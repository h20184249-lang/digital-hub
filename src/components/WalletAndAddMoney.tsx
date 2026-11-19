import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  CreditCard,
  Gift,
  PlusCircle,
  Wallet,
} from 'lucide-react';
import {
  AuthUser,
  Language,
  PaymentMethod,
  PaymentMethodConfig,
  SiteSettings,
  UserProfile,
  WalletAccount,
  WalletTransaction,
  WithdrawalRequest,
  WithdrawalStatus,
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
  user: AuthUser | null;
  profile: UserProfile | null;
  wallet: WalletAccount | null;
  walletTxs: WalletTransaction[];
  withdrawals?: WithdrawalRequest[];
  paymentMethods?: PaymentMethodConfig[];
  settings: SiteSettings;
  onOpenAuth: () => void;
}

const FALLBACK_WITHDRAW_METHODS: PaymentMethodConfig[] = [
  {
    id: 'pm_bkash',
    code: 'bkash',
    name: 'bKash',
    type: 'mobile_banking',
    accountNumber: '',
    accountName: 'Personal',
    instructionsBn: 'আপনার ব্যক্তিগত ১১ ডিজিটের বিকাশ নম্বর দিন।',
    instructionsEn: 'Enter your personal 11-digit bKash number.',
    requirementsBn: '১১ ডিজিট বিকাশ নম্বর',
    requirementsEn: '11-digit bKash number',
    minAmount: 50,
    maxAmount: 50000,
    supportsDeposit: true,
    supportsWithdrawal: true,
    enabled: true,
    sortOrder: 1,
  },
  {
    id: 'pm_nagad',
    code: 'nagad',
    name: 'Nagad',
    type: 'mobile_banking',
    accountNumber: '',
    accountName: 'Personal',
    instructionsBn: 'আপনার ব্যক্তিগত ১১ ডিজিটের নগদ নম্বর দিন।',
    instructionsEn: 'Enter your personal 11-digit Nagad number.',
    requirementsBn: '১১ ডিজিট নগদ নম্বর',
    requirementsEn: '11-digit Nagad number',
    minAmount: 50,
    maxAmount: 50000,
    supportsDeposit: true,
    supportsWithdrawal: true,
    enabled: true,
    sortOrder: 2,
  },
  {
    id: 'pm_rocket',
    code: 'rocket',
    name: 'Rocket',
    type: 'mobile_banking',
    accountNumber: '',
    accountName: 'Personal',
    instructionsBn: 'আপনার ব্যক্তিগত রকেট নম্বর দিন।',
    instructionsEn: 'Enter your personal Rocket number.',
    requirementsBn: 'রকেট নম্বর',
    requirementsEn: 'Rocket number',
    minAmount: 50,
    maxAmount: 50000,
    supportsDeposit: true,
    supportsWithdrawal: true,
    enabled: true,
    sortOrder: 3,
  },
  {
    id: 'pm_bank',
    code: 'bank_transfer',
    name: 'Bank Transfer',
    type: 'bank_transfer',
    accountNumber: '',
    accountName: 'Bank Account',
    instructionsBn: 'ব্যাংকের নাম, শাখা, অ্যাকাউন্ট নম্বর ও অ্যাকাউন্টধারীর নাম দিন।',
    instructionsEn: 'Enter Bank Name, Branch, Account Number, and Account Holder Name.',
    requirementsBn: 'ব্যাংক ও অ্যাকাউন্ট নম্বর',
    requirementsEn: 'Bank Name, Account Number & Holder Name',
    minAmount: 500,
    maxAmount: 200000,
    supportsDeposit: false,
    supportsWithdrawal: true,
    enabled: true,
    sortOrder: 4,
  },
];

function getWithdrawalBadgeStyle(status: WithdrawalStatus): string {
  switch (status) {
    case 'Paid':
      return 'bg-emerald-100 text-[#16A34A] dark:bg-emerald-500/20 dark:text-emerald-300';
    case 'Approved':
      return 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300';
    case 'Processing':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300';
    case 'Rejected':
      return 'bg-red-100 text-[#DC2626] dark:bg-red-500/20 dark:text-red-300';
    default:
      return 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300';
  }
}

export function WalletAndAddMoney({
  initialTab,
  lang,
  user,
  profile,
  wallet,
  walletTxs,
  withdrawals = [],
  paymentMethods = [],
  settings,
  onOpenAuth,
}: WalletAndAddMoneyProps) {
  const [tab, setTab] = useState<'wallet' | 'add-money' | 'withdraw'>(initialTab);
  const [amount, setAmount] = useState('500');
  const [method, setMethod] = useState<PaymentMethod>('bkash');
  const [senderNumber, setSenderNumber] = useState('');
  const [txId, setTxId] = useState('');
  const [receiptDataUrl, setReceiptDataUrl] = useState('');

  const withdrawalMethods = useMemo(() => {
    const active = paymentMethods.filter((pm) => pm.enabled && pm.supportsWithdrawal);
    return active.length > 0 ? active : FALLBACK_WITHDRAW_METHODS;
  }, [paymentMethods]);

  const [withdrawAmount, setWithdrawAmount] = useState('100');
  const [withdrawMethod, setWithdrawMethod] = useState<string>('bkash');
  const [withdrawAccount, setWithdrawAccount] = useState(profile?.phone || user?.phone || '');
  const [accountHolderName, setAccountHolderName] = useState(profile?.displayName || user?.displayName || '');
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

  useEffect(() => {
    if (withdrawalMethods.length > 0 && !withdrawalMethods.some((m) => m.code === withdrawMethod)) {
      setWithdrawMethod(withdrawalMethods[0].code);
    }
  }, [withdrawalMethods, withdrawMethod]);

  const selectedWithdrawPm = useMemo(
    () => withdrawalMethods.find((m) => m.code === withdrawMethod) || withdrawalMethods[0],
    [withdrawalMethods, withdrawMethod]
  );

  const effectiveMinWithdraw = Math.max(
    Number(settings.minWithdrawalBdt ?? 50) || 50,
    Number(selectedWithdrawPm?.minAmount ?? 50) || 50
  );
  const effectiveMaxWithdraw = Math.max(
    effectiveMinWithdraw,
    Number(selectedWithdrawPm?.maxAmount ?? 100000) || 100000
  );

  if (!user) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <div className="dh-card rounded-3xl p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500] flex items-center justify-center mx-auto">
            <Wallet className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-[#172033] dark:text-slate-100">{t(lang, 'loginRequiredTitle')}</h2>
          <p className="text-sm text-[#777777] dark:text-slate-400">{t(lang, 'loginRequiredDesc')}</p>
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
        userEmail: user.phone || user.email || '',
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

    if (settings.withdrawalsEnabled === false) {
      setError(
        lang === 'bn'
          ? 'উইথড্রয়াল সিস্টেম বর্তমানে সাময়িকভাবে বন্ধ আছে।'
          : 'Withdrawals are currently paused by the administrator.'
      );
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
    if (!Number.isFinite(numericAmount) || numericAmount < effectiveMinWithdraw) {
      setError(
        lang === 'bn'
          ? `এই মাধ্যমে ন্যূনতম উইথড্রয়াল পরিমাণ ৳${effectiveMinWithdraw}।`
          : `Minimum withdrawal amount for ${selectedWithdrawPm?.name || withdrawMethod} is ৳${effectiveMinWithdraw}.`
      );
      return;
    }
    if (numericAmount > effectiveMaxWithdraw) {
      setError(
        lang === 'bn'
          ? `এই মাধ্যমে সর্বোচ্চ উইথড্রয়াল পরিমাণ ৳${effectiveMaxWithdraw}।`
          : `Maximum withdrawal amount is ৳${effectiveMaxWithdraw}.`
      );
      return;
    }
    if (numericAmount > wallet.availableBalanceBdt) {
      setError(lang === 'bn' ? 'আপনার ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই।' : 'Insufficient available wallet balance.');
      return;
    }

    setSubmitting(true);
    try {
      const wId = await submitWithdrawalRequest({
        userId: user.uid,
        userEmail: user.phone || user.email || '',
        wallet,
        method: withdrawMethod,
        accountNumber: withdrawAccount,
        accountHolderName:
          selectedWithdrawPm?.type === 'bank_transfer' || selectedWithdrawPm?.type === 'custom'
            ? accountHolderName
            : '',
        amountBdt: numericAmount,
      });
      setSuccessMsg(
        lang === 'bn'
          ? `উইথড্রয়াল অনুরোধ (${wId}) জমা হয়েছে। অ্যাডমিন পেমেন্ট পাঠালে স্ট্যাটাস আপডেট হবে।`
          : `Withdrawal request (${wId}) submitted as Pending payout.`
      );
      setWithdrawAmount(String(effectiveMinWithdraw));
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
          <h1 className="text-2xl font-extrabold text-[#172033] dark:text-slate-100">
            {tab === 'add-money'
              ? t(lang, 'navAddMoney')
              : tab === 'withdraw'
                ? lang === 'bn'
                  ? 'ওয়ালেট উইথড্র'
                  : 'Withdraw Funds'
                : t(lang, 'navWallet')}
          </h1>
          <p className="text-xs sm:text-sm text-[#777777] dark:text-slate-400">
            {lang === 'bn'
              ? 'ভেরিফায়েড ম্যানুয়াল ডিপোজিট, উইথড্রয়াল এবং স্বচ্ছ ওয়ালেট লেনদেন ইতিহাস'
              : 'Verified manual deposits, withdrawals, and transparent transaction ledger'}
          </p>
        </div>

        <div className="inline-flex flex-wrap p-1 rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 gap-1">
          <button
            type="button"
            onClick={() => {
              setTab('wallet');
              setError('');
              setSuccessMsg('');
            }}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-colors ${
              tab === 'wallet' ? 'dh-orange-gradient text-white' : 'text-[#172033] dark:text-slate-200'
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
              tab === 'add-money' ? 'dh-orange-gradient text-white' : 'text-[#172033] dark:text-slate-200'
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
              tab === 'withdraw' ? 'dh-orange-gradient text-white' : 'text-[#172033] dark:text-slate-200'
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
            <span className="text-xs font-semibold text-[#777777] dark:text-slate-400">{t(lang, 'promoCreditsLabel')}</span>
            <Gift className="w-4 h-4 text-[#FF8500]" />
          </div>
          <p className="text-2xl font-extrabold font-mono-num text-[#172033] dark:text-slate-100">৳{promoCredits.toFixed(2)}</p>
          <p className="text-[11px] text-[#777777] dark:text-slate-400 mt-1">
            {lang === 'bn' ? 'রেফারেল ও বোনাস ক্রেডিট (পৃথক)' : 'Separate referral/bonus credits'}
          </p>
        </div>

        <div className="dh-card rounded-2xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[#777777] dark:text-slate-400">
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
            <span className="text-xs font-semibold text-[#777777] dark:text-slate-400">
              {lang === 'bn' ? 'মোট ব্যয়' : 'Total Spent'}
            </span>
            <ArrowUpRight className="w-4 h-4 text-[#172033] dark:text-slate-200" />
          </div>
          <p className="text-2xl font-extrabold font-mono-num text-[#172033] dark:text-slate-100">
            ৳{(wallet?.totalSpentBdt || 0).toFixed(2)}
          </p>
        </div>
      </div>

      {tab === 'add-money' ? (
        <div className="dh-card rounded-3xl p-5 sm:p-6">
          <div className="flex items-center gap-2.5 mb-5">
            <PlusCircle className="w-5 h-5 text-[#FF8500]" />
            <h2 className="text-lg font-bold text-[#172033] dark:text-slate-100">
              {lang === 'bn' ? 'ম্যানুয়াল অ্যাড মানি (Send Money)' : 'Add Money via Manual Send Money'}
            </h2>
          </div>

          <form onSubmit={handleDepositSubmit} className="space-y-4">
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1.5">
                  {lang === 'bn' ? 'পরিমাণ (BDT ৳)' : 'Amount (BDT ৳)'}
                </label>
                <input
                  type="number"
                  min={10}
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-base font-bold font-mono-num text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {[200, 500, 1000, 2000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAmount(String(preset))}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold font-mono-num transition-colors ${
                        Number(amount) === preset
                          ? 'bg-[#172033] dark:bg-[#FF8500] text-white'
                          : 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500] hover:bg-[#FFE4C4]'
                      }`}
                    >
                      ৳{preset}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-2">
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
                <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
                  {t(lang, 'senderNumberLabel')}
                </label>
                <input
                  type="tel"
                  required
                  value={senderNumber}
                  onChange={(e) => setSenderNumber(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-sm font-mono-num text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
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
                  placeholder="TXN7K21..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-sm font-mono-num uppercase text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
                />
              </div>
            </div>

            <ReceiptScreenshotUploadBox
              receiptDataUrl={receiptDataUrl}
              lang={lang}
              onFileChange={handleReceipt}
              onClear={() => setReceiptDataUrl('')}
            />

            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#FF8500]" />
              <span>
                {lang === 'bn'
                  ? 'অ্যাড মানি জমা দেওয়ার পর অবস্থা "Verification Pending" থাকবে। অ্যাডমিন প্রকৃত লেনদেন যাচাই করার পর ওয়ালেট ব্যালেন্স আপডেট হবে।'
                  : 'Submitted deposits enter "Verification Pending". Your wallet balance updates only after an administrator verifies the real transaction.'}
              </span>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-[#DC2626] dark:text-red-300 text-xs font-semibold">
                {error}
              </div>
            )}
            {successMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[#16A34A] dark:text-emerald-300 text-xs font-semibold flex items-center gap-2">
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
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2.5">
                <ArrowUpRight className="w-5 h-5 text-[#FF8500]" />
                <h2 className="text-lg font-bold text-[#172033] dark:text-slate-100">
                  {lang === 'bn' ? 'ব্যালেন্স উইথড্রয়াল অনুরোধ' : 'Request Wallet Withdrawal'}
                </h2>
              </div>
              <span className="text-xs font-bold font-mono-num text-[#FF8500]">
                {lang === 'bn' ? 'উপলব্ধ ব্যালেন্স:' : 'Available:'} ৳{(wallet?.availableBalanceBdt || 0).toFixed(2)}
              </span>
            </div>

            {settings.withdrawalsEnabled === false ? (
              <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-semibold">
                {lang === 'bn'
                  ? 'উইথড্রয়াল সিস্টেম বর্তমানে অ্যাডমিন কর্তৃক সাময়িকভাবে বন্ধ রাখা হয়েছে।'
                  : 'Withdrawals are temporarily paused by the administrator.'}
              </div>
            ) : (
              <form onSubmit={handleWithdrawSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-2">
                    {lang === 'bn' ? 'পেমেন্ট মাধ্যম নির্বাচন করুন' : 'Select Payout Method'}
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2.5">
                    {withdrawalMethods.map((pm) => {
                      const isBrand = pm.code === 'bkash' || pm.code === 'nagad' || pm.code === 'rocket';
                      const active = withdrawMethod === pm.code;
                      return (
                        <button
                          key={pm.id}
                          type="button"
                          onClick={() => {
                            setWithdrawMethod(pm.code);
                            setError('');
                          }}
                          className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between gap-1.5 ${
                            active
                              ? 'border-[#FF8500] bg-[#FFF7EE] dark:bg-orange-500/15 ring-2 ring-[#FF8500]/20'
                              : 'border-[#E6ECFA] dark:border-slate-700 bg-white dark:bg-slate-800/70 hover:border-[#FF8500]/50'
                          }`}
                        >
                          {isBrand ? (
                            <PaymentProviderLogo method={pm.code as PaymentMethod} settings={settings} />
                          ) : (
                            <div className="flex items-center gap-2">
                              {pm.type === 'bank_transfer' ? (
                                <Building2 className="w-5 h-5 text-[#FF8500] shrink-0" />
                              ) : (
                                <CreditCard className="w-5 h-5 text-[#FF8500] shrink-0" />
                              )}
                              <span className="text-xs font-extrabold text-[#172033] dark:text-slate-100 truncate">
                                {pm.name}
                              </span>
                            </div>
                          )}
                          <span className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400">
                            Min ৳{Math.max(Number(settings.minWithdrawalBdt ?? 50), pm.minAmount)} · Max ৳{pm.maxAmount.toLocaleString()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {selectedWithdrawPm && (selectedWithdrawPm.instructionsBn || selectedWithdrawPm.instructionsEn) && (
                  <div className="p-3 rounded-xl bg-[#F3F6FF] dark:bg-slate-800/80 border border-[#E6ECFA] dark:border-slate-700 text-xs text-[#475569] dark:text-slate-300 space-y-1">
                    <p className="font-bold text-[#172033] dark:text-slate-100">{selectedWithdrawPm.name}</p>
                    <p>{lang === 'bn' ? selectedWithdrawPm.instructionsBn || selectedWithdrawPm.instructionsEn : selectedWithdrawPm.instructionsEn || selectedWithdrawPm.instructionsBn}</p>
                    {(selectedWithdrawPm.requirementsBn || selectedWithdrawPm.requirementsEn) && (
                      <p className="text-[11px] text-[#777777] dark:text-slate-400">
                        {lang === 'bn' ? 'প্রয়োজনীয় তথ্য:' : 'Required:'}{' '}
                        {lang === 'bn' ? selectedWithdrawPm.requirementsBn || selectedWithdrawPm.requirementsEn : selectedWithdrawPm.requirementsEn || selectedWithdrawPm.requirementsBn}
                      </p>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1.5">
                      {lang === 'bn'
                        ? `উইথড্রয়াল পরিমাণ (৳${effectiveMinWithdraw} – ৳${effectiveMaxWithdraw})`
                        : `Withdrawal Amount (৳${effectiveMinWithdraw} – ৳${effectiveMaxWithdraw})`}
                    </label>
                    <input
                      type="number"
                      min={effectiveMinWithdraw}
                      max={Math.min(effectiveMaxWithdraw, Math.max(effectiveMinWithdraw, Math.floor(wallet?.availableBalanceBdt || 0)))}
                      required
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-base font-bold font-mono-num text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1.5">
                      {selectedWithdrawPm?.type === 'bank_transfer'
                        ? lang === 'bn'
                          ? 'ব্যাংক অ্যাকাউন্ট নম্বর ও শাখা'
                          : 'Bank Account Number & Branch'
                        : lang === 'bn'
                          ? `আপনার ${selectedWithdrawPm?.name || withdrawMethod.toUpperCase()} অ্যাকাউন্ট / নম্বর`
                          : `Your ${selectedWithdrawPm?.name || withdrawMethod.toUpperCase()} Account / Number`}
                    </label>
                    <input
                      type="text"
                      required
                      value={withdrawAccount}
                      onChange={(e) => setWithdrawAccount(e.target.value)}
                      placeholder={
                        selectedWithdrawPm?.type === 'bank_transfer'
                          ? 'City Bank — A/C 2301XXXX (Motijheel)'
                          : '01XXXXXXXXX'
                      }
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-sm font-mono-num text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>
                </div>

                {(selectedWithdrawPm?.type === 'bank_transfer' || selectedWithdrawPm?.type === 'custom') && (
                  <div>
                    <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
                      {lang === 'bn' ? 'অ্যাকাউন্টধারীর পূর্ণ নাম' : 'Account Holder Name'}
                    </label>
                    <input
                      type="text"
                      required
                      value={accountHolderName}
                      onChange={(e) => setAccountHolderName(e.target.value)}
                      placeholder={lang === 'bn' ? 'ব্যাংক/অ্যাকাউন্টের নাম লিখুন' : 'Full name on account'}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-sm text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>
                )}

                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-[#FF8500]" />
                  <span>
                    {lang === 'bn'
                      ? 'উইথড্রয়াল জমা দেওয়ার সাথে সাথে অর্থ পেন্ডিং অবস্থায় সংরক্ষিত হবে। অ্যাডমিন বাতিল করলে সম্পূর্ণ অর্থ স্বয়ংক্রিয়ভাবে ওয়ালেটে ফেরত আসবে।'
                      : 'Requested funds are placed into Pending payout immediately. If rejected by the administrator, the full amount is refunded automatically.'}
                  </span>
                </div>

                {error && (
                  <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-[#DC2626] dark:text-red-300 text-xs font-semibold">
                    {error}
                  </div>
                )}
                {successMsg && (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[#16A34A] dark:text-emerald-300 text-xs font-semibold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span>{successMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    submitting ||
                    profile?.status === 'suspended' ||
                    (wallet?.availableBalanceBdt || 0) < effectiveMinWithdraw
                  }
                  className="w-full py-3 rounded-xl dh-orange-gradient text-white font-bold text-sm shadow-md hover:opacity-95 disabled:opacity-60"
                >
                  {submitting
                    ? '...'
                    : `${lang === 'bn' ? 'উইথড্রয়াল অনুরোধ পাঠান' : 'Submit Withdrawal Request'} · ৳${withdrawAmount || 0}`}
                </button>
              </form>
            )}
          </div>

          <div className="dh-card rounded-3xl p-5 sm:p-6">
            <h3 className="text-base font-bold text-[#172033] dark:text-slate-100 mb-3">
              {lang === 'bn' ? 'উইথড্রয়াল ইতিহাস' : 'Withdrawal History'} ({withdrawals.length})
            </h3>
            {withdrawals.length === 0 ? (
              <p className="text-xs text-[#777777] dark:text-slate-400 py-6 text-center">
                {lang === 'bn' ? 'এখনো কোনো উইথড্রয়াল অনুরোধ নেই।' : 'No withdrawal requests yet.'}
              </p>
            ) : (
              <div className="space-y-2.5">
                {withdrawals.map((w) => (
                  <div
                    key={w.id}
                    className="p-3.5 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/80 border border-[#E6ECFA] dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-0.5">
                      <p className="font-bold text-[#172033] dark:text-slate-100">
                        {w.methodName || w.method.toUpperCase()} · <span className="font-mono-num">{w.accountNumber}</span>
                        {w.accountHolderName ? ` (${w.accountHolderName})` : ''}
                      </p>
                      <p className="text-[#777777] dark:text-slate-400 font-mono-num">
                        ID: {w.id} · {formatDateShort(w.createdAt, lang)}
                        {w.payoutReference ? ` · Ref: ${w.payoutReference}` : ''}
                        {w.paidAt ? ` · Paid: ${formatDateShort(w.paidAt, lang)}` : ''}
                      </p>
                      {w.adminNote && (
                        <p className="text-[#475569] dark:text-slate-300">Note: {w.adminNote}</p>
                      )}
                      {w.rejectionReason && (
                        <p className="text-[#DC2626] dark:text-red-400 font-semibold">{w.rejectionReason}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
                      <span className="text-sm font-extrabold font-mono-num text-[#172033] dark:text-slate-100">৳{w.amountBdt}</span>
                      <span className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${getWithdrawalBadgeStyle(w.status)}`}>
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
            <h2 className="text-lg font-bold text-[#172033] dark:text-slate-100">
              {lang === 'bn' ? 'ওয়ালেট লেনদেনের ইতিহাস' : 'Wallet Transaction Ledger'}
            </h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setTab('withdraw')}
                className="px-3.5 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-100 text-xs font-bold hover:border-[#FF8500]"
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
            <p className="text-sm text-[#777777] dark:text-slate-400 py-8 text-center">
              {lang === 'bn' ? 'এখনো কোনো ওয়ালেট লেনদেন নেই।' : 'No wallet transactions yet.'}
            </p>
          ) : (
            <div className="space-y-2.5">
              {walletTxs.map((tx) => {
                const isDebit =
                  tx.type === 'purchase' ||
                  tx.type === 'withdrawal' ||
                  (tx.type === 'admin_adjustment' &&
                    ((typeof tx.signedDeltaBdt === 'number' && tx.signedDeltaBdt < 0) ||
                      tx.note?.startsWith('[DEDUCT]')));
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
                    className="p-3.5 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/80 border border-[#E6ECFA] dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold uppercase text-[#172033] dark:text-slate-100">
                          {lang === 'bn' ? lbl.bn : lbl.en}
                        </span>
                        <span className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400">
                          {tx.transactionId}
                        </span>
                      </div>
                      <p className="text-xs text-[#777777] dark:text-slate-400 mt-0.5">
                        {String(tx.method || '').toUpperCase()} · {formatDateShort(tx.createdAt, lang)}
                        {tx.note ? ` · ${tx.note}` : ''}
                        {tx.rejectionReason ? ` · ${tx.rejectionReason}` : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-center">
                      <span
                        className={`text-sm font-extrabold font-mono-num ${
                          isDebit ? 'text-[#172033] dark:text-slate-100' : 'text-[#16A34A]'
                        }`}
                      >
                        {isDebit ? '-' : '+'}৳{tx.amountBdt}
                      </span>
                      <span
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold ${
                          tx.status === 'Approved'
                            ? 'bg-emerald-100 text-[#16A34A] dark:bg-emerald-500/20 dark:text-emerald-300'
                            : tx.status === 'Rejected'
                              ? 'bg-red-100 text-[#DC2626] dark:bg-red-500/20 dark:text-red-300'
                              : 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'
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
