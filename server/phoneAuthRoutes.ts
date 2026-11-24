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
import {
  dispatchAdminDevicesPush,
  dispatchBroadcastPush,
  dispatchCustomerPush,
  getOrCreateVapidConfig,
  getUserNotificationPreferences,
  PushSubscriptionRow,
  saveUserNotificationPreferences,
} from './webPush.ts';

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
  is_verified?: number | null;
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
  adsEnabled: boolean;
  watchEarnEnabled: boolean;
  rewardedAdEnabled: boolean;
  watchEarnCoinsPerAd: number;
  watchEarnCoinsPerBdt: number;
  watchEarnDailyCoinLimit: number;
  rewardedAdDailyLimit: number;
  watchEarnMinRedeemCoins: number;
  heroAutoPlayMs: number;
  dailyRewardEnabled: boolean;
  dailyRewardCoins: number;
  streakEnabled: boolean;
  streakDay7BonusCoins: number;
}

function getDhakaDateString(ms: number = Date.now()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(ms));
  } catch {
    return new Date(ms + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
}

function isAnnouncementActiveNow(raw: Record<string, unknown>, todayDhaka: string): boolean {
  if (!raw || raw.active === false) return false;
  const startDate = typeof raw.startDate === 'string' ? raw.startDate.trim() : '';
  const expiresAt = typeof raw.expiresAt === 'string' ? raw.expiresAt.trim() : '';
  if (startDate && startDate > todayDhaka) return false;
  if (expiresAt && expiresAt < todayDhaka) return false;
  return true;
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

async function syncPaymentMethodToSettings(
  db: AppDatabase,
  pmCode: string,
  accountNumber: string,
  accountName: string,
  enabled: boolean
): Promise<void> {
  const normalizedCode = pmCode.trim().toLowerCase();
  if (normalizedCode !== 'bkash' && normalizedCode !== 'nagad' && normalizedCode !== 'rocket') {
    return;
  }
  const now = Date.now();
  const row = await db.first<{ payload_json: string }>(
    `SELECT payload_json FROM catalog_overrides WHERE collection = 'settings' AND doc_id = 'global' AND deleted = 0 LIMIT 1`
  );
  const current = row ? parseJsonSafe<Record<string, unknown>>(row.payload_json, {}) : { id: 'global' };
  const next: Record<string, unknown> = { ...current, id: 'global', updatedAt: now };
  if (normalizedCode === 'bkash') {
    next.bkashNumber = accountNumber;
    if (accountName) next.bkashType = accountName;
    next.bkashEnabled = enabled;
  } else if (normalizedCode === 'nagad') {
    next.nagadNumber = accountNumber;
    if (accountName) next.nagadType = accountName;
    next.nagadEnabled = enabled;
  } else if (normalizedCode === 'rocket') {
    next.rocketNumber = accountNumber;
    if (accountName) next.rocketType = accountName;
    next.rocketEnabled = enabled;
  }
  await db.run(
    `INSERT INTO catalog_overrides (collection, doc_id, deleted, payload_json, updated_at)
     VALUES ('settings', 'global', 0, ?, ?)
     ON CONFLICT(collection, doc_id) DO UPDATE SET deleted = 0, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
    [JSON.stringify(next), now]
  );
}

async function syncSettingsToPaymentMethods(
  db: AppDatabase,
  settingsData: Record<string, unknown>
): Promise<void> {
  const now = Date.now();
  const mappings: Array<{ code: 'bkash' | 'nagad' | 'rocket'; numberKey: string; typeKey: string; enabledKey: string }> = [
    { code: 'bkash', numberKey: 'bkashNumber', typeKey: 'bkashType', enabledKey: 'bkashEnabled' },
    { code: 'nagad', numberKey: 'nagadNumber', typeKey: 'nagadType', enabledKey: 'nagadEnabled' },
    { code: 'rocket', numberKey: 'rocketNumber', typeKey: 'rocketType', enabledKey: 'rocketEnabled' },
  ];
  for (const m of mappings) {
    const rawNumber = typeof settingsData[m.numberKey] === 'string' ? settingsData[m.numberKey] as string : '';
    const rawType = typeof settingsData[m.typeKey] === 'string' ? settingsData[m.typeKey] as string : '';
    const hasEnabledFlag = typeof settingsData[m.enabledKey] === 'boolean';
    if (!rawNumber.trim() && !rawType.trim() && !hasEnabledFlag) continue;
    const existing = await db.first<PaymentMethodRow>(
      'SELECT * FROM payment_methods WHERE code = ? LIMIT 1',
      [m.code]
    );
    if (!existing) continue;
    await db.run(
      `UPDATE payment_methods
       SET account_number = ?, account_name = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
      [
        rawNumber.trim() ? rawNumber.trim().slice(0, 120) : existing.account_number,
        rawType.trim() ? rawType.trim().slice(0, 120) : existing.account_name,
        hasEnabledFlag ? (settingsData[m.enabledKey] ? 1 : 0) : existing.enabled,
        now,
        existing.id,
      ]
    );
  }
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
    adsEnabled: raw.adsEnabled !== false,
    watchEarnEnabled: raw.watchEarnEnabled !== false,
    rewardedAdEnabled: raw.rewardedAdEnabled !== false,
    watchEarnCoinsPerAd: Math.max(1, Math.floor(Number(raw.watchEarnCoinsPerAd ?? 5) || 5)),
    watchEarnCoinsPerBdt: Math.max(1, Number(raw.watchEarnCoinsPerBdt ?? 10) || 10),
    watchEarnDailyCoinLimit: Math.max(10, Math.floor(Number(raw.watchEarnDailyCoinLimit ?? 100) || 100)),
    rewardedAdDailyLimit: Math.min(20, Math.max(1, Math.floor(Number(raw.rewardedAdDailyLimit ?? 10) || 10))),
    watchEarnMinRedeemCoins: Math.max(10, Math.floor(Number(raw.watchEarnMinRedeemCoins ?? 50) || 50)),
    heroAutoPlayMs: Math.min(20000, Math.max(2000, Math.floor(Number(raw.heroAutoPlayMs ?? 5500) || 5500))),
    dailyRewardEnabled: raw.dailyRewardEnabled !== false,
    dailyRewardCoins: Math.min(10000, Math.max(1, Math.floor(Number(raw.dailyRewardCoins ?? 10) || 10))),
    streakEnabled: raw.streakEnabled !== false,
    streakDay7BonusCoins: Math.min(10000, Math.max(0, Math.floor(Number(raw.streakDay7BonusCoins ?? 20) || 0))),
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
    verified: Number(row.is_verified || 0) === 1,
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
    verified: Number(row.is_verified || 0) === 1,
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
  coinsAvailable: number;
  coinsLifetimeEarned: number;
  coinsRedeemed: number;
  lastTxId: string;
  updatedAt: number;
}> {
  const [existing, coinBal] = await Promise.all([
    db.first<{
      uid: string;
      available_balance_bdt: number;
      promotional_credits_bdt: number;
      total_added_bdt: number;
      total_spent_bdt: number;
      last_tx_id: string;
      updated_at: number;
    }>('SELECT * FROM wallet_accounts WHERE uid = ?', [uid]),
    db.first<{
      coins_available: number;
      coins_lifetime_earned: number;
      coins_redeemed: number;
    }>('SELECT coins_available, coins_lifetime_earned, coins_redeemed FROM watch_earn_balances WHERE user_id = ?', [
      uid,
    ]),
  ]);

  const coinsAvailable = Number(coinBal?.coins_available || 0);
  const coinsLifetimeEarned = Number(coinBal?.coins_lifetime_earned || 0);
  const coinsRedeemed = Number(coinBal?.coins_redeemed || 0);

  if (existing) {
    return {
      uid: existing.uid,
      availableBalanceBdt: Number(existing.available_balance_bdt || 0),
      promotionalCreditsBdt: Number(existing.promotional_credits_bdt || 0),
      totalAddedBdt: Number(existing.total_added_bdt || 0),
      totalSpentBdt: Number(existing.total_spent_bdt || 0),
      coinsAvailable,
      coinsLifetimeEarned,
      coinsRedeemed,
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
    coinsAvailable,
    coinsLifetimeEarned,
    coinsRedeemed,
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
  type:
    | 'order'
    | 'payment'
    | 'wallet'
    | 'referral'
    | 'system'
    | 'promo'
    | 'new_app'
    | 'app_update'
    | 'announcement'
    | 'download'
    | 'support'
    | 'reward',
  options?: {
    link?: string;
    meta?: Record<string, unknown>;
  }
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
    ...(options?.link ? { link: options.link } : {}),
    ...(options?.meta ? { meta: options.meta } : {}),
    read: false,
    createdAt: now,
  };
  await db.run(
    'INSERT INTO notifications (id, user_id, is_read, payload_json, created_at) VALUES (?, ?, 0, ?, ?)',
    [id, userId, JSON.stringify(payload), now]
  );
}

async function notifyAdminsNewOrder(
  db: AppDatabase,
  params: {
    orderId: string;
    orderNumber: string;
    customerId: string;
    customerName: string;
    productTitleEn: string;
    selectedPackageName?: string;
    totalPriceBdt: number;
    paymentMethod: string;
    createdAt: number;
  }
): Promise<void> {
  try {
    const deepLink = `/?route=admin&section=orders&orderId=${encodeURIComponent(params.orderId)}`;
    const orderTimeStr = new Date(params.createdAt).toLocaleString('en-US', {
      timeZone: 'Asia/Dhaka',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
    const serviceLabel = params.selectedPackageName
      ? `${params.productTitleEn} (${params.selectedPackageName})`
      : params.productTitleEn;
    const methodLabel = params.paymentMethod.toUpperCase();
    const pushBody = `${params.customerName} (${params.customerId}) • #${params.orderNumber} • ${serviceLabel} • ৳${params.totalPriceBdt} via ${methodLabel} • ${orderTimeStr}`;

    const superEmail = getConfiguredSuperAdminEmail().toLowerCase();
    const adminUsers = await db.all<{ uid: string }>(
      `SELECT uid FROM users WHERE status = 'active' AND (role IN ('admin', 'super_admin') OR LOWER(COALESCE(email_normalized, email)) = ?) LIMIT 50`,
      [superEmail]
    );
    const seenUids = new Set<string>();
    for (const au of adminUsers) {
      if (!au.uid || seenUids.has(au.uid)) continue;
      seenUids.add(au.uid);
      await insertNotification(
        db,
        au.uid,
        'DIGITAL HUB — নতুন অর্ডার এসেছে!',
        'DIGITAL HUB — NEW ORDER!',
        `${params.customerName} (${params.customerId}) • #${params.orderNumber} • ${serviceLabel} • ৳${params.totalPriceBdt} (${methodLabel})`,
        pushBody,
        'order',
        {
          link: deepLink,
          meta: {
            orderId: params.orderId,
            orderNumber: params.orderNumber,
            isAdminAlert: true,
          },
        }
      );
    }

    await dispatchAdminDevicesPush(
      db,
      {
        title: 'DIGITAL HUB — NEW ORDER!',
        body: pushBody,
        url: deepLink,
        tag: `admin-order-${params.orderNumber}`,
        orderId: params.orderId,
        category: 'order',
        requireInteraction: true,
      },
      `new_order_${params.orderId}`
    );
  } catch {
    // Non-blocking admin alert
  }
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

const VALID_ANALYTICS_EVENT_TYPES = new Set([
  'page_view',
  'homepage_view',
  'app_view',
  'game_view',
  'product_view',
  'service_view',
  'download_click',
  'app_download',
  'external_link_click',
  'play_click',
  'search',
  'favorite',
  'heartbeat',
  'signup',
  'login',
  'order_created',
  'order_completed',
]);

function getDhakaDayStartMs(ms: number = Date.now()): number {
  const dateStr = getDhakaDateString(ms);
  const parsed = Date.parse(`${dateStr}T00:00:00+06:00`);
  if (Number.isFinite(parsed)) return parsed;
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function getDhakaMonthStartMs(ms: number = Date.now()): number {
  const dateStr = getDhakaDateString(ms).slice(0, 7);
  const parsed = Date.parse(`${dateStr}-01T00:00:00+06:00`);
  if (Number.isFinite(parsed)) return parsed;
  const d = new Date(ms);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function parseUserAgentMetadata(uaRaw: unknown): {
  deviceType: 'mobile' | 'tablet' | 'desktop';
  browser: string;
  os: string;
  isLikelyBot: boolean;
} {
  const ua = typeof uaRaw === 'string' ? uaRaw : '';
  const lower = ua.toLowerCase();
  const isLikelyBot =
    !ua ||
    /(bot|crawler|spider|slurp|bingpreview|headlesschrome|lighthouse|pingdom|uptimerobot|curl\/|wget\/|python-requests|go-http-client)/i.test(
      ua
    );

  let deviceType: 'mobile' | 'tablet' | 'desktop' = 'desktop';
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua)) {
    deviceType = 'tablet';
  } else if (/mobile|iphone|ipod|android.*mobile|windows phone|blackberry|opera mini|iemobile/i.test(ua)) {
    deviceType = 'mobile';
  }

  let browser = 'Other';
  if (lower.includes('edg/') || lower.includes('edga/') || lower.includes('edgios/')) browser = 'Edge';
  else if (lower.includes('opr/') || lower.includes('opera')) browser = 'Opera';
  else if (lower.includes('samsungbrowser/')) browser = 'Samsung Internet';
  else if (lower.includes('ucbrowser/')) browser = 'UC Browser';
  else if (lower.includes('firefox/') || lower.includes('fxios/')) browser = 'Firefox';
  else if (lower.includes('chrome/') || lower.includes('crios/')) browser = 'Chrome';
  else if (lower.includes('safari/') && !lower.includes('chrome')) browser = 'Safari';

  let os = 'Other';
  if (lower.includes('android')) os = 'Android';
  else if (lower.includes('iphone') || lower.includes('ipad') || lower.includes('ipod')) os = 'iOS';
  else if (lower.includes('windows nt')) os = 'Windows';
  else if (lower.includes('mac os x') || lower.includes('macintosh')) os = 'macOS';
  else if (lower.includes('cros')) os = 'ChromeOS';
  else if (lower.includes('linux')) os = 'Linux';

  return { deviceType, browser, os, isLikelyBot };
}

function extractServerCountry(req: express.Request): string {
  const raw = req.headers['cf-ipcountry'];
  if (typeof raw !== 'string') return '';
  const code = raw.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return '';
  return code;
}

async function logServerAnalyticsEvent(
  db: AppDatabase,
  req: express.Request,
  params: {
    visitorId?: string;
    sessionId?: string;
    userId?: string;
    eventType: string;
    pagePath?: string;
    appId?: string;
    contentId?: string;
    contentType?: string;
    contentCategory?: string;
    deviceTypeHint?: string;
    referrerHost?: string;
    metadata?: Record<string, unknown>;
    now?: number;
  }
): Promise<string | null> {
  try {
    const eventType = VALID_ANALYTICS_EVENT_TYPES.has(params.eventType) ? params.eventType : 'page_view';
    const uaMeta = parseUserAgentMetadata(req.headers['user-agent']);
    const now = params.now || Date.now();
    const visitorId =
      String(params.visitorId || params.userId || `srv_${now}`)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 64) || `srv_${now}`;
    const sessionId =
      String(params.sessionId || `sess_${visitorId.slice(0, 24)}`)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 64) || `sess_${visitorId.slice(0, 24)}`;
    const userId = String(params.userId || '').trim().slice(0, 80);
    const pagePath = String(params.pagePath || '/').trim().slice(0, 140) || '/';
    const appId = String(params.appId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const contentId =
      String(params.contentId || appId || '')
        .trim()
        .replace(/[^a-zA-Z0-9_.:-]/g, '')
        .slice(0, 100);
    const contentType = String(params.contentType || (appId ? 'app' : '')).trim().slice(0, 32);
    const contentCategory = String(params.contentCategory || '').trim().slice(0, 64);
    const deviceType =
      params.deviceTypeHint === 'mobile' || params.deviceTypeHint === 'tablet' || params.deviceTypeHint === 'desktop'
        ? params.deviceTypeHint
        : uaMeta.deviceType;
    const referrerHost = String(params.referrerHost || 'direct').trim().slice(0, 80) || 'direct';
    const country = extractServerCountry(req);
    const metadataJson = JSON.stringify(params.metadata || {}).slice(0, 1200);
    const id = generateSecureId('evt', 10);

    await db.run(
      `INSERT INTO analytics_events (
        id, visitor_id, session_id, user_id, event_type, page_path, app_id,
        content_id, content_type, content_category, device_type, browser, os, country, referrer_host, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        visitorId,
        sessionId,
        userId,
        eventType,
        pagePath,
        appId,
        contentId,
        contentType,
        contentCategory,
        deviceType,
        uaMeta.browser,
        uaMeta.os,
        country,
        referrerHost,
        metadataJson,
        now,
      ]
    );

    const priorRow = await db.first<{ cnt: number }>(
      `SELECT COUNT(*) AS cnt FROM visitor_sessions WHERE visitor_id = ? AND session_id != ?`,
      [visitorId, sessionId]
    );
    const isReturning = Number(priorRow?.cnt || 0) > 0 ? 1 : 0;

    await db.run(
      `INSERT INTO visitor_sessions (
        session_id, visitor_id, user_id, first_seen_at, last_seen_at, visit_count, is_returning,
        current_page, last_event_type, last_content_id, device_type, browser, os, referrer_host, country
      ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        user_id = CASE WHEN excluded.user_id != '' THEN excluded.user_id ELSE visitor_sessions.user_id END,
        last_seen_at = excluded.last_seen_at,
        visit_count = visitor_sessions.visit_count + CASE WHEN excluded.last_event_type = 'heartbeat' THEN 0 ELSE 1 END,
        is_returning = CASE WHEN visitor_sessions.is_returning = 1 OR excluded.is_returning = 1 THEN 1 ELSE 0 END,
        current_page = CASE WHEN excluded.current_page != '' THEN excluded.current_page ELSE visitor_sessions.current_page END,
        last_event_type = CASE WHEN excluded.last_event_type = 'heartbeat' THEN visitor_sessions.last_event_type ELSE excluded.last_event_type END,
        last_content_id = CASE WHEN excluded.last_content_id != '' THEN excluded.last_content_id ELSE visitor_sessions.last_content_id END,
        device_type = excluded.device_type,
        browser = excluded.browser,
        os = excluded.os,
        country = CASE WHEN excluded.country != '' THEN excluded.country ELSE visitor_sessions.country END`,
      [
        sessionId,
        visitorId,
        userId,
        now,
        now,
        isReturning,
        pagePath,
        eventType,
        contentId,
        deviceType,
        uaMeta.browser,
        uaMeta.os,
        referrerHost,
        country,
      ]
    );

    return id;
  } catch {
    return null;
  }
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

      await logServerAnalyticsEvent(db, req, {
        userId: uid,
        eventType: 'signup',
        pagePath: '/auth/register',
        referrerHost: 'direct',
        metadata: { authMethod },
        now,
      });

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

      await logServerAnalyticsEvent(db, req, {
        userId: userRow.uid,
        eventType: 'login',
        pagePath: '/auth/login',
        referrerHost: 'direct',
        metadata: { authMethod },
        now,
      });

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
        favoriteRows,
        downloadCountRow,
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
        db.all<{ app_id: string }>(
          'SELECT app_id FROM app_favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
          [user.uid]
        ),
        db.first<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM analytics_events WHERE user_id = ? AND event_type IN ('app_download', 'download_click')`,
          [user.uid]
        ),
      ]);

      const downloadHistoryRows = await db.all<{
        id: string;
        app_id: string;
        content_id: string;
        content_type: string;
        page_path: string;
        device_type: string;
        event_type: string;
        created_at: number;
      }>(
        `SELECT id, app_id, content_id, content_type, page_path, device_type, event_type, created_at
         FROM analytics_events
         WHERE user_id = ? AND event_type IN ('app_download', 'download_click', 'play_click')
         ORDER BY created_at DESC
         LIMIT 50`,
        [user.uid]
      );

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
        announcements: announcementRows
          .map((r) => parseJsonSafe<Record<string, unknown>>(r.payload_json, {}))
          .filter((a) => isAnnouncementActiveNow(a, getDhakaDateString())),
        favoriteAppIds: favoriteRows.map((r) => r.app_id),
        totalDownloads: Number(downloadCountRow?.cnt || 0),
        downloadHistory: downloadHistoryRows.map((row) => ({
          id: row.id,
          appId: row.app_id || row.content_id || '',
          contentId: row.content_id || row.app_id || '',
          contentType: row.content_type || 'app',
          pagePath: row.page_path || '/apps',
          deviceType: row.device_type || 'desktop',
          eventType: row.event_type,
          createdAt: Number(row.created_at || 0),
        })),
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
        paymentMethod?: string;
        receiverNumber?: string;
        senderNumber?: string;
        transactionId?: string;
        deliveryNote?: string;
        referenceAttachmentUrl?: string;
        receiptDataUrl?: string;
      };

      const totalPriceBdt = Number(body.totalPriceBdt || 0);
      const quantity = Math.max(1, Math.min(100, Math.round(Number(body.quantity || 1))));
      const rawMethod = String(body.paymentMethod || 'bkash').trim().toLowerCase().slice(0, 40);
      const pmRow = await db.first<PaymentMethodRow>(
        'SELECT * FROM payment_methods WHERE code = ? LIMIT 1',
        [rawMethod]
      );
      if (pmRow && pmRow.enabled !== 1) {
        res.status(400).json({ ok: false, error: `${pmRow.name} পেমেন্ট মাধ্যমটি বর্তমানে বন্ধ আছে।` });
        return;
      }
      const method = pmRow
        ? pmRow.code
        : rawMethod === 'nagad' || rawMethod === 'rocket'
          ? rawMethod
          : 'bkash';
      const senderNumber = String(body.senderNumber || '').trim().slice(0, 60);
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
        'order',
        { link: '/?route=account&tab=orders', meta: { orderId, orderNumber } }
      );

      await Promise.all([
        notifyAdminsNewOrder(db, {
          orderId,
          orderNumber,
          customerId: user.uid,
          customerName: user.displayName,
          productTitleEn: orderObj.productTitleEn || orderObj.productTitleBn || 'Digital Service',
          selectedPackageName: orderObj.selectedPackageName,
          totalPriceBdt,
          paymentMethod: method,
          createdAt: now,
        }),
        dispatchCustomerPush(
          db,
          user.uid,
          'order',
          {
            title: 'Order Submitted — DIGITAL HUB',
            body: `Order #${orderNumber} (৳${totalPriceBdt}) submitted for verification.`,
            url: '/?route=account&tab=orders',
            orderId,
            category: 'order',
          },
          `cust_order_submit_${orderId}`
        ),
      ]);

      await logServerAnalyticsEvent(db, req, {
        userId: user.uid,
        eventType: 'order_created',
        pagePath: '/checkout',
        contentId: orderObj.productId,
        contentType: 'service',
        metadata: { orderId, orderNumber, totalPriceBdt, paymentMethod: method },
        now,
      });

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
        'order',
        { link: '/?route=account&tab=orders', meta: { orderId, orderNumber } }
      );

      await Promise.all([
        notifyAdminsNewOrder(db, {
          orderId,
          orderNumber,
          customerId: user.uid,
          customerName: user.displayName,
          productTitleEn: orderObj.productTitleEn || orderObj.productTitleBn || 'Digital Service',
          selectedPackageName: orderObj.selectedPackageName,
          totalPriceBdt,
          paymentMethod: 'wallet',
          createdAt: now,
        }),
        dispatchCustomerPush(
          db,
          user.uid,
          'order',
          {
            title: 'Wallet Order Confirmed — DIGITAL HUB',
            body: `Order #${orderNumber} (৳${totalPriceBdt}) paid from wallet.`,
            url: '/?route=account&tab=orders',
            orderId,
            category: 'order',
          },
          `cust_wallet_order_${orderId}`
        ),
      ]);

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
      const existingPm = await db.first<PaymentMethodRow>(
        'SELECT * FROM payment_methods WHERE code = ? LIMIT 1',
        [rawMethod]
      );
      if (existingPm && (existingPm.enabled !== 1 || existingPm.supports_deposit !== 1)) {
        res.status(400).json({ ok: false, error: `${existingPm.name} অ্যাড মানি সুবিধাটি বর্তমানে বন্ধ আছে।` });
        return;
      }
      const pmRow = existingPm && existingPm.enabled === 1 && existingPm.supports_deposit === 1 ? existingPm : null;
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
      const body = (req.body || {}) as {
        subject?: string;
        message?: string;
        orderNumber?: string;
        category?: string;
        screenshotDataUrl?: string;
      };
      const subject = String(body.subject || '').trim().slice(0, 160);
      const message = String(body.message || '').trim().slice(0, 2000);
      const orderNumber = String(body.orderNumber || '').trim().slice(0, 60);
      const allowedCategories = new Set(['general', 'order', 'payment', 'withdrawal', 'app_bug', 'reward', 'account']);
      const category = allowedCategories.has(String(body.category || '')) ? String(body.category) : 'general';
      const rawShot = String(body.screenshotDataUrl || '').trim();
      let screenshotDataUrl = '';
      if (rawShot) {
        if (
          rawShot.length <= 450_000 &&
          (/^data:image\/(?:png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(rawShot) ||
            rawShot.startsWith('/api/media/') ||
            rawShot.startsWith('https://'))
        ) {
          screenshotDataUrl = rawShot;
        } else {
          res.status(400).json({ ok: false, error: 'স্ক্রিনশটটি বৈধ PNG/JPG/WebP ইমেজ (৪০০ কেবি-র কম) হতে হবে।' });
          return;
        }
      }
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
        category,
        subject,
        message,
        orderNumber,
        ...(screenshotDataUrl ? { screenshotDataUrl } : {}),
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

  router.post('/notifications/mark-all-read', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const rows = await db.all<{ id: string; payload_json: string }>(
        'SELECT id, payload_json FROM notifications WHERE user_id = ? AND is_read = 0 LIMIT 200',
        [user.uid]
      );
      for (const r of rows) {
        const updated = { ...parseJsonSafe<Record<string, unknown>>(r.payload_json, {}), read: true };
        await db.run('UPDATE notifications SET is_read = 1, payload_json = ? WHERE id = ?', [
          JSON.stringify(updated),
          r.id,
        ]);
      }
      res.json({ ok: true, updatedCount: rows.length });
    } catch (err) {
      handleRouteError(res, err, 'Failed to mark notifications as read.');
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
      const siteSettings = await getGlobalSiteSettings(db);
      const claimDate = getDhakaDateString(now);
      const id = generateSecureId('rcl', 8);
      const amountBdt = Math.max(1, Number(siteSettings.rewardedAdEnabled ? 2 : 0) || 2);
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
        dailyLimit: siteSettings.rewardedAdDailyLimit,
        status: 'Pending Credit',
      });
    } catch (err) {
      handleRouteError(res, err, 'রিওয়ার্ড ক্লেইম জমা দেওয়া যায়নি।');
    }
  });

  const WATCH_EARN_REQUIRED_SECONDS = 5;
  const WATCH_EARN_MIN_ELAPSED_MS = 4500;
  const WATCH_EARN_SESSION_TTL_MS = 10 * 60 * 1000;

  async function computeWatchEarnUserStats(db: AppDatabase, userId: string, siteSettings: EffectiveSiteSettings) {
    const todayStr = getDhakaDateString();
    const [bal, creditedRows] = await Promise.all([
      db.first<{
        coins_available: number;
        coins_lifetime_earned: number;
        coins_redeemed: number;
      }>('SELECT coins_available, coins_lifetime_earned, coins_redeemed FROM watch_earn_balances WHERE user_id = ?', [
        userId,
      ]),
      db.all<{ id: string; payload_json: string; updated_at: number }>(
        `SELECT id, payload_json, updated_at FROM ad_viewing_sessions WHERE user_id = ? AND LOWER(status) = 'credited' ORDER BY updated_at DESC LIMIT 200`,
        [userId]
      ),
    ]);

    let adsWatchedToday = 0;
    let coinsEarnedToday = 0;
    const watchedUnitIdSet = new Set<string>();
    const creditedSessions = creditedRows.map((r) => {
      const obj = parseJsonSafe<Record<string, unknown>>(r.payload_json, {});
      const coins = Number(obj.coinsAwarded || 0);
      const creditedAtStr = String(
        obj.creditedAt || (r.updated_at ? new Date(r.updated_at).toISOString() : '')
      );
      const verifiedMs = Number(obj.verifiedAt || r.updated_at || Date.parse(creditedAtStr) || 0);
      const sessionDhakaDate =
        typeof obj.dhakaDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj.dhakaDate)
          ? obj.dhakaDate
          : verifiedMs > 0
            ? getDhakaDateString(verifiedMs)
            : '';
      if (sessionDhakaDate === todayStr) {
        adsWatchedToday += 1;
        coinsEarnedToday += coins;
        const uidVal = String(obj.unitId || '').trim();
        if (uidVal) watchedUnitIdSet.add(uidVal);
      }
      return {
        sessionId: String(obj.id || r.id || ''),
        unitId: String(obj.unitId || ''),
        provider: String(obj.provider || ''),
        providerEventId: String(obj.providerEventId || ''),
        coins,
        creditedAt: creditedAtStr,
      };
    });

    const watchedUnitIdsToday = Array.from(watchedUnitIdSet);
    const remainingAdsToday = Math.max(0, siteSettings.rewardedAdDailyLimit - adsWatchedToday);

    return {
      coinsAvailable: Number(bal?.coins_available || 0),
      coinsLifetimeEarned: Number(bal?.coins_lifetime_earned || 0),
      coinsRedeemed: Number(bal?.coins_redeemed || 0),
      adsWatchedToday,
      remainingAdsToday,
      coinsEarnedToday,
      dailyAdLimit: siteSettings.rewardedAdDailyLimit,
      dailyCoinLimit: siteSettings.watchEarnDailyCoinLimit,
      coinsPerAd: siteSettings.watchEarnCoinsPerAd,
      coinsPerBdt: siteSettings.watchEarnCoinsPerBdt,
      minRedeemCoins: siteSettings.watchEarnMinRedeemCoins,
      resetTimezone: 'Asia/Dhaka',
      watchedUnitIdsToday,
      watchEarnEnabled: siteSettings.watchEarnEnabled && siteSettings.rewardedAdEnabled && siteSettings.adsEnabled,
      creditedSessions: creditedSessions.slice(0, 50),
    };
  }

  router.get('/watch-earn/summary', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const siteSettings = await getGlobalSiteSettings(db);
      const stats = await computeWatchEarnUserStats(db, user.uid, siteSettings);
      res.json({ ok: true, ...stats });
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
      if (user.status === 'suspended') {
        res.status(403).json({
          ok: false,
          error: 'আপনার অ্যাকাউন্ট সাময়িকভাবে সাসপেন্ড আছে।',
        });
        return;
      }

      const siteSettings = await getGlobalSiteSettings(db);
      if (!siteSettings.watchEarnEnabled || !siteSettings.rewardedAdEnabled || !siteSettings.adsEnabled) {
        res.status(403).json({
          ok: false,
          error: 'ওয়াচ ও আর্ন বর্তমানে অ্যাডমিন দ্বারা বন্ধ রাখা হয়েছে।',
        });
        return;
      }

      const body = (req.body || {}) as {
        unitId?: string;
        provider?: string;
        adTitle?: string;
        launchUrl?: string;
      };
      const unitId = String(body.unitId || '').trim().slice(0, 80);
      const provider = String(body.provider || 'DIGITAL_HUB').trim().slice(0, 60);
      const adTitle = String(body.adTitle || '').trim().slice(0, 140);
      const launchUrl = String(body.launchUrl || '').trim().slice(0, 600);
      if (!unitId) {
        res.status(400).json({ ok: false, error: 'সঠিক অ্যাড ইউনিট নির্বাচন করুন।' });
        return;
      }

      // Authorize reward units:
      // External ad units/networks may only start a reward session if explicitly approved under network policy
      // (supportsRewardedVerification === true or supportsIncentivizedRewards === true).
      const FIRST_PARTY_REWARD_UNITS = new Set([
        'DH_REWARD_01',
        'DH_REWARD_02',
        'DH_REWARD_03',
        'DH_REWARD_04',
        'DH_REWARD_05',
      ]);
      const isFirstPartyReward = FIRST_PARTY_REWARD_UNITS.has(unitId.toUpperCase());
      let requiresS2SCallback = false;
      if (!isFirstPartyReward) {
        const unitOv = await db.first<{ collection: string; payload_json: string }>(
          `SELECT collection, payload_json FROM catalog_overrides
           WHERE collection IN ('managedAdUnits', 'advertisingUnits', 'adNetworks', 'advertisements')
             AND (doc_id = ? OR json_extract(payload_json, '$.code') = ?)
             AND deleted = 0
           ORDER BY CASE collection WHEN 'managedAdUnits' THEN 1 WHEN 'advertisingUnits' THEN 2 WHEN 'adNetworks' THEN 3 ELSE 4 END
           LIMIT 1`,
          [unitId, unitId]
        );
        const ovObj = unitOv ? parseJsonSafe<Record<string, unknown>>(unitOv.payload_json, {}) : {};
        let policyApproved =
          ovObj.supportsRewardedVerification === true ||
          ovObj.supportsIncentivizedRewards === true ||
          ovObj.incentivizedApproved === true;

        if (!policyApproved) {
          const networkHint = String(ovObj.networkName || provider || '').trim().toLowerCase();
          if (networkHint) {
            const netRows = await db.all<{ payload_json: string }>(
              `SELECT payload_json FROM catalog_overrides WHERE collection = 'adNetworks' AND deleted = 0 LIMIT 40`
            );
            policyApproved = netRows.some((r) => {
              const net = parseJsonSafe<Record<string, unknown>>(r.payload_json, {});
              return (
                net.enabled === true &&
                net.approvalStatus === 'active' &&
                net.supportsIncentivizedRewards === true &&
                (String(net.name || '').trim().toLowerCase() === networkHint ||
                  String(net.provider || '').trim().toLowerCase() === networkHint ||
                  String(net.id || '').trim().toLowerCase() === networkHint)
              );
            });
          }
        }

        if (!policyApproved) {
          res.status(403).json({
            ok: false,
            error:
              'এই বিজ্ঞাপন নেটওয়ার্কটি এখনো রিওয়ার্ড (Incentivized Traffic) অনুমোদন করেনি। শুধুমাত্র অনুমোদিত নেটওয়ার্কে কয়েন যোগ হয়।',
          });
          return;
        }
        requiresS2SCallback = ovObj.requiresS2SCallback === true;
      }

      const stats = await computeWatchEarnUserStats(db, user.uid, siteSettings);
      if (stats.watchedUnitIdsToday.some((id) => id.toLowerCase() === unitId.toLowerCase())) {
        res.status(409).json({
          ok: false,
          error:
            'এই বিজ্ঞাপনটি আজ ইতিমধ্যে দেখা হয়েছে। প্রতিটি বিজ্ঞাপন প্রতিদিন একবারই দেখা যাবে (রিসেট: রাত ১২টা Asia/Dhaka)।',
        });
        return;
      }
      if (stats.adsWatchedToday >= stats.dailyAdLimit) {
        res.status(429).json({
          ok: false,
          error: `আজকের দৈনিক বিজ্ঞাপন সীমা (${stats.dailyAdLimit}/${stats.dailyAdLimit}) পূর্ণ হয়েছে। আগামীকাল আবার চেষ্টা করুন।`,
        });
        return;
      }
      if (stats.coinsEarnedToday + stats.coinsPerAd > stats.dailyCoinLimit) {
        res.status(429).json({
          ok: false,
          error: `আজকের দৈনিক কয়েন সীমা (${stats.dailyCoinLimit} কয়েন) পূর্ণ হয়েছে।`,
        });
        return;
      }

      const now = Date.now();
      // Prevent simultaneous active reward timers per user
      const activeWatching = await db.first<{ id: string; created_at: number }>(
        `SELECT id, created_at FROM ad_viewing_sessions WHERE user_id = ? AND status = 'watching' ORDER BY created_at DESC LIMIT 1`,
        [user.uid]
      );
      if (activeWatching && now - Number(activeWatching.created_at || 0) < WATCH_EARN_MIN_ELAPSED_MS) {
        const waitSec = Math.ceil((WATCH_EARN_MIN_ELAPSED_MS - (now - Number(activeWatching.created_at || 0))) / 1000);
        res.status(429).json({
          ok: false,
          error: `একটি বিজ্ঞাপন টাইমার ইতিমধ্যে চালু আছে। অনুগ্রহ করে ${waitSec} সেকেন্ড অপেক্ষা করুন।`,
        });
        return;
      }

      // Expire any stale unfinished watching sessions older than the timer window
      await db.run(
        `UPDATE ad_viewing_sessions SET status = 'expired', updated_at = ? WHERE user_id = ? AND status = 'watching' AND created_at < ?`,
        [now, user.uid, now - WATCH_EARN_MIN_ELAPSED_MS]
      );

      const sessionId = generateSecureId('wsess', 8);
      const sessionToken = generateSecureId('wtok', 12);
      const initialStatus = requiresS2SCallback ? 'awaiting_callback' : 'watching';
      const payload = {
        id: sessionId,
        userId: user.uid,
        userEmail: getUserPrimaryIdentifier(user),
        unitId,
        adTitle: adTitle || `${provider} · ${unitId}`,
        provider,
        sessionToken,
        launchUrl,
        requiresS2SCallback,
        status: initialStatus,
        requiredSeconds: WATCH_EARN_REQUIRED_SECONDS,
        rewardCoins: stats.coinsPerAd,
        coinsAwarded: 0,
        createdAt: now,
        updatedAt: now,
      };
      await db.run(
        'INSERT INTO ad_viewing_sessions (id, user_id, session_token, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [sessionId, user.uid, sessionToken, initialStatus, JSON.stringify(payload), now, now]
      );
      res.status(201).json({
        ok: true,
        sessionId,
        sessionToken,
        unitId,
        provider,
        launchUrl,
        requiresS2SCallback,
        status: initialStatus,
        requiredSeconds: WATCH_EARN_REQUIRED_SECONDS,
        rewardCoins: stats.coinsPerAd,
        serverStartedAt: now,
        message: requiresS2SCallback
          ? `অ্যাড ভিউ শুরু হয়েছে — প্রোভাইডার S2S কলব্যাক যাচাইয়ের পর +${stats.coinsPerAd} কয়েন যোগ হবে।`
          : `${WATCH_EARN_REQUIRED_SECONDS} সেকেন্ড বিজ্ঞাপনটি দেখুন — সম্পন্ন হলে স্বয়ংক্রিয়ভাবে +${stats.coinsPerAd} কয়েন যোগ হবে।`,
      });
    } catch (err) {
      handleRouteError(res, err, 'সেশন শুরু করা যায়নি।');
    }
  });

  router.post('/watch-earn/session/complete', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      if (user.status === 'suspended') {
        res.status(403).json({ ok: false, error: 'আপনার অ্যাকাউন্ট সাময়িকভাবে সাসপেন্ড আছে।' });
        return;
      }

      const body = (req.body || {}) as {
        sessionId?: string;
        sessionToken?: string;
        adLoaded?: boolean;
        failureReason?: string;
      };
      const sessionId = String(body.sessionId || '').trim();
      const sessionToken = String(body.sessionToken || '').trim();
      const adLoaded = body.adLoaded === true;
      const failureReason = String(body.failureReason || '').trim().slice(0, 240);

      if (!sessionId || !sessionToken) {
        res.status(400).json({ ok: false, error: 'অবৈধ বিজ্ঞাপন সেশন তথ্য।' });
        return;
      }

      const row = await db.first<{
        id: string;
        user_id: string;
        session_token: string;
        status: string;
        payload_json: string;
        created_at: number;
      }>(
        'SELECT id, user_id, session_token, status, payload_json, created_at FROM ad_viewing_sessions WHERE id = ? LIMIT 1',
        [sessionId]
      );

      if (!row || row.user_id !== user.uid || row.session_token !== sessionToken) {
        res.status(404).json({ ok: false, error: 'বিজ্ঞাপন সেশনটি খুঁজে পাওয়া যায়নি।' });
        return;
      }

      const siteSettings = await getGlobalSiteSettings(db);
      const currentStatus = String(row.status || '').toLowerCase();
      const existingObj = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});

      // Duplicate reward prevention: already credited sessions return idempotent balance without re-crediting
      if (currentStatus === 'credited') {
        const stats = await computeWatchEarnUserStats(db, user.uid, siteSettings);
        res.json({
          ok: true,
          verified: true,
          alreadyCredited: true,
          status: 'credited',
          coinsAwarded: 0,
          ...stats,
          message: 'এই বিজ্ঞাপনটির কয়েন ইতিমধ্যে আপনার অ্যাকাউন্টে যোগ করা হয়েছে।',
        });
        return;
      }

      const now = Date.now();

      // Honest verification: never credit coins if the ad failed to load
      if (!adLoaded) {
        const failedPayload = {
          ...existingObj,
          status: 'load_failed',
          coinsAwarded: 0,
          failureReason: failureReason || 'Advertisement failed to load in viewport',
          updatedAt: now,
        };
        await db.run(
          `UPDATE ad_viewing_sessions SET status = 'load_failed', payload_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND LOWER(status) != 'credited'`,
          [JSON.stringify(failedPayload), now, sessionId, user.uid]
        );
        res.status(400).json({
          ok: false,
          verified: false,
          status: 'load_failed',
          coinsAwarded: 0,
          error: 'বিজ্ঞাপনটি লোড হয়নি বলে কোনো কয়েন যোগ করা হয়নি। অনুগ্রহ করে অন্য বিজ্ঞাপন চেষ্টা করুন।',
        });
        return;
      }

      if (currentStatus === 'expired' || now - Number(row.created_at || 0) > WATCH_EARN_SESSION_TTL_MS) {
        res.status(400).json({
          ok: false,
          verified: false,
          status: 'expired',
          coinsAwarded: 0,
          error: 'বিজ্ঞাপন সেশনটির মেয়াদ শেষ হয়েছে। নতুন করে বিজ্ঞাপন দেখুন।',
        });
        return;
      }

      // S2S-only third-party sessions MUST be credited via /api/ads/postback/:provider, never by client /complete
      if (existingObj.requiresS2SCallback === true || currentStatus === 'awaiting_callback') {
        res.status(403).json({
          ok: false,
          verified: false,
          status: 'awaiting_callback',
          coinsAwarded: 0,
          error: 'এই অ্যাড নেটওয়ার্কটির জন্য প্রোভাইডারের অনুমোদিত S2S কলব্যাক যাচাই প্রয়োজন।',
        });
        return;
      }

      // Enforce real server-side 5-second watch timer (rejects forged/premature requests)
      const elapsedMs = now - Number(row.created_at || 0);
      if (elapsedMs < WATCH_EARN_MIN_ELAPSED_MS) {
        const remainingSeconds = Math.max(1, Math.ceil((WATCH_EARN_MIN_ELAPSED_MS - elapsedMs) / 1000));
        res.status(400).json({
          ok: false,
          verified: false,
          status: 'watching',
          remainingSeconds,
          coinsAwarded: 0,
          error: `সম্পূর্ণ ৫ সেকেন্ড বিজ্ঞাপন দেখা বাকি আছে (${remainingSeconds} সেকেন্ড)।`,
        });
        return;
      }

      if (!siteSettings.watchEarnEnabled || !siteSettings.rewardedAdEnabled || !siteSettings.adsEnabled) {
        res.status(403).json({
          ok: false,
          error: 'ওয়াচ ও আর্ন বর্তমানে বন্ধ আছে।',
        });
        return;
      }

      const preStats = await computeWatchEarnUserStats(db, user.uid, siteSettings);
      const rewardCoins = Math.max(
        1,
        Math.floor(Number(existingObj.rewardCoins || siteSettings.watchEarnCoinsPerAd) || siteSettings.watchEarnCoinsPerAd)
      );

      if (preStats.adsWatchedToday >= preStats.dailyAdLimit) {
        res.status(429).json({
          ok: false,
          error: `আজকের দৈনিক বিজ্ঞাপন সীমা (${preStats.dailyAdLimit}/${preStats.dailyAdLimit}) পূর্ণ হয়েছে।`,
        });
        return;
      }
      if (preStats.coinsEarnedToday + rewardCoins > preStats.dailyCoinLimit) {
        res.status(429).json({
          ok: false,
          error: `আজকের দৈনিক কয়েন সীমা (${preStats.dailyCoinLimit} কয়েন) পূর্ণ হয়েছে।`,
        });
        return;
      }

      const creditedAtIso = new Date(now).toISOString();
      const dhakaDate = getDhakaDateString(now);
      const completedPayload = {
        ...existingObj,
        status: 'credited',
        coinsAwarded: rewardCoins,
        failureReason: '',
        watchedDurationMs: elapsedMs,
        verifiedAt: now,
        dhakaDate,
        creditedAt: creditedAtIso,
        updatedAt: now,
      };

      // Atomic transition guarantees duplicate/concurrent requests can NEVER double-credit
      const atomicUpd = await db.run(
        `UPDATE ad_viewing_sessions
         SET status = 'credited', payload_json = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND LOWER(status) IN ('watching', 'pending', 'awaiting_callback', 'initiated')`,
        [JSON.stringify(completedPayload), now, sessionId, user.uid]
      );

      if (atomicUpd.changes === 0) {
        const latestStats = await computeWatchEarnUserStats(db, user.uid, siteSettings);
        res.json({
          ok: true,
          verified: true,
          alreadyCredited: true,
          status: 'credited',
          coinsAwarded: 0,
          ...latestStats,
          message: 'এই বিজ্ঞাপনটির কয়েন ইতিমধ্যে যোগ করা হয়েছে।',
        });
        return;
      }

      await db.run(
        `INSERT INTO watch_earn_balances (user_id, coins_available, coins_lifetime_earned, coins_redeemed, updated_at)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           coins_available = coins_available + excluded.coins_available,
           coins_lifetime_earned = coins_lifetime_earned + excluded.coins_lifetime_earned,
           updated_at = excluded.updated_at`,
        [user.uid, rewardCoins, rewardCoins, now]
      );

      const rtxId = generateSecureId('rtx', 8);
      const bdtEquivalent = Number((rewardCoins / siteSettings.watchEarnCoinsPerBdt).toFixed(2));
      const unitIdStr = String(existingObj.unitId || 'DH_REWARD');
      const adTitleStr = String(existingObj.adTitle || `Reward Ad (${unitIdStr})`);
      const rtxPayload = {
        id: rtxId,
        sessionId,
        userId: user.uid,
        userEmail: getUserPrimaryIdentifier(user),
        unitId: unitIdStr,
        adTitle: adTitleStr,
        provider: String(existingObj.provider || 'DIGITAL_HUB'),
        type: 'watch_earn_credit',
        coins: rewardCoins,
        bdtEquivalent,
        status: 'Credited',
        note: `${adTitleStr} — 5s verified (+${rewardCoins} coins)`,
        createdAt: now,
      };
      await db.run(
        'INSERT INTO ad_reward_transactions (id, user_id, type, status, coins, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [rtxId, user.uid, 'watch_earn_credit', 'Credited', rewardCoins, JSON.stringify(rtxPayload), now]
      );

      const postStats = await computeWatchEarnUserStats(db, user.uid, siteSettings);

      res.json({
        ok: true,
        verified: true,
        alreadyCredited: false,
        status: 'credited',
        coinsAwarded: rewardCoins,
        bdtEquivalent,
        session: completedPayload,
        rewardTransaction: rtxPayload,
        ...postStats,
        message: `অভিনন্দন! +${rewardCoins} কয়েন আপনার অ্যাকাউন্টে স্বয়ংক্রিয়ভাবে যোগ হয়েছে।`,
      });
    } catch (err) {
      handleRouteError(res, err, 'বিজ্ঞাপন রিওয়ার্ড প্রসেস করা যায়নি।');
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
      const isCredited = String(row.status || '').toLowerCase() === 'credited';
      res.json({
        ok: true,
        verified: isCredited,
        status: isCredited ? 'credited' : row.status,
        coinsAwarded: Number(obj.coinsAwarded || 0),
        message: isCredited
          ? 'বিজ্ঞাপন যাচাই সম্পন্ন হয়েছে এবং কয়েন স্থায়ীভাবে যুক্ত হয়েছে।'
          : 'বিজ্ঞাপনটি সম্পূর্ণ দেখা ও যাচাইয়ের জন্য অপেক্ষমান আছে।',
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
      if (user.status === 'suspended') {
        res.status(403).json({ ok: false, error: 'আপনার অ্যাকাউন্ট সাময়িকভাবে সাসপেন্ড আছে।' });
        return;
      }
      const siteSettings = await getGlobalSiteSettings(db);
      const minRedeemCoins = siteSettings.watchEarnMinRedeemCoins;
      const coinsPerBdt = siteSettings.watchEarnCoinsPerBdt;

      const body = (req.body || {}) as { coins?: number };
      const coins = Math.floor(Number(body.coins || 0));
      if (!Number.isFinite(coins) || coins < minRedeemCoins) {
        res.status(400).json({
          ok: false,
          error: `সর্বনিম্ন ${minRedeemCoins} কয়েন রিডিম করা যাবে।`,
        });
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
      const bdtEstimate = Number((coins / coinsPerBdt).toFixed(2));
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
  // 8B. DAILY LOGIN REWARD (10 COINS + STREAK SYSTEM, ASIA/DHAKA SYNCED)
  // =========================================================================
  async function computeDailyRewardStatus(
    db: AppDatabase,
    userId: string | null,
    siteSettings: EffectiveSiteSettings
  ) {
    const now = Date.now();
    const todayDate = getDhakaDateString(now);
    const todayStartMs = getDhakaDayStartMs(now);
    const yesterdayDate = getDhakaDateString(todayStartMs - 1000);
    const nextResetAt = todayStartMs + 24 * 60 * 60 * 1000;

    let claimedToday = false;
    let currentStreak = 0;
    let longestStreak = 0;
    let lastClaimDate = '';
    let totalClaims = 0;
    let coinsAvailable = 0;
    let todayClaim: Record<string, unknown> | null = null;

    if (userId) {
      const [claimRow, streakRow, balRow] = await Promise.all([
        db.first<{
          id: string;
          user_id: string;
          claim_date: string;
          streak_day: number;
          base_coins: number;
          bonus_coins: number;
          total_coins: number;
          status: string;
          transaction_id: string;
          created_at: number;
        }>('SELECT * FROM daily_login_claims WHERE user_id = ? AND claim_date = ? LIMIT 1', [
          userId,
          todayDate,
        ]),
        db.first<{
          current_streak: number;
          longest_streak: number;
          last_claim_date: string;
          total_claims: number;
        }>('SELECT * FROM daily_login_streaks WHERE user_id = ? LIMIT 1', [userId]),
        db.first<{ coins_available: number }>(
          'SELECT coins_available FROM watch_earn_balances WHERE user_id = ? LIMIT 1',
          [userId]
        ),
      ]);

      coinsAvailable = Number(balRow?.coins_available || 0);
      totalClaims = Number(streakRow?.total_claims || 0);
      longestStreak = Number(streakRow?.longest_streak || 0);
      lastClaimDate = String(streakRow?.last_claim_date || '');

      if (claimRow) {
        claimedToday = true;
        todayClaim = {
          id: claimRow.id,
          userId: claimRow.user_id,
          claimDate: claimRow.claim_date,
          streakDay: Number(claimRow.streak_day || 1),
          baseCoins: Number(claimRow.base_coins || siteSettings.dailyRewardCoins),
          bonusCoins: Number(claimRow.bonus_coins || 0),
          totalCoins: Number(claimRow.total_coins || siteSettings.dailyRewardCoins),
          status: claimRow.status || 'Credited',
          transactionId: claimRow.transaction_id || claimRow.id,
          createdAt: Number(claimRow.created_at || now),
        };
      }

      if (streakRow) {
        if (lastClaimDate === todayDate || lastClaimDate === yesterdayDate) {
          currentStreak = Number(streakRow.current_streak || 0);
        } else {
          currentStreak = 0;
        }
      }
    }

    const cycleCompletedDays = claimedToday
      ? currentStreak > 0
        ? ((currentStreak - 1) % 7) + 1
        : 1
      : currentStreak % 7;
    const nextClaimDayInCycle = claimedToday ? Math.min(7, cycleCompletedDays) : cycleCompletedDays + 1;

    const weekDays = Array.from({ length: 7 }, (_, idx) => {
      const dayNumber = idx + 1;
      const isBonusMilestone = siteSettings.streakEnabled && dayNumber === 7 && siteSettings.streakDay7BonusCoins > 0;
      const coins = siteSettings.dailyRewardCoins + (isBonusMilestone ? siteSettings.streakDay7BonusCoins : 0);
      const claimed = claimedToday ? dayNumber <= cycleCompletedDays : dayNumber <= cycleCompletedDays;
      const isCurrent = !claimedToday && dayNumber === nextClaimDayInCycle;
      return {
        dayNumber,
        labelEn: `Day ${dayNumber}`,
        labelBn: `দিন ${dayNumber}`,
        coins,
        claimed,
        isCurrent,
        isBonusMilestone,
      };
    });

    return {
      enabled: siteSettings.dailyRewardEnabled,
      dailyCoins: siteSettings.dailyRewardCoins,
      streakEnabled: siteSettings.streakEnabled,
      streakDay7BonusCoins: siteSettings.streakDay7BonusCoins,
      todayDate,
      nextResetAt,
      isAuthenticated: Boolean(userId),
      claimedToday,
      currentStreak,
      longestStreak,
      lastClaimDate,
      totalClaims,
      coinsAvailable,
      todayClaim,
      weekDays,
    };
  }

  router.get('/rewards/daily-status', async (req, res) => {
    try {
      const session = await resolveSessionFromRequest(req).catch(() => null);
      const db = session ? session.db : await getAppDatabase();
      const siteSettings = await getGlobalSiteSettings(db);
      const status = await computeDailyRewardStatus(db, session?.user.uid || null, siteSettings);
      res.json({ ok: true, status });
    } catch (err) {
      handleRouteError(res, err, 'ডেইলি রিওয়ার্ড স্ট্যাটাস লোড করা যায়নি।');
    }
  });

  router.post('/rewards/daily-claim', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'ডেইলি লগইন রিওয়ার্ড পেতে অনুগ্রহ করে লগইন করুন।' });
        return;
      }
      const { db, user } = resolved;
      if (user.status === 'suspended') {
        res.status(403).json({ ok: false, error: 'আপনার অ্যাকাউন্ট সাময়িকভাবে সাসপেন্ড আছে।' });
        return;
      }
      const siteSettings = await getGlobalSiteSettings(db);
      if (!siteSettings.dailyRewardEnabled) {
        res.status(403).json({ ok: false, error: 'ডেইলি লগইন রিওয়ার্ড বর্তমানে বন্ধ আছে।' });
        return;
      }

      const now = Date.now();
      const claimDate = getDhakaDateString(now);
      const todayStartMs = getDhakaDayStartMs(now);
      const yesterdayDate = getDhakaDateString(todayStartMs - 1000);

      const streakRow = await db.first<{
        current_streak: number;
        longest_streak: number;
        last_claim_date: string;
        total_claims: number;
      }>('SELECT * FROM daily_login_streaks WHERE user_id = ? LIMIT 1', [user.uid]);

      const nextStreak =
        streakRow && streakRow.last_claim_date === yesterdayDate
          ? Number(streakRow.current_streak || 0) + 1
          : streakRow && streakRow.last_claim_date === claimDate
            ? Number(streakRow.current_streak || 1)
            : 1;
      const longestStreak = Math.max(Number(streakRow?.longest_streak || 0), nextStreak);
      const prevTotalClaims = Number(streakRow?.total_claims || 0);

      const baseCoins = siteSettings.dailyRewardCoins;
      const bonusCoins =
        siteSettings.streakEnabled && nextStreak % 7 === 0 ? siteSettings.streakDay7BonusCoins : 0;
      const totalCoins = baseCoins + bonusCoins;
      const claimId = generateSecureId('dlc', 8);
      const rtxId = generateSecureId('dlr', 8);

      // Atomic daily claim uniqueness guard: UNIQUE(user_id, claim_date)
      const insertClaim = await db.run(
        `INSERT OR IGNORE INTO daily_login_claims (
          id, user_id, claim_date, streak_day, base_coins, bonus_coins, total_coins, status, transaction_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Credited', ?, ?)`,
        [claimId, user.uid, claimDate, nextStreak, baseCoins, bonusCoins, totalCoins, rtxId, now]
      );

      if (insertClaim.changes === 0) {
        const status = await computeDailyRewardStatus(db, user.uid, siteSettings);
        res.status(409).json({
          ok: false,
          alreadyClaimed: true,
          error: "Today's reward already claimed.",
          status,
        });
        return;
      }

      await db.run(
        `INSERT INTO daily_login_streaks (user_id, current_streak, longest_streak, last_claim_date, total_claims, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           current_streak = excluded.current_streak,
           longest_streak = MAX(daily_login_streaks.longest_streak, excluded.longest_streak),
           last_claim_date = excluded.last_claim_date,
           total_claims = daily_login_streaks.total_claims + 1,
           updated_at = excluded.updated_at`,
        [user.uid, nextStreak, longestStreak, claimDate, prevTotalClaims + 1, now]
      );

      await db.run(
        `INSERT INTO watch_earn_balances (user_id, coins_available, coins_lifetime_earned, coins_redeemed, updated_at)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           coins_available = watch_earn_balances.coins_available + ?,
           coins_lifetime_earned = watch_earn_balances.coins_lifetime_earned + ?,
           updated_at = excluded.updated_at`,
        [user.uid, totalCoins, totalCoins, now, totalCoins, totalCoins]
      );

      const coinsPerBdt = siteSettings.watchEarnCoinsPerBdt || 10;
      const baseNote = `Daily Login Reward (${claimDate}) • Day ${nextStreak}`;
      const basePayload = {
        id: rtxId,
        sessionId: claimId,
        refId: claimId,
        userId: user.uid,
        userEmail: getUserPrimaryIdentifier(user),
        adTitle: 'Daily Login Reward',
        provider: 'DAILY_LOGIN',
        type: 'daily_login_reward',
        coins: baseCoins,
        bdtEquivalent: Number((baseCoins / coinsPerBdt).toFixed(2)),
        status: 'Credited',
        note: bonusCoins > 0 ? `${baseNote} (+${baseCoins} base + ${bonusCoins} Day-7 bonus)` : baseNote,
        createdAt: now,
      };
      await db.run(
        'INSERT INTO ad_reward_transactions (id, user_id, type, status, coins, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [rtxId, user.uid, 'daily_login_reward', 'Credited', baseCoins, JSON.stringify(basePayload), now]
      );

      if (bonusCoins > 0) {
        const bonusTxId = generateSecureId('dls', 8);
        const bonusPayload = {
          id: bonusTxId,
          sessionId: claimId,
          refId: claimId,
          userId: user.uid,
          userEmail: getUserPrimaryIdentifier(user),
          adTitle: `7-Day Streak Milestone Bonus (Day ${nextStreak})`,
          provider: 'STREAK_BONUS',
          type: 'daily_login_streak_bonus',
          coins: bonusCoins,
          bdtEquivalent: Number((bonusCoins / coinsPerBdt).toFixed(2)),
          status: 'Credited',
          note: `Streak milestone Day ${nextStreak} bonus (+${bonusCoins} coins)`,
          createdAt: now + 1,
        };
        await db.run(
          'INSERT INTO ad_reward_transactions (id, user_id, type, status, coins, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [bonusTxId, user.uid, 'daily_login_streak_bonus', 'Credited', bonusCoins, JSON.stringify(bonusPayload), now + 1]
        );
      }

      await insertNotification(
        db,
        user.uid,
        `ডেইলি লগইন রিওয়ার্ড: +${totalCoins} কয়েন!`,
        `Daily Login Reward: +${totalCoins} Coins!`,
        bonusCoins > 0
          ? `আপনার আজকের +${baseCoins} কয়েন এবং ৭ দিনের স্ট্রিক বোনাস +${bonusCoins} কয়েন (মোট +${totalCoins} কয়েন) অ্যাকাউন্টে যুক্ত হয়েছে।`
          : `আজকের ডেইলি লগইন রিওয়ার্ড +${totalCoins} কয়েন (স্ট্রিক: দিন ${nextStreak}) আপনার অ্যাকাউন্টে যুক্ত হয়েছে।`,
        bonusCoins > 0
          ? `You earned +${baseCoins} daily coins plus +${bonusCoins} streak milestone bonus (Total +${totalCoins} coins).`
          : `You claimed +${totalCoins} daily login coins (Streak: Day ${nextStreak}).`,
        'reward'
      );

      const status = await computeDailyRewardStatus(db, user.uid, siteSettings);
      res.status(201).json({
        ok: true,
        alreadyClaimed: false,
        claimId,
        transactionId: rtxId,
        baseCoins,
        bonusCoins,
        totalCoins,
        streakDay: nextStreak,
        status,
        message:
          bonusCoins > 0
            ? `অভিনন্দন! +${baseCoins} ডেইলি কয়েন এবং +${bonusCoins} স্ট্রিক বোনাস সহ মোট +${totalCoins} কয়েন যুক্ত হয়েছে।`
            : `অভিনন্দন! +${totalCoins} কয়েন আপনার অ্যাকাউন্টে যুক্ত হয়েছে।`,
      });
    } catch (err) {
      handleRouteError(res, err, 'ডেইলি রিওয়ার্ড ক্লেইম সম্পন্ন করা যায়নি।');
    }
  });

  router.get('/me/coin-history', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const siteSettings = await getGlobalSiteSettings(db);
      const [balRow, txRows, streakStatus] = await Promise.all([
        db.first<{
          coins_available: number;
          coins_lifetime_earned: number;
          coins_redeemed: number;
        }>('SELECT * FROM watch_earn_balances WHERE user_id = ? LIMIT 1', [user.uid]),
        db.all<{
          id: string;
          type: string;
          status: string;
          coins: number;
          payload_json: string;
          created_at: number;
        }>(
          'SELECT id, type, status, coins, payload_json, created_at FROM ad_reward_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 200',
          [user.uid]
        ),
        computeDailyRewardStatus(db, user.uid, siteSettings),
      ]);

      res.json({
        ok: true,
        coinsAvailable: Number(balRow?.coins_available || 0),
        coinsLifetimeEarned: Number(balRow?.coins_lifetime_earned || 0),
        coinsRedeemed: Number(balRow?.coins_redeemed || 0),
        dailyRewardStatus: streakStatus,
        transactions: txRows.map((row) => {
          const parsed = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
          return {
            ...parsed,
            id: String(parsed.id || row.id),
            type: String(parsed.type || row.type),
            status: String(parsed.status || row.status || 'Credited'),
            coins: Number(parsed.coins ?? row.coins ?? 0),
            createdAt: Number(parsed.createdAt || row.created_at || 0),
          };
        }),
      });
    } catch (err) {
      handleRouteError(res, err, 'কয়েন হিস্ট্রি লোড করা যায়নি।');
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

  router.get('/catalog/overrides', async (req, res) => {
    try {
      const db = await getAppDatabase();
      const session = await resolveSessionFromRequest(req).catch(() => null);
      const callerIsAdmin = Boolean(
        session && (session.user.role === 'admin' || session.user.role === 'super_admin')
      );

      const [overrideRows, reviewRows, announcementRows, pmRows] = await Promise.all([
        db.all<{ collection: string; doc_id: string; deleted: number; payload_json: string }>(
          `SELECT collection, doc_id, deleted, payload_json FROM catalog_overrides WHERE collection != 'system_secrets'`
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM reviews WHERE approved = 1 ORDER BY created_at DESC LIMIT 200'
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 30'
        ),
        db.all<PaymentMethodRow>(
          'SELECT * FROM payment_methods ORDER BY sort_order ASC, name ASC'
        ),
      ]);

      const sanitizePublicProduct = (raw: unknown): unknown => {
        if (callerIsAdmin || !raw || typeof raw !== 'object') return raw;
        const obj = { ...(raw as Record<string, unknown>) };
        delete obj.supplierPriceBdt;
        const priceNum = typeof obj.priceBdt === 'number' ? obj.priceBdt : Number(obj.priceBdt || 0);
        const origNum =
          typeof obj.originalPriceBdt === 'number'
            ? obj.originalPriceBdt
            : Number(obj.originalPriceBdt || 0);
        if (origNum > 0 && origNum <= priceNum) {
          delete obj.originalPriceBdt;
        }
        if (Array.isArray(obj.packages)) {
          obj.packages = obj.packages.map((pk) => {
            if (!pk || typeof pk !== 'object') return pk;
            const copy = { ...(pk as Record<string, unknown>) };
            delete copy.supplierPriceBdt;
            const pPrice = typeof copy.priceBdt === 'number' ? copy.priceBdt : Number(copy.priceBdt || 0);
            const pOrig =
              typeof copy.originalPriceBdt === 'number'
                ? copy.originalPriceBdt
                : Number(copy.originalPriceBdt || 0);
            if (pOrig > 0 && pOrig <= pPrice) {
              delete copy.originalPriceBdt;
            }
            return copy;
          });
        }
        return obj;
      };

      const overrides: Record<string, Array<{ id: string; deleted: boolean; data: unknown }>> = {};
      for (const r of overrideRows) {
        if (r.collection === 'system_secrets') continue;
        if (!overrides[r.collection]) overrides[r.collection] = [];
        const parsed = parseJsonSafe(r.payload_json, {});
        overrides[r.collection].push({
          id: r.doc_id,
          deleted: r.deleted === 1,
          data: r.collection === 'products' ? sanitizePublicProduct(parsed) : parsed,
        });
      }

      const mappedPaymentMethods = pmRows.map(mapPaymentMethodRow);
      const todayDhaka = getDhakaDateString();
      res.json({
        ok: true,
        overrides,
        reviews: reviewRows.map((r) => parseJsonSafe(r.payload_json, {})),
        announcements: announcementRows
          .map((r) => parseJsonSafe<Record<string, unknown>>(r.payload_json, {}))
          .filter((a) => isAnnouncementActiveNow(a, todayDhaka)),
        paymentMethods: mappedPaymentMethods.filter((m) => m.enabled),
        allPaymentMethods: mappedPaymentMethods,
      });
    } catch {
      res.json({ ok: true, overrides: {}, reviews: [], announcements: [], paymentMethods: [], allPaymentMethods: [] });
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
        'payment',
        { link: '/?route=account&tab=orders', meta: { orderId: payRow.order_id } }
      );
      await dispatchCustomerPush(
        db,
        payRow.customer_id,
        'payment',
        {
          title: decision === 'approve' ? 'Payment Approved — DIGITAL HUB' : 'Payment Rejected — DIGITAL HUB',
          body: decision === 'approve' ? 'Your order payment has been approved.' : `Payment rejected: ${reason}`,
          url: '/?route=account&tab=orders',
          orderId: payRow.order_id,
          category: 'payment',
        },
        `pay_verify_${paymentId}_${decision}`
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
        'wallet',
        { link: '/?route=account&tab=wallet' }
      );
      await dispatchCustomerPush(
        db,
        txRow.user_id,
        'wallet',
        {
          title: decision === 'approve' ? 'Wallet Deposit Approved' : 'Wallet Deposit Rejected',
          body:
            decision === 'approve'
              ? `৳${txRow.amount_bdt} has been credited to your Digital Hub wallet.`
              : `Deposit of ৳${txRow.amount_bdt} rejected: ${reason}`,
          url: '/?route=account&tab=wallet',
          category: 'payment',
        },
        `add_money_${walletTxId}_${decision}`
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
      if (status === 'Completed' && existing.status !== 'Completed') {
        await logServerAnalyticsEvent(db, req, {
          userId: row.customer_id,
          eventType: 'order_completed',
          pagePath: '/admin/orders',
          contentId: String(existing.productId || ''),
          contentType: 'service',
          metadata: { orderId },
          now,
        });
      }
      if (status !== existing.status) {
        const orderNum = String(existing.orderNumber || orderId);
        await insertNotification(
          db,
          row.customer_id,
          `অর্ডার #${orderNum} স্ট্যাটাস আপডেট`,
          `Order #${orderNum} Status Updated`,
          `আপনার অর্ডার #${orderNum}-এর বর্তমান অবস্থা: ${status}`,
          `Your order #${orderNum} is now ${status}.`,
          'order',
          { link: '/?route=account&tab=orders', meta: { orderId, orderNumber: orderNum } }
        );
        await dispatchCustomerPush(
          db,
          row.customer_id,
          'order',
          {
            title: `Order #${orderNum} — ${status}`,
            body: `Your order status has been updated to ${status}.`,
            url: '/?route=account&tab=orders',
            orderId,
            category: 'order',
          },
          `ord_status_${orderId}_${status}_${now}`
        );
      }
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
      await logServerAnalyticsEvent(db, req, {
        userId: row.customer_id,
        eventType: 'order_completed',
        pagePath: '/admin/orders',
        contentId: String(existing.productId || ''),
        contentType: 'service',
        metadata: { orderId },
        now,
      });
      const completedOrderNum = String(existing.orderNumber || orderId);
      await insertNotification(
        db,
        row.customer_id,
        'অর্ডার সম্পন্ন হয়েছে',
        'Order Completed',
        `আপনার অর্ডার #${completedOrderNum} সফলভাবে ডেলিভারি সম্পন্ন হয়েছে।`,
        `Your order #${completedOrderNum} has been completed.`,
        'order',
        { link: '/?route=account&tab=orders', meta: { orderId, orderNumber: completedOrderNum } }
      );
      await dispatchCustomerPush(
        db,
        row.customer_id,
        'order',
        {
          title: `Order #${completedOrderNum} Completed!`,
          body: `Your order #${completedOrderNum} has been delivered and completed.`,
          url: '/?route=account&tab=orders',
          orderId,
          category: 'order',
        },
        `ord_complete_${orderId}`
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
      const cancelledOrderNum = String(existing.orderNumber || orderId);
      await insertNotification(
        db,
        row.customer_id,
        'অর্ডার বাতিল করা হয়েছে',
        'Order Cancelled',
        `অর্ডার #${cancelledOrderNum} বাতিল হয়েছে।${refundedBdt > 0 ? ` ৳${refundedBdt} ওয়ালেটে ফেরত দেওয়া হয়েছে।` : ''}`,
        `Order #${cancelledOrderNum} cancelled.${refundedBdt > 0 ? ` ৳${refundedBdt} refunded to wallet.` : ''}`,
        'order',
        { link: '/?route=account&tab=orders', meta: { orderId, orderNumber: cancelledOrderNum } }
      );
      await dispatchCustomerPush(
        db,
        row.customer_id,
        'order',
        {
          title: `Order #${cancelledOrderNum} Cancelled`,
          body: refundedBdt > 0 ? `৳${refundedBdt} refunded to your wallet.` : cancelReason || 'Your order has been cancelled.',
          url: '/?route=account&tab=orders',
          orderId,
          category: 'order',
        },
        `ord_cancel_${orderId}`
      );
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
        verified?: boolean;
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
      const nextVerified =
        typeof body.verified === 'boolean' ? (body.verified ? 1 : 0) : Number(targetRow.is_verified || 0);

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
        'UPDATE users SET display_name = ?, phone_e164 = ?, language = ?, admin_notes = ?, is_verified = ?, updated_at = ? WHERE uid = ?',
        [nextName, nextPhone, nextLanguage, nextNotes, nextVerified, now, targetUid]
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
      if (saved) {
        await syncPaymentMethodToSettings(
          db,
          saved.code,
          saved.account_number,
          saved.account_name,
          saved.enabled === 1
        );
      }
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
      await syncPaymentMethodToSettings(admin.db, existing.code, '', existing.account_name, false);
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
        type?:
          | 'order'
          | 'payment'
          | 'wallet'
          | 'referral'
          | 'system'
          | 'promo'
          | 'new_app'
          | 'app_update'
          | 'announcement'
          | 'support'
          | 'reward';
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
        body.type === 'promo' ||
        body.type === 'new_app' ||
        body.type === 'app_update' ||
        body.type === 'announcement' ||
        body.type === 'support' ||
        body.type === 'reward'
          ? body.type
          : 'system';

      if (titleBn.length < 2 || messageBn.length < 2) {
        res.status(400).json({ ok: false, error: 'নোটিফিকেশনের শিরোনাম এবং বার্তা লিখুন।' });
        return;
      }

      let recipientCount = 0;
      let targetLabel = targetUid;
      const deliveredUserIds: string[] = [];
      const notifLink = '/?route=account&tab=notifications';
      if (targetUidsRaw.length > 0) {
        for (const uidItem of targetUidsRaw) {
          const exists = await db.first<{ uid: string }>('SELECT uid FROM users WHERE uid = ? LIMIT 1', [uidItem]);
          if (exists) {
            await insertNotification(db, uidItem, titleBn, titleEn, messageBn, messageEn, type, { link: notifLink });
            deliveredUserIds.push(uidItem);
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
          await insertNotification(db, u.uid, titleBn, titleEn, messageBn, messageEn, type, { link: notifLink });
          deliveredUserIds.push(u.uid);
          recipientCount += 1;
        }
      } else {
        const exists = await db.first<{ uid: string }>('SELECT uid FROM users WHERE uid = ? LIMIT 1', [targetUid]);
        if (!exists) {
          res.status(404).json({ ok: false, error: 'নির্বাচিত ব্যবহারকারী পাওয়া যায়নি।' });
          return;
        }
        await insertNotification(db, targetUid, titleBn, titleEn, messageBn, messageEn, type, { link: notifLink });
        deliveredUserIds.push(targetUid);
        recipientCount = 1;
      }

      await dispatchBroadcastPush(
        db,
        deliveredUserIds,
        type,
        {
          title: titleEn || titleBn,
          body: messageEn || messageBn,
          url: notifLink,
          category: type,
        },
        `admin_notif_${Date.now()}`
      );

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
        imageUrl?: string;
        startDate?: string;
        expiresAt?: string;
        dismissible?: boolean;
        active?: boolean;
      };
      const imageUrl = String(body.imageUrl || '').trim();
      if (imageUrl && !isSafePackageAssetUrl(imageUrl)) {
        res.status(400).json({ ok: false, error: 'Invalid announcement image URL.' });
        return;
      }
      const now = Date.now();
      const id = generateSecureId('ann', 8);
      const isActive = body.active !== false;
      const payload = {
        id,
        titleBn: String(body.titleBn || '').trim().slice(0, 200),
        titleEn: String(body.titleEn || '').trim().slice(0, 200),
        messageBn: String(body.messageBn || '').trim().slice(0, 1000),
        messageEn: String(body.messageEn || '').trim().slice(0, 1000),
        type: String(body.type || 'general').trim().slice(0, 32),
        ...(imageUrl ? { imageUrl } : {}),
        ...(typeof body.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate.trim())
          ? { startDate: body.startDate.trim() }
          : {}),
        ...(typeof body.expiresAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.expiresAt.trim())
          ? { expiresAt: body.expiresAt.trim() }
          : {}),
        dismissible: body.dismissible !== false,
        active: isActive,
        createdBy: user.uid,
        createdAt: now,
        updatedAt: now,
      };
      await db.run(
        'INSERT INTO announcements (id, active, payload_json, created_at) VALUES (?, ?, ?, ?)',
        [id, isActive ? 1 : 0, JSON.stringify(payload), now]
      );
      if (isActive) {
        const activeUsers = await db.all<{ uid: string }>(
          `SELECT uid FROM users WHERE status = 'active' LIMIT 1000`
        );
        await dispatchBroadcastPush(
          db,
          activeUsers.map((u) => u.uid),
          payload.type === 'offer' || payload.type === 'promo' ? 'promo' : 'announcement',
          {
            title: payload.titleEn || payload.titleBn || 'Important Announcement — DIGITAL HUB',
            body: payload.messageEn || payload.messageBn || 'Check the latest announcement on DIGITAL HUB.',
            url: '/?route=home#latest-updates',
            category: 'announcement',
          },
          `ann_${id}`
        );
      }
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
      res.status(201).json({ ok: true, id, announcement: payload });
    } catch (err) {
      handleRouteError(res, err, 'Failed to broadcast announcement.');
    }
  });

  router.put('/admin/announcements/:id', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const id = String(req.params.id || '').trim();
      const row = await admin.db.first<{ payload_json: string; created_at: number }>(
        'SELECT payload_json, created_at FROM announcements WHERE id = ? LIMIT 1',
        [id]
      );
      if (!row) {
        res.status(404).json({ ok: false, error: 'Announcement not found.' });
        return;
      }
      const existing = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      const body = (req.body || {}) as {
        titleBn?: string;
        titleEn?: string;
        messageBn?: string;
        messageEn?: string;
        type?: string;
        imageUrl?: string;
        startDate?: string;
        expiresAt?: string;
        dismissible?: boolean;
        active?: boolean;
      };
      const imageUrl = body.imageUrl !== undefined ? String(body.imageUrl || '').trim() : String(existing.imageUrl || '');
      if (imageUrl && !isSafePackageAssetUrl(imageUrl)) {
        res.status(400).json({ ok: false, error: 'Invalid announcement image URL.' });
        return;
      }
      const now = Date.now();
      const nextActive = typeof body.active === 'boolean' ? body.active : existing.active !== false;
      const cleanStartDate =
        body.startDate !== undefined
          ? /^\d{4}-\d{2}-\d{2}$/.test(String(body.startDate || '').trim())
            ? String(body.startDate).trim()
            : ''
          : String(existing.startDate || '');
      const cleanExpiresAt =
        body.expiresAt !== undefined
          ? /^\d{4}-\d{2}-\d{2}$/.test(String(body.expiresAt || '').trim())
            ? String(body.expiresAt).trim()
            : ''
          : String(existing.expiresAt || '');

      const nextPayload: Record<string, unknown> = {
        ...existing,
        id,
        titleBn: body.titleBn !== undefined ? String(body.titleBn).trim().slice(0, 200) : existing.titleBn,
        titleEn: body.titleEn !== undefined ? String(body.titleEn).trim().slice(0, 200) : existing.titleEn,
        messageBn: body.messageBn !== undefined ? String(body.messageBn).trim().slice(0, 1000) : existing.messageBn,
        messageEn: body.messageEn !== undefined ? String(body.messageEn).trim().slice(0, 1000) : existing.messageEn,
        type: body.type !== undefined ? String(body.type).trim().slice(0, 32) : existing.type,
        dismissible: typeof body.dismissible === 'boolean' ? body.dismissible : existing.dismissible !== false,
        active: nextActive,
        createdAt: existing.createdAt || row.created_at || now,
        updatedAt: now,
      };
      if (imageUrl) nextPayload.imageUrl = imageUrl;
      else delete nextPayload.imageUrl;
      if (cleanStartDate) nextPayload.startDate = cleanStartDate;
      else delete nextPayload.startDate;
      if (cleanExpiresAt) nextPayload.expiresAt = cleanExpiresAt;
      else delete nextPayload.expiresAt;

      await admin.db.run('UPDATE announcements SET active = ?, payload_json = ? WHERE id = ?', [
        nextActive ? 1 : 0,
        JSON.stringify(nextPayload),
        id,
      ]);
      await insertAuditLog(
        admin.db,
        admin.user.uid,
        getUserPrimaryIdentifier(admin.user),
        'ANNOUNCEMENT_UPDATED',
        'announcements',
        id,
        `Updated announcement: ${String(nextPayload.titleEn || nextPayload.titleBn || id)}`,
        { newValue: String(nextPayload.titleEn || nextPayload.titleBn || id) }
      );
      res.json({ ok: true, announcement: nextPayload });
    } catch (err) {
      handleRouteError(res, err, 'Failed to update announcement.');
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
        'support'
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
      await insertNotification(
        admin.db,
        row.user_id,
        isCredit ? 'কয়েন রিডিম সম্পন্ন হয়েছে' : 'কয়েন রিডিম বাতিল হয়েছে',
        isCredit ? 'Coin Redemption Credited' : 'Coin Redemption Rejected',
        isCredit
          ? `আপনার ${row.coins} কয়েন রিডিম অনুমোদিত হয়ে ওয়ালেটে ব্যালেন্স যুক্ত হয়েছে।`
          : `আপনার ${row.coins} কয়েন রিডিম অনুরোধ বাতিল করে কয়েন ফেরত দেওয়া হয়েছে।`,
        isCredit
          ? `Your ${row.coins} coins redemption was credited to your wallet.`
          : `Your ${row.coins} coins redemption was rejected and coins were refunded.`,
        'reward'
      );
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
      if (binary.length > 10 * 1024 * 1024) {
        res.status(413).json({ ok: false, error: 'Image file exceeds the maximum 10MB size limit.' });
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
        'mobileApps',
        'games',
        'advertisements',
        'adNetworks',
        'managedAdUnits',
        'banners',
        'heroBanners',
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
        const cleanPriceBdt = Math.round(priceBdt);
        const originalPriceBdt =
          Number.isFinite(rawOrigPrice) && rawOrigPrice > cleanPriceBdt ? Math.round(rawOrigPrice) : 0;
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

        const sanitizedSubPackages = Array.isArray(body.data.packages)
          ? (body.data.packages as Array<Record<string, unknown>>)
              .filter((pk) => pk && String(pk.nameEn || pk.nameBn || '').trim() && Number(pk.priceBdt) > 0)
              .slice(0, 200)
              .map((pk, idx) => {
                const pkPrice = Math.max(1, Math.round(Number(pk.priceBdt)));
                const rawPkOrig = Number(pk.originalPriceBdt || 0);
                const pkOrig = Number.isFinite(rawPkOrig) && rawPkOrig > pkPrice ? Math.round(rawPkOrig) : 0;
                const rawPkSup = Number(pk.supplierPriceBdt || 0);
                const pkSup = Number.isFinite(rawPkSup) && rawPkSup > 0 ? Math.round(rawPkSup) : 0;
                const availRaw = String(pk.availability || '').trim();
                const pkAvail =
                  availRaw === 'out_of_stock' || availRaw === 'limited' || availRaw === 'in_stock'
                    ? availRaw
                    : undefined;
                return {
                  id: String(pk.id || `pkg_${idx + 1}`).trim().slice(0, 64),
                  nameBn: String(pk.nameBn || pk.nameEn || '').trim().slice(0, 120),
                  nameEn: String(pk.nameEn || pk.nameBn || '').trim().slice(0, 120),
                  priceBdt: pkPrice,
                  ...(pkOrig > 0 ? { originalPriceBdt: pkOrig } : {}),
                  ...(pkSup > 0 ? { supplierPriceBdt: pkSup } : {}),
                  ...(pkAvail ? { availability: pkAvail } : {}),
                  ...(pk.durationBn ? { durationBn: String(pk.durationBn).trim().slice(0, 60) } : {}),
                  ...(pk.durationEn ? { durationEn: String(pk.durationEn).trim().slice(0, 60) } : {}),
                  ...(pk.deliveryDurationBn ? { deliveryDurationBn: String(pk.deliveryDurationBn).trim().slice(0, 60) } : {}),
                  ...(pk.deliveryDurationEn ? { deliveryDurationEn: String(pk.deliveryDurationEn).trim().slice(0, 60) } : {}),
                  ...(pk.tag ? { tag: String(pk.tag).trim().slice(0, 32) } : {}),
                };
              })
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
          ...(sanitizedSubPackages !== undefined ? { packages: sanitizedSubPackages } : {}),
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

      if (col === 'mobileApps') {
        const appName = String(body.data.name || '').trim().slice(0, 120);
        if (appName.length < 2) {
          res.status(400).json({ ok: false, error: 'App name must be at least 2 characters.' });
          return;
        }
        if (
          !isSafePackageAssetUrl(body.data.logoUrl) ||
          !isSafePackageAssetUrl(body.data.bannerImageUrl)
        ) {
          res.status(400).json({ ok: false, error: 'Invalid app logo or banner image URL.' });
          return;
        }
        const screenshots = Array.isArray(body.data.screenshots)
          ? body.data.screenshots
              .map((s) => String(s || '').trim())
              .filter((s) => s && isSafePackageAssetUrl(s))
              .slice(0, 8)
          : [];
        const rawUrl = String(body.data.downloadUrl || body.data.playStoreUrl || '').trim();
        const safeDownloadUrl =
          rawUrl && (rawUrl.startsWith('https://') || rawUrl.startsWith('http://') || rawUrl.startsWith('/'))
            ? rawUrl.slice(0, 500)
            : '';
        payloadToSave = {
          ...body.data,
          id: docId,
          name: appName,
          version: String(body.data.version || 'v1.0.0').trim().slice(0, 40),
          sizeLabel: String(body.data.sizeLabel || '25 MB').trim().slice(0, 40),
          downloadUrl: safeDownloadUrl,
          playStoreUrl: safeDownloadUrl || String(body.data.playStoreUrl || '').trim().slice(0, 500),
          screenshots,
          featured: Boolean(body.data.featured),
          popular: Boolean(body.data.popular),
          trending: Boolean(body.data.trending),
          visible: body.data.visible !== false,
          updatedAt: Number(body.data.updatedAt || now),
        };
      }

      if (col === 'games') {
        const gameTitle = String(body.data.name || body.data.titleEn || '').trim().slice(0, 120);
        if (gameTitle.length < 2) {
          res.status(400).json({ ok: false, error: 'Game name must be at least 2 characters.' });
          return;
        }
        if (
          !isSafePackageAssetUrl(body.data.iconUrl) ||
          !isSafePackageAssetUrl(body.data.imageUrl)
        ) {
          res.status(400).json({ ok: false, error: 'Invalid game icon or cover image URL.' });
          return;
        }
        const screenshots = Array.isArray(body.data.screenshots)
          ? body.data.screenshots
              .map((s) => String(s || '').trim())
              .filter((s) => s && isSafePackageAssetUrl(s))
              .slice(0, 8)
          : [];
        const rawPlayUrl = String(body.data.playUrl || '').trim();
        const rawDownloadUrl = String(body.data.downloadUrl || '').trim();
        const sanitizeExternal = (u: string) =>
          u && (u.startsWith('https://') || u.startsWith('http://') || u.startsWith('/'))
            ? u.slice(0, 500)
            : '';
        payloadToSave = {
          ...body.data,
          id: docId,
          name: gameTitle,
          slug: String(body.data.slug || docId).trim().slice(0, 80),
          category: String(body.data.category || 'android_games').trim().slice(0, 48),
          developer: String(body.data.developer || 'Official Publisher').trim().slice(0, 80),
          shortDescBn: String(body.data.shortDescBn || body.data.shortDescEn || '').trim().slice(0, 400),
          shortDescEn: String(body.data.shortDescEn || body.data.shortDescBn || '').trim().slice(0, 400),
          descriptionBn: String(body.data.descriptionBn || body.data.shortDescBn || '').trim().slice(0, 1600),
          descriptionEn: String(body.data.descriptionEn || body.data.shortDescEn || '').trim().slice(0, 1600),
          iconUrl: String(body.data.iconUrl || body.data.imageUrl || '/assets/products/prod_ff_bd_diamonds.jpg').trim().slice(0, 200000),
          imageUrl: String(body.data.imageUrl || body.data.iconUrl || '/assets/products/prod_ff_bd_diamonds.jpg').trim().slice(0, 200000),
          screenshots,
          playUrl: sanitizeExternal(rawPlayUrl),
          downloadUrl: sanitizeExternal(rawDownloadUrl),
          relatedProductId: String(body.data.relatedProductId || '').trim().slice(0, 80),
          featured: Boolean(body.data.featured),
          popular: Boolean(body.data.popular),
          isNew: Boolean(body.data.isNew),
          visible: body.data.visible !== false,
          updatedAt: Number(body.data.updatedAt || now),
        };
      }

      if (col === 'heroBanners') {
        const imageUrl = String(body.data.imageUrl || '').trim();
        const mobileImageUrl = String(body.data.mobileImageUrl || '').trim();
        if (
          (imageUrl && !isSafePackageAssetUrl(imageUrl)) ||
          (mobileImageUrl && !isSafePackageAssetUrl(mobileImageUrl))
        ) {
          res.status(400).json({ ok: false, error: 'Invalid Hero Banner image URL or format.' });
          return;
        }
        const linkType = body.data.linkType === 'external_url' ? 'external_url' : 'internal_route';
        let cleanTargetUrl = '';
        if (linkType === 'external_url') {
          const rawTarget = String(body.data.targetUrl || '').trim();
          try {
            const parsedUrl = new URL(rawTarget);
            if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
              res.status(400).json({ ok: false, error: 'External destination URL must use https:// or http://.' });
              return;
            }
            cleanTargetUrl = parsedUrl.toString().slice(0, 600);
          } catch {
            res.status(400).json({ ok: false, error: 'Valid external URL is required.' });
            return;
          }
        }
        const deviceRaw = String(body.data.deviceVisibility || 'both');
        const deviceVisibility = deviceRaw === 'desktop' || deviceRaw === 'mobile' ? deviceRaw : 'both';
        const cleanStart =
          typeof body.data.startDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.data.startDate.trim())
            ? body.data.startDate.trim()
            : '';
        const cleanEnd =
          typeof body.data.endDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.data.endDate.trim())
            ? body.data.endDate.trim()
            : '';
        const allowedThemes = new Set(['navy_services', 'white_wallet', 'orange_gaming', 'navy_support']);
        const rawTheme = String(body.data.themeVariant || 'navy_services').trim();
        const themeVariant = allowedThemes.has(rawTheme) ? rawTheme : 'navy_services';
        const allowedIcons = new Set([
          'sparkles',
          'gamepad',
          'gift',
          'flame',
          'zap',
          'crown',
          'tv',
          'star',
          'shopping',
          'shield',
          'smartphone',
          'award',
        ]);
        const rawIcon = String(body.data.iconName || 'sparkles').trim().toLowerCase();
        const cleanIcon = allowedIcons.has(rawIcon) ? rawIcon : 'sparkles';
        const imageFit = body.data.imageFit === 'contain' ? 'contain' : 'cover';

        payloadToSave = {
          id: docId,
          badgeBn: String(body.data.badgeBn || '').trim().slice(0, 80),
          badgeEn: String(body.data.badgeEn || '').trim().slice(0, 80),
          titleBn: String(body.data.titleBn || body.data.titleEn || 'ডিজিটাল সার্ভিস').trim().slice(0, 180),
          titleEn: String(body.data.titleEn || body.data.titleBn || 'Digital Services').trim().slice(0, 180),
          subtitleBn: String(body.data.subtitleBn || '').trim().slice(0, 320),
          subtitleEn: String(body.data.subtitleEn || '').trim().slice(0, 320),
          buttonTextBn: String(body.data.buttonTextBn || 'এখনই দেখুন').trim().slice(0, 60),
          buttonTextEn: String(body.data.buttonTextEn || 'Explore Now').trim().slice(0, 60),
          linkType,
          ctaRoute: linkType === 'internal_route' ? String(body.data.ctaRoute || 'services').trim().slice(0, 64) : undefined,
          targetUrl: linkType === 'external_url' ? cleanTargetUrl : undefined,
          openInNewTab: Boolean(body.data.openInNewTab ?? linkType === 'external_url'),
          clickable: body.data.clickable !== false,
          themeVariant,
          iconName: cleanIcon,
          showIcon: body.data.showIcon === true,
          imageFit,
          imageUrl,
          ...(mobileImageUrl ? { mobileImageUrl } : {}),
          deviceVisibility,
          sortOrder: Math.max(0, Math.floor(Number(body.data.sortOrder ?? 1) || 1)),
          enabled: body.data.enabled !== false,
          ...(cleanStart ? { startDate: cleanStart } : {}),
          ...(cleanEnd ? { endDate: cleanEnd } : {}),
          createdAt: typeof body.data.createdAt === 'number' && body.data.createdAt > 0 ? body.data.createdAt : now,
          updatedAt: now,
        };
      }

      if (col === 'settings' && docId === 'global') {
        payloadToSave = {
          ...payloadToSave,
          rewardedAdDailyLimit: Math.min(20, Math.max(1, Math.floor(Number(payloadToSave.rewardedAdDailyLimit ?? 10) || 10))),
          watchEarnCoinsPerAd: Math.max(1, Math.floor(Number(payloadToSave.watchEarnCoinsPerAd ?? 5) || 5)),
          watchEarnCoinsPerBdt: Math.max(1, Math.floor(Number(payloadToSave.watchEarnCoinsPerBdt ?? 10) || 10)),
          heroAutoPlayMs: Math.min(20000, Math.max(2000, Math.floor(Number(payloadToSave.heroAutoPlayMs ?? 5500) || 5500))),
          dailyRewardEnabled: payloadToSave.dailyRewardEnabled !== false,
          dailyRewardCoins: Math.min(10000, Math.max(1, Math.floor(Number(payloadToSave.dailyRewardCoins ?? 10) || 10))),
          streakEnabled: payloadToSave.streakEnabled !== false,
          streakDay7BonusCoins: Math.min(10000, Math.max(0, Math.floor(Number(payloadToSave.streakDay7BonusCoins ?? 20) || 0))),
        };
      }

      if (col === 'managedAdUnits') {
        const rawUrl = String(body.data.originalUrl || '').trim();
        let safeUrl: string | undefined;
        if (rawUrl) {
          try {
            const parsedUrl = new URL(rawUrl);
            if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
              res.status(400).json({ ok: false, error: 'Ad URL must start with https:// or http://.' });
              return;
            }
            safeUrl = parsedUrl.toString().slice(0, 600);
          } catch {
            res.status(400).json({ ok: false, error: 'Invalid Ad URL format.' });
            return;
          }
        }
        payloadToSave = {
          ...payloadToSave,
          ...(safeUrl ? { originalUrl: safeUrl } : {}),
          ...(typeof body.data.label === 'string' && body.data.label.trim()
            ? { label: body.data.label.trim().slice(0, 140) }
            : {}),
          ...(typeof body.data.labelBn === 'string' && body.data.labelBn.trim()
            ? { labelBn: body.data.labelBn.trim().slice(0, 140) }
            : {}),
        };
      }

      await admin.db.run(
        `INSERT INTO catalog_overrides (collection, doc_id, deleted, payload_json, updated_at)
         VALUES (?, ?, 0, ?, ?)
         ON CONFLICT(collection, doc_id) DO UPDATE SET deleted = 0, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
        [col, docId, JSON.stringify(payloadToSave), now]
      );
      if (col === 'settings' && docId === 'global') {
        await syncSettingsToPaymentMethods(admin.db, payloadToSave);
      }
      if (col === 'mobileApps' && body.data.notifyUsers === true && payloadToSave.visible !== false) {
        const isUpdate = body.auditAction === 'update';
        const appName = String(payloadToSave.name || docId);
        const activeUsers = await admin.db.all<{ uid: string }>(
          `SELECT uid FROM users WHERE status = 'active' LIMIT 1000`
        );
        for (const u of activeUsers) {
          await insertNotification(
            admin.db,
            u.uid,
            isUpdate ? `অ্যাপ আপডেট: ${appName}` : `নতুন অ্যাপ যুক্ত হয়েছে: ${appName}`,
            isUpdate ? `App Updated: ${appName}` : `New App Added: ${appName}`,
            `${appName} (${String(payloadToSave.version || 'Latest')}) এখন স্মার্ট অ্যাপ স্টোরে উপলব্ধ।`,
            `${appName} (${String(payloadToSave.version || 'Latest')}) is now available in the Smart App Store.`,
            isUpdate ? 'app_update' : 'new_app'
          );
        }
      }
      if (
        col === 'settings' ||
        col === 'advertisements' ||
        col === 'banners' ||
        col === 'heroBanners' ||
        col === 'managedAdUnits' ||
        col === 'categories' ||
        col === 'mobileApps' ||
        col === 'games'
      ) {
        await insertAuditLog(
          admin.db,
          admin.user.uid,
          getUserPrimaryIdentifier(admin.user),
          col === 'settings' ? 'SETTINGS_UPDATED' : `${col.toUpperCase()}_SAVED`,
          col,
          docId,
          `Saved ${col}/${docId}`,
          {
            newValue: String(
              (body.data as { siteName?: string; titleEn?: string; titleBn?: string; name?: string }).siteName ||
                (body.data as { titleEn?: string; name?: string }).titleEn ||
                (body.data as { name?: string }).name ||
                docId
            ),
          }
        );
      }
      res.json({ ok: true, id: docId, data: payloadToSave });
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

  // =========================================================================
  // 11. REAL DATABASE ANALYTICS, SMART APP STORE & COIN MANAGEMENT ENDPOINTS
  // =========================================================================
  const recentAnalyticsBucket = new Map<string, number>();

  router.post('/analytics/track', async (req, res) => {
    try {
      const uaMeta = parseUserAgentMetadata(req.headers['user-agent']);
      if (uaMeta.isLikelyBot) {
        res.json({ ok: true, filtered: 'bot' });
        return;
      }

      const body = (req.body || {}) as {
        visitorId?: string;
        sessionId?: string;
        eventType?: string;
        pagePath?: string;
        appId?: string;
        contentId?: string;
        contentType?: string;
        contentCategory?: string;
        deviceType?: string;
        referrerHost?: string;
        metadata?: Record<string, unknown>;
      };

      const rawEventType = String(body.eventType || 'page_view').trim();
      const eventType = VALID_ANALYTICS_EVENT_TYPES.has(rawEventType) ? rawEventType : 'page_view';
      const visitorId = String(body.visitorId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      if (visitorId.length < 6) {
        res.status(400).json({ ok: false, error: 'Invalid visitor identifier.' });
        return;
      }
      const sessionId =
        String(body.sessionId || `sess_${visitorId.slice(0, 24)}`)
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 64) || `sess_${visitorId.slice(0, 24)}`;
      const pagePath = String(body.pagePath || '/').trim().slice(0, 140) || '/';
      const appId = String(body.appId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      const contentId =
        String(body.contentId || appId || '')
          .trim()
          .replace(/[^a-zA-Z0-9_.:-]/g, '')
          .slice(0, 100);
      const contentType = String(body.contentType || (appId ? 'app' : '')).trim().slice(0, 32);
      const contentCategory = String(body.contentCategory || '').trim().slice(0, 64);
      const deviceType =
        body.deviceType === 'mobile' || body.deviceType === 'tablet' || body.deviceType === 'desktop'
          ? body.deviceType
          : uaMeta.deviceType;
      const referrerHost = String(body.referrerHost || 'direct').trim().slice(0, 80) || 'direct';

      const now = Date.now();
      const throttleKey = `${visitorId}:${eventType}:${pagePath}:${contentId || appId}`;
      const prevTs = recentAnalyticsBucket.get(throttleKey) || 0;
      const minGapMs =
        eventType === 'heartbeat'
          ? 20_000
          : eventType === 'page_view' || eventType === 'homepage_view'
            ? 4_000
            : eventType === 'app_view' || eventType === 'game_view' || eventType === 'product_view' || eventType === 'service_view'
              ? 3_000
              : 1_200;
      if (now - prevTs < minGapMs) {
        res.json({ ok: true, throttled: true });
        return;
      }
      recentAnalyticsBucket.set(throttleKey, now);
      if (recentAnalyticsBucket.size > 6000) {
        const cutoff = now - 120_000;
        for (const [k, ts] of recentAnalyticsBucket.entries()) {
          if (ts < cutoff) recentAnalyticsBucket.delete(k);
        }
      }

      const session = await resolveSessionFromRequest(req).catch(() => null);
      const db = session ? session.db : await getAppDatabase();
      const id = await logServerAnalyticsEvent(db, req, {
        visitorId,
        sessionId,
        userId: session?.user.uid || '',
        eventType,
        pagePath,
        appId,
        contentId,
        contentType,
        contentCategory,
        deviceTypeHint: deviceType,
        referrerHost,
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : undefined,
        now,
      });

      res.status(201).json({ ok: true, id });
    } catch {
      res.json({ ok: false });
    }
  });

  router.get('/admin/analytics', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db } = admin;
      const now = Date.now();
      const todayMs = getDhakaDayStartMs(now);
      const yesterdayMs = todayMs - 24 * 60 * 60 * 1000;
      const monthStartMs = getDhakaMonthStartMs(now);
      const onlineCutoffMs = now - 5 * 60 * 1000;
      const sevenDaysAgo = todayMs - 6 * 24 * 60 * 60 * 1000;
      const prev7dStartMs = sevenDaysAgo - 7 * 24 * 60 * 60 * 1000;
      const thirtyDaysAgo = todayMs - 29 * 24 * 60 * 60 * 1000;

      const rawFrom = Number(req.query.from || 0);
      const rawTo = Number(req.query.to || 0);
      const rangeFrom = Number.isFinite(rawFrom) && rawFrom > 0 ? rawFrom : thirtyDaysAgo;
      const rangeTo = Number.isFinite(rawTo) && rawTo > rangeFrom ? rawTo : now;
      const spanMs = Math.max(24 * 60 * 60 * 1000, rangeTo - rangeFrom);
      const prevFrom = rangeFrom - spanMs;
      const prevTo = rangeFrom - 1;

      const [
        totalUsersRow,
        todayNewUsersRow,
        activeTodayRow,
        active7dRow,
        active30dRow,
        overallVisitorsRow,
        todayUniqueRow,
        yesterdayUniqueRow,
        monthUniqueRow,
        last7dUniqueRow,
        prev7dUniqueRow,
        onlineVisitorsRow,
        totalOrdersRow,
        pendingOrdersRow,
        completedOrdersRow,
        rewardClaimsRow,
        coinsTotalRow,
        pendingWithdrawalsRow,
        pendingTicketsRow,
        rangeEvents,
        prevEvents,
        rangeOrdersRows,
        prevOrdersCountRow,
        rangeNewUsers,
        rangeRewardRows,
        activeSessionsRows,
        recentEventRows,
        allFavoritesRows,
        allOrdersRows,
        contentEvents30dRows,
      ] = await Promise.all([
        db.first<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM users'),
        db.first<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM users WHERE created_at >= ?', [todayMs]),
        db.first<{ cnt: number }>(
          `SELECT COUNT(DISTINCT uid) AS cnt FROM (
             SELECT user_id AS uid FROM sessions WHERE last_seen_at >= ?
             UNION ALL
             SELECT user_id AS uid FROM analytics_events WHERE user_id != '' AND created_at >= ?
           )`,
          [todayMs, todayMs]
        ),
        db.first<{ cnt: number }>(
          `SELECT COUNT(DISTINCT uid) AS cnt FROM (
             SELECT user_id AS uid FROM sessions WHERE last_seen_at >= ?
             UNION ALL
             SELECT user_id AS uid FROM analytics_events WHERE user_id != '' AND created_at >= ?
           )`,
          [sevenDaysAgo, sevenDaysAgo]
        ),
        db.first<{ cnt: number }>(
          `SELECT COUNT(DISTINCT uid) AS cnt FROM (
             SELECT user_id AS uid FROM sessions WHERE last_seen_at >= ?
             UNION ALL
             SELECT user_id AS uid FROM analytics_events WHERE user_id != '' AND created_at >= ?
           )`,
          [thirtyDaysAgo, thirtyDaysAgo]
        ),
        db.first<{ cnt: number }>(`SELECT COUNT(DISTINCT visitor_id) AS cnt FROM analytics_events`),
        db.first<{ cnt: number }>(
          `SELECT COUNT(DISTINCT visitor_id) AS cnt FROM analytics_events WHERE created_at >= ?`,
          [todayMs]
        ),
        db.first<{ cnt: number }>(
          `SELECT COUNT(DISTINCT visitor_id) AS cnt FROM analytics_events WHERE created_at >= ? AND created_at < ?`,
          [yesterdayMs, todayMs]
        ),
        db.first<{ cnt: number }>(
          `SELECT COUNT(DISTINCT visitor_id) AS cnt FROM analytics_events WHERE created_at >= ?`,
          [monthStartMs]
        ),
        db.first<{ cnt: number }>(
          `SELECT COUNT(DISTINCT visitor_id) AS cnt FROM analytics_events WHERE created_at >= ?`,
          [sevenDaysAgo]
        ),
        db.first<{ cnt: number }>(
          `SELECT COUNT(DISTINCT visitor_id) AS cnt FROM analytics_events WHERE created_at >= ? AND created_at < ?`,
          [prev7dStartMs, sevenDaysAgo]
        ),
        db.first<{ cnt: number }>(
          `SELECT COUNT(DISTINCT visitor_id) AS cnt FROM (
             SELECT visitor_id FROM visitor_sessions WHERE last_seen_at >= ?
             UNION ALL
             SELECT visitor_id FROM analytics_events WHERE created_at >= ?
           )`,
          [onlineCutoffMs, onlineCutoffMs]
        ),
        db.first<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM orders`),
        db.first<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM orders WHERE status IN ('Pending Payment', 'Verification Pending', 'Processing')`
        ),
        db.first<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM orders WHERE status = 'Completed'`),
        db.first<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM rewarded_claims'),
        db.first<{ totalCoins: number }>(
          'SELECT COALESCE(SUM(coins_lifetime_earned), 0) AS totalCoins FROM watch_earn_balances'
        ),
        db.first<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM withdrawals WHERE status = 'Pending'`),
        db.first<{ cnt: number }>(`SELECT COUNT(*) AS cnt FROM support_tickets WHERE status = 'open'`),
        db.all<{
          visitor_id: string;
          session_id: string;
          user_id: string;
          event_type: string;
          page_path: string;
          app_id: string;
          content_id: string;
          content_type: string;
          content_category: string;
          device_type: string;
          browser: string;
          os: string;
          country: string;
          referrer_host: string;
          created_at: number;
        }>(
          `SELECT visitor_id, session_id, user_id, event_type, page_path, app_id,
                  content_id, content_type, content_category, device_type, browser, os, country, referrer_host, created_at
           FROM analytics_events WHERE created_at BETWEEN ? AND ? ORDER BY created_at ASC LIMIT 40000`,
          [rangeFrom, rangeTo]
        ),
        db.all<{
          visitor_id: string;
          event_type: string;
          created_at: number;
        }>(
          `SELECT visitor_id, event_type, created_at
           FROM analytics_events WHERE created_at BETWEEN ? AND ? LIMIT 40000`,
          [prevFrom, prevTo]
        ),
        db.all<{ created_at: number; status: string; payload_json: string }>(
          `SELECT created_at, status, payload_json FROM orders WHERE created_at BETWEEN ? AND ? LIMIT 10000`,
          [rangeFrom, rangeTo]
        ),
        db.first<{ cnt: number }>(
          `SELECT COUNT(*) AS cnt FROM orders WHERE created_at BETWEEN ? AND ?`,
          [prevFrom, prevTo]
        ),
        db.all<{ created_at: number }>(
          `SELECT created_at FROM users WHERE created_at BETWEEN ? AND ? ORDER BY created_at ASC LIMIT 10000`,
          [rangeFrom, rangeTo]
        ),
        db.all<{ coins: number; created_at: number }>(
          `SELECT coins, created_at FROM ad_reward_transactions WHERE coins > 0 AND created_at BETWEEN ? AND ? LIMIT 10000`,
          [rangeFrom, rangeTo]
        ),
        db.all<{
          session_id: string;
          visitor_id: string;
          user_id: string;
          first_seen_at: number;
          last_seen_at: number;
          visit_count: number;
          is_returning: number;
          current_page: string;
          last_event_type: string;
          last_content_id: string;
          device_type: string;
          browser: string;
          os: string;
          referrer_host: string;
          country: string;
        }>(
          `SELECT * FROM visitor_sessions WHERE last_seen_at >= ? ORDER BY last_seen_at DESC LIMIT 80`,
          [onlineCutoffMs]
        ),
        db.all<{
          id: string;
          visitor_id: string;
          session_id: string;
          user_id: string;
          event_type: string;
          page_path: string;
          app_id: string;
          content_id: string;
          content_type: string;
          device_type: string;
          browser: string;
          os: string;
          country: string;
          referrer_host: string;
          created_at: number;
        }>(
          `SELECT id, visitor_id, session_id, user_id, event_type, page_path, app_id,
                  content_id, content_type, device_type, browser, os, country, referrer_host, created_at
           FROM analytics_events
           WHERE event_type != 'heartbeat'
           ORDER BY created_at DESC
           LIMIT 50`
        ),
        db.all<{ app_id: string; cnt: number }>(`SELECT app_id, COUNT(*) AS cnt FROM app_favorites GROUP BY app_id`),
        db.all<{ payload_json: string; created_at: number }>(
          `SELECT payload_json, created_at FROM orders ORDER BY created_at DESC LIMIT 10000`
        ),
        db.all<{
          visitor_id: string;
          event_type: string;
          app_id: string;
          content_id: string;
          content_type: string;
          content_category: string;
          created_at: number;
        }>(
          `SELECT visitor_id, event_type, app_id, content_id, content_type, content_category, created_at
           FROM analytics_events
           WHERE (content_id != '' OR app_id != '')
             AND event_type IN ('app_view', 'game_view', 'product_view', 'service_view', 'app_download', 'download_click', 'play_click', 'external_link_click')
           ORDER BY created_at DESC
           LIMIT 50000`
        ),
      ]);

      // Fetch returning visitor counts inside range from visitor_sessions
      const returningSessionsInRange = await db.all<{ visitor_id: string }>(
        `SELECT DISTINCT visitor_id FROM visitor_sessions WHERE is_returning = 1 AND last_seen_at BETWEEN ? AND ?`,
        [rangeFrom, rangeTo]
      );
      const returningVisitorSet = new Set(returningSessionsInRange.map((r) => r.visitor_id));

      const dayBuckets = new Map<
        string,
        {
          date: string;
          visitors: Set<string>;
          returningVisitors: Set<string>;
          pageViews: number;
          appViews: number;
          gameViews: number;
          serviceViews: number;
          downloads: number;
          playClicks: number;
          orders: number;
          registrations: number;
          coins: number;
        }
      >();
      const ensureDay = (ms: number) => {
        const key = getDhakaDateString(ms);
        let entry = dayBuckets.get(key);
        if (!entry) {
          entry = {
            date: key,
            visitors: new Set(),
            returningVisitors: new Set(),
            pageViews: 0,
            appViews: 0,
            gameViews: 0,
            serviceViews: 0,
            downloads: 0,
            playClicks: 0,
            orders: 0,
            registrations: 0,
            coins: 0,
          };
          dayBuckets.set(key, entry);
        }
        return entry;
      };

      // Pre-fill date axis for spans <= 95 days so daily chart never shows awkward gaps
      const daySpan = Math.ceil((rangeTo - rangeFrom) / (24 * 60 * 60 * 1000));
      if (daySpan <= 95) {
        for (let t = getDhakaDayStartMs(rangeFrom); t <= rangeTo; t += 24 * 60 * 60 * 1000) {
          ensureDay(t);
        }
      }

      const pageCounts = new Map<string, number>();
      const appDownloadCounts = new Map<string, number>();
      const sourceCounts = new Map<string, number>();
      const browserVisitors = new Map<string, Set<string>>();
      const osVisitors = new Map<string, Set<string>>();
      const countryVisitors = new Map<string, Set<string>>();
      const mobileVisitors = new Set<string>();
      const tabletVisitors = new Set<string>();
      const desktopVisitors = new Set<string>();
      const uniqueVisitorsRangeSet = new Set<string>();

      let pageViewsRange = 0;
      let homepageViewsRange = 0;
      let appViewsRange = 0;
      let gameViewsRange = 0;
      let productViewsRange = 0;
      let serviceViewsRange = 0;
      let downloadClicksRange = 0;
      let playClicksRange = 0;
      let externalClicksRange = 0;
      let searchesRange = 0;
      let todayDownloadClicks = 0;
      let visitorsTodayViews = 0;
      let visitorsYesterdayViews = 0;

      for (const ev of rangeEvents) {
        uniqueVisitorsRangeSet.add(ev.visitor_id);
        const day = ensureDay(ev.created_at);
        day.visitors.add(ev.visitor_id);
        if (returningVisitorSet.has(ev.visitor_id)) {
          day.returningVisitors.add(ev.visitor_id);
        }
        if (ev.device_type === 'mobile') mobileVisitors.add(ev.visitor_id);
        else if (ev.device_type === 'tablet') tabletVisitors.add(ev.visitor_id);
        else desktopVisitors.add(ev.visitor_id);

        if (ev.browser) {
          let s = browserVisitors.get(ev.browser);
          if (!s) {
            s = new Set();
            browserVisitors.set(ev.browser, s);
          }
          s.add(ev.visitor_id);
        }
        if (ev.os) {
          let s = osVisitors.get(ev.os);
          if (!s) {
            s = new Set();
            osVisitors.set(ev.os, s);
          }
          s.add(ev.visitor_id);
        }
        if (ev.country) {
          let s = countryVisitors.get(ev.country);
          if (!s) {
            s = new Set();
            countryVisitors.set(ev.country, s);
          }
          s.add(ev.visitor_id);
        }

        if (ev.event_type === 'page_view' || ev.event_type === 'homepage_view') {
          pageViewsRange += 1;
          day.pageViews += 1;
          if (ev.event_type === 'homepage_view') homepageViewsRange += 1;
          if (ev.created_at >= todayMs) visitorsTodayViews += 1;
          else if (ev.created_at >= yesterdayMs && ev.created_at < todayMs) visitorsYesterdayViews += 1;
          const p = ev.page_path || '/';
          pageCounts.set(p, (pageCounts.get(p) || 0) + 1);
          const src = ev.referrer_host || 'direct';
          sourceCounts.set(src, (sourceCounts.get(src) || 0) + 1);
        } else if (ev.event_type === 'app_view') {
          appViewsRange += 1;
          day.appViews += 1;
        } else if (ev.event_type === 'game_view') {
          gameViewsRange += 1;
          day.gameViews += 1;
        } else if (ev.event_type === 'product_view' || ev.event_type === 'service_view') {
          if (ev.event_type === 'product_view') productViewsRange += 1;
          else serviceViewsRange += 1;
          day.serviceViews += 1;
        } else if (ev.event_type === 'app_download' || ev.event_type === 'download_click') {
          downloadClicksRange += 1;
          day.downloads += 1;
          if (ev.created_at >= todayMs) todayDownloadClicks += 1;
          const targetAppId = ev.app_id || ev.content_id;
          if (targetAppId) appDownloadCounts.set(targetAppId, (appDownloadCounts.get(targetAppId) || 0) + 1);
        } else if (ev.event_type === 'play_click') {
          playClicksRange += 1;
          day.playClicks += 1;
        } else if (ev.event_type === 'external_link_click') {
          externalClicksRange += 1;
        } else if (ev.event_type === 'search') {
          searchesRange += 1;
        }
      }

      for (const ord of rangeOrdersRows) {
        ensureDay(ord.created_at).orders += 1;
      }
      for (const u of rangeNewUsers) {
        ensureDay(u.created_at).registrations += 1;
      }
      for (const rc of rangeRewardRows) {
        ensureDay(rc.created_at).coins += Number(rc.coins || 0);
      }

      // Previous period comparison summary
      const prevUniqueSet = new Set<string>();
      let prevPageViews = 0;
      let prevDownloads = 0;
      for (const ev of prevEvents) {
        prevUniqueSet.add(ev.visitor_id);
        if (ev.event_type === 'page_view' || ev.event_type === 'homepage_view') prevPageViews += 1;
        else if (ev.event_type === 'app_download' || ev.event_type === 'download_click') prevDownloads += 1;
      }
      const calcDeltaPct = (curr: number, prev: number) => {
        if (prev <= 0) return curr > 0 ? 100 : 0;
        return Math.round(((curr - prev) / prev) * 100);
      };

      // Content Stats aggregation (real DB metrics across apps, games, products/services)
      type AggItem = {
        id: string;
        contentType: 'app' | 'game' | 'service';
        category: string;
        totalViews: number;
        uniqueViewers: Set<string>;
        viewsToday: number;
        viewsYesterday: number;
        views7d: number;
        views30d: number;
        downloadClicks: number;
        playClicks: number;
        externalClicks: number;
        favoritesCount: number;
        ordersCount: number;
        lastViewedAt: number;
      };
      const contentAgg = new Map<string, AggItem>();
      const ensureContentAgg = (
        id: string,
        contentType: 'app' | 'game' | 'service',
        category = ''
      ): AggItem => {
        const key = `${contentType}:${id}`;
        let item = contentAgg.get(key);
        if (!item) {
          item = {
            id,
            contentType,
            category,
            totalViews: 0,
            uniqueViewers: new Set(),
            viewsToday: 0,
            viewsYesterday: 0,
            views7d: 0,
            views30d: 0,
            downloadClicks: 0,
            playClicks: 0,
            externalClicks: 0,
            favoritesCount: 0,
            ordersCount: 0,
            lastViewedAt: 0,
          };
          contentAgg.set(key, item);
        }
        if (category && !item.category) item.category = category;
        return item;
      };

      for (const ev of contentEvents30dRows) {
        const cid = ev.content_id || ev.app_id;
        if (!cid) continue;
        const ctype: 'app' | 'game' | 'service' =
          ev.content_type === 'game' || ev.event_type === 'game_view' || ev.event_type === 'play_click'
            ? 'game'
            : ev.content_type === 'service' ||
                ev.content_type === 'product' ||
                ev.event_type === 'product_view' ||
                ev.event_type === 'service_view'
              ? 'service'
              : 'app';
        const agg = ensureContentAgg(cid, ctype, ev.content_category || '');
        if (
          ev.event_type === 'app_view' ||
          ev.event_type === 'game_view' ||
          ev.event_type === 'product_view' ||
          ev.event_type === 'service_view'
        ) {
          agg.totalViews += 1;
          agg.uniqueViewers.add(ev.visitor_id);
          if (ev.created_at >= todayMs) agg.viewsToday += 1;
          else if (ev.created_at >= yesterdayMs && ev.created_at < todayMs) agg.viewsYesterday += 1;
          if (ev.created_at >= sevenDaysAgo) agg.views7d += 1;
          if (ev.created_at >= thirtyDaysAgo) agg.views30d += 1;
          if (ev.created_at > agg.lastViewedAt) agg.lastViewedAt = ev.created_at;
        } else if (ev.event_type === 'app_download' || ev.event_type === 'download_click') {
          agg.downloadClicks += 1;
          if (ev.created_at > agg.lastViewedAt) agg.lastViewedAt = ev.created_at;
        } else if (ev.event_type === 'play_click') {
          agg.playClicks += 1;
          if (ev.created_at > agg.lastViewedAt) agg.lastViewedAt = ev.created_at;
        } else if (ev.event_type === 'external_link_click') {
          agg.externalClicks += 1;
        }
      }

      for (const fav of allFavoritesRows) {
        if (!fav.app_id) continue;
        const agg = ensureContentAgg(fav.app_id, 'app');
        agg.favoritesCount += Number(fav.cnt || 0);
      }

      for (const ord of allOrdersRows) {
        const parsed = parseJsonSafe<{ productId?: string }>(ord.payload_json, {});
        const pid = String(parsed.productId || '').trim();
        if (!pid) continue;
        const isMobileAppOrder = pid.startsWith('mapp_');
        const agg = ensureContentAgg(pid, isMobileAppOrder ? 'app' : 'service');
        agg.ordersCount += 1;
      }

      const contentStats = Array.from(contentAgg.values()).map((c) => {
        const totalClicks = c.downloadClicks + c.playClicks + c.ordersCount;
        const conversionRate =
          c.totalViews > 0 ? Math.min(100, Math.round((totalClicks / c.totalViews) * 1000) / 10) : 0;
        return {
          id: c.id,
          contentType: c.contentType,
          category: c.category,
          totalViews: c.totalViews,
          uniqueViews: c.uniqueViewers.size,
          viewsToday: c.viewsToday,
          viewsYesterday: c.viewsYesterday,
          views7d: c.views7d,
          views30d: c.views30d,
          downloadClicks: c.downloadClicks,
          playClicks: c.playClicks,
          externalClicks: c.externalClicks,
          favoritesCount: c.favoritesCount,
          ordersCount: c.ordersCount,
          conversionRate,
          lastViewedAt: c.lastViewedAt,
        };
      });

      const dailySeries = Array.from(dayBuckets.values())
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((d) => ({
          date: d.date,
          visitors: d.visitors.size,
          uniqueVisitors: d.visitors.size,
          returningVisitors: d.returningVisitors.size,
          pageViews: d.pageViews,
          appViews: d.appViews,
          gameViews: d.gameViews,
          serviceViews: d.serviceViews,
          downloads: d.downloads,
          downloadClicks: d.downloads,
          playClicks: d.playClicks,
          orders: d.orders,
          registrations: d.registrations,
          coinsDistributed: d.coins,
        }));

      const topPages = Array.from(pageCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([path, views]) => ({ path, views }));

      const topApps = Array.from(appDownloadCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([appId, downloads]) => ({ appId, downloads }));

      const trafficSources = Array.from(sourceCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([source, visits]) => ({ source, visits }));

      const toSortedSplit = (m: Map<string, Set<string>>, limit = 8) =>
        Array.from(m.entries())
          .map(([name, set]) => ({ name, count: set.size }))
          .sort((a, b) => b.count - a.count)
          .slice(0, limit);

      const todayDhaka = getDhakaDateString(now);
      const [
        todayDailyClaimsRow,
        totalDailyClaimsRow,
        totalDailyCoinsRow,
        heroBannerRows,
        activeAnnRows,
      ] = await Promise.all([
        db.first<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM daily_login_claims WHERE claim_date = ?', [
          todayDhaka,
        ]),
        db.first<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM daily_login_claims'),
        db.first<{ totalCoins: number }>('SELECT COALESCE(SUM(total_coins), 0) AS totalCoins FROM daily_login_claims'),
        db.all<{ payload_json: string }>(
          `SELECT payload_json FROM catalog_overrides WHERE collection = 'heroBanners' AND deleted = 0`
        ),
        db.all<{ payload_json: string }>('SELECT payload_json FROM announcements WHERE active = 1'),
      ]);

      const activeHeroBannersCount =
        heroBannerRows.length > 0
          ? heroBannerRows
              .map((r) => parseJsonSafe<Record<string, unknown>>(r.payload_json, {}))
              .filter((b) => {
                if (b.enabled === false) return false;
                const s = typeof b.startDate === 'string' ? b.startDate.trim() : '';
                const e = typeof b.endDate === 'string' ? b.endDate.trim() : '';
                if (s && s > todayDhaka) return false;
                if (e && e < todayDhaka) return false;
                return true;
              }).length
          : 3;

      const publishedAnnouncementsCount = activeAnnRows
        .map((r) => parseJsonSafe<Record<string, unknown>>(r.payload_json, {}))
        .filter((a) => isAnnouncementActiveNow(a, todayDhaka)).length;

      res.json({
        ok: true,
        range: { from: rangeFrom, to: rangeTo },
        kpis: {
          totalUsers: Number(totalUsersRow?.cnt || 0),
          todayNewUsers: Number(todayNewUsersRow?.cnt || 0),
          activeUsersToday: Number(activeTodayRow?.cnt || 0),
          activeUsers7d: Number(active7dRow?.cnt || 0),
          activeUsers30d: Number(active30dRow?.cnt || 0),
          totalVisitors: pageViewsRange,
          uniqueVisitors: uniqueVisitorsRangeSet.size,
          onlineUsers: Number(onlineVisitorsRow?.cnt || 0),
          totalDownloads: downloadClicksRange,
          todayDownloads: todayDownloadClicks,
          totalRewardClaims: Number(rewardClaimsRow?.cnt || 0),
          totalCoinsDistributed: Number(coinsTotalRow?.totalCoins || 0),
          todayDailyRewardClaims: Number(todayDailyClaimsRow?.cnt || 0),
          totalDailyRewardClaims: Number(totalDailyClaimsRow?.cnt || 0),
          totalDailyRewardCoins: Number(totalDailyCoinsRow?.totalCoins || 0),
          activeHeroBanners: activeHeroBannersCount,
          publishedAnnouncements: publishedAnnouncementsCount,
          pendingWithdrawals: Number(pendingWithdrawalsRow?.cnt || 0),
          pendingTickets: Number(pendingTicketsRow?.cnt || 0),
        },
        overview: {
          visitorsToday: Number(todayUniqueRow?.cnt || 0),
          visitorsYesterday: Number(yesterdayUniqueRow?.cnt || 0),
          visitorsTodayPageViews: visitorsTodayViews,
          visitorsYesterdayPageViews: visitorsYesterdayViews,
          visitorsThisMonth: Number(monthUniqueRow?.cnt || 0),
          visitorsLast7d: Number(last7dUniqueRow?.cnt || 0),
          visitorsPrev7d: Number(prev7dUniqueRow?.cnt || 0),
          totalVisitorsOverall: Number(overallVisitorsRow?.cnt || 0),
          uniqueVisitorsInRange: uniqueVisitorsRangeSet.size,
          returningVisitorsInRange: returningVisitorSet.size,
          currentlyActiveVisitors: Number(onlineVisitorsRow?.cnt || 0),
          totalPageViews: pageViewsRange,
          totalHomepageViews: homepageViewsRange,
          totalAppViews: appViewsRange,
          totalGameViews: gameViewsRange,
          totalProductViews: productViewsRange,
          totalServiceViews: serviceViewsRange,
          totalDownloadClicks: downloadClicksRange,
          todayDownloadClicks,
          totalPlayClicks: playClicksRange,
          totalExternalClicks: externalClicksRange,
          totalSearches: searchesRange,
          totalOrders: Number(totalOrdersRow?.cnt || 0),
          pendingOrders: Number(pendingOrdersRow?.cnt || 0),
          completedOrders: Number(completedOrdersRow?.cnt || 0),
          ordersInRange: rangeOrdersRows.length,
        },
        comparisonSummary: {
          current: {
            uniqueVisitors: uniqueVisitorsRangeSet.size,
            pageViews: pageViewsRange,
            downloadClicks: downloadClicksRange,
            orders: rangeOrdersRows.length,
          },
          previous: {
            uniqueVisitors: prevUniqueSet.size,
            pageViews: prevPageViews,
            downloadClicks: prevDownloads,
            orders: Number(prevOrdersCountRow?.cnt || 0),
          },
          deltasPct: {
            uniqueVisitors: calcDeltaPct(uniqueVisitorsRangeSet.size, prevUniqueSet.size),
            pageViews: calcDeltaPct(pageViewsRange, prevPageViews),
            downloadClicks: calcDeltaPct(downloadClicksRange, prevDownloads),
            orders: calcDeltaPct(rangeOrdersRows.length, Number(prevOrdersCountRow?.cnt || 0)),
          },
        },
        deviceSplit: {
          mobile: mobileVisitors.size,
          tablet: tabletVisitors.size,
          desktop: desktopVisitors.size,
        },
        browserSplit: toSortedSplit(browserVisitors),
        osSplit: toSortedSplit(osVisitors),
        countrySplit: toSortedSplit(countryVisitors),
        dailySeries,
        topPages,
        topApps,
        trafficSources,
        liveVisitors: {
          activeCount: Number(onlineVisitorsRow?.cnt || 0),
          activeSessions: activeSessionsRows.map((s) => ({
            sessionId: s.session_id,
            visitorId: s.visitor_id.slice(0, 18),
            isMember: Boolean(s.user_id),
            isReturning: s.is_returning === 1,
            visitCount: Number(s.visit_count || 1),
            currentPage: s.current_page || '/',
            lastEventType: s.last_event_type || 'page_view',
            lastContentId: s.last_content_id || '',
            deviceType: s.device_type || 'desktop',
            browser: s.browser || 'Other',
            os: s.os || 'Other',
            referrerHost: s.referrer_host || 'direct',
            country: s.country || '',
            firstSeenAt: Number(s.first_seen_at || 0),
            lastSeenAt: Number(s.last_seen_at || 0),
          })),
          recentEvents: recentEventRows.map((ev) => ({
            id: ev.id,
            visitorId: ev.visitor_id.slice(0, 18),
            isMember: Boolean(ev.user_id),
            eventType: ev.event_type,
            pagePath: ev.page_path || '/',
            contentId: ev.content_id || ev.app_id || '',
            contentType: ev.content_type || '',
            deviceType: ev.device_type || 'desktop',
            browser: ev.browser || 'Other',
            os: ev.os || 'Other',
            country: ev.country || '',
            referrerHost: ev.referrer_host || 'direct',
            createdAt: Number(ev.created_at || 0),
          })),
        },
        contentStats,
      });
    } catch (err) {
      handleRouteError(res, err, 'Failed to load analytics.');
    }
  });

  router.get('/apps/meta', async (req, res) => {
    try {
      const session = await resolveSessionFromRequest(req).catch(() => null);
      const db = session ? session.db : await getAppDatabase();
      const [downloadRows, viewRows, ratingRows, reviewRows, favRows] = await Promise.all([
        db.all<{ app_id: string; cnt: number }>(
          `SELECT COALESCE(NULLIF(app_id, ''), content_id) AS app_id, COUNT(*) AS cnt
           FROM analytics_events
           WHERE event_type IN ('app_download', 'download_click')
             AND (app_id != '' OR (content_type = 'app' AND content_id != ''))
           GROUP BY COALESCE(NULLIF(app_id, ''), content_id)`
        ),
        db.all<{ app_id: string; cnt: number }>(
          `SELECT COALESCE(NULLIF(content_id, ''), app_id) AS app_id, COUNT(*) AS cnt
           FROM analytics_events
           WHERE event_type = 'app_view'
             AND (app_id != '' OR content_id != '')
           GROUP BY COALESCE(NULLIF(content_id, ''), app_id)`
        ),
        db.all<{ app_id: string; rating_sum: number; cnt: number }>(
          `SELECT app_id, SUM(rating) AS rating_sum, COUNT(*) AS cnt FROM app_reviews GROUP BY app_id`
        ),
        db.all<{ id: string; app_id: string; user_id: string; author_name: string; rating: number; comment: string; created_at: number }>(
          `SELECT id, app_id, user_id, author_name, rating, comment, created_at FROM app_reviews ORDER BY created_at DESC LIMIT 200`
        ),
        session
          ? db.all<{ app_id: string }>('SELECT app_id FROM app_favorites WHERE user_id = ?', [session.user.uid])
          : Promise.resolve([]),
      ]);

      const statsByApp: Record<string, { views: number; downloads: number; ratingAvg: number; ratingCount: number }> = {};
      for (const d of downloadRows) {
        if (!d.app_id) continue;
        statsByApp[d.app_id] = { views: 0, downloads: Number(d.cnt || 0), ratingAvg: 0, ratingCount: 0 };
      }
      for (const v of viewRows) {
        if (!v.app_id) continue;
        const cur = statsByApp[v.app_id] || { views: 0, downloads: 0, ratingAvg: 0, ratingCount: 0 };
        cur.views = Number(v.cnt || 0);
        statsByApp[v.app_id] = cur;
      }
      for (const r of ratingRows) {
        const cur = statsByApp[r.app_id] || { views: 0, downloads: 0, ratingAvg: 0, ratingCount: 0 };
        const cnt = Number(r.cnt || 0);
        cur.ratingCount = cnt;
        cur.ratingAvg = cnt > 0 ? Math.round((Number(r.rating_sum || 0) / cnt) * 10) / 10 : 0;
        statsByApp[r.app_id] = cur;
      }

      res.json({
        ok: true,
        statsByApp,
        reviews: reviewRows.map((r) => ({
          id: r.id,
          appId: r.app_id,
          userId: r.user_id,
          authorName: r.author_name,
          rating: Number(r.rating || 5),
          comment: r.comment,
          createdAt: Number(r.created_at || 0),
        })),
        favoriteAppIds: favRows.map((f) => f.app_id),
      });
    } catch {
      res.json({ ok: true, statsByApp: {}, reviews: [], favoriteAppIds: [] });
    }
  });

  router.get('/games/meta', async (req, res) => {
    try {
      const session = await resolveSessionFromRequest(req).catch(() => null);
      const db = session ? session.db : await getAppDatabase();
      const [viewRows, playRows, dlRows] = await Promise.all([
        db.all<{ content_id: string; cnt: number }>(
          `SELECT content_id, COUNT(*) AS cnt FROM analytics_events WHERE event_type = 'game_view' AND content_id != '' GROUP BY content_id`
        ),
        db.all<{ content_id: string; cnt: number }>(
          `SELECT content_id, COUNT(*) AS cnt FROM analytics_events WHERE event_type = 'play_click' AND content_id != '' GROUP BY content_id`
        ),
        db.all<{ content_id: string; cnt: number }>(
          `SELECT content_id, COUNT(*) AS cnt FROM analytics_events WHERE event_type = 'download_click' AND content_type = 'game' AND content_id != '' GROUP BY content_id`
        ),
      ]);
      const statsByGame: Record<string, { views: number; plays: number; downloads: number }> = {};
      for (const r of viewRows) {
        statsByGame[r.content_id] = { views: Number(r.cnt || 0), plays: 0, downloads: 0 };
      }
      for (const r of playRows) {
        const cur = statsByGame[r.content_id] || { views: 0, plays: 0, downloads: 0 };
        cur.plays = Number(r.cnt || 0);
        statsByGame[r.content_id] = cur;
      }
      for (const r of dlRows) {
        const cur = statsByGame[r.content_id] || { views: 0, plays: 0, downloads: 0 };
        cur.downloads = Number(r.cnt || 0);
        statsByGame[r.content_id] = cur;
      }
      res.json({ ok: true, statsByGame });
    } catch {
      res.json({ ok: true, statsByGame: {} });
    }
  });

  router.post('/apps/:id/download', async (req, res) => {
    try {
      const appId = String(req.params.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      if (!appId) {
        res.status(400).json({ ok: false, error: 'Invalid app ID.' });
        return;
      }
      const body = (req.body || {}) as { appName?: string; visitorId?: string; sessionId?: string; deviceType?: string };
      const session = await resolveSessionFromRequest(req).catch(() => null);
      const db = session ? session.db : await getAppDatabase();
      const now = Date.now();
      const visitorId =
        String(body.visitorId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) ||
        session?.user.uid ||
        `anon_${now}`;
      await logServerAnalyticsEvent(db, req, {
        visitorId,
        sessionId: body.sessionId,
        userId: session?.user.uid || '',
        eventType: 'app_download',
        pagePath: '/apps',
        appId,
        contentId: appId,
        contentType: 'app',
        deviceTypeHint: body.deviceType === 'mobile' ? 'mobile' : undefined,
        referrerHost: 'app_store',
        now,
      });
      if (session?.user.uid && body.appName) {
        const cleanName = String(body.appName).trim().slice(0, 100);
        await insertNotification(
          db,
          session.user.uid,
          `ডাউনলোড শুরু হয়েছে: ${cleanName}`,
          `Download Started: ${cleanName}`,
          `আপনি "${cleanName}" অ্যাপটি ডাউনলোড করেছেন।`,
          `You clicked download for "${cleanName}" from Digital Hub Smart App Store.`,
          'download'
        );
      }
      const countRow = await db.first<{ cnt: number }>(
        `SELECT COUNT(*) AS cnt FROM analytics_events WHERE event_type IN ('app_download', 'download_click') AND (app_id = ? OR content_id = ?)`,
        [appId, appId]
      );
      res.json({ ok: true, downloads: Number(countRow?.cnt || 0) });
    } catch (err) {
      handleRouteError(res, err, 'Failed to record app download.');
    }
  });

  router.post('/apps/:id/favorite', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'পছন্দের অ্যাপ সেভ করতে আগে লগইন করুন।' });
        return;
      }
      const appId = String(req.params.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      if (!appId) {
        res.status(400).json({ ok: false, error: 'Invalid app ID.' });
        return;
      }
      const { db, user } = resolved;
      const existing = await db.first<{ app_id: string }>(
        'SELECT app_id FROM app_favorites WHERE user_id = ? AND app_id = ?',
        [user.uid, appId]
      );
      let favorited = false;
      if (existing) {
        await db.run('DELETE FROM app_favorites WHERE user_id = ? AND app_id = ?', [user.uid, appId]);
        favorited = false;
      } else {
        await db.run('INSERT INTO app_favorites (user_id, app_id, created_at) VALUES (?, ?, ?)', [
          user.uid,
          appId,
          Date.now(),
        ]);
        favorited = true;
        await logServerAnalyticsEvent(db, req, {
          userId: user.uid,
          eventType: 'favorite',
          pagePath: '/apps',
          appId,
          contentId: appId,
          contentType: 'app',
          referrerHost: 'app_store',
        });
      }
      const rows = await db.all<{ app_id: string }>('SELECT app_id FROM app_favorites WHERE user_id = ?', [user.uid]);
      res.json({ ok: true, favorited, favoriteAppIds: rows.map((r) => r.app_id) });
    } catch (err) {
      handleRouteError(res, err, 'Failed to toggle favorite.');
    }
  });

  router.post('/apps/:id/review', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'রিভিউ দিতে আগে লগইন করুন।' });
        return;
      }
      const appId = String(req.params.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      const body = (req.body || {}) as { rating?: number; comment?: string };
      const rating = Math.max(1, Math.min(5, Math.round(Number(body.rating || 5))));
      const comment = String(body.comment || '').trim().slice(0, 800);
      if (!appId || comment.length < 2) {
        res.status(400).json({ ok: false, error: 'অনুগ্রহ করে আপনার মতামত লিখুন।' });
        return;
      }
      const { db, user } = resolved;
      const id = generateSecureId('arev', 8);
      const now = Date.now();
      await db.run(
        `INSERT INTO app_reviews (id, app_id, user_id, author_name, rating, comment, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, appId, user.uid, user.displayName, rating, comment, now]
      );
      res.status(201).json({
        ok: true,
        review: { id, appId, userId: user.uid, authorName: user.displayName, rating, comment, createdAt: now },
      });
    } catch (err) {
      handleRouteError(res, err, 'Failed to submit app review.');
    }
  });

  router.post('/apps/:id/report-link', async (req, res) => {
    try {
      const appId = String(req.params.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
      const body = (req.body || {}) as { appName?: string; reason?: string };
      const reason = String(body.reason || '').trim().slice(0, 500);
      if (!appId || reason.length < 3) {
        res.status(400).json({ ok: false, error: 'সমস্যার বিবরণ লিখুন।' });
        return;
      }
      const session = await resolveSessionFromRequest(req).catch(() => null);
      const db = session ? session.db : await getAppDatabase();
      const id = generateSecureId('rep', 8);
      await db.run(
        `INSERT INTO app_broken_reports (id, app_id, app_name, user_id, reason, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'open', ?)`,
        [id, appId, String(body.appName || appId).slice(0, 120), session?.user.uid || '', reason, Date.now()]
      );
      res.status(201).json({ ok: true, id });
    } catch (err) {
      handleRouteError(res, err, 'Failed to submit link report.');
    }
  });

  router.get('/admin/app-reports', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const rows = await admin.db.all<{
        id: string;
        app_id: string;
        app_name: string;
        user_id: string;
        reason: string;
        status: string;
        created_at: number;
      }>('SELECT * FROM app_broken_reports ORDER BY created_at DESC LIMIT 200');
      res.json({
        ok: true,
        reports: rows.map((r) => ({
          id: r.id,
          appId: r.app_id,
          appName: r.app_name,
          userId: r.user_id,
          reason: r.reason,
          status: r.status,
          createdAt: Number(r.created_at || 0),
        })),
      });
    } catch (err) {
      handleRouteError(res, err, 'Failed to fetch app reports.');
    }
  });

  router.post('/admin/app-reports/:id/resolve', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const id = String(req.params.id || '').trim();
      await admin.db.run(`UPDATE app_broken_reports SET status = 'resolved' WHERE id = ?`, [id]);
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to resolve app report.');
    }
  });

  router.get('/admin/coins/overview', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db } = admin;
      const [balRows, txRows, claimRows] = await Promise.all([
        db.all<{
          user_id: string;
          coins_available: number;
          coins_lifetime_earned: number;
          coins_redeemed: number;
          updated_at: number;
          display_name: string | null;
          email: string | null;
          phone_e164: string | null;
        }>(
          `SELECT w.user_id, w.coins_available, w.coins_lifetime_earned, w.coins_redeemed, w.updated_at,
                  u.display_name, u.email, u.phone_e164
           FROM watch_earn_balances w
           LEFT JOIN users u ON u.uid = w.user_id
           ORDER BY w.coins_available DESC, w.updated_at DESC
           LIMIT 500`
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM ad_reward_transactions ORDER BY created_at DESC LIMIT 300'
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM rewarded_claims ORDER BY created_at DESC LIMIT 200'
        ),
      ]);
      res.json({
        ok: true,
        balances: balRows.map((b) => ({
          userId: b.user_id,
          displayName: b.display_name || b.user_id,
          contact: b.email || extractPublicPhone(b.phone_e164) || b.user_id,
          coinsAvailable: Number(b.coins_available || 0),
          coinsLifetimeEarned: Number(b.coins_lifetime_earned || 0),
          coinsRedeemed: Number(b.coins_redeemed || 0),
          updatedAt: Number(b.updated_at || 0),
        })),
        transactions: txRows.map((r) => parseJsonSafe(r.payload_json, {})),
        rewardClaims: claimRows.map((r) => parseJsonSafe(r.payload_json, {})),
      });
    } catch (err) {
      handleRouteError(res, err, 'Failed to load coin overview.');
    }
  });

  router.post('/admin/coins/adjust', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as {
        targetUid?: string;
        mode?: 'add' | 'deduct' | 'set';
        coins?: number;
        reason?: string;
      };
      const targetUid = String(body.targetUid || '').trim();
      const mode = body.mode === 'deduct' || body.mode === 'set' ? body.mode : 'add';
      const coinsInput = Math.floor(Number(body.coins || 0));
      const reason = String(body.reason || '').trim().slice(0, 300);

      if (!targetUid || !Number.isFinite(coinsInput) || coinsInput < 0 || (mode !== 'set' && coinsInput < 1)) {
        res.status(400).json({ ok: false, error: 'Valid user ID and positive coin amount required.' });
        return;
      }
      if (reason.length < 3) {
        res.status(400).json({ ok: false, error: 'Mandatory reason (at least 3 characters) required for coin adjustment.' });
        return;
      }

      const targetUser = await db.first<{ uid: string; display_name: string }>(
        'SELECT uid, display_name FROM users WHERE uid = ? LIMIT 1',
        [targetUid]
      );
      if (!targetUser) {
        res.status(404).json({ ok: false, error: 'Target user not found.' });
        return;
      }

      const now = Date.now();
      await db.run(
        `INSERT OR IGNORE INTO watch_earn_balances (user_id, coins_available, coins_lifetime_earned, coins_redeemed, updated_at)
         VALUES (?, 0, 0, 0, ?)`,
        [targetUid, now]
      );
      const currentBal = await db.first<{
        coins_available: number;
        coins_lifetime_earned: number;
        coins_redeemed: number;
      }>('SELECT coins_available, coins_lifetime_earned, coins_redeemed FROM watch_earn_balances WHERE user_id = ?', [
        targetUid,
      ]);
      const prevCoins = Number(currentBal?.coins_available || 0);
      const nextCoins =
        mode === 'add'
          ? prevCoins + coinsInput
          : mode === 'deduct'
            ? Math.max(0, prevCoins - coinsInput)
            : coinsInput;
      const delta = nextCoins - prevCoins;
      const lifetimeDelta = delta > 0 ? delta : 0;

      await db.run(
        `UPDATE watch_earn_balances
         SET coins_available = ?,
             coins_lifetime_earned = coins_lifetime_earned + ?,
             updated_at = ?
         WHERE user_id = ?`,
        [nextCoins, lifetimeDelta, now, targetUid]
      );

      const txId = generateSecureId('cadj', 8);
      const txPayload = {
        id: txId,
        userId: targetUid,
        type: delta >= 0 ? 'admin_coin_credit' : 'admin_coin_deduct',
        adUnitTitle: `Admin Adjustment (${mode})`,
        coins: delta,
        bdtEquivalent: 0,
        status: 'Credited',
        note: reason,
        createdAt: now,
      };
      await db.run(
        'INSERT INTO ad_reward_transactions (id, user_id, type, status, coins, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [txId, targetUid, txPayload.type, 'Credited', delta, JSON.stringify(txPayload), now]
      );

      await insertNotification(
        db,
        targetUid,
        delta >= 0 ? 'কয়েন ব্যালেন্স আপডেট হয়েছে' : 'কয়েন সমন্বয় করা হয়েছে',
        delta >= 0 ? 'Coins Credited' : 'Coin Balance Adjusted',
        `অ্যাডমিন আপনার অ্যাকাউন্টে ${delta >= 0 ? `+${delta}` : delta} কয়েন সমন্বয় করেছেন। কারণ: ${reason}`,
        `Admin adjusted your coins by ${delta >= 0 ? `+${delta}` : delta} coins. Reason: ${reason}`,
        'reward'
      );

      await insertAuditLog(
        db,
        user.uid,
        getUserPrimaryIdentifier(user),
        'COINS_ADJUSTED',
        'watch_earn_balances',
        targetUid,
        `Adjusted coins for ${targetUser.display_name} (${prevCoins} -> ${nextCoins})`,
        { targetUserId: targetUid, previousValue: `${prevCoins}`, newValue: `${nextCoins}`, reason, transactionId: txId }
      );

      res.json({ ok: true, previousCoins: prevCoins, coinsAvailable: nextCoins, transactionId: txId });
    } catch (err) {
      handleRouteError(res, err, 'Failed to adjust user coins.');
    }
  });

  router.get('/admin/rewards/daily-claims', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db } = admin;
      const dateFilter = String(req.query.date || '').trim();
      const searchFilter = String(req.query.search || '').trim().toLowerCase();
      const limit = Math.min(500, Math.max(20, Number(req.query.limit || 200) || 200));
      const todayDate = getDhakaDateString();

      const whereParts: string[] = [];
      const params: unknown[] = [];
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
        whereParts.push('c.claim_date = ?');
        params.push(dateFilter);
      }
      if (searchFilter) {
        whereParts.push('(LOWER(c.user_id) LIKE ? OR LOWER(COALESCE(u.display_name, \'\')) LIKE ? OR LOWER(COALESCE(u.email, \'\')) LIKE ?)');
        const like = `%${searchFilter}%`;
        params.push(like, like, like);
      }
      const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

      const [claimRows, todayCountRow, todayCoinsRow, totalCountRow, totalCoinsRow, activeStreaksRow] =
        await Promise.all([
          db.all<{
            id: string;
            user_id: string;
            claim_date: string;
            streak_day: number;
            base_coins: number;
            bonus_coins: number;
            total_coins: number;
            status: string;
            transaction_id: string;
            created_at: number;
            display_name: string | null;
            email: string | null;
            phone_e164: string | null;
          }>(
            `SELECT c.*, u.display_name, u.email, u.phone_e164
             FROM daily_login_claims c
             LEFT JOIN users u ON u.uid = c.user_id
             ${whereClause}
             ORDER BY c.created_at DESC
             LIMIT ?`,
            [...params, limit]
          ),
          db.first<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM daily_login_claims WHERE claim_date = ?', [
            todayDate,
          ]),
          db.first<{ totalCoins: number }>(
            'SELECT COALESCE(SUM(total_coins), 0) AS totalCoins FROM daily_login_claims WHERE claim_date = ?',
            [todayDate]
          ),
          db.first<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM daily_login_claims'),
          db.first<{ totalCoins: number }>(
            'SELECT COALESCE(SUM(total_coins), 0) AS totalCoins FROM daily_login_claims'
          ),
          db.first<{ cnt: number }>(
            'SELECT COUNT(*) AS cnt FROM daily_login_streaks WHERE current_streak >= 2'
          ),
        ]);

      res.json({
        ok: true,
        todayDate,
        stats: {
          todayClaims: Number(todayCountRow?.cnt || 0),
          todayCoinsDistributed: Number(todayCoinsRow?.totalCoins || 0),
          totalClaims: Number(totalCountRow?.cnt || 0),
          totalCoinsDistributed: Number(totalCoinsRow?.totalCoins || 0),
          activeStreaks: Number(activeStreaksRow?.cnt || 0),
        },
        claims: claimRows.map((c) => ({
          id: c.id,
          userId: c.user_id,
          displayName: c.display_name || c.user_id,
          contact: c.email || extractPublicPhone(c.phone_e164) || c.user_id,
          claimDate: c.claim_date,
          streakDay: Number(c.streak_day || 1),
          baseCoins: Number(c.base_coins || 10),
          bonusCoins: Number(c.bonus_coins || 0),
          totalCoins: Number(c.total_coins || 10),
          status: c.status || 'Credited',
          transactionId: c.transaction_id || c.id,
          createdAt: Number(c.created_at || 0),
        })),
      });
    } catch (err) {
      handleRouteError(res, err, 'Failed to load daily reward claims.');
    }
  });

  // =========================================================================
  // DEVELOPER TEAM RANK & BADGE SYSTEM ENDPOINTS
  // =========================================================================

  interface DeveloperDbRow {
    id: string;
    name: string;
    title: string;
    rank: string;
    verified: number;
    bio: string;
    photo_url: string;
    social_links_json: string;
    sort_order: number;
    active: number;
    created_at: number;
    updated_at: number;
  }

  const DEVELOPER_ORDER_SQL =
    "CASE rank WHEN 'gold' THEN 4 WHEN 'silver' THEN 3 WHEN 'blue' THEN 2 ELSE 1 END DESC, sort_order ASC, created_at ASC";

  const DEFAULT_TITLE_BY_RANK: Record<'gold' | 'silver' | 'blue' | 'verified', string> = {
    gold: 'Lead Developer / Team Leader',
    silver: 'Senior Developer / Specialist',
    blue: 'Junior Developer / Developer',
    verified: 'Developer',
  };

  const normalizeDevRankServer = (raw: unknown): 'gold' | 'silver' | 'blue' | 'verified' => {
    const val = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (val === 'gold' || val === 'silver' || val === 'blue' || val === 'verified') return val;
    return 'verified';
  };

  const sanitizeDevSocialLinks = (raw: unknown): Record<string, string> => {
    if (!raw || typeof raw !== 'object') return {};
    const allowedKeys = ['github', 'linkedin', 'portfolio', 'telegram', 'facebook', 'x'] as const;
    const out: Record<string, string> = {};
    const src = raw as Record<string, unknown>;
    for (const k of allowedKeys) {
      const val = typeof src[k] === 'string' ? src[k].trim().slice(0, 300) : '';
      if (!val) continue;
      if (/^https?:\/\/[^\s]+$/i.test(val)) {
        out[k] = val;
      }
    }
    return out;
  };

  const mapDeveloperRow = (row: DeveloperDbRow) => {
    let socialLinks: Record<string, string> = {};
    try {
      const parsed = JSON.parse(row.social_links_json || '{}');
      socialLinks = sanitizeDevSocialLinks(parsed);
    } catch {
      socialLinks = {};
    }
    return {
      id: row.id,
      name: row.name || '',
      title: row.title || '',
      rank: normalizeDevRankServer(row.rank),
      verified: Number(row.verified) === 1,
      bio: row.bio || '',
      photoUrl: row.photo_url || '',
      socialLinks,
      sortOrder: Number(row.sort_order || 0),
      active: Number(row.active) !== 0,
      createdAt: Number(row.created_at || 0),
      updatedAt: Number(row.updated_at || 0),
    };
  };

  router.get('/developers', async (_req, res) => {
    try {
      const db = await getAppDatabase();
      const rows = await db.all<DeveloperDbRow>(
        `SELECT * FROM developers WHERE active = 1 ORDER BY ${DEVELOPER_ORDER_SQL}`
      );
      res.json({ ok: true, developers: rows.map(mapDeveloperRow) });
    } catch (err) {
      handleRouteError(res, err, 'Failed to load developer team.');
    }
  });

  router.get('/admin/developers', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db } = admin;
      const rows = await db.all<DeveloperDbRow>(
        `SELECT * FROM developers ORDER BY ${DEVELOPER_ORDER_SQL}`
      );
      res.json({ ok: true, developers: rows.map(mapDeveloperRow) });
    } catch (err) {
      handleRouteError(res, err, 'Failed to load developer roster.');
    }
  });

  router.post('/admin/developers', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as Record<string, unknown>;

      const name = String(body.name || '').trim().slice(0, 120);
      if (name.length < 2) {
        return res.status(400).json({ ok: false, error: 'Developer name must be at least 2 characters.' });
      }

      const rank = normalizeDevRankServer(body.rank);
      const rawTitle = String(body.title || '').trim().slice(0, 120);
      const title = rawTitle || DEFAULT_TITLE_BY_RANK[rank];
      const verified = body.verified === true || body.verified === 1 || body.verified === 'true';
      const active = body.active === false || body.active === 0 || body.active === 'false' ? false : true;
      const bio = String(body.bio || '').trim().slice(0, 400);
      const photoUrl = String(body.photoUrl || '').trim().slice(0, 300000);

      if (photoUrl && !isSafePackageAssetUrl(photoUrl)) {
        return res.status(400).json({ ok: false, error: 'Invalid developer photo URL or format.' });
      }

      const cleanSocial = sanitizeDevSocialLinks(body.socialLinks);
      const socialJson = JSON.stringify(cleanSocial);
      const sortOrderRaw = Number(body.sortOrder);
      const sortOrder =
        Number.isFinite(sortOrderRaw) && sortOrderRaw >= 0
          ? Math.min(100000, Math.round(sortOrderRaw))
          : 0;

      const rawId = typeof body.id === 'string' ? body.id.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100) : '';
      const id = rawId || generateSecureId('dev');
      const now = Date.now();

      const existing = await db.first<DeveloperDbRow>('SELECT * FROM developers WHERE id = ?', [id]);
      const createdAt = existing?.created_at ? Number(existing.created_at) : now;

      await db.run(
        `INSERT INTO developers (id, name, title, rank, verified, bio, photo_url, social_links_json, sort_order, active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           title = excluded.title,
           rank = excluded.rank,
           verified = excluded.verified,
           bio = excluded.bio,
           photo_url = excluded.photo_url,
           social_links_json = excluded.social_links_json,
           sort_order = excluded.sort_order,
           active = excluded.active,
           updated_at = excluded.updated_at`,
        [
          id,
          name,
          title,
          rank,
          verified ? 1 : 0,
          bio,
          photoUrl,
          socialJson,
          sortOrder,
          active ? 1 : 0,
          createdAt,
          now,
        ]
      );

      await insertAuditLog(
        db,
        user.uid,
        getUserPrimaryIdentifier(user),
        existing ? 'DEVELOPER_UPDATED' : 'DEVELOPER_CREATED',
        'developers',
        id,
        `${existing ? 'Updated' : 'Added'} developer ${name} (${rank})`,
        {
          previousValue: existing ? `${existing.rank}|active=${existing.active}` : '',
          newValue: `${rank}|verified=${verified}|active=${active}`,
        }
      );

      const savedRow = await db.first<DeveloperDbRow>('SELECT * FROM developers WHERE id = ?', [id]);
      res.json({
        ok: true,
        developer: savedRow
          ? mapDeveloperRow(savedRow)
          : {
              id,
              name,
              title,
              rank,
              verified,
              bio,
              photoUrl,
              socialLinks: cleanSocial,
              sortOrder,
              active,
              createdAt,
              updatedAt: now,
            },
      });
    } catch (err) {
      handleRouteError(res, err, 'Failed to save developer profile.');
    }
  });

  router.post('/admin/developers/reorder', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as { items?: Array<{ id?: string; sortOrder?: number }> };
      const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
      if (items.length === 0) {
        return res.status(400).json({ ok: false, error: 'Reorder items are required.' });
      }
      const now = Date.now();
      for (const item of items) {
        const devId = typeof item.id === 'string' ? item.id.trim().slice(0, 100) : '';
        if (!devId) continue;
        const nextOrder = Math.max(0, Math.min(100000, Math.round(Number(item.sortOrder) || 0)));
        await db.run('UPDATE developers SET sort_order = ?, updated_at = ? WHERE id = ?', [
          nextOrder,
          now,
          devId,
        ]);
      }

      await insertAuditLog(
        db,
        user.uid,
        getUserPrimaryIdentifier(user),
        'DEVELOPERS_REORDERED',
        'developers',
        'batch',
        `Updated display order for ${items.length} developer profile(s)`
      );

      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to reorder developers.');
    }
  });

  router.delete('/admin/developers/:id', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const devId = String(req.params.id || '').trim().slice(0, 100);
      if (!devId) {
        return res.status(400).json({ ok: false, error: 'Developer ID is required.' });
      }
      const existing = await db.first<DeveloperDbRow>('SELECT * FROM developers WHERE id = ?', [devId]);
      if (!existing) {
        return res.status(404).json({ ok: false, error: 'Developer not found.' });
      }
      await db.run('DELETE FROM developers WHERE id = ?', [devId]);
      await insertAuditLog(
        db,
        user.uid,
        getUserPrimaryIdentifier(user),
        'DEVELOPER_DELETED',
        'developers',
        devId,
        `Deleted developer ${existing.name}`
      );
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to delete developer profile.');
    }
  });

  // =========================================================================
  // REAL WEB PUSH / FCM SUBSCRIPTIONS, PREFERENCES & ADMIN ORDER ALERTS
  // =========================================================================

  router.get('/push/public-key', async (_req, res) => {
    try {
      const db = await getAppDatabase();
      const vapid = await getOrCreateVapidConfig(db);
      res.json({ ok: true, publicKey: vapid.publicKey });
    } catch (err) {
      handleRouteError(res, err, 'Failed to load push public key.');
    }
  });

  router.post('/push/subscribe', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'পুশ নোটিফিকেশন চালু করতে আগে লগইন করুন।' });
        return;
      }
      const { db, user } = resolved;
      const body = (req.body || {}) as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
        fcmToken?: string;
        isAdminDevice?: boolean;
        deviceLabel?: string;
        platform?: string;
      };

      const endpoint = String(body.endpoint || '').trim().slice(0, 1200);
      const p256dh = String(body.keys?.p256dh || '').trim().slice(0, 500);
      const auth = String(body.keys?.auth || '').trim().slice(0, 300);
      const fcmToken = String(body.fcmToken || '').trim().slice(0, 1000);

      if (!endpoint || (!fcmToken && (!p256dh || !auth))) {
        res.status(400).json({ ok: false, error: 'Valid browser push subscription keys are required.' });
        return;
      }
      if (!endpoint.startsWith('https://')) {
        res.status(400).json({ ok: false, error: 'Push endpoint must use HTTPS.' });
        return;
      }

      const callerIsAdmin = user.role === 'admin' || user.role === 'super_admin';
      const isAdminDevice = callerIsAdmin && Boolean(body.isAdminDevice) ? 1 : 0;
      const userAgent = String(req.headers['user-agent'] || '').slice(0, 300);
      const deviceLabel =
        String(body.deviceLabel || '').trim().slice(0, 120) ||
        (/Android|iPhone|iPad|Mobile/i.test(userAgent) ? 'Mobile Browser / PWA' : 'Desktop Browser');
      const platform = String(body.platform || '').trim().slice(0, 40) || (/Android/i.test(userAgent) ? 'android' : 'web');

      const now = Date.now();
      const id = generateSecureId('push', 10);
      await db.run(
        `INSERT INTO push_subscriptions (
           id, user_id, role, is_admin_device, device_label, platform,
           endpoint, p256dh, auth, fcm_token, user_agent, active,
           last_success_at, last_error, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, '', ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET
           user_id = excluded.user_id,
           role = excluded.role,
           is_admin_device = excluded.is_admin_device,
           device_label = excluded.device_label,
           platform = excluded.platform,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           fcm_token = excluded.fcm_token,
           user_agent = excluded.user_agent,
           active = 1,
           last_error = '',
           updated_at = excluded.updated_at`,
        [id, user.uid, user.role, isAdminDevice, deviceLabel, platform, endpoint, p256dh, auth, fcmToken, userAgent, now, now]
      );

      res.json({ ok: true, isAdminDevice: isAdminDevice === 1 });
    } catch (err) {
      handleRouteError(res, err, 'Failed to save push subscription.');
    }
  });

  router.delete('/push/subscribe', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const { db, user } = resolved;
      const body = (req.body || {}) as { endpoint?: string };
      const endpoint = String(body.endpoint || '').trim();
      const now = Date.now();
      if (endpoint) {
        await db.run(
          'UPDATE push_subscriptions SET active = 0, updated_at = ? WHERE user_id = ? AND endpoint = ?',
          [now, user.uid, endpoint]
        );
      } else {
        await db.run('UPDATE push_subscriptions SET active = 0, updated_at = ? WHERE user_id = ?', [now, user.uid]);
      }
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to remove push subscription.');
    }
  });

  router.get('/push/preferences', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const preferences = await getUserNotificationPreferences(resolved.db, resolved.user.uid);
      res.json({ ok: true, preferences });
    } catch (err) {
      handleRouteError(res, err, 'Failed to load notification preferences.');
    }
  });

  router.post('/push/preferences', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved) {
        res.status(401).json({ ok: false, error: 'লগইন প্রয়োজন।' });
        return;
      }
      const body = (req.body || {}) as {
        newOffers?: boolean;
        importantAnnouncements?: boolean;
        serviceUpdates?: boolean;
        orderNotifications?: boolean;
        paymentNotifications?: boolean;
        accountNotifications?: boolean;
      };
      const preferences = await saveUserNotificationPreferences(resolved.db, resolved.user.uid, body);
      res.json({ ok: true, preferences });
    } catch (err) {
      handleRouteError(res, err, 'Failed to save notification preferences.');
    }
  });

  router.get('/admin/push/devices', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const rows = await admin.db.all<PushSubscriptionRow>(
        `SELECT * FROM push_subscriptions WHERE is_admin_device = 1 ORDER BY active DESC, updated_at DESC LIMIT 100`
      );
      res.json({
        ok: true,
        devices: rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          role: r.role,
          isAdminDevice: r.is_admin_device === 1,
          deviceLabel: r.device_label,
          platform: r.platform,
          endpointPreview: r.endpoint.slice(0, 64),
          active: r.active === 1,
          lastSuccessAt: Number(r.last_success_at || 0),
          lastError: r.last_error || '',
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      });
    } catch (err) {
      handleRouteError(res, err, 'Failed to load admin push devices.');
    }
  });

  router.post('/admin/push/test', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const result = await dispatchAdminDevicesPush(db, {
        title: 'DIGITAL HUB — NEW ORDER! (Test Alert)',
        body: `Test Customer (${user.uid}) • #DH-TEST99 • Instant Order Push Active • ৳499 via bKash`,
        url: '/?route=admin&section=orders',
        tag: `admin-test-${Date.now()}`,
        category: 'order',
        requireInteraction: true,
      });
      res.json({ ok: true, ...result });
    } catch (err) {
      handleRouteError(res, err, 'Failed to send test push notification.');
    }
  });

  router.delete('/admin/push/devices/:id', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const id = String(req.params.id || '').trim();
      await admin.db.run('DELETE FROM push_subscriptions WHERE id = ? AND is_admin_device = 1', [id]);
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to remove admin device.');
    }
  });

  return router;
}
