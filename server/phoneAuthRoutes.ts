import express from 'express';
import {
  clearSessionCookie,
  evaluatePasswordStrength,
  generateRecoveryCode,
  generateReferralCode,
  generateSecureId,
  generateSessionToken,
  hashSecretPbkdf2,
  normalizeBangladeshPhone,
  normalizeEmailAddress,
  normalizeRecoveryCodeInput,
  parseCookies,
  runDummyPasswordWork,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  setSessionCookie,
  sha256Hex,
  verifySecretPbkdf2,
} from './authCrypto.ts';
import {
  AppDatabase,
  DatabaseNotConfiguredError,
  extractPublicPhone,
  getAppDatabase,
  getEmptyPhoneStorageValue,
  getRuntimeEnvVar,
} from './db.ts';

export interface SessionAuthUser {
  uid: string;
  phone: string;
  displayName: string;
  email: string;
  authMethod: 'phone' | 'email';
  photoURL: string;
  role: 'super_admin' | 'admin' | 'user';
  status: 'active' | 'suspended';
  referralCode: string;
  referredBy: string;
  promotionalCredits: number;
  language: 'bn' | 'en';
  adminNotes: string;
  lastLoginAt: number;
  lastLoginIp: string;
  sessionRevokedAt: number;
  createdAt: number;
  updatedAt: number;
  sessionId: string;
}

interface UserRow {
  uid: string;
  phone_e164: string | null;
  display_name: string;
  email: string;
  email_normalized?: string | null;
  auth_method?: string | null;
  photo_url: string;
  password_hash: string;
  recovery_hash: string;
  role: string;
  status: string;
  referral_code: string;
  referred_by: string;
  promotional_credits: number;
  language: string;
  admin_notes?: string | null;
  last_login_at?: number | null;
  last_login_ip?: string | null;
  session_revoked_at: number;
  created_at: number;
  updated_at: number;
}

interface PaymentMethodRow {
  id: string;
  code: string;
  name: string;
  type: string;
  account_number: string;
  account_name: string;
  instructions_bn: string;
  instructions_en: string;
  requirements_bn: string;
  requirements_en: string;
  min_amount: number;
  max_amount: number;
  supports_deposit: number;
  supports_withdrawal: number;
  enabled: number;
  sort_order: number;
  updated_at: number;
}

interface EffectiveSiteSettings {
  maintenanceMode: boolean;
  registrationEnabled: boolean;
  emailAuthEnabled: boolean;
  phoneAuthEnabled: boolean;
  withdrawalsEnabled: boolean;
  minWithdrawalBdt: number;
  referralEnabled: boolean;
  referralBonusBdt: number;
  invitedUserRewardBdt: number;
  referralMaxRewardBdt: number;
  referralEligibility: string;
  loginAlertsEnabled: boolean;
}

interface AttemptRow {
  attempt_key: string;
  attempts: number;
  window_start: number;
  locked_until: number;
}

const DEFAULT_SUPER_ADMIN_EMAIL = 'ftake810@gmail.com';

function getClientIp(req: express.Request): string {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim()) return cfIp.trim().slice(0, 64);
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return String(req.ip || 'unknown').slice(0, 64);
}

export function getConfiguredSuperAdminEmail(): string {
  const fromEnv = normalizeEmailAddress(getRuntimeEnvVar('SUPER_ADMIN_EMAIL'));
  return fromEnv || DEFAULT_SUPER_ADMIN_EMAIL;
}

function getConfiguredAdminPhones(): Set<string> {
  const raw = getRuntimeEnvVar('ADMIN_PHONE_NUMBERS');
  const set = new Set<string>();
  if (!raw) return set;
  for (const part of raw.split(',')) {
    const normalized = normalizeBangladeshPhone(part.trim());
    if (normalized) set.add(normalized);
  }
  return set;
}

function getConfiguredAdminEmails(): Set<string> {
  const raw = getRuntimeEnvVar('ADMIN_EMAILS');
  const set = new Set<string>();
  if (!raw) return set;
  for (const part of raw.split(',')) {
    const normalized = normalizeEmailAddress(part.trim());
    if (normalized) set.add(normalized);
  }
  return set;
}

function isConfiguredSuperAdmin(
  phoneE164: string | null | undefined,
  emailNormalized: string | null | undefined
): boolean {
  const cleanEmail = typeof emailNormalized === 'string' ? emailNormalized.trim().toLowerCase() : '';
  if (cleanEmail && cleanEmail === getConfiguredSuperAdminEmail()) return true;
  const publicPhone = extractPublicPhone(phoneE164);
  if (publicPhone && getConfiguredAdminPhones().has(publicPhone)) return true;
  return false;
}

function resolveUserRole(
  phoneE164: string | null | undefined,
  emailNormalized: string | null | undefined,
  dbRole: string
): 'super_admin' | 'admin' | 'user' {
  if (isConfiguredSuperAdmin(phoneE164, emailNormalized)) return 'super_admin';
  const cleanEmail = typeof emailNormalized === 'string' ? emailNormalized.trim().toLowerCase() : '';
  if (cleanEmail && getConfiguredAdminEmails().has(cleanEmail)) return 'admin';
  if (dbRole === 'admin') return 'admin';
  return 'user';
}

function resolveAuthMethod(row: UserRow): 'phone' | 'email' {
  if (row.auth_method === 'email') return 'email';
  if (row.auth_method === 'phone') return 'phone';
  return extractPublicPhone(row.phone_e164) ? 'phone' : 'email';
}

function getUserPrimaryIdentifier(user: { phone: string; email: string; uid: string }): string {
  return user.email || user.phone || user.uid;
}

function mapPaymentMethodRow(row: PaymentMethodRow) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type:
      row.type === 'bank_transfer' || row.type === 'custom'
        ? (row.type as 'bank_transfer' | 'custom')
        : ('mobile_banking' as const),
    accountNumber: row.account_number || '',
    accountName: row.account_name || '',
    instructionsBn: row.instructions_bn || '',
    instructionsEn: row.instructions_en || '',
    requirementsBn: row.requirements_bn || '',
    requirementsEn: row.requirements_en || '',
    minAmount: Number(row.min_amount || 50),
    maxAmount: Number(row.max_amount || 100000),
    supportsDeposit: row.supports_deposit === 1,
    supportsWithdrawal: row.supports_withdrawal === 1,
    enabled: row.enabled === 1,
    sortOrder: Number(row.sort_order || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

async function getGlobalSiteSettings(db: AppDatabase): Promise<EffectiveSiteSettings> {
  const row = await db.first<{ payload_json: string }>(
    `SELECT payload_json FROM catalog_overrides WHERE collection = 'settings' AND doc_id = 'global' AND deleted = 0 LIMIT 1`
  );
  const raw = row ? parseJsonSafe<Record<string, unknown>>(row.payload_json, {}) : {};
  return {
    maintenanceMode: Boolean(raw.maintenanceMode ?? false),
    registrationEnabled: raw.registrationEnabled !== false,
    emailAuthEnabled: raw.emailAuthEnabled !== false,
    phoneAuthEnabled: raw.phoneAuthEnabled !== false,
    withdrawalsEnabled: raw.withdrawalsEnabled !== false,
    minWithdrawalBdt: Math.max(10, Number(raw.minWithdrawalBdt ?? 50) || 50),
    referralEnabled: raw.referralEnabled !== false,
    referralBonusBdt: Math.max(0, Number(raw.referralBonusBdt ?? 50) || 0),
    invitedUserRewardBdt: Math.max(0, Number(raw.invitedUserRewardBdt ?? 20) || 0),
    referralMaxRewardBdt: Math.max(0, Number(raw.referralMaxRewardBdt ?? 5000) || 0),
    referralEligibility: String(raw.referralEligibility || 'first_paid_order'),
    loginAlertsEnabled: raw.loginAlertsEnabled !== false,
  };
}

function toClientAuthUser(row: UserRow) {
  const publicPhone = extractPublicPhone(row.phone_e164);
  const publicEmail = (row.email_normalized || row.email || '').trim().toLowerCase();
  const effectiveRole = resolveUserRole(publicPhone, publicEmail, row.role);
  return {
    uid: row.uid,
    phone: publicPhone,
    displayName: row.display_name,
    email: publicEmail,
    authMethod: resolveAuthMethod(row),
    photoURL: row.photo_url || '',
    role: effectiveRole,
    status: row.status === 'suspended' ? 'suspended' : 'active',
    referralCode: row.referral_code,
    createdAt: row.created_at,
  };
}

function toClientUserProfile(row: UserRow) {
  const publicPhone = extractPublicPhone(row.phone_e164);
  const publicEmail = (row.email_normalized || row.email || '').trim().toLowerCase();
  const effectiveRole = resolveUserRole(publicPhone, publicEmail, row.role);
  return {
    uid: row.uid,
    displayName: row.display_name,
    email: publicEmail,
    role: effectiveRole,
    authMethod: resolveAuthMethod(row),
    phone: publicPhone,
    photoUrl: row.photo_url || '',
    referralCode: row.referral_code,
    referredBy: row.referred_by || '',
    promotionalCredits: Number(row.promotional_credits || 0),
    language: row.language === 'en' ? ('en' as const) : ('bn' as const),
    status: row.status === 'suspended' ? ('suspended' as const) : ('active' as const),
    adminNotes: row.admin_notes || '',
    lastLoginAt: Number(row.last_login_at || 0),
    lastLoginIp: row.last_login_ip || '',
    sessionRevokedAt: Number(row.session_revoked_at || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function parseJsonSafe<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function checkAttemptLimit(
  db: AppDatabase,
  key: string,
  maxAttempts: number,
  windowMs: number
): Promise<{ blocked: boolean; retryAfterSec: number }> {
  const now = Date.now();
  const row = await db.first<AttemptRow>(
    'SELECT attempt_key, attempts, window_start, locked_until FROM auth_attempts WHERE attempt_key = ?',
    [key]
  );
  if (!row) return { blocked: false, retryAfterSec: 0 };
  if (row.locked_until > now) {
    return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((row.locked_until - now) / 1000)) };
  }
  if (now - row.window_start > windowMs) {
    await db.run('DELETE FROM auth_attempts WHERE attempt_key = ?', [key]);
    return { blocked: false, retryAfterSec: 0 };
  }
  if (row.attempts >= maxAttempts) {
    const lockedUntil = row.window_start + windowMs;
    await db.run('UPDATE auth_attempts SET locked_until = ? WHERE attempt_key = ?', [lockedUntil, key]);
    return { blocked: true, retryAfterSec: Math.max(1, Math.ceil((lockedUntil - now) / 1000)) };
  }
  return { blocked: false, retryAfterSec: 0 };
}

async function recordFailedAttempt(
  db: AppDatabase,
  key: string,
  maxAttempts: number,
  windowMs: number,
  lockoutMs: number
): Promise<void> {
  const now = Date.now();
  const row = await db.first<AttemptRow>(
    'SELECT attempt_key, attempts, window_start, locked_until FROM auth_attempts WHERE attempt_key = ?',
    [key]
  );
  if (!row || now - row.window_start > windowMs) {
    await db.run(
      `INSERT INTO auth_attempts (attempt_key, attempts, window_start, locked_until)
       VALUES (?, 1, ?, 0)
       ON CONFLICT(attempt_key) DO UPDATE SET attempts = 1, window_start = excluded.window_start, locked_until = 0`,
      [key, now]
    );
    return;
  }
  const nextAttempts = Number(row.attempts || 0) + 1;
  const lockedUntil = nextAttempts >= maxAttempts ? now + lockoutMs : 0;
  await db.run(
    'UPDATE auth_attempts SET attempts = ?, locked_until = ? WHERE attempt_key = ?',
    [nextAttempts, lockedUntil, key]
  );
}

async function clearAttemptLimit(db: AppDatabase, key: string): Promise<void> {
  await db.run('DELETE FROM auth_attempts WHERE attempt_key = ?', [key]);
}

async function createSessionForUser(
  db: AppDatabase,
  userId: string,
  req: express.Request,
  res: express.Response
): Promise<string> {
  const rawToken = generateSessionToken();
  const tokenHash = await sha256Hex(rawToken);
  const sessionId = generateSecureId('sess', 12);
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_SECONDS * 1000;
  const ip = getClientIp(req);
  const userAgent = String(req.headers['user-agent'] || '').slice(0, 240);

  await db.run(
    `INSERT INTO sessions (id, user_id, token_hash, ip_address, user_agent, created_at, last_seen_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [sessionId, userId, tokenHash, ip, userAgent, now, now, expiresAt]
  );

  // Opportunistic cleanup of expired sessions for this user
  await db
    .run('DELETE FROM sessions WHERE user_id = ? AND (expires_at < ? OR revoked_at > 0)', [userId, now])
    .catch(() => {});

  setSessionCookie(req, res, rawToken, SESSION_TTL_SECONDS);
  return sessionId;
}

export async function resolveSessionFromRequest(
  req: express.Request
): Promise<{ db: AppDatabase; user: SessionAuthUser; rawRow: UserRow } | null> {
  const cookies = parseCookies(req.headers.cookie);
  const rawToken = (cookies[SESSION_COOKIE_NAME] || '').trim();
  if (!rawToken || rawToken.length < 20) return null;

  const db = await getAppDatabase();
  const tokenHash = await sha256Hex(rawToken);
  const now = Date.now();

  const row = await db.first<
    UserRow & {
      session_id: string;
      session_expires_at: number;
      session_revoked_flag: number;
      session_created_at: number;
      session_last_seen_at: number;
    }
  >(
    `SELECT u.*, s.id AS session_id, s.expires_at AS session_expires_at,
            s.revoked_at AS session_revoked_flag, s.created_at AS session_created_at,
            s.last_seen_at AS session_last_seen_at
     FROM sessions s
     INNER JOIN users u ON u.uid = s.user_id
     WHERE s.token_hash = ?
     LIMIT 1`,
    [tokenHash]
  );

  if (!row) return null;
  if (row.session_revoked_flag > 0 || row.session_expires_at <= now) return null;
  const publicPhone = extractPublicPhone(row.phone_e164);
  const publicEmail = (row.email_normalized || row.email || '').trim().toLowerCase();
  const effectiveRole = resolveUserRole(publicPhone, publicEmail, row.role);

  // Protect Super Admin from ever being suspended and keep DB role synced with env config
  if (effectiveRole === 'super_admin' && row.status === 'suspended') {
    await db
      .run('UPDATE users SET status = ?, role = ?, updated_at = ? WHERE uid = ?', ['active', 'super_admin', now, row.uid])
      .catch(() => {});
    row.status = 'active';
    row.role = 'super_admin';
  } else if (row.status === 'suspended') {
    return null;
  }

  if (effectiveRole !== row.role) {
    await db
      .run('UPDATE users SET role = ?, updated_at = ? WHERE uid = ?', [effectiveRole, now, row.uid])
      .catch(() => {});
    row.role = effectiveRole;
  }

  if (now - row.session_last_seen_at > 5 * 60 * 1000) {
    await db
      .run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [now, row.session_id])
      .catch(() => {});
  }

  return {
    db,
    rawRow: row,
    user: {
      uid: row.uid,
      phone: publicPhone,
      displayName: row.display_name,
      email: publicEmail,
      authMethod: resolveAuthMethod(row),
      photoURL: row.photo_url || '',
      role: effectiveRole,
      status: row.status === 'suspended' ? 'suspended' : 'active',
      referralCode: row.referral_code,
      referredBy: row.referred_by || '',
      promotionalCredits: Number(row.promotional_credits || 0),
      language: row.language === 'en' ? 'en' : 'bn',
      adminNotes: row.admin_notes || '',
      lastLoginAt: Number(row.last_login_at || 0),
      lastLoginIp: row.last_login_ip || '',
      sessionRevokedAt: Number(row.session_revoked_at || 0),
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
      sessionId: row.session_id,
    },
  };
}

async function ensureWalletAccount(db: AppDatabase, uid: string): Promise<{
  uid: string;
  availableBalanceBdt: number;
  promotionalCreditsBdt: number;
  totalAddedBdt: number;
  totalSpentBdt: number;
  lastTxId: string;
  updatedAt: number;
}> {
  const existing = await db.first<{
    uid: string;
    available_balance_bdt: number;
    promotional_credits_bdt: number;
    total_added_bdt: number;
    total_spent_bdt: number;
    last_tx_id: string;
    updated_at: number;
  }>('SELECT * FROM wallet_accounts WHERE uid = ?', [uid]);

  if (existing) {
    return {
      uid: existing.uid,
      availableBalanceBdt: Number(existing.available_balance_bdt || 0),
      promotionalCreditsBdt: Number(existing.promotional_credits_bdt || 0),
      totalAddedBdt: Number(existing.total_added_bdt || 0),
      totalSpentBdt: Number(existing.total_spent_bdt || 0),
      lastTxId: existing.last_tx_id || '',
      updatedAt: Number(existing.updated_at || Date.now()),
    };
  }

  const now = Date.now();
  await db.run(
    `INSERT OR IGNORE INTO wallet_accounts
     (uid, available_balance_bdt, promotional_credits_bdt, total_added_bdt, total_spent_bdt, last_tx_id, updated_at)
     VALUES (?, 0, 0, 0, 0, '', ?)`,
    [uid, now]
  );
  return {
    uid,
    availableBalanceBdt: 0,
    promotionalCreditsBdt: 0,
    totalAddedBdt: 0,
    totalSpentBdt: 0,
    lastTxId: '',
    updatedAt: now,
  };
}

async function insertNotification(
  db: AppDatabase,
  userId: string,
  titleBn: string,
  titleEn: string,
  messageBn: string,
  messageEn: string,
  type: 'order' | 'payment' | 'wallet' | 'referral' | 'system' | 'promo'
): Promise<void> {
  const now = Date.now();
  const id = generateSecureId('notif', 8);
  const payload = {
    id,
    userId,
    titleBn,
    titleEn,
    messageBn,
    messageEn,
    type,
    read: false,
    createdAt: now,
  };
  await db.run(
    'INSERT INTO notifications (id, user_id, is_read, payload_json, created_at) VALUES (?, ?, 0, ?, ?)',
    [id, userId, JSON.stringify(payload), now]
  );
}

async function insertAuditLog(
  db: AppDatabase,
  actorUid: string,
  actorIdentifier: string,
  action: string,
  targetCollection: string,
  targetId: string,
  summary: string,
  details?: {
    targetUserId?: string;
    previousValue?: string;
    newValue?: string;
    reason?: string;
    transactionId?: string;
  }
): Promise<void> {
  const now = Date.now();
  const id = generateSecureId('log', 8);
  const payload = {
    id,
    actorUid,
    actorEmail: actorIdentifier,
    action,
    targetCollection,
    targetId,
    targetUserId: details?.targetUserId || '',
    previousValue: details?.previousValue || '',
    newValue: details?.newValue || '',
    reason: details?.reason || '',
    transactionId: details?.transactionId || '',
    summary,
    createdAt: now,
  };
  await db.run(
    'INSERT INTO audit_logs (id, actor_uid, action, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, actorUid, action, JSON.stringify(payload), now]
  );
}

function handleRouteError(res: express.Response, err: unknown, fallbackMsg: string): void {
  if (err instanceof DatabaseNotConfiguredError) {
    res.status(503).json({
      ok: false,
      code: err.code,
      error: err.message,
    });
    return;
  }
  console.error('[DIGITAL HUB API Error]', err);
  res.status(500).json({
    ok: false,
    code: 'server/internal-error',
    error: fallbackMsg,
  });
}

function normalizeTxIdKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

export function createPhoneAuthAndAppRouter(): express.Router {
  const router = express.Router();

  // =========================================================================
  // 1. REGISTRATION (Phone +880 OR Email & Password — PBKDF2-SHA256 + HTTP-only Cookie)
  // =========================================================================
  router.post('/auth/register', async (req, res) => {
    try {
      const db = await getAppDatabase();
      const ip = getClientIp(req);
      const ipLimit = await checkAttemptLimit(db, `reg_ip:${ip}`, 10, 15 * 60 * 1000);
      if (ipLimit.blocked) {
        const mins = Math.max(1, Math.ceil(ipLimit.retryAfterSec / 60));
        res.status(429).json({
          ok: false,
          code: 'auth/too-many-requests',
          error: `অনেকবার চেষ্টা করা হয়েছে। অনুগ্রহ করে ${mins} মিনিট পর আবার চেষ্টা করুন।`,
        });
        return;
      }

      const body = (req.body || {}) as {
        authMethod?: unknown;
        fullName?: unknown;
        phone?: unknown;
        email?: unknown;
        password?: unknown;
        confirmPassword?: unknown;
        referralCode?: unknown;
        language?: unknown;
      };

      const rawMethod = typeof body.authMethod === 'string' ? body.authMethod.trim().toLowerCase() : '';
      const hasRawPhone = typeof body.phone === 'string' && body.phone.trim().length > 0;
      const hasRawEmail = typeof body.email === 'string' && body.email.trim().length > 0;
      const authMethod: 'phone' | 'email' =
        rawMethod === 'email'
          ? 'email'
          : rawMethod === 'phone'
            ? 'phone'
            : !hasRawPhone && hasRawEmail
              ? 'email'
              : 'phone';

      const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 120) : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const confirmPassword =
        typeof body.confirmPassword === 'string' ? body.confirmPassword : undefined;
      const incomingRef =
        typeof body.referralCode === 'string'
          ? body.referralCode.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 24)
          : '';
      const language: 'bn' | 'en' = body.language === 'en' ? 'en' : 'bn';

      if (fullName.length < 2) {
        res.status(400).json({
          ok: false,
          code: 'auth/invalid-name',
          error: 'অনুগ্রহ করে আপনার পূর্ণ নাম লিখুন (কমপক্ষে ২ অক্ষর)।',
        });
        return;
      }

      let phoneE164: string | null = null;
      let emailNormalized: string | null = null;

      if (authMethod === 'email') {
        emailNormalized = normalizeEmailAddress(body.email);
        if (!emailNormalized) {
          res.status(400).json({
            ok: false,
            code: 'auth/invalid-email',
            error: 'সঠিক ইমেইল ঠিকানা লিখুন (যেমন: name@gmail.com)।',
          });
          return;
        }
      } else {
        phoneE164 = normalizeBangladeshPhone(body.phone);
        if (!phoneE164) {
          res.status(400).json({
            ok: false,
            code: 'auth/invalid-phone-number',
            error: 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন (যেমন: 017XXXXXXXX বা +88017XXXXXXXX)।',
          });
          return;
        }
      }

      const siteSettings = await getGlobalSiteSettings(db);
      const isSuperAdminCandidate = isConfiguredSuperAdmin(phoneE164, emailNormalized);

      if (!isSuperAdminCandidate) {
        if (siteSettings.maintenanceMode) {
          res.status(503).json({
            ok: false,
            code: 'system/maintenance-mode',
            error: 'ওয়েবসাইটে বর্তমানে রক্ষণাবেক্ষণ কাজ চলছে। অনুগ্রহ করে কিছুক্ষণ পর চেষ্টা করুন।',
          });
          return;
        }
        if (!siteSettings.registrationEnabled) {
          res.status(403).json({
            ok: false,
            code: 'auth/registration-disabled',
            error: 'অ্যাডমিন কর্তৃক নতুন অ্যাকাউন্ট রেজিস্ট্রেশন সাময়িকভাবে বন্ধ রাখা হয়েছে।',
          });
          return;
        }
        if (authMethod === 'email' && !siteSettings.emailAuthEnabled) {
          res.status(403).json({
            ok: false,
            code: 'auth/method-disabled',
            error: 'ইমেইল রেজিস্ট্রেশন বর্তমানে বন্ধ আছে। অনুগ্রহ করে মোবাইল নম্বর ব্যবহার করুন।',
          });
          return;
        }
        if (authMethod === 'phone' && !siteSettings.phoneAuthEnabled) {
          res.status(403).json({
            ok: false,
            code: 'auth/method-disabled',
            error: 'মোবাইল নম্বর রেজিস্ট্রেশন বর্তমানে বন্ধ আছে। অনুগ্রহ করে ইমেইল ব্যবহার করুন।',
          });
          return;
        }
      }

      if (password.length < 6 || password.length > 128) {
        res.status(400).json({
          ok: false,
          code: 'auth/weak-password',
          error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।',
        });
        return;
      }
      if (authMethod === 'email' && !evaluatePasswordStrength(password).acceptable) {
        res.status(400).json({
          ok: false,
          code: 'auth/weak-password',
          error: 'আরও শক্তিশালী পাসওয়ার্ড দিন (কমপক্ষে ৮ অক্ষর অথবা অক্ষর ও সংখ্যার সমন্বয়ে ৬+ অক্ষর)।',
        });
        return;
      }
      if (confirmPassword !== undefined && password !== confirmPassword) {
        res.status(400).json({
          ok: false,
          code: 'auth/password-mismatch',
          error: 'দুটি পাসওয়ার্ড মেলেনি। একই পাসওয়ার্ড দুই ঘরে লিখুন।',
        });
        return;
      }

      await recordFailedAttempt(db, `reg_ip:${ip}`, 10, 15 * 60 * 1000, 15 * 60 * 1000);

      // Enforce strict uniqueness per identifier without merging accounts
      if (authMethod === 'email' && emailNormalized) {
        const existingEmail = await db.first<{ uid: string }>(
          'SELECT uid FROM users WHERE email_normalized = ? LIMIT 1',
          [emailNormalized]
        );
        if (existingEmail) {
          res.status(409).json({
            ok: false,
            code: 'auth/email-already-in-use',
            error: 'এই ইমেইল ঠিকানা দিয়ে আগে থেকেই অ্যাকাউন্ট রয়েছে। অনুগ্রহ করে লগইন করুন।',
          });
          return;
        }
      } else if (phoneE164) {
        const existingPhone = await db.first<{ uid: string }>(
          'SELECT uid FROM users WHERE phone_e164 = ? LIMIT 1',
          [phoneE164]
        );
        if (existingPhone) {
          res.status(409).json({
            ok: false,
            code: 'auth/phone-already-in-use',
            error: 'এই মোবাইল নম্বর দিয়ে আগে থেকেই অ্যাকাউন্ট রয়েছে। অনুগ্রহ করে লগইন করুন।',
          });
          return;
        }
      }

      const now = Date.now();
      const uid = generateSecureId('dh', 10);
      const recoveryCode = generateRecoveryCode();
      const [passwordHash, recoveryHash] = await Promise.all([
        hashSecretPbkdf2(password),
        hashSecretPbkdf2(normalizeRecoveryCodeInput(recoveryCode)),
      ]);

      // Generate unique referral code
      let myReferralCode = generateReferralCode();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const clash = await db.first<{ uid: string }>(
          'SELECT uid FROM users WHERE referral_code = ? LIMIT 1',
          [myReferralCode]
        );
        if (!clash) break;
        myReferralCode = generateReferralCode();
      }

      // Resolve valid referrer if referral system is enabled and code matches another user
      let validReferredBy = '';
      let referrerUid = '';
      let suspiciousReferral = false;
      let suspiciousReason = '';
      if (siteSettings.referralEnabled && incomingRef && incomingRef !== myReferralCode) {
        const refOwner = await db.first<{ uid: string; referral_code: string; last_login_ip?: string }>(
          'SELECT uid, referral_code, last_login_ip FROM users WHERE referral_code = ? LIMIT 1',
          [incomingRef]
        );
        if (refOwner && refOwner.uid !== uid) {
          validReferredBy = refOwner.referral_code;
          referrerUid = refOwner.uid;
          if (ip && ip !== 'unknown' && ip !== '127.0.0.1' && ip !== '::1' && refOwner.last_login_ip === ip) {
            suspiciousReferral = true;
            suspiciousReason = `Same IP address as referrer (${ip})`;
          } else {
            const recentSameReferrer = await db.first<{ cnt: number }>(
              'SELECT COUNT(*) AS cnt FROM referrals WHERE referrer_uid = ? AND created_at > ?',
              [refOwner.uid, now - 24 * 60 * 60 * 1000]
            );
            if (Number(recentSameReferrer?.cnt || 0) >= 5) {
              suspiciousReferral = true;
              suspiciousReason = 'High-velocity referrals (>5 in 24h)';
            }
          }
        }
      }

      const initialRole = resolveUserRole(phoneE164, emailNormalized, 'user');
      const storedPhoneValue =
        authMethod === 'phone' ? phoneE164 : getEmptyPhoneStorageValue(db, uid);
      const storedEmailDisplay = authMethod === 'email' && emailNormalized ? emailNormalized : '';
      const storedEmailNormalized = authMethod === 'email' ? emailNormalized : null;

      try {
        await db.run(
          `INSERT INTO users (
            uid, phone_e164, display_name, email, email_normalized, auth_method, photo_url,
            password_hash, recovery_hash, role, status, referral_code, referred_by,
            promotional_credits, language, admin_notes, last_login_at, last_login_ip,
            session_revoked_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'active', ?, ?, 0, ?, '', ?, ?, 0, ?, ?)`,
          [
            uid,
            storedPhoneValue,
            fullName,
            storedEmailDisplay,
            storedEmailNormalized,
            authMethod,
            passwordHash,
            recoveryHash,
            initialRole,
            myReferralCode,
            validReferredBy,
            language,
            now,
            ip,
            now,
            now,
          ]
        );
      } catch (insertErr) {
        const msg = insertErr instanceof Error ? insertErr.message : '';
        if (msg.toUpperCase().includes('UNIQUE')) {
          if (authMethod === 'email') {
            res.status(409).json({
              ok: false,
              code: 'auth/email-already-in-use',
              error: 'এই ইমেইল ঠিকানা দিয়ে আগে থেকেই অ্যাকাউন্ট রয়েছে। অনুগ্রহ করে লগইন করুন।',
            });
          } else {
            res.status(409).json({
              ok: false,
              code: 'auth/phone-already-in-use',
              error: 'এই মোবাইল নম্বর দিয়ে আগে থেকেই অ্যাকাউন্ট রয়েছে। অনুগ্রহ করে লগইন করুন।',
            });
          }
          return;
        }
        throw insertErr;
      }

      await ensureWalletAccount(db, uid);

      const primaryIdentifier =
        authMethod === 'email' ? (emailNormalized || '') : (phoneE164 || '');

      if (referrerUid && siteSettings.referralEnabled) {
        const refId = generateSecureId('ref', 8);
        const refStatus = suspiciousReferral ? 'flagged' : 'pending';
        const refPayload = {
          id: refId,
          referrerId: referrerUid,
          referredUserId: uid,
          referredEmail: primaryIdentifier,
          referralCode: validReferredBy,
          rewardAmountBdt: siteSettings.referralBonusBdt,
          invitedRewardBdt: siteSettings.invitedUserRewardBdt,
          eligibilityRule: siteSettings.referralEligibility,
          suspiciousFlag: suspiciousReferral,
          suspiciousReason,
          status: refStatus,
          createdAt: now,
          updatedAt: now,
        };
        await db
          .run(
            'INSERT OR IGNORE INTO referrals (id, referrer_uid, referred_uid, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [refId, referrerUid, uid, refStatus, JSON.stringify(refPayload), now]
          )
          .catch(() => {});
      }

      await insertNotification(
        db,
        uid,
        'DIGITAL HUB-এ স্বাগতম!',
        'Welcome to DIGITAL HUB!',
        authMethod === 'email'
          ? `আপনার ইমেইল (${primaryIdentifier}) দিয়ে অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে।`
          : `আপনার মোবাইল নম্বর (${primaryIdentifier}) দিয়ে অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে।`,
        `Your account with ${primaryIdentifier} has been created successfully.`,
        'system'
      );

      await createSessionForUser(db, uid, req, res);

      const createdRow = await db.first<UserRow>('SELECT * FROM users WHERE uid = ?', [uid]);
      if (!createdRow) {
        res.status(500).json({ ok: false, code: 'server/internal-error', error: 'Account load failed.' });
        return;
      }

      res.status(201).json({
        ok: true,
        user: toClientAuthUser(createdRow),
        profile: toClientUserProfile(createdRow),
        recoveryCode,
      });
    } catch (err) {
      handleRouteError(
        res,
        err,
        'অ্যাকাউন্ট তৈরি করা যায়নি। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।'
      );
    }
  });

  // =========================================================================
  // 2. LOGIN (Phone +880 OR Email & Password — Brute-force protected + HTTP-only Cookie)
  // =========================================================================
  router.post('/auth/login', async (req, res) => {
    try {
      const db = await getAppDatabase();
      const ip = getClientIp(req);
      const ipLimit = await checkAttemptLimit(db, `login_ip:${ip}`, 25, 15 * 60 * 1000);
      if (ipLimit.blocked) {
        const mins = Math.max(1, Math.ceil(ipLimit.retryAfterSec / 60));
        res.status(429).json({
          ok: false,
          code: 'auth/too-many-requests',
          error: `অনেকবার ভুল চেষ্টা করা হয়েছে। অনুগ্রহ করে ${mins} মিনিট পর আবার চেষ্টা করুন।`,
        });
        return;
      }

      const body = (req.body || {}) as {
        authMethod?: unknown;
        phone?: unknown;
        email?: unknown;
        identifier?: unknown;
        password?: unknown;
      };

      const rawMethod = typeof body.authMethod === 'string' ? body.authMethod.trim().toLowerCase() : '';
      const rawPhone = typeof body.phone === 'string' ? body.phone.trim() : '';
      const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';
      const rawIdentifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';

      const authMethod: 'phone' | 'email' =
        rawMethod === 'email'
          ? 'email'
          : rawMethod === 'phone'
            ? 'phone'
            : !rawPhone && (rawEmail.length > 0 || rawIdentifier.includes('@'))
              ? 'email'
              : 'phone';

      let phoneE164: string | null = null;
      let emailNormalized: string | null = null;
      let limitKey = '';

      if (authMethod === 'email') {
        emailNormalized = normalizeEmailAddress(rawEmail || rawIdentifier);
        if (!emailNormalized) {
          res.status(400).json({
            ok: false,
            code: 'auth/invalid-email',
            error: 'সঠিক ইমেইল ঠিকানা লিখুন (যেমন: name@gmail.com)।',
          });
          return;
        }
        if (!password || password.length < 6) {
          res.status(400).json({
            ok: false,
            code: 'auth/invalid-credential',
            error: 'ইমেইল ঠিকানা অথবা পাসওয়ার্ড সঠিক নয়।',
          });
          return;
        }
        limitKey = `login_email:${emailNormalized}`;
      } else {
        phoneE164 = normalizeBangladeshPhone(rawPhone || rawIdentifier);
        if (!phoneE164) {
          res.status(400).json({
            ok: false,
            code: 'auth/invalid-phone-number',
            error: 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন (যেমন: 017XXXXXXXX বা +88017XXXXXXXX)।',
          });
          return;
        }
        if (!password || password.length < 6) {
          res.status(400).json({
            ok: false,
            code: 'auth/invalid-credential',
            error: 'মোবাইল নম্বর অথবা পাসওয়ার্ড সঠিক নয়।',
          });
          return;
        }
        limitKey = `login_phone:${phoneE164}`;
      }

      const siteSettings = await getGlobalSiteSettings(db);
      const isSuperAdminCandidate = isConfiguredSuperAdmin(phoneE164, emailNormalized);
      if (!isSuperAdminCandidate) {
        if (authMethod === 'email' && !siteSettings.emailAuthEnabled) {
          res.status(403).json({
            ok: false,
            code: 'auth/method-disabled',
            error: 'ইমেইল লগইন বর্তমানে বন্ধ রাখা হয়েছে।',
          });
          return;
        }
        if (authMethod === 'phone' && !siteSettings.phoneAuthEnabled) {
          res.status(403).json({
            ok: false,
            code: 'auth/method-disabled',
            error: 'মোবাইল নম্বর লগইন বর্তমানে বন্ধ রাখা হয়েছে।',
          });
          return;
        }
      }

      const accountLimit = await checkAttemptLimit(db, limitKey, 5, 15 * 60 * 1000);
      if (accountLimit.blocked) {
        const mins = Math.max(1, Math.ceil(accountLimit.retryAfterSec / 60));
        res.status(429).json({
          ok: false,
          code: 'auth/too-many-requests',
          error:
            authMethod === 'email'
              ? `নিরাপত্তার জন্য এই ইমেইলে লগইন সাময়িকভাবে সীমিত করা হয়েছে। ${mins} মিনিট পর আবার চেষ্টা করুন।`
              : `নিরাপত্তার জন্য এই নম্বরে লগইন সাময়িকভাবে সীমিত করা হয়েছে। ${mins} মিনিট পর আবার চেষ্টা করুন।`,
        });
        return;
      }

      const userRow =
        authMethod === 'email' && emailNormalized
          ? await db.first<UserRow>('SELECT * FROM users WHERE email_normalized = ? LIMIT 1', [
              emailNormalized,
            ])
          : await db.first<UserRow>('SELECT * FROM users WHERE phone_e164 = ? LIMIT 1', [phoneE164]);

      const invalidCredMsg =
        authMethod === 'email'
          ? 'ইমেইল ঠিকানা অথবা পাসওয়ার্ড সঠিক নয়।'
          : 'মোবাইল নম্বর অথবা পাসওয়ার্ড সঠিক নয়।';

      if (!userRow) {
        await runDummyPasswordWork(password);
        await Promise.all([
          recordFailedAttempt(db, limitKey, 5, 15 * 60 * 1000, 15 * 60 * 1000),
          recordFailedAttempt(db, `login_ip:${ip}`, 25, 15 * 60 * 1000, 15 * 60 * 1000),
        ]);
        res.status(401).json({
          ok: false,
          code: 'auth/invalid-credential',
          error: invalidCredMsg,
        });
        return;
      }

      const passwordValid = await verifySecretPbkdf2(password, userRow.password_hash);
      if (!passwordValid) {
        await Promise.all([
          recordFailedAttempt(db, limitKey, 5, 15 * 60 * 1000, 15 * 60 * 1000),
          recordFailedAttempt(db, `login_ip:${ip}`, 25, 15 * 60 * 1000, 15 * 60 * 1000),
        ]);
        res.status(401).json({
          ok: false,
          code: 'auth/invalid-credential',
          error: invalidCredMsg,
        });
        return;
      }

      const effectiveRole = resolveUserRole(
        userRow.phone_e164,
        userRow.email_normalized || userRow.email,
        userRow.role
      );

      // Protect Super Admin from ever being locked out by suspended flag
      if (userRow.status === 'suspended' && effectiveRole !== 'super_admin') {
        res.status(403).json({
          ok: false,
          code: 'auth/user-disabled',
          error: 'আপনার অ্যাকাউন্টটি সাময়িকভাবে নিষ্ক্রিয় করা হয়েছে। অনুগ্রহ করে সাপোর্টে যোগাযোগ করুন।',
        });
        return;
      }

      const now = Date.now();
      const previousIp = String(userRow.last_login_ip || '');
      const nextStatus = effectiveRole === 'super_admin' ? 'active' : userRow.status;

      await db.run(
        'UPDATE users SET role = ?, status = ?, last_login_at = ?, last_login_ip = ?, updated_at = ? WHERE uid = ?',
        [effectiveRole, nextStatus, now, ip, now, userRow.uid]
      );
      userRow.role = effectiveRole;
      userRow.status = nextStatus;
      userRow.last_login_at = now;
      userRow.last_login_ip = ip;

      await clearAttemptLimit(db, limitKey);
      await ensureWalletAccount(db, userRow.uid);
      await createSessionForUser(db, userRow.uid, req, res);

      // Login security alert notification when logging in from a new IP or if alerts enabled
      if (siteSettings.loginAlertsEnabled && previousIp && previousIp !== ip) {
        await insertNotification(
          db,
          userRow.uid,
          'নতুন লগইন নিরাপত্তা সতর্কতা',
          'New Login Security Alert',
          `আপনার অ্যাকাউন্টে নতুন আইপি (${ip}) থেকে সফলভাবে লগইন হয়েছে। এটি আপনি না হলে দ্রুত পাসওয়ার্ড পরিবর্তন করুন।`,
          `New sign-in detected from IP ${ip}. If this wasn't you, change your password immediately.`,
          'system'
        ).catch(() => {});
      }

      res.json({
        ok: true,
        user: toClientAuthUser(userRow),
        profile: toClientUserProfile(userRow),
      });
    } catch (err) {
      handleRouteError(res, err, 'লগইন সম্পন্ন করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।');
    }
  });

  // =========================================================================
  // 3. CURRENT SESSION CHECK (GET /api/auth/me & POST /api/auth/session)
  // =========================================================================
  const handleGetSession = async (req: express.Request, res: express.Response) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.json({
          ok: true,
          authenticated: false,
          user: null,
          profile: null,
        });
        return;
      }
      const { user, rawRow } = resolved;
      res.json({
        ok: true,
        authenticated: true,
        uid: user.uid,
        phone: user.phone,
        email: user.email,
        authMethod: user.authMethod,
        role: user.role,
        adminRole: user.role,
        status: user.status,
        user: toClientAuthUser(rawRow),
        profile: toClientUserProfile(rawRow),
      });
    } catch (err) {
      if (err instanceof DatabaseNotConfiguredError) {
        res.status(503).json({ ok: false, authenticated: false, code: err.code, error: err.message });
        return;
      }
      res.json({ ok: true, authenticated: false, user: null, profile: null });
    }
  };

  router.get('/auth/me', handleGetSession);
  router.post('/auth/session', handleGetSession);

  // =========================================================================
  // 4. LOGOUT & LOGOUT ALL DEVICES
  // =========================================================================
  router.post('/auth/logout', async (req, res) => {
    try {
      const cookies = parseCookies(req.headers.cookie);
      const rawToken = (cookies[SESSION_COOKIE_NAME] || '').trim();
      if (rawToken) {
        const db = await getAppDatabase();
        const tokenHash = await sha256Hex(rawToken);
        await db.run('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
      }
      clearSessionCookie(req, res);
      res.json({ ok: true });
    } catch (err) {
      clearSessionCookie(req, res);
      handleRouteError(res, err, 'লগআউট সম্পন্ন করা যায়নি।');
    }
  });

  const handleLogoutAll = async (req: express.Request, res: express.Response) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        clearSessionCookie(req, res);
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const now = Date.now();
      await resolved.db.run('DELETE FROM sessions WHERE user_id = ?', [resolved.user.uid]);
      await resolved.db.run('UPDATE users SET session_revoked_at = ?, updated_at = ? WHERE uid = ?', [
        now,
        now,
        resolved.user.uid,
      ]);
      clearSessionCookie(req, res);
      res.json({ ok: true, revokedAt: now });
    } catch (err) {
      handleRouteError(res, err, 'সব ডিভাইস থেকে লগআউট করা যায়নি।');
    }
  };

  router.post('/auth/logout-all', handleLogoutAll);
  router.post('/account/logout-all', handleLogoutAll);

  // =========================================================================
  // 5. CHANGE PASSWORD & RECOVERY CODE MANAGEMENT & FORGOT PASSWORD RESET
  // =========================================================================
  router.post('/auth/change-password', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, code: 'auth/unauthenticated', error: 'অনুগ্রহ করে আগে লগইন করুন।' });
        return;
      }
      const body = (req.body || {}) as {
        currentPassword?: unknown;
        newPassword?: unknown;
        confirmPassword?: unknown;
      };
      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      const confirmPassword =
        typeof body.confirmPassword === 'string' ? body.confirmPassword : undefined;

      if (!currentPassword || newPassword.length < 6 || newPassword.length > 128) {
        res.status(400).json({
          ok: false,
          code: 'auth/weak-password',
          error: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।',
        });
        return;
      }
      if (confirmPassword !== undefined && newPassword !== confirmPassword) {
        res.status(400).json({
          ok: false,
          code: 'auth/password-mismatch',
          error: 'নতুন পাসওয়ার্ড দুটি মেলেনি।',
        });
        return;
      }

      const validCurrent = await verifySecretPbkdf2(currentPassword, resolved.rawRow.password_hash);
      if (!validCurrent) {
        res.status(401).json({
          ok: false,
          code: 'auth/wrong-password',
          error: 'বর্তমান পাসওয়ার্ড সঠিক নয়।',
        });
        return;
      }

      const newHash = await hashSecretPbkdf2(newPassword);
      const now = Date.now();
      await resolved.db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE uid = ?', [
        newHash,
        now,
        resolved.user.uid,
      ]);
      // Revoke all other active sessions for safety
      await resolved.db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', [
        resolved.user.uid,
        resolved.user.sessionId,
      ]);
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'পাসওয়ার্ড পরিবর্তন করা যায়নি।');
    }
  });

  router.post('/auth/recovery-code/regenerate', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, code: 'auth/unauthenticated', error: 'অনুগ্রহ করে আগে লগইন করুন।' });
        return;
      }
      const body = (req.body || {}) as { currentPassword?: unknown };
      const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
      const valid = await verifySecretPbkdf2(currentPassword, resolved.rawRow.password_hash);
      if (!valid) {
        res.status(401).json({
          ok: false,
          code: 'auth/wrong-password',
          error: 'সঠিক বর্তমান পাসওয়ার্ড দিন।',
        });
        return;
      }
      const recoveryCode = generateRecoveryCode();
      const recoveryHash = await hashSecretPbkdf2(normalizeRecoveryCodeInput(recoveryCode));
      await resolved.db.run('UPDATE users SET recovery_hash = ?, updated_at = ? WHERE uid = ?', [
        recoveryHash,
        Date.now(),
        resolved.user.uid,
      ]);
      res.json({ ok: true, recoveryCode });
    } catch (err) {
      handleRouteError(res, err, 'নতুন রিকভারি কোড তৈরি করা যায়নি।');
    }
  });

  router.post('/auth/forgot-password/reset', async (req, res) => {
    try {
      const db = await getAppDatabase();
      const ip = getClientIp(req);
      const ipLimit = await checkAttemptLimit(db, `reset_ip:${ip}`, 10, 15 * 60 * 1000);
      if (ipLimit.blocked) {
        const mins = Math.max(1, Math.ceil(ipLimit.retryAfterSec / 60));
        res.status(429).json({
          ok: false,
          code: 'auth/too-many-requests',
          error: `অনেকবার চেষ্টা করা হয়েছে। ${mins} মিনিট পর আবার চেষ্টা করুন।`,
        });
        return;
      }

      const body = (req.body || {}) as {
        authMethod?: unknown;
        phone?: unknown;
        email?: unknown;
        recoveryCode?: unknown;
        newPassword?: unknown;
        confirmPassword?: unknown;
      };
      const rawMethod = typeof body.authMethod === 'string' ? body.authMethod.trim().toLowerCase() : '';
      const hasRawPhone = typeof body.phone === 'string' && body.phone.trim().length > 0;
      const hasRawEmail = typeof body.email === 'string' && body.email.trim().length > 0;
      const authMethod: 'phone' | 'email' =
        rawMethod === 'email'
          ? 'email'
          : rawMethod === 'phone'
            ? 'phone'
            : !hasRawPhone && hasRawEmail
              ? 'email'
              : 'phone';

      const normalizedRecovery = normalizeRecoveryCodeInput(body.recoveryCode);
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      const confirmPassword =
        typeof body.confirmPassword === 'string' ? body.confirmPassword : undefined;

      let phoneE164: string | null = null;
      let emailNormalized: string | null = null;
      let resetLimitKey = '';
      let loginLimitKey = '';

      if (authMethod === 'email') {
        emailNormalized = normalizeEmailAddress(body.email);
        if (!emailNormalized) {
          res.status(400).json({
            ok: false,
            code: 'auth/invalid-email',
            error: 'সঠিক ইমেইল ঠিকানা লিখুন।',
          });
          return;
        }
        resetLimitKey = `reset_email:${emailNormalized}`;
        loginLimitKey = `login_email:${emailNormalized}`;
      } else {
        phoneE164 = normalizeBangladeshPhone(body.phone);
        if (!phoneE164) {
          res.status(400).json({
            ok: false,
            code: 'auth/invalid-phone-number',
            error: 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন।',
          });
          return;
        }
        resetLimitKey = `reset_phone:${phoneE164}`;
        loginLimitKey = `login_phone:${phoneE164}`;
      }

      if (normalizedRecovery.length < 8) {
        res.status(400).json({
          ok: false,
          code: 'auth/invalid-recovery-code',
          error: 'সঠিক ব্যাকআপ রিকভারি কোড লিখুন (যেমন: DH-XXXX-XXXX)।',
        });
        return;
      }
      if (newPassword.length < 6 || newPassword.length > 128) {
        res.status(400).json({
          ok: false,
          code: 'auth/weak-password',
          error: 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।',
        });
        return;
      }
      if (confirmPassword !== undefined && newPassword !== confirmPassword) {
        res.status(400).json({
          ok: false,
          code: 'auth/password-mismatch',
          error: 'নতুন পাসওয়ার্ড দুটি মেলেনি।',
        });
        return;
      }

      const accountLimit = await checkAttemptLimit(db, resetLimitKey, 5, 15 * 60 * 1000);
      if (accountLimit.blocked) {
        const mins = Math.max(1, Math.ceil(accountLimit.retryAfterSec / 60));
        res.status(429).json({
          ok: false,
          code: 'auth/too-many-requests',
          error: `অনেকবার ভুল রিকভারি কোড দেওয়া হয়েছে। ${mins} মিনিট পর আবার চেষ্টা করুন।`,
        });
        return;
      }

      const userRow =
        authMethod === 'email' && emailNormalized
          ? await db.first<UserRow>('SELECT * FROM users WHERE email_normalized = ? LIMIT 1', [
              emailNormalized,
            ])
          : await db.first<UserRow>('SELECT * FROM users WHERE phone_e164 = ? LIMIT 1', [phoneE164]);

      const invalidCodeMsg =
        authMethod === 'email'
          ? 'ইমেইল ঠিকানা অথবা ব্যাকআপ রিকভারি কোড সঠিক নয়।'
          : 'মোবাইল নম্বর অথবা ব্যাকআপ রিকভারি কোড সঠিক নয়।';

      if (!userRow) {
        await runDummyPasswordWork(normalizedRecovery);
        await Promise.all([
          recordFailedAttempt(db, resetLimitKey, 5, 15 * 60 * 1000, 15 * 60 * 1000),
          recordFailedAttempt(db, `reset_ip:${ip}`, 10, 15 * 60 * 1000, 15 * 60 * 1000),
        ]);
        res.status(401).json({
          ok: false,
          code: 'auth/invalid-recovery-code',
          error: invalidCodeMsg,
        });
        return;
      }

      const codeValid = await verifySecretPbkdf2(normalizedRecovery, userRow.recovery_hash);
      if (!codeValid) {
        await Promise.all([
          recordFailedAttempt(db, resetLimitKey, 5, 15 * 60 * 1000, 15 * 60 * 1000),
          recordFailedAttempt(db, `reset_ip:${ip}`, 10, 15 * 60 * 1000, 15 * 60 * 1000),
        ]);
        res.status(401).json({
          ok: false,
          code: 'auth/invalid-recovery-code',
          error: invalidCodeMsg,
        });
        return;
      }

      const nextRecoveryCode = generateRecoveryCode();
      const [newPasswordHash, nextRecoveryHash] = await Promise.all([
        hashSecretPbkdf2(newPassword),
        hashSecretPbkdf2(normalizeRecoveryCodeInput(nextRecoveryCode)),
      ]);
      const now = Date.now();

      await db.run(
        'UPDATE users SET password_hash = ?, recovery_hash = ?, session_revoked_at = ?, updated_at = ? WHERE uid = ?',
        [newPasswordHash, nextRecoveryHash, now, now, userRow.uid]
      );
      await db.run('DELETE FROM sessions WHERE user_id = ?', [userRow.uid]);
      await clearAttemptLimit(db, resetLimitKey);
      await clearAttemptLimit(db, loginLimitKey);

      res.json({
        ok: true,
        newRecoveryCode: nextRecoveryCode,
      });
    } catch (err) {
      handleRouteError(res, err, 'পাসওয়ার্ড রিসেট করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।');
    }
  });

  // =========================================================================
  // 6. CUSTOMER DASHBOARD & PROFILE ENDPOINTS
  // =========================================================================
  router.get('/me/dashboard', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user, rawRow } = resolved;
      const wallet = await ensureWalletAccount(db, user.uid);

      const [
        walletTxRows,
        orderRows,
        paymentRows,
        referralRows,
        notificationRows,
        ticketRows,
        withdrawalRows,
        rewardClaimRows,
        viewingSessionRows,
        adRewardTxRows,
        announcementRows,
      ] = await Promise.all([
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
          [user.uid]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200',
          [user.uid]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM payments WHERE customer_id = ? ORDER BY created_at DESC LIMIT 200',
          [user.uid]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM referrals WHERE referrer_uid = ? ORDER BY created_at DESC LIMIT 200',
          [user.uid]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
          [user.uid]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
          [user.uid]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
          [user.uid]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM rewarded_claims WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
          [user.uid]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM ad_viewing_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
          [user.uid]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM ad_reward_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
          [user.uid]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 50'
        ),
      ]);

      res.json({
        ok: true,
        user: toClientAuthUser(rawRow),
        profile: toClientUserProfile(rawRow),
        wallet,
        walletTxs: walletTxRows.map((r) => parseJsonSafe(r.payload_json, {})),
        orders: orderRows.map((r) => parseJsonSafe(r.payload_json, {})),
        payments: paymentRows.map((r) => parseJsonSafe(r.payload_json, {})),
        referrals: referralRows.map((r) => parseJsonSafe(r.payload_json, {})),
        notifications: notificationRows.map((r) => parseJsonSafe(r.payload_json, {})),
        tickets: ticketRows.map((r) => parseJsonSafe(r.payload_json, {})),
        withdrawals: withdrawalRows.map((r) => parseJsonSafe(r.payload_json, {})),
        rewardClaims: rewardClaimRows.map((r) => parseJsonSafe(r.payload_json, {})),
        viewingSessions: viewingSessionRows.map((r) => parseJsonSafe(r.payload_json, {})),
        adRewardTransactions: adRewardTxRows.map((r) => parseJsonSafe(r.payload_json, {})),
        announcements: announcementRows.map((r) => parseJsonSafe(r.payload_json, {})),
      });
    } catch (err) {
      handleRouteError(res, err, 'ড্যাশবোর্ড তথ্য লোড করা যায়নি।');
    }
  });

  router.patch('/me/profile', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user, rawRow } = resolved;
      const body = (req.body || {}) as {
        displayName?: unknown;
        phone?: unknown;
        email?: unknown;
        language?: unknown;
        photoUrl?: unknown;
      };

      const nextName =
        typeof body.displayName === 'string' && body.displayName.trim().length >= 2
          ? body.displayName.trim().slice(0, 120)
          : rawRow.display_name;
      const nextLanguage: 'bn' | 'en' =
        body.language === 'en' ? 'en' : body.language === 'bn' ? 'bn' : user.language;
      const nextPhotoUrl =
        typeof body.photoUrl === 'string' ? body.photoUrl.slice(0, 250000) : rawRow.photo_url;
      // Never auto-merge accounts: keep primary login email immutable for email accounts
      const nextEmail =
        resolveAuthMethod(rawRow) === 'email'
          ? (rawRow.email_normalized || rawRow.email || '')
          : typeof body.email === 'string'
            ? body.email.trim().toLowerCase().slice(0, 200)
            : rawRow.email;

      let nextPhone = rawRow.phone_e164;
      if (typeof body.phone === 'string' && body.phone.trim()) {
        const normalized = normalizeBangladeshPhone(body.phone);
        if (!normalized) {
          res.status(400).json({
            ok: false,
            code: 'auth/invalid-phone-number',
            error: 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন।',
          });
          return;
        }
        if (normalized !== extractPublicPhone(rawRow.phone_e164)) {
          const taken = await db.first<{ uid: string }>(
            'SELECT uid FROM users WHERE phone_e164 = ? AND uid != ? LIMIT 1',
            [normalized, user.uid]
          );
          if (taken) {
            res.status(409).json({
              ok: false,
              code: 'auth/phone-already-in-use',
              error: 'এই মোবাইল নম্বরটি অন্য অ্যাকাউন্টে ব্যবহৃত হচ্ছে।',
            });
            return;
          }
          nextPhone = normalized;
        }
      }

      const now = Date.now();
      await db.run(
        `UPDATE users
         SET display_name = ?, phone_e164 = ?, email = ?, language = ?, photo_url = ?, updated_at = ?
         WHERE uid = ?`,
        [nextName, nextPhone, nextEmail, nextLanguage, nextPhotoUrl, now, user.uid]
      );

      const updated = await db.first<UserRow>('SELECT * FROM users WHERE uid = ?', [user.uid]);
      res.json({
        ok: true,
        user: updated ? toClientAuthUser(updated) : toClientAuthUser(rawRow),
        profile: updated ? toClientUserProfile(updated) : toClientUserProfile(rawRow),
      });
    } catch (err) {
      handleRouteError(res, err, 'প্রোফাইল আপডেট করা যায়নি।');
    }
  });

  // =========================================================================
  // 7. ORDERS, PAYMENTS, WALLET, WITHDRAWALS, TICKETS, REVIEWS, REFERRALS
  // =========================================================================
  router.post('/payments/validate-txid', async (req, res) => {
    try {
      const db = await getAppDatabase();
      const body = (req.body || {}) as { transactionId?: unknown };
      const rawTxId = typeof body.transactionId === 'string' ? body.transactionId.trim() : '';
      const txKey = normalizeTxIdKey(rawTxId);
      if (txKey.length < 4 || txKey.length > 80) {
        res.status(400).json({
          ok: false,
          duplicate: false,
          error: 'সঠিক ট্রানজেকশন আইডি (কমপক্ষে ৪ অক্ষর) লিখুন।',
        });
        return;
      }
      const exists = await db.first<{ tx_key: string }>(
        'SELECT tx_key FROM used_transaction_ids WHERE tx_key = ? LIMIT 1',
        [txKey]
      );
      if (exists) {
        res.status(409).json({
          ok: false,
          duplicate: true,
          error: 'এই ট্রানজেকশন আইডিটি আগে ব্যবহৃত হয়েছে। সঠিক নতুন ট্রানজেকশন আইডি দিন।',
        });
        return;
      }
      res.json({ ok: true, duplicate: false });
    } catch (err) {
      handleRouteError(res, err, 'ট্রানজেকশন আইডি যাচাই করা যায়নি।');
    }
  });

  router.post('/orders/manual', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'অর্ডার করতে আগে লগইন করুন।' });
        return;
      }
      const { db, user } = resolved;
      const body = (req.body || {}) as {
        productId?: string;
        productTitleBn?: string;
        productTitleEn?: string;
        selectedPackageName?: string;
        itemsSummary?: string;
        quantity?: number;
        couponCode?: string;
        discountBdt?: number;
        totalPriceBdt?: number;
        paymentMethod?: 'bkash' | 'nagad' | 'rocket';
        receiverNumber?: string;
        senderNumber?: string;
        transactionId?: string;
        deliveryNote?: string;
        referenceAttachmentUrl?: string;
        receiptDataUrl?: string;
      };

      const totalPriceBdt = Number(body.totalPriceBdt || 0);
      const quantity = Math.max(1, Math.min(100, Math.round(Number(body.quantity || 1))));
      const method =
        body.paymentMethod === 'nagad' || body.paymentMethod === 'rocket'
          ? body.paymentMethod
          : 'bkash';
      const senderNumber = String(body.senderNumber || '').trim().slice(0, 30);
      const transactionId = String(body.transactionId || '').trim().slice(0, 80);
      const txKey = normalizeTxIdKey(transactionId);

      if (!Number.isFinite(totalPriceBdt) || totalPriceBdt <= 0 || totalPriceBdt > 1000000) {
        res.status(400).json({ ok: false, error: 'সঠিক অর্ডার মূল্য পাওয়া যায়নি।' });
        return;
      }
      if (senderNumber.length < 8) {
        res.status(400).json({ ok: false, error: 'সঠিক প্রেরক (Sender) মোবাইল নম্বর দিন।' });
        return;
      }
      if (txKey.length < 4) {
        res.status(400).json({ ok: false, error: 'সঠিক ট্রানজেকশন আইডি (TrxID) লিখুন।' });
        return;
      }

      const dup = await db.first<{ tx_key: string }>(
        'SELECT tx_key FROM used_transaction_ids WHERE tx_key = ? LIMIT 1',
        [txKey]
      );
      if (dup) {
        res.status(409).json({
          ok: false,
          error: 'এই ট্রানজেকশন আইডিটি আগে ব্যবহৃত হয়েছে। অনুগ্রহ করে সঠিক নতুন TrxID দিন।',
        });
        return;
      }

      const now = Date.now();
      const orderId = generateSecureId('ord', 8);
      const paymentId = generateSecureId('pay', 8);
      const orderNumber = `DH-${String(now).slice(-6)}${Math.floor(10 + Math.random() * 89)}`;

      const orderObj = {
        id: orderId,
        orderNumber,
        customerId: user.uid,
        customerEmail: getUserPrimaryIdentifier(user),
        customerName: user.displayName,
        productId: String(body.productId || 'custom').slice(0, 128),
        productTitleBn: String(body.productTitleBn || '').slice(0, 200),
        productTitleEn: String(body.productTitleEn || '').slice(0, 200),
        selectedPackageName: String(body.selectedPackageName || '').slice(0, 120),
        itemsSummary: String(body.itemsSummary || '').slice(0, 500),
        quantity,
        couponCode: String(body.couponCode || '').slice(0, 40),
        discountBdt: Math.max(0, Number(body.discountBdt || 0)),
        totalPriceBdt,
        paymentMethod: method,
        transactionId,
        senderNumber,
        deliveryNote: String(body.deliveryNote || '').slice(0, 1500),
        referenceAttachmentUrl: String(body.referenceAttachmentUrl || '').slice(0, 400000),
        status: 'Verification Pending',
        createdAt: now,
        updatedAt: now,
      };

      const paymentObj = {
        id: paymentId,
        orderId,
        orderNumber,
        customerId: user.uid,
        purpose: 'order',
        method,
        receiverNumber: String(body.receiverNumber || '').slice(0, 30),
        senderNumber,
        transactionId,
        amountBdt: totalPriceBdt,
        receiptDataUrl: String(body.receiptDataUrl || '').slice(0, 400000),
        status: 'Verification Pending',
        createdAt: now,
        updatedAt: now,
      };

      await db.run(
        'INSERT INTO used_transaction_ids (tx_key, kind, ref_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)',
        [txKey, 'order', orderId, user.uid, now]
      );
      await db.run(
        'INSERT INTO orders (id, order_number, customer_id, status, transaction_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [orderId, orderNumber, user.uid, orderObj.status, transactionId, JSON.stringify(orderObj), now, now]
      );
      await db.run(
        'INSERT INTO payments (id, order_id, customer_id, transaction_id, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [paymentId, orderId, user.uid, transactionId, paymentObj.status, JSON.stringify(paymentObj), now, now]
      );

      await insertNotification(
        db,
        user.uid,
        'নতুন অর্ডার জমা হয়েছে',
        'Order Submitted',
        `অর্ডার #${orderNumber} (৳${totalPriceBdt}) পেমেন্ট যাচাইয়ের জন্য জমা হয়েছে।`,
        `Order #${orderNumber} (৳${totalPriceBdt}) submitted for payment verification.`,
        'order'
      );

      res.status(201).json({ ok: true, orderId, orderNumber, paymentId });
    } catch (err) {
      handleRouteError(res, err, 'অর্ডার জমা দেওয়া যায়নি।');
    }
  });

  router.post('/orders/wallet', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'অর্ডার করতে আগে লগইন করুন।' });
        return;
      }
      const { db, user } = resolved;
      const body = (req.body || {}) as {
        productId?: string;
        productTitleBn?: string;
        productTitleEn?: string;
        selectedPackageName?: string;
        itemsSummary?: string;
        quantity?: number;
        couponCode?: string;
        discountBdt?: number;
        totalPriceBdt?: number;
        deliveryNote?: string;
        referenceAttachmentUrl?: string;
      };

      const totalPriceBdt = Number(body.totalPriceBdt || 0);
      const quantity = Math.max(1, Math.min(100, Math.round(Number(body.quantity || 1))));
      if (!Number.isFinite(totalPriceBdt) || totalPriceBdt <= 0 || totalPriceBdt > 1000000) {
        res.status(400).json({ ok: false, error: 'সঠিক অর্ডার মূল্য পাওয়া যায়নি।' });
        return;
      }

      const wallet = await ensureWalletAccount(db, user.uid);
      if (wallet.availableBalanceBdt < totalPriceBdt) {
        res.status(400).json({
          ok: false,
          error: 'আপনার ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই। অনুগ্রহ করে অ্যাড মানি করুন।',
        });
        return;
      }

      const now = Date.now();
      const orderId = generateSecureId('ord', 8);
      const txId = generateSecureId('wtx', 8);
      const orderNumber = `DH-${String(now).slice(-6)}${Math.floor(10 + Math.random() * 89)}`;

      // Conditional update ensures atomic non-negative wallet deduction
      const deduct = await db.run(
        `UPDATE wallet_accounts
         SET available_balance_bdt = available_balance_bdt - ?,
             total_spent_bdt = total_spent_bdt + ?,
             last_tx_id = ?,
             updated_at = ?
         WHERE uid = ? AND available_balance_bdt >= ?`,
        [totalPriceBdt, totalPriceBdt, txId, now, user.uid, totalPriceBdt]
      );
      if (deduct.changes === 0) {
        res.status(409).json({
          ok: false,
          error: 'আপনার ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই।',
        });
        return;
      }

      const orderObj = {
        id: orderId,
        orderNumber,
        customerId: user.uid,
        customerEmail: getUserPrimaryIdentifier(user),
        customerName: user.displayName,
        productId: String(body.productId || 'custom').slice(0, 128),
        productTitleBn: String(body.productTitleBn || '').slice(0, 200),
        productTitleEn: String(body.productTitleEn || '').slice(0, 200),
        selectedPackageName: String(body.selectedPackageName || '').slice(0, 120),
        itemsSummary: String(body.itemsSummary || '').slice(0, 500),
        quantity,
        couponCode: String(body.couponCode || '').slice(0, 40),
        discountBdt: Math.max(0, Number(body.discountBdt || 0)),
        totalPriceBdt,
        paymentMethod: 'wallet',
        transactionId: `WALLET-${orderNumber}`,
        senderNumber: getUserPrimaryIdentifier(user),
        deliveryNote: String(body.deliveryNote || '').slice(0, 1500),
        referenceAttachmentUrl: String(body.referenceAttachmentUrl || '').slice(0, 400000),
        status: 'Processing',
        createdAt: now,
        updatedAt: now,
      };

      const wtxObj = {
        id: txId,
        userId: user.uid,
        userEmail: getUserPrimaryIdentifier(user),
        type: 'purchase',
        method: 'wallet',
        transactionId: orderObj.transactionId,
        amountBdt: totalPriceBdt,
        status: 'Approved',
        note: `Wallet payment for order #${orderNumber}`,
        relatedOrderId: orderId,
        createdAt: now,
        updatedAt: now,
      };

      await db.run(
        'INSERT INTO orders (id, order_number, customer_id, status, transaction_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [orderId, orderNumber, user.uid, orderObj.status, orderObj.transactionId, JSON.stringify(orderObj), now, now]
      );
      await db.run(
        'INSERT INTO wallet_transactions (id, user_id, type, amount_bdt, status, transaction_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [txId, user.uid, 'purchase', totalPriceBdt, 'Approved', orderObj.transactionId, JSON.stringify(wtxObj), now, now]
      );

      await insertNotification(
        db,
        user.uid,
        'ওয়ালেট অর্ডার নিশ্চিত হয়েছে',
        'Wallet Order Confirmed',
        `অর্ডার #${orderNumber} (৳${totalPriceBdt}) ওয়ালেট ব্যালেন্স থেকে পরিশোধিত হয়েছে।`,
        `Order #${orderNumber} (৳${totalPriceBdt}) paid instantly from wallet balance.`,
        'order'
      );

      res.status(201).json({ ok: true, orderId, orderNumber });
    } catch (err) {
      handleRouteError(res, err, 'ওয়ালেট পেমেন্ট সম্পন্ন করা যায়নি।');
    }
  });

  router.post('/orders/:id/cancel', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const orderId = String(req.params.id || '').trim();
      const row = await db.first<{ customer_id: string; status: string; payload_json: string }>(
        'SELECT customer_id, status, payload_json FROM orders WHERE id = ?',
        [orderId]
      );
      if (!row || row.customer_id !== user.uid) {
        res.status(404).json({ ok: false, error: 'অর্ডার পাওয়া যায়নি।' });
        return;
      }
      if (row.status !== 'Pending Payment' && row.status !== 'Verification Pending') {
        res.status(400).json({ ok: false, error: 'এই অর্ডারটি আর বাতিল করা সম্ভব নয়।' });
        return;
      }
      const now = Date.now();
      const updated = {
        ...parseJsonSafe<Record<string, unknown>>(row.payload_json, {}),
        status: 'Cancelled',
        updatedAt: now,
      };
      await db.run('UPDATE orders SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?', [
        'Cancelled',
        JSON.stringify(updated),
        now,
        orderId,
      ]);
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'অর্ডার বাতিল করা যায়নি।');
    }
  });

  router.post('/wallet/deposit', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'অ্যাড মানি করতে আগে লগইন করুন।' });
        return;
      }
      const { db, user } = resolved;
      const body = (req.body || {}) as {
        amountBdt?: number;
        method?: string;
        receiverNumber?: string;
        senderNumber?: string;
        transactionId?: string;
        receiptDataUrl?: string;
      };
      const amountBdt = Number(body.amountBdt || 0);
      const rawMethod = String(body.method || 'bkash').trim().toLowerCase().slice(0, 40);
      const pmRow = await db.first<PaymentMethodRow>(
        'SELECT * FROM payment_methods WHERE code = ? AND enabled = 1 AND supports_deposit = 1 LIMIT 1',
        [rawMethod]
      );
      const method = pmRow
        ? pmRow.code
        : rawMethod === 'nagad' || rawMethod === 'rocket'
          ? rawMethod
          : 'bkash';
      const senderNumber = String(body.senderNumber || '').trim().slice(0, 60);
      const transactionId = String(body.transactionId || '').trim().slice(0, 80);
      const txKey = normalizeTxIdKey(transactionId);

      const minDep = Math.max(10, Number(pmRow?.min_amount ?? 10) || 10);
      const maxDep = Math.max(minDep, Number(pmRow?.max_amount ?? 500000) || 500000);
      if (!Number.isFinite(amountBdt) || amountBdt < minDep || amountBdt > maxDep) {
        res.status(400).json({ ok: false, error: `সঠিক টাকার পরিমাণ লিখুন (৳${minDep} – ৳${maxDep})।` });
        return;
      }
      if (senderNumber.length < 4 || txKey.length < 4) {
        res.status(400).json({ ok: false, error: 'সঠিক প্রেরক নম্বর ও ট্রানজেকশন আইডি দিন।' });
        return;
      }

      const dup = await db.first<{ tx_key: string }>(
        'SELECT tx_key FROM used_transaction_ids WHERE tx_key = ? LIMIT 1',
        [txKey]
      );
      if (dup) {
        res.status(409).json({
          ok: false,
          error: 'এই ট্রানজেকশন আইডিটি আগে ব্যবহৃত হয়েছে।',
        });
        return;
      }

      const now = Date.now();
      const txId = generateSecureId('dep', 8);
      const paymentId = generateSecureId('pay', 8);
      const wtxObj = {
        id: txId,
        userId: user.uid,
        type: 'deposit',
        amountBdt,
        method,
        senderNumber,
        transactionId,
        receiptDataUrl: String(body.receiptDataUrl || '').slice(0, 400000),
        status: 'Verification Pending',
        note: `Add Money via ${method.toUpperCase()}`,
        createdAt: now,
        updatedAt: now,
      };
      const paymentObj = {
        id: paymentId,
        orderId: txId,
        orderNumber: txId.toUpperCase(),
        customerId: user.uid,
        purpose: 'add_money',
        method,
        receiverNumber: String(body.receiverNumber || '').slice(0, 30),
        senderNumber,
        transactionId,
        amountBdt,
        receiptDataUrl: String(body.receiptDataUrl || '').slice(0, 400000),
        status: 'Verification Pending',
        createdAt: now,
        updatedAt: now,
      };

      await db.run(
        'INSERT INTO used_transaction_ids (tx_key, kind, ref_id, user_id, created_at) VALUES (?, ?, ?, ?, ?)',
        [txKey, 'deposit', txId, user.uid, now]
      );
      await db.run(
        'INSERT INTO wallet_transactions (id, user_id, type, amount_bdt, status, transaction_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [txId, user.uid, 'deposit', amountBdt, 'Verification Pending', transactionId, JSON.stringify(wtxObj), now, now]
      );
      await db.run(
        'INSERT INTO payments (id, order_id, customer_id, transaction_id, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [paymentId, txId, user.uid, transactionId, 'Verification Pending', JSON.stringify(paymentObj), now, now]
      );

      await insertNotification(
        db,
        user.uid,
        'অ্যাড মানি অনুরোধ জমা হয়েছে',
        'Add Money Request Submitted',
        `৳${amountBdt} অ্যাড মানি অনুরোধ (${method.toUpperCase()}) যাচাইয়ের জন্য জমা হয়েছে।`,
        `Your ৳${amountBdt} Add Money request (${method.toUpperCase()}) is pending verification.`,
        'wallet'
      );

      res.status(201).json({ ok: true, id: txId });
    } catch (err) {
      handleRouteError(res, err, 'অ্যাড মানি অনুরোধ জমা দেওয়া যায়নি।');
    }
  });

  router.post('/wallet/withdraw', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const siteSettings = await getGlobalSiteSettings(db);
      if (siteSettings.maintenanceMode && user.role === 'user') {
        res.status(503).json({ ok: false, error: 'ওয়েবসাইট বর্তমানে মেইনটেন্যান্স মোডে আছে।' });
        return;
      }
      if (!siteSettings.withdrawalsEnabled) {
        res.status(403).json({ ok: false, error: 'উত্তোলন সুবিধা বর্তমানে সাময়িকভাবে বন্ধ আছে।' });
        return;
      }

      const body = (req.body || {}) as {
        amountBdt?: number;
        method?: string;
        accountNumber?: string;
        accountHolderName?: string;
      };
      const amountBdt = Math.round(Number(body.amountBdt || 0) * 100) / 100;
      const methodCode = String(body.method || 'bkash')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '')
        .slice(0, 40);
      const accountNumber = String(body.accountNumber || '').trim().slice(0, 120);
      const accountHolderName = String(body.accountHolderName || '').trim().slice(0, 120);

      const pmRow = await db.first<PaymentMethodRow>(
        'SELECT * FROM payment_methods WHERE code = ? AND enabled = 1 AND supports_withdrawal = 1 LIMIT 1',
        [methodCode]
      );
      if (!pmRow) {
        res.status(400).json({
          ok: false,
          error: 'নির্বাচিত পেমেন্ট মাধ্যমটি বর্তমানে উত্তোলনের জন্য সক্রিয় নেই।',
        });
        return;
      }

      const minAllowed = Math.max(siteSettings.minWithdrawalBdt, Number(pmRow.min_amount || 0));
      const maxAllowed = Math.max(minAllowed, Number(pmRow.max_amount || 250000));
      if (!Number.isFinite(amountBdt) || amountBdt < minAllowed || amountBdt > maxAllowed) {
        res.status(400).json({
          ok: false,
          error: `${pmRow.name}-এর মাধ্যমে সর্বনিম্ন ৳${minAllowed} থেকে সর্বোচ্চ ৳${maxAllowed} উত্তোলন করতে পারবেন।`,
        });
        return;
      }
      if (accountNumber.length < 6) {
        res.status(400).json({
          ok: false,
          error: `${pmRow.name}-এর জন্য সঠিক অ্যাকাউন্ট / মোবাইল নম্বর দিন।`,
        });
        return;
      }

      const now = Date.now();

      // Anti-duplicate request guard (prevent double-clicks / duplicate pending spam)
      const recentPending = await db.all<{ payload_json: string; created_at: number }>(
        `SELECT payload_json, created_at FROM withdrawals WHERE user_id = ? AND status = 'Pending' ORDER BY created_at DESC LIMIT 10`,
        [user.uid]
      );
      if (recentPending.length >= 3) {
        res.status(429).json({
          ok: false,
          error: 'আপনার ইতিমধ্যে ৩টি উত্তোলন অনুরোধ অপেক্ষমাণ আছে। অনুগ্রহ করে প্রসেস হওয়ার পর আবার চেষ্টা করুন।',
        });
        return;
      }
      for (const rp of recentPending) {
        const parsed = parseJsonSafe<Record<string, unknown>>(rp.payload_json, {});
        if (
          now - Number(rp.created_at || 0) < 30_000 &&
          Number(parsed.amountBdt) === amountBdt &&
          String(parsed.method || '') === methodCode &&
          String(parsed.accountNumber || '') === accountNumber
        ) {
          res.status(409).json({
            ok: false,
            error: 'একই উত্তোলন অনুরোধ মাত্র জমা হয়েছে। ডুপ্লিকেট অনুরোধ রোধ করা হয়েছে।',
          });
          return;
        }
      }

      const id = generateSecureId('wdr', 8);
      const txId = generateSecureId('wtx', 8);

      // Atomic deduction guarantees no negative balance and no race-condition double spend
      const deduct = await db.run(
        `UPDATE wallet_accounts
         SET available_balance_bdt = available_balance_bdt - ?,
             last_tx_id = ?,
             updated_at = ?
         WHERE uid = ? AND available_balance_bdt >= ?`,
        [amountBdt, txId, now, user.uid, amountBdt]
      );
      if (deduct.changes === 0) {
        res.status(400).json({ ok: false, error: 'ওয়ালেটে পর্যাপ্ত ব্যালেন্স নেই।' });
        return;
      }

      const wdrObj = {
        id,
        walletTxId: txId,
        userId: user.uid,
        userEmail: getUserPrimaryIdentifier(user),
        userName: user.displayName,
        amountBdt,
        method: methodCode,
        methodName: pmRow.name,
        accountNumber,
        accountHolderName,
        status: 'Pending',
        createdAt: now,
        updatedAt: now,
      };
      const wtxObj = {
        id: txId,
        userId: user.uid,
        userEmail: getUserPrimaryIdentifier(user),
        type: 'withdrawal',
        amountBdt,
        method: methodCode,
        senderNumber: accountNumber,
        transactionId: id,
        status: 'Verification Pending',
        note: `Withdrawal request via ${pmRow.name} (${accountNumber})`,
        createdAt: now,
        updatedAt: now,
      };

      await db.run(
        'INSERT INTO withdrawals (id, user_id, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, user.uid, 'Pending', JSON.stringify(wdrObj), now, now]
      );
      await db.run(
        'INSERT INTO wallet_transactions (id, user_id, type, amount_bdt, status, transaction_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [txId, user.uid, 'withdrawal', amountBdt, 'Verification Pending', id, JSON.stringify(wtxObj), now, now]
      );

      await insertNotification(
        db,
        user.uid,
        'উত্তোলন অনুরোধ জমা হয়েছে',
        'Withdrawal Request Submitted',
        `${pmRow.name} (${accountNumber})-এ ৳${amountBdt} উত্তোলনের অনুরোধ জমা হয়েছে।`,
        `Your ৳${amountBdt} withdrawal request via ${pmRow.name} (${accountNumber}) is pending review.`,
        'wallet'
      );

      res.status(201).json({ ok: true, id, walletTxId: txId, status: 'Pending' });
    } catch (err) {
      handleRouteError(res, err, 'উত্তোলন অনুরোধ জমা দেওয়া যায়নি।');
    }
  });

  router.post('/tickets', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const body = (req.body || {}) as { subject?: string; message?: string; orderNumber?: string };
      const subject = String(body.subject || '').trim().slice(0, 160);
      const message = String(body.message || '').trim().slice(0, 2000);
      const orderNumber = String(body.orderNumber || '').trim().slice(0, 60);
      if (subject.length < 2 || message.length < 3) {
        res.status(400).json({ ok: false, error: 'বিষয় এবং বিস্তারিত বার্তা লিখুন।' });
        return;
      }
      const now = Date.now();
      const id = generateSecureId('tkt', 8);
      const payload = {
        id,
        userId: user.uid,
        userEmail: getUserPrimaryIdentifier(user),
        subject,
        message,
        orderNumber,
        status: 'open',
        createdAt: now,
        updatedAt: now,
      };
      await db.run(
        'INSERT INTO support_tickets (id, user_id, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, user.uid, 'open', JSON.stringify(payload), now, now]
      );
      res.status(201).json({ ok: true, id });
    } catch (err) {
      handleRouteError(res, err, 'সাপোর্ট টিকেট জমা দেওয়া যায়নি।');
    }
  });

  router.post('/reviews', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const body = (req.body || {}) as {
        productId?: string;
        orderId?: string;
        rating?: number;
        comment?: string;
      };
      const rating = Math.max(1, Math.min(5, Math.round(Number(body.rating || 5))));
      const comment = String(body.comment || '').trim().slice(0, 1000);
      if (comment.length < 2) {
        res.status(400).json({ ok: false, error: 'অনুগ্রহ করে আপনার মতামত লিখুন।' });
        return;
      }
      const now = Date.now();
      const id = generateSecureId('rev', 8);
      const payload = {
        id,
        productId: String(body.productId || '').slice(0, 128),
        orderId: String(body.orderId || '').slice(0, 128),
        userId: user.uid,
        authorName: user.displayName,
        rating,
        comment,
        approved: false,
        createdAt: now,
      };
      await db.run(
        'INSERT INTO reviews (id, product_id, user_id, approved, payload_json, created_at) VALUES (?, ?, ?, 0, ?, ?)',
        [id, payload.productId, user.uid, JSON.stringify(payload), now]
      );
      res.status(201).json({ ok: true, id });
    } catch (err) {
      handleRouteError(res, err, 'রিভিউ জমা দেওয়া যায়নি।');
    }
  });

  router.post('/notifications/:id/read', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const id = String(req.params.id || '').trim();
      const row = await db.first<{ user_id: string; payload_json: string }>(
        'SELECT user_id, payload_json FROM notifications WHERE id = ?',
        [id]
      );
      if (!row || row.user_id !== user.uid) {
        res.status(404).json({ ok: false, error: 'Notification not found' });
        return;
      }
      const updated = { ...parseJsonSafe<Record<string, unknown>>(row.payload_json, {}), read: true };
      await db.run('UPDATE notifications SET is_read = 1, payload_json = ? WHERE id = ?', [
        JSON.stringify(updated),
        id,
      ]);
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to update notification.');
    }
  });

  router.post('/account/deletion-request', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const body = (req.body || {}) as { reason?: string };
      const now = Date.now();
      const id = generateSecureId('del', 8);
      const payload = {
        id,
        userId: user.uid,
        userEmail: getUserPrimaryIdentifier(user),
        reason: String(body.reason || '').trim().slice(0, 500),
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      await db.run(
        'INSERT INTO deletion_requests (id, user_id, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, user.uid, 'pending', JSON.stringify(payload), now, now]
      );
      res.status(201).json({ ok: true, requestId: id });
    } catch (err) {
      handleRouteError(res, err, 'অনুরোধ জমা দেওয়া যায়নি।');
    }
  });

  router.post('/referrals/register', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const siteSettings = await getGlobalSiteSettings(db);
      if (!siteSettings.referralEnabled) {
        res.json({ ok: true, registered: false, reason: 'Referral program is disabled.' });
        return;
      }
      const body = (req.body || {}) as { referralCode?: string };
      const code = String(body.referralCode || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9_-]/g, '')
        .slice(0, 24);
      if (!code || code === user.referralCode) {
        res.json({ ok: true, registered: false });
        return;
      }
      const existing = await db.first<{ id: string }>(
        'SELECT id FROM referrals WHERE referred_uid = ? LIMIT 1',
        [user.uid]
      );
      if (existing) {
        res.json({ ok: true, registered: false });
        return;
      }
      const owner = await db.first<{ uid: string; referral_code: string; last_login_ip?: string }>(
        'SELECT uid, referral_code, last_login_ip FROM users WHERE referral_code = ? LIMIT 1',
        [code]
      );
      if (!owner || owner.uid === user.uid) {
        res.json({ ok: true, registered: false });
        return;
      }
      const now = Date.now();
      const ip = getClientIp(req);
      const suspiciousFlag = Boolean(
        ip && ip !== 'unknown' && ip !== '127.0.0.1' && ip !== '::1' && owner.last_login_ip === ip
      );
      const status = suspiciousFlag ? 'flagged' : 'pending';
      const refId = generateSecureId('ref', 8);
      const payload = {
        id: refId,
        referrerId: owner.uid,
        referredUserId: user.uid,
        referredEmail: getUserPrimaryIdentifier(user),
        referralCode: owner.referral_code,
        rewardAmountBdt: siteSettings.referralBonusBdt,
        invitedRewardBdt: siteSettings.invitedUserRewardBdt,
        eligibilityRule: siteSettings.referralEligibility,
        suspiciousFlag,
        suspiciousReason: suspiciousFlag ? `Matching IP (${ip})` : '',
        status,
        createdAt: now,
        updatedAt: now,
      };
      await db.run(
        'INSERT OR IGNORE INTO referrals (id, referrer_uid, referred_uid, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [refId, owner.uid, user.uid, status, JSON.stringify(payload), now]
      );
      await db.run('UPDATE users SET referred_by = ?, updated_at = ? WHERE uid = ? AND referred_by = ""', [
        owner.referral_code,
        now,
        user.uid,
      ]);
      res.json({ ok: true, registered: true, referralId: refId, status });
    } catch (err) {
      handleRouteError(res, err, 'Referral registration failed.');
    }
  });

  // =========================================================================
  // 8. WATCH & EARN AND REWARDED ADS (Cookie-authenticated, DB-backed)
  // =========================================================================
  router.post('/rewards/claim', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const body = (req.body || {}) as { networkId?: string; networkName?: string };
      const networkId = String(body.networkId || '').trim().slice(0, 80);
      if (!networkId) {
        res.status(400).json({ ok: false, error: 'অ্যাড নেটওয়ার্ক নির্বাচন করুন।' });
        return;
      }
      const now = Date.now();
      const claimDate = new Date(now).toISOString().slice(0, 10);
      const id = generateSecureId('rcl', 8);
      const amountBdt = 2;
      const payload = {
        id,
        userId: user.uid,
        userEmail: getUserPrimaryIdentifier(user),
        networkId,
        networkName: String(body.networkName || networkId).slice(0, 120),
        amountBdt,
        claimDate,
        status: 'Pending Credit',
        createdAt: now,
        updatedAt: now,
      };
      await db.run(
        'INSERT INTO rewarded_claims (id, user_id, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, user.uid, 'Pending Credit', JSON.stringify(payload), now]
      );
      res.status(201).json({
        ok: true,
        id,
        claimId: id,
        amountBdt,
        dailyCount: 1,
        dailyLimit: 5,
        status: 'Pending Credit',
      });
    } catch (err) {
      handleRouteError(res, err, 'রিওয়ার্ড ক্লেইম জমা দেওয়া যায়নি।');
    }
  });

  router.get('/watch-earn/summary', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const bal = await db.first<{
        coins_available: number;
        coins_lifetime_earned: number;
        coins_redeemed: number;
      }>('SELECT * FROM watch_earn_balances WHERE user_id = ?', [user.uid]);

      const creditedRows = await db.all<{ payload_json: string }>(
        `SELECT payload_json FROM ad_viewing_sessions WHERE user_id = ? AND status = 'Credited' ORDER BY updated_at DESC LIMIT 50`,
        [user.uid]
      );

      res.json({
        ok: true,
        coinsAvailable: Number(bal?.coins_available || 0),
        coinsLifetimeEarned: Number(bal?.coins_lifetime_earned || 0),
        coinsRedeemed: Number(bal?.coins_redeemed || 0),
        creditedSessions: creditedRows.map((r) => {
          const obj = parseJsonSafe<Record<string, unknown>>(r.payload_json, {});
          return {
            sessionId: String(obj.id || ''),
            provider: String(obj.provider || ''),
            providerEventId: String(obj.providerEventId || ''),
            coins: Number(obj.coinsAwarded || 0),
            creditedAt: String(obj.creditedAt || ''),
          };
        }),
      });
    } catch (err) {
      handleRouteError(res, err, 'Watch & Earn তথ্য লোড করা যায়নি।');
    }
  });

  router.post('/watch-earn/session/start', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const body = (req.body || {}) as { unitId?: string; provider?: string; launchUrl?: string };
      const unitId = String(body.unitId || '').trim().slice(0, 80);
      const provider = String(body.provider || 'partner').trim().slice(0, 60);
      const launchUrl = String(body.launchUrl || '').trim().slice(0, 600);
      if (!unitId) {
        res.status(400).json({ ok: false, error: 'সঠিক অ্যাড ইউনিট নির্বাচন করুন।' });
        return;
      }
      const now = Date.now();
      const sessionId = generateSecureId('wsess', 8);
      const sessionToken = generateSecureId('wtok', 12);
      const payload = {
        id: sessionId,
        userId: user.uid,
        userEmail: getUserPrimaryIdentifier(user),
        unitId,
        provider,
        sessionToken,
        launchUrl,
        status: 'Pending',
        coinsAwarded: 0,
        createdAt: now,
        updatedAt: now,
      };
      await db.run(
        'INSERT INTO ad_viewing_sessions (id, user_id, session_token, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [sessionId, user.uid, sessionToken, 'Pending', JSON.stringify(payload), now, now]
      );
      res.status(201).json({
        ok: true,
        sessionId,
        sessionToken,
        unitId,
        provider,
        launchUrl,
        status: 'Pending',
        message: 'বিজ্ঞাপন সেশন শুরু হয়েছে। বিজ্ঞাপন সম্পূর্ণ দেখে ভেরিফাই করুন।',
      });
    } catch (err) {
      handleRouteError(res, err, 'সেশন শুরু করা যায়নি।');
    }
  });

  router.post('/watch-earn/session/verify', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const body = (req.body || {}) as { sessionId?: string };
      const sessionId = String(body.sessionId || '').trim();
      const row = await db.first<{ user_id: string; status: string; payload_json: string }>(
        'SELECT user_id, status, payload_json FROM ad_viewing_sessions WHERE id = ?',
        [sessionId]
      );
      if (!row || row.user_id !== user.uid) {
        res.status(404).json({ ok: false, error: 'সেশন পাওয়া যায়নি।' });
        return;
      }
      const obj = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      res.json({
        ok: true,
        verified: row.status === 'Credited',
        status: row.status,
        coinsAwarded: Number(obj.coinsAwarded || 0),
        message:
          row.status === 'Credited'
            ? 'সার্ভার পোস্টব্যাক যাচাই সম্পন্ন হয়েছে এবং কয়েন যুক্ত হয়েছে।'
            : 'বিজ্ঞাপন পার্টনারের সার্ভার পোস্টব্যাকের জন্য অপেক্ষমান আছে।',
      });
    } catch (err) {
      handleRouteError(res, err, 'সেশন যাচাই করা যায়নি।');
    }
  });

  router.post('/watch-earn/redeem', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const body = (req.body || {}) as { coins?: number };
      const coins = Math.floor(Number(body.coins || 0));
      if (!Number.isFinite(coins) || coins < 100) {
        res.status(400).json({ ok: false, error: 'সর্বনিম্ন ১০০ কয়েন রিডিম করা যাবে।' });
        return;
      }
      const now = Date.now();
      const deduct = await db.run(
        `UPDATE watch_earn_balances
         SET coins_available = coins_available - ?,
             coins_redeemed = coins_redeemed + ?,
             updated_at = ?
         WHERE user_id = ? AND coins_available >= ?`,
        [coins, coins, now, user.uid, coins]
      );
      if (deduct.changes === 0) {
        res.status(400).json({ ok: false, error: 'পর্যাপ্ত ভেরিফায়েড কয়েন নেই।' });
        return;
      }
      const id = generateSecureId('rtx', 8);
      const bdtEstimate = Number((coins / 10).toFixed(2));
      const payload = {
        id,
        sessionId: id,
        userId: user.uid,
        userEmail: getUserPrimaryIdentifier(user),
        provider: 'WALLET',
        type: 'coin_redemption',
        coins: -coins,
        bdtEquivalent: bdtEstimate,
        status: 'Pending Credit',
        note: `Coin redemption request (${coins} coins -> ৳${bdtEstimate})`,
        createdAt: now,
      };
      await db.run(
        'INSERT INTO ad_reward_transactions (id, user_id, type, status, coins, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, user.uid, 'coin_redemption', 'Pending Credit', coins, JSON.stringify(payload), now]
      );
      const nextBal = await db.first<{ coins_available: number }>(
        'SELECT coins_available FROM watch_earn_balances WHERE user_id = ?',
        [user.uid]
      );
      res.status(201).json({
        ok: true,
        id,
        coinsRedeemed: coins,
        bdtCredited: bdtEstimate,
        coinsAvailable: Number(nextBal?.coins_available || 0),
        status: 'Pending Credit',
      });
    } catch (err) {
      handleRouteError(res, err, 'কয়েন রিডিম অনুরোধ ব্যর্থ হয়েছে।');
    }
  });

  // =========================================================================
  // 9. PUBLIC CATALOG OVERRIDES & APPROVED REVIEWS
  // =========================================================================
  router.get('/payment-methods', async (_req, res) => {
    try {
      const db = await getAppDatabase();
      const rows = await db.all<PaymentMethodRow>(
        'SELECT * FROM payment_methods WHERE enabled = 1 ORDER BY sort_order ASC, name ASC'
      );
      res.json({ ok: true, paymentMethods: rows.map(mapPaymentMethodRow) });
    } catch {
      res.json({ ok: true, paymentMethods: [] });
    }
  });

  router.get('/catalog/overrides', async (_req, res) => {
    try {
      const db = await getAppDatabase();
      const [overrideRows, reviewRows, announcementRows, pmRows] = await Promise.all([
        db.all<{ collection: string; doc_id: string; deleted: number; payload_json: string }>(
          'SELECT collection, doc_id, deleted, payload_json FROM catalog_overrides'
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM reviews WHERE approved = 1 ORDER BY created_at DESC LIMIT 200'
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 30'
        ),
        db.all<PaymentMethodRow>(
          'SELECT * FROM payment_methods WHERE enabled = 1 ORDER BY sort_order ASC, name ASC'
        ),
      ]);

      const overrides: Record<string, Array<{ id: string; deleted: boolean; data: unknown }>> = {};
      for (const r of overrideRows) {
        if (!overrides[r.collection]) overrides[r.collection] = [];
        overrides[r.collection].push({
          id: r.doc_id,
          deleted: r.deleted === 1,
          data: parseJsonSafe(r.payload_json, {}),
        });
      }

      res.json({
        ok: true,
        overrides,
        reviews: reviewRows.map((r) => parseJsonSafe(r.payload_json, {})),
        announcements: announcementRows.map((r) => parseJsonSafe(r.payload_json, {})),
        paymentMethods: pmRows.map(mapPaymentMethodRow),
      });
    } catch {
      res.json({ ok: true, overrides: {}, reviews: [], announcements: [], paymentMethods: [] });
    }
  });

  // =========================================================================
  // 10. SERVER-VERIFIED ADMIN ROUTES (DB Role RBAC via HTTP-only Cookie)
  // =========================================================================
  async function requireAdminSession(
    req: express.Request,
    res: express.Response
  ): Promise<{ db: AppDatabase; user: SessionAuthUser } | null> {
    const resolved = await resolveSessionFromRequest(req);
    if (!resolved || (resolved.user.role !== 'admin' && resolved.user.role !== 'super_admin')) {
      res.status(403).json({ ok: false, error: 'অ্যাডমিন অনুমোদন প্রয়োজন।' });
      return null;
    }
    return { db: resolved.db, user: resolved.user };
  }

  router.get('/admin/verify', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved || (resolved.user.role !== 'admin' && resolved.user.role !== 'super_admin')) {
        res.status(403).json({ ok: false, isAdmin: false });
        return;
      }
      res.json({
        ok: true,
        isAdmin: true,
        uid: resolved.user.uid,
        phone: resolved.user.phone,
        email: resolved.user.email,
        role: resolved.user.role,
        superAdminEmail: getConfiguredSuperAdminEmail(),
      });
    } catch {
      res.status(403).json({ ok: false, isAdmin: false });
    }
  });

  router.get('/admin/dashboard', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db } = admin;

      const [
        userRows,
        walletRows,
        walletTxRows,
        orderRows,
        paymentRows,
        referralRows,
        ticketRows,
        reviewRows,
        withdrawalRows,
        rewardClaimRows,
        announcementRows,
        viewingSessionRows,
        adRewardTxRows,
        auditLogRows,
        paymentMethodRows,
        deletionRequestRows,
      ] = await Promise.all([
        db.all<UserRow>('SELECT * FROM users ORDER BY created_at DESC LIMIT 1000'),
        db.all<{
          uid: string;
          available_balance_bdt: number;
          promotional_credits_bdt: number;
          total_added_bdt: number;
          total_spent_bdt: number;
          last_tx_id: string;
          updated_at: number;
        }>('SELECT * FROM wallet_accounts LIMIT 1000'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM wallet_transactions ORDER BY created_at DESC LIMIT 1000'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM orders ORDER BY created_at DESC LIMIT 500'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM payments ORDER BY created_at DESC LIMIT 500'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM referrals ORDER BY created_at DESC LIMIT 500'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM support_tickets ORDER BY created_at DESC LIMIT 500'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM reviews ORDER BY created_at DESC LIMIT 500'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM withdrawals ORDER BY created_at DESC LIMIT 500'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM rewarded_claims ORDER BY created_at DESC LIMIT 500'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM announcements ORDER BY created_at DESC LIMIT 200'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM ad_viewing_sessions ORDER BY created_at DESC LIMIT 300'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM ad_reward_transactions ORDER BY created_at DESC LIMIT 300'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM audit_logs ORDER BY created_at DESC LIMIT 300'),
        db.all<PaymentMethodRow>('SELECT * FROM payment_methods ORDER BY sort_order ASC, name ASC'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM deletion_requests ORDER BY created_at DESC LIMIT 200'),
      ]);

      res.json({
        ok: true,
        superAdminEmail: getConfiguredSuperAdminEmail(),
        users: userRows.map(toClientUserProfile),
        wallets: walletRows.map((w) => ({
          uid: w.uid,
          availableBalanceBdt: Number(w.available_balance_bdt || 0),
          promotionalCreditsBdt: Number(w.promotional_credits_bdt || 0),
          totalAddedBdt: Number(w.total_added_bdt || 0),
          totalSpentBdt: Number(w.total_spent_bdt || 0),
          lastTxId: w.last_tx_id || '',
          updatedAt: Number(w.updated_at || 0),
        })),
        walletTxs: walletTxRows.map((r) => parseJsonSafe(r.payload_json, {})),
        orders: orderRows.map((r) => parseJsonSafe(r.payload_json, {})),
        payments: paymentRows.map((r) => parseJsonSafe(r.payload_json, {})),
        referrals: referralRows.map((r) => parseJsonSafe(r.payload_json, {})),
        tickets: ticketRows.map((r) => parseJsonSafe(r.payload_json, {})),
        reviews: reviewRows.map((r) => parseJsonSafe(r.payload_json, {})),
        withdrawals: withdrawalRows.map((r) => parseJsonSafe(r.payload_json, {})),
        rewardClaims: rewardClaimRows.map((r) => parseJsonSafe(r.payload_json, {})),
        announcements: announcementRows.map((r) => parseJsonSafe(r.payload_json, {})),
        viewingSessions: viewingSessionRows.map((r) => parseJsonSafe(r.payload_json, {})),
        adRewardTransactions: adRewardTxRows.map((r) => parseJsonSafe(r.payload_json, {})),
        auditLogs: auditLogRows.map((r) => parseJsonSafe(r.payload_json, {})),
        paymentMethods: paymentMethodRows.map(mapPaymentMethodRow),
        deletionRequests: deletionRequestRows.map((r) => parseJsonSafe(r.payload_json, {})),
      });
    } catch (err) {
      handleRouteError(res, err, 'অ্যাডমিন ডেটা লোড করা যায়নি।');
    }
  });

  router.post('/admin/verify-payment', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as {
        paymentId?: string;
        decision?: 'approve' | 'reject';
        rejectionReason?: string;
      };
      const paymentId = String(body.paymentId || '').trim();
      const decision = body.decision;
      const reason = String(body.rejectionReason || '').trim().slice(0, 400);
      if (!paymentId || (decision !== 'approve' && decision !== 'reject')) {
        res.status(400).json({ ok: false, error: 'Invalid payment verification request.' });
        return;
      }

      const payRow = await db.first<{ order_id: string; customer_id: string; status: string; payload_json: string }>(
        'SELECT order_id, customer_id, status, payload_json FROM payments WHERE id = ?',
        [paymentId]
      );
      if (!payRow) {
        res.status(404).json({ ok: false, error: 'Payment not found.' });
        return;
      }
      if (payRow.status !== 'Verification Pending') {
        res.status(409).json({ ok: false, error: `Payment already processed (${payRow.status}).` });
        return;
      }

      const now = Date.now();
      const paymentStatus = decision === 'approve' ? 'Approved' : 'Rejected';
      const orderStatus = decision === 'approve' ? 'Payment Approved' : 'Rejected';

      const payPayload = {
        ...parseJsonSafe<Record<string, unknown>>(payRow.payload_json, {}),
        status: paymentStatus,
        rejectionReason: decision === 'reject' ? reason : '',
        verifiedBy: user.uid,
        verifiedAt: now,
        updatedAt: now,
      };
      await db.run('UPDATE payments SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?', [
        paymentStatus,
        JSON.stringify(payPayload),
        now,
        paymentId,
      ]);

      const ordRow = await db.first<{ payload_json: string }>('SELECT payload_json FROM orders WHERE id = ?', [
        payRow.order_id,
      ]);
      if (ordRow) {
        const ordPayload = {
          ...parseJsonSafe<Record<string, unknown>>(ordRow.payload_json, {}),
          status: orderStatus,
          rejectionReason: decision === 'reject' ? reason : '',
          updatedAt: now,
        };
        await db.run('UPDATE orders SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?', [
          orderStatus,
          JSON.stringify(ordPayload),
          now,
          payRow.order_id,
        ]);
      }

      await insertNotification(
        db,
        payRow.customer_id,
        decision === 'approve' ? 'পেমেন্ট অনুমোদিত হয়েছে' : 'পেমেন্ট প্রত্যাখ্যাত হয়েছে',
        decision === 'approve' ? 'Payment Approved' : 'Payment Rejected',
        decision === 'approve'
          ? 'আপনার অর্ডারের পেমেন্ট অনুমোদিত হয়েছে।'
          : `আপনার পেমেন্ট প্রত্যাখ্যাত হয়েছে। কারণ: ${reason}`,
        decision === 'approve' ? 'Your payment has been approved.' : `Payment rejected: ${reason}`,
        'payment'
      );
      await insertAuditLog(
        db,
        user.uid,
        getUserPrimaryIdentifier(user),
        decision === 'approve' ? 'PAYMENT_APPROVED' : 'PAYMENT_REJECTED',
        'payments',
        paymentId,
        `${decision} payment ${paymentId}`
      );
      res.json({ ok: true, paymentStatus, orderStatus });
    } catch (err) {
      handleRouteError(res, err, 'Failed to verify payment.');
    }
  });

  router.post('/admin/verify-add-money', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as {
        walletTxId?: string;
        decision?: 'approve' | 'reject';
        rejectionReason?: string;
      };
      const walletTxId = String(body.walletTxId || '').trim();
      const decision = body.decision;
      const reason = String(body.rejectionReason || '').trim().slice(0, 400);
      if (!walletTxId || (decision !== 'approve' && decision !== 'reject')) {
        res.status(400).json({ ok: false, error: 'Invalid add-money request.' });
        return;
      }

      const txRow = await db.first<{ user_id: string; amount_bdt: number; status: string; payload_json: string }>(
        'SELECT user_id, amount_bdt, status, payload_json FROM wallet_transactions WHERE id = ?',
        [walletTxId]
      );
      if (!txRow) {
        res.status(404).json({ ok: false, error: 'Deposit transaction not found.' });
        return;
      }
      if (txRow.status !== 'Verification Pending') {
        res.status(409).json({ ok: false, error: `Deposit already processed (${txRow.status}).` });
        return;
      }

      const now = Date.now();
      const txStatus = decision === 'approve' ? 'Approved' : 'Rejected';
      const updatedTx = {
        ...parseJsonSafe<Record<string, unknown>>(txRow.payload_json, {}),
        status: txStatus,
        rejectionReason: decision === 'reject' ? reason : '',
        updatedAt: now,
      };
      await db.run(
        'UPDATE wallet_transactions SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?',
        [txStatus, JSON.stringify(updatedTx), now, walletTxId]
      );

      if (decision === 'approve') {
        await ensureWalletAccount(db, txRow.user_id);
        await db.run(
          `UPDATE wallet_accounts
           SET available_balance_bdt = available_balance_bdt + ?,
               total_added_bdt = total_added_bdt + ?,
               last_tx_id = ?,
               updated_at = ?
           WHERE uid = ?`,
          [txRow.amount_bdt, txRow.amount_bdt, walletTxId, now, txRow.user_id]
        );
      }

      // Sync linked payment row
      const linkedPay = await db.first<{ id: string; payload_json: string }>(
        'SELECT id, payload_json FROM payments WHERE order_id = ? LIMIT 1',
        [walletTxId]
      );
      if (linkedPay) {
        const payObj = {
          ...parseJsonSafe<Record<string, unknown>>(linkedPay.payload_json, {}),
          status: txStatus,
          rejectionReason: decision === 'reject' ? reason : '',
          verifiedBy: user.uid,
          verifiedAt: now,
          updatedAt: now,
        };
        await db.run('UPDATE payments SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?', [
          txStatus,
          JSON.stringify(payObj),
          now,
          linkedPay.id,
        ]);
      }

      await insertNotification(
        db,
        txRow.user_id,
        decision === 'approve' ? 'ওয়ালেট অ্যাড মানি অনুমোদিত' : 'ওয়ালেট অ্যাড মানি প্রত্যাখ্যাত',
        decision === 'approve' ? 'Wallet Deposit Approved' : 'Wallet Deposit Rejected',
        decision === 'approve'
          ? `আপনার ওয়ালেটে ৳${txRow.amount_bdt} যোগ হয়েছে।`
          : `৳${txRow.amount_bdt} অ্যাড মানি প্রত্যাখ্যাত হয়েছে। কারণ: ${reason}`,
        decision === 'approve'
          ? `৳${txRow.amount_bdt} credited to your wallet.`
          : `Deposit rejected: ${reason}`,
        'wallet'
      );
      await insertAuditLog(
        db,
        user.uid,
        getUserPrimaryIdentifier(user),
        decision === 'approve' ? 'ADD_MONEY_APPROVED' : 'ADD_MONEY_REJECTED',
        'walletTransactions',
        walletTxId,
        `${decision} ৳${txRow.amount_bdt} for ${txRow.user_id}`
      );
      res.json({ ok: true, txStatus });
    } catch (err) {
      handleRouteError(res, err, 'Failed to process deposit.');
    }
  });

  router.post('/admin/orders/:id/status', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const orderId = String(req.params.id || '').trim();
      const body = (req.body || {}) as { status?: string; adminNote?: string; rejectionReason?: string };
      const row = await db.first<{ customer_id: string; payload_json: string }>(
        'SELECT customer_id, payload_json FROM orders WHERE id = ?',
        [orderId]
      );
      if (!row) {
        res.status(404).json({ ok: false, error: 'Order not found' });
        return;
      }
      const now = Date.now();
      const existing = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      const status = String(body.status || existing.status || 'Processing');
      const updated = {
        ...existing,
        status,
        adminNote: body.adminNote ?? existing.adminNote ?? '',
        rejectionReason: body.rejectionReason ?? existing.rejectionReason ?? '',
        updatedAt: now,
      };
      await db.run('UPDATE orders SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?', [
        status,
        JSON.stringify(updated),
        now,
        orderId,
      ]);
      await insertAuditLog(db, user.uid, getUserPrimaryIdentifier(user), 'ORDER_STATUS_UPDATED', 'orders', orderId, `Set status ${status}`);
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to update order status.');
    }
  });

  router.post('/admin/complete-order-with-rewards', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as { orderId?: string; adminNote?: string };
      const orderId = String(body.orderId || '').trim();
      const row = await db.first<{ customer_id: string; payload_json: string }>(
        'SELECT customer_id, payload_json FROM orders WHERE id = ?',
        [orderId]
      );
      if (!row) {
        res.status(404).json({ ok: false, error: 'Order not found' });
        return;
      }
      const now = Date.now();
      const existing = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      const updated = {
        ...existing,
        status: 'Completed',
        adminNote: body.adminNote ?? existing.adminNote ?? '',
        updatedAt: now,
      };
      await db.run('UPDATE orders SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?', [
        'Completed',
        JSON.stringify(updated),
        now,
        orderId,
      ]);
      await insertNotification(
        db,
        row.customer_id,
        'অর্ডার সম্পন্ন হয়েছে',
        'Order Completed',
        `আপনার অর্ডার #${String(existing.orderNumber || orderId)} সফলভাবে ডেলিভারি সম্পন্ন হয়েছে।`,
        `Your order #${String(existing.orderNumber || orderId)} has been completed.`,
        'order'
      );
      await insertAuditLog(db, user.uid, getUserPrimaryIdentifier(user), 'ORDER_COMPLETED', 'orders', orderId, `Completed order ${orderId}`);
      res.json({ ok: true, awardedCashbackBdt: 0, awardedReferralBdt: 0 });
    } catch (err) {
      handleRouteError(res, err, 'Failed to complete order.');
    }
  });

  router.post('/admin/refund-cancel-order', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as {
        orderId?: string;
        reason?: string;
        rejectionReason?: string;
        refundToWallet?: boolean;
      };
      const orderId = String(body.orderId || '').trim();
      const row = await db.first<{ customer_id: string; payload_json: string }>(
        'SELECT customer_id, payload_json FROM orders WHERE id = ?',
        [orderId]
      );
      if (!row) {
        res.status(404).json({ ok: false, error: 'Order not found' });
        return;
      }
      const now = Date.now();
      const existing = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      const amount = Number(existing.totalPriceBdt || 0);
      const cancelReason = String(body.rejectionReason || body.reason || '').slice(0, 400);
      const updated = {
        ...existing,
        status: 'Cancelled',
        rejectionReason: cancelReason,
        updatedAt: now,
      };
      await db.run('UPDATE orders SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?', [
        'Cancelled',
        JSON.stringify(updated),
        now,
        orderId,
      ]);
      let refundedBdt = 0;
      if (body.refundToWallet && amount > 0) {
        refundedBdt = amount;
        await ensureWalletAccount(db, row.customer_id);
        const txId = generateSecureId('refw', 8);
        await db.run(
          'UPDATE wallet_accounts SET available_balance_bdt = available_balance_bdt + ?, last_tx_id = ?, updated_at = ? WHERE uid = ?',
          [amount, txId, now, row.customer_id]
        );
        const wtx = {
          id: txId,
          userId: row.customer_id,
          type: 'refund',
          method: 'wallet',
          transactionId: txId,
          amountBdt: amount,
          status: 'Approved',
          note: `Refund for cancelled order #${String(existing.orderNumber || orderId)}`,
          relatedOrderId: orderId,
          createdAt: now,
          updatedAt: now,
        };
        await db.run(
          'INSERT INTO wallet_transactions (id, user_id, type, amount_bdt, status, transaction_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [txId, row.customer_id, 'refund', amount, 'Approved', txId, JSON.stringify(wtx), now, now]
        );
      }
      await insertAuditLog(db, user.uid, getUserPrimaryIdentifier(user), 'ORDER_REFUND_CANCEL', 'orders', orderId, `Cancelled order ${orderId}`);
      res.json({ ok: true, status: 'Cancelled', refundedBdt });
    } catch (err) {
      handleRouteError(res, err, 'Failed to refund/cancel order.');
    }
  });

  router.post('/admin/wallet/adjust', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as {
        uid?: string;
        targetUid?: string;
        mode?: 'add' | 'deduct' | 'set';
        amountBdt?: number;
        amountDeltaBdt?: number;
        promoDeltaBdt?: number;
        reason?: string;
        note?: string;
      };
      const targetUid = String(body.targetUid || body.uid || '').trim();
      const reason = String(body.reason || body.note || '').trim().slice(0, 300);
      if (!targetUid) {
        res.status(400).json({ ok: false, error: 'Target user ID required.' });
        return;
      }
      if (reason.length < 3) {
        res.status(400).json({
          ok: false,
          error: 'ব্যালেন্স পরিবর্তনের জন্য সুস্পষ্ট কারণ (কমপক্ষে ৩ অক্ষর) লেখা বাধ্যতামূলক।',
        });
        return;
      }
      const targetUser = await db.first<UserRow>('SELECT * FROM users WHERE uid = ? LIMIT 1', [targetUid]);
      if (!targetUser) {
        res.status(404).json({ ok: false, error: 'Target user not found.' });
        return;
      }

      const wallet = await ensureWalletAccount(db, targetUid);
      const previousBal = wallet.availableBalanceBdt;
      let nextBal = previousBal;
      let delta = 0;
      const promoDelta = Number(body.promoDeltaBdt || 0);
      if (body.mode === 'add' || body.mode === 'deduct' || body.mode === 'set') {
        const rawAmt = Math.max(0, Math.round(Number(body.amountBdt || 0) * 100) / 100);
        if (body.mode === 'add') nextBal = previousBal + rawAmt;
        else if (body.mode === 'deduct') {
          if (previousBal < rawAmt) {
            res.status(400).json({ ok: false, error: `Cannot deduct ৳${rawAmt} from ৳${previousBal}.` });
            return;
          }
          nextBal = previousBal - rawAmt;
        } else {
          nextBal = rawAmt;
        }
        delta = Math.round((nextBal - previousBal) * 100) / 100;
      } else {
        delta = Math.round(Number(body.amountDeltaBdt || 0) * 100) / 100;
        if (previousBal + delta < 0) {
          res.status(400).json({ ok: false, error: `Balance cannot become negative (current ৳${previousBal}).` });
          return;
        }
        nextBal = Math.max(0, previousBal + delta);
      }
      const nextPromo = Math.max(0, wallet.promotionalCreditsBdt + promoDelta);
      const now = Date.now();
      const txId = generateSecureId('adj', 8);

      await db.run(
        `UPDATE wallet_accounts
         SET available_balance_bdt = ?, promotional_credits_bdt = ?, last_tx_id = ?, updated_at = ?
         WHERE uid = ?`,
        [nextBal, nextPromo, txId, now, targetUid]
      );

      const wtx = {
        id: txId,
        userId: targetUid,
        userEmail: targetUser.email_normalized || extractPublicPhone(targetUser.phone_e164) || targetUid,
        type: promoDelta > 0 && delta === 0 ? 'promo_credit' : 'admin_adjustment',
        method: 'system',
        transactionId: txId,
        amountBdt: Math.abs(delta || promoDelta),
        signedDeltaBdt: delta,
        status: 'Approved',
        note: reason,
        createdAt: now,
        updatedAt: now,
      };
      await db.run(
        'INSERT INTO wallet_transactions (id, user_id, type, amount_bdt, status, transaction_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [txId, targetUid, wtx.type, wtx.amountBdt, 'Approved', txId, JSON.stringify(wtx), now, now]
      );

      await insertNotification(
        db,
        targetUid,
        delta >= 0 ? 'ওয়ালেট ব্যালেন্স যুক্ত হয়েছে' : 'ওয়ালেট ব্যালেন্স সমন্বয় হয়েছে',
        delta >= 0 ? 'Wallet Balance Credited' : 'Wallet Balance Adjusted',
        `অ্যাডমিন কর্তৃক আপনার ব্যালেন্স ৳${previousBal} থেকে ৳${nextBal} করা হয়েছে। কারণ: ${reason}`,
        `Your wallet balance was updated from ৳${previousBal} to ৳${nextBal}. Reason: ${reason}`,
        'wallet'
      );

      await insertAuditLog(
        db,
        user.uid,
        getUserPrimaryIdentifier(user),
        'WALLET_ADJUSTED',
        'walletAccounts',
        targetUid,
        `Adjusted balance ${delta >= 0 ? '+' : ''}৳${delta} for ${targetUser.display_name}`,
        {
          targetUserId: targetUid,
          previousValue: `৳${previousBal}`,
          newValue: `৳${nextBal}`,
          reason,
          transactionId: txId,
        }
      );
      res.json({ ok: true, previousBalance: previousBal, nextBalance: nextBal, transactionId: txId });
    } catch (err) {
      handleRouteError(res, err, 'Failed to adjust wallet.');
    }
  });

  router.post('/admin/update-user-status', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as {
        uid?: string;
        targetUid?: string;
        status?: 'active' | 'suspended';
        reason?: string;
      };
      const targetUid = String(body.targetUid || body.uid || '').trim();
      const status = body.status === 'suspended' ? 'suspended' : 'active';
      const reason = String(body.reason || '').trim().slice(0, 300);

      const targetRow = await db.first<UserRow>('SELECT * FROM users WHERE uid = ? LIMIT 1', [targetUid]);
      if (!targetRow) {
        res.status(404).json({ ok: false, error: 'ব্যবহারকারী পাওয়া যায়নি।' });
        return;
      }

      const targetRole = resolveUserRole(
        targetRow.phone_e164,
        targetRow.email_normalized || targetRow.email,
        targetRow.role
      );
      if (targetRole === 'super_admin' || targetUid === user.uid) {
        res.status(403).json({
          ok: false,
          code: 'admin/super-admin-protected',
          error: 'সুপার অ্যাডমিন অ্যাকাউন্ট ব্লক, সাসপেন্ড বা নিষ্ক্রিয় করা যাবে না।',
        });
        return;
      }

      const previousStatus = targetRow.status || 'active';
      const now = Date.now();
      await db.run('UPDATE users SET status = ?, updated_at = ? WHERE uid = ?', [status, now, targetUid]);
      if (status === 'suspended') {
        await db.run('DELETE FROM sessions WHERE user_id = ?', [targetUid]);
      }

      await insertNotification(
        db,
        targetUid,
        status === 'suspended' ? 'অ্যাকাউন্ট সাময়িকভাবে ব্লক করা হয়েছে' : 'অ্যাকাউন্ট পুনরায় সক্রিয় হয়েছে',
        status === 'suspended' ? 'Account Suspended' : 'Account Activated',
        status === 'suspended'
          ? `আপনার অ্যাকাউন্ট সাময়িকভাবে সাসপেন্ড করা হয়েছে।${reason ? ` কারণ: ${reason}` : ''}`
          : 'আপনার DIGITAL HUB অ্যাকাউন্ট পুনরায় সক্রিয় করা হয়েছে।',
        status === 'suspended'
          ? `Your account has been suspended.${reason ? ` Reason: ${reason}` : ''}`
          : 'Your DIGITAL HUB account is now active again.',
        'system'
      );

      await insertAuditLog(
        db,
        user.uid,
        getUserPrimaryIdentifier(user),
        status === 'suspended' ? 'USER_SUSPENDED' : 'USER_ACTIVATED',
        'users',
        targetUid,
        `Changed ${targetRow.display_name} status from ${previousStatus} to ${status}`,
        {
          targetUserId: targetUid,
          previousValue: previousStatus,
          newValue: status,
          reason: reason || `Status updated to ${status}`,
        }
      );
      res.json({ ok: true, status });
    } catch (err) {
      handleRouteError(res, err, 'Failed to update user status.');
    }
  });

  // Full User Profile Detail for Admin Inspection Drawer/Modal
  router.get('/admin/users/:uid', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db } = admin;
      const targetUid = String(req.params.uid || '').trim();
      const userRow = await db.first<UserRow>('SELECT * FROM users WHERE uid = ? LIMIT 1', [targetUid]);
      if (!userRow) {
        res.status(404).json({ ok: false, error: 'User not found.' });
        return;
      }
      const wallet = await ensureWalletAccount(db, targetUid);
      const [txRows, wdrRows, refRows, orderRows, sessionRows, auditRows] = await Promise.all([
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM wallet_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
          [targetUid]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
          [targetUid]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM referrals WHERE referrer_uid = ? ORDER BY created_at DESC LIMIT 100',
          [targetUid]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM orders WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100',
          [targetUid]
        ),
        db.all<{ id: string; ip_address: string; user_agent: string; created_at: number; last_seen_at: number; expires_at: number }>(
          'SELECT id, ip_address, user_agent, created_at, last_seen_at, expires_at FROM sessions WHERE user_id = ? AND revoked_at = 0 AND expires_at > ? ORDER BY last_seen_at DESC',
          [targetUid, Date.now()]
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM audit_logs ORDER BY created_at DESC LIMIT 200'
        ),
      ]);

      const walletTxs = txRows.map((r) => parseJsonSafe<Record<string, unknown>>(r.payload_json, {}));
      const withdrawals = wdrRows.map((r) => parseJsonSafe<Record<string, unknown>>(r.payload_json, {}));
      const referrals = refRows.map((r) => parseJsonSafe<Record<string, unknown>>(r.payload_json, {}));
      const orders = orderRows.map((r) => parseJsonSafe<Record<string, unknown>>(r.payload_json, {}));
      const relatedAudits = auditRows
        .map((r) => parseJsonSafe<Record<string, unknown>>(r.payload_json, {}))
        .filter((a) => a.targetUserId === targetUid || a.targetId === targetUid)
        .slice(0, 30);

      const earningTypes = new Set(['referral', 'cashback', 'rewarded_ad', 'watch_earn_coin_redeem', 'promo_credit']);
      const totalEarningsBdt = walletTxs
        .filter((tx) => tx.status === 'Approved' && earningTypes.has(String(tx.type || '')))
        .reduce((sum, tx) => sum + Number(tx.amountBdt || 0), 0);
      const referralEarningsBdt = referrals
        .filter((ref) => ref.status === 'credited')
        .reduce((sum, ref) => sum + Number(ref.rewardAmountBdt || 0), 0);
      const totalWithdrawnBdt = withdrawals
        .filter((w) => w.status === 'Paid' || w.status === 'Approved')
        .reduce((sum, w) => sum + Number(w.amountBdt || 0), 0);
      const pendingWithdrawalBdt = withdrawals
        .filter((w) => w.status === 'Pending' || w.status === 'Processing')
        .reduce((sum, w) => sum + Number(w.amountBdt || 0), 0);

      res.json({
        ok: true,
        profile: toClientUserProfile(userRow),
        wallet,
        summary: {
          totalEarningsBdt,
          referralEarningsBdt,
          totalWithdrawnBdt,
          pendingWithdrawalBdt,
          referralCount: referrals.length,
          orderCount: orders.length,
          activeSessionCount: sessionRows.length,
        },
        walletTxs,
        withdrawals,
        referrals,
        orders,
        sessions: sessionRows.map((s) => ({
          id: s.id,
          ipAddress: s.ip_address,
          userAgent: s.user_agent,
          createdAt: s.created_at,
          lastSeenAt: s.last_seen_at,
          expiresAt: s.expires_at,
        })),
        auditLogs: relatedAudits,
      });
    } catch (err) {
      handleRouteError(res, err, 'Failed to load user details.');
    }
  });

  // Admin Edit Permitted User Info & Admin Notes
  router.patch('/admin/users/:uid', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const targetUid = String(req.params.uid || '').trim();
      const targetRow = await db.first<UserRow>('SELECT * FROM users WHERE uid = ? LIMIT 1', [targetUid]);
      if (!targetRow) {
        res.status(404).json({ ok: false, error: 'User not found.' });
        return;
      }

      const body = (req.body || {}) as {
        displayName?: string;
        phone?: string;
        language?: 'bn' | 'en';
        adminNotes?: string;
        reason?: string;
      };

      const nextName =
        typeof body.displayName === 'string' && body.displayName.trim().length >= 2
          ? body.displayName.trim().slice(0, 120)
          : targetRow.display_name;
      const nextLanguage =
        body.language === 'en' ? 'en' : body.language === 'bn' ? 'bn' : targetRow.language === 'en' ? 'en' : 'bn';
      const nextNotes =
        typeof body.adminNotes === 'string' ? body.adminNotes.trim().slice(0, 2000) : targetRow.admin_notes || '';

      let nextPhone = targetRow.phone_e164;
      if (typeof body.phone === 'string' && body.phone.trim()) {
        const normalized = normalizeBangladeshPhone(body.phone);
        if (!normalized) {
          res.status(400).json({ ok: false, error: 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন।' });
          return;
        }
        if (normalized !== extractPublicPhone(targetRow.phone_e164)) {
          const taken = await db.first<{ uid: string }>(
            'SELECT uid FROM users WHERE phone_e164 = ? AND uid != ? LIMIT 1',
            [normalized, targetUid]
          );
          if (taken) {
            res.status(409).json({ ok: false, error: 'এই নম্বরটি অন্য অ্যাকাউন্টে ব্যবহৃত হচ্ছে।' });
            return;
          }
          nextPhone = normalized;
        }
      }

      const now = Date.now();
      await db.run(
        'UPDATE users SET display_name = ?, phone_e164 = ?, language = ?, admin_notes = ?, updated_at = ? WHERE uid = ?',
        [nextName, nextPhone, nextLanguage, nextNotes, now, targetUid]
      );

      await insertAuditLog(
        db,
        user.uid,
        getUserPrimaryIdentifier(user),
        'USER_PROFILE_EDITED',
        'users',
        targetUid,
        `Updated user info/notes for ${targetRow.display_name}`,
        {
          targetUserId: targetUid,
          previousValue: `${targetRow.display_name} | Notes: ${(targetRow.admin_notes || '').slice(0, 60)}`,
          newValue: `${nextName} | Notes: ${nextNotes.slice(0, 60)}`,
          reason: String(body.reason || 'Admin user profile update').slice(0, 200),
        }
      );

      const updated = await db.first<UserRow>('SELECT * FROM users WHERE uid = ?', [targetUid]);
      res.json({ ok: true, profile: updated ? toClientUserProfile(updated) : toClientUserProfile(targetRow) });
    } catch (err) {
      handleRouteError(res, err, 'Failed to update user details.');
    }
  });

  // 5-Stage Withdrawal Processing (Pending -> Approved -> Processing -> Paid / Rejected with atomic single refund)
  router.post('/admin/process-withdrawal', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as {
        withdrawalId?: string;
        status?: 'Approved' | 'Processing' | 'Paid' | 'Rejected';
        decision?: 'approve' | 'processing' | 'paid' | 'reject';
        adminNote?: string;
        rejectionReason?: string;
        payoutTrxId?: string;
        payoutReference?: string;
      };
      const wId = String(body.withdrawalId || '').trim();
      const row = await db.first<{ user_id: string; status: string; payload_json: string }>(
        'SELECT user_id, status, payload_json FROM withdrawals WHERE id = ?',
        [wId]
      );
      if (!row) {
        res.status(404).json({ ok: false, error: 'Withdrawal request not found.' });
        return;
      }

      const previousStatus = row.status;
      if (previousStatus === 'Paid' || previousStatus === 'Rejected') {
        res.status(409).json({
          ok: false,
          error: `Withdrawal already finalized (${previousStatus}) and cannot be modified again.`,
        });
        return;
      }

      let nextStatus: 'Approved' | 'Processing' | 'Paid' | 'Rejected' | null = null;
      if (
        body.status === 'Approved' ||
        body.status === 'Processing' ||
        body.status === 'Paid' ||
        body.status === 'Rejected'
      ) {
        nextStatus = body.status;
      } else if (body.decision === 'approve') {
        nextStatus = 'Approved';
      } else if (body.decision === 'processing') {
        nextStatus = 'Processing';
      } else if (body.decision === 'paid') {
        nextStatus = 'Paid';
      } else if (body.decision === 'reject') {
        nextStatus = 'Rejected';
      }

      if (!nextStatus || nextStatus === previousStatus) {
        res.status(400).json({ ok: false, error: 'Invalid withdrawal status transition.' });
        return;
      }

      const now = Date.now();
      const existing = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      const payoutReference = String(
        body.payoutReference || body.payoutTrxId || existing.payoutReference || ''
      )
        .trim()
        .slice(0, 100);
      const adminNote = String(body.adminNote ?? existing.adminNote ?? '').trim().slice(0, 400);
      const rejectionReason = String(
        body.rejectionReason ?? existing.rejectionReason ?? ''
      )
        .trim()
        .slice(0, 400);

      const updated = {
        ...existing,
        status: nextStatus,
        adminNote,
        rejectionReason: nextStatus === 'Rejected' ? rejectionReason : '',
        payoutReference,
        paidAt: nextStatus === 'Paid' ? now : existing.paidAt || null,
        processedBy: user.uid,
        updatedAt: now,
      };

      // Atomic conditional update guarantees no concurrent double refund or double finalize
      const updateResult = await db.run(
        'UPDATE withdrawals SET status = ?, payload_json = ?, updated_at = ? WHERE id = ? AND status = ?',
        [nextStatus, JSON.stringify(updated), now, wId, previousStatus]
      );
      if (updateResult.changes === 0) {
        res.status(409).json({ ok: false, error: 'Withdrawal status changed concurrently. Please refresh.' });
        return;
      }

      const amt = Number(existing.amountBdt || 0);
      const linkedWalletTxId = String(existing.walletTxId || '');

      if (nextStatus === 'Rejected' && amt > 0) {
        await ensureWalletAccount(db, row.user_id);
        const refundTxId = generateSecureId('wref', 8);
        await db.run(
          'UPDATE wallet_accounts SET available_balance_bdt = available_balance_bdt + ?, last_tx_id = ?, updated_at = ? WHERE uid = ?',
          [amt, refundTxId, now, row.user_id]
        );
        const refundTx = {
          id: refundTxId,
          userId: row.user_id,
          userEmail: String(existing.userEmail || ''),
          type: 'withdrawal_refund',
          method: 'system',
          transactionId: wId,
          amountBdt: amt,
          status: 'Approved',
          note: `Refund for rejected withdrawal #${wId}${rejectionReason ? ` (${rejectionReason})` : ''}`,
          createdAt: now,
          updatedAt: now,
        };
        await db.run(
          'INSERT INTO wallet_transactions (id, user_id, type, amount_bdt, status, transaction_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [refundTxId, row.user_id, 'withdrawal_refund', amt, 'Approved', wId, JSON.stringify(refundTx), now, now]
        );
      }

      if (linkedWalletTxId) {
        const wtxRow = await db.first<{ payload_json: string }>(
          'SELECT payload_json FROM wallet_transactions WHERE id = ? LIMIT 1',
          [linkedWalletTxId]
        );
        if (wtxRow) {
          const txStatus =
            nextStatus === 'Paid' || nextStatus === 'Approved'
              ? 'Approved'
              : nextStatus === 'Rejected'
                ? 'Rejected'
                : 'Verification Pending';
          const nextWtx = {
            ...parseJsonSafe<Record<string, unknown>>(wtxRow.payload_json, {}),
            status: txStatus,
            transactionId: payoutReference || wId,
            rejectionReason: nextStatus === 'Rejected' ? rejectionReason : '',
            updatedAt: now,
          };
          await db.run(
            'UPDATE wallet_transactions SET status = ?, transaction_id = ?, payload_json = ?, updated_at = ? WHERE id = ?',
            [txStatus, payoutReference || wId, JSON.stringify(nextWtx), now, linkedWalletTxId]
          );
        }
      }

      const notifMap: Record<
        'Approved' | 'Processing' | 'Paid' | 'Rejected',
        { bnTitle: string; enTitle: string; bnMsg: string; enMsg: string }
      > = {
        Approved: {
          bnTitle: 'উত্তোলন অনুরোধ অনুমোদিত হয়েছে',
          enTitle: 'Withdrawal Approved',
          bnMsg: `৳${amt} উত্তোলন অনুরোধ (#${wId}) অনুমোদিত হয়েছে। শীঘ্রই পেমেন্ট পাঠানো হবে।`,
          enMsg: `Your ৳${amt} withdrawal (#${wId}) has been approved.`,
        },
        Processing: {
          bnTitle: 'উত্তোলন পেমেন্ট প্রসেসিং চলছে',
          enTitle: 'Withdrawal Processing',
          bnMsg: `৳${amt} উত্তোলন অনুরোধ (#${wId}) বর্তমানে পেমেন্ট প্রসেসিংয়ে আছে।`,
          enMsg: `Your ৳${amt} withdrawal (#${wId}) is now being processed.`,
        },
        Paid: {
          bnTitle: 'উত্তোলন পেমেন্ট সম্পন্ন হয়েছে',
          enTitle: 'Withdrawal Paid',
          bnMsg: `৳${amt} পেমেন্ট সফলভাবে পাঠানো হয়েছে।${payoutReference ? ` রেফারেন্স: ${payoutReference}` : ''}`,
          enMsg: `Your ৳${amt} withdrawal has been paid.${payoutReference ? ` Reference: ${payoutReference}` : ''}`,
        },
        Rejected: {
          bnTitle: 'উত্তোলন অনুরোধ প্রত্যাখ্যাত (রিফান্ড সম্পন্ন)',
          enTitle: 'Withdrawal Rejected (Refunded)',
          bnMsg: `৳${amt} উত্তোলন অনুরোধ প্রত্যাখ্যাত হওয়ায় টাকা আপনার ওয়ালেটে ফেরত দেওয়া হয়েছে।${rejectionReason ? ` কারণ: ${rejectionReason}` : ''}`,
          enMsg: `Your ৳${amt} withdrawal was rejected and refunded to your wallet.${rejectionReason ? ` Reason: ${rejectionReason}` : ''}`,
        },
      };

      const msg = notifMap[nextStatus];
      await insertNotification(db, row.user_id, msg.bnTitle, msg.enTitle, msg.bnMsg, msg.enMsg, 'wallet');

      await insertAuditLog(
        db,
        user.uid,
        getUserPrimaryIdentifier(user),
        `WITHDRAWAL_${nextStatus.toUpperCase()}`,
        'withdrawals',
        wId,
        `Withdrawal #${wId} (৳${amt}) changed from ${previousStatus} to ${nextStatus}`,
        {
          targetUserId: row.user_id,
          previousValue: previousStatus,
          newValue: nextStatus,
          reason: rejectionReason || adminNote || `Marked ${nextStatus}`,
          transactionId: payoutReference || wId,
        }
      );

      res.json({ ok: true, status: nextStatus, paidAt: nextStatus === 'Paid' ? now : undefined });
    } catch (err) {
      handleRouteError(res, err, 'Failed to process withdrawal.');
    }
  });

  // Configurable Payment Methods CRUD (bKash, Nagad, Rocket, Bank Transfer, Custom)
  router.get('/admin/payment-methods', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const rows = await admin.db.all<PaymentMethodRow>(
        'SELECT * FROM payment_methods ORDER BY sort_order ASC, name ASC'
      );
      res.json({ ok: true, paymentMethods: rows.map(mapPaymentMethodRow) });
    } catch (err) {
      handleRouteError(res, err, 'Failed to load payment methods.');
    }
  });

  router.post('/admin/payment-methods', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as {
        id?: string;
        code?: string;
        name?: string;
        type?: 'mobile_banking' | 'bank_transfer' | 'custom';
        accountNumber?: string;
        accountName?: string;
        instructionsBn?: string;
        instructionsEn?: string;
        requirementsBn?: string;
        requirementsEn?: string;
        minAmount?: number;
        maxAmount?: number;
        supportsDeposit?: boolean;
        supportsWithdrawal?: boolean;
        enabled?: boolean;
        sortOrder?: number;
      };

      const name = String(body.name || '').trim().slice(0, 80);
      if (name.length < 2) {
        res.status(400).json({ ok: false, error: 'Payment method name is required.' });
        return;
      }
      const rawCode = String(body.code || name)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
      if (!rawCode) {
        res.status(400).json({ ok: false, error: 'Valid method code required.' });
        return;
      }

      const id = String(body.id || `pm_${rawCode}`).trim().slice(0, 64);
      const existing = await db.first<PaymentMethodRow>('SELECT * FROM payment_methods WHERE id = ? LIMIT 1', [id]);
      const type =
        body.type === 'bank_transfer' || body.type === 'custom' ? body.type : 'mobile_banking';
      const accountNumber = String(body.accountNumber || '').trim().slice(0, 120);
      const accountName = String(body.accountName || '').trim().slice(0, 120);
      const instructionsBn = String(body.instructionsBn || '').trim().slice(0, 800);
      const instructionsEn = String(body.instructionsEn || '').trim().slice(0, 800);
      const requirementsBn = String(body.requirementsBn || '').trim().slice(0, 400);
      const requirementsEn = String(body.requirementsEn || '').trim().slice(0, 400);
      const minAmount = Math.max(10, Number(body.minAmount ?? 50) || 50);
      const maxAmount = Math.max(minAmount, Number(body.maxAmount ?? 100000) || 100000);
      const supportsDeposit = body.supportsDeposit !== false ? 1 : 0;
      const supportsWithdrawal = body.supportsWithdrawal !== false ? 1 : 0;
      const enabled = body.enabled !== false ? 1 : 0;
      const sortOrder = Number(body.sortOrder ?? existing?.sort_order ?? 10) || 0;
      const now = Date.now();

      await db.run(
        `INSERT INTO payment_methods (
          id, code, name, type, account_number, account_name,
          instructions_bn, instructions_en, requirements_bn, requirements_en,
          min_amount, max_amount, supports_deposit, supports_withdrawal, enabled, sort_order, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          account_number = excluded.account_number,
          account_name = excluded.account_name,
          instructions_bn = excluded.instructions_bn,
          instructions_en = excluded.instructions_en,
          requirements_bn = excluded.requirements_bn,
          requirements_en = excluded.requirements_en,
          min_amount = excluded.min_amount,
          max_amount = excluded.max_amount,
          supports_deposit = excluded.supports_deposit,
          supports_withdrawal = excluded.supports_withdrawal,
          enabled = excluded.enabled,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at`,
        [
          id,
          existing?.code || rawCode,
          name,
          type,
          accountNumber,
          accountName,
          instructionsBn,
          instructionsEn,
          requirementsBn,
          requirementsEn,
          minAmount,
          maxAmount,
          supportsDeposit,
          supportsWithdrawal,
          enabled,
          sortOrder,
          now,
        ]
      );

      await insertAuditLog(
        db,
        user.uid,
        getUserPrimaryIdentifier(user),
        existing ? 'PAYMENT_METHOD_UPDATED' : 'PAYMENT_METHOD_CREATED',
        'payment_methods',
        id,
        `${existing ? 'Updated' : 'Created'} payment method ${name}`,
        {
          previousValue: existing ? `${existing.name} (${existing.account_number}, enabled=${existing.enabled})` : 'none',
          newValue: `${name} (${accountNumber}, enabled=${enabled})`,
          reason: 'Admin payment method configuration',
        }
      );

      const saved = await db.first<PaymentMethodRow>('SELECT * FROM payment_methods WHERE id = ?', [id]);
      res.status(existing ? 200 : 201).json({
        ok: true,
        paymentMethod: saved ? mapPaymentMethodRow(saved) : null,
      });
    } catch (err) {
      handleRouteError(res, err, 'Failed to save payment method.');
    }
  });

  router.delete('/admin/payment-methods/:id', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const id = String(req.params.id || '').trim();
      const existing = await admin.db.first<PaymentMethodRow>('SELECT * FROM payment_methods WHERE id = ?', [id]);
      if (!existing) {
        res.status(404).json({ ok: false, error: 'Payment method not found.' });
        return;
      }
      await admin.db.run('DELETE FROM payment_methods WHERE id = ?', [id]);
      await insertAuditLog(
        admin.db,
        admin.user.uid,
        getUserPrimaryIdentifier(admin.user),
        'PAYMENT_METHOD_DELETED',
        'payment_methods',
        id,
        `Deleted payment method ${existing.name}`,
        { previousValue: existing.name, newValue: 'deleted', reason: 'Admin removed payment method' }
      );
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to delete payment method.');
    }
  });

  // Direct Targeted, Multi-User, or Broadcast System Notifications
  router.post('/admin/notifications/send', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as {
        targetUid?: string;
        targetUids?: string[];
        titleBn?: string;
        titleEn?: string;
        messageBn?: string;
        messageEn?: string;
        type?: 'order' | 'payment' | 'wallet' | 'referral' | 'system' | 'promo';
      };
      const targetUid = String(body.targetUid || 'ALL').trim();
      const targetUidsRaw = Array.isArray(body.targetUids)
        ? Array.from(new Set(body.targetUids.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 500)
        : [];
      const titleBn = String(body.titleBn || body.titleEn || '').trim().slice(0, 160);
      const titleEn = String(body.titleEn || body.titleBn || '').trim().slice(0, 160);
      const messageBn = String(body.messageBn || body.messageEn || '').trim().slice(0, 1000);
      const messageEn = String(body.messageEn || body.messageBn || '').trim().slice(0, 1000);
      const type =
        body.type === 'order' ||
        body.type === 'payment' ||
        body.type === 'wallet' ||
        body.type === 'referral' ||
        body.type === 'promo'
          ? body.type
          : 'system';

      if (titleBn.length < 2 || messageBn.length < 2) {
        res.status(400).json({ ok: false, error: 'নোটিফিকেশনের শিরোনাম এবং বার্তা লিখুন।' });
        return;
      }

      let recipientCount = 0;
      let targetLabel = targetUid;
      if (targetUidsRaw.length > 0) {
        for (const uidItem of targetUidsRaw) {
          const exists = await db.first<{ uid: string }>('SELECT uid FROM users WHERE uid = ? LIMIT 1', [uidItem]);
          if (exists) {
            await insertNotification(db, uidItem, titleBn, titleEn, messageBn, messageEn, type);
            recipientCount += 1;
          }
        }
        if (recipientCount === 0) {
          res.status(404).json({ ok: false, error: 'নির্বাচিত কোনো ব্যবহারকারী পাওয়া যায়নি।' });
          return;
        }
        targetLabel = `SELECTED_${recipientCount}`;
      } else if (targetUid === 'ALL') {
        const activeUsers = await db.all<{ uid: string }>(
          `SELECT uid FROM users WHERE status = 'active' LIMIT 1000`
        );
        for (const u of activeUsers) {
          await insertNotification(db, u.uid, titleBn, titleEn, messageBn, messageEn, type);
          recipientCount += 1;
        }
      } else {
        const exists = await db.first<{ uid: string }>('SELECT uid FROM users WHERE uid = ? LIMIT 1', [targetUid]);
        if (!exists) {
          res.status(404).json({ ok: false, error: 'নির্বাচিত ব্যবহারকারী পাওয়া যায়নি।' });
          return;
        }
        await insertNotification(db, targetUid, titleBn, titleEn, messageBn, messageEn, type);
        recipientCount = 1;
      }

      await insertAuditLog(
        db,
        user.uid,
        getUserPrimaryIdentifier(user),
        'NOTIFICATION_SENT',
        'notifications',
        targetLabel,
        `Sent notification "${titleEn}" to ${recipientCount} user(s)`,
        {
          targetUserId: targetUidsRaw.length === 0 && targetUid !== 'ALL' ? targetUid : '',
          newValue: titleEn,
          reason: messageEn.slice(0, 140),
        }
      );

      res.status(201).json({ ok: true, recipientCount });
    } catch (err) {
      handleRouteError(res, err, 'Failed to send notification.');
    }
  });

  // Security Console Endpoints (Active Sessions, Rate-Limit Lockouts, Suspicious Accounts, Repeated Payments, Abnormal Referrals, Deletion Requests)
  router.get('/admin/security', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db } = admin;
      const now = Date.now();
      const oneDayAgo = now - 24 * 60 * 60 * 1000;
      const [
        sessionRows,
        attemptRows,
        deletionRows,
        flaggedRefRows,
        allUserRows,
        paymentRows,
        walletTxRows,
        allRefRows,
      ] = await Promise.all([
        db.all<{
          id: string;
          user_id: string;
          ip_address: string;
          user_agent: string;
          created_at: number;
          last_seen_at: number;
          expires_at: number;
          display_name: string;
          email: string;
          phone_e164: string | null;
          role: string;
        }>(
          `SELECT s.id, s.user_id, s.ip_address, s.user_agent, s.created_at, s.last_seen_at, s.expires_at,
                  u.display_name, u.email, u.phone_e164, u.role
           FROM sessions s
           INNER JOIN users u ON u.uid = s.user_id
           WHERE s.revoked_at = 0 AND s.expires_at > ?
           ORDER BY s.last_seen_at DESC
           LIMIT 200`,
          [now]
        ),
        db.all<AttemptRow>(
          'SELECT attempt_key, attempts, window_start, locked_until FROM auth_attempts ORDER BY locked_until DESC, attempts DESC LIMIT 100'
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM deletion_requests ORDER BY created_at DESC LIMIT 100'
        ),
        db.all<{ payload_json: string }>(
          `SELECT payload_json FROM referrals WHERE status = 'flagged' ORDER BY created_at DESC LIMIT 100`
        ),
        db.all<{
          uid: string;
          display_name: string;
          email: string;
          phone_e164: string | null;
          status: string;
          last_login_ip: string;
          last_login_at: number;
        }>(
          `SELECT uid, display_name, email, phone_e164, status, last_login_ip, last_login_at FROM users ORDER BY created_at DESC LIMIT 1000`
        ),
        db.all<{
          id: string;
          customer_id: string;
          status: string;
          payload_json: string;
          created_at: number;
        }>(
          `SELECT id, customer_id, status, payload_json, created_at FROM payments ORDER BY created_at DESC LIMIT 500`
        ),
        db.all<{
          id: string;
          user_id: string;
          type: string;
          amount_bdt: number;
          status: string;
          payload_json: string;
          created_at: number;
        }>(
          `SELECT id, user_id, type, amount_bdt, status, payload_json, created_at FROM wallet_transactions WHERE type = 'deposit' ORDER BY created_at DESC LIMIT 500`
        ),
        db.all<{
          id: string;
          referrer_uid: string;
          referred_uid: string;
          status: string;
          created_at: number;
        }>(
          `SELECT id, referrer_uid, referred_uid, status, created_at FROM referrals ORDER BY created_at DESC LIMIT 500`
        ),
      ]);

      const userLabelById = new Map<string, string>();
      const usersByIp = new Map<string, typeof allUserRows>();
      for (const u of allUserRows) {
        const identifier = u.email || extractPublicPhone(u.phone_e164) || u.uid;
        userLabelById.set(u.uid, `${u.display_name || 'User'} (${identifier})`);
        const ip = String(u.last_login_ip || '').trim();
        if (ip && ip !== 'unknown') {
          const list = usersByIp.get(ip) || [];
          list.push(u);
          usersByIp.set(ip, list);
        }
      }

      // 1. Suspicious Account Activity (shared login IP across multiple accounts or suspended accounts with repeated attempts)
      const suspiciousAccounts: Array<{
        uid: string;
        userName: string;
        identifier: string;
        severity: 'high' | 'medium';
        reason: string;
        details: string;
        lastSeenAt: number;
      }> = [];
      for (const [ip, list] of usersByIp.entries()) {
        if (list.length >= 2) {
          for (const u of list.slice(0, 6)) {
            suspiciousAccounts.push({
              uid: u.uid,
              userName: u.display_name || 'User',
              identifier: u.email || extractPublicPhone(u.phone_e164) || u.uid,
              severity: list.length >= 3 ? 'high' : 'medium',
              reason: `Shared Login IP (${list.length} accounts)`,
              details: `IP ${ip} shared across ${list.length} distinct user accounts`,
              lastSeenAt: Number(u.last_login_at || 0),
            });
          }
        }
      }
      for (const a of attemptRows) {
        if (Number(a.attempts || 0) >= 3 || Number(a.locked_until || 0) > now) {
          suspiciousAccounts.push({
            uid: a.attempt_key,
            userName: 'Auth Target',
            identifier: a.attempt_key,
            severity: Number(a.locked_until || 0) > now ? 'high' : 'medium',
            reason: Number(a.locked_until || 0) > now ? 'Rate-Limit Lockout Triggered' : 'Repeated Failed Auth Attempts',
            details: `${Number(a.attempts || 0)} failed attempt(s) recorded in current window`,
            lastSeenAt: Number(a.window_start || 0),
          });
        }
      }

      // 2. Repeated / Rejected Payment Attempts (by sender number or user)
      const paymentBuckets = new Map<
        string,
        {
          key: string;
          label: string;
          totalCount: number;
          rejectedCount: number;
          recent24hCount: number;
          totalAmountBdt: number;
          lastAttemptAt: number;
        }
      >();
      const pushPaymentRecord = (
        key: string,
        label: string,
        status: string,
        amountBdt: number,
        createdAt: number
      ) => {
        if (!key) return;
        const cur = paymentBuckets.get(key) || {
          key,
          label,
          totalCount: 0,
          rejectedCount: 0,
          recent24hCount: 0,
          totalAmountBdt: 0,
          lastAttemptAt: 0,
        };
        cur.totalCount += 1;
        if (status === 'Rejected') cur.rejectedCount += 1;
        if (createdAt >= oneDayAgo) cur.recent24hCount += 1;
        cur.totalAmountBdt += Number(amountBdt || 0);
        if (createdAt > cur.lastAttemptAt) cur.lastAttemptAt = createdAt;
        paymentBuckets.set(key, cur);
      };
      for (const p of paymentRows) {
        const parsedPay = parseJsonSafe<{ senderNumber?: string; amountBdt?: number }>(p.payload_json, {});
        const sender = String(parsedPay.senderNumber || '').trim();
        const payAmount = Number(parsedPay.amountBdt || 0);
        if (sender) {
          pushPaymentRecord(`sender:${sender}`, `Sender ${sender}`, p.status, payAmount, Number(p.created_at || 0));
        }
        pushPaymentRecord(
          `user:${p.customer_id}`,
          userLabelById.get(p.customer_id) || p.customer_id,
          p.status,
          payAmount,
          Number(p.created_at || 0)
        );
      }
      for (const tx of walletTxRows) {
        const parsed = parseJsonSafe<{ senderNumber?: string }>(tx.payload_json, {});
        const sender = String(parsed.senderNumber || '').trim();
        if (sender) {
          pushPaymentRecord(`sender:${sender}`, `Sender ${sender}`, tx.status, tx.amount_bdt, Number(tx.created_at || 0));
        }
        pushPaymentRecord(
          `user:${tx.user_id}`,
          userLabelById.get(tx.user_id) || tx.user_id,
          tx.status,
          tx.amount_bdt,
          Number(tx.created_at || 0)
        );
      }
      const repeatedPaymentAttempts = Array.from(paymentBuckets.values())
        .filter((b) => b.rejectedCount >= 2 || b.recent24hCount >= 3)
        .sort((a, b) => b.rejectedCount - a.rejectedCount || b.recent24hCount - a.recent24hCount)
        .slice(0, 30)
        .map((b) => ({
          ...b,
          reason:
            b.rejectedCount >= 2
              ? `${b.rejectedCount} rejected payment submissions`
              : `${b.recent24hCount} payment attempts within 24h`,
        }));

      // 3. Abnormal Referral Activity (flagged referrals or high-velocity burst within 24h)
      const refByReferrer = new Map<
        string,
        { total: number; last24h: number; flagged: number; lastAt: number }
      >();
      for (const r of allRefRows) {
        const cur = refByReferrer.get(r.referrer_uid) || { total: 0, last24h: 0, flagged: 0, lastAt: 0 };
        cur.total += 1;
        if (Number(r.created_at || 0) >= oneDayAgo) cur.last24h += 1;
        if (r.status === 'flagged') cur.flagged += 1;
        if (Number(r.created_at || 0) > cur.lastAt) cur.lastAt = Number(r.created_at || 0);
        refByReferrer.set(r.referrer_uid, cur);
      }
      const abnormalReferrals = Array.from(refByReferrer.entries())
        .filter(([, stats]) => stats.flagged > 0 || stats.last24h >= 3)
        .map(([referrerId, stats]) => ({
          referrerId,
          referrerLabel: userLabelById.get(referrerId) || referrerId,
          totalReferrals: stats.total,
          last24hCount: stats.last24h,
          flaggedCount: stats.flagged,
          lastReferralAt: stats.lastAt,
          reason:
            stats.flagged > 0
              ? `${stats.flagged} flagged referral(s) detected`
              : `High referral burst (${stats.last24h} in 24h)`,
        }))
        .sort((a, b) => b.flaggedCount - a.flaggedCount || b.last24hCount - a.last24hCount)
        .slice(0, 30);

      res.json({
        ok: true,
        superAdminEmail: getConfiguredSuperAdminEmail(),
        activeSessions: sessionRows.map((s) => ({
          id: s.id,
          userId: s.user_id,
          userName: s.display_name,
          userIdentifier: s.email || extractPublicPhone(s.phone_e164) || s.user_id,
          role: resolveUserRole(s.phone_e164, s.email, s.role),
          ipAddress: s.ip_address,
          userAgent: s.user_agent,
          createdAt: s.created_at,
          lastSeenAt: s.last_seen_at,
          expiresAt: s.expires_at,
          isCurrent: s.id === admin.user.sessionId,
        })),
        authAttempts: attemptRows.map((a) => ({
          key: a.attempt_key,
          attempts: Number(a.attempts || 0),
          windowStart: Number(a.window_start || 0),
          lockedUntil: Number(a.locked_until || 0),
          isLocked: Number(a.locked_until || 0) > now,
        })),
        deletionRequests: deletionRows.map((r) => parseJsonSafe(r.payload_json, {})),
        flaggedReferrals: flaggedRefRows.map((r) => parseJsonSafe(r.payload_json, {})),
        suspiciousAccounts: suspiciousAccounts.slice(0, 40),
        repeatedPaymentAttempts,
        abnormalReferrals,
      });
    } catch (err) {
      handleRouteError(res, err, 'Failed to load security telemetry.');
    }
  });

  router.post('/admin/security/revoke-session', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const body = (req.body || {}) as { sessionId?: string; targetUid?: string };
      const sessionId = String(body.sessionId || '').trim();
      const targetUid = String(body.targetUid || '').trim();

      if (sessionId) {
        const sess = await admin.db.first<{ user_id: string }>('SELECT user_id FROM sessions WHERE id = ?', [sessionId]);
        if (!sess) {
          res.status(404).json({ ok: false, error: 'Session not found.' });
          return;
        }
        await admin.db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
        await insertAuditLog(
          admin.db,
          admin.user.uid,
          getUserPrimaryIdentifier(admin.user),
          'SESSION_REVOKED',
          'sessions',
          sessionId,
          `Revoked session ${sessionId} for ${sess.user_id}`,
          { targetUserId: sess.user_id, reason: 'Admin security session revocation' }
        );
        res.json({ ok: true });
        return;
      }

      if (targetUid) {
        const targetRow = await admin.db.first<UserRow>('SELECT * FROM users WHERE uid = ?', [targetUid]);
        if (targetRow) {
          const targetRole = resolveUserRole(
            targetRow.phone_e164,
            targetRow.email_normalized || targetRow.email,
            targetRow.role
          );
          if (targetRole === 'super_admin' && targetUid !== admin.user.uid) {
            res.status(403).json({ ok: false, error: 'Cannot revoke Super Admin sessions.' });
            return;
          }
        }
        const now = Date.now();
        await admin.db.run('DELETE FROM sessions WHERE user_id = ?', [targetUid]);
        await admin.db.run('UPDATE users SET session_revoked_at = ?, updated_at = ? WHERE uid = ?', [
          now,
          now,
          targetUid,
        ]);
        await insertAuditLog(
          admin.db,
          admin.user.uid,
          getUserPrimaryIdentifier(admin.user),
          'ALL_SESSIONS_REVOKED',
          'sessions',
          targetUid,
          `Revoked all sessions for ${targetUid}`,
          { targetUserId: targetUid, reason: 'Admin forced logout across all devices' }
        );
        res.json({ ok: true });
        return;
      }

      res.status(400).json({ ok: false, error: 'sessionId or targetUid required.' });
    } catch (err) {
      handleRouteError(res, err, 'Failed to revoke session.');
    }
  });

  router.post('/admin/security/unlock-attempt', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const key = String((req.body as { key?: string })?.key || '').trim();
      if (!key) {
        res.status(400).json({ ok: false, error: 'Attempt key required.' });
        return;
      }
      await admin.db.run('DELETE FROM auth_attempts WHERE attempt_key = ?', [key]);
      await insertAuditLog(
        admin.db,
        admin.user.uid,
        getUserPrimaryIdentifier(admin.user),
        'RATE_LIMIT_UNLOCKED',
        'auth_attempts',
        key,
        `Cleared brute-force lockout for ${key}`,
        { previousValue: 'locked', newValue: 'unlocked', reason: 'Admin manual security unlock' }
      );
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to unlock attempt key.');
    }
  });

  router.post('/admin/broadcast-announcement', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as {
        titleBn?: string;
        titleEn?: string;
        messageBn?: string;
        messageEn?: string;
        type?: string;
      };
      const now = Date.now();
      const id = generateSecureId('ann', 8);
      const payload = {
        id,
        titleBn: String(body.titleBn || '').slice(0, 200),
        titleEn: String(body.titleEn || '').slice(0, 200),
        messageBn: String(body.messageBn || '').slice(0, 1000),
        messageEn: String(body.messageEn || '').slice(0, 1000),
        type: String(body.type || 'info'),
        active: true,
        createdBy: user.uid,
        createdAt: now,
      };
      await db.run(
        'INSERT INTO announcements (id, active, payload_json, created_at) VALUES (?, 1, ?, ?)',
        [id, JSON.stringify(payload), now]
      );
      await insertAuditLog(
        db,
        user.uid,
        getUserPrimaryIdentifier(user),
        'ANNOUNCEMENT_PUBLISHED',
        'announcements',
        id,
        `Published announcement: ${payload.titleEn || payload.titleBn}`,
        { newValue: payload.titleEn || payload.titleBn }
      );
      res.status(201).json({ ok: true, id });
    } catch (err) {
      handleRouteError(res, err, 'Failed to broadcast announcement.');
    }
  });

  router.post('/admin/announcements/:id/toggle', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const id = String(req.params.id || '').trim();
      const active = Boolean((req.body as { active?: boolean })?.active);
      const row = await admin.db.first<{ payload_json: string }>('SELECT payload_json FROM announcements WHERE id = ?', [
        id,
      ]);
      if (row) {
        const next = { ...parseJsonSafe<Record<string, unknown>>(row.payload_json, {}), active };
        await admin.db.run('UPDATE announcements SET active = ?, payload_json = ? WHERE id = ?', [
          active ? 1 : 0,
          JSON.stringify(next),
          id,
        ]);
      }
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to update announcement.');
    }
  });

  router.delete('/admin/announcements/:id', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const id = String(req.params.id || '').trim();
      await admin.db.run('DELETE FROM announcements WHERE id = ?', [id]);
      await insertAuditLog(
        admin.db,
        admin.user.uid,
        getUserPrimaryIdentifier(admin.user),
        'ANNOUNCEMENT_DELETED',
        'announcements',
        id,
        `Deleted announcement ${id}`
      );
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to delete announcement.');
    }
  });

  router.post('/admin/tickets/:id/reply', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const id = String(req.params.id || '').trim();
      const body = (req.body || {}) as { adminReply?: string; status?: string };
      const row = await admin.db.first<{ user_id: string; payload_json: string }>(
        'SELECT user_id, payload_json FROM support_tickets WHERE id = ?',
        [id]
      );
      if (!row) {
        res.status(404).json({ ok: false, error: 'Ticket not found' });
        return;
      }
      const now = Date.now();
      const existing = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      const status = String(body.status || 'resolved');
      const next = {
        ...existing,
        adminReply: String(body.adminReply || '').slice(0, 2000),
        status,
        updatedAt: now,
      };
      await admin.db.run(
        'UPDATE support_tickets SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?',
        [status, JSON.stringify(next), now, id]
      );
      await insertNotification(
        admin.db,
        row.user_id,
        'সাপোর্ট টিকেটের উত্তর এসেছে',
        'Support Ticket Updated',
        `আপনার টিকেট "${String(existing.subject || id)}"-এ অ্যাডমিন উত্তর দিয়েছেন।`,
        `Admin replied to your support ticket "${String(existing.subject || id)}".`,
        'system'
      );
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to reply to ticket.');
    }
  });

  router.post('/admin/settle-reward-claim', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const body = (req.body || {}) as {
        claimId?: string;
        decision?: 'approve' | 'credit' | 'reject';
        rewardBdt?: number;
        rejectionReason?: string;
        adminNote?: string;
      };
      const id = String(body.claimId || '').trim();
      const row = await admin.db.first<{ user_id: string; status: string; payload_json: string }>(
        'SELECT user_id, status, payload_json FROM rewarded_claims WHERE id = ?',
        [id]
      );
      if (!row) {
        res.status(404).json({ ok: false, error: 'Claim not found' });
        return;
      }
      if (row.status === 'Credited' || row.status === 'Rejected') {
        res.status(409).json({ ok: false, error: `Claim already settled (${row.status}).` });
        return;
      }
      const now = Date.now();
      const existing = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      const isCredit = body.decision === 'approve' || body.decision === 'credit';
      const status = isCredit ? 'Credited' : 'Rejected';
      const rewardBdt = isCredit ? Math.max(0, Number(body.rewardBdt ?? existing.amountBdt ?? 2)) : 0;
      const next = {
        ...existing,
        status,
        amountBdt: rewardBdt,
        rejectionReason: body.rejectionReason || body.adminNote || '',
        creditedBy: admin.user.uid,
        updatedAt: now,
      };
      await admin.db.run('UPDATE rewarded_claims SET status = ?, payload_json = ? WHERE id = ?', [
        status,
        JSON.stringify(next),
        id,
      ]);
      if (isCredit && rewardBdt > 0) {
        await ensureWalletAccount(admin.db, row.user_id);
        const txId = generateSecureId('rad', 8);
        await admin.db.run(
          'UPDATE wallet_accounts SET available_balance_bdt = available_balance_bdt + ?, last_tx_id = ?, updated_at = ? WHERE uid = ?',
          [rewardBdt, txId, now, row.user_id]
        );
        const wtx = {
          id: txId,
          userId: row.user_id,
          type: 'rewarded_ad',
          method: 'system',
          transactionId: id,
          amountBdt: rewardBdt,
          status: 'Approved',
          note: `Ad reward credit (${String(existing.networkName || id)})`,
          createdAt: now,
          updatedAt: now,
        };
        await admin.db.run(
          'INSERT INTO wallet_transactions (id, user_id, type, amount_bdt, status, transaction_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [txId, row.user_id, 'rewarded_ad', rewardBdt, 'Approved', id, JSON.stringify(wtx), now, now]
        );
      }
      await insertAuditLog(
        admin.db,
        admin.user.uid,
        getUserPrimaryIdentifier(admin.user),
        isCredit ? 'REWARD_CLAIM_CREDITED' : 'REWARD_CLAIM_REJECTED',
        'rewarded_claims',
        id,
        `${status} reward claim #${id} (৳${rewardBdt})`,
        {
          targetUserId: row.user_id,
          previousValue: row.status,
          newValue: status,
          reason: body.rejectionReason || body.adminNote || '',
        }
      );
      res.json({ ok: true, status });
    } catch (err) {
      handleRouteError(res, err, 'Failed to settle claim.');
    }
  });

  router.post('/admin/settle-coin-redemption', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const body = (req.body || {}) as {
        txId?: string;
        decision?: 'approve' | 'credit' | 'reject';
        amountBdt?: number;
        reason?: string;
        adminNote?: string;
      };
      const id = String(body.txId || '').trim();
      const row = await admin.db.first<{ user_id: string; status: string; coins: number; payload_json: string }>(
        'SELECT user_id, status, coins, payload_json FROM ad_reward_transactions WHERE id = ?',
        [id]
      );
      if (!row) {
        res.status(404).json({ ok: false, error: 'Redemption not found' });
        return;
      }
      if (row.status === 'Credited' || row.status === 'Rejected') {
        res.status(409).json({ ok: false, error: `Redemption already settled (${row.status}).` });
        return;
      }
      const now = Date.now();
      const existing = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      const isCredit = body.decision === 'approve' || body.decision === 'credit';
      const status = isCredit ? 'Credited' : 'Rejected';
      const next = { ...existing, status, note: body.reason || body.adminNote || existing.note || '' };
      await admin.db.run('UPDATE ad_reward_transactions SET status = ?, payload_json = ? WHERE id = ?', [
        status,
        JSON.stringify(next),
        id,
      ]);
      if (isCredit) {
        const amt = Math.max(0, Number(body.amountBdt ?? existing.bdtEquivalent ?? existing.amountBdt ?? 0));
        if (amt > 0) {
          await ensureWalletAccount(admin.db, row.user_id);
          const wtxId = generateSecureId('wer', 8);
          await admin.db.run(
            'UPDATE wallet_accounts SET available_balance_bdt = available_balance_bdt + ?, last_tx_id = ?, updated_at = ? WHERE uid = ?',
            [amt, wtxId, now, row.user_id]
          );
          const wtx = {
            id: wtxId,
            userId: row.user_id,
            type: 'watch_earn_coin_redeem',
            method: 'system',
            transactionId: id,
            amountBdt: amt,
            status: 'Approved',
            note: `Watch & Earn coin redemption (${row.coins} coins -> ৳${amt})`,
            createdAt: now,
            updatedAt: now,
          };
          await admin.db.run(
            'INSERT INTO wallet_transactions (id, user_id, type, amount_bdt, status, transaction_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [wtxId, row.user_id, 'watch_earn_coin_redeem', amt, 'Approved', id, JSON.stringify(wtx), now, now]
          );
        }
      } else if (row.coins > 0) {
        await admin.db.run(
          'UPDATE watch_earn_balances SET coins_available = coins_available + ?, coins_redeemed = MAX(0, coins_redeemed - ?), updated_at = ? WHERE user_id = ?',
          [row.coins, row.coins, now, row.user_id]
        );
      }
      res.json({ ok: true, status });
    } catch (err) {
      handleRouteError(res, err, 'Failed to settle coin redemption.');
    }
  });

  router.post('/admin/settle-referral', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const body = (req.body || {}) as {
        referralId?: string;
        decision?: 'approve' | 'credit' | 'reject' | 'revoke';
        rewardBdt?: number;
        reason?: string;
      };
      const id = String(body.referralId || '').trim();
      const row = await admin.db.first<{ referrer_uid: string; referred_uid: string; status: string; payload_json: string }>(
        'SELECT referrer_uid, referred_uid, status, payload_json FROM referrals WHERE id = ?',
        [id]
      );
      if (!row) {
        res.status(404).json({ ok: false, error: 'Referral not found' });
        return;
      }
      if (row.status === 'credited' || row.status === 'revoked') {
        res.status(409).json({ ok: false, error: `Referral already settled (${row.status}).` });
        return;
      }

      const siteSettings = await getGlobalSiteSettings(admin.db);
      const now = Date.now();
      const existing = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      const isCredit = body.decision === 'approve' || body.decision === 'credit';
      const status = isCredit ? 'credited' : 'revoked';
      const rewardBdt = Math.max(0, Number(body.rewardBdt ?? existing.rewardAmountBdt ?? siteSettings.referralBonusBdt));

      // Enforce maximum referral reward cap per referrer if configured
      if (isCredit && siteSettings.referralMaxRewardBdt > 0) {
        const creditedRows = await admin.db.all<{ payload_json: string }>(
          `SELECT payload_json FROM referrals WHERE referrer_uid = ? AND status = 'credited'`,
          [row.referrer_uid]
        );
        const alreadyEarned = creditedRows.reduce(
          (acc, r) => acc + Number(parseJsonSafe<Record<string, unknown>>(r.payload_json, {}).rewardAmountBdt || 0),
          0
        );
        if (alreadyEarned + rewardBdt > siteSettings.referralMaxRewardBdt) {
          res.status(400).json({
            ok: false,
            error: `Referrer has reached the maximum referral reward cap (৳${siteSettings.referralMaxRewardBdt}).`,
          });
          return;
        }
      }

      const next = { ...existing, status, rewardAmountBdt: rewardBdt, updatedAt: now };
      const upd = await admin.db.run(
        'UPDATE referrals SET status = ?, payload_json = ? WHERE id = ? AND status = ?',
        [status, JSON.stringify(next), id, row.status]
      );
      if (upd.changes === 0) {
        res.status(409).json({ ok: false, error: 'Referral already updated.' });
        return;
      }

      let txId = '';
      if (isCredit && rewardBdt > 0) {
        await ensureWalletAccount(admin.db, row.referrer_uid);
        txId = generateSecureId('rfr', 8);
        await admin.db.run(
          'UPDATE wallet_accounts SET available_balance_bdt = available_balance_bdt + ?, last_tx_id = ?, updated_at = ? WHERE uid = ?',
          [rewardBdt, txId, now, row.referrer_uid]
        );
        const wtx = {
          id: txId,
          userId: row.referrer_uid,
          type: 'referral',
          method: 'system',
          transactionId: id,
          amountBdt: rewardBdt,
          status: 'Approved',
          note: `Referral reward credited (${String(existing.referredEmail || row.referred_uid)})`,
          createdAt: now,
          updatedAt: now,
        };
        await admin.db.run(
          'INSERT INTO wallet_transactions (id, user_id, type, amount_bdt, status, transaction_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [txId, row.referrer_uid, 'referral', rewardBdt, 'Approved', id, JSON.stringify(wtx), now, now]
        );
        await insertNotification(
          admin.db,
          row.referrer_uid,
          'রেফারেল বোনাস যুক্ত হয়েছে!',
          'Referral Bonus Credited!',
          `আপনার রেফারেল বোনাস ৳${rewardBdt} ওয়ালেটে যুক্ত করা হয়েছে।`,
          `৳${rewardBdt} referral bonus has been credited to your wallet.`,
          'referral'
        );
      }

      await insertAuditLog(
        admin.db,
        admin.user.uid,
        getUserPrimaryIdentifier(admin.user),
        isCredit ? 'REFERRAL_CREDITED' : 'REFERRAL_REVOKED',
        'referrals',
        id,
        `${status} referral #${id} (৳${rewardBdt})`,
        {
          targetUserId: row.referrer_uid,
          previousValue: row.status,
          newValue: status,
          reason: String(body.reason || `Admin ${status} referral`),
          transactionId: txId || id,
        }
      );
      res.json({ ok: true, status });
    } catch (err) {
      handleRouteError(res, err, 'Failed to settle referral.');
    }
  });

  router.post('/admin/reviews/:id/approval', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const id = String(req.params.id || '').trim();
      const approved = Boolean((req.body as { approved?: boolean })?.approved);
      const row = await admin.db.first<{ payload_json: string }>('SELECT payload_json FROM reviews WHERE id = ?', [id]);
      if (row) {
        const next = { ...parseJsonSafe<Record<string, unknown>>(row.payload_json, {}), approved };
        await admin.db.run('UPDATE reviews SET approved = ?, payload_json = ? WHERE id = ?', [
          approved ? 1 : 0,
          JSON.stringify(next),
          id,
        ]);
      }
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to update review.');
    }
  });

  router.delete('/admin/reviews/:id', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      await admin.db.run('DELETE FROM reviews WHERE id = ?', [String(req.params.id || '').trim()]);
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to delete review.');
    }
  });

  // Public Persistent Media Serving (Package Logos & Artwork stored in D1 / SQLite)
  router.get('/media/:id', async (req, res) => {
    try {
      const mediaId = String(req.params.id || '').trim();
      if (!/^[a-zA-Z0-9_-]{6,96}$/.test(mediaId)) {
        res.status(400).json({ ok: false, error: 'Invalid media ID.' });
        return;
      }
      const db = await getAppDatabase();
      const row = await db.first<{ mime_type: string; data_base64: string; byte_size: number }>(
        'SELECT mime_type, data_base64, byte_size FROM media_assets WHERE id = ? LIMIT 1',
        [mediaId]
      );
      if (!row || !row.data_base64) {
        res.status(404).json({ ok: false, error: 'Media asset not found.' });
        return;
      }
      const binary = Buffer.from(row.data_base64, 'base64');
      res.setHeader('Content-Type', row.mime_type || 'application/octet-stream');
      res.setHeader('Content-Length', String(binary.length));
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.status(200).send(binary);
    } catch (err) {
      handleRouteError(res, err, 'Failed to serve media asset.');
    }
  });

  // Super Admin Persistent Image/Logo Upload (PNG, JPG, JPEG, WebP with strict magic-byte & size validation)
  router.post('/admin/media/upload', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const body = (req.body || {}) as { dataUrl?: string };
      const rawDataUrl = String(body.dataUrl || '').trim();
      const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(rawDataUrl);
      if (!match) {
        res.status(400).json({
          ok: false,
          error: 'Only valid PNG, JPG, JPEG, or WebP images are allowed.',
        });
        return;
      }
      const normalizedMime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
      const base64Payload = match[2];
      const binary = Buffer.from(base64Payload, 'base64');
      if (binary.length < 16) {
        res.status(400).json({ ok: false, error: 'Uploaded image file is empty or corrupted.' });
        return;
      }
      if (binary.length > 2 * 1024 * 1024) {
        res.status(413).json({ ok: false, error: 'Image file exceeds the maximum 2MB size limit.' });
        return;
      }

      // Magic-byte signature validation prevents disguised HTML/SVG/script uploads
      const isPng =
        binary.length >= 8 &&
        binary[0] === 0x89 &&
        binary[1] === 0x50 &&
        binary[2] === 0x4e &&
        binary[3] === 0x47;
      const isJpeg = binary.length >= 3 && binary[0] === 0xff && binary[1] === 0xd8 && binary[2] === 0xff;
      const isWebp =
        binary.length >= 12 &&
        binary.subarray(0, 4).toString('ascii') === 'RIFF' &&
        binary.subarray(8, 12).toString('ascii') === 'WEBP';

      const validMagic =
        (normalizedMime === 'image/png' && isPng) ||
        (normalizedMime === 'image/jpeg' && isJpeg) ||
        (normalizedMime === 'image/webp' && isWebp);

      if (!validMagic) {
        res.status(400).json({
          ok: false,
          error: 'Image binary signature does not match declared PNG/JPEG/WebP format.',
        });
        return;
      }

      const id = generateSecureId('media', 12);
      const now = Date.now();
      await admin.db.run(
        `INSERT INTO media_assets (id, mime_type, byte_size, data_base64, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [id, normalizedMime, binary.length, base64Payload, admin.user.uid, now]
      );

      await insertAuditLog(
        admin.db,
        admin.user.uid,
        getUserPrimaryIdentifier(admin.user),
        'MEDIA_UPLOADED',
        'media_assets',
        id,
        `Uploaded package logo/image (${normalizedMime}, ${Math.round(binary.length / 1024)} KB)`,
        { newValue: `/api/media/${id}` }
      );

      res.status(201).json({
        ok: true,
        id,
        url: `/api/media/${id}`,
        mimeType: normalizedMime,
        byteSize: binary.length,
        createdAt: now,
      });
    } catch (err) {
      handleRouteError(res, err, 'Failed to upload media asset.');
    }
  });

  router.delete('/admin/media/:id', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const mediaId = String(req.params.id || '').trim();
      if (!/^[a-zA-Z0-9_-]{6,96}$/.test(mediaId)) {
        res.status(400).json({ ok: false, error: 'Invalid media ID.' });
        return;
      }
      await admin.db.run('DELETE FROM media_assets WHERE id = ?', [mediaId]);
      await insertAuditLog(
        admin.db,
        admin.user.uid,
        getUserPrimaryIdentifier(admin.user),
        'MEDIA_DELETED',
        'media_assets',
        mediaId,
        `Deleted uploaded media asset ${mediaId}`
      );
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to delete media asset.');
    }
  });

  // Safe Sanitized Full Database Backup Export (Never includes password hashes, recovery hashes, or session token hashes)
  router.get('/admin/backup/export', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db } = admin;
      const [
        userRows,
        walletRows,
        walletTxRows,
        orderRows,
        paymentRows,
        withdrawalRows,
        referralRows,
        paymentMethodRows,
        overrideRows,
        announcementRows,
        ticketRows,
        reviewRows,
        auditRows,
        adStatRows,
        mediaMetaRows,
      ] = await Promise.all([
        db.all<{
          uid: string;
          display_name: string;
          email: string;
          phone_e164: string | null;
          auth_method: string;
          role: string;
          status: string;
          referral_code: string;
          referred_by: string;
          promotional_credits: number;
          last_login_at: number;
          created_at: number;
          updated_at: number;
        }>(
          `SELECT uid, display_name, email, phone_e164, auth_method, role, status, referral_code, referred_by,
                  promotional_credits, last_login_at, created_at, updated_at
           FROM users ORDER BY created_at DESC LIMIT 5000`
        ),
        db.all<Record<string, unknown>>('SELECT * FROM wallet_accounts ORDER BY updated_at DESC LIMIT 5000'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM wallet_transactions ORDER BY created_at DESC LIMIT 5000'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM orders ORDER BY created_at DESC LIMIT 5000'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM payments ORDER BY created_at DESC LIMIT 5000'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM withdrawals ORDER BY created_at DESC LIMIT 5000'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM referrals ORDER BY created_at DESC LIMIT 5000'),
        db.all<Record<string, unknown>>('SELECT * FROM payment_methods ORDER BY sort_order ASC LIMIT 100'),
        db.all<{ collection: string; doc_id: string; deleted: number; payload_json: string; updated_at: number }>(
          'SELECT collection, doc_id, deleted, payload_json, updated_at FROM catalog_overrides ORDER BY collection ASC, updated_at DESC LIMIT 2000'
        ),
        db.all<{ payload_json: string }>('SELECT payload_json FROM announcements ORDER BY created_at DESC LIMIT 500'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM support_tickets ORDER BY created_at DESC LIMIT 1000'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM reviews ORDER BY created_at DESC LIMIT 1000'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM audit_logs ORDER BY created_at DESC LIMIT 2000'),
        db.all<Record<string, unknown>>('SELECT * FROM ad_stats ORDER BY last_event_at DESC LIMIT 500'),
        db.all<{ id: string; mime_type: string; byte_size: number; uploaded_by: string; created_at: number }>(
          'SELECT id, mime_type, byte_size, uploaded_by, created_at FROM media_assets ORDER BY created_at DESC LIMIT 1000'
        ),
      ]);

      const now = Date.now();
      await insertAuditLog(
        db,
        admin.user.uid,
        getUserPrimaryIdentifier(admin.user),
        'DATABASE_BACKUP_EXPORTED',
        'system',
        `backup_${now}`,
        `Exported sanitized full database backup (${userRows.length} users, ${orderRows.length} orders, ${overrideRows.length} catalog overrides)`
      );

      res.json({
        ok: true,
        backup: {
          platform: 'DIGITAL HUB BD',
          schemaVersion: '4.0',
          exportedAt: now,
          exportedBy: getUserPrimaryIdentifier(admin.user),
          counts: {
            users: userRows.length,
            wallets: walletRows.length,
            walletTransactions: walletTxRows.length,
            orders: orderRows.length,
            payments: paymentRows.length,
            withdrawals: withdrawalRows.length,
            referrals: referralRows.length,
            catalogOverrides: overrideRows.length,
            auditLogs: auditRows.length,
            mediaAssets: mediaMetaRows.length,
          },
          users: userRows.map((u) => ({
            uid: u.uid,
            displayName: u.display_name,
            email: u.email,
            phone: extractPublicPhone(u.phone_e164),
            authMethod: u.auth_method || 'phone',
            role: resolveUserRole(u.phone_e164, u.email, u.role),
            status: u.status,
            referralCode: u.referral_code,
            referredBy: u.referred_by,
            promotionalCredits: Number(u.promotional_credits || 0),
            lastLoginAt: Number(u.last_login_at || 0),
            createdAt: Number(u.created_at || 0),
            updatedAt: Number(u.updated_at || 0),
          })),
          wallets: walletRows,
          walletTransactions: walletTxRows.map((r) => parseJsonSafe(r.payload_json, {})),
          orders: orderRows.map((r) => parseJsonSafe(r.payload_json, {})),
          payments: paymentRows.map((r) => parseJsonSafe(r.payload_json, {})),
          withdrawals: withdrawalRows.map((r) => parseJsonSafe(r.payload_json, {})),
          referrals: referralRows.map((r) => parseJsonSafe(r.payload_json, {})),
          paymentMethods: paymentMethodRows,
          catalogOverrides: overrideRows.map((r) => ({
            collection: r.collection,
            docId: r.doc_id,
            deleted: Boolean(r.deleted),
            updatedAt: Number(r.updated_at || 0),
            data: parseJsonSafe(r.payload_json, {}),
          })),
          announcements: announcementRows.map((r) => parseJsonSafe(r.payload_json, {})),
          tickets: ticketRows.map((r) => parseJsonSafe(r.payload_json, {})),
          reviews: reviewRows.map((r) => parseJsonSafe(r.payload_json, {})),
          auditLogs: auditRows.map((r) => parseJsonSafe(r.payload_json, {})),
          adStats: adStatRows,
          mediaAssets: mediaMetaRows.map((m) => ({
            id: m.id,
            url: `/api/media/${m.id}`,
            mimeType: m.mime_type,
            byteSize: Number(m.byte_size || 0),
            uploadedBy: m.uploaded_by,
            createdAt: Number(m.created_at || 0),
          })),
        },
      });
    } catch (err) {
      handleRouteError(res, err, 'Failed to generate database backup.');
    }
  });

  const isSafePackageAssetUrl = (val: unknown): boolean => {
    if (val === undefined || val === null || val === '') return true;
    const s = String(val).trim();
    if (!s) return true;
    return (
      s.startsWith('/api/media/') ||
      s.startsWith('/assets/') ||
      s.startsWith('https://') ||
      /^data:image\/(?:png|jpeg|jpg|webp);base64,/i.test(s)
    );
  };

  router.post('/admin/catalog/:collection', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const col = String(req.params.collection || '').trim();
      const allowed = new Set([
        'categories',
        'products',
        'advertisements',
        'adNetworks',
        'managedAdUnits',
        'banners',
        'coupons',
        'settings',
        'adRevenueEntries',
      ]);
      if (!allowed.has(col)) {
        res.status(400).json({ ok: false, error: 'Unsupported collection.' });
        return;
      }
      const body = (req.body || {}) as {
        id?: string;
        data?: Record<string, unknown>;
        auditAction?: string;
        auditReason?: string;
        previousSnapshot?: Record<string, unknown>;
      };
      const docId = String(body.id || '').trim().slice(0, 128);
      if (!docId || !body.data) {
        res.status(400).json({ ok: false, error: 'Missing doc id or data.' });
        return;
      }
      const now = Date.now();
      let payloadToSave: Record<string, unknown> = { ...body.data, id: docId, updatedAt: now };

      if (col === 'products') {
        const existingRow = await admin.db.first<{ payload_json: string; deleted: number }>(
          'SELECT payload_json, deleted FROM catalog_overrides WHERE collection = ? AND doc_id = ? LIMIT 1',
          ['products', docId]
        );
        const existingData =
          existingRow && Number(existingRow.deleted) === 0
            ? parseJsonSafe<Record<string, unknown>>(existingRow.payload_json, {})
            : body.previousSnapshot && typeof body.previousSnapshot === 'object'
              ? body.previousSnapshot
              : null;

        const titleEn = String(body.data.titleEn || body.data.titleBn || '').trim();
        const titleBn = String(body.data.titleBn || body.data.titleEn || '').trim();
        if (titleEn.length < 2) {
          res.status(400).json({ ok: false, error: 'Package name must be at least 2 characters.' });
          return;
        }
        const priceBdt = Number(body.data.priceBdt);
        if (!Number.isFinite(priceBdt) || priceBdt < 1 || priceBdt > 10000000) {
          res.status(400).json({ ok: false, error: 'Package price must be a valid amount of at least ৳1.' });
          return;
        }
        const rawOrigPrice = Number(body.data.originalPriceBdt ?? body.data.regularPriceBdt ?? 0);
        const originalPriceBdt = Number.isFinite(rawOrigPrice) && rawOrigPrice > 0 ? Math.round(rawOrigPrice) : 0;
        const cleanPriceBdt = Math.round(priceBdt);
        const computedDiscount =
          originalPriceBdt > cleanPriceBdt
            ? Math.min(95, Math.max(1, Math.round(((originalPriceBdt - cleanPriceBdt) / originalPriceBdt) * 100)))
            : 0;

        if (
          !isSafePackageAssetUrl(body.data.customLogoUrl) ||
          !isSafePackageAssetUrl(body.data.imageUrl) ||
          !isSafePackageAssetUrl(body.data.bannerUrl)
        ) {
          res.status(400).json({
            ok: false,
            error: 'Invalid package logo or image URL. Upload a valid PNG, JPG, JPEG, or WebP image.',
          });
          return;
        }

        const existingCreatedAt =
          typeof existingData?.createdAt === 'number' && existingData.createdAt > 0
            ? existingData.createdAt
            : typeof body.data.createdAt === 'number' && body.data.createdAt > 0
              ? body.data.createdAt
              : now;

        const featuresList = Array.isArray(body.data.features)
          ? body.data.features
              .map((f) => String(f || '').trim().slice(0, 200))
              .filter(Boolean)
              .slice(0, 30)
          : undefined;

        payloadToSave = {
          ...body.data,
          id: docId,
          titleEn: titleEn.slice(0, 160),
          titleBn: titleBn.slice(0, 160),
          priceBdt: cleanPriceBdt,
          originalPriceBdt,
          regularPriceBdt: originalPriceBdt || cleanPriceBdt,
          discountPercent: computedDiscount,
          currency: 'BDT',
          ...(featuresList ? { features: featuresList } : {}),
          createdAt: existingCreatedAt,
          updatedAt: now,
        };

        await admin.db.run(
          `INSERT INTO catalog_overrides (collection, doc_id, deleted, payload_json, updated_at)
           VALUES (?, ?, 0, ?, ?)
           ON CONFLICT(collection, doc_id) DO UPDATE SET deleted = 0, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
          [col, docId, JSON.stringify(payloadToSave), now]
        );

        const prevPrice = existingData ? Number(existingData.priceBdt || 0) : 0;
        const prevLogo = existingData ? String(existingData.customLogoUrl || existingData.imageUrl || '') : '';
        const nextLogo = String(payloadToSave.customLogoUrl || payloadToSave.imageUrl || '');
        const prevActive = existingData ? Boolean(existingData.active) : true;
        const nextActive = Boolean(payloadToSave.active);

        let auditType = 'PACKAGE_UPDATED';
        let prevVal = existingData ? String(existingData.titleEn || docId) : '';
        let newVal = `${titleEn} (৳${cleanPriceBdt})`;
        let summary = `Updated package "${titleEn}" (ID: ${docId})`;

        if (body.auditAction === 'create' || (!existingData && body.auditAction !== 'duplicate')) {
          auditType = 'PACKAGE_CREATED';
          prevVal = '';
          summary = `Created new package "${titleEn}" at ৳${cleanPriceBdt}`;
        } else if (body.auditAction === 'duplicate') {
          auditType = 'PACKAGE_DUPLICATED';
          summary = `Duplicated package into "${titleEn}" (${docId})`;
        } else if (body.auditAction === 'price_change' || (existingData && prevPrice > 0 && prevPrice !== cleanPriceBdt)) {
          auditType = 'PACKAGE_PRICE_CHANGED';
          prevVal = `৳${prevPrice}`;
          newVal = `৳${cleanPriceBdt}${originalPriceBdt > cleanPriceBdt ? ` (was ৳${originalPriceBdt}, -${computedDiscount}%)` : ''}`;
          summary = `Changed price of "${titleEn}" from ৳${prevPrice} to ৳${cleanPriceBdt}`;
        } else if (body.auditAction === 'logo_change' || (existingData && prevLogo !== nextLogo)) {
          auditType = 'PACKAGE_LOGO_CHANGED';
          prevVal = prevLogo.slice(0, 120);
          newVal = nextLogo.slice(0, 120);
          summary = `Updated package logo for "${titleEn}"`;
        } else if (body.auditAction === 'status_change' || (existingData && prevActive !== nextActive)) {
          auditType = 'PACKAGE_STATUS_CHANGED';
          prevVal = prevActive ? 'active' : 'inactive';
          newVal = nextActive ? 'active' : 'inactive';
          summary = `${nextActive ? 'Activated' : 'Deactivated'} package "${titleEn}"`;
        } else if (body.auditAction === 'duration_change') {
          auditType = 'PACKAGE_DURATION_CHANGED';
          newVal = String(payloadToSave.durationLabelEn || payloadToSave.validityEn || '');
          summary = `Updated duration for "${titleEn}"`;
        } else if (body.auditAction === 'features_change') {
          auditType = 'PACKAGE_FEATURES_CHANGED';
          newVal = `${featuresList?.length || 0} feature(s)`;
          summary = `Updated features list for "${titleEn}"`;
        }

        await insertAuditLog(
          admin.db,
          admin.user.uid,
          getUserPrimaryIdentifier(admin.user),
          auditType,
          'products',
          docId,
          summary,
          {
            previousValue: prevVal,
            newValue: newVal,
            reason: String(body.auditReason || '').trim().slice(0, 240),
          }
        );

        res.json({ ok: true, id: docId, data: payloadToSave });
        return;
      }

      await admin.db.run(
        `INSERT INTO catalog_overrides (collection, doc_id, deleted, payload_json, updated_at)
         VALUES (?, ?, 0, ?, ?)
         ON CONFLICT(collection, doc_id) DO UPDATE SET deleted = 0, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
        [col, docId, JSON.stringify(payloadToSave), now]
      );
      if (col === 'settings' || col === 'advertisements' || col === 'banners' || col === 'managedAdUnits' || col === 'categories') {
        await insertAuditLog(
          admin.db,
          admin.user.uid,
          getUserPrimaryIdentifier(admin.user),
          col === 'settings' ? 'SETTINGS_UPDATED' : `${col.toUpperCase()}_SAVED`,
          col,
          docId,
          `Saved ${col}/${docId}`,
          { newValue: String((body.data as { siteName?: string; titleEn?: string; titleBn?: string }).siteName || (body.data as { titleEn?: string }).titleEn || docId) }
        );
      }
      res.json({ ok: true, id: docId });
    } catch (err) {
      handleRouteError(res, err, 'Failed to save catalog item.');
    }
  });

  router.delete('/admin/catalog/:collection/:docId', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const col = String(req.params.collection || '').trim();
      const docId = String(req.params.docId || '').trim();
      const now = Date.now();
      const existingRow = await admin.db.first<{ payload_json: string }>(
        'SELECT payload_json FROM catalog_overrides WHERE collection = ? AND doc_id = ? LIMIT 1',
        [col, docId]
      );
      const existingPayload = existingRow ? parseJsonSafe<Record<string, unknown>>(existingRow.payload_json, {}) : null;

      await admin.db.run(
        `INSERT INTO catalog_overrides (collection, doc_id, deleted, payload_json, updated_at)
         VALUES (?, ?, 1, '{}', ?)
         ON CONFLICT(collection, doc_id) DO UPDATE SET deleted = 1, updated_at = excluded.updated_at`,
        [col, docId, now]
      );
      await insertAuditLog(
        admin.db,
        admin.user.uid,
        getUserPrimaryIdentifier(admin.user),
        col === 'products' ? 'PACKAGE_DELETED' : `${col.toUpperCase()}_DELETED`,
        col,
        docId,
        col === 'products'
          ? `Deleted package "${String(existingPayload?.titleEn || docId)}" (${docId})`
          : `Deleted ${col}/${docId}`,
        {
          previousValue: existingPayload ? String(existingPayload.titleEn || docId) : docId,
        }
      );
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to delete catalog item.');
    }
  });

  return router;
}
