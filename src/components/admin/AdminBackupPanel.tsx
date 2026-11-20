import { useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  Database,
  Download,
  FileSpreadsheet,
  Package,
  ShieldCheck,
  ShoppingBag,
  Users,
  Wallet,
} from 'lucide-react';
import {
  AuditLog,
  Language,
  Order,
  Product,
  UserProfile,
  WalletAccount,
  WalletTransaction,
  WithdrawalRequest,
} from '../../types/marketplace';
import {
  adminFetchDatabaseBackup,
  downloadJsonFile,
  exportRecordsToCsv,
  formatDateShort,
} from '../../lib/firestoreService';

interface AdminBackupPanelProps {
  lang: Language;
  users: UserProfile[];
  wallets: WalletAccount[];
  products: Product[];
  orders: Order[];
  walletTxs: WalletTransaction[];
  withdrawals: WithdrawalRequest[];
  auditLogs: AuditLog[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminBackupPanel({
  lang,
  users,
  wallets,
  products,
  orders,
  walletTxs,
  withdrawals,
  auditLogs,
  onSuccess,
  onError,
}: AdminBackupPanelProps) {
  const [downloadingBackup, setDownloadingBackup] = useState(false);

  const dateStamp = new Date().toISOString().slice(0, 10);

  const handleFullBackup = async () => {
    setDownloadingBackup(true);
    try {
      const backup = await adminFetchDatabaseBackup();
      downloadJsonFile(`digital-hub-bd-backup-${dateStamp}.json`, backup);
      onSuccess(
        lang === 'bn'
          ? 'সম্পূর্ণ নিরাপদ ডাটাবেস ব্যাকআপ (JSON) ডাউনলোড হয়েছে।'
          : 'Sanitized full database JSON backup downloaded successfully.'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to export database backup.');
    } finally {
      setDownloadingBackup(false);
    }
  };

  const walletByUid = new Map(wallets.map((w) => [w.uid, w]));

  const csvExports = [
    {
      id: 'users',
      icon: Users,
      title: lang === 'bn' ? 'ইউজার তালিকা (CSV)' : 'Users & Balances (CSV)',
      count: users.length,
      desc: lang === 'bn' ? 'সব ইউজার, ফোন/ইমেইল, স্ট্যাটাস ও ব্যালেন্স' : 'All accounts, contacts, role, status & wallet balances',
      onClick: () => {
        exportRecordsToCsv(
          `digital-hub-users-${dateStamp}.csv`,
          ['UID', 'Display Name', 'Email', 'Phone', 'Role', 'Status', 'Available Balance (BDT)', 'Total Added', 'Total Spent', 'Referral Code', 'Created At'],
          users.map((u) => {
            const w = walletByUid.get(u.uid);
            return [
              u.uid,
              u.displayName,
              u.email || '',
              u.phone || '',
              u.role || 'user',
              u.status,
              w?.availableBalanceBdt ?? 0,
              w?.totalAddedBdt ?? 0,
              w?.totalSpentBdt ?? 0,
              u.referralCode || '',
              formatDateShort(u.createdAt, 'en'),
            ];
          })
        );
        onSuccess(`Exported ${users.length} users to CSV.`);
      },
    },
    {
      id: 'packages',
      icon: Package,
      title: lang === 'bn' ? 'প্যাকেজ ক্যাটালগ (CSV)' : 'Packages Catalog (CSV)',
      count: products.length,
      desc: lang === 'bn' ? 'প্যাকেজ ID, নাম, মূল্য, ডিসকাউন্ট, মেয়াদ ও স্ট্যাটাস' : 'Package IDs, prices, discounts, duration, badges & logos',
      onClick: () => {
        exportRecordsToCsv(
          `digital-hub-packages-${dateStamp}.csv`,
          ['Package ID', 'Name (EN)', 'Name (BN)', 'Category', 'Current Price (BDT)', 'Previous Price (BDT)', 'Discount %', 'Duration', 'Badge', 'Active', 'Featured', 'Display Order', 'Logo URL'],
          products.map((p) => [
            p.id,
            p.titleEn,
            p.titleBn,
            p.categoryId,
            p.priceBdt,
            p.originalPriceBdt || 0,
            p.discountPercent || 0,
            p.durationLabelEn || p.validityEn || p.deliveryDurationEn || '',
            p.badge || '',
            p.active ? 'Active' : 'Inactive',
            p.featured ? 'Yes' : 'No',
            p.sortOrder ?? 0,
            p.customLogoUrl || p.imageUrl || '',
          ])
        );
        onSuccess(`Exported ${products.length} packages to CSV.`);
      },
    },
    {
      id: 'orders',
      icon: ShoppingBag,
      title: lang === 'bn' ? 'স্টোর অর্ডার (CSV)' : 'Storefront Orders (CSV)',
      count: orders.length,
      desc: lang === 'bn' ? 'অর্ডার নম্বর, কাস্টমার, মূল্য, TrxID ও স্ট্যাটাস' : 'Order numbers, historical prices, methods, TrxIDs & statuses',
      onClick: () => {
        exportRecordsToCsv(
          `digital-hub-orders-${dateStamp}.csv`,
          ['Order Number', 'Customer ID', 'Customer Name', 'Package', 'Plan', 'Quantity', 'Total Price (BDT)', 'Payment Method', 'Transaction ID', 'Sender Number', 'Status', 'Created At'],
          orders.map((o) => [
            o.orderNumber,
            o.customerId,
            o.customerName || o.customerEmail || '',
            o.productTitleEn || o.productId,
            o.selectedPackageName || '',
            o.quantity || 1,
            o.totalPriceBdt,
            o.paymentMethod,
            o.transactionId || '',
            o.senderNumber || '',
            o.status,
            formatDateShort(o.createdAt, 'en'),
          ])
        );
        onSuccess(`Exported ${orders.length} orders to CSV.`);
      },
    },
    {
      id: 'transactions',
      icon: Wallet,
      title: lang === 'bn' ? 'ওয়ালেট লেনদেন (CSV)' : 'Wallet Transactions (CSV)',
      count: walletTxs.length,
      desc: lang === 'bn' ? 'ডিপোজিট, ক্রয়, রেফারেল ও অ্যাডমিন অ্যাডজাস্টমেন্ট' : 'Deposits, purchases, refunds, referral credits & adjustments',
      onClick: () => {
        exportRecordsToCsv(
          `digital-hub-transactions-${dateStamp}.csv`,
          ['Tx ID', 'User ID', 'Type', 'Method', 'Amount (BDT)', 'Transaction ID', 'Sender', 'Status', 'Note', 'Date'],
          walletTxs.map((tx) => [
            tx.id,
            tx.userId,
            tx.type,
            tx.method,
            tx.amountBdt,
            tx.transactionId || '',
            tx.senderNumber || '',
            tx.status,
            tx.note || '',
            formatDateShort(tx.createdAt, 'en'),
          ])
        );
        onSuccess(`Exported ${walletTxs.length} wallet transactions to CSV.`);
      },
    },
    {
      id: 'withdrawals',
      icon: ArrowDownToLine,
      title: lang === 'bn' ? 'উইথড্রয়াল রেকর্ড (CSV)' : 'Withdrawals Ledger (CSV)',
      count: withdrawals.length,
      desc: lang === 'bn' ? 'সকল পেন্ডিং, পেইড ও রিজেক্টেড উইথড্রয়াল' : 'All payout requests, recipient accounts & payout references',
      onClick: () => {
        exportRecordsToCsv(
          `digital-hub-withdrawals-${dateStamp}.csv`,
          ['ID', 'User ID', 'User Name', 'Method', 'Account Number', 'Amount (BDT)', 'Status', 'Payout Reference', 'Date'],
          withdrawals.map((w) => [
            w.id,
            w.userId,
            w.userName || w.userEmail || '',
            w.methodName || w.method,
            w.accountNumber,
            w.amountBdt,
            w.status,
            w.payoutReference || '',
            formatDateShort(w.createdAt, 'en'),
          ])
        );
        onSuccess(`Exported ${withdrawals.length} withdrawal records to CSV.`);
      },
    },
    {
      id: 'audit',
      icon: Activity,
      title: lang === 'bn' ? 'অ্যাডমিন অডিট লগ (CSV)' : 'Admin Audit Logs (CSV)',
      count: auditLogs.length,
      desc: lang === 'bn' ? 'প্যাকেজ এডিট, মূল্য পরিবর্তন ও সিস্টেম অ্যাকশন হিস্ট্রি' : 'Full history of package, balance, user & settings changes',
      onClick: () => {
        exportRecordsToCsv(
          `digital-hub-audit-logs-${dateStamp}.csv`,
          ['ID', 'Actor', 'Action', 'Collection', 'Target ID', 'Previous Value', 'New Value', 'Reason', 'Summary', 'Date'],
          auditLogs.map((l) => [
            l.id,
            l.actorEmail || l.actorUid,
            l.action,
            l.targetCollection,
            l.targetId,
            l.previousValue || '',
            l.newValue || '',
            l.reason || '',
            l.summary,
            formatDateShort(l.createdAt, 'en'),
          ])
        );
        onSuccess(`Exported ${auditLogs.length} audit log entries to CSV.`);
      },
    },
  ];

  return (
    <div className="space-y-5">
      {/* Full Database Backup Hero Card */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 sm:p-6 text-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-[#FF8500]/15 border border-[#FF8500]/30 text-[#FF8500] flex items-center justify-center shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-extrabold text-white">
              {lang === 'bn' ? 'নিরাপদ সম্পূর্ণ ডাটাবেস ব্যাকআপ (JSON)' : 'Sanitized Full Database Backup (JSON)'}
            </h2>
            <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
              {lang === 'bn'
                ? 'সার্ভার থেকে সব ইউজার, ওয়ালেট, লেনদেন, অর্ডার, উইথড্রয়াল, প্যাকেজ ও অডিট লগের একটি নিরাপদ ব্যাকআপ ডাউনলোড করুন। পাসওয়ার্ড হ্যাশ বা সেশন টোকেন কখনোই ব্যাকআপে যুক্ত হয় না।'
                : 'Download a verified server snapshot of users, wallets, orders, transactions, withdrawals, packages, settings, and audit logs. Password hashes, recovery hashes, and session tokens are strictly stripped.'}
            </p>
            <div className="flex items-center gap-2 mt-2 text-[11px] text-emerald-400 font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Zero credential hashes exposed · Audit logged on every export</span>
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={downloadingBackup}
          onClick={() => void handleFullBackup()}
          className="px-5 py-3 rounded-xl bg-[#FF8500] hover:bg-[#e57600] text-white text-xs font-extrabold inline-flex items-center justify-center gap-2 shrink-0 disabled:opacity-50 cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>
            {downloadingBackup
              ? lang === 'bn'
                ? 'ব্যাকআপ তৈরি হচ্ছে...'
                : 'Generating Backup...'
              : lang === 'bn'
                ? 'ডাটাবেস ব্যাকআপ ডাউনলোড'
                : 'Download JSON Backup'}
          </span>
        </button>
      </div>

      {/* Individual CSV Exports Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {csvExports.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.id}
              className="rounded-2xl bg-slate-900 border border-slate-800 p-4 flex flex-col justify-between gap-4 text-slate-100"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="w-9 h-9 rounded-xl bg-slate-950 border border-slate-800 text-[#FF8500] flex items-center justify-center">
                    <Icon className="w-4 h-4" />
                  </span>
                  <span className="text-xs font-mono-num font-extrabold text-slate-300">
                    {item.count.toLocaleString()} rows
                  </span>
                </div>
                <h3 className="text-sm font-extrabold text-white">{item.title}</h3>
                <p className="text-xs text-slate-400 leading-relaxed">{item.desc}</p>
              </div>
              <button
                type="button"
                onClick={item.onClick}
                className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                <span>{lang === 'bn' ? 'CSV ডাউনলোড করুন' : 'Export CSV'}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
