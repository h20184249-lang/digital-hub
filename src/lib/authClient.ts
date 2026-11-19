import { apiUrl } from './apiClient';
import { AuthUser, Language, UserProfile } from '../types/marketplace';

export class AuthApiError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'AuthApiError';
    this.code = code;
    this.status = status;
  }
}

const BENGALI_DIGITS: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

export function normalizeBangladeshPhoneClient(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const ascii = raw.replace(/[০-৯]/g, (d) => BENGALI_DIGITS[d] || d);
  const cleaned = ascii.replace(/[\s\-().]/g, '').trim();
  if (!cleaned) return null;
  if (/^\+8801[3-9]\d{8}$/.test(cleaned)) return cleaned;
  if (/^8801[3-9]\d{8}$/.test(cleaned)) return `+${cleaned}`;
  if (/^01[3-9]\d{8}$/.test(cleaned)) return `+88${cleaned}`;
  if (/^1[3-9]\d{8}$/.test(cleaned)) return `+880${cleaned}`;
  return null;
}

const CLIENT_EMAIL_REGEX =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function normalizeEmailAddressClient(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (!normalized || normalized.length > 254) return null;
  if (/\s/.test(normalized) || normalized.includes('..')) return null;
  const atIdx = normalized.indexOf('@');
  if (atIdx <= 0 || atIdx !== normalized.lastIndexOf('@')) return null;
  const localPart = normalized.slice(0, atIdx);
  const domainPart = normalized.slice(atIdx + 1);
  if (localPart.length > 64 || domainPart.length < 3 || domainPart.length > 253) return null;
  if (localPart.startsWith('.') || localPart.endsWith('.')) return null;
  if (!CLIENT_EMAIL_REGEX.test(normalized)) return null;
  return normalized;
}

async function postAuthJson<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(apiUrl(path), {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : '{}',
    });
  } catch {
    throw new AuthApiError(
      'auth/network-request-failed',
      'ইন্টারনেট বা সার্ভার সংযোগে সমস্যা হয়েছে। অনুগ্রহ করে আবার চেষ্টা করুন।',
      0
    );
  }

  const data = (await resp.json().catch(() => ({}))) as T & {
    ok?: boolean;
    code?: string;
    error?: string;
  };

  if (!resp.ok || data.ok === false) {
    throw new AuthApiError(
      data.code || 'auth/request-failed',
      data.error || 'অনুরোধ সম্পন্ন করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।',
      resp.status
    );
  }

  return data;
}

export interface RegisterAuthResult {
  ok: true;
  user: AuthUser;
  profile: UserProfile;
  recoveryCode: string;
}

export type RegisterPhoneResult = RegisterAuthResult;

export async function registerWithPhone(input: {
  fullName: string;
  phone: string;
  password: string;
  confirmPassword: string;
  referralCode?: string;
  language?: Language;
}): Promise<RegisterAuthResult> {
  return postAuthJson<RegisterAuthResult>('/api/auth/register', {
    authMethod: 'phone',
    fullName: input.fullName.trim(),
    phone: input.phone.trim(),
    password: input.password,
    confirmPassword: input.confirmPassword,
    referralCode: (input.referralCode || '').trim(),
    language: input.language || 'bn',
  });
}

export async function registerWithEmail(input: {
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  referralCode?: string;
  language?: Language;
}): Promise<RegisterAuthResult> {
  return postAuthJson<RegisterAuthResult>('/api/auth/register', {
    authMethod: 'email',
    fullName: input.fullName.trim(),
    email: input.email.trim().toLowerCase(),
    password: input.password,
    confirmPassword: input.confirmPassword,
    referralCode: (input.referralCode || '').trim(),
    language: input.language || 'bn',
  });
}

export interface LoginAuthResult {
  ok: true;
  user: AuthUser;
  profile: UserProfile;
}

export type LoginPhoneResult = LoginAuthResult;

export async function loginWithPhone(input: {
  phone: string;
  password: string;
}): Promise<LoginAuthResult> {
  return postAuthJson<LoginAuthResult>('/api/auth/login', {
    authMethod: 'phone',
    phone: input.phone.trim(),
    password: input.password,
  });
}

export async function loginWithEmail(input: {
  email: string;
  password: string;
}): Promise<LoginAuthResult> {
  return postAuthJson<LoginAuthResult>('/api/auth/login', {
    authMethod: 'email',
    email: input.email.trim().toLowerCase(),
    password: input.password,
  });
}

export interface CurrentSessionResult {
  authenticated: boolean;
  user: AuthUser | null;
  profile: UserProfile | null;
  isAdmin: boolean;
}

export async function fetchCurrentSession(): Promise<CurrentSessionResult> {
  try {
    const resp = await fetch(apiUrl('/api/auth/me'), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) {
      return { authenticated: false, user: null, profile: null, isAdmin: false };
    }
    const data = (await resp.json().catch(() => ({}))) as {
      authenticated?: boolean;
      user?: AuthUser | null;
      profile?: UserProfile | null;
      role?: string;
      adminRole?: string;
    };
    if (!data.authenticated || !data.user) {
      return { authenticated: false, user: null, profile: null, isAdmin: false };
    }
    const isAdmin =
      data.user.role === 'admin' ||
      data.user.role === 'super_admin' ||
      data.role === 'admin' ||
      data.adminRole === 'admin' ||
      data.adminRole === 'super_admin';
    return {
      authenticated: true,
      user: data.user,
      profile: data.profile || null,
      isAdmin,
    };
  } catch {
    return { authenticated: false, user: null, profile: null, isAdmin: false };
  }
}

export async function logoutSession(): Promise<void> {
  try {
    await fetch(apiUrl('/api/auth/logout'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  } catch {
    // Non-fatal
  }
}

export async function logoutAllSessions(): Promise<{ ok: true; revokedAt?: number }> {
  return postAuthJson<{ ok: true; revokedAt?: number }>('/api/auth/logout-all');
}

export async function changePasswordWithCurrent(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<{ ok: true }> {
  return postAuthJson<{ ok: true }>('/api/auth/change-password', {
    currentPassword: input.currentPassword,
    newPassword: input.newPassword,
    confirmPassword: input.confirmPassword,
  });
}

export async function regenerateRecoveryCode(
  currentPassword: string
): Promise<{ ok: true; recoveryCode: string }> {
  return postAuthJson<{ ok: true; recoveryCode: string }>('/api/auth/recovery-code/regenerate', {
    currentPassword,
  });
}

export async function resetPasswordWithRecoveryCode(input: {
  authMethod?: 'phone' | 'email';
  phone?: string;
  email?: string;
  recoveryCode: string;
  newPassword: string;
  confirmPassword: string;
}): Promise<{ ok: true; newRecoveryCode: string }> {
  return postAuthJson<{ ok: true; newRecoveryCode: string }>('/api/auth/forgot-password/reset', {
    authMethod: input.authMethod || (input.email && !input.phone ? 'email' : 'phone'),
    phone: (input.phone || '').trim(),
    email: (input.email || '').trim().toLowerCase(),
    recoveryCode: input.recoveryCode.trim(),
    newPassword: input.newPassword,
    confirmPassword: input.confirmPassword,
  });
}
