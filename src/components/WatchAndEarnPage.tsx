import { FormEvent, MouseEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Coins,
  Clock,
  ExternalLink,
  Film,
  History,
  Lock,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  AdNetworkConfig,
  AdRewardTransaction,
  AdViewingSession,
  AppRoute,
  Language,
  ManagedAdUnitConfig,
  SiteSettings,
  UserProfile,
  WalletAccount,
} from '../types/marketplace';
import {
  formatDateShort,
  getTimeMs,
  getWatchEarnSummaryServer,
  redeemWatchEarnCoinsServer,
  startWatchEarnSessionServer,
  trackAdEvent,
  verifyWatchEarnSessionServer,
} from '../lib/firestoreService';
import { resolveAdBrowserUrl, tryAcquireAdLaunchLock } from '../lib/adNavigation';
import { ManagedPlacementSlot } from './AdUnitFrame';

interface WatchAndEarnPageProps {
  lang: Language;
  user: User | null;
  profile: UserProfile | null;
  wallet: WalletAccount | null;
  settings: SiteSettings;
  managedAdUnits: ManagedAdUnitConfig[];
  adNetworks: AdNetworkConfig[];
  viewingSessions: AdViewingSession[];
  rewardTransactions: AdRewardTransaction[];
  onNavigate: (r: AppRoute) => void;
  onOpenAuth: () => void;
}

export function WatchAndEarnPage({
  lang,
  user,
  profile,
  wallet,
  settings,
  managedAdUnits,
  adNetworks,
  viewingSessions,
  rewardTransactions,
  onNavigate,
  onOpenAuth,
}: WatchAndEarnPageProps) {
  const [selectedUnitKey, setSelectedUnitKey] = useState<string>('');
  const [serverSummary, setServerSummary] = useState<{
    coinsAvailable: number;
    coinsLifetimeEarned: number;
    coinsRedeemed: number;
    creditedSessions: Array<{
      sessionId: string;
      provider: string;
      providerEventId: string;
      coins: number;
      creditedAt: string;
    }>;
  }>({ coinsAvailable: 0, coinsLifetimeEarned: 0, coinsRedeemed: 0, creditedSessions: [] });
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    sessionToken: string;
    unitId: string;
    provider: string;
    launchUrl: string;
    status: string;
    message: string;
  } | null>(null);
  const [busyPlay, setBusyPlay] = useState(false);
  const [busyVerify, setBusyVerify] = useState(false);
  const [redeemAmount, setRedeemAmount] = useState('');
  const [busyRedeem, setBusyRedeem] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'info' | 'err'; text: string } | null>(null);

  const refreshServerSummary = () => {
    if (!user || !user.emailVerified) return;
    getWatchEarnSummaryServer().then(setServerSummary).catch(() => {});
  };

  useEffect(() => {
    refreshServerSummary();
  }, [user?.uid, user?.emailVerified]);

  const authorizedRewardProviders = useMemo(() => {
    const netProviders = adNetworks
      .filter(
        (n) =>
          n.enabled &&
          n.approvalStatus === 'active' &&
          n.supportsIncentivizedRewards &&
          n.provider !== 'adsense'
      )
      .map((n) => ({
        id: n.id,
        provider: n.provider.toUpperCase(),
        label: n.name,
        url: n.scriptSrc || '',
      }));
    const unitProviders = managedAdUnits
      .filter((u) => u.enabled && u.supportsRewardedVerification)
      .map((u) => ({
        id: u.id,
        provider: u.provider,
        label: lang === 'bn' ? u.labelBn : u.label,
        url: u.originalUrl,
      }));
    return [...netProviders, ...unitProviders];
  }, [adNetworks, managedAdUnits, lang]);

  const directPartnerUnits = useMemo(
    () =>
      managedAdUnits
        .filter((u) => u.enabled && u.format === 'direct_link')
        .sort((a, b) => a.priority - b.priority),
    [managedAdUnits]
  );

  const effectiveTarget = useMemo(() => {
    if (authorizedRewardProviders.length > 0) {
      return (
        authorizedRewardProviders.find((p) => p.id === selectedUnitKey) ||
        authorizedRewardProviders[0]
      );
    }
    const fallbackUnit =
      directPartnerUnits.find((u) => u.placements.includes('watch_earn')) ||
      directPartnerUnits[0] ||
      managedAdUnits.find((u) => u.enabled) ||
      managedAdUnits[0];
    return fallbackUnit
      ? {
          id: fallbackUnit.id,
          provider: fallbackUnit.provider,
          label: lang === 'bn' ? fallbackUnit.labelBn : fallbackUnit.label,
          url: fallbackUnit.originalUrl,
        }
      : {
          id: 'UNIT_02',
          provider: 'ARWF',
          label: 'ARWF Partner Offer',
          url: 'https://arwf.org/4/268e1645e2ede4000fc61453e86fca74',
        };
  }, [authorizedRewardProviders, directPartnerUnits, managedAdUnits, selectedUnitKey, lang]);

  const heroLaunch = useMemo(
    () =>
      resolveAdBrowserUrl(effectiveTarget.url, {
        dh_unit: effectiveTarget.id,
      }),
    [effectiveTarget.url, effectiveTarget.id]
  );

  const todayStr = new Date().toISOString().slice(0, 10);

  const creditedSessionMap = useMemo(() => {
    const map = new Map<string, { coins: number; providerEventId: string }>();
    serverSummary.creditedSessions.forEach((s) => {
      map.set(s.sessionId, { coins: s.coins, providerEventId: s.providerEventId });
    });
    return map;
  }, [serverSummary.creditedSessions]);

  const reconciledViewingSessions = useMemo(
    () =>
      viewingSessions.map((s) => {
        const credited = creditedSessionMap.get(s.id);
        if (credited) {
          return {
            ...s,
            status: 'credited' as const,
            coinsAwarded: Math.max(s.coinsAwarded || 0, credited.coins),
            failureReason: '',
          };
        }
        return s;
      }),
    [viewingSessions, creditedSessionMap]
  );

  const todayCredited = useMemo(
    () =>
      reconciledViewingSessions.filter((s) => {
        if (s.status !== 'credited') return false;
        const ms = getTimeMs(s.createdAt);
        return ms > 0 && new Date(ms).toISOString().slice(0, 10) === todayStr;
      }),
    [reconciledViewingSessions, todayStr]
  );

  const todayServerCredited = useMemo(
    () => serverSummary.creditedSessions.filter((s) => s.creditedAt.slice(0, 10) === todayStr),
    [serverSummary.creditedSessions, todayStr]
  );

  const dailyAdLimit = Math.max(1, settings.rewardedAdDailyLimit ?? 5);
  const dailyCoinLimit = Math.max(10, settings.watchEarnDailyCoinLimit ?? 100);
  const coinsPerAd = Math.max(1, settings.watchEarnCoinsPerAd ?? 10);
  const coinsPerBdt = Math.max(1, settings.watchEarnCoinsPerBdt ?? 10);
  const minRedeemCoins = Math.max(10, settings.watchEarnMinRedeemCoins ?? 50);

  const adsWatchedToday = Math.max(todayCredited.length, todayServerCredited.length);
  const coinsEarnedToday = Math.max(
    todayCredited.reduce((s, x) => s + (x.coinsAwarded || 0), 0),
    todayServerCredited.reduce((s, x) => s + (x.coins || 0), 0)
  );
  const currentCoinBalance = Math.max(wallet?.coinsAvailable ?? 0, serverSummary.coinsAvailable);
  const totalCoinsEarned = Math.max(wallet?.coinsLifetimeEarned ?? 0, serverSummary.coinsLifetimeEarned);
  const watchEarnEnabled = settings.watchEarnEnabled !== false && settings.rewardedAdEnabled !== false;

  // Poll S2S status softly while waiting for provider callback
  useEffect(() => {
    if (!activeSession || activeSession.status !== 'awaiting_callback') return;
    let cancelled = false;
    let attempts = 0;
    const interval = setInterval(async () => {
      if (cancelled || attempts >= 8) {
        clearInterval(interval);
        return;
      }
      attempts += 1;
      try {
        const res = await verifyWatchEarnSessionServer(activeSession.sessionId);
        if (cancelled) return;
        if (res.verified || res.status === 'credited' || res.status === 'verification_failed') {
          setActiveSession((prev) =>
            prev && prev.sessionId === activeSession.sessionId
              ? { ...prev, status: res.status, message: res.message }
              : prev
          );
          if (res.verified) {
            setFeedback({ type: 'ok', text: res.message });
            refreshServerSummary();
            clearInterval(interval);
          }
        }
      } catch {
        // Non-fatal polling retry
      }
    }, 6000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeSession?.sessionId, activeSession?.status]);

  const handlePlayAdAndEarn = async (e?: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => {
    if (!user || !user.emailVerified) {
      if (e) e.preventDefault();
      onOpenAuth();
      return;
    }

    if (e && heroLaunch.ok) {
      if (!tryAcquireAdLaunchLock(effectiveTarget.id, heroLaunch.finalHttpUrl)) {
        e.preventDefault();
        return;
      }
      trackAdEvent(effectiveTarget.id, 'click', 'watch_earn_hero', 'direct_link');
    } else if (e) {
      e.preventDefault();
    }

    setFeedback(null);

    if (authorizedRewardProviders.length === 0) {
      setFeedback({
        type: 'info',
        text:
          lang === 'bn'
            ? `${effectiveTarget.provider} (${effectiveTarget.id}) বিজ্ঞাপনটি নতুন Chrome ট্যাবে ওপেন হয়েছে। এটি একটি স্ট্যান্ডার্ড স্পন্সরড বিজ্ঞাপন (০ কয়েন); অ্যাডমিন থেকে S2S রিওয়ার্ডেড প্রোভাইডার যুক্ত হলে কয়েন যোগ হবে।`
            : `Opened ${effectiveTarget.provider} (${effectiveTarget.id}) partner ad in a new Chrome tab. Standard partner ads award 0 coins until an S2S-verified rewarded provider is enabled by Admin.`,
      });
      return;
    }

    setBusyPlay(true);
    try {
      const res = await startWatchEarnSessionServer({
        unitId: effectiveTarget.id,
        provider: effectiveTarget.provider,
      });
      if (res.sessionId) {
        setActiveSession({
          sessionId: res.sessionId,
          sessionToken: res.sessionToken,
          unitId: effectiveTarget.id,
          provider: effectiveTarget.provider,
          launchUrl: effectiveTarget.url,
          status: res.status,
          message: res.message,
        });
      }
      setFeedback({
        type: res.status === 'awaiting_callback' ? 'ok' : 'info',
        text: res.message,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not start rewarded session.',
      });
    } finally {
      setBusyPlay(false);
    }
  };

  const handleVerifySession = async (sessionId: string) => {
    setFeedback(null);
    setBusyVerify(true);
    try {
      const res = await verifyWatchEarnSessionServer(sessionId);
      setActiveSession((prev) =>
        prev && prev.sessionId === sessionId ? { ...prev, status: res.status, message: res.message } : prev
      );
      setFeedback({
        type: res.verified ? 'ok' : res.status === 'awaiting_callback' ? 'info' : 'err',
        text: res.message,
      });
      if (res.verified) {
        refreshServerSummary();
      }
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Verification failed.',
      });
    } finally {
      setBusyVerify(false);
    }
  };

  const handleRedeemCoins = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !user.emailVerified) {
      onOpenAuth();
      return;
    }
    setFeedback(null);
    setBusyRedeem(true);
    try {
      const coins = Number(redeemAmount) || currentCoinBalance;
      const res = await redeemWatchEarnCoinsServer(coins);
      setRedeemAmount('');
      setFeedback({
        type: 'ok',
        text:
          res.status === 'Credited'
            ? lang === 'bn'
              ? `${res.coinsRedeemed} কয়েন কনভার্ট করে আপনার ওয়ালেটে ৳${res.bdtCredited} যোগ করা হয়েছে।`
              : `Converted ${res.coinsRedeemed} coins into ৳${res.bdtCredited} wallet balance.`
            : lang === 'bn'
              ? `${res.coinsRedeemed} কয়েন (৳${res.bdtCredited}) রিডেম্পশন অনুরোধ জমা হয়েছে; অ্যাডমিন অনুমোদনের পর ওয়ালেটে যোগ হবে।`
              : `Submitted ${res.coinsRedeemed} coin redemption (৳${res.bdtCredited}); credits to wallet upon owner settlement.`,
      });
      refreshServerSummary();
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Redemption failed.',
      });
    } finally {
      setBusyRedeem(false);
    }
  };

  const activeSessionLaunch = activeSession
    ? resolveAdBrowserUrl(activeSession.launchUrl, {
        sub_id: activeSession.sessionToken,
        dh_unit: activeSession.unitId,
      })
    : null;

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Header Hero */}
      <section className="dh-card rounded-3xl p-5 sm:p-7 bg-gradient-to-br from-[#172033] via-[#1f2d47] to-[#263659] text-white border-none space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2 max-w-2xl">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FF8500]/20 border border-[#FF8500]/40 text-[#FF9B19] text-[11px] font-bold uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5" />
              {lang === 'bn' ? 'সার্ভার-যাচাইকৃত ওয়াচ ও আর্ন' : 'Server-Verified Watch & Earn'}
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              {lang === 'bn' ? 'বিজ্ঞাপন দেখুন ও কয়েন আয় করুন' : 'Watch Rewarded Ads & Earn Coins'}
            </h1>
            <p className="text-xs sm:text-sm text-white/80 leading-relaxed">
              {lang === 'bn'
                ? `প্রতিটি যাচাইকৃত রিওয়ার্ডেড সেশনে ${coinsPerAd} কয়েন পান (${coinsPerBdt} কয়েন = ৳১)। যেকোনো বিজ্ঞাপনে ক্লিক করলে সরাসরি নতুন Chrome ট্যাবে ওপেন হবে। সাধারণ ডিসপ্লে বা ডাইরেক্ট লিংকে কয়েন যোগ হয় না।`
                : `Earn ${coinsPerAd} coins per server-verified rewarded ad completion (${coinsPerBdt} coins = ৳1). Clicking any ad opens its real URL in a new Chrome browser tab. Ordinary banner clicks, direct links, or page reloads never credit fake coins.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            {watchEarnEnabled && profile?.status !== 'suspended' && heroLaunch.ok ? (
              <a
                href={heroLaunch.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                onClick={handlePlayAdAndEarn}
                className="px-6 py-3.5 rounded-2xl dh-orange-gradient text-white text-sm font-extrabold inline-flex items-center gap-2 shadow-lg hover:opacity-95 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>{busyPlay ? (lang === 'bn' ? 'চালু হচ্ছে...' : 'Starting...') : 'PLAY AD & EARN'}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : (
              <button
                type="button"
                disabled={busyPlay || !watchEarnEnabled || profile?.status === 'suspended'}
                onClick={() => handlePlayAdAndEarn()}
                className="px-6 py-3.5 rounded-2xl dh-orange-gradient text-white text-sm font-extrabold inline-flex items-center gap-2 shadow-lg hover:opacity-95 disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>{busyPlay ? (lang === 'bn' ? 'লোড হচ্ছে...' : 'Starting...') : 'PLAY AD & EARN'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onNavigate('wallet')}
              className="px-4 py-3.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-1.5"
            >
              <Wallet className="w-4 h-4 text-[#FF9B19]" />
              <span>{lang === 'bn' ? 'ওয়ালেট দেখুন' : 'My Wallet'}</span>
            </button>
          </div>
        </div>

        {/* 5 Core Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="p-3.5 rounded-2xl bg-white/10 border border-white/10">
            <p className="text-[11px] text-white/70">
              {lang === 'bn' ? 'মোট রিওয়ার্ডেড অ্যাড' : 'Rewarded Providers'}
            </p>
            <p className="text-2xl font-extrabold font-mono-num text-[#FF9B19] mt-0.5">
              {authorizedRewardProviders.length}
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-white/10 border border-white/10">
            <p className="text-[11px] text-white/70">
              {lang === 'bn' ? 'আজকে দেখা হয়েছে' : 'Ads Watched Today'}
            </p>
            <p className="text-2xl font-extrabold font-mono-num mt-0.5">
              {adsWatchedToday} / {dailyAdLimit}
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-white/10 border border-white/10">
            <p className="text-[11px] text-white/70">
              {lang === 'bn' ? 'মোট অর্জিত কয়েন' : 'Total Coins Earned'}
            </p>
            <p className="text-2xl font-extrabold font-mono-num text-emerald-400 mt-0.5">
              {totalCoinsEarned}
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-white/10 border border-white/10">
            <p className="text-[11px] text-white/70">
              {lang === 'bn' ? 'বর্তমান কয়েন ব্যালেন্স' : 'Current Coin Balance'}
            </p>
            <p className="text-2xl font-extrabold font-mono-num text-[#FACC15] mt-0.5">
              {currentCoinBalance}
              <span className="text-xs font-normal text-white/70 ml-1.5">
                (৳{(currentCoinBalance / coinsPerBdt).toFixed(2)})
              </span>
            </p>
          </div>
          <div className="p-3.5 rounded-2xl bg-white/10 border border-white/10 col-span-2 sm:col-span-1">
            <p className="text-[11px] text-white/70">
              {lang === 'bn' ? 'দৈনিক আয়ের সীমা' : 'Daily Earning Limit'}
            </p>
            <p className="text-2xl font-extrabold font-mono-num mt-0.5">
              {coinsEarnedToday} / {dailyCoinLimit}
            </p>
          </div>
        </div>
      </section>

      {feedback && (
        <div
          className={`p-4 rounded-2xl border text-xs sm:text-sm font-semibold flex items-start gap-2.5 ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : feedback.type === 'info'
                ? 'bg-[#F3F6FF] border-[#E6ECFA] text-[#172033]'
                : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          {feedback.type === 'ok' ? (
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#16A34A]" />
          ) : (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#FF8500]" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {!user && (
        <div className="dh-card rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Lock className="w-6 h-6 text-[#FF8500] shrink-0" />
            <div>
              <p className="text-sm font-bold text-[#172033]">
                {lang === 'bn' ? 'সাইন ইন প্রয়োজন' : 'Sign in to Track Your Coin Balance'}
              </p>
              <p className="text-xs text-[#777777]">
                {lang === 'bn'
                  ? 'কয়েন সংগ্রহ ও ওয়ালেটে রূপান্তর করতে আপনার যাচাইকৃত অ্যাকাউন্ট দিয়ে লগইন করুন।'
                  : 'Log in with your verified Gmail account to start Watch & Earn sessions and redeem coins.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenAuth}
            className="px-5 py-2.5 rounded-xl dh-orange-gradient text-white text-xs font-bold shrink-0"
          >
            {lang === 'bn' ? 'লগইন / রেজিস্টার' : 'Sign In / Register'}
          </button>
        </div>
      )}

      {/* Active Session Status & Authorized Provider Runner + Coin Redemption */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 dh-card rounded-3xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#172033] flex items-center gap-2">
                <Film className="w-5 h-5 text-[#FF8500]" />
                {lang === 'bn' ? 'রিওয়ার্ডেড অ্যাড সেশন' : 'Rewarded Ad Session Verification'}
              </h2>
              <p className="text-xs text-[#777777]">
                {lang === 'bn'
                  ? 'কেবলমাত্র সার্ভার-টু-সার্ভার (S2S) কলব্যাক অনুমোদিত নেটওয়ার্ক থেকেই কয়েন প্রদান করা হয়।'
                  : 'Only explicit S2S-verified non-AdSense rewarded providers can credit coins after real callback validation.'}
              </p>
            </div>
          </div>

          {!watchEarnEnabled ? (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-semibold">
              {lang === 'bn'
                ? 'ওয়াচ ও আর্ন বর্তমানে অ্যাডমিন দ্বারা বন্ধ রাখা হয়েছে।'
                : 'Watch & Earn is currently paused by the administrator.'}
            </div>
          ) : authorizedRewardProviders.length === 0 ? (
            <div className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-2 text-xs">
              <p className="font-bold text-[#172033]">
                {lang === 'bn'
                  ? 'কোনো S2S-ভেরিফায়েড রিওয়ার্ডেড অ্যাড নেটওয়ার্ক এখনো কনফিগার করা হয়নি'
                  : 'Standard Sponsored Mode Active (No S2S Rewarded Provider Enabled Yet)'}
              </p>
              <p className="text-[#777777] leading-relaxed">
                {lang === 'bn'
                  ? 'নিরাপত্তা নীতির কারণে সাধারণ ডাইরেক্ট লিংক বা ব্যানার অ্যাড (AFDERS, ARWF, BICEA, AUCTIONR, ASIAFILM) কখনোই অটো-কয়েন দেয় না। তবে PLAY AD & EARN বা নিচের যেকোনো কার্ডে ক্লিক করলে বিজ্ঞাপনটি সরাসরি Chrome-এ ওপেন হবে।'
                  : 'Standard display and direct partner ads (AFDERS, ARWF, BICEA, AUCTIONR, ASIAFILM) open cleanly in a new Chrome tab when clicked, without issuing unverified coins. Once Admin enables a rewarded network with an S2S postback secret, verified sessions credit coins automatically.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block text-xs font-bold text-[#172033]">
                {lang === 'bn' ? 'অনুমোদিত প্রোভাইডার নির্বাচন করুন' : 'Select Authorized Rewarded Provider'}
              </label>
              <select
                value={effectiveTarget.id}
                onChange={(e) => setSelectedUnitKey(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-semibold"
              >
                {authorizedRewardProviders.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label} ({p.provider}) — +{coinsPerAd} coins/verified view
                  </option>
                ))}
              </select>
            </div>
          )}

          {activeSession && (
            <div className="p-4 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/30 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-[#172033] font-mono-num">
                  Session: {activeSession.sessionId} ({activeSession.provider})
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-md text-[11px] font-bold ${
                    activeSession.status === 'credited'
                      ? 'bg-emerald-100 text-[#16A34A]'
                      : activeSession.status === 'awaiting_callback'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-red-100 text-[#DC2626]'
                  }`}
                >
                  {activeSession.status}
                </span>
              </div>
              <p className="text-[#777777]">{activeSession.message}</p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {activeSessionLaunch?.ok && (
                  <a
                    href={activeSessionLaunch.href}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    onClick={(e) => {
                      if (!tryAcquireAdLaunchLock(`sess_${activeSession.sessionId}`, activeSessionLaunch.finalHttpUrl)) {
                        e.preventDefault();
                        return;
                      }
                      trackAdEvent(activeSession.unitId, 'click', 'watch_earn_session', 'direct_link');
                    }}
                    className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-1.5 hover:opacity-95"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>{lang === 'bn' ? 'Chrome-এ বিজ্ঞাপন খুলুন' : 'Open Ad in Chrome'}</span>
                  </a>
                )}
                {activeSession.status !== 'credited' && (
                  <button
                    type="button"
                    disabled={busyVerify}
                    onClick={() => handleVerifySession(activeSession.sessionId)}
                    className="px-4 py-2 rounded-xl bg-[#172033] text-white font-bold inline-flex items-center gap-1.5 hover:bg-[#FF8500] transition-colors disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${busyVerify ? 'animate-spin' : ''}`} />
                    <span>
                      {activeSession.status === 'verification_failed'
                        ? lang === 'bn'
                          ? 'পুনরায় যাচাই করুন'
                          : 'Retry Verification'
                        : lang === 'bn'
                          ? 'S2S ভেরিফিকেশন চেক করুন'
                          : 'Check S2S Callback Status'}
                    </span>
                  </button>
                )}
                <span className="text-[11px] font-mono-num text-[#777777]">
                  Token: {activeSession.sessionToken.slice(0, 12)}...
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Coin to BDT Wallet Redemption */}
        <form onSubmit={handleRedeemCoins} className="dh-card rounded-3xl p-5 space-y-3.5">
          <div className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-[#FF8500]" />
            <h2 className="text-base font-bold text-[#172033]">
              {lang === 'bn' ? 'কয়েন থেকে ওয়ালেট টাকা' : 'Redeem Coins to Wallet'}
            </h2>
          </div>
          <p className="text-xs text-[#777777]">
            {lang === 'bn'
              ? `রেট: ${coinsPerBdt} কয়েন = ৳১ · ন্যূনতম ${minRedeemCoins} কয়েন।`
              : `Rate: ${coinsPerBdt} Coins = ৳1 BDT · Minimum ${minRedeemCoins} coins required.`}
          </p>
          <div className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex items-center justify-between text-xs">
            <span className="text-[#777777]">{lang === 'bn' ? 'ব্যবহারযোগ্য কয়েন' : 'Available Coins'}</span>
            <span className="font-mono-num font-extrabold text-[#172033] text-sm">
              {currentCoinBalance}
            </span>
          </div>
          <div>
            <label className="block text-xs font-bold text-[#172033] mb-1">
              {lang === 'bn' ? 'কয়েনের পরিমাণ' : 'Coins to Convert'}
            </label>
            <input
              type="number"
              min={minRedeemCoins}
              max={Math.max(minRedeemCoins, currentCoinBalance)}
              value={redeemAmount}
              onChange={(e) => setRedeemAmount(e.target.value)}
              placeholder={`${minRedeemCoins}`}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num"
            />
          </div>
          <button
            type="submit"
            disabled={busyRedeem || currentCoinBalance < minRedeemCoins || profile?.status === 'suspended'}
            className="w-full py-2.5 rounded-xl dh-orange-gradient text-white text-xs font-bold disabled:opacity-50"
          >
            {busyRedeem
              ? lang === 'bn'
                ? 'কনভার্ট হচ্ছে...'
                : 'Converting...'
              : lang === 'bn'
                ? 'ওয়ালেটে যোগ করুন'
                : 'Convert to Wallet BDT'}
          </button>
        </form>
      </div>

      {/* Watch History & Reward History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="dh-card rounded-3xl p-5 space-y-3">
          <h3 className="text-base font-bold text-[#172033] flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#FF8500]" />
            {lang === 'bn' ? 'ওয়াচ হিস্ট্রি' : 'Watch History'} ({reconciledViewingSessions.length})
          </h3>
          {reconciledViewingSessions.length === 0 ? (
            <p className="text-xs text-[#777777] py-6 text-center">
              {lang === 'bn' ? 'এখনো কোনো অ্যাড সেশন নেই।' : 'No Watch & Earn sessions recorded yet.'}
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {reconciledViewingSessions.slice(0, 20).map((s) => (
                <div
                  key={s.id}
                  className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex items-start justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-[#172033] truncate">
                      {s.provider} · {s.unitId}
                    </p>
                    <p className="text-[11px] text-[#777777] truncate">
                      {formatDateShort(s.createdAt, lang)}
                      {s.failureReason ? ` · ${s.failureReason}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        s.status === 'credited'
                          ? 'bg-emerald-100 text-[#16A34A]'
                          : s.status === 'awaiting_callback'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-red-100 text-[#DC2626]'
                      }`}
                    >
                      {s.status}
                    </span>
                    {s.coinsAwarded > 0 && (
                      <span className="font-mono-num font-bold text-[#16A34A]">+{s.coinsAwarded} coins</span>
                    )}
                    {s.status === 'awaiting_callback' && (
                      <button
                        type="button"
                        disabled={busyVerify}
                        onClick={() => handleVerifySession(s.id)}
                        className="text-[10px] font-bold text-[#FF8500] hover:underline"
                      >
                        {lang === 'bn' ? 'চেক করুন' : 'Verify'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dh-card rounded-3xl p-5 space-y-3">
          <h3 className="text-base font-bold text-[#172033] flex items-center gap-2">
            <History className="w-4 h-4 text-[#FF8500]" />
            {lang === 'bn' ? 'রিওয়ার্ড হিস্ট্রি' : 'Reward History'} ({rewardTransactions.length})
          </h3>
          {rewardTransactions.length === 0 ? (
            <p className="text-xs text-[#777777] py-6 text-center">
              {lang === 'bn' ? 'এখনো কোনো রিওয়ার্ড লেনদেন নেই।' : 'No coin reward transactions yet.'}
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {rewardTransactions.slice(0, 20).map((tx) => (
                <div
                  key={tx.id}
                  className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-[#172033] truncate">
                      {tx.note || tx.type} ({tx.provider})
                    </p>
                    <p className="text-[11px] text-[#777777]">{formatDateShort(tx.createdAt, lang)}</p>
                  </div>
                  <div className="text-right shrink-0 font-mono-num">
                    <p
                      className={`font-extrabold ${
                        tx.coins >= 0 ? 'text-[#16A34A]' : 'text-[#FF8500]'
                      }`}
                    >
                      {tx.coins >= 0 ? `+${tx.coins}` : tx.coins} coins
                    </p>
                    <p className="text-[11px] text-[#777777]">৳{tx.bdtEquivalent}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Standard Sponsored Ads Placement (All Clickable -> Chrome Tab) */}
      <div className="dh-card rounded-3xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#FF8500]" />
          <h3 className="text-sm font-bold text-[#172033]">
            {lang === 'bn' ? 'স্পন্সরড পার্টনার বিজ্ঞাপন (Chrome-এ ওপেন হবে)' : 'Sponsored Partner Placement (Opens in Chrome)'}
          </h3>
        </div>
        <ManagedPlacementSlot
          placement="watch_earn"
          units={managedAdUnits}
          adsEnabled={settings.adsEnabled}
          lang={lang}
          variant="grid"
        />
      </div>
    </div>
  );
}
