import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ImageIcon,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Wallet,
} from 'lucide-react';
import {
  CheckoutPaymentMethod,
  Language,
  PaymentMethod,
  SiteSettings,
  UserProfile,
} from '../types/marketplace';
import { PAYMENT_BRAND_META, resolvePaymentLogoUrl } from './BrandLogos';
import {
  compressImageToDataUrl,
  submitAddMoneyDeposit,
  validateTransactionIdServer,
} from '../lib/firestoreService';
import { t } from '../lib/i18n';

export function getEnabledPaymentMethods(settings: SiteSettings): PaymentMethod[] {
  return (['bkash', 'nagad', 'rocket'] as PaymentMethod[]).filter((m) =>
    m === 'bkash'
      ? settings.bkashEnabled !== false
      : m === 'nagad'
        ? settings.nagadEnabled !== false
        : settings.rocketEnabled !== false
  );
}

export function getPaymentMethodDetails(method: PaymentMethod, settings: SiteSettings) {
  const brand = PAYMENT_BRAND_META[method];
  const number =
    method === 'bkash'
      ? settings.bkashNumber
      : method === 'nagad'
        ? settings.nagadNumber
        : settings.rocketNumber;
  const accountType =
    method === 'bkash'
      ? settings.bkashType || 'Personal'
      : method === 'nagad'
        ? settings.nagadType || 'Personal'
        : settings.rocketType || 'Personal';
  const noteBn =
    method === 'bkash'
      ? settings.bkashNoteBn
      : method === 'nagad'
        ? settings.nagadNoteBn
        : settings.rocketNoteBn;
  const noteEn =
    method === 'bkash'
      ? settings.bkashNoteEn
      : method === 'nagad'
        ? settings.nagadNoteEn
        : settings.rocketNoteEn;
  const logoUrl = resolvePaymentLogoUrl(method, settings);

  return {
    brand,
    number,
    accountType,
    noteBn,
    noteEn,
    logoUrl,
  };
}

interface PaymentCardsGridProps {
  settings: SiteSettings;
  lang: Language;
  selectedMethod: CheckoutPaymentMethod;
  onSelect: (method: PaymentMethod) => void;
  compact?: boolean;
}

export function PaymentMethodCardsGrid({
  settings,
  lang,
  selectedMethod,
  onSelect,
  compact = false,
}: PaymentCardsGridProps) {
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});
  const enabledMethods = getEnabledPaymentMethods(settings);

  if (enabledMethods.length === 0) {
    return (
      <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800 text-center">
        {lang === 'bn'
          ? 'বর্তমানে কোনো মোবাইল পেমেন্ট মাধ্যম সক্রিয় নেই।'
          : 'No mobile payment methods are currently enabled.'}
      </div>
    );
  }

  return (
    <div
      className={`grid gap-2.5 sm:gap-3 ${
        compact ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3'
      }`}
    >
      {enabledMethods.map((m) => {
        const { brand, number, accountType, logoUrl } = getPaymentMethodDetails(m, settings);
        const isSelected = selectedMethod === m;
        const effectiveSrc = failedUrls[logoUrl] ? brand.defaultLogoPath : logoUrl;

        return (
          <button
            key={m}
            type="button"
            onClick={() => onSelect(m)}
            aria-pressed={isSelected}
            style={{
              borderColor: isSelected ? brand.primaryColor : undefined,
              boxShadow: isSelected
                ? `0 10px 25px -6px ${brand.borderColor}`
                : '0 4px 14px rgba(23, 32, 51, 0.05)',
            }}
            className={`group relative rounded-2xl border-2 text-left transition-all duration-200 overflow-hidden cursor-pointer ${
              compact ? 'p-2.5' : 'p-4'
            } ${
              isSelected
                ? 'scale-[1.01] bg-white'
                : 'border-[#E6ECFA] bg-white hover:-translate-y-0.5 hover:border-[#CBD5E1]'
            }`}
          >
            {/* Top Brand Accent Bar */}
            <div
              className="absolute inset-x-0 top-0 h-1.5 transition-opacity"
              style={{ background: brand.gradient, opacity: isSelected ? 1 : 0.72 }}
            />

            {/* Selected Checkmark Pill */}
            {isSelected && (
              <span
                className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full text-white flex items-center justify-center shadow-xs animate-[fadeIn_160ms_ease-out]"
                style={{ background: brand.gradient }}
              >
                <Check className="w-3 h-3 stroke-[3]" />
              </span>
            )}

            <div className={`flex flex-col ${compact ? 'items-center text-center gap-1.5 pt-1' : 'gap-2.5 pt-1'}`}>
              <div
                className={`rounded-xl bg-white border border-[#E6ECFA] flex items-center justify-center overflow-hidden shadow-2xs ${
                  compact ? 'h-9 w-full px-1.5' : 'h-12 w-fit px-3'
                }`}
              >
                <img
                  src={effectiveSrc}
                  alt={brand.nameEn}
                  referrerPolicy="no-referrer"
                  onError={() => {
                    if (effectiveSrc !== brand.defaultLogoPath) {
                      setFailedUrls((prev) => ({ ...prev, [logoUrl]: true }));
                    }
                  }}
                  className={`${compact ? 'h-7 max-w-[74px]' : 'h-9 max-w-[116px]'} w-auto object-contain`}
                />
              </div>

              <div className="min-w-0">
                <div className={`flex items-center gap-1.5 ${compact ? 'justify-center' : ''}`}>
                  <span
                    className={`font-extrabold tracking-tight ${compact ? 'text-xs' : 'text-sm'}`}
                    style={{ color: brand.primaryColor }}
                  >
                    {brand.nameEn}
                  </span>
                  {!compact && (
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                      style={{ backgroundColor: brand.softBg, color: brand.primaryColor }}
                    >
                      {accountType}
                    </span>
                  )}
                </div>
                {!compact && (
                  <p className="text-xs font-mono-num font-bold text-[#172033] mt-1 truncate">
                    {number}
                  </p>
                )}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

interface SelectedPaymentInstructionCardProps {
  method: PaymentMethod;
  settings: SiteSettings;
  amountBdt: number;
  lang: Language;
  copied: boolean;
  onCopy: () => void;
}

export function SelectedPaymentInstructionCard({
  method,
  settings,
  amountBdt,
  lang,
  copied,
  onCopy,
}: SelectedPaymentInstructionCardProps) {
  const [failedUrl, setFailedUrl] = useState('');
  const { brand, number, accountType, noteBn, noteEn, logoUrl } = getPaymentMethodDetails(
    method,
    settings
  );
  const effectiveSrc = failedUrl === logoUrl ? brand.defaultLogoPath : logoUrl;
  const note = lang === 'bn' ? noteBn : noteEn;

  return (
    <div
      className="rounded-2xl border p-4 transition-all duration-200 shadow-sm"
      style={{
        background: `linear-gradient(135deg, ${brand.softBg} 0%, #FFFFFF 100%)`,
        borderColor: brand.borderColor,
      }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-12 px-2.5 rounded-xl bg-white border border-[#E6ECFA] shadow-xs flex items-center justify-center shrink-0">
            <img
              src={effectiveSrc}
              alt={brand.nameEn}
              referrerPolicy="no-referrer"
              onError={() => {
                if (effectiveSrc !== brand.defaultLogoPath) {
                  setFailedUrl(effectiveSrc);
                }
              }}
              className="h-9 w-auto max-w-[96px] object-contain"
            />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-sm font-extrabold" style={{ color: brand.primaryColor }}>
                {brand.nameEn} ({accountType})
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white border border-[#E6ECFA] text-[10px] font-extrabold font-mono-num text-[#172033]">
                {lang === 'bn' ? 'পরিমাণ:' : 'Pay:'} ৳{amountBdt}
              </span>
            </div>
            <p className="text-[11px] text-[#777777] mt-0.5">
              {t(lang, 'sendMoneyTo')}:
            </p>
            <p className="text-lg sm:text-xl font-mono-num font-extrabold text-[#172033] tracking-wide">
              {number}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onCopy}
          style={{ background: copied ? '#16A34A' : brand.gradient }}
          className="px-4 py-2 rounded-xl text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-sm hover:opacity-95 transition-all shrink-0 self-start sm:self-center cursor-pointer"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? t(lang, 'copied') : t(lang, 'copyNumber')}</span>
        </button>
      </div>

      {note && (
        <p className="mt-2.5 pt-2.5 border-t border-black/5 text-[11px] font-medium text-[#4B5563]">
          {note}
        </p>
      )}
    </div>
  );
}

interface ReceiptUploadBoxProps {
  receiptDataUrl: string;
  lang: Language;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onClear: () => void;
}

export function ReceiptScreenshotUploadBox({
  receiptDataUrl,
  lang,
  onFileChange,
  onClear,
}: ReceiptUploadBoxProps) {
  return (
    <div className="space-y-2">
      <label className="flex items-center justify-center gap-2 px-3.5 py-3 rounded-xl border border-dashed border-[#FF8500]/55 bg-[#FFF7EE] hover:bg-[#FFF1E0] text-xs font-semibold text-[#172033] cursor-pointer transition-colors">
        <Upload className="w-4 h-4 text-[#FF8500] shrink-0" />
        <span>
          {receiptDataUrl
            ? lang === 'bn'
              ? 'পেমেন্ট স্ক্রিনশট পরিবর্তন করুন'
              : 'Change payment screenshot'
            : t(lang, 'receiptUploadLabel')}
        </span>
        <input type="file" accept="image/*" onChange={onFileChange} className="hidden" />
      </label>

      {receiptDataUrl && (
        <div className="p-2.5 rounded-xl bg-white border border-[#E6ECFA] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img
              src={receiptDataUrl}
              alt="Payment Screenshot Preview"
              className="w-12 h-12 rounded-lg object-cover border border-[#E6ECFA] shrink-0"
            />
            <div className="min-w-0">
              <p className="text-xs font-bold text-[#16A34A] flex items-center gap-1">
                <ImageIcon className="w-3.5 h-3.5 shrink-0" />
                <span>{lang === 'bn' ? 'স্ক্রিনশট সংযুক্ত হয়েছে' : 'Payment screenshot attached'}</span>
              </p>
              <p className="text-[10px] text-[#777777]">
                {lang === 'bn' ? 'অ্যাডমিন যাচাইয়ের জন্য প্রস্তুত' : 'Ready for admin verification'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClear}
            className="p-1.5 rounded-lg bg-red-50 text-[#DC2626] hover:bg-red-100 shrink-0"
            title="Remove screenshot"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

interface HomepagePaymentSectionProps {
  settings: SiteSettings;
  lang: Language;
  user: User | null;
  profile: UserProfile | null;
  onOpenAuth: () => void;
  onNavigateAddMoney: () => void;
}

export function HomepagePaymentSection({
  settings,
  lang,
  user,
  profile,
  onOpenAuth,
  onNavigateAddMoney,
}: HomepagePaymentSectionProps) {
  const enabledMethods = getEnabledPaymentMethods(settings);
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>(enabledMethods[0] || 'bkash');
  const [amount, setAmount] = useState('500');
  const [senderNumber, setSenderNumber] = useState(profile?.phone || '');
  const [txId, setTxId] = useState('');
  const [receiptDataUrl, setReceiptDataUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    if (enabledMethods.length > 0 && !enabledMethods.includes(selectedMethod)) {
      setSelectedMethod(enabledMethods[0]);
    }
  }, [enabledMethods, selectedMethod]);

  useEffect(() => {
    if (profile?.phone && !senderNumber) {
      setSenderNumber(profile.phone);
    }
  }, [profile?.phone, senderNumber]);

  const activeDetails = getPaymentMethodDetails(selectedMethod, settings);
  const numericAmount = Math.max(10, Math.round(Number(amount) || 0));

  const handleCopy = () => {
    navigator.clipboard.writeText(activeDetails.number).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleScreenshotChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await compressImageToDataUrl(file);
      setReceiptDataUrl(url);
      setError('');
    } catch {
      setError(
        lang === 'bn' ? 'পেমেন্ট স্ক্রিনশট প্রক্রিয়া করা যায়নি।' : 'Could not process screenshot image.'
      );
    }
  };

  const handleQuickPaymentSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!user) {
      onOpenAuth();
      return;
    }
    if (!user.emailVerified) {
      setError(t(lang, 'verifyEmailDesc'));
      return;
    }
    if (profile?.status === 'suspended') {
      setError(lang === 'bn' ? 'আপনার অ্যাকাউন্ট সাময়িকভাবে স্থগিত করা হয়েছে।' : 'Your account is suspended.');
      return;
    }

    const amt = Math.round(Number(amount));
    if (!Number.isFinite(amt) || amt < 10) {
      setError(lang === 'bn' ? 'ন্যূনতম পরিমাণ ৳১০ লিখুন।' : 'Minimum payment amount is ৳10.');
      return;
    }

    setSubmitting(true);
    try {
      const cleanTx = await validateTransactionIdServer({
        transactionId: txId,
        senderNumber,
        method: selectedMethod,
      });

      const txDocId = await submitAddMoneyDeposit({
        userId: user.uid,
        userEmail: user.email || '',
        amountBdt: amt,
        method: selectedMethod,
        receiverNumber: activeDetails.number,
        senderNumber,
        transactionId: cleanTx,
        receiptDataUrl,
      });

      setSuccessMsg(
        lang === 'bn'
          ? `পেমেন্ট অনুরোধ (${txDocId}) জমা হয়েছে! অ্যাডমিন যাচাইয়ের পর ওয়ালেটে ৳${amt} যোগ হবে।`
          : `Payment submitted (${txDocId}) for Verification Pending. ৳${amt} credits after admin review.`
      );
      setTxId('');
      setReceiptDataUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="dh-card rounded-3xl p-5 sm:p-7 space-y-5 bg-gradient-to-br from-white via-white to-[#F7FAFF] shadow-md">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-[#FFF3E5] text-[#FF8500] text-[10px] font-extrabold uppercase tracking-wider">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'অফিশিয়াল বাংলাদেশি পেমেন্ট গেটওয়ে' : 'Official Bangladesh MFS Gateways'}</span>
          </div>
          <h2 className="text-lg sm:text-xl font-extrabold text-[#172033]">
            {lang === 'bn'
              ? 'দ্রুত ও নিরাপদ পেমেন্ট মাধ্যম (bKash · Nagad · Rocket)'
              : 'Premium Payment Channels (bKash · Nagad · Rocket)'}
          </h2>
          <p className="text-xs text-[#777777]">
            {lang === 'bn'
              ? 'যেকোনো কার্ডে ক্লিক করে সরাসরি পেমেন্ট নম্বর, অ্যামাউন্ট, TxID ও স্ক্রিনশট জমা দিন।'
              : 'Select any payment card below to view the official number, send money, and submit your TxID & screenshot.'}
          </p>
        </div>
        <button
          type="button"
          onClick={onNavigateAddMoney}
          className="px-4 py-2.5 rounded-xl dh-orange-gradient text-white text-xs font-extrabold shadow-sm hover:opacity-95 transition-opacity flex items-center gap-1.5 self-start sm:self-auto shrink-0 cursor-pointer"
        >
          <Wallet className="w-3.5 h-3.5" />
          <span>+ {t(lang, 'navAddMoney')}</span>
        </button>
      </div>

      {/* 3 Separate Brand Payment Cards */}
      <PaymentMethodCardsGrid
        settings={settings}
        lang={lang}
        selectedMethod={selectedMethod}
        onSelect={(m) => {
          setSelectedMethod(m);
          setError('');
          setSuccessMsg('');
        }}
      />

      {/* Selected Payment Interactive Panel */}
      {enabledMethods.length > 0 && (
        <form
          onSubmit={handleQuickPaymentSubmit}
          className="rounded-2xl border border-[#E6ECFA] bg-[#F8FAFF] p-4 sm:p-5 space-y-4 transition-all"
        >
          <SelectedPaymentInstructionCard
            method={selectedMethod}
            settings={settings}
            amountBdt={numericAmount}
            lang={lang}
            copied={copied}
            onCopy={handleCopy}
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            <div>
              <label className="block text-xs font-bold text-[#172033] mb-1">
                {lang === 'bn' ? 'পরিশোধের পরিমাণ (BDT ৳) *' : 'Amount to Pay (BDT ৳) *'}
              </label>
              <input
                type="number"
                min={10}
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-sm font-extrabold font-mono-num focus:outline-none focus:border-[#FF8500]"
              />
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {[100, 200, 500, 1000, 2000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(String(preset))}
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold font-mono-num transition-colors cursor-pointer ${
                      Number(amount) === preset
                        ? 'bg-[#172033] text-white'
                        : 'bg-[#FFF3E5] text-[#FF8500] hover:bg-[#FFE4C4]'
                    }`}
                  >
                    ৳{preset}
                  </button>
                ))}
              </div>
            </div>

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
                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-sm font-mono-num focus:outline-none focus:border-[#FF8500]"
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
                className="w-full px-3.5 py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-sm font-mono-num uppercase focus:outline-none focus:border-[#FF8500]"
              />
            </div>
          </div>

          <ReceiptScreenshotUploadBox
            receiptDataUrl={receiptDataUrl}
            lang={lang}
            onFileChange={handleScreenshotChange}
            onClear={() => setReceiptDataUrl('')}
          />

          {error && (
            <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[#16A34A] text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
            <p className="text-[11px] text-[#777777] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#FF8500] shrink-0" />
              <span>
                {lang === 'bn'
                  ? 'প্রতিটি লেনদেন অ্যাডমিন যাচাই করার পর ওয়ালেট ব্যালেন্সে যোগ হয়।'
                  : 'Payments enter Verification Pending & credit automatically upon owner approval.'}
              </span>
            </p>
            <button
              type="submit"
              disabled={submitting || profile?.status === 'suspended'}
              style={{ background: activeDetails.brand.gradient }}
              className="px-6 py-3 rounded-xl text-white font-extrabold text-xs sm:text-sm shadow-md hover:opacity-95 disabled:opacity-60 transition-all shrink-0 cursor-pointer"
            >
              {submitting
                ? '...'
                : !user
                  ? lang === 'bn'
                    ? 'সাইন ইন করে পেমেন্ট জমা দিন'
                    : 'Sign In to Submit Payment'
                  : `${t(lang, 'submitPayment')} (${activeDetails.brand.nameEn}) · ৳${numericAmount}`}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
