import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  MessageCircle,
  Search,
  Send,
  ShieldCheck,
  Smartphone,
  Wallet,
  X,
} from 'lucide-react';
import type {
  AuthUser,
  CheckoutPaymentMethod,
  Language,
  PaymentMethod,
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
  submitOrderWithManualPayment,
  submitOrderWithWalletBalance,
  validateTransactionIdServer,
} from '../lib/firestoreService';
import {
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

function AppScreenshotPreview({
  app,
  size = 'card',
}: {
  app: MobileAppItem;
  size?: 'card' | 'modal';
}) {
  const [imgFailed, setImgFailed] = useState(false);

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
        src={app.screenUrl}
        alt=""
        aria-hidden="true"
        loading="lazy"
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
          src={app.screenUrl}
          alt={`${app.name} official mobile app preview`}
          loading="lazy"
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
  user,
  profile,
  wallet,
  onOpenAuth,
  onNavigateAll,
  onBackHome,
  onGoToOrders,
}: MobileAppStoreSectionProps) {
  const [selectedCategory, setSelectedCategory] = useState<'all' | MobileAppCategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedHome, setExpandedHome] = useState(false);

  // Active modals
  const [detailsApp, setDetailsApp] = useState<MobileAppItem | null>(null);
  const [detailsPlanId, setDetailsPlanId] = useState<'1_device' | '2_devices'>('1_device');

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

  // Ensure selected manual method is enabled
  useEffect(() => {
    if (paymentMethod === 'wallet') return;
    const isEnabled =
      paymentMethod === 'bkash'
        ? settings.bkashEnabled !== false
        : paymentMethod === 'nagad'
          ? settings.nagadEnabled !== false
          : settings.rocketEnabled !== false;
    if (!isEnabled) {
      const next = (['bkash', 'nagad', 'rocket'] as PaymentMethod[]).find((m) =>
        m === 'bkash'
          ? settings.bkashEnabled !== false
          : m === 'nagad'
            ? settings.nagadEnabled !== false
            : settings.rocketEnabled !== false
      );
      setPaymentMethod(next || 'wallet');
    }
  }, [settings.bkashEnabled, settings.nagadEnabled, settings.rocketEnabled, paymentMethod]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: MOBILE_APPS_CATALOG.length };
    for (const app of MOBILE_APPS_CATALOG) {
      counts[app.category] = (counts[app.category] || 0) + 1;
    }
    return counts;
  }, []);

  const filteredApps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return MOBILE_APPS_CATALOG.filter((app) => {
      if (selectedCategory !== 'all' && app.category !== selectedCategory) return false;
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
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [selectedCategory, searchQuery]);

  const isHomeCompact =
    mode === 'home' && !expandedHome && selectedCategory === 'all' && searchQuery.trim() === '';
  const visibleApps = isHomeCompact ? filteredApps.slice(0, 12) : filteredApps;

  const activeOrderPlan: MobileAppDevicePlan =
    MOBILE_APP_DEVICE_PLANS.find((p) => p.id === orderPlanId) || MOBILE_APP_DEVICE_PLANS[0];
  const activeDetailsPlan: MobileAppDevicePlan =
    MOBILE_APP_DEVICE_PLANS.find((p) => p.id === detailsPlanId) || MOBILE_APP_DEVICE_PLANS[0];

  const totalCostBdt = activeOrderPlan.priceBdt * orderQty;
  const walletBalance = wallet?.availableBalanceBdt || 0;
  const walletSufficient = walletBalance >= totalCostBdt;

  const receiverNumber =
    paymentMethod === 'bkash'
      ? settings.bkashNumber
      : paymentMethod === 'nagad'
        ? settings.nagadNumber
        : settings.rocketNumber;

  const openDetails = (app: MobileAppItem, defaultPlan: '1_device' | '2_devices' = '1_device') => {
    setDetailsApp(app);
    setDetailsPlanId(defaultPlan);
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

    const { product, pkg } = buildMobileAppProductForOrder(orderApp, activeOrderPlan);

    const deliveryLines = [
      `Store: Mobile App Store (Android Only)`,
      `App: ${orderApp.name}`,
      `Package: ${activeOrderPlan.labelEn} (৳${activeOrderPlan.priceBdt}) × ${orderQty} = ৳${totalCostBdt}`,
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
                  {MOBILE_APPS_CATALOG.length} {lang === 'bn' ? 'টি অ্যাপ' : 'Apps'}
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
              <span>{lang === 'bn' ? 'সব ৪১টি অ্যাপ' : 'All 41 Apps'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
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
      {(selectedCategory !== 'all' || searchQuery.trim() !== '') && (
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
            {lang === 'bn'
              ? `"${searchQuery}" নামে কোনো মোবাইল অ্যাপ পাওয়া যায়নি।`
              : `No mobile apps matched "${searchQuery}".`}
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedCategory('all');
            }}
            className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold cursor-pointer"
          >
            {lang === 'bn' ? 'সব অ্যাপ দেখুন' : 'Show All 41 Apps'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-5">
          {visibleApps.map((app) => {
            const catMeta = getMobileAppCategoryMeta(app.category);
            return (
              <article
                key={app.id}
                className="group rounded-2xl bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-800 overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(23,32,51,0.09)] dark:hover:shadow-[0_14px_32px_rgba(0,0,0,0.45)]"
              >
                {/* Official App Screenshot Preview */}
                <button
                  type="button"
                  onClick={() => openDetails(app, '1_device')}
                  className="relative aspect-[16/10] w-full overflow-hidden text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF8500] cursor-pointer"
                  aria-label={`${app.name} details`}
                >
                  <AppScreenshotPreview app={app} size="card" />
                </button>

                {/* Card Body */}
                <div className="p-4 flex-1 flex flex-col justify-between gap-3.5">
                  <div className="space-y-2.5">
                    {/* Official App Icon + Name + Clean Unboxed Category Metadata */}
                    <div className="flex items-start gap-3">
                      <img
                        src={app.iconUrl}
                        alt={`${app.name} official logo`}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="w-11 h-11 rounded-xl object-cover border border-[#E2E9F7] dark:border-slate-700 bg-white dark:bg-slate-800 shrink-0 shadow-xs"
                      />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-[15px] font-extrabold text-[#172033] dark:text-slate-50 leading-snug truncate">
                          {app.name}
                        </h3>
                        <p className="text-[11px] font-medium text-[#64748B] dark:text-slate-400 truncate mt-0.5">
                          {lang === 'bn' ? catMeta.labelBn : catMeta.labelEn} · Android
                        </p>
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
                      {MOBILE_APP_DEVICE_PLANS.map((plan) => (
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
                            ৳{plan.priceBdt}
                          </span>
                        </button>
                      ))}
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

      {mode === 'home' && expandedHome && selectedCategory === 'all' && searchQuery.trim() === '' && (
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
              {/* Large Official Preview */}
              <div className="relative h-60 sm:h-72 rounded-2xl overflow-hidden border border-[#E2E9F7] dark:border-slate-800">
                <AppScreenshotPreview app={detailsApp} size="modal" />
              </div>

              {/* Description & Official Store Verification Link */}
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
                  <span className="text-[#64748B] dark:text-slate-400">
                    {lang === 'bn'
                      ? 'প্ল্যাটফর্ম: শুধুমাত্র Android / Mobile'
                      : 'Platform: Android / Mobile Only'}
                  </span>
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
                          ৳{plan.priceBdt}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-4 border-t border-[#EDF2FA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-900/90 flex items-center justify-between gap-3">
              <div>
                <span className="block text-[11px] text-[#64748B] dark:text-slate-400">
                  {lang === 'bn' ? activeDetailsPlan.labelBn : activeDetailsPlan.labelEn}
                </span>
                <span className="text-xl font-extrabold font-mono-num tabular-nums text-[#FF8500]">
                  ৳{activeDetailsPlan.priceBdt}
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
                    ? `অর্ডার করুন · ৳${activeDetailsPlan.priceBdt}`
                    : `Order Now · ৳${activeDetailsPlan.priceBdt}`}
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
                              ৳{plan.priceBdt}
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
