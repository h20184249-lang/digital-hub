import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Coins,
  Film,
  History,
  Loader2,
  Lock,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import {
  AdNetworkConfig,
  AdRewardTransaction,
  AdViewingSession,
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
  formatDateShort,
  getTimeMs,
  getWatchEarnSummaryServer,
  redeemWatchEarnCoinsServer,
  startWatchEarnSessionServer,
  verifyWatchEarnSessionServer,
  WatchEarnSummaryPayload,
} from '../lib/firestoreService';
import { ManagedPlacementSlot } from './AdUnitFrame';
import {
  buildWatchableAdItems,
  WatchableAdItem,
  WatchAdModal,
  WatchRewardCompletionResult,
} from './WatchEarnWidgets';

interface WatchAndEarnPageProps {
  lang: Language;
  user: AuthUser | null;
  profile: UserProfile | null;
  wallet: WalletAccount | null;
  settings: SiteSettings;
  advertisements?: Advertisement[];
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
  advertisements = [],
  managedAdUnits,
  viewingSessions,
  rewardTransactions,
  onNavigate,
  onOpenAuth,
}: WatchAndEarnPageProps) {
  const [selectedAdId, setSelectedAdId] = useState<string>('');
  const [serverSummary, setServerSummary] = useState<WatchEarnSummaryPayload>({
    coinsAvailable: 0,
    coinsLifetimeEarned: 0,
    coinsRedeemed: 0,
    adsWatchedToday: 0,
    coinsEarnedToday: 0,
    dailyAdLimit: Math.max(1, settings.rewardedAdDailyLimit ?? 5),
    dailyCoinLimit: Math.max(10, settings.watchEarnDailyCoinLimit ?? 100),
    coinsPerAd: Math.max(1, settings.watchEarnCoinsPerAd ?? 10),
    coinsPerBdt: Math.max(1, settings.watchEarnCoinsPerBdt ?? 10),
    minRedeemCoins: Math.max(10, settings.watchEarnMinRedeemCoins ?? 50),
    watchEarnEnabled: settings.watchEarnEnabled !== false,
    creditedSessions: [],
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [activeAd, setActiveAd] = useState<WatchableAdItem | null>(null);
  const [activeSession, setActiveSession] = useState<{
    sessionId: string;
    sessionToken: string;
    requiredSeconds: number;
    rewardCoins: number;
  } | null>(null);
  const [busyPlay, setBusyPlay] = useState(false);
  const [busyVerify, setBusyVerify] = useState(false);
  const [redeemAmount, setRedeemAmount] = useState('');
  const [busyRedeem, setBusyRedeem] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'info' | 'err'; text: string } | null>(null);
  const startLockRef = useRef(false);

  const watchableAds = useMemo(
    () => buildWatchableAdItems(advertisements, managedAdUnits),
    [advertisements, managedAdUnits]
  );

  const selectedAd = useMemo(() => {
    if (watchableAds.length === 0) return null;
    return watchableAds.find((a) => a.id === selectedAdId) || watchableAds[0];
  }, [watchableAds, selectedAdId]);

  const refreshServerSummary = () => {
    if (!user) return;
    getWatchEarnSummaryServer().then(setServerSummary).catch(() => {});
  };

  useEffect(() => {
    refreshServerSummary();
  }, [user?.uid]);

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
        if (credited || String(s.status || '').toLowerCase() === 'credited') {
          return {
            ...s,
            status: 'credited' as const,
            coinsAwarded: Math.max(s.coinsAwarded || 0, credited?.coins || 0),
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

  const dailyAdLimit = Math.max(1, serverSummary.dailyAdLimit || settings.rewardedAdDailyLimit || 5);
  const dailyCoinLimit = Math.max(10, serverSummary.dailyCoinLimit || settings.watchEarnDailyCoinLimit || 100);
  const coinsPerAd = Math.max(1, serverSummary.coinsPerAd || settings.watchEarnCoinsPerAd || 10);
  const coinsPerBdt = Math.max(1, serverSummary.coinsPerBdt || settings.watchEarnCoinsPerBdt || 10);
  const minRedeemCoins = Math.max(10, serverSummary.minRedeemCoins || settings.watchEarnMinRedeemCoins || 50);

  const adsWatchedToday = Math.max(todayCredited.length, serverSummary.adsWatchedToday || 0);
  const coinsEarnedToday = Math.max(
    todayCredited.reduce((s, x) => s + (x.coinsAwarded || 0), 0),
    serverSummary.coinsEarnedToday || 0
  );
  const currentCoinBalance = Math.max(wallet?.coinsAvailable ?? 0, serverSummary.coinsAvailable);
  const totalCoinsEarned = Math.max(wallet?.coinsLifetimeEarned ?? 0, serverSummary.coinsLifetimeEarned);
  const watchEarnEnabled =
    settings.adsEnabled !== false &&
    settings.watchEarnEnabled !== false &&
    settings.rewardedAdEnabled !== false;
  const canWatchMore = adsWatchedToday < dailyAdLimit && coinsEarnedToday + coinsPerAd <= dailyCoinLimit;

  const startWatchSession = async (targetAd?: WatchableAdItem | null) => {
    if (!user) {
      onOpenAuth();
      return;
    }
    if (profile?.status === 'suspended') {
      setFeedback({
        type: 'err',
        text: lang === 'bn' ? 'আপনার অ্যাকাউন্ট সাময়িকভাবে সাসপেন্ড আছে।' : 'Your account is currently suspended.',
      });
      return;
    }
    if (!watchEarnEnabled) {
      setFeedback({
        type: 'err',
        text:
          lang === 'bn'
            ? 'ওয়াচ ও আর্ন বর্তমানে অ্যাডমিন দ্বারা বন্ধ রাখা হয়েছে।'
            : 'Watch & Earn is currently paused by the administrator.',
      });
      return;
    }
    if (!canWatchMore) {
      setFeedback({
        type: 'info',
        text:
          lang === 'bn'
            ? `আজকের দৈনিক বিজ্ঞাপন সীমা (${dailyAdLimit}/${dailyAdLimit}) পূর্ণ হয়েছে। আগামীকাল আবার চেষ্টা করুন।`
            : `Today's daily ad limit (${dailyAdLimit}/${dailyAdLimit}) is complete. Come back tomorrow!`,
      });
      return;
    }
    const chosen = targetAd || selectedAd;
    if (!chosen) {
      setFeedback({
        type: 'err',
        text:
          lang === 'bn'
            ? 'বর্তমানে দেখার মতো কোনো সক্রিয় বিজ্ঞাপন নেই।'
            : 'No active advertisements are available right now.',
      });
      return;
    }
    if (startLockRef.current || modalOpen) return;

    startLockRef.current = true;
    setBusyPlay(true);
    setFeedback(null);

    try {
      const res = await startWatchEarnSessionServer({
        unitId: chosen.unitId,
        provider: chosen.provider,
        launchUrl: chosen.targetUrl,
      });
      setSelectedAdId(chosen.id);
      setActiveAd(chosen);
      setActiveSession({
        sessionId: res.sessionId,
        sessionToken: res.sessionToken,
        requiredSeconds: res.requiredSeconds || 5,
        rewardCoins: res.rewardCoins || coinsPerAd,
      });
      setModalOpen(true);
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'Could not start Watch & Earn session.',
      });
    } finally {
      setBusyPlay(false);
      startLockRef.current = false;
    }
  };

  const handleRewardCredited = (res: WatchRewardCompletionResult) => {
    setServerSummary((prev) => ({
      ...prev,
      coinsAvailable: res.coinsAvailable,
      coinsLifetimeEarned: res.coinsLifetimeEarned,
      coinsRedeemed: res.coinsRedeemed,
      adsWatchedToday: res.adsWatchedToday,
      coinsEarnedToday: res.coinsEarnedToday,
      dailyAdLimit: res.dailyAdLimit,
      dailyCoinLimit: res.dailyCoinLimit,
    }));
    setFeedback({
      type: 'ok',
      text: res.alreadyCredited
        ? lang === 'bn'
          ? 'এই বিজ্ঞাপনটির কয়েন ইতিমধ্যে আপনার অ্যাকাউন্টে যোগ করা হয়েছে।'
          : 'Coins for this ad session were already credited.'
        : lang === 'bn'
          ? `অভিনন্দন! +${res.coinsAwarded} কয়েন স্বয়ংক্রিয়ভাবে আপনার অ্যাকাউন্টে যোগ হয়েছে (বর্তমান ব্যালেন্স: ${res.coinsAvailable} কয়েন)।`
          : `Success! +${res.coinsAwarded} Coins credited automatically to your balance (New balance: ${res.coinsAvailable} Coins).`,
    });
    // Advance selected ad to next one automatically
    if (watchableAds.length > 1 && activeAd) {
      const curIdx = watchableAds.findIndex((a) => a.id === activeAd.id);
      const nextAd = watchableAds[(curIdx + 1) % watchableAds.length];
      if (nextAd) setSelectedAdId(nextAd.id);
    }
    refreshServerSummary();
  };

  const handleVerifySession = async (sessionId: string) => {
    setFeedback(null);
    setBusyVerify(true);
    try {
      const res = await verifyWatchEarnSessionServer(sessionId);
      setFeedback({
        type: res.verified ? 'ok' : 'info',
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
    if (!user) {
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
              : `Submitted ${res.coinsRedeemed} coin redemption (৳${res.bdtCredited}); credits to wallet upon admin approval.`,
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

  return (
    <div className="max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 py-5 sm:py-6 space-y-6">
      {/* Header Hero */}
      <section className="dh-card rounded-3xl p-4 sm:p-7 bg-gradient-to-br from-[#172033] via-[#1f2d47] to-[#263659] text-white border-none space-y-5 overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2 max-w-2xl min-w-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FF8500]/20 border border-[#FF8500]/40 text-[#FF9B19] text-[11px] font-bold uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              {lang === 'bn' ? '৫ সেকেন্ডে অটো-কয়েন রিওয়ার্ড' : '5-Second Auto-Credit Watch & Earn'}
            </span>
            <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight leading-tight">
              {lang === 'bn' ? 'বিজ্ঞাপন দেখুন ও কয়েন আয় করুন' : 'Watch Ads & Earn Coins'}
            </h1>
            <p className="text-xs sm:text-sm text-white/80 leading-relaxed">
              {lang === 'bn'
                ? `প্রতিটি বিজ্ঞাপন ৫ সেকেন্ড সম্পূর্ণ দেখলেই কোনো ক্লেইম বাটন ছাড়াই স্বয়ংক্রিয়ভাবে +${coinsPerAd} কয়েন আপনার অ্যাকাউন্টে স্থায়ীভাবে যোগ হবে (${coinsPerBdt} কয়েন = ৳১)।`
                : `Watch any real ad for 5 full seconds and receive +${coinsPerAd} coins automatically with zero extra clicks (${coinsPerBdt} coins = ৳1). Balance persists permanently in your account.`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={busyPlay || !watchEarnEnabled || profile?.status === 'suspended' || (Boolean(user) && !canWatchMore)}
              onClick={() => void startWatchSession()}
              className="px-5 sm:px-6 py-3.5 rounded-2xl dh-orange-gradient text-white text-xs sm:text-sm font-extrabold inline-flex items-center gap-2 shadow-lg hover:opacity-95 disabled:opacity-50 cursor-pointer"
            >
              {busyPlay ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4 fill-current" />
              )}
              <span>
                {busyPlay
                  ? lang === 'bn'
                    ? 'চালু হচ্ছে...'
                    : 'Starting...'
                  : user && !canWatchMore
                    ? lang === 'bn'
                      ? 'আজকের সীমা পূর্ণ'
                      : 'Daily Limit Reached'
                    : lang === 'bn'
                      ? `বিজ্ঞাপন দেখুন (+${coinsPerAd} কয়েন)`
                      : `WATCH AD & EARN (+${coinsPerAd})`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('wallet')}
              className="px-4 py-3.5 rounded-2xl bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Wallet className="w-4 h-4 text-[#FF9B19]" />
              <span>{lang === 'bn' ? 'ওয়ালেট দেখুন' : 'My Wallet'}</span>
            </button>
          </div>
        </div>

        {/* 5 Core Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 sm:gap-3">
          <div className="p-3 sm:p-3.5 rounded-2xl bg-white/10 border border-white/10 min-w-0">
            <p className="text-[11px] text-white/70 truncate">
              {lang === 'bn' ? 'উপলব্ধ বিজ্ঞাপন' : 'Available Ads'}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono-num text-[#FF9B19] mt-0.5">
              {watchableAds.length}
            </p>
          </div>
          <div className="p-3 sm:p-3.5 rounded-2xl bg-white/10 border border-white/10 min-w-0">
            <p className="text-[11px] text-white/70 truncate">
              {lang === 'bn' ? 'আজকে দেখা হয়েছে' : 'Ads Watched Today'}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono-num mt-0.5">
              {adsWatchedToday} / {dailyAdLimit}
            </p>
          </div>
          <div className="p-3 sm:p-3.5 rounded-2xl bg-white/10 border border-white/10 min-w-0">
            <p className="text-[11px] text-white/70 truncate">
              {lang === 'bn' ? 'মোট অর্জিত কয়েন' : 'Total Coins Earned'}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono-num text-emerald-400 mt-0.5">
              {totalCoinsEarned}
            </p>
          </div>
          <div className="p-3 sm:p-3.5 rounded-2xl bg-white/10 border border-white/10 min-w-0">
            <p className="text-[11px] text-white/70 truncate">
              {lang === 'bn' ? 'বর্তমান কয়েন ব্যালেন্স' : 'Current Coin Balance'}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono-num text-[#FACC15] mt-0.5">
              {currentCoinBalance}
              <span className="text-[11px] font-normal text-white/70 ml-1">
                (৳{(currentCoinBalance / coinsPerBdt).toFixed(2)})
              </span>
            </p>
          </div>
          <div className="p-3 sm:p-3.5 rounded-2xl bg-white/10 border border-white/10 col-span-2 sm:col-span-1 min-w-0">
            <p className="text-[11px] text-white/70 truncate">
              {lang === 'bn' ? 'দৈনিক আয়ের সীমা' : 'Daily Coin Limit'}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono-num mt-0.5">
              {coinsEarnedToday} / {dailyCoinLimit}
            </p>
          </div>
        </div>
      </section>

      {feedback && (
        <div
          className={`p-4 rounded-2xl border text-xs sm:text-sm font-semibold flex items-start gap-2.5 ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : feedback.type === 'info'
                ? 'bg-[#F3F6FF] dark:bg-slate-800 border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-100'
                : 'bg-amber-50 dark:bg-amber-950/35 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-300'
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
          <div className="flex items-center gap-3 min-w-0">
            <Lock className="w-6 h-6 text-[#FF8500] shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-[#172033] dark:text-slate-100">
                {lang === 'bn' ? 'কয়েন আয় করতে সাইন ইন করুন' : 'Sign In to Earn & Save Coins'}
              </p>
              <p className="text-xs text-[#777777] dark:text-slate-400">
                {lang === 'bn'
                  ? 'আপনার মোবাইল নম্বর বা ইমেইল অ্যাকাউন্ট দিয়ে লগইন করলে প্রতিটি ৫ সেকেন্ডের বিজ্ঞাপনের কয়েন স্থায়ীভাবে জমা থাকবে।'
                  : 'Log in with your mobile number or email account so your 5-second ad coins save permanently.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenAuth}
            className="px-5 py-2.5 rounded-xl dh-orange-gradient text-white text-xs font-bold shrink-0 cursor-pointer"
          >
            {lang === 'bn' ? 'লগইন / রেজিস্টার' : 'Sign In / Register'}
          </button>
        </div>
      )}

      {/* Watchable Ads Selector + Coin Redemption */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 dh-card rounded-3xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#172033] dark:text-slate-100 flex items-center gap-2">
                <Film className="w-5 h-5 text-[#FF8500]" />
                {lang === 'bn' ? 'বিজ্ঞাপন নির্বাচন করুন (৫ সেকেন্ড = অটো কয়েন)' : 'Select an Ad to Watch (5s = Auto Coins)'}
              </h2>
              <p className="text-xs text-[#777777] dark:text-slate-400">
                {lang === 'bn'
                  ? `যেকোনো বিজ্ঞাপনে ট্যাপ করুন → ৫ সেকেন্ড দেখুন → +${coinsPerAd} কয়েন সাথে সাথে জমা হবে।`
                  : `Tap any available ad → view for 5 seconds → +${coinsPerAd} coins credited automatically.`}
              </p>
            </div>
          </div>

          {!watchEarnEnabled ? (
            <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-300 font-semibold">
              {lang === 'bn'
                ? 'ওয়াচ ও আর্ন বর্তমানে অ্যাডমিন দ্বারা বন্ধ রাখা হয়েছে।'
                : 'Watch & Earn is currently paused by the administrator.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {watchableAds.slice(0, 8).map((item) => {
                const isSelected = selectedAd?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={busyPlay || (Boolean(user) && !canWatchMore)}
                    onClick={() => void startWatchSession(item)}
                    className={`group text-left p-3 rounded-2xl border transition-all flex items-center justify-between gap-2.5 cursor-pointer disabled:opacity-55 ${
                      isSelected
                        ? 'bg-[#FFF7EE] dark:bg-orange-500/15 border-[#FF8500] shadow-xs'
                        : 'bg-[#F3F6FF] dark:bg-slate-800/80 border-[#E6ECFA] dark:border-slate-700 hover:border-[#FF8500]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-9 h-9 rounded-xl dh-orange-gradient text-white flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-mono-num font-bold px-1.5 py-0.5 rounded bg-[#172033] text-white">
                            {item.unitId}
                          </span>
                          <span className="text-[10px] font-bold text-[#16A34A] dark:text-emerald-400">
                            +{coinsPerAd} {lang === 'bn' ? 'কয়েন' : 'Coins'}
                          </span>
                        </div>
                        <p className="text-xs font-bold text-[#172033] dark:text-slate-100 truncate mt-0.5">
                          {lang === 'bn' ? item.titleBn : item.titleEn}
                        </p>
                        <p className="text-[10px] text-[#777777] dark:text-slate-400 truncate">
                          {item.provider} · 5s {lang === 'bn' ? 'ভেরিফায়েড ভিউ' : 'verified view'}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Coin to BDT Wallet Redemption */}
        <form onSubmit={handleRedeemCoins} className="dh-card rounded-3xl p-4 sm:p-5 space-y-3.5">
          <div className="flex items-center gap-2">
            <Coins className="w-5 h-5 text-[#FF8500]" />
            <h2 className="text-base font-bold text-[#172033] dark:text-slate-100">
              {lang === 'bn' ? 'কয়েন থেকে ওয়ালেট টাকা' : 'Redeem Coins to Wallet'}
            </h2>
          </div>
          <p className="text-xs text-[#777777] dark:text-slate-400">
            {lang === 'bn'
              ? `রেট: ${coinsPerBdt} কয়েন = ৳১ · ন্যূনতম ${minRedeemCoins} কয়েন।`
              : `Rate: ${coinsPerBdt} Coins = ৳1 BDT · Minimum ${minRedeemCoins} coins required.`}
          </p>
          <div className="p-3 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between text-xs">
            <span className="text-[#777777] dark:text-slate-400">
              {lang === 'bn' ? 'ব্যবহারযোগ্য কয়েন' : 'Available Coins'}
            </span>
            <span className="font-mono-num font-extrabold text-[#172033] dark:text-slate-100 text-sm">
              {currentCoinBalance} (৳{(currentCoinBalance / coinsPerBdt).toFixed(2)})
            </span>
          </div>
          <div>
            <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
              {lang === 'bn' ? 'কয়েনের পরিমাণ' : 'Coins to Convert'}
            </label>
            <input
              type="number"
              min={minRedeemCoins}
              max={Math.max(minRedeemCoins, currentCoinBalance)}
              value={redeemAmount}
              onChange={(e) => setRedeemAmount(e.target.value)}
              placeholder={`${minRedeemCoins}`}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-mono-num text-[#172033] dark:text-slate-100"
            />
          </div>
          <button
            type="submit"
            disabled={busyRedeem || currentCoinBalance < minRedeemCoins || profile?.status === 'suspended'}
            className="w-full py-2.5 rounded-xl dh-orange-gradient text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
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
        <div className="dh-card rounded-3xl p-4 sm:p-5 space-y-3">
          <h3 className="text-base font-bold text-[#172033] dark:text-slate-100 flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#FF8500]" />
            {lang === 'bn' ? 'ওয়াচ হিস্ট্রি' : 'Watch History'} ({reconciledViewingSessions.length})
          </h3>
          {reconciledViewingSessions.length === 0 ? (
            <p className="text-xs text-[#777777] dark:text-slate-400 py-6 text-center">
              {lang === 'bn' ? 'এখনো কোনো অ্যাড সেশন নেই।' : 'No Watch & Earn sessions recorded yet.'}
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {reconciledViewingSessions.slice(0, 20).map((s) => (
                <div
                  key={s.id}
                  className="p-3 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/80 border border-[#E6ECFA] dark:border-slate-700 flex items-start justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-[#172033] dark:text-slate-100 truncate">
                      {s.provider} · {s.unitId}
                    </p>
                    <p className="text-[11px] text-[#777777] dark:text-slate-400 truncate">
                      {formatDateShort(s.createdAt, lang)}
                      {s.failureReason ? ` · ${s.failureReason}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                        s.status === 'credited'
                          ? 'bg-emerald-100 dark:bg-emerald-500/20 text-[#16A34A] dark:text-emerald-300'
                          : s.status === 'watching' || s.status === 'awaiting_callback'
                            ? 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300'
                            : 'bg-red-100 dark:bg-red-500/20 text-[#DC2626] dark:text-red-300'
                      }`}
                    >
                      {s.status}
                    </span>
                    {s.coinsAwarded > 0 && (
                      <span className="font-mono-num font-bold text-[#16A34A] dark:text-emerald-400">
                        +{s.coinsAwarded} coins
                      </span>
                    )}
                    {s.status === 'awaiting_callback' && (
                      <button
                        type="button"
                        disabled={busyVerify}
                        onClick={() => void handleVerifySession(s.id)}
                        className="text-[10px] font-bold text-[#FF8500] hover:underline inline-flex items-center gap-0.5"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${busyVerify ? 'animate-spin' : ''}`} />
                        {lang === 'bn' ? 'চেক করুন' : 'Verify'}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="dh-card rounded-3xl p-4 sm:p-5 space-y-3">
          <h3 className="text-base font-bold text-[#172033] dark:text-slate-100 flex items-center gap-2">
            <History className="w-4 h-4 text-[#FF8500]" />
            {lang === 'bn' ? 'রিওয়ার্ড হিস্ট্রি' : 'Reward History'} ({rewardTransactions.length})
          </h3>
          {rewardTransactions.length === 0 ? (
            <p className="text-xs text-[#777777] dark:text-slate-400 py-6 text-center">
              {lang === 'bn' ? 'এখনো কোনো রিওয়ার্ড লেনদেন নেই।' : 'No coin reward transactions yet.'}
            </p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {rewardTransactions.slice(0, 20).map((tx) => (
                <div
                  key={tx.id}
                  className="p-3 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/80 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-[#172033] dark:text-slate-100 truncate">
                      {tx.note || tx.type} ({tx.provider})
                    </p>
                    <p className="text-[11px] text-[#777777] dark:text-slate-400">
                      {formatDateShort(tx.createdAt, lang)}
                    </p>
                  </div>
                  <div className="text-right shrink-0 font-mono-num">
                    <p
                      className={`font-extrabold ${
                        tx.coins >= 0 ? 'text-[#16A34A] dark:text-emerald-400' : 'text-[#FF8500]'
                      }`}
                    >
                      {tx.coins >= 0 ? `+${tx.coins}` : tx.coins} coins
                    </p>
                    <p className="text-[11px] text-[#777777] dark:text-slate-400">৳{tx.bdtEquivalent}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Sponsored Partner Ads Placement */}
      <div className="dh-card rounded-3xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#FF8500]" />
          <h3 className="text-sm font-bold text-[#172033] dark:text-slate-100">
            {lang === 'bn' ? 'স্পন্সরড পার্টনার বিজ্ঞাপন' : 'Sponsored Partner Placement'}
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
        onRewardCredited={handleRewardCredited}
        onSwitchAd={() => {
          const curIdx = activeAd ? watchableAds.findIndex((a) => a.id === activeAd.id) : 0;
          const nextAd = watchableAds[(curIdx + 1) % Math.max(1, watchableAds.length)];
          setModalOpen(false);
          setActiveSession(null);
          if (nextAd) {
            setTimeout(() => void startWatchSession(nextAd), 120);
          }
        }}
        onWatchNext={() => {
          const curIdx = activeAd ? watchableAds.findIndex((a) => a.id === activeAd.id) : 0;
          const nextAd = watchableAds[(curIdx + 1) % Math.max(1, watchableAds.length)];
          setModalOpen(false);
          setActiveSession(null);
          if (nextAd) {
            setTimeout(() => void startWatchSession(nextAd), 120);
          }
        }}
        onGoWallet={() => {
          setModalOpen(false);
          setActiveSession(null);
          onNavigate('wallet');
        }}
      />
    </div>
  );
}
