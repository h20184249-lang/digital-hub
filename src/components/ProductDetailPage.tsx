import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  Layers,
  Lock,
  PackageCheck,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Star,
  Wallet,
} from 'lucide-react';
import {
  AdNetworkConfig,
  Advertisement,
  AppRoute,
  AuthUser,
  Banner,
  Category,
  CheckoutPaymentMethod,
  Language,
  ManagedAdUnitConfig,
  PaymentMethod,
  PaymentMethodConfig,
  Product,
  ProductPackage,
  Review,
  SiteSettings,
  UserProfile,
  WalletAccount,
} from '../types/marketplace';
import { t } from '../lib/i18n';
import { BRAND_META, PaymentProviderLogo, ProductVisualArtwork, ServiceBrandLogo } from './BrandLogos';
import {
  getEnabledPaymentMethods,
  getPaymentMethodDetails,
  PaymentMethodCardsGrid,
  ReceiptScreenshotUploadBox,
  SelectedPaymentInstructionCard,
} from './PremiumPaymentSection';
import {
  compressImageToDataUrl,
  submitOrderWithManualPayment,
  submitOrderWithWalletBalance,
  validateTransactionIdServer,
} from '../lib/firestoreService';
import {
  formatBdt,
  getEffectiveProductAvailability,
  getFirstAvailablePackage,
  getNormalizedPackages,
  getPackageAvailability,
  getProductOrderFormType,
  getProductStockCount,
  getRulesAndRefundPoints,
  hasGenuineDiscount,
  isPackagePurchasable,
} from '../lib/catalogHelpers';
import {
  buildServiceDeliveryNote,
  createInitialServiceOrderValues,
  ServiceOrderFieldValues,
  ServiceOrderFormFields,
  validateServiceOrderValues,
} from './ServiceOrderFormFields';
import { BannerSlotView } from './BannerSlotView';
import { NativeAdRow } from './AutomaticAdEngine';
import { ManagedPlacementSlot } from './AdUnitFrame';
import { ProductCard } from './StorefrontPages';

interface ProductDetailPageProps {
  product: Product;
  allProducts: Product[];
  categories: Category[];
  lang: Language;
  settings: SiteSettings;
  paymentMethods?: PaymentMethodConfig[];
  user: AuthUser | null;
  profile: UserProfile | null;
  wallet: WalletAccount | null;
  banners: Banner[];
  advertisements: Advertisement[];
  adNetworks: AdNetworkConfig[];
  managedAdUnits?: ManagedAdUnitConfig[];
  reviews: Review[];
  onBack: () => void;
  onNavigate: (r: AppRoute) => void;
  onSelectProduct: (p: Product) => void;
  onQuickOrder: (p: Product) => void;
  onAddToCart: (p: Product, qty?: number, pkg?: ProductPackage) => void;
  onOpenAuth: () => void;
  onOrderSuccess: () => void;
}

const EMPTY_PAYMENT_METHODS: PaymentMethodConfig[] = [];
const EMPTY_MANAGED_AD_UNITS: ManagedAdUnitConfig[] = [];

export function ProductDetailPage({
  product,
  allProducts,
  categories,
  lang,
  settings,
  paymentMethods = EMPTY_PAYMENT_METHODS,
  user,
  profile,
  wallet,
  banners,
  advertisements,
  adNetworks,
  managedAdUnits = EMPTY_MANAGED_AD_UNITS,
  reviews,
  onBack,
  onNavigate,
  onSelectProduct,
  onQuickOrder,
  onAddToCart,
  onOpenAuth,
  onOrderSuccess,
}: ProductDetailPageProps) {
  const packages = useMemo(() => getNormalizedPackages(product), [product]);
  const [selectedPackage, setSelectedPackage] = useState<ProductPackage | null>(
    () => getFirstAvailablePackage(product) || packages[0] || null
  );
  const [quantity, setQuantity] = useState(1);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [method, setMethod] = useState<CheckoutPaymentMethod>('bkash');
  const [senderNumber, setSenderNumber] = useState('');
  const [txId, setTxId] = useState('');
  const [serviceValues, setServiceValues] = useState<ServiceOrderFieldValues>(() =>
    createInitialServiceOrderValues(user?.email || '', product)
  );
  const [referenceAttachmentUrl, setReferenceAttachmentUrl] = useState('');
  const [receiptDataUrl, setReceiptDataUrl] = useState('');
  const [copiedNum, setCopiedNum] = useState(false);
  const [copiedShare, setCopiedShare] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [doneOrderNumber, setDoneOrderNumber] = useState('');
  const checkoutSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setSelectedPackage(getFirstAvailablePackage(product) || getNormalizedPackages(product)[0] || null);
    setQuantity(1);
    setCheckoutOpen(false);
    setError('');
    setDoneOrderNumber('');
    setReferenceAttachmentUrl('');
    setServiceValues(createInitialServiceOrderValues(user?.email || '', product));
  }, [product.id]);

  useEffect(() => {
    if (user?.email && !serviceValues.deliveryEmail) {
      setServiceValues((prev) => ({ ...prev, deliveryEmail: user.email || '' }));
    }
  }, [user?.email]);

  useEffect(() => {
    if (method === 'wallet') return;
    const enabled = getEnabledPaymentMethods(settings, paymentMethods);
    if (!enabled.includes(method)) {
      const next = enabled[0] || 'wallet';
      if (next !== method) setMethod(next);
    }
  }, [settings, paymentMethods, method]);

  const category = categories.find((c) => c.id === product.categoryId);
  const brandMeta = product.brandKey ? BRAND_META[product.brandKey.toLowerCase()] : undefined;
  const effectiveAvail = getEffectiveProductAvailability(product);
  const stockCount = getProductStockCount(product);
  const isProductOutOfStock = effectiveAvail === 'out_of_stock' || stockCount <= 0;
  const formType = getProductOrderFormType(product);
  const { rules, refundPolicy } = useMemo(() => getRulesAndRefundPoints(product, lang), [product, lang]);

  const activePackage = selectedPackage || packages[0];
  const activePkgPurchasable = !isProductOutOfStock && isPackagePurchasable(activePackage, product);
  const unitPrice = activePackage ? activePackage.priceBdt : product.priceBdt;
  const originalUnitPrice = activePackage?.originalPriceBdt ?? product.originalPriceBdt;
  const showGenuineDiscount = hasGenuineDiscount(unitPrice, originalUnitPrice);
  const discountPct =
    showGenuineDiscount && originalUnitPrice
      ? Math.min(95, Math.max(1, Math.round(((originalUnitPrice - unitPrice) / originalUnitPrice) * 100)))
      : 0;
  const totalCost = Math.max(1, unitPrice * quantity);
  const walletBalance = wallet?.availableBalanceBdt || 0;
  const walletSufficient = walletBalance >= totalCost;

  const productReviews = useMemo(
    () => reviews.filter((r) => r.productId === product.id && r.approved),
    [reviews, product.id]
  );

  const relatedProducts = useMemo(
    () =>
      allProducts
        .filter((p) => p.active && p.id !== product.id && p.categoryId === product.categoryId)
        .slice(0, 4),
    [allProducts, product.id, product.categoryId]
  );

  const receiverNumber =
    method === 'wallet' ? '' : getPaymentMethodDetails(method, settings, paymentMethods).number;

  const handleCopyNumber = () => {
    navigator.clipboard.writeText(receiverNumber).catch(() => {});
    setCopiedNum(true);
    setTimeout(() => setCopiedNum(false), 1800);
  };

  const handleShareLink = () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}?product=${encodeURIComponent(product.id)}`;
    navigator.clipboard.writeText(shareUrl).catch(() => {});
    setCopiedShare(true);
    setTimeout(() => setCopiedShare(false), 1800);
  };

  const handleReceiptChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await compressImageToDataUrl(file);
      setReceiptDataUrl(url);
    } catch {
      setError('Failed to process receipt image');
    }
  };

  const openInlineCheckout = () => {
    setCheckoutOpen(true);
    setTimeout(() => {
      checkoutSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 60);
  };

  const handleSubmitOrder = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!activePkgPurchasable) {
      setError(
        lang === 'bn'
          ? 'নির্বাচিত প্যাকেজটি বর্তমানে Out of Stock। অনুগ্রহ করে অন্য একটি উপলব্ধ প্যাকেজ নির্বাচন করুন।'
          : 'The selected package is currently Out of Stock. Please choose an available package.'
      );
      return;
    }
    if (!user) {
      onOpenAuth();
      return;
    }

    const validationErr = validateServiceOrderValues(formType, serviceValues, lang, product);
    if (validationErr) {
      setError(validationErr);
      return;
    }

    const formattedDeliveryNote = buildServiceDeliveryNote(
      formType,
      serviceValues,
      product,
      activePackage,
      quantity
    );

    setSubmitting(true);
    try {
      if (method === 'wallet') {
        if (!wallet || wallet.availableBalanceBdt < totalCost) {
          throw new Error(
            lang === 'bn'
              ? 'পর্যাপ্ত ভেরিফায়েড ওয়ালেট ব্যালেন্স নেই। অ্যাড মানি করুন অথবা বিকাশ/নগদ/রকেট ব্যবহার করুন।'
              : 'Insufficient verified wallet balance. Please Add Money or pay via bKash/Nagad/Rocket.'
          );
        }
        const res = await submitOrderWithWalletBalance({
          customerId: user.uid,
          customerEmail: user.phone || user.email || '',
          customerName: profile?.displayName || user.displayName || 'Customer',
          wallet,
          items: [{ product, quantity, selectedPackage: activePackage }],
          totalPriceBdt: totalCost,
          deliveryNote: formattedDeliveryNote,
          referenceAttachmentUrl,
        });
        setDoneOrderNumber(res.orderNumber);
      } else {
        const cleanTx = await validateTransactionIdServer({
          transactionId: txId,
          senderNumber: senderNumber.trim(),
          method,
        });
        const res = await submitOrderWithManualPayment({
          customerId: user.uid,
          customerEmail: user.phone || user.email || '',
          customerName: profile?.displayName || user.displayName || 'Customer',
          items: [{ product, quantity, selectedPackage: activePackage }],
          totalPriceBdt: totalCost,
          method: method as PaymentMethod,
          receiverNumber,
          senderNumber,
          transactionId: cleanTx,
          deliveryNote: formattedDeliveryNote,
          receiptDataUrl,
          referenceAttachmentUrl,
        });
        setDoneOrderNumber(res.orderNumber);
      }
      onOrderSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Breadcrumb & Back Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-[#777777] flex-wrap">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#E6ECFA] text-[#172033] font-bold hover:border-[#FF8500] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-[#FF8500]" />
            <span>{t(lang, 'backToStore')}</span>
          </button>
          {category && (
            <>
              <span>/</span>
              <button
                type="button"
                onClick={() => onNavigate((category.slug as AppRoute) || 'services')}
                className="font-semibold hover:text-[#FF8500]"
              >
                {lang === 'bn' ? category.nameBn : category.nameEn}
              </button>
            </>
          )}
          <span>/</span>
          <span className="font-bold text-[#172033] truncate max-w-[260px]">
            {lang === 'bn' ? product.titleBn : product.titleEn}
          </span>
        </div>

        <button
          type="button"
          onClick={handleShareLink}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#172033] hover:border-[#FF8500]"
        >
          {copiedShare ? <Check className="w-3.5 h-3.5 text-[#16A34A]" /> : <Share2 className="w-3.5 h-3.5 text-[#FF8500]" />}
          <span>{copiedShare ? t(lang, 'copied') : lang === 'bn' ? 'লিংক কপি' : 'Share'}</span>
        </button>
      </div>

      {/* MangoTop-Style Product Hero Banner */}
      <div className="relative h-40 sm:h-52 lg:h-60 rounded-3xl overflow-hidden border border-[#E6ECFA] shadow-sm group bg-[#172033]">
        <ProductVisualArtwork product={product} lang={lang} variant="banner" />
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4 z-20 flex flex-wrap items-center justify-end gap-2">
          <span className="px-2.5 py-1 rounded-xl bg-black/55 backdrop-blur-xs border border-white/15 text-white text-[11px] font-bold flex items-center gap-1">
            <Clock className="w-3.5 h-3.5 text-[#FF9B19]" />
            {lang === 'bn' ? product.deliveryDurationBn : product.deliveryDurationEn}
          </span>
          <span
            className={`px-2.5 py-1 rounded-xl text-[11px] font-extrabold border ${
              effectiveAvail === 'in_stock' && !isProductOutOfStock
                ? 'bg-emerald-950/75 border-emerald-400/30 text-emerald-300'
                : effectiveAvail === 'limited' && !isProductOutOfStock
                  ? 'bg-amber-950/75 border-amber-400/30 text-amber-300'
                  : 'bg-red-950/75 border-red-400/30 text-red-300'
            }`}
          >
            {isProductOutOfStock
              ? t(lang, 'outOfStock')
              : effectiveAvail === 'limited'
                ? t(lang, 'limited')
                : t(lang, 'inStock')}
          </span>
        </div>
      </div>

      {/* Main MangoTop-Style Product Card */}
      <div className="dh-card rounded-3xl p-4 sm:p-6 lg:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
        {/* Left Column: Product Visual + Official Brand Metadata + Accepted Payments */}
        <div className="lg:col-span-5 space-y-4">
          <div className="relative aspect-[16/11] rounded-3xl overflow-hidden border border-[#E6ECFA] shadow-sm group">
            <ProductVisualArtwork product={product} lang={lang} variant="hero" />
            {!isProductOutOfStock && discountPct > 0 ? (
              <span className="absolute top-3 right-3 px-2.5 py-1 rounded-xl bg-[#DC2626] text-white text-xs font-extrabold font-mono-num shadow-sm">
                -{discountPct}%
              </span>
            ) : null}
          </div>

          <div className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <ServiceBrandLogo
                brandKey={product.brandKey}
                customLogoUrl={product.customLogoUrl}
                size={44}
              />
              <div className="min-w-0">
                <p className="text-[11px] font-bold text-[#FF8500] uppercase tracking-wide">
                  {t(lang, 'officialBrandAsset')}
                </p>
                <p className="text-xs sm:text-sm font-extrabold text-[#172033] truncate">
                  {brandMeta?.label ||
                    (lang === 'bn' ? product.subcategoryBn || 'DIGITAL HUB' : product.subcategoryEn || 'DIGITAL HUB')}
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] font-bold text-[#777777] uppercase">{t(lang, 'deliveryLabel')}</p>
              <p className="text-xs font-extrabold text-[#172033] flex items-center gap-1 justify-end">
                <Clock className="w-3.5 h-3.5 text-[#FF8500]" />
                {lang === 'bn' ? product.deliveryDurationBn : product.deliveryDurationEn}
              </p>
            </div>
          </div>

          {/* Stock & Availability Indicator */}
          <div className="p-3.5 rounded-2xl bg-white border border-[#E6ECFA] flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 font-bold text-[#172033]">
              <PackageCheck className="w-4 h-4 text-[#FF8500]" />
              <span>{t(lang, 'stockAvailable')}</span>
            </div>
            <div className="flex items-center gap-2 font-mono-num font-extrabold">
              <span
                className={
                  isProductOutOfStock
                    ? 'text-[#DC2626]'
                    : effectiveAvail === 'limited'
                      ? 'text-[#FF8500]'
                      : 'text-[#059669]'
                }
              >
                {isProductOutOfStock
                  ? t(lang, 'outOfStock')
                  : effectiveAvail === 'limited'
                    ? t(lang, 'limited')
                    : t(lang, 'inStock')}
              </span>
            </div>
          </div>

          <div className="p-3.5 rounded-2xl bg-white border border-[#E6ECFA] flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold text-[#777777]">
              {lang === 'bn' ? 'স্বীকৃত পেমেন্ট:' : 'Accepted:'}
            </span>
            <div className="flex items-center gap-2.5 flex-wrap justify-end">
              {settings.bkashEnabled !== false && <PaymentProviderLogo method="bkash" compact settings={settings} />}
              {settings.nagadEnabled !== false && <PaymentProviderLogo method="nagad" compact settings={settings} />}
              {settings.rocketEnabled !== false && <PaymentProviderLogo method="rocket" compact settings={settings} />}
            </div>
          </div>
        </div>

        {/* Right Column: Service Details, Select Package / Recharge, Live Total & Actions */}
        <div className="lg:col-span-7 flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
              {(product.subcategoryBn || product.subcategoryEn) && (
                <span className="text-[#FF8500] uppercase tracking-wider">
                  {lang === 'bn' ? product.subcategoryBn || product.subcategoryEn : product.subcategoryEn}
                </span>
              )}
              {product.badge && (
                <span className="px-2 py-0.5 rounded-md bg-[#FF8500] text-white text-[10px] font-extrabold uppercase tracking-wide">
                  {product.badge}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-3xl font-extrabold text-[#172033] leading-tight">
              {lang === 'bn' ? product.titleBn : product.titleEn}
            </h1>

            <p className="text-sm text-[#777777] leading-relaxed">
              {lang === 'bn' ? product.descriptionBn : product.descriptionEn}
            </p>

            <div className="flex flex-wrap items-baseline gap-3 pt-1">
              <span className="text-3xl font-extrabold font-mono-num text-[#FF8500]">
                {formatBdt(unitPrice)}
              </span>
              {showGenuineDiscount && originalUnitPrice && (
                <span className="px-2 py-0.5 rounded-md bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num text-[#777777] line-through">
                  {formatBdt(originalUnitPrice)}
                </span>
              )}
              {discountPct > 0 && (
                <span className="px-2 py-0.5 rounded-md bg-[#DC2626] text-white text-[11px] font-extrabold font-mono-num">
                  -{discountPct}%
                </span>
              )}
              {activePackage && (
                <span className="px-2.5 py-1 rounded-lg bg-[#FFF3E5] text-[#172033] text-xs font-bold">
                  {lang === 'bn' ? activePackage.nameBn : activePackage.nameEn}
                </span>
              )}
            </div>

            {(product.durationLabelBn || product.durationLabelEn || product.validityBn || product.validityEn) && (
              <div className="p-3 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/20 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-bold text-[#172033] flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#FF8500]" />
                  {t(lang, 'validityLabel')}
                </span>
                <span className="font-semibold text-[#172033]">
                  {lang === 'bn'
                    ? product.durationLabelBn || product.validityBn || product.durationLabelEn || product.validityEn
                    : product.durationLabelEn || product.validityEn || product.durationLabelBn || product.validityBn}
                </span>
              </div>
            )}

            {/* Select Package / Select Recharge Grid */}
            <div className="space-y-2.5 pt-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#172033] uppercase tracking-wide">
                  <Layers className="w-4 h-4 text-[#FF8500]" />
                  <span>{t(lang, 'selectPackage')}</span>
                </div>
                <span className="text-[11px] font-bold text-[#777777] font-mono-num">
                  {packages.length} {t(lang, 'packagesAvailable')}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {packages.map((pkg) => {
                  const isSel = activePackage?.id === pkg.id;
                  const pkgAvail = getPackageAvailability(pkg, product);
                  const pkgOut = isProductOutOfStock || pkgAvail === 'out_of_stock';
                  const pkgGenuineDiscount = hasGenuineDiscount(pkg.priceBdt, pkg.originalPriceBdt);
                  const pkgDuration = lang === 'bn' ? pkg.durationBn || pkg.durationEn : pkg.durationEn || pkg.durationBn;
                  return (
                    <button
                      key={pkg.id}
                      type="button"
                      disabled={pkgOut}
                      onClick={() => {
                        if (!pkgOut) setSelectedPackage(pkg);
                      }}
                      className={`p-3 rounded-2xl border text-left transition-all ${
                        pkgOut
                          ? 'border-red-200 bg-red-50/50 opacity-65 cursor-not-allowed'
                          : isSel
                            ? 'border-[#FF8500] bg-[#FFF7EE] ring-2 ring-[#FF8500]/25'
                            : 'border-[#E6ECFA] bg-[#F3F6FF] hover:border-[#FF8500]/60'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1 mb-1 min-h-[18px]">
                        {pkgOut ? (
                          <span className="inline-block px-1.5 py-0.5 rounded bg-[#DC2626] text-white text-[9px] font-extrabold uppercase">
                            {t(lang, 'outOfStock')}
                          </span>
                        ) : pkg.tag ? (
                          <span className="inline-block px-1.5 py-0.5 rounded bg-[#FF8500] text-white text-[9px] font-extrabold uppercase">
                            {pkg.tag}
                          </span>
                        ) : pkgAvail === 'limited' ? (
                          <span className="inline-block px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[9px] font-extrabold uppercase">
                            {t(lang, 'limited')}
                          </span>
                        ) : (
                          <span />
                        )}
                      </div>
                      <p className="text-xs font-bold text-[#172033] leading-snug">
                        {lang === 'bn' ? pkg.nameBn : pkg.nameEn}
                      </p>
                      {pkgDuration && (
                        <p className="text-[10px] text-[#777777] mt-0.5 truncate">{pkgDuration}</p>
                      )}
                      <div className="flex items-baseline gap-1.5 mt-1">
                        <span
                          className={`text-sm font-extrabold font-mono-num ${
                            pkgOut ? 'text-[#777777]' : 'text-[#FF8500]'
                          }`}
                        >
                          {formatBdt(pkg.priceBdt)}
                        </span>
                        {pkgGenuineDiscount && pkg.originalPriceBdt && (
                          <span className="text-[10px] font-mono-num text-[#777777] line-through">
                            {formatBdt(pkg.originalPriceBdt)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Dynamic Total Breakdown Card */}
            <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-1.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-[#172033]">{t(lang, 'priceBreakdownLabel')}</span>
                {showGenuineDiscount && originalUnitPrice && (
                  <span className="text-[11px] font-mono-num text-[#059669] font-bold">
                    {lang === 'bn'
                      ? `সাশ্রয়: ${formatBdt((originalUnitPrice - unitPrice) * quantity)}`
                      : `You save ${formatBdt((originalUnitPrice - unitPrice) * quantity)}`}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#E6ECFA]">
                <span className="font-semibold text-[#777777]">
                  {t(lang, 'totalPayable')}:{' '}
                  <span className="font-mono-num text-[#172033] font-bold">
                    {formatBdt(unitPrice)} × {quantity}
                  </span>
                </span>
                <span className="text-base font-extrabold font-mono-num text-[#FF8500]">
                  {formatBdt(totalCost)}
                </span>
              </div>
            </div>

            {(Boolean(product.features?.length) || product.benefitsBn || product.benefitsEn || product.instructionsBn || product.instructionsEn) && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                {(Boolean(product.features?.length) || product.benefitsBn || product.benefitsEn) && (
                  <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA]">
                    <p className="font-bold text-[#172033] mb-1.5">
                      {lang === 'bn' ? 'প্যাকেজ ফিচার ও সুবিধাসমূহ' : 'Package Features & Benefits'}
                    </p>
                    {product.features && product.features.length > 0 ? (
                      <ul className="space-y-1 text-[#5C6B84]">
                        {product.features.map((feat, i) => (
                          <li key={i} className="flex items-start gap-1.5 leading-snug">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                            <span>{feat}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[#777777]">{lang === 'bn' ? product.benefitsBn : product.benefitsEn}</p>
                    )}
                  </div>
                )}
                {(product.instructionsBn || product.instructionsEn) && (
                  <div className="p-3.5 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/20">
                    <p className="font-bold text-[#172033] mb-1">
                      {lang === 'bn' ? 'ডেলিভারি নির্দেশনা' : 'Delivery Instructions'}
                    </p>
                    <p className="text-[#777777]">{lang === 'bn' ? product.instructionsBn : product.instructionsEn}</p>
                  </div>
                )}
              </div>
            )}
            {/* Required Account Info Checklist */}
            <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-extrabold text-[#172033]">
                  {lang === 'bn' ? 'অর্ডারের জন্য প্রয়োজনীয় তথ্য' : 'Required Account Information'}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#059669]">
                  <Lock className="w-3 h-3" />
                  {lang === 'bn' ? 'পাসওয়ার্ড লাগবে না' : 'Zero Password Required'}
                </span>
              </div>
              <p className="text-[11px] text-[#777777] leading-relaxed">
                {formType === 'freefire'
                  ? lang === 'bn'
                    ? 'প্লেয়ার UID নম্বর এবং গেম সার্ভার (BD / Indonesia / Singapore)। শুধু Buy Now বাটনে ক্লিক করে লিখুন।'
                    : 'Player UID & Game Server (BD / Indonesia / Singapore). Enter at checkout — no password ever needed.'
                  : formType === 'pubg_uid'
                    ? lang === 'bn'
                      ? 'গেম ক্যারেক্টার ID / Player Tag এবং সার্ভার রিজিওন।'
                      : 'In-game Player ID / Tag and account Region.'
                    : formType === 'telegram'
                      ? lang === 'bn'
                        ? 'আপনার পাবলিক টেলিগ্রাম @ইউজারনেম (লগইন বা পাসওয়ার্ড প্রয়োজন নেই)।'
                        : 'Your public Telegram @username (no login or password needed).'
                      : formType === 'giftcard'
                        ? lang === 'bn'
                          ? 'অ্যাকাউন্ট রিজিওন (USA/Global) এবং ডেলিভারি ইমেইল।'
                          : 'Account Region (USA / Global) and Voucher Delivery Email.'
                        : formType === 'social'
                          ? lang === 'bn'
                            ? 'পাবলিক প্রোফাইল, চ্যানেল বা পোস্ট/ভিডিওর সঠিক লিংক (URL)।'
                            : 'Public profile, channel, page, or video/post URL.'
                          : formType === 'design'
                            ? lang === 'bn'
                              ? 'প্রজেক্ট নির্দেশনা, ডেলিভারি ইমেইল এবং প্রয়োজনে রেফারেন্স ছবি।'
                              : 'Project brief specifications, delivery email & optional reference artwork.'
                            : lang === 'bn'
                              ? 'অ্যাক্টিভেশন/ইনভাইট ইমেইল এবং দ্রুত যোগাযোগের জন্য WhatsApp/Telegram নম্বর।'
                              : 'Activation / Invite email address and WhatsApp / Telegram contact handle.'}
              </p>
            </div>
          </div>

          {/* Quantity + Primary Actions */}
          <div className="pt-3 border-t border-[#E6ECFA] flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 bg-[#F3F6FF] px-3 py-2 rounded-xl border border-[#E6ECFA]">
              <span className="text-[11px] font-bold text-[#777777] mr-1">{t(lang, 'quantityLabel')}</span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="w-7 h-7 rounded-lg bg-white font-bold text-[#172033]"
              >
                -
              </button>
              <span className="w-6 text-center text-sm font-bold font-mono-num">{quantity}</span>
              <button
                type="button"
                onClick={() =>
                  setQuantity((q) => Math.min(Math.max(1, Math.min(20, stockCount || 20)), q + 1))
                }
                className="w-7 h-7 rounded-lg bg-white font-bold text-[#172033]"
              >
                +
              </button>
            </div>

            <button
              type="button"
              disabled={!activePkgPurchasable}
              onClick={() => onAddToCart(product, quantity, activePackage)}
              className="flex-1 min-w-[140px] py-3 px-4 rounded-xl bg-[#172033] text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 hover:bg-[#23314d] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ShoppingCart className="w-4 h-4" />
              <span>{!activePkgPurchasable ? t(lang, 'outOfStock') : t(lang, 'addToCart')}</span>
            </button>

            <button
              type="button"
              disabled={!activePkgPurchasable}
              onClick={openInlineCheckout}
              className="flex-1 min-w-[170px] py-3 px-5 rounded-xl dh-orange-gradient text-white text-xs sm:text-sm font-extrabold flex items-center justify-center gap-2 shadow-md hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>
                {!activePkgPurchasable
                  ? t(lang, 'outOfStock')
                  : `${t(lang, 'buyNow')} · ${formatBdt(totalCost)}`}
              </span>
            </button>
          </div>
        </div>
      </div>

      {/* Rules & Conditions + Order Cancellation & Refund Policy */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="dh-card rounded-3xl p-5 space-y-2.5">
          <h2 className="text-sm font-extrabold text-[#172033] flex items-center gap-2">
            <FileText className="w-4 h-4 text-[#FF8500]" />
            <span>{t(lang, 'rulesAndConditions')}</span>
          </h2>
          <ul className="space-y-1.5 text-xs text-[#777777] list-disc pl-4 leading-relaxed">
            {rules.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
        <div className="dh-card rounded-3xl p-5 space-y-2.5">
          <h2 className="text-sm font-extrabold text-[#172033] flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-[#059669]" />
            <span>{t(lang, 'refundPolicyTitle')}</span>
          </h2>
          <ul className="space-y-1.5 text-xs text-[#777777] list-disc pl-4 leading-relaxed">
            {refundPolicy.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </div>
      </section>

      {/* Inline Instant Checkout Panel */}
      {(checkoutOpen || doneOrderNumber) && (
        <div ref={checkoutSectionRef} className="dh-card rounded-3xl p-5 sm:p-7 space-y-5 border-[#FF8500]/40">
          {doneOrderNumber ? (
            <div className="py-6 text-center space-y-3">
              <div className="w-14 h-14 rounded-full bg-emerald-100 text-[#16A34A] flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-xl font-extrabold text-[#172033]">
                {lang === 'bn' ? 'অর্ডার জমা হয়েছে' : 'Order Submitted'}
              </h2>
              <p className="text-sm font-mono-num font-bold text-[#FF8500]">#{doneOrderNumber}</p>
              <p className="text-xs sm:text-sm text-[#777777] max-w-md mx-auto">
                {method === 'wallet'
                  ? lang === 'bn'
                    ? 'ওয়ালেট পেমেন্ট সম্পন্ন হয়ে অর্ডার প্রসেসিং-এ আছে।'
                    : 'Wallet payment processed. Your order is now Processing.'
                  : t(lang, 'manualVerificationNotice')}
              </p>
              <div className="pt-2 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => onNavigate('orders')}
                  className="px-5 py-2.5 rounded-xl dh-orange-gradient text-white text-xs font-bold"
                >
                  {lang === 'bn' ? 'আমার অর্ডার দেখুন' : 'Track in My Orders'}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmitOrder} className="space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E6ECFA]">
                <div>
                  <h2 className="text-lg font-extrabold text-[#172033]">{t(lang, 'checkoutTitle')}</h2>
                  <p className="text-xs text-[#777777]">
                    {lang === 'bn' ? product.titleBn : product.titleEn}
                    {activePackage ? ` — ${lang === 'bn' ? activePackage.nameBn : activePackage.nameEn}` : ''} ×{' '}
                    {quantity}
                  </p>
                </div>
                <span className="text-2xl font-extrabold font-mono-num text-[#FF8500]">{formatBdt(totalCost)}</span>
              </div>

              {!user && (
                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs font-bold text-[#172033]">{t(lang, 'loginRequiredDesc')}</p>
                  <button
                    type="button"
                    onClick={onOpenAuth}
                    className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold shrink-0"
                  >
                    {t(lang, 'signIn')}
                  </button>
                </div>
              )}

              {/* Service-Specific Form Fields */}
              <ServiceOrderFormFields
                product={product}
                selectedPackage={activePackage}
                quantity={quantity}
                lang={lang}
                values={serviceValues}
                onChange={setServiceValues}
                referenceAttachmentUrl={referenceAttachmentUrl}
                onReferenceAttachmentChange={setReferenceAttachmentUrl}
              />

              {/* Payment Method Split: Option 1 Wallet Pay vs Option 2 Instant Pay */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-[#172033]">
                  {t(lang, 'selectPaymentMethod')}
                </label>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  {/* Option 1: Wallet Pay */}
                  <div className="md:col-span-5">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#777777] mb-1.5">
                      {lang === 'bn' ? 'অপশন ১ · ওয়ালেট পেমেন্ট' : 'Option 1 · Wallet Pay'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setMethod('wallet')}
                      className={`w-full p-3 rounded-2xl border text-left transition-all ${
                        method === 'wallet'
                          ? 'border-[#FF8500] bg-[#FFF7EE] ring-2 ring-[#FF8500]/20'
                          : 'border-[#E6ECFA] bg-white hover:border-[#FF8500]/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <PaymentProviderLogo method="wallet" compact />
                        <span className="text-xs font-mono-num font-extrabold text-[#172033]">
                          ৳{walletBalance.toFixed(2)}
                        </span>
                      </div>
                      <p
                        className={`text-[10px] font-semibold mt-1.5 ${
                          walletSufficient ? 'text-[#059669]' : 'text-[#DC2626]'
                        }`}
                      >
                        {walletSufficient
                          ? lang === 'bn'
                            ? 'ব্যালেন্স পর্যাপ্ত — তাৎক্ষণিক পেমেন্ট সম্ভব'
                            : 'Sufficient balance — Instant confirmation'
                          : lang === 'bn'
                            ? `আরও ৳${Math.max(1, totalCost - walletBalance)} প্রয়োজন`
                            : `Need ৳${Math.max(1, totalCost - walletBalance)} more in wallet`}
                      </p>
                    </button>
                  </div>

                  {/* Option 2: Instant Pay (bKash / Nagad / Rocket) */}
                  <div className="md:col-span-7">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-[#777777] mb-1.5">
                      {lang === 'bn' ? 'অপশন ২ · ইনস্ট্যান্ট পে (মোবাইল ব্যাংকিং)' : 'Option 2 · Instant Pay (bKash / Nagad / Rocket)'}
                    </p>
                    <PaymentMethodCardsGrid
                      settings={settings}
                      paymentMethods={paymentMethods}
                      lang={lang}
                      selectedMethod={method}
                      onSelect={(m) => setMethod(m)}
                      compact
                    />
                  </div>
                </div>
              </div>

              {method === 'wallet' ? (
                <div className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 text-xs">
                    <Wallet className="w-5 h-5 text-[#FF8500] shrink-0" />
                    <div>
                      <p className="font-bold text-[#172033]">
                        {lang === 'bn' ? 'যাচাইকৃত ওয়ালেট ব্যালেন্স:' : 'Verified Wallet Balance:'}{' '}
                        <span className="font-mono-num text-[#FF8500]">৳{walletBalance.toFixed(2)}</span>
                      </p>
                      <p className="text-[#777777]">
                        {walletSufficient
                          ? lang === 'bn'
                            ? `কনফার্ম করলে ৳${totalCost} কেটে নেওয়া হবে।`
                            : `Confirming will instantly deduct ৳${totalCost} and start processing.`
                          : lang === 'bn'
                            ? 'ব্যালেন্স কম থাকলে প্রথমে অ্যাড মানি করুন বা বিকাশ/নগদ/রকেট নির্বাচন করুন।'
                            : 'Top up your wallet via Add Money or pick bKash / Nagad / Rocket.'}
                      </p>
                    </div>
                  </div>
                  {!walletSufficient && (
                    <button
                      type="button"
                      onClick={() => onNavigate('add-money')}
                      className="px-4 py-2 rounded-xl bg-[#172033] text-white text-xs font-bold hover:bg-[#FF8500] transition-colors shrink-0"
                    >
                      {t(lang, 'navAddMoney')}
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <SelectedPaymentInstructionCard
                    method={method}
                    settings={settings}
                    paymentMethods={paymentMethods}
                    amountBdt={totalCost}
                    lang={lang}
                    copied={copiedNum}
                    onCopy={handleCopyNumber}
                  />

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-[#172033] mb-1">
                        {t(lang, 'senderNumberLabel')}
                      </label>
                      <input
                        type="tel"
                        required
                        value={senderNumber}
                        onChange={(e) => setSenderNumber(e.target.value)}
                        placeholder="01XXXXXXXXX"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num focus:outline-none focus:border-[#FF8500]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-[#172033] mb-1">
                        {t(lang, 'txIdLabel')}
                      </label>
                      <input
                        type="text"
                        required
                        value={txId}
                        onChange={(e) => setTxId(e.target.value.toUpperCase())}
                        placeholder="TXN9B72K..."
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num uppercase focus:outline-none focus:border-[#FF8500]"
                      />
                    </div>
                  </div>

                  <ReceiptScreenshotUploadBox
                    receiptDataUrl={receiptDataUrl}
                    lang={lang}
                    onFileChange={handleReceiptChange}
                    onClear={() => setReceiptDataUrl('')}
                  />

                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#FF8500]" />
                    <span>{t(lang, 'manualVerificationNotice')}</span>
                  </div>
                </>
              )}

              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-semibold">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || !activePkgPurchasable || (method === 'wallet' && !walletSufficient)}
                className="w-full py-3 rounded-xl dh-orange-gradient text-white font-extrabold text-sm shadow-md hover:opacity-95 disabled:opacity-60"
              >
                {submitting
                  ? '...'
                  : !activePkgPurchasable
                    ? t(lang, 'outOfStock')
                    : `${t(lang, 'submitPayment')} · ${formatBdt(totalCost)}`}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Product Page Automatic Ad Placements */}
      <ManagedPlacementSlot
        placement="product_page"
        units={managedAdUnits}
        adsEnabled={settings.adsEnabled}
        lang={lang}
        variant="banner"
      />
      <BannerSlotView
        slot="product_page"
        banners={banners}
        adNetworks={adNetworks}
        adsEnabled={settings.adsEnabled}
        lang={lang}
      />
      <NativeAdRow
        placement="product_page"
        advertisements={advertisements}
        adNetworks={adNetworks}
        adsEnabled={settings.adsEnabled}
        lang={lang}
        maxCards={3}
      />

      {/* Verified Customer Reviews */}
      {productReviews.length > 0 && (
        <section className="dh-card rounded-3xl p-5 sm:p-6 space-y-3">
          <h2 className="text-lg font-extrabold text-[#172033]">{t(lang, 'customerReviews')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {productReviews.map((rev) => (
              <div key={rev.id} className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#172033]">{rev.authorName}</span>
                  <span className="inline-flex items-center gap-0.5 text-[#FF8500] font-bold">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    {rev.rating}/5
                  </span>
                </div>
                <p className="text-[#777777]">{rev.comment}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Related Services */}
      {relatedProducts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-extrabold text-[#172033]">{t(lang, 'relatedServices')}</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
            {relatedProducts.map((rp) => (
              <ProductCard
                key={rp.id}
                product={rp}
                lang={lang}
                onSelect={onSelectProduct}
                onQuickOrder={onQuickOrder}
                onAddToCart={(prod) => onAddToCart(prod, 1)}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
