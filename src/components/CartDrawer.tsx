import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Lock,
  Minus,
  Plus,
  ShoppingCart,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  AuthUser,
  CartItem,
  CheckoutPaymentMethod,
  Coupon,
  Language,
  PaymentMethod,
  SiteSettings,
  UserProfile,
  WalletAccount,
} from '../types/marketplace';
import { t } from '../lib/i18n';
import { PaymentProviderLogo, ProductVisualArtwork } from './BrandLogos';
import {
  PaymentMethodCardsGrid,
  ReceiptScreenshotUploadBox,
  SelectedPaymentInstructionCard,
} from './PremiumPaymentSection';
import { getProductOrderFormType } from '../lib/catalogHelpers';
import {
  compressImageToDataUrl,
  submitOrderWithManualPayment,
  submitOrderWithWalletBalance,
  validateTransactionIdServer,
} from '../lib/firestoreService';

export function getCartItemKey(item: CartItem): string {
  return `${item.product.id}::${item.selectedPackage?.id || 'base'}`;
}

interface CartDrawerProps {
  open: boolean;
  onClose: () => void;
  items: CartItem[];
  onUpdateQty: (cartKey: string, qty: number) => void;
  onRemoveItem: (cartKey: string) => void;
  onClearCart: () => void;
  coupons: Coupon[];
  settings: SiteSettings;
  lang: Language;
  user: AuthUser | null;
  profile: UserProfile | null;
  wallet: WalletAccount | null;
  onOpenAuth: () => void;
  onOrderSuccess: () => void;
}

export function CartDrawer({
  open,
  onClose,
  items,
  onUpdateQty,
  onRemoveItem,
  onClearCart,
  coupons,
  settings,
  lang,
  user,
  profile,
  wallet,
  onOpenAuth,
  onOrderSuccess,
}: CartDrawerProps) {
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<Coupon | null>(null);
  const [couponError, setCouponError] = useState('');
  const [method, setMethod] = useState<CheckoutPaymentMethod>('bkash');
  const [senderNumber, setSenderNumber] = useState('');
  const [txId, setTxId] = useState('');
  const [deliveryNote, setDeliveryNote] = useState('');
  const [referenceAttachmentUrl, setReferenceAttachmentUrl] = useState('');
  const [receiptDataUrl, setReceiptDataUrl] = useState('');
  const [copiedNum, setCopiedNum] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [completedOrder, setCompletedOrder] = useState<{ orderNumber: string; method: string } | null>(
    null
  );

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

  const hasDesignItem = useMemo(
    () => items.some((it) => getProductOrderFormType(it.product) === 'design'),
    [items]
  );

  const itemRequirementLines = useMemo(
    () =>
      items.map((it) => {
        const ft = getProductOrderFormType(it.product);
        const title = lang === 'bn' ? it.product.titleBn : it.product.titleEn;
        const pkg = it.selectedPackage
          ? ` (${lang === 'bn' ? it.selectedPackage.nameBn : it.selectedPackage.nameEn})`
          : '';
        let reqText = '';
        let templateLine = '';
        if (ft === 'freefire') {
          const isIndo =
            it.product.id === 'prod_ff_indo' || (it.product.brandKey || '').toLowerCase() === 'freefire_indo';
          reqText = lang === 'bn' ? 'Player UID + গেম সার্ভার' : 'Player UID + Game Server';
          templateLine = `${title}${pkg} x${it.quantity} — UID: [ENTER_UID], Server: ${isIndo ? 'Indonesia' : 'BD'}`;
        } else if (ft === 'pubg_uid') {
          reqText = lang === 'bn' ? 'Player ID / Tag + রিজিওন' : 'Player ID / Tag + Region';
          templateLine = `${title}${pkg} x${it.quantity} — Player ID: [ENTER_ID], Region: Global`;
        } else if (ft === 'telegram') {
          reqText = lang === 'bn' ? 'Telegram @username' : 'Telegram @username';
          templateLine = `${title}${pkg} x${it.quantity} — Telegram: @[USERNAME]`;
        } else if (ft === 'giftcard') {
          reqText = lang === 'bn' ? 'রিজিওন + ডেলিভারি ইমেইল' : 'Region + Delivery Email';
          templateLine = `${title}${pkg} x${it.quantity} — Region: USA, Email: ${user?.email || '[EMAIL]'}`;
        } else if (ft === 'social') {
          reqText = lang === 'bn' ? 'প্রোফাইল / পোস্ট লিংক (URL)' : 'Public Profile / Post URL';
          templateLine = `${title}${pkg} x${it.quantity} — Link: https://...`;
        } else if (ft === 'design') {
          reqText = lang === 'bn' ? 'প্রজেক্ট নির্দেশনা + ডেলিভারি ইমেইল' : 'Project Brief + Delivery Email';
          templateLine = `${title}${pkg} x${it.quantity} — Brief: [DETAILS], Email: ${user?.email || '[EMAIL]'}`;
        } else {
          reqText = lang === 'bn' ? 'ডেলিভারি ইমেইল + WhatsApp/Telegram' : 'Delivery Email + WhatsApp/TG';
          templateLine = `${title}${pkg} x${it.quantity} — Email: ${user?.email || '[EMAIL]'}, Contact: [WA/TG]`;
        }
        return { key: getCartItemKey(it), title: `${title}${pkg}`, reqText, templateLine };
      }),
    [items, lang, user?.email]
  );

  const subtotal = useMemo(
    () =>
      items.reduce(
        (sum, it) => sum + (it.selectedPackage?.priceBdt ?? it.product.priceBdt) * it.quantity,
        0
      ),
    [items]
  );

  const discountBdt = useMemo(() => {
    if (!appliedCoupon || subtotal < appliedCoupon.minOrderBdt) return 0;
    if (appliedCoupon.discountType === 'percent') {
      return Math.min(subtotal, Math.round((subtotal * appliedCoupon.discountValue) / 100));
    }
    return Math.min(subtotal, appliedCoupon.discountValue);
  }, [appliedCoupon, subtotal]);

  const finalTotal = Math.max(1, subtotal - discountBdt);

  const receiverNumber =
    method === 'bkash'
      ? settings.bkashNumber
      : method === 'nagad'
        ? settings.nagadNumber
        : settings.rocketNumber;

  if (!open) return null;

  const handleApplyCoupon = () => {
    setCouponError('');
    const code = couponInput.trim().toUpperCase();
    const today = new Date().toISOString().slice(0, 10);
    const found = coupons.find((c) => c.code.toUpperCase() === code && c.active);
    if (!found) {
      setAppliedCoupon(null);
      setCouponError(lang === 'bn' ? 'সঠিক কুপন কোড নয়' : 'Invalid or inactive coupon code');
      return;
    }
    if (found.expiresAt && found.expiresAt < today) {
      setAppliedCoupon(null);
      setCouponError(lang === 'bn' ? 'কুপনের মেয়াদ শেষ হয়েছে' : 'This coupon has expired');
      return;
    }
    if (found.usedCount >= found.usageLimit) {
      setAppliedCoupon(null);
      setCouponError(lang === 'bn' ? 'কুপন ব্যবহারের সীমা শেষ' : 'Coupon usage limit reached');
      return;
    }
    if (subtotal < found.minOrderBdt) {
      setAppliedCoupon(null);
      setCouponError(
        lang === 'bn'
          ? `ন্যূনতম অর্ডার ৳${found.minOrderBdt} প্রয়োজন`
          : `Minimum order ৳${found.minOrderBdt} required`
      );
      return;
    }
    setAppliedCoupon(found);
  };

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
      setError(lang === 'bn' ? 'রিসিট ছবি প্রক্রিয়া করা যায়নি' : 'Failed to process receipt image');
    }
  };

  const handleReferenceChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await compressImageToDataUrl(file, 960);
      setReferenceAttachmentUrl(url);
    } catch {
      setError(lang === 'bn' ? 'রেফারেন্স ছবি প্রক্রিয়া করা যায়নি' : 'Failed to process reference image');
    }
  };

  const handleCheckout = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (items.length === 0) return;
    if (!user) {
      onOpenAuth();
      return;
    }

    setSubmitting(true);
    try {
      if (method === 'wallet') {
        if (!wallet || wallet.availableBalanceBdt < finalTotal) {
          throw new Error(
            lang === 'bn'
              ? 'পর্যাপ্ত ভেরিফায়েড ওয়ালেট ব্যালেন্স নেই। অনুগ্রহ করে অ্যাড মানি করুন অথবা বিকাশ/নগদ/রকেট ব্যবহার করুন।'
              : 'Insufficient verified wallet balance. Please Add Money or pay with bKash/Nagad/Rocket.'
          );
        }
        const res = await submitOrderWithWalletBalance({
          customerId: user.uid,
          customerEmail: user.phone || user.email || '',
          customerName: profile?.displayName || user.displayName || 'Customer',
          wallet,
          items,
          couponCode: appliedCoupon?.code,
          discountBdt,
          totalPriceBdt: finalTotal,
          deliveryNote,
          referenceAttachmentUrl,
        });
        setCompletedOrder({ orderNumber: res.orderNumber, method: 'Wallet Balance' });
      } else {
        const cleanTx = await validateTransactionIdServer({
          transactionId: txId,
          senderNumber,
          method,
        });
        const res = await submitOrderWithManualPayment({
          customerId: user.uid,
          customerEmail: user.phone || user.email || '',
          customerName: profile?.displayName || user.displayName || 'Customer',
          items,
          couponCode: appliedCoupon?.code,
          discountBdt,
          totalPriceBdt: finalTotal,
          method: method as PaymentMethod,
          receiverNumber,
          senderNumber,
          transactionId: cleanTx,
          deliveryNote,
          receiptDataUrl,
          referenceAttachmentUrl,
        });
        setCompletedOrder({ orderNumber: res.orderNumber, method: method.toUpperCase() });
      }
      setReferenceAttachmentUrl('');
      onClearCart();
      onOrderSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#172033]/60 backdrop-blur-xs flex justify-end">
      <div className="w-full max-w-lg bg-white h-full flex flex-col shadow-2xl">
        <div className="px-5 py-4 border-b border-[#E6ECFA] flex items-center justify-between bg-[#FFF7EE]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl dh-orange-gradient text-white flex items-center justify-center">
              <ShoppingCart className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#172033]">{t(lang, 'checkoutTitle')}</h2>
              <p className="text-xs text-[#777777]">
                {items.length} {lang === 'bn' ? 'টি আইটেম' : 'item(s) in cart'}
              </p>
            </div>
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
          {completedOrder ? (
            <div className="py-10 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-[#16A34A] flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <h3 className="text-xl font-bold text-[#172033]">
                {lang === 'bn' ? 'অর্ডার সফলভাবে জমা হয়েছে!' : 'Order Submitted Successfully!'}
              </h3>
              <p className="text-sm font-mono-num font-bold text-[#FF8500]">
                #{completedOrder.orderNumber}
              </p>
              <p className="text-xs sm:text-sm text-[#777777] max-w-sm mx-auto">
                {completedOrder.method === 'Wallet Balance'
                  ? lang === 'bn'
                    ? 'আপনার ওয়ালেট থেকে পেমেন্ট সম্পন্ন হয়েছে এবং অর্ডার প্রসেসিং-এ রয়েছে।'
                    : 'Paid via Wallet Balance. Your order is now Processing.'
                  : t(lang, 'manualVerificationNotice')}
              </p>
              <button
                type="button"
                onClick={() => {
                  setCompletedOrder(null);
                  onClose();
                }}
                className="px-6 py-2.5 rounded-xl dh-orange-gradient text-white font-bold text-sm"
              >
                {lang === 'bn' ? 'ঠিক আছে' : 'Done'}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <ShoppingCart className="w-12 h-12 text-[#777777]/40 mx-auto" />
              <p className="text-sm font-semibold text-[#777777]">
                {lang === 'bn' ? 'আপনার কার্ট বর্তমানে খালি।' : 'Your shopping cart is empty.'}
              </p>
            </div>
          ) : (
            <>
              {/* Cart Items */}
              <div className="space-y-2.5">
                {items.map((item) => {
                  const key = getCartItemKey(item);
                  const unitPrice = item.selectedPackage?.priceBdt ?? item.product.priceBdt;
                  return (
                    <div
                      key={key}
                      className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex items-center gap-3"
                    >
                      <div className="w-16 h-12 rounded-xl overflow-hidden shrink-0 border border-[#E6ECFA] bg-[#172033]">
                        <ProductVisualArtwork product={item.product} lang={lang} variant="card" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-[#172033] truncate">
                          {lang === 'bn' ? item.product.titleBn : item.product.titleEn}
                        </p>
                        {item.selectedPackage && (
                          <span className="inline-block px-1.5 py-0.5 rounded bg-[#FFF3E5] text-[#FF8500] text-[10px] font-bold mb-0.5">
                            {lang === 'bn' ? item.selectedPackage.nameBn : item.selectedPackage.nameEn}
                          </span>
                        )}
                        <p className="text-xs font-mono-num font-bold text-[#FF8500]">
                          ৳{unitPrice} × {item.quantity} = ৳{unitPrice * item.quantity}
                        </p>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onUpdateQty(key, item.quantity - 1)}
                          className="w-7 h-7 rounded-lg bg-white border border-[#E6ECFA] flex items-center justify-center text-[#172033]"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="w-6 text-center text-xs font-bold font-mono-num">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => onUpdateQty(key, item.quantity + 1)}
                          className="w-7 h-7 rounded-lg bg-white border border-[#E6ECFA] flex items-center justify-center text-[#172033]"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveItem(key)}
                          className="p-1.5 text-[#DC2626] hover:bg-red-50 rounded-lg ml-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Coupon Box */}
              <div className="p-3.5 rounded-2xl border border-[#E6ECFA] bg-white space-y-2">
                <label className="text-xs font-bold text-[#172033] flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-[#FF8500]" />
                  {lang === 'bn' ? 'কুপন / প্রোমো কোড' : 'Coupon / Promo Code'}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    placeholder="WELCOME50 / HUB10"
                    className="flex-1 px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num uppercase focus:outline-none focus:border-[#FF8500]"
                  />
                  <button
                    type="button"
                    onClick={handleApplyCoupon}
                    className="px-4 py-2 rounded-xl bg-[#172033] text-white text-xs font-bold hover:bg-[#FF8500] transition-colors"
                  >
                    {lang === 'bn' ? 'প্রয়োগ করুন' : 'Apply'}
                  </button>
                </div>
                {couponError && <p className="text-xs text-[#DC2626] font-semibold">{couponError}</p>}
                {appliedCoupon && (
                  <p className="text-xs text-[#16A34A] font-semibold">
                    {appliedCoupon.code}: -৳{discountBdt} {lang === 'bn' ? 'ছাড় প্রয়োগ হয়েছে' : 'discount applied'}
                  </p>
                )}
              </div>

              {/* Price Summary */}
              <div className="p-4 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/25 space-y-1.5 text-sm">
                <div className="flex justify-between text-[#777777]">
                  <span>{lang === 'bn' ? 'মোট মূল্য' : 'Subtotal'}</span>
                  <span className="font-mono-num font-semibold">৳{subtotal}</span>
                </div>
                {discountBdt > 0 && (
                  <div className="flex justify-between text-[#16A34A]">
                    <span>{lang === 'bn' ? 'কুপন ছাড়' : 'Discount'}</span>
                    <span className="font-mono-num font-semibold">-৳{discountBdt}</span>
                  </div>
                )}
                <div className="flex justify-between text-[#172033] font-extrabold text-base pt-1.5 border-t border-[#FF8500]/20">
                  <span>{lang === 'bn' ? 'সর্বমোট পরিশোধযোগ্য' : 'Total Payable'}</span>
                  <span className="font-mono-num text-[#FF8500]">৳{finalTotal}</span>
                </div>
              </div>

              {/* Checkout Form */}
              <form onSubmit={handleCheckout} className="space-y-4">
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-[#172033]">
                    {t(lang, 'selectPaymentMethod')}
                  </label>

                  {/* Option 1: Wallet Pay */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-bold text-[#059669] uppercase tracking-wider">
                      {lang === 'bn' ? 'অপশন ১: ওয়ালেট পে (তাৎক্ষণিক)' : 'Option 1: Wallet Pay (Instant)'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setMethod('wallet')}
                      className={`w-full p-2.5 rounded-xl border flex items-center justify-between transition-all ${
                        method === 'wallet'
                          ? 'border-[#FF8500] bg-[#FFF7EE] ring-2 ring-[#FF8500]/20'
                          : 'border-[#E6ECFA] bg-white hover:border-[#FF8500]/50'
                      }`}
                    >
                      <PaymentProviderLogo method="wallet" compact />
                      <span
                        className={`text-xs font-mono-num font-bold ${
                          (wallet?.availableBalanceBdt || 0) >= finalTotal ? 'text-[#059669]' : 'text-[#DC2626]'
                        }`}
                      >
                        ৳{(wallet?.availableBalanceBdt || 0).toFixed(2)}
                      </span>
                    </button>
                  </div>

                  {/* Option 2: Instant Pay (bKash / Nagad / Rocket) */}
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-bold text-[#777777] uppercase tracking-wider">
                      {lang === 'bn'
                        ? 'অপশন ২: ইনস্ট্যান্ট পে (bKash / Nagad / Rocket)'
                        : 'Option 2: Instant Pay (bKash / Nagad / Rocket)'}
                    </p>
                    <PaymentMethodCardsGrid
                      settings={settings}
                      lang={lang}
                      selectedMethod={method}
                      onSelect={(m) => setMethod(m)}
                      compact
                    />
                  </div>
                </div>

                {method !== 'wallet' ? (
                  <>
                    <SelectedPaymentInstructionCard
                      method={method}
                      settings={settings}
                      amountBdt={finalTotal}
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
                          placeholder="TXN8A92K..."
                          className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num uppercase focus:outline-none focus:border-[#FF8500]"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-[#172033] mb-1">
                        {t(lang, 'receiptUploadLabel')}
                      </label>
                      <ReceiptScreenshotUploadBox
                        receiptDataUrl={receiptDataUrl}
                        lang={lang}
                        onFileChange={handleReceiptChange}
                        onClear={() => setReceiptDataUrl('')}
                      />
                    </div>

                    <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] flex items-start gap-2">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#FF8500]" />
                      <span>{t(lang, 'manualVerificationNotice')}</span>
                    </div>
                  </>
                ) : (
                  <div
                    className={`p-3.5 rounded-2xl border text-xs ${
                      (wallet?.availableBalanceBdt || 0) >= finalTotal
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                        : 'bg-red-50 border-red-200 text-[#DC2626]'
                    }`}
                  >
                    {(wallet?.availableBalanceBdt || 0) >= finalTotal
                      ? lang === 'bn'
                        ? `আপনার যাচাইকৃত ওয়ালেট ব্যালেন্স: ৳${(wallet?.availableBalanceBdt || 0).toFixed(2)}। কনফার্ম করলে ৳${finalTotal} সরাসরি কাটা হবে।`
                        : `Verified Wallet Balance: ৳${(wallet?.availableBalanceBdt || 0).toFixed(2)}. Submitting will debit ৳${finalTotal}.`
                      : lang === 'bn'
                        ? `পর্যাপ্ত ব্যালেন্স নেই (৳${(wallet?.availableBalanceBdt || 0).toFixed(2)})। আরও ৳${Math.max(1, Math.ceil(finalTotal - (wallet?.availableBalanceBdt || 0)))} অ্যাড মানি করুন অথবা bKash/Nagad/Rocket ব্যবহার করুন।`
                        : `Insufficient balance (৳${(wallet?.availableBalanceBdt || 0).toFixed(2)}). Short by ৳${Math.max(1, Math.ceil(finalTotal - (wallet?.availableBalanceBdt || 0)))} — please Add Money or use bKash/Nagad/Rocket.`}
                  </div>
                )}

                <div className="space-y-2.5">
                  {/* Required Account Info Guide per Cart Item */}
                  <div className="p-3 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-extrabold text-[#172033] flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-[#FF8500]" />
                        {lang === 'bn' ? 'প্রয়োজনীয় অ্যাকাউন্ট তথ্য' : 'Required Info per Item'}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setDeliveryNote(
                            itemRequirementLines.map((ln) => ln.templateLine).join('\n').slice(0, 1150)
                          )
                        }
                        className="px-2.5 py-1 rounded-lg bg-white border border-[#FF8500]/40 text-[10px] font-bold text-[#FF8500] hover:bg-[#FFF7EE]"
                      >
                        {lang === 'bn' ? 'টেমপ্লেট পূরণ করুন' : 'Insert Template'}
                      </button>
                    </div>
                    <ul className="space-y-1 text-[11px] text-[#777777]">
                      {itemRequirementLines.map((ln) => (
                        <li key={ln.key} className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold text-[#172033] truncate">{ln.title}</span>
                          <span className="shrink-0 font-mono-num text-[10px] text-[#FF8500]">{ln.reqText}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <label className="block text-xs font-bold text-[#172033]">
                        {t(lang, 'deliveryNoteLabel')}
                      </label>
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-[#059669]">
                        <Lock className="w-3 h-3" />
                        {lang === 'bn' ? 'পাসওয়ার্ড নয়' : 'Zero Passwords'}
                      </span>
                    </div>
                    <p className="text-[11px] text-[#059669] font-semibold mb-1.5">
                      {lang === 'bn'
                        ? 'নিরাপত্তা গ্যারান্টি: কখনোই পাসওয়ার্ড লিখবেন না (শুধু UID / @ইউজারনেম / ডেলিভারি ইমেইল বা লিংক দিন)।'
                        : 'Security notice: Never enter passwords — only Player UID, Server/Region, Telegram @username, URL, or Delivery Email.'}
                    </p>
                    <textarea
                      rows={3}
                      required
                      maxLength={1150}
                      value={deliveryNote}
                      onChange={(e) => setDeliveryNote(e.target.value)}
                      placeholder={
                        lang === 'bn'
                          ? 'প্রতিটি সার্ভিসের জন্য: Free Fire UID + Server, PUBG ID + Region, Telegram @username বা Delivery Email লিখুন...'
                          : 'For each item: Player UID + Server/Region, Telegram @username, Profile URL, or Delivery Email...'
                      }
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>

                  {hasDesignItem && (
                    <label className="flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-dashed border-[#FF8500]/50 bg-[#FFF7EE] text-xs font-semibold text-[#172033] cursor-pointer">
                      <Upload className="w-4 h-4 text-[#FF8500]" />
                      <span>
                        {referenceAttachmentUrl
                          ? lang === 'bn'
                            ? 'ডিজাইন রেফারেন্স ছবি সংযুক্ত হয়েছে'
                            : 'Design reference image attached'
                          : lang === 'bn'
                            ? 'ডিজাইন / ওয়েব রেফারেন্স ছবি (ঐচ্ছিক)'
                            : 'Design Reference Image / Sketch (Optional)'}
                      </span>
                      <input type="file" accept="image/*" onChange={handleReferenceChange} className="hidden" />
                    </label>
                  )}
                </div>

                {error && (
                  <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-semibold">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-3 rounded-xl dh-orange-gradient text-white font-bold text-sm shadow-md hover:opacity-95 disabled:opacity-60"
                >
                  {submitting ? '...' : `${t(lang, 'submitPayment')} · ৳${finalTotal}`}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
