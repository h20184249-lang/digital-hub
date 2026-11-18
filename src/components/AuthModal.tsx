import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updateProfile,
  User,
} from 'firebase/auth';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Mail,
  Phone,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import {
  authenticatePhoneServer,
  checkPhoneRegisteredServer,
  clearPendingAuthMeta,
  ensureUserProfile,
  hasExistingUserProfile,
  normalizeBangladeshPhoneClient,
  recoverPhoneAccountServer,
  registerPhoneIndexServer,
  savePendingAuthMeta,
} from '../lib/firestoreService';
import { AuthMethod, Language } from '../types/marketplace';
import { DigitalHubLogo } from './DigitalHubLogo';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
  lang: Language;
  initialMode?: 'login' | 'register';
  initialReferralCode?: string;
  onReferralCapture: (code: string) => void;
  onLoginSuccess?: () => void;
  onPasswordSetupStateChange?: (active: boolean) => void;
  onRegistrationComplete?: (
    user: User,
    isExistingAccount?: boolean,
    meta?: { authMethod?: AuthMethod; phone?: string; displayName?: string }
  ) => Promise<void>;
  needsVerification?: boolean;
  pendingEmail?: string;
  onRefreshVerification?: () => Promise<boolean>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function GoogleBrandMark() {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.2-2.27H12v4.3h6.44a5.5 5.5 0 0 1-2.39 3.61v3h3.87c2.26-2.08 3.57-5.15 3.57-8.64Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.15-4.06 1.15-3.12 0-5.77-2.11-6.72-4.95H1.28v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.29A7.2 7.2 0 0 1 4.9 12c0-.79.14-1.56.38-2.29v-3.1H1.28A12 12 0 0 0 0 12c0 1.94.46 3.77 1.28 5.39l4-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.76c1.76 0 3.34.61 4.58 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.61l4 3.1c.95-2.84 3.6-4.95 6.72-4.95Z"
      />
    </svg>
  );
}

function getFirebaseAuthErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim()) {
      return code.trim().toLowerCase();
    }
  }
  if (err instanceof Error) {
    const match = err.message.match(/\((auth\/[a-z0-9-]+)\)/i);
    if (match?.[1]) return match[1].toLowerCase();
  }
  return '';
}

function mapAuthError(
  err: unknown,
  context: 'google' | 'email-login' | 'email-register' | 'phone-login' | 'phone-register' | 'reset-email' | 'reset-phone' | 'verify',
  lang: Language
): { code: string; message: string } {
  const code = getFirebaseAuthErrorCode(err);
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';

  switch (code) {
    case 'auth/email-already-in-use':
    case 'auth/credential-already-in-use':
      return {
        code: 'auth/email-already-in-use',
        message:
          lang === 'bn'
            ? 'এই ইমেইল দিয়ে আগে থেকেই অ্যাকাউন্ট রয়েছে। অনুগ্রহ করে লগইন করুন।'
            : 'An account already exists with this email. Please log in instead.',
      };
    case 'auth/phone-already-in-use':
      return {
        code: 'auth/phone-already-in-use',
        message:
          lang === 'bn'
            ? 'এই ফোন নম্বর দিয়ে আগে থেকেই অ্যাকাউন্ট রয়েছে। অনুগ্রহ করে ফোন নম্বর ও পাসওয়ার্ড দিয়ে লগইন করুন।'
            : 'An account already exists with this phone number. Please log in with your phone and password.',
      };
    case 'auth/invalid-phone-number':
      return {
        code,
        message:
          lang === 'bn'
            ? 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন (যেমন: 017XXXXXXXX বা +88017XXXXXXXX)।'
            : 'Please enter a valid Bangladesh mobile number (e.g., 017XXXXXXXX or +88017XXXXXXXX).',
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
            ? 'পাসওয়ার্ড দুর্বল। কমপক্ষে ৬ অক্ষরের (অক্ষর ও সংখ্যাসহ) শক্তিশালী পাসওয়ার্ড ব্যবহার করুন।'
            : 'Password is too weak. Use at least 6 characters with letters and numbers.',
      };
    case 'auth/user-not-found':
      return {
        code,
        message:
          context === 'phone-login' || context === 'reset-phone'
            ? lang === 'bn'
              ? 'এই ফোন নম্বর দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি। নতুন অ্যাকাউন্ট তৈরি করুন।'
              : 'No account was found with this phone number. Please create a new account.'
            : lang === 'bn'
              ? 'এই ইমেইল দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি। নতুন অ্যাকাউন্ট তৈরি করুন।'
              : 'No account was found with this email address. Please create a new account.',
      };
    case 'auth/wrong-password':
      return {
        code,
        message:
          lang === 'bn'
            ? 'পাসওয়ার্ড সঠিক নয়। আবার চেষ্টা করুন অথবা "পাসওয়ার্ড ভুলে গেছেন?" ব্যবহার করুন।'
            : 'Incorrect password. Please try again or use "Forgot Password?".',
      };
    case 'auth/invalid-credential':
      return {
        code,
        message:
          context === 'phone-login'
            ? lang === 'bn'
              ? 'ফোন নম্বর অথবা পাসওয়ার্ড সঠিক নয়। আবার পরীক্ষা করে চেষ্টা করুন।'
              : 'Incorrect phone number or password. Please check and try again.'
            : lang === 'bn'
              ? 'ইমেইল অথবা পাসওয়ার্ড সঠিক নয়। আগে Google দিয়ে অ্যাকাউন্ট খুলে থাকলে Google বাটন দিয়ে লগইন করুন।'
              : 'Incorrect email or password. If you previously signed up with Google, use the Google button.',
      };
    case 'auth/unauthorized-domain':
      return {
        code,
        message:
          lang === 'bn'
            ? `এই ডোমেইনটি (${hostname}) Firebase Auth Authorized Domains-এ যুক্ত করা হয়নি। Firebase Console → Authentication → Settings → Authorized domains-এ ডোমেইনটি যোগ করুন।`
            : `This domain (${hostname}) is not authorized in Firebase Authentication. Add it in Firebase Console → Authentication → Settings → Authorized domains.`,
      };
    case 'auth/popup-blocked':
      return {
        code,
        message:
          lang === 'bn'
            ? 'আপনার ব্রাউজার Google পপআপ ব্লক করেছে। পপআপ অনুমতি দিন অথবা নিচের বাটনে ক্লিক করে সরাসরি Google-এ চালিয়ে যান।'
            : 'Your browser blocked the Google popup. Allow popups or click the button below to continue via redirect.',
      };
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return {
        code: 'auth/popup-closed-by-user',
        message:
          lang === 'bn'
            ? 'Google লগইন পপআপ বন্ধ করা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Google Sign-In popup was closed. Please try again.',
      };
    case 'auth/network-request-failed':
      return {
        code,
        message:
          lang === 'bn'
            ? 'ইন্টারনেট সংযোগে সমস্যা হয়েছে। আপনার নেটওয়ার্ক পরীক্ষা করে আবার চেষ্টা করুন।'
            : 'Network connection error. Please check your internet and try again.',
      };
    case 'auth/operation-not-allowed':
      return {
        code,
        message:
          lang === 'bn'
            ? 'Firebase Console-এ Email/Password লগইন পদ্ধতি এখনো চালু করা হয়নি। অ্যাডমিন Firebase Console → Authentication → Sign-in method থেকে Email/Password চালু করলেই এটি সক্রিয় হবে।'
            : 'Email/Password sign-in is not yet enabled in Firebase Console. Enable Email/Password under Authentication → Sign-in method.',
      };
    case 'auth/too-many-requests':
      return {
        code,
        message:
          lang === 'bn'
            ? 'অনেকবার ভুল চেষ্টা করা হয়েছে। নিরাপত্তার জন্য কিছুক্ষণ অপেক্ষা করে আবার চেষ্টা করুন।'
            : 'Too many attempts. Please wait a few minutes and try again.',
      };
    case 'auth/user-disabled':
      return {
        code,
        message:
          lang === 'bn'
            ? 'এই অ্যাকাউন্টটি সাময়িকভাবে নিষ্ক্রিয় করা হয়েছে। অনুগ্রহ করে সাপোর্টে যোগাযোগ করুন।'
            : 'This account has been disabled. Please contact support.',
      };
    case 'auth/account-exists-with-different-credential':
      return {
        code,
        message:
          lang === 'bn'
            ? 'এই ইমেইল দিয়ে অন্য লগইন পদ্ধতিতে অ্যাকাউন্ট রয়েছে। অনুগ্রহ করে সেই পদ্ধতিতে লগইন করে প্রোফাইল থেকে অ্যাকাউন্ট লিংক করুন।'
            : 'An account already exists with this email under another sign-in method. Sign in with that method and link your account from Profile.',
      };
    default: {
      const raw = err instanceof Error ? err.message : '';
      return {
        code,
        message:
          raw ||
          (lang === 'bn'
            ? 'লগইন / সাইনআপ সম্পন্ন করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Authentication could not be completed. Please try again.'),
      };
    }
  }
}

interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  labelBn: string;
  labelEn: string;
  barColor: string;
  textColor: string;
}

function evaluatePasswordStrength(pwd: string): PasswordStrength {
  if (!pwd) {
    return { score: 0, labelBn: '', labelEn: '', barColor: 'bg-[#E6ECFA]', textColor: 'text-[#777777]' };
  }
  let score = 0;
  if (pwd.length >= 6) score += 1;
  if (pwd.length >= 8) score += 1;
  if (/[a-zA-Z]/.test(pwd) && /\d/.test(pwd)) score += 1;
  if (/[A-Z]/.test(pwd) || /[^a-zA-Z0-9]/.test(pwd)) score += 1;
  const clamped = Math.min(4, Math.max(1, score)) as 1 | 2 | 3 | 4;
  if (clamped === 1) {
    return { score: 1, labelBn: 'দুর্বল', labelEn: 'Weak', barColor: 'bg-[#DC2626]', textColor: 'text-[#DC2626]' };
  }
  if (clamped === 2) {
    return { score: 2, labelBn: 'মাঝারি', labelEn: 'Fair', barColor: 'bg-[#F59E0B]', textColor: 'text-[#D97706]' };
  }
  if (clamped === 3) {
    return { score: 3, labelBn: 'ভালো', labelEn: 'Good', barColor: 'bg-[#2563EB]', textColor: 'text-[#2563EB]' };
  }
  return { score: 4, labelBn: 'শক্তিশালী', labelEn: 'Strong', barColor: 'bg-[#16A34A]', textColor: 'text-[#16A34A]' };
}

export function AuthModal({
  open,
  onClose,
  lang,
  initialMode = 'login',
  initialReferralCode = '',
  onReferralCapture,
  onLoginSuccess,
  onPasswordSetupStateChange,
  onRegistrationComplete,
  needsVerification = false,
  pendingEmail = '',
  onRefreshVerification,
}: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>(initialMode);
  const [channel, setChannel] = useState<'email' | 'phone'>('email');
  const [step, setStep] = useState<'default' | 'success'>('default');

  // Shared form fields
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [referralCode, setReferralCode] = useState(initialReferralCode);

  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<'google' | 'submit' | 'verify' | ''>('');
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [info, setInfo] = useState('');
  const [successIdentity, setSuccessIdentity] = useState('');
  const [successIsNew, setSuccessIsNew] = useState(false);
  const [pendingRegisteredPhone, setPendingRegisteredPhone] = useState('');

  const submittingRef = useRef(false);
  const successTimerRef = useRef<number | null>(null);

  const normalizedPhonePreview = useMemo(() => normalizeBangladeshPhoneClient(phoneInput), [phoneInput]);
  const strength = useMemo(() => evaluatePasswordStrength(password), [password]);
  const passwordsMatch = Boolean(confirmPassword) && password === confirmPassword;
  const passwordsMismatch = Boolean(confirmPassword) && password !== confirmPassword;

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        window.clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (open) {
      if (step === 'default') {
        setMode(initialMode);
        setError('');
        setErrorCode('');
        setInfo('');
      }
    } else {
      setStep('default');
      setFullName('');
      setEmail('');
      setPhoneInput('');
      setPassword('');
      setConfirmPassword('');
      setShowPassword(false);
      setShowConfirmPassword(false);
      setError('');
      setErrorCode('');
      setInfo('');
      setSuccessIdentity('');
      setPendingRegisteredPhone('');
      submittingRef.current = false;
      setLoading(false);
      setLoadingAction('');
      onPasswordSetupStateChange?.(false);
    }
  }, [open, initialMode]);

  useEffect(() => {
    if (initialReferralCode) {
      setReferralCode(initialReferralCode);
    }
  }, [initialReferralCode]);

  if (!open) return null;

  const clearFeedback = () => {
    setError('');
    setErrorCode('');
    setInfo('');
  };

  const switchMode = (
    nextMode: 'login' | 'register' | 'reset',
    options?: { nextChannel?: 'email' | 'phone'; keepEmail?: boolean; keepPhone?: boolean }
  ) => {
    setMode(nextMode);
    if (options?.nextChannel) setChannel(options.nextChannel);
    setStep('default');
    clearFeedback();
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
    if (!options?.keepEmail) setEmail('');
    if (!options?.keepPhone) setPhoneInput('');
  };

  const switchChannel = (nextChannel: 'email' | 'phone') => {
    setChannel(nextChannel);
    clearFeedback();
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  const finishWithSuccess = (
    signedInUser: User,
    isExistingAccount: boolean,
    identityLabel: string,
    meta: { authMethod: AuthMethod; phone?: string; displayName?: string }
  ) => {
    setSuccessIdentity(identityLabel);
    setSuccessIsNew(!isExistingAccount);
    setStep('success');
    onLoginSuccess?.();

    successTimerRef.current = window.setTimeout(async () => {
      onPasswordSetupStateChange?.(false);
      if (onRegistrationComplete) {
        await onRegistrationComplete(signedInUser, isExistingAccount, meta);
      } else {
        onClose();
      }
    }, 850);
  };

  // =========================================================================
  // METHOD A: GOOGLE ACCOUNT (Popup primary + optional Redirect fallback)
  // =========================================================================
  const handleGoogleSignIn = async (useRedirect = false) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    clearFeedback();
    setLoading(true);
    setLoadingAction('google');
    onPasswordSetupStateChange?.(true);

    try {
      if (referralCode.trim()) onReferralCapture(referralCode.trim());
      googleProvider.setCustomParameters({ prompt: 'select_account' });

      if (useRedirect) {
        await signInWithRedirect(auth, googleProvider);
        return;
      }

      const cred = await signInWithPopup(auth, googleProvider);
      const signedInUser = cred.user;
      const verifiedEmail = (signedInUser.email || '').trim().toLowerCase();
      const verifiedName = (
        signedInUser.displayName ||
        verifiedEmail.split('@')[0] ||
        'Customer'
      ).trim();

      const existing = await hasExistingUserProfile(signedInUser.uid);

      await ensureUserProfile(
        signedInUser.uid,
        verifiedEmail,
        verifiedName,
        lang,
        referralCode.trim(),
        signedInUser.photoURL || '',
        'google'
      ).catch((profileErr) => {
        console.warn('Non-fatal Google profile sync error:', profileErr);
      });

      clearPendingAuthMeta();
      finishWithSuccess(signedInUser, existing, verifiedEmail || verifiedName, {
        authMethod: 'google',
        displayName: verifiedName,
      });
    } catch (err) {
      onPasswordSetupStateChange?.(false);
      const mapped = mapAuthError(err, 'google', lang);
      setErrorCode(mapped.code);
      setError(mapped.message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
      setLoadingAction('');
    }
  };

  // =========================================================================
  // METHOD B & C: EMAIL / PHONE FORM SUBMIT (Login, Register, Reset)
  // =========================================================================
  const handlePrimaryFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    clearFeedback();

    // -----------------------------------------------------------------------
    // FORGOT PASSWORD / ACCOUNT RECOVERY
    // -----------------------------------------------------------------------
    if (mode === 'reset') {
      if (channel === 'email') {
        const normalizedEmail = email.trim().toLowerCase();
        if (!EMAIL_PATTERN.test(normalizedEmail)) {
          setErrorCode('auth/invalid-email');
          setError(
            lang === 'bn'
              ? 'অনুগ্রহ করে একটি সঠিক ইমেইল ঠিকানা লিখুন।'
              : 'Please enter a valid email address.'
          );
          return;
        }
        submittingRef.current = true;
        setLoading(true);
        setLoadingAction('submit');
        try {
          await sendPasswordResetEmail(auth, normalizedEmail);
          setInfo(
            lang === 'bn'
              ? `পাসওয়ার্ড রিসেট লিংক ${normalizedEmail} ইমেইলে পাঠানো হয়েছে। অনুগ্রহ করে ইনবক্স বা Spam ফোল্ডার চেক করুন।`
              : `Password reset link sent to ${normalizedEmail}. Please check your inbox or Spam folder.`
          );
        } catch (err) {
          const mapped = mapAuthError(err, 'reset-email', lang);
          setErrorCode(mapped.code);
          setError(mapped.message);
        } finally {
          submittingRef.current = false;
          setLoading(false);
          setLoadingAction('');
        }
        return;
      }

      // Phone Account Recovery
      const normalizedPhone = normalizeBangladeshPhoneClient(phoneInput);
      if (!normalizedPhone) {
        setErrorCode('auth/invalid-phone-number');
        setError(
          lang === 'bn'
            ? 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন (যেমন: 017XXXXXXXX বা +88017XXXXXXXX)।'
            : 'Please enter a valid Bangladesh mobile number (e.g., 017XXXXXXXX or +88017XXXXXXXX).'
        );
        return;
      }

      submittingRef.current = true;
      setLoading(true);
      setLoadingAction('submit');
      try {
        const res = await recoverPhoneAccountServer(normalizedPhone);
        setInfo(
          lang === 'bn'
            ? `${res.normalizedPhone} নম্বরের সাথে যুক্ত রিকভারি ইমেইলে (${res.maskedEmail}) পাসওয়ার্ড রিসেট লিংক পাঠানো হয়েছে। অনুগ্রহ করে ইনবক্স বা Spam ফোল্ডার চেক করুন।`
            : `A password reset link for ${res.normalizedPhone} has been sent to its recovery email (${res.maskedEmail}). Check your inbox or Spam folder.`
        );
      } catch (err) {
        const mapped = mapAuthError(err, 'reset-phone', lang);
        setErrorCode(mapped.code);
        setError(mapped.message);
      } finally {
        submittingRef.current = false;
        setLoading(false);
        setLoadingAction('');
      }
      return;
    }

    // -----------------------------------------------------------------------
    // METHOD B: EMAIL + PASSWORD (Login / Register)
    // -----------------------------------------------------------------------
    if (channel === 'email') {
      const normalizedEmail = email.trim().toLowerCase();
      if (!EMAIL_PATTERN.test(normalizedEmail)) {
        setErrorCode('auth/invalid-email');
        setError(
          lang === 'bn'
            ? 'অনুগ্রহ করে একটি সঠিক ইমেইল ঠিকানা লিখুন।'
            : 'Please enter a valid email address.'
        );
        return;
      }
      if (password.length < 6) {
        setErrorCode('auth/weak-password');
        setError(
          lang === 'bn'
            ? 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'
            : 'Password must be at least 6 characters long.'
        );
        return;
      }

      if (mode === 'register') {
        const cleanName = fullName.trim();
        if (cleanName.length < 2) {
          setError(
            lang === 'bn'
              ? 'অনুগ্রহ করে আপনার পূর্ণ নাম লিখুন (কমপক্ষে ২ অক্ষর)।'
              : 'Please enter your full name (at least 2 characters).'
          );
          return;
        }
        if (password !== confirmPassword) {
          setError(
            lang === 'bn'
              ? 'দুটি পাসওয়ার্ড মেলেনি। অনুগ্রহ করে একই পাসওয়ার্ড দুই ঘরে লিখুন।'
              : 'Passwords do not match. Please enter the same password in both fields.'
          );
          return;
        }

        submittingRef.current = true;
        setLoading(true);
        setLoadingAction('submit');
        onPasswordSetupStateChange?.(true);

        try {
          if (referralCode.trim()) onReferralCapture(referralCode.trim());
          const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, password);
          setPassword('');
          setConfirmPassword('');

          await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});
          savePendingAuthMeta({
            uid: cred.user.uid,
            authMethod: 'email',
            displayName: cleanName,
            referralCode: referralCode.trim(),
          });

          if (!cred.user.emailVerified) {
            await sendEmailVerification(cred.user).catch(() => {});
            onPasswordSetupStateChange?.(false);
            setInfo(
              lang === 'bn'
                ? `অ্যাকাউন্ট তৈরি হয়েছে! ${normalizedEmail} ঠিকানায় ভেরিফিকেশন ইমেইল পাঠানো হয়েছে। লিংকে ক্লিক করে নিচের বাটনে চাপ দিন।`
                : `Account created! A verification link has been sent to ${normalizedEmail}. Click it and then tap refresh below.`
            );
          } else {
            await ensureUserProfile(
              cred.user.uid,
              normalizedEmail,
              cleanName,
              lang,
              referralCode.trim(),
              '',
              'email'
            ).catch(() => {});
            clearPendingAuthMeta();
            finishWithSuccess(cred.user, false, normalizedEmail, {
              authMethod: 'email',
              displayName: cleanName,
            });
          }
        } catch (err) {
          onPasswordSetupStateChange?.(false);
          const mapped = mapAuthError(err, 'email-register', lang);
          setErrorCode(mapped.code);
          setError(mapped.message);
        } finally {
          submittingRef.current = false;
          setLoading(false);
          setLoadingAction('');
        }
        return;
      }

      // Email Login
      submittingRef.current = true;
      setLoading(true);
      setLoadingAction('submit');
      onPasswordSetupStateChange?.(true);

      try {
        const cred = await signInWithEmailAndPassword(auth, normalizedEmail, password);
        setPassword('');
        if (cred.user.emailVerified) {
          await ensureUserProfile(
            cred.user.uid,
            normalizedEmail,
            cred.user.displayName || normalizedEmail.split('@')[0] || 'Customer',
            lang,
            referralCode.trim(),
            cred.user.photoURL || '',
            'email'
          ).catch(() => {});
          finishWithSuccess(cred.user, true, normalizedEmail, { authMethod: 'email' });
        } else {
          onPasswordSetupStateChange?.(false);
          setInfo(
            lang === 'bn'
              ? 'আপনার ইমেইল এখনো যাচাই হয়নি। ইনবক্স/Spam চেক করে ভেরিফাই করুন।'
              : 'Your email is not verified yet. Please verify from your inbox/Spam folder.'
          );
        }
      } catch (err) {
        onPasswordSetupStateChange?.(false);
        const mapped = mapAuthError(err, 'email-login', lang);
        setErrorCode(mapped.code);
        setError(mapped.message);
      } finally {
        submittingRef.current = false;
        setLoading(false);
        setLoadingAction('');
      }
      return;
    }

    // -----------------------------------------------------------------------
    // METHOD C: BANGLADESH PHONE NUMBER (+880) + PASSWORD
    // -----------------------------------------------------------------------
    const normalizedPhone = normalizeBangladeshPhoneClient(phoneInput);
    if (!normalizedPhone) {
      setErrorCode('auth/invalid-phone-number');
      setError(
        lang === 'bn'
          ? 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন (যেমন: 017XXXXXXXX বা +88017XXXXXXXX)।'
          : 'Please enter a valid Bangladesh mobile number (e.g., 017XXXXXXXX or +88017XXXXXXXX).'
      );
      return;
    }
    if (password.length < 6) {
      setErrorCode('auth/weak-password');
      setError(
        lang === 'bn'
          ? 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'
          : 'Password must be at least 6 characters long.'
      );
      return;
    }

    if (mode === 'register') {
      const cleanName = fullName.trim();
      const normalizedRecoveryEmail = email.trim().toLowerCase();

      if (cleanName.length < 2) {
        setError(
          lang === 'bn'
            ? 'অনুগ্রহ করে আপনার পূর্ণ নাম লিখুন (কমপক্ষে ২ অক্ষর)।'
            : 'Please enter your full name (at least 2 characters).'
        );
        return;
      }
      if (!EMAIL_PATTERN.test(normalizedRecoveryEmail)) {
        setErrorCode('auth/invalid-email');
        setError(
          lang === 'bn'
            ? 'ভেরিফিকেশন ও পাসওয়ার্ড রিকভারির জন্য একটি সঠিক ইমেইল ঠিকানা লিখুন।'
            : 'Please enter a valid email address for verification and password recovery.'
        );
        return;
      }
      if (password !== confirmPassword) {
        setError(
          lang === 'bn'
            ? 'দুটি পাসওয়ার্ড মেলেনি। অনুগ্রহ করে একই পাসওয়ার্ড দুই ঘরে লিখুন।'
            : 'Passwords do not match. Please enter the same password in both fields.'
        );
        return;
      }

      submittingRef.current = true;
      setLoading(true);
      setLoadingAction('submit');
      onPasswordSetupStateChange?.(true);

      try {
        // 1. Check backend if this BD phone number is already registered BEFORE creating any Firebase account
        const checkRes = await checkPhoneRegisteredServer(normalizedPhone);
        if (checkRes.exists) {
          onPasswordSetupStateChange?.(false);
          setErrorCode('auth/phone-already-in-use');
          setError(
            lang === 'bn'
              ? 'এই ফোন নম্বর দিয়ে আগে থেকেই অ্যাকাউন্ট রয়েছে। অনুগ্রহ করে ফোন নম্বর ও পাসওয়ার্ড দিয়ে লগইন করুন।'
              : 'An account already exists with this phone number. Please log in instead.'
          );
          return;
        }

        if (referralCode.trim()) onReferralCapture(referralCode.trim());

        // 2. Create real Firebase Auth user backed by verified recovery email
        const cred = await createUserWithEmailAndPassword(auth, normalizedRecoveryEmail, password);
        setPassword('');
        setConfirmPassword('');

        await updateProfile(cred.user, { displayName: cleanName }).catch(() => {});

        // Save pending phone registration metadata so verification completion indexes phoneHash & profile cleanly
        savePendingAuthMeta({
          uid: cred.user.uid,
          authMethod: 'phone',
          displayName: cleanName,
          phone: normalizedPhone,
          referralCode: referralCode.trim(),
        });
        setPendingRegisteredPhone(normalizedPhone);

        if (!cred.user.emailVerified) {
          await sendEmailVerification(cred.user).catch(() => {});
          onPasswordSetupStateChange?.(false);
          setInfo(
            lang === 'bn'
              ? `ফোন নম্বর ${normalizedPhone} যুক্ত হয়েছে! অ্যাকাউন্ট সক্রিয় করতে ${normalizedRecoveryEmail} ইমেইলে পাঠানো ভেরিফিকেশন লিংকে ক্লিক করুন।`
              : `Phone ${normalizedPhone} linked! Click the verification link sent to ${normalizedRecoveryEmail} to activate your account.`
          );
        } else {
          await ensureUserProfile(
            cred.user.uid,
            normalizedRecoveryEmail,
            cleanName,
            lang,
            referralCode.trim(),
            '',
            'phone',
            normalizedPhone
          ).catch(() => {});
          await registerPhoneIndexServer(normalizedPhone).catch(() => {});
          clearPendingAuthMeta();
          finishWithSuccess(cred.user, false, normalizedPhone, {
            authMethod: 'phone',
            phone: normalizedPhone,
            displayName: cleanName,
          });
        }
      } catch (err) {
        onPasswordSetupStateChange?.(false);
        const mapped = mapAuthError(err, 'phone-register', lang);
        setErrorCode(mapped.code);
        setError(mapped.message);
      } finally {
        submittingRef.current = false;
        setLoading(false);
        setLoadingAction('');
      }
      return;
    }

    // Phone + Password Login (Server-verified against Firebase Identity Toolkit)
    submittingRef.current = true;
    setLoading(true);
    setLoadingAction('submit');
    onPasswordSetupStateChange?.(true);

    try {
      const serverAuth = await authenticatePhoneServer(normalizedPhone, password);
      const cred = await signInWithEmailAndPassword(auth, serverAuth.authEmail, password);
      setPassword('');

      if (cred.user.emailVerified) {
        await ensureUserProfile(
          cred.user.uid,
          serverAuth.authEmail,
          cred.user.displayName || normalizedPhone,
          lang,
          referralCode.trim(),
          cred.user.photoURL || '',
          'phone',
          serverAuth.normalizedPhone
        ).catch(() => {});
        finishWithSuccess(cred.user, true, serverAuth.normalizedPhone, {
          authMethod: 'phone',
          phone: serverAuth.normalizedPhone,
        });
      } else {
        onPasswordSetupStateChange?.(false);
        setPendingRegisteredPhone(serverAuth.normalizedPhone);
        setInfo(
          lang === 'bn'
            ? 'আপনার রিকভারি ইমেইল এখনো যাচাই হয়নি। ইনবক্স/Spam থেকে ভেরিফিকেশন সম্পন্ন করুন।'
            : 'Your verification email is still pending. Please verify from your inbox/Spam folder.'
        );
      }
    } catch (err) {
      onPasswordSetupStateChange?.(false);
      const mapped = mapAuthError(err, 'phone-login', lang);
      setErrorCode(mapped.code);
      setError(mapped.message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
      setLoadingAction('');
    }
  };

  // =========================================================================
  // VERIFICATION HANDLERS
  // =========================================================================
  const handleRefreshVerificationClick = async () => {
    if (!onRefreshVerification || submittingRef.current) return;
    submittingRef.current = true;
    clearFeedback();
    setLoading(true);
    setLoadingAction('verify');
    try {
      const verified = await onRefreshVerification();
      if (!verified) {
        setInfo(
          lang === 'bn'
            ? 'ইমেইল এখনো যাচাই হয়নি। ইনবক্স বা Spam ফোল্ডারের লিংকে ক্লিক করে আবার চেষ্টা করুন।'
            : 'Email is not verified yet. Click the link in your inbox or Spam folder and try again.'
        );
      }
    } catch (err) {
      const mapped = mapAuthError(err, 'verify', lang);
      setErrorCode(mapped.code);
      setError(mapped.message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
      setLoadingAction('');
    }
  };

  const handleResendVerification = async () => {
    if (!auth.currentUser || submittingRef.current) return;
    submittingRef.current = true;
    clearFeedback();
    setLoading(true);
    setLoadingAction('verify');
    try {
      await sendEmailVerification(auth.currentUser);
      setInfo(
        lang === 'bn'
          ? 'নতুন ভেরিফিকেশন ইমেইল পাঠানো হয়েছে। অনুগ্রহ করে ইনবক্স ও Spam ফোল্ডার চেক করুন।'
          : 'A fresh verification email has been sent. Please check your inbox and Spam folder.'
      );
    } catch (err) {
      const mapped = mapAuthError(err, 'verify', lang);
      setErrorCode(mapped.code);
      setError(mapped.message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
      setLoadingAction('');
    }
  };

  const handleSwitchAccountSignOut = async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    try {
      clearPendingAuthMeta();
      await signOut(auth);
      setPendingRegisteredPhone('');
      switchMode('login');
    } catch (err) {
      const mapped = mapAuthError(err, 'verify', lang);
      setErrorCode(mapped.code);
      setError(mapped.message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  const verificationEmailLabel = pendingEmail || auth.currentUser?.email || '';

  return (
    <div
      className="fixed inset-0 z-50 bg-[#172033]/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="DIGITAL HUB Authentication"
    >
      <div className="w-full max-w-[440px] bg-white rounded-3xl border border-[#E6ECFA] shadow-2xl overflow-hidden my-auto">
        {/* Modal Header with DIGITAL HUB Logo */}
        <div className="px-5 sm:px-6 py-4 bg-gradient-to-r from-[#FFF7EE] via-[#FFFBF5] to-[#F3F6FF] border-b border-[#E6ECFA] flex items-center justify-between">
          <DigitalHubLogo compact />
          <button
            type="button"
            onClick={() => !loading && onClose()}
            disabled={loading}
            className="p-2 rounded-xl bg-white border border-[#E6ECFA] text-[#777777] hover:text-[#172033] hover:border-[#FF8500]/40 transition-colors disabled:opacity-50"
            aria-label="Close authentication modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-4 max-h-[84vh] overflow-y-auto">
          {/* =============================================================== */}
          {/* VIEW 1: SUCCESS SCREEN                                          */}
          {/* =============================================================== */}
          {step === 'success' ? (
            <div className="py-6 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 text-[#16A34A] flex items-center justify-center mx-auto shadow-xs">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-xl font-extrabold text-[#172033]">
                  {successIsNew
                    ? lang === 'bn'
                      ? 'অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে!'
                      : 'Account Created Successfully!'
                    : lang === 'bn'
                      ? 'লগইন সফল হয়েছে!'
                      : 'Signed In Successfully!'}
                </h2>
                <p className="text-xs sm:text-sm text-[#777777]">
                  {lang === 'bn'
                    ? 'আপনাকে আপনার ড্যাশবোর্ডে নিয়ে যাওয়া হচ্ছে...'
                    : 'Taking you to your dashboard...'}
                </p>
              </div>
              {successIdentity && (
                <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-bold text-[#172033]">
                  <UserCheck className="w-4 h-4 text-[#16A34A]" />
                  <span>{successIdentity}</span>
                </div>
              )}
            </div>
          ) : needsVerification ? (
            /* =============================================================== */
            /* VIEW 2: EMAIL VERIFICATION GATE                                 */
            /* =============================================================== */
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-[#FFF7EE] border border-[#FF8500]/30 space-y-2.5">
                <div className="flex items-center gap-2 text-[#FF8500] font-extrabold text-sm">
                  <ShieldCheck className="w-5 h-5 shrink-0" />
                  <span>
                    {lang === 'bn' ? 'আপনার ইমেইল ভেরিফাই করুন' : 'Verify Your Email Address'}
                  </span>
                </div>
                <p className="text-xs text-[#172033] leading-relaxed">
                  {lang === 'bn'
                    ? 'নিরাপত্তার জন্য আমরা আপনার ইমেইলে একটি ভেরিফিকেশন লিংক পাঠিয়েছি। লিংকে ক্লিক করার পর নিচের "ভেরিফিকেশন চেক করুন" বাটনে চাপ দিন।'
                    : 'For account security, we sent a verification link to your email. Click the link, then tap the button below.'}
                </p>
                {verificationEmailLabel && (
                  <div className="px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#172033] break-all flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-[#FF8500] shrink-0" />
                    <span>{verificationEmailLabel}</span>
                  </div>
                )}
                {pendingRegisteredPhone && (
                  <div className="px-3 py-2 rounded-xl bg-white border border-[#E6ECFA] text-xs font-bold text-[#172033] font-mono-num flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                    <span>{pendingRegisteredPhone}</span>
                  </div>
                )}
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-semibold flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {info && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[#16A34A] text-xs font-semibold">
                  {info}
                </div>
              )}

              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={loading}
                  onClick={handleRefreshVerificationClick}
                  className="w-full py-3 rounded-xl dh-orange-gradient text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm hover:opacity-95 disabled:opacity-60"
                >
                  {loading && loadingAction === 'verify' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  <span>
                    {lang === 'bn' ? 'ভেরিফিকেশন চেক করুন ও ড্যাশবোর্ডে যান' : 'I Verified — Go to Dashboard'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={loading}
                  onClick={handleResendVerification}
                  className="w-full py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-[#172033] font-bold text-xs flex items-center justify-center gap-2 hover:bg-[#E6ECFA]/70 disabled:opacity-60"
                >
                  <Mail className="w-3.5 h-3.5 text-[#FF8500]" />
                  <span>
                    {lang === 'bn' ? 'ভেরিফিকেশন ইমেইল আবার পাঠান' : 'Resend Verification Email'}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={loading}
                  onClick={handleSwitchAccountSignOut}
                  className="w-full py-2.5 rounded-xl bg-white border border-[#E6ECFA] text-[#777777] hover:text-[#172033] font-semibold text-xs flex items-center justify-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>{lang === 'bn' ? 'অন্য অ্যাকাউন্ট দিয়ে লগইন করুন' : 'Use Another Account'}</span>
                </button>
              </div>
            </div>
          ) : mode === 'reset' ? (
            /* =============================================================== */
            /* VIEW 3: FORGOT PASSWORD / ACCOUNT RECOVERY (Email & Phone)      */
            /* =============================================================== */
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => switchMode('login', { nextChannel: channel, keepEmail: true, keepPhone: true })}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#777777] hover:text-[#172033]"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'লগইনে ফিরে যান' : 'Back to Login'}</span>
              </button>

              <div>
                <h2 className="text-lg font-extrabold text-[#172033]">
                  {lang === 'bn' ? 'পাসওয়ার্ড রিসেট / অ্যাকাউন্ট রিকভারি' : 'Reset Password / Account Recovery'}
                </h2>
                <p className="text-xs text-[#777777] mt-1">
                  {channel === 'phone'
                    ? lang === 'bn'
                      ? 'আপনার নিবন্ধিত বাংলাদেশি ফোন নম্বর দিন। অ্যাকাউন্টের রিকভারি ইমেইলে পাসওয়ার্ড রিসেট লিংক পাঠানো হবে।'
                      : 'Enter your registered Bangladesh phone number. A password reset link will be sent to your recovery email.'
                    : lang === 'bn'
                      ? 'আপনার নিবন্ধিত ইমেইল ঠিকানা দিন। আমরা পাসওয়ার্ড রিসেট লিংক পাঠিয়ে দেব।'
                      : 'Enter your registered email address and we will send you a password reset link.'}
                </p>
              </div>

              {/* Channel Toggle: Email vs Phone */}
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA]">
                <button
                  type="button"
                  onClick={() => switchChannel('email')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    channel === 'email'
                      ? 'bg-white text-[#172033] shadow-xs border border-[#E6ECFA]'
                      : 'text-[#777777] hover:text-[#172033]'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5 text-[#FF8500]" />
                  <span>{lang === 'bn' ? 'ইমেইল দিয়ে' : 'By Email'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchChannel('phone')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    channel === 'phone'
                      ? 'bg-white text-[#172033] shadow-xs border border-[#E6ECFA]'
                      : 'text-[#777777] hover:text-[#172033]'
                  }`}
                >
                  <Phone className="w-3.5 h-3.5 text-[#FF8500]" />
                  <span>{lang === 'bn' ? 'ফোন নম্বর দিয়ে' : 'By Phone'}</span>
                </button>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-semibold flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {info && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[#16A34A] text-xs font-semibold leading-relaxed">
                  {info}
                </div>
              )}

              <form onSubmit={handlePrimaryFormSubmit} className="space-y-3.5">
                {channel === 'email' ? (
                  <div>
                    <label htmlFor="dh-reset-email" className="block text-xs font-bold text-[#172033] mb-1">
                      {lang === 'bn' ? 'ইমেইল ঠিকানা' : 'Email Address'}
                    </label>
                    <input
                      id="dh-reset-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@gmail.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm text-[#172033] focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>
                ) : (
                  <div>
                    <label htmlFor="dh-reset-phone" className="block text-xs font-bold text-[#172033] mb-1">
                      {lang === 'bn' ? 'বাংলাদেশি ফোন নম্বর' : 'Bangladesh Phone Number'}
                    </label>
                    <div className="flex items-stretch rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] focus-within:border-[#FF8500] overflow-hidden">
                      <span className="px-3 flex items-center gap-1 bg-[#EAEFFA] border-r border-[#DCE4F7] text-xs font-extrabold text-[#172033] font-mono-num shrink-0">
                        +880
                      </span>
                      <input
                        id="dh-reset-phone"
                        type="tel"
                        required
                        autoComplete="tel"
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        placeholder="017XXXXXXXX"
                        className="w-full px-3 py-2.5 bg-transparent text-sm text-[#172033] font-mono-num focus:outline-none"
                      />
                    </div>
                    {normalizedPhonePreview && (
                      <p className="text-[11px] font-mono-num font-semibold text-[#16A34A] mt-1">
                        ✓ {normalizedPhonePreview}
                      </p>
                    )}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl dh-orange-gradient text-white font-bold text-sm flex items-center justify-center gap-2 shadow-sm hover:opacity-95 disabled:opacity-60"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  <span>
                    {loading
                      ? lang === 'bn'
                        ? 'পাঠানো হচ্ছে...'
                        : 'Sending...'
                      : lang === 'bn'
                        ? 'রিসেট লিংক পাঠান'
                        : 'Send Reset Link'}
                  </span>
                </button>
              </form>
            </div>
          ) : (
            /* =============================================================== */
            /* VIEW 4: MAIN LOGIN & CREATE ACCOUNT VIEW                        */
            /* =============================================================== */
            <div className="space-y-4">
              {/* Top Primary Tabs: Login | Create Account */}
              <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA]">
                <button
                  type="button"
                  onClick={() => switchMode('login', { nextChannel: channel, keepEmail: true, keepPhone: true })}
                  className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                    mode === 'login'
                      ? 'bg-[#172033] text-white shadow-sm'
                      : 'text-[#777777] hover:text-[#172033]'
                  }`}
                >
                  <LogIn className="w-4 h-4" />
                  <span>{lang === 'bn' ? 'লগইন' : 'Login'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchMode('register', { nextChannel: channel, keepEmail: true, keepPhone: true })}
                  className={`py-2.5 px-3 rounded-xl text-xs sm:text-sm font-extrabold flex items-center justify-center gap-1.5 transition-all ${
                    mode === 'register'
                      ? 'dh-orange-gradient text-white shadow-sm'
                      : 'text-[#777777] hover:text-[#172033]'
                  }`}
                >
                  <UserPlus className="w-4 h-4" />
                  <span>{lang === 'bn' ? 'নতুন অ্যাকাউন্ট' : 'Create Account'}</span>
                </button>
              </div>

              {/* Heading */}
              <div>
                <h2 className="text-lg sm:text-xl font-extrabold text-[#172033]">
                  {mode === 'login'
                    ? lang === 'bn'
                      ? 'আপনার অ্যাকাউন্টে লগইন করুন'
                      : 'Sign In to Your Account'
                    : lang === 'bn'
                      ? 'নতুন Digital Hub অ্যাকাউন্ট খুলুন'
                      : 'Create Your Digital Hub Account'}
                </h2>
                <p className="text-xs text-[#777777] mt-0.5">
                  {mode === 'login'
                    ? lang === 'bn'
                      ? 'Google, ইমেইল অথবা ফোন নম্বর দিয়ে দ্রুত ও নিরাপদ লগইন করুন।'
                      : 'Sign in securely with Google, Email, or Bangladesh Phone Number.'
                    : lang === 'bn'
                      ? 'মাত্র ১ ক্লিকে Google দিয়ে অথবা ইমেইল / ফোন নম্বর দিয়ে অ্যাকাউন্ট তৈরি করুন।'
                      : 'Register in 1 click with Google, or use your Email or Bangladesh Phone Number.'}
                </p>
              </div>

              {/* METHOD A: Google Continue Button */}
              <button
                type="button"
                disabled={loading}
                onClick={() => handleGoogleSignIn(false)}
                className="w-full py-3 px-4 rounded-xl bg-[#172033] hover:bg-[#1E2B45] text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-sm transition-all disabled:opacity-60"
              >
                {loading && loadingAction === 'google' ? (
                  <Loader2 className="w-5 h-5 animate-spin text-[#FF8500]" />
                ) : (
                  <span className="w-7 h-7 rounded-lg bg-white flex items-center justify-center shrink-0">
                    <GoogleBrandMark />
                  </span>
                )}
                <span>
                  {loading && loadingAction === 'google'
                    ? lang === 'bn'
                      ? 'Google যাচাই হচ্ছে...'
                      : 'Connecting to Google...'
                    : mode === 'register'
                      ? lang === 'bn'
                        ? 'Google দিয়ে দ্রুত অ্যাকাউন্ট খুলুন'
                        : 'Continue with Google'
                      : lang === 'bn'
                        ? 'Google অ্যাকাউন্ট দিয়ে চালিয়ে যান'
                        : 'Continue with Google'}
                </span>
              </button>

              {/* Divider */}
              <div className="relative flex items-center py-0.5">
                <div className="grow border-t border-[#E6ECFA]" />
                <span className="mx-3 text-[11px] font-bold text-[#777777] uppercase tracking-wide">
                  {lang === 'bn' ? 'অথবা ইমেইল / ফোন দিয়ে' : 'or use email / phone'}
                </span>
                <div className="grow border-t border-[#E6ECFA]" />
              </div>

              {/* Channel Selector: Email vs Phone Number */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => switchChannel('email')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    channel === 'email'
                      ? 'bg-[#FFF7EE] border-[#FF8500] text-[#172033] shadow-2xs'
                      : 'bg-[#F8FAFF] border-[#E6ECFA] text-[#777777] hover:text-[#172033]'
                  }`}
                >
                  <Mail className={`w-3.5 h-3.5 ${channel === 'email' ? 'text-[#FF8500]' : 'text-[#94A3B8]'}`} />
                  <span>{lang === 'bn' ? 'ইমেইল ও পাসওয়ার্ড' : 'Email & Password'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => switchChannel('phone')}
                  className={`py-2 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-all ${
                    channel === 'phone'
                      ? 'bg-[#FFF7EE] border-[#FF8500] text-[#172033] shadow-2xs'
                      : 'bg-[#F8FAFF] border-[#E6ECFA] text-[#777777] hover:text-[#172033]'
                  }`}
                >
                  <Phone className={`w-3.5 h-3.5 ${channel === 'phone' ? 'text-[#FF8500]' : 'text-[#94A3B8]'}`} />
                  <span>{lang === 'bn' ? 'ফোন নম্বর (+880)' : 'Phone (+880)'}</span>
                </button>
              </div>

              {/* Error Alert with Smart Contextual Actions */}
              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-semibold leading-relaxed space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>

                  {/* Smart 1-click redirect when Email already registered */}
                  {errorCode === 'auth/email-already-in-use' && mode === 'register' && (
                    <div className="flex flex-wrap gap-2 pt-0.5 pl-6">
                      <button
                        type="button"
                        onClick={() => switchMode('login', { nextChannel: 'email', keepEmail: true })}
                        className="px-3 py-1.5 rounded-lg bg-[#172033] text-white text-[11px] font-bold hover:opacity-90 inline-flex items-center gap-1"
                      >
                        <span>{lang === 'bn' ? 'এই ইমেইল দিয়ে লগইন করুন' : 'Log in with this email'}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => switchMode('reset', { nextChannel: 'email', keepEmail: true })}
                        className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-[#172033] text-[11px] font-bold hover:bg-red-50"
                      >
                        {lang === 'bn' ? 'পাসওয়ার্ড রিসেট' : 'Reset Password'}
                      </button>
                    </div>
                  )}

                  {/* Smart 1-click redirect when Phone already registered */}
                  {errorCode === 'auth/phone-already-in-use' && mode === 'register' && (
                    <div className="flex flex-wrap gap-2 pt-0.5 pl-6">
                      <button
                        type="button"
                        onClick={() => switchMode('login', { nextChannel: 'phone', keepPhone: true })}
                        className="px-3 py-1.5 rounded-lg bg-[#172033] text-white text-[11px] font-bold hover:opacity-90 inline-flex items-center gap-1"
                      >
                        <span>{lang === 'bn' ? 'এই নম্বর দিয়ে লগইন করুন' : 'Log in with this phone'}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => switchMode('reset', { nextChannel: 'phone', keepPhone: true })}
                        className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-[#172033] text-[11px] font-bold hover:bg-red-50"
                      >
                        {lang === 'bn' ? 'পাসওয়ার্ড রিকভারি' : 'Recover Password'}
                      </button>
                    </div>
                  )}

                  {/* Smart 1-click switch to Register when account not found on Login */}
                  {errorCode === 'auth/user-not-found' && mode === 'login' && (
                    <div className="pl-6">
                      <button
                        type="button"
                        onClick={() =>
                          switchMode('register', {
                            nextChannel: channel,
                            keepEmail: channel === 'email',
                            keepPhone: channel === 'phone',
                          })
                        }
                        className="px-3 py-1.5 rounded-lg bg-[#FF8500] text-white text-[11px] font-bold hover:opacity-90 inline-flex items-center gap-1"
                      >
                        <span>{lang === 'bn' ? 'নতুন অ্যাকাউন্ট খুলুন' : 'Create New Account'}</span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  )}

                  {/* Redirect fallback when mobile browser blocks Google Popup */}
                  {errorCode === 'auth/popup-blocked' && (
                    <div className="pl-6">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => handleGoogleSignIn(true)}
                        className="px-3 py-1.5 rounded-lg bg-[#172033] text-white text-[11px] font-bold hover:opacity-90 inline-flex items-center gap-1.5"
                      >
                        <span>
                          {lang === 'bn'
                            ? 'পপআপ ছাড়া সরাসরি Google-এ চালিয়ে যান'
                            : 'Continue to Google without popup'}
                        </span>
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Success / Info Banner */}
              {info && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-[#16A34A] text-xs font-semibold leading-relaxed">
                  {info}
                </div>
              )}

              {/* Credential Form (Email or Phone) */}
              <form onSubmit={handlePrimaryFormSubmit} className="space-y-3" autoComplete="on">
                {/* Full Name (Registration Only) */}
                {mode === 'register' && (
                  <div>
                    <label htmlFor="dh-auth-name" className="block text-xs font-bold text-[#172033] mb-1">
                      {lang === 'bn' ? 'আপনার পূর্ণ নাম' : 'Full Name'}
                    </label>
                    <input
                      id="dh-auth-name"
                      type="text"
                      required
                      minLength={2}
                      maxLength={120}
                      autoComplete="name"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder={lang === 'bn' ? 'যেমন: আরিফুল ইসলাম' : 'e.g. Ariful Islam'}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm text-[#172033] focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>
                )}

                {/* Phone Number Input (When Phone Channel Selected) */}
                {channel === 'phone' && (
                  <div>
                    <label htmlFor="dh-auth-phone" className="block text-xs font-bold text-[#172033] mb-1">
                      {lang === 'bn' ? 'বাংলাদেশি ফোন নম্বর' : 'Bangladesh Phone Number'}
                    </label>
                    <div className="flex items-stretch rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] focus-within:border-[#FF8500] overflow-hidden">
                      <span className="px-3 flex items-center gap-1 bg-[#EAEFFA] border-r border-[#DCE4F7] text-xs font-extrabold text-[#172033] font-mono-num shrink-0">
                        +880
                      </span>
                      <input
                        id="dh-auth-phone"
                        type="tel"
                        required
                        autoComplete="tel"
                        value={phoneInput}
                        onChange={(e) => setPhoneInput(e.target.value)}
                        placeholder="017XXXXXXXX"
                        className="w-full px-3 py-2.5 bg-transparent text-sm text-[#172033] font-mono-num focus:outline-none"
                      />
                    </div>
                    {phoneInput.trim().length > 0 && (
                      <p
                        className={`text-[11px] mt-1 font-mono-num font-semibold ${
                          normalizedPhonePreview ? 'text-[#16A34A]' : 'text-[#D97706]'
                        }`}
                      >
                        {normalizedPhonePreview
                          ? `✓ ${lang === 'bn' ? 'নরমালাইজড নম্বর:' : 'Normalized:'} ${normalizedPhonePreview}`
                          : lang === 'bn'
                            ? '১১ ডিজিটের বাংলাদেশি নম্বর লিখুন (যেমন: 01712345678)'
                            : 'Enter a valid 11-digit BD mobile number (e.g. 01712345678)'}
                      </p>
                    )}
                  </div>
                )}

                {/* Email Input (For Email Login/Signup, OR as Verified Recovery Email on Phone Signup) */}
                {(channel === 'email' || (channel === 'phone' && mode === 'register')) && (
                  <div>
                    <label htmlFor="dh-auth-email" className="block text-xs font-bold text-[#172033] mb-1">
                      {channel === 'phone'
                        ? lang === 'bn'
                          ? 'ভেরিফিকেশন ও রিকভারি ইমেইল'
                          : 'Verification & Recovery Email'
                        : lang === 'bn'
                          ? 'ইমেইল ঠিকানা'
                          : 'Email Address'}
                    </label>
                    <input
                      id="dh-auth-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@gmail.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm text-[#172033] focus:outline-none focus:border-[#FF8500]"
                    />
                    {channel === 'phone' && mode === 'register' && (
                      <p className="text-[11px] text-[#777777] mt-1">
                        {lang === 'bn'
                          ? 'অ্যাকাউন্ট ভেরিফিকেশন এবং পাসওয়ার্ড ভুলে গেলে রিকভারির জন্য ব্যবহৃত হবে।'
                          : 'Used for account verification and password recovery if you forget your password.'}
                      </p>
                    )}
                  </div>
                )}

                {/* Password Input with Show/Hide Icon */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label htmlFor="dh-auth-password" className="text-xs font-bold text-[#172033]">
                      {lang === 'bn' ? 'পাসওয়ার্ড' : 'Password'}
                    </label>
                    {mode === 'login' && (
                      <button
                        type="button"
                        onClick={() =>
                          switchMode('reset', {
                            nextChannel: channel,
                            keepEmail: channel === 'email',
                            keepPhone: channel === 'phone',
                          })
                        }
                        className="text-[11px] font-bold text-[#FF8500] hover:underline"
                      >
                        {lang === 'bn' ? 'পাসওয়ার্ড ভুলে গেছেন?' : 'Forgot Password?'}
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <input
                      id="dh-auth-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        mode === 'register'
                          ? lang === 'bn'
                            ? 'কমপক্ষে ৬ অক্ষরের পাসওয়ার্ড লিখুন'
                            : 'Create password (min 6 chars)'
                          : '••••••••'
                      }
                      className="w-full pl-3.5 pr-11 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm text-[#172033] focus:outline-none focus:border-[#FF8500]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[#777777] hover:text-[#172033]"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Real-time Password Strength Indicator on Registration */}
                  {mode === 'register' && password.length > 0 && (
                    <div className="mt-1.5 space-y-1">
                      <div className="grid grid-cols-4 gap-1">
                        {[1, 2, 3, 4].map((seg) => (
                          <div
                            key={seg}
                            className={`h-1.5 rounded-full transition-colors ${
                              strength.score >= seg ? strength.barColor : 'bg-[#E6ECFA]'
                            }`}
                          />
                        ))}
                      </div>
                      <div className="flex items-center justify-between text-[11px]">
                        <span className={`font-bold ${strength.textColor}`}>
                          {lang === 'bn' ? strength.labelBn : strength.labelEn}
                        </span>
                        <span className="text-[#777777]">
                          {lang === 'bn' ? `${password.length} অক্ষর` : `${password.length} chars`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm Password (Registration Only) */}
                {mode === 'register' && (
                  <div>
                    <label
                      htmlFor="dh-auth-confirm-password"
                      className="block text-xs font-bold text-[#172033] mb-1"
                    >
                      {lang === 'bn' ? 'পাসওয়ার্ড নিশ্চিত করুন' : 'Confirm Password'}
                    </label>
                    <div className="relative">
                      <input
                        id="dh-auth-confirm-password"
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        minLength={6}
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={
                          lang === 'bn' ? 'একই পাসওয়ার্ড আবার লিখুন' : 'Re-enter your password'
                        }
                        className={`w-full pl-3.5 pr-11 py-2.5 rounded-xl bg-[#F3F6FF] border text-sm text-[#172033] focus:outline-none ${
                          passwordsMismatch
                            ? 'border-[#DC2626] focus:border-[#DC2626]'
                            : passwordsMatch
                              ? 'border-[#16A34A] focus:border-[#16A34A]'
                              : 'border-[#E6ECFA] focus:border-[#FF8500]'
                        }`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[#777777] hover:text-[#172033]"
                        aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                    {passwordsMismatch && (
                      <p className="text-[11px] font-semibold text-[#DC2626] mt-1">
                        {lang === 'bn' ? 'পাসওয়ার্ড মেলেনি' : 'Passwords do not match'}
                      </p>
                    )}
                    {passwordsMatch && (
                      <p className="text-[11px] font-semibold text-[#16A34A] mt-1">
                        ✓ {lang === 'bn' ? 'পাসওয়ার্ড মিলেছে' : 'Passwords match'}
                      </p>
                    )}
                  </div>
                )}

                {/* Optional Referral Code (Registration Only) */}
                {mode === 'register' && (
                  <div>
                    <label htmlFor="dh-auth-referral" className="block text-xs font-bold text-[#172033] mb-1">
                      {lang === 'bn' ? 'রেফারেল কোড (ঐচ্ছিক)' : 'Referral Code (Optional)'}
                    </label>
                    <input
                      id="dh-auth-referral"
                      type="text"
                      maxLength={24}
                      value={referralCode}
                      onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                      placeholder="DHXXXXXX"
                      className="w-full px-3.5 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-mono-num uppercase text-[#172033] focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>
                )}

                {/* Primary Submit CTA */}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 rounded-xl dh-orange-gradient text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-sm hover:opacity-95 transition-opacity disabled:opacity-60 mt-1"
                >
                  {loading && loadingAction === 'submit' ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : mode === 'login' ? (
                    <LogIn className="w-4 h-4" />
                  ) : (
                    <UserPlus className="w-4 h-4" />
                  )}
                  <span>
                    {loading && loadingAction === 'submit'
                      ? lang === 'bn'
                        ? 'অপেক্ষা করুন...'
                        : 'Please wait...'
                      : mode === 'login'
                        ? channel === 'phone'
                          ? lang === 'bn'
                            ? 'ফোন নম্বর দিয়ে লগইন করুন'
                            : 'Sign In with Phone'
                          : lang === 'bn'
                            ? 'লগইন করুন'
                            : 'Sign In'
                        : channel === 'phone'
                          ? lang === 'bn'
                            ? 'ফোন নম্বর দিয়ে অ্যাকাউন্ট তৈরি করুন'
                            : 'Create Account with Phone'
                          : lang === 'bn'
                            ? 'অ্যাকাউন্ট তৈরি করুন'
                            : 'Create Account'}
                  </span>
                </button>
              </form>

              {/* Footer Switcher */}
              <div className="pt-2 border-t border-[#E6ECFA] text-center text-xs text-[#777777]">
                {mode === 'login' ? (
                  <>
                    <span>{lang === 'bn' ? 'অ্যাকাউন্ট নেই?' : "Don't have an account?"} </span>
                    <button
                      type="button"
                      onClick={() => switchMode('register', { nextChannel: channel })}
                      className="font-extrabold text-[#FF8500] hover:underline"
                    >
                      {lang === 'bn' ? 'নতুন অ্যাকাউন্ট খুলুন' : 'Create Account'}
                    </button>
                  </>
                ) : (
                  <>
                    <span>{lang === 'bn' ? 'আগে থেকেই অ্যাকাউন্ট আছে?' : 'Already have an account?'} </span>
                    <button
                      type="button"
                      onClick={() => switchMode('login', { nextChannel: channel })}
                      className="font-extrabold text-[#FF8500] hover:underline"
                    >
                      {lang === 'bn' ? 'লগইন করুন' : 'Log In'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
