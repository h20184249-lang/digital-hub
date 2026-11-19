import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  Bell,
  CheckCircle2,
  CreditCard,
  FileText,
  Gift,
  LayoutDashboard,
  Lock,
  LogOut,
  Megaphone,
  Menu,
  Moon,
  RefreshCw,
  Settings,
  Shield,
  ShieldAlert,
  ShoppingBag,
  Sun,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import {
  AdNetworkConfig,
  AdRewardTransaction,
  Advertisement,
  Announcement,
  AuditLog,
  AuthUser,
  Banner,
  Category,
  Coupon,
  Language,
  ManagedAdUnitConfig,
  Order,
  Payment,
  PaymentMethodConfig,
  Product,
  Referral,
  Review,
  RewardedAdClaim,
  ServerAdAnalytics,
  SiteSettings,
  SupportTicket,
  UserProfile,
  WalletAccount,
  WalletTransaction,
  WithdrawalRequest,
} from '../types/marketplace';
import {
  fetchAdminDashboardServer,
  fetchServerAdAnalytics,
  formatDateShort,
  notifyDashboardInvalidation,
  subscribeAllAdminCollections,
  subscribeAllAdRewardTransactions,
  subscribeAllAnnouncements,
  subscribeAllRewardedClaims,
  subscribeAllWithdrawals,
  verifyOwnerAdminServer,
} from '../lib/firestoreService';
import { DigitalHubLogo } from './DigitalHubLogo';
import { AdminCharts } from './admin/AdminCharts';
import { AdminUsersPanel } from './admin/AdminUsersPanel';
import {
  AdminTransactionsPanel,
  AdminWalletsPanel,
  AdminWithdrawalsPanel,
} from './admin/AdminFinancePanels';
import {
  AdminAdsPanel,
  AdminPaymentMethodsPanel,
  AdminReferralsPanel,
} from './admin/AdminGrowthPanels';
import {
  AdminActivityLogsPanel,
  AdminNotificationsPanel,
  AdminSecurityPanel,
  AdminSettingsPanel,
  AdminStorefrontPanel,
} from './admin/AdminSystemPanels';
import { ConfirmDialog } from './admin/ConfirmDialog';

interface AdminDashboardProps {
  lang: Language;
  setLang?: (l: Language) => void;
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
  user: AuthUser | null;
  isAdmin: boolean;
  onBackToStore?: () => void;
  onLogout: () => Promise<void>;
  categories: Category[];
  products: Product[];
  advertisements: Advertisement[];
  adNetworks: AdNetworkConfig[];
  managedAdUnits: ManagedAdUnitConfig[];
  banners: Banner[];
  paymentMethods?: PaymentMethodConfig[];
  settings: SiteSettings;
}

type AdminSection =
  | 'overview'
  | 'users'
  | 'wallets'
  | 'transactions'
  | 'withdrawals'
  | 'referrals'
  | 'advertisements'
  | 'payment_methods'
  | 'notifications'
  | 'settings'
  | 'security'
  | 'activity_logs'
  | 'storefront';

export function AdminDashboard({
  lang,
  setLang,
  theme = 'light',
  onToggleTheme,
  user,
  isAdmin,
  onBackToStore,
  onLogout,
  categories,
  products,
  advertisements,
  managedAdUnits,
  banners,
  paymentMethods = [],
  settings,
}: AdminDashboardProps) {
  const [section, setSection] = useState<AdminSection>('overview');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [serverVerifiedAdmin, setServerVerifiedAdmin] = useState<boolean | null>(null);
  const [superAdminEmail, setSuperAdminEmail] = useState('');

  // Core Admin Collections (100% live from D1 / SQLite API)
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [walletTxs, setWalletTxs] = useState<WalletTransaction[]>([]);
  const [wallets, setWallets] = useState<WalletAccount[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [rewardClaims, setRewardClaims] = useState<RewardedAdClaim[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [adRewardTransactions, setAdRewardTransactions] = useState<AdRewardTransaction[]>([]);
  const [adAnalytics, setAdAnalytics] = useState<ServerAdAnalytics | null>(null);

  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);

  const showSuccess = (msg: string) => {
    setErrMsg('');
    setNotice(msg);
    setTimeout(() => setNotice(''), 4200);
  };

  const showError = (msg: string) => {
    setNotice('');
    setErrMsg(msg);
    setTimeout(() => setErrMsg(''), 5500);
  };

  useEffect(() => {
    let active = true;
    if (!user || !isAdmin) {
      setServerVerifiedAdmin(false);
      return;
    }
    verifyOwnerAdminServer()
      .then((verified) => {
        if (active) setServerVerifiedAdmin(verified);
      })
      .catch(() => {
        if (active) setServerVerifiedAdmin(false);
      });
    return () => {
      active = false;
    };
  }, [user, isAdmin]);

  useEffect(() => {
    if (!serverVerifiedAdmin) return;
    const unsubs = subscribeAllAdminCollections({
      onUsers: setUsers,
      onOrders: setOrders,
      onPayments: setPayments,
      onWalletTx: setWalletTxs,
      onWallets: setWallets,
      onCoupons: setCoupons,
      onReviews: setReviews,
      onTickets: setTickets,
      onReferrals: setReferrals,
      onAuditLogs: setAuditLogs,
      onAdmins: () => {},
    });
    const uW = subscribeAllWithdrawals(setWithdrawals);
    const uR = subscribeAllRewardedClaims(setRewardClaims);
    const uA = subscribeAllAnnouncements(setAnnouncements);
    const uT = subscribeAllAdRewardTransactions(setAdRewardTransactions);

    fetchAdminDashboardServer(false)
      .then((snap) => {
        if (snap?.superAdminEmail) setSuperAdminEmail(snap.superAdminEmail);
      })
      .catch(() => {});
    fetchServerAdAnalytics()
      .then(setAdAnalytics)
      .catch(() => {});

    return () => {
      unsubs.forEach((u) => u());
      uW();
      uR();
      uA();
      uT();
    };
  }, [serverVerifiedAdmin]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      notifyDashboardInvalidation();
      const [snap, stats] = await Promise.all([
        fetchAdminDashboardServer(true),
        fetchServerAdAnalytics(),
      ]);
      if (snap?.superAdminEmail) setSuperAdminEmail(snap.superAdminEmail);
      setAdAnalytics(stats);
    } finally {
      setRefreshing(false);
    }
  };

  const kpis = useMemo(() => {
    const activeUsers = users.filter((u) => u.status === 'active').length;
    const suspendedUsers = users.filter((u) => u.status === 'suspended').length;
    const totalWalletBalance = wallets.reduce((s, w) => s + (w.availableBalanceBdt || 0), 0);
    const pendingWithdrawals = withdrawals.filter(
      (w) => w.status === 'Pending' || w.status === 'Approved' || w.status === 'Processing'
    );
    const pendingWithdrawalAmount = pendingWithdrawals.reduce((s, w) => s + (w.amountBdt || 0), 0);
    const paidWithdrawals = withdrawals.filter((w) => w.status === 'Paid');
    const paidWithdrawalAmount = paidWithdrawals.reduce((s, w) => s + (w.amountBdt || 0), 0);
    const pendingDeposits = walletTxs.filter(
      (tx) => tx.type === 'deposit' && tx.status === 'Verification Pending'
    ).length;
    const pendingOrders = orders.filter(
      (o) => o.status === 'Pending Payment' || o.status === 'Verification Pending' || o.status === 'Processing'
    ).length;
    const creditedReferralBdt = referrals
      .filter((r) => r.status === 'credited')
      .reduce((s, r) => s + (r.rewardAmountBdt || 0), 0);
    return {
      totalUsers: users.length,
      activeUsers,
      suspendedUsers,
      totalWalletBalance,
      pendingWithdrawalCount: pendingWithdrawals.length,
      pendingWithdrawalAmount,
      paidWithdrawalCount: paidWithdrawals.length,
      paidWithdrawalAmount,
      pendingDeposits,
      pendingOrders,
      totalReferrals: referrals.length,
      creditedReferralBdt,
      adImpressions: adAnalytics?.totalImpressions || 0,
      adClicks: adAnalytics?.totalClicks || 0,
    };
  }, [users, wallets, withdrawals, walletTxs, orders, referrals, adAnalytics]);

  if (serverVerifiedAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 px-6 py-5 text-xs font-bold text-[#777777]">
          {lang === 'bn' ? 'সার্ভার অ্যাডমিন অনুমতি যাচাই করা হচ্ছে...' : 'Verifying server-side Super Admin session...'}
        </div>
      </div>
    );
  }

  if (!user || !isAdmin || !serverVerifiedAdmin) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-950/50 text-[#DC2626] flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-lg font-extrabold text-[#172033] dark:text-slate-100">
            {lang === 'bn' ? 'অ্যাডমিন অনুমতি নেই' : 'Restricted Super Admin Area'}
          </h2>
          <p className="text-xs text-[#777777] dark:text-slate-400">
            {lang === 'bn'
              ? 'এই ড্যাশবোর্ড শুধুমাত্র সার্ভার-ভেরিফায়েড সুপার অ্যাডমিনের জন্য সংরক্ষিত।'
              : 'This dashboard requires a server-verified Super Admin or Admin session.'}
          </p>
          {onBackToStore && (
            <button
              type="button"
              onClick={onBackToStore}
              className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold"
            >
              {lang === 'bn' ? 'হোমপেজে ফিরে যান' : 'Return to Storefront'}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Exact 12 primary navigation tabs (+ Logout as item #13, plus Storefront & Orders workspace)
  const navItems: Array<{
    id: AdminSection;
    label: string;
    labelBn: string;
    icon: typeof LayoutDashboard;
    badge?: number;
  }> = [
    { id: 'overview', label: 'Overview', labelBn: 'ওভারভিউ', icon: LayoutDashboard },
    { id: 'users', label: 'Users', labelBn: 'ইউজার ম্যানেজমেন্ট', icon: Users, badge: kpis.totalUsers },
    {
      id: 'wallets',
      label: 'Wallet & Balances',
      labelBn: 'ওয়ালেট ও ব্যালেন্স',
      icon: Wallet,
      badge: kpis.pendingDeposits || undefined,
    },
    { id: 'transactions', label: 'Transactions', labelBn: 'লেনদেন লেজার', icon: FileText },
    {
      id: 'withdrawals',
      label: 'Withdrawals',
      labelBn: 'উইথড্রয়াল',
      icon: ArrowDownToLine,
      badge: kpis.pendingWithdrawalCount || undefined,
    },
    { id: 'referrals', label: 'Referrals', labelBn: 'রেফারেল প্রোগ্রাম', icon: Gift },
    { id: 'advertisements', label: 'Advertisements', labelBn: 'বিজ্ঞাপন ও ব্যানার', icon: Megaphone },
    { id: 'payment_methods', label: 'Payment Methods', labelBn: 'পেমেন্ট মেথড', icon: CreditCard },
    { id: 'notifications', label: 'Notifications', labelBn: 'নোটিফিকেশন', icon: Bell },
    { id: 'settings', label: 'Website Settings', labelBn: 'ওয়েবসাইট সেটিংস', icon: Settings },
    { id: 'security', label: 'Security', labelBn: 'সিকিউরিটি', icon: Lock },
    { id: 'activity_logs', label: 'Activity Logs', labelBn: 'অ্যাক্টিভিটি লগ', icon: Activity },
  ];

  const activeNavMeta =
    navItems.find((n) => n.id === section) ||
    (section === 'storefront'
      ? { label: 'Storefront & Orders', labelBn: 'স্টোরফ্রন্ট ও অর্ডার' }
      : navItems[0]);

  const renderSidebarNav = () => (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-[#E6ECFA] dark:border-slate-800 flex items-center justify-between gap-2">
        <DigitalHubLogo compact siteName={settings.siteName} logoUrl={settings.logoUrl} />
        <button
          type="button"
          onClick={() => setMobileMenuOpen(false)}
          className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Super Admin Identity Strip */}
      <div className="px-4 py-3 border-b border-[#E6ECFA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-800/40">
        <div className="flex items-center gap-2">
          <span className="w-8 h-8 rounded-xl bg-[#172033] dark:bg-[#FF8500] text-white flex items-center justify-center font-extrabold text-xs shrink-0">
            <Shield className="w-4 h-4" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-extrabold text-[#172033] dark:text-slate-100 truncate">
              {user.role === 'super_admin' ? 'Super Admin' : 'Administrator'}
            </p>
            <p className="text-[10px] font-mono-num text-[#777777] dark:text-slate-400 truncate">
              {user.email || user.phone}
            </p>
          </div>
        </div>
      </div>

      {/* 12 Primary Items + Storefront + Logout (#13) */}
      <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = section === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setSection(item.id);
                setMobileMenuOpen(false);
              }}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between gap-2 transition-colors ${
                active
                  ? 'bg-[#FF8500] text-white shadow-xs'
                  : 'text-[#172033] dark:text-slate-300 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
              }`}
            >
              <span className="flex items-center gap-2.5 min-w-0">
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-slate-500 dark:text-slate-400'}`} />
                <span className="truncate">{lang === 'bn' ? item.labelBn : item.label}</span>
              </span>
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono-num font-extrabold ${
                    active
                      ? 'bg-white/20 text-white'
                      : 'bg-[#FFF3E5] dark:bg-orange-950/50 text-[#FF8500]'
                  }`}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}

        <div className="pt-2 mt-2 border-t border-[#E6ECFA] dark:border-slate-800 space-y-1">
          <button
            type="button"
            onClick={() => {
              setSection('storefront');
              setMobileMenuOpen(false);
            }}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between gap-2 transition-colors ${
              section === 'storefront'
                ? 'bg-[#FF8500] text-white'
                : 'text-[#172033] dark:text-slate-300 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
            }`}
          >
            <span className="flex items-center gap-2.5">
              <ShoppingBag className="w-4 h-4 shrink-0" />
              <span>{lang === 'bn' ? 'স্টোরফ্রন্ট ও অর্ডার' : 'Storefront & Orders'}</span>
            </span>
            {kpis.pendingOrders > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-mono-num font-extrabold bg-amber-100 text-amber-800">
                {kpis.pendingOrders}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setLogoutConfirmOpen(true)}
            className="w-full px-3 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2.5 text-[#DC2626] hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
          >
            <LogOut className="w-4 h-4 shrink-0" />
            <span>{lang === 'bn' ? 'লগআউট' : 'Logout'}</span>
          </button>
        </div>
      </nav>
    </div>
  );

  return (
    <div className="min-h-screen flex bg-[#F3F6FF] dark:bg-slate-950 text-[#172033] dark:text-slate-100">
      {/* Desktop Fixed Sidebar */}
      <aside className="hidden lg:block w-[264px] shrink-0 bg-white dark:bg-slate-900 border-r border-[#E6ECFA] dark:border-slate-800 sticky top-0 h-screen">
        {renderSidebarNav()}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-[270px] max-w-[82vw] bg-white dark:bg-slate-900 h-full shadow-2xl border-r border-[#E6ECFA] dark:border-slate-800">
            {renderSidebarNav()}
          </div>
          <div
            className="flex-1 bg-slate-950/50 backdrop-blur-xs"
            onClick={() => setMobileMenuOpen(false)}
          />
        </div>
      )}

      {/* Workspace Main Column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Sticky Top Admin Toolbar */}
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-[#E6ECFA] dark:border-slate-800 px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 text-[#172033] dark:text-slate-200"
              aria-label="Open menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-extrabold text-[#172033] dark:text-slate-100 truncate">
                {lang === 'bn' ? activeNavMeta.labelBn : activeNavMeta.label}
              </h1>
              {settings.maintenanceMode && (
                <p className="text-[10px] font-extrabold text-[#DC2626] uppercase tracking-wider">
                  Maintenance Mode Active
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleRefresh()}
              className="px-3 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-bold inline-flex items-center gap-1.5 hover:border-[#FF8500]"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#FF8500] ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{lang === 'bn' ? 'রিফ্রেশ' : 'Refresh'}</span>
            </button>

            {setLang && (
              <button
                type="button"
                onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}
                className="px-2.5 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-bold"
              >
                {lang === 'bn' ? 'EN' : 'বাংলা'}
              </button>
            )}

            {onToggleTheme && (
              <button
                type="button"
                onClick={onToggleTheme}
                aria-label="Toggle theme"
                className="p-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-amber-300"
              >
                {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
            )}

            {onBackToStore && (
              <button
                type="button"
                onClick={onBackToStore}
                className="px-3 py-1.5 rounded-xl bg-[#172033] dark:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 hover:bg-[#FF8500] transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span className="hidden md:inline">{lang === 'bn' ? 'স্টোরফ্রন্ট' : 'Storefront'}</span>
              </button>
            )}
          </div>
        </header>

        {/* Feedback Banners */}
        <div className="px-4 sm:px-6 pt-4 space-y-2 max-w-[1440px] w-full mx-auto">
          {notice && (
            <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400 text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}
          {errMsg && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[#DC2626] text-xs font-bold flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{errMsg}</span>
            </div>
          )}
        </div>

        {/* Section Body */}
        <div className="p-4 sm:p-6 max-w-[1440px] w-full mx-auto space-y-6 flex-1">
          {section === 'overview' && (
            <div className="space-y-6">
              {/* Primary 8 KPI Cards (100% Real DB Metrics) */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
                {[
                  {
                    label: lang === 'bn' ? 'মোট ইউজার' : 'Total Users',
                    val: kpis.totalUsers.toLocaleString(),
                    sub: `${kpis.activeUsers} active · ${kpis.suspendedUsers} suspended`,
                    tone: 'text-[#172033] dark:text-slate-100',
                    target: 'users' as AdminSection,
                  },
                  {
                    label: lang === 'bn' ? 'মোট ইউজার ব্যালেন্স' : 'Total User Balances',
                    val: `৳${kpis.totalWalletBalance.toLocaleString()}`,
                    sub: `${kpis.pendingDeposits} pending deposit(s)`,
                    tone: 'text-[#FF8500]',
                    target: 'wallets' as AdminSection,
                  },
                  {
                    label: lang === 'bn' ? 'পেন্ডিং উইথড্রয়াল' : 'Pending Withdrawals',
                    val: `${kpis.pendingWithdrawalCount}`,
                    sub: `৳${kpis.pendingWithdrawalAmount.toLocaleString()} awaiting payout`,
                    tone: 'text-amber-600 dark:text-amber-400',
                    target: 'withdrawals' as AdminSection,
                  },
                  {
                    label: lang === 'bn' ? 'মোট পেইড উইথড্রয়াল' : 'Paid Withdrawals',
                    val: `৳${kpis.paidWithdrawalAmount.toLocaleString()}`,
                    sub: `${kpis.paidWithdrawalCount} completed payouts`,
                    tone: 'text-emerald-600 dark:text-emerald-400',
                    target: 'withdrawals' as AdminSection,
                  },
                  {
                    label: lang === 'bn' ? 'মোট রেফারেল' : 'Total Referrals',
                    val: `${kpis.totalReferrals}`,
                    sub: `৳${kpis.creditedReferralBdt.toLocaleString()} credited`,
                    tone: 'text-[#172033] dark:text-slate-100',
                    target: 'referrals' as AdminSection,
                  },
                  {
                    label: lang === 'bn' ? 'বিজ্ঞাপন ভিউ ও ক্লিক' : 'Ad Views / Clicks',
                    val: `${kpis.adImpressions.toLocaleString()} / ${kpis.adClicks.toLocaleString()}`,
                    sub: `CTR ${adAnalytics?.ctr ?? 0}% (D1 verified)`,
                    tone: 'text-[#FF8500]',
                    target: 'advertisements' as AdminSection,
                  },
                  {
                    label: lang === 'bn' ? 'মোট লেনদেন' : 'Total Transactions',
                    val: walletTxs.length.toLocaleString(),
                    sub: `${payments.length} order payments`,
                    tone: 'text-[#172033] dark:text-slate-100',
                    target: 'transactions' as AdminSection,
                  },
                  {
                    label: lang === 'bn' ? 'স্টোর অর্ডার' : 'Storefront Orders',
                    val: orders.length.toLocaleString(),
                    sub: `${kpis.pendingOrders} pending processing`,
                    tone: 'text-emerald-600 dark:text-emerald-400',
                    target: 'storefront' as AdminSection,
                  },
                ].map((kpi) => (
                  <button
                    key={kpi.label}
                    type="button"
                    onClick={() => setSection(kpi.target)}
                    className="text-left rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 hover:border-[#FF8500] transition-colors"
                  >
                    <p className="text-[11px] font-semibold text-[#777777] dark:text-slate-400">{kpi.label}</p>
                    <p className={`text-xl sm:text-2xl font-extrabold font-mono-num mt-1 ${kpi.tone}`}>
                      {kpi.val}
                    </p>
                    <p className="text-[11px] text-[#777777] dark:text-slate-400 mt-1 truncate">{kpi.sub}</p>
                  </button>
                ))}
              </div>

              {/* Real Database Charts */}
              <AdminCharts
                lang={lang}
                users={users}
                wallets={wallets}
                walletTxs={walletTxs}
                withdrawals={withdrawals}
                orders={orders}
              />

              {/* Bottom 2-Col: Recent Withdrawals & Recent Audit Logs */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
                      {lang === 'bn' ? 'সাম্প্রতিক উইথড্রয়াল' : 'Recent Withdrawal Requests'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setSection('withdrawals')}
                      className="text-xs font-bold text-[#FF8500] hover:underline"
                    >
                      Manage All →
                    </button>
                  </div>
                  {withdrawals.length === 0 ? (
                    <p className="text-xs text-[#777777] py-4 text-center">No withdrawals submitted yet.</p>
                  ) : (
                    <div className="divide-y divide-[#E6ECFA] dark:divide-slate-800 text-xs">
                      {withdrawals.slice(0, 5).map((w) => (
                        <div key={w.id} className="py-2.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-[#172033] dark:text-slate-100 truncate">
                              {w.userName || w.userEmail}
                            </p>
                            <p className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400">
                              {(w.methodName || w.method).toUpperCase()} · {w.accountNumber}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono-num font-extrabold text-[#FF8500]">৳{w.amountBdt}</p>
                            <span className="text-[10px] font-bold text-[#777777]">{w.status}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
                      {lang === 'bn' ? 'সাম্প্রতিক অডিট লগ' : 'Recent Admin Activity'}
                    </h3>
                    <button
                      type="button"
                      onClick={() => setSection('activity_logs')}
                      className="text-xs font-bold text-[#FF8500] hover:underline"
                    >
                      Full Audit Log →
                    </button>
                  </div>
                  {auditLogs.length === 0 ? (
                    <p className="text-xs text-[#777777] py-4 text-center">No audit events recorded yet.</p>
                  ) : (
                    <div className="divide-y divide-[#E6ECFA] dark:divide-slate-800 text-xs">
                      {auditLogs.slice(0, 5).map((log) => (
                        <div key={log.id} className="py-2.5 flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-[#172033] dark:text-slate-100 truncate">
                              {log.reason || log.summary}
                            </p>
                            <p className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400">
                              {log.action} · {log.actorEmail || log.actorUid}
                            </p>
                          </div>
                          <span className="text-[10px] text-[#777777] shrink-0">
                            {formatDateShort(log.createdAt, lang)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {section === 'users' && (
            <AdminUsersPanel
              lang={lang}
              users={users}
              wallets={wallets}
              superAdminEmail={superAdminEmail}
              onSuccess={showSuccess}
              onError={showError}
            />
          )}

          {section === 'wallets' && (
            <AdminWalletsPanel
              lang={lang}
              users={users}
              wallets={wallets}
              walletTxs={walletTxs}
              onSuccess={showSuccess}
              onError={showError}
            />
          )}

          {section === 'transactions' && (
            <AdminTransactionsPanel
              lang={lang}
              users={users}
              walletTxs={walletTxs}
              payments={payments}
            />
          )}

          {section === 'withdrawals' && (
            <AdminWithdrawalsPanel
              lang={lang}
              withdrawals={withdrawals}
              onSuccess={showSuccess}
              onError={showError}
            />
          )}

          {section === 'referrals' && (
            <AdminReferralsPanel
              lang={lang}
              referrals={referrals}
              settings={settings}
              onSuccess={showSuccess}
              onError={showError}
            />
          )}

          {section === 'advertisements' && (
            <AdminAdsPanel
              lang={lang}
              advertisements={advertisements}
              managedAdUnits={managedAdUnits}
              banners={banners}
              rewardClaims={rewardClaims}
              adRewardTransactions={adRewardTransactions}
              onSuccess={showSuccess}
              onError={showError}
            />
          )}

          {section === 'payment_methods' && (
            <AdminPaymentMethodsPanel
              lang={lang}
              paymentMethods={paymentMethods}
              onSuccess={showSuccess}
              onError={showError}
            />
          )}

          {section === 'notifications' && (
            <AdminNotificationsPanel
              lang={lang}
              users={users}
              announcements={announcements}
              onSuccess={showSuccess}
              onError={showError}
            />
          )}

          {section === 'settings' && (
            <AdminSettingsPanel
              lang={lang}
              settings={settings}
              onSuccess={showSuccess}
              onError={showError}
            />
          )}

          {section === 'security' && (
            <AdminSecurityPanel lang={lang} onSuccess={showSuccess} onError={showError} />
          )}

          {section === 'activity_logs' && (
            <AdminActivityLogsPanel lang={lang} auditLogs={auditLogs} />
          )}

          {section === 'storefront' && (
            <AdminStorefrontPanel
              lang={lang}
              orders={orders}
              payments={payments}
              products={products}
              categories={categories}
              coupons={coupons}
              tickets={tickets}
              reviews={reviews}
              onSuccess={showSuccess}
              onError={showError}
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={logoutConfirmOpen}
        lang={lang}
        title={lang === 'bn' ? 'অ্যাডমিন প্যানেল থেকে লগআউট করবেন?' : 'Sign Out of Super Admin Dashboard?'}
        description={
          lang === 'bn'
            ? 'আপনার বর্তমান সেশন নিরাপদে বন্ধ হয়ে যাবে।'
            : 'Your active HTTP-only administrator session will be cleared securely.'
        }
        tone="warning"
        confirmLabel={lang === 'bn' ? 'লগআউট করুন' : 'Logout'}
        onCancel={() => setLogoutConfirmOpen(false)}
        onConfirm={async () => {
          setLogoutConfirmOpen(false);
          await onLogout();
        }}
      />
    </div>
  );
}
