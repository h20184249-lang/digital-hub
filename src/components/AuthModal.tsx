import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  EmailAuthProvider,
  linkWithCredential,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  User,
} from 'firebase/auth';
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import { ensureUserProfile, hasExistingUserProfile } from '../lib/firestoreService';
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
  onPasswordSetupStateChange?: (active: boolean) => void;
  onRegistrationComplete?: (user: User, isExistingAccount?: boolean) => Promise<void>;
  needsVerification?: boolean;
  pendingEmail?: string;
  onRefreshVerification?: () => Promise<boolean>;
}

interface VerifiedGoogleCandidate {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  hadExistingProfile: boolean;
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

function mapFirebaseAuthError(
  err: unknown,
  context: 'login' | 'register' | 'link-password' | 'reset' | 'google' | 'verify',
  lang: Language
): { code: string; message: string } {
  const code = getFirebaseAuthErrorCode(err);

  switch (code) {
    case 'auth/email-already-in-use':
    case 'auth/credential-already-in-use':
      return {
        code,
        message:
          lang === 'bn'
            ? 'এই Gmail ঠিকানাটি ইতিমধ্যেই Digital Hub-এ নিবন্ধিত আছে। অনুগ্রহ করে লগইন করুন অথবা পাসওয়ার্ড রিসেট করুন।'
            : 'This Gmail address is already registered on Digital Hub. Please sign in or reset your password.',
      };
    case 'auth/provider-already-linked':
      return {
        code,
        message:
          lang === 'bn'
            ? 'এই অ্যাকাউন্টে ইতিমধ্যেই পাসওয়ার্ড সেট করা আছে। অনুগ্রহ করে লগইন করুন।'
            : 'A Digital Hub password is already linked to this account. Please sign in.',
      };
    case 'auth/operation-not-allowed':
      return {
        code,
        message:
          context === 'link-password' || context === 'login'
            ? lang === 'bn'
              ? 'Firebase Console-এ Email/Password প্রোভাইডার এখনো চালু করা হয়নি। সাইট অ্যাডমিন Firebase Authentication → Sign-in method থেকে Email/Password চালু করলেই পাসওয়ার্ড লগইন কাজ করবে।'
              : 'Email/Password sign-in provider is currently disabled in Firebase Console. Enable Email/Password under Firebase Authentication → Sign-in method to complete password setup.'
            : lang === 'bn'
              ? 'এই সাইন-ইন পদ্ধতিটি Firebase Console-এ বর্তমানে নিষ্ক্রিয় আছে।'
              : 'This sign-in provider is currently disabled in Firebase Authentication Console.',
      };
    case 'auth/unauthorized-domain':
      return {
        code,
        message:
          lang === 'bn'
            ? `এই ওয়েবসাইট ডোমেইনটি (${typeof window !== 'undefined' ? window.location.hostname : ''}) Firebase Authorized Domains-এ যুক্ত করা হয়নি। Firebase Console → Authentication → Settings → Authorized domains-এ ডোমেইনটি যোগ করুন।`
            : `This domain (${typeof window !== 'undefined' ? window.location.hostname : ''}) is not listed in Firebase Authentication Authorized Domains. Add it in Firebase Console → Authentication → Settings → Authorized domains.`,
      };
    case 'auth/invalid-email':
      return {
        code,
        message:
          lang === 'bn'
            ? 'অনুগ্রহ করে একটি সঠিক Gmail / ইমেইল ঠিকানা লিখুন।'
            : 'Please enter a valid Gmail / email address.',
      };
    case 'auth/weak-password':
      return {
        code,
        message:
          lang === 'bn'
            ? 'পাসওয়ার্ডটি খুবই দুর্বল। কমপক্ষে ৬ অক্ষর (সুপারিশকৃত ৮+ অক্ষর, সংখ্যা ও চিহ্নসহ) ব্যবহার করুন।'
            : 'Password is too weak. Use at least 6 characters (8+ with numbers and symbols recommended).',
      };
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return {
        code,
        message:
          context === 'reset'
            ? lang === 'bn'
              ? 'এই ইমেইল দিয়ে কোনো অ্যাকাউন্ট পাওয়া যায়নি।'
              : 'No account was found with this email address.'
            : lang === 'bn'
              ? 'ইমেইল অথবা পাসওয়ার্ড সঠিক নয়। যদি আগে শুধু Google দিয়ে লগইন করে থাকেন, তবে Google লগইন ব্যবহার করুন অথবা "Google দিয়ে সাইনআপ" করে পাসওয়ার্ড সেট করুন।'
              : 'Incorrect email or password. If you previously used Google only, sign in with Google or click "Sign Up with Google" to set a Digital Hub password.',
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
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return {
        code,
        message:
          lang === 'bn'
            ? 'Google অ্যাকাউন্ট নির্বাচন পপআপটি বন্ধ করা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Google account selection popup was closed before completing. Please try again.',
      };
    case 'auth/popup-blocked':
      return {
        code,
        message:
          lang === 'bn'
            ? 'আপনার ব্রাউজার Google পপআপ ব্লক করেছে। অনুগ্রহ করে ব্রাউজারে পপআপ অনুমতি দিয়ে আবার চেষ্টা করুন।'
            : 'Your browser blocked the Google Sign-In popup. Please allow popups and try again.',
      };
    case 'auth/requires-recent-login':
      return {
        code,
        message:
          lang === 'bn'
            ? 'নিরাপত্তার জন্য Google অ্যাকাউন্টটি পুনরায় যাচাই করা প্রয়োজন। অনুগ্রহ করে আবার চেষ্টা করুন।'
            : 'Please re-verify your Google account for security and try again.',
      };
    case 'auth/account-exists-with-different-credential':
      return {
        code,
        message:
          lang === 'bn'
            ? 'এই ইমেইলটি অন্য সাইন-ইন পদ্ধতিতে যুক্ত আছে। অনুগ্রহ করে সেই পদ্ধতি ব্যবহার করুন।'
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

interface PasswordStrengthResult {
  score: 0 | 1 | 2 | 3 | 4;
  labelBn: string;
  labelEn: string;
  barColor: string;
  textColor: string;
  hasMinLength: boolean;
  hasRecommendedLength: boolean;
  hasLetterAndNumber: boolean;
  hasUpperOrSymbol: boolean;
}

function evaluatePasswordStrength(pwd: string): PasswordStrengthResult {
  const hasMinLength = pwd.length >= 6;
  const hasRecommendedLength = pwd.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(pwd);
  const hasNumber = /\d/.test(pwd);
  const hasLetterAndNumber = hasLetter && hasNumber;
  const hasUpperOrSymbol = /[A-Z]/.test(pwd) || /[^a-zA-Z0-9]/.test(pwd);

  if (!pwd) {
    return {
      score: 0,
      labelBn: '',
      labelEn: '',
      barColor: 'bg-[#E6ECFA]',
      textColor: 'text-[#777777]',
      hasMinLength,
      hasRecommendedLength,
      hasLetterAndNumber,
      hasUpperOrSymbol,
    };
  }

  let points = 0;
  if (hasMinLength) points += 1;
  if (hasRecommendedLength) points += 1;
  if (hasLetterAndNumber) points += 1;
  if (hasUpperOrSymbol) points += 1;
  if (pwd.length >= 12 && hasLetterAndNumber && hasUpperOrSymbol) points = 4;

  const score = Math.min(4, Math.max(1, points)) as 1 | 2 | 3 | 4;

  if (score === 1) {
    return {
      score,
      labelBn: 'দুর্বল পাসওয়ার্ড',
      labelEn: 'Weak',
      barColor: 'bg-[#DC2626]',
      textColor: 'text-[#DC2626]',
      hasMinLength,
      hasRecommendedLength,
      hasLetterAndNumber,
      hasUpperOrSymbol,
    };
  }
  if (score === 2) {
    return {
      score,
      labelBn: 'মাঝারি পাসওয়ার্ড',
      labelEn: 'Fair',
      barColor: 'bg-[#F59E0B]',
      textColor: 'text-[#D97706]',
      hasMinLength,
      hasRecommendedLength,
      hasLetterAndNumber,
      hasUpperOrSymbol,
    };
  }
  if (score === 3) {
    return {
      score,
      labelBn: 'ভালো পাসওয়ার্ড',
      labelEn: 'Good',
      barColor: 'bg-[#2563EB]',
      textColor: 'text-[#2563EB]',
      hasMinLength,
      hasRecommendedLength,
      hasLetterAndNumber,
      hasUpperOrSymbol,
    };
  }
  return {
    score: 4,
    labelBn: 'শক্তিশালী পাসওয়ার্ড',
    labelEn: 'Strong',
    barColor: 'bg-[#16A34A]',
    textColor: 'text-[#16A34A]',
    hasMinLength,
    hasRecommendedLength,
    hasLetterAndNumber,
    hasUpperOrSymbol,
  };
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
  const [step, setStep] = useState<'default' | 'create-password' | 'success'>('default');
  const [verifiedGoogleUser, setVerifiedGoogleUser] = useState<VerifiedGoogleCandidate | null>(null);

  // Login / Reset fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Create Digital Hub Password fields (Step 3)
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [referralCode, setReferralCode] = useState(initialReferralCode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errorCode, setErrorCode] = useState('');
  const [info, setInfo] = useState('');
  const [successEmail, setSuccessEmail] = useState('');
  const submittingRef = useRef(false);
  const successTimerRef = useRef<number | null>(null);

  const strength = useMemo(() => evaluatePasswordStrength(newPassword), [newPassword]);
  const passwordsMatch = Boolean(confirmPassword) && newPassword === confirmPassword;
  const passwordsMismatch = Boolean(confirmPassword) && newPassword !== confirmPassword;

  useEffect(() => {
    return () => {
      if (successTimerRef.current) {
        window.clearTimeout(successTimerRef.current);
      }
    };
  }, []);

  // Reset form state cleanly whenever modal opens or closes (unless actively in create-password)
  useEffect(() => {
    if (open) {
      if (step === 'default') {
        setMode(initialMode);
        setEmail('');
        setPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setShowLoginPassword(false);
        setShowNewPassword(false);
        setShowConfirmPassword(false);
        setError('');
        setErrorCode('');
        setInfo('');
      }
    } else {
      setStep('default');
      setVerifiedGoogleUser(null);
      setEmail('');
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowLoginPassword(false);
      setShowNewPassword(false);
      setShowConfirmPassword(false);
      setError('');
      setErrorCode('');
      setInfo('');
      setSuccessEmail('');
      submittingRef.current = false;
      setLoading(false);
      onPasswordSetupStateChange?.(false);
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
    setStep('default');
    setVerifiedGoogleUser(null);
    setError('');
    setErrorCode('');
    setInfo('');
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
    if (!preserveEmail) {
      setEmail('');
    }
  };

  const handleCloseModal = async () => {
    if (loading) return;
    if (step === 'create-password' && verifiedGoogleUser) {
      onPasswordSetupStateChange?.(false);
      if (!verifiedGoogleUser.hadExistingProfile && auth.currentUser?.uid === verifiedGoogleUser.uid) {
        // Incomplete first-time signup without password linking: sign out cleanly so user can start fresh
        await signOut(auth).catch(() => {});
      }
    }
    onClose();
  };

  // STEP 1 & STEP 2: Google Account Selection + Verification
  // Used for BOTH "Sign Up with Google" (register intent) and "Continue with Google" (login intent).
  const handleGoogleFlow = async (intent: 'register' | 'login') => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError('');
    setErrorCode('');
    setInfo('');
    setLoading(true);

    // Pause App.tsx auto-close while we inspect whether this Google user needs Step 3 (Create Password)
    onPasswordSetupStateChange?.(true);

    try {
      if (referralCode.trim()) onReferralCapture(referralCode.trim());

      // Always force Google account chooser so users can freely create multiple accounts with different Gmails
      googleProvider.setCustomParameters({ prompt: 'select_account' });
      const cred = await signInWithPopup(auth, googleProvider);
      const signedInUser = cred.user;
      const verifiedEmail = (signedInUser.email || '').trim().toLowerCase();
      const verifiedName = (
        signedInUser.displayName ||
        verifiedEmail.split('@')[0] ||
        'Customer'
      ).trim();

      if (!verifiedEmail) {
        await signOut(auth).catch(() => {});
        onPasswordSetupStateChange?.(false);
        setError(
          lang === 'bn'
            ? 'Google অ্যাকাউন্ট থেকে যাচাইকৃত Gmail ঠিকানা পাওয়া যায়নি। অনুগ্রহ করে অন্য Google অ্যাকাউন্ট বেছে নিন।'
            : 'Could not retrieve a verified Gmail address from Google. Please select another Google account.'
        );
        return;
      }

      const hasPasswordProvider = signedInUser.providerData.some((p) => p.providerId === 'password');
      const existingProfile = await hasExistingUserProfile(signedInUser.uid);

      // Show "Create Your Digital Hub Password" screen when:
      // 1. User clicked "Sign Up with Google" and does NOT yet have a Digital Hub password linked, OR
      // 2. Brand-new user (no existing Firestore profile and no password linked) clicked Google on Login tab.
      const needsPasswordSetup =
        intent === 'register'
          ? !hasPasswordProvider
          : !hasPasswordProvider && !existingProfile;

      if (needsPasswordSetup) {
        setVerifiedGoogleUser({
          uid: signedInUser.uid,
          email: verifiedEmail,
          displayName: verifiedName,
          photoURL: signedInUser.photoURL || '',
          hadExistingProfile: existingProfile,
        });
        setNewPassword('');
        setConfirmPassword('');
        setShowNewPassword(false);
        setShowConfirmPassword(false);
        setStep('create-password');
        return;
      }

      // Account is already registered on Digital Hub — preserve existing data and log in seamlessly
      onPasswordSetupStateChange?.(false);
      onLoginSuccess?.();
      if (onRegistrationComplete) {
        await onRegistrationComplete(signedInUser, true);
      } else {
        onClose();
      }
    } catch (err) {
      onPasswordSetupStateChange?.(false);
      const mapped = mapFirebaseAuthError(err, intent === 'register' ? 'register' : 'google', lang);
      setErrorCode(mapped.code);
      setError(mapped.message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  // Switch to another Google account directly from Step 3 (supports multiple Gmail accounts smoothly)
  const handleChooseAnotherGoogleAccount = async () => {
    if (submittingRef.current) return;
    setError('');
    setErrorCode('');
    setInfo('');
    setNewPassword('');
    setConfirmPassword('');
    setVerifiedGoogleUser(null);
    await signOut(auth).catch(() => {});
    setStep('default');
    setMode('register');
    await handleGoogleFlow('register');
  };

  // STEP 4, STEP 5, STEP 6: Link Email/Password credential to verified Google user -> sync profile -> auto-login
  const handleCreatePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current || !verifiedGoogleUser) return;

    setError('');
    setErrorCode('');
    setInfo('');

    const currentUser = auth.currentUser;
    const currentEmail = (currentUser?.email || '').trim().toLowerCase();

    // Security check: strictly enforce that password is only linked to the actively Google-verified user
    if (!currentUser || currentUser.uid !== verifiedGoogleUser.uid || currentEmail !== verifiedGoogleUser.email) {
      setError(
        lang === 'bn'
          ? 'Google যাচাইকরণ সেশনটি শেষ হয়ে গেছে। অনুগ্রহ করে আবার Google দিয়ে যাচাই করুন।'
          : 'Google verification session expired. Please verify your Google account again.'
      );
      setStep('default');
      setMode('register');
      setVerifiedGoogleUser(null);
      onPasswordSetupStateChange?.(false);
      return;
    }

    if (newPassword.length < 6) {
      setError(
        lang === 'bn'
          ? 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে (৮ বা তার বেশি অক্ষর সুপারিশকৃত)।'
          : 'Password must be at least 6 characters long (8+ characters recommended).'
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(
        lang === 'bn'
          ? 'দুটি পাসওয়ার্ড মেলেনি। অনুগ্রহ করে একই পাসওয়ার্ড দুই ঘরে লিখুন।'
          : 'Passwords do not match. Please enter the same password in both fields.'
      );
      return;
    }

    submittingRef.current = true;
    setLoading(true);

    try {
      const emailCredential = EmailAuthProvider.credential(verifiedGoogleUser.email, newPassword);

      // STEP 4: Link Email/Password provider to the existing Google-authenticated Firebase user.
      // Never calls createUserWithEmailAndPassword — zero duplicate Firebase accounts!
      try {
        await linkWithCredential(currentUser, emailCredential);
      } catch (linkErr) {
        const linkCode = getFirebaseAuthErrorCode(linkErr);
        if (linkCode === 'auth/requires-recent-login') {
          googleProvider.setCustomParameters({
            prompt: 'select_account',
            login_hint: verifiedGoogleUser.email,
          });
          await reauthenticateWithPopup(currentUser, googleProvider);
          await linkWithCredential(currentUser, emailCredential);
        } else if (linkCode === 'auth/provider-already-linked') {
          // Password credential is already linked on this exact account; proceed safely
        } else {
          throw linkErr;
        }
      }

      // Immediately clear plain-text passwords from memory; Firebase Auth stores the secure hash
      setNewPassword('');
      setConfirmPassword('');

      // Refresh Firebase user state & ID token
      await currentUser.reload().catch(() => {});
      await currentUser.getIdToken(true).catch(() => {});

      // STEP 5: Create or update user profile in Firestore, preserving all existing user records
      if (referralCode.trim()) onReferralCapture(referralCode.trim());
      await ensureUserProfile(
        currentUser.uid,
        verifiedGoogleUser.email,
        verifiedGoogleUser.displayName,
        lang,
        referralCode.trim(),
        verifiedGoogleUser.photoURL
      ).catch((profileErr) => {
        console.warn('Non-fatal Firestore profile sync error after password linking:', profileErr);
      });

      // STEP 6: Show success confirmation and automatically log into Digital Hub
      setSuccessEmail(verifiedGoogleUser.email);
      setStep('success');
      onLoginSuccess?.();

      successTimerRef.current = window.setTimeout(async () => {
        onPasswordSetupStateChange?.(false);
        if (onRegistrationComplete) {
          await onRegistrationComplete(currentUser, false);
        } else {
          onClose();
        }
      }, 1050);
    } catch (err) {
      const mapped = mapFirebaseAuthError(err, 'link-password', lang);
      setErrorCode(mapped.code);
      setError(mapped.message);
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  // Future Login (Gmail + Digital Hub Password) & Forgot Password Reset
  const handleEmailFormSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;

    const normalizedEmail = email.trim().toLowerCase();
    setError('');
    setErrorCode('');
    setInfo('');

    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      setError(
        lang === 'bn'
          ? 'অনুগ্রহ করে একটি সঠিক Gmail / ইমেইল ঠিকানা লিখুন।'
          : 'Please enter a valid Gmail / email address.'
      );
      return;
    }

    if (mode === 'login' && password.length < 6) {
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
      if (mode === 'reset') {
        await sendPasswordResetEmail(auth, normalizedEmail);
        setInfo(
          lang === 'bn'
            ? `পাসওয়ার্ড রিসেট লিংক ${normalizedEmail} ইমেইলে পাঠানো হয়েছে। অনুগ্রহ করে ইনবক্স বা Spam ফোল্ডার চেক করুন।`
            : `Password reset link has been sent to ${normalizedEmail}. Please check your inbox or Spam folder.`
        );
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
      const mapped = mapFirebaseAuthError(err, mode === 'reset' ? 'reset' : 'login', lang);
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
    <div className="fixed inset-0 z-50 bg-[#172033]/65 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="w-full max-w-md bg-white rounded-3xl border border-[#E6ECFA] shadow-2xl overflow-hidden my-auto">
        <div className="px-5 sm:px-6 py-4 bg-[#FFF7EE] border-b border-[#E6ECFA] flex items-center justify-between">
          <DigitalHubLogo compact />
          <button
            type="button"
            onClick={handleCloseModal}
            disabled={loading}
            className="p-2 rounded-xl bg-white border border-[#E6ECFA] text-[#777777] hover:text-[#172033] disabled:opacity-50"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6 space-y-5 max-h-[85vh] overflow-y-auto">
          {step === 'success' ? (
            /* STEP 6: Registration Complete & Auto-Login */
            <div className="py-6 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 text-[#16A34A] flex items-center justify-center mx-auto shadow-xs">
                <CheckCircle2 className="w-9 h-9" />
              </div>
              <div className="space-y-1.5">
                <h2 className="text-xl font-extrabold text-[#172033]">
                  {lang === 'bn'
                    ? 'অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে!'
                    : 'Account Created Successfully!'}
                </h2>
                <p className="text-xs sm:text-sm text-[#777777]">
                  {lang === 'bn'
                    ? 'আপনার Google এবং Digital Hub পাসওয়ার্ড উভয়ই সক্রিয় হয়েছে। আপনাকে স্বয়ংক্রিয়ভাবে লগইন করা হচ্ছে...'
                    : 'Both Google Login and your Digital Hub password are now active. Signing you in automatically...'}
                </p>
              </div>
              {successEmail && (
                <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-bold text-[#172033]">
                  <UserCheck className="w-4 h-4 text-[#16A34A]" />
                  <span>{successEmail}</span>
                </div>
              )}
            </div>
          ) : step === 'create-password' && verifiedGoogleUser ? (
            /* STEP 3: Create Your Digital Hub Password Screen (Bengali + Mobile Responsive) */
            <div className="space-y-4">
              {/* Step Indicator */}
              <div className="flex items-center gap-2 text-[11px] font-bold">
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 text-[#16A34A] border border-emerald-200">
                  <Check className="w-3.5 h-3.5" />
                  {lang === 'bn' ? '১. Google যাচাইকৃত' : '1. Google Verified'}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-[#94A3B8]" />
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FFF3E5] text-[#FF8500] border border-[#FFD7AA]">
                  <Lock className="w-3.5 h-3.5" />
                  {lang === 'bn' ? '২. পাসওয়ার্ড তৈরি' : '2. Create Password'}
                </span>
              </div>

              <div>
                <h2 className="text-lg sm:text-xl font-extrabold text-[#172033]">
                  {lang === 'bn'
                    ? 'আপনার Digital Hub পাসওয়ার্ড তৈরি করুন'
                    : 'Create Your Digital Hub Password'}
                </h2>
                <p className="text-xs sm:text-sm text-[#777777] mt-1 leading-relaxed">
                  {lang === 'bn'
                    ? 'আপনার Google অ্যাকাউন্ট সফলভাবে যাচাই হয়েছে। এখন Digital Hub-এ লগইন করার জন্য একটি পাসওয়ার্ড তৈরি করুন।'
                    : 'Your Google account has been verified. Now create a password to use when logging into Digital Hub.'}
                </p>
              </div>

              {/* Verified Google Identity Card */}
              <div className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] flex items-center gap-3">
                {verifiedGoogleUser.photoURL ? (
                  <img
                    src={verifiedGoogleUser.photoURL}
                    alt={verifiedGoogleUser.displayName}
                    className="w-11 h-11 rounded-xl object-cover border-2 border-emerald-400 shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-xl dh-orange-gradient text-white font-extrabold text-base flex items-center justify-center shrink-0">
                    {verifiedGoogleUser.displayName.slice(0, 1).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold text-[#172033] truncate">
                      {verifiedGoogleUser.displayName}
                    </p>
                    <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0" />
                  </div>
                  <p className="text-[11px] font-semibold text-[#16A34A]">
                    {lang === 'bn' ? 'Google দ্বারা যাচাইকৃত অ্যাকাউন্ট' : 'Verified Google Account'}
                  </p>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-semibold leading-relaxed">
                  {error}
                </div>
              )}

              <form onSubmit={handleCreatePasswordSubmit} className="space-y-3.5" autoComplete="off">
                {/* Verified Gmail (Read-Only) */}
                <div>
                  <label
                    htmlFor="dh-verified-gmail"
                    className="block text-xs font-bold text-[#172033] mb-1"
                  >
                    {lang === 'bn' ? 'যাচাইকৃত Gmail ঠিকানা' : 'Verified Gmail Address'}
                  </label>
                  <div className="relative">
                    <input
                      id="dh-verified-gmail"
                      type="email"
                      readOnly
                      tabIndex={-1}
                      value={verifiedGoogleUser.email}
                      className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-[#EEF2FA] border border-[#D8E2F5] text-sm font-semibold text-[#172033] cursor-not-allowed select-all"
                    />
                    <ShieldCheck
                      className="w-4 h-4 text-[#16A34A] absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                      aria-hidden="true"
                    />
                  </div>
                </div>

                {/* New Password Field + Show/Hide Toggle */}
                <div>
                  <label
                    htmlFor="dh-new-password"
                    className="block text-xs font-bold text-[#172033] mb-1"
                  >
                    {lang === 'bn' ? 'নতুন পাসওয়ার্ড' : 'New Password'}
                  </label>
                  <div className="relative">
                    <input
                      id="dh-new-password"
                      name="dh_new_password"
                      type={showNewPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={
                        lang === 'bn'
                          ? 'কমপক্ষে ৬ অক্ষরের শক্তিশালী পাসওয়ার্ড লিখুন'
                          : 'Enter a strong password (min 6 chars)'
                      }
                      className="w-full pl-3.5 pr-11 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm text-[#172033] focus:outline-none focus:border-[#FF8500]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((v) => !v)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[#777777] hover:text-[#172033]"
                      aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Password Strength Indicator */}
                  {newPassword.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      <div className="grid grid-cols-4 gap-1.5">
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
                          {lang === 'bn'
                            ? `${newPassword.length} অক্ষর`
                            : `${newPassword.length} chars`}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                        <span
                          className={
                            strength.hasMinLength ? 'text-[#16A34A] font-semibold' : 'text-[#777777]'
                          }
                        >
                          {strength.hasMinLength ? '✓' : '○'}{' '}
                          {lang === 'bn' ? 'কমপক্ষে ৬ অক্ষর' : '6+ chars'}
                        </span>
                        <span
                          className={
                            strength.hasLetterAndNumber
                              ? 'text-[#16A34A] font-semibold'
                              : 'text-[#777777]'
                          }
                        >
                          {strength.hasLetterAndNumber ? '✓' : '○'}{' '}
                          {lang === 'bn' ? 'অক্ষর ও সংখ্যা' : 'Letters & numbers'}
                        </span>
                        <span
                          className={
                            strength.hasUpperOrSymbol
                              ? 'text-[#16A34A] font-semibold'
                              : 'text-[#777777]'
                          }
                        >
                          {strength.hasUpperOrSymbol ? '✓' : '○'}{' '}
                          {lang === 'bn' ? 'বড় হাতের অক্ষর/চিহ্ন' : 'Uppercase/symbol'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm Password Field + Show/Hide Toggle */}
                <div>
                  <label
                    htmlFor="dh-confirm-password"
                    className="block text-xs font-bold text-[#172033] mb-1"
                  >
                    {lang === 'bn' ? 'পাসওয়ার্ড নিশ্চিত করুন' : 'Confirm Password'}
                  </label>
                  <div className="relative">
                    <input
                      id="dh-confirm-password"
                      name="dh_confirm_password"
                      type={showConfirmPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder={
                        lang === 'bn'
                          ? 'একই পাসওয়ার্ড আবার লিখুন'
                          : 'Re-enter your password'
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
                      {lang === 'bn' ? 'পাসওয়ার্ড দুটি মেলেনি।' : 'Passwords do not match.'}
                    </p>
                  )}
                  {passwordsMatch && (
                    <p className="text-[11px] font-semibold text-[#16A34A] mt-1">
                      {lang === 'bn' ? 'পাসওয়ার্ড মিলেছে।' : 'Passwords match.'}
                    </p>
                  )}
                </div>

                {/* Continue / Create Account Button */}
                <button
                  type="submit"
                  disabled={loading || !strength.hasMinLength || passwordsMismatch}
                  className="w-full py-3 rounded-xl dh-orange-gradient text-white font-bold text-sm shadow-sm hover:opacity-95 disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>
                    {loading
                      ? lang === 'bn'
                        ? 'অ্যাকাউন্ট সেটআপ হচ্ছে...'
                        : 'Creating Account...'
                      : lang === 'bn'
                        ? 'চালিয়ে যান / অ্যাকাউন্ট তৈরি করুন'
                        : 'Continue / Create Account'}
                  </span>
                </button>
              </form>

              <p className="text-[11px] text-center text-[#777777] leading-relaxed">
                {lang === 'bn'
                  ? 'আপনার পাসওয়ার্ড Firebase Authentication-এ সম্পূর্ণ এনক্রিপ্ট করে সংরক্ষিত হয়। ভবিষ্যতে আপনি Google অথবা Gmail + এই পাসওয়ার্ড দিয়ে লগইন করতে পারবেন।'
                  : 'Your password is securely stored by Firebase Authentication. Next time, sign in using either Google or your Gmail + this password.'}
              </p>

              <div className="pt-2 border-t border-[#E6ECFA] text-center">
                <button
                  type="button"
                  onClick={handleChooseAnotherGoogleAccount}
                  disabled={loading}
                  className="text-xs font-semibold text-[#777777] hover:text-[#FF8500] inline-flex items-center gap-1.5"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  {lang === 'bn'
                    ? 'অন্য Google অ্যাকাউন্ট ব্যবহার করুন'
                    : 'Use a different Google account'}
                </button>
              </div>
            </div>
          ) : needsVerification ? (
            /* Legacy Unverified Email Account Fallback */
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
            /* DEFAULT AUTH SCREEN: Login | Register (Google-First) | Forgot Password */
            <>
              {/* Clean Two-Mode Switcher (Login / Create Account) */}
              {mode !== 'reset' && (
                <div className="grid grid-cols-2 p-1 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA]">
                  <button
                    type="button"
                    onClick={() => switchMode('login', false)}
                    className={`py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                      mode === 'login'
                        ? 'bg-white text-[#172033] shadow-xs border border-[#E6ECFA]'
                        : 'text-[#777777] hover:text-[#172033]'
                    }`}
                  >
                    {lang === 'bn' ? 'লগইন করুন' : 'Sign In'}
                  </button>
                  <button
                    type="button"
                    onClick={() => switchMode('register', false)}
                    className={`py-2 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                      mode === 'register'
                        ? 'dh-orange-gradient text-white shadow-xs'
                        : 'text-[#777777] hover:text-[#172033]'
                    }`}
                  >
                    {lang === 'bn' ? 'নতুন অ্যাকাউন্ট' : 'Create Account'}
                  </button>
                </div>
              )}

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
                <p className="text-xs text-[#777777] mt-1">
                  {mode === 'register'
                    ? lang === 'bn'
                      ? 'প্রথমে Google দিয়ে আপনার Gmail যাচাই করুন, তারপর Digital Hub-এর জন্য নিজের পাসওয়ার্ড সেট করুন।'
                      : 'First verify your Gmail with Google, then create your own Digital Hub password.'
                    : mode === 'reset'
                      ? lang === 'bn'
                        ? 'আপনার নিবন্ধিত Gmail ঠিকানা দিন — আমরা পাসওয়ার্ড রিসেট লিংক পাঠিয়ে দেব।'
                        : 'Enter your registered Gmail address to receive a Firebase password reset link.'
                      : lang === 'bn'
                        ? 'Google অথবা আপনার Gmail ও Digital Hub পাসওয়ার্ড দিয়ে লগইন করুন।'
                        : 'Sign in with Google or your Gmail & Digital Hub password.'}
                </p>
              </div>

              {error && (
                <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[#DC2626] text-xs font-semibold space-y-2 leading-relaxed">
                  <p>{error}</p>
                  {mode === 'register' &&
                    (errorCode === 'auth/email-already-in-use' ||
                      errorCode === 'auth/credential-already-in-use' ||
                      errorCode === 'auth/provider-already-linked') && (
                      <div className="flex flex-wrap items-center gap-3 pt-0.5">
                        <button
                          type="button"
                          onClick={() => switchMode('login', false)}
                          className="underline font-bold text-[#172033] hover:text-[#FF8500]"
                        >
                          {lang === 'bn' ? 'লগইন পেজে যান' : 'Go to Sign In'}
                        </button>
                        <button
                          type="button"
                          onClick={() => switchMode('reset', false)}
                          className="underline font-semibold text-[#777777] hover:text-[#172033]"
                        >
                          {lang === 'bn' ? 'পাসওয়ার্ড রিসেট করুন' : 'Reset password'}
                        </button>
                      </div>
                    )}
                </div>
              )}
              {info && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold flex items-start gap-2 leading-relaxed">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{info}</span>
                </div>
              )}

              {mode === 'register' ? (
                /* STEP 1: Google-First Public Registration Flow */
                <div className="space-y-4">
                  {/* Optional Referral Code before Google Verification */}
                  <div>
                    <label
                      htmlFor="dh-register-referral"
                      className="block text-xs font-bold text-[#172033] mb-1"
                    >
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

                  {/* Primary STEP 1 CTA: Sign Up with Google */}
                  <button
                    type="button"
                    onClick={() => handleGoogleFlow('register')}
                    disabled={loading}
                    className="w-full py-3.5 px-4 rounded-2xl bg-[#172033] hover:bg-[#23314d] text-white font-bold text-sm flex items-center justify-center gap-3 transition-colors shadow-md disabled:opacity-60"
                  >
                    <span className="w-7 h-7 rounded-lg bg-white flex items-center justify-center shrink-0">
                      <GoogleBrandMark />
                    </span>
                    <span>
                      {loading
                        ? lang === 'bn'
                          ? 'Google যাচাই চলছে...'
                          : 'Verifying with Google...'
                        : lang === 'bn'
                          ? 'Google দিয়ে সাইনআপ করুন'
                          : 'Sign Up with Google'}
                    </span>
                  </button>

                  {/* 2-Step Guided Explanation */}
                  <div className="p-3.5 rounded-2xl bg-[#FFF7EE] border border-[#FFE0BF] space-y-2">
                    <p className="text-xs font-extrabold text-[#172033]">
                      {lang === 'bn' ? 'কিভাবে নতুন অ্যাকাউন্ট তৈরি হবে:' : 'How registration works:'}
                    </p>
                    <div className="space-y-1.5 text-[11px] sm:text-xs text-[#555555]">
                      <div className="flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full bg-[#FF8500] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          ১
                        </span>
                        <span>
                          {lang === 'bn'
                            ? 'পপআপ থেকে আপনার পছন্দের Google (Gmail) অ্যাকাউন্টটি বাছাই করুন।'
                            : 'Choose your Google (Gmail) account in the popup window.'}
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full bg-[#FF8500] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          ২
                        </span>
                        <span>
                          {lang === 'bn'
                            ? 'Gmail যাচাই হলে Digital Hub-এর জন্য আপনার নিজের পাসওয়ার্ড তৈরি করুন।'
                            : 'Once verified, create your own Digital Hub password.'}
                        </span>
                      </div>
                      <div className="flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full bg-[#16A34A] text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                          ✓
                        </span>
                        <span>
                          {lang === 'bn'
                            ? 'ভবিষ্যতে Google অথবা Gmail + পাসওয়ার্ড—যেকোনোটি দিয়ে লগইন করতে পারবেন।'
                            : 'Log in anytime with Google or your Gmail + Digital Hub password.'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-center text-[#777777]">
                    {lang === 'bn'
                      ? 'ভিন্ন ভিন্ন Gmail ঠিকানা দিয়ে একাধিক Digital Hub অ্যাকাউন্ট তৈরি করা যাবে।'
                      : 'You can create multiple Digital Hub accounts using different Gmail addresses.'}
                  </p>
                </div>
              ) : (
                /* LOGIN & FORGOT PASSWORD FLOWS */
                <>
                  {mode === 'login' && (
                    <>
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => handleGoogleFlow('login')}
                          disabled={loading}
                          className="w-full py-3 px-4 rounded-xl bg-[#172033] hover:bg-[#23314d] text-white font-bold text-sm flex items-center justify-center gap-2.5 transition-colors shadow-sm disabled:opacity-60"
                        >
                          <span className="w-6 h-6 rounded-md bg-white flex items-center justify-center shrink-0">
                            <GoogleBrandMark />
                          </span>
                          <span>
                            {loading
                              ? '...'
                              : lang === 'bn'
                                ? 'Google দিয়ে লগইন করুন'
                                : 'Continue with Google'}
                          </span>
                        </button>
                      </div>

                      <div className="relative flex items-center py-0.5">
                        <div className="flex-grow border-t border-[#E6ECFA]" />
                        <span className="px-3 text-[11px] font-bold uppercase tracking-wider text-[#777777]">
                          {lang === 'bn' ? 'অথবা Gmail ও পাসওয়ার্ড দিয়ে' : 'OR GMAIL & PASSWORD'}
                        </span>
                        <div className="flex-grow border-t border-[#E6ECFA]" />
                      </div>
                    </>
                  )}

                  <form key={mode} onSubmit={handleEmailFormSubmit} className="space-y-3">
                    <div>
                      <label
                        htmlFor={`dh-${mode}-email`}
                        className="block text-xs font-bold text-[#172033] mb-1"
                      >
                        {lang === 'bn' ? 'Gmail / ইমেইল ঠিকানা' : 'Gmail / Email Address'}
                      </label>
                      <input
                        id={`dh-${mode}-email`}
                        name="email"
                        type="email"
                        required
                        autoComplete="email"
                        autoCapitalize="none"
                        spellCheck={false}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="yourname@gmail.com"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm text-[#172033] focus:outline-none focus:border-[#FF8500]"
                      />
                    </div>

                    {mode === 'login' && (
                      <div>
                        <label
                          htmlFor="dh-login-password"
                          className="block text-xs font-bold text-[#172033] mb-1"
                        >
                          {lang === 'bn' ? 'Digital Hub পাসওয়ার্ড' : 'Digital Hub Password'}
                        </label>
                        <div className="relative">
                          <input
                            id="dh-login-password"
                            name="password"
                            type={showLoginPassword ? 'text' : 'password'}
                            required
                            minLength={6}
                            autoComplete="current-password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full pl-3.5 pr-11 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-sm text-[#172033] focus:outline-none focus:border-[#FF8500]"
                          />
                          <button
                            type="button"
                            onClick={() => setShowLoginPassword((v) => !v)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-[#777777] hover:text-[#172033]"
                            aria-label={showLoginPassword ? 'Hide password' : 'Show password'}
                          >
                            {showLoginPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={loading}
                      className="w-full py-2.5 rounded-xl dh-orange-gradient text-white font-bold text-sm shadow-sm hover:opacity-95 disabled:opacity-60 flex items-center justify-center gap-2"
                    >
                      <KeyRound className="w-4 h-4" />
                      <span>
                        {loading
                          ? '...'
                          : mode === 'login'
                            ? t(lang, 'signIn')
                            : lang === 'bn'
                              ? 'রিসেট লিংক পাঠান'
                              : 'Send Reset Link'}
                      </span>
                    </button>
                  </form>
                </>
              )}

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
