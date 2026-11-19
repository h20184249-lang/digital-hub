import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  Award,
  BarChart3,
  Bell,
  CheckCircle2,
  Coins,
  CreditCard,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  Flame,
  FolderTree,
  Gift,
  Image as ImageIcon,
  Layers,
  LayoutDashboard,
  Lock,
  LogOut,
  Megaphone,
  MessageSquare,
  Package,
  Plus,
  PlusCircle,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShoppingBag,
  Star,
  Tag,
  Trash2,
  Upload,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  AdFormat,
  AdNetworkConfig,
  AdNetworkProvider,
  AdPlacementSlot,
  AdRevenueEntry,
  AdRewardTransaction,
  Advertisement,
  AdViewingSession,
  Announcement,
  AdPlacement,
  AuditLog,
  AuthUser,
  Banner,
  BannerSlot,
  Category,
  Coupon,
  Language,
  ManagedAdUnitConfig,
  Order,
  OrderFormType,
  OrderStatus,
  Payment,
  PaymentMethod,
  Product,
  ProductPackage,
  ProductSectionTag,
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
import { t } from '../lib/i18n';
import { apiUrl } from '../lib/apiClient';
import { resolveStudioImage, STUDIO_IMAGES } from '../lib/studioAssets';
import { AD_PLACEMENT_LABELS, ALL_AD_PLACEMENT_SLOTS } from '../lib/adProviderConfig';
import { getManagedUnitStatusSnapshot, ManagedUnitRuntimeStatus, subscribeManagedUnitStatuses } from './AdUnitFrame';
import {
  BRAND_META,
  PAYMENT_BRAND_META,
  PaymentProviderLogo,
  ProductVisualArtwork,
  resolvePaymentLogoUrl,
  ServiceBrandLogo,
} from './BrandLogos';
import {
  adminAddAdRevenueEntry,
  adminAdjustWalletBalance,
  adminBroadcastAnnouncementServer,
  adminCompleteOrderWithRewardsServer,
  adminDeleteAdNetwork,
  adminDeleteAdRevenueEntry,
  adminDeleteAdvertisement,
  adminDeleteAnnouncement,
  adminDeleteBanner,
  adminDeleteCategory,
  adminDeleteCoupon,
  adminDeleteProduct,
  adminDeleteReview,
  adminMigratePhase1Server,
  adminProcessWithdrawalServer,
  adminQuickUpdatePackage,
  adminRefundAndCancelOrderServer,
  adminReplyTicket,
  adminSaveAdNetwork,
  adminSaveAdvertisement,
  adminSaveBanner,
  adminSaveCategory,
  adminSaveCoupon,
  adminSaveManagedAdUnit,
  adminSaveProduct,
  adminSaveSiteSettings,
  adminSendPromoReward,
  adminSettleCoinRedemptionServer,
  adminSettleReferralServer,
  adminSettleRewardClaimServer,
  adminToggleAnnouncementActive,
  adminToggleReviewApproval,
  adminUpdateOrderStatus,
  adminUpdateReferralStatus,
  adminUpdateUserStatusServer,
  adminVerifyAddMoneyServer,
  adminVerifyPaymentServer,
  compressImageToDataUrl,
  formatDateShort,
  generateId,
  getTimeMs,
  seedMarketplaceToFirestore,
  subscribeAdRevenueEntries,
  subscribeAllAdRewardTransactions,
  subscribeAllAdminCollections,
  subscribeAllAnnouncements,
  subscribeAllRewardedClaims,
  subscribeAllViewingSessions,
  subscribeAllWithdrawals,
  verifyOwnerAdminServer,
} from '../lib/firestoreService';

interface AdminDashboardProps {
  lang: Language;
  user: AuthUser | null;
  isAdmin: boolean;
  onLogout: () => Promise<void>;
  categories: Category[];
  products: Product[];
  advertisements: Advertisement[];
  adNetworks: AdNetworkConfig[];
  managedAdUnits: ManagedAdUnitConfig[];
  banners: Banner[];
  settings: SiteSettings;
}

type AdminSection =
  | 'overview'
  | 'customers'
  | 'products'
  | 'packages'
  | 'categories'
  | 'orders'
  | 'payments'
  | 'add_money'
  | 'wallets'
  | 'withdrawals'
  | 'ads'
  | 'banners'
  | 'ad_analytics'
  | 'referrals'
  | 'coupons'
  | 'announcements'
  | 'tickets'
  | 'reviews'
  | 'content'
  | 'reports'
  | 'settings'
  | 'security';

export function AdminDashboard({
  lang,
  user,
  isAdmin,
  onLogout,
  categories,
  products,
  advertisements,
  adNetworks,
  managedAdUnits,
  banners,
  settings,
}: AdminDashboardProps) {
  const [section, setSection] = useState<AdminSection>('overview');
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
  const [adRevenueEntries, setAdRevenueEntries] = useState<AdRevenueEntry[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [rewardClaims, setRewardClaims] = useState<RewardedAdClaim[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [viewingSessions, setViewingSessions] = useState<AdViewingSession[]>([]);
  const [adRewardTransactions, setAdRewardTransactions] = useState<AdRewardTransaction[]>([]);
  const [unitStatuses, setUnitStatuses] = useState<Record<string, ManagedUnitRuntimeStatus>>(() =>
    getManagedUnitStatusSnapshot()
  );
  const [unitDrafts, setUnitDrafts] = useState<Record<string, ManagedAdUnitConfig>>({});
  const [sessionFilter, setSessionFilter] = useState<'all' | 'verification_failed' | 'credited' | 'awaiting_callback'>('all');
  const [adAnalytics, setAdAnalytics] = useState<ServerAdAnalytics | null>(null);
  const [serverVerifiedAdmin, setServerVerifiedAdmin] = useState<boolean | null>(null);

  const [notice, setNotice] = useState('');
  const [errMsg, setErrMsg] = useState('');
  const [migratingPhase1, setMigratingPhase1] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [prodSearch, setProdSearch] = useState('');
  const [txFilterType, setTxFilterType] = useState('all');
  const [txSearch, setTxSearch] = useState('');
  const [busyId, setBusyId] = useState('');
  const [reauthBusy, setReauthBusy] = useState(false);
  const [rejectionReasons, setRejectionReasons] = useState<Record<string, string>>({});
  const [payoutRefs, setPayoutRefs] = useState<Record<string, string>>({});
  const [orderNotes, setOrderNotes] = useState<Record<string, string>>({});
  const [ticketReplies, setTicketReplies] = useState<Record<string, string>>({});
  const [payStatusFilter, setPayStatusFilter] = useState<'all' | 'Verification Pending' | 'Approved' | 'Rejected'>('all');
  const [payMethodFilter, setPayMethodFilter] = useState<'all' | PaymentMethod>('all');
  const [paySearch, setPaySearch] = useState('');
  const [receiptLightboxUrl, setReceiptLightboxUrl] = useState('');
  const [savingPaymentSettings, setSavingPaymentSettings] = useState(false);

  // Product editor state
  const [editingProd, setEditingProd] = useState<Product | null>(null);
  const [prodTitleBn, setProdTitleBn] = useState('');
  const [prodTitleEn, setProdTitleEn] = useState('');
  const [prodCat, setProdCat] = useState('cat_gaming');
  const [prodSubcatBn, setProdSubcatBn] = useState('');
  const [prodSubcatEn, setProdSubcatEn] = useState('');
  const [prodBrandKey, setProdBrandKey] = useState('freefire');
  const [prodPrice, setProdPrice] = useState('145');
  const [prodOrigPrice, setProdOrigPrice] = useState('165');
  const [prodDiscount, setProdDiscount] = useState('12');
  const [prodTag, setProdTag] = useState<ProductSectionTag>('standard');
  const [prodAvail, setProdAvail] = useState<Product['availability']>('in_stock');
  const [prodStockCount, setProdStockCount] = useState('100');
  const [prodOrderFormType, setProdOrderFormType] = useState<OrderFormType>('subscription');
  const [prodDurBn, setProdDurBn] = useState('৫ - ১৫ মিনিট');
  const [prodDurEn, setProdDurEn] = useState('5 - 15 mins');
  const [prodValidityBn, setProdValidityBn] = useState('');
  const [prodValidityEn, setProdValidityEn] = useState('');
  const [prodDescBn, setProdDescBn] = useState('');
  const [prodDescEn, setProdDescEn] = useState('');
  const [prodInstrEn, setProdInstrEn] = useState('');
  const [prodBenefitsEn, setProdBenefitsEn] = useState('');
  const [prodTermsEn, setProdTermsEn] = useState('');
  const [prodImg, setProdImg] = useState<string>(STUDIO_IMAGES.gameBattle);
  const [prodBannerUrl, setProdBannerUrl] = useState('');
  const [prodCustomLogoUrl, setProdCustomLogoUrl] = useState('');
  const [prodFeatured, setProdFeatured] = useState(false);
  const [prodPackages, setProdPackages] = useState<ProductPackage[]>([]);

  // Package Management workspace state
  const [editingPkgProd, setEditingPkgProd] = useState<Product | null>(null);
  const [pkgNameEn, setPkgNameEn] = useState('');
  const [pkgNameBn, setPkgNameBn] = useState('');
  const [pkgCategory, setPkgCategory] = useState('cat_gaming');
  const [pkgPrice, setPkgPrice] = useState('');
  const [pkgOrigPrice, setPkgOrigPrice] = useState('');
  const [pkgDescEn, setPkgDescEn] = useState('');
  const [pkgDescBn, setPkgDescBn] = useState('');
  const [pkgDurationEn, setPkgDurationEn] = useState('1 Month');
  const [pkgDeliveryEn, setPkgDeliveryEn] = useState('5 - 15 mins');
  const [pkgFeaturesEn, setPkgFeaturesEn] = useState('');
  const [pkgImageUrl, setPkgImageUrl] = useState<string>('/assets/products/prod_ff_bd_diamonds.jpg');
  const [pkgAvailability, setPkgAvailability] = useState<Product['availability']>('in_stock');
  const [pkgStockCount, setPkgStockCount] = useState('100');
  const [pkgDisplayOrder, setPkgDisplayOrder] = useState('1');
  const [pkgPopular, setPkgPopular] = useState(true);
  const [pkgActive, setPkgActive] = useState(true);
  const [pkgSectionTag, setPkgSectionTag] = useState<ProductSectionTag>('hot_product');
  const [pkgSearchQuery, setPkgSearchQuery] = useState('');
  const [pkgCatFilter, setPkgCatFilter] = useState('all');
  const [pkgStatusFilter, setPkgStatusFilter] = useState<'all' | 'active' | 'inactive' | 'featured'>('all');
  const [confirmDeletePkg, setConfirmDeletePkg] = useState<Product | null>(null);
  const [pkgOrderEdits, setPkgOrderEdits] = useState<Record<string, string>>({});
  const [pkgBusy, setPkgBusy] = useState(false);

  // Wallet balance adjustment modal state
  const [walletAdjTarget, setWalletAdjTarget] = useState<{
    uid: string;
    email?: string;
    name?: string;
  } | null>(null);
  const [walletAdjMode, setWalletAdjMode] = useState<'add' | 'deduct' | 'set'>('add');
  const [walletAdjAmount, setWalletAdjAmount] = useState('100');
  const [walletAdjNote, setWalletAdjNote] = useState('');
  const [walletAdjBusy, setWalletAdjBusy] = useState(false);

  // Category editor state
  const [editingCat, setEditingCat] = useState<Category | null>(null);
  const [catNameBn, setCatNameBn] = useState('');
  const [catNameEn, setCatNameEn] = useState('');
  const [catSlug, setCatSlug] = useState('');
  const [catOrder, setCatOrder] = useState('1');

  // Ad editor state
  const [editingAd, setEditingAd] = useState<Advertisement | null>(null);
  const [adCode, setAdCode] = useState('AD07');
  const [adTitleBn, setAdTitleBn] = useState('');
  const [adTitleEn, setAdTitleEn] = useState('');
  const [adDescBn, setAdDescBn] = useState('');
  const [adDescEn, setAdDescEn] = useState('');
  const [adUrl, setAdUrl] = useState('');
  const [adPlacement, setAdPlacement] = useState<AdPlacement>('all');
  const [adFormat, setAdFormat] = useState<AdFormat>('direct_link');
  const [adNetworkName, setAdNetworkName] = useState('Direct Partner');
  const [adMediaType, setAdMediaType] = useState<'external' | 'video'>('external');
  const [adMediaUrl, setAdMediaUrl] = useState('');
  const [adThumb, setAdThumb] = useState<string>(STUDIO_IMAGES.bannerVip);
  const [adOrder, setAdOrder] = useState('1');

  // Official Ad Network Script Manager state
  const [editingNet, setEditingNet] = useState<AdNetworkConfig | null>(null);
  const [netProvider, setNetProvider] = useState<AdNetworkProvider>('adsense');
  const [netName, setNetName] = useState('');
  const [netFormat, setNetFormat] = useState<'banner' | 'native' | 'social_bar'>('banner');
  const [netPlacement, setNetPlacement] = useState<BannerSlot | 'social_bar' | 'all'>('home_top');
  const [netPublisherId, setNetPublisherId] = useState('');
  const [netZoneId, setNetZoneId] = useState('');
  const [netScriptSrc, setNetScriptSrc] = useState('');
  const [netContainerId, setNetContainerId] = useState('');
  const [netSupportsRewards, setNetSupportsRewards] = useState(false);
  const [netApproval, setNetApproval] = useState<AdNetworkConfig['approvalStatus']>('pending_approval');

  // Global announcement broadcast draft state
  const [annTitleBn, setAnnTitleBn] = useState('');
  const [annTitleEn, setAnnTitleEn] = useState('');
  const [annMsgBn, setAnnMsgBn] = useState('');
  const [annMsgEn, setAnnMsgEn] = useState('');
  const [annType, setAnnType] = useState<Announcement['type']>('info');

  // Verified Ad Revenue Ledger form state
  const [revNetworkName, setRevNetworkName] = useState('Google AdSense');
  const [revPeriodLabel, setRevPeriodLabel] = useState('');
  const [revAmountBdt, setRevAmountBdt] = useState('');
  const [revUsd, setRevUsd] = useState('');
  const [revRefId, setRevRefId] = useState('');

  // Banner editor state
  const [editingBanner, setEditingBanner] = useState<Banner | null>(null);
  const [banTitleBn, setBanTitleBn] = useState('');
  const [banTitleEn, setBanTitleEn] = useState('');
  const [banSlot, setBanSlot] = useState<BannerSlot>('home_top');
  const [banUrl, setBanUrl] = useState('');
  const [banImg, setBanImg] = useState<string>(STUDIO_IMAGES.bannerVip);
  const [banMobileImg, setBanMobileImg] = useState('');
  const [banOrder, setBanOrder] = useState('1');

  // Coupon editor state
  const [coupCode, setCoupCode] = useState('');
  const [coupType, setCoupType] = useState<'fixed' | 'percent'>('fixed');
  const [coupVal, setCoupVal] = useState('50');
  const [coupMin, setCoupMin] = useState('300');
  const [coupLimit, setCoupLimit] = useState('200');
  const [coupExp, setCoupExp] = useState('2027-12-31');

  // Settings & Content form state
  const [settingsDraft, setSettingsDraft] = useState<SiteSettings>(settings);

  useEffect(() => {
    setSettingsDraft(settings);
  }, [settings]);

  useEffect(() => {
    let active = true;
    if (!user || !isAdmin) {
      setServerVerifiedAdmin(false);
      return;
    }
    setServerVerifiedAdmin(null);
    verifyOwnerAdminServer()
      .then((ok) => {
        if (active) setServerVerifiedAdmin(ok);
      })
      .catch(() => {
        if (active) setServerVerifiedAdmin(false);
      });
    return () => {
      active = false;
    };
  }, [user, isAdmin]);

  useEffect(() => {
    if (!isAdmin || !user || serverVerifiedAdmin !== true) return;
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
    const unsubRev = subscribeAdRevenueEntries(setAdRevenueEntries);
    const unsubWdr = subscribeAllWithdrawals(setWithdrawals);
    const unsubRewards = subscribeAllRewardedClaims(setRewardClaims);
    const unsubAnn = subscribeAllAnnouncements(setAnnouncements);
    const unsubSessions = subscribeAllViewingSessions(setViewingSessions);
    const unsubRewardTxs = subscribeAllAdRewardTransactions(setAdRewardTransactions);
    const unsubTelemetry = subscribeManagedUnitStatuses(() => {
      setUnitStatuses(getManagedUnitStatusSnapshot());
    });
    return () => {
      unsubs.forEach((u) => u());
      unsubRev();
      unsubWdr();
      unsubRewards();
      unsubAnn();
      unsubSessions();
      unsubRewardTxs();
      unsubTelemetry();
    };
  }, [isAdmin, user, serverVerifiedAdmin]);

  const loadAnalytics = async () => {
    if (!user) return;
    try {
      const resp = await fetch(apiUrl('/api/ads/analytics'), {
        credentials: 'include',
      });
      if (resp.ok) {
        setAdAnalytics((await resp.json()) as ServerAdAnalytics);
      }
    } catch {
      // Non-fatal
    }
  };

  useEffect(() => {
    if (isAdmin && user && serverVerifiedAdmin === true) {
      loadAnalytics();
    }
  }, [isAdmin, user, section, serverVerifiedAdmin]);

  const metrics = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400000;
    const newCustomers = users.filter((u) => getTimeMs(u.createdAt) >= weekAgo).length;
    const verifiedOrders = orders.filter((o) =>
      ['Paid', 'Payment Approved', 'Processing', 'Completed'].includes(o.status)
    );
    const verifiedRevenue = verifiedOrders.reduce((s, o) => s + (o.totalPriceBdt || 0), 0);
    const pendingOrders = orders.filter(
      (o) => o.status === 'Verification Pending' || o.status === 'Pending Payment'
    ).length;
    const completedOrders = orders.filter((o) => o.status === 'Completed').length;
    const pendingPayments = payments.filter((p) => p.status === 'Verification Pending').length;
    const pendingDeposits = walletTxs.filter(
      (w) => w.type === 'deposit' && w.status === 'Verification Pending'
    ).length;
    const pendingWithdrawals = withdrawals.filter((w) => w.status === 'Pending').length;
    const approvedWithdrawalsBdt = withdrawals
      .filter((w) => w.status === 'Approved')
      .reduce((s, w) => s + (w.amountBdt || 0), 0);
    const pendingRewardClaims = rewardClaims.filter((c) => c.status === 'Pending Credit').length;
    const totalSalesBdt = orders
      .filter((o) => !['Rejected', 'Cancelled'].includes(o.status))
      .reduce((s, o) => s + (o.totalPriceBdt || 0), 0);
    const totalCashbackPaid = walletTxs
      .filter((w) => w.type === 'cashback' && w.status === 'Approved')
      .reduce((s, w) => s + (w.amountBdt || 0), 0);
    const totalReferralPaid = walletTxs
      .filter((w) => w.type === 'referral' && w.status === 'Approved')
      .reduce((s, w) => s + (w.amountBdt || 0), 0);
    const totalAdRewardsPaid = walletTxs
      .filter((w) => w.type === 'rewarded_ad' && w.status === 'Approved')
      .reduce((s, w) => s + (w.amountBdt || 0), 0);
    const totalExpensesBdt =
      approvedWithdrawalsBdt + totalCashbackPaid + totalReferralPaid + totalAdRewardsPaid;
    const netProfitBdt = verifiedRevenue - totalExpensesBdt;

    return {
      totalCustomers: users.length,
      newCustomers,
      totalProducts: products.length,
      totalOrders: orders.length,
      pendingOrders,
      completedOrders,
      pendingPayments,
      pendingDeposits,
      pendingWithdrawals,
      approvedWithdrawalsBdt,
      pendingRewardClaims,
      totalSalesBdt,
      verifiedRevenue,
      totalCashbackPaid,
      totalReferralPaid,
      totalAdRewardsPaid,
      totalExpensesBdt,
      netProfitBdt,
    };
  }, [users, orders, payments, walletTxs, products, withdrawals, rewardClaims]);

  if (serverVerifiedAdmin === null) {
    return (
      <div className="max-w-xl mx-auto py-16 px-4">
        <div className="dh-card rounded-3xl p-8 text-center space-y-3">
          <Shield className="w-10 h-10 text-[#FF8500] mx-auto animate-pulse" />
          <h2 className="text-lg font-bold text-[#172033]">Verifying Admin Security Session...</h2>
          <p className="text-xs text-[#777777]">Checking backend RBAC session authorization for {user?.phone || user?.email || 'your account'}</p>
        </div>
      </div>
    );
  }

  if (
    !user ||
    !isAdmin ||
    serverVerifiedAdmin !== true
  ) {
    return (
      <div className="max-w-xl mx-auto py-16 px-4">
        <div className="dh-card rounded-3xl p-8 text-center space-y-3 border-red-200">
          <Lock className="w-10 h-10 text-[#DC2626] mx-auto" />
          <h2 className="text-xl font-bold text-[#172033]">403 — Restricted</h2>
          <p className="text-sm text-[#777777]">{t(lang, 'adminAccessDenied')}</p>
        </div>
      </div>
    );
  }

  const showOk = (msg: string) => {
    setErrMsg('');
    setNotice(msg);
    setTimeout(() => setNotice(''), 4000);
  };

  const showErr = (e: unknown) => {
    setNotice('');
    setErrMsg(e instanceof Error ? e.message : 'Action failed');
  };

  const handleSaveProduct = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const cleanedPackages = prodPackages
        .filter((pk) => pk.nameEn.trim() || pk.nameBn.trim())
        .map((pk, idx) => ({
          id: pk.id || `pkg_${idx + 1}`,
          nameBn: (pk.nameBn || pk.nameEn).trim(),
          nameEn: (pk.nameEn || pk.nameBn).trim(),
          priceBdt: Math.max(1, Math.round(Number(pk.priceBdt) || 1)),
          ...(pk.originalPriceBdt && Number(pk.originalPriceBdt) > 0
            ? { originalPriceBdt: Math.round(Number(pk.originalPriceBdt)) }
            : {}),
          ...(pk.tag ? { tag: pk.tag.trim() } : {}),
        }));

      const parsedStock = Math.max(0, Math.round(Number(prodStockCount) || 0));
      const payload: Product = {
        id: editingProd ? editingProd.id : generateId('prod'),
        categoryId: prodCat,
        subcategoryBn: prodSubcatBn.trim() || undefined,
        subcategoryEn: prodSubcatEn.trim() || undefined,
        brandKey: prodBrandKey.trim() || undefined,
        titleBn: prodTitleBn || prodTitleEn,
        titleEn: prodTitleEn || prodTitleBn,
        descriptionBn: prodDescBn || prodDescEn,
        descriptionEn: prodDescEn || prodDescBn,
        priceBdt: Math.max(1, Number(prodPrice) || 1),
        originalPriceBdt: Number(prodOrigPrice) || 0,
        discountPercent: Number(prodDiscount) || 0,
        packages: cleanedPackages.length > 0 ? cleanedPackages : undefined,
        availability: parsedStock === 0 ? 'out_of_stock' : prodAvail,
        stockCount: parsedStock,
        orderFormType: prodOrderFormType,
        deliveryDurationBn: prodDurBn,
        deliveryDurationEn: prodDurEn,
        validityBn: prodValidityBn.trim() || prodValidityEn.trim() || undefined,
        validityEn: prodValidityEn.trim() || prodValidityBn.trim() || undefined,
        instructionsEn: prodInstrEn,
        instructionsBn: prodInstrEn,
        benefitsEn: prodBenefitsEn,
        benefitsBn: prodBenefitsEn,
        termsEn: prodTermsEn,
        termsBn: prodTermsEn,
        sectionTag: prodTag,
        imageUrl: prodImg,
        bannerUrl: prodBannerUrl.trim() || undefined,
        customLogoUrl: prodCustomLogoUrl.trim() || undefined,
        featured: prodFeatured,
        active: true,
      };
      await adminSaveProduct(payload, !editingProd);
      setEditingProd(null);
      setProdTitleBn('');
      setProdTitleEn('');
      setProdSubcatBn('');
      setProdSubcatEn('');
      setProdStockCount('100');
      setProdOrderFormType('subscription');
      setProdBannerUrl('');
      setProdCustomLogoUrl('');
      setProdValidityBn('');
      setProdValidityEn('');
      setProdDescBn('');
      setProdDescEn('');
      setProdInstrEn('');
      setProdBenefitsEn('');
      setProdTermsEn('');
      setProdPackages([]);
      showOk('Product, stock, brand logo, banner & packages saved successfully.');
    } catch (e) {
      showErr(e);
    }
  };

  const resetPackageForm = () => {
    setEditingPkgProd(null);
    setPkgNameEn('');
    setPkgNameBn('');
    setPkgCategory(categories[0]?.id || 'cat_gaming');
    setPkgPrice('');
    setPkgOrigPrice('');
    setPkgDescEn('');
    setPkgDescBn('');
    setPkgDurationEn('1 Month');
    setPkgDeliveryEn('5 - 15 mins');
    setPkgFeaturesEn('');
    setPkgImageUrl('/assets/products/prod_ff_bd_diamonds.jpg');
    setPkgAvailability('in_stock');
    setPkgStockCount('100');
    setPkgDisplayOrder(String((products.reduce((m, p) => Math.max(m, p.sortOrder ?? 0), 0) || 0) + 1));
    setPkgPopular(true);
    setPkgActive(true);
    setPkgSectionTag('hot_product');
  };

  const startEditPackage = (p: Product) => {
    setEditingPkgProd(p);
    setPkgNameEn(p.titleEn);
    setPkgNameBn(p.titleBn);
    setPkgCategory(p.categoryId);
    setPkgPrice(String(p.priceBdt));
    setPkgOrigPrice(p.originalPriceBdt ? String(p.originalPriceBdt) : '');
    setPkgDescEn(p.descriptionEn || '');
    setPkgDescBn(p.descriptionBn || '');
    setPkgDurationEn(p.validityEn || p.deliveryDurationEn || '1 Month');
    setPkgDeliveryEn(p.deliveryDurationEn || '5 - 15 mins');
    setPkgFeaturesEn(p.benefitsEn || '');
    setPkgImageUrl(p.imageUrl || '/assets/products/prod_ff_bd_diamonds.jpg');
    setPkgAvailability(p.availability || 'in_stock');
    setPkgStockCount(String(p.stockCount ?? 100));
    setPkgDisplayOrder(String(p.sortOrder ?? 10));
    setPkgPopular(Boolean(p.featured));
    setPkgActive(p.active !== false);
    setPkgSectionTag(p.sectionTag || 'hot_product');
  };

  const handleSavePackage = async (e: FormEvent) => {
    e.preventDefault();
    const parsedPrice = Math.max(1, Math.round(Number(pkgPrice) || 0));
    if (!pkgNameEn.trim() || !parsedPrice) {
      showErr(new Error('Please enter a package name and valid BDT price.'));
      return;
    }
    setPkgBusy(true);
    try {
      const cat = categories.find((c) => c.id === pkgCategory);
      const parsedOrder = Math.max(0, Math.round(Number(pkgDisplayOrder) || 1));
      const parsedStock = Math.max(0, Math.round(Number(pkgStockCount) || 0));
      const cleanNameEn = pkgNameEn.trim();
      const cleanNameBn = pkgNameBn.trim() || cleanNameEn;
      const cleanDescEn = pkgDescEn.trim() || `${cleanNameEn} — instant verified delivery on DIGITAL HUB.`;
      const cleanDescBn = pkgDescBn.trim() || cleanDescEn;
      const cleanDur = pkgDurationEn.trim() || '1 Month';
      const cleanDelivery = pkgDeliveryEn.trim() || '5 - 15 mins';
      const cleanFeatures = pkgFeaturesEn.trim() || 'Verified authentic fulfillment • Instant order tracking • 24/7 support';
      const payload: Product = {
        ...(editingPkgProd || {}),
        id: editingPkgProd ? editingPkgProd.id : generateId('pkgitem'),
        categoryId: pkgCategory,
        subcategoryBn: editingPkgProd?.subcategoryBn || cat?.nameBn || 'প্যাকেজ',
        subcategoryEn: editingPkgProd?.subcategoryEn || cat?.nameEn || 'Package',
        brandKey: editingPkgProd?.brandKey || 'digitalhub',
        titleBn: cleanNameBn,
        titleEn: cleanNameEn,
        descriptionBn: cleanDescBn,
        descriptionEn: cleanDescEn,
        priceBdt: parsedPrice,
        originalPriceBdt: Number(pkgOrigPrice) > 0 ? Math.round(Number(pkgOrigPrice)) : 0,
        discountPercent: 0,
        availability: parsedStock === 0 ? 'out_of_stock' : pkgAvailability,
        stockCount: parsedStock,
        orderFormType: editingPkgProd?.orderFormType || 'subscription',
        deliveryDurationBn: editingPkgProd?.deliveryDurationBn || cleanDelivery,
        deliveryDurationEn: cleanDelivery,
        validityBn: cleanDur,
        validityEn: cleanDur,
        benefitsBn: editingPkgProd?.benefitsBn || cleanFeatures,
        benefitsEn: cleanFeatures,
        instructionsBn:
          editingPkgProd?.instructionsBn ||
          'চেকআউট ফর্মে সঠিক অ্যাকাউন্ট তথ্য দিন; পেমেন্ট যাচাইয়ের পর নির্ধারিত সময়ে ডেলিভারি হবে।',
        instructionsEn:
          editingPkgProd?.instructionsEn ||
          'Enter your delivery email and required account details at checkout.',
        termsBn:
          editingPkgProd?.termsBn ||
          'সঠিক তথ্য নিশ্চিত করে অর্ডার করুন; ডিজিটাল ডেলিভারি সম্পন্ন হলে অর্ডার ফেরতযোগ্য নয়।',
        termsEn:
          editingPkgProd?.termsEn ||
          'Confirm account details before submitting payment; completed digital deliveries are final.',
        sectionTag: pkgPopular && pkgSectionTag === 'standard' ? 'hot_product' : pkgSectionTag,
        imageUrl: pkgImageUrl.trim() || '/assets/products/prod_ff_bd_diamonds.jpg',
        featured: pkgPopular,
        sortOrder: parsedOrder,
        active: pkgActive,
      };
      await adminSaveProduct(payload, !editingPkgProd);
      showOk(
        editingPkgProd
          ? `Package "${cleanNameEn}" updated and synced live.`
          : `Package "${cleanNameEn}" saved and published to the website.`
      );
      resetPackageForm();
    } catch (err) {
      showErr(err);
    } finally {
      setPkgBusy(false);
    }
  };

  const handleWalletAdjustmentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!walletAdjTarget) return;
    setWalletAdjBusy(true);
    try {
      const currentWallet = wallets.find((w) => w.uid === walletAdjTarget.uid);
      const res = await adminAdjustWalletBalance({
        targetUid: walletAdjTarget.uid,
        userEmail: walletAdjTarget.email,
        currentWallet,
        mode: walletAdjMode,
        amountBdt: Number(walletAdjAmount) || 0,
        note: walletAdjNote,
      });
      setWalletAdjTarget(null);
      setWalletAdjAmount('100');
      setWalletAdjNote('');
      showOk(`Wallet updated to ৳${res.nextBalance} for ${walletAdjTarget.email || walletAdjTarget.uid}.`);
    } catch (err) {
      showErr(err);
    } finally {
      setWalletAdjBusy(false);
    }
  };

  const handleSaveCategory = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const payload: Category = {
        id: editingCat ? editingCat.id : generateId('cat'),
        slug: catSlug || catNameEn.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        nameBn: catNameBn || catNameEn,
        nameEn: catNameEn || catNameBn,
        sortOrder: Number(catOrder) || 1,
        active: true,
      };
      await adminSaveCategory(payload, !editingCat);
      setEditingCat(null);
      setCatNameBn('');
      setCatNameEn('');
      setCatSlug('');
      showOk('Category saved.');
    } catch (e) {
      showErr(e);
    }
  };

  const handleSaveAd = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const payload: Advertisement = {
        id: editingAd ? editingAd.id : generateId('ad'),
        code: adCode.trim() || 'AD',
        titleBn: adTitleBn || adTitleEn,
        titleEn: adTitleEn || adTitleBn,
        descriptionBn: adDescBn,
        descriptionEn: adDescEn,
        targetUrl: adUrl.trim(),
        mediaType: adMediaType,
        adFormat,
        networkName: adNetworkName.trim() || 'Direct Partner',
        mediaUrl: adMediaUrl.trim(),
        thumbnailUrl: adThumb,
        placement: adPlacement,
        priority: editingAd?.priority ?? 5,
        sortOrder: Number(adOrder) || 1,
        enabled: editingAd ? editingAd.enabled : true,
      };
      await adminSaveAdvertisement(payload, !editingAd);
      setEditingAd(null);
      setAdCode('AD07');
      setAdTitleBn('');
      setAdTitleEn('');
      setAdDescBn('');
      setAdDescEn('');
      setAdUrl('');
      setAdMediaUrl('');
      showOk('Advertisement saved.');
    } catch (e) {
      showErr(e);
    }
  };

  const handleSaveAdNetwork = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const allowIncentivized = netProvider === 'adsense' ? false : netSupportsRewards;
      const payload: AdNetworkConfig = {
        id: editingNet ? editingNet.id : generateId('net'),
        provider: netProvider,
        name: netName.trim() || `${netProvider.toUpperCase()} Slot`,
        adFormat: netFormat,
        placement: netPlacement,
        publisherId: netPublisherId.trim(),
        zoneId: netZoneId.trim(),
        scriptSrc: netScriptSrc.trim(),
        containerId: netContainerId.trim(),
        supportsIncentivizedRewards: allowIncentivized,
        approvalStatus: netApproval,
        enabled: editingNet ? editingNet.enabled : netApproval === 'active',
      };
      await adminSaveAdNetwork(payload, !editingNet);
      setEditingNet(null);
      setNetName('');
      setNetPublisherId('');
      setNetZoneId('');
      setNetScriptSrc('');
      setNetContainerId('');
      setNetSupportsRewards(false);
      showOk('Official Ad Network script configuration saved.');
    } catch (e) {
      showErr(e);
    }
  };

  const handleBroadcastAnnouncement = async (e: FormEvent) => {
    e.preventDefault();
    setBusyId('ann_broadcast');
    try {
      await adminBroadcastAnnouncementServer({
        titleBn: annTitleBn.trim() || annTitleEn.trim(),
        titleEn: annTitleEn.trim() || annTitleBn.trim(),
        messageBn: annMsgBn.trim() || annMsgEn.trim(),
        messageEn: annMsgEn.trim() || annMsgBn.trim(),
        type: annType,
      });
      setAnnTitleBn('');
      setAnnTitleEn('');
      setAnnMsgBn('');
      setAnnMsgEn('');
      showOk('Global announcement broadcasted to all user dashboards.');
    } catch (e) {
      showErr(e);
    } finally {
      setBusyId('');
    }
  };

  const handleAddRevenueEntry = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const amt = Math.max(0, Number(revAmountBdt) || 0);
      if (amt <= 0) {
        throw new Error('Verified BDT amount must be greater than 0.');
      }
      await adminAddAdRevenueEntry({
        id: generateId('adrev'),
        networkName: revNetworkName.trim() || 'Official Ad Network',
        periodLabel: revPeriodLabel.trim() || new Date().toISOString().slice(0, 7),
        verifiedAmountBdt: amt,
        ...(revUsd ? { reportedUsd: Number(revUsd) || 0 } : {}),
        ...(revRefId ? { referenceId: revRefId.trim() } : {}),
        verifiedBy: user?.email || user?.uid || 'admin',
      });
      setRevPeriodLabel('');
      setRevAmountBdt('');
      setRevUsd('');
      setRevRefId('');
      showOk('Verified advertising revenue entry recorded.');
    } catch (e) {
      showErr(e);
    }
  };

  const handleSaveBanner = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const payload: Banner = {
        id: editingBanner ? editingBanner.id : generateId('ban'),
        titleBn: banTitleBn || banTitleEn,
        titleEn: banTitleEn || banTitleBn,
        slot: banSlot,
        targetUrl: banUrl.trim(),
        imageUrl: banImg,
        mobileImageUrl: banMobileImg || banImg,
        sortOrder: Number(banOrder) || 1,
        priority: 5,
        enabled: true,
      };
      await adminSaveBanner(payload, !editingBanner);
      setEditingBanner(null);
      setBanTitleBn('');
      setBanTitleEn('');
      setBanUrl('');
      showOk('Banner saved.');
    } catch (e) {
      showErr(e);
    }
  };

  const handleSaveCoupon = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const payload: Coupon = {
        id: generateId('coup'),
        code: coupCode.trim().toUpperCase(),
        discountType: coupType,
        discountValue: Math.max(1, Number(coupVal) || 10),
        minOrderBdt: Math.max(0, Number(coupMin) || 0),
        usageLimit: Math.max(1, Number(coupLimit) || 100),
        usedCount: 0,
        expiresAt: coupExp,
        active: true,
      };
      await adminSaveCoupon(payload, true);
      setCoupCode('');
      showOk('Coupon created.');
    } catch (e) {
      showErr(e);
    }
  };

  const handleUploadImage = async (
    e: ChangeEvent<HTMLInputElement>,
    setter: (dataUrl: string) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await compressImageToDataUrl(file);
      setter(url);
    } catch (err) {
      showErr(err);
    }
  };

  const exportCsvReport = () => {
    const headers = ['OrderNumber', 'CustomerEmail', 'Method', 'AmountBDT', 'Status', 'TxID'];
    const rows = orders.map((o) => [
      o.orderNumber,
      o.customerEmail || '',
      o.paymentMethod,
      String(o.totalPriceBdt),
      o.status,
      o.transactionId,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `digital-hub-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportLedgerCsvReport = () => {
    const headers = ['TxID', 'UserEmail', 'Type', 'Method', 'AmountBDT', 'Status', 'Note'];
    const rows = walletTxs.map((tx) => [
      tx.transactionId || tx.id,
      tx.userEmail || tx.userId,
      tx.type,
      tx.method,
      String(tx.amountBdt),
      tx.status,
      tx.note || '',
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `digital-hub-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Complete Admin Control Modules (22 views + Logout button)
  const navItems: { id: AdminSection; label: string; icon: typeof LayoutDashboard; badge?: number }[] = [
    { id: 'overview', label: '1. Dashboard Overview', icon: LayoutDashboard },
    { id: 'customers', label: '2. User Management', icon: Users },
    { id: 'products', label: '3. Product Management', icon: ShoppingBag },
    { id: 'packages', label: '4. Package Management', icon: Layers, badge: products.length },
    { id: 'categories', label: '5. Category Management', icon: FolderTree },
    { id: 'orders', label: '6. Order Management', icon: Package, badge: metrics.pendingOrders },
    { id: 'payments', label: '7. Payment Control & History', icon: CreditCard, badge: metrics.pendingPayments },
    { id: 'add_money', label: '8. Add Money Requests', icon: PlusCircle, badge: metrics.pendingDeposits },
    { id: 'wallets', label: '9. Wallet & Ledger', icon: Wallet },
    { id: 'withdrawals', label: '10. Withdrawal Queue', icon: ArrowDownToLine, badge: metrics.pendingWithdrawals },
    { id: 'ads', label: '11. Ads & Rewarded Ads', icon: Megaphone, badge: metrics.pendingRewardClaims },
    { id: 'banners', label: '12. Banner Management', icon: ImageIcon },
    { id: 'ad_analytics', label: '13. Ad Analytics', icon: BarChart3 },
    { id: 'referrals', label: '14. Referral Settings', icon: Gift },
    { id: 'coupons', label: '15. Coupon Management', icon: Tag },
    { id: 'announcements', label: '16. Announcements', icon: Bell },
    { id: 'tickets', label: '17. Support Tickets', icon: MessageSquare },
    { id: 'reviews', label: '18. Reviews Management', icon: Star },
    { id: 'content', label: '19. Website Content', icon: FileText },
    { id: 'reports', label: '20. Profit & Reports', icon: Activity },
    { id: 'settings', label: '21. Settings & Cashback', icon: Settings },
    { id: 'security', label: '22. Admin Security', icon: Shield },
  ];

  const depositTxs = walletTxs.filter((w) => w.type === 'deposit');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Sidebar */}
        <aside className="lg:w-64 shrink-0 dh-card rounded-3xl p-3 space-y-1 self-start lg:sticky lg:top-20">
          <div className="px-3 py-2.5 border-b border-[#E6ECFA] mb-1">
            <p className="text-xs font-extrabold text-[#FF8500] uppercase tracking-wider">Admin Control</p>
            <p className="text-[11px] text-[#777777] truncate">{user.phone || user.email || user.displayName}</p>
          </div>

          <div className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-2 lg:pb-0">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-2 shrink-0 transition-colors ${
                    active ? 'dh-orange-gradient text-white shadow-xs' : 'text-[#172033] hover:bg-[#F3F6FF]'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </span>
                  {item.badge ? (
                    <span
                      className={`px-1.5 py-0.5 rounded-md text-[10px] font-mono-num ${
                        active ? 'bg-white text-[#FF8500]' : 'bg-[#FFF3E5] text-[#FF8500]'
                      }`}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => {
                onLogout().catch(() => {});
              }}
              className="px-3 py-2 rounded-xl text-xs font-bold text-[#DC2626] hover:bg-red-50 flex items-center gap-2 shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>20. Logout</span>
            </button>
          </div>
        </aside>

        {/* Main Workspace */}
        <main className="flex-1 min-w-0 space-y-5">
          {notice && (
            <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-[#16A34A] text-xs font-bold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{notice}</span>
            </div>
          )}
          {errMsg && (
            <div className="p-3 rounded-2xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-bold flex items-center gap-2">
              <XCircle className="w-4 h-4 shrink-0" />
              <span>{errMsg}</span>
            </div>
          )}

          {/* 1. OVERVIEW */}
          {section === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                {[
                  { label: 'Customers', value: metrics.totalCustomers },
                  { label: 'New (7d)', value: metrics.newCustomers },
                  { label: 'Products', value: metrics.totalProducts },
                  { label: 'Pending Orders', value: metrics.pendingOrders },
                  { label: 'Completed Orders', value: metrics.completedOrders },
                  { label: 'Pending Payments', value: metrics.pendingPayments },
                  { label: 'Pending Add Money', value: metrics.pendingDeposits },
                  { label: 'Pending Withdrawals', value: metrics.pendingWithdrawals },
                  { label: 'Verified Revenue', value: `৳${metrics.verifiedRevenue}` },
                  { label: 'Net Profit', value: `৳${metrics.netProfitBdt}` },
                  { label: 'Ad Impressions', value: adAnalytics?.totalImpressions || 0 },
                  { label: 'Ad Clicks', value: adAnalytics?.totalClicks || 0 },
                ].map((stat) => (
                  <div key={stat.label} className="dh-card rounded-2xl p-4">
                    <p className="text-[11px] font-semibold text-[#777777]">{stat.label}</p>
                    <p className="text-xl font-extrabold font-mono-num text-[#172033] mt-1">{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="dh-card rounded-3xl p-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-[#172033]">MangoTopUp & Full Catalog Sync</h2>
                  <p className="text-xs text-[#777777]">
                    Sync missing categories (10 stores), 60+ gaming/SMM/subscription/AI/software/gift-card/digital services, 6 partner ads (AD01–AD06), banners, and coupons without overwriting existing changes.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await seedMarketplaceToFirestore(false);
                      showOk(`Catalog synced cleanly (${res.addedCount} new records added).`);
                    } catch (e) {
                      showErr(e);
                    }
                  }}
                  className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sync Full Catalog
                </button>
              </div>
            </div>
          )}

          {/* 2. USER MANAGEMENT */}
          {section === 'customers' && (
            <div className="dh-card rounded-3xl p-5 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-[#172033]">User & Role Management ({users.length})</h2>
                  <p className="text-xs text-[#777777]">
                    Admin access is enforced server-side via database roles and <span className="font-mono-num">ADMIN_PHONE_NUMBERS</span>. Block/Unblock actions require a verified HTTP-only admin session.
                  </p>
                </div>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search name, mobile, or email..."
                  className="px-3.5 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                />
              </div>
              <div className="space-y-2.5">
                {users
                  .filter(
                    (u) =>
                      !searchTerm ||
                      u.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                      (u.phone || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                      (u.email || '').toLowerCase().includes(searchTerm.toLowerCase())
                  )
                  .map((u) => {
                    const isOwnerRow = u.role === 'admin' || u.role === 'super_admin' || u.uid === user.uid;
                    const userWallet = wallets.find((w) => w.uid === u.uid);
                    return (
                      <div
                        key={u.uid}
                        className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col md:flex-row md:items-center justify-between gap-3"
                      >
                        <div className="space-y-0.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-bold text-[#172033]">{u.displayName}</p>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase ${
                                isOwnerRow
                                  ? 'bg-[#172033] text-[#FF9B19]'
                                  : 'bg-white border border-[#E6ECFA] text-[#4B5563]'
                              }`}
                            >
                              {isOwnerRow ? 'ADMIN' : 'USER'}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                                u.status === 'suspended'
                                  ? 'bg-red-100 text-[#DC2626]'
                                  : 'bg-emerald-100 text-[#16A34A]'
                              }`}
                            >
                              {u.status}
                            </span>
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-[#FFF3E5] text-[#FF8500]">
                              {u.authMethod === 'email' ? 'EMAIL' : 'PHONE'}
                            </span>
                          </div>
                          <p className="text-xs text-[#777777] font-mono-num">
                            {[u.phone, u.email].filter(Boolean).join(' · ') || u.uid} · Wallet: <strong className="text-[#172033]">৳{userWallet?.availableBalanceBdt ?? 0}</strong> · Promo: ৳{u.promotionalCredits}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setWalletAdjTarget({ uid: u.uid, email: u.phone || u.email || u.uid, name: u.displayName });
                              setWalletAdjMode('add');
                              setWalletAdjAmount('100');
                              setWalletAdjNote('');
                            }}
                            className="px-3 py-1.5 rounded-xl bg-emerald-50 text-[#16A34A] border border-emerald-200 text-xs font-bold"
                          >
                            Adjust Wallet
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await adminSendPromoReward({
                                  userId: u.uid,
                                  currentCredits: u.promotionalCredits,
                                  bonusBdt: 50,
                                  titleBn: 'বোনাস প্রমোশনাল ক্রেডিট',
                                  titleEn: 'Bonus Promotional Credit',
                                  messageBn: 'অ্যাডমিন আপনার অ্যাকাউন্টে ৳৫০ প্রমোশনাল ক্রেডিট যোগ করেছেন।',
                                  messageEn: 'Admin added ৳50 promotional credit to your account.',
                                });
                                showOk(`Added ৳50 promo credit to ${u.displayName}.`);
                              } catch (e) {
                                showErr(e);
                              }
                            }}
                            className="px-3 py-1.5 rounded-xl bg-[#FFF3E5] text-[#FF8500] text-xs font-bold"
                          >
                            +৳50 Promo
                          </button>
                          {!isOwnerRow && (
                            <button
                              type="button"
                              disabled={busyId === u.uid}
                              onClick={async () => {
                                setBusyId(u.uid);
                                try {
                                  const nextStatus = u.status === 'active' ? 'suspended' : 'active';
                                  await adminUpdateUserStatusServer(
                                    u.uid,
                                    nextStatus,
                                    nextStatus === 'suspended' ? 'Blocked by owner admin' : 'Restored by owner admin'
                                  );
                                  showOk(`${u.email} is now ${nextStatus}.`);
                                } catch (e) {
                                  showErr(e);
                                } finally {
                                  setBusyId('');
                                }
                              }}
                              className={`px-3 py-1.5 rounded-xl text-white text-xs font-bold disabled:opacity-60 ${
                                u.status === 'active' ? 'bg-[#DC2626]' : 'bg-[#16A34A]'
                              }`}
                            >
                              {busyId === u.uid ? 'Updating...' : u.status === 'active' ? 'Block User' : 'Unblock User'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* 3. PRODUCTS */}
          {section === 'products' && (
            <div className="space-y-5">
              <form onSubmit={handleSaveProduct} className="dh-card rounded-3xl p-5 space-y-3">
                <h2 className="text-lg font-bold text-[#172033]">
                  {editingProd ? 'Edit Product' : 'Add New Product / Service'}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <input
                    required
                    value={prodTitleBn}
                    onChange={(e) => setProdTitleBn(e.target.value)}
                    placeholder="Title (Bangla)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <input
                    required
                    value={prodTitleEn}
                    onChange={(e) => setProdTitleEn(e.target.value)}
                    placeholder="Title (English)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <select
                    value={prodCat}
                    onChange={(e) => setProdCat(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameEn}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    required
                    value={prodPrice}
                    onChange={(e) => setProdPrice(e.target.value)}
                    placeholder="Website Selling Price (BDT)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num"
                  />
                  <input
                    type="number"
                    value={prodOrigPrice}
                    onChange={(e) => setProdOrigPrice(e.target.value)}
                    placeholder="Original Base Price (BDT)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num"
                  />
                  <input
                    type="number"
                    value={prodDiscount}
                    onChange={(e) => setProdDiscount(e.target.value)}
                    placeholder="Discount %"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num"
                  />
                  <select
                    value={prodTag}
                    onChange={(e) => setProdTag(e.target.value as ProductSectionTag)}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  >
                    <option value="flash_sale">Flash Sale</option>
                    <option value="hot_product">Hot Product</option>
                    <option value="trending">Trending</option>
                    <option value="best_seller">Best Seller</option>
                    <option value="new_arrival">New Arrival</option>
                    <option value="standard">Standard</option>
                  </select>
                  <select
                    value={prodAvail}
                    onChange={(e) => setProdAvail(e.target.value as Product['availability'])}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  >
                    <option value="in_stock">In Stock</option>
                    <option value="limited">Limited</option>
                    <option value="out_of_stock">Out of Stock</option>
                  </select>
                  <input
                    value={prodDurEn}
                    onChange={(e) => {
                      setProdDurEn(e.target.value);
                      setProdDurBn(e.target.value);
                    }}
                    placeholder="Delivery Duration"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <input
                    value={prodSubcatBn}
                    onChange={(e) => setProdSubcatBn(e.target.value)}
                    placeholder="Subcategory (Bangla)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <input
                    value={prodSubcatEn}
                    onChange={(e) => setProdSubcatEn(e.target.value)}
                    placeholder="Subcategory (English, e.g. Battle Royale)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <select
                    value={prodBrandKey}
                    onChange={(e) => setProdBrandKey(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-semibold"
                  >
                    {Object.keys(BRAND_META)
                      .sort((a, b) => a.localeCompare(b))
                      .map((bk) => (
                        <option key={bk} value={bk}>
                          Brand Logo: {BRAND_META[bk].label} ({bk})
                        </option>
                      ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    max={1000000}
                    value={prodStockCount}
                    onChange={(e) => setProdStockCount(e.target.value)}
                    placeholder="Stock Count (e.g. 100)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num"
                  />
                  <select
                    value={prodOrderFormType}
                    onChange={(e) => setProdOrderFormType(e.target.value as OrderFormType)}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-semibold"
                  >
                    <option value="freefire">Order Form: Free Fire UID + Server</option>
                    <option value="pubg_uid">Order Form: Player UID / ID + Region</option>
                    <option value="telegram">Order Form: Telegram @username</option>
                    <option value="giftcard">Order Form: Gift Card (Region + Email)</option>
                    <option value="social">Order Form: Social Public URL</option>
                    <option value="subscription">Order Form: Subscription / AI / Software</option>
                    <option value="design">Order Form: Design / Web Project + Brief File</option>
                  </select>
                  <input
                    value={prodCustomLogoUrl}
                    onChange={(e) => setProdCustomLogoUrl(e.target.value)}
                    placeholder="Custom Brand Logo URL (optional)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <input
                    value={prodBannerUrl}
                    onChange={(e) => setProdBannerUrl(e.target.value)}
                    placeholder="Wide Product Banner URL (optional)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                </div>

                {/* Package Tiers Builder */}
                <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#172033]">
                      Multi-Tier Packages ({prodPackages.length}/200) — MangoTop Select Recharge
                    </span>
                    <button
                      type="button"
                      disabled={prodPackages.length >= 200}
                      onClick={() =>
                        setProdPackages((prev) => [
                          ...prev,
                          {
                            id: `pkg_${Date.now()}_${prev.length + 1}`,
                            nameBn: '',
                            nameEn: '',
                            priceBdt: Number(prodPrice) || 100,
                          },
                        ])
                      }
                      className="px-3 py-1 rounded-lg bg-[#172033] text-white text-[11px] font-bold flex items-center gap-1 disabled:opacity-40"
                    >
                      <Plus className="w-3 h-3" />
                      Add Tier
                    </button>
                  </div>
                  {prodPackages.map((pk, idx) => (
                    <div key={pk.id || idx} className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-center">
                      <input
                        value={pk.nameEn}
                        onChange={(e) => {
                          const next = [...prodPackages];
                          next[idx] = { ...next[idx], nameEn: e.target.value };
                          setProdPackages(next);
                        }}
                        placeholder="Package Name (EN)"
                        className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E6ECFA] text-[11px]"
                      />
                      <input
                        value={pk.nameBn}
                        onChange={(e) => {
                          const next = [...prodPackages];
                          next[idx] = { ...next[idx], nameBn: e.target.value };
                          setProdPackages(next);
                        }}
                        placeholder="Package Name (BN)"
                        className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E6ECFA] text-[11px]"
                      />
                      <input
                        type="number"
                        value={pk.priceBdt}
                        onChange={(e) => {
                          const next = [...prodPackages];
                          next[idx] = { ...next[idx], priceBdt: Number(e.target.value) || 0 };
                          setProdPackages(next);
                        }}
                        placeholder="Price BDT"
                        className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E6ECFA] text-[11px] font-mono-num"
                      />
                      <input
                        type="number"
                        value={pk.originalPriceBdt || ''}
                        onChange={(e) => {
                          const next = [...prodPackages];
                          next[idx] = {
                            ...next[idx],
                            originalPriceBdt: Number(e.target.value) || undefined,
                          };
                          setProdPackages(next);
                        }}
                        placeholder="Orig. BDT"
                        className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E6ECFA] text-[11px] font-mono-num"
                      />
                      <input
                        value={pk.tag || ''}
                        onChange={(e) => {
                          const next = [...prodPackages];
                          next[idx] = { ...next[idx], tag: e.target.value };
                          setProdPackages(next);
                        }}
                        placeholder="Tag (Popular)"
                        className="px-2.5 py-1.5 rounded-lg bg-white border border-[#E6ECFA] text-[11px]"
                      />
                      <button
                        type="button"
                        onClick={() => setProdPackages((prev) => prev.filter((_, i) => i !== idx))}
                        className="p-1.5 rounded-lg bg-red-50 text-[#DC2626] justify-self-start"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <textarea
                    rows={2}
                    value={prodDescBn}
                    onChange={(e) => setProdDescBn(e.target.value)}
                    placeholder="Description (Bangla)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <textarea
                    rows={2}
                    value={prodDescEn}
                    onChange={(e) => setProdDescEn(e.target.value)}
                    placeholder="Description (English)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <input
                    value={prodValidityEn}
                    onChange={(e) => {
                      setProdValidityEn(e.target.value);
                      if (!prodValidityBn) setProdValidityBn(e.target.value);
                    }}
                    placeholder="Validity / Duration (e.g. 1 Month)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <input
                    value={prodInstrEn}
                    onChange={(e) => setProdInstrEn(e.target.value)}
                    placeholder="Delivery Instructions"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <input
                    value={prodBenefitsEn}
                    onChange={(e) => setProdBenefitsEn(e.target.value)}
                    placeholder="Key Benefits"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <input
                    value={prodTermsEn}
                    onChange={(e) => setProdTermsEn(e.target.value)}
                    placeholder="Terms & Conditions"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-center p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA]">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-[#172033] block">
                      Studio Artwork Preset / Custom URL
                    </label>
                    <select
                      value={Object.values(STUDIO_IMAGES).includes(prodImg as never) ? prodImg : 'custom'}
                      onChange={(e) => {
                        if (e.target.value !== 'custom') setProdImg(e.target.value);
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs"
                    >
                      <option value="custom">Custom Uploaded / External URL</option>
                      <option value={STUDIO_IMAGES.gameBattle}>Free Fire / Battle Gaming Artwork</option>
                      <option value={STUDIO_IMAGES.artPubgTactical}>PUBG / Tactical Shooter Artwork</option>
                      <option value={STUDIO_IMAGES.artFootballStadium}>eFootball / EA FC / DLS Stadium Artwork</option>
                      <option value={STUDIO_IMAGES.artClashFantasy}>Clash of Clans / Clash Royale Fantasy Artwork</option>
                      <option value={STUDIO_IMAGES.streaming}>Streaming & OTT Entertainment Artwork</option>
                      <option value={STUDIO_IMAGES.aiSuite}>AI Tools & Gemini/Claude Suite Artwork</option>
                      <option value={STUDIO_IMAGES.artAdobeCreativeStudio}>Adobe Creative Cloud & Video Editing Artwork</option>
                      <option value={STUDIO_IMAGES.artWebCloudHosting}>Domain, Hosting, SSL & Security Artwork</option>
                      <option value={STUDIO_IMAGES.giftVouchers}>Gift Cards & Gaming Vouchers Artwork</option>
                      <option value={STUDIO_IMAGES.telegram}>Telegram Premium & Stars Artwork</option>
                      <option value={STUDIO_IMAGES.social}>Social Media Growth Artwork</option>
                      <option value={STUDIO_IMAGES.design}>Logo, Banner & Brand Design Artwork</option>
                      <option value={STUDIO_IMAGES.subscriptions}>Windows & Office Software Artwork</option>
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-[#172033] block">
                      Original Image URL (https://...)
                    </label>
                    <input
                      value={prodImg}
                      onChange={(e) => setProdImg(e.target.value)}
                      placeholder="https://... or upload image"
                      className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs"
                    />
                  </div>

                  <div className="flex items-center gap-3">
                    <ServiceBrandLogo
                      brandKey={prodBrandKey}
                      customLogoUrl={prodCustomLogoUrl || undefined}
                      size={44}
                    />
                    <div className="w-24 h-14 rounded-xl overflow-hidden bg-[#172033] shrink-0 border border-[#E6ECFA]">
                      <ProductVisualArtwork
                        product={{
                          id: editingProd?.id || 'preview',
                          titleBn: prodTitleBn || 'Preview',
                          titleEn: prodTitleEn || 'Preview',
                          categoryId: prodCat,
                          brandKey: prodBrandKey,
                          priceBdt: Number(prodPrice) || 0,
                          availability: prodAvail,
                          stockCount: Number(prodStockCount) || 0,
                          orderFormType: prodOrderFormType,
                          deliveryDurationBn: prodDurBn || 'Instant',
                          deliveryDurationEn: prodDurEn || 'Instant',
                          descriptionBn: '',
                          descriptionEn: '',
                          imageUrl: prodImg,
                          customLogoUrl: prodCustomLogoUrl || undefined,
                          active: true,
                        }}
                        lang={lang}
                        variant="card"
                      />
                    </div>
                    <span className="text-[11px] text-[#777777] leading-tight">
                      Live Brand Logo + Artwork Preview
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#FFF7EE] border border-[#FF8500]/40 text-xs font-bold cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-[#FF8500]" />
                    Upload Product Image
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleUploadImage(e, setProdImg)}
                      className="hidden"
                    />
                  </label>
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-bold cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-[#172033]" />
                    Upload Brand Logo
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const url = await compressImageToDataUrl(file, 400, 0.8);
                          setProdCustomLogoUrl(url);
                        } catch (err) {
                          showErr(err);
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#FFF7EE] border border-[#FF8500]/40 text-xs font-bold cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-[#FF8500]" />
                    Upload Product Banner
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleUploadImage(e, setProdBannerUrl)}
                      className="hidden"
                    />
                  </label>
                  <label className="inline-flex items-center gap-1.5 text-xs font-bold">
                    <input
                      type="checkbox"
                      checked={prodFeatured}
                      onChange={(e) => setProdFeatured(e.target.checked)}
                    />
                    Featured
                  </label>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold flex items-center gap-1.5"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {editingProd ? 'Update Product' : 'Save Product'}
                  </button>
                  {editingProd && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingProd(null);
                        setProdPackages([]);
                        setProdBannerUrl('');
                        setProdCustomLogoUrl('');
                      }}
                      className="px-3 py-2 rounded-xl bg-[#F3F6FF] text-xs font-bold"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>

              <div className="dh-card rounded-3xl p-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-[#172033]">
                    All Marketplace Products & Top-Ups ({products.length})
                  </h3>
                  <input
                    type="text"
                    value={prodSearch}
                    onChange={(e) => setProdSearch(e.target.value)}
                    placeholder="Search products..."
                    className="px-3 py-1.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                </div>
                {products
                  .filter(
                    (p) =>
                      !prodSearch.trim() ||
                      p.titleEn.toLowerCase().includes(prodSearch.toLowerCase()) ||
                      p.titleBn.toLowerCase().includes(prodSearch.toLowerCase()) ||
                      (p.subcategoryEn || '').toLowerCase().includes(prodSearch.toLowerCase())
                  )
                  .map((p) => (
                    <div
                      key={p.id}
                      className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-11 rounded-xl overflow-hidden bg-[#172033] shrink-0">
                          <ProductVisualArtwork product={p} lang={lang} variant="card" />
                        </div>
                        <div>
                          <p className="text-xs sm:text-sm font-bold text-[#172033]">{p.titleEn}</p>
                          <p className="text-[11px] text-[#777777] font-mono-num">
                            Site: ৳{p.priceBdt}
                            {p.originalPriceBdt ? ` (Orig: ৳${p.originalPriceBdt})` : ''} · {p.packages?.length || 0} pkgs · Stock: {p.stockCount ?? 100} ·{' '}
                            {p.orderFormType || 'auto'} · {p.availability}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingProd(p);
                            setProdTitleBn(p.titleBn);
                            setProdTitleEn(p.titleEn);
                            setProdCat(p.categoryId);
                            setProdSubcatBn(p.subcategoryBn || '');
                            setProdSubcatEn(p.subcategoryEn || '');
                            setProdBrandKey(p.brandKey || 'freefire');
                            setProdPrice(String(p.priceBdt));
                            setProdOrigPrice(String(p.originalPriceBdt || ''));
                            setProdDiscount(String(p.discountPercent || ''));
                            setProdTag(p.sectionTag || 'standard');
                            setProdAvail(p.availability);
                            setProdStockCount(String(p.stockCount ?? 100));
                            setProdOrderFormType(p.orderFormType || 'subscription');
                            setProdDurEn(p.deliveryDurationEn);
                            setProdDurBn(p.deliveryDurationBn);
                            setProdValidityBn(p.validityBn || '');
                            setProdValidityEn(p.validityEn || '');
                            setProdDescBn(p.descriptionBn);
                            setProdDescEn(p.descriptionEn);
                            setProdInstrEn(p.instructionsEn || '');
                            setProdBenefitsEn(p.benefitsEn || '');
                            setProdTermsEn(p.termsEn || '');
                            setProdImg(p.imageUrl);
                            setProdBannerUrl(p.bannerUrl || '');
                            setProdCustomLogoUrl(p.customLogoUrl || '');
                            setProdFeatured(Boolean(p.featured));
                            setProdPackages(p.packages || []);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => adminDeleteProduct(p.id).then(() => showOk('Product deleted.')).catch(showErr)}
                          className="p-1.5 rounded-xl bg-red-50 text-[#DC2626]"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* 4. PACKAGE MANAGEMENT */}
          {section === 'packages' && (
            <div className="space-y-5">
              {/* Add / Edit Package Form */}
              <form onSubmit={handleSavePackage} className="dh-card rounded-3xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-[#172033] flex items-center gap-2">
                      <Layers className="w-5 h-5 text-[#FF8500]" />
                      <span>{editingPkgProd ? `Edit Package: ${editingPkgProd.titleEn}` : 'Add New Package'}</span>
                    </h2>
                    <p className="text-xs text-[#777777]">
                      Create unlimited packages with photo, price, duration, features, category, display order & instant website publishing.
                    </p>
                  </div>
                  {editingPkgProd && (
                    <button
                      type="button"
                      onClick={resetPackageForm}
                      className="px-3.5 py-1.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-bold text-[#172033]"
                    >
                      + Create New Package Instead
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-[#172033] mb-1">Package Name (English) *</label>
                    <input
                      required
                      value={pkgNameEn}
                      onChange={(e) => setPkgNameEn(e.target.value)}
                      placeholder="e.g. ChatGPT Plus 1 Month Private"
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#172033] mb-1">Package Name (Bangla - Optional)</label>
                    <input
                      value={pkgNameBn}
                      onChange={(e) => setPkgNameBn(e.target.value)}
                      placeholder="চ্যাটজিপিটি প্লাস ১ মাস"
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#172033] mb-1">Package Category *</label>
                    <select
                      value={pkgCategory}
                      onChange={(e) => setPkgCategory(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-semibold"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nameEn}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#172033] mb-1">Package Price (BDT) *</label>
                    <input
                      type="number"
                      min={1}
                      required
                      value={pkgPrice}
                      onChange={(e) => setPkgPrice(e.target.value)}
                      placeholder="e.g. 520"
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#172033] mb-1">Original Price (BDT - Optional)</label>
                    <input
                      type="number"
                      min={0}
                      value={pkgOrigPrice}
                      onChange={(e) => setPkgOrigPrice(e.target.value)}
                      placeholder="e.g. 500"
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#172033] mb-1">Package Duration *</label>
                    <input
                      required
                      value={pkgDurationEn}
                      onChange={(e) => setPkgDurationEn(e.target.value)}
                      placeholder="e.g. 1 Month / 30 Days / Lifetime"
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#172033] mb-1">Delivery Time</label>
                    <input
                      value={pkgDeliveryEn}
                      onChange={(e) => setPkgDeliveryEn(e.target.value)}
                      placeholder="e.g. Instant (5-15 mins)"
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#172033] mb-1">Availability</label>
                    <select
                      value={pkgAvailability}
                      onChange={(e) => setPkgAvailability(e.target.value as Product['availability'])}
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-semibold"
                    >
                      <option value="in_stock">In Stock</option>
                      <option value="limited">Limited Stock</option>
                      <option value="out_of_stock">Out of Stock</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-bold text-[#172033] mb-1">Display Order</label>
                      <input
                        type="number"
                        min={0}
                        value={pkgDisplayOrder}
                        onChange={(e) => setPkgDisplayOrder(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-[#172033] mb-1">Stock Qty</label>
                      <input
                        type="number"
                        min={0}
                        value={pkgStockCount}
                        onChange={(e) => setPkgStockCount(e.target.value)}
                        className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-[#172033] mb-1">Package Description *</label>
                    <textarea
                      rows={3}
                      required
                      value={pkgDescEn}
                      onChange={(e) => setPkgDescEn(e.target.value)}
                      placeholder="Write complete package description..."
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#172033] mb-1">Package Features *</label>
                    <textarea
                      rows={3}
                      required
                      value={pkgFeaturesEn}
                      onChange={(e) => setPkgFeaturesEn(e.target.value)}
                      placeholder="e.g. Fast Private Access • Full Term Warranty • 24/7 Support"
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                    />
                  </div>
                </div>

                {/* Package Photo Upload & Preview */}
                <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-28 h-20 rounded-xl overflow-hidden bg-[#172033] border border-[#E6ECFA] shrink-0">
                      <img
                        src={pkgImageUrl || '/assets/products/prod_ff_bd_diamonds.jpg'}
                        alt={pkgNameEn || 'Package Preview'}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <p className="text-xs font-bold text-[#172033]">Package Photo / Image</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#FF8500] text-[#FF8500] text-xs font-bold cursor-pointer hover:bg-[#FFF7EE]">
                          <Upload className="w-3.5 h-3.5" />
                          Upload Photo
                          <input
                            type="file"
                            accept="image/*"
                            onChange={(e) => handleUploadImage(e, setPkgImageUrl)}
                            className="hidden"
                          />
                        </label>
                      </div>
                      <input
                        value={pkgImageUrl}
                        onChange={(e) => setPkgImageUrl(e.target.value)}
                        placeholder="Or paste Image URL (/assets/products/... or https://...)"
                        className="w-full sm:w-72 px-2.5 py-1.5 rounded-lg bg-white border border-[#E6ECFA] text-[11px]"
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-3 text-xs font-bold">
                      <label className="inline-flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pkgActive}
                          onChange={(e) => setPkgActive(e.target.checked)}
                        />
                        <span>Active (Published on Website)</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 cursor-pointer text-[#FF8500]">
                        <input
                          type="checkbox"
                          checked={pkgPopular}
                          onChange={(e) => setPkgPopular(e.target.checked)}
                        />
                        <span>Popular / Featured</span>
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={pkgSectionTag}
                        onChange={(e) => setPkgSectionTag(e.target.value as ProductSectionTag)}
                        className="px-3 py-1.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-semibold"
                      >
                        <option value="hot_product">Show in Hot / Popular</option>
                        <option value="new_arrival">Show in New Arrivals</option>
                        <option value="flash_sale">Show in Flash Sale</option>
                        <option value="trending">Show in Trending</option>
                        <option value="best_seller">Show in Best Sellers</option>
                        <option value="standard">Category Page Only</option>
                      </select>
                      <button
                        type="submit"
                        disabled={pkgBusy}
                        className="px-5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-extrabold flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        {pkgBusy
                          ? 'Saving...'
                          : editingPkgProd
                            ? 'Save Package Changes'
                            : 'Save & Publish Package'}
                      </button>
                      {editingPkgProd && (
                        <button
                          type="button"
                          onClick={resetPackageForm}
                          className="px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold"
                        >
                          Cancel
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </form>

              {/* Delete Confirmation Dialog */}
              {confirmDeletePkg && (
                <div className="p-4 rounded-2xl bg-red-50 border border-red-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs">
                    <p className="font-extrabold text-[#DC2626]">
                      Confirm Permanent Deletion: "{confirmDeletePkg.titleEn}"
                    </p>
                    <p className="text-[#777777]">
                      This will permanently remove the package from the database and customer website.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setConfirmDeletePkg(null)}
                      className="px-3.5 py-1.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#172033]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const target = confirmDeletePkg;
                        setConfirmDeletePkg(null);
                        try {
                          await adminDeleteProduct(target.id);
                          if (editingPkgProd?.id === target.id) resetPackageForm();
                          showOk(`Package "${target.titleEn}" permanently deleted.`);
                        } catch (err) {
                          showErr(err);
                        }
                      }}
                      className="px-4 py-1.5 rounded-xl bg-[#DC2626] text-white text-xs font-bold"
                    >
                      Confirm Delete
                    </button>
                  </div>
                </div>
              )}

              {/* Package List & Controls */}
              <div className="dh-card rounded-3xl p-5 space-y-3">
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-[#172033]">
                    All Packages & Services ({products.length})
                  </h3>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={pkgSearchQuery}
                      onChange={(e) => setPkgSearchQuery(e.target.value)}
                      placeholder="Search package name..."
                      className="px-3 py-1.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                    />
                    <select
                      value={pkgCatFilter}
                      onChange={(e) => setPkgCatFilter(e.target.value)}
                      className="px-3 py-1.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-semibold"
                    >
                      <option value="all">All Categories</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nameEn}
                        </option>
                      ))}
                    </select>
                    <select
                      value={pkgStatusFilter}
                      onChange={(e) =>
                        setPkgStatusFilter(e.target.value as 'all' | 'active' | 'inactive' | 'featured')
                      }
                      className="px-3 py-1.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-semibold"
                    >
                      <option value="all">All Status</option>
                      <option value="active">Active Only</option>
                      <option value="inactive">Inactive Only</option>
                      <option value="featured">Popular / Featured</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2.5">
                  {products
                    .filter((p) => {
                      if (pkgCatFilter !== 'all' && p.categoryId !== pkgCatFilter) return false;
                      if (pkgStatusFilter === 'active' && !p.active) return false;
                      if (pkgStatusFilter === 'inactive' && p.active) return false;
                      if (pkgStatusFilter === 'featured' && !p.featured) return false;
                      if (pkgSearchQuery.trim()) {
                        const q = pkgSearchQuery.toLowerCase();
                        return (
                          p.titleEn.toLowerCase().includes(q) ||
                          p.titleBn.toLowerCase().includes(q) ||
                          (p.benefitsEn || '').toLowerCase().includes(q)
                        );
                      }
                      return true;
                    })
                    .map((p, idx) => {
                      const catName = categories.find((c) => c.id === p.categoryId)?.nameEn || p.categoryId;
                      const currentOrderVal = pkgOrderEdits[p.id] ?? String(p.sortOrder ?? idx + 1);
                      return (
                        <div
                          key={p.id}
                          className={`p-3 rounded-2xl border flex flex-col xl:flex-row xl:items-center justify-between gap-3 ${
                            p.active ? 'bg-[#F3F6FF] border-[#E6ECFA]' : 'bg-gray-50 border-gray-200 opacity-75'
                          }`}
                        >
                          <div className="flex items-start sm:items-center gap-3 min-w-0">
                            <div className="w-20 h-14 rounded-xl overflow-hidden bg-[#172033] shrink-0">
                              <ProductVisualArtwork product={p} lang={lang} variant="card" />
                            </div>
                            <div className="min-w-0 space-y-0.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <p className="text-xs sm:text-sm font-bold text-[#172033] truncate">{p.titleEn}</p>
                                <span className="px-1.5 py-0.5 rounded bg-white border border-[#E6ECFA] text-[10px] font-bold text-[#4B5563]">
                                  {catName}
                                </span>
                                {p.featured && (
                                  <span className="px-1.5 py-0.5 rounded bg-[#FF8500] text-white text-[10px] font-extrabold">
                                    POPULAR
                                  </span>
                                )}
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                    p.active
                                      ? 'bg-emerald-100 text-[#16A34A]'
                                      : 'bg-gray-200 text-gray-600'
                                  }`}
                                >
                                  {p.active ? 'ACTIVE' : 'INACTIVE'}
                                </span>
                              </div>
                              <p className="text-[11px] font-mono-num text-[#777777]">
                                <strong className="text-[#FF8500]">৳{p.priceBdt}</strong> ·{' '}
                                {p.validityEn || p.deliveryDurationEn} · {p.availability}
                              </p>
                              {p.benefitsEn && (
                                <p className="text-[11px] text-[#777777] truncate max-w-xl">{p.benefitsEn}</p>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                            {/* Display Order Control */}
                            <div className="flex items-center gap-1 bg-white border border-[#E6ECFA] rounded-xl px-1.5 py-1">
                              <span className="text-[10px] font-bold text-[#777777]">Order</span>
                              <input
                                type="number"
                                min={0}
                                value={currentOrderVal}
                                onChange={(e) =>
                                  setPkgOrderEdits((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                                className="w-12 px-1.5 py-0.5 rounded bg-[#F3F6FF] text-[11px] font-mono-num text-center"
                              />
                              <button
                                type="button"
                                title="Save display order"
                                onClick={() =>
                                  adminQuickUpdatePackage(p, {
                                    sortOrder: Math.max(0, Math.round(Number(currentOrderVal) || 0)),
                                  })
                                    .then(() => showOk(`Display order updated for "${p.titleEn}".`))
                                    .catch(showErr)
                                }
                                className="px-1.5 py-0.5 rounded bg-[#172033] text-white text-[10px] font-bold"
                              >
                                Set
                              </button>
                              <button
                                type="button"
                                title="Move Up"
                                onClick={() =>
                                  adminQuickUpdatePackage(p, {
                                    sortOrder: Math.max(0, (p.sortOrder ?? idx + 1) - 1),
                                  })
                                    .then(() => showOk(`Moved "${p.titleEn}" up.`))
                                    .catch(showErr)
                                }
                                className="p-1 rounded hover:bg-[#F3F6FF] text-[#172033]"
                              >
                                <ArrowUp className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                title="Move Down"
                                onClick={() =>
                                  adminQuickUpdatePackage(p, {
                                    sortOrder: (p.sortOrder ?? idx + 1) + 1,
                                  })
                                    .then(() => showOk(`Moved "${p.titleEn}" down.`))
                                    .catch(showErr)
                                }
                                className="p-1 rounded hover:bg-[#F3F6FF] text-[#172033]"
                              >
                                <ArrowDown className="w-3 h-3" />
                              </button>
                            </div>

                            {/* Popular / Featured Toggle */}
                            <button
                              type="button"
                              onClick={() =>
                                adminQuickUpdatePackage(p, {
                                  featured: !p.featured,
                                  sectionTag: !p.featured
                                    ? 'hot_product'
                                    : p.sectionTag === 'hot_product'
                                      ? 'standard'
                                      : p.sectionTag,
                                })
                                  .then(() =>
                                    showOk(
                                      `"${p.titleEn}" ${!p.featured ? 'marked Popular / Featured' : 'removed from Featured'}.`
                                    )
                                  )
                                  .catch(showErr)
                              }
                              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 border ${
                                p.featured
                                  ? 'bg-[#FFF3E5] border-[#FF8500] text-[#FF8500]'
                                  : 'bg-white border-[#E6ECFA] text-[#4B5563]'
                              }`}
                            >
                              <Flame className="w-3 h-3" />
                              {p.featured ? 'Featured' : 'Set Popular'}
                            </button>

                            {/* Activate / Deactivate Toggle */}
                            <button
                              type="button"
                              onClick={() =>
                                adminQuickUpdatePackage(p, { active: !p.active })
                                  .then(() =>
                                    showOk(`"${p.titleEn}" ${!p.active ? 'activated' : 'deactivated'}.`)
                                  )
                                  .catch(showErr)
                              }
                              className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1 border ${
                                p.active
                                  ? 'bg-emerald-50 border-emerald-200 text-[#16A34A]'
                                  : 'bg-white border-gray-300 text-gray-600'
                              }`}
                            >
                              {p.active ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                              {p.active ? 'Active' : 'Inactive'}
                            </button>

                            {/* Edit Package */}
                            <button
                              type="button"
                              onClick={() => {
                                startEditPackage(p);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                              className="px-2.5 py-1.5 rounded-xl bg-white border border-[#E6ECFA] text-[#172033] text-[11px] font-bold flex items-center gap-1 hover:border-[#FF8500]"
                            >
                              <Edit3 className="w-3 h-3" />
                              Edit
                            </button>

                            {/* Delete Package (with Confirmation) */}
                            <button
                              type="button"
                              onClick={() => setConfirmDeletePkg(p)}
                              className="p-1.5 rounded-xl bg-red-50 border border-red-200 text-[#DC2626]"
                              title="Delete package"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          )}

          {/* 5. CATEGORIES */}
          {section === 'categories' && (
            <div className="space-y-5">
              <form onSubmit={handleSaveCategory} className="dh-card rounded-3xl p-5 grid grid-cols-1 sm:grid-cols-4 gap-3">
                <input
                  required
                  value={catNameBn}
                  onChange={(e) => setCatNameBn(e.target.value)}
                  placeholder="Category (Bangla)"
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                />
                <input
                  required
                  value={catNameEn}
                  onChange={(e) => setCatNameEn(e.target.value)}
                  placeholder="Category (English)"
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                />
                <input
                  type="number"
                  value={catOrder}
                  onChange={(e) => setCatOrder(e.target.value)}
                  placeholder="Sort Order"
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                />
                <button type="submit" className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold">
                  {editingCat ? 'Update Category' : 'Add Category'}
                </button>
              </form>

              <div className="dh-card rounded-3xl p-5 space-y-2">
                {categories.map((c) => (
                  <div key={c.id} className="p-3 rounded-2xl bg-[#F3F6FF] flex justify-between items-center text-xs">
                    <span className="font-bold text-[#172033]">
                      #{c.sortOrder} · {c.nameEn} ({c.nameBn})
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCat(c);
                          setCatNameBn(c.nameBn);
                          setCatNameEn(c.nameEn);
                          setCatSlug(c.slug);
                          setCatOrder(String(c.sortOrder));
                        }}
                        className="px-2.5 py-1 rounded-lg bg-white border border-[#E6ECFA] font-bold"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => adminDeleteCategory(c.id).then(() => showOk('Category deleted.')).catch(showErr)}
                        className="p-1.5 rounded-lg bg-red-50 text-[#DC2626]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 5. ORDERS */}
          {section === 'orders' && (
            <div className="dh-card rounded-3xl p-5 space-y-3">
              <div>
                <h2 className="text-lg font-bold text-[#172033]">Order Management ({orders.length})</h2>
                <p className="text-xs text-[#777777]">
                  Marking an order as Completed triggers idempotent Cashback & Referral Commission settlement automatically.
                </p>
              </div>
              {orders.map((ord) => (
                <div key={ord.id} className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-2">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-mono-num font-bold text-[#FF8500]">#{ord.orderNumber}</span>
                        {ord.cashbackAwarded && (
                          <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-[#16A34A] text-[10px] font-bold">
                            Cashback ৳{ord.cashbackBdt || 0} Credited
                          </span>
                        )}
                        {ord.referralProcessed && (
                          <span className="px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-700 text-[10px] font-bold">
                            Referral Settled
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-bold text-[#172033]">
                        {ord.productTitleEn}
                        {ord.selectedPackageName ? ` [${ord.selectedPackageName}]` : ''} · ৳{ord.totalPriceBdt}
                      </p>
                      <p className="text-xs text-[#777777]">
                        {ord.customerEmail} · {ord.paymentMethod.toUpperCase()} · {ord.transactionId}
                      </p>
                      {ord.itemsSummary && (
                        <p className="text-[11px] text-[#777777] mt-0.5">{ord.itemsSummary}</p>
                      )}
                      {ord.deliveryNote && (
                        <p className="text-xs text-[#172033] mt-0.5 whitespace-pre-wrap break-words">
                          Customer Info: {ord.deliveryNote}
                        </p>
                      )}
                      {ord.referenceAttachmentUrl && (
                        <div className="mt-2">
                          <p className="text-[11px] font-bold text-[#FF8500] mb-1">Reference File:</p>
                          <img
                            src={ord.referenceAttachmentUrl}
                            alt="Order attachment"
                            className="max-h-28 rounded-xl border border-[#E6ECFA]"
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={orderNotes[ord.id] ?? ord.adminNote ?? ''}
                        onChange={(e) => setOrderNotes({ ...orderNotes, [ord.id]: e.target.value })}
                        placeholder="Delivery details / link..."
                        className="px-2.5 py-1.5 rounded-xl bg-white border border-[#E6ECFA] text-xs"
                      />
                      <button
                        type="button"
                        disabled={busyId === ord.id}
                        onClick={() =>
                          adminUpdateOrderStatus(ord, 'Processing', orderNotes[ord.id] ?? ord.adminNote)
                            .then(() => showOk(`Order #${ord.orderNumber} set to Processing.`))
                            .catch(showErr)
                        }
                        className="px-2.5 py-1.5 rounded-xl bg-[#172033] text-white text-[11px] font-bold"
                      >
                        Process
                      </button>
                      <button
                        type="button"
                        disabled={busyId === ord.id}
                        onClick={async () => {
                          setBusyId(ord.id);
                          try {
                            const res = await adminCompleteOrderWithRewardsServer(
                              ord.id,
                              orderNotes[ord.id] ?? ord.adminNote
                            );
                            showOk(
                              `Order #${ord.orderNumber} completed! Cashback: ৳${res.awardedCashbackBdt}, Referral: ৳${res.awardedReferralBdt}.`
                            );
                          } catch (e) {
                            showErr(e);
                          } finally {
                            setBusyId('');
                          }
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-[#16A34A] text-white text-[11px] font-bold disabled:opacity-60"
                      >
                        {busyId === ord.id ? 'Completing...' : 'Complete (+ Rewards)'}
                      </button>
                      <button
                        type="button"
                        disabled={busyId === ord.id}
                        onClick={() =>
                          adminUpdateOrderStatus(ord, 'Rejected', orderNotes[ord.id] ?? ord.adminNote)
                            .then(() => showOk(`Order #${ord.orderNumber} rejected.`))
                            .catch(showErr)
                        }
                        className="px-2.5 py-1.5 rounded-xl bg-[#DC2626] text-white text-[11px] font-bold"
                      >
                        Reject
                      </button>
                      {ord.status !== 'Cancelled' && (
                        <button
                          type="button"
                          disabled={busyId === ord.id}
                          onClick={async () => {
                            setBusyId(ord.id);
                            try {
                              const res = await adminRefundAndCancelOrderServer({
                                orderId: ord.id,
                                rejectionReason: orderNotes[ord.id] || undefined,
                                refundToWallet: true,
                              });
                              showOk(
                                res.refundedBdt > 0
                                  ? `Order #${ord.orderNumber} cancelled & ৳${res.refundedBdt} refunded to wallet.`
                                  : `Order #${ord.orderNumber} cancelled.`
                              );
                            } catch (e) {
                              showErr(e);
                            } finally {
                              setBusyId('');
                            }
                          }}
                          className="px-2.5 py-1.5 rounded-xl bg-amber-600 text-white text-[11px] font-bold disabled:opacity-60"
                        >
                          {busyId === ord.id ? 'Cancelling...' : 'Cancel & Refund'}
                        </button>
                      )}
                      <select
                        value={ord.status}
                        onChange={async (e) => {
                          const next = e.target.value as OrderStatus;
                          if (next === 'Completed') {
                            setBusyId(ord.id);
                            try {
                              const res = await adminCompleteOrderWithRewardsServer(
                                ord.id,
                                orderNotes[ord.id] ?? ord.adminNote
                              );
                              showOk(
                                `Order #${ord.orderNumber} completed! Cashback: ৳${res.awardedCashbackBdt}, Referral: ৳${res.awardedReferralBdt}.`
                              );
                            } catch (err) {
                              showErr(err);
                            } finally {
                              setBusyId('');
                            }
                            return;
                          }
                          adminUpdateOrderStatus(ord, next, orderNotes[ord.id] ?? ord.adminNote)
                            .then(() => showOk(`Order #${ord.orderNumber} updated.`))
                            .catch(showErr);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold"
                      >
                        {[
                          'Pending Payment',
                          'Verification Pending',
                          'Paid',
                          'Payment Approved',
                          'Processing',
                          'Completed',
                          'Rejected',
                          'Cancelled',
                        ].map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 7. ADMIN PAYMENT CONTROL, SETTINGS & COMPLETE PAYMENT HISTORY */}
          {section === 'payments' && (
            <div className="space-y-5">
              {/* Payment Gateway Settings & Logo Control */}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setSavingPaymentSettings(true);
                  try {
                    await adminSaveSiteSettings(settingsDraft);
                    showOk('Payment numbers, logos, and gateway toggles saved! Live customer UI updated.');
                  } catch (err) {
                    showErr(err);
                  } finally {
                    setSavingPaymentSettings(false);
                  }
                }}
                className="dh-card rounded-3xl p-5 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold text-[#172033]">
                      Payment Settings & Gateway Control (bKash · Nagad · Rocket)
                    </h2>
                    <p className="text-xs text-[#777777]">
                      Update receiver numbers, enable/disable gateways, and upload or reset official payment logos.
                    </p>
                  </div>
                  <button
                    type="submit"
                    disabled={savingPaymentSettings}
                    className="px-5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-extrabold shadow-xs hover:opacity-95 disabled:opacity-60"
                  >
                    {savingPaymentSettings ? 'Saving...' : 'Save Payment Settings'}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                  {(['bkash', 'nagad', 'rocket'] as PaymentMethod[]).map((m) => {
                    const meta = PAYMENT_BRAND_META[m];
                    const enabled =
                      m === 'bkash'
                        ? settingsDraft.bkashEnabled !== false
                        : m === 'nagad'
                          ? settingsDraft.nagadEnabled !== false
                          : settingsDraft.rocketEnabled !== false;
                    const number =
                      m === 'bkash'
                        ? settingsDraft.bkashNumber
                        : m === 'nagad'
                          ? settingsDraft.nagadNumber
                          : settingsDraft.rocketNumber;
                    const typeVal =
                      m === 'bkash'
                        ? settingsDraft.bkashType || 'Personal'
                        : m === 'nagad'
                          ? settingsDraft.nagadType || 'Personal'
                          : settingsDraft.rocketType || 'Personal';
                    const noteEn =
                      m === 'bkash'
                        ? settingsDraft.bkashNoteEn || ''
                        : m === 'nagad'
                          ? settingsDraft.nagadNoteEn || ''
                          : settingsDraft.rocketNoteEn || '';
                    const noteBn =
                      m === 'bkash'
                        ? settingsDraft.bkashNoteBn || ''
                        : m === 'nagad'
                          ? settingsDraft.nagadNoteBn || ''
                          : settingsDraft.rocketNoteBn || '';
                    const customLogo =
                      m === 'bkash'
                        ? settingsDraft.bkashLogoUrl || ''
                        : m === 'nagad'
                          ? settingsDraft.nagadLogoUrl || ''
                          : settingsDraft.rocketLogoUrl || '';
                    const previewLogo = resolvePaymentLogoUrl(m, settingsDraft);

                    const setEnabled = (val: boolean) =>
                      setSettingsDraft((prev) =>
                        m === 'bkash'
                          ? { ...prev, bkashEnabled: val }
                          : m === 'nagad'
                            ? { ...prev, nagadEnabled: val }
                            : { ...prev, rocketEnabled: val }
                      );
                    const setNumber = (val: string) =>
                      setSettingsDraft((prev) =>
                        m === 'bkash'
                          ? { ...prev, bkashNumber: val }
                          : m === 'nagad'
                            ? { ...prev, nagadNumber: val }
                            : { ...prev, rocketNumber: val }
                      );
                    const setTypeVal = (val: 'Personal' | 'Merchant' | 'Agent') =>
                      setSettingsDraft((prev) =>
                        m === 'bkash'
                          ? { ...prev, bkashType: val }
                          : m === 'nagad'
                            ? { ...prev, nagadType: val }
                            : { ...prev, rocketType: val }
                      );
                    const setNoteEn = (val: string) =>
                      setSettingsDraft((prev) =>
                        m === 'bkash'
                          ? { ...prev, bkashNoteEn: val }
                          : m === 'nagad'
                            ? { ...prev, nagadNoteEn: val }
                            : { ...prev, rocketNoteEn: val }
                      );
                    const setNoteBn = (val: string) =>
                      setSettingsDraft((prev) =>
                        m === 'bkash'
                          ? { ...prev, bkashNoteBn: val }
                          : m === 'nagad'
                            ? { ...prev, nagadNoteBn: val }
                            : { ...prev, rocketNoteBn: val }
                      );
                    const setLogoUrl = (val: string) =>
                      setSettingsDraft((prev) =>
                        m === 'bkash'
                          ? { ...prev, bkashLogoUrl: val }
                          : m === 'nagad'
                            ? { ...prev, nagadLogoUrl: val }
                            : { ...prev, rocketLogoUrl: val }
                      );

                    return (
                      <div
                        key={m}
                        className="p-4 rounded-2xl border-2 space-y-3 bg-white"
                        style={{ borderColor: enabled ? meta.borderColor : '#E6ECFA' }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="h-10 px-2 rounded-xl border border-[#E6ECFA] bg-white flex items-center justify-center shrink-0">
                              <img
                                src={previewLogo}
                                alt={meta.nameEn}
                                className="h-7 w-auto max-w-[78px] object-contain"
                                onError={(ev) => {
                                  (ev.currentTarget as HTMLImageElement).src = meta.defaultLogoPath;
                                }}
                              />
                            </div>
                            <div>
                              <p className="text-sm font-extrabold" style={{ color: meta.primaryColor }}>
                                {meta.nameEn}
                              </p>
                              <p className="text-[10px] font-semibold text-[#777777]">
                                {enabled ? 'Active on Storefront' : 'Disabled'}
                              </p>
                            </div>
                          </div>
                          <label className="flex items-center gap-1.5 font-bold text-[11px] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(e) => setEnabled(e.target.checked)}
                            />
                            <span>{enabled ? 'Enabled' : 'Off'}</span>
                          </label>
                        </div>

                        <div>
                          <label className="block font-bold text-[11px] text-[#172033] mb-1">
                            Payment Number
                          </label>
                          <input
                            value={number}
                            onChange={(e) => setNumber(e.target.value)}
                            className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num font-bold text-[#172033]"
                            placeholder="01XXXXXXXXX"
                          />
                        </div>

                        <div>
                          <label className="block font-bold text-[11px] text-[#172033] mb-1">
                            Account Type
                          </label>
                          <select
                            value={typeVal}
                            onChange={(e) => setTypeVal(e.target.value as 'Personal' | 'Merchant' | 'Agent')}
                            className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                          >
                            <option value="Personal">Personal (Send Money)</option>
                            <option value="Merchant">Merchant (Payment)</option>
                            <option value="Agent">Agent (Cash Out)</option>
                          </select>
                        </div>

                        <div className="space-y-1.5">
                          <label className="block font-bold text-[11px] text-[#172033]">
                            Upload / Update Logo (or keep official SVG)
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            <label className="flex-1 px-2.5 py-1.5 rounded-xl bg-[#FFF7EE] border border-[#FF8500]/40 text-[11px] font-bold text-[#172033] flex items-center justify-center gap-1 cursor-pointer hover:bg-[#FFEAD2]">
                              <Upload className="w-3.5 h-3.5 text-[#FF8500]" />
                              <span>Upload Logo</span>
                              <input
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={async (e) => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  try {
                                    const dataUrl = await compressImageToDataUrl(file, 360, 0.85);
                                    setLogoUrl(dataUrl);
                                    showOk(`${meta.nameEn} logo uploaded. Click "Save Payment Settings" to publish.`);
                                  } catch (err) {
                                    showErr(err);
                                  }
                                }}
                              />
                            </label>
                            {customLogo && (
                              <button
                                type="button"
                                onClick={() => setLogoUrl('')}
                                className="px-2.5 py-1.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-[11px] font-bold text-[#777777] hover:text-[#172033]"
                              >
                                Reset Official
                              </button>
                            )}
                          </div>
                          <input
                            value={customLogo.startsWith('data:') ? '(Uploaded Custom Image)' : customLogo}
                            onChange={(e) => {
                              if (!customLogo.startsWith('data:') || !e.target.value.startsWith('(Uploaded')) {
                                setLogoUrl(e.target.value);
                              }
                            }}
                            placeholder={`Default: ${meta.defaultLogoPath}`}
                            className="w-full px-3 py-1.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-[11px]"
                          />
                        </div>

                        <div className="grid grid-cols-1 gap-1.5">
                          <input
                            value={noteEn}
                            onChange={(e) => setNoteEn(e.target.value)}
                            placeholder="English note (e.g. Use Send Money option)"
                            className="w-full px-3 py-1.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-[11px]"
                          />
                          <input
                            value={noteBn}
                            onChange={(e) => setNoteBn(e.target.value)}
                            placeholder="বাংলা নোট (যেমন: শুধুমাত্র Send Money করুন)"
                            className="w-full px-3 py-1.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-[11px]"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </form>

              {/* Complete Payment History & Transaction Verification */}
              <div className="dh-card rounded-3xl p-5 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-extrabold text-[#172033]">
                      Complete Payment History & Verification ({payments.length})
                    </h2>
                    <p className="text-xs text-[#777777]">
                      Inspect submitted TxIDs and full-size payment screenshots, approve or reject any order or wallet payment.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                    <span className="px-2.5 py-1 rounded-lg bg-amber-100 text-amber-800">
                      Pending: {payments.filter((p) => p.status === 'Verification Pending').length}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-100 text-[#16A34A]">
                      Approved: {payments.filter((p) => p.status === 'Approved').length}
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-red-100 text-[#DC2626]">
                      Rejected: {payments.filter((p) => p.status === 'Rejected').length}
                    </span>
                  </div>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-[#777777] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      value={paySearch}
                      onChange={(e) => setPaySearch(e.target.value)}
                      placeholder="Search TxID, Order #, Email, Sender..."
                      className="w-full pl-8 pr-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                    />
                  </div>
                  <select
                    value={payStatusFilter}
                    onChange={(e) =>
                      setPayStatusFilter(
                        e.target.value as 'all' | 'Verification Pending' | 'Approved' | 'Rejected'
                      )
                    }
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-semibold"
                  >
                    <option value="all">All Statuses</option>
                    <option value="Verification Pending">Verification Pending</option>
                    <option value="Approved">Approved</option>
                    <option value="Rejected">Rejected</option>
                  </select>
                  <select
                    value={payMethodFilter}
                    onChange={(e) => setPayMethodFilter(e.target.value as 'all' | PaymentMethod)}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-semibold"
                  >
                    <option value="all">All Payment Methods</option>
                    <option value="bkash">bKash</option>
                    <option value="nagad">Nagad</option>
                    <option value="rocket">Rocket</option>
                  </select>
                </div>

                {(() => {
                  const q = paySearch.trim().toLowerCase();
                  const filteredPayments = payments.filter((p) => {
                    if (payStatusFilter !== 'all' && p.status !== payStatusFilter) return false;
                    if (payMethodFilter !== 'all' && p.method !== payMethodFilter) return false;
                    if (!q) return true;
                    const uEmail = (users.find((u) => u.uid === p.customerId)?.email || '').toLowerCase();
                    return (
                      p.transactionId.toLowerCase().includes(q) ||
                      (p.orderNumber || '').toLowerCase().includes(q) ||
                      p.orderId.toLowerCase().includes(q) ||
                      p.customerId.toLowerCase().includes(q) ||
                      uEmail.includes(q) ||
                      p.senderNumber.toLowerCase().includes(q)
                    );
                  });

                  if (filteredPayments.length === 0) {
                    return (
                      <p className="text-xs text-[#777777] py-8 text-center">
                        No payment records match the selected filters.
                      </p>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      {filteredPayments.map((pay) => {
                        const payerEmail = users.find((u) => u.uid === pay.customerId)?.email || pay.customerId;
                        return (
                        <div key={pay.id} className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-3">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-start sm:items-center gap-3 min-w-0">
                              <PaymentProviderLogo method={pay.method} compact settings={settingsDraft} />
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="text-sm font-extrabold font-mono-num text-[#172033]">
                                    {pay.transactionId}
                                  </span>
                                  <span className="text-sm font-extrabold font-mono-num text-[#FF8500]">
                                    ৳{pay.amountBdt}
                                  </span>
                                  <span className="px-2 py-0.5 rounded-md bg-white border border-[#E6ECFA] text-[10px] font-bold text-[#172033]">
                                    {pay.purpose === 'add_money'
                                      ? 'Wallet Add Money'
                                      : `Order #${pay.orderNumber || pay.orderId}`}
                                  </span>
                                </div>
                                <p className="text-xs text-[#777777] mt-0.5">
                                  {payerEmail} · Sender{' '}
                                  <span className="font-mono-num font-bold text-[#172033]">{pay.senderNumber}</span> →{' '}
                                  <span className="font-mono-num">{pay.receiverNumber}</span> ·{' '}
                                  {formatDateShort(pay.createdAt, lang)}
                                </p>
                                {pay.rejectionReason && (
                                  <p className="text-xs font-semibold text-[#DC2626] mt-0.5">
                                    Reason: {pay.rejectionReason}
                                  </p>
                                )}
                              </div>
                            </div>

                            <span
                              className={`px-3 py-1 rounded-lg text-xs font-bold shrink-0 self-start sm:self-center ${
                                pay.status === 'Approved'
                                  ? 'bg-emerald-100 text-[#16A34A]'
                                  : pay.status === 'Rejected'
                                    ? 'bg-red-100 text-[#DC2626]'
                                    : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {pay.status}
                            </span>
                          </div>

                          {pay.receiptDataUrl && (
                            <div className="flex flex-wrap items-center gap-3">
                              <button
                                type="button"
                                onClick={() => setReceiptLightboxUrl(pay.receiptDataUrl || '')}
                                className="group relative rounded-xl overflow-hidden border border-[#E6ECFA] bg-white hover:border-[#FF8500] transition-colors"
                              >
                                <img
                                  src={pay.receiptDataUrl}
                                  alt="Payment Screenshot"
                                  className="max-h-36 w-auto object-contain"
                                />
                                <span className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-bold flex items-center gap-1">
                                  <Eye className="w-3 h-3" />
                                  View Full
                                </span>
                              </button>
                            </div>
                          )}

                          {pay.status === 'Verification Pending' && (
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                              <input
                                value={rejectionReasons[pay.id] || ''}
                                onChange={(e) =>
                                  setRejectionReasons({ ...rejectionReasons, [pay.id]: e.target.value })
                                }
                                placeholder="Rejection reason (required only if rejecting)"
                                className="flex-1 min-w-[200px] px-3 py-1.5 rounded-xl bg-white border border-[#E6ECFA] text-xs"
                              />
                              <button
                                type="button"
                                disabled={busyId === pay.id}
                                onClick={async () => {
                                  setBusyId(pay.id);
                                  try {
                                    if (pay.purpose === 'add_money') {
                                      const matchedTx: WalletTransaction = walletTxs.find(
                                        (w) => w.id === pay.orderId
                                      ) || {
                                        id: pay.orderId,
                                        userId: pay.customerId,
                                        userEmail: payerEmail,
                                        type: 'deposit',
                                        method: pay.method,
                                        amountBdt: pay.amountBdt,
                                        transactionId: pay.transactionId,
                                        senderNumber: pay.senderNumber,
                                        status:
                                          pay.status === 'Approved'
                                            ? 'Approved'
                                            : pay.status === 'Rejected'
                                              ? 'Rejected'
                                              : 'Verification Pending',
                                        createdAt: pay.createdAt,
                                      };
                                      await adminVerifyAddMoneyServer({ walletTx: matchedTx, decision: 'approve' });
                                      showOk(`Add Money (${pay.transactionId}) approved & ৳${pay.amountBdt} credited!`);
                                    } else {
                                      await adminVerifyPaymentServer({
                                        payment: pay,
                                        decision: 'approve',
                                        nextOrderStatus: 'Processing',
                                      });
                                      showOk(`Order payment ${pay.transactionId} approved!`);
                                    }
                                  } catch (e) {
                                    showErr(e);
                                  } finally {
                                    setBusyId('');
                                  }
                                }}
                                className="px-4 py-1.5 rounded-xl bg-[#16A34A] text-white text-xs font-bold hover:opacity-95 disabled:opacity-60"
                              >
                                {busyId === pay.id ? 'Processing...' : 'Approve'}
                              </button>
                              <button
                                type="button"
                                disabled={busyId === pay.id}
                                onClick={async () => {
                                  setBusyId(pay.id);
                                  const reason =
                                    rejectionReasons[pay.id] || 'Transaction not matched in receiver account';
                                  try {
                                    if (pay.purpose === 'add_money') {
                                      const matchedTx: WalletTransaction = walletTxs.find(
                                        (w) => w.id === pay.orderId
                                      ) || {
                                        id: pay.orderId,
                                        userId: pay.customerId,
                                        userEmail: payerEmail,
                                        type: 'deposit',
                                        method: pay.method,
                                        amountBdt: pay.amountBdt,
                                        transactionId: pay.transactionId,
                                        senderNumber: pay.senderNumber,
                                        status:
                                          pay.status === 'Approved'
                                            ? 'Approved'
                                            : pay.status === 'Rejected'
                                              ? 'Rejected'
                                              : 'Verification Pending',
                                        createdAt: pay.createdAt,
                                      };
                                      await adminVerifyAddMoneyServer({
                                        walletTx: matchedTx,
                                        decision: 'reject',
                                        rejectionReason: reason,
                                      });
                                      showOk(`Add Money (${pay.transactionId}) rejected.`);
                                    } else {
                                      await adminVerifyPaymentServer({
                                        payment: pay,
                                        decision: 'reject',
                                        rejectionReason: reason,
                                      });
                                      showOk(`Payment ${pay.transactionId} rejected.`);
                                    }
                                  } catch (e) {
                                    showErr(e);
                                  } finally {
                                    setBusyId('');
                                  }
                                }}
                                className="px-4 py-1.5 rounded-xl bg-[#DC2626] text-white text-xs font-bold hover:opacity-95 disabled:opacity-60"
                              >
                                Reject
                              </button>
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* 8. ADD MONEY REQUESTS */}
          {section === 'add_money' && (
            <div className="dh-card rounded-3xl p-5 space-y-3">
              <h2 className="text-lg font-bold text-[#172033]">Add Money Deposit Verification</h2>
              {depositTxs.length === 0 ? (
                <p className="text-sm text-[#777777] py-6 text-center">No Add Money requests yet.</p>
              ) : (
                depositTxs.map((tx) => (
                  <div key={tx.id} className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-2">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <PaymentProviderLogo
                          method={tx.method === 'system' ? 'wallet' : tx.method}
                          compact
                          settings={settingsDraft}
                        />
                        <div>
                          <p className="text-sm font-bold text-[#172033]">
                            +৳{tx.amountBdt} · <span className="font-mono-num">{tx.transactionId}</span>
                          </p>
                          <p className="text-xs text-[#777777]">
                            {tx.userEmail || tx.userId} · Sender: {tx.senderNumber} · {formatDateShort(tx.createdAt, lang)}
                          </p>
                        </div>
                      </div>
                      <span className="px-2.5 py-1 rounded-lg bg-white text-xs font-bold">{tx.status}</span>
                    </div>

                    {tx.receiptDataUrl && (
                      <button
                        type="button"
                        onClick={() => setReceiptLightboxUrl(tx.receiptDataUrl || '')}
                        className="relative rounded-xl overflow-hidden border border-[#E6ECFA] bg-white hover:border-[#FF8500]"
                      >
                        <img src={tx.receiptDataUrl} alt="Receipt" className="max-h-40 rounded-xl" />
                        <span className="absolute bottom-1.5 right-1.5 px-2 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-bold flex items-center gap-1">
                          <Eye className="w-3 h-3" />
                          View Full
                        </span>
                      </button>
                    )}

                    {tx.status === 'Verification Pending' && (
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={rejectionReasons[tx.id] || ''}
                          onChange={(e) => setRejectionReasons({ ...rejectionReasons, [tx.id]: e.target.value })}
                          placeholder="Rejection reason (optional)"
                          className="flex-1 min-w-[200px] px-3 py-1.5 rounded-xl bg-white border border-[#E6ECFA] text-xs"
                        />
                        <button
                          type="button"
                          disabled={busyId === tx.id}
                          onClick={async () => {
                            setBusyId(tx.id);
                            try {
                              await adminVerifyAddMoneyServer({ walletTx: tx, decision: 'approve' });
                              showOk(`Credited ৳${tx.amountBdt} to customer wallet.`);
                            } catch (e) {
                              showErr(e);
                            } finally {
                              setBusyId('');
                            }
                          }}
                          className="px-4 py-1.5 rounded-xl bg-[#16A34A] text-white text-xs font-bold"
                        >
                          Approve & Credit Wallet
                        </button>
                        <button
                          type="button"
                          disabled={busyId === tx.id}
                          onClick={async () => {
                            setBusyId(tx.id);
                            try {
                              await adminVerifyAddMoneyServer({
                                walletTx: tx,
                                decision: 'reject',
                                rejectionReason: rejectionReasons[tx.id] || 'Deposit transaction not verified',
                              });
                              showOk('Deposit rejected.');
                            } catch (e) {
                              showErr(e);
                            } finally {
                              setBusyId('');
                            }
                          }}
                          className="px-4 py-1.5 rounded-xl bg-[#DC2626] text-white text-xs font-bold"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* 8. WALLETS & FULL LEDGER */}
          {section === 'wallets' && (
            <div className="space-y-5">
              <div className="dh-card rounded-3xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-[#172033]">Customer Wallets ({wallets.length})</h2>
                    <p className="text-xs text-[#777777]">
                      Add credit, deduct balance, or set exact verified wallet balance with full audit logs.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {wallets.map((w) => {
                    const matchedUser = users.find((u) => u.uid === w.uid);
                    return (
                      <div
                        key={w.uid}
                        className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs flex items-center justify-between gap-3"
                      >
                        <div className="space-y-1 min-w-0">
                          <p className="font-bold text-[#172033] truncate">
                            {matchedUser?.displayName || 'Customer'}
                            {matchedUser?.email ? ` (${matchedUser.email})` : ''}
                          </p>
                          <p className="font-mono-num text-[11px] text-[#777777] truncate">{w.uid}</p>
                          <p className="text-[#FF8500] font-extrabold font-mono-num text-base">
                            Available: ৳{w.availableBalanceBdt}
                          </p>
                          <p className="text-[#777777] font-mono-num">
                            Added: ৳{w.totalAddedBdt} · Spent: ৳{w.totalSpentBdt}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setWalletAdjTarget({
                              uid: w.uid,
                              email: matchedUser?.email,
                              name: matchedUser?.displayName,
                            });
                            setWalletAdjMode('add');
                            setWalletAdjAmount('100');
                            setWalletAdjNote('');
                          }}
                          className="px-3 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold shrink-0"
                        >
                          Adjust Balance
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="dh-card rounded-3xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-bold text-[#172033]">
                      Full Wallet Transaction Ledger ({walletTxs.length})
                    </h3>
                    <p className="text-xs text-[#777777]">
                      All deposits, purchases, cashbacks, referrals, ad rewards, withdrawals, and admin adjustments.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-[#777777] absolute left-2.5 top-2.5" />
                      <input
                        value={txSearch}
                        onChange={(e) => setTxSearch(e.target.value)}
                        placeholder="Email, TxID, Note..."
                        className="pl-8 pr-3 py-1.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                      />
                    </div>
                    <select
                      value={txFilterType}
                      onChange={(e) => setTxFilterType(e.target.value)}
                      className="px-3 py-1.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-semibold"
                    >
                      <option value="all">All Types</option>
                      <option value="deposit">Deposit</option>
                      <option value="purchase">Purchase</option>
                      <option value="cashback">Cashback</option>
                      <option value="referral">Referral Commission</option>
                      <option value="rewarded_ad">Rewarded Ad</option>
                      <option value="withdrawal">Withdrawal</option>
                      <option value="withdrawal_refund">Withdrawal Refund</option>
                      <option value="admin_adjustment">Admin Adjustment</option>
                      <option value="promo_credit">Promo Credit</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                  {walletTxs
                    .filter((tx) => txFilterType === 'all' || tx.type === txFilterType)
                    .filter((tx) => {
                      if (!txSearch.trim()) return true;
                      const q = txSearch.toLowerCase();
                      return (
                        (tx.userEmail || '').toLowerCase().includes(q) ||
                        (tx.transactionId || '').toLowerCase().includes(q) ||
                        (tx.note || '').toLowerCase().includes(q) ||
                        tx.userId.toLowerCase().includes(q)
                      );
                    })
                    .slice(0, 120)
                    .map((tx) => (
                      <div
                        key={tx.id}
                        className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-[#172033] truncate">
                            <span className="uppercase text-[#FF8500] mr-1.5">[{tx.type}]</span>
                            {tx.userEmail || tx.userId}
                          </p>
                          <p className="text-[11px] text-[#777777] font-mono-num truncate">
                            {tx.method.toUpperCase()} · {tx.transactionId} · {formatDateShort(tx.createdAt, lang)}
                            {tx.note ? ` · ${tx.note}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono-num font-extrabold text-[#172033]">৳{tx.amountBdt}</span>
                          <span className="px-2 py-0.5 rounded-md bg-white border border-[#E6ECFA] text-[10px] font-bold">
                            {tx.status}
                          </span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {/* 9. WITHDRAWAL QUEUE */}
          {section === 'withdrawals' && (
            <div className="dh-card rounded-3xl p-5 space-y-3">
              <div>
                <h2 className="text-lg font-bold text-[#172033]">
                  Withdrawal Requests Queue ({withdrawals.length})
                </h2>
                <p className="text-xs text-[#777777]">
                  Approve after sending bKash/Nagad/Rocket payout (log reference ID), or Reject to automatically refund the escrowed balance to the user wallet.
                </p>
              </div>
              {withdrawals.length === 0 ? (
                <p className="text-sm text-[#777777] py-6 text-center">No withdrawal requests submitted yet.</p>
              ) : (
                withdrawals.map((w) => (
                  <div key={w.id} className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-2.5 text-xs">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-[#172033]">
                          ৳{w.amountBdt} · {w.method.toUpperCase()} ({w.accountNumber})
                        </p>
                        <p className="text-[#777777] font-mono-num">
                          {w.userEmail} · ID: {w.id} · {formatDateShort(w.createdAt, lang)}
                        </p>
                        {w.payoutReference && (
                          <p className="text-[#16A34A] font-bold mt-0.5">Payout Ref: {w.payoutReference}</p>
                        )}
                        {w.rejectionReason && (
                          <p className="text-[#DC2626] font-bold mt-0.5">Rejected: {w.rejectionReason}</p>
                        )}
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-lg font-bold self-start ${
                          w.status === 'Approved'
                            ? 'bg-emerald-100 text-[#16A34A]'
                            : w.status === 'Rejected'
                              ? 'bg-red-100 text-[#DC2626]'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {w.status}
                      </span>
                    </div>

                    {w.status === 'Pending' && (
                      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1">
                        <input
                          value={payoutRefs[w.id] || ''}
                          onChange={(e) => setPayoutRefs({ ...payoutRefs, [w.id]: e.target.value })}
                          placeholder="MFS Payout TrxID (for Approve)"
                          className="px-3 py-1.5 rounded-xl bg-white border border-[#E6ECFA] font-mono-num"
                        />
                        <input
                          value={rejectionReasons[w.id] || ''}
                          onChange={(e) => setRejectionReasons({ ...rejectionReasons, [w.id]: e.target.value })}
                          placeholder="Rejection reason (if rejecting)"
                          className="px-3 py-1.5 rounded-xl bg-white border border-[#E6ECFA]"
                        />
                        <button
                          type="button"
                          disabled={busyId === w.id}
                          onClick={async () => {
                            setBusyId(w.id);
                            try {
                              await adminProcessWithdrawalServer({
                                withdrawalId: w.id,
                                decision: 'approve',
                                payoutReference: payoutRefs[w.id] || '',
                              });
                              showOk(`Withdrawal ৳${w.amountBdt} approved & marked paid.`);
                            } catch (e) {
                              showErr(e);
                            } finally {
                              setBusyId('');
                            }
                          }}
                          className="px-4 py-1.5 rounded-xl bg-[#16A34A] text-white font-bold disabled:opacity-60"
                        >
                          {busyId === w.id ? 'Processing...' : 'Approve & Mark Paid'}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === w.id}
                          onClick={async () => {
                            setBusyId(w.id);
                            try {
                              await adminProcessWithdrawalServer({
                                withdrawalId: w.id,
                                decision: 'reject',
                                rejectionReason: rejectionReasons[w.id] || 'Invalid payout account or verification check failed',
                              });
                              showOk(`Withdrawal rejected & ৳${w.amountBdt} refunded to customer wallet.`);
                            } catch (e) {
                              showErr(e);
                            } finally {
                              setBusyId('');
                            }
                          }}
                          className="px-4 py-1.5 rounded-xl bg-[#DC2626] text-white font-bold disabled:opacity-60"
                        >
                          Reject & Refund
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {/* 9. ADVERTISEMENTS & OFFICIAL PUBLISHER NETWORKS */}
          {section === 'ads' && (
            <div className="space-y-5">
              {/* 9A. Direct Link / Native / Social Bar Ads */}
              <form onSubmit={handleSaveAd} className="dh-card rounded-3xl p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-bold text-[#172033]">
                    {editingAd ? `Edit ${editingAd.code}` : 'Add Direct / Native / Social Bar Advertisement'}
                  </h2>
                  <span className="text-[11px] font-semibold text-[#777777]">
                    Direct partner URLs (AD01–AD06) are preserved as safe clickable external links.
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    required
                    value={adCode}
                    onChange={(e) => setAdCode(e.target.value)}
                    placeholder="Code (e.g. AD01)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num"
                  />
                  <input
                    required
                    value={adTitleBn}
                    onChange={(e) => setAdTitleBn(e.target.value)}
                    placeholder="Title (Bangla)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <input
                    required
                    value={adTitleEn}
                    onChange={(e) => setAdTitleEn(e.target.value)}
                    placeholder="Title (English)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <input
                    type="url"
                    required
                    value={adUrl}
                    onChange={(e) => setAdUrl(e.target.value)}
                    placeholder="Target URL (https://...)"
                    className="sm:col-span-2 px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <input
                    type="number"
                    value={adOrder}
                    onChange={(e) => setAdOrder(e.target.value)}
                    placeholder="Order"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <select
                    value={adFormat}
                    onChange={(e) => setAdFormat(e.target.value as AdFormat)}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-semibold"
                  >
                    <option value="direct_link">Format: Direct Link</option>
                    <option value="native">Format: Native Ad Card</option>
                    <option value="banner">Format: Banner Ad</option>
                    <option value="social_bar">Format: Social Bar</option>
                  </select>
                  <select
                    value={adPlacement}
                    onChange={(e) => setAdPlacement(e.target.value as AdPlacement)}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  >
                    <option value="all">Placement: All Pages</option>
                    <option value="player">Ad Player</option>
                    <option value="between_sections">Homepage Native / Between Sections</option>
                    <option value="service_banner">Service Page</option>
                    <option value="product_page">Product Page</option>
                    <option value="dashboard_promo">Dashboard Promo</option>
                    <option value="social_bar">Floating Social Bar</option>
                    <option value="ads_page">Ads Hub</option>
                  </select>
                  <input
                    value={adNetworkName}
                    onChange={(e) => setAdNetworkName(e.target.value)}
                    placeholder="Partner / Network Label"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <select
                    value={adMediaType}
                    onChange={(e) => setAdMediaType(e.target.value as 'external' | 'video')}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  >
                    <option value="external">External Partner Link</option>
                    <option value="video">Real Video File (.mp4/.webm)</option>
                  </select>
                  <input
                    value={adMediaUrl}
                    onChange={(e) => setAdMediaUrl(e.target.value)}
                    placeholder="Optional .mp4 URL (video mode only)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <input
                    value={adDescEn}
                    onChange={(e) => {
                      setAdDescEn(e.target.value);
                      setAdDescBn(e.target.value);
                    }}
                    placeholder="Short Description (optional)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#FFF7EE] border border-[#FF8500]/40 text-xs font-bold cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-[#FF8500]" />
                    Upload Thumbnail
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleUploadImage(e, setAdThumb)}
                      className="hidden"
                    />
                  </label>
                  <button type="submit" className="px-5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold">
                    {editingAd ? 'Update Ad' : 'Save Ad'}
                  </button>
                  {editingAd && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingAd(null);
                        setAdCode('AD07');
                        setAdTitleBn('');
                        setAdTitleEn('');
                        setAdUrl('');
                      }}
                      className="px-4 py-2 rounded-xl bg-[#F3F6FF] text-xs font-bold text-[#172033]"
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </form>

              <div className="dh-card rounded-3xl p-5 space-y-2.5">
                <h3 className="text-sm font-bold text-[#172033]">
                  Active & Saved Advertisements ({advertisements.length})
                </h3>
                {advertisements.map((ad) => (
                  <div
                    key={ad.id}
                    className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#172033]">
                        [{ad.code}] #{ad.sortOrder} · <span className="text-[#FF8500] uppercase">{ad.adFormat || 'direct_link'}</span> ·{' '}
                        {ad.titleEn}
                      </p>
                      <p className="text-[11px] font-mono-num text-[#777777] truncate">
                        {ad.targetUrl} · Placement: {ad.placement}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          adminSaveAdvertisement({ ...ad, enabled: !ad.enabled }, false)
                            .then(() => showOk('Ad status toggled.'))
                            .catch(showErr)
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-bold ${
                          ad.enabled ? 'bg-emerald-100 text-[#16A34A]' : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {ad.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAd(ad);
                          setAdCode(ad.code);
                          setAdTitleBn(ad.titleBn);
                          setAdTitleEn(ad.titleEn);
                          setAdDescBn(ad.descriptionBn || '');
                          setAdDescEn(ad.descriptionEn || '');
                          setAdUrl(ad.targetUrl);
                          setAdPlacement(ad.placement);
                          setAdFormat(ad.adFormat || 'direct_link');
                          setAdNetworkName(ad.networkName || 'Direct Partner');
                          setAdMediaType(ad.mediaType);
                          setAdMediaUrl(ad.mediaUrl || '');
                          setAdThumb(ad.thumbnailUrl || '');
                          setAdOrder(String(ad.sortOrder));
                        }}
                        className="px-2.5 py-1 rounded-lg bg-white border border-[#E6ECFA] text-xs font-bold"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => adminDeleteAdvertisement(ad.id).then(() => showOk('Ad deleted.')).catch(showErr)}
                        className="p-1.5 rounded-lg bg-red-50 text-[#DC2626]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* 9B. Official Ad Network Publisher Scripts Manager */}
              <form onSubmit={handleSaveAdNetwork} className="dh-card rounded-3xl p-5 space-y-3 border border-[#FF8500]/30">
                <div>
                  <h2 className="text-lg font-bold text-[#172033]">
                    {editingNet ? `Edit Publisher Script: ${editingNet.name}` : 'Official Ad Network Publisher Scripts'}
                  </h2>
                  <p className="text-xs text-[#777777] mt-0.5">
                    Configure approved AdSense (Publisher ca-pub + Slot ID) or HTTPS Adsterra / Monetag / PropellerAds zone scripts. Never paste direct redirect URLs here.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <select
                    value={netProvider}
                    onChange={(e) => {
                      const prov = e.target.value as AdNetworkProvider;
                      setNetProvider(prov);
                      if (prov === 'adsense') setNetSupportsRewards(false);
                    }}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-semibold"
                  >
                    <option value="adsense">Google AdSense</option>
                    <option value="adsterra">Adsterra</option>
                    <option value="monetag">Monetag</option>
                    <option value="propellerads">PropellerAds</option>
                    <option value="custom_https">Custom Official HTTPS Script</option>
                  </select>
                  <input
                    required
                    value={netName}
                    onChange={(e) => setNetName(e.target.value)}
                    placeholder="Slot Name (e.g. AdSense Top Banner)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                  />
                  <select
                    value={netFormat}
                    onChange={(e) => setNetFormat(e.target.value as 'banner' | 'native' | 'social_bar')}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                  >
                    <option value="banner">Format: Banner</option>
                    <option value="native">Format: Native</option>
                    <option value="social_bar">Format: Social Bar</option>
                  </select>
                  <select
                    value={netPlacement}
                    onChange={(e) => setNetPlacement(e.target.value as BannerSlot | 'social_bar' | 'all')}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                  >
                    <option value="all">Placement: All Slots</option>
                    <option value="home_top">home_top</option>
                    <option value="between_sections">between_sections</option>
                    <option value="home_middle">home_middle</option>
                    <option value="home_bottom">home_bottom</option>
                    <option value="service_page">service_page</option>
                    <option value="product_page">product_page</option>
                    <option value="dashboard_promo">dashboard_promo</option>
                    <option value="social_bar">social_bar</option>
                  </select>
                  <input
                    value={netPublisherId}
                    onChange={(e) => setNetPublisherId(e.target.value)}
                    placeholder="Publisher ID (e.g. ca-pub-XXXX)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                  />
                  <input
                    value={netZoneId}
                    onChange={(e) => setNetZoneId(e.target.value)}
                    placeholder="Ad Slot / Zone ID"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                  />
                  <input
                    value={netScriptSrc}
                    onChange={(e) => setNetScriptSrc(e.target.value)}
                    placeholder="Official HTTPS Script src (Adsterra / Monetag)"
                    className="sm:col-span-2 px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                  />
                  <input
                    value={netContainerId}
                    onChange={(e) => setNetContainerId(e.target.value)}
                    placeholder="Optional Container Div ID"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                  />
                  <select
                    value={netApproval}
                    onChange={(e) => setNetApproval(e.target.value as AdNetworkConfig['approvalStatus'])}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-semibold"
                  >
                    <option value="pending_approval">Status: Pending Approval</option>
                    <option value="active">Status: Approved & Active</option>
                    <option value="paused">Status: Paused</option>
                  </select>
                  <label
                    className={`sm:col-span-2 flex items-center gap-2 px-3 py-2 rounded-xl border font-semibold ${
                      netProvider === 'adsense'
                        ? 'bg-red-50 border-red-200 text-[#DC2626] opacity-75 cursor-not-allowed'
                        : 'bg-[#FFF7EE] border-[#FF8500]/30 text-[#172033] cursor-pointer'
                    }`}
                  >
                    <input
                      type="checkbox"
                      disabled={netProvider === 'adsense'}
                      checked={netProvider === 'adsense' ? false : netSupportsRewards}
                      onChange={(e) => setNetSupportsRewards(e.target.checked)}
                    />
                    <span>
                      {netProvider === 'adsense'
                        ? 'Incentivized Rewards Blocked (Google AdSense Policy)'
                        : 'Eligible for Policy-Compliant User Rewarded Ad Claims'}
                    </span>
                  </label>
                  <div className="sm:col-span-3 flex items-center gap-2">
                    <button type="submit" className="px-5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold">
                      {editingNet ? 'Update Publisher Network' : 'Save Publisher Network'}
                    </button>
                    {editingNet && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNet(null);
                          setNetSupportsRewards(false);
                        }}
                        className="px-4 py-2 rounded-xl bg-[#F3F6FF] text-xs font-bold"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  {adNetworks.map((net) => (
                    <div
                      key={net.id}
                      className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-[#172033]">
                          {net.name} · <span className="text-[#FF8500] uppercase">{net.provider}</span> ({net.adFormat} · {net.placement})
                          {net.supportsIncentivizedRewards && net.provider !== 'adsense' && (
                            <span className="ml-2 px-2 py-0.5 rounded-md bg-emerald-100 text-[#16A34A] text-[10px] font-bold">
                              Rewarded Enabled
                            </span>
                          )}
                        </p>
                        <p className="text-[11px] font-mono-num text-[#777777] truncate">
                          Status: {net.approvalStatus} · Pub: {net.publisherId || '—'} · Zone: {net.zoneId || '—'}
                          {net.scriptSrc ? ` · ${net.scriptSrc}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            adminSaveAdNetwork({ ...net, enabled: !net.enabled }, false)
                              .then(() => showOk('Publisher network toggled.'))
                              .catch(showErr)
                          }
                          className={`px-2.5 py-1 rounded-lg font-bold ${
                            net.enabled && net.approvalStatus === 'active'
                              ? 'bg-emerald-100 text-[#16A34A]'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {net.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingNet(net);
                            setNetProvider(net.provider);
                            setNetName(net.name);
                            setNetFormat(net.adFormat);
                            setNetPlacement(net.placement);
                            setNetPublisherId(net.publisherId || '');
                            setNetZoneId(net.zoneId || '');
                            setNetScriptSrc(net.scriptSrc || '');
                            setNetContainerId(net.containerId || '');
                            setNetSupportsRewards(
                              net.provider === 'adsense' ? false : Boolean(net.supportsIncentivizedRewards)
                            );
                            setNetApproval(net.approvalStatus);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-white border border-[#E6ECFA] font-bold"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            adminDeleteAdNetwork(net.id)
                              .then(() => showOk('Publisher network deleted.'))
                              .catch(showErr)
                          }
                          className="p-1.5 rounded-lg bg-red-50 text-[#DC2626]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </form>

              {/* 9C. Policy-Compliant Rewarded Ads Settings & Claims Queue */}
              <div className="dh-card rounded-3xl p-5 space-y-4">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    adminSaveSiteSettings(settingsDraft)
                      .then(() => showOk('Rewarded Ads settings updated.'))
                      .catch(showErr);
                  }}
                  className="space-y-3"
                >
                  <div>
                    <h2 className="text-lg font-bold text-[#172033] flex items-center gap-2">
                      <Coins className="w-5 h-5 text-[#FF8500]" />
                      Rewarded Ads Policy & Payout Settings
                    </h2>
                    <p className="text-xs text-[#777777]">
                      Only non-AdSense Ad Networks flagged &quot;Eligible for Rewarded Ad Claims&quot; appear in user dashboards. Direct partner links and Google AdSense never reward user clicks.
                    </p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                    <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-bold">
                      <input
                        type="checkbox"
                        checked={Boolean(settingsDraft.rewardedAdEnabled)}
                        onChange={(e) => setSettingsDraft({ ...settingsDraft, rewardedAdEnabled: e.target.checked })}
                      />
                      Enable Rewarded Ads
                    </label>
                    <div>
                      <label className="block font-bold mb-1">Reward Amount (BDT)</label>
                      <input
                        type="number"
                        min={1}
                        max={100}
                        value={settingsDraft.rewardedAdAmountBdt ?? 2}
                        onChange={(e) =>
                          setSettingsDraft({ ...settingsDraft, rewardedAdAmountBdt: Math.max(1, Number(e.target.value) || 1) })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">Cooldown (Minutes)</label>
                      <input
                        type="number"
                        min={1}
                        max={1440}
                        value={settingsDraft.rewardedAdCooldownMinutes ?? 30}
                        onChange={(e) =>
                          setSettingsDraft({ ...settingsDraft, rewardedAdCooldownMinutes: Math.max(1, Number(e.target.value) || 1) })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">Daily Limit Per User</label>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={settingsDraft.rewardedAdDailyLimit ?? 5}
                        onChange={(e) =>
                          setSettingsDraft({ ...settingsDraft, rewardedAdDailyLimit: Math.max(1, Number(e.target.value) || 1) })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                      />
                    </div>
                  </div>
                  <button type="submit" className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold">
                    Save Rewarded Ads Policy
                  </button>
                </form>

                <div className="pt-2 border-t border-[#E6ECFA] space-y-2">
                  <h3 className="text-sm font-bold text-[#172033]">
                    User Rewarded Ad Claims ({rewardClaims.length})
                  </h3>
                  {rewardClaims.length === 0 ? (
                    <p className="text-xs text-[#777777] py-4 text-center">No rewarded ad claims submitted yet.</p>
                  ) : (
                    rewardClaims.map((claim) => (
                      <div
                        key={claim.id}
                        className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <p className="font-bold text-[#172033]">
                            ৳{claim.amountBdt} · {claim.networkName} ({claim.userEmail || claim.userId})
                          </p>
                          <p className="text-[11px] font-mono-num text-[#777777]">
                            Date: {claim.claimDate} · Status: {claim.status}
                          </p>
                        </div>
                        {claim.status === 'Pending Credit' ? (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={busyId === claim.id}
                              onClick={async () => {
                                setBusyId(claim.id);
                                try {
                                  await adminSettleRewardClaimServer({ claimId: claim.id, decision: 'credit' });
                                  showOk(`Credited ৳${claim.amountBdt} ad reward to user wallet.`);
                                } catch (e) {
                                  showErr(e);
                                } finally {
                                  setBusyId('');
                                }
                              }}
                              className="px-3 py-1.5 rounded-xl bg-[#16A34A] text-white font-bold disabled:opacity-60"
                            >
                              Credit Wallet
                            </button>
                            <button
                              type="button"
                              disabled={busyId === claim.id}
                              onClick={async () => {
                                setBusyId(claim.id);
                                try {
                                  await adminSettleRewardClaimServer({
                                    claimId: claim.id,
                                    decision: 'reject',
                                    rejectionReason: 'Did not meet incentivized verification check',
                                  });
                                  showOk('Rewarded ad claim rejected.');
                                } catch (e) {
                                  showErr(e);
                                } finally {
                                  setBusyId('');
                                }
                              }}
                              className="px-3 py-1.5 rounded-xl bg-[#DC2626] text-white font-bold disabled:opacity-60"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span
                            className={`px-2.5 py-1 rounded-lg font-bold ${
                              claim.status === 'Credited'
                                ? 'bg-emerald-100 text-[#16A34A]'
                                : 'bg-red-100 text-[#DC2626]'
                            }`}
                          >
                            {claim.status}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* 9D. Centralized 24 Ad Units Configuration & Live Verification Status */}
              <div className="dh-card rounded-3xl p-5 space-y-4 border border-[#FF8500]/30">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-[#172033]">
                      Centralized 24 Ad Units Manager (UNIT_01 – UNIT_24)
                    </h2>
                    <p className="text-xs text-[#777777]">
                      Control enabled/disabled state, mobile/desktop visibility, placements, priority, rotation cadence, and inspect live iframe telemetry. Scripts remain sandboxed with zero wallet/token access.
                    </p>
                  </div>
                  <span className="px-3 py-1 rounded-xl bg-[#F3F6FF] text-xs font-mono-num font-bold text-[#172033]">
                    {managedAdUnits.filter((u) => u.enabled).length} / {managedAdUnits.length} Enabled
                  </span>
                </div>

                <div className="space-y-3">
                  {managedAdUnits.map((u) => {
                    const draft = unitDrafts[u.id] || u;
                    const telemetry = unitStatuses[u.id];
                    const liveState = telemetry?.status || 'idle';
                    const setDraft = (patch: Partial<ManagedAdUnitConfig>) =>
                      setUnitDrafts((prev) => ({
                        ...prev,
                        [u.id]: { ...draft, ...patch },
                      }));
                    const togglePlacement = (slot: AdPlacementSlot) => {
                      const has = draft.placements.includes(slot);
                      const next = has
                        ? draft.placements.filter((p) => p !== slot)
                        : [...draft.placements, slot];
                      setDraft({ placements: next });
                    };
                    return (
                      <div
                        key={u.id}
                        className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-2.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-[#172033] flex flex-wrap items-center gap-1.5">
                              <span className="font-mono-num text-[#FF8500]">{u.id}</span>
                              <span>· {u.provider}</span>
                              <span className="px-2 py-0.5 rounded-md bg-white border border-[#E6ECFA] text-[10px] uppercase">
                                {u.format}
                                {u.dimensions ? ` (${u.dimensions.width}x${u.dimensions.height})` : ''}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                                  liveState === 'loaded'
                                    ? 'bg-emerald-100 text-[#16A34A]'
                                    : liveState === 'blocked' || liveState === 'error'
                                      ? 'bg-red-100 text-[#DC2626]'
                                      : liveState === 'loading'
                                        ? 'bg-amber-100 text-amber-800'
                                        : 'bg-white text-[#777777] border border-[#E6ECFA]'
                                }`}
                              >
                                Status: {liveState}
                              </span>
                            </p>
                            <p className="text-[11px] font-mono-num text-[#777777] truncate max-w-2xl mt-0.5">
                              {u.originalUrl || u.label}
                              {telemetry?.error ? ` · Error: ${telemetry.error}` : ''}
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            <label className="flex items-center gap-1 font-bold bg-white px-2.5 py-1 rounded-lg border border-[#E6ECFA]">
                              <input
                                type="checkbox"
                                checked={draft.enabled}
                                onChange={(e) => setDraft({ enabled: e.target.checked })}
                              />
                              Enabled
                            </label>
                            <label className="flex items-center gap-1 font-semibold bg-white px-2.5 py-1 rounded-lg border border-[#E6ECFA]">
                              <input
                                type="checkbox"
                                checked={draft.showOnMobile}
                                onChange={(e) => setDraft({ showOnMobile: e.target.checked })}
                              />
                              Mobile
                            </label>
                            <label className="flex items-center gap-1 font-semibold bg-white px-2.5 py-1 rounded-lg border border-[#E6ECFA]">
                              <input
                                type="checkbox"
                                checked={draft.showOnDesktop}
                                onChange={(e) => setDraft({ showOnDesktop: e.target.checked })}
                              />
                              Desktop
                            </label>
                            <label className="flex items-center gap-1 font-semibold bg-[#FFF7EE] px-2.5 py-1 rounded-lg border border-[#FF8500]/30">
                              <input
                                type="checkbox"
                                checked={Boolean(draft.supportsRewardedVerification)}
                                onChange={(e) =>
                                  setDraft({ supportsRewardedVerification: e.target.checked })
                                }
                              />
                              S2S Rewarded
                            </label>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap gap-1.5">
                            {ALL_AD_PLACEMENT_SLOTS.map((slot) => (
                              <label
                                key={slot}
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold cursor-pointer ${
                                  draft.placements.includes(slot)
                                    ? 'bg-[#172033] text-white border-[#172033]'
                                    : 'bg-white text-[#777777] border-[#E6ECFA]'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  className="hidden"
                                  checked={draft.placements.includes(slot)}
                                  onChange={() => togglePlacement(slot)}
                                />
                                {AD_PLACEMENT_LABELS[slot].en}
                              </label>
                            ))}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[10px] text-[#777777]">Priority</span>
                            <input
                              type="number"
                              min={1}
                              max={999}
                              value={draft.priority}
                              onChange={(e) => setDraft({ priority: Number(e.target.value) || 1 })}
                              className="w-14 px-2 py-1 rounded-lg bg-white border border-[#E6ECFA] font-mono-num"
                            />
                            <span className="text-[10px] text-[#777777]">Rot(s)</span>
                            <input
                              type="number"
                              min={5}
                              max={300}
                              value={draft.rotationSeconds}
                              onChange={(e) =>
                                setDraft({ rotationSeconds: Number(e.target.value) || 20 })
                              }
                              className="w-14 px-2 py-1 rounded-lg bg-white border border-[#E6ECFA] font-mono-num"
                            />
                            <button
                              type="button"
                              disabled={busyId === u.id}
                              onClick={async () => {
                                setBusyId(u.id);
                                try {
                                  await adminSaveManagedAdUnit(draft);
                                  showOk(`Saved configuration for ${u.id}.`);
                                } catch (err) {
                                  showErr(err);
                                } finally {
                                  setBusyId('');
                                }
                              }}
                              className="px-3 py-1.5 rounded-lg dh-orange-gradient text-white font-bold disabled:opacity-60"
                            >
                              {busyId === u.id ? '...' : 'Save Unit'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 9E. Watch & Earn Coin Policy, Redemption Settlement & Viewing Sessions Monitor */}
              <div className="dh-card rounded-3xl p-5 space-y-4">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    adminSaveSiteSettings(settingsDraft)
                      .then(() => showOk('Watch & Earn policy saved.'))
                      .catch(showErr);
                  }}
                  className="space-y-3"
                >
                  <div>
                    <h2 className="text-lg font-bold text-[#172033]">
                      Watch &amp; Earn System Policy &amp; Coin Economics
                    </h2>
                    <p className="text-xs text-[#777777]">
                      Only S2S postback-verified incentivized sessions can award coins. Configure coin rates, daily caps, and minimum redemption threshold.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                    <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-bold">
                      <input
                        type="checkbox"
                        checked={settingsDraft.watchEarnEnabled !== false}
                        onChange={(e) =>
                          setSettingsDraft({ ...settingsDraft, watchEarnEnabled: e.target.checked })
                        }
                      />
                      Watch &amp; Earn Enabled
                    </label>
                    <div>
                      <label className="block font-bold mb-1">Coins Per Verified Ad</label>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        value={settingsDraft.watchEarnCoinsPerAd ?? 10}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            watchEarnCoinsPerAd: Math.max(1, Number(e.target.value) || 10),
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">Coins Per 1 BDT</label>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={settingsDraft.watchEarnCoinsPerBdt ?? 10}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            watchEarnCoinsPerBdt: Math.max(1, Number(e.target.value) || 10),
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">Daily Coin Cap</label>
                      <input
                        type="number"
                        min={10}
                        max={10000}
                        value={settingsDraft.watchEarnDailyCoinLimit ?? 100}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            watchEarnDailyCoinLimit: Math.max(10, Number(e.target.value) || 100),
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                      />
                    </div>
                    <div>
                      <label className="block font-bold mb-1">Min Redeem Coins</label>
                      <input
                        type="number"
                        min={10}
                        max={10000}
                        value={settingsDraft.watchEarnMinRedeemCoins ?? 50}
                        onChange={(e) =>
                          setSettingsDraft({
                            ...settingsDraft,
                            watchEarnMinRedeemCoins: Math.max(10, Number(e.target.value) || 50),
                          })
                        }
                        className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold"
                  >
                    Save Watch &amp; Earn Policy
                  </button>
                </form>

                {/* Coin Redemption Payout Queue */}
                <div className="pt-3 border-t border-[#E6ECFA] space-y-2">
                  <h3 className="text-sm font-bold text-[#172033]">
                    Watch &amp; Earn Coin Transactions &amp; Redemptions ({adRewardTransactions.length})
                  </h3>
                  {adRewardTransactions.length === 0 ? (
                    <p className="text-xs text-[#777777] py-3 text-center">
                      No Watch &amp; Earn coin transactions recorded yet.
                    </p>
                  ) : (
                    adRewardTransactions.slice(0, 20).map((tx) => (
                      <div
                        key={tx.id}
                        className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-wrap items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <p className="font-bold text-[#172033]">
                            {tx.coins} Coins · ৳{tx.bdtEquivalent} · {tx.userEmail || tx.userId}
                          </p>
                          <p className="text-[11px] text-[#777777]">{tx.note}</p>
                        </div>
                        {tx.status === 'Pending Credit' ? (
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={busyId === tx.id}
                              onClick={async () => {
                                setBusyId(tx.id);
                                try {
                                  await adminSettleCoinRedemptionServer({
                                    txId: tx.id,
                                    decision: 'credit',
                                  });
                                  showOk(`Credited ৳${tx.bdtEquivalent} to user wallet.`);
                                } catch (err) {
                                  showErr(err);
                                } finally {
                                  setBusyId('');
                                }
                              }}
                              className="px-3 py-1 rounded-lg bg-[#16A34A] text-white font-bold"
                            >
                              Credit Wallet
                            </button>
                            <button
                              type="button"
                              disabled={busyId === tx.id}
                              onClick={async () => {
                                setBusyId(tx.id);
                                try {
                                  await adminSettleCoinRedemptionServer({
                                    txId: tx.id,
                                    decision: 'reject',
                                    reason: 'Rejected by administrator',
                                  });
                                  showOk('Redemption rejected & coins restored.');
                                } catch (err) {
                                  showErr(err);
                                } finally {
                                  setBusyId('');
                                }
                              }}
                              className="px-3 py-1 rounded-lg bg-[#DC2626] text-white font-bold"
                            >
                              Reject
                            </button>
                          </div>
                        ) : (
                          <span className="px-2.5 py-0.5 rounded-md bg-white border border-[#E6ECFA] font-bold">
                            {tx.status}
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Watch & Earn Session & Failed Verification Log */}
                <div className="pt-3 border-t border-[#E6ECFA] space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-bold text-[#172033]">
                      Viewing Sessions &amp; Failed Verification Monitor ({viewingSessions.length})
                    </h3>
                    <div className="flex gap-1.5 text-[11px]">
                      {(['all', 'verification_failed', 'awaiting_callback', 'credited'] as const).map(
                        (f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setSessionFilter(f)}
                            className={`px-2.5 py-1 rounded-lg font-bold ${
                              sessionFilter === f
                                ? 'bg-[#172033] text-white'
                                : 'bg-[#F3F6FF] text-[#777777]'
                            }`}
                          >
                            {f}
                          </button>
                        )
                      )}
                    </div>
                  </div>
                  {viewingSessions.filter((s) => sessionFilter === 'all' || s.status === sessionFilter)
                    .length === 0 ? (
                    <p className="text-xs text-[#777777] py-3 text-center">
                      No matching viewing sessions recorded yet.
                    </p>
                  ) : (
                    viewingSessions
                      .filter((s) => sessionFilter === 'all' || s.status === sessionFilter)
                      .slice(0, 25)
                      .map((s) => (
                        <div
                          key={s.id}
                          className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <p className="font-bold text-[#172033]">
                              {s.unitId} ({s.provider}) · {s.userEmail || s.userId}
                            </p>
                            <p className="text-[11px] text-[#777777]">
                              {s.failureReason || `Session ${s.id}`} · {formatDateShort(s.createdAt, lang)}
                            </p>
                          </div>
                          <span
                            className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase shrink-0 ${
                              s.status === 'credited'
                                ? 'bg-emerald-100 text-[#16A34A]'
                                : s.status === 'verification_failed'
                                  ? 'bg-red-100 text-[#DC2626]'
                                  : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {s.status} ({s.coinsAwarded} coins)
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 10. BANNERS */}
          {section === 'banners' && (
            <div className="space-y-5">
              <form onSubmit={handleSaveBanner} className="dh-card rounded-3xl p-5 space-y-3">
                <h2 className="text-lg font-bold text-[#172033]">
                  {editingBanner ? 'Edit Banner' : 'Add Banner Slot'}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <input
                    required
                    value={banTitleBn}
                    onChange={(e) => setBanTitleBn(e.target.value)}
                    placeholder="Title (Bangla)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <input
                    required
                    value={banTitleEn}
                    onChange={(e) => setBanTitleEn(e.target.value)}
                    placeholder="Title (English)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <select
                    value={banSlot}
                    onChange={(e) => setBanSlot(e.target.value as BannerSlot)}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  >
                    <option value="home_top">home_top</option>
                    <option value="between_sections">between_sections</option>
                    <option value="home_middle">home_middle</option>
                    <option value="home_bottom">home_bottom</option>
                    <option value="service_page">service_page</option>
                    <option value="product_page">product_page</option>
                    <option value="dashboard_promo">dashboard_promo</option>
                  </select>
                  <input
                    type="url"
                    required
                    value={banUrl}
                    onChange={(e) => setBanUrl(e.target.value)}
                    placeholder="Destination URL"
                    className="sm:col-span-2 px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                  <input
                    type="number"
                    value={banOrder}
                    onChange={(e) => setBanOrder(e.target.value)}
                    placeholder="Order"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#FFF7EE] border border-[#FF8500]/40 text-xs font-bold cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-[#FF8500]" />
                    Desktop Image
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleUploadImage(e, setBanImg)}
                      className="hidden"
                    />
                  </label>
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-bold cursor-pointer">
                    <Upload className="w-3.5 h-3.5 text-[#172033]" />
                    Mobile Image
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => handleUploadImage(e, setBanMobileImg)}
                      className="hidden"
                    />
                  </label>
                  <button type="submit" className="px-5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold">
                    {editingBanner ? 'Update Banner' : 'Save Banner'}
                  </button>
                </div>
              </form>

              <div className="dh-card rounded-3xl p-5 space-y-2">
                {banners.map((b) => (
                  <div key={b.id} className="p-3 rounded-2xl bg-[#F3F6FF] flex flex-wrap justify-between items-center gap-2 text-xs">
                    <div>
                      <span className="font-mono-num font-bold text-[#FF8500] mr-2">[{b.slot}]</span>
                      <span className="font-bold text-[#172033]">{b.titleEn}</span>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          adminSaveBanner({ ...b, enabled: !b.enabled }, false).then(() => showOk('Banner toggled.')).catch(showErr)
                        }
                        className={`px-2.5 py-1 rounded-lg font-bold ${
                          b.enabled ? 'bg-emerald-100 text-[#16A34A]' : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {b.enabled ? 'On' : 'Off'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingBanner(b);
                          setBanTitleBn(b.titleBn);
                          setBanTitleEn(b.titleEn);
                          setBanSlot(b.slot);
                          setBanUrl(b.targetUrl);
                          setBanImg(b.imageUrl || '');
                          setBanMobileImg(b.mobileImageUrl || '');
                          setBanOrder(String(b.sortOrder));
                        }}
                        className="px-2.5 py-1 rounded-lg bg-white border border-[#E6ECFA] font-bold"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => adminDeleteBanner(b.id).then(() => showOk('Banner deleted.')).catch(showErr)}
                        className="p-1.5 rounded-lg bg-red-50 text-[#DC2626]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 11. AD ANALYTICS & VERIFIED REVENUE */}
          {section === 'ad_analytics' && (
            <div className="space-y-5">
              <div className="dh-card rounded-3xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-[#172033]">
                    Advertisement Analytics (Anti-Fraud Telemetry)
                  </h2>
                  <button
                    type="button"
                    onClick={loadAnalytics}
                    className="px-3 py-1.5 rounded-xl bg-[#F3F6FF] text-xs font-bold flex items-center gap-1"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Refresh
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  <div className="p-4 rounded-2xl bg-[#F3F6FF]">
                    <p className="text-xs text-[#777777]">Total Impressions</p>
                    <p className="text-2xl font-extrabold font-mono-num">{adAnalytics?.totalImpressions || 0}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#F3F6FF]">
                    <p className="text-xs text-[#777777]">Total Real Clicks</p>
                    <p className="text-2xl font-extrabold font-mono-num text-[#FF8500]">{adAnalytics?.totalClicks || 0}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#F3F6FF]">
                    <p className="text-xs text-[#777777]">Click-Through Rate</p>
                    <p className="text-2xl font-extrabold font-mono-num text-[#16A34A]">{adAnalytics?.ctr || 0}%</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#F3F6FF]">
                    <p className="text-xs text-[#777777]">Blocked Fake Clicks</p>
                    <p className="text-2xl font-extrabold font-mono-num text-[#DC2626]">
                      {adAnalytics?.blockedFakeClicks || 0}
                    </p>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#F3F6FF]">
                    <p className="text-xs text-[#777777]">Active Ads / Networks</p>
                    <p className="text-2xl font-extrabold font-mono-num">
                      {advertisements.filter((a) => a.enabled).length} /{' '}
                      {adNetworks.filter((n) => n.enabled && n.approvalStatus === 'active').length}
                    </p>
                  </div>
                </div>

                {adAnalytics?.byFormat && Object.keys(adAnalytics.byFormat).length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-bold text-[#172033]">Performance by Ad Format</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-xs">
                      {Object.entries(adAnalytics.byFormat).map(([fmt, stats]) => (
                        <div key={fmt} className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA]">
                          <p className="font-bold uppercase text-[#FF8500] text-[10px]">{fmt}</p>
                          <p className="font-mono-num font-bold text-[#172033] mt-1">
                            {stats.impressions} imp · {stats.clicks} clk
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {adAnalytics?.byAd && Object.keys(adAnalytics.byAd).length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-bold text-[#172033]">Per-Ad Performance (AD01–AD06 & Banners)</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                      {Object.entries(adAnalytics.byAd).map(([adKey, stats]) => (
                        <div
                          key={adKey}
                          className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex items-center justify-between"
                        >
                          <span className="font-mono-num font-bold text-[#172033]">{adKey}</span>
                          <span className="font-mono-num text-[#777777]">
                            {stats.impressions} imp · <strong className="text-[#FF8500]">{stats.clicks}</strong> clicks
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Verified Advertising Revenue Ledger */}
              <div className="dh-card rounded-3xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h3 className="text-base font-bold text-[#172033]">Verified Advertising Revenue Ledger</h3>
                    <p className="text-xs text-[#777777]">
                      Record verified statement payouts from AdSense, Adsterra, Monetag, or partner dashboards. Clicks never auto-generate fake revenue.
                    </p>
                  </div>
                  <div className="px-4 py-2 rounded-2xl bg-[#FFF3E5] text-[#FF8500] font-mono-num font-extrabold text-base shrink-0">
                    Total Verified: ৳
                    {adRevenueEntries.reduce((sum, e) => sum + (e.verifiedAmountBdt || 0), 0).toFixed(2)}
                  </div>
                </div>

                <form onSubmit={handleAddRevenueEntry} className="grid grid-cols-1 sm:grid-cols-6 gap-2.5 text-xs">
                  <input
                    required
                    value={revNetworkName}
                    onChange={(e) => setRevNetworkName(e.target.value)}
                    placeholder="Network (e.g. AdSense)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                  />
                  <input
                    required
                    value={revPeriodLabel}
                    onChange={(e) => setRevPeriodLabel(e.target.value)}
                    placeholder="Period (e.g. Nov 2026)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                  />
                  <input
                    type="number"
                    required
                    min="1"
                    step="0.01"
                    value={revAmountBdt}
                    onChange={(e) => setRevAmountBdt(e.target.value)}
                    placeholder="Verified BDT"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                  />
                  <input
                    type="number"
                    step="0.01"
                    value={revUsd}
                    onChange={(e) => setRevUsd(e.target.value)}
                    placeholder="USD (Optional)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                  />
                  <input
                    value={revRefId}
                    onChange={(e) => setRevRefId(e.target.value)}
                    placeholder="Statement Ref ID"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                  />
                  <button type="submit" className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold">
                    Log Verified Revenue
                  </button>
                </form>

                {adRevenueEntries.length === 0 ? (
                  <p className="text-xs text-[#777777] py-4 text-center">
                    No verified advertising payout statements recorded yet.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {adRevenueEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex items-center justify-between gap-2 text-xs"
                      >
                        <div>
                          <p className="font-bold text-[#172033]">
                            {entry.networkName} · {entry.periodLabel}
                          </p>
                          <p className="text-[11px] text-[#777777] font-mono-num">
                            {entry.referenceId ? `Ref: ${entry.referenceId} · ` : ''}
                            Logged by {entry.verifiedBy}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-mono-num font-extrabold text-[#16A34A]">
                            ৳{entry.verifiedAmountBdt}
                            {entry.reportedUsd ? ` ($${entry.reportedUsd})` : ''}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              adminDeleteAdRevenueEntry(entry.id)
                                .then(() => showOk('Revenue entry removed.'))
                                .catch(showErr)
                            }
                            className="p-1.5 rounded-lg bg-red-50 text-[#DC2626]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 13. REFERRAL SETTINGS & RECORDS */}
          {section === 'referrals' && (
            <div className="space-y-5">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  adminSaveSiteSettings(settingsDraft)
                    .then(() => showOk('Referral program settings saved.'))
                    .catch(showErr);
                }}
                className="dh-card rounded-3xl p-5 space-y-3"
              >
                <div>
                  <h2 className="text-lg font-bold text-[#172033]">Referral Program Rules</h2>
                  <p className="text-xs text-[#777777]">
                    Configure commission credited automatically to referrers when their referred user completes their first qualifying order.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                  <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-bold">
                    <input
                      type="checkbox"
                      checked={settingsDraft.referralEnabled !== false}
                      onChange={(e) => setSettingsDraft({ ...settingsDraft, referralEnabled: e.target.checked })}
                    />
                    Enable Referral Rewards
                  </label>
                  <div>
                    <label className="block font-bold mb-1">Inviter Bonus (BDT)</label>
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      value={settingsDraft.referralBonusBdt}
                      onChange={(e) =>
                        setSettingsDraft({ ...settingsDraft, referralBonusBdt: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">Invited Welcome Bonus (BDT)</label>
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      value={settingsDraft.invitedUserRewardBdt ?? 20}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          invitedUserRewardBdt: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">Min Qualifying Order (BDT)</label>
                    <input
                      type="number"
                      min={0}
                      max={100000}
                      value={settingsDraft.referralMinOrderBdt ?? 100}
                      onChange={(e) =>
                        setSettingsDraft({ ...settingsDraft, referralMinOrderBdt: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">Eligibility Rule</label>
                    <select
                      value={settingsDraft.referralEligibility || 'first_paid_order'}
                      onChange={(e) =>
                        setSettingsDraft({
                          ...settingsDraft,
                          referralEligibility: e.target.value as SiteSettings['referralEligibility'],
                        })
                      }
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-semibold"
                    >
                      <option value="first_paid_order">First Paid Order</option>
                      <option value="verified_signup">Verified Email Signup</option>
                      <option value="first_rewarded_ad">First Rewarded Ad</option>
                    </select>
                  </div>
                </div>
                <button type="submit" className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold">
                  Save Referral Settings
                </button>
              </form>

              <div className="dh-card rounded-3xl p-5 space-y-3">
                <h3 className="text-base font-bold text-[#172033]">Referral Records ({referrals.length})</h3>
                {referrals.length === 0 ? (
                  <p className="text-xs text-[#777777] py-6 text-center">No referral records yet.</p>
                ) : (
                  referrals.map((r) => {
                    const referrer = users.find((u) => u.uid === r.referrerId);
                    const referred = users.find((u) => u.uid === r.referredUserId);
                    return (
                      <div key={r.id} className="p-3 rounded-2xl bg-[#F3F6FF] flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 text-xs">
                        <div>
                          <p className="font-bold text-[#172033] flex flex-wrap items-center gap-1.5">
                            <span>
                              Code: <span className="font-mono-num text-[#FF8500]">{r.referralCode}</span> · Inviter ৳{r.rewardAmountBdt}
                              {r.invitedRewardBdt ? ` / Invited ৳${r.invitedRewardBdt}` : ''} ({r.status})
                            </span>
                            {r.suspiciousFlag && (
                              <span className="px-2 py-0.5 rounded-md bg-red-100 text-[#DC2626] text-[10px] font-bold">
                                Suspicious Flag
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-[#777777]">
                            Referrer: {referrer?.email || r.referrerId} → Referred: {referred?.email || r.referredEmail || r.referredUserId}
                            {r.suspiciousReason ? ` · ${r.suspiciousReason}` : ''}
                          </p>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={busyId === r.id || r.status === 'credited'}
                            onClick={async () => {
                              setBusyId(r.id);
                              try {
                                await adminSettleReferralServer({ referralId: r.id, decision: 'credit' });
                                showOk('Referral reward settled & credited to wallet.');
                              } catch (err) {
                                adminUpdateReferralStatus(r.id, 'credited')
                                  .then(() => showOk('Marked credited.'))
                                  .catch(showErr);
                                showErr(err);
                              } finally {
                                setBusyId('');
                              }
                            }}
                            className="px-3 py-1 rounded-lg bg-[#16A34A] text-white font-bold disabled:opacity-50"
                          >
                            Approve &amp; Credit
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={async () => {
                              setBusyId(r.id);
                              try {
                                await adminSettleReferralServer({ referralId: r.id, decision: 'revoke' });
                                showOk('Referral revoked.');
                              } catch (err) {
                                adminUpdateReferralStatus(r.id, 'revoked')
                                  .then(() => showOk('Revoked.'))
                                  .catch(showErr);
                                showErr(err);
                              } finally {
                                setBusyId('');
                              }
                            }}
                            className="px-3 py-1 rounded-lg bg-[#DC2626] text-white font-bold disabled:opacity-50"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}

          {/* 14. COUPONS */}
          {section === 'coupons' && (
            <div className="space-y-5">
              <form onSubmit={handleSaveCoupon} className="dh-card rounded-3xl p-5 grid grid-cols-2 sm:grid-cols-6 gap-2.5">
                <input
                  required
                  value={coupCode}
                  onChange={(e) => setCoupCode(e.target.value.toUpperCase())}
                  placeholder="Code (SAVE20)"
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num uppercase"
                />
                <select
                  value={coupType}
                  onChange={(e) => setCoupType(e.target.value as 'fixed' | 'percent')}
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                >
                  <option value="fixed">Fixed ৳</option>
                  <option value="percent">Percent %</option>
                </select>
                <input
                  type="number"
                  required
                  value={coupVal}
                  onChange={(e) => setCoupVal(e.target.value)}
                  placeholder="Value"
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num"
                />
                <input
                  type="number"
                  value={coupMin}
                  onChange={(e) => setCoupMin(e.target.value)}
                  placeholder="Min Order ৳"
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num"
                />
                <input
                  type="date"
                  value={coupExp}
                  onChange={(e) => setCoupExp(e.target.value)}
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
                />
                <button type="submit" className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold">
                  Create Coupon
                </button>
              </form>

              <div className="dh-card rounded-3xl p-5 space-y-2">
                {coupons.map((c) => (
                  <div key={c.id} className="p-3 rounded-2xl bg-[#F3F6FF] flex justify-between items-center text-xs">
                    <span className="font-mono-num font-bold text-[#172033]">
                      {c.code} · {c.discountType === 'percent' ? `${c.discountValue}%` : `৳${c.discountValue}`} · Min ৳
                      {c.minOrderBdt}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          adminSaveCoupon({ ...c, active: !c.active }, false).then(() => showOk('Coupon updated.')).catch(showErr)
                        }
                        className={`px-2.5 py-1 rounded-lg font-bold ${
                          c.active ? 'bg-emerald-100 text-[#16A34A]' : 'bg-gray-200 text-gray-600'
                        }`}
                      >
                        {c.active ? 'Active' : 'Paused'}
                      </button>
                      <button
                        type="button"
                        onClick={() => adminDeleteCoupon(c.id).then(() => showOk('Coupon deleted.')).catch(showErr)}
                        className="p-1.5 rounded-lg bg-red-50 text-[#DC2626]"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 15. GLOBAL ANNOUNCEMENTS BROADCAST */}
          {section === 'announcements' && (
            <div className="space-y-5">
              <form onSubmit={handleBroadcastAnnouncement} className="dh-card rounded-3xl p-5 space-y-3">
                <div>
                  <h2 className="text-lg font-bold text-[#172033] flex items-center gap-2">
                    <Bell className="w-5 h-5 text-[#FF8500]" />
                    Broadcast Global Notification / Announcement
                  </h2>
                  <p className="text-xs text-[#777777]">
                    Published announcements appear instantly inside every user&apos;s Notifications & Alerts center. Requires fresh owner re-auth.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <input
                    required
                    value={annTitleBn}
                    onChange={(e) => setAnnTitleBn(e.target.value)}
                    placeholder="Title (Bangla)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                  />
                  <input
                    required
                    value={annTitleEn}
                    onChange={(e) => setAnnTitleEn(e.target.value)}
                    placeholder="Title (English)"
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                  />
                  <select
                    value={annType}
                    onChange={(e) => setAnnType(e.target.value as Announcement['type'])}
                    className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] font-semibold"
                  >
                    <option value="info">Type: General Info</option>
                    <option value="promo">Type: Promo Offer</option>
                    <option value="policy">Type: Policy Update</option>
                    <option value="maintenance">Type: Maintenance Alert</option>
                  </select>
                  <textarea
                    required
                    rows={2}
                    value={annMsgBn}
                    onChange={(e) => setAnnMsgBn(e.target.value)}
                    placeholder="Message (Bangla)"
                    className="sm:col-span-3 px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                  />
                  <textarea
                    required
                    rows={2}
                    value={annMsgEn}
                    onChange={(e) => setAnnMsgEn(e.target.value)}
                    placeholder="Message (English)"
                    className="sm:col-span-3 px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busyId === 'ann_broadcast'}
                  className="px-5 py-2.5 rounded-xl dh-orange-gradient text-white text-xs font-bold disabled:opacity-60"
                >
                  {busyId === 'ann_broadcast' ? 'Broadcasting...' : 'Broadcast Announcement'}
                </button>
              </form>

              <div className="dh-card rounded-3xl p-5 space-y-2.5">
                <h3 className="text-base font-bold text-[#172033]">
                  Published Announcements ({announcements.length})
                </h3>
                {announcements.length === 0 ? (
                  <p className="text-xs text-[#777777] py-4 text-center">No global announcements published yet.</p>
                ) : (
                  announcements.map((ann) => (
                    <div
                      key={ann.id}
                      className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                    >
                      <div className="space-y-0.5 min-w-0">
                        <p className="font-bold text-[#172033]">
                          <span className="uppercase text-[#FF8500] mr-1.5">[{ann.type}]</span>
                          {ann.titleEn} / {ann.titleBn}
                        </p>
                        <p className="text-[#777777] break-words">{ann.messageEn}</p>
                        <p className="text-[11px] text-[#777777] font-mono-num">
                          By {ann.createdBy} · {formatDateShort(ann.createdAt, lang)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            adminToggleAnnouncementActive(ann.id, !ann.active)
                              .then(() => showOk('Announcement visibility updated.'))
                              .catch(showErr)
                          }
                          className={`px-2.5 py-1 rounded-lg font-bold ${
                            ann.active ? 'bg-emerald-100 text-[#16A34A]' : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          {ann.active ? 'Active' : 'Hidden'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            adminDeleteAnnouncement(ann.id)
                              .then(() => showOk('Announcement deleted.'))
                              .catch(showErr)
                          }
                          className="p-1.5 rounded-lg bg-red-50 text-[#DC2626]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* 14. SUPPORT TICKETS */}
          {section === 'tickets' && (
            <div className="dh-card rounded-3xl p-5 space-y-3">
              <h2 className="text-lg font-bold text-[#172033]">Support Tickets ({tickets.length})</h2>
              {tickets.map((tk) => (
                <div key={tk.id} className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="font-bold text-[#172033]">{tk.subject}</span>
                    <span className="font-bold text-[#FF8500] uppercase">{tk.status}</span>
                  </div>
                  <p className="text-[#777777]">{tk.message}</p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      value={ticketReplies[tk.id] ?? tk.adminReply ?? ''}
                      onChange={(e) => setTicketReplies({ ...ticketReplies, [tk.id]: e.target.value })}
                      placeholder="Write admin reply..."
                      className="flex-1 px-3 py-1.5 rounded-xl bg-white border border-[#E6ECFA]"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        adminReplyTicket(tk, 'resolved', ticketReplies[tk.id] || 'Resolved by support')
                          .then(() => showOk('Ticket replied & resolved.'))
                          .catch(showErr)
                      }
                      className="px-4 py-1.5 rounded-xl dh-orange-gradient text-white font-bold"
                    >
                      Send & Resolve
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 15. REVIEWS */}
          {section === 'reviews' && (
            <div className="dh-card rounded-3xl p-5 space-y-3">
              <h2 className="text-lg font-bold text-[#172033]">Customer Reviews Moderation ({reviews.length})</h2>
              {reviews.length === 0 ? (
                <p className="text-xs text-[#777777] py-6 text-center">No customer reviews submitted yet.</p>
              ) : (
                reviews.map((rev) => (
                  <div key={rev.id} className="p-3.5 rounded-2xl bg-[#F3F6FF] flex justify-between items-center gap-3 text-xs">
                    <div>
                      <p className="font-bold text-[#172033]">
                        {rev.authorName} · {rev.rating}/5 Stars
                      </p>
                      <p className="text-[#777777]">{rev.comment}</p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() =>
                          adminToggleReviewApproval(rev.id, !rev.approved).then(() => showOk('Review updated.')).catch(showErr)
                        }
                        className={`px-3 py-1.5 rounded-xl font-bold ${
                          rev.approved ? 'bg-emerald-100 text-[#16A34A]' : 'bg-[#FF8500] text-white'
                        }`}
                      >
                        {rev.approved ? 'Approved' : 'Approve'}
                      </button>
                      <button
                        type="button"
                        onClick={() => adminDeleteReview(rev.id).then(() => showOk('Review deleted.')).catch(showErr)}
                        className="p-1.5 rounded-xl bg-red-50 text-[#DC2626]"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 16. WEBSITE CONTENT */}
          {section === 'content' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                adminSaveSiteSettings(settingsDraft).then(() => showOk('Website content saved.')).catch(showErr);
              }}
              className="dh-card rounded-3xl p-5 space-y-3"
            >
              <h2 className="text-lg font-bold text-[#172033]">Website Content & Legal Policies</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <input
                  value={settingsDraft.announcementBn || ''}
                  onChange={(e) => setSettingsDraft({ ...settingsDraft, announcementBn: e.target.value })}
                  placeholder="Announcement Bar (Bangla)"
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                />
                <input
                  value={settingsDraft.announcementEn || ''}
                  onChange={(e) => setSettingsDraft({ ...settingsDraft, announcementEn: e.target.value })}
                  placeholder="Announcement Bar (English)"
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                />
                <textarea
                  rows={3}
                  value={settingsDraft.aboutEn || ''}
                  onChange={(e) => setSettingsDraft({ ...settingsDraft, aboutEn: e.target.value })}
                  placeholder="About Us (English)"
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                />
                <textarea
                  rows={3}
                  value={settingsDraft.termsEn || ''}
                  onChange={(e) => setSettingsDraft({ ...settingsDraft, termsEn: e.target.value })}
                  placeholder="Terms & Conditions (English)"
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                />
                <textarea
                  rows={3}
                  value={settingsDraft.privacyEn || ''}
                  onChange={(e) => setSettingsDraft({ ...settingsDraft, privacyEn: e.target.value })}
                  placeholder="Privacy Policy (English)"
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                />
                <textarea
                  rows={3}
                  value={settingsDraft.refundEn || ''}
                  onChange={(e) => setSettingsDraft({ ...settingsDraft, refundEn: e.target.value })}
                  placeholder="Refund Policy (English)"
                  className="px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                />
              </div>
              <button type="submit" className="px-5 py-2.5 rounded-xl dh-orange-gradient text-white text-xs font-bold">
                Save Website Content
              </button>
            </form>
          )}

          {/* 19. PROFIT & FINANCIAL REPORTS */}
          {section === 'reports' && (
            <div className="space-y-5">
              <div className="dh-card rounded-3xl p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-bold text-[#172033]">Sales, Expenses & Net Profit Reports</h2>
                    <p className="text-xs text-[#777777]">
                      Real-time accounting across verified orders, approved withdrawals, cashback, referral commissions, and rewarded ad payouts.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={exportCsvReport}
                      className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold flex items-center gap-1.5"
                    >
                      <Download className="w-4 h-4" />
                      Export Orders CSV
                    </button>
                    <button
                      type="button"
                      onClick={exportLedgerCsvReport}
                      className="px-4 py-2 rounded-xl bg-[#172033] text-white text-xs font-bold flex items-center gap-1.5"
                    >
                      <Download className="w-4 h-4" />
                      Export Financial Ledger CSV
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-4 rounded-2xl bg-[#F3F6FF]">
                    <p className="text-[#777777]">Total Gross Sales</p>
                    <p className="text-2xl font-extrabold font-mono-num text-[#172033]">৳{metrics.totalSalesBdt}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#F3F6FF]">
                    <p className="text-[#777777]">Verified Revenue</p>
                    <p className="text-2xl font-extrabold font-mono-num text-[#16A34A]">৳{metrics.verifiedRevenue}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#F3F6FF]">
                    <p className="text-[#777777]">Total Payouts & Expenses</p>
                    <p className="text-2xl font-extrabold font-mono-num text-[#DC2626]">৳{metrics.totalExpensesBdt}</p>
                  </div>
                  <div className="p-4 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/30">
                    <p className="text-[#777777]">Net Platform Profit</p>
                    <p className="text-2xl font-extrabold font-mono-num text-[#FF8500]">৳{metrics.netProfitBdt}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3.5 rounded-2xl bg-white border border-[#E6ECFA]">
                    <p className="text-[#777777]">Approved Withdrawals</p>
                    <p className="text-lg font-extrabold font-mono-num text-[#172033]">৳{metrics.approvedWithdrawalsBdt}</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-white border border-[#E6ECFA]">
                    <p className="text-[#777777]">Cashback Credited</p>
                    <p className="text-lg font-extrabold font-mono-num text-[#172033]">৳{metrics.totalCashbackPaid}</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-white border border-[#E6ECFA]">
                    <p className="text-[#777777]">Referral Commissions</p>
                    <p className="text-lg font-extrabold font-mono-num text-[#172033]">৳{metrics.totalReferralPaid}</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-white border border-[#E6ECFA]">
                    <p className="text-[#777777]">Rewarded Ad Payouts</p>
                    <p className="text-lg font-extrabold font-mono-num text-[#172033]">৳{metrics.totalAdRewardsPaid}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 20. WEBSITE & CASHBACK SETTINGS */}
          {section === 'settings' && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                adminSaveSiteSettings(settingsDraft).then(() => showOk('Settings & Cashback rules saved.')).catch(showErr);
              }}
              className="dh-card rounded-3xl p-5 space-y-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold text-[#172033]">Website, Payment & Cashback Settings</h2>
                  <p className="text-xs text-[#777777]">
                    Manage bKash/Nagad/Rocket receiver numbers, account types, active toggles, and Cashback thresholds.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={migratingPhase1}
                  onClick={async () => {
                    setMigratingPhase1(true);
                    try {
                      const res = await adminMigratePhase1Server();
                      setSettingsDraft((prev) => ({
                        ...prev,
                        nagadNumber: '01772558301',
                        nagadType: prev.nagadType || 'Personal',
                      }));
                      showOk(
                        `Live DB sync complete — Nagad updated: ${res.updatedNagad ? 'Yes (01772558301)' : 'Already up-to-date'}, AD07 added: ${res.addedAd07 ? 'Yes' : 'Already present'}`
                      );
                    } catch (err) {
                      showErr(err);
                    } finally {
                      setMigratingPhase1(false);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#172033] text-white text-xs font-bold hover:opacity-90 disabled:opacity-60"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${migratingPhase1 ? 'animate-spin' : ''}`} />
                  <span>{migratingPhase1 ? 'Syncing...' : 'Sync Nagad 01772558301 & AD07'}</span>
                </button>
              </div>

              {/* Payment Channel Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                {/* bKash */}
                <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-[#172033]">bKash Receiver</span>
                    <label className="flex items-center gap-1.5 font-bold text-[11px]">
                      <input
                        type="checkbox"
                        checked={settingsDraft.bkashEnabled !== false}
                        onChange={(e) => setSettingsDraft({ ...settingsDraft, bkashEnabled: e.target.checked })}
                      />
                      Enabled
                    </label>
                  </div>
                  <input
                    value={settingsDraft.bkashNumber}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, bkashNumber: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] font-mono-num"
                    placeholder="01727936180"
                  />
                  <select
                    value={settingsDraft.bkashType || 'Personal'}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        bkashType: e.target.value as 'Personal' | 'Merchant' | 'Agent',
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA]"
                  >
                    <option value="Personal">Personal (Send Money)</option>
                    <option value="Merchant">Merchant (Payment)</option>
                    <option value="Agent">Agent (Cash Out)</option>
                  </select>
                  <input
                    value={settingsDraft.bkashNoteEn || ''}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, bkashNoteEn: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA]"
                    placeholder="Channel note (English)"
                  />
                </div>

                {/* Nagad */}
                <div className="p-3.5 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/30 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-[#172033]">Nagad Receiver</span>
                    <label className="flex items-center gap-1.5 font-bold text-[11px]">
                      <input
                        type="checkbox"
                        checked={settingsDraft.nagadEnabled !== false}
                        onChange={(e) => setSettingsDraft({ ...settingsDraft, nagadEnabled: e.target.checked })}
                      />
                      Enabled
                    </label>
                  </div>
                  <input
                    value={settingsDraft.nagadNumber}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, nagadNumber: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] font-mono-num"
                    placeholder="01772558301"
                  />
                  <select
                    value={settingsDraft.nagadType || 'Personal'}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        nagadType: e.target.value as 'Personal' | 'Merchant' | 'Agent',
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA]"
                  >
                    <option value="Personal">Personal (Send Money)</option>
                    <option value="Merchant">Merchant (Payment)</option>
                    <option value="Agent">Agent (Cash Out)</option>
                  </select>
                  <input
                    value={settingsDraft.nagadNoteEn || ''}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, nagadNoteEn: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA]"
                    placeholder="Channel note (English)"
                  />
                </div>

                {/* Rocket */}
                <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold text-[#172033]">Rocket Receiver</span>
                    <label className="flex items-center gap-1.5 font-bold text-[11px]">
                      <input
                        type="checkbox"
                        checked={settingsDraft.rocketEnabled !== false}
                        onChange={(e) => setSettingsDraft({ ...settingsDraft, rocketEnabled: e.target.checked })}
                      />
                      Enabled
                    </label>
                  </div>
                  <input
                    value={settingsDraft.rocketNumber}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, rocketNumber: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] font-mono-num"
                    placeholder="01799792541"
                  />
                  <select
                    value={settingsDraft.rocketType || 'Personal'}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        rocketType: e.target.value as 'Personal' | 'Merchant' | 'Agent',
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA]"
                  >
                    <option value="Personal">Personal (Send Money)</option>
                    <option value="Merchant">Merchant (Payment)</option>
                    <option value="Agent">Agent (Cash Out)</option>
                  </select>
                  <input
                    value={settingsDraft.rocketNoteEn || ''}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, rocketNoteEn: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA]"
                    placeholder="Channel note (English)"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                <div>
                  <label className="block font-bold mb-1">Support Email</label>
                  <input
                    value={settingsDraft.supportContact || ''}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, supportContact: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Telegram Admin URL (@zenvoofficial)</label>
                  <input
                    value={settingsDraft.telegramLink || ''}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, telegramLink: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">WhatsApp Admin URL (+880 1352-838945)</label>
                  <input
                    value={settingsDraft.whatsappLink || ''}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, whatsappLink: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Official Telegram Channel URL</label>
                  <input
                    value={settingsDraft.telegramChannelLink || ''}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, telegramChannelLink: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA]"
                  />
                </div>
              </div>

              {/* Cashback Settings Block */}
              <div className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-3">
                <h3 className="text-sm font-bold text-[#172033] flex items-center gap-2">
                  <Award className="w-4 h-4 text-[#FF8500]" />
                  Cashback Program Settings
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                  <label className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] font-bold">
                    <input
                      type="checkbox"
                      checked={settingsDraft.cashbackEnabled !== false}
                      onChange={(e) => setSettingsDraft({ ...settingsDraft, cashbackEnabled: e.target.checked })}
                    />
                    Enable Order Cashback
                  </label>
                  <div>
                    <label className="block font-bold mb-1">Cashback Percent (%)</label>
                    <input
                      type="number"
                      min={0}
                      max={50}
                      step="0.5"
                      value={settingsDraft.cashbackPercent ?? 2}
                      onChange={(e) =>
                        setSettingsDraft({ ...settingsDraft, cashbackPercent: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">Min Order (BDT)</label>
                    <input
                      type="number"
                      min={0}
                      value={settingsDraft.cashbackMinOrderBdt ?? 100}
                      onChange={(e) =>
                        setSettingsDraft({ ...settingsDraft, cashbackMinOrderBdt: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">Max Per Order (BDT)</label>
                    <input
                      type="number"
                      min={0}
                      value={settingsDraft.cashbackMaxPerOrderBdt ?? 50}
                      onChange={(e) =>
                        setSettingsDraft({ ...settingsDraft, cashbackMaxPerOrderBdt: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] font-mono-num"
                    />
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-xs font-bold">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settingsDraft.adsEnabled}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, adsEnabled: e.target.checked })}
                  />
                  Enable Advertisements & Banners
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(settingsDraft.maintenanceMode)}
                    onChange={(e) => setSettingsDraft({ ...settingsDraft, maintenanceMode: e.target.checked })}
                  />
                  Maintenance Notice Mode
                </label>
              </div>
              <button type="submit" className="px-5 py-2.5 rounded-xl dh-orange-gradient text-white text-xs font-bold">
                Save All Settings
              </button>
            </form>
          )}

          {/* 21. ADMIN SECURITY */}
          {section === 'security' && (
            <div className="space-y-5">
              <div className="dh-card rounded-3xl p-5 space-y-3 border border-[#FF8500]/30 bg-gradient-to-br from-white to-[#FFF7EE]">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-[#172033] text-[#FF9B19] flex items-center justify-center shrink-0">
                      <Lock className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-lg font-bold text-[#172033]">
                        Strict Role-Based Admin Security Lock
                      </h2>
                      <p className="text-xs text-[#777777]">
                        Active Admin Session: <strong className="font-mono-num text-[#172033]">{user.phone || user.email || user.displayName}</strong>{' '}
                        <span className="uppercase font-bold text-[#FF8500]">({user.role})</span>
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={reauthBusy}
                    onClick={async () => {
                      setReauthBusy(true);
                      try {
                        const ok = await verifyOwnerAdminServer();
                        setServerVerifiedAdmin(ok);
                        if (ok) {
                          showOk('Admin HTTP-only cookie session verified cleanly against the backend.');
                        } else {
                          showErr(new Error('Admin session verification failed. Please log in again.'));
                        }
                      } catch (e) {
                        showErr(e);
                      } finally {
                        setReauthBusy(false);
                      }
                    }}
                    className="px-4 py-2 rounded-xl bg-[#172033] text-white text-xs font-bold flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${reauthBusy ? 'animate-spin' : ''}`} />
                    {reauthBusy ? 'Verifying...' : 'Verify Admin Session'}
                  </button>
                </div>
                <div className="p-3.5 rounded-2xl bg-white border border-[#E6ECFA] text-xs text-[#172033] space-y-1">
                  <p className="font-bold">Multi-Layer Enforcement Active:</p>
                  <p className="text-[#777777]">
                    1. Passwords are protected using per-user salted <span className="font-mono-num">PBKDF2-SHA256</span> (100,000 iterations) with constant-time verification and persistent brute-force rate limiting.
                  </p>
                  <p className="text-[#777777]">
                    2. Backend API routes (<span className="font-mono-num">/api/admin/*</span>,{' '}
                    <span className="font-mono-num">/api/ads/analytics</span>) validate SHA-256 hashed HTTP-only <span className="font-mono-num">dh_session</span> cookies against the D1/SQLite session table and reject non-admin accounts with HTTP 403.
                  </p>
                  <p className="text-[#777777]">
                    3. Admin privileges are assigned server-side via <span className="font-mono-num">ADMIN_PHONE_NUMBERS</span> or database role checks, with CSRF origin verification on every state-changing request.
                  </p>
                </div>
              </div>

              <div className="dh-card rounded-3xl p-5 space-y-2">
                <h3 className="text-base font-bold text-[#172033]">Recent Security Audit Logs</h3>
                {auditLogs.slice(0, 20).map((log) => (
                  <div key={log.id} className="p-2.5 rounded-xl bg-[#F3F6FF] text-xs flex justify-between gap-2">
                    <span className="font-semibold text-[#172033]">
                      {log.action}: {log.summary}
                    </span>
                    <span className="text-[#777777] shrink-0">{formatDateShort(log.createdAt, lang)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Admin Wallet Balance Adjustment Modal */}
      {walletAdjTarget && (
        <div className="fixed inset-0 z-50 bg-[#172033]/65 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleWalletAdjustmentSubmit}
            className="w-full max-w-md bg-white rounded-3xl p-6 space-y-4 shadow-2xl border border-[#E6ECFA]"
          >
            <div>
              <h3 className="text-lg font-extrabold text-[#172033]">Adjust Customer Wallet Balance</h3>
              <p className="text-xs text-[#777777] mt-0.5">
                {walletAdjTarget.name || 'Customer'} · {walletAdjTarget.email || walletAdjTarget.uid}
              </p>
              <p className="text-xs font-mono-num font-bold text-[#FF8500] mt-1">
                Current Balance: ৳{wallets.find((w) => w.uid === walletAdjTarget.uid)?.availableBalanceBdt ?? 0}
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              {(
                [
                  { id: 'add', label: '+ Add Credit' },
                  { id: 'deduct', label: '- Deduct' },
                  { id: 'set', label: 'Set Exact ৳' },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setWalletAdjMode(m.id)}
                  className={`py-2 rounded-xl border font-bold ${
                    walletAdjMode === m.id
                      ? 'border-[#FF8500] bg-[#FFF7EE] text-[#FF8500]'
                      : 'border-[#E6ECFA] bg-[#F3F6FF] text-[#172033]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div>
              <label className="block text-xs font-bold text-[#172033] mb-1">Amount (BDT)</label>
              <input
                type="number"
                required
                min={walletAdjMode === 'set' ? 0 : 1}
                max={10000000}
                value={walletAdjAmount}
                onChange={(e) => setWalletAdjAmount(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm font-mono-num"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#172033] mb-1">Audit Reason / Note</label>
              <input
                type="text"
                required
                value={walletAdjNote}
                onChange={(e) => setWalletAdjNote(e.target.value)}
                placeholder="e.g. Manual top-up refund or verified cash credit"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setWalletAdjTarget(null)}
                className="px-4 py-2 rounded-xl bg-[#F3F6FF] text-xs font-bold text-[#172033]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={walletAdjBusy}
                className="px-5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold disabled:opacity-60"
              >
                {walletAdjBusy ? 'Saving...' : 'Confirm Adjustment'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Full-Size Payment Receipt Lightbox Modal */}
      {receiptLightboxUrl && (
        <div
          className="fixed inset-0 z-50 bg-[#172033]/85 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => setReceiptLightboxUrl('')}
        >
          <div
            className="relative max-w-3xl max-h-[90vh] bg-white rounded-3xl p-3 shadow-2xl border border-[#E6ECFA] flex flex-col gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-2 pt-1">
              <span className="text-xs font-extrabold text-[#172033]">
                Submitted Payment Screenshot Verification
              </span>
              <button
                type="button"
                onClick={() => setReceiptLightboxUrl('')}
                className="px-3 py-1 rounded-xl bg-[#F3F6FF] text-xs font-bold text-[#172033] hover:bg-[#DC2626] hover:text-white transition-colors"
              >
                Close
              </button>
            </div>
            <img
              src={receiptLightboxUrl}
              alt="Full Size Payment Screenshot"
              className="max-h-[78vh] w-auto object-contain rounded-2xl border border-[#E6ECFA]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
