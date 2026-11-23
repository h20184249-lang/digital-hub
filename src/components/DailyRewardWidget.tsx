import { useCallback, useEffect, useState } from 'react';
import { Calendar, CheckCircle2, Clock, Coins, Flame, Gift, Lock, Sparkles } from 'lucide-react';
import {
  claimDailyRewardServer,
  fetchDailyRewardStatusServer,
  subscribeDashboardInvalidation,
} from '../lib/firestoreService';
import { AuthUser, DailyRewardStatus, Language } from '../types/marketplace';

interface DailyRewardWidgetProps {
  lang: Language;
  user: AuthUser | null;
  onOpenAuth: () => void;
  onClaimed?: (message: string) => void;
}

function formatCountdown(targetMs: number, nowMs: number): string {
  const diff = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  const hrs = Math.floor(diff / 3600);
  const mins = Math.floor((diff % 3600) / 60);
  const secs = diff % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function DailyRewardWidget({ lang, user, onOpenAuth, onClaimed }: DailyRewardWidgetProps) {
  const [status, setStatus] = useState<DailyRewardStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const loadStatus = useCallback(async () => {
    const next = await fetchDailyRewardStatusServer();
    if (next) setStatus(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadStatus().catch(() => setLoading(false));
    const unsub = subscribeDashboardInvalidation(() => {
      loadStatus().catch(() => {});
    });
    return () => unsub();
  }, [loadStatus, user?.uid]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (loading && !status) {
    return (
      <section className="dh-card rounded-3xl p-4 sm:p-5 border border-[#E6ECFA] dark:border-slate-800 animate-pulse">
        <div className="h-16 bg-slate-100 dark:bg-slate-800 rounded-2xl" />
      </section>
    );
  }

  if (!status || !status.enabled) {
    return null;
  }

  const handleClaim = async () => {
    if (!user) {
      onOpenAuth();
      return;
    }
    if (claiming || status.claimedToday) return;
    setErrorMsg('');
    setClaiming(true);
    try {
      const res = await claimDailyRewardServer();
      if (res.status) {
        setStatus(res.status);
      }
      if (res.ok) {
        onClaimed?.(
          res.message ||
            (lang === 'bn'
              ? `+${res.totalCoins || status.dailyCoins} কয়েন আপনার অ্যাকাউন্টে যুক্ত হয়েছে!`
              : `+${res.totalCoins || status.dailyCoins} Coins added to your balance!`)
        );
      } else if (res.alreadyClaimed) {
        await loadStatus();
        setErrorMsg(
          lang === 'bn' ? 'আজকের ডেইলি রিওয়ার্ড ইতিমধ্যেই ক্লেইম করা হয়েছে।' : "Today's reward already claimed."
        );
      } else {
        setErrorMsg(res.error || (lang === 'bn' ? 'রিওয়ার্ড ক্লেইম করা যায়নি।' : 'Failed to claim daily reward.'));
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to claim daily reward.');
    } finally {
      setClaiming(false);
    }
  };

  const resetCountdown = formatCountdown(status.nextResetAt, nowMs);

  return (
    <section className="dh-card rounded-3xl p-4 sm:p-5 border border-[#FF8500]/25 bg-gradient-to-br from-[#FFF9F2] via-white to-[#F3F6FF] dark:from-slate-900 dark:via-slate-900 dark:to-slate-900/90 space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5 min-w-0">
          <div className="w-12 h-12 rounded-2xl dh-orange-gradient text-white flex items-center justify-center shadow-md shrink-0">
            <Gift className="w-6 h-6" />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-[#FF8500]/15 text-[#FF8500] text-[10px] font-extrabold uppercase tracking-wider">
                {lang === 'bn' ? 'ডেইলি লগইন রিওয়ার্ড' : 'Daily Login Reward'}
              </span>
              {status.currentStreak > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300 text-[11px] font-extrabold font-mono-num">
                  <Flame className="w-3.5 h-3.5 text-[#FF8500]" />
                  {status.currentStreak} {lang === 'bn' ? 'দিনের স্ট্রিক' : 'Day Streak'}
                </span>
              )}
              {status.streakEnabled && status.streakDay7BonusCoins > 0 && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950/50 text-[#16A34A] dark:text-emerald-300 text-[10px] font-bold">
                  <Sparkles className="w-3 h-3" />
                  {lang === 'bn'
                    ? `৭ম দিনে +${status.streakDay7BonusCoins} বোনাস`
                    : `Day 7 +${status.streakDay7BonusCoins} Bonus`}
                </span>
              )}
            </div>

            <h2 className="text-base sm:text-lg font-extrabold text-[#172033] dark:text-slate-100 flex flex-wrap items-center gap-2">
              <span>
                {lang === 'bn'
                  ? `প্রতিদিন লগইন করে জিতুন +${status.dailyCoins} ফ্রি কয়েন`
                  : `Claim Your Daily +${status.dailyCoins} Free Coins`}
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-xl bg-[#172033] text-[#FACC15] text-xs font-extrabold font-mono-num">
                <Coins className="w-3.5 h-3.5" />+{status.dailyCoins}
              </span>
            </h2>

            <p className="text-xs text-[#64748B] dark:text-slate-400">
              {user ? (
                status.claimedToday ? (
                  <span className="inline-flex items-center gap-1.5 text-[#16A34A] dark:text-emerald-400 font-semibold">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    {lang === 'bn'
                      ? `আজকের +${status.todayClaim?.totalCoins || status.dailyCoins} কয়েন সংগ্রহ সম্পন্ন · আপনার মোট কয়েন: ${status.coinsAvailable}`
                      : `Today's +${status.todayClaim?.totalCoins || status.dailyCoins} Coins claimed · Your Coin Balance: ${status.coinsAvailable}`}
                  </span>
                ) : lang === 'bn' ? (
                  `আজ (${status.todayDate}) ক্লেইম করতে নিচের বাটনে ক্লিক করুন — কয়েন সাথে সাথে ব্যালেন্সে যোগ হবে।`
                ) : (
                  `Ready to claim for ${status.todayDate} (Asia/Dhaka) — coins credit instantly to your account.`
                )
              ) : lang === 'bn' ? (
                'সাইন-ইন করা ইউজাররা প্রতিদিন একবার +১০ ফ্রি কয়েন সংগ্রহ করতে পারবেন।'
              ) : (
                'Sign in or create a free account to claim +10 Coins every day and unlock 7-day streak bonuses.'
              )}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {!user ? (
            <button
              type="button"
              onClick={onOpenAuth}
              className="px-4 py-2.5 rounded-2xl dh-orange-gradient text-white text-xs sm:text-sm font-extrabold inline-flex items-center gap-2 shadow-md hover:opacity-95 transition-opacity"
            >
              <Lock className="w-4 h-4" />
              <span>{lang === 'bn' ? 'লগইন করে +১০ কয়েন নিন' : 'Sign In to Claim +10 Coins'}</span>
            </button>
          ) : status.claimedToday ? (
            <div className="flex items-center gap-2.5 px-4 py-2 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/70">
              <CheckCircle2 className="w-5 h-5 text-[#16A34A] shrink-0" />
              <div>
                <p className="text-xs font-extrabold text-[#16A34A] dark:text-emerald-400">
                  {lang === 'bn' ? 'আজকের রিওয়ার্ড ক্লেইমড' : "Today's Reward Claimed"}
                </p>
                <p className="text-[11px] text-[#64748B] dark:text-slate-400 font-mono-num inline-flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {lang === 'bn' ? 'পরবর্তী রিসেট:' : 'Next reset:'} {resetCountdown}
                </p>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={claiming}
              onClick={handleClaim}
              className="px-5 py-2.5 rounded-2xl dh-orange-gradient text-white text-xs sm:text-sm font-extrabold inline-flex items-center gap-2 shadow-md hover:opacity-95 transition-opacity disabled:opacity-60 cursor-pointer"
            >
              <Coins className="w-4 h-4" />
              <span>
                {claiming
                  ? lang === 'bn'
                    ? 'ক্লেইম হচ্ছে...'
                    : 'Claiming...'
                  : lang === 'bn'
                    ? `আজকের +${status.dailyCoins} কয়েন ক্লেইম করুন`
                    : `Claim Today's +${status.dailyCoins} Coins`}
              </span>
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <p className="text-xs font-bold text-[#DC2626] bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl px-3 py-2">
          {errorMsg}
        </p>
      )}

      {/* 7-Day Daily Streak Calendar */}
      <div className="pt-2 border-t border-[#E6ECFA] dark:border-slate-800/80">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-bold text-[#64748B] dark:text-slate-400 inline-flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#FF8500]" />
            {lang === 'bn' ? '৭ দিনের লগইন স্ট্রিক ক্যালেন্ডার (রিসেট রাত ১২:০০ BST)' : '7-Day Login Streak Calendar (Resets 00:00 BST)'}
          </span>
          {user && (
            <span className="text-[11px] font-mono-num font-bold text-[#172033] dark:text-slate-300">
              {lang === 'bn' ? 'সেরা স্ট্রিক:' : 'Best Streak:'} {status.longestStreak}{' '}
              {lang === 'bn' ? 'দিন' : 'days'}
            </span>
          )}
        </div>
        <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
          {status.weekDays.map((day) => (
            <div
              key={day.dayNumber}
              className={`rounded-2xl p-2 text-center border transition-colors ${
                day.claimed
                  ? 'bg-emerald-50 dark:bg-emerald-950/35 border-emerald-300 dark:border-emerald-800 text-[#16A34A] dark:text-emerald-300'
                  : day.isCurrent
                    ? 'bg-[#FFF3E5] dark:bg-orange-950/40 border-[#FF8500] text-[#172033] dark:text-white shadow-xs'
                    : day.isBonusMilestone
                      ? 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-300/70 dark:border-amber-800/50 text-[#172033] dark:text-slate-300'
                      : 'bg-white/80 dark:bg-slate-800/60 border-[#E6ECFA] dark:border-slate-700 text-[#64748B] dark:text-slate-400'
              }`}
            >
              <p className="text-[10px] font-bold truncate">{lang === 'bn' ? day.labelBn : day.labelEn}</p>
              <div className="my-1 flex items-center justify-center">
                {day.claimed ? (
                  <CheckCircle2 className="w-4 h-4 text-[#16A34A]" />
                ) : (
                  <Coins className={`w-4 h-4 ${day.isCurrent || day.isBonusMilestone ? 'text-[#FF8500]' : 'text-slate-400'}`} />
                )}
              </div>
              <p className="text-[11px] font-extrabold font-mono-num">+{day.coins}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
