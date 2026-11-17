import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Layers,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
  Star,
  Wallet,
  X,
} from 'lucide-react';
import {
  AdNetworkConfig,
  Advertisement,
  Banner,
  CheckoutPaymentMethod,
  Language,
  PaymentMethod,
  Product,
  ProductPackage,
  Review,
  SiteSettings,
  UserProfile,
  WalletAccount,
} from '../types/marketplace';
import { t } from '../lib/i18n';
import { PaymentProviderLogo, ProductVisualArtwork, ServiceBrandLogo } from './BrandLogos';
import {
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
  getNormalizedPackages,
  getProductOrderFormType,
  getProductStockCount,
  getRulesAndRefundPoints,
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

interface ProductCheckoutModalProps {
  product: Product | null;
  initialTab?: 'details' | 'checkout';
  onClose: () => void;
  lang: Language;
  settings: SiteSettings;
  user: User | null;
  profile: UserProfile | null;
  wallet: WalletAccount | null;
  banners: Banner[];
  advertisements?: Advertisement[];
  adNetworks?: AdNetworkConfig[];
  reviews: Review[];
  onAddToCart: (product: Product, quantity: number, selectedPackage?: ProductPackage) => void;
  onOpenAuth: () => void;
  onOrderSuccess: () => void;
}

export function ProductCheckoutModal({
  product,
  initialTab = 'details',
  onClose,
  lang,
  settings,
  user,
  profile,
  wallet,
  banners,
  advertisements = [],
  adNetworks = [],
  reviews,
  onAddToCart,
  onOpenAuth,
  onOrderSuccess,
}: ProductCheckoutModalProps) {
  const [tab, setTab] = useState<'details' | 'checkout'>(initialTab);
  const [selectedPackage, setSelectedPackage] = useState<ProductPackage | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [method, setMethod] = useState<CheckoutPaymentMethod>('bkash');
  const [senderNumber, setSenderNumber] = useState('');
  const [txId, setTxId] = useState('');
  const [serviceValues, setServiceValues] = useState<ServiceOrderFieldValues>(() =>
    createInitialServiceOrderValues(user?.email || '', product || undefined)
  );
  const [referenceAttachmentUrl, setReferenceAttachmentUrl] = useState('');
  const [receiptDataUrl, setReceiptDataUrl] = useState('');
  const [copiedNum, setCopiedNum] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [doneOrderNumber, setDoneOrderNumber] = useState('');

  useEffect(() => {
    const pkgs = product ? getNormalizedPackages(product) : [];
    setTab(initialTab);
    setQuantity(1);
    setError('');
    setDoneOrderNumber('');
    setReferenceAttachmentUrl('');
    setSelectedPackage(pkgs[0] || null);
    setServiceValues(createInitialServiceOrderValues(user?.email || '', product || undefined));
  }, [product?.id, initialTab]);

  useEffect(() => {
    if (user?.email && !serviceValues.deliveryEmail) {
      setServiceValues((prev) => ({ ...prev, deliveryEmail: user.email || '' }));
    }
  }, [user?.email]);

  useEffect(() => {
    if (method === 'wallet') return;
    const isEnabled =
      method === 'bkash'
        ? settings.bkashEnabled !== false
        : method === 'nagad'
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
      setMethod(next || 'wallet');
    }
  }, [settings.bkashEnabled, settings.nagadEnabled, settings.rocketEnabled, method]);

  const productReviews = useMemo(
    () => (product ? reviews.filter((r) => r.productId === product.id && r.approved) : []),
    [reviews, product]
  );

  if (!product) return null;

  const packages = getNormalizedPackages(product);
  const activePackage = selectedPackage || packages[0];
  const unitPrice = activePackage ? activePackage.priceBdt : product.priceBdt;
  const originalUnitPrice = activePackage?.originalPriceBdt ?? product.originalPriceBdt;
  const totalCost = Math.max(1, unitPrice * quantity);
  const stockCount = getProductStockCount(product);
  const formType = getProductOrderFormType(product);
  const { rules, refundPolicy } = getRulesAndRefundPoints(product, lang);
  const walletBalance = wallet?.availableBalanceBdt || 0;
  const walletSufficient = walletBalance >= totalCost;

  const receiverNumber =
    method === 'bkash'
      ? settings.bkashNumber
      : method === 'nagad'
        ? settings.nagadNumber
        : settings.rocketNumber;

  const handleCopy = () => {
    navigator.clipboard.writeText(receiverNumber).catch(() => {});
    setCopiedNum(true);
    setTimeout(() => setCopiedNum(false), 1800);
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

  const handleSubmitOrder = async (e: FormEvent) => {
    e.preventDefault();
    if (!product) return;
    setError('');
    if (!user) {
      onOpenAuth();
      return;
    }
    if (!user.emailVerified) {
      setError(t(lang, 'verifyEmailDesc'));
      return;
    }

    const validationErr = validateServiceOrderValues(formType, serviceValues, lang);
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
              ? 'পর্যাপ্ত ভেরিফায়েড ওয়ালেট ব্যালেন্স নেই।'
              : 'Insufficient verified wallet balance.'
          );
        }
        const res = await submitOrderWithWalletBalance({
          customerId: user.uid,
          customerEmail: user.email || '',
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
          customerEmail: user.email || '',
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
    <div className="fixed inset-0 z-50 bg-[#172033]/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
      <div className="w-full max-w-2xl bg-white rounded-3xl border border-[#E6ECFA] shadow-2xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E6ECFA] bg-[#FFF7EE] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTab('details')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                tab === 'details' ? 'bg-[#FF8500] text-white' : 'bg-white text-[#172033]'
              }`}
            >
              {lang === 'bn' ? 'সার্ভিস বিবরণ' : 'Details'}
            </button>
            <button
              type="button"
              onClick={() => setTab('checkout')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                tab === 'checkout' ? 'bg-[#FF8500] text-white' : 'bg-white text-[#172033]'
              }`}
            >
              {t(lang, 'buyNow')}
            </button>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white border border-[#E6ECFA] text-[#777777] hover:text-[#172033]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {doneOrderNumber ? (
            <div className="py-10 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-[#16A34A] flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <h3 className="text-xl font-bold text-[#172033]">
                {lang === 'bn' ? 'অর্ডার জমা হয়েছে' : 'Order Submitted'}
              </h3>
              <p className="text-sm font-mono-num font-bold text-[#FF8500]">#{doneOrderNumber}</p>
              <p className="text-xs sm:text-sm text-[#777777] max-w-md mx-auto">
                {method === 'wallet'
                  ? lang === 'bn'
                    ? 'ওয়ালেট পেমেন্ট সম্পন্ন হয়ে অর্ডার প্রসেসিং-এ আছে।'
                    : 'Wallet payment processed. Your order is now Processing.'
                  : t(lang, 'manualVerificationNotice')}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="px-6 py-2.5 rounded-xl dh-orange-gradient text-white font-bold text-sm"
              >
                {lang === 'bn' ? 'বন্ধ করুন' : 'Close'}
              </button>
            </div>
          ) : tab === 'details' ? (
            <>
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="w-full sm:w-44 h-44 rounded-2xl overflow-hidden border border-[#E6ECFA] shrink-0">
                  <ProductVisualArtwork product={product} lang={lang} variant="card" />
                </div>
                <div className="flex-1 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {product.subcategoryEn && (
                      <span className="text-[#FF8500] text-[10px] font-bold uppercase tracking-wide">
                        {lang === 'bn' ? product.subcategoryBn || product.subcategoryEn : product.subcategoryEn}
                      </span>
                    )}
                    {product.discountPercent ? (
                      <span className="px-2 py-0.5 rounded-md bg-[#DC2626] text-white text-[11px] font-bold">
                        -{product.discountPercent}%
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1 text-emerald-700 text-[11px] font-bold">
                      <PackageCheck className="w-3.5 h-3.5" />
                      {stockCount} {lang === 'bn' ? 'স্টক' : 'Stock'}
                    </span>
                    <span className="inline-flex items-center gap-1 text-xs text-[#777777]">
                      <Clock className="w-3.5 h-3.5 text-[#FF8500]" />
                      {lang === 'bn' ? product.deliveryDurationBn : product.deliveryDurationEn}
                    </span>
                  </div>

                  <div className="flex items-start gap-2.5">
                    {(product.brandKey || product.customLogoUrl) && (
                      <ServiceBrandLogo
                        brandKey={product.brandKey}
                        customLogoUrl={product.customLogoUrl}
                        size={42}
                      />
                    )}
                    <h2 className="text-lg sm:text-xl font-bold text-[#172033] leading-snug">
                      {lang === 'bn' ? product.titleBn : product.titleEn}
                    </h2>
                  </div>

                  <div className="flex flex-wrap items-baseline gap-2.5">
                    <span className="text-2xl font-extrabold font-mono-num text-[#FF8500]">
                      ৳{unitPrice}
                    </span>
                    {originalUnitPrice && originalUnitPrice > 0 && originalUnitPrice !== unitPrice && (
                      <span className="px-2 py-0.5 rounded-md bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num text-[#777777]">
                        {t(lang, 'originalPriceLabel')}: ৳{originalUnitPrice}
                      </span>
                    )}
                    {activePackage && (
                      <span className="text-xs font-bold text-[#172033] bg-[#FFF3E5] px-2 py-0.5 rounded-md">
                        {lang === 'bn' ? activePackage.nameBn : activePackage.nameEn}
                      </span>
                    )}
                  </div>

                  {(product.validityBn || product.validityEn) && (
                    <p className="text-xs font-semibold text-[#172033] bg-[#FFF7EE] border border-[#FF8500]/20 px-3 py-1.5 rounded-xl">
                      {t(lang, 'validityLabel')}:{' '}
                      {lang === 'bn' ? product.validityBn || product.validityEn : product.validityEn || product.validityBn}
                    </p>
                  )}

                  <p className="text-xs sm:text-sm text-[#777777] leading-relaxed">
                    {lang === 'bn' ? product.descriptionBn : product.descriptionEn}
                  </p>
                </div>
              </div>

              {/* Dynamic MangoTopUp-Style Select Package / Recharge */}
              <div className="space-y-2.5 pt-1">
                <div className="flex items-center gap-1.5 text-xs font-extrabold text-[#172033] uppercase tracking-wide">
                  <Layers className="w-4 h-4 text-[#FF8500]" />
                  <span>{t(lang, 'selectPackage')}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {packages.map((pkg) => {
                    const isSel = activePackage?.id === pkg.id;
                    return (
                      <button
                        key={pkg.id}
                        type="button"
                        onClick={() => setSelectedPackage(pkg)}
                        className={`p-3 rounded-2xl border text-left transition-all relative ${
                          isSel
                            ? 'border-[#FF8500] bg-[#FFF7EE] ring-2 ring-[#FF8500]/20'
                            : 'border-[#E6ECFA] bg-[#F3F6FF] hover:border-[#FF8500]/60'
                        }`}
                      >
                        {pkg.tag && (
                          <span className="inline-block px-1.5 py-0.5 rounded bg-[#FF8500] text-white text-[9px] font-extrabold uppercase mb-1">
                            {pkg.tag}
                          </span>
                        )}
                        <p className="text-xs font-bold text-[#172033] leading-snug">
                          {lang === 'bn' ? pkg.nameBn : pkg.nameEn}
                        </p>
                        <div className="flex items-baseline gap-1.5 mt-1">
                          <span className="text-sm font-extrabold font-mono-num text-[#FF8500]">
                            ৳{pkg.priceBdt}
                          </span>
                          {pkg.originalPriceBdt && pkg.originalPriceBdt > 0 && pkg.originalPriceBdt !== pkg.priceBdt && (
                            <span className="text-[10px] font-mono-num text-[#777777]">
                              {pkg.originalPriceBdt > pkg.priceBdt ? (
                                <span className="line-through">৳{pkg.originalPriceBdt}</span>
                              ) : (
                                <span>(Base ৳{pkg.originalPriceBdt})</span>
                              )}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {(product.benefitsBn || product.benefitsEn || product.instructionsBn || product.instructionsEn) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  {(product.benefitsBn || product.benefitsEn) && (
                    <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA]">
                      <p className="font-bold text-[#172033] mb-1">
                        {lang === 'bn' ? 'সুবিধাসমূহ' : 'Key Benefits'}
                      </p>
                      <p className="text-[#777777]">{lang === 'bn' ? product.benefitsBn : product.benefitsEn}</p>
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

              {/* Rules & Conditions + Refund Summary */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-1.5">
                  <p className="font-bold text-[#172033] flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-[#FF8500]" />
                    {t(lang, 'rulesAndConditions')}
                  </p>
                  <ul className="space-y-1 text-[#777777] list-disc pl-4">
                    {rules.slice(0, 2).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
                <div className="p-3.5 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/20 space-y-1.5">
                  <p className="font-bold text-[#172033] flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-[#059669]" />
                    {t(lang, 'refundPolicyTitle')}
                  </p>
                  <ul className="space-y-1 text-[#777777] list-disc pl-4">
                    {refundPolicy.slice(0, 2).map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Quantity + Action Buttons */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <div className="flex items-center gap-2 bg-[#F3F6FF] px-3 py-1.5 rounded-xl border border-[#E6ECFA]">
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
                    onClick={() => setQuantity((q) => Math.min(20, q + 1))}
                    className="w-7 h-7 rounded-lg bg-white font-bold text-[#172033]"
                  >
                    +
                  </button>
                </div>

                <button
                  type="button"
                  disabled={product.availability === 'out_of_stock'}
                  onClick={() => {
                    onAddToCart(product, quantity, activePackage);
                    onClose();
                  }}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-[#172033] text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 hover:bg-[#23314d] disabled:opacity-50"
                >
                  <ShoppingCart className="w-4 h-4" />
                  {t(lang, 'addToCart')}
                </button>

                <button
                  type="button"
                  disabled={product.availability === 'out_of_stock'}
                  onClick={() => setTab('checkout')}
                  className="flex-1 py-2.5 px-4 rounded-xl dh-orange-gradient text-white text-xs sm:text-sm font-bold flex items-center justify-center gap-2 shadow-sm hover:opacity-95 disabled:opacity-50"
                >
                  <ShieldCheck className="w-4 h-4" />
                  {t(lang, 'buyNow')} · ৳{totalCost}
                </button>
              </div>

              {/* Product Page Ad Placement */}
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
                maxCards={2}
              />

              {/* Verified Customer Reviews */}
              {productReviews.length > 0 && (
                <div className="space-y-2.5 pt-2">
                  <h4 className="text-sm font-bold text-[#172033]">{t(lang, 'customerReviews')}</h4>
                  {productReviews.map((rev) => (
                    <div key={rev.id} className="p-3 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs">
                      <div className="flex items-center justify-between mb-1">
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
              )}
            </>
          ) : (
            <form onSubmit={handleSubmitOrder} className="space-y-4">
              <div className="p-3.5 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/25 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  {(product.brandKey || product.customLogoUrl) && (
                    <ServiceBrandLogo
                      brandKey={product.brandKey}
                      customLogoUrl={product.customLogoUrl}
                      size={36}
                    />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[#172033] truncate">
                      {lang === 'bn' ? product.titleBn : product.titleEn}
                      {activePackage ? ` — ${lang === 'bn' ? activePackage.nameBn : activePackage.nameEn}` : ''} ×{' '}
                      {quantity}
                    </p>
                    <p className="text-[11px] text-[#777777]">
                      {lang === 'bn' ? product.deliveryDurationBn : product.deliveryDurationEn}
                      {originalUnitPrice && originalUnitPrice > 0
                        ? ` · ${t(lang, 'originalPriceLabel')}: ৳${originalUnitPrice} → ${t(lang, 'websitePriceLabel')}: ৳${unitPrice}`
                        : ''}
                    </p>
                  </div>
                </div>
                <p className="text-xl font-extrabold font-mono-num text-[#FF8500] shrink-0">৳{totalCost}</p>
              </div>

              {!user && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-[#172033]">{t(lang, 'loginRequiredDesc')}</span>
                  <button
                    type="button"
                    onClick={onOpenAuth}
                    className="px-3.5 py-1.5 rounded-lg dh-orange-gradient text-white font-bold shrink-0"
                  >
                    {t(lang, 'signIn')}
                  </button>
                </div>
              )}

              {/* Dynamic Service-Specific Order Fields */}
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

              {/* Split Payment Option: Wallet Pay vs Instant Pay */}
              <div className="space-y-2.5">
                <label className="block text-xs font-bold text-[#172033]">
                  {t(lang, 'selectPaymentMethod')}
                </label>

                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => setMethod('wallet')}
                    className={`w-full p-2.5 rounded-xl border text-left transition-all ${
                      method === 'wallet'
                        ? 'border-[#FF8500] bg-[#FFF7EE] ring-2 ring-[#FF8500]/20'
                        : 'border-[#E6ECFA] bg-white hover:border-[#FF8500]/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <PaymentProviderLogo method="wallet" compact settings={settings} />
                      <span className="text-xs font-mono-num font-bold text-[#172033]">
                        ৳{walletBalance.toFixed(2)}
                      </span>
                    </div>
                  </button>

                  <PaymentMethodCardsGrid
                    settings={settings}
                    lang={lang}
                    selectedMethod={method}
                    onSelect={(m) => setMethod(m)}
                    compact
                  />
                </div>
              </div>

              {method === 'wallet' ? (
                <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs flex items-center gap-2.5">
                  <Wallet className="w-4 h-4 text-[#FF8500] shrink-0" />
                  <p className={walletSufficient ? 'text-[#172033]' : 'text-[#DC2626] font-semibold'}>
                    {walletSufficient
                      ? lang === 'bn'
                        ? `যাচাইকৃত ব্যালেন্স ৳${walletBalance.toFixed(2)} থেকে ৳${totalCost} তাৎক্ষণিক পরিশোধ হবে।`
                        : `৳${totalCost} will be deducted from your verified ৳${walletBalance.toFixed(2)} wallet balance.`
                      : lang === 'bn'
                        ? `পর্যাপ্ত ব্যালেন্স নেই (আরও ৳${totalCost - walletBalance} প্রয়োজন)।`
                        : `Insufficient wallet balance (short by ৳${totalCost - walletBalance}). Switch to bKash/Nagad/Rocket.`}
                  </p>
                </div>
              ) : (
                <>
                  <SelectedPaymentInstructionCard
                    method={method}
                    settings={settings}
                    amountBdt={totalCost}
                    lang={lang}
                    copied={copiedNum}
                    onCopy={handleCopy}
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
                        className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num focus:outline-none focus:border-[#FF8500]"
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
                        className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num uppercase focus:outline-none focus:border-[#FF8500]"
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
                disabled={submitting || (method === 'wallet' && !walletSufficient)}
                className="w-full py-3 rounded-xl dh-orange-gradient text-white font-bold text-sm shadow-md hover:opacity-95 disabled:opacity-60"
              >
                {submitting ? '...' : `${t(lang, 'submitPayment')} · ৳${totalCost}`}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
