import { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Coins,
  ExternalLink,
  Film,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import {
  AdNetworkConfig,
  Advertisement,
  AppRoute,
  AuthUser,
  Language,
  ManagedAdUnitConfig,
  SiteSettings,
  UserProfile,
  WalletAccount,
} from '../types/marketplace';
import {
  completeWatchEarnSessionServer,
  getWatchEarnSummaryServer,
  startWatchEarnSessionServer,
  trackAdEvent,
  verifyWatchEarnSessionServer,
  WatchEarnSummaryPayload,
} from '../lib/firestoreService';
import {
  isValidExternalAdUrl,
  resolveAdBrowserUrl,
  tryAcquireAdLaunchLock,
} from '../lib/adNavigation';

export interface WatchableAdItem {
  id: string;
  unitId: string;
  provider: string;
  titleBn: string;
  titleEn: string;
  descriptionBn: string;
  descriptionEn: string;
  targetUrl: string;
  rewardApproved: boolean;
  requiresS2SCallback: boolean;
  managedUnit?: ManagedAdUnitConfig;
}

export interface WatchRewardCompletionResult {
  coinsAwarded: number;
  alreadyCredited: boolean;
  coinsAvailable: number;
  coinsLifetimeEarned: number;
  coinsRedeemed: number;
  adsWatchedToday: number;
  coinsEarnedToday: number;
  dailyAdLimit: number;
  dailyCoinLimit: number;
  bdtEquivalent: number;
  message: string;
}

export type ExternalAdStepPhase =
  | 'opened'
  | 'counting'
  | 'ready_to_claim'
  | 'claiming'
  | 'awaiting_s2s'
  | 'credited'
  | 'failed';

export interface PersistedExternalAdStep {
  uid: string;
  unitId: string;
  adId: string;
  adTitleBn: string;
  adTitleEn: string;
  provider: string;
  targetUrl: string;
  rewardApproved: boolean;
  requiresS2SCallback: boolean;
  rewardCoins: number;
  sessionId?: string;
  sessionToken?: string;
  phase: ExternalAdStepPhase;
  openedAt: number;
  countdownStartedAt?: number;
  requiredSeconds: number;
  errorMessage?: string;
  creditResult?: WatchRewardCompletionResult;
}

const STEP_STORAGE_PREFIX = 'dh_ext_ad_step_v2_';
const STEP_EVENT_NAME = 'dh-ext-ad-step-updated';
const STEP_TTL_MS = 15 * 60 * 1000;

function getStepStorageKey(uid: string): string {
  return `${STEP_STORAGE_PREFIX}${uid}`;
}

export function loadPersistedAdStep(uid?: string): PersistedExternalAdStep | null {
  if (!uid || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(getStepStorageKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedExternalAdStep;
    if (!parsed || parsed.uid !== uid || !parsed.targetUrl) return null;
    if (Date.now() - Number(parsed.openedAt || 0) > STEP_TTL_MS) {
      window.localStorage.removeItem(getStepStorageKey(uid));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function savePersistedAdStep(uid: string, step: PersistedExternalAdStep | null): void {
  if (!uid || typeof window === 'undefined') return;
  try {
    if (!step) {
      window.localStorage.removeItem(getStepStorageKey(uid));
    } else {
      window.localStorage.setItem(getStepStorageKey(uid), JSON.stringify(step));
    }
    window.dispatchEvent(new CustomEvent(STEP_EVENT_NAME, { detail: { uid } }));
  } catch {
    // Non-fatal storage limit
  }
}

function getHostnameLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return 'external-ad';
  }
}

/**
 * Builds Watch Ad items strictly from the user's real external ad URLs
 * (managed direct links & external advertisements). Zero demo or internal URLs.
 */
export function buildWatchableAdItems(
  advertisements: Advertisement[],
  managedAdUnits: ManagedAdUnitConfig[],
  adNetworks: AdNetworkConfig[] = []
): WatchableAdItem[] {
  const today = new Date().toISOString().slice(0, 10);
  const items: WatchableAdItem[] = [];
  const seenUrls = new Set<string>();
  const seenUnitIds = new Set<string>();

  const hasApprovedNetwork = adNetworks.some(
    (n) =>
      n.enabled &&
      n.approvalStatus === 'active' &&
      n.supportsIncentivizedRewards === true &&
      n.provider !== 'adsense'
  );

  // 1. User-configured external direct_link ad units (ARWF, AUCTIONR, ASIAFILM, etc.)
  managedAdUnits
    .filter((u) => u.enabled && u.format === 'direct_link' && isValidExternalAdUrl(u.originalUrl))
    .sort((a, b) => a.priority - b.priority)
    .forEach((u) => {
      const normalizedUrl = u.originalUrl.trim();
      if (seenUrls.has(normalizedUrl) || seenUnitIds.has(u.id)) return;
      seenUrls.add(normalizedUrl);
      seenUnitIds.add(u.id);
      const rewardApproved = u.supportsRewardedVerification === true;
      items.push({
        id: u.id,
        unitId: u.id,
        provider: u.provider,
        titleBn: u.labelBn,
        titleEn: u.label,
        descriptionBn: rewardApproved
          ? `অনুমোদিত এক্সটার্নাল রিওয়ার্ড বিজ্ঞাপন (${getHostnameLabel(normalizedUrl)})`
          : `এক্সটার্নাল বিজ্ঞাপন লিংক (${getHostnameLabel(normalizedUrl)})`,
        descriptionEn: rewardApproved
          ? `Policy-approved external reward ad (${getHostnameLabel(normalizedUrl)})`
          : `External partner ad link (${getHostnameLabel(normalizedUrl)})`,
        targetUrl: normalizedUrl,
        rewardApproved,
        requiresS2SCallback: false,
        managedUnit: u,
      });
    });

  // 2. Enabled external advertisements (preserves any unique admin-managed external URLs)
  advertisements
    .filter((ad) => {
      if (!ad.enabled) return false;
      if (ad.startDate && ad.startDate > today) return false;
      if (ad.endDate && ad.endDate < today) return false;
      return isValidExternalAdUrl(ad.targetUrl);
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || b.priority - a.priority)
    .forEach((ad) => {
      const normalizedUrl = ad.targetUrl.trim();
      const unitId = ad.code || ad.id;
      if (seenUrls.has(normalizedUrl) || seenUnitIds.has(unitId)) return;
      seenUrls.add(normalizedUrl);
      seenUnitIds.add(unitId);
      const matchingNet = adNetworks.find(
        (n) =>
          n.enabled &&
          n.approvalStatus === 'active' &&
          n.supportsIncentivizedRewards === true &&
          (n.name.toLowerCase() === (ad.networkName || '').toLowerCase() ||
            n.provider.toLowerCase() === (ad.networkName || '').toLowerCase())
      );
      const rewardApproved = Boolean(matchingNet || (hasApprovedNetwork && ad.adFormat === 'direct_link'));
      items.push({
        id: ad.id,
        unitId,
        provider: ad.networkName || 'PARTNER',
        titleBn: ad.titleBn,
        titleEn: ad.titleEn,
        descriptionBn: ad.descriptionBn || `এক্সটার্নাল বিজ্ঞাপন লিংক (${getHostnameLabel(normalizedUrl)})`,
        descriptionEn: ad.descriptionEn || `External partner ad link (${getHostnameLabel(normalizedUrl)})`,
        targetUrl: normalizedUrl,
        rewardApproved,
        requiresS2SCallback: false,
      });
    });

  return items;
}

/**
 * Shared hook managing single-tab external ad execution, tab return detection,
 * 5-second countdown, Claim Coins / step completion, and persistent state.
 */
export function useExternalWatchAdController({
  uid,
  isSuspended,
  coinsPerAd,
  onCredited,
}: {
  uid?: string;
  isSuspended?: boolean;
  coinsPerAd: number;
  onCredited?: (res: WatchRewardCompletionResult) => void;
}) {
  const [activeStep, setActiveStep] = useState<PersistedExternalAdStep | null>(() => loadPersistedAdStep(uid));
  const [secondsLeft, setSecondsLeft] = useState<number>(5);
  const [busyAction, setBusyAction] = useState(false);
  const claimLockRef = useRef(false);
  const leftTabRef = useRef(false);

  // Sync across components & page refreshes when uid changes or localStorage updates
  useEffect(() => {
    setActiveStep(loadPersistedAdStep(uid));
    if (!uid) return;
    const onSync = (ev: Event) => {
      const detail = (ev as CustomEvent<{ uid?: string }>).detail;
      if (!detail || detail.uid === uid) {
        setActiveStep(loadPersistedAdStep(uid));
      }
    };
    window.addEventListener(STEP_EVENT_NAME, onSync);
    return () => window.removeEventListener(STEP_EVENT_NAME, onSync);
  }, [uid]);

  const updateStep = useCallback(
    (next: PersistedExternalAdStep | null) => {
      setActiveStep(next);
      if (uid) {
        savePersistedAdStep(uid, next);
      }
    },
    [uid]
  );

  // Detect tab switch away + return back to Digital Hub BD cleanly without forcing re-login
  useEffect(() => {
    if (!uid || !activeStep || activeStep.phase !== 'opened') return;

    const triggerCountdown = () => {
      const latest = loadPersistedAdStep(uid);
      if (!latest || latest.phase !== 'opened') return;
      if (Date.now() - latest.openedAt < 500) return;
      updateStep({
        ...latest,
        phase: 'counting',
        countdownStartedAt: Date.now(),
      });
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        leftTabRef.current = true;
      } else if (document.visibilityState === 'visible') {
        if (leftTabRef.current || Date.now() - activeStep.openedAt >= 1200) {
          triggerCountdown();
        }
      }
    };

    const onBlur = () => {
      leftTabRef.current = true;
    };

    const onFocus = () => {
      if (leftTabRef.current || Date.now() - activeStep.openedAt >= 1200) {
        triggerCountdown();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [uid, activeStep?.phase, activeStep?.openedAt, updateStep]);

  // 5-second countdown timer whenever phase === 'counting'
  useEffect(() => {
    if (!uid || !activeStep || activeStep.phase !== 'counting') {
      setSecondsLeft(activeStep?.requiredSeconds ?? 5);
      return;
    }

    const computeRemaining = () => {
      const startTs = activeStep.countdownStartedAt || Date.now();
      const totalMs = Math.max(5, activeStep.requiredSeconds || 5) * 1000;
      return Math.max(0, Math.ceil((startTs + totalMs - Date.now()) / 1000));
    };

    const tick = () => {
      const rem = computeRemaining();
      setSecondsLeft(rem);
      if (rem <= 0) {
        const latest = loadPersistedAdStep(uid);
        if (latest && latest.phase === 'counting') {
          updateStep({
            ...latest,
            phase: latest.requiresS2SCallback ? 'awaiting_s2s' : 'ready_to_claim',
          });
        }
      }
    };

    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [uid, activeStep?.phase, activeStep?.countdownStartedAt, activeStep?.requiredSeconds, updateStep]);

  const hasBlockingActiveStep = Boolean(
    activeStep &&
      activeStep.phase !== 'credited' &&
      activeStep.phase !== 'failed'
  );

  // Invoked synchronously on <a target="_blank"> click so the browser opens a single new tab natively
  const handleOpenExternalAd = (
    e: MouseEvent<HTMLAnchorElement>,
    item: WatchableAdItem,
    lang: Language
  ) => {
    if (!uid || isSuspended || hasBlockingActiveStep) {
      e.preventDefault();
      return;
    }
    const launch = resolveAdBrowserUrl(item.targetUrl);
    if (!launch.ok || !tryAcquireAdLaunchLock(`ext_${item.unitId}`, launch.finalHttpUrl, 2000)) {
      e.preventDefault();
      return;
    }

    leftTabRef.current = false;
    trackAdEvent(item.unitId, 'impression', 'watch_earn_link', 'direct_link');
    trackAdEvent(item.unitId, 'click', 'watch_earn_link', 'direct_link');

    const newStep: PersistedExternalAdStep = {
      uid,
      unitId: item.unitId,
      adId: item.id,
      adTitleBn: item.titleBn,
      adTitleEn: item.titleEn,
      provider: item.provider,
      targetUrl: item.targetUrl,
      rewardApproved: item.rewardApproved,
      requiresS2SCallback: item.requiresS2SCallback,
      rewardCoins: item.rewardApproved ? coinsPerAd : 0,
      phase: 'opened',
      openedAt: Date.now(),
      requiredSeconds: 5,
    };
    updateStep(newStep);

    // If this unit is policy-approved for rewards, register the server session right away
    if (item.rewardApproved) {
      startWatchEarnSessionServer({
        unitId: item.unitId,
        provider: item.provider,
        launchUrl: item.targetUrl,
        adTitle: lang === 'bn' ? item.titleBn : item.titleEn,
      })
        .then((res) => {
          const cur = loadPersistedAdStep(uid);
          if (!cur || cur.unitId !== item.unitId || cur.openedAt !== newStep.openedAt) return;
          updateStep({
            ...cur,
            sessionId: res.sessionId,
            sessionToken: res.sessionToken,
            rewardCoins: res.rewardCoins || coinsPerAd,
            requiredSeconds: res.requiredSeconds || 5,
            requiresS2SCallback: res.requiresS2SCallback,
          });
        })
        .catch((err) => {
          const cur = loadPersistedAdStep(uid);
          if (!cur || cur.unitId !== item.unitId) return;
          updateStep({
            ...cur,
            phase: 'failed',
            errorMessage: err instanceof Error ? err.message : 'Reward session could not be verified.',
          });
        });
    }
  };

  const handleManualStartCountdown = () => {
    if (!activeStep || activeStep.phase !== 'opened') return;
    updateStep({
      ...activeStep,
      phase: 'counting',
      countdownStartedAt: Date.now(),
    });
  };

  const handleClaimOrFinishStep = async (lang: Language) => {
    if (!uid || !activeStep || claimLockRef.current) return;

    // Unapproved display-only link step completion (0 coins, unlocks next ad cleanly)
    if (!activeStep.rewardApproved) {
      updateStep({
        ...activeStep,
        phase: 'credited',
        creditResult: {
          coinsAwarded: 0,
          alreadyCredited: false,
          coinsAvailable: 0,
          coinsLifetimeEarned: 0,
          coinsRedeemed: 0,
          adsWatchedToday: 0,
          coinsEarnedToday: 0,
          dailyAdLimit: 5,
          dailyCoinLimit: 100,
          bdtEquivalent: 0,
          message:
            lang === 'bn'
              ? 'ধাপ সম্পন্ন হয়েছে। নেটওয়ার্ক পলিসি অনুমোদিত না থাকায় কয়েন যোগ হয়নি।'
              : 'Step completed. No coins credited because network policy has not approved rewards.',
        },
      });
      return;
    }

    if (!activeStep.sessionId || !activeStep.sessionToken) {
      updateStep({
        ...activeStep,
        phase: 'failed',
        errorMessage:
          lang === 'bn'
            ? 'সার্ভার সেশন পাওয়া যায়নি। অনুগ্রহ করে আবার বিজ্ঞাপনটি ওপেন করুন।'
            : 'Server session not initialized. Please re-open the ad.',
      });
      return;
    }

    claimLockRef.current = true;
    setBusyAction(true);
    updateStep({ ...activeStep, phase: 'claiming', errorMessage: '' });

    try {
      const res = await completeWatchEarnSessionServer({
        sessionId: activeStep.sessionId,
        sessionToken: activeStep.sessionToken,
        adLoaded: true,
      });
      const result: WatchRewardCompletionResult = {
        coinsAwarded: res.coinsAwarded,
        alreadyCredited: res.alreadyCredited,
        coinsAvailable: res.coinsAvailable,
        coinsLifetimeEarned: res.coinsLifetimeEarned,
        coinsRedeemed: res.coinsRedeemed,
        adsWatchedToday: res.adsWatchedToday,
        coinsEarnedToday: res.coinsEarnedToday,
        dailyAdLimit: res.dailyAdLimit,
        dailyCoinLimit: res.dailyCoinLimit,
        bdtEquivalent: res.bdtEquivalent,
        message: res.message,
      };
      updateStep({
        ...activeStep,
        phase: 'credited',
        creditResult: result,
      });
      onCredited?.(result);
    } catch (err) {
      updateStep({
        ...activeStep,
        phase: 'failed',
        errorMessage:
          err instanceof Error
            ? err.message
            : lang === 'bn'
              ? 'কয়েন ক্লেইম করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
              : 'Could not claim coins. Please try again.',
      });
    } finally {
      setBusyAction(false);
      claimLockRef.current = false;
    }
  };

  const handleCheckS2SVerification = async () => {
    if (!uid || !activeStep?.sessionId || busyAction) return;
    setBusyAction(true);
    try {
      const check = await verifyWatchEarnSessionServer(activeStep.sessionId);
      if (check.verified) {
        const sum = await getWatchEarnSummaryServer();
        const result: WatchRewardCompletionResult = {
          coinsAwarded: check.coinsAwarded,
          alreadyCredited: false,
          coinsAvailable: sum.coinsAvailable,
          coinsLifetimeEarned: sum.coinsLifetimeEarned,
          coinsRedeemed: sum.coinsRedeemed,
          adsWatchedToday: sum.adsWatchedToday,
          coinsEarnedToday: sum.coinsEarnedToday,
          dailyAdLimit: sum.dailyAdLimit,
          dailyCoinLimit: sum.dailyCoinLimit,
          bdtEquivalent: Number((check.coinsAwarded / Math.max(1, sum.coinsPerBdt)).toFixed(2)),
          message: check.message,
        };
        updateStep({ ...activeStep, phase: 'credited', creditResult: result });
        onCredited?.(result);
      } else {
        updateStep({ ...activeStep, errorMessage: check.message });
      }
    } catch (err) {
      updateStep({
        ...activeStep,
        errorMessage: err instanceof Error ? err.message : 'Verification pending.',
      });
    } finally {
      setBusyAction(false);
    }
  };

  const resetActiveStep = () => updateStep(null);

  return {
    activeStep,
    secondsLeft,
    busyAction,
    hasBlockingActiveStep,
    handleOpenExternalAd,
    handleManualStartCountdown,
    handleClaimOrFinishStep,
    handleCheckS2SVerification,
    resetActiveStep,
  };
}

export function ActiveAdSessionStatusPanel({
  step,
  secondsLeft,
  busyAction,
  lang,
  coinsPerBdt,
  onStartCountdown,
  onClaimCoins,
  onCheckS2S,
  onResetStep,
  onGoWallet,
}: {
  step: PersistedExternalAdStep;
  secondsLeft: number;
  busyAction: boolean;
  lang: Language;
  coinsPerBdt: number;
  onStartCountdown: () => void;
  onClaimCoins: () => void;
  onCheckS2S: () => void;
  onResetStep: () => void;
  onGoWallet?: () => void;
}) {
  const title = lang === 'bn' ? step.adTitleBn : step.adTitleEn;
  const statusLabel =
    step.phase === 'opened'
      ? lang === 'bn'
        ? 'নতুন ট্যাবে বিজ্ঞাপন খোলা হয়েছে — ফিরে আসুন'
        : 'Ad Opened in New Tab — Return to Verify'
      : step.phase === 'counting'
        ? lang === 'bn'
          ? `কাউন্টডাউন চলছে (${secondsLeft} সেকেন্ড)`
          : `Counting Down (${secondsLeft}s remaining)`
        : step.phase === 'ready_to_claim'
          ? step.rewardApproved
            ? lang === 'bn'
              ? 'কয়েন ক্লেইম করার জন্য প্রস্তুত'
              : 'Ready to Claim Coins'
            : lang === 'bn'
              ? 'ধাপ সম্পন্ন — পরের বিজ্ঞাপন আনলক করুন'
              : 'Ready to Complete Step'
          : step.phase === 'claiming'
            ? lang === 'bn'
              ? 'কয়েন যাচাই ও যোগ হচ্ছে...'
              : 'Verifying & Claiming Coins...'
            : step.phase === 'awaiting_s2s'
              ? lang === 'bn'
                ? 'প্রোভাইডার S2S যাচাইয়ের অপেক্ষায়'
                : 'Awaiting Provider S2S Callback'
              : step.phase === 'credited'
                ? lang === 'bn'
                  ? 'ধাপ সম্পন্ন হয়েছে'
                  : 'Step Completed'
                : lang === 'bn'
                  ? 'সেশন ত্রুটি'
                  : 'Session Error';

  const progressPct =
    step.phase === 'credited' || step.phase === 'ready_to_claim' || step.phase === 'claiming'
      ? 100
      : step.phase === 'counting'
        ? Math.min(100, Math.round(((step.requiredSeconds - secondsLeft) / step.requiredSeconds) * 100))
        : 20;

  return (
    <div className="rounded-2xl border border-[#FF8500]/45 bg-[#FFF9F2] dark:bg-slate-900 p-4 space-y-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="px-2 py-0.5 rounded-md bg-[#172033] text-white text-[10px] font-mono-num font-bold">
              {step.unitId}
            </span>
            <span
              className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                step.phase === 'credited'
                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                  : step.phase === 'failed'
                    ? 'bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300'
                    : 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
              }`}
            >
              {statusLabel}
            </span>
          </div>
          <p className="text-xs sm:text-sm font-extrabold text-[#172033] dark:text-slate-100 truncate mt-1">
            {title} · <span className="font-mono-num text-[#777777] dark:text-slate-400">{step.provider}</span>
          </p>
        </div>

        {step.phase === 'counting' && (
          <span className="px-3 py-1 rounded-xl dh-orange-gradient text-white text-xs font-extrabold font-mono-num inline-flex items-center gap-1 shrink-0">
            <Clock className="w-3.5 h-3.5" />
            {secondsLeft}s
          </span>
        )}
      </div>

      {/* Smooth Progress Bar */}
      <div className="h-1.5 w-full rounded-full bg-[#E6ECFA] dark:bg-slate-800 overflow-hidden">
        <div
          className={`h-full transition-[width] duration-300 ${
            step.phase === 'credited'
              ? 'bg-emerald-500'
              : step.phase === 'failed'
                ? 'bg-red-500'
                : 'bg-[#FF8500]'
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {step.phase === 'opened' && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <p className="text-[#555555] dark:text-slate-300">
            {lang === 'bn'
              ? 'নতুন ট্যাবে বিজ্ঞাপনটি দেখে এই পেজে ফিরে এলেই ৫ সেকেন্ডের কাউন্টডাউন শুরু হবে।'
              : 'View the ad in the new tab and return here to start the 5-second countdown.'}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onStartCountdown}
              className="px-3.5 py-2 rounded-xl dh-orange-gradient text-white font-bold text-xs inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? '৫ সেকেন্ড কাউন্টডাউন শুরু করুন' : 'Start 5s Countdown'}</span>
            </button>
            <button
              type="button"
              onClick={onResetStep}
              className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200 font-bold text-xs"
            >
              {lang === 'bn' ? 'বাতিল' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {step.phase === 'counting' && (
        <p className="text-xs font-semibold text-[#172033] dark:text-slate-200">
          {step.rewardApproved
            ? lang === 'bn'
              ? `অনুগ্রহ করে ${secondsLeft} সেকেন্ড অপেক্ষা করুন — শেষ হলেই Claim Coins বাটন আসবে।`
              : `Please wait ${secondsLeft}s — Claim Coins button will appear at 0s.`
            : lang === 'bn'
              ? `ভিউ যাচাই চলছে (${secondsLeft} সেকেন্ড বাকি)...`
              : `Verifying ad view (${secondsLeft}s remaining)...`}
        </p>
      )}

      {step.phase === 'ready_to_claim' && (
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <p className="text-xs text-[#555555] dark:text-slate-300">
            {step.rewardApproved
              ? lang === 'bn'
                ? `৫ সেকেন্ড সম্পন্ন! এখন Claim Coins বাটনে চাপ দিয়ে +${step.rewardCoins} কয়েন সংগ্রহ করুন।`
                : `5s countdown finished! Tap Claim Coins to collect +${step.rewardCoins} Coins.`
              : lang === 'bn'
                ? 'এই বিজ্ঞাপন নেটওয়ার্কটি এখনো রিওয়ার্ড অনুমোদন করেনি (Display Only)। পরের বিজ্ঞাপন দেখতে ধাপটি সম্পন্ন করুন।'
                : 'Network policy has not approved rewarded coins for this ad (Display Only). Complete this step to unlock the next ad.'}
          </p>
          <button
            type="button"
            disabled={busyAction}
            onClick={onClaimCoins}
            className="px-4 py-2.5 rounded-xl dh-orange-gradient text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm hover:opacity-95 cursor-pointer shrink-0"
          >
            {step.rewardApproved ? <Coins className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
            <span>
              {step.rewardApproved
                ? lang === 'bn'
                  ? `Claim Coins (+${step.rewardCoins})`
                  : `Claim Coins (+${step.rewardCoins})`
                : lang === 'bn'
                  ? 'ধাপ সম্পন্ন ও আনলক করুন'
                  : 'Complete Step & Unlock Next'}
            </span>
          </button>
        </div>
      )}

      {step.phase === 'claiming' && (
        <div className="flex items-center gap-2 text-xs font-bold text-[#172033] dark:text-slate-200">
          <Loader2 className="w-4 h-4 text-[#FF8500] animate-spin shrink-0" />
          <span>{lang === 'bn' ? 'ডাটাবেসে কয়েন সেভ হচ্ছে...' : 'Saving verified coins to database...'}</span>
        </div>
      )}

      {step.phase === 'awaiting_s2s' && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="text-[#555555] dark:text-slate-300">
            {lang === 'bn'
              ? 'নেটওয়ার্ক S2S কলব্যাক নিশ্চিত হলেই কয়েন যোগ হবে।'
              : 'Waiting for provider S2S callback confirmation.'}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busyAction}
              onClick={onCheckS2S}
              className="px-3.5 py-2 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busyAction ? 'animate-spin' : ''}`} />
              <span>{lang === 'bn' ? 'স্ট্যাটাস চেক করুন' : 'Check Status'}</span>
            </button>
            <button
              type="button"
              onClick={onResetStep}
              className="px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold"
            >
              {lang === 'bn' ? 'বন্ধ করুন' : 'Dismiss'}
            </button>
          </div>
        </div>
      )}

      {step.phase === 'credited' && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-start gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="font-extrabold text-emerald-800 dark:text-emerald-300">
                {step.creditResult && step.creditResult.coinsAwarded > 0
                  ? lang === 'bn'
                    ? `সফল! +${step.creditResult.coinsAwarded} কয়েন যোগ হয়েছে (মোট: ${step.creditResult.coinsAvailable} কয়েন = ৳${(step.creditResult.coinsAvailable / Math.max(1, coinsPerBdt)).toFixed(2)})`
                    : `Success! +${step.creditResult.coinsAwarded} Coins credited (Balance: ${step.creditResult.coinsAvailable} Coins)`
                  : step.creditResult?.message ||
                    (lang === 'bn' ? 'ধাপ সম্পন্ন হয়েছে — পরবর্তী বিজ্ঞাপন আনলক!' : 'Step finished — Next ad unlocked!')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onGoWallet && (
              <button
                type="button"
                onClick={onGoWallet}
                className="px-3 py-1.5 rounded-lg bg-[#172033] text-white font-bold inline-flex items-center gap-1"
              >
                <Wallet className="w-3 h-3" />
                <span>{lang === 'bn' ? 'ওয়ালেট' : 'Wallet'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onResetStep}
              className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 text-emerald-800 dark:text-emerald-300 font-bold"
            >
              {lang === 'bn' ? 'পরবর্তী বিজ্ঞাপন দেখুন' : 'Ready for Next Ad'}
            </button>
          </div>
        </div>
      )}

      {step.phase === 'failed' && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/35 border border-red-200 dark:border-red-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-[#DC2626] shrink-0" />
            <span className="text-red-800 dark:text-red-300 font-semibold">
              {step.errorMessage || (lang === 'bn' ? 'সেশন সম্পন্ন করা যায়নি।' : 'Could not complete ad session.')}
            </span>
          </div>
          <button
            type="button"
            onClick={onResetStep}
            className="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-red-300 dark:border-red-700 text-[#172033] dark:text-slate-100 font-bold inline-flex items-center gap-1 shrink-0"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{lang === 'bn' ? 'রিসেট করুন' : 'Reset'}</span>
          </button>
        </div>
      )}
    </div>
  );
}

interface WatchEarnHomeBannerProps {
  lang: Language;
  user: AuthUser | null;
  profile: UserProfile | null;
  wallet: WalletAccount | null;
  settings: SiteSettings;
  advertisements: Advertisement[];
  managedAdUnits: ManagedAdUnitConfig[];
  adNetworks?: AdNetworkConfig[];
  onNavigate: (r: AppRoute) => void;
  onOpenAuth: () => void;
  onToast?: (msg: string) => void;
}

export function WatchEarnHomeBanner({
  lang,
  user,
  profile,
  wallet,
  settings,
  advertisements,
  managedAdUnits,
  adNetworks = [],
  onNavigate,
  onOpenAuth,
  onToast,
}: WatchEarnHomeBannerProps) {
  const [summary, setSummary] = useState<WatchEarnSummaryPayload | null>(null);
  const [adCursor, setAdCursor] = useState(0);

  const watchableAds = useMemo(
    () => buildWatchableAdItems(advertisements, managedAdUnits, adNetworks),
    [advertisements, managedAdUnits, adNetworks]
  );

  useEffect(() => {
    if (!user) {
      setSummary(null);
      return;
    }
    getWatchEarnSummaryServer().then(setSummary).catch(() => {});
  }, [user?.uid, wallet?.coinsAvailable]);

  const watchEarnEnabled =
    settings.adsEnabled !== false &&
    settings.watchEarnEnabled !== false &&
    settings.rewardedAdEnabled !== false;

  const coinsPerAd = summary?.coinsPerAd || Math.max(1, settings.watchEarnCoinsPerAd ?? 5);
  const coinsPerBdt = summary?.coinsPerBdt || Math.max(1, settings.watchEarnCoinsPerBdt ?? 10);
  const dailyAdLimit = summary?.dailyAdLimit || Math.max(1, settings.rewardedAdDailyLimit ?? 5);
  const adsWatchedToday = summary?.adsWatchedToday ?? 0;
  const currentCoins = Math.max(wallet?.coinsAvailable ?? 0, summary?.coinsAvailable ?? 0);
  const canWatchMore = adsWatchedToday < dailyAdLimit;

  const controller = useExternalWatchAdController({
    uid: user?.uid,
    isSuspended: profile?.status === 'suspended',
    coinsPerAd,
    onCredited: (res) => {
      setAdCursor((prev) => prev + 1);
      if (res.coinsAwarded > 0) {
        setSummary((prev) => ({
          ...(prev || {
            coinsAvailable: 0,
            coinsLifetimeEarned: 0,
            coinsRedeemed: 0,
            adsWatchedToday: 0,
            coinsEarnedToday: 0,
            dailyAdLimit,
            dailyCoinLimit: settings.watchEarnDailyCoinLimit ?? 100,
            coinsPerAd,
            coinsPerBdt,
            minRedeemCoins: settings.watchEarnMinRedeemCoins ?? 50,
            watchEarnEnabled: true,
            creditedSessions: [],
          }),
          coinsAvailable: res.coinsAvailable,
          coinsLifetimeEarned: res.coinsLifetimeEarned,
          coinsRedeemed: res.coinsRedeemed,
          adsWatchedToday: res.adsWatchedToday,
          coinsEarnedToday: res.coinsEarnedToday,
          dailyAdLimit: res.dailyAdLimit,
          dailyCoinLimit: res.dailyCoinLimit,
        }));
        onToast?.(
          lang === 'bn'
            ? `+${res.coinsAwarded} কয়েন যোগ হয়েছে! মোট কয়েন: ${res.coinsAvailable}`
            : `+${res.coinsAwarded} Coins credited! Balance: ${res.coinsAvailable}`
        );
      }
    },
  });

  if (!watchEarnEnabled) return null;

  const nextAd = watchableAds.length > 0 ? watchableAds[adCursor % watchableAds.length] : null;
  const nextLaunch = nextAd ? resolveAdBrowserUrl(nextAd.targetUrl) : null;
  const hasRewardApprovedAds = watchableAds.some((a) => a.rewardApproved);

  return (
    <section className="w-full max-w-full overflow-hidden rounded-3xl bg-gradient-to-br from-[#172033] via-[#1d2b45] to-[#263759] text-white p-4 sm:p-6 shadow-lg border border-[#FF8500]/30 space-y-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md bg-[#FF8500] text-white text-[10px] font-extrabold uppercase tracking-wider">
              <Sparkles className="w-3 h-3" />
              {lang === 'bn' ? 'ওয়াচ অ্যাডস ও আর্ন কয়েন' : 'Watch Ads & Earn Coins'}
            </span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/10 text-[#FACC15] text-[10px] font-bold font-mono-num">
              <Clock className="w-3 h-3" />
              5s = +{coinsPerAd} {lang === 'bn' ? 'কয়েন' : 'Coins'}
            </span>
          </div>

          <h2 className="text-lg sm:text-2xl font-extrabold leading-tight tracking-tight">
            {lang === 'bn'
              ? `নতুন ট্যাবে বিজ্ঞাপন দেখুন ও ফিরে এসে কয়েন ক্লেইম করুন`
              : `Open Partner Ads in New Tab & Claim +${coinsPerAd} Coins on Return`}
          </h2>
          <p className="text-xs sm:text-sm text-white/80 max-w-2xl leading-relaxed">
            {hasRewardApprovedAds
              ? lang === 'bn'
                ? `অনুমোদিত বিজ্ঞাপনে Open Ad চাপুন → নতুন ট্যাবে দেখে ফিরে আসুন → ৫ সেকেন্ডের কাউন্টডাউন শেষে Claim Coins চাপলেই +${coinsPerAd} কয়েন জমা হবে (${coinsPerBdt} কয়েন = ৳১)।`
                : `Tap Open Ad → view in new tab and return → wait 5s countdown → Claim Coins (+${coinsPerAd} Coins, ${coinsPerBdt} Coins = ৳1).`
              : lang === 'bn'
                ? 'আপনার সংযুক্ত এক্সটার্নাল বিজ্ঞাপন লিংকসমূহ একটি করে নতুন ট্যাবে খুলুন। নেটওয়ার্ক পলিসি অনুমোদিত ইউনিটগুলোতে ৫ সেকেন্ডের রিওয়ার্ড সক্রিয় থাকে।'
                : 'Open your connected external ad links one at a time in a new tab. Coins unlock wherever the ad network policy approves rewarded traffic.'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row lg:flex-col xl:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
          <div className="flex items-center justify-between sm:justify-start gap-3 px-3.5 py-2.5 rounded-2xl bg-white/10 border border-white/15">
            <div>
              <p className="text-[10px] text-white/70 uppercase font-semibold">
                {lang === 'bn' ? 'কয়েন ব্যালেন্স' : 'Your Coins'}
              </p>
              <p className="text-base sm:text-lg font-extrabold font-mono-num text-[#FACC15] leading-tight">
                {currentCoins}{' '}
                <span className="text-[11px] font-normal text-white/75">
                  (৳{(currentCoins / coinsPerBdt).toFixed(2)})
                </span>
              </p>
            </div>
            <div className="h-7 w-px bg-white/15" />
            <div>
              <p className="text-[10px] text-white/70 uppercase font-semibold">
                {lang === 'bn' ? 'আজকের সীমা' : 'Today'}
              </p>
              <p className="text-sm font-extrabold font-mono-num text-white leading-tight">
                {adsWatchedToday}/{dailyAdLimit}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
            {!user ? (
              <button
                type="button"
                onClick={onOpenAuth}
                className="flex-1 sm:flex-none px-4 sm:px-5 py-3 rounded-2xl dh-orange-gradient text-white text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-2 shadow-md hover:opacity-95 cursor-pointer whitespace-nowrap"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>{lang === 'bn' ? 'লগইন করে Watch Ad শুরু করুন' : 'Sign In to Watch Ad'}</span>
              </button>
            ) : controller.hasBlockingActiveStep || !nextAd || !nextLaunch?.ok || (nextAd.rewardApproved && !canWatchMore) ? (
              <button
                type="button"
                onClick={() => onNavigate('watch-earn')}
                className="flex-1 sm:flex-none px-4 sm:px-5 py-3 rounded-2xl dh-orange-gradient text-white text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-2 shadow-md hover:opacity-95 cursor-pointer whitespace-nowrap"
              >
                {controller.hasBlockingActiveStep ? <Lock className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                <span>
                  {controller.hasBlockingActiveStep
                    ? lang === 'bn'
                      ? 'চলমান বিজ্ঞাপন সম্পন্ন করুন'
                      : 'Complete Active Ad Step'
                    : lang === 'bn'
                      ? 'Watch Ad পেজে যান'
                      : 'Go to Watch Ad'}
                </span>
              </button>
            ) : (
              <a
                href={nextLaunch.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                onClick={(e) => controller.handleOpenExternalAd(e, nextAd, lang)}
                className="flex-1 sm:flex-none px-4 sm:px-5 py-3 rounded-2xl dh-orange-gradient text-white text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-2 shadow-md hover:opacity-95 cursor-pointer whitespace-nowrap"
              >
                <ExternalLink className="w-4 h-4" />
                <span>
                  {nextAd.rewardApproved
                    ? lang === 'bn'
                      ? `Open Ad (+${coinsPerAd})`
                      : `Watch Ad (+${coinsPerAd} Coins)`
                    : lang === 'bn'
                      ? 'Open Ad (নতুন ট্যাব)'
                      : 'Open Ad'}
                </span>
              </a>
            )}

            <button
              type="button"
              onClick={() => onNavigate('watch-earn')}
              className="px-3.5 py-3 rounded-2xl bg-white/12 hover:bg-white/20 text-white text-xs font-bold inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
            >
              <Film className="w-3.5 h-3.5 text-[#FF9B19]" />
              <span>{lang === 'bn' ? 'সব বিজ্ঞাপন ও হিস্ট্রি' : 'All Ads & History'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Synced Active Session Panel if user opened an ad from Homepage or Watch Page */}
      {user && controller.activeStep && (
        <div className="text-[#172033] dark:text-slate-100">
          <ActiveAdSessionStatusPanel
            step={controller.activeStep}
            secondsLeft={controller.secondsLeft}
            busyAction={controller.busyAction}
            lang={lang}
            coinsPerBdt={coinsPerBdt}
            onStartCountdown={controller.handleManualStartCountdown}
            onClaimCoins={() => void controller.handleClaimOrFinishStep(lang)}
            onCheckS2S={() => void controller.handleCheckS2SVerification()}
            onResetStep={controller.resetActiveStep}
            onGoWallet={() => onNavigate('watch-earn')}
          />
        </div>
      )}

      <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/70">
        <span className="inline-flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          {lang === 'bn'
            ? 'একবারে একটি ট্যাব · সেশন ও ব্যালেন্স স্থায়ী সেভ · নেটওয়ার্ক পলিসি সুরক্ষা'
            : 'One ad step at a time · Persistent return session · Network-policy protected'}
        </span>
      </div>
    </section>
  );
}
