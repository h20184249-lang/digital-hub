import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  EmailAuthProvider,
  linkWithCredential,
  linkWithPopup,
  reauthenticateWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  Bell,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Eye,
  FileText,
  Film,
  Gift,
  KeyRound,
  LayoutDashboard,
  Link2,
  LogOut,
  MessageSquare,
  Package,
  Phone,
  PlusCircle,
  Share2,
  Shield,
  Star,
  Tag,
  Upload,
  User as UserIcon,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import {
  AdNetworkConfig,
  Advertisement,
  Announcement,
  AppNotification,
  AppRoute,
  Banner,
  Coupon,
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
import { t } from '../lib/i18n';
import {
  cancelCustomerOrder,
  compressImageToDataUrl,
  createSupportTicket,
  formatDateShort,
  markNotificationRead,
  normalizeBangladeshPhoneClient,
  registerPhoneIndexServer,
  submitAccountDeletionRequestServer,
  submitCustomerReview,
  submitRewardedAdClaimServer,
  triggerLogoutAllDevicesServer,
  updateUserProfileFields,
} from '../lib/firestoreService';
import { BannerSlotView } from './BannerSlotView';
import { NativeAdRow } from './AutomaticAdEngine';
import { ManagedPlacementSlot } from './AdUnitFrame';
import { PaymentProviderLogo } from './BrandLogos';

interface CustomerDashboardProps {
  initialTab?: 'overview' | 'orders' | 'payments' | 'referrals' | 'rewards' | 'coupons' | 'notifications' | 'support' | 'profile';
  lang: Language;
  setLang: (l: Language) => void;
  user: User | null;
  profile: UserProfile | null;
  wallet: WalletAccount | null;
  walletTxs?: WalletTransaction[];
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
}

export function CustomerDashboard({
  initialTab = 'overview',
  lang,
  setLang,
  user,
  profile,
  wallet,
  walletTxs = [],
  orders,
  payments,
  referrals,
  withdrawals = [],
  rewardClaims = [],
  announcements = [],
  coupons,
  notifications,
  tickets,
  banners,
  advertisements = [],
  adNetworks = [],
  managedAdUnits = [],
  settings,
  isAdmin,
  onNavigate,
  onOpenAuth,
}: CustomerDashboardProps) {
  const [tab, setTab] = useState(initialTab);
  const [copiedRef, setCopiedRef] = useState(false);

  // Support ticket state
  const [subject, setSubject] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [message, setMessage] = useState('');
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
  const [phone, setPhone] = useState(profile?.phone || '');
  const [photoUrl, setPhotoUrl] = useState(profile?.photoUrl || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [revokingSessions, setRevokingSessions] = useState(false);
  const [deletionReason, setDeletionReason] = useState('');
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [deletionSubmitting, setDeletionSubmitting] = useState(false);
  const [deletionSubmittedId, setDeletionSubmittedId] = useState('');
  const [linkPwdOpen, setLinkPwdOpen] = useState(false);
  const [linkPwdValue, setLinkPwdValue] = useState('');
  const [linkPwdConfirm, setLinkPwdConfirm] = useState('');
  const [linkingBusy, setLinkingBusy] = useState(false);
  const [linkedProviderTick, setLinkedProviderTick] = useState(0);

  useEffect(() => {
    if (profile?.displayName && !displayName) setDisplayName(profile.displayName);
    if (profile?.phone && !phone) setPhone(profile.phone);
    if (profile?.photoUrl && !photoUrl) setPhotoUrl(profile.photoUrl);
  }, [profile?.displayName, profile?.phone, profile?.photoUrl]);

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
      .filter((tx) => tx.type === 'rewarded_ad' && tx.status === 'Approved')
      .reduce((s, tx) => s + (tx.amountBdt || 0), 0);
    const totalWithdrawn = withdrawals
      .filter((w) => w.status === 'Approved')
      .reduce((s, w) => s + (w.amountBdt || 0), 0);
    return { cashbackEarned, referralEarned, adRewardsEarned, totalWithdrawn };
  }, [walletTxs, withdrawals]);

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

  const handleTicketSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setTicketSubmitting(true);
    setFeedback('');
    try {
      await createSupportTicket({
        userId: user.uid,
        userEmail: user.email || '',
        subject,
        message,
        orderNumber,
      });
      setSubject('');
      setOrderNumber('');
      setMessage('');
      setFeedback(lang === 'bn' ? 'সাপোর্ট টিকেট জমা হয়েছে।' : 'Support ticket submitted.');
    } finally {
      setTicketSubmitting(false);
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
        try {
          await registerPhoneIndexServer(normalizedBdPhone);
          setFeedback(
            lang === 'bn'
              ? `প্রোফাইল আপডেট হয়েছে এবং ফোন নম্বর (${normalizedBdPhone}) লগইনের জন্য যুক্ত হয়েছে।`
              : `Profile updated and phone (${normalizedBdPhone}) linked for phone login.`
          );
        } catch (idxErr) {
          const code = (idxErr as { code?: string })?.code || '';
          if (code === 'auth/phone-already-in-use') {
            setFeedback(
              lang === 'bn'
                ? 'প্রোফাইল সেভ হয়েছে, তবে এই ফোন নম্বরটি অন্য অ্যাকাউন্টে লগইনের জন্য ব্যবহৃত হচ্ছে।'
                : 'Profile saved, but this phone number is already linked to another login account.'
            );
          } else {
            setFeedback(lang === 'bn' ? 'প্রোফাইল আপডেট হয়েছে।' : 'Profile updated successfully.');
          }
        }
      } else {
        setFeedback(lang === 'bn' ? 'প্রোফাইল আপডেট হয়েছে।' : 'Profile updated successfully.');
      }
    } finally {
      setProfileSaving(false);
    }
  };

  void linkedProviderTick;
  const activeProviders = auth.currentUser?.providerData || user?.providerData || [];
  const hasGoogleLinked = activeProviders.some((p) => p.providerId === 'google.com');
  const hasPasswordLinked = activeProviders.some((p) => p.providerId === 'password');

  const handleLinkGoogleAccount = async () => {
    if (!auth.currentUser || linkingBusy) return;
    setLinkingBusy(true);
    setFeedback('');
    try {
      googleProvider.setCustomParameters({ prompt: 'select_account' });
      await linkWithPopup(auth.currentUser, googleProvider);
      await auth.currentUser.reload().catch(() => {});
      setLinkedProviderTick((n) => n + 1);
      setFeedback(
        lang === 'bn'
          ? 'Google অ্যাকাউন্ট সফলভাবে যুক্ত হয়েছে! এখন Google দিয়েও এই একই অ্যাকাউন্টে লগইন করতে পারবেন।'
          : 'Google account linked! You can now also sign in to this same account using Google.'
      );
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/credential-already-in-use' || code === 'auth/email-already-in-use') {
        setFeedback(
          lang === 'bn'
            ? 'এই Google অ্যাকাউন্টটি ইতিমধ্যেই অন্য একটি Digital Hub অ্যাকাউন্টের সাথে যুক্ত।'
            : 'That Google account is already linked to a different Digital Hub account.'
        );
      } else if (code === 'auth/unauthorized-domain') {
        setFeedback(
          lang === 'bn'
            ? 'এই ডোমেইনটি Firebase Authorized Domains-এ যুক্ত নয়।'
            : 'This domain is not authorized in Firebase Authentication settings.'
        );
      } else {
        setFeedback(
          lang === 'bn'
            ? 'Google অ্যাকাউন্ট লিংক করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Could not link Google account. Please try again.'
        );
      }
    } finally {
      setLinkingBusy(false);
    }
  };

  const handleLinkPasswordCredential = async (e: FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !auth.currentUser.email || linkingBusy) return;
    if (linkPwdValue.length < 6) {
      setFeedback(
        lang === 'bn'
          ? 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'
          : 'Password must be at least 6 characters.'
      );
      return;
    }
    if (linkPwdValue !== linkPwdConfirm) {
      setFeedback(
        lang === 'bn' ? 'দুটি পাসওয়ার্ড মেলেনি।' : 'Passwords do not match.'
      );
      return;
    }
    setLinkingBusy(true);
    setFeedback('');
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email.trim().toLowerCase(), linkPwdValue);
      try {
        await linkWithCredential(auth.currentUser, cred);
      } catch (linkErr) {
        const code = (linkErr as { code?: string })?.code || '';
        if (code === 'auth/requires-recent-login') {
          googleProvider.setCustomParameters({ prompt: 'select_account', login_hint: auth.currentUser.email });
          await reauthenticateWithPopup(auth.currentUser, googleProvider);
          await linkWithCredential(auth.currentUser, cred);
        } else {
          throw linkErr;
        }
      }
      await auth.currentUser.reload().catch(() => {});
      setLinkPwdValue('');
      setLinkPwdConfirm('');
      setLinkPwdOpen(false);
      setLinkedProviderTick((n) => n + 1);
      setFeedback(
        lang === 'bn'
          ? 'Digital Hub পাসওয়ার্ড সফলভাবে যুক্ত হয়েছে! এখন ইমেইল/ফোন ও পাসওয়ার্ড দিয়েও লগইন করতে পারবেন।'
          : 'Digital Hub password linked! You can now also sign in with Email/Phone and Password.'
      );
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/operation-not-allowed') {
        setFeedback(
          lang === 'bn'
            ? 'Firebase Console-এ Email/Password প্রোভাইডার চালু করা হয়নি।'
            : 'Email/Password sign-in provider is not yet enabled in Firebase Console.'
        );
      } else {
        setFeedback(
          lang === 'bn'
            ? 'পাসওয়ার্ড যুক্ত করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Could not link password. Please try again.'
        );
      }
    } finally {
      setLinkingBusy(false);
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
    { id: 'rewards', label: lang === 'bn' ? 'ক্যাশব্যাক ও রিওয়ার্ড' : 'Rewards & Cashback', icon: Star },
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
      <div className="dh-card rounded-3xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          {profile?.photoUrl || photoUrl || user.photoURL ? (
            <img
              src={profile?.photoUrl || photoUrl || user.photoURL || ''}
              alt={profile?.displayName || 'Customer'}
              className="w-14 h-14 rounded-2xl object-cover border-2 border-[#FF8500]"
            />
          ) : (
            <div className="w-14 h-14 rounded-2xl dh-orange-gradient text-white flex items-center justify-center text-xl font-extrabold">
              {(profile?.displayName || user.email || 'U').slice(0, 1).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-lg sm:text-xl font-extrabold text-[#172033]">
              {profile?.displayName || user.displayName || 'DIGITAL HUB Customer'}
            </h1>
            <p className="text-xs text-[#777777]">{user.email}</p>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              <span className="px-2 py-0.5 rounded-md bg-emerald-50 text-[#16A34A] text-[11px] font-bold">
                {user.emailVerified
                  ? lang === 'bn'
                    ? 'ইমেইল যাচাইকৃত'
                    : 'Verified Account'
                  : lang === 'bn'
                    ? 'ইমেইল যাচাই বাকি'
                    : 'Unverified Email'}
              </span>
              <span className="px-2 py-0.5 rounded-md bg-[#FFF3E5] text-[#FF8500] text-[11px] font-mono-num font-bold">
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
            className="px-4 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-[#172033] text-xs font-bold flex items-center gap-1.5"
          >
            <Wallet className="w-4 h-4 text-[#FF8500]" />
            ৳{(wallet?.availableBalanceBdt || 0).toFixed(2)}
          </button>
          {isAdmin && (
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              className="px-4 py-2 rounded-xl bg-[#172033] text-white text-xs font-bold flex items-center gap-1.5"
            >
              <Shield className="w-4 h-4 text-[#FF8500]" />
              {t(lang, 'navAdmin')}
            </button>
          )}
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="px-3.5 py-2 rounded-xl bg-red-50 text-[#DC2626] text-xs font-bold flex items-center gap-1.5 hover:bg-red-100"
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
                  : 'bg-white border border-[#E6ECFA] text-[#172033] hover:border-[#FF8500]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {feedback && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[#16A34A] text-xs font-bold flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{feedback}</span>
        </div>
      )}

      {tab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: lang === 'bn' ? 'মোট অর্ডার' : 'Total Orders', val: orderStats.total, color: 'text-[#172033]' },
              { label: lang === 'bn' ? 'সম্পন্ন অর্ডার' : 'Completed Orders', val: orderStats.completed, color: 'text-[#16A34A]' },
              {
                label: t(lang, 'walletBalanceLabel'),
                val: `৳${(wallet?.availableBalanceBdt || 0).toFixed(0)}`,
                color: 'text-[#FF8500]',
              },
              {
                label: lang === 'bn' ? 'মোট ক্যাশব্যাক' : 'Cashback Earned',
                val: `৳${earningStats.cashbackEarned}`,
                color: 'text-[#16A34A]',
              },
              {
                label: lang === 'bn' ? 'রেফারেল আয়' : 'Referral Income',
                val: `৳${earningStats.referralEarned}`,
                color: 'text-[#FF8500]',
              },
              {
                label: lang === 'bn' ? 'অ্যাড রিওয়ার্ড' : 'Ad Rewards',
                val: `৳${earningStats.adRewardsEarned}`,
                color: 'text-[#172033]',
              },
              {
                label: lang === 'bn' ? 'মোট উইথড্র' : 'Total Withdrawn',
                val: `৳${earningStats.totalWithdrawn}`,
                color: 'text-[#172033]',
              },
              {
                label: lang === 'bn' ? 'পেন্ডিং অর্ডার' : 'Pending Orders',
                val: orderStats.pending,
                color: 'text-[#FF8500]',
              },
            ].map((kpi) => (
              <div key={kpi.label} className="dh-card rounded-2xl p-4">
                <p className="text-[11px] font-semibold text-[#777777]">{kpi.label}</p>
                <p className={`text-2xl font-extrabold font-mono-num mt-1 ${kpi.color}`}>{kpi.val}</p>
              </div>
            ))}
          </div>

          <div className="dh-card rounded-3xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-[#172033]">
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
              <p className="text-sm text-[#777777] py-6 text-center">
                {lang === 'bn' ? 'এখনো কোনো অর্ডার নেই।' : 'No orders placed yet.'}
              </p>
            ) : (
              <div className="space-y-2.5">
                {orders.slice(0, 5).map((ord) => (
                  <div
                    key={ord.id}
                    className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div>
                      <p className="text-sm font-bold text-[#172033]">
                        {lang === 'bn' ? ord.productTitleBn || ord.productTitleEn : ord.productTitleEn || ord.productTitleBn}
                        {ord.selectedPackageName ? (
                          <span className="ml-1.5 text-xs font-semibold text-[#FF8500]">
                            ({ord.selectedPackageName})
                          </span>
                        ) : null}
                      </p>
                      <p className="text-xs text-[#777777] font-mono-num">
                        #{ord.orderNumber} · {ord.paymentMethod.toUpperCase()} · {formatDateShort(ord.createdAt, lang)}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono-num font-extrabold text-sm text-[#FF8500]">৳{ord.totalPriceBdt}</span>
                      <span className="px-2.5 py-1 rounded-lg bg-white border border-[#E6ECFA] text-[11px] font-bold text-[#172033]">
                        {ord.status}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedOrder(ord)}
                        className="px-2.5 py-1 rounded-lg bg-[#172033] text-white text-[11px] font-bold flex items-center gap-1 hover:bg-[#FF8500] transition-colors"
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
                    ? `প্রতি ভেরিফায়েড রিওয়ার্ড ক্লেইমে ৳${settings.rewardedAdAmountBdt ?? 2} · দৈনিক সীমা: ${settings.rewardedAdDailyLimit ?? 5}টি · কুলডাউন: ${settings.rewardedAdCooldownMinutes ?? 5} মিনিট। (Google AdSense কখনোই রিওয়ার্ডেড হিসেবে ব্যবহার করা হয় না)`
                    : `Earn ৳${settings.rewardedAdAmountBdt ?? 2} per verified incentivized ad claim · Daily cap: ${settings.rewardedAdDailyLimit ?? 5} · Cooldown: ${settings.rewardedAdCooldownMinutes ?? 5}m. (Google AdSense is strictly excluded from incentivized clicks)`}
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
                  const todayStr = new Date().toISOString().slice(0, 10);
                  const todayCount = rewardClaims.filter((c) => c.claimDate === todayStr && c.status !== 'Rejected').length;
                  const limit = settings.rewardedAdDailyLimit ?? 5;
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

          <div className="dh-card rounded-3xl p-5 space-y-3">
            <h2 className="text-lg font-bold text-[#172033]">
              {lang === 'bn' ? 'নোটিফিকেশন ও পেমেন্ট স্ট্যাটাস' : 'Notifications & Alerts'}
            </h2>
            {notifications.length === 0 ? (
              <p className="text-sm text-[#777777] py-6 text-center">
                {lang === 'bn' ? 'কোনো নতুন বার্তা নেই।' : 'No notifications yet.'}
              </p>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.read && markNotificationRead(n.id)}
                  className={`p-3.5 rounded-2xl border cursor-pointer transition-colors ${
                    n.read ? 'bg-white border-[#E6ECFA]' : 'bg-[#FFF7EE] border-[#FF8500]/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-bold text-[#172033]">
                      {lang === 'bn' ? n.titleBn : n.titleEn}
                    </p>
                    <span className="text-[11px] text-[#777777]">{formatDateShort(n.createdAt, lang)}</span>
                  </div>
                  <p className="text-xs text-[#777777] mt-1">{lang === 'bn' ? n.messageBn : n.messageEn}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {tab === 'support' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <form onSubmit={handleTicketSubmit} className="dh-card rounded-3xl p-5 space-y-3">
            <h2 className="text-lg font-bold text-[#172033]">
              {lang === 'bn' ? 'নতুন সাপোর্ট টিকেট' : 'Submit Support Ticket'}
            </h2>
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
                <div key={tk.id} className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-[#172033]">{tk.subject}</span>
                    <span className="px-2 py-0.5 rounded-md bg-white text-[10px] font-bold uppercase text-[#FF8500]">
                      {tk.status}
                    </span>
                  </div>
                  <p className="text-xs text-[#777777]">{tk.message}</p>
                  {tk.adminReply && (
                    <p className="text-xs text-[#16A34A] font-semibold pt-1 border-t border-[#E6ECFA]">
                      Admin: {tk.adminReply}
                    </p>
                  )}
                </div>
              ))
            )}
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

            {/* Linked Sign-In Methods & Firebase Account Linking */}
            <div className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs font-extrabold text-[#172033] flex items-center gap-1.5">
                  <Link2 className="w-3.5 h-3.5 text-[#FF8500]" />
                  <span>{lang === 'bn' ? 'সংযুক্ত লগইন পদ্ধতি' : 'Linked Sign-In Methods'}</span>
                </p>
                {profile?.authMethod && (
                  <span className="text-[11px] font-bold text-[#777777]">
                    {lang === 'bn' ? 'মূল মাধ্যম:' : 'Primary:'}{' '}
                    <span className="text-[#172033] uppercase">{profile.authMethod}</span>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2 text-[11px] font-bold">
                <span
                  className={`px-2.5 py-1 rounded-lg border ${
                    hasGoogleLinked
                      ? 'bg-emerald-50 border-emerald-200 text-[#16A34A]'
                      : 'bg-white border-[#E6ECFA] text-[#777777]'
                  }`}
                >
                  {hasGoogleLinked ? '✓ Google' : '○ Google'}
                </span>
                <span
                  className={`px-2.5 py-1 rounded-lg border ${
                    hasPasswordLinked
                      ? 'bg-emerald-50 border-emerald-200 text-[#16A34A]'
                      : 'bg-white border-[#E6ECFA] text-[#777777]'
                  }`}
                >
                  {hasPasswordLinked
                    ? lang === 'bn'
                      ? '✓ ইমেইল ও পাসওয়ার্ড'
                      : '✓ Email & Password'
                    : lang === 'bn'
                      ? '○ পাসওয়ার্ড যুক্ত নয়'
                      : '○ No Password Linked'}
                </span>
                <span
                  className={`px-2.5 py-1 rounded-lg border inline-flex items-center gap-1 font-mono-num ${
                    profile?.phone && normalizeBangladeshPhoneClient(profile.phone)
                      ? 'bg-emerald-50 border-emerald-200 text-[#16A34A]'
                      : 'bg-white border-[#E6ECFA] text-[#777777]'
                  }`}
                >
                  <Phone className="w-3 h-3" />
                  <span>
                    {profile?.phone && normalizeBangladeshPhoneClient(profile.phone)
                      ? normalizeBangladeshPhoneClient(profile.phone)
                      : lang === 'bn'
                        ? 'ফোন যুক্ত নয়'
                        : 'No Phone Linked'}
                  </span>
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                {!hasGoogleLinked && (
                  <button
                    type="button"
                    disabled={linkingBusy}
                    onClick={handleLinkGoogleAccount}
                    className="px-3.5 py-2 rounded-xl bg-white border border-[#E6ECFA] hover:border-[#FF8500] text-[#172033] text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <Link2 className="w-3.5 h-3.5 text-[#FF8500]" />
                    <span>{lang === 'bn' ? 'Google অ্যাকাউন্ট লিংক করুন' : 'Link Google Account'}</span>
                  </button>
                )}
                {!hasPasswordLinked && (
                  <button
                    type="button"
                    disabled={linkingBusy}
                    onClick={() => setLinkPwdOpen((v) => !v)}
                    className="px-3.5 py-2 rounded-xl bg-white border border-[#E6ECFA] hover:border-[#FF8500] text-[#172033] text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-60"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-[#FF8500]" />
                    <span>{lang === 'bn' ? 'পাসওয়ার্ড যুক্ত করুন' : 'Add Digital Hub Password'}</span>
                  </button>
                )}
              </div>

              {linkPwdOpen && !hasPasswordLinked && (
                <form
                  onSubmit={handleLinkPasswordCredential}
                  className="pt-2 border-t border-[#DCE4F7] grid grid-cols-1 sm:grid-cols-2 gap-2.5"
                >
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={linkPwdValue}
                    onChange={(e) => setLinkPwdValue(e.target.value)}
                    placeholder={lang === 'bn' ? 'নতুন পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)' : 'New password (min 6 chars)'}
                    className="px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={linkPwdConfirm}
                    onChange={(e) => setLinkPwdConfirm(e.target.value)}
                    placeholder={lang === 'bn' ? 'পাসওয়ার্ড নিশ্চিত করুন' : 'Confirm password'}
                    className="px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs"
                  />
                  <div className="sm:col-span-2 flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={linkingBusy}
                      className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold disabled:opacity-60"
                    >
                      {linkingBusy ? '...' : lang === 'bn' ? 'পাসওয়ার্ড লিংক করুন' : 'Link Password'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLinkPwdOpen(false);
                        setLinkPwdValue('');
                        setLinkPwdConfirm('');
                      }}
                      className="px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#777777]"
                    >
                      {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                    </button>
                  </div>
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
                    await signOut(auth);
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
