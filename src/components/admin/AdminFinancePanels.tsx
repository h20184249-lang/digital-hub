import { FormEvent, useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  CheckCircle2,
  Download,
  Image as ImageIcon,
  Search,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  Language,
  Payment,
  UserProfile,
  WalletAccount,
  WalletTransaction,
  WithdrawalRequest,
  WithdrawalStatus,
} from '../../types/marketplace';
import {
  adminAdjustWalletBalance,
  adminProcessWithdrawalServer,
  adminVerifyAddMoneyServer,
  formatDateShort,
  getTimeMs,
} from '../../lib/firestoreService';
import { ConfirmDialog } from './ConfirmDialog';

// =========================================================================
// 1. WALLET & BALANCES PANEL (DEPOSIT VERIFICATION + AUDITED ADJUSTMENTS)
// =========================================================================

interface AdminWalletsPanelProps {
  lang: Language;
  users: UserProfile[];
  wallets: WalletAccount[];
  walletTxs: WalletTransaction[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminWalletsPanel({
  lang,
  users,
  wallets,
  walletTxs,
  onSuccess,
  onError,
}: AdminWalletsPanelProps) {
  const [search, setSearch] = useState('');
  const [receiptUrl, setReceiptUrl] = useState('');
  const [busyId, setBusyId] = useState('');

  // Balance Adjust Modal
  const [adjustTarget, setAdjustTarget] = useState<{ user?: UserProfile; wallet: WalletAccount } | null>(null);
  const [adjMode, setAdjMode] = useState<'add' | 'deduct' | 'set'>('add');
  const [adjAmount, setAdjAmount] = useState('');
  const [adjReason, setAdjReason] = useState('');
  const [adjBusy, setAdjBusy] = useState(false);

  // Confirm Dialog for Reject Deposit / Destructive Adjust
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

  const userByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    users.forEach((u) => map.set(u.uid, u));
    return map;
  }, [users]);

  const pendingDeposits = useMemo(
    () => walletTxs.filter((tx) => tx.type === 'deposit' && tx.status === 'Verification Pending'),
    [walletTxs]
  );

  const filteredWallets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return wallets.filter((w) => {
      if (!q) return true;
      const u = userByUid.get(w.uid);
      return (
        w.uid.toLowerCase().includes(q) ||
        (u?.displayName || '').toLowerCase().includes(q) ||
        (u?.email || '').toLowerCase().includes(q) ||
        (u?.phone || '').toLowerCase().includes(q)
      );
    });
  }, [wallets, userByUid, search]);

  const totals = useMemo(() => {
    const balance = wallets.reduce((s, w) => s + (w.availableBalanceBdt || 0), 0);
    const added = wallets.reduce((s, w) => s + (w.totalAddedBdt || 0), 0);
    const spent = wallets.reduce((s, w) => s + (w.totalSpentBdt || 0), 0);
    return { balance, added, spent };
  }, [wallets]);

  const handleApproveDeposit = async (tx: WalletTransaction) => {
    setBusyId(tx.id);
    try {
      await adminVerifyAddMoneyServer({ walletTx: tx, decision: 'approve' });
      onSuccess(`Deposit ${tx.transactionId} (৳${tx.amountBdt}) approved & credited.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Approval failed.');
    } finally {
      setBusyId('');
    }
  };

  const handleRejectDeposit = (tx: WalletTransaction) => {
    setConfirmState({
      open: true,
      title: lang === 'bn' ? 'ডিপোজিট রিকোয়েস্ট বাতিল করবেন?' : 'Reject Deposit Request?',
      description: `TX: ${tx.transactionId} · Amount: ৳${tx.amountBdt} · User: ${tx.userId}`,
      tone: 'danger',
      requireReason: true,
      confirmLabel: lang === 'bn' ? 'রিজেক্ট করুন' : 'Reject Deposit',
      onRun: async (reason) => {
        await adminVerifyAddMoneyServer({
          walletTx: tx,
          decision: 'reject',
          rejectionReason: reason,
        });
        onSuccess(`Deposit ${tx.transactionId} rejected.`);
      },
    });
  };

  const computePreview = () => {
    if (!adjustTarget) return 0;
    const cur = adjustTarget.wallet.availableBalanceBdt || 0;
    const amt = Math.max(0, Math.round(Number(adjAmount) || 0));
    if (adjMode === 'add') return cur + amt;
    if (adjMode === 'deduct') return Math.max(0, cur - amt);
    return amt;
  };

  const handleSubmitAdjust = async (e: FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    const amt = Math.round(Number(adjAmount) || 0);
    if (amt < 0 || (adjMode !== 'set' && amt <= 0)) {
      onError(lang === 'bn' ? 'সঠিক পরিমাণ (BDT) লিখুন।' : 'Enter a valid BDT amount.');
      return;
    }
    if (adjReason.trim().length < 3) {
      onError(
        lang === 'bn'
          ? 'অডিটের জন্য কমপক্ষে ৩ অক্ষরের কারণ লিখুন।'
          : 'A mandatory reason (min 3 characters) is required for wallet adjustments.'
      );
      return;
    }

    const runAdjust = async () => {
      setAdjBusy(true);
      try {
        const res = await adminAdjustWalletBalance({
          targetUid: adjustTarget.wallet.uid,
          mode: adjMode,
          amountBdt: amt,
          reason: adjReason.trim(),
        });
        onSuccess(
          `Balance updated for ${adjustTarget.wallet.uid}: ৳${res.previousBalance} → ৳${res.nextBalance} (${res.transactionId})`
        );
        setAdjustTarget(null);
        setAdjAmount('');
        setAdjReason('');
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Wallet adjustment failed.');
      } finally {
        setAdjBusy(false);
      }
    };

    if (adjMode === 'deduct' || adjMode === 'set') {
      const next = computePreview();
      setConfirmState({
        open: true,
        title: lang === 'bn' ? 'ব্যালেন্স পরিবর্তন নিশ্চিত করুন' : 'Confirm Balance Adjustment',
        description: `User ${adjustTarget.user?.displayName || adjustTarget.wallet.uid}: ৳${adjustTarget.wallet.availableBalanceBdt} → ৳${next}. Reason: "${adjReason.trim()}"`,
        tone: adjMode === 'deduct' ? 'danger' : 'warning',
        confirmLabel: lang === 'bn' ? 'নিশ্চিত করুন' : 'Apply Change',
        onRun: async () => {
          await runAdjust();
        },
      });
    } else {
      await runAdjust();
    }
  };

  return (
    <div className="space-y-5">
      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: lang === 'bn' ? 'মোট ইউজার ব্যালেন্স' : 'Total User Balance', val: `৳${totals.balance.toLocaleString()}`, tone: 'text-[#FF8500]' },
          { label: lang === 'bn' ? 'মোট অ্যাড মানি' : 'Lifetime Added', val: `৳${totals.added.toLocaleString()}`, tone: 'text-emerald-600 dark:text-emerald-400' },
          { label: lang === 'bn' ? 'মোট খরচ / উইথড্র' : 'Lifetime Spent', val: `৳${totals.spent.toLocaleString()}`, tone: 'text-[#172033] dark:text-slate-100' },
          { label: lang === 'bn' ? 'পেন্ডিং ডিপোজিট' : 'Pending Deposits', val: `${pendingDeposits.length}`, tone: 'text-amber-600 dark:text-amber-400' },
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

      {/* Pending Add Money Verification Queue */}
      {pendingDeposits.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800/70 p-4 space-y-3">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
            {lang === 'bn' ? `পেন্ডিং অ্যাড মানি ডিপোজিট (${pendingDeposits.length})` : `Pending Add Money Deposits (${pendingDeposits.length})`}
          </h3>
          <div className="space-y-2.5">
            {pendingDeposits.map((tx) => {
              const u = userByUid.get(tx.userId);
              return (
                <div
                  key={tx.id}
                  className="p-3.5 rounded-xl bg-[#F8FAFF] dark:bg-slate-800/70 border border-[#E6ECFA] dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs"
                >
                  <div className="space-y-0.5">
                    <p className="font-bold text-[#172033] dark:text-slate-100">
                      {u?.displayName || tx.userEmail || tx.userId}{' '}
                      <span className="font-mono-num text-[#FF8500] font-extrabold ml-1">৳{tx.amountBdt}</span>
                    </p>
                    <p className="font-mono-num text-[11px] text-[#777777] dark:text-slate-400">
                      {String(tx.method).toUpperCase()} · TXID: <strong>{tx.transactionId}</strong> · Sender:{' '}
                      {tx.senderNumber || 'N/A'} · {formatDateShort(tx.createdAt, lang)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {tx.receiptDataUrl && (
                      <button
                        type="button"
                        onClick={() => setReceiptUrl(tx.receiptDataUrl || '')}
                        className="px-2.5 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 font-bold inline-flex items-center gap-1"
                      >
                        <ImageIcon className="w-3.5 h-3.5 text-[#FF8500]" />
                        Receipt
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === tx.id}
                      onClick={() => void handleApproveDeposit(tx)}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1 disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyId === tx.id}
                      onClick={() => handleRejectDeposit(tx)}
                      className="px-3 py-1.5 rounded-lg bg-red-50 dark:bg-red-950/50 text-[#DC2626] font-bold inline-flex items-center gap-1 hover:bg-red-100"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Searchable User Wallets Table */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-[#E6ECFA] dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lang === 'bn' ? 'ইউজার আইডি, নাম, ইমেইল বা ফোন দিয়ে খুঁজুন...' : 'Search user wallets by ID, name, email, or phone...'}
              className="w-full pl-10 pr-3.5 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs text-[#172033] dark:text-slate-100"
            />
          </div>
          <span className="text-xs font-mono-num text-[#777777] dark:text-slate-400">
            {filteredWallets.length} wallets
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E6ECFA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-800/60 text-[#777777] dark:text-slate-400 uppercase text-[10px]">
                <th className="py-3 px-4 font-bold">User</th>
                <th className="py-3 px-4 font-bold">Available Balance</th>
                <th className="py-3 px-4 font-bold">Total Added</th>
                <th className="py-3 px-4 font-bold">Total Spent</th>
                <th className="py-3 px-4 font-bold">Promo Credits</th>
                <th className="py-3 px-4 font-bold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
              {filteredWallets.map((w) => {
                const u = userByUid.get(w.uid);
                return (
                  <tr key={w.uid} className="hover:bg-[#F8FAFF] dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4">
                      <p className="font-bold text-[#172033] dark:text-slate-100">
                        {u?.displayName || 'Unknown User'}
                      </p>
                      <p className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400">
                        {w.uid} {u?.email || u?.phone ? `· ${u.email || u.phone}` : ''}
                      </p>
                    </td>
                    <td className="py-3 px-4 font-mono-num font-extrabold text-[#FF8500]">
                      ৳{(w.availableBalanceBdt || 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-emerald-600 dark:text-emerald-400">
                      ৳{(w.totalAddedBdt || 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-[#172033] dark:text-slate-200">
                      ৳{(w.totalSpentBdt || 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 font-mono-num text-[#777777] dark:text-slate-400">
                      ৳{(w.promotionalCreditsBdt || 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setAdjustTarget({ user: u, wallet: w });
                          setAdjMode('add');
                          setAdjAmount('');
                          setAdjReason('');
                        }}
                        className="px-3 py-1.5 rounded-lg bg-[#172033] dark:bg-[#FF8500] text-white font-bold inline-flex items-center gap-1 hover:opacity-90"
                      >
                        <Wallet className="w-3.5 h-3.5" />
                        {lang === 'bn' ? 'ব্যালেন্স পরিবর্তন' : 'Adjust Balance'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Adjust Balance Modal */}
      {adjustTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleSubmitAdjust}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 shadow-2xl overflow-hidden"
          >
            <div className="p-5 border-b border-[#E6ECFA] dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-[#172033] dark:text-slate-100">
                  {lang === 'bn' ? 'ওয়ালেট ব্যালেন্স পরিবর্তন' : 'Adjust User Wallet Balance'}
                </h3>
                <p className="text-xs font-mono-num text-[#777777] dark:text-slate-400">
                  {adjustTarget.user?.displayName || adjustTarget.wallet.uid} ({adjustTarget.wallet.uid})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="p-3 rounded-xl bg-[#F8FAFF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between">
                <div>
                  <p className="text-[10px] uppercase font-bold text-[#777777] dark:text-slate-400">Previous</p>
                  <p className="text-base font-extrabold font-mono-num text-[#172033] dark:text-slate-100">
                    ৳{adjustTarget.wallet.availableBalanceBdt.toLocaleString()}
                  </p>
                </div>
                <span className="text-[#FF8500] font-extrabold">→</span>
                <div className="text-right">
                  <p className="text-[10px] uppercase font-bold text-[#777777] dark:text-slate-400">New Balance</p>
                  <p className="text-base font-extrabold font-mono-num text-[#FF8500]">
                    ৳{computePreview().toLocaleString()}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {(['add', 'deduct', 'set'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAdjMode(m)}
                    className={`py-2 rounded-xl font-bold capitalize border ${
                      adjMode === m
                        ? 'bg-[#FF8500] text-white border-[#FF8500]'
                        : 'bg-[#F3F6FF] dark:bg-slate-800 border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200'
                    }`}
                  >
                    {m === 'add' ? '+ Add' : m === 'deduct' ? '- Deduct' : '= Set Exact'}
                  </button>
                ))}
              </div>

              <div>
                <label className="block font-bold mb-1">Amount (BDT) *</label>
                <input
                  type="number"
                  min={0}
                  required
                  value={adjAmount}
                  onChange={(e) => setAdjAmount(e.target.value)}
                  placeholder="Enter amount in BDT"
                  className="w-full px-3 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num text-sm"
                />
              </div>

              <div>
                <label className="block font-bold mb-1">Mandatory Audit Reason *</label>
                <textarea
                  rows={2}
                  required
                  value={adjReason}
                  onChange={(e) => setAdjReason(e.target.value)}
                  placeholder="e.g., Manual deposit credit #BK9812 or duplicate cashback correction"
                  className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                />
              </div>
            </div>

            <div className="p-4 border-t border-[#E6ECFA] dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAdjustTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={adjBusy}
                className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold disabled:opacity-50"
              >
                {adjBusy ? 'Updating...' : 'Save Adjustment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Receipt Lightbox */}
      {receiptUrl && (
        <div
          className="fixed inset-0 z-[95] bg-slate-950/80 flex items-center justify-center p-4"
          onClick={() => setReceiptUrl('')}
        >
          <img
            src={receiptUrl}
            alt="Payment Receipt"
            className="max-w-full max-h-[85vh] rounded-2xl shadow-2xl border border-white/20"
          />
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

// =========================================================================
// 2. UNIFIED TRANSACTIONS LEDGER PANEL
// =========================================================================

interface AdminTransactionsPanelProps {
  lang: Language;
  users: UserProfile[];
  walletTxs: WalletTransaction[];
  payments: Payment[];
}

export function AdminTransactionsPanel({
  lang,
  users,
  walletTxs,
  payments,
}: AdminTransactionsPanelProps) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [userFilter, setUserFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const userByUid = useMemo(() => {
    const map = new Map<string, UserProfile>();
    users.forEach((u) => map.set(u.uid, u));
    return map;
  }, [users]);

  const unifiedRows = useMemo(() => {
    const rows = walletTxs.map((tx) => {
      const isCredit =
        typeof tx.signedDeltaBdt === 'number'
          ? tx.signedDeltaBdt >= 0
          : !['purchase', 'withdrawal'].includes(tx.type);
      return {
        id: tx.id,
        txId: tx.transactionId || tx.id,
        userId: tx.userId,
        userLabel: userByUid.get(tx.userId)?.displayName || tx.userEmail || tx.userId,
        type: tx.type,
        method: String(tx.method || 'wallet').toUpperCase(),
        amountBdt: Math.abs(tx.amountBdt || 0),
        isCredit,
        status: tx.status,
        note: tx.note || tx.rejectionReason || '',
        createdMs: getTimeMs(tx.createdAt),
      };
    });

    // Include order manual payments that might not be in wallet_transactions
    const existingTxIds = new Set(rows.map((r) => r.txId));
    payments.forEach((p) => {
      if (p.purpose === 'add_money' || existingTxIds.has(p.transactionId)) return;
      rows.push({
        id: `pay_${p.id}`,
        txId: p.transactionId || p.id,
        userId: p.customerId,
        userLabel: userByUid.get(p.customerId)?.displayName || p.customerId,
        type: 'purchase',
        method: String(p.method || 'bkash').toUpperCase(),
        amountBdt: Math.abs(p.amountBdt || 0),
        isCredit: false,
        status: p.status === 'Approved' ? 'Approved' : p.status === 'Rejected' ? 'Rejected' : 'Verification Pending',
        note: `Order #${p.orderNumber || p.orderId} (${p.senderNumber})`,
        createdMs: getTimeMs(p.createdAt),
      });
    });

    return rows.sort((a, b) => b.createdMs - a.createdMs);
  }, [walletTxs, payments, userByUid]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const fromMs = dateFrom ? Date.parse(`${dateFrom}T00:00:00`) : 0;
    const toMs = dateTo ? Date.parse(`${dateTo}T23:59:59.999`) : 0;

    return unifiedRows.filter((row) => {
      if (typeFilter !== 'all' && row.type !== typeFilter) return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (userFilter !== 'all' && row.userId !== userFilter) return false;
      if (fromMs && row.createdMs < fromMs) return false;
      if (toMs && row.createdMs > toMs) return false;
      if (!q) return true;
      return (
        row.txId.toLowerCase().includes(q) ||
        row.userId.toLowerCase().includes(q) ||
        row.userLabel.toLowerCase().includes(q) ||
        row.method.toLowerCase().includes(q) ||
        row.note.toLowerCase().includes(q)
      );
    });
  }, [unifiedRows, search, typeFilter, statusFilter, userFilter, dateFrom, dateTo]);

  const exportCsv = () => {
    const header = ['Date', 'Transaction ID', 'User ID', 'User', 'Type', 'Method', 'Amount BDT', 'Status', 'Note'];
    const lines = [
      header.join(','),
      ...filtered.map((r) =>
        [
          new Date(r.createdMs || Date.now()).toISOString(),
          r.txId,
          r.userId,
          `"${(r.userLabel || '').replace(/"/g, '""')}"`,
          r.type,
          r.method,
          `${r.isCredit ? '+' : '-'}${r.amountBdt}`,
          r.status,
          `"${(r.note || '').replace(/"/g, '""')}"`,
        ].join(',')
      ),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `digital-hub-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-2.5 text-xs">
          <div className="relative lg:col-span-2">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search TX ID, User ID, note..."
              className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          >
            <option value="all">All Types</option>
            <option value="deposit">Deposit</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="withdrawal_refund">Withdrawal Refund</option>
            <option value="admin_adjustment">Admin Adjustment</option>
            <option value="purchase">Order Purchase</option>
            <option value="refund">Order Refund</option>
            <option value="referral">Referral Bonus</option>
            <option value="cashback">Cashback</option>
            <option value="rewarded_ad">Rewarded Ad</option>
            <option value="watch_earn_coin_redeem">Watch & Earn</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          >
            <option value="all">All Statuses</option>
            <option value="Approved">Approved</option>
            <option value="Verification Pending">Pending</option>
            <option value="Rejected">Rejected</option>
          </select>

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            title="From Date"
          />

          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            title="To Date"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2">
            <select
              value={userFilter}
              onChange={(e) => setUserFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs max-w-[220px]"
            >
              <option value="all">Filter by User (All)</option>
              {users.map((u) => (
                <option key={u.uid} value={u.uid}>
                  {u.displayName || u.email || u.phone || u.uid}
                </option>
              ))}
            </select>
            <span className="font-mono-num text-[#777777] dark:text-slate-400">
              {filtered.length} records
            </span>
          </div>

          <button
            type="button"
            onClick={exportCsv}
            className="px-3 py-1.5 rounded-lg bg-[#172033] dark:bg-slate-800 text-white font-bold inline-flex items-center gap-1.5 hover:bg-[#FF8500]"
          >
            <Download className="w-3.5 h-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-[#E6ECFA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-800/60 text-[#777777] dark:text-slate-400 uppercase text-[10px]">
                <th className="py-3 px-4 font-bold">Date</th>
                <th className="py-3 px-4 font-bold">TX ID</th>
                <th className="py-3 px-4 font-bold">User</th>
                <th className="py-3 px-4 font-bold">Type & Method</th>
                <th className="py-3 px-4 font-bold">Amount</th>
                <th className="py-3 px-4 font-bold">Status</th>
                <th className="py-3 px-4 font-bold">Note / Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-[#777777]">
                    No transactions match your filters.
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 150).map((row) => (
                  <tr key={row.id} className="hover:bg-[#F8FAFF] dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 whitespace-nowrap text-[#777777] dark:text-slate-400">
                      {formatDateShort(row.createdMs, lang)}
                    </td>
                    <td className="py-3 px-4 font-mono-num font-bold text-[#172033] dark:text-slate-100">
                      {row.txId}
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-bold text-[#172033] dark:text-slate-100">{row.userLabel}</p>
                      <p className="text-[10px] font-mono-num text-[#777777]">{row.userId}</p>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-bold text-[10px] uppercase">
                        {row.type.replace(/_/g, ' ')}
                      </span>
                      <span className="ml-1.5 text-[10px] font-mono-num text-[#777777]">{row.method}</span>
                    </td>
                    <td
                      className={`py-3 px-4 font-mono-num font-extrabold ${
                        row.isCredit ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {row.isCredit ? '+' : '-'}৳{row.amountBdt.toLocaleString()}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          row.status === 'Approved'
                            ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400'
                            : row.status === 'Rejected'
                              ? 'bg-red-100 dark:bg-red-950/50 text-[#DC2626]'
                              : 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-[#777777] dark:text-slate-400 max-w-xs truncate" title={row.note}>
                      {row.note || '—'}
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
// 3. WITHDRAWAL MANAGEMENT PANEL (5 STAGES + REFERENCE + SINGLE REFUND)
// =========================================================================

interface AdminWithdrawalsPanelProps {
  lang: Language;
  withdrawals: WithdrawalRequest[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

const WITHDRAWAL_BADGE: Record<WithdrawalStatus, string> = {
  Pending: 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300',
  Approved: 'bg-sky-100 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300',
  Processing: 'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300',
  Paid: 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400',
  Rejected: 'bg-red-100 dark:bg-red-950/50 text-[#DC2626]',
};

export function AdminWithdrawalsPanel({
  lang,
  withdrawals,
  onSuccess,
  onError,
}: AdminWithdrawalsPanelProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | WithdrawalStatus>('all');
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState('');

  // Modal for Paid / Reject details
  const [actionModal, setActionModal] = useState<{
    withdrawal: WithdrawalRequest;
    targetStatus: 'Paid' | 'Rejected';
  } | null>(null);
  const [payoutRef, setPayoutRef] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [modalBusy, setModalBusy] = useState(false);

  const counts = useMemo(() => {
    const map: Record<'all' | WithdrawalStatus, { count: number; amount: number }> = {
      all: { count: withdrawals.length, amount: withdrawals.reduce((s, w) => s + w.amountBdt, 0) },
      Pending: { count: 0, amount: 0 },
      Approved: { count: 0, amount: 0 },
      Processing: { count: 0, amount: 0 },
      Paid: { count: 0, amount: 0 },
      Rejected: { count: 0, amount: 0 },
    };
    withdrawals.forEach((w) => {
      if (map[w.status]) {
        map[w.status].count += 1;
        map[w.status].amount += w.amountBdt || 0;
      }
    });
    return map;
  }, [withdrawals]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return withdrawals.filter((w) => {
      if (statusFilter !== 'all' && w.status !== statusFilter) return false;
      if (!q) return true;
      return (
        w.id.toLowerCase().includes(q) ||
        w.userId.toLowerCase().includes(q) ||
        (w.userName || '').toLowerCase().includes(q) ||
        (w.userEmail || '').toLowerCase().includes(q) ||
        w.accountNumber.toLowerCase().includes(q) ||
        (w.accountHolderName || '').toLowerCase().includes(q) ||
        (w.payoutReference || '').toLowerCase().includes(q) ||
        w.method.toLowerCase().includes(q)
      );
    });
  }, [withdrawals, statusFilter, search]);

  const handleQuickTransition = async (w: WithdrawalRequest, status: 'Approved' | 'Processing') => {
    setBusyId(w.id);
    try {
      await adminProcessWithdrawalServer({ withdrawalId: w.id, status });
      onSuccess(`Withdrawal ${w.id} marked as ${status}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Status update failed.');
    } finally {
      setBusyId('');
    }
  };

  const handleModalSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!actionModal) return;
    if (actionModal.targetStatus === 'Rejected' && rejectionReason.trim().length < 3) {
      onError(
        lang === 'bn'
          ? 'রিজেক্ট করার জন্য কমপক্ষে ৩ অক্ষরের কারণ লিখুন।'
          : 'Please enter a clear rejection reason (min 3 characters).'
      );
      return;
    }
    setModalBusy(true);
    try {
      const res = await adminProcessWithdrawalServer({
        withdrawalId: actionModal.withdrawal.id,
        status: actionModal.targetStatus,
        payoutReference: payoutRef.trim() || undefined,
        adminNote: adminNote.trim() || undefined,
        rejectionReason: rejectionReason.trim() || undefined,
      });
      onSuccess(
        res.status === 'Paid'
          ? `Withdrawal ${actionModal.withdrawal.id} marked Paid (Ref: ${payoutRef.trim() || 'Recorded'}).`
          : `Withdrawal ${actionModal.withdrawal.id} rejected & ৳${actionModal.withdrawal.amountBdt} refunded to wallet.`
      );
      setActionModal(null);
      setPayoutRef('');
      setAdminNote('');
      setRejectionReason('');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Withdrawal processing failed.');
    } finally {
      setModalBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Status Tabs & Search */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-3">
        <div className="flex flex-wrap gap-2">
          {(['all', 'Pending', 'Approved', 'Processing', 'Paid', 'Rejected'] as const).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors ${
                statusFilter === st
                  ? 'bg-[#FF8500] text-white border-[#FF8500]'
                  : 'bg-[#F8FAFF] dark:bg-slate-800 border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200'
              }`}
            >
              {st === 'all' ? 'All' : st} ({counts[st].count}) · ৳{counts[st].amount.toLocaleString()}
            </button>
          ))}
        </div>

        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by User ID, Withdrawal ID, Account #, or Payout Ref..."
            className="w-full pl-10 pr-3.5 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs"
          />
        </div>
      </div>

      {/* Withdrawal List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-10 text-center text-xs text-[#777777]">
            No withdrawal requests in this view.
          </div>
        ) : (
          filtered.map((w) => {
            const isTerminal = w.status === 'Paid' || w.status === 'Rejected';
            return (
              <div
                key={w.id}
                className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 text-xs"
              >
                <div className="space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono-num font-extrabold text-[#172033] dark:text-slate-100">
                      {w.id}
                    </span>
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold ${WITHDRAWAL_BADGE[w.status]}`}>
                      {w.status}
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-bold uppercase text-[10px]">
                      {w.methodName || w.method}
                    </span>
                    <span className="text-[11px] text-[#777777] dark:text-slate-400">
                      {formatDateShort(w.createdAt, lang)}
                    </span>
                  </div>
                  <p className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
                    {w.userName || w.userEmail} ·{' '}
                    <span className="font-mono-num text-[#FF8500]">৳{w.amountBdt.toLocaleString()}</span>
                  </p>
                  <p className="font-mono-num text-[11px] text-[#777777] dark:text-slate-400">
                    UID: {w.userId} · Account: <strong className="text-[#172033] dark:text-slate-200">{w.accountNumber}</strong>
                    {w.accountHolderName ? ` (${w.accountHolderName})` : ''}
                  </p>
                  {w.payoutReference && (
                    <p className="text-[11px] font-mono-num text-emerald-600 dark:text-emerald-400 font-bold">
                      Payout Ref: {w.payoutReference}
                      {w.paidAt ? ` · Paid: ${formatDateShort(w.paidAt, lang)}` : ''}
                    </p>
                  )}
                  {w.adminNote && (
                    <p className="text-[11px] text-[#777777] dark:text-slate-400">Note: {w.adminNote}</p>
                  )}
                  {w.rejectionReason && (
                    <p className="text-[11px] font-bold text-[#DC2626]">Rejected: {w.rejectionReason}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {!isTerminal ? (
                    <>
                      {w.status === 'Pending' && (
                        <button
                          type="button"
                          disabled={busyId === w.id}
                          onClick={() => void handleQuickTransition(w, 'Approved')}
                          className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold disabled:opacity-50"
                        >
                          Approve
                        </button>
                      )}
                      {(w.status === 'Pending' || w.status === 'Approved') && (
                        <button
                          type="button"
                          disabled={busyId === w.id}
                          onClick={() => void handleQuickTransition(w, 'Processing')}
                          className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold disabled:opacity-50"
                        >
                          Processing
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busyId === w.id}
                        onClick={() => {
                          setActionModal({ withdrawal: w, targetStatus: 'Paid' });
                          setPayoutRef(w.payoutReference || '');
                          setAdminNote(w.adminNote || '');
                          setRejectionReason('');
                        }}
                        className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold inline-flex items-center gap-1 disabled:opacity-50"
                      >
                        <ArrowDownToLine className="w-3.5 h-3.5" />
                        Mark Paid
                      </button>
                      <button
                        type="button"
                        disabled={busyId === w.id}
                        onClick={() => {
                          setActionModal({ withdrawal: w, targetStatus: 'Rejected' });
                          setPayoutRef('');
                          setAdminNote('');
                          setRejectionReason('');
                        }}
                        className="px-3 py-1.5 rounded-xl bg-red-50 dark:bg-red-950/50 text-[#DC2626] font-bold hover:bg-red-100 disabled:opacity-50"
                      >
                        Reject & Refund
                      </button>
                    </>
                  ) : (
                    <span className="text-[11px] font-bold text-[#777777] dark:text-slate-400">
                      {w.status === 'Paid' ? 'Payout Finalized' : 'Refunded & Closed'}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Paid / Reject Modal */}
      {actionModal && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs">
          <form
            onSubmit={handleModalSubmit}
            className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 shadow-2xl overflow-hidden"
          >
            <div className="p-5 border-b border-[#E6ECFA] dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-extrabold text-[#172033] dark:text-slate-100">
                  {actionModal.targetStatus === 'Paid'
                    ? 'Confirm Withdrawal Payout (Paid)'
                    : 'Reject Withdrawal & Refund Balance'}
                </h3>
                <p className="text-xs font-mono-num text-[#777777] dark:text-slate-400">
                  {actionModal.withdrawal.id} · ৳{actionModal.withdrawal.amountBdt.toLocaleString()} →{' '}
                  {actionModal.withdrawal.accountNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-3 text-xs">
              {actionModal.targetStatus === 'Paid' ? (
                <>
                  <div>
                    <label className="block font-bold mb-1">Payment Reference / TrxID *</label>
                    <input
                      type="text"
                      required
                      value={payoutRef}
                      onChange={(e) => setPayoutRef(e.target.value)}
                      placeholder="e.g., BK98273615 or Bank Ref #4421"
                      className="w-full px-3 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">Admin Note (Optional)</label>
                    <textarea
                      rows={2}
                      value={adminNote}
                      onChange={(e) => setAdminNote(e.target.value)}
                      placeholder="Payout note visible to user & audit log..."
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 font-semibold">
                    Confirming rejection will refund ৳{actionModal.withdrawal.amountBdt.toLocaleString()} back to the user&apos;s wallet once and mark this withdrawal closed.
                  </div>
                  <div>
                    <label className="block font-bold mb-1">Rejection Reason *</label>
                    <textarea
                      rows={3}
                      required
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="Explain why the withdrawal was rejected (e.g., incorrect account number)..."
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                    />
                  </div>
                </>
              )}
            </div>

            <div className="p-4 border-t border-[#E6ECFA] dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={modalBusy}
                className={`px-4 py-2 rounded-xl text-white text-xs font-bold disabled:opacity-50 ${
                  actionModal.targetStatus === 'Paid'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-[#DC2626] hover:bg-red-700'
                }`}
              >
                {modalBusy
                  ? 'Processing...'
                  : actionModal.targetStatus === 'Paid'
                    ? 'Record Payout & Mark Paid'
                    : 'Reject & Refund Once'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
