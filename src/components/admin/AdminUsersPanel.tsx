import { FormEvent, useMemo, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Copy,
  Eye,
  KeyRound,
  RefreshCw,
  Save,
  Search,
  Shield,
  ShieldCheck,
  Wallet,
  X,
} from 'lucide-react';
import {
  AdminUserDetailPayload,
  Language,
  UserProfile,
  WalletAccount,
} from '../../types/marketplace';
import {
  adminAdjustWalletBalance,
  adminFetchUserDetail,
  adminRevokeSession,
  adminUpdateUserProfile,
  adminUpdateUserStatusServer,
  formatDateShort,
} from '../../lib/firestoreService';
import { ConfirmDialog } from './ConfirmDialog';

interface AdminUsersPanelProps {
  lang: Language;
  users: UserProfile[];
  wallets: WalletAccount[];
  superAdminEmail?: string;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminUsersPanel({
  lang,
  users,
  wallets,
  superAdminEmail,
  onSuccess,
  onError,
}: AdminUsersPanelProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | 'user' | 'admin' | 'super_admin'>('all');
  const [copiedId, setCopiedId] = useState('');

  // User detail modal state
  const [selectedUid, setSelectedUid] = useState('');
  const [detail, setDetail] = useState<AdminUserDetailPayload | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<'overview' | 'transactions' | 'withdrawals' | 'referrals' | 'sessions'>('overview');

  // Edit profile form state
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editLang, setEditLang] = useState<'bn' | 'en'>('bn');
  const [editNotes, setEditNotes] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  // Quick wallet adjust form inside drawer
  const [adjMode, setAdjMode] = useState<'add' | 'deduct' | 'set'>('add');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjBusy, setAdjBusy] = useState(false);

  // Confirm modal state
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    tone: 'danger' | 'warning' | 'primary';
    requireReason?: boolean;
    confirmLabel?: string;
    onRun: (reason: string) => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const walletByUid = useMemo(() => {
    const map = new Map<string, WalletAccount>();
    wallets.forEach((w) => map.set(w.uid, w));
    return map;
  }, [wallets]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter !== 'all' && u.status !== statusFilter) return false;
      const effectiveRole = u.role || 'user';
      if (roleFilter !== 'all' && effectiveRole !== roleFilter) return false;
      if (!q) return true;
      return (
        u.uid.toLowerCase().includes(q) ||
        (u.displayName || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.phone || '').toLowerCase().includes(q) ||
        (u.referralCode || '').toLowerCase().includes(q)
      );
    });
  }, [users, search, statusFilter, roleFilter]);

  const loadUserDetail = async (uid: string) => {
    setSelectedUid(uid);
    setDetailLoading(true);
    setDetailTab('overview');
    try {
      const data = await adminFetchUserDetail(uid);
      setDetail(data);
      setEditName(data.profile.displayName || '');
      setEditPhone(data.profile.phone || '');
      setEditLang(data.profile.language === 'en' ? 'en' : 'bn');
      setEditNotes(data.profile.adminNotes || '');
      setAdjAmount('');
      setAdjReason('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load user details.');
      setSelectedUid('');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleCopyUid = (uid: string) => {
    navigator.clipboard.writeText(uid).catch(() => {});
    setCopiedId(uid);
    setTimeout(() => setCopiedId(''), 1400);
  };

  const requestStatusToggle = (u: UserProfile) => {
    if (u.role === 'super_admin') {
      onError(
        lang === 'bn'
          ? 'পার্মানেন্ট সুপার অ্যাডমিন অ্যাকাউন্ট সাসপেন্ড বা ব্লক করা যাবে না।'
          : 'Permanent Super Admin account is protected and cannot be suspended or blocked.'
      );
      return;
    }
    const nextStatus = u.status === 'suspended' ? 'active' : 'suspended';
    setConfirmState({
      open: true,
      title:
        nextStatus === 'suspended'
          ? lang === 'bn'
            ? 'ইউজার সাসপেন্ড / ব্লক করবেন?'
            : 'Suspend / Block User Account?'
          : lang === 'bn'
            ? 'ইউজার পুনরায় সক্রিয় করবেন?'
            : 'Reactivate User Account?',
      description:
        nextStatus === 'suspended'
          ? lang === 'bn'
            ? `${u.displayName || u.uid} সাসপেন্ড হলে তার সব সেশন বন্ধ হয়ে যাবে এবং নতুন অর্ডার/উইথড্র বন্ধ থাকবে।`
            : `Suspending ${u.displayName || u.uid} revokes active sessions and blocks withdrawals & orders.`
          : lang === 'bn'
            ? `${u.displayName || u.uid} আবার স্বাভাবিকভাবে লগইন ও ওয়ালেট ব্যবহার করতে পারবেন।`
            : `Reactivating ${u.displayName || u.uid} restores full login and wallet access.`,
      tone: nextStatus === 'suspended' ? 'danger' : 'primary',
      requireReason: nextStatus === 'suspended',
      confirmLabel:
        nextStatus === 'suspended'
          ? lang === 'bn'
            ? 'সাসপেন্ড করুন'
            : 'Suspend User'
          : lang === 'bn'
            ? 'সক্রিয় করুন'
            : 'Activate User',
      onRun: async (reason) => {
        await adminUpdateUserStatusServer(u.uid, nextStatus, reason || undefined);
        onSuccess(
          nextStatus === 'suspended'
            ? `User ${u.displayName || u.uid} suspended.`
            : `User ${u.displayName || u.uid} reactivated.`
        );
        if (selectedUid === u.uid) {
          await loadUserDetail(u.uid);
        }
      },
    });
  };

  const handleSaveProfile = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    setSavingProfile(true);
    try {
      await adminUpdateUserProfile(detail.profile.uid, {
        displayName: editName.trim(),
        phone: editPhone.trim(),
        language: editLang,
        adminNotes: editNotes.trim(),
      });
      onSuccess(lang === 'bn' ? 'ইউজার প্রোফাইল ও অ্যাডমিন নোট সংরক্ষিত হয়েছে।' : 'User profile & admin notes saved.');
      await loadUserDetail(detail.profile.uid);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save user details.');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAdjustBalanceSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!detail) return;
    const numericAmount = Math.round(Number(adjAmount) || 0);
    if (numericAmount < 0 || (adjMode !== 'set' && numericAmount <= 0)) {
      onError(lang === 'bn' ? 'সঠিক টাকার পরিমাণ লিখুন।' : 'Enter a valid BDT amount.');
      return;
    }
    if (adjReason.trim().length < 3) {
      onError(
        lang === 'bn'
          ? 'ব্যালেন্স পরিবর্তনের জন্য কমপক্ষে ৩ অক্ষরের স্পষ্ট কারণ লিখুন।'
          : 'A clear audit reason (minimum 3 characters) is mandatory.'
      );
      return;
    }

    const executeAdjust = async () => {
      setAdjBusy(true);
      try {
        const res = await adminAdjustWalletBalance({
          targetUid: detail.profile.uid,
          mode: adjMode,
          amountBdt: numericAmount,
          reason: adjReason.trim(),
        });
        onSuccess(
          `Wallet updated: ৳${res.previousBalance} → ৳${res.nextBalance} (TX: ${res.transactionId})`
        );
        setAdjAmount('');
        setAdjReason('');
        await loadUserDetail(detail.profile.uid);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Balance adjustment failed.');
      } finally {
        setAdjBusy(false);
      }
    };

    if (adjMode === 'deduct' || adjMode === 'set') {
      const current = detail.wallet.availableBalanceBdt || 0;
      const preview = adjMode === 'deduct' ? Math.max(0, current - numericAmount) : numericAmount;
      setConfirmState({
        open: true,
        title: lang === 'bn' ? 'ব্যালেন্স পরিবর্তন নিশ্চিত করুন' : 'Confirm Wallet Balance Change',
        description: `${detail.profile.displayName || detail.profile.uid}: ৳${current} → ৳${preview}. Reason: "${adjReason.trim()}"`,
        tone: adjMode === 'deduct' ? 'danger' : 'warning',
        confirmLabel: lang === 'bn' ? 'পরিবর্তন করুন' : 'Apply Adjustment',
        onRun: async () => {
          await executeAdjust();
        },
      });
    } else {
      await executeAdjust();
    }
  };

  const previewNextBalance = () => {
    if (!detail) return 0;
    const cur = detail.wallet.availableBalanceBdt || 0;
    const amt = Math.max(0, Math.round(Number(adjAmount) || 0));
    if (adjMode === 'add') return cur + amt;
    if (adjMode === 'deduct') return Math.max(0, cur - amt);
    return amt;
  };

  return (
    <div className="space-y-5">
      {/* Header & Search Controls */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              lang === 'bn'
                ? 'নাম, ইমেইল, ফোন বা ইউজার আইডি দিয়ে খুঁজুন...'
                : 'Search by name, email, phone, or Unique User ID...'
            }
            className="w-full pl-10 pr-3.5 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'suspended')}
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-semibold text-[#172033] dark:text-slate-200"
          >
            <option value="all">{lang === 'bn' ? 'সব স্ট্যাটাস' : 'All Statuses'}</option>
            <option value="active">{lang === 'bn' ? 'সক্রিয়' : 'Active'}</option>
            <option value="suspended">{lang === 'bn' ? 'সাসপেন্ডেড' : 'Suspended'}</option>
          </select>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | 'user' | 'admin' | 'super_admin')}
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-semibold text-[#172033] dark:text-slate-200"
          >
            <option value="all">{lang === 'bn' ? 'সব রোল' : 'All Roles'}</option>
            <option value="user">User</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super Admin</option>
          </select>

          <span className="text-xs font-mono-num font-bold text-[#777777] dark:text-slate-400 px-2">
            {filteredUsers.length} / {users.length}
          </span>
        </div>
      </div>

      {/* Super Admin Protection Banner */}
      {superAdminEmail && (
        <div className="rounded-2xl bg-slate-900 dark:bg-slate-800/80 text-white px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#FF8500] shrink-0" />
            <span>
              {lang === 'bn' ? 'পার্মানেন্ট সুপার অ্যাডমিন সুরক্ষিত:' : 'Permanent Super Admin protected server-side:'}{' '}
              <strong className="font-mono-num text-[#FF9B19]">{superAdminEmail}</strong>
            </span>
          </div>
          <span className="text-[11px] text-slate-300">
            {lang === 'bn' ? 'সাসপেন্ড, ব্লক বা ডিমোট করা অসম্ভব' : 'Immune to suspend, block, or demotion'}
          </span>
        </div>
      )}

      {/* Users Table */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E6ECFA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-800/60 text-[#777777] dark:text-slate-400 uppercase text-[10px] tracking-wider">
                <th className="py-3 px-4 font-bold">{lang === 'bn' ? 'ইউজার' : 'User'}</th>
                <th className="py-3 px-4 font-bold">{lang === 'bn' ? 'ইউজার আইডি' : 'Unique ID'}</th>
                <th className="py-3 px-4 font-bold">{lang === 'bn' ? 'ব্যালেন্স' : 'Balance'}</th>
                <th className="py-3 px-4 font-bold">{lang === 'bn' ? 'রোল / স্ট্যাটাস' : 'Role / Status'}</th>
                <th className="py-3 px-4 font-bold">{lang === 'bn' ? 'যোগদান' : 'Joined'}</th>
                <th className="py-3 px-4 font-bold text-right">{lang === 'bn' ? 'অ্যাকশন' : 'Actions'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-[#777777] dark:text-slate-400">
                    {lang === 'bn' ? 'কোনো ইউজার পাওয়া যায়নি।' : 'No matching users found.'}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const w = walletByUid.get(u.uid);
                  const isSuper = u.role === 'super_admin';
                  return (
                    <tr
                      key={u.uid}
                      className="hover:bg-[#F8FAFF] dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <p className="font-bold text-[#172033] dark:text-slate-100">
                          {u.displayName || 'Unnamed User'}
                        </p>
                        <p className="text-[11px] text-[#777777] dark:text-slate-400 font-mono-num">
                          {[u.email, u.phone].filter(Boolean).join(' · ')}
                        </p>
                      </td>
                      <td className="py-3 px-4">
                        <button
                          type="button"
                          onClick={() => handleCopyUid(u.uid)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-mono-num font-semibold text-[#172033] dark:text-slate-200 hover:text-[#FF8500]"
                        >
                          <span>{u.uid}</span>
                          <Copy className="w-3 h-3" />
                          {copiedId === u.uid && <span className="text-emerald-600 text-[10px]">✓</span>}
                        </button>
                      </td>
                      <td className="py-3 px-4 font-mono-num font-extrabold text-[#172033] dark:text-slate-100">
                        ৳{(w?.availableBalanceBdt || 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase ${
                              isSuper
                                ? 'bg-[#172033] dark:bg-[#FF8500] text-white'
                                : u.role === 'admin'
                                  ? 'bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300'
                                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                            }`}
                          >
                            {isSuper ? 'Super Admin' : u.role || 'User'}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              u.status === 'suspended'
                                ? 'bg-red-100 dark:bg-red-950/50 text-[#DC2626]'
                                : 'bg-emerald-100 dark:bg-emerald-950/40 text-[#16A34A]'
                            }`}
                          >
                            {u.status}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[#777777] dark:text-slate-400">
                        {formatDateShort(u.createdAt, lang)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => void loadUserDetail(u.uid)}
                            className="px-2.5 py-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200 font-bold inline-flex items-center gap-1 hover:border-[#FF8500]"
                          >
                            <Eye className="w-3.5 h-3.5 text-[#FF8500]" />
                            {lang === 'bn' ? 'প্রোফাইল' : 'Inspect'}
                          </button>
                          {isSuper ? (
                            <span
                              title="Permanent Super Admin cannot be suspended"
                              className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-400 font-bold inline-flex items-center gap-1 cursor-not-allowed"
                            >
                              <Shield className="w-3.5 h-3.5" />
                              {lang === 'bn' ? 'সুরক্ষিত' : 'Protected'}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => requestStatusToggle(u)}
                              className={`px-2.5 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 ${
                                u.status === 'suspended'
                                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-[#16A34A] hover:bg-emerald-100'
                                  : 'bg-red-50 dark:bg-red-950/40 text-[#DC2626] hover:bg-red-100'
                              }`}
                            >
                              {u.status === 'suspended' ? (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  {lang === 'bn' ? 'সক্রিয়' : 'Activate'}
                                </>
                              ) : (
                                <>
                                  <Ban className="w-3.5 h-3.5" />
                                  {lang === 'bn' ? 'সাসপেন্ড' : 'Suspend'}
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Full User Profile Detail Modal / Drawer */}
      {selectedUid && (
        <div className="fixed inset-0 z-[80] flex justify-end bg-slate-950/60 backdrop-blur-xs">
          <div className="w-full max-w-3xl bg-white dark:bg-slate-900 h-full overflow-y-auto border-l border-[#E6ECFA] dark:border-slate-800 shadow-2xl flex flex-col">
            <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 border-b border-[#E6ECFA] dark:border-slate-800 px-5 py-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-extrabold text-[#172033] dark:text-slate-100 truncate">
                  {detail?.profile.displayName || selectedUid}
                </h3>
                <p className="text-xs font-mono-num text-[#777777] dark:text-slate-400 truncate">
                  ID: {selectedUid} {detail?.profile.email ? `· ${detail.profile.email}` : ''}{' '}
                  {detail?.profile.phone ? `· ${detail.profile.phone}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => void loadUserDetail(selectedUid)}
                  className="p-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 text-[#172033] dark:text-slate-200 hover:text-[#FF8500]"
                  title="Refresh"
                >
                  <RefreshCw className={`w-4 h-4 ${detailLoading ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedUid('');
                    setDetail(null);
                  }}
                  className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {detailLoading || !detail ? (
              <div className="p-10 text-center text-xs text-[#777777] dark:text-slate-400">
                {lang === 'bn' ? 'ইউজারের তথ্য লোড হচ্ছে...' : 'Loading complete user record...'}
              </div>
            ) : (
              <div className="p-5 space-y-5">
                {/* Summary KPI Strip */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: 'Available Balance', val: `৳${detail.wallet.availableBalanceBdt.toLocaleString()}`, tone: 'text-[#FF8500]' },
                    { label: 'Total Earnings', val: `৳${detail.summary.totalEarningsBdt.toLocaleString()}`, tone: 'text-emerald-600 dark:text-emerald-400' },
                    { label: 'Total Withdrawn', val: `৳${detail.summary.totalWithdrawnBdt.toLocaleString()}`, tone: 'text-[#172033] dark:text-slate-100' },
                    { label: 'Pending Withdrawal', val: `৳${detail.summary.pendingWithdrawalBdt.toLocaleString()}`, tone: 'text-amber-600 dark:text-amber-400' },
                    { label: 'Referral Earnings', val: `৳${detail.summary.referralEarningsBdt.toLocaleString()}`, tone: 'text-[#FF8500]' },
                    {
                      label: 'Orders / Referrals',
                      val: `${detail.summary.orderCount} / ${detail.summary.referralCount}`,
                      tone: 'text-[#172033] dark:text-slate-100',
                    },
                  ].map((item) => (
                    <div
                      key={item.label}
                      className="p-3 rounded-xl bg-[#F8FAFF] dark:bg-slate-800/70 border border-[#E6ECFA] dark:border-slate-700"
                    >
                      <p className="text-[10px] font-semibold text-[#777777] dark:text-slate-400 uppercase">
                        {item.label}
                      </p>
                      <p className={`text-lg font-extrabold font-mono-num mt-0.5 ${item.tone}`}>{item.val}</p>
                    </div>
                  ))}
                </div>

                {/* Drawer Tabs */}
                <div className="flex flex-wrap gap-1.5 border-b border-[#E6ECFA] dark:border-slate-800 pb-3">
                  {(
                    [
                      ['overview', lang === 'bn' ? 'তথ্য ও ব্যালেন্স' : 'Profile & Balance'],
                      ['transactions', `${lang === 'bn' ? 'লেনদেন' : 'Transactions'} (${detail.walletTxs.length})`],
                      ['withdrawals', `${lang === 'bn' ? 'উইথড্রয়াল' : 'Withdrawals'} (${detail.withdrawals.length})`],
                      ['referrals', `${lang === 'bn' ? 'রেফারেল' : 'Referrals'} (${detail.referrals.length})`],
                      ['sessions', `${lang === 'bn' ? 'সেশন' : 'Sessions'} (${detail.sessions.length})`],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDetailTab(id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                        detailTab === id
                          ? 'bg-[#FF8500] text-white'
                          : 'bg-[#F3F6FF] dark:bg-slate-800 text-[#172033] dark:text-slate-200'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {detailTab === 'overview' && (
                  <div className="space-y-5">
                    {/* Metadata */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs p-4 rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/60 border border-[#E6ECFA] dark:border-slate-700">
                      <div>
                        <span className="text-[#777777] dark:text-slate-400">Joined: </span>
                        <strong className="text-[#172033] dark:text-slate-100">
                          {formatDateShort(detail.profile.createdAt, lang)}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[#777777] dark:text-slate-400">Last Login: </span>
                        <strong className="font-mono-num text-[#172033] dark:text-slate-100">
                          {detail.profile.lastLoginAt ? formatDateShort(detail.profile.lastLoginAt, lang) : 'N/A'}
                          {detail.profile.lastLoginIp ? ` (${detail.profile.lastLoginIp})` : ''}
                        </strong>
                      </div>
                      <div>
                        <span className="text-[#777777] dark:text-slate-400">Referral Code: </span>
                        <strong className="font-mono-num text-[#FF8500]">{detail.profile.referralCode}</strong>
                      </div>
                      <div>
                        <span className="text-[#777777] dark:text-slate-400">Auth Method: </span>
                        <strong className="uppercase text-[#172033] dark:text-slate-100">
                          {detail.profile.authMethod || 'phone'}
                        </strong>
                      </div>
                    </div>

                    {/* Edit Permitted User Info & Admin Notes */}
                    <form
                      onSubmit={handleSaveProfile}
                      className="p-4 rounded-2xl border border-[#E6ECFA] dark:border-slate-800 space-y-3"
                    >
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#172033] dark:text-slate-200">
                        {lang === 'bn' ? 'প্রোফাইল এডিট ও অ্যাডমিন নোট' : 'Edit Permitted Info & Admin Notes'}
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[11px] font-bold text-[#777777] dark:text-slate-400 mb-1">
                            Display Name
                          </label>
                          <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs text-[#172033] dark:text-slate-100"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-bold text-[#777777] dark:text-slate-400 mb-1">
                            Phone Number
                          </label>
                          <input
                            type="text"
                            value={editPhone}
                            onChange={(e) => setEditPhone(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-mono-num text-[#172033] dark:text-slate-100"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-[#777777] dark:text-slate-400 mb-1">
                          Internal Admin Notes (Private)
                        </label>
                        <textarea
                          rows={2}
                          value={editNotes}
                          onChange={(e) => setEditNotes(e.target.value)}
                          placeholder="Internal verification notes, risk remarks, or support context..."
                          className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs text-[#172033] dark:text-slate-100"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <select
                          value={editLang}
                          onChange={(e) => setEditLang(e.target.value as 'bn' | 'en')}
                          className="px-3 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs"
                        >
                          <option value="bn">Language: বাংলা (bn)</option>
                          <option value="en">Language: English (en)</option>
                        </select>
                        <button
                          type="submit"
                          disabled={savingProfile}
                          className="px-4 py-2 rounded-xl bg-[#172033] dark:bg-[#FF8500] text-white text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                        >
                          <Save className="w-3.5 h-3.5" />
                          {savingProfile ? 'Saving...' : lang === 'bn' ? 'সংরক্ষণ করুন' : 'Save Changes'}
                        </button>
                      </div>
                    </form>

                    {/* Quick Wallet Balance Adjuster */}
                    <form
                      onSubmit={handleAdjustBalanceSubmit}
                      className="p-4 rounded-2xl border border-[#E6ECFA] dark:border-slate-800 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#172033] dark:text-slate-200 flex items-center gap-1.5">
                          <Wallet className="w-4 h-4 text-[#FF8500]" />
                          {lang === 'bn' ? 'ব্যালেন্স অ্যাড / ডিডাক্ট / সেট করুন' : 'Adjust Wallet Balance'}
                        </h4>
                        <span className="text-xs font-mono-num font-bold text-[#FF8500]">
                          ৳{detail.wallet.availableBalanceBdt} → ৳{previewNextBalance()}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <select
                          value={adjMode}
                          onChange={(e) => setAdjMode(e.target.value as 'add' | 'deduct' | 'set')}
                          className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-bold"
                        >
                          <option value="add">+ Add Balance</option>
                          <option value="deduct">- Deduct Balance</option>
                          <option value="set">= Set Exact Balance</option>
                        </select>
                        <input
                          type="number"
                          min={0}
                          value={adjAmount}
                          onChange={(e) => setAdjAmount(e.target.value)}
                          placeholder="Amount (BDT)"
                          className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-mono-num"
                        />
                        <input
                          type="text"
                          value={adjReason}
                          onChange={(e) => setAdjReason(e.target.value)}
                          placeholder="Mandatory reason (min 3 chars)"
                          className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs"
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={adjBusy}
                          className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold disabled:opacity-50"
                        >
                          {adjBusy ? 'Updating...' : 'Apply Audited Balance Change'}
                        </button>
                      </div>
                    </form>
                  </div>
                )}

                {detailTab === 'transactions' && (
                  <div className="space-y-2">
                    {detail.walletTxs.length === 0 ? (
                      <p className="text-xs text-[#777777] py-6 text-center">No wallet transactions.</p>
                    ) : (
                      detail.walletTxs.map((tx) => (
                        <div
                          key={tx.id}
                          className="p-3 rounded-xl bg-[#F8FAFF] dark:bg-slate-800/60 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-[#172033] dark:text-slate-100 truncate">
                              {tx.note || tx.type}
                            </p>
                            <p className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400">
                              {tx.transactionId} · {tx.method} · {formatDateShort(tx.createdAt, lang)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono-num font-extrabold text-[#172033] dark:text-slate-100">
                              ৳{tx.amountBdt}
                            </p>
                            <span className="text-[10px] font-bold text-[#777777]">{tx.status}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {detailTab === 'withdrawals' && (
                  <div className="space-y-2">
                    {detail.withdrawals.length === 0 ? (
                      <p className="text-xs text-[#777777] py-6 text-center">No withdrawals.</p>
                    ) : (
                      detail.withdrawals.map((w) => (
                        <div
                          key={w.id}
                          className="p-3 rounded-xl bg-[#F8FAFF] dark:bg-slate-800/60 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <p className="font-bold text-[#172033] dark:text-slate-100">
                              {(w.methodName || w.method).toUpperCase()} · {w.accountNumber}
                            </p>
                            <p className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400">
                              {formatDateShort(w.createdAt, lang)}
                              {w.payoutReference ? ` · Ref: ${w.payoutReference}` : ''}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-mono-num font-extrabold text-[#FF8500]">৳{w.amountBdt}</p>
                            <span className="text-[10px] font-bold">{w.status}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {detailTab === 'referrals' && (
                  <div className="space-y-2">
                    {detail.referrals.length === 0 ? (
                      <p className="text-xs text-[#777777] py-6 text-center">No referrals yet.</p>
                    ) : (
                      detail.referrals.map((r) => (
                        <div
                          key={r.id}
                          className="p-3 rounded-xl bg-[#F8FAFF] dark:bg-slate-800/60 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <p className="font-bold text-[#172033] dark:text-slate-100">
                              {r.referredEmail || r.referredUserId}
                            </p>
                            <p className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400">
                              Code: {r.referralCode} · {formatDateShort(r.createdAt, lang)}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-mono-num font-bold text-emerald-600">৳{r.rewardAmountBdt}</p>
                            <span className="text-[10px] font-bold uppercase">{r.status}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {detailTab === 'sessions' && (
                  <div className="space-y-2">
                    {detail.sessions.length === 0 ? (
                      <p className="text-xs text-[#777777] py-6 text-center">No active sessions.</p>
                    ) : (
                      detail.sessions.map((s) => (
                        <div
                          key={s.id}
                          className="p-3 rounded-xl bg-[#F8FAFF] dark:bg-slate-800/60 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between gap-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-mono-num font-bold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
                              <KeyRound className="w-3.5 h-3.5 text-[#FF8500]" />
                              {s.ipAddress || 'Unknown IP'}
                            </p>
                            <p className="text-[11px] text-[#777777] dark:text-slate-400 truncate">
                              {s.userAgent || 'Browser Session'}
                            </p>
                          </div>
                          {detail.profile.role !== 'super_admin' && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await adminRevokeSession({ sessionId: s.id });
                                  onSuccess('Session revoked.');
                                  await loadUserDetail(detail.profile.uid);
                                } catch (err) {
                                  onError(err instanceof Error ? err.message : 'Failed to revoke session.');
                                }
                              }}
                              className="px-2.5 py-1 rounded-lg bg-red-50 dark:bg-red-950/40 text-[#DC2626] font-bold shrink-0"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmState?.open)}
        lang={lang}
        title={confirmState?.title || ''}
        description={confirmState?.description || ''}
        tone={confirmState?.tone || 'danger'}
        requireReason={confirmState?.requireReason}
        confirmLabel={confirmState?.confirmLabel}
        busy={confirmBusy}
        onCancel={() => setConfirmState(null)}
        onConfirm={async (reason) => {
          if (!confirmState) return;
          setConfirmBusy(true);
          try {
            await confirmState.onRun(reason);
            setConfirmState(null);
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Action failed.');
          } finally {
            setConfirmBusy(false);
          }
        }}
      />
    </div>
  );
}
