import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Bell,
  CheckCheck,
  CheckCircle2,
  Clock,
  Coins,
  Copy,
  CreditCard,
  Download,
  Eye,
  FileText,
  Film,
  Gift,
  Heart,
  Image as ImageIcon,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  MessageCircle,
  MessageSquare,
  Package,
  Phone,
  PlusCircle,
  RefreshCw,
  Share2,
  Shield,
  Star,
  Tag,
  Trash2,
  Upload,
  User as UserIcon,
  Users,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  changePasswordWithCurrent,
  regenerateRecoveryCode,
} from '../lib/authClient';
import {
  AdNetworkConfig,
  AdRewardTransaction,
  Advertisement,
  Announcement,
  AppNotification,
  AppRoute,
  AuthUser,
  Banner,
  Coupon,
  DownloadHistoryItem,
  GameItem,
  Language,
  ManagedAdUnitConfig,
  Order,
  Payment,
  Referral,
  RewardedAdClaim,
  SiteSettings,
  SupportTicket,
  UserProfile,
  WalletAccount,
  WalletTransaction,
  WithdrawalRequest,
} from '../types/marketplace';
import type { MobileAppItem } from '../lib/mobileAppsCatalog';
import { t } from '../lib/i18n';
import {
  cancelCustomerOrder,
  compressImageToDataUrl,
  createSupportTicket,
  formatDateShort,
  getTimeMs,
  markAllNotificationsRead,
  markNotificationRead,
  normalizeBangladeshPhoneClient,
  submitAccountDeletionRequestServer,
  submitCustomerReview,
  submitRewardedAdClaimServer,
  toggleAppFavorite,
  triggerLogoutAllDevicesServer,
  updateUserProfileFields,
} from '../lib/firestoreService';
import { BannerSlotView } from './BannerSlotView';
import { NativeAdRow } from './AutomaticAdEngine';
import { ManagedPlacementSlot } from './AdUnitFrame';
import { PaymentProviderLogo } from './BrandLogos';
import { getDhakaDateString } from '../lib/adProviderConfig';

interface CustomerDashboardProps {
  initialTab?:
    | 'overview'
    | 'orders'
    | 'payments'
    | 'referrals'
    | 'rewards'
    | 'favorites'
    | 'downloads'
    | 'coupons'
    | 'notifications'
    | 'support'
    | 'profile';
  lang: Language;
  setLang: (l: Language) => void;
  user: AuthUser | null;
  profile: UserProfile | null;
  wallet: WalletAccount | null;
  walletTxs?: WalletTransaction[];
  adRewardTransactions?: AdRewardTransaction[];
  favoriteAppIds?: string[];
  downloadHistory?: DownloadHistoryItem[];
  totalDownloads?: number;
  mobileApps?: MobileAppItem[];
  games?: GameItem[];
  orders: Order[];
  payments: Payment[];
  referrals: Referral[];
  withdrawals?: WithdrawalRequest[];
  rewardClaims?: RewardedAdClaim[];
  announcements?: Announcement[];
  coupons: Coupon[];
  notifications: AppNotification[];
  tickets: SupportTicket[];
  banners: Banner[];
  advertisements?: Advertisement[];
  adNetworks?: AdNetworkConfig[];
  managedAdUnits?: ManagedAdUnitConfig[];
  settings: SiteSettings;
  isAdmin: boolean;
  onNavigate: (r: AppRoute) => void;
  onOpenAuth: () => void;
  onLogout: () => Promise<void>;
}

const EMPTY_WALLET_TXS: WalletTransaction[] = [];
const EMPTY_AD_REWARD_TXS: AdRewardTransaction[] = [];
const EMPTY_STRING_IDS: string[] = [];
const EMPTY_DOWNLOAD_HISTORY: DownloadHistoryItem[] = [];
const EMPTY_MOBILE_APPS: MobileAppItem[] = [];
const EMPTY_GAMES: GameItem[] = [];
const EMPTY_WITHDRAWALS: WithdrawalRequest[] = [];
const EMPTY_REWARD_CLAIMS: RewardedAdClaim[] = [];
const EMPTY_ANNOUNCEMENTS: Announcement[] = [];
const EMPTY_ADVERTISEMENTS: Advertisement[] = [];
const EMPTY_AD_NETWORKS: AdNetworkConfig[] = [];
const EMPTY_MANAGED_AD_UNITS: ManagedAdUnitConfig[] = [];

export function CustomerDashboard({
  initialTab = 'overview',
  lang,
  setLang,
  user,
  profile,
  wallet,
  walletTxs = EMPTY_WALLET_TXS,
  adRewardTransactions = EMPTY_AD_REWARD_TXS,
  favoriteAppIds = EMPTY_STRING_IDS,
  downloadHistory = EMPTY_DOWNLOAD_HISTORY,
  totalDownloads = 0,
  mobileApps = EMPTY_MOBILE_APPS,
  games = EMPTY_GAMES,
  orders,
  payments,
  referrals,
  withdrawals = EMPTY_WITHDRAWALS,
  rewardClaims = EMPTY_REWARD_CLAIMS,
  announcements = EMPTY_ANNOUNCEMENTS,
  coupons,
  notifications,
  tickets,
  banners,
  advertisements = EMPTY_ADVERTISEMENTS,
  adNetworks = EMPTY_AD_NETWORKS,
  managedAdUnits = EMPTY_MANAGED_AD_UNITS,
  settings,
  isAdmin,
  onNavigate,
  onOpenAuth,
  onLogout,
}: CustomerDashboardProps) {
  const [tab, setTab] = useState(initialTab);
  const [copiedRef, setCopiedRef] = useState(false);
  const [copiedUid, setCopiedUid] = useState(false);
  const [notifFilter, setNotifFilter] = useState<'all' | 'new_app' | 'app_update' | 'announcement' | 'download' | 'payment' | 'support' | 'reward'>('all');
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [unfavoritingId, setUnfavoritingId] = useState('');

  // Support ticket state
  const [ticketCategory, setTicketCategory] = useState('general');
  const [subject, setSubject] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [message, setMessage] = useState('');
  const [ticketScreenshot, setTicketScreenshot] = useState('');
  const [ticketSubmitting, setTicketSubmitting] = useState(false);

  // Review & Order details modal state
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [reviewOrder, setReviewOrder] = useState<Order | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [claimingNetId, setClaimingNetId] = useState('');

  // Profile form state
  const [displayName, setDisplayName] = useState(profile?.displayName || user?.displayName || '');
  const [phone, setPhone] = useState(profile?.phone || user?.phone || '');
  const [photoUrl, setPhotoUrl] = useState(profile?.photoUrl || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [deletionReason, setDeletionReason] = useState('');
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deletionSubmitting, setDeletionSubmitting] = useState(false);
  const [deletionSubmittedId, setDeletionSubmittedId] = useState('');
  const [pwdFormOpen, setPwdFormOpen] = useState(false);
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmNewPwd, setConfirmNewPwd] = useState('');
  const [pwdBusy, setPwdBusy] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenCurrentPwd, setRegenCurrentPwd] = useState('');
  const [regenBusy, setRegenBusy] = useState(false);
  const [freshRecoveryCode, setFreshRecoveryCode] = useState('');

  useEffect(() => {
    if (profile?.displayName && !displayName) setDisplayName(profile.displayName);
    if ((profile?.phone || user?.phone) && !phone) setPhone(profile?.phone || user?.phone || '');
    if (profile?.photoUrl && !photoUrl) setPhotoUrl(profile.photoUrl);
  }, [profile?.displayName, profile?.phone, profile?.photoUrl, user?.phone]);

  const orderStats = useMemo(() => {
    const pending = orders.filter(
      (o) => o.status === 'Verification Pending' || o.status === 'Pending Payment' || o.status === 'Processing'
    ).length;
    const completed = orders.filter((o) => o.status === 'Completed').length;
    const rejected = orders.filter((o) => o.status === 'Rejected' || o.status === 'Cancelled').length;
    return { total: orders.length, pending, completed, rejected };
  }, [orders]);

  const earningStats = useMemo(() => {
    const cashbackEarned = walletTxs
      .filter((tx) => tx.type === 'cashback' && tx.status === 'Approved')
      .reduce((s, tx) => s + (tx.amountBdt || 0), 0);
    const referralEarned = walletTxs
      .filter((tx) => tx.type === 'referral' && tx.status === 'Approved')
      .reduce((s, tx) => s + (tx.amountBdt || 0), 0);
    const adRewardsEarned = walletTxs
      .filter(
        (tx) =>
          (tx.type === 'rewarded_ad' || tx.type === 'watch_earn_coin_redeem') &&
          tx.status === 'Approved'
      )
      .reduce((s, tx) => s + (tx.amountBdt || 0), 0);
    const promoEarned = walletTxs
      .filter((tx) => tx.type === 'promo_credit' && tx.status === 'Approved')
      .reduce((s, tx) => s + (tx.amountBdt || 0), 0);
    const totalEarnings = cashbackEarned + referralEarned + adRewardsEarned + promoEarned;
    const totalWithdrawn = withdrawals
      .filter((w) => w.status === 'Paid' || w.status === 'Approved')
      .reduce((s, w) => s + (w.amountBdt || 0), 0);
    const pendingWithdrawal = withdrawals
      .filter((w) => w.status === 'Pending' || w.status === 'Processing')
      .reduce((s, w) => s + (w.amountBdt || 0), 0);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    const todaysBdtEarnings = walletTxs
      .filter(
        (tx) =>
          tx.status === 'Approved' &&
          ['cashback', 'referral', 'rewarded_ad', 'watch_earn_coin_redeem', 'promo_credit'].includes(tx.type) &&
          getTimeMs(tx.createdAt) >= todayStartMs
      )
      .reduce((s, tx) => s + (tx.amountBdt || 0), 0);

    const todaysCoinsEarned = adRewardTransactions
      .filter((tx) => tx.coins > 0 && tx.type !== 'coin_redemption' && getTimeMs(tx.createdAt) >= todayStartMs)
      .reduce((s, tx) => s + (tx.coins || 0), 0);

    return {
      totalEarnings,
      cashbackEarned,
      referralEarned,
      adRewardsEarned,
      totalWithdrawn,
      pendingWithdrawal,
      todaysBdtEarnings,
      todaysCoinsEarned,
    };
  }, [walletTxs, withdrawals, adRewardTransactions]);

  const favoriteApps = useMemo(() => {
    const idSet = new Set(favoriteAppIds);
    return mobileApps.filter((a) => idSet.has(a.id));
  }, [favoriteAppIds, mobileApps]);

  const appById = useMemo(() => {
    const map = new Map<string, MobileAppItem>();
    mobileApps.forEach((a) => map.set(a.id, a));
    return map;
  }, [mobileApps]);

  const gameById = useMemo(() => {
    const map = new Map<string, GameItem>();
    games.forEach((g) => map.set(g.id, g));
    return map;
  }, [games]);

  const filteredNotifications = useMemo(() => {
    if (notifFilter === 'all') return notifications;
    return notifications.filter((n) => {
      if (notifFilter === 'reward') return n.type === 'reward' || n.type === 'wallet' || n.type === 'referral';
      if (notifFilter === 'payment') return n.type === 'payment' || n.type === 'order';
      return n.type === notifFilter;
    });
  }, [notifications, notifFilter]);

  const recentActivity = useMemo(() => {
    type ActivityItem = {
      id: string;
      kind: 'wallet' | 'withdrawal' | 'order' | 'coin';
      title: string;
      subtitle: string;
      amountLabel?: string;
      amountTone?: 'credit' | 'debit' | 'neutral';
      status: string;
      ts: number;
    };
    const items: ActivityItem[] = [];

    walletTxs.slice(0, 6).forEach((tx) => {
      const isCredit =
        typeof tx.signedDeltaBdt === 'number'
          ? tx.signedDeltaBdt >= 0
          : !['purchase', 'withdrawal'].includes(tx.type);
      items.push({
        id: `tx_${tx.id}`,
        kind: 'wallet',
        title: tx.note || tx.type.replace(/_/g, ' '),
        subtitle: `${String(tx.method || 'wallet').toUpperCase()} · ${tx.transactionId}`,
        amountLabel: `${isCredit ? '+' : '-'}৳${Math.abs(tx.amountBdt || 0)}`,
        amountTone: isCredit ? 'credit' : 'debit',
        status: tx.status,
        ts: getTimeMs(tx.createdAt),
      });
    });

    adRewardTransactions.slice(0, 4).forEach((ct) => {
      const isRedeem = ct.type === 'coin_redemption' || ct.coins < 0;
      items.push({
        id: `coin_${ct.id}`,
        kind: 'coin',
        title: ct.note || ct.type.replace(/_/g, ' '),
        subtitle: `${ct.provider.toUpperCase()} · ${ct.bdtEquivalent ? `৳${ct.bdtEquivalent}` : 'Coins'}`,
        amountLabel: `${isRedeem ? '-' : '+'}${Math.abs(ct.coins)} Coins`,
        amountTone: isRedeem ? 'debit' : 'credit',
        status: ct.status,
        ts: getTimeMs(ct.createdAt),
      });
    });

    withdrawals.slice(0, 4).forEach((w) => {
      items.push({
        id: `wd_${w.id}`,
        kind: 'withdrawal',
        title:
          lang === 'bn'
            ? `উইথড্র রিকোয়েস্ট (${w.methodName || w.method.toUpperCase()})`
            : `Withdrawal (${w.methodName || w.method.toUpperCase()})`,
        subtitle: `${w.accountNumber}${w.payoutReference ? ` · Ref: ${w.payoutReference}` : ''}`,
        amountLabel: `৳${w.amountBdt}`,
        amountTone: w.status === 'Rejected' ? 'credit' : 'debit',
        status: w.status,
        ts: getTimeMs(w.createdAt),
      });
    });

    orders.slice(0, 4).forEach((o) => {
      items.push({
        id: `ord_${o.id}`,
        kind: 'order',
        title: lang === 'bn' ? o.productTitleBn || o.productTitleEn || 'অর্ডার' : o.productTitleEn || 'Order',
        subtitle: `#${o.orderNumber} · ${o.paymentMethod.toUpperCase()}`,
        amountLabel: `৳${o.totalPriceBdt}`,
        amountTone: 'neutral',
        status: o.status,
        ts: getTimeMs(o.createdAt),
      });
    });

    return items.sort((a, b) => b.ts - a.ts).slice(0, 10);
  }, [walletTxs, adRewardTransactions, withdrawals, orders, lang]);

  const incentivizedNetworks = useMemo(
    () =>
      adNetworks.filter(
        (n) =>
          n.enabled &&
          n.approvalStatus === 'active' &&
          n.supportsIncentivizedRewards === true &&
          n.provider !== 'adsense'
      ),
    [adNetworks]
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  if (!user) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <div className="dh-card rounded-3xl p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-[#FFF3E5] text-[#FF8500] flex items-center justify-center mx-auto">
            <UserIcon className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-[#172033]">{t(lang, 'loginRequiredTitle')}</h2>
          <p className="text-sm text-[#777777]">{t(lang, 'loginRequiredDesc')}</p>
          <button
            type="button"
            onClick={onOpenAuth}
            className="px-6 py-2.5 rounded-xl dh-orange-gradient text-white font-bold text-sm"
          >
            {t(lang, 'signIn')}
          </button>
        </div>
      </div>
    );
  }

  const refCode = profile?.referralCode || `DH${user.uid.slice(0, 6).toUpperCase()}`;
  const referralUrl = `${window.location.origin}/register?ref=${refCode}`;

  const handleCopyRef = () => {
    navigator.clipboard.writeText(referralUrl).catch(() => {});
    setCopiedRef(true);
    setTimeout(() => setCopiedRef(false), 1800);
  };

  const handleCopyUid = () => {
    navigator.clipboard.writeText(user.uid).catch(() => {});
    setCopiedUid(true);
    setTimeout(() => setCopiedUid(false), 1800);
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(refCode).catch(() => {});
    setFeedback(lang === 'bn' ? `রেফারেল কোড ${refCode} কপি হয়েছে।` : `Copied referral code ${refCode}.`);
  };

  const handleShareRef = async () => {
    const text =
      lang === 'bn'
        ? `DIGITAL HUB-এ জয়েন করুন আমার রেফারেল লিংক দিয়ে: ${referralUrl}`
        : `Join DIGITAL HUB with my invite link: ${referralUrl}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'DIGITAL HUB Referral', text, url: referralUrl });
        return;
      } catch {
        // Fallback to copy
      }
    }
    handleCopyRef();
  };

  const handleTicketScreenshotUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file, 900, 0.78);
      setTicketScreenshot(dataUrl);
    } catch {
      setFeedback(lang === 'bn' ? 'স্ক্রিনশট আপলোড ব্যর্থ হয়েছে।' : 'Failed to process screenshot.');
    }
  };

  const handleTicketSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTicketSubmitting(true);
    setFeedback('');
    try {
      await createSupportTicket({
        userId: user.uid,
        userEmail: user.phone || user.email || '',
        subject,
        message,
        orderNumber,
        category: ticketCategory,
        screenshotDataUrl: ticketScreenshot || undefined,
      });
      setSubject('');
      setOrderNumber('');
      setMessage('');
      setTicketScreenshot('');
      setTicketCategory('general');
      setFeedback(lang === 'bn' ? 'সাপোর্ট টিকেট সফলভাবে জমা হয়েছে।' : 'Support ticket submitted successfully.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Ticket submission failed.');
    } finally {
      setTicketSubmitting(false);
    }
  };

  const handleMarkAllRead = async () => {
    if (markingAllRead || unreadCount === 0) return;
    setMarkingAllRead(true);
    try {
      await markAllNotificationsRead();
      setFeedback(lang === 'bn' ? 'সব নোটিফিকেশন পঠিত হিসেবে চিহ্নিত হয়েছে।' : 'All notifications marked as read.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Failed to mark notifications read.');
    } finally {
      setMarkingAllRead(false);
    }
  };

  const handleUnfavoriteApp = async (appId: string) => {
    if (unfavoritingId) return;
    setUnfavoritingId(appId);
    try {
      await toggleAppFavorite(appId);
    } catch {
      // Ignore transient error
    } finally {
      setUnfavoritingId('');
    }
  };

  const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await compressImageToDataUrl(file, 400, 0.72);
    setPhotoUrl(url);
  };

  const handleProfileSave = async (e: FormEvent) => {
    e.preventDefault();
    setProfileSaving(true);
    setFeedback('');
    try {
      const normalizedBdPhone = normalizeBangladeshPhoneClient(phone);
      const phoneToSave = normalizedBdPhone || phone.trim();
      await updateUserProfileFields(user.uid, {
        displayName: displayName || user.displayName || 'Customer',
        phone: phoneToSave,
        language: lang,
        photoUrl,
      });
      if (normalizedBdPhone) {
        setPhone(normalizedBdPhone);
      }
      setFeedback(lang === 'bn' ? 'প্রোফাইল সফলভাবে আপডেট হয়েছে।' : 'Profile updated successfully.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not update profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleChangePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (pwdBusy) return;
    if (newPwd.length < 6) {
      setFeedback(lang === 'bn' ? 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।' : 'New password must be at least 6 characters.');
      return;
    }
    if (newPwd !== confirmNewPwd) {
      setFeedback(lang === 'bn' ? 'নতুন পাসওয়ার্ড দুটি মেলেনি।' : 'New passwords do not match.');
      return;
    }
    setPwdBusy(true);
    setFeedback('');
    try {
      await changePasswordWithCurrent({
        currentPassword: currentPwd,
        newPassword: newPwd,
        confirmPassword: confirmNewPwd,
      });
      setCurrentPwd('');
      setNewPwd('');
      setConfirmNewPwd('');
      setPwdFormOpen(false);
      setFeedback(lang === 'bn' ? 'পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে।' : 'Password changed successfully.');
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not change password.');
    } finally {
      setPwdBusy(false);
    }
  };

  const handleRegenerateRecoveryCode = async (e: FormEvent) => {
    e.preventDefault();
    if (regenBusy) return;
    setRegenBusy(true);
    setFeedback('');
    try {
      const res = await regenerateRecoveryCode(regenCurrentPwd);
      setFreshRecoveryCode(res.recoveryCode);
      setRegenCurrentPwd('');
      setRegenOpen(false);
      setFeedback(
        lang === 'bn'
          ? 'নতুন ব্যাকআপ রিকভারি কোড তৈরি হয়েছে। নিচ থেকে কপি করে নিরাপদে রাখুন।'
          : 'New backup recovery code generated. Copy and store it safely below.'
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Could not regenerate recovery code.');
    } finally {
      setRegenBusy(false);
    }
  };

  const handleReviewSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reviewOrder) return;
    setReviewSubmitting(true);
    try {
      await submitCustomerReview({
        productId: reviewOrder.productId,
        orderId: reviewOrder.id,
        userId: user.uid,
        authorName: profile?.displayName || user.displayName || 'Verified Buyer',
        rating: reviewRating,
        comment: reviewComment,
      });
      setReviewOrder(null);
      setReviewComment('');
      setFeedback(
        lang === 'bn'
          ? 'রিভিউ জমা হয়েছে! অ্যাডমিন অনুমোদনের পর প্রদর্শিত হবে।'
          : 'Review submitted! It will appear after admin approval.'
      );
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleClaimRewardedAd = async (networkId: string) => {
    setFeedback('');
    setClaimingNetId(networkId);
    try {
      const res = await submitRewardedAdClaimServer(networkId);
      setFeedback(
        lang === 'bn'
          ? `৳${res.amountBdt} রিওয়ার্ড ক্লেইম জমা হয়েছে (${res.dailyCount}/${res.dailyLimit} আজকের সীমা)।`
          : `Submitted ৳${res.amountBdt} rewarded ad claim (${res.dailyCount}/${res.dailyLimit} today). Credits settle after admin verification.`
      );
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setClaimingNetId('');
    }
  };

  const tabs = [
    { id: 'overview', label: lang === 'bn' ? 'ড্যাশবোর্ড' : 'Overview', icon: LayoutDashboard },
    { id: 'orders', label: t(lang, 'navOrders'), icon: Package },
    { id: 'payments', label: lang === 'bn' ? 'পেমেন্ট' : 'Payments', icon: CreditCard },
    { id: 'rewards', label: lang === 'bn' ? 'কয়েন ও রিওয়ার্ড' : 'Coins & Rewards', icon: Star },
    {
      id: 'favorites',
      label: `${lang === 'bn' ? 'পছন্দের অ্যাপস' : 'Favorites'}${favoriteApps.length ? ` (${favoriteApps.length})` : ''}`,
      icon: Heart,
    },
    {
      id: 'downloads',
      label: `${lang === 'bn' ? 'ডাউনলোড হিস্টোরি' : 'Downloads'}${downloadHistory.length ? ` (${downloadHistory.length})` : ''}`,
      icon: Download,
    },
    { id: 'referrals', label: lang === 'bn' ? 'রেফারেল' : 'Referrals', icon: Gift },
    { id: 'coupons', label: lang === 'bn' ? 'কুপন' : 'Coupons', icon: Tag },
    {
      id: 'notifications',
      label: `${lang === 'bn' ? 'নোটিফিকেশন' : 'Alerts'}${unreadCount + announcements.length ? ` (${unreadCount})` : ''}`,
      icon: Bell,
    },
    { id: 'support', label: t(lang, 'navSupport'), icon: MessageSquare },
    { id: 'profile', label: lang === 'bn' ? 'প্রোফাইল' : 'Profile', icon: UserIcon },
  ] as const;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Top Account Banner */}
      <div className="dh-card rounded-3xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 dark:bg-slate-900 dark:border-slate-800">
        <div className="flex items-center gap-3.5 min-w-0">
          {profile?.photoUrl || photoUrl || user.photoURL ? (
            <img
              src={profile?.photoUrl || photoUrl || user.photoURL || ''}
              alt={profile?.displayName || 'Customer'}
              className="w-14 h-14 rounded-2xl object-cover border-2 border-[#FF8500] shrink-0"
            />
          ) : (
            <div className="w-14 h-14 rounded-2xl dh-orange-gradient text-white flex items-center justify-center text-xl font-extrabold shrink-0">
              {(profile?.displayName || user.displayName || user.phone || user.email || 'U').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-lg sm:text-xl font-extrabold text-[#172033] dark:text-slate-100 truncate">
                {profile?.displayName || user.displayName || 'DIGITAL HUB Customer'}
              </h1>
              {user.role === 'super_admin' && (
                <span className="px-2 py-0.5 rounded-md bg-[#172033] dark:bg-[#FF8500] text-white text-[10px] font-extrabold uppercase tracking-wider">
                  Super Admin
                </span>
              )}
            </div>
            <p className="text-xs font-mono-num text-[#777777] dark:text-slate-400 truncate">
              {[profile?.email || user.email, profile?.phone || user.phone].filter(Boolean).join(' · ')}
            </p>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <button
                type="button"
                onClick={handleCopyUid}
                title={lang === 'bn' ? 'ইউজার আইডি কপি করুন' : 'Copy Unique User ID'}
                className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[#172033] dark:text-slate-200 text-[11px] font-mono-num font-bold inline-flex items-center gap-1 hover:border-[#FF8500] transition-colors"
              >
                <span>ID: {user.uid}</span>
                <Copy className="w-3 h-3 text-[#FF8500]" />
                {copiedUid && (
                  <span className="text-[#16A34A] ml-0.5">{lang === 'bn' ? 'কপিড' : 'Copied'}</span>
                )}
              </button>
              <span
                className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                  profile?.status === 'suspended'
                    ? 'bg-red-50 dark:bg-red-950/50 text-[#DC2626]'
                    : 'bg-emerald-50 dark:bg-emerald-950/40 text-[#16A34A]'
                }`}
              >
                {profile?.status === 'suspended'
                  ? lang === 'bn'
                    ? 'অ্যাকাউন্ট সাসপেন্ডেড'
                    : 'Suspended'
                  : lang === 'bn'
                    ? 'সক্রিয় অ্যাকাউন্ট'
                    : 'Active'}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-[#FFF3E5] dark:bg-orange-950/40 text-[#FF8500] text-[11px] font-mono-num font-bold">
                Ref: {refCode}
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('add-money')}
            className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold flex items-center gap-1.5"
          >
            <PlusCircle className="w-4 h-4" />
            {t(lang, 'navAddMoney')}
          </button>
          <button
            type="button"
            onClick={() => onNavigate('wallet')}
            className="px-4 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-100 text-xs font-bold flex items-center gap-1.5"
          >
            <Wallet className="w-4 h-4 text-[#FF8500]" />
            <span className="font-mono-num">৳{(wallet?.availableBalanceBdt || 0).toFixed(2)}</span>
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="px-4 py-2 rounded-xl bg-[#172033] dark:bg-[#FF8500] text-white text-xs font-bold flex items-center gap-1.5"
            >
              <Shield className="w-4 h-4 text-[#FF8500] dark:text-white" />
              {t(lang, 'navAdmin')}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              onLogout().catch(() => {});
            }}
            className="px-3.5 py-2 rounded-xl bg-red-50 dark:bg-red-950/40 text-[#DC2626] text-xs font-bold flex items-center gap-1.5 hover:bg-red-100 dark:hover:bg-red-950/70"
          >
            <LogOut className="w-4 h-4" />
            {t(lang, 'signOut')}
          </button>
        </div>
      </div>

      {/* Dashboard Promo Ad Placement */}
      <ManagedPlacementSlot
        placement="dashboard"
        units={managedAdUnits}
        adsEnabled={settings.adsEnabled}
        lang={lang}
        variant="banner"
      />
      <BannerSlotView
        slot="dashboard_promo"
        banners={banners}
        adNetworks={adNetworks}
        adsEnabled={settings.adsEnabled}
        lang={lang}
      />

      {/* Horizontal Scrollable Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {tabs.map((item) => {
          const Icon = item.icon;
          const active = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 transition-colors ${
                active
                  ? 'dh-orange-gradient text-white shadow-xs'
                  : 'bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 text-[#172033] dark:text-slate-200 hover:border-[#FF8500]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {feedback && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-[#16A34A] text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-6">
          {/* Primary Financial, Coins, Downloads & Account KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-4 gap-3">
            {[
              {
                label: lang === 'bn' ? 'মোট কয়েন' : 'Total Coins',
                val: `${wallet?.coinsAvailable || 0}`,
                sub: `${lang === 'bn' ? 'আজীবন:' : 'Lifetime:'} ${wallet?.coinsLifetimeEarned || 0}`,
                color: 'text-[#FF8500]',
                icon: Coins,
              },
              {
                label: lang === 'bn' ? 'আজকের আয়' : "Today's Earnings",
                val: `৳${earningStats.todaysBdtEarnings.toFixed(0)}`,
                sub: `+${earningStats.todaysCoinsEarned} ${lang === 'bn' ? 'কয়েন আজ' : 'Coins today'}`,
                color: 'text-[#16A34A]',
                icon: Star,
              },
              {
                label: lang === 'bn' ? 'মোট ডাউনলোড' : 'Total Downloads',
                val: `${totalDownloads}`,
                sub: `${favoriteApps.length} ${lang === 'bn' ? 'পছন্দের অ্যাপ' : 'Favorite apps'}`,
                color: 'text-[#0EA5E9]',
                icon: Download,
              },
              {
                label: lang === 'bn' ? 'রেফারেল সংখ্যা' : 'Referral Count',
                val: `${referrals.length}`,
                sub: `৳${earningStats.referralEarned.toFixed(0)} ${lang === 'bn' ? 'আয়' : 'earned'}`,
                color: 'text-[#172033] dark:text-slate-100',
                icon: Users,
              },
              {
                label: t(lang, 'walletBalanceLabel'),
                val: `৳${(wallet?.availableBalanceBdt || 0).toFixed(2)}`,
                sub: `${lang === 'bn' ? 'মোট আয়:' : 'Total:'} ৳${earningStats.totalEarnings.toFixed(0)}`,
                color: 'text-[#FF8500]',
                icon: Wallet,
              },
              {
                label: lang === 'bn' ? 'মোট উইথড্র' : 'Total Withdrawn',
                val: `৳${earningStats.totalWithdrawn.toFixed(0)}`,
                sub: `${lang === 'bn' ? 'পেন্ডিং:' : 'Pending:'} ৳${earningStats.pendingWithdrawal.toFixed(0)}`,
                color: 'text-[#172033] dark:text-slate-100',
                icon: ArrowDownToLine,
              },
              {
                label: lang === 'bn' ? 'মোট অর্ডার' : 'Total Orders',
                val: `${orderStats.total}`,
                sub: `${orderStats.completed} ${lang === 'bn' ? 'সম্পন্ন' : 'completed'}`,
                color: 'text-[#172033] dark:text-slate-100',
                icon: Package,
              },
              {
                label: lang === 'bn' ? 'অপঠিত বার্তা' : 'Unread Alerts',
                val: `${unreadCount}`,
                sub: `${tickets.filter((tk) => tk.status !== 'closed').length} ${lang === 'bn' ? 'সক্রিয় টিকেট' : 'active tickets'}`,
                color: unreadCount > 0 ? 'text-[#DC2626]' : 'text-[#172033] dark:text-slate-100',
                icon: Bell,
              },
            ].map((kpi) => {
              const KpiIcon = kpi.icon;
              return (
                <div
                  key={kpi.label}
                  className="dh-card rounded-2xl p-4 dark:bg-slate-900 dark:border-slate-800 flex items-start justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-[#777777] dark:text-slate-400 truncate">
                      {kpi.label}
                    </p>
                    <p className={`text-xl sm:text-2xl font-extrabold font-mono-num mt-1 ${kpi.color}`}>
                      {kpi.val}
                    </p>
                    <p className="text-[10px] font-semibold text-[#64748B] dark:text-slate-400 mt-0.5 truncate">
                      {kpi.sub}
                    </p>
                  </div>
                  <div className="w-8 h-8 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <KpiIcon className="w-4 h-4 text-[#FF8500]" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Quick Referral Invite & Wallet Actions Bar */}
          <div className="dh-card rounded-3xl p-4 sm:p-5 dark:bg-slate-900 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="space-y-1">
              <p className="text-xs font-extrabold uppercase tracking-wider text-[#FF8500] flex items-center gap-1.5">
                <Gift className="w-3.5 h-3.5" />
                {lang === 'bn' ? 'রেফারেল কোড ও ইনভাইট লিংক' : 'Referral Code & Invite Link'}
              </p>
              <p className="text-xs text-[#777777] dark:text-slate-400">
                {lang === 'bn'
                  ? `বন্ধুদের ইনভাইট করে প্রতি যোগ্য রেফারেলে ৳${settings.referralBonusBdt} বোনাস পান (${referrals.length} জন রেফার্ড)।`
                  : `Earn ৳${settings.referralBonusBdt} per qualified referral (${referrals.length} referred so far).`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCopyCode}
                className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-mono-num font-extrabold text-[#172033] dark:text-slate-100 inline-flex items-center gap-1.5 hover:border-[#FF8500]"
              >
                <span>{refCode}</span>
                <Copy className="w-3.5 h-3.5 text-[#FF8500]" />
              </button>
              <button
                type="button"
                onClick={handleCopyRef}
                className="px-3.5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                {copiedRef ? (lang === 'bn' ? 'লিংক কপি হয়েছে!' : 'Link Copied!') : lang === 'bn' ? 'লিংক কপি' : 'Copy Link'}
              </button>
              <button
                type="button"
                onClick={handleShareRef}
                className="px-3.5 py-2 rounded-xl bg-[#172033] dark:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Share2 className="w-3.5 h-3.5 text-[#FF8500]" />
                {lang === 'bn' ? 'শেয়ার' : 'Share'}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('wallet')}
                className="px-3.5 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-[#16A34A] text-xs font-bold inline-flex items-center gap-1.5"
              >
                <ArrowDownToLine className="w-3.5 h-3.5" />
                {lang === 'bn' ? 'উইথড্র করুন' : 'Withdraw'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Recent Activity Feed */}
            <div className="dh-card rounded-3xl p-5 dark:bg-slate-900 dark:border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-[#172033] dark:text-slate-100 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#FF8500]" />
                  {lang === 'bn' ? 'সাম্প্রতিক কার্যক্রম' : 'Recent Activity'}
                </h2>
                <button
                  type="button"
                  onClick={() => onNavigate('wallet')}
                  className="text-xs font-bold text-[#FF8500] hover:underline inline-flex items-center gap-0.5"
                >
                  {lang === 'bn' ? 'ওয়ালেট লেজার' : 'Wallet Ledger'}
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </button>
              </div>
              {recentActivity.length === 0 ? (
                <p className="text-sm text-[#777777] dark:text-slate-400 py-6 text-center">
                  {lang === 'bn' ? 'এখনো কোনো কার্যক্রম রেকর্ড হয়নি।' : 'No account activity recorded yet.'}
                </p>
              ) : (
                <div className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
                  {recentActivity.map((act) => (
                    <div key={act.id} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs sm:text-sm font-bold text-[#172033] dark:text-slate-100 truncate">
                          {act.title}
                        </p>
                        <p className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400 truncate">
                          {act.subtitle} · {formatDateShort(act.ts, lang)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {act.amountLabel && (
                          <p
                            className={`text-xs sm:text-sm font-mono-num font-extrabold ${
                              act.amountTone === 'credit'
                                ? 'text-[#16A34A]'
                                : act.amountTone === 'debit'
                                  ? 'text-[#DC2626]'
                                  : 'text-[#172033] dark:text-slate-100'
                            }`}
                          >
                            {act.amountLabel}
                          </p>
                        )}
                        <span className="text-[10px] font-bold text-[#777777] dark:text-slate-400">
                          {act.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recent Orders */}
            <div className="dh-card rounded-3xl p-5 dark:bg-slate-900 dark:border-slate-800">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-[#172033] dark:text-slate-100">
                  {lang === 'bn' ? 'সাম্প্রতিক অর্ডার' : 'Recent Orders'}
                </h2>
                <button
                  type="button"
                  onClick={() => setTab('orders')}
                  className="text-xs font-bold text-[#FF8500] hover:underline"
                >
                  {t(lang, 'viewAll')} →
                </button>
              </div>
              {orders.length === 0 ? (
                <p className="text-sm text-[#777777] dark:text-slate-400 py-6 text-center">
                  {lang === 'bn' ? 'এখনো কোনো অর্ডার নেই।' : 'No orders placed yet.'}
                </p>
              ) : (
                <div className="space-y-2.5">
                  {orders.slice(0, 5).map((ord) => (
                    <div
                      key={ord.id}
                      className="p-3.5 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/70 border border-[#E6ECFA] dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-[#172033] dark:text-slate-100 truncate">
                          {lang === 'bn' ? ord.productTitleBn || ord.productTitleEn : ord.productTitleEn || ord.productTitleBn}
                          {ord.selectedPackageName ? (
                            <span className="ml-1.5 text-xs font-semibold text-[#FF8500]">
                              ({ord.selectedPackageName})
                            </span>
                          ) : null}
                        </p>
                        <p className="text-xs text-[#777777] dark:text-slate-400 font-mono-num">
                          #{ord.orderNumber} · {ord.paymentMethod.toUpperCase()} · {formatDateShort(ord.createdAt, lang)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <span className="font-mono-num font-extrabold text-sm text-[#FF8500]">৳{ord.totalPriceBdt}</span>
                        <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 text-[11px] font-bold text-[#172033] dark:text-slate-200">
                          {ord.status}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSelectedOrder(ord)}
                          className="px-2.5 py-1 rounded-lg bg-[#172033] dark:bg-[#FF8500] text-white text-[11px] font-bold flex items-center gap-1 hover:bg-[#FF8500] transition-colors"
                        >
                          <Eye className="w-3 h-3" />
                          {lang === 'bn' ? 'বিস্তারিত' : 'Details'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Account Information + Favorite Apps Quick Row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <div className="dh-card rounded-3xl p-5 dark:bg-slate-900 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[#172033] dark:text-slate-100 flex items-center gap-2">
                  <UserIcon className="w-4 h-4 text-[#FF8500]" />
                  {lang === 'bn' ? 'অ্যাকাউন্ট তথ্য' : 'Account Information'}
                </h2>
                <button
                  type="button"
                  onClick={() => setTab('profile')}
                  className="text-xs font-bold text-[#FF8500] hover:underline"
                >
                  {lang === 'bn' ? 'সম্পাদনা' : 'Manage'} →
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="p-3 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/70">
                  <span className="text-[11px] text-[#777777] dark:text-slate-400 block">
                    {lang === 'bn' ? 'নাম' : 'Account Name'}
                  </span>
                  <strong className="text-[#172033] dark:text-slate-100 truncate block">
                    {profile?.displayName || user.displayName || 'Customer'}
                  </strong>
                </div>
                <div className="p-3 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/70">
                  <span className="text-[11px] text-[#777777] dark:text-slate-400 block">
                    {lang === 'bn' ? 'লগইন মাধ্যম' : 'Sign-in Method'}
                  </span>
                  <strong className="text-[#172033] dark:text-slate-100 uppercase">
                    {profile?.authMethod || user.authMethod || 'phone'}
                  </strong>
                </div>
                <div className="p-3 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/70">
                  <span className="text-[11px] text-[#777777] dark:text-slate-400 block">
                    {lang === 'bn' ? 'যোগদানের তারিখ' : 'Member Since'}
                  </span>
                  <strong className="text-[#172033] dark:text-slate-100 font-mono-num">
                    {formatDateShort(profile?.createdAt, lang)}
                  </strong>
                </div>
                <div className="p-3 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/70">
                  <span className="text-[11px] text-[#777777] dark:text-slate-400 block">
                    {lang === 'bn' ? 'ফোন / ইমেইল' : 'Contact'}
                  </span>
                  <strong className="text-[#172033] dark:text-slate-100 font-mono-num truncate block">
                    {profile?.phone || user.phone || profile?.email || user.email || '-'}
                  </strong>
                </div>
              </div>
            </div>

            <div className="dh-card rounded-3xl p-5 dark:bg-slate-900 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[#172033] dark:text-slate-100 flex items-center gap-2">
                  <Heart className="w-4 h-4 text-[#FF8500]" />
                  {lang === 'bn' ? 'পছন্দের অ্যাপস' : 'Favorite Apps'} ({favoriteApps.length})
                </h2>
                <button
                  type="button"
                  onClick={() => (favoriteApps.length > 0 ? setTab('favorites') : onNavigate('mobile-apps'))}
                  className="text-xs font-bold text-[#FF8500] hover:underline"
                >
                  {favoriteApps.length > 0
                    ? lang === 'bn'
                      ? 'সব দেখুন →'
                      : 'View All →'
                    : lang === 'bn'
                      ? 'অ্যাপ স্টোর →'
                      : 'Browse Apps →'}
                </button>
              </div>
              {favoriteApps.length === 0 ? (
                <div className="p-4 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/70 text-center space-y-2">
                  <p className="text-xs text-[#777777] dark:text-slate-400">
                    {lang === 'bn'
                      ? 'আপনি এখনো কোনো মোবাইল অ্যাপ ফেভারিট করেননি।'
                      : 'You have not saved any favorite mobile apps yet.'}
                  </p>
                  <button
                    type="button"
                    onClick={() => onNavigate('mobile-apps')}
                    className="px-3.5 py-1.5 rounded-xl dh-orange-gradient text-white text-xs font-bold"
                  >
                    {lang === 'bn' ? 'Mobile App Store দেখুন' : 'Explore Mobile App Store'}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {favoriteApps.slice(0, 4).map((app) => (
                    <div
                      key={app.id}
                      className="p-2.5 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/70 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between gap-2"
                    >
                      <button
                        type="button"
                        onClick={() => onNavigate('mobile-apps')}
                        className="flex items-center gap-2.5 min-w-0 text-left"
                      >
                        <img
                          src={app.iconUrl}
                          alt={app.name}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-9 h-9 rounded-xl object-cover shrink-0 border border-[#E6ECFA]"
                        />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-[#172033] dark:text-slate-100 truncate">
                            {app.name}
                          </p>
                          <p className="text-[10px] text-[#64748B] dark:text-slate-400 truncate">
                            {app.version ? `v${app.version}` : app.developer}
                          </p>
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled={unfavoritingId === app.id}
                        onClick={() => handleUnfavoriteApp(app.id)}
                        title={lang === 'bn' ? 'সরিয়ে ফেলুন' : 'Remove favorite'}
                        className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 shrink-0"
                      >
                        <Heart className="w-4 h-4 fill-current" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Recent Download History Card (Synced from DB analytics_events) */}
          <div className="dh-card rounded-3xl p-5 dark:bg-slate-900 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-bold text-[#172033] dark:text-slate-100 flex items-center gap-2">
                <Download className="w-4 h-4 text-[#0EA5E9]" />
                {lang === 'bn' ? 'সাম্প্রতিক ডাউনলোড ও প্লে হিস্টোরি' : 'Recent Downloads & Plays'}
              </h2>
              <button
                type="button"
                onClick={() => setTab('downloads')}
                className="text-xs font-bold text-[#FF8500] hover:underline cursor-pointer"
              >
                {lang === 'bn' ? 'সব হিস্টোরি →' : 'Full History →'}
              </button>
            </div>
            {downloadHistory.length === 0 ? (
              <p className="text-xs text-[#777777] dark:text-slate-400 py-3 text-center">
                {lang === 'bn'
                  ? 'এখনো কোনো অ্যাপ বা গেম ডাউনলোড/প্লে রেকর্ড হয়নি।'
                  : 'No app downloads or game plays recorded yet.'}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {downloadHistory.slice(0, 3).map((dl) => {
                  const matchedApp = dl.contentType === 'app' ? appById.get(dl.contentId) : undefined;
                  const matchedGame = dl.contentType === 'game' ? gameById.get(dl.contentId) : undefined;
                  const itemTitle =
                    matchedApp?.name ||
                    (matchedGame ? (lang === 'bn' ? matchedGame.titleBn : matchedGame.titleEn) : '') ||
                    dl.contentId;
                  return (
                    <button
                      key={dl.id}
                      type="button"
                      onClick={() => onNavigate(dl.contentType === 'game' ? 'games-store' : 'mobile-apps')}
                      className="p-3 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/70 border border-[#E6ECFA] dark:border-slate-700 text-left hover:border-[#FF8500] transition-colors cursor-pointer"
                    >
                      <p className="text-xs font-extrabold text-[#172033] dark:text-slate-100 truncate">
                        {itemTitle}
                      </p>
                      <p className="text-[10px] font-mono-num text-[#64748B] dark:text-slate-400 mt-0.5 truncate">
                        {dl.contentType.toUpperCase()} · {dl.eventType.replace(/_/g, ' ')} · {formatDateShort(dl.createdAt, lang)}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="p-4 rounded-3xl bg-gradient-to-r from-[#172033] to-[#23314d] text-white flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-extrabold uppercase text-[#FF8500] flex items-center gap-1.5">
                <Film className="w-4 h-4" />
                {lang === 'bn' ? 'ওয়াচ অ্যান্ড আর্ন (S2S ভেরিফায়েড)' : 'Watch & Earn (S2S Verified)'}
              </p>
              <p className="text-xs text-white/80">
                {lang === 'bn'
                  ? 'অনুমোদিত ইনসেন্টিভাইজড সেশনে অংশ নিয়ে কয়েন আয় করুন এবং ওয়ালেটে কনভার্ট করুন।'
                  : 'Complete verified incentivized sessions to earn coins and redeem them into your DIGITAL HUB wallet.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('watch-earn')}
              className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold shrink-0"
            >
              {lang === 'bn' ? 'Watch & Earn খুলুন →' : 'Open Watch & Earn →'}
            </button>
          </div>

          <NativeAdRow
            placement="dashboard_promo"
            advertisements={advertisements}
            adNetworks={adNetworks}
            adsEnabled={settings.adsEnabled}
            lang={lang}
            maxCards={2}
          />
        </div>
      )}

      {tab === 'orders' && (
        <div className="dh-card rounded-3xl p-5 space-y-3">
          <h2 className="text-lg font-bold text-[#172033]">{t(lang, 'navOrders')}</h2>
          {orders.length === 0 ? (
            <p className="text-sm text-[#777777] py-8 text-center">
              {lang === 'bn' ? 'কোনো অর্ডার পাওয়া যায়নি।' : 'No orders found.'}
            </p>
          ) : (
            orders.map((ord) => (
              <div
                key={ord.id}
                className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col md:flex-row md:items-center justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono-num font-bold text-[#FF8500]">#{ord.orderNumber}</span>
                    <span className="px-2.5 py-0.5 rounded-md bg-white border border-[#E6ECFA] text-[11px] font-bold">
                      {ord.status}
                    </span>
                    <span className="text-xs text-[#777777]">{formatDateShort(ord.createdAt, lang)}</span>
                  </div>
                  <p className="text-sm font-bold text-[#172033]">
                    {lang === 'bn' ? ord.productTitleBn || ord.productTitleEn : ord.productTitleEn}
                    {ord.selectedPackageName ? (
                      <span className="ml-1.5 text-xs font-semibold text-[#FF8500]">
                        [{ord.selectedPackageName}]
                      </span>
                    ) : null}
                  </p>
                  {ord.itemsSummary && <p className="text-xs text-[#777777]">{ord.itemsSummary}</p>}
                  {ord.adminNote && (
                    <p className="text-xs font-semibold text-[#16A34A]">
                      {lang === 'bn' ? 'ডেলিভারি নোট:' : 'Delivery Note:'} {ord.adminNote}
                    </p>
                  )}
                  {ord.rejectionReason && (
                    <p className="text-xs font-semibold text-[#DC2626]">
                      {lang === 'bn' ? 'বাতিলের কারণ:' : 'Reason:'} {ord.rejectionReason}
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <span className="text-base font-extrabold font-mono-num text-[#172033] mr-2">
                    ৳{ord.totalPriceBdt}
                  </span>
                  <button
                    type="button"
                    onClick={() => setSelectedOrder(ord)}
                    className="px-3 py-1.5 rounded-xl bg-white border border-[#E6ECFA] text-[#172033] text-xs font-bold flex items-center gap-1 hover:border-[#FF8500]"
                  >
                    <Eye className="w-3.5 h-3.5 text-[#FF8500]" />
                    {lang === 'bn' ? 'ট্র্যাক / বিস্তারিত' : 'Track / Details'}
                  </button>
                  {(ord.status === 'Pending Payment' || ord.status === 'Verification Pending') && (
                    <button
                      type="button"
                      onClick={() =>
                        cancelCustomerOrder(ord.id, {
                          customerId: ord.customerId,
                          orderNumber: ord.orderNumber,
                        }).then(() =>
                          setFeedback(
                            lang === 'bn'
                              ? `অর্ডার #${ord.orderNumber} বাতিল করা হয়েছে।`
                              : `Order #${ord.orderNumber} cancelled.`
                          )
                        )
                      }
                      className="px-3 py-1.5 rounded-xl bg-red-50 text-[#DC2626] text-xs font-bold flex items-center gap-1 hover:bg-red-100"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      {lang === 'bn' ? 'বাতিল করুন' : 'Cancel'}
                    </button>
                  )}
                  {ord.status === 'Completed' && (
                    <button
                      type="button"
                      onClick={() => setReviewOrder(ord)}
                      className="px-3 py-1.5 rounded-xl dh-orange-gradient text-white text-xs font-bold flex items-center gap-1"
                    >
                      <Star className="w-3.5 h-3.5" />
                      {lang === 'bn' ? 'রিভিউ লিখুন' : 'Write Review'}
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'payments' && (
        <div className="dh-card rounded-3xl p-5 space-y-3">
          <h2 className="text-lg font-bold text-[#172033]">
            {lang === 'bn' ? 'পেমেন্ট যাচাইকরণ ইতিহাস' : 'Payment Verification History'}
          </h2>
          {payments.length === 0 ? (
            <p className="text-sm text-[#777777] py-8 text-center">
              {lang === 'bn' ? 'কোনো পেমেন্ট রেকর্ড নেই।' : 'No payment records yet.'}
            </p>
          ) : (
            payments.map((pay) => (
              <div
                key={pay.id}
                className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="flex items-center gap-3">
                  <PaymentProviderLogo method={pay.method} compact settings={settings} />
                  <div>
                    <p className="text-sm font-bold text-[#172033]">
                      <span className="font-mono-num">{pay.transactionId}</span>
                    </p>
                    <p className="text-xs text-[#777777]">
                      {pay.purpose === 'add_money' ? 'Add Money' : `Order #${pay.orderNumber || pay.orderId}`} ·{' '}
                      {pay.senderNumber} → {pay.receiverNumber}
                    </p>
                    {pay.rejectionReason && (
                      <p className="text-xs text-[#DC2626] font-semibold mt-0.5">{pay.rejectionReason}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-extrabold font-mono-num text-[#FF8500]">৳{pay.amountBdt}</span>
                  <span
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
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
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'rewards' && (
        <div className="space-y-5">
          {/* Cashback Program & History */}
          <div className="dh-card rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-[#172033]">
                  {lang === 'bn' ? 'অর্ডার ক্যাশব্যাক প্রোগ্রাম' : 'Order Cashback Program'}
                </h2>
                <p className="text-xs text-[#777777]">
                  {settings.cashbackEnabled !== false
                    ? lang === 'bn'
                      ? `প্রতিটি সম্পন্ন অর্ডারে (ন্যূনতম ৳${settings.cashbackMinOrderBdt ?? 100}) ${settings.cashbackPercent ?? 2}% ক্যাশব্যাক (সর্বোচ্চ ৳${settings.cashbackMaxPerOrderBdt ?? 100}) সরাসরি ওয়ালেটে যোগ হয়।`
                      : `Earn ${settings.cashbackPercent ?? 2}% cashback (up to ৳${settings.cashbackMaxPerOrderBdt ?? 100} per order) on completed orders ≥ ৳${settings.cashbackMinOrderBdt ?? 100}.`
                    : lang === 'bn'
                      ? 'ক্যাশব্যাক প্রোগ্রাম বর্তমানে বন্ধ আছে।'
                      : 'Cashback program is currently paused by admin.'}
                </p>
              </div>
              <div className="px-4 py-2 rounded-2xl bg-emerald-50 text-[#16A34A] font-mono-num font-extrabold text-sm">
                {lang === 'bn' ? 'মোট ক্যাশব্যাক:' : 'Total Earned:'} ৳{earningStats.cashbackEarned}
              </div>
            </div>

            {walletTxs.filter((tx) => tx.type === 'cashback').length === 0 ? (
              <p className="text-xs text-[#777777] py-4 text-center">
                {lang === 'bn' ? 'এখনো কোনো ক্যাশব্যাক যোগ হয়নি।' : 'No cashback transactions credited yet.'}
              </p>
            ) : (
              <div className="space-y-2">
                {walletTxs
                  .filter((tx) => tx.type === 'cashback')
                  .map((tx) => (
                    <div
                      key={tx.id}
                      className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex items-center justify-between text-xs"
                    >
                      <div>
                        <p className="font-bold text-[#172033]">{tx.note || 'Order Cashback'}</p>
                        <p className="text-[#777777]">{formatDateShort(tx.createdAt, lang)}</p>
                      </div>
                      <span className="font-mono-num font-extrabold text-[#16A34A]">+৳{tx.amountBdt}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>

          {/* Policy-Compliant Rewarded Ads */}
          <div className="dh-card rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-[#172033]">
                  {lang === 'bn' ? 'রিওয়ার্ডেড অ্যাড (পলিসি-সম্মত)' : 'Rewarded Ads (Policy-Compliant)'}
                </h2>
                <p className="text-xs text-[#777777]">
                  {lang === 'bn'
                    ? `প্রতি ভেরিফায়েড রিওয়ার্ড ক্লেইমে ৳${settings.rewardedAdAmountBdt ?? 2} · দৈনিক সীমা: ${settings.rewardedAdDailyLimit ?? 10}টি · কুলডাউন: ${settings.rewardedAdCooldownMinutes ?? 5} মিনিট। (Google AdSense কখনোই রিওয়ার্ডেড হিসেবে ব্যবহার করা হয় না)`
                    : `Earn ৳${settings.rewardedAdAmountBdt ?? 2} per verified incentivized ad claim · Daily cap: ${settings.rewardedAdDailyLimit ?? 10} · Cooldown: ${settings.rewardedAdCooldownMinutes ?? 5}m. (Google AdSense is strictly excluded from incentivized clicks)`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('wallet')}
                className="px-4 py-2 rounded-xl bg-[#172033] text-white text-xs font-bold hover:bg-[#FF8500] transition-colors"
              >
                {lang === 'bn' ? 'ওয়ালেট ও উইথড্র দেখুন' : 'Go to Wallet & Withdraw'}
              </button>
            </div>

            {settings.rewardedAdEnabled === false ? (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs text-amber-800 font-semibold">
                {lang === 'bn'
                  ? 'রিওয়ার্ডেড অ্যাড বর্তমানে অ্যাডমিন দ্বারা সাময়িকভাবে বন্ধ রাখা হয়েছে।'
                  : 'Rewarded ads are currently paused by the administrator.'}
              </div>
            ) : incentivizedNetworks.length === 0 ? (
              <div className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs text-[#777777]">
                {lang === 'bn'
                  ? 'এই মুহূর্তে কোনো অনুমোদিত ইনসেন্টিভাইজড অ্যাড নেটওয়ার্ক সক্রিয় নেই। অ্যাডমিন প্যানেল থেকে সাপোর্টেড নেটওয়ার্ক সক্রিয় করলে এখানে দেখতে পাবেন।'
                  : 'No incentivized-compatible ad networks are currently active. Admin must explicitly enable a non-AdSense incentivized network before claims open.'}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {incentivizedNetworks.map((net) => {
                  const todayStr = getDhakaDateString();
                  const todayCount = rewardClaims.filter((c) => c.claimDate === todayStr && c.status !== 'Rejected').length;
                  const limit = settings.rewardedAdDailyLimit ?? 10;
                  return (
                    <div
                      key={net.id}
                      className="p-4 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/30 flex items-center justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-bold text-[#172033]">{net.name}</p>
                        <p className="text-[11px] text-[#777777] uppercase">
                          {net.provider} · {todayCount}/{limit} {lang === 'bn' ? 'আজকের ক্লেইম' : 'today'}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={
                          claimingNetId === net.id ||
                          profile?.status === 'suspended' ||
                          todayCount >= limit
                        }
                        onClick={() => handleClaimRewardedAd(net.id)}
                        className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold disabled:opacity-50 shrink-0"
                      >
                        {claimingNetId === net.id
                          ? '...'
                          : `${lang === 'bn' ? 'ক্লেইম' : 'Claim'} ৳${settings.rewardedAdAmountBdt ?? 2}`}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {rewardClaims.length > 0 && (
              <div className="space-y-2 pt-2">
                <h3 className="text-xs font-bold text-[#172033] uppercase">
                  {lang === 'bn' ? 'সাম্প্রতিক রিওয়ার্ড ক্লেইম' : 'Recent Reward Claims'}
                </h3>
                {rewardClaims.slice(0, 8).map((c) => (
                  <div
                    key={c.id}
                    className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex items-center justify-between text-xs"
                  >
                    <div>
                      <p className="font-bold text-[#172033]">{c.networkName}</p>
                      <p className="text-[11px] text-[#777777]">
                        {c.claimDate}
                        {c.rejectionReason ? ` · ${c.rejectionReason}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono-num font-bold text-[#172033]">৳{c.amountBdt}</span>
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          c.status === 'Credited'
                            ? 'bg-emerald-100 text-[#16A34A]'
                            : c.status === 'Rejected'
                              ? 'bg-red-100 text-[#DC2626]'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {c.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Complete Coin & Reward History Ledger */}
          <div className="dh-card rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-bold text-[#172033] flex items-center gap-2">
                  <Coins className="w-5 h-5 text-[#FF8500]" />
                  {lang === 'bn' ? 'সম্পূর্ণ কয়েন ও রিওয়ার্ড হিস্টোরি' : 'Reward History & Coin Ledger'}
                </h2>
                <p className="text-xs text-[#777777]">
                  {lang === 'bn'
                    ? 'ওয়াচ অ্যান্ড আর্ন, অ্যাডমিন বোনাস এবং কয়েন রিডেম্পশন ইতিহাস'
                    : 'Verified coin earnings, admin adjustments, and wallet redemptions'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-3 py-1.5 rounded-xl bg-[#FFF7EE] border border-[#FF8500]/30 text-xs font-extrabold font-mono-num text-[#FF8500]">
                  {wallet?.coinsAvailable || 0} Coins
                </span>
                <button
                  type="button"
                  onClick={() => onNavigate('watch-earn')}
                  className="px-3.5 py-1.5 rounded-xl dh-orange-gradient text-white text-xs font-bold"
                >
                  {lang === 'bn' ? 'আরও কয়েন আয়' : 'Earn More'}
                </button>
              </div>
            </div>

            {adRewardTransactions.length === 0 ? (
              <p className="text-xs text-[#777777] py-4 text-center">
                {lang === 'bn' ? 'এখনো কোনো কয়েন লেনদেন রেকর্ড হয়নি।' : 'No coin transactions recorded yet.'}
              </p>
            ) : (
              <div className="space-y-2">
                {adRewardTransactions.slice(0, 20).map((ct) => {
                  const isDebit = ct.type === 'coin_redemption' || ct.coins < 0;
                  return (
                    <div
                      key={ct.id}
                      className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-[#172033] truncate">{ct.note || ct.type.replace(/_/g, ' ')}</p>
                        <p className="text-[11px] text-[#777777] font-mono-num">
                          {ct.provider.toUpperCase()} · {formatDateShort(ct.createdAt, lang)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={`font-mono-num font-extrabold ${
                            isDebit ? 'text-[#DC2626]' : 'text-[#16A34A]'
                          }`}
                        >
                          {isDebit ? '-' : '+'}
                          {Math.abs(ct.coins)} Coins
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-white border border-[#E6ECFA] text-[10px] font-bold">
                          {ct.status}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'favorites' && (
        <div className="dh-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#172033] flex items-center gap-2">
                <Heart className="w-5 h-5 text-rose-500 fill-current" />
                {lang === 'bn' ? 'আপনার পছন্দের মোবাইল অ্যাপস' : 'Favorite Mobile Apps'}
              </h2>
              <p className="text-xs text-[#777777]">
                {lang === 'bn'
                  ? 'Mobile App Store থেকে সেভ করা আপনার প্রিয় অ্যাপগুলো এখানে দ্রুত পাবেন।'
                  : 'Quick access to Android apps you bookmarked in Mobile App Store.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('mobile-apps')}
              className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold"
            >
              {lang === 'bn' ? 'Mobile App Store খুলুন →' : 'Open App Store →'}
            </button>
          </div>

          {favoriteApps.length === 0 ? (
            <div className="py-10 text-center space-y-3">
              <Heart className="w-10 h-10 text-[#CBD5E1] mx-auto" />
              <p className="text-sm text-[#777777]">
                {lang === 'bn'
                  ? 'কোনো অ্যাপ এখনো ফেভারিট তালিকায় যোগ করা হয়নি।'
                  : 'No favorite apps saved yet. Tap the heart icon on any app in the Mobile App Store.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {favoriteApps.map((app) => (
                <div
                  key={app.id}
                  className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col justify-between gap-3"
                >
                  <div className="flex items-start gap-3">
                    <img
                      src={app.iconUrl}
                      alt={app.name}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                      className="w-12 h-12 rounded-xl object-cover border border-[#E6ECFA] shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-extrabold text-[#172033] truncate">{app.name}</p>
                      <p className="text-[11px] text-[#777777] truncate">
                        {app.developer}
                        {app.version ? ` · v${app.version}` : ''}
                      </p>
                      <p className="text-xs text-[#475569] line-clamp-2 mt-1">
                        {lang === 'bn' ? app.shortDescBn : app.shortDescEn}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E6ECFA]">
                    <button
                      type="button"
                      onClick={() => onNavigate('mobile-apps')}
                      className="px-3 py-1.5 rounded-xl bg-[#172033] text-white text-xs font-bold hover:bg-[#FF8500] transition-colors"
                    >
                      {lang === 'bn' ? 'অ্যাপ দেখুন' : 'View in Store'}
                    </button>
                    <button
                      type="button"
                      disabled={unfavoritingId === app.id}
                      onClick={() => handleUnfavoriteApp(app.id)}
                      className="px-3 py-1.5 rounded-xl bg-rose-50 text-rose-600 text-xs font-bold inline-flex items-center gap-1 hover:bg-rose-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {lang === 'bn' ? 'সরান' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'downloads' && (
        <div className="dh-card rounded-3xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-[#172033] dark:text-slate-100 flex items-center gap-2">
                <Download className="w-5 h-5 text-[#0EA5E9]" />
                {lang === 'bn' ? 'অ্যাপ ও গেম ডাউনলোড হিস্টোরি' : 'Download & Play History'}
              </h2>
              <p className="text-xs text-[#777777] dark:text-slate-400">
                {lang === 'bn'
                  ? 'আপনার অ্যাকাউন্ট থেকে করা সাম্প্রতিক অ্যাপ ডাউনলোড ও গেম প্লে ক্লিকের ইতিহাস।'
                  : 'Verified record of mobile app downloads and game play/install clicks from your account.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate('mobile-apps')}
                className="px-3.5 py-2 rounded-xl bg-[#172033] text-white text-xs font-bold hover:bg-[#FF8500] transition-colors cursor-pointer"
              >
                {lang === 'bn' ? 'অ্যাপ স্টোর' : 'App Store'}
              </button>
              <button
                type="button"
                onClick={() => onNavigate('games-store')}
                className="px-3.5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold cursor-pointer"
              >
                {lang === 'bn' ? 'গেমস স্টোর' : 'Games Store'}
              </button>
            </div>
          </div>

          {downloadHistory.length === 0 ? (
            <div className="py-10 text-center space-y-3">
              <Download className="w-10 h-10 text-[#CBD5E1] mx-auto" />
              <p className="text-sm text-[#777777] dark:text-slate-400">
                {lang === 'bn'
                  ? 'এখনো কোনো ডাউনলোড হিস্টোরি নেই।'
                  : 'No downloads or game plays recorded yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {downloadHistory.map((dl) => {
                const matchedApp = dl.contentType === 'app' ? appById.get(dl.contentId) : undefined;
                const matchedGame = dl.contentType === 'game' ? gameById.get(dl.contentId) : undefined;
                const title =
                  matchedApp?.name ||
                  (matchedGame ? (lang === 'bn' ? matchedGame.titleBn : matchedGame.titleEn) : '') ||
                  dl.contentId;
                const thumb = matchedApp?.iconUrl || matchedGame?.imageUrl;
                const catLabel = matchedApp?.category || matchedGame?.category || '';
                return (
                  <div
                    key={dl.id}
                    className="p-3.5 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/70 border border-[#E6ECFA] dark:border-slate-700 flex flex-wrap items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {thumb ? (
                        <img
                          src={thumb}
                          alt={title}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="w-10 h-10 rounded-xl object-cover border border-[#E6ECFA] shrink-0"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-center shrink-0">
                          <Download className="w-4 h-4 text-[#0EA5E9]" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-extrabold text-[#172033] dark:text-slate-100 truncate">{title}</p>
                        <p className="text-[11px] font-mono-num text-[#64748B] dark:text-slate-400">
                          {dl.contentType.toUpperCase()}
                          {catLabel ? ` · ${catLabel}` : ''} · {dl.deviceType} · {formatDateShort(dl.createdAt, lang)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 text-[10px] font-bold uppercase text-[#0EA5E9]">
                        {dl.eventType === 'play_click'
                          ? lang === 'bn'
                            ? 'প্লে ক্লিক'
                            : 'Play Click'
                          : lang === 'bn'
                            ? 'ডাউনলোড ক্লিক'
                            : 'Download Click'}
                      </span>
                      <button
                        type="button"
                        onClick={() => onNavigate(dl.contentType === 'game' ? 'games-store' : 'mobile-apps')}
                        className="px-3 py-1.5 rounded-xl bg-[#172033] text-white text-xs font-bold hover:bg-[#FF8500] transition-colors cursor-pointer"
                      >
                        {lang === 'bn' ? 'স্টোর খুলুন' : 'Open Store'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'referrals' && (
        <div className="dh-card rounded-3xl p-5 sm:p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-[#172033]">
                {lang === 'bn' ? 'রেফারেল প্রোগ্রাম' : 'Referral Dashboard'}
              </h2>
              <p className="text-xs text-[#777777]">
                {settings.referralEnabled === false
                  ? lang === 'bn'
                    ? 'রেফারেল প্রোগ্রাম বর্তমানে সাময়িকভাবে বন্ধ আছে।'
                    : 'Referral rewards are currently paused by admin.'
                  : lang === 'bn'
                    ? `প্রতি সফল রেফারেলে আপনি পাবেন ৳${settings.referralBonusBdt} এবং আমন্ত্রিত বন্ধু পাবেন ৳${settings.invitedUserRewardBdt ?? 20} (শর্ত: ${(settings.referralEligibility || 'first_paid_order').replace(/_/g, ' ')})।`
                    : `Earn ৳${settings.referralBonusBdt} per qualified friend (welcome bonus ৳${settings.invitedUserRewardBdt ?? 20}) · Rule: ${(settings.referralEligibility || 'first_paid_order').replace(/_/g, ' ')}.`}
              </p>
            </div>
            <span className="px-3.5 py-1.5 rounded-xl bg-emerald-50 text-[#16A34A] text-xs font-extrabold font-mono-num">
              {lang === 'bn' ? 'মোট রেফারেল আয়:' : 'Total Referral Rewards:'} ৳{earningStats.referralEarned}
            </span>
          </div>

          {/* 4 Referral KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA]">
              <p className="text-[#777777] font-semibold">{lang === 'bn' ? 'মোট আমন্ত্রিত' : 'Total Invited Users'}</p>
              <p className="text-xl font-extrabold font-mono-num text-[#172033] mt-1">{referrals.length}</p>
            </div>
            <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA]">
              <p className="text-[#777777] font-semibold">{lang === 'bn' ? 'সফল রেজিস্ট্রেশন' : 'Successful Registrations'}</p>
              <p className="text-xl font-extrabold font-mono-num text-[#16A34A] mt-1">
                {referrals.filter((r) => r.status !== 'revoked' && r.status !== 'flagged').length}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA]">
              <p className="text-[#777777] font-semibold">{lang === 'bn' ? 'পেন্ডিং রেফারেল' : 'Pending Referrals'}</p>
              <p className="text-xl font-extrabold font-mono-num text-[#FF8500] mt-1">
                {referrals.filter((r) => r.status === 'pending' || r.status === 'qualified').length}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/30">
              <p className="text-[#777777] font-semibold">{lang === 'bn' ? 'মোট পুরস্কার' : 'Total Rewards'}</p>
              <p className="text-xl font-extrabold font-mono-num text-[#FF8500] mt-1">৳{earningStats.referralEarned}</p>
            </div>
          </div>

          {/* My Referral Code & Link Box */}
          <div className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs">
                <span className="text-[#777777] font-semibold block">{lang === 'bn' ? 'আমার রেফারেল কোড' : 'My Referral Code'}</span>
                <span className="text-base font-mono-num font-extrabold text-[#172033]">{refCode}</span>
              </div>
              <button
                type="button"
                onClick={handleCopyCode}
                className="px-3 py-1.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#172033] hover:border-[#FF8500]"
              >
                {lang === 'bn' ? 'কোড কপি' : 'Copy Code'}
              </button>
            </div>

            <div className="pt-2 border-t border-[#E6ECFA] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-[11px] font-semibold text-[#777777] block">
                  {lang === 'bn' ? 'আমার রেফারেল লিংক' : 'My Referral Link'}
                </span>
                <span className="text-xs font-mono-num text-[#172033] break-all">{referralUrl}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyRef}
                  className="px-3.5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5" />
                  {copiedRef ? t(lang, 'copied') : lang === 'bn' ? 'লিংক কপি' : 'Copy Link'}
                </button>
                <button
                  type="button"
                  onClick={handleShareRef}
                  className="px-3.5 py-2 rounded-xl bg-[#172033] text-white text-xs font-bold flex items-center gap-1.5"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  {lang === 'bn' ? 'শেয়ার' : 'Share Link'}
                </button>
              </div>
            </div>
          </div>

          {/* Referral History */}
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-[#172033]">
              {lang === 'bn' ? 'রেফারেল ইতিহাস' : 'Referral History'}
            </h3>
            {referrals.length === 0 ? (
              <p className="text-xs text-[#777777] py-4 text-center">
                {lang === 'bn' ? 'এখনো কোনো রেফারেল রেকর্ড নেই।' : 'No referral records yet.'}
              </p>
            ) : (
              referrals.map((r) => (
                <div key={r.id} className="p-3 rounded-xl bg-white border border-[#E6ECFA] flex flex-wrap justify-between items-center gap-2 text-xs">
                  <div>
                    <p className="font-bold text-[#172033] font-mono-num">
                      {r.referredEmail || `${r.referredUserId.slice(0, 12)}...`}
                    </p>
                    <p className="text-[11px] text-[#777777]">
                      Code: {r.referralCode} · {formatDateShort(r.createdAt, lang)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono-num font-bold text-[#172033]">৳{r.rewardAmountBdt}</span>
                    <span
                      className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                        r.status === 'credited'
                          ? 'bg-emerald-100 text-[#16A34A]'
                          : r.status === 'flagged' || r.status === 'revoked'
                            ? 'bg-red-100 text-[#DC2626]'
                            : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {r.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'coupons' && (
        <div className="dh-card rounded-3xl p-5 space-y-3">
          <h2 className="text-lg font-bold text-[#172033]">{t(lang, 'specialOffers')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {coupons.map((c) => (
              <div key={c.id} className="p-4 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/30 flex justify-between items-center">
                <div>
                  <span className="px-2.5 py-1 rounded-lg bg-[#172033] text-white font-mono-num text-xs font-bold">
                    {c.code}
                  </span>
                  <p className="text-xs text-[#777777] mt-1.5">
                    {lang === 'bn' ? `ন্যূনতম অর্ডার ৳${c.minOrderBdt}` : `Min order ৳${c.minOrderBdt}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-extrabold font-mono-num text-[#FF8500]">
                    {c.discountType === 'percent' ? `${c.discountValue}% OFF` : `৳${c.discountValue} OFF`}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="space-y-5">
          {announcements.length > 0 && (
            <div className="dh-card rounded-3xl p-5 space-y-3 border border-[#FF8500]/30">
              <h2 className="text-lg font-bold text-[#172033]">
                {lang === 'bn' ? 'অফিশিয়াল ঘোষণা (Announcements)' : 'Official Announcements'}
              </h2>
              <div className="space-y-2.5">
                {announcements.map((ann) => (
                  <div key={ann.id} className="p-3.5 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/30">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-bold text-[#172033]">
                        <span className="px-2 py-0.5 rounded-md bg-[#172033] text-white text-[10px] uppercase mr-2">
                          {ann.type}
                        </span>
                        {lang === 'bn' ? ann.titleBn : ann.titleEn}
                      </p>
                      <span className="text-[11px] text-[#777777] shrink-0">
                        {formatDateShort(ann.createdAt, lang)}
                      </span>
                    </div>
                    <p className="text-xs text-[#172033]/85 mt-1.5">
                      {lang === 'bn' ? ann.messageBn : ann.messageEn}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="dh-card rounded-3xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-[#172033]">
                {lang === 'bn' ? 'নোটিফিকেশন ও পেমেন্ট স্ট্যাটাস' : 'Notifications & Alerts'}
              </h2>
              {unreadCount > 0 && (
                <button
                  type="button"
                  disabled={markingAllRead}
                  onClick={handleMarkAllRead}
                  className="px-3.5 py-1.5 rounded-xl bg-[#172033] text-white text-xs font-bold inline-flex items-center gap-1.5 hover:bg-[#FF8500] transition-colors disabled:opacity-60"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>{lang === 'bn' ? 'সব পঠিত করুন' : 'Mark All Read'}</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {(
                [
                  { id: 'all', bn: 'সব', en: 'All' },
                  { id: 'new_app', bn: 'নতুন অ্যাপ', en: 'New App' },
                  { id: 'app_update', bn: 'আপডেট', en: 'Updates' },
                  { id: 'announcement', bn: 'ঘোষণা', en: 'Announcements' },
                  { id: 'download', bn: 'ডাউনলোড', en: 'Downloads' },
                  { id: 'payment', bn: 'পেমেন্ট ও অর্ডার', en: 'Payments' },
                  { id: 'support', bn: 'সাপোর্ট', en: 'Support' },
                  { id: 'reward', bn: 'রিওয়ার্ড', en: 'Rewards' },
                ] as const
              ).map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setNotifFilter(cat.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors ${
                    notifFilter === cat.id
                      ? 'bg-[#FF8500] text-white'
                      : 'bg-[#F3F6FF] border border-[#E6ECFA] text-[#475569] hover:border-[#FF8500]'
                  }`}
                >
                  {lang === 'bn' ? cat.bn : cat.en}
                </button>
              ))}
            </div>

            {filteredNotifications.length === 0 ? (
              <p className="text-sm text-[#777777] py-6 text-center">
                {lang === 'bn' ? 'এই ক্যাটাগরিতে কোনো বার্তা নেই।' : 'No notifications in this category.'}
              </p>
            ) : (
              filteredNotifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.read && markNotificationRead(n.id)}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition-colors ${
                    n.read ? 'bg-white border-[#E6ECFA]' : 'bg-[#FFF7EE] border-[#FF8500]/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="px-2 py-0.5 rounded-md bg-[#F3F6FF] border border-[#E6ECFA] text-[10px] font-bold uppercase text-[#FF8500] shrink-0">
                        {n.type.replace(/_/g, ' ')}
                      </span>
                      <p className="text-sm font-bold text-[#172033] truncate">
                        {lang === 'bn' ? n.titleBn : n.titleEn}
                      </p>
                    </div>
                    <span className="text-[11px] text-[#777777] shrink-0">{formatDateShort(n.createdAt, lang)}</span>
                  </div>
                  <p className="text-xs text-[#777777] mt-1">{lang === 'bn' ? n.messageBn : n.messageEn}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'support' && (
        <div className="space-y-5">
          {/* Quick WhatsApp Support Banner */}
          <div className="p-4 rounded-3xl bg-[#16A34A]/10 border border-[#16A34A]/25 flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-0.5">
              <p className="text-xs font-extrabold uppercase text-[#16A34A] flex items-center gap-1.5">
                <MessageCircle className="w-4 h-4" />
                {lang === 'bn' ? 'তাৎক্ষণিক WhatsApp সাপোর্ট' : 'Instant WhatsApp Support'}
              </p>
              <p className="text-xs text-[#172033]">
                {lang === 'bn'
                  ? 'জরুরি অর্ডার বা পেমেন্ট যাচাইয়ের জন্য সরাসরি WhatsApp-এ মেসেজ দিন।'
                  : 'Need urgent help with an order or payment? Reach our support desk directly on WhatsApp.'}
              </p>
            </div>
            <a
              href={settings.whatsappLink || 'https://wa.me/8801352838945'}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 rounded-xl bg-[#16A34A] hover:bg-[#15803D] text-white text-xs font-bold inline-flex items-center gap-1.5"
            >
              <MessageCircle className="w-4 h-4" />
              <span>{lang === 'bn' ? 'WhatsApp চ্যাট খুলুন' : 'Chat on WhatsApp'}</span>
            </a>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <form onSubmit={handleTicketSubmit} className="dh-card rounded-3xl p-5 space-y-3">
              <h2 className="text-lg font-bold text-[#172033]">
                {lang === 'bn' ? 'নতুন সাপোর্ট টিকেট' : 'Submit Support Ticket'}
              </h2>
              <div>
                <label className="block text-[11px] font-bold text-[#172033] mb-1">
                  {lang === 'bn' ? 'সমস্যার ধরন (Category)' : 'Issue Category'}
                </label>
                <select
                  value={ticketCategory}
                  onChange={(e) => setTicketCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-semibold text-[#172033] focus:outline-none focus:border-[#FF8500]"
                >
                  <option value="general">{lang === 'bn' ? 'সাধারণ সহায়তা (General)' : 'General Support'}</option>
                  <option value="order">{lang === 'bn' ? 'অর্ডার ও ডেলিভারি (Order)' : 'Order & Delivery'}</option>
                  <option value="payment">{lang === 'bn' ? 'পেমেন্ট ও TrxID (Payment)' : 'Payment & TrxID'}</option>
                  <option value="withdrawal">{lang === 'bn' ? 'উইথড্র সমস্যা (Withdrawal)' : 'Withdrawal Issue'}</option>
                  <option value="app_bug">{lang === 'bn' ? 'মোবাইল অ্যাপ / লিংক (App Bug)' : 'App Store / Broken Link'}</option>
                  <option value="reward">{lang === 'bn' ? 'কয়েন ও রিওয়ার্ড (Rewards)' : 'Coins & Watch/Earn'}</option>
                  <option value="account">{lang === 'bn' ? 'অ্যাকাউন্ট নিরাপত্তা (Account)' : 'Account & Security'}</option>
                </select>
              </div>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={lang === 'bn' ? 'বিষয় লিখুন' : 'Subject'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs focus:outline-none focus:border-[#FF8500]"
              />
              <input
                type="text"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                placeholder={lang === 'bn' ? 'অর্ডার নম্বর (ঐচ্ছিক, যেমন DH-123456)' : 'Order # (Optional)'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num focus:outline-none focus:border-[#FF8500]"
              />
              <textarea
                rows={3}
                required
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={lang === 'bn' ? 'সমস্যার বিস্তারিত লিখুন...' : 'Describe your issue...'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs focus:outline-none focus:border-[#FF8500]"
              />
              <div className="space-y-2">
                <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#FFF7EE] border border-[#FF8500]/35 text-xs font-bold text-[#172033] cursor-pointer hover:border-[#FF8500]">
                  <ImageIcon className="w-4 h-4 text-[#FF8500]" />
                  <span>{lang === 'bn' ? 'স্ক্রিনশট সংযুক্ত করুন (ঐচ্ছিক)' : 'Attach Screenshot (Optional)'}</span>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleTicketScreenshotUpload}
                    className="hidden"
                  />
                </label>
                {ticketScreenshot && (
                  <div className="relative inline-block">
                    <img
                      src={ticketScreenshot}
                      alt="Ticket screenshot preview"
                      className="max-h-32 rounded-xl border border-[#E6ECFA] object-contain bg-white"
                    />
                    <button
                      type="button"
                      onClick={() => setTicketScreenshot('')}
                      aria-label="Remove screenshot"
                      className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-[#DC2626] text-white flex items-center justify-center shadow"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <button
                type="submit"
                disabled={ticketSubmitting}
                className="w-full py-2.5 rounded-xl dh-orange-gradient text-white font-bold text-xs"
              >
                {ticketSubmitting ? '...' : lang === 'bn' ? 'টিকেট পাঠান' : 'Send Ticket'}
              </button>
            </form>

            <div className="dh-card rounded-3xl p-5 space-y-3">
              <h2 className="text-lg font-bold text-[#172033]">
                {lang === 'bn' ? 'পূর্ববর্তী সাপোর্ট টিকেট' : 'Your Tickets'}
              </h2>
              {tickets.length === 0 ? (
                <p className="text-xs text-[#777777] py-6 text-center">
                  {lang === 'bn' ? 'কোনো টিকেট নেই।' : 'No support tickets yet.'}
                </p>
              ) : (
                tickets.map((tk) => (
                  <div key={tk.id} className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-1.5">
                    <div className="flex flex-wrap justify-between items-center gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {tk.category && (
                          <span className="px-2 py-0.5 rounded-md bg-white border border-[#E6ECFA] text-[10px] font-bold uppercase text-[#475569] shrink-0">
                            {tk.category.replace(/_/g, ' ')}
                          </span>
                        )}
                        <span className="text-xs font-bold text-[#172033] truncate">{tk.subject}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded-md bg-white text-[10px] font-bold uppercase text-[#FF8500] shrink-0">
                        {tk.status}
                      </span>
                    </div>
                    <p className="text-xs text-[#777777]">{tk.message}</p>
                    {tk.screenshotDataUrl && (
                      <img
                        src={tk.screenshotDataUrl}
                        alt="Ticket attachment"
                        loading="lazy"
                        className="max-h-28 rounded-xl border border-[#E6ECFA] bg-white object-contain"
                      />
                    )}
                    {tk.adminReply && (
                      <p className="text-xs text-[#16A34A] font-semibold pt-1.5 border-t border-[#E6ECFA]">
                        Admin: {tk.adminReply}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {tab === 'profile' && (
        <div className="space-y-6 max-w-2xl">
          <form onSubmit={handleProfileSave} className="dh-card rounded-3xl p-5 sm:p-6 space-y-4">
            <h2 className="text-lg font-bold text-[#172033]">
              {lang === 'bn' ? 'প্রোফাইল ও অ্যাকাউন্ট সেটিংস' : 'Profile & Settings'}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-[#172033] mb-1">
                  {lang === 'bn' ? 'নাম' : 'Display Name'}
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#172033] mb-1">
                  {lang === 'bn' ? 'মোবাইল নম্বর' : 'Mobile Number'}
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm font-mono-num"
                />
              </div>
              {(profile?.email || user.email) && (
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-[#172033] mb-1">
                    {lang === 'bn' ? 'ইমেইল ঠিকানা' : 'Email Address'}
                  </label>
                  <input
                    type="email"
                    readOnly
                    value={profile?.email || user.email || ''}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#EEF2FC] border border-[#E6ECFA] text-sm text-[#475569] cursor-not-allowed"
                  />
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FFF7EE] border border-[#FF8500]/40 text-xs font-bold text-[#172033] cursor-pointer">
                <Upload className="w-4 h-4 text-[#FF8500]" />
                <span>{lang === 'bn' ? 'প্রোফাইল ছবি আপলোড' : 'Upload Avatar'}</span>
                <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
              </label>

              <button
                type="button"
                onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}
                className="px-4 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-bold text-[#172033]"
              >
                {lang === 'bn' ? 'ভাষা: বাংলা → English' : 'Language: English → বাংলা'}
              </button>
            </div>

            <button
              type="submit"
              disabled={profileSaving}
              className="px-6 py-2.5 rounded-xl dh-orange-gradient text-white font-bold text-sm"
            >
              {profileSaving ? '...' : lang === 'bn' ? 'সংরক্ষণ করুন' : 'Save Changes'}
            </button>
          </form>

          {/* Account Security & Deletion Requests */}
          <div className="dh-card rounded-3xl p-5 sm:p-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-[#172033] flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#FF8500]" />
                  {lang === 'bn' ? 'নিরাপত্তা ও সেশন নিয়ন্ত্রণ' : 'Account Security & Sessions'}
                </h3>
                <p className="text-xs text-[#777777] mt-0.5">
                  {lang === 'bn'
                    ? 'সংযুক্ত লগইন পদ্ধতি পরিচালনা করুন, অন্যান্য ডিভাইস থেকে লগআউট করুন অথবা অ্যাকাউন্ট মুছে ফেলার অনুরোধ পাঠান।'
                    : 'Manage linked sign-in methods, revoke sessions across devices, or submit an account deletion request.'}
                </p>
              </div>
            </div>

            {/* Account Authentication & Recovery Code Management */}
            <div className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-extrabold text-[#172033] flex items-center gap-1.5">
                  {(profile?.authMethod || user.authMethod) === 'email' ? (
                    <Mail className="w-3.5 h-3.5 text-[#FF8500]" />
                  ) : (
                    <Phone className="w-3.5 h-3.5 text-[#FF8500]" />
                  )}
                  <span>
                    {(profile?.authMethod || user.authMethod) === 'email'
                      ? lang === 'bn'
                        ? 'ইমেইল ও পাসওয়ার্ড নিরাপত্তা'
                        : 'Email & Password Security'
                      : lang === 'bn'
                        ? 'ফোন ও পাসওয়ার্ড নিরাপত্তা'
                        : 'Mobile & Password Security'}
                  </span>
                </p>
                <span className="px-2.5 py-1 rounded-lg border bg-emerald-50 border-emerald-200 text-[#16A34A] text-[11px] font-bold font-mono-num">
                  ✓ {profile?.phone || user.phone || profile?.email || user.email}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPwdFormOpen((v) => !v);
                    setRegenOpen(false);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-white border border-[#E6ECFA] hover:border-[#FF8500] text-[#172033] text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <KeyRound className="w-3.5 h-3.5 text-[#FF8500]" />
                  <span>{lang === 'bn' ? 'পাসওয়ার্ড পরিবর্তন করুন' : 'Change Password'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRegenOpen((v) => !v);
                    setPwdFormOpen(false);
                  }}
                  className="px-3.5 py-2 rounded-xl bg-white border border-[#E6ECFA] hover:border-[#FF8500] text-[#172033] text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-[#FF8500]" />
                  <span>{lang === 'bn' ? 'নতুন রিকভারি কোড তৈরি করুন' : 'Generate New Recovery Code'}</span>
                </button>
              </div>

              {freshRecoveryCode && (
                <div className="p-3 rounded-xl bg-white border-2 border-dashed border-[#FF8500]/50 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-bold text-[#777777]">
                      {lang === 'bn' ? 'নতুন ব্যাকআপ রিকভারি কোড (একবারই দেখানো হবে):' : 'New Backup Recovery Code (shown once):'}
                    </p>
                    <p className="text-base font-mono-num font-extrabold text-[#172033] tracking-wider">
                      {freshRecoveryCode}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(freshRecoveryCode).catch(() => {});
                      setFeedback(lang === 'bn' ? 'রিকভারি কোড কপি হয়েছে।' : 'Recovery code copied.');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#FFF7EE] border border-[#FF8500]/40 text-xs font-bold text-[#172033] inline-flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5 text-[#FF8500]" />
                    <span>{lang === 'bn' ? 'কপি' : 'Copy'}</span>
                  </button>
                </div>
              )}

              {pwdFormOpen && (
                <form
                  onSubmit={handleChangePassword}
                  className="pt-2 border-t border-[#DCE4F7] grid grid-cols-1 sm:grid-cols-2 gap-2.5"
                >
                  <input
                    type="password"
                    required
                    value={currentPwd}
                    onChange={(e) => setCurrentPwd(e.target.value)}
                    placeholder={lang === 'bn' ? 'বর্তমান পাসওয়ার্ড' : 'Current password'}
                    className="sm:col-span-2 px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newPwd}
                    onChange={(e) => setNewPwd(e.target.value)}
                    placeholder={lang === 'bn' ? 'নতুন পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)' : 'New password (min 6 chars)'}
                    className="px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={confirmNewPwd}
                    onChange={(e) => setConfirmNewPwd(e.target.value)}
                    placeholder={lang === 'bn' ? 'নতুন পাসওয়ার্ড নিশ্চিত করুন' : 'Confirm new password'}
                    className="px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs"
                  />
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={pwdBusy}
                      className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold disabled:opacity-60"
                    >
                      {pwdBusy ? '...' : lang === 'bn' ? 'পাসওয়ার্ড আপডেট করুন' : 'Update Password'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPwdFormOpen(false);
                        setCurrentPwd('');
                        setNewPwd('');
                        setConfirmNewPwd('');
                      }}
                      className="px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#777777]"
                    >
                      {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                    </button>
                  </div>
                </form>
              )}

              {regenOpen && (
                <form
                  onSubmit={handleRegenerateRecoveryCode}
                  className="pt-2 border-t border-[#DCE4F7] flex flex-wrap items-center gap-2"
                >
                  <input
                    type="password"
                    required
                    value={regenCurrentPwd}
                    onChange={(e) => setRegenCurrentPwd(e.target.value)}
                    placeholder={lang === 'bn' ? 'যাচাইয়ের জন্য বর্তমান পাসওয়ার্ড দিন' : 'Enter current password to confirm'}
                    className="flex-1 min-w-[200px] px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs"
                  />
                  <button
                    type="submit"
                    disabled={regenBusy}
                    className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold disabled:opacity-60"
                  >
                    {regenBusy ? '...' : lang === 'bn' ? 'তৈরি করুন' : 'Generate'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRegenOpen(false);
                      setRegenCurrentPwd('');
                    }}
                    className="px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#777777]"
                  >
                    {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                  </button>
                </form>
              )}
            </div>

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                disabled={revokingSessions}
                onClick={async () => {
                  setRevokingSessions(true);
                  setFeedback('');
                  try {
                    await triggerLogoutAllDevicesServer();
                    await onLogout();
                  } catch (err) {
                    setFeedback(err instanceof Error ? err.message : 'Failed to revoke sessions');
                  } finally {
                    setRevokingSessions(false);
                  }
                }}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#172033] text-white text-xs font-bold hover:opacity-90 disabled:opacity-60"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>
                  {revokingSessions
                    ? '...'
                    : lang === 'bn'
                      ? 'সব ডিভাইস থেকে লগআউট করুন'
                      : 'Sign Out From All Devices'}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setDeletionOpen((v) => !v)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-bold hover:bg-red-100"
              >
                <XCircle className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'অ্যাকাউন্ট ডিলিট অনুরোধ' : 'Request Account Deletion'}</span>
              </button>
            </div>

            {deletionSubmittedId && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[#16A34A] text-xs font-semibold">
                {lang === 'bn'
                  ? `অ্যাকাউন্ট ডিলিশন অনুরোধ (#${deletionSubmittedId}) অ্যাডমিন পর্যালোচনার জন্য জমা হয়েছে।`
                  : `Account deletion request (#${deletionSubmittedId}) queued for owner review.`}
              </div>
            )}

            {deletionOpen && !deletionSubmittedId && (
              <div className="p-4 rounded-2xl bg-[#FFF7EE] border border-red-200 space-y-3 text-xs">
                <p className="font-semibold text-[#172033]">
                  {lang === 'bn'
                    ? 'অর্থনৈতিক হিসাব ও অর্ডার অখণ্ডতা রক্ষার্থে অ্যাডমিন যাচাইয়ের পর অ্যাকাউন্ট বন্ধ করা হবে।'
                    : 'To protect payment & order integrity, deletion requests are reviewed by the owner before account closure.'}
                </p>
                <textarea
                  rows={2}
                  value={deletionReason}
                  onChange={(e) => setDeletionReason(e.target.value)}
                  placeholder={lang === 'bn' ? 'অ্যাকাউন্ট মুছে ফেলার কারণ (ঐচ্ছিক)...' : 'Reason for account deletion (optional)...'}
                  className="w-full px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={deletionSubmitting}
                    onClick={async () => {
                      setDeletionSubmitting(true);
                      setFeedback('');
                      try {
                        const res = await submitAccountDeletionRequestServer(deletionReason);
                        setDeletionSubmittedId(res.requestId || 'submitted');
                        setDeletionOpen(false);
                        setDeletionReason('');
                      } catch (err) {
                        setFeedback(err instanceof Error ? err.message : 'Request failed');
                      } finally {
                        setDeletionSubmitting(false);
                      }
                    }}
                    className="px-4 py-2 rounded-xl bg-[#DC2626] text-white font-bold text-xs disabled:opacity-60"
                  >
                    {deletionSubmitting
                      ? '...'
                      : lang === 'bn'
                        ? 'অনুরোধ নিশ্চিত করুন'
                        : 'Submit Deletion Request'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletionOpen(false)}
                    className="px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-[#777777] font-bold text-xs"
                  >
                    {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Order Details & Tracking Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 z-50 bg-[#172033]/65 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl max-h-[90vh] overflow-y-auto bg-white rounded-3xl shadow-2xl border border-[#E6ECFA]">
            <div className="sticky top-0 z-10 px-5 py-4 bg-[#FFF7EE] border-b border-[#E6ECFA] flex items-center justify-between">
              <div>
                <p className="text-xs font-mono-num font-bold text-[#FF8500]">#{selectedOrder.orderNumber}</p>
                <h3 className="text-base font-extrabold text-[#172033]">
                  {lang === 'bn' ? 'অর্ডার বিস্তারিত ও ট্র্যাকিং' : 'Order Details & Tracking'}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrder(null)}
                className="p-2 rounded-xl bg-white border border-[#E6ECFA] text-[#777777] hover:text-[#172033]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              {/* Fulfillment Timeline */}
              {(() => {
                const isRejectedOrCancelled =
                  selectedOrder.status === 'Rejected' || selectedOrder.status === 'Cancelled';
                const step2Done = ['Paid', 'Payment Approved', 'Processing', 'Completed'].includes(
                  selectedOrder.status
                );
                const step3Done = selectedOrder.status === 'Completed';
                return (
                  <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[#172033] flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-[#FF8500]" />
                        {lang === 'bn' ? 'অর্ডার অগ্রগতি' : 'Order Progress'}
                      </span>
                      <span
                        className={`px-2.5 py-0.5 rounded-lg text-[11px] font-bold ${
                          step3Done
                            ? 'bg-emerald-100 text-[#16A34A]'
                            : isRejectedOrCancelled
                              ? 'bg-red-100 text-[#DC2626]'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {selectedOrder.status}
                      </span>
                    </div>
                    {isRejectedOrCancelled ? (
                      <p className="text-[11px] font-semibold text-[#DC2626]">
                        {lang === 'bn'
                          ? `অর্ডারটি ${selectedOrder.status} অবস্থায় রয়েছে। প্রয়োজনে সাপোর্টে যোগাযোগ করুন।`
                          : `This order is ${selectedOrder.status}. Contact support if you need assistance.`}
                      </p>
                    ) : (
                      <div className="grid grid-cols-3 gap-2 pt-1">
                        {[
                          {
                            label: lang === 'bn' ? '১. জমা / যাচাই' : '1. Submitted',
                            done: true,
                          },
                          {
                            label: lang === 'bn' ? '২. পেমেন্ট অনুমোদিত' : '2. Processing',
                            done: step2Done,
                          },
                          {
                            label: lang === 'bn' ? '৩. ডেলিভারি সম্পন্ন' : '3. Completed',
                            done: step3Done,
                          },
                        ].map((st) => (
                          <div
                            key={st.label}
                            className={`p-2 rounded-xl border text-center font-bold text-[11px] ${
                              st.done
                                ? 'bg-emerald-50 border-emerald-200 text-[#16A34A]'
                                : 'bg-white border-[#E6ECFA] text-[#777777]'
                            }`}
                          >
                            {st.label}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Product & Price Snapshot */}
              <div className="p-4 rounded-2xl bg-white border border-[#E6ECFA] space-y-2">
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="text-sm font-extrabold text-[#172033]">
                      {lang === 'bn'
                        ? selectedOrder.productTitleBn || selectedOrder.productTitleEn
                        : selectedOrder.productTitleEn}
                    </p>
                    {selectedOrder.selectedPackageName && (
                      <p className="text-xs font-semibold text-[#FF8500]">
                        {selectedOrder.selectedPackageName}
                      </p>
                    )}
                    {selectedOrder.itemsSummary && (
                      <p className="text-[11px] text-[#777777] mt-1">{selectedOrder.itemsSummary}</p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-lg font-extrabold font-mono-num text-[#FF8500]">
                      ৳{selectedOrder.totalPriceBdt}
                    </p>
                    <p className="text-[11px] text-[#777777]">
                      Qty: {selectedOrder.quantity || 1} · {formatDateShort(selectedOrder.createdAt, lang)}
                    </p>
                  </div>
                </div>
                <div className="pt-2 border-t border-[#E6ECFA] grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-[#777777]">{lang === 'bn' ? 'পেমেন্ট মাধ্যম:' : 'Payment:'}</span>{' '}
                    <strong className="uppercase">{selectedOrder.paymentMethod}</strong>
                  </div>
                  <div>
                    <span className="text-[#777777]">TxID:</span>{' '}
                    <strong className="font-mono-num">{selectedOrder.transactionId}</strong>
                  </div>
                  <div>
                    <span className="text-[#777777]">{lang === 'bn' ? 'প্রেরক:' : 'Sender:'}</span>{' '}
                    <strong className="font-mono-num">{selectedOrder.senderNumber}</strong>
                  </div>
                  {selectedOrder.couponCode && (
                    <div>
                      <span className="text-[#777777]">{lang === 'bn' ? 'কুপন:' : 'Coupon:'}</span>{' '}
                      <strong className="text-[#16A34A]">
                        {selectedOrder.couponCode} (-৳{selectedOrder.discountBdt || 0})
                      </strong>
                    </div>
                  )}
                </div>
              </div>

              {/* Submitted Customer Info */}
              {selectedOrder.deliveryNote && (
                <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-1">
                  <p className="font-bold text-[#172033] flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-[#FF8500]" />
                    {lang === 'bn' ? 'প্রদত্ত অ্যাকাউন্ট / ডেলিভারি তথ্য' : 'Submitted Account & Order Info'}
                  </p>
                  <p className="text-[#172033] whitespace-pre-wrap break-words font-mono-num text-[11px]">
                    {selectedOrder.deliveryNote}
                  </p>
                </div>
              )}

              {selectedOrder.referenceAttachmentUrl && (
                <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-2">
                  <p className="font-bold text-[#172033]">
                    {lang === 'bn' ? 'সংযুক্ত রেফারেন্স ছবি' : 'Attached Reference File'}
                  </p>
                  <img
                    src={selectedOrder.referenceAttachmentUrl}
                    alt="Reference attachment"
                    className="max-h-44 rounded-xl border border-[#E6ECFA]"
                  />
                </div>
              )}

              {selectedOrder.adminNote && (
                <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 space-y-1">
                  <p className="font-bold">
                    {lang === 'bn' ? 'অ্যাডমিন ডেলিভারি নোট / প্রমাণ:' : 'Admin Delivery Note:'}
                  </p>
                  <p className="whitespace-pre-wrap break-words">{selectedOrder.adminNote}</p>
                </div>
              )}

              {selectedOrder.rejectionReason && (
                <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-[#DC2626] space-y-1">
                  <p className="font-bold">{lang === 'bn' ? 'বাতিলের কারণ:' : 'Rejection Reason:'}</p>
                  <p>{selectedOrder.rejectionReason}</p>
                </div>
              )}

              {/* Policy Reminder */}
              <div className="p-3 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/25 text-[11px] text-[#777777]">
                <strong className="text-[#172033]">{t(lang, 'refundPolicyTitle')}: </strong>
                {lang === 'bn'
                  ? 'ভেরিফিকেশন পেন্ডিং অবস্থায় অর্ডার বাতিল করা যাবে। ডেলিভারি সম্পন্ন হলে রিফান্ড প্রযোজ্য নয়; তবে সার্ভিস সমস্যার ক্ষেত্রে সাপোর্ট টিকেট ওপেন করুন।'
                  : 'Orders can be cancelled while Verification Pending. Delivered digital goods are non-refundable unless fulfillment failed; open a ticket for resolution.'}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                {(selectedOrder.status === 'Pending Payment' ||
                  selectedOrder.status === 'Verification Pending') && (
                  <button
                    type="button"
                    onClick={async () => {
                      await cancelCustomerOrder(selectedOrder.id, {
                        customerId: selectedOrder.customerId,
                        orderNumber: selectedOrder.orderNumber,
                      });
                      setSelectedOrder(null);
                      setFeedback(
                        lang === 'bn'
                          ? `অর্ডার #${selectedOrder.orderNumber} বাতিল করা হয়েছে।`
                          : `Order #${selectedOrder.orderNumber} cancelled.`
                      );
                    }}
                    className="px-4 py-2 rounded-xl bg-red-50 text-[#DC2626] font-bold flex items-center gap-1.5 hover:bg-red-100"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    {lang === 'bn' ? 'অর্ডার বাতিল করুন' : 'Cancel Order'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const ordNum = selectedOrder.orderNumber;
                    setSelectedOrder(null);
                    setOrderNumber(ordNum);
                    setSubject(`Issue with Order #${ordNum}`);
                    setTab('support');
                  }}
                  className="px-4 py-2 rounded-xl bg-[#172033] text-white font-bold flex items-center gap-1.5 hover:bg-[#FF8500] transition-colors"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  {lang === 'bn' ? 'সমস্যা জানান / সাপোর্ট' : 'Report Issue / Support'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Write Review Modal for Completed Orders */}
      {reviewOrder && (
        <div className="fixed inset-0 z-50 bg-[#172033]/60 flex items-center justify-center p-4">
          <form onSubmit={handleReviewSubmit} className="w-full max-w-md bg-white rounded-3xl p-6 space-y-4">
            <h3 className="text-lg font-bold text-[#172033]">
              {lang === 'bn' ? 'আপনার অভিজ্ঞতা শেয়ার করুন' : 'Write a Verified Review'}
            </h3>
            <p className="text-xs text-[#777777]">
              #{reviewOrder.orderNumber} · {lang === 'bn' ? reviewOrder.productTitleBn : reviewOrder.productTitleEn}
            </p>
            <div className="flex items-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  onClick={() => setReviewRating(star)}
                  className={`p-1.5 rounded-lg ${
                    star <= reviewRating ? 'text-[#FF8500]' : 'text-gray-300'
                  }`}
                >
                  <Star className="w-6 h-6 fill-current" />
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              required
              value={reviewComment}
              onChange={(e) => setReviewComment(e.target.value)}
              placeholder={lang === 'bn' ? 'সার্ভিস ও ডেলিভারি সম্পর্কে লিখুন...' : 'Share your service experience...'}
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm"
            />
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setReviewOrder(null)}
                className="px-4 py-2 rounded-xl bg-[#F3F6FF] text-xs font-bold text-[#172033]"
              >
                {lang === 'bn' ? 'বাতিল' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={reviewSubmitting}
                className="px-5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold"
              >
                {reviewSubmitting ? '...' : lang === 'bn' ? 'রিভিউ পাঠান' : 'Submit Review'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
