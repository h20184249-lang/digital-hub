import type express from 'express';

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_HASH_BYTES = 32;
const PBKDF2_SALT_BYTES = 16;

export const SESSION_COOKIE_NAME = 'dh_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const BENGALI_DIGITS_MAP: Record<string, string> = {
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

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const binary = atob(padded + '='.repeat(padLen));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function normalizeBangladeshPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const ascii = raw.replace(/[০-৯]/g, (d) => BENGALI_DIGITS_MAP[d] || d);
  const cleaned = ascii.replace(/[\s\-().]/g, '').trim();
  if (!cleaned) return null;

  if (/^\+8801[3-9]\d{8}$/.test(cleaned)) return cleaned;
  if (/^8801[3-9]\d{8}$/.test(cleaned)) return `+${cleaned}`;
  if (/^01[3-9]\d{8}$/.test(cleaned)) return `+88${cleaned}`;
  if (/^1[3-9]\d{8}$/.test(cleaned)) return `+880${cleaned}`;
  return null;
}

const EMAIL_VALIDATION_REGEX =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function normalizeEmailAddress(raw: unknown): string | null {
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
  if (!EMAIL_VALIDATION_REGEX.test(normalized)) return null;
  return normalized;
}

export function evaluatePasswordStrength(password: string): { score: number; acceptable: boolean } {
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return { score: 0, acceptable: false };
  }
  let score = 0;
  if (password.length >= 6) score += 1;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password) || /[^A-Za-z0-9]/.test(password)) score += 1;
  // Require at least Fair strength (8+ chars OR mix of letters + digits/symbols)
  const hasLetterAndNumberOrSymbol =
    /[A-Za-z]/.test(password) && (/\d/.test(password) || /[^A-Za-z0-9]/.test(password));
  const acceptable = password.length >= 8 || hasLetterAndNumberOrSymbol;
  return { score, acceptable };
}

export function normalizeRecoveryCodeInput(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  let chars = '';
  for (let i = 0; i < bytes.length; i += 1) {
    chars += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return `DH-${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
}

export function generateSecureId(prefix: string, byteLen = 12): string {
  const bytes = new Uint8Array(byteLen);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${bytesToHex(bytes)}`;
}

export function generateReferralCode(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  let out = 'DH';
  for (let i = 0; i < bytes.length; i += 1) {
    out += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length];
  }
  return out;
}

export function generateSessionToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

async function derivePbkdf2Bits(
  secret: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const keyMaterial = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const saltBuf = new Uint8Array(salt).buffer as ArrayBuffer;
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: saltBuf,
      iterations,
    },
    keyMaterial,
    PBKDF2_HASH_BYTES * 8
  );
  return new Uint8Array(bits);
}

export async function hashSecretPbkdf2(secret: string): Promise<string> {
  const salt = new Uint8Array(PBKDF2_SALT_BYTES);
  globalThis.crypto.getRandomValues(salt);
  const derived = await derivePbkdf2Bits(secret, salt, PBKDF2_ITERATIONS);
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(derived)}`;
}

export async function verifySecretPbkdf2(secret: string, storedHash: string): Promise<boolean> {
  if (typeof storedHash !== 'string' || !storedHash.startsWith('pbkdf2_sha256$')) {
    return false;
  }
  const parts = storedHash.split('$');
  if (parts.length !== 4) return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 10000 || iterations > 100000) {
    return false;
  }
  try {
    const salt = base64UrlToBytes(parts[2]);
    const expected = base64UrlToBytes(parts[3]);
    const actual = await derivePbkdf2Bits(secret, salt, iterations);
    return timingSafeEqualBytes(actual, expected);
  } catch {
    return false;
  }
}

// Dummy verification executed when an account is not found to equalize response timing
const DUMMY_PBKDF2_HASH =
  'pbkdf2_sha256$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export async function runDummyPasswordWork(password: string): Promise<void> {
  await verifySecretPbkdf2(password, DUMMY_PBKDF2_HASH).catch(() => false);
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx <= 0) continue;
    const key = part.slice(0, eqIdx).trim();
    const rawVal = part.slice(eqIdx + 1).trim();
    if (!key) continue;
    try {
      result[key] = decodeURIComponent(rawVal);
    } catch {
      result[key] = rawVal;
    }
  }
  return result;
}

function isHttpsRequest(req: express.Request): boolean {
  if (req.secure) return true;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  if (forwardedProto === 'https') return true;
  const origin = String(req.headers.origin || '').toLowerCase();
  if (origin.startsWith('https://')) return true;
  const cfVisitor = String(req.headers['cf-visitor'] || '');
  if (cfVisitor.includes('"https"')) return true;
  return false;
}

function isEmbeddedPreviewHost(req: express.Request): boolean {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').toLowerCase();
  const origin = String(req.headers.origin || '').toLowerCase();
  return host.includes('.run.app') || origin.includes('.run.app');
}

export function setSessionCookie(
  req: express.Request,
  res: express.Response,
  rawToken: string,
  maxAgeSeconds = SESSION_TTL_SECONDS
): void {
  const isHttps = isHttpsRequest(req);
  const embeddedPreview = isHttps && isEmbeddedPreviewHost(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(rawToken)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (embeddedPreview) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
    if (isHttps) parts.push('Secure');
  }
  res.append('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(req: express.Request, res: express.Response): void {
  const isHttps = isHttpsRequest(req);
  const embeddedPreview = isHttps && isEmbeddedPreviewHost(req);
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (embeddedPreview) {
    parts.push('SameSite=None', 'Secure', 'Partitioned');
  } else {
    parts.push('SameSite=Lax');
    if (isHttps) parts.push('Secure');
  }
  res.append('Set-Cookie', parts.join('; '));
}
