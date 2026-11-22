import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Coins,
  ExternalLink,
  Film,
  History,
  Lock,
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
  verifyWatchEarnSessionServer,
  WatchEarnSummaryPayload,
} from '../lib/firestoreService';
import { resolveAdBrowserUrl } from '../lib/adNavigation';
import { getDhakaDateString } from '../lib/adProviderConfig';
import { ManagedPlacementSlot } from './AdUnitFrame';
import {
  ActiveAdSessionStatusPanel,
  buildWatchableAdItems,
  loadWatchedUnitIdsToday,
  useExternalWatchAdController,
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

const EMPTY_ADVERTISEMENTS: Advertisement[] = [];
const EMPTY_AD_NETWORKS: AdNetworkConfig[] = [];

export function WatchAndEarnPage({
  lang,
  user,
  profile,
  wallet,
  settings,
  advertisements = EMPTY_ADVERTISEMENTS,
  managedAdUnits,
  adNetworks = EMPTY_AD_NETWORKS,
  viewingSessions,
  rewardTransactions,
  onNavigate,
  onOpenAuth,
}: WatchAndEarnPageProps) {
  const [serverSummary, setServerSummary] = useState<WatchEarnSummaryPayload>({
    coinsAvailable: 0,
    coinsLifetimeEarned: 0,
    coinsRedeemed: 0,
    adsWatchedToday: 0,
    remainingAdsToday: Math.min(20, Math.max(1, settings.rewardedAdDailyLimit ?? 10)),
    coinsEarnedToday: 0,
    dailyAdLimit: Math.min(20, Math.max(1, settings.rewardedAdDailyLimit ?? 10)),
    dailyCoinLimit: Math.max(10, settings.watchEarnDailyCoinLimit ?? 100),
    coinsPerAd: Math.max(1, settings.watchEarnCoinsPerAd ?? 5),
    coinsPerBdt: Math.max(1, settings.watchEarnCoinsPerBdt ?? 10),
    minRedeemCoins: Math.max(10, settings.watchEarnMinRedeemCoins ?? 50),
    resetTimezone: 'Asia/Dhaka',
    watchedUnitIdsToday: [],
    watchEarnEnabled: settings.watchEarnEnabled !== false,
    creditedSessions: [],
  });
  const [adFilter, setAdFilter] = useState<'all' | 'available' | 'completed'>('all');
  const [busyVerify, setBusyVerify] = useState(false);
  const [redeemAmount, setRedeemAmount] = useState('');
  const [busyRedeem, setBusyRedeem] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'info' | 'err'; text: string } | null>(null);

  const watchableAds = useMemo(
    () => buildWatchableAdItems(advertisements, managedAdUnits, adNetworks),
    [advertisements, managedAdUnits, adNetworks]
  );

  const refreshServerSummary = () => {
    if (!user) return;
    getWatchEarnSummaryServer().then(setServerSummary).catch(() => {});
  };

  useEffect(() => {
    refreshServerSummary();
  }, [user?.uid]);

  const todayStr = getDhakaDateString();

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
        return ms > 0 && getDhakaDateString(ms) === todayStr;
      }),
    [reconciledViewingSessions, todayStr]
  );

  const dailyAdLimit = Math.min(20, Math.max(1, serverSummary.dailyAdLimit || settings.rewardedAdDailyLimit || 10));
  const dailyCoinLimit = Math.max(10, serverSummary.dailyCoinLimit || settings.watchEarnDailyCoinLimit || 100);
  const coinsPerAd = Math.max(1, serverSummary.coinsPerAd || settings.watchEarnCoinsPerAd || 5);
  const coinsPerBdt = Math.max(1, serverSummary.coinsPerBdt || settings.watchEarnCoinsPerBdt || 10);
  const minRedeemCoins = Math.max(10, serverSummary.minRedeemCoins || settings.watchEarnMinRedeemCoins || 50);

  const adsWatchedToday = Math.max(todayCredited.length, serverSummary.adsWatchedToday || 0);
  const remainingAdsToday = Math.max(0, dailyAdLimit - adsWatchedToday);
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

  const watchedTodaySet = useMemo(() => {
    const set = new Set<string>();
    (serverSummary.watchedUnitIdsToday || []).forEach((id) => set.add(id.toLowerCase()));
    todayCredited.forEach((s) => {
      if (s.unitId) set.add(s.unitId.toLowerCase());
    });
    loadWatchedUnitIdsToday(user?.uid).forEach((id) => set.add(id.toLowerCase()));
    return set;
  }, [serverSummary.watchedUnitIdsToday, todayCredited, user?.uid, adFilter]);

  const availableAdsList = useMemo(
    () => watchableAds.filter((a) => !watchedTodaySet.has(a.unitId.toLowerCase())),
    [watchableAds, watchedTodaySet]
  );
  const completedAdsList = useMemo(
    () => watchableAds.filter((a) => watchedTodaySet.has(a.unitId.toLowerCase())),
    [watchableAds, watchedTodaySet]
  );
  const visibleWatchableAds =
    adFilter === 'available'
      ? availableAdsList
      : adFilter === 'completed'
        ? completedAdsList
        : watchableAds;

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
          ? 'এই সেশনের কয়েন ইতিমধ্যে আপনার অ্যাকাউন্টে যোগ করা হয়েছে।'
          : 'Coins for this session were already credited.'
        : lang === 'bn'
          ? `সফল! +${res.coinsAwarded} কয়েন আপনার অ্যাকাউন্টে যোগ হয়েছে (মোট ব্যালেন্স: ${res.coinsAvailable} কয়েন)।`
          : `Success! +${res.coinsAwarded} Coins credited to your balance (New balance: ${res.coinsAvailable} Coins).`,
    });
    refreshServerSummary();
  };

  const controller = useExternalWatchAdController({
    uid: user?.uid,
    isSuspended: profile?.status === 'suspended',
    coinsPerAd,
    onCredited: handleRewardCredited,
  });

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

  const approvedCount = watchableAds.filter((a) => a.rewardApproved).length;

  return (
    <div className="max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 py-5 sm:py-6 space-y-6">
      {/* Header Hero */}
      <section className="dh-card rounded-3xl p-4 sm:p-7 bg-gradient-to-br from-[#172033] via-[#1f2d47] to-[#263659] text-white border-none space-y-5 overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2 max-w-2xl min-w-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FF8500]/20 border border-[#FF8500]/40 text-[#FF9B19] text-[11px] font-bold uppercase tracking-wider">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              {lang === 'bn'
                ? 'এক্সটার্নাল অ্যাড লিংক ও ৫ সেকেন্ড রিটার্ন সিস্টেম'
                : 'External Ad Links & 5s Return Reward System'}
            </span>
            <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight leading-tight">
              {lang === 'bn' ? 'বিজ্ঞাপন দেখুন ও কয়েন আয় করুন' : 'Watch External Ads & Earn Coins'}
            </h1>
            <p className="text-xs sm:text-sm text-white/80 leading-relaxed">
              {lang === 'bn'
                ? `প্রতিটি বিজ্ঞাপনের পাশে Open Ad বাটনে চাপ দিলে নির্ধারিত URL নতুন ব্রাউজার ট্যাবে খুলবে। ফিরে এলে ৫ সেকেন্ডের কাউন্টডাউন শেষে Claim Coins বাটন আসবে (+${coinsPerAd} কয়েন, ${coinsPerBdt} কয়েন = ৳১)।`
                : `Tap Open Ad to open the external URL in a single new tab. Return here for the 5-second countdown, then tap Claim Coins (+${coinsPerAd} Coins on policy-approved ads; ${coinsPerBdt} Coins = ৳1).`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
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

        {/* 6 Core Watch & Earn Status Cards (PART 2) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 sm:gap-3">
          <div className="p-3 sm:p-3.5 rounded-2xl bg-white/10 border border-white/10 min-w-0">
            <p className="text-[11px] text-white/70 truncate">
              {lang === 'bn' ? 'আজ সম্পন্ন বিজ্ঞাপন' : "Today's Completed"}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono-num mt-0.5">
              {adsWatchedToday}
            </p>
          </div>
          <div className="p-3 sm:p-3.5 rounded-2xl bg-white/10 border border-white/10 min-w-0">
            <p className="text-[11px] text-white/70 truncate">
              {lang === 'bn' ? 'দৈনিক বিজ্ঞাপন সীমা' : 'Daily Ads Limit'}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono-num text-[#FF9B19] mt-0.5">
              {adsWatchedToday} / {dailyAdLimit}
            </p>
          </div>
          <div className="p-3 sm:p-3.5 rounded-2xl bg-white/10 border border-white/10 min-w-0">
            <p className="text-[11px] text-white/70 truncate">
              {lang === 'bn' ? 'বাকি বিজ্ঞাপন (আজ)' : 'Remaining Ads'}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono-num text-sky-300 mt-0.5">
              {remainingAdsToday}
            </p>
          </div>
          <div className="p-3 sm:p-3.5 rounded-2xl bg-white/10 border border-white/10 min-w-0">
            <p className="text-[11px] text-white/70 truncate">
              {lang === 'bn' ? 'আজকের অর্জিত কয়েন' : 'Coins Earned Today'}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono-num text-emerald-400 mt-0.5">
              +{coinsEarnedToday}
              <span className="text-[11px] font-normal text-white/70 ml-1">/ {dailyCoinLimit}</span>
            </p>
          </div>
          <div className="p-3 sm:p-3.5 rounded-2xl bg-white/10 border border-white/10 min-w-0">
            <p className="text-[11px] text-white/70 truncate">
              {lang === 'bn' ? 'বর্তমান কয়েন ব্যালেন্স' : 'Coin Balance'}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono-num text-[#FACC15] mt-0.5">
              {currentCoinBalance}
              <span className="text-[11px] font-normal text-white/70 ml-1">
                (৳{(currentCoinBalance / coinsPerBdt).toFixed(2)})
              </span>
            </p>
          </div>
          <div className="p-3 sm:p-3.5 rounded-2xl bg-white/10 border border-white/10 min-w-0">
            <p className="text-[11px] text-white/70 truncate">
              {lang === 'bn' ? 'উপলব্ধ / সম্পন্ন অ্যাড' : 'Available / Done'}
            </p>
            <p className="text-xl sm:text-2xl font-extrabold font-mono-num mt-0.5">
              <span className="text-[#FF9B19]">{availableAdsList.length}</span>
              <span className="text-white/50 mx-1">/</span>
              <span className="text-emerald-300">{completedAdsList.length}</span>
            </p>
          </div>
        </div>
        <p className="text-[11px] text-white/70 flex flex-wrap items-center justify-between gap-2">
          <span>
            {lang === 'bn'
              ? `দৈনিক রিসেট সময়: রাত ১২:০০ (Asia/Dhaka) · মোট আজীবন আয়: ${totalCoinsEarned} কয়েন`
              : `Daily limit resets at 00:00 (Asia/Dhaka) · Lifetime earned: ${totalCoinsEarned} coins`}
          </span>
          <span className="font-mono-num text-[#FF9B19]">
            {lang === 'bn'
              ? `Today: ${adsWatchedToday} / ${dailyAdLimit} Ads · Remaining: ${remainingAdsToday} Ads · Coins Earned: ${coinsEarnedToday}`
              : `Today: ${adsWatchedToday} / ${dailyAdLimit} Ads · Remaining: ${remainingAdsToday} Ads · Coins Earned: ${coinsEarnedToday}`}
          </span>
        </p>
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
                  ? 'আপনার মোবাইল নম্বর বা ইমেইল অ্যাকাউন্ট দিয়ে লগইন করলে রিটার্ন সেশন ও কয়েন ব্যালেন্স স্থায়ীভাবে জমা থাকবে।'
                  : 'Sign in with your mobile number or email so your active ad step and earned coins save permanently.'}
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

      {/* Active Persistent Ad Session Status + 5s Countdown + Claim Coins Button */}
      {user && controller.activeStep && (
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
          onGoWallet={() => onNavigate('wallet')}
        />
      )}

      {/* Individual External Ad Cards with Open Ad Buttons + Coin Redemption */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 dh-card rounded-3xl p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-[#172033] dark:text-slate-100 flex items-center gap-2">
                <Film className="w-5 h-5 text-[#FF8500]" />
                {lang === 'bn' ? 'বিজ্ঞাপন তালিকা — প্রতিটি অ্যাডের জন্য আলাদা Open Ad বাটন' : 'External Ad Links — Open Ad One Step at a Time'}
              </h2>
              <p className="text-xs text-[#777777] dark:text-slate-400">
                {lang === 'bn'
                  ? `একসাথে কেবল একটি বিজ্ঞাপন খুলবে। আগের ধাপ সম্পন্ন না করে পরবর্তী বিজ্ঞাপন খোলা যাবে না।`
                  : `Only one ad tab can be active at a time. Complete the active step before opening the next ad.`}
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
            <>
              <div className="p-3 rounded-xl bg-[#F3F6FF] dark:bg-slate-800/80 border border-[#E6ECFA] dark:border-slate-700 text-[11px] text-[#555555] dark:text-slate-300 flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
                <span>
                  {approvedCount > 0
                    ? lang === 'bn'
                      ? `নীতিমালা অনুমোদিত ${approvedCount}টি বিজ্ঞাপনে ৫ সেকেন্ড শেষে Claim Coins (+${coinsPerAd} কয়েন) সক্রিয় আছে। অন্যান্য ডিসপ্লে লিংকে শুধু নিরাপদ ভিউ ধাপ চলে।`
                      : `${approvedCount} policy-approved ad(s) award +${coinsPerAd} Coins after 5s countdown + Claim Coins. Display-only links complete without coins.`
                    : lang === 'bn'
                      ? 'নেটওয়ার্ক নীতিমালা অনুযায়ী Reward-সহ বিজ্ঞাপন কেবল বিজ্ঞাপন নেটওয়ার্ক অনুমোদন করলে চালু হবে (অ্যাডমিন → Ad Units থেকে অনুমোদনযোগ্য)। এখন সব নির্ধারিত বিজ্ঞাপন লিংক নিরাপদে Open Ad বাটনে খুলবে।'
                      : 'Per ad network policy, rewarded coins activate only on units approved by the ad network (manageable in Admin → Ad Units). All your external ad URLs open safely one by one via Open Ad.'}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {(
                    [
                      ['all', lang === 'bn' ? `সব বিজ্ঞাপন (${watchableAds.length})` : `All Ads (${watchableAds.length})`],
                      ['available', lang === 'bn' ? `উপলব্ধ (${availableAdsList.length})` : `Available (${availableAdsList.length})`],
                      ['completed', lang === 'bn' ? `আজ সম্পন্ন (${completedAdsList.length})` : `Completed Today (${completedAdsList.length})`],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setAdFilter(key)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                        adFilter === key
                          ? 'dh-orange-gradient text-white border-[#FF8500]'
                          : 'bg-[#F3F6FF] dark:bg-slate-800 border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-[#777777] dark:text-slate-400">
                  {lang === 'bn' ? 'প্রতিটি বিজ্ঞাপন দিনে একবার' : 'One view per ad per day'}
                </span>
              </div>

              {visibleWatchableAds.length === 0 ? (
                <div className="p-6 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/80 border border-[#E6ECFA] dark:border-slate-700 text-center text-xs text-[#777777] dark:text-slate-300">
                  {adFilter === 'available'
                    ? lang === 'bn'
                      ? 'আজকের সব বিজ্ঞাপন ইতিমধ্যে সম্পন্ন হয়েছে! আগামীকাল (রাত ১২টা Asia/Dhaka) নতুন বিজ্ঞাপন আনলক হবে।'
                      : 'All available ads have been completed today! New ads unlock at 00:00 (Asia/Dhaka).'
                    : lang === 'bn'
                      ? 'এই তালিকায় কোনো বিজ্ঞাপন নেই।'
                      : 'No advertisements match this filter yet.'}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {visibleWatchableAds.map((item) => {
                    const launch = resolveAdBrowserUrl(item.targetUrl);
                    const isCurrentActive = controller.activeStep?.unitId === item.unitId;
                    const isWatchedToday = watchedTodaySet.has(item.unitId.toLowerCase());
                    const isLockedByOther =
                      controller.hasBlockingActiveStep && !isCurrentActive;
                    const blockedReason =
                      !user
                        ? 'auth'
                        : profile?.status === 'suspended'
                          ? 'suspended'
                          : isWatchedToday
                            ? 'watched_today'
                            : isLockedByOther
                              ? 'locked'
                              : isCurrentActive && controller.hasBlockingActiveStep
                                ? 'active'
                                : item.rewardApproved && !canWatchMore
                                  ? 'limit'
                                  : null;

                    const statusBadgeText = isWatchedToday
                      ? lang === 'bn'
                        ? 'সম্পন্ন (আজ)'
                        : 'Completed Today'
                      : isCurrentActive && controller.hasBlockingActiveStep
                        ? lang === 'bn'
                          ? 'চলমান'
                          : 'Active Step'
                        : item.rewardApproved && !canWatchMore
                          ? lang === 'bn'
                            ? 'সীমা পূর্ণ'
                            : 'Limit Reached'
                          : item.rewardApproved
                            ? `5s = +${coinsPerAd} ${lang === 'bn' ? 'কয়েন' : 'Coins'}`
                            : lang === 'bn'
                              ? 'উপলব্ধ · ডিসপ্লে'
                              : 'Available · Display';

                    return (
                      <div
                        key={item.id}
                        className={`p-3.5 rounded-2xl border transition-all flex flex-col justify-between gap-3 ${
                          isWatchedToday
                            ? 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/60'
                            : isCurrentActive
                              ? 'bg-[#FFF7EE] dark:bg-orange-500/15 border-[#FF8500] shadow-xs'
                              : 'bg-[#F3F6FF] dark:bg-slate-800/80 border-[#E6ECFA] dark:border-slate-700'
                        }`}
                      >
                        <div className="space-y-1 min-w-0">
                          <div className="flex flex-wrap items-center justify-between gap-1.5">
                            <span className="text-[10px] font-mono-num font-bold px-1.5 py-0.5 rounded bg-[#172033] text-white">
                              {item.unitId} · {item.provider}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                                isWatchedToday
                                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-[#16A34A] dark:text-emerald-300'
                                  : item.rewardApproved
                                    ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                                    : 'bg-slate-200/80 dark:bg-slate-700 text-[#555555] dark:text-slate-300'
                              }`}
                            >
                              {statusBadgeText}
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm font-bold text-[#172033] dark:text-slate-100 truncate">
                            {lang === 'bn' ? item.titleBn : item.titleEn}
                          </p>
                          <p className="text-[11px] text-[#777777] dark:text-slate-400 truncate font-mono-num">
                            {item.targetUrl}
                          </p>
                        </div>

                        <div>
                          {!user ? (
                            <button
                              type="button"
                              onClick={onOpenAuth}
                              className="w-full py-2 px-3 rounded-xl bg-[#172033] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Lock className="w-3.5 h-3.5" />
                              <span>{lang === 'bn' ? 'সাইন ইন করে Open Ad' : 'Sign In to Open Ad'}</span>
                            </button>
                          ) : blockedReason || !launch.ok ? (
                            <button
                              type="button"
                              disabled
                              className={`w-full py-2 px-3 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-not-allowed ${
                                blockedReason === 'watched_today'
                                  ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 opacity-75'
                              }`}
                            >
                              {blockedReason === 'watched_today' ? (
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              ) : (
                                <Lock className="w-3.5 h-3.5" />
                              )}
                              <span>
                                {blockedReason === 'watched_today'
                                  ? lang === 'bn'
                                    ? 'আজ ইতিমধ্যে দেখা হয়েছে'
                                    : 'Completed Today (1/1)'
                                  : blockedReason === 'active'
                                    ? lang === 'bn'
                                      ? 'উপরের সেশন সম্পন্ন করুন'
                                      : 'Complete Active Session Above'
                                    : blockedReason === 'locked'
                                      ? lang === 'bn'
                                        ? 'আগের ধাপ শেষ করুন'
                                        : 'Finish Previous Ad First'
                                      : blockedReason === 'limit'
                                        ? lang === 'bn'
                                          ? 'আজকের সীমা পূর্ণ'
                                          : 'Daily Limit Reached'
                                        : lang === 'bn'
                                          ? 'অনুপলব্ধ'
                                          : 'Unavailable'}
                              </span>
                            </button>
                          ) : (
                            <a
                              href={launch.href}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              onClick={(e) => controller.handleOpenExternalAd(e, item, lang)}
                              className="w-full py-2.5 px-3 rounded-xl dh-orange-gradient text-white text-xs font-extrabold inline-flex items-center justify-center gap-1.5 shadow-xs hover:opacity-95 cursor-pointer"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>
                                {item.rewardApproved
                                  ? lang === 'bn'
                                    ? `Open Ad (+${coinsPerAd} কয়েন)`
                                    : `Open Ad (+${coinsPerAd} Coins)`
                                  : lang === 'bn'
                                    ? 'Open Ad (নতুন ট্যাব)'
                                    : 'Open Ad'}
                              </span>
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Coin to BDT Wallet Redemption */}
        <form onSubmit={handleRedeemCoins} className="dh-card rounded-3xl p-4 sm:p-5 space-y-3.5 self-start">
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
              {rewardTransactions.slice(0, 20).map((tx) => {
                const statusLower = String(tx.status || '').toLowerCase();
                const isCredited = statusLower === 'credited' || statusLower === 'approved';
                const isRejected = statusLower === 'rejected' || statusLower === 'failed';
                return (
                  <div
                    key={tx.id}
                    className="p-3 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/80 border border-[#E6ECFA] dark:border-slate-700 flex items-start justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-bold text-[#172033] dark:text-slate-100 truncate">
                        {tx.adTitle || tx.note || tx.type}
                      </p>
                      <p className="text-[11px] text-[#555555] dark:text-slate-300 truncate font-mono-num">
                        {tx.unitId ? `${tx.unitId} · ` : ''}
                        {tx.provider}
                      </p>
                      <p className="text-[11px] text-[#777777] dark:text-slate-400">
                        {formatDateShort(tx.createdAt, lang)}
                      </p>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          isCredited
                            ? 'bg-emerald-100 dark:bg-emerald-500/20 text-[#16A34A] dark:text-emerald-300'
                            : isRejected
                              ? 'bg-red-100 dark:bg-red-500/20 text-[#DC2626] dark:text-red-300'
                              : 'bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        {tx.status || 'Credited'}
                      </span>
                      <p
                        className={`font-mono-num font-extrabold ${
                          tx.coins >= 0 ? 'text-[#16A34A] dark:text-emerald-400' : 'text-[#FF8500]'
                        }`}
                      >
                        {tx.coins >= 0 ? `+${tx.coins}` : tx.coins} coins
                      </p>
                      <p className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400">
                        ৳{tx.bdtEquivalent}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sponsored Partner Ads Placement */}
      <div className="dh-card rounded-3xl p-4 sm:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#FF8500]" />
          <h3 className="text-sm font-bold text-[#172033] dark:text-slate-100">
            {lang === 'bn' ? 'স্পন্সরড পার্টনার ব্যানার' : 'Sponsored Partner Banners'}
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
