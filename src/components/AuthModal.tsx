import { FormEvent, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from 'firebase/auth';
import { CheckCircle2, KeyRound, Mail, RefreshCw, ShieldCheck, UserPlus, X } from 'lucide-react';
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
  onRefreshVerification?: () => Promise<void>;
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
  onRefreshVerification,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [referralCode, setReferralCode] = useState(initialReferralCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (open) {
      setMode(initialMode);
    }
  }, [open, initialMode]);

  useEffect(() => {
    if (initialReferralCode) {
      setReferralCode(initialReferralCode);
    }
  }, [initialReferralCode]);

  if (!open) return null;

  const handleGoogleSignIn = async () => {
    setError('');
    setInfo('');
    setLoading(true);
    try {
      if (referralCode.trim()) onReferralCapture(referralCode.trim());
      await signInWithPopup(auth, googleProvider);
      onLoginSuccess?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Sign-In failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    try {
      if (referralCode.trim()) onReferralCapture(referralCode.trim());

      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, email.trim());
        setInfo(
          lang === 'bn'
            ? 'পাসওয়ার্ড রিসেট লিংক আপনার ইমেইলে পাঠানো হয়েছে।'
            : 'Password reset link has been sent to your email.'
        );
      } else if (mode === 'register') {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) {
          await updateProfile(cred.user, { displayName: name.trim() });
        }
        await sendEmailVerification(cred.user);
        setInfo(
          lang === 'bn'
            ? 'অ্যাকাউন্ট তৈরি হয়েছে! অনুগ্রহ করে আপনার ইমেইল ইনবক্স থেকে ভেরিফিকেশন লিংক নিশ্চিত করুন।'
            : 'Account created! Please click the verification link sent to your email.'
        );
      } else {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        if (cred.user.emailVerified) {
          onLoginSuccess?.();
          onClose();
        } else {
          setInfo(t(lang, 'verifyEmailDesc'));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!auth.currentUser) return;
    setError('');
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
      setError(err instanceof Error ? err.message : 'Could not resend email');
    } finally {
      setLoading(false);
    }
  };

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
                    onClick={onRefreshVerification}
                    className="w-full py-2.5 rounded-xl dh-orange-gradient text-white font-bold text-sm flex items-center justify-center gap-2"
                  >
                    <RefreshCw className="w-4 h-4" />
                    {t(lang, 'refreshVerification')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleResendVerification}
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-[#172033] font-semibold text-sm hover:border-[#FF8500]"
                >
                  {t(lang, 'resendVerification')}
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
                  className="w-full py-3 px-4 rounded-xl bg-[#172033] hover:bg-[#23314d] text-white font-bold text-sm flex items-center justify-center gap-2.5 transition-colors shadow-sm"
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
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-semibold">
                  {error}
                </div>
              )}
              {info && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{info}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-3">
                {mode === 'register' && (
                  <div>
                    <label className="block text-xs font-bold text-[#172033] mb-1">
                      {lang === 'bn' ? 'পুরো নাম' : 'Full Name'}
                    </label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={lang === 'bn' ? 'আপনার নাম লিখুন' : 'Your full name'}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm text-[#172033] focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-[#172033] mb-1">
                    {lang === 'bn' ? 'ইমেইল ঠিকানা' : 'Email Address'}
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.com"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm text-[#172033] focus:outline-none focus:border-[#FF8500]"
                  />
                </div>

                {mode !== 'reset' && (
                  <div>
                    <label className="block text-xs font-bold text-[#172033] mb-1">
                      {lang === 'bn' ? 'পাসওয়ার্ড' : 'Password'}
                    </label>
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm text-[#172033] focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>
                )}

                {mode === 'register' && (
                  <div>
                    <label className="block text-xs font-bold text-[#172033] mb-1">
                      {lang === 'bn' ? 'রেফারেল কোড (ঐচ্ছিক)' : 'Referral Code (Optional)'}
                    </label>
                    <input
                      type="text"
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
                      onClick={() => {
                        setMode('register');
                        setError('');
                        setInfo('');
                      }}
                      className="font-bold text-[#FF8500] hover:underline"
                    >
                      {lang === 'bn' ? 'নতুন অ্যাকাউন্ট খুলুন' : 'Create new account'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMode('reset');
                        setError('');
                        setInfo('');
                      }}
                      className="text-[#777777] hover:text-[#172033]"
                    >
                      {lang === 'bn' ? 'পাসওয়ার্ড ভুলে গেছেন?' : 'Forgot password?'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setMode('login');
                      setError('');
                      setInfo('');
                    }}
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
