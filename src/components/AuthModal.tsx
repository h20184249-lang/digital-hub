import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Gift,
  KeyRound,
  Lock,
  LogIn,
  Mail,
  Phone,
  ShieldCheck,
  User as UserIcon,
  UserPlus,
  X,
} from 'lucide-react';
import { AuthMethod, AuthUser, Language, UserProfile } from '../types/marketplace';
import {
  AuthApiError,
  loginWithEmail,
  loginWithPhone,
  normalizeBangladeshPhoneClient,
  normalizeEmailAddressClient,
  registerWithEmail,
  registerWithPhone,
  resetPasswordWithRecoveryCode,
} from '../lib/authClient';
import { DigitalHubLogo } from './DigitalHubLogo';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  lang: Language;
  initialMode?: 'login' | 'register';
  initialReferralCode?: string;
  onReferralCapture: (code: string) => void;
  onAuthSuccess: (user: AuthUser, profile: UserProfile, isNewAccount: boolean, keepModalOpen?: boolean) => void;
  supportTelegramUrl?: string;
  supportWhatsappUrl?: string;
}

type ModalMode = 'login' | 'register' | 'reset';

function getPasswordStrength(password: string, lang: Language): {
  score: number;
  label: string;
  color: string;
} {
  if (!password) {
    return { score: 0, label: '', color: 'bg-gray-200' };
  }
  let score = 0;
  if (password.length >= 6) score += 1;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 1) {
    return {
      score: 1,
      label: lang === 'bn' ? 'দুর্বল' : 'Weak',
      color: 'bg-[#DC2626]',
    };
  }
  if (score === 2) {
    return {
      score: 2,
      label: lang === 'bn' ? 'মাঝারি' : 'Fair',
      color: 'bg-amber-500',
    };
  }
  if (score === 3) {
    return {
      score: 3,
      label: lang === 'bn' ? 'ভালো' : 'Good',
      color: 'bg-emerald-500',
    };
  }
  return {
    score: 4,
    label: lang === 'bn' ? 'শক্তিশালী' : 'Strong',
    color: 'bg-[#16A34A]',
  };
}

export function AuthModal({
  open,
  onClose,
  lang,
  initialMode = 'login',
  initialReferralCode = '',
  onReferralCapture,
  onAuthSuccess,
  supportTelegramUrl = 'https://t.me/zenvoofficial',
  supportWhatsappUrl = 'https://wa.me/8801352838945',
}: AuthModalProps) {
  const [mode, setMode] = useState<ModalMode>(initialMode);
  const [authMethod, setAuthMethod] = useState<AuthMethod>('phone');
  const [fullName, setFullName] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [emailInput, setEmailInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  const [recoveryCodeInput, setRecoveryCodeInput] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [errorCode, setErrorCode] = useState('');

  // Post-registration or post-reset one-time recovery code display
  const [issuedRecoveryCode, setIssuedRecoveryCode] = useState('');
  const [issuedKind, setIssuedKind] = useState<'register' | 'reset' | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setErrorMsg('');
      setErrorCode('');
      setIssuedRecoveryCode('');
      setIssuedKind(null);
      setCopiedCode(false);
      setPassword('');
      setConfirmPassword('');
      setRecoveryCodeInput('');
      setShowPassword(false);
      setShowConfirmPassword(false);
      if (initialReferralCode) {
        setReferralCode(initialReferralCode);
      }
    }
  }, [open, initialMode, initialReferralCode]);

  const normalizedPhone = useMemo(() => normalizeBangladeshPhoneClient(phoneInput), [phoneInput]);
  const normalizedEmail = useMemo(() => normalizeEmailAddressClient(emailInput), [emailInput]);
  const strength = useMemo(() => getPasswordStrength(password, lang), [password, lang]);

  if (!open) return null;

  const switchMode = (next: ModalMode) => {
    setMode(next);
    setErrorMsg('');
    setErrorCode('');
    setPassword('');
    setConfirmPassword('');
    setRecoveryCodeInput('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const switchMethod = (next: AuthMethod) => {
    if (next === authMethod) return;
    setAuthMethod(next);
    setErrorMsg('');
    setErrorCode('');
  };

  const handleCopyRecoveryCode = () => {
    if (!issuedRecoveryCode) return;
    navigator.clipboard.writeText(issuedRecoveryCode).catch(() => {});
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleLoginSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setErrorCode('');

    if (authMethod === 'email') {
      const normalized = normalizeEmailAddressClient(emailInput);
      if (!normalized) {
        setErrorMsg(
          lang === 'bn'
            ? 'সঠিক ইমেইল ঠিকানা লিখুন (যেমন: name@gmail.com)।'
            : 'Please enter a valid email address (e.g. name@gmail.com).'
        );
        setErrorCode('auth/invalid-email');
        return;
      }
      if (!password) {
        setErrorMsg(lang === 'bn' ? 'আপনার পাসওয়ার্ড লিখুন।' : 'Please enter your password.');
        return;
      }

      setBusy(true);
      try {
        const res = await loginWithEmail({
          email: normalized,
          password,
        });
        onAuthSuccess(res.user, res.profile, false, false);
        onClose();
      } catch (err) {
        if (err instanceof AuthApiError) {
          setErrorCode(err.code);
          setErrorMsg(err.message);
        } else {
          setErrorMsg(
            lang === 'bn'
              ? 'লগইন সম্পন্ন করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
              : 'Unable to sign in. Please try again.'
          );
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    const normalized = normalizeBangladeshPhoneClient(phoneInput);
    if (!normalized) {
      setErrorMsg(
        lang === 'bn'
          ? 'সঠিক ১১-ডিজিট বাংলাদেশি মোবাইল নম্বর লিখুন (যেমন: 017XXXXXXXX)।'
          : 'Please enter a valid 11-digit Bangladesh mobile number (e.g. 017XXXXXXXX).'
      );
      setErrorCode('auth/invalid-phone-number');
      return;
    }
    if (!password) {
      setErrorMsg(lang === 'bn' ? 'আপনার পাসওয়ার্ড লিখুন।' : 'Please enter your password.');
      return;
    }

    setBusy(true);
    try {
      const res = await loginWithPhone({
        phone: normalized,
        password,
      });
      onAuthSuccess(res.user, res.profile, false, false);
      onClose();
    } catch (err) {
      if (err instanceof AuthApiError) {
        setErrorCode(err.code);
        setErrorMsg(err.message);
      } else {
        setErrorMsg(
          lang === 'bn'
            ? 'লগইন সম্পন্ন করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Unable to sign in. Please try again.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRegisterSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setErrorCode('');

    const cleanName = fullName.trim();
    if (cleanName.length < 2) {
      setErrorMsg(
        lang === 'bn'
          ? 'অনুগ্রহ করে আপনার পূর্ণ নাম লিখুন (কমপক্ষে ২ অক্ষর)।'
          : 'Please enter your full name (at least 2 characters).'
      );
      return;
    }

    if (authMethod === 'email') {
      const normalized = normalizeEmailAddressClient(emailInput);
      if (!normalized) {
        setErrorMsg(
          lang === 'bn'
            ? 'সঠিক ইমেইল ঠিকানা লিখুন (যেমন: name@gmail.com)।'
            : 'Please enter a valid email address (e.g. name@gmail.com).'
        );
        setErrorCode('auth/invalid-email');
        return;
      }
      if (password.length < 6) {
        setErrorMsg(
          lang === 'bn'
            ? 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'
            : 'Password must be at least 6 characters long.'
        );
        return;
      }
      if (strength.score < 2) {
        setErrorMsg(
          lang === 'bn'
            ? 'আরও শক্তিশালী পাসওয়ার্ড দিন (কমপক্ষে ৮ অক্ষর অথবা অক্ষর ও সংখ্যার সমন্বয়ে ৬+ অক্ষর)।'
            : 'Please use a stronger password (at least 8 characters, or 6+ characters with letters and numbers).'
        );
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg(
          lang === 'bn'
            ? 'পাসওয়ার্ড এবং কনফার্ম পাসওয়ার্ড মেলেনি।'
            : 'Password and Confirm Password do not match.'
        );
        return;
      }

      if (referralCode.trim()) {
        onReferralCapture(referralCode.trim().toUpperCase());
      }

      setBusy(true);
      try {
        const res = await registerWithEmail({
          fullName: cleanName,
          email: normalized,
          password,
          confirmPassword,
          referralCode: referralCode.trim().toUpperCase(),
          language: lang,
        });
        onAuthSuccess(res.user, res.profile, true, true);
        setIssuedRecoveryCode(res.recoveryCode);
        setIssuedKind('register');
      } catch (err) {
        if (err instanceof AuthApiError) {
          setErrorCode(err.code);
          setErrorMsg(err.message);
        } else {
          setErrorMsg(
            lang === 'bn'
              ? 'অ্যাকাউন্ট তৈরি করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
              : 'Could not create account. Please try again.'
          );
        }
      } finally {
        setBusy(false);
      }
      return;
    }

    const normalized = normalizeBangladeshPhoneClient(phoneInput);
    if (!normalized) {
      setErrorMsg(
        lang === 'bn'
          ? 'সঠিক ১১-ডিজিট বাংলাদেশি মোবাইল নম্বর লিখুন (যেমন: 017XXXXXXXX বা +88017XXXXXXXX)।'
          : 'Please enter a valid Bangladesh mobile number (e.g. 017XXXXXXXX or +88017XXXXXXXX).'
      );
      setErrorCode('auth/invalid-phone-number');
      return;
    }

    if (password.length < 6) {
      setErrorMsg(
        lang === 'bn'
          ? 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'
          : 'Password must be at least 6 characters long.'
      );
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg(
        lang === 'bn'
          ? 'পাসওয়ার্ড এবং কনফার্ম পাসওয়ার্ড মেলেনি।'
          : 'Password and Confirm Password do not match.'
      );
      return;
    }

    if (referralCode.trim()) {
      onReferralCapture(referralCode.trim().toUpperCase());
    }

    setBusy(true);
    try {
      const res = await registerWithPhone({
        fullName: cleanName,
        phone: normalized,
        password,
        confirmPassword,
        referralCode: referralCode.trim().toUpperCase(),
        language: lang,
      });
      // Immediately sync authenticated user into parent app state while keeping modal open for backup code
      onAuthSuccess(res.user, res.profile, true, true);
      setIssuedRecoveryCode(res.recoveryCode);
      setIssuedKind('register');
    } catch (err) {
      if (err instanceof AuthApiError) {
        setErrorCode(err.code);
        setErrorMsg(err.message);
      } else {
        setErrorMsg(
          lang === 'bn'
            ? 'অ্যাকাউন্ট তৈরি করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Could not create account. Please try again.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResetSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setErrorCode('');

    let normalizedPhoneVal = '';
    let normalizedEmailVal = '';

    if (authMethod === 'email') {
      const normalized = normalizeEmailAddressClient(emailInput);
      if (!normalized) {
        setErrorMsg(
          lang === 'bn'
            ? 'সঠিক ইমেইল ঠিকানা লিখুন।'
            : 'Please enter a valid email address.'
        );
        return;
      }
      normalizedEmailVal = normalized;
    } else {
      const normalized = normalizeBangladeshPhoneClient(phoneInput);
      if (!normalized) {
        setErrorMsg(
          lang === 'bn'
            ? 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন।'
            : 'Please enter a valid Bangladesh mobile number.'
        );
        return;
      }
      normalizedPhoneVal = normalized;
    }

    if (recoveryCodeInput.trim().length < 6) {
      setErrorMsg(
        lang === 'bn'
          ? 'সঠিক ব্যাকআপ রিকভারি কোড (যেমন: DH-XXXX-XXXX) লিখুন।'
          : 'Please enter your valid backup recovery code (e.g. DH-XXXX-XXXX).'
      );
      return;
    }

    if (password.length < 6) {
      setErrorMsg(
        lang === 'bn'
          ? 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'
          : 'New password must be at least 6 characters long.'
      );
      return;
    }

    if (password !== confirmPassword) {
      setErrorMsg(
        lang === 'bn'
          ? 'নতুন পাসওয়ার্ড দুটি মেলেনি।'
          : 'New passwords do not match.'
      );
      return;
    }

    setBusy(true);
    try {
      const res = await resetPasswordWithRecoveryCode({
        authMethod,
        phone: normalizedPhoneVal || undefined,
        email: normalizedEmailVal || undefined,
        recoveryCode: recoveryCodeInput.trim().toUpperCase(),
        newPassword: password,
        confirmPassword,
      });
      setIssuedRecoveryCode(res.newRecoveryCode);
      setIssuedKind('reset');
    } catch (err) {
      if (err instanceof AuthApiError) {
        setErrorCode(err.code);
        setErrorMsg(err.message);
      } else {
        setErrorMsg(
          lang === 'bn'
            ? 'পাসওয়ার্ড রিসেট করা যায়নি। রিকভারি কোড যাচাই করে আবার চেষ্টা করুন।'
            : 'Could not reset password. Please verify your recovery code and try again.'
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#172033]/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-[440px] bg-white rounded-3xl shadow-2xl border border-[#E6ECFA] overflow-hidden my-auto">
        {/* Header Bar */}
        <div className="px-5 py-4 bg-[#FFF7EE] border-b border-[#F3DFC8] flex items-center justify-between">
          <DigitalHubLogo compact />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close authentication modal"
            className="w-8 h-8 rounded-xl bg-white border border-[#E6ECFA] text-[#777777] hover:text-[#172033] flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 space-y-5 max-h-[82vh] overflow-y-auto">
          {/* Post-Registration / Post-Reset Recovery Code Screen */}
          {issuedRecoveryCode && issuedKind ? (
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 border border-emerald-200">
                <CheckCircle2 className="w-6 h-6 text-[#16A34A] shrink-0 mt-0.5" />
                <div>
                  <h2 className="text-base font-extrabold text-[#172033]">
                    {issuedKind === 'register'
                      ? lang === 'bn'
                        ? 'অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে!'
                        : 'Account Created Successfully!'
                      : lang === 'bn'
                        ? 'পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে!'
                        : 'Password Reset Successfully!'}
                  </h2>
                  <p className="text-xs text-[#475569] mt-0.5">
                    {issuedKind === 'register'
                      ? lang === 'bn'
                        ? 'আপনি এখন সরাসরি লগইন অবস্থায় আছেন। ভবিষ্যতে পাসওয়ার্ড ভুলে গেলে নিচের ব্যাকআপ কোডটি কাজে লাগবে।'
                        : 'You are now signed in. Save the backup recovery code below in case you ever forget your password.'
                      : lang === 'bn'
                        ? 'আপনার নতুন পাসওয়ার্ড সক্রিয় হয়েছে। ভবিষ্যতের জন্য নতুন ব্যাকআপ কোডটি সংরক্ষণ করুন।'
                        : 'Your new password is active. Save your newly rotated backup recovery code safely.'}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-[#F3F6FF] border-2 border-dashed border-[#FF8500]/50 text-center space-y-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#777777] flex items-center justify-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-[#FF8500]" />
                  <span>
                    {lang === 'bn' ? 'আপনার এককালীন ব্যাকআপ রিকভারি কোড' : 'One-Time Backup Recovery Code'}
                  </span>
                </p>
                <p className="text-2xl font-mono-num font-extrabold tracking-widest text-[#172033] select-all">
                  {issuedRecoveryCode}
                </p>
                <button
                  type="button"
                  onClick={handleCopyRecoveryCode}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-white border border-[#E6ECFA] hover:border-[#FF8500] text-xs font-bold text-[#172033] transition-colors"
                >
                  <Copy className="w-3.5 h-3.5 text-[#FF8500]" />
                  <span>
                    {copiedCode
                      ? lang === 'bn'
                        ? 'কপি হয়েছে!'
                        : 'Copied!'
                      : lang === 'bn'
                        ? 'রিকভারি কোড কপি করুন'
                        : 'Copy Recovery Code'}
                  </span>
                </button>
              </div>

              <p className="text-[11px] text-[#777777] text-center leading-relaxed">
                {lang === 'bn'
                  ? 'নিরাপত্তার কারণে এই কোডটি আর দ্বিতীয়বার দেখানো হবে না। স্ক্রিনশট নিন বা নিরাপদ স্থানে লিখে রাখুন।'
                  : 'For security, this recovery code will not be shown again. Take a screenshot or store it safely.'}
              </p>

              {issuedKind === 'register' ? (
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full py-3 rounded-2xl dh-orange-gradient text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md hover:opacity-95 transition-opacity"
                >
                  <span>{lang === 'bn' ? 'কোড সংরক্ষণ করেছি — এগিয়ে যান' : 'I Saved It — Continue to Dashboard'}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setIssuedRecoveryCode('');
                    setIssuedKind(null);
                    switchMode('login');
                  }}
                  className="w-full py-3 rounded-2xl dh-orange-gradient text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md hover:opacity-95 transition-opacity"
                >
                  <LogIn className="w-4 h-4" />
                  <span>{lang === 'bn' ? 'নতুন পাসওয়ার্ড দিয়ে লগইন করুন' : 'Sign In With New Password'}</span>
                </button>
              )}
            </div>
          ) : (
            <>
              {/* Top Mode Switcher (Login / Create Account) */}
              {mode !== 'reset' ? (
                <div className="grid grid-cols-2 p-1 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA]">
                  <button
                    type="button"
                    onClick={() => switchMode('login')}
                    className={`py-2.5 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                      mode === 'login'
                        ? 'bg-[#172033] text-white shadow-sm'
                        : 'text-[#64748B] hover:text-[#172033]'
                    }`}
                  >
                    <LogIn className="w-4 h-4" />
                    <span>{lang === 'bn' ? 'লগইন' : 'Login'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('register')}
                    className={`py-2.5 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                      mode === 'register'
                        ? 'bg-[#172033] text-white shadow-sm'
                        : 'text-[#64748B] hover:text-[#172033]'
                    }`}
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>{lang === 'bn' ? 'নতুন অ্যাকাউন্ট' : 'Register'}</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => switchMode('login')}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-[#64748B] hover:text-[#172033]"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>{lang === 'bn' ? 'লগইনে ফিরে যান' : 'Back to Login'}</span>
                </button>
              )}

              {/* Title & Subtitle */}
              <div className="space-y-1">
                <h2 className="text-xl font-extrabold text-[#172033]">
                  {mode === 'login'
                    ? lang === 'bn'
                      ? 'আপনার অ্যাকাউন্টে লগইন করুন'
                      : 'Sign In to DIGITAL HUB'
                    : mode === 'register'
                      ? lang === 'bn'
                        ? 'নতুন অ্যাকাউন্ট তৈরি করুন'
                        : 'Create Your Account'
                      : lang === 'bn'
                        ? 'পাসওয়ার্ড রিসেট করুন'
                        : 'Reset Your Password'}
                </h2>
                <p className="text-xs text-[#64748B] leading-relaxed">
                  {mode === 'login'
                    ? authMethod === 'email'
                      ? lang === 'bn'
                        ? 'আপনার ইমেইল ঠিকানা ও পাসওয়ার্ড দিয়ে নিরাপদে লগইন করুন।'
                        : 'Sign in securely using your email address and password.'
                      : lang === 'bn'
                        ? 'আপনার বাংলাদেশি মোবাইল নম্বর (+880) ও পাসওয়ার্ড দিয়ে নিরাপদে লগইন করুন।'
                        : 'Sign in securely using your Bangladesh mobile number (+880) and password.'
                    : mode === 'register'
                      ? authMethod === 'email'
                        ? lang === 'bn'
                          ? 'আপনার ইমেইল ঠিকানা ও পাসওয়ার্ড দিয়ে মুহূর্তেই DIGITAL HUB অ্যাকাউন্ট খুলুন।'
                          : 'Create your DIGITAL HUB account with your email address and password.'
                        : lang === 'bn'
                          ? 'আপনার মোবাইল নম্বর (+880) দিয়ে মুহূর্তেই DIGITAL HUB অ্যাকাউন্ট খুলুন।'
                          : 'Register quickly with your Bangladesh mobile number (+880) and password.'
                      : authMethod === 'email'
                        ? lang === 'bn'
                          ? 'আপনার ইমেইল ঠিকানা এবং ব্যাকআপ রিকভারি কোড ব্যবহার করে নতুন পাসওয়ার্ড সেট করুন।'
                          : 'Use your registered email address and backup recovery code to set a new password.'
                        : lang === 'bn'
                          ? 'আপনার মোবাইল নম্বর এবং ব্যাকআপ রিকভারি কোড ব্যবহার করে নতুন পাসওয়ার্ড সেট করুন।'
                          : 'Use your registered mobile number and backup recovery code to set a new password.'}
                </p>
              </div>

              {/* Method Switcher (Phone / Email) */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => switchMethod('phone')}
                  className={`py-2.5 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 border transition-all ${
                    authMethod === 'phone'
                      ? 'bg-[#FFF7EE] border-[#FF8500] text-[#172033] shadow-xs'
                      : 'bg-[#F3F6FF] border-[#E6ECFA] text-[#64748B] hover:text-[#172033]'
                  }`}
                >
                  <Phone className={`w-3.5 h-3.5 shrink-0 ${authMethod === 'phone' ? 'text-[#FF8500]' : ''}`} />
                  <span>{lang === 'bn' ? 'ফোন নম্বর দিয়ে' : 'With Phone'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchMethod('email')}
                  className={`py-2.5 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 border transition-all ${
                    authMethod === 'email'
                      ? 'bg-[#FFF7EE] border-[#FF8500] text-[#172033] shadow-xs'
                      : 'bg-[#F3F6FF] border-[#E6ECFA] text-[#64748B] hover:text-[#172033]'
                  }`}
                >
                  <Mail className={`w-3.5 h-3.5 shrink-0 ${authMethod === 'email' ? 'text-[#FF8500]' : ''}`} />
                  <span>{lang === 'bn' ? 'ইমেইল দিয়ে' : 'With Email'}</span>
                </button>
              </div>

              {/* Error Banner */}
              {errorMsg && (
                <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 space-y-2.5">
                  <div className="flex items-start gap-2 text-xs font-semibold text-[#DC2626]">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{errorMsg}</span>
                  </div>
                  {(errorCode === 'auth/phone-already-in-use' || errorCode === 'auth/email-already-in-use') &&
                    mode === 'register' && (
                      <button
                        type="button"
                        onClick={() => switchMode('login')}
                        className="px-3.5 py-1.5 rounded-xl dh-orange-gradient text-white text-xs font-bold inline-flex items-center gap-1"
                      >
                        <span>
                          {errorCode === 'auth/email-already-in-use'
                            ? lang === 'bn'
                              ? 'এই ইমেইল দিয়ে লগইন করুন'
                              : 'Login with this email'
                            : lang === 'bn'
                              ? 'এই নম্বর দিয়ে লগইন করুন'
                              : 'Login with this number'}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    )}
                  {errorCode === 'auth/user-not-found' && mode === 'login' && (
                    <button
                      type="button"
                      onClick={() => switchMode('register')}
                      className="px-3.5 py-1.5 rounded-xl dh-orange-gradient text-white text-xs font-bold inline-flex items-center gap-1"
                    >
                      <span>{lang === 'bn' ? 'নতুন অ্যাকাউন্ট খুলুন' : 'Create New Account'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}

              {/* LOGIN FORM */}
              {mode === 'login' && (
                <form onSubmit={handleLoginSubmit} className="space-y-4">
                  {authMethod === 'phone' ? (
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-[#172033]">
                        {lang === 'bn' ? 'বাংলাদেশি মোবাইল নম্বর' : 'Bangladesh Mobile Number'}
                      </label>
                      <div className="flex items-center rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus-within:border-[#FF8500] focus-within:bg-white transition-colors overflow-hidden">
                        <span className="px-3 py-2.5 bg-[#E9EFFC] text-[#172033] text-xs font-mono-num font-extrabold border-r border-[#DCE4F7] flex items-center gap-1 shrink-0">
                          <Phone className="w-3.5 h-3.5 text-[#FF8500]" />
                          +880
                        </span>
                        <input
                          type="tel"
                          required
                          autoComplete="tel"
                          value={phoneInput}
                          onChange={(e) => setPhoneInput(e.target.value)}
                          placeholder="017XXXXXXXX"
                          className="w-full px-3 py-2.5 bg-transparent text-sm font-mono-num text-[#172033] focus:outline-none"
                        />
                      </div>
                      {normalizedPhone && (
                        <p className="text-[11px] font-semibold text-[#16A34A] font-mono-num">
                          ✓ {lang === 'bn' ? 'সঠিক নম্বর:' : 'Normalized:'} {normalizedPhone}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="block text-xs font-bold text-[#172033]">
                        {lang === 'bn' ? 'ইমেইল ঠিকানা' : 'Email Address'}
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-[#FF8500] absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          required
                          autoComplete="email"
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                          placeholder="name@gmail.com"
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus:border-[#FF8500] focus:bg-white text-sm text-[#172033] focus:outline-none transition-colors"
                        />
                      </div>
                      {normalizedEmail && (
                        <p className="text-[11px] font-semibold text-[#16A34A] font-mono-num truncate">
                          ✓ {lang === 'bn' ? 'ইমেইল:' : 'Email:'} {normalizedEmail}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block text-xs font-bold text-[#172033]">
                        {lang === 'bn' ? 'পাসওয়ার্ড' : 'Password'}
                      </label>
                      <button
                        type="button"
                        onClick={() => switchMode('reset')}
                        className="text-[11px] font-bold text-[#FF8500] hover:underline"
                      >
                        {lang === 'bn' ? 'পাসওয়ার্ড ভুলে গেছেন?' : 'Forgot Password?'}
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[#777777] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={lang === 'bn' ? 'আপনার পাসওয়ার্ড লিখুন' : 'Enter your password'}
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus:border-[#FF8500] focus:bg-white text-sm text-[#172033] focus:outline-none transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#172033]"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full py-3 rounded-2xl dh-orange-gradient text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md hover:opacity-95 disabled:opacity-60 transition-opacity"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>
                      {busy
                        ? lang === 'bn'
                          ? 'লগইন হচ্ছে...'
                          : 'Signing in...'
                        : authMethod === 'email'
                          ? lang === 'bn'
                            ? 'ইমেইল দিয়ে লগইন করুন'
                            : 'Login with Email'
                          : lang === 'bn'
                            ? 'ফোন নম্বর দিয়ে লগইন করুন'
                            : 'Login with Phone'}
                    </span>
                  </button>

                  <p className="text-center text-xs text-[#64748B]">
                    {lang === 'bn' ? 'নতুন ব্যবহারকারী?' : "Don't have an account?"}{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('register')}
                      className="font-extrabold text-[#FF8500] hover:underline"
                    >
                      {lang === 'bn' ? 'নতুন অ্যাকাউন্ট খুলুন' : 'Create Account'}
                    </button>
                  </p>
                </form>
              )}

              {/* REGISTER FORM */}
              {mode === 'register' && (
                <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-[#172033]">
                      {lang === 'bn' ? 'পূর্ণ নাম' : 'Full Name'}
                    </label>
                    <div className="relative">
                      <UserIcon className="w-4 h-4 text-[#777777] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        minLength={2}
                        maxLength={100}
                        autoComplete="name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder={lang === 'bn' ? 'আপনার পূর্ণ নাম লিখুন' : 'Enter your full name'}
                        className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus:border-[#FF8500] focus:bg-white text-sm text-[#172033] focus:outline-none transition-colors"
                      />
                    </div>
                  </div>

                  {authMethod === 'phone' ? (
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-[#172033]">
                        {lang === 'bn' ? 'বাংলাদেশি মোবাইল নম্বর (+880)' : 'Bangladesh Mobile Number (+880)'}
                      </label>
                      <div className="flex items-center rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus-within:border-[#FF8500] focus-within:bg-white transition-colors overflow-hidden">
                        <span className="px-3 py-2.5 bg-[#E9EFFC] text-[#172033] text-xs font-mono-num font-extrabold border-r border-[#DCE4F7] flex items-center gap-1 shrink-0">
                          <Phone className="w-3.5 h-3.5 text-[#FF8500]" />
                          +880
                        </span>
                        <input
                          type="tel"
                          required
                          autoComplete="tel"
                          value={phoneInput}
                          onChange={(e) => setPhoneInput(e.target.value)}
                          placeholder="017XXXXXXXX"
                          className="w-full px-3 py-2.5 bg-transparent text-sm font-mono-num text-[#172033] focus:outline-none"
                        />
                      </div>
                      {phoneInput.trim() && (
                        <p
                          className={`text-[11px] font-semibold font-mono-num ${
                            normalizedPhone ? 'text-[#16A34A]' : 'text-[#DC2626]'
                          }`}
                        >
                          {normalizedPhone
                            ? `✓ ${lang === 'bn' ? 'ভেরিফায়েড ফরম্যাট:' : 'Format OK:'} ${normalizedPhone}`
                            : lang === 'bn'
                              ? 'সঠিক ১১-ডিজিট নম্বর দিন (013–019 দিয়ে শুরু)'
                              : 'Enter a valid 11-digit BD number (starts with 013–019)'}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-[#172033]">
                        {lang === 'bn' ? 'ইমেইল ঠিকানা (Gmail বা যেকোনো বৈধ ইমেইল)' : 'Email Address'}
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-[#FF8500] absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          required
                          autoComplete="email"
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                          placeholder="name@gmail.com"
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus:border-[#FF8500] focus:bg-white text-sm text-[#172033] focus:outline-none transition-colors"
                        />
                      </div>
                      {emailInput.trim() && (
                        <p
                          className={`text-[11px] font-semibold font-mono-num truncate ${
                            normalizedEmail ? 'text-[#16A34A]' : 'text-[#DC2626]'
                          }`}
                        >
                          {normalizedEmail
                            ? `✓ ${lang === 'bn' ? 'সঠিক ইমেইল:' : 'Valid email:'} ${normalizedEmail}`
                            : lang === 'bn'
                              ? 'সঠিক ইমেইল ঠিকানা লিখুন (যেমন: name@gmail.com)'
                              : 'Please enter a valid email address (e.g. name@gmail.com)'}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-[#172033]">
                      {authMethod === 'email'
                        ? lang === 'bn'
                          ? 'পাসওয়ার্ড (কমপক্ষে ৮ অক্ষর বা অক্ষর+সংখ্যা ৬+)'
                          : 'Password (min 8 chars, or 6+ with letters & numbers)'
                        : lang === 'bn'
                          ? 'পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)'
                          : 'Password (min 6 characters)'}
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[#777777] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={lang === 'bn' ? 'শক্তিশালী পাসওয়ার্ড দিন' : 'Create a password'}
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus:border-[#FF8500] focus:bg-white text-sm text-[#172033] focus:outline-none transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#172033]"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {password && (
                      <div className="space-y-1 pt-0.5">
                        <div className="grid grid-cols-4 gap-1">
                          {[1, 2, 3, 4].map((idx) => (
                            <div
                              key={idx}
                              className={`h-1 rounded-full transition-colors ${
                                idx <= strength.score ? strength.color : 'bg-gray-200'
                              }`}
                            />
                          ))}
                        </div>
                        <p className="text-[11px] text-[#64748B] font-semibold">
                          {lang === 'bn' ? 'পাসওয়ার্ডের শক্তি:' : 'Password strength:'}{' '}
                          <span className="text-[#172033]">{strength.label}</span>
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-[#172033]">
                      {lang === 'bn' ? 'পাসওয়ার্ড নিশ্চিত করুন' : 'Confirm Password'}
                    </label>
                    <div className="relative">
                      <ShieldCheck className="w-4 h-4 text-[#777777] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={lang === 'bn' ? 'পুনরায় পাসওয়ার্ড লিখুন' : 'Re-enter your password'}
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus:border-[#FF8500] focus:bg-white text-sm text-[#172033] focus:outline-none transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B] hover:text-[#172033]"
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {confirmPassword && (
                      <p
                        className={`text-[11px] font-semibold ${
                          password === confirmPassword ? 'text-[#16A34A]' : 'text-[#DC2626]'
                        }`}
                      >
                        {password === confirmPassword
                          ? lang === 'bn'
                            ? '✓ পাসওয়ার্ড মিলেছে'
                            : '✓ Passwords match'
                          : lang === 'bn'
                            ? 'পাসওয়ার্ড মেলেনি'
                            : 'Passwords do not match'}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-[#172033] flex items-center gap-1">
                      <Gift className="w-3.5 h-3.5 text-[#FF8500]" />
                      <span>{lang === 'bn' ? 'রেফারেল কোড (ঐচ্ছিক)' : 'Referral Code (Optional)'}</span>
                    </label>
                    <input
                      type="text"
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                      placeholder={lang === 'bn' ? 'থাকলে কোড দিন (যেমন: DHXXXXXX)' : 'Optional code (e.g. DHXXXXXX)'}
                      className="w-full px-3.5 py-2 rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus:border-[#FF8500] focus:bg-white text-xs font-mono-num uppercase text-[#172033] focus:outline-none transition-colors"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full py-3 rounded-2xl dh-orange-gradient text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md hover:opacity-95 disabled:opacity-60 transition-opacity"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span>
                      {busy
                        ? lang === 'bn'
                          ? 'অ্যাকাউন্ট তৈরি হচ্ছে...'
                          : 'Creating Account...'
                        : lang === 'bn'
                          ? 'অ্যাকাউন্ট তৈরি করুন'
                          : 'Create Account'}
                    </span>
                  </button>

                  <p className="text-center text-xs text-[#64748B]">
                    {lang === 'bn' ? 'ইতিমধ্যে অ্যাকাউন্ট আছে?' : 'Already have an account?'}{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="font-extrabold text-[#FF8500] hover:underline"
                    >
                      {lang === 'bn' ? 'লগইন করুন' : 'Login'}
                    </button>
                  </p>
                </form>
              )}

              {/* FORGOT PASSWORD / RECOVERY RESET FORM */}
              {mode === 'reset' && (
                <form onSubmit={handleResetSubmit} className="space-y-3.5">
                  {authMethod === 'phone' ? (
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-[#172033]">
                        {lang === 'bn' ? 'নিবন্ধিত মোবাইল নম্বর' : 'Registered Mobile Number'}
                      </label>
                      <div className="flex items-center rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus-within:border-[#FF8500] focus-within:bg-white overflow-hidden">
                        <span className="px-3 py-2.5 bg-[#E9EFFC] text-[#172033] text-xs font-mono-num font-extrabold border-r border-[#DCE4F7] shrink-0">
                          +880
                        </span>
                        <input
                          type="tel"
                          required
                          value={phoneInput}
                          onChange={(e) => setPhoneInput(e.target.value)}
                          placeholder="017XXXXXXXX"
                          className="w-full px-3 py-2.5 bg-transparent text-sm font-mono-num text-[#172033] focus:outline-none"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <label className="block text-xs font-bold text-[#172033]">
                        {lang === 'bn' ? 'নিবন্ধিত ইমেইল ঠিকানা' : 'Registered Email Address'}
                      </label>
                      <div className="relative">
                        <Mail className="w-4 h-4 text-[#FF8500] absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="email"
                          required
                          value={emailInput}
                          onChange={(e) => setEmailInput(e.target.value)}
                          placeholder="name@gmail.com"
                          className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus:border-[#FF8500] focus:bg-white text-sm text-[#172033] focus:outline-none"
                        />
                      </div>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-[#172033]">
                      {lang === 'bn' ? 'ব্যাকআপ রিকভারি কোড' : 'Backup Recovery Code'}
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-[#FF8500] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        required
                        value={recoveryCodeInput}
                        onChange={(e) => setRecoveryCodeInput(e.target.value.toUpperCase())}
                        placeholder="DH-XXXX-XXXX"
                        className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus:border-[#FF8500] focus:bg-white text-sm font-mono-num uppercase text-[#172033] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-[#172033]">
                      {lang === 'bn' ? 'নতুন পাসওয়ার্ড' : 'New Password'}
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-[#777777] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={lang === 'bn' ? 'কমপক্ষে ৬ অক্ষরের নতুন পাসওয়ার্ড' : 'New password (min 6 chars)'}
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus:border-[#FF8500] focus:bg-white text-sm text-[#172033] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B]"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-[#172033]">
                      {lang === 'bn' ? 'নতুন পাসওয়ার্ড নিশ্চিত করুন' : 'Confirm New Password'}
                    </label>
                    <div className="relative">
                      <ShieldCheck className="w-4 h-4 text-[#777777] absolute left-3.5 top-1/2 -translate-y-1/2" />
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={lang === 'bn' ? 'পুনরায় নতুন পাসওয়ার্ড লিখুন' : 'Re-enter new password'}
                        className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#DCE4F7] focus:border-[#FF8500] focus:bg-white text-sm text-[#172033] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#64748B]"
                      >
                        {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full py-3 rounded-2xl dh-orange-gradient text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-md hover:opacity-95 disabled:opacity-60"
                  >
                    <KeyRound className="w-4 h-4" />
                    <span>
                      {busy
                        ? lang === 'bn'
                          ? 'রিসেট হচ্ছে...'
                          : 'Resetting...'
                        : lang === 'bn'
                          ? 'পাসওয়ার্ড রিসেট করুন'
                          : 'Reset Password'}
                    </span>
                  </button>

                  <div className="p-3 rounded-2xl bg-[#FFF7EE] border border-[#F3DFC8] text-[11px] text-[#64748B] space-y-1.5">
                    <p className="font-bold text-[#172033]">
                      {lang === 'bn' ? 'রিকভারি কোড হারিয়ে ফেলেছেন?' : 'Lost your recovery code?'}
                    </p>
                    <p>
                      {lang === 'bn'
                        ? 'সরাসরি আমাদের অফিশিয়াল সাপোর্টে যোগাযোগ করে অ্যাকাউন্ট যাচাই করুন:'
                        : 'Contact official support to verify your account:'}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      <a
                        href={supportTelegramUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-white border border-[#E6ECFA] text-[#0088cc] font-bold hover:underline"
                      >
                        Telegram Support
                      </a>
                      <a
                        href={supportWhatsappUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-white border border-[#E6ECFA] text-[#16A34A] font-bold hover:underline"
                      >
                        WhatsApp Support
                      </a>
                    </div>
                  </div>
                </form>
              )}

              {/* Footer Security Note */}
              <div className="pt-2 border-t border-[#E6ECFA] flex items-center justify-center gap-1.5 text-[11px] text-[#64748B]">
                <ShieldCheck className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                <span>
                  {lang === 'bn'
                    ? 'এনক্রিপ্টেড পাসওয়ার্ড ও নিরাপদ HTTP-only সেশন সুরক্ষা'
                    : 'PBKDF2 encrypted credentials & HTTP-only session security'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
