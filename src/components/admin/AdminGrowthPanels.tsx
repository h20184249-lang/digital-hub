import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Edit3,
  Megaphone,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  AdPlacement,
  AdRewardTransaction,
  Advertisement,
  Banner,
  BannerSlot,
  Language,
  ManagedAdUnitConfig,
  PaymentMethodConfig,
  Referral,
  RewardedAdClaim,
  ServerAdAnalytics,
  SiteSettings,
} from '../../types/marketplace';
import {
  adminDeleteAdvertisement,
  adminDeleteBanner,
  adminDeletePaymentMethod,
  adminFetchPaymentMethods,
  adminSaveAdvertisement,
  adminSaveBanner,
  adminSaveManagedAdUnit,
  adminSavePaymentMethod,
  adminSaveSiteSettings,
  adminSettleCoinRedemptionServer,
  adminSettleReferralServer,
  adminSettleRewardClaimServer,
  fetchServerAdAnalytics,
  formatDateShort,
  generateId,
} from '../../lib/firestoreService';
import { ConfirmDialog } from './ConfirmDialog';

// =========================================================================
// 1. REFERRALS MANAGEMENT PANEL (SETTINGS + LIST + SUSPICIOUS DETECTION)
// =========================================================================

interface AdminReferralsPanelProps {
  lang: Language;
  referrals: Referral[];
  settings: SiteSettings;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminReferralsPanel({
  lang,
  referrals,
  settings,
  onSuccess,
  onError,
}: AdminReferralsPanelProps) {
  const [filter, setFilter] = useState<'all' | 'pending' | 'credited' | 'flagged' | 'revoked'>('all');
  const [busyId, setBusyId] = useState('');

  // Referral program settings
  const [enabled, setEnabled] = useState(settings.referralEnabled !== false);
  const [bonusBdt, setBonusBdt] = useState(String(settings.referralBonusBdt ?? 25));
  const [invitedRewardBdt, setInvitedRewardBdt] = useState(String(settings.invitedUserRewardBdt ?? 0));
  const [maxRewardBdt, setMaxRewardBdt] = useState(String(settings.referralMaxRewardBdt ?? 5000));
  const [eligibility, setEligibility] = useState<NonNullable<SiteSettings['referralEligibility']>>(
    settings.referralEligibility || 'first_paid_order'
  );
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    setEnabled(settings.referralEnabled !== false);
    setBonusBdt(String(settings.referralBonusBdt ?? 25));
    setInvitedRewardBdt(String(settings.invitedUserRewardBdt ?? 0));
    setMaxRewardBdt(String(settings.referralMaxRewardBdt ?? 5000));
    setEligibility(settings.referralEligibility || 'first_paid_order');
  }, [settings]);

  const filtered = useMemo(() => {
    if (filter === 'all') return referrals;
    if (filter === 'flagged') return referrals.filter((r) => r.status === 'flagged' || r.suspiciousFlag);
    return referrals.filter((r) => r.status === filter);
  }, [referrals, filter]);

  const flaggedCount = referrals.filter((r) => r.status === 'flagged' || r.suspiciousFlag).length;
  const creditedTotal = referrals
    .filter((r) => r.status === 'credited')
    .reduce((s, r) => s + (r.rewardAmountBdt || 0), 0);

  const handleSaveSettings = async (e: FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await adminSaveSiteSettings({
        ...settings,
        referralEnabled: enabled,
        referralBonusBdt: Math.max(0, Math.round(Number(bonusBdt) || 0)),
        invitedUserRewardBdt: Math.max(0, Math.round(Number(invitedRewardBdt) || 0)),
        referralMaxRewardBdt: Math.max(0, Math.round(Number(maxRewardBdt) || 0)),
        referralEligibility: eligibility,
      });
      onSuccess(lang === 'bn' ? 'রেফারেল সেটিংস সংরক্ষিত হয়েছে।' : 'Referral program settings saved.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save referral settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSettle = async (ref: Referral, decision: 'credit' | 'revoke') => {
    setBusyId(ref.id);
    try {
      await adminSettleReferralServer({
        referralId: ref.id,
        decision,
        reason: decision === 'revoke' ? 'Revoked by administrator' : 'Credited by administrator',
      });
      onSuccess(
        decision === 'credit'
          ? `Referral ${ref.id} credited (+৳${ref.rewardAmountBdt}).`
          : `Referral ${ref.id} revoked.`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Referral update failed.');
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="space-y-5">
      {/* Program Settings Form */}
      <form
        onSubmit={handleSaveSettings}
        className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-4 text-xs"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
              {lang === 'bn' ? 'রেফারেল প্রোগ্রাম কনফিগারেশন' : 'Referral Program Rules & Limits'}
            </h3>
            <p className="text-[11px] text-[#777777] dark:text-slate-400">
              Total Credited: <strong className="font-mono-num text-emerald-600">৳{creditedTotal}</strong> · Suspicious Flags:{' '}
              <strong className="font-mono-num text-[#DC2626]">{flaggedCount}</strong>
            </p>
          </div>
          <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="accent-[#FF8500] w-4 h-4"
            />
            <span>{enabled ? 'Program Enabled' : 'Program Disabled'}</span>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block font-bold mb-1">Referrer Reward (BDT)</label>
            <input
              type="number"
              min={0}
              value={bonusBdt}
              onChange={(e) => setBonusBdt(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Invited User Bonus (BDT)</label>
            <input
              type="number"
              min={0}
              value={invitedRewardBdt}
              onChange={(e) => setInvitedRewardBdt(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Max Referral Rewards / User (BDT)</label>
            <input
              type="number"
              min={0}
              value={maxRewardBdt}
              onChange={(e) => setMaxRewardBdt(e.target.value)}
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">Qualification Rule</label>
            <select
              value={eligibility}
              onChange={(e) =>
                setEligibility(e.target.value as NonNullable<SiteSettings['referralEligibility']>)
              }
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            >
              <option value="first_paid_order">First Completed Paid Order</option>
              <option value="verified_signup">Immediate Verified Signup</option>
              <option value="first_rewarded_ad">First Rewarded Ad</option>
            </select>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={savingSettings}
            className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {savingSettings ? 'Saving...' : 'Save Referral Rules'}
          </button>
        </div>
      </form>

      {/* Referral Filter & Table */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-[#E6ECFA] dark:border-slate-800 flex flex-wrap gap-2">
          {(['all', 'pending', 'credited', 'flagged', 'revoked'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize border ${
                filter === f
                  ? 'bg-[#FF8500] text-white border-[#FF8500]'
                  : 'bg-[#F8FAFF] dark:bg-slate-800 border-[#E6ECFA] dark:border-slate-700'
              }`}
            >
              {f} {f === 'flagged' && flaggedCount > 0 ? `(${flaggedCount})` : ''}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E6ECFA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-800/60 text-[#777777] dark:text-slate-400 uppercase text-[10px]">
                <th className="py-3 px-4 font-bold">Referrer ID</th>
                <th className="py-3 px-4 font-bold">Referred User</th>
                <th className="py-3 px-4 font-bold">Reward</th>
                <th className="py-3 px-4 font-bold">Status / Risk</th>
                <th className="py-3 px-4 font-bold">Date</th>
                <th className="py-3 px-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[#777777]">
                    No referral records found.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => (
                  <tr key={r.id} className="hover:bg-[#F8FAFF] dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-mono-num">
                      <p className="font-bold text-[#172033] dark:text-slate-100">{r.referrerId}</p>
                      <p className="text-[10px] text-[#FF8500]">Code: {r.referralCode}</p>
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-bold text-[#172033] dark:text-slate-100">{r.referredEmail || r.referredUserId}</p>
                      <p className="text-[10px] font-mono-num text-[#777777]">{r.referredUserId}</p>
                    </td>
                    <td className="py-3 px-4 font-mono-num font-extrabold text-emerald-600 dark:text-emerald-400">
                      ৳{r.rewardAmountBdt}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                          r.status === 'credited'
                            ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                            : r.status === 'flagged' || r.suspiciousFlag
                              ? 'bg-red-100 dark:bg-red-950/50 text-[#DC2626]'
                              : r.status === 'revoked'
                                ? 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                : 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        {r.status}
                      </span>
                      {r.suspiciousReason && (
                        <p className="text-[10px] text-[#DC2626] mt-0.5 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          {r.suspiciousReason}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-[#777777] dark:text-slate-400">
                      {formatDateShort(r.createdAt, lang)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {r.status !== 'credited' && (
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void handleSettle(r, 'credit')}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-50"
                          >
                            Credit
                          </button>
                        )}
                        {r.status !== 'revoked' && (
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void handleSettle(r, 'revoke')}
                            className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-950/50 text-[#DC2626] font-bold disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// 2. ADVERTISEMENTS MANAGEMENT PANEL (REAL D1 ANALYTICS + ADS/UNITS/BANNERS)
// =========================================================================

interface AdminAdsPanelProps {
  lang: Language;
  advertisements: Advertisement[];
  managedAdUnits: ManagedAdUnitConfig[];
  banners: Banner[];
  rewardClaims: RewardedAdClaim[];
  adRewardTransactions: AdRewardTransaction[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminAdsPanel({
  lang,
  advertisements,
  managedAdUnits,
  banners,
  rewardClaims,
  adRewardTransactions,
  onSuccess,
  onError,
}: AdminAdsPanelProps) {
  const [subTab, setSubTab] = useState<'ads' | 'units' | 'banners' | 'claims'>('ads');
  const [analytics, setAnalytics] = useState<ServerAdAnalytics | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Ad Form State
  const [editingAdId, setEditingAdId] = useState('');
  const [adCode, setAdCode] = useState('');
  const [adTitleEn, setAdTitleEn] = useState('');
  const [adTitleBn, setAdTitleBn] = useState('');
  const [adDescEn, setAdDescEn] = useState('');
  const [adTargetUrl, setAdTargetUrl] = useState('');
  const [adMediaType, setAdMediaType] = useState<'image' | 'video' | 'external'>('image');
  const [adMediaUrl, setAdMediaUrl] = useState('');
  const [adPlacement, setAdPlacement] = useState<AdPlacement>('player');
  const [adDuration, setAdDuration] = useState('15');
  const [adReward, setAdReward] = useState('0');
  const [adPriority, setAdPriority] = useState('1');
  const [adEnabled, setAdEnabled] = useState(true);
  const [savingAd, setSavingAd] = useState(false);

  // Banner Form State
  const [banTitleEn, setBanTitleEn] = useState('');
  const [banTitleBn, setBanTitleBn] = useState('');
  const [banSlot, setBanSlot] = useState<BannerSlot>('home_top');
  const [banTargetUrl, setBanTargetUrl] = useState('');
  const [banImageUrl, setBanImageUrl] = useState('');
  const [savingBanner, setSavingBanner] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'ad' | 'banner'; id: string; label: string } | null>(null);
  const [busyDelete, setBusyDelete] = useState(false);

  const refreshAnalytics = async () => {
    setLoadingStats(true);
    try {
      const data = await fetchServerAdAnalytics();
      setAnalytics(data);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    void refreshAnalytics();
  }, []);

  const resetAdForm = () => {
    setEditingAdId('');
    setAdCode('');
    setAdTitleEn('');
    setAdTitleBn('');
    setAdDescEn('');
    setAdTargetUrl('');
    setAdMediaType('image');
    setAdMediaUrl('');
    setAdPlacement('player');
    setAdDuration('15');
    setAdReward('0');
    setAdPriority('1');
    setAdEnabled(true);
  };

  const startEditAd = (ad: Advertisement) => {
    setEditingAdId(ad.id);
    setAdCode(ad.code || '');
    setAdTitleEn(ad.titleEn || '');
    setAdTitleBn(ad.titleBn || '');
    setAdDescEn(ad.descriptionEn || '');
    setAdTargetUrl(ad.targetUrl || '');
    setAdMediaType(ad.mediaType || 'external');
    setAdMediaUrl(ad.mediaUrl || ad.thumbnailUrl || '');
    setAdPlacement(ad.placement || 'player');
    setAdDuration(String(ad.durationSeconds ?? 15));
    setAdReward(String(ad.rewardAmountBdt ?? 0));
    setAdPriority(String(ad.priority ?? 1));
    setAdEnabled(ad.enabled !== false);
  };

  const handleSaveAd = async (e: FormEvent) => {
    e.preventDefault();
    if (!adTitleEn.trim() || !adTargetUrl.trim()) {
      onError('Ad Title and Target URL are required.');
      return;
    }
    setSavingAd(true);
    try {
      const id = editingAdId || generateId('ad');
      await adminSaveAdvertisement(
        {
          id,
          code: adCode.trim() || `AD-${Date.now().toString().slice(-4)}`,
          titleEn: adTitleEn.trim(),
          titleBn: adTitleBn.trim() || adTitleEn.trim(),
          descriptionEn: adDescEn.trim(),
          descriptionBn: adDescEn.trim(),
          targetUrl: adTargetUrl.trim(),
          mediaType: adMediaType,
          mediaUrl: adMediaUrl.trim() || undefined,
          thumbnailUrl: adMediaType === 'image' ? adMediaUrl.trim() || undefined : undefined,
          durationSeconds: Math.max(0, Math.round(Number(adDuration) || 0)),
          rewardAmountBdt: Math.max(0, Number(adReward) || 0),
          placement: adPlacement,
          priority: Math.max(1, Math.round(Number(adPriority) || 1)),
          sortOrder: Math.max(1, Math.round(Number(adPriority) || 1)),
          enabled: adEnabled,
        },
        !editingAdId
      );
      onSuccess(editingAdId ? 'Advertisement updated.' : 'New advertisement created.');
      resetAdForm();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not save advertisement.');
    } finally {
      setSavingAd(false);
    }
  };

  const handleCreateBanner = async (e: FormEvent) => {
    e.preventDefault();
    if (!banTitleEn.trim() || !banTargetUrl.trim()) return;
    setSavingBanner(true);
    try {
      await adminSaveBanner(
        {
          id: generateId('ban'),
          titleEn: banTitleEn.trim(),
          titleBn: banTitleBn.trim() || banTitleEn.trim(),
          slot: banSlot,
          targetUrl: banTargetUrl.trim(),
          imageUrl: banImageUrl.trim() || undefined,
          sortOrder: banners.length + 1,
          priority: 1,
          enabled: true,
        },
        true
      );
      setBanTitleEn('');
      setBanTitleBn('');
      setBanTargetUrl('');
      setBanImageUrl('');
      onSuccess('Banner saved.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save banner.');
    } finally {
      setSavingBanner(false);
    }
  };

  const pendingRedemptions = adRewardTransactions.filter(
    (t) => t.type === 'coin_redemption' && t.status === 'Pending Credit'
  );
  const pendingClaims = rewardClaims.filter((c) => c.status === 'Pending Credit');

  return (
    <div className="space-y-5">
      {/* Real Persistent D1 Ad Analytics Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Ad Impressions', val: (analytics?.totalImpressions ?? 0).toLocaleString(), tone: 'text-[#172033] dark:text-slate-100' },
          { label: 'Verified Ad Clicks', val: (analytics?.totalClicks ?? 0).toLocaleString(), tone: 'text-[#FF8500]' },
          { label: 'Click-Through Rate (CTR)', val: `${analytics?.ctr ?? 0}%`, tone: 'text-emerald-600 dark:text-emerald-400' },
          { label: 'Blocked Fake Clicks', val: (analytics?.blockedFakeClicks ?? 0).toLocaleString(), tone: 'text-rose-600 dark:text-rose-400' },
        ].map((k) => (
          <div
            key={k.label}
            className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4"
          >
            <p className="text-[11px] font-semibold text-[#777777] dark:text-slate-400">{k.label}</p>
            <p className={`text-xl font-extrabold font-mono-num mt-1 ${k.tone}`}>{k.val}</p>
          </div>
        ))}
      </div>

      {/* Sub-tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ['ads', `Advertisements (${advertisements.length})`],
              ['units', `Ad Units (${managedAdUnits.length})`],
              ['banners', `Banners (${banners.length})`],
              ['claims', `Reward Claims (${pendingClaims.length + pendingRedemptions.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSubTab(id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold border ${
                subTab === id
                  ? 'bg-[#FF8500] text-white border-[#FF8500]'
                  : 'bg-white dark:bg-slate-900 border-[#E6ECFA] dark:border-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void refreshAnalytics()}
          className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 text-xs font-bold inline-flex items-center gap-1.5"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingStats ? 'animate-spin' : ''}`} />
          Refresh Stats
        </button>
      </div>

      {subTab === 'ads' && (
        <div className="space-y-5">
          <form
            onSubmit={handleSaveAd}
            className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-3 text-xs"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
                <Megaphone className="w-4 h-4 text-[#FF8500]" />
                {editingAdId ? 'Edit Advertisement' : 'Create Advertisement (Image / Video / Link)'}
              </h3>
              {editingAdId && (
                <button type="button" onClick={resetAdForm} className="text-xs font-bold text-[#777777] hover:underline">
                  Cancel Edit
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <input
                type="text"
                value={adCode}
                onChange={(e) => setAdCode(e.target.value)}
                placeholder="Code (e.g. AD08)"
                className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
              />
              <input
                type="text"
                required
                value={adTitleEn}
                onChange={(e) => setAdTitleEn(e.target.value)}
                placeholder="Ad Title (EN) *"
                className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
              <input
                type="text"
                value={adTitleBn}
                onChange={(e) => setAdTitleBn(e.target.value)}
                placeholder="Ad Title (BN)"
                className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
              <select
                value={adMediaType}
                onChange={(e) => setAdMediaType(e.target.value as 'image' | 'video' | 'external')}
                className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              >
                <option value="image">Image Banner / Card</option>
                <option value="video">Video Ad</option>
                <option value="external">External Direct Link</option>
              </select>
              <input
                type="url"
                required
                value={adTargetUrl}
                onChange={(e) => setAdTargetUrl(e.target.value)}
                placeholder="Target URL (https://...) *"
                className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 sm:col-span-2"
              />
              <input
                type="url"
                value={adMediaUrl}
                onChange={(e) => setAdMediaUrl(e.target.value)}
                placeholder="Image or Video URL (optional)"
                className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 sm:col-span-2"
              />
              <select
                value={adPlacement}
                onChange={(e) => setAdPlacement(e.target.value as AdPlacement)}
                className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              >
                <option value="player">Ad Player</option>
                <option value="ads_page">Ads Page</option>
                <option value="dashboard_promo">Dashboard Promo</option>
                <option value="between_sections">Between Sections</option>
                <option value="product_page">Product Page</option>
                <option value="all">All Placements</option>
              </select>
              <input
                type="number"
                min={0}
                value={adDuration}
                onChange={(e) => setAdDuration(e.target.value)}
                placeholder="Duration (sec)"
                className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
              />
              <input
                type="number"
                min={0}
                step="0.5"
                value={adReward}
                onChange={(e) => setAdReward(e.target.value)}
                placeholder="Reward (BDT)"
                className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
              />
              <input
                type="number"
                min={1}
                value={adPriority}
                onChange={(e) => setAdPriority(e.target.value)}
                placeholder="Priority"
                className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={adEnabled}
                  onChange={(e) => setAdEnabled(e.target.checked)}
                  className="accent-[#FF8500]"
                />
                <span>Visible & Active</span>
              </label>
              <button
                type="submit"
                disabled={savingAd}
                className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                {savingAd ? 'Saving...' : editingAdId ? 'Update Ad' : 'Create Ad'}
              </button>
            </div>
          </form>

          {/* Ads List with Real Per-Ad Impressions/Clicks/CTR */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {advertisements.map((ad) => {
              const stat = analytics?.byAd?.[ad.id];
              const imps = stat?.impressions || 0;
              const clicks = stat?.clicks || 0;
              const ctr = imps > 0 ? ((clicks / imps) * 100).toFixed(1) : '0.0';
              return (
                <div
                  key={ad.id}
                  className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex flex-col justify-between gap-3 text-xs"
                >
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-num font-extrabold text-[#FF8500]">{ad.code || ad.id}</span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          ad.enabled
                            ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                        }`}
                      >
                        {ad.enabled ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <p className="font-bold text-sm text-[#172033] dark:text-slate-100">
                      {lang === 'bn' ? ad.titleBn || ad.titleEn : ad.titleEn}
                    </p>
                    <p className="text-[11px] text-[#777777] dark:text-slate-400 truncate">{ad.targetUrl}</p>
                    <p className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400">
                      Type: {ad.mediaType} · Placement: {ad.placement} · Views: <strong>{imps}</strong> · Clicks:{' '}
                      <strong>{clicks}</strong> · CTR: <strong>{ctr}%</strong>
                    </p>
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E6ECFA] dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => startEditAd(ad)}
                      className="px-2.5 py-1 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 font-bold inline-flex items-center gap-1"
                    >
                      <Edit3 className="w-3 h-3 text-[#FF8500]" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await adminSaveAdvertisement({ ...ad, enabled: !ad.enabled }, false);
                          onSuccess(`Ad ${ad.code} ${!ad.enabled ? 'enabled' : 'disabled'}.`);
                        } catch (err) {
                          onError(err instanceof Error ? err.message : 'Toggle failed.');
                        }
                      }}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold"
                    >
                      {ad.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget({ kind: 'ad', id: ad.id, label: ad.titleEn || ad.code })}
                      className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-950/50 text-[#DC2626] font-bold inline-flex items-center gap-1"
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {subTab === 'units' && (
        <div className="space-y-3 text-xs">
          <div className="rounded-2xl bg-[#FFF7ED] dark:bg-orange-950/25 border border-[#FFDDB3] dark:border-orange-900/40 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="font-extrabold text-[#172033] dark:text-slate-100">
                Active Ad Units: {managedAdUnits.filter((u) => u.enabled).length} / {managedAdUnits.length}
              </p>
              <p className="text-[11px] text-[#555555] dark:text-slate-300 mt-0.5">
                All mobile and desktop banner frames auto-scale to viewport width. Optional third-party networks (AdSense, Adsterra, Monetag) can be configured in the Ad Networks tab once you have Publisher/Zone IDs.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {managedAdUnits.map((unit) => (
              <div
                key={unit.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-extrabold text-[#172033] dark:text-slate-100 truncate">
                    #{unit.unitNumber} · {unit.label}
                  </p>
                  <p className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400 break-words">
                    {unit.provider} · {unit.format} · {unit.showOnMobile ? 'Mobile' : ''}{unit.showOnMobile && unit.showOnDesktop ? '+' : ''}{unit.showOnDesktop ? 'Desktop' : ''} · {unit.placements.join(', ')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await adminSaveManagedAdUnit({
                        id: unit.id,
                        enabled: !unit.enabled,
                        placements: unit.placements,
                        showOnMobile: unit.showOnMobile,
                        showOnDesktop: unit.showOnDesktop,
                        priority: unit.priority,
                        rotationSeconds: unit.rotationSeconds,
                        supportsRewardedVerification: unit.supportsRewardedVerification,
                      });
                      onSuccess(`Ad unit ${unit.label} ${!unit.enabled ? 'enabled' : 'disabled'}.`);
                    } catch (err) {
                      onError(err instanceof Error ? err.message : 'Update failed.');
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl font-bold shrink-0 ${
                    unit.enabled
                      ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                  }`}
                >
                  {unit.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'banners' && (
        <div className="space-y-4 text-xs">
          <form
            onSubmit={handleCreateBanner}
            className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5"
          >
            <input
              type="text"
              required
              value={banTitleEn}
              onChange={(e) => setBanTitleEn(e.target.value)}
              placeholder="Banner Title (EN) *"
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
            <input
              type="text"
              value={banTitleBn}
              onChange={(e) => setBanTitleBn(e.target.value)}
              placeholder="Banner Title (BN)"
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
            <select
              value={banSlot}
              onChange={(e) => setBanSlot(e.target.value as BannerSlot)}
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            >
              <option value="home_top">Home Top</option>
              <option value="home_middle">Home Middle</option>
              <option value="home_bottom">Home Bottom</option>
              <option value="between_sections">Between Sections</option>
              <option value="dashboard_promo">Dashboard Promo</option>
            </select>
            <input
              type="url"
              required
              value={banTargetUrl}
              onChange={(e) => setBanTargetUrl(e.target.value)}
              placeholder="Target URL *"
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
            <button
              type="submit"
              disabled={savingBanner}
              className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold disabled:opacity-50"
            >
              {savingBanner ? 'Saving...' : '+ Add Banner'}
            </button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {banners.map((b) => (
              <div
                key={b.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex items-center justify-between gap-2"
              >
                <div className="min-w-0">
                  <p className="font-bold text-[#172033] dark:text-slate-100 truncate">{b.titleEn}</p>
                  <p className="text-[11px] font-mono-num text-[#777777] truncate">
                    Slot: {b.slot} · {b.targetUrl}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteTarget({ kind: 'banner', id: b.id, label: b.titleEn })}
                  className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-950/50 text-[#DC2626] font-bold shrink-0"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === 'claims' && (
        <div className="space-y-3 text-xs">
          {pendingClaims.length === 0 && pendingRedemptions.length === 0 ? (
            <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-8 text-center text-[#777777]">
              No pending rewarded ad claims or Watch & Earn coin redemptions.
            </div>
          ) : (
            <>
              {pendingClaims.map((c) => (
                <div
                  key={c.id}
                  className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-bold text-[#172033] dark:text-slate-100">
                      {c.networkName} · ৳{c.amountBdt}
                    </p>
                    <p className="font-mono-num text-[11px] text-[#777777]">
                      User: {c.userEmail || c.userId} · {c.claimDate}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await adminSettleRewardClaimServer({ claimId: c.id, decision: 'credit' });
                          onSuccess('Reward claim credited.');
                        } catch (err) {
                          onError(err instanceof Error ? err.message : 'Failed.');
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold"
                    >
                      Credit
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await adminSettleRewardClaimServer({
                            claimId: c.id,
                            decision: 'reject',
                            rejectionReason: 'Rejected by admin',
                          });
                          onSuccess('Reward claim rejected.');
                        } catch (err) {
                          onError(err instanceof Error ? err.message : 'Failed.');
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-red-50 text-[#DC2626] font-bold"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
              {pendingRedemptions.map((tx) => (
                <div
                  key={tx.id}
                  className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex items-center justify-between gap-3"
                >
                  <div>
                    <p className="font-bold text-[#172033] dark:text-slate-100">
                      Watch & Earn Redemption: {tx.coins} coins → ৳{tx.bdtEquivalent}
                    </p>
                    <p className="font-mono-num text-[11px] text-[#777777]">
                      User: {tx.userEmail || tx.userId}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await adminSettleCoinRedemptionServer({ txId: tx.id, decision: 'credit' });
                          onSuccess('Coin redemption credited.');
                        } catch (err) {
                          onError(err instanceof Error ? err.message : 'Failed.');
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold"
                    >
                      Credit
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await adminSettleCoinRedemptionServer({
                            txId: tx.id,
                            decision: 'reject',
                            reason: 'Rejected by admin',
                          });
                          onSuccess('Coin redemption rejected.');
                        } catch (err) {
                          onError(err instanceof Error ? err.message : 'Failed.');
                        }
                      }}
                      className="px-3 py-1.5 rounded-lg bg-red-50 text-[#DC2626] font-bold"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        lang={lang}
        title={deleteTarget?.kind === 'ad' ? 'Delete Advertisement?' : 'Delete Banner?'}
        description={`Remove "${deleteTarget?.label || ''}" permanently from the storefront?`}
        tone="danger"
        confirmLabel="Delete"
        busy={busyDelete}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setBusyDelete(true);
          try {
            if (deleteTarget.kind === 'ad') {
              await adminDeleteAdvertisement(deleteTarget.id);
            } else {
              await adminDeleteBanner(deleteTarget.id);
            }
            onSuccess(`Deleted "${deleteTarget.label}".`);
            setDeleteTarget(null);
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Delete failed.');
          } finally {
            setBusyDelete(false);
          }
        }}
      />
    </div>
  );
}

// =========================================================================
// 3. PAYMENT METHODS MANAGEMENT PANEL (bKash, Nagad, Rocket, Bank, Custom)
// =========================================================================

interface AdminPaymentMethodsPanelProps {
  lang: Language;
  paymentMethods: PaymentMethodConfig[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminPaymentMethodsPanel({
  lang,
  paymentMethods: initialMethods,
  onSuccess,
  onError,
}: AdminPaymentMethodsPanelProps) {
  const [methods, setMethods] = useState<PaymentMethodConfig[]>(initialMethods);
  const [editingId, setEditingId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'mobile_banking' | 'bank_transfer' | 'custom'>('mobile_banking');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [minAmount, setMinAmount] = useState('50');
  const [maxAmount, setMaxAmount] = useState('50000');
  const [instructionsEn, setInstructionsEn] = useState('');
  const [instructionsBn, setInstructionsBn] = useState('');
  const [requirementsEn, setRequirementsEn] = useState('');
  const [requirementsBn, setRequirementsBn] = useState('');
  const [supportsDeposit, setSupportsDeposit] = useState(true);
  const [supportsWithdrawal, setSupportsWithdrawal] = useState(true);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<PaymentMethodConfig | null>(null);
  const [deleting, setDeleting] = useState(false);

  const reload = async () => {
    try {
      const list = await adminFetchPaymentMethods();
      setMethods(list);
    } catch {
      // Keep current list
    }
  };

  useEffect(() => {
    if (initialMethods.length > 0) setMethods(initialMethods);
    void reload();
  }, [initialMethods]);

  const resetForm = () => {
    setEditingId('');
    setCode('');
    setName('');
    setType('mobile_banking');
    setAccountNumber('');
    setAccountName('');
    setMinAmount('50');
    setMaxAmount('50000');
    setInstructionsEn('');
    setInstructionsBn('');
    setRequirementsEn('');
    setRequirementsBn('');
    setSupportsDeposit(true);
    setSupportsWithdrawal(true);
    setEnabled(true);
  };

  const loadForEdit = (pm: PaymentMethodConfig) => {
    setEditingId(pm.id);
    setCode(pm.code);
    setName(pm.name);
    setType(pm.type);
    setAccountNumber(pm.accountNumber || '');
    setAccountName(pm.accountName || '');
    setMinAmount(String(pm.minAmount ?? 50));
    setMaxAmount(String(pm.maxAmount ?? 50000));
    setInstructionsEn(pm.instructionsEn || '');
    setInstructionsBn(pm.instructionsBn || '');
    setRequirementsEn(pm.requirementsEn || '');
    setRequirementsBn(pm.requirementsBn || '');
    setSupportsDeposit(pm.supportsDeposit);
    setSupportsWithdrawal(pm.supportsWithdrawal);
    setEnabled(pm.enabled);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      onError('Payment method name is required.');
      return;
    }
    setSaving(true);
    try {
      await adminSavePaymentMethod({
        ...(editingId ? { id: editingId } : {}),
        code: code.trim() || undefined,
        name: name.trim(),
        type,
        accountNumber: accountNumber.trim(),
        accountName: accountName.trim(),
        minAmount: Math.max(1, Math.round(Number(minAmount) || 50)),
        maxAmount: Math.max(10, Math.round(Number(maxAmount) || 50000)),
        instructionsEn: instructionsEn.trim(),
        instructionsBn: instructionsBn.trim() || instructionsEn.trim(),
        requirementsEn: requirementsEn.trim(),
        requirementsBn: requirementsBn.trim() || requirementsEn.trim(),
        supportsDeposit,
        supportsWithdrawal,
        enabled,
      });
      onSuccess(editingId ? `Updated payment method "${name.trim()}".` : `Created payment method "${name.trim()}".`);
      resetForm();
      await reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save payment method.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Add / Edit Form */}
      <form
        onSubmit={handleSave}
        className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-3 text-xs"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
            <CreditCard className="w-4 h-4 text-[#FF8500]" />
            {editingId ? `Edit Payment Method (${name})` : 'Add Payment Method (bKash / Nagad / Rocket / Bank / Custom)'}
          </h3>
          {editingId && (
            <button type="button" onClick={resetForm} className="text-xs font-bold text-[#777777] hover:underline">
              Cancel Edit
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Method Name (e.g., Upay, Dutch-Bangla Bank) *"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          />
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Code (e.g., upay, dbbl)"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
          />
          <select
            value={type}
            onChange={(e) => setType(e.target.value as 'mobile_banking' | 'bank_transfer' | 'custom')}
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          >
            <option value="mobile_banking">Mobile Banking</option>
            <option value="bank_transfer">Bank Transfer</option>
            <option value="custom">Custom Method</option>
          </select>
          <input
            type="text"
            value={accountNumber}
            onChange={(e) => setAccountNumber(e.target.value)}
            placeholder="Receiver Account Number"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
          />
          <input
            type="text"
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="Account Type / Holder (Personal / Bank Name)"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          />
          <input
            type="number"
            min={1}
            value={minAmount}
            onChange={(e) => setMinAmount(e.target.value)}
            placeholder="Min Amount (BDT)"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
          />
          <input
            type="number"
            min={10}
            value={maxAmount}
            onChange={(e) => setMaxAmount(e.target.value)}
            placeholder="Max Amount (BDT)"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
          />
          <input
            type="text"
            value={requirementsEn}
            onChange={(e) => setRequirementsEn(e.target.value)}
            placeholder="Withdrawal Requirement (e.g. 11-digit personal #)"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          />
          <input
            type="text"
            value={instructionsEn}
            onChange={(e) => setInstructionsEn(e.target.value)}
            placeholder="Instructions (EN)"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 sm:col-span-2"
          />
          <input
            type="text"
            value={instructionsBn}
            onChange={(e) => setInstructionsBn(e.target.value)}
            placeholder="Instructions (BN)"
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 sm:col-span-2"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-1.5 font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={supportsDeposit}
                onChange={(e) => setSupportsDeposit(e.target.checked)}
                className="accent-[#FF8500]"
              />
              <span>Supports Deposit</span>
            </label>
            <label className="inline-flex items-center gap-1.5 font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={supportsWithdrawal}
                onChange={(e) => setSupportsWithdrawal(e.target.checked)}
                className="accent-[#FF8500]"
              />
              <span>Supports Withdrawal</span>
            </label>
            <label className="inline-flex items-center gap-1.5 font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="accent-[#FF8500]"
              />
              <span>Enabled</span>
            </label>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {saving ? 'Saving...' : editingId ? 'Update Method' : 'Save Payment Method'}
          </button>
        </div>
      </form>

      {/* Methods Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {methods.map((pm) => (
          <div
            key={pm.id}
            className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex flex-col justify-between gap-3"
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-extrabold text-[#172033] dark:text-slate-100">{pm.name}</span>
                  <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono-num text-[10px] font-bold">
                    {pm.code}
                  </span>
                </div>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                    pm.enabled
                      ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                      : 'bg-red-100 dark:bg-red-950/50 text-[#DC2626]'
                  }`}
                >
                  {pm.enabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <p className="font-mono-num text-[11px] text-[#777777] dark:text-slate-400">
                Account: <strong className="text-[#172033] dark:text-slate-200">{pm.accountNumber || 'User-provided'}</strong>
                {pm.accountName ? ` (${pm.accountName})` : ''}
              </p>
              <p className="font-mono-num text-[11px] text-[#777777] dark:text-slate-400">
                Limits: ৳{pm.minAmount} – ৳{pm.maxAmount.toLocaleString()} · Deposit:{' '}
                {pm.supportsDeposit ? 'Yes' : 'No'} · Withdrawal: {pm.supportsWithdrawal ? 'Yes' : 'No'}
              </p>
              {pm.instructionsEn && (
                <p className="text-[11px] text-[#777777] dark:text-slate-400">{pm.instructionsEn}</p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E6ECFA] dark:border-slate-800">
              <button
                type="button"
                onClick={() => loadForEdit(pm)}
                className="px-2.5 py-1 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 font-bold inline-flex items-center gap-1"
              >
                <Edit3 className="w-3 h-3 text-[#FF8500]" />
                Edit
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await adminSavePaymentMethod({ ...pm, enabled: !pm.enabled });
                    onSuccess(`${pm.name} ${!pm.enabled ? 'enabled' : 'disabled'}.`);
                    await reload();
                  } catch (err) {
                    onError(err instanceof Error ? err.message : 'Toggle failed.');
                  }
                }}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold inline-flex items-center gap-1"
              >
                {pm.enabled ? <XCircle className="w-3 h-3 text-amber-600" /> : <CheckCircle2 className="w-3 h-3 text-emerald-600" />}
                {pm.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                type="button"
                onClick={() => setDeleteTarget(pm)}
                className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-950/50 text-[#DC2626] font-bold inline-flex items-center gap-1"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        lang={lang}
        title="Delete Payment Method?"
        description={`Remove "${deleteTarget?.name || ''}" (${deleteTarget?.code || ''})? Existing historical transactions remain preserved.`}
        tone="danger"
        confirmLabel="Delete Method"
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleting(true);
          try {
            await adminDeletePaymentMethod(deleteTarget.id);
            onSuccess(`Deleted payment method "${deleteTarget.name}".`);
            setDeleteTarget(null);
            await reload();
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Delete failed.');
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
