import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Flag,
  Flame,
  Heart,
  MessageCircle,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import type {
  AppMetaPayload,
  AuthUser,
  CheckoutPaymentMethod,
  Language,
  PaymentMethodConfig,
  SiteSettings,
  UserProfile,
  WalletAccount,
} from '../types/marketplace';
import {
  buildMobileAppProductForOrder,
  getMobileAppCategoryMeta,
  MOBILE_APP_CATEGORIES,
  MOBILE_APP_DEVICE_PLANS,
  MOBILE_APPS_CATALOG,
  type MobileAppCategoryId,
  type MobileAppDevicePlan,
  type MobileAppItem,
} from '../lib/mobileAppsCatalog';
import {
  compressImageToDataUrl,
  fetchAppMeta,
  recordAppDownload,
  reportBrokenAppLink,
  submitAppReview,
  submitOrderWithManualPayment,
  submitOrderWithWalletBalance,
  subscribeMobileApps,
  toggleAppFavorite,
  validateTransactionIdServer,
} from '../lib/firestoreService';
import {
  getEnabledPaymentMethods,
  getPaymentMethodDetails,
  PaymentMethodCardsGrid,
  ReceiptScreenshotUploadBox,
  SelectedPaymentInstructionCard,
} from './PremiumPaymentSection';
import { PaymentProviderLogo } from './BrandLogos';
import { t } from '../lib/i18n';

interface MobileAppStoreSectionProps {
  mode: 'home' | 'page';
  lang: Language;
  settings: SiteSettings;
  paymentMethods?: PaymentMethodConfig[];
  user: AuthUser | null;
  profile: UserProfile | null;
  wallet: WalletAccount | null;
  onOpenAuth: () => void;
  onNavigateAll?: () => void;
  onBackHome?: () => void;
  onGoToOrders?: () => void;
}

interface CompletedMobileOrderSummary {
  orderNumber: string;
  appName: string;
  deviceLabel: string;
  quantity: number;
  totalPriceBdt: number;
  whatsapp: string;
  telegram: string;
  paymentMethod: CheckoutPaymentMethod;
  officialStoreUrl: string;
}

function buildWhatsAppPrefillUrl(baseLink: string | undefined, message: string): string {
  const cleanBase = (baseLink || 'https://wa.me/8801352838945').trim();
  const sep = cleanBase.includes('?') ? '&' : '?';
  return `${cleanBase}${sep}text=${encodeURIComponent(message)}`;
}

function getVisitorId(): string {
  try {
    const key = 'dh_visitor_id_v1';
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(key, created);
    return created;
  } catch {
    return 'v_anon';
  }
}

function getAppPlanPrice(app: MobileAppItem | null, plan: MobileAppDevicePlan): number {
  if (!app) return plan.priceBdt;
  if (plan.id === '1_device' && typeof app.price1DeviceBdt === 'number' && app.price1DeviceBdt > 0) {
    return app.price1DeviceBdt;
  }
  if (plan.id === '2_devices' && typeof app.price2DevicesBdt === 'number' && app.price2DevicesBdt > 0) {
    return app.price2DevicesBdt;
  }
  return plan.priceBdt;
}

function AppScreenshotPreview({
  app,
  imageUrl,
  size = 'card',
}: {
  app: MobileAppItem;
  imageUrl?: string;
  size?: 'card' | 'modal';
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = imageUrl || app.bannerImageUrl || app.screenUrl;

  useEffect(() => {
    setImgFailed(false);
  }, [src]);

  if (imgFailed) {
    return (
      <div className="w-full h-full bg-[#0F172A] flex flex-col items-center justify-center gap-2 p-4">
        <img
          src={app.iconUrl}
          alt={app.name}
          referrerPolicy="no-referrer"
          className="w-16 h-16 rounded-2xl object-cover shadow-md border border-white/15"
        />
        <span className="text-xs font-bold text-white/90">{app.name}</span>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full bg-[#0F172A] overflow-hidden select-none">
      {/* Ambient blurred backdrop from the app's own real screenshot */}
      <img
        src={src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setImgFailed(true)}
        className="absolute inset-0 w-full h-full object-cover scale-125 blur-xl opacity-45"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-[#0B1120]/80 via-[#0B1120]/25 to-[#0B1120]/30" />

      {/* Crisp uncropped official app preview centered cleanly */}
      <div
        className={`relative z-10 w-full h-full flex items-center justify-center ${
          size === 'modal' ? 'p-4' : 'p-2.5'
        }`}
      >
        <img
          src={src}
          alt={`${app.name} official mobile app preview`}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className={`max-h-full max-w-full object-contain rounded-xl shadow-[0_10px_28px_rgba(0,0,0,0.45)] border border-white/15 transition-transform duration-300 ${
            size === 'card' ? 'group-hover:scale-[1.03]' : ''
          }`}
        />
      </div>
    </div>
  );
}

export function MobileAppStoreSection({
  mode,
  lang,
  settings,
  paymentMethods,
  user,
  profile,
  wallet,
  onOpenAuth,
  onNavigateAll,
  onBackHome,
  onGoToOrders,
}: MobileAppStoreSectionProps) {
  const [liveApps, setLiveApps] = useState<MobileAppItem[]>(() => [...MOBILE_APPS_CATALOG]);
  const [appMeta, setAppMeta] = useState<AppMetaPayload>({
    statsByApp: {},
    reviews: [],
    favoriteAppIds: [],
  });
  const [selectedCategory, setSelectedCategory] = useState<'all' | MobileAppCategoryId>('all');
  const [discoveryFilter, setDiscoveryFilter] = useState<
    'all' | 'latest' | 'popular' | 'trending' | 'updated' | 'favorites'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedHome, setExpandedHome] = useState(false);

  // Active modals & Smart Store interaction state
  const [detailsApp, setDetailsApp] = useState<MobileAppItem | null>(null);
  const [detailsPlanId, setDetailsPlanId] = useState<'1_device' | '2_devices'>('1_device');
  const [activeScreenshot, setActiveScreenshot] = useState<string>('');
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewFeedback, setReviewFeedback] = useState('');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportBusy, setReportBusy] = useState(false);
  const [reportDone, setReportDone] = useState('');

  const [orderApp, setOrderApp] = useState<MobileAppItem | null>(null);
  const [orderPlanId, setOrderPlanId] = useState<'1_device' | '2_devices'>('1_device');
  const [orderQty, setOrderQty] = useState(1);
  const [whatsappInput, setWhatsappInput] = useState('');
  const [telegramInput, setTelegramInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<CheckoutPaymentMethod>('bkash');
  const [senderNumber, setSenderNumber] = useState('');
  const [txId, setTxId] = useState('');
  const [receiptDataUrl, setReceiptDataUrl] = useState('');
  const [copiedPayNum, setCopiedPayNum] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [completedOrder, setCompletedOrder] = useState<CompletedMobileOrderSummary | null>(null);

  useEffect(() => {
    const unsub = subscribeMobileApps((apps) => {
      setLiveApps(apps);
    }, false);
    return () => unsub();
  }, []);

  useEffect(() => {
    let active = true;
    fetchAppMeta()
      .then((m) => {
        if (active) setAppMeta(m);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [user?.uid]);

  const enabledManualMethods = useMemo(
    () => getEnabledPaymentMethods(settings, paymentMethods),
    [settings, paymentMethods]
  );

  // Ensure selected manual method is enabled
  useEffect(() => {
    if (paymentMethod === 'wallet') return;
    if (!enabledManualMethods.includes(paymentMethod)) {
      setPaymentMethod(enabledManualMethods[0] || 'wallet');
    }
  }, [enabledManualMethods, paymentMethod]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: liveApps.length };
    for (const app of liveApps) {
      counts[app.category] = (counts[app.category] || 0) + 1;
    }
    return counts;
  }, [liveApps]);

  const favoriteSet = useMemo(() => new Set(appMeta.favoriteAppIds || []), [appMeta.favoriteAppIds]);

  const filteredApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = liveApps.filter((app) => {
      if (selectedCategory !== 'all' && app.category !== selectedCategory) return false;
      if (discoveryFilter === 'favorites' && !favoriteSet.has(app.id)) return false;
      if (discoveryFilter === 'popular') {
        const dl = appMeta.statsByApp[app.id]?.downloads || 0;
        if (!app.popular && !app.featured && dl === 0) return false;
      }
      if (discoveryFilter === 'trending' && !app.trending && !app.featured) return false;
      if (!q) return true;
      const cat = getMobileAppCategoryMeta(app.category);
      const haystack = [
        app.name,
        app.developer,
        app.shortDescBn,
        app.shortDescEn,
        cat.labelBn,
        cat.labelEn,
        app.slug,
        app.version || '',
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });

    if (discoveryFilter === 'popular') {
      return [...list].sort(
        (a, b) =>
          (appMeta.statsByApp[b.id]?.downloads || 0) - (appMeta.statsByApp[a.id]?.downloads || 0) ||
          Number(Boolean(b.popular)) - Number(Boolean(a.popular))
      );
    }
    if (discoveryFilter === 'updated' || discoveryFilter === 'latest') {
      return [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    }
    if (discoveryFilter === 'trending') {
      return [...list].sort(
        (a, b) =>
          Number(Boolean(b.trending)) - Number(Boolean(a.trending)) ||
          (appMeta.statsByApp[b.id]?.downloads || 0) - (appMeta.statsByApp[a.id]?.downloads || 0)
      );
    }
    return list;
  }, [liveApps, selectedCategory, discoveryFilter, searchQuery, favoriteSet, appMeta.statsByApp]);

  const isHomeCompact =
    mode === 'home' &&
    !expandedHome &&
    selectedCategory === 'all' &&
    discoveryFilter === 'all' &&
    searchQuery.trim() === '';
  const visibleApps = isHomeCompact ? filteredApps.slice(0, 12) : filteredApps;

  const activeOrderPlan: MobileAppDevicePlan =
    MOBILE_APP_DEVICE_PLANS.find((p) => p.id === orderPlanId) || MOBILE_APP_DEVICE_PLANS[0];
  const activeDetailsPlan: MobileAppDevicePlan =
    MOBILE_APP_DEVICE_PLANS.find((p) => p.id === detailsPlanId) || MOBILE_APP_DEVICE_PLANS[0];

  const activeOrderUnitPrice = getAppPlanPrice(orderApp, activeOrderPlan);
  const activeDetailsPrice = getAppPlanPrice(detailsApp, activeDetailsPlan);
  const totalCostBdt = activeOrderUnitPrice * orderQty;
  const walletBalance = wallet?.availableBalanceBdt || 0;
  const walletSufficient = walletBalance >= totalCostBdt;

  const activePaymentMeta = getPaymentMethodDetails(
    paymentMethod === 'wallet' ? 'bkash' : paymentMethod,
    settings,
    paymentMethods
  );
  const receiverNumber = activePaymentMeta.number || '';

  const openDetails = (app: MobileAppItem, defaultPlan: '1_device' | '2_devices' = '1_device') => {
    setDetailsApp(app);
    setDetailsPlanId(defaultPlan);
    setActiveScreenshot(app.bannerImageUrl || app.screenUrl);
    setReviewFeedback('');
    setReportOpen(false);
    setReportReason('');
    setReportDone('');
  };

  const openOrderModal = (app: MobileAppItem, defaultPlan: '1_device' | '2_devices' = '1_device') => {
    setDetailsApp(null);
    setOrderApp(app);
    setOrderPlanId(defaultPlan);
    setOrderQty(1);
    setOrderError('');
    setCompletedOrder(null);
    setReceiptDataUrl('');
    setTxId('');
    setNoteInput('');
    if (!whatsappInput && (profile?.phone || user?.phone)) {
      setWhatsappInput(profile?.phone || user?.phone || '');
    }
  };

  const handleCopyPayNumber = () => {
    navigator.clipboard.writeText(receiverNumber).catch(() => {});
    setCopiedPayNum(true);
    setTimeout(() => setCopiedPayNum(false), 1800);
  };

  const handleToggleFavorite = async (appId: string) => {
    if (!user) {
      onOpenAuth();
      return;
    }
    try {
      const res = await toggleAppFavorite(appId);
      setAppMeta((prev) => ({ ...prev, favoriteAppIds: res.favoriteAppIds }));
    } catch {
      // Non-fatal
    }
  };

  const handleTrackDownload = (app: MobileAppItem) => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
    recordAppDownload({
      appId: app.id,
      appName: app.name,
      visitorId: getVisitorId(),
      deviceType: isMobile ? 'mobile' : 'desktop',
    }).then((count) => {
      if (count > 0) {
        setAppMeta((prev) => ({
          ...prev,
          statsByApp: {
            ...prev.statsByApp,
            [app.id]: {
              downloads: count,
              ratingAvg: prev.statsByApp[app.id]?.ratingAvg || 0,
              ratingCount: prev.statsByApp[app.id]?.ratingCount || 0,
            },
          },
        }));
      }
    });
  };

  const handleSubmitAppReview = async (e: FormEvent) => {
    e.preventDefault();
    if (!detailsApp) return;
    if (!user) {
      onOpenAuth();
      return;
    }
    setReviewBusy(true);
    setReviewFeedback('');
    try {
      const review = await submitAppReview({
        appId: detailsApp.id,
        rating: reviewRating,
        comment: reviewComment,
      });
      setReviewComment('');
      setReviewFeedback(lang === 'bn' ? 'আপনার রিভিউ যুক্ত হয়েছে!' : 'Thank you! Your review has been posted.');
      const nextReviews = [review, ...appMeta.reviews.filter((r) => r.id !== review.id)];
      const appRevs = nextReviews.filter((r) => r.appId === detailsApp.id);
      const avg = appRevs.length ? Number((appRevs.reduce((s, r) => s + r.rating, 0) / appRevs.length).toFixed(1)) : reviewRating;
      setAppMeta((prev) => ({
        ...prev,
        reviews: nextReviews,
        statsByApp: {
          ...prev.statsByApp,
          [detailsApp.id]: {
            downloads: prev.statsByApp[detailsApp.id]?.downloads || 0,
            ratingAvg: avg,
            ratingCount: appRevs.length,
          },
        },
      }));
    } catch (err) {
      setReviewFeedback(err instanceof Error ? err.message : 'Failed to post review.');
    } finally {
      setReviewBusy(false);
    }
  };

  const handleSubmitBrokenReport = async (e: FormEvent) => {
    e.preventDefault();
    if (!detailsApp) return;
    setReportBusy(true);
    try {
      await reportBrokenAppLink({
        appId: detailsApp.id,
        appName: detailsApp.name,
        reason: reportReason || 'Broken download or store link',
      });
      setReportDone(
        lang === 'bn'
          ? 'রিপোর্ট গৃহীত হয়েছে। অ্যাডমিন শীঘ্রই লিংক যাচাই করবেন।'
          : 'Report submitted. Our admin team will check this link shortly.'
      );
      setReportReason('');
      setReportOpen(false);
    } catch {
      setReportDone(lang === 'bn' ? 'রিপোর্ট পাঠানো যায়নি।' : 'Could not submit report.');
    } finally {
      setReportBusy(false);
    }
  };

  const handleReceiptUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageToDataUrl(file);
      setReceiptDataUrl(dataUrl);
    } catch {
      setOrderError(
        lang === 'bn' ? 'রিসিপ্ট ছবি প্রসেস করা যায়নি।' : 'Failed to process receipt screenshot.'
      );
    }
  };

  const handleSubmitMobileAppOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!orderApp) return;
    setOrderError('');

    const cleanWhatsapp = whatsappInput.trim();
    const cleanTelegram = telegramInput.trim();

    if (!cleanWhatsapp && !cleanTelegram) {
      setOrderError(
        lang === 'bn'
          ? 'অর্ডার করতে আপনার WhatsApp নম্বর অথবা Telegram Username/ID — যেকোনো একটি অবশ্যই দিন।'
          : 'Please provide either your WhatsApp number or Telegram Username/ID (at least one is required).'
      );
      return;
    }

    if (cleanWhatsapp) {
      const digits = cleanWhatsapp.replace(/\D/g, '');
      if (digits.length < 8 || digits.length > 15) {
        setOrderError(
          lang === 'bn'
            ? 'সঠিক WhatsApp নম্বর দিন (কমপক্ষে ৮-১৫ ডিজিট)।'
            : 'Please enter a valid WhatsApp number (8-15 digits).'
        );
        return;
      }
    }

    if (cleanTelegram && cleanTelegram.replace(/^@/, '').length < 3) {
      setOrderError(
        lang === 'bn'
          ? 'সঠিক Telegram Username বা Numeric ID দিন।'
          : 'Please enter a valid Telegram username or ID.'
      );
      return;
    }

    if (!user) {
      onOpenAuth();
      return;
    }

    const { product, pkg } = buildMobileAppProductForOrder(orderApp, {
      ...activeOrderPlan,
      priceBdt: activeOrderUnitPrice,
    });

    const deliveryLines = [
      `Store: Mobile App Store (Android Only)`,
      `App: ${orderApp.name}`,
      `Package: ${activeOrderPlan.labelEn} (৳${activeOrderUnitPrice}) × ${orderQty} = ৳${totalCostBdt}`,
      cleanWhatsapp ? `WhatsApp: ${cleanWhatsapp}` : null,
      cleanTelegram ? `Telegram: ${cleanTelegram}` : null,
      `Official Source: ${orderApp.officialStoreUrl}`,
      noteInput.trim() ? `Note: ${noteInput.trim()}` : null,
    ].filter(Boolean);

    const deliveryNote = deliveryLines.join(' | ');

    setSubmitting(true);
    try {
      let orderNumber = '';
      if (paymentMethod === 'wallet') {
        if (!wallet || wallet.availableBalanceBdt < totalCostBdt) {
          throw new Error(
            lang === 'bn'
              ? 'পর্যাপ্ত ভেরিফায়েড ওয়ালেট ব্যালেন্স নেই। bKash/Nagad/Rocket ব্যবহার করুন।'
              : 'Insufficient verified wallet balance. Please use bKash/Nagad/Rocket.'
          );
        }
        const res = await submitOrderWithWalletBalance({
          customerId: user.uid,
          customerEmail: user.phone || user.email || '',
          customerName: profile?.displayName || user.displayName || 'Customer',
          wallet,
          items: [{ product, quantity: orderQty, selectedPackage: pkg }],
          totalPriceBdt: totalCostBdt,
          deliveryNote,
        });
        orderNumber = res.orderNumber;
      } else {
        const cleanTx = await validateTransactionIdServer({
          transactionId: txId,
          senderNumber: senderNumber.trim(),
          method: paymentMethod,
        });
        const res = await submitOrderWithManualPayment({
          customerId: user.uid,
          customerEmail: user.phone || user.email || '',
          customerName: profile?.displayName || user.displayName || 'Customer',
          items: [{ product, quantity: orderQty, selectedPackage: pkg }],
          totalPriceBdt: totalCostBdt,
          method: paymentMethod,
          receiverNumber,
          senderNumber: senderNumber.trim(),
          transactionId: cleanTx,
          deliveryNote,
          receiptDataUrl,
        });
        orderNumber = res.orderNumber;
      }

      setCompletedOrder({
        orderNumber,
        appName: orderApp.name,
        deviceLabel: lang === 'bn' ? activeOrderPlan.labelBn : activeOrderPlan.labelEn,
        quantity: orderQty,
        totalPriceBdt: totalCostBdt,
        whatsapp: cleanWhatsapp,
        telegram: cleanTelegram,
        paymentMethod,
        officialStoreUrl: orderApp.officialStoreUrl,
      });
    } catch (err) {
      setOrderError(
        err instanceof Error
          ? err.message
          : lang === 'bn'
            ? 'অর্ডার জমা দিতে সমস্যা হয়েছে।'
            : 'Failed to submit order.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const completedOrderText = useMemo(() => {
    if (!completedOrder) return '';
    return [
      `DIGITAL HUB — Mobile App Store Order`,
      `Order ID: #${completedOrder.orderNumber}`,
      `App Name: ${completedOrder.appName} (Android)`,
      `Package: ${completedOrder.deviceLabel} × ${completedOrder.quantity}`,
      `Total Price: ৳${completedOrder.totalPriceBdt}`,
      completedOrder.whatsapp ? `WhatsApp: ${completedOrder.whatsapp}` : null,
      completedOrder.telegram ? `Telegram: ${completedOrder.telegram}` : null,
      `Payment: ${completedOrder.paymentMethod.toUpperCase()}`,
    ]
      .filter(Boolean)
      .join('\n');
  }, [completedOrder]);

  const handleCopySummary = () => {
    if (!completedOrderText) return;
    navigator.clipboard.writeText(completedOrderText).catch(() => {});
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 1800);
  };

  const wrapperClass =
    mode === 'page'
      ? 'max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-6'
      : 'space-y-5';

  return (
    <section aria-label="Mobile App Store" className={wrapperClass}>
      {/* Section Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          {mode === 'page' && onBackHome && (
            <button
              type="button"
              onClick={onBackHome}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#64748B] dark:text-slate-400 hover:text-[#FF8500] transition-colors mb-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'হোম পেজে ফিরুন' : 'Back to Home'}</span>
            </button>
          )}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#172033] dark:bg-[#FF8500] text-white flex items-center justify-center shrink-0 shadow-xs">
              <Smartphone className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-extrabold text-[#172033] dark:text-slate-50 tracking-tight leading-tight">
                Mobile App Store
              </h2>
              <p className="text-xs sm:text-sm text-[#64748B] dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span>{lang === 'bn' ? 'শুধুমাত্র Android / Mobile অ্যাপস' : 'Android / Mobile Apps Only'}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num tabular-nums">
                  {liveApps.length} {lang === 'bn' ? 'টি অ্যাপ' : 'Apps'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="font-semibold text-[#172033] dark:text-slate-200 font-mono-num tabular-nums">
                  {lang === 'bn' ? '১ ডিভাইস ৳50 / ২ ডিভাইস ৳70' : '1 Device ৳50 / 2 Devices ৳70'}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Search Input + View All CTA on Home */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={
                lang === 'bn'
                  ? 'অ্যাপ খুঁজুন (যেমন: CapCut, Remini, Spotify)...'
                  : 'Search mobile apps (CapCut, Remini, Spotify)...'
              }
              aria-label="Search Mobile App Store"
              className="w-full pl-10 pr-9 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-700 text-xs sm:text-sm text-[#172033] dark:text-slate-100 placeholder:text-[#94A3B8] focus:outline-none focus:border-[#FF8500] transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-[#64748B] hover:text-[#172033] dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {mode === 'home' && onNavigateAll && (
            <button
              type="button"
              onClick={onNavigateAll}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-[#172033] dark:bg-slate-800 hover:bg-[#FF8500] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <span>{lang === 'bn' ? `সব ${liveApps.length}টি অ্যাপ` : `All ${liveApps.length} Apps`}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Discovery Quick Filters (Latest, Popular, Trending, Recently Updated, Favorites) */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        {(
          [
            { id: 'all', bn: 'সব ডিসকভারি', en: 'Discover All', icon: Sparkles },
            { id: 'latest', bn: 'সর্বশেষ (Latest)', en: 'Latest', icon: Sparkles },
            { id: 'popular', bn: 'জনপ্রিয় (Popular)', en: 'Popular', icon: Flame },
            { id: 'trending', bn: 'ট্রেন্ডিং', en: 'Trending', icon: TrendingUp },
            { id: 'updated', bn: 'সাম্প্রতিক আপডেট', en: 'Recently Updated', icon: CheckCircle2 },
            { id: 'favorites', bn: `পছন্দের (${appMeta.favoriteAppIds.length})`, en: `Favorites (${appMeta.favoriteAppIds.length})`, icon: Heart },
          ] as const
        ).map((df) => {
          const Icon = df.icon;
          const active = discoveryFilter === df.id;
          return (
            <button
              key={df.id}
              type="button"
              onClick={() => setDiscoveryFilter(df.id)}
              className={`min-h-[34px] px-3 py-1.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-[#172033] dark:bg-[#FF8500] text-white shadow-xs'
                  : 'bg-[#F8FAFF] dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-800 text-[#475569] dark:text-slate-300 hover:border-[#FF8500]'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${df.id === 'favorites' && active ? 'fill-current' : ''}`} />
              <span>{lang === 'bn' ? df.bn : df.en}</span>
            </button>
          );
        })}
      </div>

      {/* Interactive Category Filter Bar */}
      <div
        role="tablist"
        aria-label="Mobile App Categories"
        className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none"
      >
        <button
          type="button"
          role="tab"
          aria-selected={selectedCategory === 'all'}
          onClick={() => setSelectedCategory('all')}
          className={`min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
            selectedCategory === 'all'
              ? 'bg-[#FF8500] text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-800 text-[#475569] dark:text-slate-300 hover:border-[#FF8500] hover:text-[#172033] dark:hover:text-white'
          }`}
        >
          {lang === 'bn' ? 'সব অ্যাপ' : 'All Apps'}{' '}
          <span className="font-mono-num tabular-nums opacity-85">({categoryCounts.all})</span>
        </button>

        {MOBILE_APP_CATEGORIES.map((cat) => {
          const active = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelectedCategory(cat.id)}
              className={`min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-[#FF8500] text-white shadow-xs'
                  : 'bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-800 text-[#475569] dark:text-slate-300 hover:border-[#FF8500] hover:text-[#172033] dark:hover:text-white'
              }`}
            >
              {lang === 'bn' ? cat.labelBn : cat.labelEn}{' '}
              <span className="font-mono-num tabular-nums opacity-85">
                ({categoryCounts[cat.id] || 0})
              </span>
            </button>
          );
        })}
      </div>

      {/* Results Count Line when filtering */}
      {(selectedCategory !== 'all' || discoveryFilter !== 'all' || searchQuery.trim() !== '') && (
        <div className="flex items-center justify-between gap-2 text-xs text-[#64748B] dark:text-slate-400">
          <p className="font-medium">
            {lang === 'bn'
              ? `মোট ${filteredApps.length}টি Android অ্যাপ পাওয়া গেছে`
              : `Showing ${filteredApps.length} Android mobile apps`}
          </p>
          <button
            type="button"
            onClick={() => {
              setSelectedCategory('all');
              setDiscoveryFilter('all');
              setSearchQuery('');
            }}
            className="text-[#FF8500] font-bold hover:underline cursor-pointer"
          >
            {lang === 'bn' ? 'ফিল্টার রিসেট' : 'Reset Filters'}
          </button>
        </div>
      )}

      {/* App Cards Grid */}
      {visibleApps.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-800 p-10 text-center space-y-3">
          <p className="text-sm font-bold text-[#172033] dark:text-slate-100">
            {discoveryFilter === 'favorites'
              ? lang === 'bn'
                ? 'আপনার ফেভারিট তালিকায় এখনো কোনো অ্যাপ নেই।'
                : 'No favorite apps saved yet.'
              : lang === 'bn'
                ? `"${searchQuery}" নামে কোনো মোবাইল অ্যাপ পাওয়া যায়নি।`
                : `No mobile apps matched "${searchQuery}".`}
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('all');
              setDiscoveryFilter('all');
            }}
            className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold cursor-pointer"
          >
            {lang === 'bn' ? 'সব অ্যাপ দেখুন' : `Show All ${liveApps.length} Apps`}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
          {visibleApps.map((app) => {
            const catMeta = getMobileAppCategoryMeta(app.category);
            const appStats = appMeta.statsByApp[app.id];
            const isFav = favoriteSet.has(app.id);
            return (
              <article
                key={app.id}
                className="group rounded-2xl bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-800 overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(23,32,51,0.09)] dark:hover:shadow-[0_14px_32px_rgba(0,0,0,0.45)]"
              >
                {/* Official App Screenshot Preview + Favorite Toggle */}
                <div className="relative aspect-[16/10] w-full overflow-hidden">
                  <button
                    type="button"
                    onClick={() => openDetails(app, '1_device')}
                    className="w-full h-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8500] cursor-pointer block"
                    aria-label={`${app.name} details`}
                  >
                    <AppScreenshotPreview app={app} size="card" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleFavorite(app.id)}
                    aria-label={isFav ? 'Remove from favorites' : 'Add to favorites'}
                    className={`absolute top-2.5 right-2.5 z-20 w-8 h-8 rounded-full flex items-center justify-center shadow-md transition-colors cursor-pointer ${
                      isFav
                        ? 'bg-rose-500 text-white'
                        : 'bg-[#0F172A]/75 text-white/90 hover:bg-rose-500'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                  </button>
                  {(app.trending || app.popular) && (
                    <span className="absolute top-2.5 left-2.5 z-20 px-2 py-0.5 rounded-md bg-[#FF8500] text-white text-[10px] font-extrabold uppercase tracking-wider shadow">
                      {app.trending ? 'Trending' : 'Popular'}
                    </span>
                  )}
                </div>

                {/* Card Body */}
                <div className="p-4 flex-1 flex flex-col justify-between gap-3.5">
                  <div className="space-y-2.5">
                    {/* Official App Icon + Name + Clean Unboxed Category Metadata */}
                    <div className="flex items-start gap-3">
                      <img
                        src={app.iconUrl}
                        alt={`${app.name} official logo`}
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                        className="w-11 h-11 rounded-xl object-cover border border-[#E2E9F7] dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0 shadow-xs"
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-extrabold text-[#172033] dark:text-slate-50 leading-snug truncate">
                          {app.name}
                        </h3>
                        <p className="text-[11px] font-medium text-[#64748B] dark:text-slate-400 truncate mt-0.5">
                          {lang === 'bn' ? catMeta.labelBn : catMeta.labelEn}
                          {app.version ? ` · v${app.version}` : ''}
                          {app.sizeLabel ? ` · ${app.sizeLabel}` : ''}
                        </p>
                        {(appStats?.downloads > 0 || appStats?.ratingCount > 0) && (
                          <div className="flex items-center gap-2.5 mt-1 text-[10px] font-mono-num font-bold text-[#475569] dark:text-slate-300">
                            {appStats.ratingCount > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[#FF8500]">
                                <Star className="w-3 h-3 fill-current" />
                                {appStats.ratingAvg.toFixed(1)} ({appStats.ratingCount})
                              </span>
                            )}
                            {appStats.downloads > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[#0EA5E9]">
                                <Download className="w-3 h-3" />
                                {appStats.downloads}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Short Factual Description */}
                    <p className="text-xs text-[#5C6B84] dark:text-slate-300 leading-relaxed line-clamp-2 min-h-[2.4rem]">
                      {lang === 'bn' ? app.shortDescBn : app.shortDescEn}
                    </p>
                  </div>

                  {/* Pricing Strip & Action Buttons */}
                  <div className="space-y-3 pt-2.5 border-t border-[#EDF2FA] dark:border-slate-800">
                    {/* Two Device Package Prices (Tabular Numerals) */}
                    <div className="grid grid-cols-2 gap-2">
                      {MOBILE_APP_DEVICE_PLANS.map((plan) => {
                        const unitPrice = getAppPlanPrice(app, plan);
                        return (
                          <button
                            key={plan.id}
                            type="button"
                            onClick={() => openOrderModal(app, plan.id)}
                            className="px-2.5 py-2 rounded-xl bg-[#F5F8FF] dark:bg-slate-800/80 hover:bg-[#FFF5EA] dark:hover:bg-orange-950/35 border border-[#E6ECFA] dark:border-slate-700/80 hover:border-[#FF8500]/60 text-left transition-colors cursor-pointer"
                          >
                            <span className="block text-[10px] font-semibold text-[#64748B] dark:text-slate-400 truncate">
                              {plan.devices === 1
                                ? lang === 'bn'
                                  ? '১ ডিভাইস'
                                  : '1 Device'
                                : lang === 'bn'
                                  ? '২ ডিভাইস'
                                  : '2 Devices'}
                            </span>
                            <span className="block text-sm font-extrabold font-mono-num tabular-nums text-[#FF8500] leading-tight mt-0.5">
                              ৳{unitPrice}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Details + Order Now Buttons */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => openDetails(app, '1_device')}
                        className="min-h-[40px] px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 hover:bg-[#E7EEFC] dark:hover:bg-slate-700 border border-[#E2E9F7] dark:border-slate-700 text-[#172033] dark:text-slate-100 text-xs font-bold whitespace-nowrap transition-colors cursor-pointer"
                      >
                        {lang === 'bn' ? 'বিস্তারিত' : 'Details'}
                      </button>
                      <button
                        type="button"
                        onClick={() => openOrderModal(app, '1_device')}
                        className="min-h-[40px] px-3 py-2 rounded-xl dh-orange-gradient hover:opacity-95 text-white text-xs font-extrabold whitespace-nowrap shadow-[0_6px_14px_rgba(255,133,0,0.24)] transition-opacity cursor-pointer"
                      >
                        {lang === 'bn' ? 'অর্ডার করুন' : 'Order Now'}
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Home Expand / Full Store Footer Bar */}
      {mode === 'home' && isHomeCompact && filteredApps.length > visibleApps.length && (
        <div className="flex flex-wrap items-center justify-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => setExpandedHome(true)}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-700 hover:border-[#FF8500] text-[#172033] dark:text-slate-100 text-xs sm:text-sm font-bold transition-colors cursor-pointer"
          >
            {lang === 'bn'
              ? `আরও ${filteredApps.length - visibleApps.length}টি অ্যাপ এখানেই দেখুন`
              : `Show All ${filteredApps.length} Apps Here`}
          </button>
          {onNavigateAll && (
            <button
              type="button"
              onClick={onNavigateAll}
              className="min-h-[44px] px-5 py-2.5 rounded-xl dh-orange-gradient text-white text-xs sm:text-sm font-extrabold inline-flex items-center gap-1.5 shadow-sm hover:opacity-95 transition-opacity cursor-pointer"
            >
              <span>{lang === 'bn' ? 'Mobile App Store পেজে যান' : 'Open Full Mobile App Store'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      )}

      {mode === 'home' && expandedHome && selectedCategory === 'all' && discoveryFilter === 'all' && searchQuery.trim() === '' && (
        <div className="flex justify-center pt-1">
          <button
            type="button"
            onClick={() => setExpandedHome(false)}
            className="min-h-[40px] px-4 py-2 rounded-xl bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-700 text-xs font-bold text-[#64748B] dark:text-slate-300 hover:text-[#172033] dark:hover:text-white cursor-pointer"
          >
            {lang === 'bn' ? 'সংক্ষিপ্ত ভিউতে ফিরুন' : 'Show Fewer Apps'}
          </button>
        </div>
      )}

      {/* ─── APP DETAILS MODAL ─────────────────────────────────────────── */}
      {detailsApp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`${detailsApp.name} Details`}
          className="fixed inset-0 z-50 bg-[#0F172A]/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
          onClick={() => setDetailsApp(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl border border-[#E2E9F7] dark:border-slate-800 shadow-2xl max-h-[92vh] flex flex-col overflow-hidden"
          >
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-[#EDF2FA] dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={detailsApp.iconUrl}
                  alt={`${detailsApp.name} logo`}
                  referrerPolicy="no-referrer"
                  className="w-11 h-11 rounded-xl object-cover border border-[#E2E9F7] dark:border-slate-700 bg-white shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="text-base sm:text-lg font-extrabold text-[#172033] dark:text-slate-50 truncate">
                    {detailsApp.name}
                  </h3>
                  <p className="text-xs text-[#64748B] dark:text-slate-400 truncate">
                    {detailsApp.developer} ·{' '}
                    {lang === 'bn'
                      ? getMobileAppCategoryMeta(detailsApp.category).labelBn
                      : getMobileAppCategoryMeta(detailsApp.category).labelEn}{' '}
                    · Android
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDetailsApp(null)}
                aria-label="Close modal"
                className="p-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 text-[#64748B] dark:text-slate-300 hover:text-[#172033] dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Large Official Preview + Multi-Screenshot Gallery */}
              <div className="space-y-2">
                <div className="relative h-60 sm:h-72 rounded-2xl overflow-hidden border border-[#E2E9F7] dark:border-slate-800">
                  <AppScreenshotPreview app={detailsApp} imageUrl={activeScreenshot} size="modal" />
                </div>
                {(() => {
                  const galleryUrls = Array.from(
                    new Set(
                      [detailsApp.bannerImageUrl || detailsApp.screenUrl, ...(detailsApp.screenshots || [])].filter(Boolean)
                    )
                  );
                  if (galleryUrls.length <= 1) return null;
                  return (
                    <div className="flex items-center gap-2 overflow-x-auto pb-1">
                      {galleryUrls.map((url, idx) => (
                        <button
                          key={url + idx}
                          type="button"
                          onClick={() => setActiveScreenshot(url)}
                          className={`w-16 h-12 rounded-xl overflow-hidden border-2 shrink-0 cursor-pointer ${
                            activeScreenshot === url ? 'border-[#FF8500]' : 'border-[#E2E9F7] dark:border-slate-700 opacity-75 hover:opacity-100'
                          }`}
                        >
                          <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Version, Size, Downloads, Ratings & Favorite Strip */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/70 border border-[#E2E9F7] dark:border-slate-700 text-xs">
                <div className="flex flex-wrap items-center gap-3 font-mono-num">
                  {detailsApp.version && (
                    <span className="font-bold text-[#172033] dark:text-slate-100">v{detailsApp.version}</span>
                  )}
                  {detailsApp.sizeLabel && (
                    <span className="text-[#64748B] dark:text-slate-300">{detailsApp.sizeLabel}</span>
                  )}
                  <span className="inline-flex items-center gap-1 text-[#0EA5E9] font-bold">
                    <Download className="w-3.5 h-3.5" />
                    {appMeta.statsByApp[detailsApp.id]?.downloads || 0} {lang === 'bn' ? 'ডাউনলোড' : 'downloads'}
                  </span>
                  <span className="inline-flex items-center gap-1 text-[#FF8500] font-bold">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    {(appMeta.statsByApp[detailsApp.id]?.ratingAvg || 0).toFixed(1)} ({appMeta.statsByApp[detailsApp.id]?.ratingCount || 0})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggleFavorite(detailsApp.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1 cursor-pointer ${
                      favoriteSet.has(detailsApp.id)
                        ? 'bg-rose-500 text-white'
                        : 'bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-700 text-[#172033] dark:text-slate-100'
                    }`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${favoriteSet.has(detailsApp.id) ? 'fill-current' : ''}`} />
                    <span>{favoriteSet.has(detailsApp.id) ? (lang === 'bn' ? 'সেভড' : 'Saved') : lang === 'bn' ? 'ফেভারিট' : 'Favorite'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setReportOpen((v) => !v)}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-700 text-xs font-bold text-[#64748B] hover:text-[#DC2626] inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Flag className="w-3.5 h-3.5" />
                    <span>{lang === 'bn' ? 'রিপোর্ট' : 'Report Link'}</span>
                  </button>
                </div>
              </div>

              {reportDone && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 text-[#16A34A] text-xs font-bold">
                  {reportDone}
                </div>
              )}

              {reportOpen && (
                <form
                  onSubmit={handleSubmitBrokenReport}
                  className="p-3.5 rounded-2xl bg-[#FFF7EE] dark:bg-slate-800/80 border border-[#FF8500]/35 space-y-2 text-xs"
                >
                  <p className="font-bold text-[#172033] dark:text-slate-100">
                    {lang === 'bn' ? 'ভাঙা ডাউনলোড/অফিশিয়াল লিংক রিপোর্ট করুন' : 'Report Broken Link or App Issue'}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      required
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value)}
                      placeholder={lang === 'bn' ? 'সমস্যার বিবরণ লিখুন...' : 'Describe issue (e.g. link not opening)...'}
                      className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-700 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={reportBusy}
                      className="px-4 py-2 rounded-xl bg-[#DC2626] text-white font-bold text-xs cursor-pointer disabled:opacity-60"
                    >
                      {reportBusy ? '...' : lang === 'bn' ? 'রিপোর্ট পাঠান' : 'Submit Report'}
                    </button>
                  </div>
                </form>
              )}

              {/* Description & Official Store Verification Link + Tracked Download CTA */}
              <div className="space-y-3">
                <p className="text-sm text-[#334155] dark:text-slate-200 leading-relaxed">
                  {lang === 'bn' ? detailsApp.shortDescBn : detailsApp.shortDescEn}
                </p>

                <ul className="space-y-2 text-xs sm:text-sm text-[#475569] dark:text-slate-300">
                  {(lang === 'bn' ? detailsApp.featuresBn : detailsApp.featuresEn).map((feat) => (
                    <li key={feat} className="flex items-start gap-2 leading-snug">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{feat}</span>
                    </li>
                  ))}
                </ul>

                <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <a
                    href={detailsApp.downloadUrl || detailsApp.officialStoreUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleTrackDownload(detailsApp)}
                    className="px-4 py-2 rounded-xl bg-[#16A34A] hover:bg-[#15803D] text-white font-bold inline-flex items-center gap-1.5 shadow-xs"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{lang === 'bn' ? 'অ্যাপ ডাউনলোড / ইনস্টল করুন' : 'Download / Install App'}</span>
                  </a>
                  <a
                    href={detailsApp.officialStoreUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 font-bold text-[#0EA5E9] hover:underline"
                  >
                    <span>
                      {detailsApp.officialStoreLabel === 'Google Play'
                        ? lang === 'bn'
                          ? 'Google Play-তে অফিশিয়াল অ্যাপ দেখুন'
                          : 'View Official Listing on Google Play'
                        : lang === 'bn'
                          ? 'অফিশিয়াল ওয়েবসাইট দেখুন'
                          : 'Visit Official App Website'}
                    </span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>
              </div>

              {/* Select Device Package inside Details */}
              <div className="space-y-2.5 pt-2 border-t border-[#EDF2FA] dark:border-slate-800">
                <p className="text-xs font-extrabold text-[#172033] dark:text-slate-100">
                  {lang === 'bn' ? 'ডিভাইস প্যাকেজ নির্বাচন করুন' : 'Select Device Package'}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {MOBILE_APP_DEVICE_PLANS.map((plan) => {
                    const selected = detailsPlanId === plan.id;
                    const unitPrice = getAppPlanPrice(detailsApp, plan);
                    return (
                      <button
                        key={plan.id}
                        type="button"
                        onClick={() => setDetailsPlanId(plan.id)}
                        className={`p-3.5 rounded-2xl border text-left transition-all flex items-center justify-between gap-3 cursor-pointer ${
                          selected
                            ? 'border-[#FF8500] bg-[#FFF7EE] dark:bg-orange-950/30 ring-2 ring-[#FF8500]/20'
                            : 'border-[#E2E9F7] dark:border-slate-700 bg-[#F8FAFF] dark:bg-slate-800/70 hover:border-[#FF8500]/50'
                        }`}
                      >
                        <div>
                          <p className="text-sm font-bold text-[#172033] dark:text-slate-100">
                            {lang === 'bn' ? plan.labelBn : plan.labelEn}
                          </p>
                          <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5">
                            {plan.devices === 1
                              ? lang === 'bn'
                                ? '১টি Android মোবাইলের জন্য'
                                : 'For 1 Android mobile device'
                              : lang === 'bn'
                                ? '২টি Android মোবাইলের জন্য'
                                : 'For 2 Android mobile devices'}
                          </p>
                        </div>
                        <span className="text-xl font-extrabold font-mono-num tabular-nums text-[#FF8500] shrink-0">
                          ৳{unitPrice}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* App Ratings & Community Reviews */}
              <div className="space-y-3 pt-3 border-t border-[#EDF2FA] dark:border-slate-800">
                <p className="text-xs font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
                  <Star className="w-4 h-4 text-[#FF8500] fill-current" />
                  <span>{lang === 'bn' ? 'রেটিং ও ইউজার রিভিউ' : 'Ratings & User Reviews'}</span>
                </p>

                <form onSubmit={handleSubmitAppReview} className="p-3.5 rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/70 border border-[#E2E9F7] dark:border-slate-700 space-y-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[#172033] dark:text-slate-100">
                      {lang === 'bn' ? 'আপনার রেটিং দিন:' : 'Rate this app:'}
                    </span>
                    <div className="flex items-center gap-1">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          type="button"
                          onClick={() => setReviewRating(star)}
                          className={`p-1 cursor-pointer ${star <= reviewRating ? 'text-[#FF8500]' : 'text-slate-300 dark:text-slate-600'}`}
                        >
                          <Star className="w-4 h-4 fill-current" />
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      required
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      placeholder={lang === 'bn' ? 'এই অ্যাপ সম্পর্কে আপনার মতামত লিখুন...' : 'Write a short review...'}
                      className="flex-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-700 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={reviewBusy}
                      className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold text-xs cursor-pointer disabled:opacity-60"
                    >
                      {reviewBusy ? '...' : lang === 'bn' ? 'পোস্ট করুন' : 'Post Review'}
                    </button>
                  </div>
                  {reviewFeedback && (
                    <p className="text-[11px] font-semibold text-[#16A34A]">{reviewFeedback}</p>
                  )}
                </form>

                {(() => {
                  const appReviews = appMeta.reviews.filter((r) => r.appId === detailsApp.id);
                  if (appReviews.length === 0) {
                    return (
                      <p className="text-xs text-[#64748B] dark:text-slate-400">
                        {lang === 'bn' ? 'এখনো কোনো রিভিউ নেই — প্রথম রিভিউ দিন!' : 'No reviews yet — be the first to rate this app!'}
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-2">
                      {appReviews.slice(0, 6).map((rev) => (
                        <div
                          key={rev.id}
                          className="p-3 rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/60 border border-[#E2E9F7] dark:border-slate-700 space-y-1 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-[#172033] dark:text-slate-100">{rev.authorName}</span>
                            <span className="inline-flex items-center gap-0.5 text-[#FF8500] font-bold">
                              <Star className="w-3 h-3 fill-current" />
                              {rev.rating}/5
                            </span>
                          </div>
                          <p className="text-[#475569] dark:text-slate-300">{rev.comment}</p>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-4 border-t border-[#EDF2FA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-900/90 flex items-center justify-between gap-3">
              <div>
                <span className="block text-[11px] text-[#64748B] dark:text-slate-400">
                  {lang === 'bn' ? activeDetailsPlan.labelBn : activeDetailsPlan.labelEn}
                </span>
                <span className="text-xl font-extrabold font-mono-num tabular-nums text-[#FF8500]">
                  ৳{activeDetailsPrice}
                </span>
              </div>
              <button
                type="button"
                onClick={() => openOrderModal(detailsApp, detailsPlanId)}
                className="min-h-[44px] px-6 py-2.5 rounded-xl dh-orange-gradient text-white text-sm font-extrabold inline-flex items-center gap-2 shadow-md hover:opacity-95 cursor-pointer"
              >
                <ShieldCheck className="w-4 h-4" />
                <span>
                  {lang === 'bn'
                    ? `অর্ডার করুন · ৳${activeDetailsPrice}`
                    : `Order Now · ৳${activeDetailsPrice}`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── MOBILE APP ORDER MODAL ────────────────────────────────────── */}
      {orderApp && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Order ${orderApp.name}`}
          className="fixed inset-0 z-50 bg-[#0F172A]/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
          onClick={() => setOrderApp(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl border border-[#E2E9F7] dark:border-slate-800 shadow-2xl max-h-[92vh] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-[#EDF2FA] dark:border-slate-800 bg-[#FFF7EE] dark:bg-slate-800/70 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src={orderApp.iconUrl}
                  alt={orderApp.name}
                  referrerPolicy="no-referrer"
                  className="w-10 h-10 rounded-xl object-cover border border-[#E2E9F7] dark:border-slate-700 bg-white shrink-0"
                />
                <div className="min-w-0">
                  <h3 className="text-base font-extrabold text-[#172033] dark:text-slate-50 truncate">
                    {lang === 'bn' ? `${orderApp.name} — অর্ডার ফর্ম` : `Order ${orderApp.name}`}
                  </h3>
                  <p className="text-xs text-[#64748B] dark:text-slate-400 truncate">
                    Mobile App Store · Android Only
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOrderApp(null)}
                aria-label="Close order modal"
                className="p-2 rounded-xl bg-white dark:bg-slate-800 border border-[#E2E9F7] dark:border-slate-700 text-[#64748B] dark:text-slate-300 hover:text-[#172033] dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-5">
              {completedOrder ? (
                <div className="space-y-5 py-2">
                  <div className="text-center space-y-2">
                    <div className="w-14 h-14 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                      <CheckCircle2 className="w-8 h-8" />
                    </div>
                    <h4 className="text-xl font-extrabold text-[#172033] dark:text-slate-50">
                      {lang === 'bn' ? 'অর্ডার সফলভাবে জমা হয়েছে!' : 'Order Submitted Successfully!'}
                    </h4>
                    <p className="text-sm font-mono-num font-bold text-[#FF8500]">
                      #{completedOrder.orderNumber}
                    </p>
                  </div>

                  {/* Full Order Details Summary */}
                  <div className="rounded-2xl bg-[#F5F8FF] dark:bg-slate-800/80 border border-[#E2E9F7] dark:border-slate-700 p-4 space-y-2.5 text-xs sm:text-sm">
                    <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E2E9F7] dark:border-slate-700">
                      <span className="font-extrabold text-[#172033] dark:text-slate-100">
                        {lang === 'bn' ? 'সম্পূর্ণ অর্ডার বিবরণ' : 'Complete Order Details'}
                      </span>
                      <button
                        type="button"
                        onClick={handleCopySummary}
                        className="inline-flex items-center gap-1 text-xs font-bold text-[#FF8500] hover:underline cursor-pointer"
                      >
                        {copiedSummary ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>
                          {copiedSummary
                            ? lang === 'bn'
                              ? 'কপি হয়েছে'
                              : 'Copied'
                            : lang === 'bn'
                              ? 'বিবরণ কপি করুন'
                              : 'Copy Summary'}
                        </span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="flex justify-between sm:block">
                        <span className="text-[#64748B] dark:text-slate-400">
                          {lang === 'bn' ? 'অ্যাপের নাম' : 'App Name'}
                        </span>
                        <p className="font-bold text-[#172033] dark:text-slate-100">
                          {completedOrder.appName} (Android)
                        </p>
                      </div>
                      <div className="flex justify-between sm:block">
                        <span className="text-[#64748B] dark:text-slate-400">
                          {lang === 'bn' ? 'ডিভাইস প্যাকেজ' : 'Device Package'}
                        </span>
                        <p className="font-bold text-[#172033] dark:text-slate-100">
                          {completedOrder.deviceLabel} × {completedOrder.quantity}
                        </p>
                      </div>
                      <div className="flex justify-between sm:block">
                        <span className="text-[#64748B] dark:text-slate-400">
                          {lang === 'bn' ? 'মোট মূল্য' : 'Total Price'}
                        </span>
                        <p className="font-extrabold font-mono-num tabular-nums text-[#FF8500]">
                          ৳{completedOrder.totalPriceBdt}
                        </p>
                      </div>
                      <div className="flex justify-between sm:block">
                        <span className="text-[#64748B] dark:text-slate-400">
                          {lang === 'bn' ? 'পেমেন্ট মাধ্যম' : 'Payment Method'}
                        </span>
                        <p className="font-bold uppercase text-[#172033] dark:text-slate-100">
                          {completedOrder.paymentMethod}
                        </p>
                      </div>
                      {completedOrder.whatsapp && (
                        <div className="flex justify-between sm:block">
                          <span className="text-[#64748B] dark:text-slate-400">WhatsApp</span>
                          <p className="font-bold font-mono-num text-[#172033] dark:text-slate-100">
                            {completedOrder.whatsapp}
                          </p>
                        </div>
                      )}
                      {completedOrder.telegram && (
                        <div className="flex justify-between sm:block">
                          <span className="text-[#64748B] dark:text-slate-400">Telegram</span>
                          <p className="font-bold text-[#172033] dark:text-slate-100">
                            {completedOrder.telegram}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Direct WhatsApp & Telegram Admin Buttons */}
                  <div className="space-y-2.5">
                    <p className="text-xs text-center text-[#64748B] dark:text-slate-400">
                      {lang === 'bn'
                        ? 'দ্রুত ডেলিভারি ও সাপোর্টের জন্য নিচের WhatsApp বা Telegram বাটনে অর্ডার তথ্য পাঠান:'
                        : 'Send your order summary directly via WhatsApp or Telegram for fastest processing:'}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      <a
                        href={buildWhatsAppPrefillUrl(settings.whatsappLink, completedOrderText)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#16A34A] hover:bg-[#15803D] text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
                      >
                        <MessageCircle className="w-4 h-4 shrink-0" />
                        <span>{lang === 'bn' ? 'WhatsApp-এ পাঠান' : 'Send on WhatsApp'}</span>
                      </a>
                      <a
                        href={settings.telegramLink || 'https://t.me/zenvoofficial'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0088cc] hover:bg-[#0077b3] text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors"
                      >
                        <Send className="w-4 h-4 shrink-0" />
                        <span>{lang === 'bn' ? 'Telegram অ্যাডমিন' : 'Contact Telegram Admin'}</span>
                      </a>
                    </div>
                  </div>

                  {/* Action Footer */}
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                    {onGoToOrders && (
                      <button
                        type="button"
                        onClick={() => {
                          setOrderApp(null);
                          onGoToOrders();
                        }}
                        className="min-h-[42px] px-5 py-2.5 rounded-xl dh-orange-gradient text-white text-xs sm:text-sm font-bold cursor-pointer"
                      >
                        {lang === 'bn' ? 'আমার অর্ডার দেখুন' : 'View My Orders'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setOrderApp(null)}
                      className="min-h-[42px] px-5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E2E9F7] dark:border-slate-700 text-[#172033] dark:text-slate-100 text-xs sm:text-sm font-bold cursor-pointer"
                    >
                      {lang === 'bn' ? 'বন্ধ করুন' : 'Close'}
                    </button>
                  </div>
                </div>
              ) : (
                <form onSubmit={handleSubmitMobileAppOrder} className="space-y-5">
                  {/* 1. Device Package Selector (Dynamically Updates Price) */}
                  <div className="space-y-2">
                    <label className="block text-xs font-extrabold text-[#172033] dark:text-slate-100">
                      {lang === 'bn' ? '১. ডিভাইস প্যাকেজ সিলেক্ট করুন' : '1. Select Device Package'}
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                      {MOBILE_APP_DEVICE_PLANS.map((plan) => {
                        const isSelected = orderPlanId === plan.id;
                        const unitPrice = getAppPlanPrice(orderApp, plan);
                        return (
                          <button
                            key={plan.id}
                            type="button"
                            onClick={() => setOrderPlanId(plan.id)}
                            className={`p-3.5 rounded-2xl border text-left transition-all flex items-center justify-between gap-2 cursor-pointer ${
                              isSelected
                                ? 'border-[#FF8500] bg-[#FFF7EE] dark:bg-orange-950/35 ring-2 ring-[#FF8500]/20'
                                : 'border-[#E2E9F7] dark:border-slate-700 bg-[#F8FAFF] dark:bg-slate-800/70 hover:border-[#FF8500]/50'
                            }`}
                          >
                            <div>
                              <p className="text-sm font-bold text-[#172033] dark:text-slate-100">
                                {lang === 'bn' ? plan.labelBn : plan.labelEn}
                              </p>
                              <p className="text-[11px] text-[#64748B] dark:text-slate-400">
                                {plan.devices === 1
                                  ? lang === 'bn'
                                    ? 'সিঙ্গেল মোবাইল ডিভাইস'
                                    : 'Single Android device'
                                  : lang === 'bn'
                                    ? 'ডুয়াল মোবাইল ডিভাইস'
                                    : 'Two Android devices'}
                              </p>
                            </div>
                            <span className="text-lg font-extrabold font-mono-num tabular-nums text-[#FF8500] shrink-0">
                              ৳{unitPrice}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Quantity + Dynamic Order Total Bar */}
                    <div className="p-3.5 rounded-2xl bg-[#F5F8FF] dark:bg-slate-800/80 border border-[#E2E9F7] dark:border-slate-700 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xs font-bold text-[#475569] dark:text-slate-300">
                          {lang === 'bn' ? 'সংখ্যা:' : 'Qty:'}
                        </span>
                        <div className="inline-flex items-center gap-2 bg-white dark:bg-slate-900 px-2 py-1 rounded-xl border border-[#E2E9F7] dark:border-slate-700">
                          <button
                            type="button"
                            onClick={() => setOrderQty((q) => Math.max(1, q - 1))}
                            className="w-7 h-7 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 font-bold text-[#172033] dark:text-slate-100 cursor-pointer"
                          >
                            -
                          </button>
                          <span className="w-6 text-center text-sm font-bold font-mono-num tabular-nums text-[#172033] dark:text-slate-100">
                            {orderQty}
                          </span>
                          <button
                            type="button"
                            onClick={() => setOrderQty((q) => Math.min(10, q + 1))}
                            className="w-7 h-7 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 font-bold text-[#172033] dark:text-slate-100 cursor-pointer"
                          >
                            +
                          </button>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="block text-[10px] font-semibold text-[#64748B] dark:text-slate-400">
                          {lang === 'bn' ? 'মোট প্রদেয় মূল্য' : 'Total Payable'}
                        </span>
                        <span className="text-xl font-extrabold font-mono-num tabular-nums text-[#FF8500]">
                          ৳{totalCostBdt}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 2. Mandatory Contact Info (WhatsApp OR Telegram) */}
                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-xs font-extrabold text-[#172033] dark:text-slate-100">
                        {lang === 'bn'
                          ? '২. যোগাযোগের তথ্য (WhatsApp অথবা Telegram — যেকোনো একটি বাধ্যতামূলক)'
                          : '2. Contact Info (WhatsApp OR Telegram — at least one required)'}
                      </label>
                      <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5">
                        {lang === 'bn'
                          ? 'অর্ডার ডেলিভারি ও সহায়তার জন্য আপনার WhatsApp নম্বর অথবা Telegram Username/ID দিন।'
                          : 'Provide your WhatsApp number or Telegram Username/ID so we can coordinate delivery.'}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label
                          htmlFor="mapp-whatsapp"
                          className="block text-xs font-bold text-[#334155] dark:text-slate-200 mb-1"
                        >
                          {lang === 'bn' ? 'WhatsApp নম্বর' : 'WhatsApp Number'}
                        </label>
                        <input
                          id="mapp-whatsapp"
                          type="tel"
                          value={whatsappInput}
                          onChange={(e) => setWhatsappInput(e.target.value)}
                          placeholder="01XXXXXXXXX"
                          className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-slate-800 border border-[#E2E9F7] dark:border-slate-700 text-xs sm:text-sm font-mono-num text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
                        />
                      </div>

                      <div>
                        <label
                          htmlFor="mapp-telegram"
                          className="block text-xs font-bold text-[#334155] dark:text-slate-200 mb-1"
                        >
                          {lang === 'bn' ? 'Telegram Username / ID' : 'Telegram Username / ID'}
                        </label>
                        <input
                          id="mapp-telegram"
                          type="text"
                          value={telegramInput}
                          onChange={(e) => setTelegramInput(e.target.value)}
                          placeholder="@username"
                          className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-slate-800 border border-[#E2E9F7] dark:border-slate-700 text-xs sm:text-sm text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="mapp-note"
                        className="block text-xs font-bold text-[#334155] dark:text-slate-200 mb-1"
                      >
                        {lang === 'bn' ? 'অতিরিক্ত নোট (ঐচ্ছিক)' : 'Additional Note (Optional)'}
                      </label>
                      <input
                        id="mapp-note"
                        type="text"
                        value={noteInput}
                        onChange={(e) => setNoteInput(e.target.value)}
                        placeholder={
                          lang === 'bn'
                            ? 'মোবাইল মডেল বা কোনো নির্দেশনা থাকলে লিখুন...'
                            : 'Android device model or any note...'
                        }
                        className="w-full px-3.5 py-2 rounded-xl bg-[#F5F8FF] dark:bg-slate-800 border border-[#E2E9F7] dark:border-slate-700 text-xs text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
                      />
                    </div>
                  </div>

                  {/* Login notice if not signed in */}
                  {!user && (
                    <div className="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 flex items-center justify-between gap-3 text-xs">
                      <span className="font-bold text-[#172033] dark:text-amber-100">
                        {lang === 'bn'
                          ? 'অর্ডার জমা দিতে আগে আপনার DIGITAL HUB অ্যাকাউন্টে লগইন করুন।'
                          : 'Sign in to your DIGITAL HUB account to place and track this order.'}
                      </span>
                      <button
                        type="button"
                        onClick={onOpenAuth}
                        className="px-3.5 py-2 rounded-xl dh-orange-gradient text-white font-bold shrink-0 cursor-pointer"
                      >
                        {t(lang, 'signIn')}
                      </button>
                    </div>
                  )}

                  {/* 3. Payment Method (Wallet or bKash/Nagad/Rocket) */}
                  <div className="space-y-2.5">
                    <label className="block text-xs font-extrabold text-[#172033] dark:text-slate-100">
                      {lang === 'bn' ? '৩. পেমেন্ট মেথড সিলেক্ট করুন' : '3. Select Payment Method'}
                    </label>

                    <button
                      type="button"
                      onClick={() => setPaymentMethod('wallet')}
                      className={`w-full p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                        paymentMethod === 'wallet'
                          ? 'border-[#FF8500] bg-[#FFF7EE] dark:bg-orange-950/30 ring-2 ring-[#FF8500]/20'
                          : 'border-[#E2E9F7] dark:border-slate-700 bg-white dark:bg-slate-800/70 hover:border-[#FF8500]/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <PaymentProviderLogo method="wallet" compact settings={settings} />
                        <span className="text-xs font-mono-num tabular-nums font-bold text-[#172033] dark:text-slate-100">
                          ৳{walletBalance.toFixed(2)}
                        </span>
                      </div>
                    </button>

                    <PaymentMethodCardsGrid
                      settings={settings}
                      paymentMethods={paymentMethods}
                      lang={lang}
                      selectedMethod={paymentMethod}
                      onSelect={(m) => setPaymentMethod(m)}
                      compact
                    />

                    {paymentMethod === 'wallet' ? (
                      <div className="p-3 rounded-xl bg-[#F5F8FF] dark:bg-slate-800/80 border border-[#E2E9F7] dark:border-slate-700 text-xs flex items-center gap-2.5">
                        <Wallet className="w-4 h-4 text-[#FF8500] shrink-0" />
                        <p
                          className={
                            walletSufficient
                              ? 'text-[#172033] dark:text-slate-200'
                              : 'text-[#DC2626] dark:text-red-400 font-semibold'
                          }
                        >
                          {walletSufficient
                            ? lang === 'bn'
                              ? `আপনার ওয়ালেট ব্যালেন্স (৳${walletBalance.toFixed(2)}) থেকে ৳${totalCostBdt} পরিশোধ হবে।`
                              : `৳${totalCostBdt} will be deducted from your verified ৳${walletBalance.toFixed(2)} wallet balance.`
                            : lang === 'bn'
                              ? `ওয়ালেট ব্যালেন্স পর্যাপ্ত নয় (আরও ৳${(totalCostBdt - walletBalance).toFixed(2)} প্রয়োজন)। bKash/Nagad/Rocket সিলেক্ট করুন।`
                              : `Insufficient wallet balance. Switch to bKash/Nagad/Rocket or add money.`}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3 pt-1">
                        <SelectedPaymentInstructionCard
                          method={paymentMethod}
                          settings={settings}
                          paymentMethods={paymentMethods}
                          amountBdt={totalCostBdt}
                          lang={lang}
                          copied={copiedPayNum}
                          onCopy={handleCopyPayNumber}
                        />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
                              {t(lang, 'senderNumberLabel')}
                            </label>
                            <input
                              type="tel"
                              required
                              value={senderNumber}
                              onChange={(e) => setSenderNumber(e.target.value)}
                              placeholder="01XXXXXXXXX"
                              className="w-full px-3 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-slate-800 border border-[#E2E9F7] dark:border-slate-700 text-xs font-mono-num text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
                              {t(lang, 'txIdLabel')}
                            </label>
                            <input
                              type="text"
                              required
                              value={txId}
                              onChange={(e) => setTxId(e.target.value.toUpperCase())}
                              placeholder="TXN9B72K..."
                              className="w-full px-3 py-2.5 rounded-xl bg-[#F5F8FF] dark:bg-slate-800 border border-[#E2E9F7] dark:border-slate-700 text-xs font-mono-num uppercase text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
                            />
                          </div>
                        </div>

                        <ReceiptScreenshotUploadBox
                          receiptDataUrl={receiptDataUrl}
                          lang={lang}
                          onFileChange={handleReceiptUpload}
                          onClear={() => setReceiptDataUrl('')}
                        />
                      </div>
                    )}
                  </div>

                  {orderError && (
                    <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 text-[#DC2626] dark:text-red-300 text-xs font-semibold flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{orderError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submitting || (Boolean(user) && paymentMethod === 'wallet' && !walletSufficient)}
                    className="w-full min-h-[46px] py-3 rounded-xl dh-orange-gradient text-white font-extrabold text-sm shadow-md hover:opacity-95 disabled:opacity-60 transition-opacity cursor-pointer"
                  >
                    {submitting
                      ? lang === 'bn'
                        ? 'অর্ডার জমা হচ্ছে...'
                        : 'Submitting Order...'
                      : lang === 'bn'
                        ? `অর্ডার কনফার্ম করুন · ৳${totalCostBdt}`
                        : `Confirm Order · ৳${totalCostBdt}`}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
