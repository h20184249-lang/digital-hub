import { ChangeEvent, FormEvent, useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Gift,
  PlusCircle,
  Wallet,
} from 'lucide-react';
import {
  Language,
  PaymentMethod,
  SiteSettings,
  UserProfile,
  WalletAccount,
  WalletTransaction,
  WithdrawalRequest,
} from '../types/marketplace';
import { t } from '../lib/i18n';
import {
  compressImageToDataUrl,
  formatDateShort,
  submitAddMoneyDeposit,
  submitWithdrawalRequest,
  validateTransactionIdServer,
} from '../lib/firestoreService';
import { PaymentProviderLogo } from './BrandLogos';
import {
  PaymentMethodCardsGrid,
  ReceiptScreenshotUploadBox,
  SelectedPaymentInstructionCard,
} from './PremiumPaymentSection';

interface WalletAndAddMoneyProps {
  initialTab: 'wallet' | 'add-money' | 'withdraw';
  lang: Language;
  user: User | null;
  profile: UserProfile | null;
  wallet: WalletAccount | null;
  walletTxs: WalletTransaction[];
  withdrawals?: WithdrawalRequest[];
  settings: SiteSettings;
  onOpenAuth: () => void;
}

export function WalletAndAddMoney({
  initialTab,
  lang,
  user,
  profile,
  wallet,
  walletTxs,
  withdrawals = [],
  settings,
  onOpenAuth,
}: WalletAndAddMoneyProps) {
  const [tab, setTab] = useState<'wallet' | 'add-money' | 'withdraw'>(initialTab);
  const [amount, setAmount] = useState('500');
  const [method, setMethod] = useState<PaymentMethod>('bkash');
  const [senderNumber, setSenderNumber] = useState('');
  const [txId, setTxId] = useState('');
  const [receiptDataUrl, setReceiptDataUrl] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('100');
  const [withdrawMethod, setWithdrawMethod] = useState<PaymentMethod>('bkash');
  const [withdrawAccount, setWithdrawAccount] = useState(profile?.phone || '');
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    const enabledMethods = (['bkash', 'nagad', 'rocket'] as PaymentMethod[]).filter((m) =>
      m === 'bkash'
        ? settings.bkashEnabled !== false
        : m === 'nagad'
          ? settings.nagadEnabled !== false
          : settings.rocketEnabled !== false
    );
    if (enabledMethods.length > 0 && !enabledMethods.includes(method)) {
      setMethod(enabledMethods[0]);
    }
  }, [settings.bkashEnabled, settings.nagadEnabled, settings.rocketEnabled, method]);

  if (!user) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <div className="dh-card rounded-3xl p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-[#FFF3E5] text-[#FF8500] flex items-center justify-center mx-auto">
            <Wallet className="w-7 h-7" />
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

  const receiverNumber =
    method === 'bkash'
      ? settings.bkashNumber
      : method === 'nagad'
        ? settings.nagadNumber
        : settings.rocketNumber;

  const handleCopy = () => {
    navigator.clipboard.writeText(receiverNumber).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleReceipt = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const url = await compressImageToDataUrl(file);
      setReceiptDataUrl(url);
    } catch {
      setError('Could not process receipt image');
    }
  };

  const handleDepositSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!user.emailVerified) {
      setError(t(lang, 'verifyEmailDesc'));
      return;
    }

    const numericAmount = Math.round(Number(amount));
    if (!Number.isFinite(numericAmount) || numericAmount < 10) {
      setError(lang === 'bn' ? 'ন্যূনতম ১০ টাকা অ্যাড মানি করুন।' : 'Minimum deposit is ৳10.');
      return;
    }

    setSubmitting(true);
    try {
      const cleanTx = await validateTransactionIdServer({
        transactionId: txId,
        senderNumber,
        method,
      });

      const txDocId = await submitAddMoneyDeposit({
        userId: user.uid,
        userEmail: user.email || '',
        amountBdt: numericAmount,
        method,
        receiverNumber,
        senderNumber,
        transactionId: cleanTx,
        receiptDataUrl,
      });

      setSuccessMsg(
        lang === 'bn'
          ? `অ্যাড মানি অনুরোধ (${txDocId}) জমা হয়েছে। অ্যাডমিন যাচাই করার পর ওয়ালেটে ব্যালেন্স যোগ হবে।`
          : `Add Money request (${txDocId}) submitted as Verification Pending. Balance updates after admin verification.`
      );
      setTxId('');
      setReceiptDataUrl('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit deposit');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdrawSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');

    if (!user.emailVerified) {
      setError(t(lang, 'verifyEmailDesc'));
      return;
    }
    if (profile?.status === 'suspended') {
      setError(lang === 'bn' ? 'আপনার অ্যাকাউন্ট সাময়িকভাবে ব্লক করা হয়েছে।' : 'Your account is suspended.');
      return;
    }
    if (!wallet) {
      setError('Wallet is still syncing.');
      return;
    }

    const numericAmount = Math.round(Number(withdrawAmount));
    if (!Number.isFinite(numericAmount) || numericAmount < 50) {
      setError(lang === 'bn' ? 'ন্যূনতম উইথড্রয়াল পরিমাণ ৳৫০।' : 'Minimum withdrawal amount is ৳50.');
      return;
    }

    setSubmitting(true);
    try {
      const wId = await submitWithdrawalRequest({
        userId: user.uid,
        userEmail: user.email || '',
        wallet,
        method: withdrawMethod,
        accountNumber: withdrawAccount,
        amountBdt: numericAmount,
      });
      setSuccessMsg(
        lang === 'bn'
          ? `উইথড্রয়াল অনুরোধ (${wId}) জমা হয়েছে। অ্যাডমিন পেমেন্ট পাঠালে স্ট্যাটাস আপডেট হবে।`
          : `Withdrawal request (${wId}) submitted as Pending payout.`
      );
      setWithdrawAmount('100');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit withdrawal');
    } finally {
      setSubmitting(false);
    }
  };

  const promoCredits = Math.max(
    profile?.promotionalCredits || 0,
    wallet?.promotionalCreditsBdt || 0
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header + Sub-tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[#172033]">
            {tab === 'add-money'
              ? t(lang, 'navAddMoney')
              : tab === 'withdraw'
                ? lang === 'bn'
                  ? 'ওয়ালেট উইথড্র'
                  : 'Withdraw Funds'
                : t(lang, 'navWallet')}
          </h1>
          <p className="text-xs sm:text-sm text-[#777777]">
            {lang === 'bn'
              ? 'ভেরিফায়েড ম্যানুয়াল ডিপোজিট, উইথড্রয়াল এবং স্বচ্ছ ওয়ালেট লেনদেন ইতিহাস'
              : 'Verified manual deposits, withdrawals, and transparent transaction ledger'}
          </p>
        </div>

        <div className="inline-flex flex-wrap p-1 rounded-2xl bg-white border border-[#E6ECFA] gap-1">
          <button
            type="button"
            onClick={() => {
              setTab('wallet');
              setError('');
              setSuccessMsg('');
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
              tab === 'wallet' ? 'dh-orange-gradient text-white' : 'text-[#172033]'
            }`}
          >
            {t(lang, 'navWallet')}
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('add-money');
              setError('');
              setSuccessMsg('');
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
              tab === 'add-money' ? 'dh-orange-gradient text-white' : 'text-[#172033]'
            }`}
          >
            + {t(lang, 'navAddMoney')}
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('withdraw');
              setError('');
              setSuccessMsg('');
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
              tab === 'withdraw' ? 'dh-orange-gradient text-white' : 'text-[#172033]'
            }`}
          >
            {lang === 'bn' ? 'উইথড্র করুন' : 'Withdraw'}
          </button>
        </div>
      </div>

      {/* Balance Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="dh-card rounded-2xl p-4 bg-gradient-to-br from-[#FF8500] to-[#FF9B19] text-white border-none">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-white/90">{t(lang, 'walletBalanceLabel')}</span>
            <Wallet className="w-4 h-4" />
          </div>
          <p className="text-2xl font-extrabold font-mono-num">
            ৳{(wallet?.availableBalanceBdt || 0).toFixed(2)}
          </p>
          <p className="text-[11px] text-white/85 mt-1">
            {lang === 'bn' ? 'অ্যাডমিন-যাচাইকৃত ব্যালেন্স' : 'Verified spendable balance'}
          </p>
        </div>

        <div className="dh-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#777777]">{t(lang, 'promoCreditsLabel')}</span>
            <Gift className="w-4 h-4 text-[#FF8500]" />
          </div>
          <p className="text-2xl font-extrabold font-mono-num text-[#172033]">৳{promoCredits.toFixed(2)}</p>
          <p className="text-[11px] text-[#777777] mt-1">
            {lang === 'bn' ? 'রেফারেল ও বোনাস ক্রেডিট (পৃথক)' : 'Separate referral/bonus credits'}
          </p>
        </div>

        <div className="dh-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#777777]">
              {lang === 'bn' ? 'মোট অ্যাড মানি' : 'Total Added'}
            </span>
            <ArrowDownLeft className="w-4 h-4 text-[#16A34A]" />
          </div>
          <p className="text-2xl font-extrabold font-mono-num text-[#16A34A]">
            ৳{(wallet?.totalAddedBdt || 0).toFixed(2)}
          </p>
        </div>

        <div className="dh-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#777777]">
              {lang === 'bn' ? 'মোট ব্যয়' : 'Total Spent'}
            </span>
            <ArrowUpRight className="w-4 h-4 text-[#172033]" />
          </div>
          <p className="text-2xl font-extrabold font-mono-num text-[#172033]">
            ৳{(wallet?.totalSpentBdt || 0).toFixed(2)}
          </p>
        </div>
      </div>

      {tab === 'add-money' ? (
        <div className="dh-card rounded-3xl p-5 sm:p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <PlusCircle className="w-5 h-5 text-[#FF8500]" />
            <h2 className="text-lg font-bold text-[#172033]">
              {lang === 'bn' ? 'ম্যানুয়াল অ্যাড মানি (Send Money)' : 'Add Money via Manual Send Money'}
            </h2>
          </div>

          <form onSubmit={handleDepositSubmit} className="space-y-4">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#172033] mb-1.5">
                  {lang === 'bn' ? 'পরিমাণ (BDT ৳)' : 'Amount (BDT ৳)'}
                </label>
                <input
                  type="number"
                  min={10}
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-base font-bold font-mono-num focus:outline-none focus:border-[#FF8500]"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[200, 500, 1000, 2000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAmount(String(preset))}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono-num transition-colors ${
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
                <label className="block text-xs font-bold text-[#172033] mb-2">
                  {t(lang, 'selectPaymentMethod')}
                </label>
                <PaymentMethodCardsGrid
                  settings={settings}
                  lang={lang}
                  selectedMethod={method}
                  onSelect={(m) => {
                    setMethod(m);
                    setError('');
                    setSuccessMsg('');
                  }}
                />
              </div>
            </div>

            <SelectedPaymentInstructionCard
              method={method}
              settings={settings}
              amountBdt={Math.max(10, Math.round(Number(amount) || 0))}
              lang={lang}
              copied={copied}
              onCopy={handleCopy}
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm font-mono-num focus:outline-none focus:border-[#FF8500]"
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
                  placeholder="TXN7K21..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm font-mono-num uppercase focus:outline-none focus:border-[#FF8500]"
                />
              </div>
            </div>

            <ReceiptScreenshotUploadBox
              receiptDataUrl={receiptDataUrl}
              lang={lang}
              onFileChange={handleReceipt}
              onClear={() => setReceiptDataUrl('')}
            />

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#FF8500]" />
              <span>
                {lang === 'bn'
                  ? 'অ্যাড মানি জমা দেওয়ার পর অবস্থা "Verification Pending" থাকবে। অ্যাডমিন প্রকৃত লেনদেন যাচাই করার পর ওয়ালেট ব্যালেন্স আপডেট হবে।'
                  : 'Submitted deposits enter "Verification Pending". Your wallet balance updates only after an administrator verifies the real transaction.'}
              </span>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-semibold">
                {error}
              </div>
            )}
            {successMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[#16A34A] text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{successMsg}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || profile?.status === 'suspended'}
              className="w-full py-3 rounded-xl dh-orange-gradient text-white font-bold text-sm shadow-md hover:opacity-95 disabled:opacity-60"
            >
              {submitting
                ? '...'
                : `${lang === 'bn' ? 'অ্যাড মানি অনুরোধ জমা দিন' : 'Submit Add Money Request'} · ৳${amount || 0}`}
            </button>
          </form>
        </div>
      ) : tab === 'withdraw' ? (
        <div className="space-y-5">
          <div className="dh-card rounded-3xl p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2.5">
                <ArrowUpRight className="w-5 h-5 text-[#FF8500]" />
                <h2 className="text-lg font-bold text-[#172033]">
                  {lang === 'bn' ? 'ব্যালেন্স উইথড্রয়াল অনুরোধ' : 'Request Wallet Withdrawal'}
                </h2>
              </div>
              <span className="px-3 py-1 rounded-xl bg-[#FFF3E5] text-[#FF8500] text-xs font-bold font-mono-num">
                {lang === 'bn' ? 'উপলব্ধ:' : 'Available:'} ৳{(wallet?.availableBalanceBdt || 0).toFixed(2)}
              </span>
            </div>

            <form onSubmit={handleWithdrawSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-[#172033] mb-1.5">
                    {lang === 'bn' ? 'উইথড্রয়াল পরিমাণ (ন্যূনতম ৳৫০)' : 'Withdrawal Amount (Min ৳50)'}
                  </label>
                  <input
                    type="number"
                    min={50}
                    max={Math.max(50, Math.floor(wallet?.availableBalanceBdt || 0))}
                    required
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-base font-bold font-mono-num focus:outline-none focus:border-[#FF8500]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-[#172033] mb-1.5">
                    {lang === 'bn' ? 'পেমেন্ট মাধ্যম নির্বাচন করুন' : 'Select Payout Method'}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {(['bkash', 'nagad', 'rocket'] as PaymentMethod[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setWithdrawMethod(m)}
                        className={`py-2.5 px-3 rounded-xl border text-left transition-all flex items-center justify-between ${
                          withdrawMethod === m
                            ? 'border-[#FF8500] bg-[#FFF7EE] ring-2 ring-[#FF8500]/20'
                            : 'border-[#E6ECFA] bg-white hover:border-[#FF8500]/50'
                        }`}
                      >
                        <PaymentProviderLogo method={m} settings={settings} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#172033] mb-1">
                  {lang === 'bn'
                    ? `আপনার ব্যক্তিগত ${withdrawMethod.toUpperCase()} নম্বর`
                    : `Your Personal ${withdrawMethod.toUpperCase()} Number`}
                </label>
                <input
                  type="tel"
                  required
                  value={withdrawAccount}
                  onChange={(e) => setWithdrawAccount(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm font-mono-num focus:outline-none focus:border-[#FF8500]"
                />
              </div>

              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#FF8500]" />
                <span>
                  {lang === 'bn'
                    ? 'উইথড্রয়াল জমা দেওয়ার সাথে সাথে অর্থ পেন্ডিং অবস্থায় সংরক্ষিত হবে। অ্যাডমিন বাতিল করলে সম্পূর্ণ অর্থ ওয়ালেটে ফেরত আসবে।'
                    : 'Requested funds are placed into Pending payout escrow immediately. If rejected by the administrator, the full amount is refunded automatically.'}
                </span>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-semibold">
                  {error}
                </div>
              )}
              {successMsg && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[#16A34A] text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{successMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || profile?.status === 'suspended' || (wallet?.availableBalanceBdt || 0) < 50}
                className="w-full py-3 rounded-xl dh-orange-gradient text-white font-bold text-sm shadow-md hover:opacity-95 disabled:opacity-60"
              >
                {submitting
                  ? '...'
                  : `${lang === 'bn' ? 'উইথড্রয়াল অনুরোধ পাঠান' : 'Submit Withdrawal Request'} · ৳${withdrawAmount || 0}`}
              </button>
            </form>
          </div>

          <div className="dh-card rounded-3xl p-5 sm:p-6">
            <h3 className="text-base font-bold text-[#172033] mb-3">
              {lang === 'bn' ? 'উইথড্রয়াল ইতিহাস' : 'Withdrawal History'} ({withdrawals.length})
            </h3>
            {withdrawals.length === 0 ? (
              <p className="text-xs text-[#777777] py-6 text-center">
                {lang === 'bn' ? 'এখনো কোনো উইথড্রয়াল অনুরোধ নেই।' : 'No withdrawal requests yet.'}
              </p>
            ) : (
              <div className="space-y-2.5">
                {withdrawals.map((w) => (
                  <div
                    key={w.id}
                    className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div>
                      <p className="font-bold text-[#172033]">
                        {w.method.toUpperCase()} · <span className="font-mono-num">{w.accountNumber}</span>
                      </p>
                      <p className="text-[#777777] mt-0.5">
                        {formatDateShort(w.createdAt, lang)}
                        {w.payoutReference ? ` · Ref: ${w.payoutReference}` : ''}
                        {w.rejectionReason ? ` · ${w.rejectionReason}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 self-end sm:self-center">
                      <span className="text-sm font-extrabold font-mono-num text-[#172033]">৳{w.amountBdt}</span>
                      <span
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
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
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="dh-card rounded-3xl p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <h2 className="text-lg font-bold text-[#172033]">
              {lang === 'bn' ? 'ওয়ালেট লেনদেনের ইতিহাস' : 'Wallet Transaction Ledger'}
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTab('withdraw')}
                className="px-3.5 py-1.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-[#172033] text-xs font-bold hover:border-[#FF8500]"
              >
                {lang === 'bn' ? 'উইথড্র' : 'Withdraw'}
              </button>
              <button
                type="button"
                onClick={() => setTab('add-money')}
                className="px-3.5 py-1.5 rounded-xl dh-orange-gradient text-white text-xs font-bold"
              >
                + {t(lang, 'navAddMoney')}
              </button>
            </div>
          </div>

          {walletTxs.length === 0 ? (
            <p className="text-sm text-[#777777] py-8 text-center">
              {lang === 'bn' ? 'এখনো কোনো ওয়ালেট লেনদেন নেই।' : 'No wallet transactions yet.'}
            </p>
          ) : (
            <div className="space-y-2.5">
              {walletTxs.map((tx) => {
                const isDebit =
                  tx.type === 'purchase' ||
                  tx.type === 'withdrawal' ||
                  (tx.type === 'admin_adjustment' && tx.note?.startsWith('[DEDUCT]'));
                const labelMap: Record<WalletTransaction['type'], { bn: string; en: string }> = {
                  deposit: { bn: 'অ্যাড মানি', en: 'Deposit' },
                  purchase: { bn: 'অর্ডার পেমেন্ট', en: 'Order Payment' },
                  cashback: { bn: 'ক্যাশব্যাক বোনাস', en: 'Order Cashback' },
                  referral: { bn: 'রেফারেল কমিশন', en: 'Referral Commission' },
                  rewarded_ad: { bn: 'রিওয়ার্ডেড অ্যাড', en: 'Rewarded Ad Payout' },
                  watch_earn_coin_redeem: { bn: 'অ্যাড কয়েন কনভার্সন', en: 'Watch & Earn Coin Redeem' },
                  withdrawal: { bn: 'উইথড্রয়াল', en: 'Withdrawal' },
                  withdrawal_refund: { bn: 'উইথড্রয়াল রিফান্ড', en: 'Withdrawal Refund' },
                  promo_credit: { bn: 'প্রমো ক্রেডিট', en: 'Promo Credit' },
                  refund: { bn: 'রিফান্ড', en: 'Refund' },
                  admin_adjustment: { bn: 'অ্যাডমিন সমন্বয়', en: 'Admin Adjustment' },
                };
                const lbl = labelMap[tx.type] || { bn: tx.type, en: tx.type };
                return (
                  <div
                    key={tx.id}
                    className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold uppercase text-[#172033]">
                          {lang === 'bn' ? lbl.bn : lbl.en}
                        </span>
                        <span className="text-[11px] font-mono-num text-[#777777]">
                          {tx.transactionId}
                        </span>
                      </div>
                      <p className="text-xs text-[#777777] mt-0.5">
                        {tx.method.toUpperCase()} · {formatDateShort(tx.createdAt, lang)}
                        {tx.note ? ` · ${tx.note}` : ''}
                        {tx.rejectionReason ? ` · ${tx.rejectionReason}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-center">
                      <span
                        className={`text-sm font-extrabold font-mono-num ${
                          isDebit ? 'text-[#172033]' : 'text-[#16A34A]'
                        }`}
                      >
                        {isDebit ? '-' : '+'}৳{tx.amountBdt}
                      </span>
                      <span
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                          tx.status === 'Approved'
                            ? 'bg-emerald-100 text-[#16A34A]'
                            : tx.status === 'Rejected'
                              ? 'bg-red-100 text-[#DC2626]'
                              : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {tx.status}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
