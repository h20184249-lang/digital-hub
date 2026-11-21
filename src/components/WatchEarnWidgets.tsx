import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Coins,
  ExternalLink,
  Film,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import {
  AdNetworkConfig,
  Advertisement,
  AppRoute,
  AuthUser,
  Language,
  ManagedAdUnitConfig,
  ManagedAdUnitStatus,
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
import { classifyAdMediaUrl, resolveAdBrowserUrl, tryAcquireAdLaunchLock } from '../lib/adNavigation';
import { AUTHORIZED_REWARD_ADS } from '../lib/adProviderConfig';
import { resolveStudioImage } from '../lib/studioAssets';
import { AdUnitCardOrBanner } from './AdUnitFrame';

export interface WatchableAdItem {
  id: string;
  unitId: string;
  provider: string;
  titleBn: string;
  titleEn: string;
  descriptionBn: string;
  descriptionEn: string;
  kind: 'sponsored_creative' | 'video' | 'script_banner';
  mediaUrl?: string;
  imageUrl?: string;
  targetUrl: string;
  managedUnit?: ManagedAdUnitConfig;
  supportsRewardedVerification: boolean;
  rewardMode: 'first_party_timer' | 's2s_callback';
}

export function buildWatchableAdItems(
  _advertisements: Advertisement[],
  managedAdUnits: ManagedAdUnitConfig[],
  adNetworks: AdNetworkConfig[] = []
): WatchableAdItem[] {
  const items: WatchableAdItem[] = [];
  const seen = new Set<string>();

  // 1. Authorized first-party DIGITAL HUB Reward Ads (server-enforced 5s viewing timer = +5 coins)
  // Third-party non-incentivized display networks are NEVER eligible to mint Watch & Earn coins.
  AUTHORIZED_REWARD_ADS.forEach((rewardAd) => {
    if (seen.has(rewardAd.unitId)) return;
    seen.add(rewardAd.unitId);
    items.push({
      id: rewardAd.id,
      unitId: rewardAd.unitId,
      provider: rewardAd.provider,
      titleBn: rewardAd.titleBn,
      titleEn: rewardAd.titleEn,
      descriptionBn: rewardAd.descriptionBn,
      descriptionEn: rewardAd.descriptionEn,
      kind: 'sponsored_creative',
      imageUrl: rewardAd.imageUrl,
      targetUrl: rewardAd.targetUrl,
      supportsRewardedVerification: true,
      rewardMode: 'first_party_timer',
    });
  });

  // 2. Third-party managed ad units ONLY when explicitly approved for S2S rewarded verification
  managedAdUnits
    .filter(
      (u) =>
        u.enabled &&
        u.supportsRewardedVerification === true &&
        (u.format === 'banner_iframe' || u.format === 'native_widget' || u.format === 'direct_link')
    )
    .sort((a, b) => a.priority - b.priority)
    .forEach((u) => {
      if (seen.has(u.id)) return;
      seen.add(u.id);
      items.push({
        id: u.id,
        unitId: u.id,
        provider: u.provider,
        titleBn: u.labelBn,
        titleEn: u.label,
        descriptionBn: `${u.provider} অনুমোদিত S2S রিওয়ার্ডেড অ্যাড`,
        descriptionEn: `${u.provider} S2S-verified rewarded ad`,
        kind: u.format === 'direct_link' ? 'sponsored_creative' : 'script_banner',
        targetUrl: u.originalUrl,
        managedUnit: u,
        supportsRewardedVerification: true,
        rewardMode: 's2s_callback',
      });
    });

  // 3. Approved third-party ad networks ONLY when explicitly marked supportsIncentivizedRewards === true
  adNetworks
    .filter((n) => n.enabled && n.supportsIncentivizedRewards === true && n.approvalStatus === 'active')
    .forEach((n) => {
      if (seen.has(n.id)) return;
      seen.add(n.id);
      items.push({
        id: n.id,
        unitId: n.id,
        provider: n.provider.toUpperCase(),
        titleBn: n.name,
        titleEn: n.name,
        descriptionBn: `${n.provider} S2S অনুমোদিত রিওয়ার্ডেড নেটওয়ার্ক`,
        descriptionEn: `${n.provider} S2S-verified rewarded network`,
        kind: 'sponsored_creative',
        targetUrl: '/?route=watch-earn',
        supportsRewardedVerification: true,
        rewardMode: 's2s_callback',
      });
    });

  return items;
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

interface WatchAdModalProps {
  open: boolean;
  ad: WatchableAdItem | null;
  session: {
    sessionId: string;
    sessionToken: string;
    requiredSeconds: number;
    rewardCoins: number;
    requiresS2SCallback?: boolean;
  } | null;
  lang: Language;
  coinsPerBdt: number;
  canWatchMore: boolean;
  onClose: () => void;
  onRewardCredited: (result: WatchRewardCompletionResult) => void;
  onSwitchAd: () => void;
  onWatchNext: () => void;
  onGoWallet: () => void;
}

export function WatchAdModal({
  open,
  ad,
  session,
  lang,
  coinsPerBdt,
  canWatchMore,
  onClose,
  onRewardCredited,
  onSwitchAd,
  onWatchNext,
  onGoWallet,
}: WatchAdModalProps) {
  const requiredSeconds = Math.max(5, session?.requiredSeconds || 5);
  const [adLoadState, setAdLoadState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const [loadError, setLoadError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(requiredSeconds);
  const [phase, setPhase] = useState<'loading_ad' | 'counting' | 'crediting' | 'awaiting_s2s' | 'credited' | 'failed'>('loading_ad');
  const [creditResult, setCreditResult] = useState<WatchRewardCompletionResult | null>(null);
  const [creditError, setCreditError] = useState('');
  const [isTabVisible, setIsTabVisible] = useState(true);
  const [retryNonce, setRetryNonce] = useState(0);
  const [checkingS2S, setCheckingS2S] = useState(false);
  const completionFiredRef = useRef(false);

  // Reset state whenever a fresh session starts
  useEffect(() => {
    if (!open || !session || !ad) return;
    completionFiredRef.current = false;
    setAdLoadState('loading');
    setLoadError('');
    setSecondsLeft(Math.max(5, session.requiredSeconds || 5));
    setPhase('loading_ad');
    setCreditResult(null);
    setCreditError('');
    setRetryNonce(0);
  }, [open, session?.sessionId, ad?.id]);

  // Pause countdown if browser tab is backgrounded
  useEffect(() => {
    if (!open) return;
    const onVis = () => setIsTabVisible(document.visibilityState === 'visible');
    onVis();
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [open]);

  // Transition from loading_ad -> counting ONLY when the real advertisement genuinely loads
  useEffect(() => {
    if (!open || !session || !ad) return;
    if (adLoadState === 'loaded' && phase === 'loading_ad') {
      setPhase('counting');
      trackAdEvent(ad.unitId, 'impression', 'watch_earn_player', ad.kind);
    } else if (adLoadState === 'failed' && (phase === 'loading_ad' || phase === 'counting')) {
      setPhase('failed');
      // Report honest load failure to server (0 coins credited)
      completeWatchEarnSessionServer({
        sessionId: session.sessionId,
        sessionToken: session.sessionToken,
        adLoaded: false,
        failureReason: loadError || 'Ad failed to render',
      }).catch(() => {});
    }
  }, [adLoadState, phase, open, session?.sessionId, ad?.unitId, loadError]);

  // Exact 5-second visible countdown timer
  useEffect(() => {
    if (!open || phase !== 'counting' || !isTabVisible) return;
    if (secondsLeft <= 0) return;

    const timer = setInterval(() => {
      setSecondsLeft((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [open, phase, isTabVisible, secondsLeft]);

  // Automatic coin crediting immediately when countdown hits 0 (NO manual Claim button required)
  // For S2S-verified third-party sessions, wait for verified provider callback instead of self-crediting
  useEffect(() => {
    if (!open || !session || phase !== 'counting' || secondsLeft > 0) return;
    if (completionFiredRef.current) return;
    completionFiredRef.current = true;

    if (session.requiresS2SCallback) {
      setPhase('awaiting_s2s');
      return;
    }

    setPhase('crediting');

    let cancelled = false;
    (async () => {
      try {
        const res = await completeWatchEarnSessionServer({
          sessionId: session.sessionId,
          sessionToken: session.sessionToken,
          adLoaded: true,
        });
        if (cancelled) return;
        const payload: WatchRewardCompletionResult = {
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
        setCreditResult(payload);
        setPhase('credited');
        onRewardCredited(payload);
      } catch (err) {
        if (cancelled) return;
        setCreditError(
          err instanceof Error
            ? err.message
            : lang === 'bn'
              ? 'কয়েন যোগ করতে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
              : 'Could not credit coins. Please try again.'
        );
        setPhase('failed');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, session, phase, secondsLeft, lang, onRewardCredited]);

  if (!open || !ad || !session) return null;

  const progressPercent =
    phase === 'credited' || phase === 'crediting' || phase === 'awaiting_s2s'
      ? 100
      : phase === 'counting'
        ? Math.min(100, Math.round(((requiredSeconds - secondsLeft) / requiredSeconds) * 100))
        : 0;

  const resolvedTarget =
    ad.targetUrl.startsWith('/') && typeof window !== 'undefined'
      ? `${window.location.origin}${ad.targetUrl}`
      : ad.targetUrl;
  const launch = resolveAdBrowserUrl(resolvedTarget, { dh_unit: ad.unitId });
  const videoMedia = ad.kind === 'video' ? classifyAdMediaUrl(ad.mediaUrl) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={lang === 'bn' ? 'বিজ্ঞাপন দেখুন ও কয়েন আয় করুন' : 'Watch Advertisement & Earn Coins'}
      className="fixed inset-0 z-50 bg-[#0B1120]/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
    >
      <div className="w-full max-w-lg rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 shadow-2xl overflow-hidden my-auto">
        {/* Top Bar with Live Timer Status */}
        <div className="px-4 py-3 sm:px-5 sm:py-3.5 bg-[#172033] text-white flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-8 h-8 rounded-xl dh-orange-gradient flex items-center justify-center shrink-0">
              <Coins className="w-4 h-4 text-white" />
            </span>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-extrabold truncate">
                {lang === 'bn' ? 'বিজ্ঞাপন দেখুন ও কয়েন আয় করুন' : 'Watch Ad & Earn Coins'}
              </p>
              <p className="text-[10px] text-white/75 font-mono-num truncate">
                {ad.provider} · {ad.unitId} · +{session.rewardCoins} {lang === 'bn' ? 'কয়েন' : 'Coins'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {phase === 'counting' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-[#FF8500] text-white text-xs font-extrabold font-mono-num">
                <Clock className="w-3.5 h-3.5" />
                {secondsLeft}s
              </span>
            )}
            {phase === 'credited' && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500 text-white text-xs font-extrabold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                +{creditResult?.coinsAwarded ?? session.rewardCoins}
              </span>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close ad viewer"
              className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Smooth 5-Second Progress Bar */}
        <div className="h-1.5 w-full bg-[#E6ECFA] dark:bg-slate-800 overflow-hidden">
          <div
            className={`h-full transition-[width] duration-700 ease-linear ${
              phase === 'credited'
                ? 'bg-emerald-500'
                : phase === 'failed'
                  ? 'bg-red-500'
                  : 'bg-[#FF8500]'
            }`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Real Advertisement Stage */}
        <div className="p-4 sm:p-5 space-y-4">
          <div className="relative rounded-2xl overflow-hidden border border-[#E6ECFA] dark:border-slate-700 bg-[#0F172A] min-h-[210px] flex flex-col items-center justify-center">
            {ad.kind === 'script_banner' && ad.managedUnit ? (
              <div className="w-full p-3 flex items-center justify-center bg-[#F8FAFF] dark:bg-slate-950 min-h-[220px]">
                <AdUnitCardOrBanner
                  key={`${ad.id}_${retryNonce}`}
                  unit={ad.managedUnit}
                  slot="watch_earn"
                  lang={lang}
                  strictRewardMode
                  onStatusChange={(_id: string, st: ManagedAdUnitStatus, err?: string) => {
                    if (st === 'loaded') {
                      setAdLoadState('loaded');
                    } else if (st === 'blocked' || st === 'error') {
                      setLoadError(err || 'Ad network blocked');
                      setAdLoadState('failed');
                    }
                  }}
                />
              </div>
            ) : ad.kind === 'video' && videoMedia && videoMedia.kind === 'direct_video' ? (
              <video
                key={`${ad.id}_vid_${retryNonce}`}
                src={videoMedia.playableSrc}
                poster={ad.imageUrl ? resolveStudioImage(ad.imageUrl) : undefined}
                autoPlay
                muted
                playsInline
                controls
                onCanPlay={() => setAdLoadState('loaded')}
                onLoadedData={() => setAdLoadState('loaded')}
                onError={() => {
                  setLoadError('Video advertisement failed to load');
                  setAdLoadState('failed');
                }}
                className="w-full aspect-video object-cover"
              />
            ) : (
              <div className="relative w-full">
                <img
                  key={`${ad.id}_img_${retryNonce}`}
                  src={resolveStudioImage(ad.imageUrl)}
                  alt={lang === 'bn' ? ad.titleBn : ad.titleEn}
                  onLoad={(e) => {
                    if (e.currentTarget.naturalWidth > 0) {
                      setAdLoadState('loaded');
                    } else {
                      setLoadError('Advertisement image returned empty dimensions');
                      setAdLoadState('failed');
                    }
                  }}
                  onError={() => {
                    setLoadError('Advertisement creative failed to load');
                    setAdLoadState('failed');
                  }}
                  className="w-full aspect-[16/9] object-cover block"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0F172A] via-[#0F172A]/45 to-transparent flex flex-col justify-end p-4 text-white">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="px-2 py-0.5 rounded-md bg-[#FF8500] text-white text-[10px] font-bold uppercase tracking-wider">
                      {lang === 'bn' ? 'স্পন্সরড' : 'Sponsored'} · {ad.unitId}
                    </span>
                    <span className="text-[10px] text-white/80 font-semibold">{ad.provider}</span>
                  </div>
                  <h3 className="text-sm sm:text-base font-extrabold leading-snug line-clamp-2">
                    {lang === 'bn' ? ad.titleBn : ad.titleEn}
                  </h3>
                  <p className="text-[11px] text-white/80 line-clamp-1 mt-0.5">
                    {lang === 'bn' ? ad.descriptionBn : ad.descriptionEn}
                  </p>
                </div>
              </div>
            )}

            {phase === 'loading_ad' && ad.kind !== 'script_banner' && (
              <div className="absolute inset-0 bg-[#0F172A]/80 flex flex-col items-center justify-center gap-2 text-white">
                <Loader2 className="w-7 h-7 text-[#FF8500] animate-spin" />
                <span className="text-xs font-bold">
                  {lang === 'bn' ? 'বিজ্ঞাপন লোড হচ্ছে...' : 'Loading advertisement...'}
                </span>
              </div>
            )}
          </div>

          {/* Live Status / Countdown / Auto-Credit Feedback */}
          {phase === 'loading_ad' && (
            <div className="p-3.5 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-[#172033] dark:text-slate-200 font-semibold">
                <Loader2 className="w-4 h-4 text-[#FF8500] animate-spin shrink-0" />
                <span>
                  {lang === 'bn'
                    ? 'বিজ্ঞাপন লোড সম্পন্ন হলে ৫ সেকেন্ডের টাইমার চালু হবে...'
                    : 'Waiting for advertisement to load before starting 5s countdown...'}
                </span>
              </div>
            </div>
          )}

          {phase === 'counting' && (
            <div className="p-3.5 rounded-2xl bg-[#FFF7EE] dark:bg-orange-500/10 border border-[#FF8500]/35 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 rounded-full dh-orange-gradient text-white font-mono-num font-extrabold text-sm flex items-center justify-center shrink-0">
                  {secondsLeft}
                </span>
                <div className="min-w-0">
                  <p className="font-extrabold text-[#172033] dark:text-slate-100">
                    {!isTabVisible
                      ? lang === 'bn'
                        ? 'টাইমার পজ করা আছে — এই পেজে থাকুন'
                        : 'Timer paused — stay on this tab'
                      : lang === 'bn'
                        ? `বিজ্ঞাপনটি দেখুন — আর ${secondsLeft} সেকেন্ড বাকি`
                        : `Viewing ad — ${secondsLeft} second${secondsLeft === 1 ? '' : 's'} remaining`}
                  </p>
                  <p className="text-[11px] text-[#777777] dark:text-slate-400">
                    {lang === 'bn'
                      ? `৫ সেকেন্ড শেষে স্বয়ংক্রিয়ভাবে +${session.rewardCoins} কয়েন যোগ হবে (কোনো ক্লেইম বাটন লাগবে না)`
                      : `+${session.rewardCoins} coins will be credited automatically at 0s`}
                  </p>
                </div>
              </div>
              {launch.ok && (
                <a
                  href={launch.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  onClick={(e) => {
                    if (!tryAcquireAdLaunchLock(`we_visit_${ad.unitId}`, launch.finalHttpUrl)) {
                      e.preventDefault();
                      return;
                    }
                    trackAdEvent(ad.unitId, 'click', 'watch_earn_modal', ad.kind);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-[#172033] text-white text-[11px] font-bold inline-flex items-center gap-1 shrink-0 self-start sm:self-center hover:bg-[#FF8500] transition-colors"
                >
                  <span>{lang === 'bn' ? 'অফার দেখুন' : 'Visit Offer'}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          )}

          {phase === 'crediting' && (
            <div className="p-3.5 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 flex items-center gap-2.5 text-xs font-bold text-[#172033] dark:text-slate-100">
              <Loader2 className="w-4 h-4 text-[#FF8500] animate-spin shrink-0" />
              <span>
                {lang === 'bn'
                  ? '৫ সেকেন্ড সম্পন্ন! আপনার অ্যাকাউন্টে স্বয়ংক্রিয়ভাবে কয়েন যোগ করা হচ্ছে...'
                  : '5 seconds complete! Automatically crediting coins to your account...'}
              </span>
            </div>
          )}

          {phase === 'awaiting_s2s' && (
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800 space-y-2.5 text-xs">
              <p className="font-extrabold text-[#172033] dark:text-slate-100">
                {lang === 'bn'
                  ? 'প্রোভাইডার S2S কলব্যাক যাচাইয়ের অপেক্ষায় আছে'
                  : 'Awaiting Provider S2S Callback Verification'}
              </p>
              <p className="text-[#777777] dark:text-slate-400">
                {lang === 'bn'
                  ? 'থার্ড-পার্টি রিওয়ার্ডেড অ্যাড নেটওয়ার্ক থেকে কনফার্মেশন পেলেই কয়েন যোগ হবে।'
                  : 'Coins will credit once the rewarded ad network sends verified S2S confirmation.'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={checkingS2S}
                  onClick={async () => {
                    if (!session) return;
                    setCheckingS2S(true);
                    try {
                      const check = await verifyWatchEarnSessionServer(session.sessionId);
                      if (check.verified) {
                        const summaryNow = await getWatchEarnSummaryServer();
                        const payload: WatchRewardCompletionResult = {
                          coinsAwarded: check.coinsAwarded,
                          alreadyCredited: false,
                          coinsAvailable: summaryNow.coinsAvailable,
                          coinsLifetimeEarned: summaryNow.coinsLifetimeEarned,
                          coinsRedeemed: summaryNow.coinsRedeemed,
                          adsWatchedToday: summaryNow.adsWatchedToday,
                          coinsEarnedToday: summaryNow.coinsEarnedToday,
                          dailyAdLimit: summaryNow.dailyAdLimit,
                          dailyCoinLimit: summaryNow.dailyCoinLimit,
                          bdtEquivalent: Number((check.coinsAwarded / Math.max(1, coinsPerBdt)).toFixed(2)),
                          message: check.message,
                        };
                        setCreditResult(payload);
                        setPhase('credited');
                        onRewardCredited(payload);
                      } else {
                        setCreditError(check.message);
                      }
                    } catch (err) {
                      setCreditError(err instanceof Error ? err.message : 'Verification pending');
                    } finally {
                      setCheckingS2S(false);
                    }
                  }}
                  className="px-3.5 py-2 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-1.5"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checkingS2S ? 'animate-spin' : ''}`} />
                  <span>{lang === 'bn' ? 'স্ট্যাটাস যাচাই করুন' : 'Check Verification'}</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold text-[#172033] dark:text-slate-200"
                >
                  {lang === 'bn' ? 'বন্ধ করুন' : 'Close'}
                </button>
              </div>
              {creditError && <p className="text-[11px] text-amber-800 dark:text-amber-300 font-semibold">{creditError}</p>}
            </div>
          )}

          {phase === 'credited' && creditResult && (
            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 space-y-3">
              <div className="flex items-start gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-emerald-800 dark:text-emerald-300">
                    {creditResult.alreadyCredited
                      ? lang === 'bn'
                        ? 'এই সেশনের কয়েন ইতিমধ্যে যুক্ত হয়েছে!'
                        : 'Coins already credited for this session!'
                      : lang === 'bn'
                        ? `সফল! +${creditResult.coinsAwarded} কয়েন স্বয়ংক্রিয়ভাবে যোগ হয়েছে`
                        : `Success! +${creditResult.coinsAwarded} Coins Credited Automatically`}
                  </p>
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5 font-mono-num">
                    {lang === 'bn'
                      ? `নতুন ব্যালেন্স: ${creditResult.coinsAvailable} কয়েন (৳${(creditResult.coinsAvailable / Math.max(1, coinsPerBdt)).toFixed(2)}) · আজ: ${creditResult.adsWatchedToday}/${creditResult.dailyAdLimit}`
                      : `New Balance: ${creditResult.coinsAvailable} Coins (৳${(creditResult.coinsAvailable / Math.max(1, coinsPerBdt)).toFixed(2)}) · Today: ${creditResult.adsWatchedToday}/${creditResult.dailyAdLimit}`}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {canWatchMore && creditResult.adsWatchedToday < creditResult.dailyAdLimit && (
                  <button
                    type="button"
                    onClick={onWatchNext}
                    className="flex-1 min-w-[140px] py-2.5 px-4 rounded-xl dh-orange-gradient text-white text-xs font-extrabold inline-flex items-center justify-center gap-1.5 shadow-sm hover:opacity-95"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{lang === 'bn' ? 'পরবর্তী বিজ্ঞাপন দেখুন' : 'Watch Next Ad'}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={onGoWallet}
                  className="py-2.5 px-4 rounded-xl bg-[#172033] dark:bg-slate-800 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:bg-[#FF8500] transition-colors"
                >
                  <Wallet className="w-3.5 h-3.5" />
                  <span>{lang === 'bn' ? 'ওয়ালেট দেখুন' : 'View Wallet'}</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="py-2.5 px-3.5 rounded-xl bg-white dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200 text-xs font-bold"
                >
                  {lang === 'bn' ? 'বন্ধ করুন' : 'Done'}
                </button>
              </div>
            </div>
          )}

          {phase === 'failed' && (
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/35 border border-amber-200 dark:border-amber-800 space-y-3 text-xs">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-5 h-5 text-[#FF8500] shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="font-extrabold text-[#172033] dark:text-slate-100">
                    {lang === 'bn'
                      ? 'বিজ্ঞাপনটি লোড হয়নি — কোনো কয়েন যোগ করা হয়নি'
                      : 'Advertisement Failed to Load — No Coins Credited'}
                  </p>
                  <p className="text-[#777777] dark:text-slate-400 mt-0.5">
                    {creditError ||
                      loadError ||
                      (lang === 'bn'
                        ? 'অ্যাডব্লকার বন্ধ করুন অথবা অন্য একটি বিজ্ঞাপন নির্বাচন করে আবার চেষ্টা করুন।'
                        : 'Disable adblockers or try another available advertisement.')}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onSwitchAd}
                  className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{lang === 'bn' ? 'অন্য বিজ্ঞাপন চেষ্টা করুন' : 'Try Another Ad'}</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-white dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200 font-bold"
                >
                  {lang === 'bn' ? 'বন্ধ করুন' : 'Close'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
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
  const [busyStart, setBusyStart] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [activeAd, setActiveAd] = useState<WatchableAdItem | null>(null);
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    sessionToken: string;
    requiredSeconds: number;
    rewardCoins: number;
    requiresS2SCallback?: boolean;
  } | null>(null);
  const startLockRef = useRef(false);

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

  if (!watchEarnEnabled) return null;

  const coinsPerAd = summary?.coinsPerAd || Math.max(1, settings.watchEarnCoinsPerAd ?? 5);
  const coinsPerBdt = summary?.coinsPerBdt || Math.max(1, settings.watchEarnCoinsPerBdt ?? 10);
  const dailyAdLimit = summary?.dailyAdLimit || Math.max(1, settings.rewardedAdDailyLimit ?? 5);
  const adsWatchedToday = summary?.adsWatchedToday ?? 0;
  const currentCoins = Math.max(wallet?.coinsAvailable ?? 0, summary?.coinsAvailable ?? 0);
  const canWatchMore = adsWatchedToday < dailyAdLimit;

  const startWatchingAd = async (cursorOverride?: number) => {
    if (!user) {
      onOpenAuth();
      return;
    }
    if (profile?.status === 'suspended') {
      setErrorMsg(
        lang === 'bn' ? 'আপনার অ্যাকাউন্ট সাময়িকভাবে সাসপেন্ড আছে।' : 'Your account is currently suspended.'
      );
      return;
    }
    if (startLockRef.current || modalOpen) return;
    if (watchableAds.length === 0) {
      setErrorMsg(
        lang === 'bn' ? 'বর্তমানে দেখার মতো কোনো অনুমোদিত Reward Ad নেই।' : 'No authorized Reward Ads available right now.'
      );
      return;
    }

    const idx = (cursorOverride ?? adCursor) % watchableAds.length;
    const chosen = watchableAds[idx];
    startLockRef.current = true;
    setBusyStart(true);
    setErrorMsg('');

    try {
      const res = await startWatchEarnSessionServer({
        unitId: chosen.unitId,
        provider: chosen.provider,
        launchUrl: chosen.targetUrl,
        adTitle: lang === 'bn' ? chosen.titleBn : chosen.titleEn,
      });
      setActiveAd(chosen);
      setActiveSession({
        sessionId: res.sessionId,
        sessionToken: res.sessionToken,
        requiredSeconds: res.requiredSeconds || 5,
        rewardCoins: res.rewardCoins || coinsPerAd,
        requiresS2SCallback: res.requiresS2SCallback,
      });
      setModalOpen(true);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : lang === 'bn'
            ? 'বিজ্ঞাপন সেশন চালু করা যায়নি।'
            : 'Could not start Watch & Earn session.'
      );
    } finally {
      setBusyStart(false);
      startLockRef.current = false;
    }
  };

  return (
    <>
      <section className="w-full max-w-full overflow-hidden rounded-3xl bg-gradient-to-br from-[#172033] via-[#1d2b45] to-[#263759] text-white p-4 sm:p-6 shadow-lg border border-[#FF8500]/30">
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
                ? `মাত্র ৫ সেকেন্ড বিজ্ঞাপন দেখে প্রতিদিন আয় করুন +${coinsPerAd} কয়েন`
                : `Watch 5-Second Ads & Earn +${coinsPerAd} Coins Automatically`}
            </h2>
            <p className="text-xs sm:text-sm text-white/80 max-w-2xl leading-relaxed">
              {lang === 'bn'
                ? `প্রতিটি বিজ্ঞাপন ৫ সেকেন্ড সম্পূর্ণ দেখলেই কোনো ক্লেইম বাটন ছাড়াই স্বয়ংক্রিয়ভাবে কয়েন আপনার অ্যাকাউন্টে জমা হবে (${coinsPerBdt} কয়েন = ৳১)।`
                : `Complete a 5-second real ad view and coins are credited automatically to your account with zero extra clicks (${coinsPerBdt} Coins = ৳1).`}
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
              <button
                type="button"
                disabled={busyStart || (Boolean(user) && !canWatchMore)}
                onClick={() => void startWatchingAd()}
                className="flex-1 sm:flex-none px-4 sm:px-5 py-3 rounded-2xl dh-orange-gradient text-white text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-2 shadow-md hover:opacity-95 disabled:opacity-55 cursor-pointer whitespace-nowrap"
              >
                {busyStart ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4 fill-current" />
                )}
                <span>
                  {user && !canWatchMore
                    ? lang === 'bn'
                      ? 'আজকের সীমা পূর্ণ'
                      : 'Daily Limit Reached'
                    : lang === 'bn'
                      ? `বিজ্ঞাপন দেখুন (+${coinsPerAd})`
                      : `Watch Ad (+${coinsPerAd} Coins)`}
                </span>
              </button>

              <button
                type="button"
                onClick={() => onNavigate('watch-earn')}
                className="px-3.5 py-3 rounded-2xl bg-white/12 hover:bg-white/20 text-white text-xs font-bold inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Film className="w-3.5 h-3.5 text-[#FF9B19]" />
                <span>{lang === 'bn' ? 'হিস্ট্রি ও রিডিম' : 'History'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-3 p-2.5 rounded-xl bg-amber-500/20 border border-amber-400/40 text-amber-100 text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[#FACC15] shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/70">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            {lang === 'bn'
              ? 'সার্ভার-যাচাইকৃত ৫ সেকেন্ড টাইমার · স্থায়ী ব্যালেন্স সেভ · ডুপ্লিকেট সুরক্ষা'
              : 'Server-verified 5s timer · Permanent balance sync · Duplicate reward protection'}
          </span>
        </div>
      </section>

      <WatchAdModal
        open={modalOpen}
        ad={activeAd}
        session={activeSession}
        lang={lang}
        coinsPerBdt={coinsPerBdt}
        canWatchMore={canWatchMore}
        onClose={() => {
          setModalOpen(false);
          setActiveSession(null);
        }}
        onRewardCredited={(res) => {
          setAdCursor((prev) => prev + 1);
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
          if (!res.alreadyCredited && res.coinsAwarded > 0) {
            onToast?.(
              lang === 'bn'
                ? `+${res.coinsAwarded} কয়েন যোগ হয়েছে! মোট কয়েন: ${res.coinsAvailable}`
                : `+${res.coinsAwarded} Coins credited! Total Coins: ${res.coinsAvailable}`
            );
          }
        }}
        onSwitchAd={() => {
          const nextIdx = (adCursor + 1) % Math.max(1, watchableAds.length);
          setAdCursor(nextIdx);
          setModalOpen(false);
          setActiveSession(null);
          setTimeout(() => void startWatchingAd(nextIdx), 120);
        }}
        onWatchNext={() => {
          const nextIdx = (adCursor + 1) % Math.max(1, watchableAds.length);
          setAdCursor(nextIdx);
          setModalOpen(false);
          setActiveSession(null);
          setTimeout(() => void startWatchingAd(nextIdx), 120);
        }}
        onGoWallet={() => {
          setModalOpen(false);
          setActiveSession(null);
          onNavigate('watch-earn');
        }}
      />
    </>
  );
}
