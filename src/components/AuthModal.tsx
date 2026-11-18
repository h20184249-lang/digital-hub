import { FormEvent, useEffect, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { CheckCircle2, KeyRound, LogOut, Mail, RefreshCw, ShieldCheck, UserPlus, X } from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { Language } from '../types/marketplace';
import { t } from '../lib/i18n';
import { DigitalHubLogo } from './DigitalHubLogo';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  lang: Language;
  initialMode?: 'login' | 'register';
  initialReferralCode?: string;
  onReferralCapture: (code: string) => void;
  onLoginSuccess?: () => void;
  needsVerification?: boolean;
  pendingEmail?: string;
  onRefreshVerification?: () => Promise<boolean>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getFirebaseAuthErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) {
      return code.trim();
    }
  }
  if (err instanceof Error) {
    const match = err.message.match(/\((auth\/[a-z0-9-]+)\)/i);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return '';
}

function mapFirebaseAuthError(
  err: unknown,
  mode: 'login' | 'register' | 'reset' | 'google' | 'verify',
  lang: Language
): { code: string; message: string } {
  const code = getFirebaseAuthErrorCode(err);

  switch (code) {
    case 'auth/email-already-in-use':
      return {
        code,
        message:
          lang === 'bn'
            ? 'এই ইমেইল ঠিকানাটি ইতিমধ্যেই নিবন্ধিত আছে। অনুগ্রহ করে লগইন করুন অথবা পাসওয়ার্ড রিসেট করুন।'
            : 'This email address is already registered. Please sign in or reset your password.',
      };
    case 'auth/operation-not-allowed':
      return {
        code,
        message:
          lang === 'bn'
            ? 'Firebase কনসোলে Email/Password রেজিস্ট্রেশন বর্তমানে বন্ধ আছে। অনুগ্রহ করে Google অ্যাকাউন্ট দিয়ে সাইনআপ করুন অথবা Firebase Authentication-এ Email/Password চালু করুন।'
            : 'Email/Password sign-up is currently disabled in Firebase Authentication Console. Please continue with Google or enable Email/Password in Firebase Console.',
      };
    case 'auth/invalid-email':
      return {
        code,
        message:
          lang === 'bn'
            ? 'অনুগ্রহ করে একটি সঠিক ইমেইল ঠিকানা লিখুন।'
            : 'Please enter a valid email address.',
      };
    case 'auth/weak-password':
      return {
        code,
        message:
          lang === 'bn'
            ? 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে এবং আরও শক্তিশালী পাসওয়ার্ড ব্যবহার করুন।'
            : 'Password must be at least 6 characters long. Please choose a stronger password.',
      };
    case 'auth/missing-password':
      return {
        code,
        message:
          lang === 'bn'
            ? 'অনুগ্রহ করে আপনার পাসওয়ার্ড লিখুন।'
            : 'Please enter your password.',
      };
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return {
        code,
        message:
          mode === 'reset'
            ? lang === 'bn'
              ? 'এই ইমেইল দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি।'
              : 'No account was found with this email address.'
            : lang === 'bn'
              ? 'ইমেইল অথবা পাসওয়ার্ড সঠিক নয়। অনুগ্রহ করে আবার চেষ্টা করুন।'
              : 'Incorrect email or password. Please try again.',
      };
    case 'auth/user-disabled':
      return {
        code,
        message:
          lang === 'bn'
            ? 'এই অ্যাকাউন্টটি সাময়িকভাবে নিষ্ক্রিয় করা হয়েছে। সাপোর্টে যোগাযোগ করুন।'
            : 'This account has been disabled. Please contact support.',
      };
    case 'auth/too-many-requests':
      return {
        code,
        message:
          lang === 'bn'
            ? 'অনেকবার চেষ্টা করা হয়েছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।'
            : 'Too many attempts. Please wait a few minutes and try again.',
      };
    case 'auth/network-request-failed':
      return {
        code,
        message:
          lang === 'bn'
            ? 'নেটওয়ার্ক সংযোগে সমস্যা হয়েছে। আপনার ইন্টারনেট পরীক্ষা করে আবার চেষ্টা করুন।'
            : 'Network error. Please check your internet connection and try again.',
      };
    case 'auth/unauthorized-domain':
      return {
        code,
        message:
          lang === 'bn'
            ? 'এই ডোমেইনটি Firebase Auth Authorized Domains-এ অনুমোদিত নয়।'
            : 'This domain is not authorized in Firebase Authentication settings.',
      };
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return {
        code,
        message:
          lang === 'bn'
            ? 'Google লগইন পপআপটি বন্ধ করা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Google Sign-In popup was closed before completing. Please try again.',
      };
    case 'auth/popup-blocked':
      return {
        code,
        message:
          lang === 'bn'
            ? 'ব্রাউজার পপআপ ব্লক করেছে। অনুগ্রহ করে পপআপ অনুমতি দিয়ে আবার চেষ্টা করুন।'
            : 'Sign-in popup was blocked by your browser. Please allow popups and try again.',
      };
    case 'auth/account-exists-with-different-credential':
      return {
        code,
        message:
          lang === 'bn'
            ? 'এই ইমেইলটি অন্য সাইন-ইন পদ্ধতিতে নিবন্ধিত আছে। অনুগ্রহ করে আগের পদ্ধতি দিয়ে লগইন করুন।'
            : 'An account already exists with this email using a different sign-in method.',
      };
    default: {
      const rawMessage = err instanceof Error ? err.message : '';
      return {
        code,
        message:
          rawMessage ||
          (lang === 'bn'
            ? 'অথেনটিকেশন সম্পন্ন করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Authentication could not be completed. Please try again.'),
      };
    }
  }
}

export function AuthModal({
  open,
  onClose,
  lang,
  initialMode = 'login',
  initialReferralCode = '',
  onReferralCapture,
  onLoginSuccess,
  needsVerification = false,
  pendingEmail = '',
  onRefreshVerification,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [info, setInfo] = useState('');
  const submittingRef = useRef(false);

  // Reset transient credentials and error banners whenever modal opens or closes
  // so stale login state or browser autofill is never reused across registration attempts.
  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setName('');
      setEmail('');
      setPassword('');
      setError('');
      setErrorCode('');
      setInfo('');
      submittingRef.current = false;
      setLoading(false);
    } else {
      setPassword('');
      setError('');
      setErrorCode('');
      setInfo('');
      submittingRef.current = false;
      setLoading(false);
    }
  }, [open, initialMode]);

  useEffect(() => {
    if (initialReferralCode) {
      setReferralCode(initialReferralCode);
    }
  }, [initialReferralCode]);

  if (!open) return null;

  const switchMode = (nextMode: 'login' | 'register' | 'reset', preserveEmail = false) => {
    setMode(nextMode);
    setError('');
    setErrorCode('');
    setInfo('');
    setPassword('');
    if (!preserveEmail) {
      setName('');
      setEmail('');
    }
  };

  const handleGoogleSignIn = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setErrorCode('');
    setInfo('');
    setLoading(true);
    try {
      if (referralCode.trim()) onReferralCapture(referralCode.trim());
      await signInWithPopup(auth, googleProvider);
      onLoginSuccess?.();
      onClose();
    } catch (err) {
      const mapped = mapFirebaseAuthError(err, 'google', lang);
      setErrorCode(mapped.code);
      setError(mapped.message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;

    const normalizedEmail = email.trim().toLowerCase();
    const cleanName = name.trim();

    setError('');
    setErrorCode('');
    setInfo('');

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError(
        lang === 'bn'
          ? 'অনুগ্রহ করে একটি সঠিক ইমেইল ঠিকানা লিখুন।'
          : 'Please enter a valid email address.'
      );
      return;
    }

    if (mode === 'register' && !cleanName) {
      setError(
        lang === 'bn'
          ? 'অনুগ্রহ করে আপনার পুরো নাম লিখুন।'
          : 'Please enter your full name.'
      );
      return;
    }

    if (mode !== 'reset' && password.length < 6) {
      setError(
        lang === 'bn'
          ? 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'
          : 'Password must be at least 6 characters long.'
      );
      return;
    }

    submittingRef.current = true;
    setLoading(true);

    try {
      if (referralCode.trim()) onReferralCapture(referralCode.trim());

      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, normalizedEmail);
        setInfo(
          lang === 'bn'
            ? `পাসওয়ার্ড রিসেট লিংক ${normalizedEmail} ইমেইলে পাঠানো হয়েছে।`
            : `Password reset link has been sent to ${normalizedEmail}.`
        );
      } else if (mode === 'register') {
        // Step 1: Create the Firebase Auth account with normalized email & user-entered password.
        // Errors thrown ONLY by createUserWithEmailAndPassword surface in the outer catch block.
        const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password);

        // Step 2: Account creation succeeded. Isolate post-signup operations so a non-fatal
        // profile or email delivery error never makes registration appear failed or triggers retries.
        setPassword('');

        if (cleanName) {
          await updateProfile(cred.user, { displayName: cleanName }).catch((profileErr) => {
            console.warn('Non-fatal displayName update error after signup:', profileErr);
          });
        }

        try {
          await sendEmailVerification(cred.user);
          setInfo(
            lang === 'bn'
              ? `অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে (${normalizedEmail})! অনুগ্রহ করে আপনার ইমেইল ইনবক্স বা Spam ফোল্ডার থেকে ভেরিফিকেশন লিংক নিশ্চিত করুন।`
              : `Account created (${normalizedEmail})! Please check your inbox or Spam folder and click the verification link.`
          );
        } catch (verifyErr) {
          console.warn('Non-fatal verification email error after signup:', verifyErr);
          setInfo(
            lang === 'bn'
              ? `অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে (${normalizedEmail}), তবে ভেরিফিকেশন ইমেইল পাঠাতে সাময়িক সমস্যা হয়েছে। নিচের "পুনরায় ইমেইল পাঠান" বাটনে ক্লিক করুন।`
              : `Account created (${normalizedEmail}), but sending the verification email encountered a temporary issue. Please click "Resend Verification Email" below.`
          );
        }
      } else {
        const cred = await signInWithEmailAndPassword(auth, normalizedEmail, password);
        setPassword('');
        if (cred.user.emailVerified) {
          onLoginSuccess?.();
          onClose();
        } else {
          setInfo(t(lang, 'verifyEmailDesc'));
        }
      }
    } catch (err) {
      const mapped = mapFirebaseAuthError(err, mode, lang);
      setErrorCode(mapped.code);
      setError(mapped.message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleRefreshVerificationClick = async () => {
    if (!onRefreshVerification || submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setErrorCode('');
    setInfo('');
    setLoading(true);
    try {
      const verified = await onRefreshVerification();
      if (!verified) {
        setInfo(
          lang === 'bn'
            ? 'ইমেইল এখনো যাচাই হয়নি। আপনার ইনবক্স/Spam ফোল্ডারের লিংকে ক্লিক করে আবার রিফ্রেশ করুন।'
            : 'Email is not verified yet. Please click the verification link in your inbox/Spam folder, then refresh again.'
        );
      }
    } catch (err) {
      const mapped = mapFirebaseAuthError(err, 'verify', lang);
      setErrorCode(mapped.code);
      setError(mapped.message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!auth.currentUser || submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setErrorCode('');
    setInfo('');
    setLoading(true);
    try {
      await sendEmailVerification(auth.currentUser);
      setInfo(
        lang === 'bn'
          ? 'নতুন ভেরিফিকেশন ইমেইল পাঠানো হয়েছে।'
          : 'A new verification email has been sent.'
      );
    } catch (err) {
      const mapped = mapFirebaseAuthError(err, 'verify', lang);
      setErrorCode(mapped.code);
      setError(mapped.message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const handleSwitchAccountSignOut = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      await signOut(auth);
      switchMode('register', false);
    } catch (err) {
      const mapped = mapFirebaseAuthError(err, 'verify', lang);
      setErrorCode(mapped.code);
      setError(mapped.message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const verificationEmailLabel = pendingEmail || auth.currentUser?.email || '';

  return (
    <div className="fixed inset-0 z-50 bg-[#172033]/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl border border-[#E6ECFA] shadow-2xl overflow-hidden">
        <div className="px-6 py-4 bg-[#FFF7EE] border-b border-[#E6ECFA] flex items-center justify-between">
          <DigitalHubLogo compact />
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl bg-white border border-[#E6ECFA] text-[#777777] hover:text-[#172033]"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {needsVerification ? (
            <div className="space-y-4 text-center">
              <div className="w-12 h-12 rounded-2xl bg-[#FFF3E5] text-[#FF8500] flex items-center justify-center mx-auto">
                <Mail className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-[#172033]">{t(lang, 'verifyEmailTitle')}</h3>
              {verificationEmailLabel && (
                <p className="text-xs font-bold text-[#172033] bg-[#F3F6FF] border border-[#E6ECFA] rounded-xl py-1.5 px-3 inline-block">
                  {verificationEmailLabel}
                </p>
              )}
              <p className="text-xs sm:text-sm text-[#777777]">{t(lang, 'verifyEmailDesc')}</p>

              {info && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold">
                  {info}
                </div>
              )}
              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-semibold">
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-2.5">
                {onRefreshVerification && (
                  <button
                    type="button"
                    onClick={handleRefreshVerificationClick}
                    disabled={loading}
                    className="w-full py-2.5 rounded-xl dh-orange-gradient text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {t(lang, 'refreshVerification')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-[#172033] font-semibold text-sm hover:border-[#FF8500] disabled:opacity-60"
                >
                  {t(lang, 'resendVerification')}
                </button>
                <button
                  type="button"
                  onClick={handleSwitchAccountSignOut}
                  disabled={loading}
                  className="w-full py-2 rounded-xl text-xs font-semibold text-[#777777] hover:text-[#DC2626] flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {lang === 'bn'
                    ? 'লগআউট করে অন্য ইমেইল ব্যবহার করুন'
                    : 'Sign out & use a different email'}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <h2 className="text-xl font-bold text-[#172033]">
                  {mode === 'login'
                    ? lang === 'bn'
                      ? 'আপনার অ্যাকাউন্টে লগইন করুন'
                      : 'Sign In to DIGITAL HUB'
                    : mode === 'register'
                      ? lang === 'bn'
                        ? 'নতুন কাস্টমার অ্যাকাউন্ট তৈরি করুন'
                        : 'Create Customer Account'
                      : lang === 'bn'
                        ? 'পাসওয়ার্ড রিসেট করুন'
                        : 'Reset Your Password'}
                </h2>
                <p className="text-xs text-[#777777] mt-1">{t(lang, 'loginRequiredDesc')}</p>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  disabled={loading}
                  className="w-full py-3 px-4 rounded-xl bg-[#172033] hover:bg-[#23314d] text-white font-bold text-sm flex items-center justify-center gap-2.5 transition-colors shadow-sm disabled:opacity-60"
                >
                  <ShieldCheck className="w-4 h-4 text-[#FF9B19]" />
                  <span>{lang === 'bn' ? 'Google অ্যাকাউন্ট দিয়ে লগইন / সাইনআপ' : 'Continue with Google'}</span>
                </button>
                <p className="text-[11px] text-center text-[#777777]">
                  {lang === 'bn'
                    ? 'অ্যাকাউন্ট রোল সার্ভার থেকে স্বয়ংক্রিয়ভাবে নির্ধারিত হয় — কোনো পৃথক অ্যাডমিন লগইন পেজ নেই।'
                    : 'Access roles are verified automatically by our security server on a single unified login.'}
                </p>
              </div>

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-[#E6ECFA]" />
                <span className="px-3 text-[11px] font-bold uppercase tracking-wider text-[#777777]">
                  {lang === 'bn' ? 'অথবা ইমেইল দিয়ে' : 'OR VIA EMAIL'}
                </span>
                <div className="flex-grow border-t border-[#E6ECFA]" />
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-semibold space-y-2">
                  <p>{error}</p>
                  {mode === 'register' && errorCode === 'auth/email-already-in-use' && (
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => switchMode('login', true)}
                        className="underline font-bold text-[#172033] hover:text-[#FF8500]"
                      >
                        {lang === 'bn' ? 'এই ইমেইল দিয়ে লগইন করুন' : 'Sign in with this email'}
                      </button>
                      <button
                        type="button"
                        onClick={() => switchMode('reset', true)}
                        className="underline font-semibold text-[#777777] hover:text-[#172033]"
                      >
                        {lang === 'bn' ? 'পাসওয়ার্ড রিসেট করুন' : 'Reset password'}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {info && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{info}</span>
                </div>
              )}

              <form key={mode} onSubmit={handleSubmit} className="space-y-3" autoComplete={mode === 'register' ? 'off' : 'on'}>
                {mode === 'register' && (
                  <div>
                    <label htmlFor="dh-register-name" className="block text-xs font-bold text-[#172033] mb-1">
                      {lang === 'bn' ? 'পুরো নাম' : 'Full Name'}
                    </label>
                    <input
                      id="dh-register-name"
                      name="register_full_name"
                      type="text"
                      required
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={lang === 'bn' ? 'আপনার নাম লিখুন' : 'Your full name'}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm text-[#172033] focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>
                )}

                <div>
                  <label htmlFor={`dh-${mode}-email`} className="block text-xs font-bold text-[#172033] mb-1">
                    {lang === 'bn' ? 'ইমেইল ঠিকানা' : 'Email Address'}
                  </label>
                  <input
                    id={`dh-${mode}-email`}
                    name={mode === 'register' ? 'register_email_address' : 'email'}
                    type="email"
                    required
                    autoComplete={mode === 'register' ? 'off' : 'email'}
                    autoCapitalize="none"
                    spellCheck={false}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm text-[#172033] focus:outline-none focus:border-[#FF8500]"
                  />
                </div>

                {mode !== 'reset' && (
                  <div>
                    <label htmlFor={`dh-${mode}-password`} className="block text-xs font-bold text-[#172033] mb-1">
                      {lang === 'bn' ? 'পাসওয়ার্ড' : 'Password'}
                    </label>
                    <input
                      id={`dh-${mode}-password`}
                      name={mode === 'register' ? 'register_new_password' : 'password'}
                      type="password"
                      required
                      minLength={6}
                      autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm text-[#172033] focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>
                )}

                {mode === 'register' && (
                  <div>
                    <label htmlFor="dh-register-referral" className="block text-xs font-bold text-[#172033] mb-1">
                      {lang === 'bn' ? 'রেফারেল কোড (ঐচ্ছিক)' : 'Referral Code (Optional)'}
                    </label>
                    <input
                      id="dh-register-referral"
                      name="register_referral_code"
                      type="text"
                      autoComplete="off"
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                      placeholder="DHXXXXXX"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm font-mono-num text-[#172033] focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl dh-orange-gradient text-white font-bold text-sm shadow-sm hover:opacity-95 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {mode === 'register' ? (
                    <UserPlus className="w-4 h-4" />
                  ) : (
                    <KeyRound className="w-4 h-4" />
                  )}
                  <span>
                    {loading
                      ? '...'
                      : mode === 'login'
                        ? t(lang, 'signIn')
                        : mode === 'register'
                          ? lang === 'bn'
                            ? 'রেজিস্টার করুন'
                            : 'Create Account'
                          : lang === 'bn'
                            ? 'রিসেট লিংক পাঠান'
                            : 'Send Reset Link'}
                  </span>
                </button>
              </form>

              <div className="flex items-center justify-between text-xs pt-2 border-t border-[#E6ECFA]">
                {mode === 'login' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => switchMode('register', false)}
                      className="font-bold text-[#FF8500] hover:underline"
                    >
                      {lang === 'bn' ? 'নতুন অ্যাকাউন্ট খুলুন' : 'Create new account'}
                    </button>
                    <button
                      type="button"
                      onClick={() => switchMode('reset', false)}
                      className="text-[#777777] hover:text-[#172033]"
                    >
                      {lang === 'bn' ? 'পাসওয়ার্ড ভুলে গেছেন?' : 'Forgot password?'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => switchMode('login', false)}
                    className="font-bold text-[#FF8500] hover:underline"
                  >
                    {lang === 'bn' ? 'আগের অ্যাকাউন্টে লগইন করুন' : 'Back to Sign In'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
