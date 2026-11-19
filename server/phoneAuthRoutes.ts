import express from 'express';
import {
  clearSessionCookie,
  generateRecoveryCode,
  generateReferralCode,
  generateSecureId,
  generateSessionToken,
  hashSecretPbkdf2,
  normalizeBangladeshPhone,
  normalizeRecoveryCodeInput,
  parseCookies,
  runDummyPasswordWork,
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  setSessionCookie,
  sha256Hex,
  verifySecretPbkdf2,
} from './authCrypto.ts';
import { AppDatabase, DatabaseNotConfiguredError, getAppDatabase, getRuntimeEnvVar } from './db.ts';

export interface SessionAuthUser {
  uid: string;
  phone: string;
  displayName: string;
  email: string;
  photoURL: string;
  role: 'super_admin' | 'admin' | 'user';
  status: 'active' | 'suspended';
  referralCode: string;
  referredBy: string;
  promotionalCredits: number;
  language: 'bn' | 'en';
  sessionRevokedAt: number;
  createdAt: number;
  updatedAt: number;
  sessionId: string;
}

interface UserRow {
  uid: string;
  phone_e164: string;
  display_name: string;
  email: string;
  photo_url: string;
  password_hash: string;
  recovery_hash: string;
  role: string;
  status: string;
  referral_code: string;
  referred_by: string;
  promotional_credits: number;
  language: string;
  session_revoked_at: number;
  created_at: number;
  updated_at: number;
}

interface AttemptRow {
  attempt_key: string;
  attempts: number;
  window_start: number;
  locked_until: number;
}

function getClientIp(req: express.Request): string {
  const cfIp = req.headers['cf-connecting-ip'];
  if (typeof cfIp === 'string' && cfIp.trim()) return cfIp.trim().slice(0, 64);
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim().slice(0, 64);
  }
  return String(req.ip || 'unknown').slice(0, 64);
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

function resolveUserRole(phoneE164: string, dbRole: string): 'super_admin' | 'admin' | 'user' {
  if (getConfiguredAdminPhones().has(phoneE164)) return 'super_admin';
  if (dbRole === 'super_admin' || dbRole === 'admin') return dbRole;
  return 'user';
}

function toClientAuthUser(row: UserRow) {
  const effectiveRole = resolveUserRole(row.phone_e164, row.role);
  return {
    uid: row.uid,
    phone: row.phone_e164,
    displayName: row.display_name,
    email: row.email || '',
    photoURL: row.photo_url || '',
    role: effectiveRole,
    status: row.status === 'suspended' ? 'suspended' : 'active',
    referralCode: row.referral_code,
    createdAt: row.created_at,
  };
}

function toClientUserProfile(row: UserRow) {
  const effectiveRole = resolveUserRole(row.phone_e164, row.role);
  return {
    uid: row.uid,
    displayName: row.display_name,
    email: row.email || '',
    role: effectiveRole !== 'user' ? 'admin' : 'user',
    authMethod: 'phone' as const,
    phone: row.phone_e164,
    photoUrl: row.photo_url || '',
    referralCode: row.referral_code,
    referredBy: row.referred_by || '',
    promotionalCredits: Number(row.promotional_credits || 0),
    language: row.language === 'en' ? ('en' as const) : ('bn' as const),
    status: row.status === 'suspended' ? ('suspended' as const) : ('active' as const),
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
  if (row.session_revoked_at > 0 && row.session_created_at < row.session_revoked_at) return null;
  if (row.status === 'suspended') return null;

  if (now - row.session_last_seen_at > 5 * 60 * 1000) {
    await db
      .run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [now, row.session_id])
      .catch(() => {});
  }

  const effectiveRole = resolveUserRole(row.phone_e164, row.role);
  return {
    db,
    rawRow: row,
    user: {
      uid: row.uid,
      phone: row.phone_e164,
      displayName: row.display_name,
      email: row.email || '',
      photoURL: row.photo_url || '',
      role: effectiveRole,
      status: row.status === 'suspended' ? 'suspended' : 'active',
      referralCode: row.referral_code,
      referredBy: row.referred_by || '',
      promotionalCredits: Number(row.promotional_credits || 0),
      language: row.language === 'en' ? 'en' : 'bn',
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
  type: 'order' | 'payment' | 'wallet' | 'referral' | 'system'
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
  summary: string
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
  // 1. REGISTRATION (Phone +880 & Password — PBKDF2-SHA256 + HTTP-only Cookie)
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
        fullName?: unknown;
        phone?: unknown;
        password?: unknown;
        confirmPassword?: unknown;
        referralCode?: unknown;
        language?: unknown;
      };

      const fullName = typeof body.fullName === 'string' ? body.fullName.trim().slice(0, 120) : '';
      const phoneE164 = normalizeBangladeshPhone(body.phone);
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
      if (!phoneE164) {
        res.status(400).json({
          ok: false,
          code: 'auth/invalid-phone-number',
          error: 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন (যেমন: 017XXXXXXXX বা +88017XXXXXXXX)।',
        });
        return;
      }
      if (password.length < 6 || password.length > 128) {
        res.status(400).json({
          ok: false,
          code: 'auth/weak-password',
          error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।',
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

      // Enforce unique Bangladesh mobile number
      const existing = await db.first<{ uid: string }>(
        'SELECT uid FROM users WHERE phone_e164 = ? LIMIT 1',
        [phoneE164]
      );
      if (existing) {
        res.status(409).json({
          ok: false,
          code: 'auth/phone-already-in-use',
          error: 'এই মোবাইল নম্বর দিয়ে আগে থেকেই অ্যাকাউন্ট রয়েছে। অনুগ্রহ করে লগইন করুন।',
        });
        return;
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

      // Resolve valid referrer if a referral code was provided
      let validReferredBy = '';
      let referrerUid = '';
      if (incomingRef && incomingRef !== myReferralCode) {
        const refOwner = await db.first<{ uid: string; referral_code: string }>(
          'SELECT uid, referral_code FROM users WHERE referral_code = ? LIMIT 1',
          [incomingRef]
        );
        if (refOwner) {
          validReferredBy = refOwner.referral_code;
          referrerUid = refOwner.uid;
        }
      }

      const initialRole = getConfiguredAdminPhones().has(phoneE164) ? 'super_admin' : 'user';

      try {
        await db.run(
          `INSERT INTO users (
            uid, phone_e164, display_name, email, photo_url, password_hash, recovery_hash,
            role, status, referral_code, referred_by, promotional_credits, language,
            session_revoked_at, created_at, updated_at
          ) VALUES (?, ?, ?, '', '', ?, ?, ?, 'active', ?, ?, 0, ?, 0, ?, ?)`,
          [
            uid,
            phoneE164,
            fullName,
            passwordHash,
            recoveryHash,
            initialRole,
            myReferralCode,
            validReferredBy,
            language,
            now,
            now,
          ]
        );
      } catch (insertErr) {
        const msg = insertErr instanceof Error ? insertErr.message : '';
        if (msg.toUpperCase().includes('UNIQUE')) {
          res.status(409).json({
            ok: false,
            code: 'auth/phone-already-in-use',
            error: 'এই মোবাইল নম্বর দিয়ে আগে থেকেই অ্যাকাউন্ট রয়েছে। অনুগ্রহ করে লগইন করুন।',
          });
          return;
        }
        throw insertErr;
      }

      await ensureWalletAccount(db, uid);

      if (referrerUid) {
        const refId = generateSecureId('ref', 8);
        const refPayload = {
          id: refId,
          referrerId: referrerUid,
          referredUserId: uid,
          referredEmail: phoneE164,
          referralCode: validReferredBy,
          rewardAmountBdt: 30,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        };
        await db
          .run(
            'INSERT OR IGNORE INTO referrals (id, referrer_uid, referred_uid, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
            [refId, referrerUid, uid, 'pending', JSON.stringify(refPayload), now]
          )
          .catch(() => {});
      }

      await insertNotification(
        db,
        uid,
        'DIGITAL HUB-এ স্বাগতম!',
        'Welcome to DIGITAL HUB!',
        `আপনার মোবাইল নম্বর (${phoneE164}) দিয়ে অ্যাকাউন্ট সফলভাবে তৈরি হয়েছে।`,
        `Your account with ${phoneE164} has been created successfully.`,
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
  // 2. LOGIN (Phone +880 & Password — Brute-force protected + HTTP-only Cookie)
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

      const body = (req.body || {}) as { phone?: unknown; password?: unknown };
      const phoneE164 = normalizeBangladeshPhone(body.phone);
      const password = typeof body.password === 'string' ? body.password : '';

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

      const phoneLimitKey = `login_phone:${phoneE164}`;
      const phoneLimit = await checkAttemptLimit(db, phoneLimitKey, 5, 15 * 60 * 1000);
      if (phoneLimit.blocked) {
        const mins = Math.max(1, Math.ceil(phoneLimit.retryAfterSec / 60));
        res.status(429).json({
          ok: false,
          code: 'auth/too-many-requests',
          error: `নিরাপত্তার জন্য এই নম্বরে লগইন সাময়িকভাবে সীমিত করা হয়েছে। ${mins} মিনিট পর আবার চেষ্টা করুন।`,
        });
        return;
      }

      const userRow = await db.first<UserRow>(
        'SELECT * FROM users WHERE phone_e164 = ? LIMIT 1',
        [phoneE164]
      );

      if (!userRow) {
        await runDummyPasswordWork(password);
        await Promise.all([
          recordFailedAttempt(db, phoneLimitKey, 5, 15 * 60 * 1000, 15 * 60 * 1000),
          recordFailedAttempt(db, `login_ip:${ip}`, 25, 15 * 60 * 1000, 15 * 60 * 1000),
        ]);
        res.status(401).json({
          ok: false,
          code: 'auth/invalid-credential',
          error: 'মোবাইল নম্বর অথবা পাসওয়ার্ড সঠিক নয়।',
        });
        return;
      }

      const passwordValid = await verifySecretPbkdf2(password, userRow.password_hash);
      if (!passwordValid) {
        await Promise.all([
          recordFailedAttempt(db, phoneLimitKey, 5, 15 * 60 * 1000, 15 * 60 * 1000),
          recordFailedAttempt(db, `login_ip:${ip}`, 25, 15 * 60 * 1000, 15 * 60 * 1000),
        ]);
        res.status(401).json({
          ok: false,
          code: 'auth/invalid-credential',
          error: 'মোবাইল নম্বর অথবা পাসওয়ার্ড সঠিক নয়।',
        });
        return;
      }

      if (userRow.status === 'suspended') {
        res.status(403).json({
          ok: false,
          code: 'auth/user-disabled',
          error: 'আপনার অ্যাকাউন্টটি সাময়িকভাবে নিষ্ক্রিয় করা হয়েছে। অনুগ্রহ করে সাপোর্টে যোগাযোগ করুন।',
        });
        return;
      }

      // Sync configured super admin role if needed
      const effectiveRole = resolveUserRole(userRow.phone_e164, userRow.role);
      if (effectiveRole !== userRow.role) {
        await db.run('UPDATE users SET role = ?, updated_at = ? WHERE uid = ?', [
          effectiveRole,
          Date.now(),
          userRow.uid,
        ]);
        userRow.role = effectiveRole;
      }

      await clearAttemptLimit(db, phoneLimitKey);
      await ensureWalletAccount(db, userRow.uid);
      await createSessionForUser(db, userRow.uid, req, res);

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
        role: user.role !== 'user' ? 'admin' : 'user',
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
        phone?: unknown;
        recoveryCode?: unknown;
        newPassword?: unknown;
        confirmPassword?: unknown;
      };
      const phoneE164 = normalizeBangladeshPhone(body.phone);
      const normalizedRecovery = normalizeRecoveryCodeInput(body.recoveryCode);
      const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
      const confirmPassword =
        typeof body.confirmPassword === 'string' ? body.confirmPassword : undefined;

      if (!phoneE164) {
        res.status(400).json({
          ok: false,
          code: 'auth/invalid-phone-number',
          error: 'সঠিক বাংলাদেশি মোবাইল নম্বর লিখুন।',
        });
        return;
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

      const phoneLimitKey = `reset_phone:${phoneE164}`;
      const phoneLimit = await checkAttemptLimit(db, phoneLimitKey, 5, 15 * 60 * 1000);
      if (phoneLimit.blocked) {
        const mins = Math.max(1, Math.ceil(phoneLimit.retryAfterSec / 60));
        res.status(429).json({
          ok: false,
          code: 'auth/too-many-requests',
          error: `অনেকবার ভুল রিকভারি কোড দেওয়া হয়েছে। ${mins} মিনিট পর আবার চেষ্টা করুন।`,
        });
        return;
      }

      const userRow = await db.first<UserRow>(
        'SELECT * FROM users WHERE phone_e164 = ? LIMIT 1',
        [phoneE164]
      );
      if (!userRow) {
        await runDummyPasswordWork(normalizedRecovery);
        await Promise.all([
          recordFailedAttempt(db, phoneLimitKey, 5, 15 * 60 * 1000, 15 * 60 * 1000),
          recordFailedAttempt(db, `reset_ip:${ip}`, 10, 15 * 60 * 1000, 15 * 60 * 1000),
        ]);
        res.status(401).json({
          ok: false,
          code: 'auth/invalid-recovery-code',
          error: 'মোবাইল নম্বর অথবা ব্যাকআপ রিকভারি কোড সঠিক নয়।',
        });
        return;
      }

      const codeValid = await verifySecretPbkdf2(normalizedRecovery, userRow.recovery_hash);
      if (!codeValid) {
        await Promise.all([
          recordFailedAttempt(db, phoneLimitKey, 5, 15 * 60 * 1000, 15 * 60 * 1000),
          recordFailedAttempt(db, `reset_ip:${ip}`, 10, 15 * 60 * 1000, 15 * 60 * 1000),
        ]);
        res.status(401).json({
          ok: false,
          code: 'auth/invalid-recovery-code',
          error: 'মোবাইল নম্বর অথবা ব্যাকআপ রিকভারি কোড সঠিক নয়।',
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
      await clearAttemptLimit(db, phoneLimitKey);
      await clearAttemptLimit(db, `login_phone:${phoneE164}`);

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
      const nextEmail =
        typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 200) : rawRow.email;

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
        if (normalized !== rawRow.phone_e164) {
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
        customerEmail: user.phone,
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
        customerEmail: user.phone,
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
        senderNumber: user.phone,
        deliveryNote: String(body.deliveryNote || '').slice(0, 1500),
        referenceAttachmentUrl: String(body.referenceAttachmentUrl || '').slice(0, 400000),
        status: 'Processing',
        createdAt: now,
        updatedAt: now,
      };

      const wtxObj = {
        id: txId,
        userId: user.uid,
        userEmail: user.phone,
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
        method?: 'bkash' | 'nagad' | 'rocket';
        receiverNumber?: string;
        senderNumber?: string;
        transactionId?: string;
        receiptDataUrl?: string;
      };
      const amountBdt = Number(body.amountBdt || 0);
      const method =
        body.method === 'nagad' || body.method === 'rocket' ? body.method : 'bkash';
      const senderNumber = String(body.senderNumber || '').trim().slice(0, 30);
      const transactionId = String(body.transactionId || '').trim().slice(0, 80);
      const txKey = normalizeTxIdKey(transactionId);

      if (!Number.isFinite(amountBdt) || amountBdt < 10 || amountBdt > 500000) {
        res.status(400).json({ ok: false, error: 'সঠিক টাকার পরিমাণ লিখুন (সর্বনিম্ন ৳১০)।' });
        return;
      }
      if (senderNumber.length < 8 || txKey.length < 4) {
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
      const body = (req.body || {}) as {
        amountBdt?: number;
        method?: 'bkash' | 'nagad' | 'rocket';
        accountNumber?: string;
      };
      const amountBdt = Number(body.amountBdt || 0);
      const method =
        body.method === 'nagad' || body.method === 'rocket' ? body.method : 'bkash';
      const accountNumber = String(body.accountNumber || '').trim().slice(0, 30);

      if (!Number.isFinite(amountBdt) || amountBdt < 50 || amountBdt > 100000) {
        res.status(400).json({ ok: false, error: 'সর্বনিম্ন ৳৫০ থেকে উত্তোলন অনুরোধ করতে পারবেন।' });
        return;
      }
      if (accountNumber.length < 8) {
        res.status(400).json({ ok: false, error: 'সঠিক বিকাশ/নগদ/রকেট নম্বর দিন।' });
        return;
      }

      const now = Date.now();
      const id = generateSecureId('wdr', 8);
      const txId = generateSecureId('wtx', 8);

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
        userId: user.uid,
        userEmail: user.phone,
        userName: user.displayName,
        amountBdt,
        method,
        accountNumber,
        status: 'Pending',
        createdAt: now,
        updatedAt: now,
      };
      const wtxObj = {
        id: txId,
        userId: user.uid,
        type: 'withdrawal',
        amountBdt,
        method,
        senderNumber: accountNumber,
        status: 'Verification Pending',
        note: `Withdrawal request to ${method.toUpperCase()} (${accountNumber})`,
        createdAt: now,
        updatedAt: now,
      };

      await db.run(
        'INSERT INTO withdrawals (id, user_id, status, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, user.uid, 'Pending', JSON.stringify(wdrObj), now, now]
      );
      await db.run(
        'INSERT INTO wallet_transactions (id, user_id, type, amount_bdt, status, transaction_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [txId, user.uid, 'withdrawal', amountBdt, 'Verification Pending', '', JSON.stringify(wtxObj), now, now]
      );

      res.status(201).json({ ok: true, id });
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
        userEmail: user.phone,
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
        userEmail: user.phone,
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
      const owner = await db.first<{ uid: string; referral_code: string }>(
        'SELECT uid, referral_code FROM users WHERE referral_code = ? LIMIT 1',
        [code]
      );
      if (!owner) {
        res.json({ ok: true, registered: false });
        return;
      }
      const now = Date.now();
      const refId = generateSecureId('ref', 8);
      const payload = {
        id: refId,
        referrerId: owner.uid,
        referredUserId: user.uid,
        referredEmail: user.phone,
        referralCode: owner.referral_code,
        rewardAmountBdt: 30,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      };
      await db.run(
        'INSERT OR IGNORE INTO referrals (id, referrer_uid, referred_uid, status, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [refId, owner.uid, user.uid, 'pending', JSON.stringify(payload), now]
      );
      res.json({ ok: true, registered: true, referralId: refId, status: 'pending' });
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
        userEmail: user.phone,
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
        userEmail: user.phone,
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
        userEmail: user.phone,
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
  router.get('/catalog/overrides', async (_req, res) => {
    try {
      const db = await getAppDatabase();
      const [overrideRows, reviewRows, announcementRows] = await Promise.all([
        db.all<{ collection: string; doc_id: string; deleted: number; payload_json: string }>(
          'SELECT collection, doc_id, deleted, payload_json FROM catalog_overrides'
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM reviews WHERE approved = 1 ORDER BY created_at DESC LIMIT 200'
        ),
        db.all<{ payload_json: string }>(
          'SELECT payload_json FROM announcements WHERE active = 1 ORDER BY created_at DESC LIMIT 30'
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
      });
    } catch {
      res.json({ ok: true, overrides: {}, reviews: [], announcements: [] });
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
        role: resolved.user.role,
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
      ] = await Promise.all([
        db.all<UserRow>('SELECT * FROM users ORDER BY created_at DESC LIMIT 500'),
        db.all<{
          uid: string;
          available_balance_bdt: number;
          promotional_credits_bdt: number;
          total_added_bdt: number;
          total_spent_bdt: number;
          last_tx_id: string;
          updated_at: number;
        }>('SELECT * FROM wallet_accounts LIMIT 500'),
        db.all<{ payload_json: string }>('SELECT payload_json FROM wallet_transactions ORDER BY created_at DESC LIMIT 500'),
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
        db.all<{ payload_json: string }>('SELECT payload_json FROM audit_logs ORDER BY created_at DESC LIMIT 200'),
      ]);

      res.json({
        ok: true,
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
        user.phone,
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
        user.phone,
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
      await insertAuditLog(db, user.uid, user.phone, 'ORDER_STATUS_UPDATED', 'orders', orderId, `Set status ${status}`);
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
      await insertAuditLog(db, user.uid, user.phone, 'ORDER_COMPLETED', 'orders', orderId, `Completed order ${orderId}`);
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
      await insertAuditLog(db, user.uid, user.phone, 'ORDER_REFUND_CANCEL', 'orders', orderId, `Cancelled order ${orderId}`);
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
      if (!targetUid) {
        res.status(400).json({ ok: false, error: 'Target user ID required.' });
        return;
      }
      const wallet = await ensureWalletAccount(db, targetUid);
      let nextBal = wallet.availableBalanceBdt;
      let delta = 0;
      const promoDelta = Number(body.promoDeltaBdt || 0);
      if (body.mode === 'add' || body.mode === 'deduct' || body.mode === 'set') {
        const rawAmt = Math.max(0, Math.round(Number(body.amountBdt || 0)));
        if (body.mode === 'add') nextBal = wallet.availableBalanceBdt + rawAmt;
        else if (body.mode === 'deduct') {
          if (wallet.availableBalanceBdt < rawAmt) {
            res.status(400).json({ ok: false, error: `Cannot deduct ৳${rawAmt} from ৳${wallet.availableBalanceBdt}.` });
            return;
          }
          nextBal = wallet.availableBalanceBdt - rawAmt;
        } else {
          nextBal = rawAmt;
        }
        delta = nextBal - wallet.availableBalanceBdt;
      } else {
        delta = Number(body.amountDeltaBdt || 0);
        nextBal = Math.max(0, wallet.availableBalanceBdt + delta);
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
      const noteText = String(body.note || body.reason || 'Admin wallet adjustment').slice(0, 300);
      const wtx = {
        id: txId,
        userId: targetUid,
        type: promoDelta > 0 && delta === 0 ? 'promo_credit' : 'admin_adjustment',
        method: 'system',
        transactionId: txId,
        amountBdt: Math.max(1, Math.abs(delta || promoDelta)),
        status: 'Approved',
        note: noteText,
        createdAt: now,
        updatedAt: now,
      };
      await db.run(
        'INSERT INTO wallet_transactions (id, user_id, type, amount_bdt, status, transaction_id, payload_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [txId, targetUid, wtx.type, wtx.amountBdt, 'Approved', txId, JSON.stringify(wtx), now, now]
      );
      await insertAuditLog(db, user.uid, user.phone, 'WALLET_ADJUSTED', 'walletAccounts', targetUid, `Delta ৳${delta} / promo ৳${promoDelta}`);
      res.json({ ok: true, nextBalance: nextBal });
    } catch (err) {
      handleRouteError(res, err, 'Failed to adjust wallet.');
    }
  });

  router.post('/admin/update-user-status', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as { uid?: string; targetUid?: string; status?: 'active' | 'suspended' };
      const targetUid = String(body.targetUid || body.uid || '').trim();
      const status = body.status === 'suspended' ? 'suspended' : 'active';
      const now = Date.now();
      await db.run('UPDATE users SET status = ?, updated_at = ? WHERE uid = ?', [status, now, targetUid]);
      if (status === 'suspended') {
        await db.run('DELETE FROM sessions WHERE user_id = ?', [targetUid]);
      }
      await insertAuditLog(db, user.uid, user.phone, 'USER_STATUS_UPDATED', 'users', targetUid, `Set ${status}`);
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to update user status.');
    }
  });

  router.post('/admin/process-withdrawal', async (req, res) => {
    try {
      const admin = await requireAdminSession(req, res);
      if (!admin) return;
      const { db, user } = admin;
      const body = (req.body || {}) as {
        withdrawalId?: string;
        decision?: 'approve' | 'reject';
        adminNote?: string;
        rejectionReason?: string;
        payoutTrxId?: string;
        payoutReference?: string;
      };
      const wId = String(body.withdrawalId || '').trim();
      const decision = body.decision;
      const row = await db.first<{ user_id: string; status: string; payload_json: string }>(
        'SELECT user_id, status, payload_json FROM withdrawals WHERE id = ?',
        [wId]
      );
      if (!row || row.status !== 'Pending') {
        res.status(409).json({ ok: false, error: 'Withdrawal already processed or missing.' });
        return;
      }
      const now = Date.now();
      const existing = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      const status = decision === 'approve' ? 'Approved' : 'Rejected';
      const updated = {
        ...existing,
        status,
        adminNote: String(body.adminNote || '').slice(0, 300),
        rejectionReason: String(body.rejectionReason || '').slice(0, 300),
        payoutReference: String(body.payoutReference || body.payoutTrxId || '').slice(0, 80),
        processedBy: user.uid,
        updatedAt: now,
      };
      await db.run('UPDATE withdrawals SET status = ?, payload_json = ?, updated_at = ? WHERE id = ?', [
        status,
        JSON.stringify(updated),
        now,
        wId,
      ]);
      if (decision === 'reject') {
        const amt = Number(existing.amountBdt || 0);
        if (amt > 0) {
          await ensureWalletAccount(db, row.user_id);
          await db.run(
            'UPDATE wallet_accounts SET available_balance_bdt = available_balance_bdt + ?, updated_at = ? WHERE uid = ?',
            [amt, now, row.user_id]
          );
        }
      }
      await insertAuditLog(db, user.uid, user.phone, 'WITHDRAWAL_PROCESSED', 'withdrawals', wId, `${status} ${wId}`);
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to process withdrawal.');
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
      await admin.db.run('DELETE FROM announcements WHERE id = ?', [String(req.params.id || '').trim()]);
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
      const status = String(body.status || 'Resolved');
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
      const row = await admin.db.first<{ user_id: string; payload_json: string }>(
        'SELECT user_id, payload_json FROM rewarded_claims WHERE id = ?',
        [id]
      );
      if (!row) {
        res.status(404).json({ ok: false, error: 'Claim not found' });
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
        await admin.db.run(
          'UPDATE wallet_accounts SET available_balance_bdt = available_balance_bdt + ?, updated_at = ? WHERE uid = ?',
          [rewardBdt, now, row.user_id]
        );
      }
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
      const row = await admin.db.first<{ user_id: string; coins: number; payload_json: string }>(
        'SELECT user_id, coins, payload_json FROM ad_reward_transactions WHERE id = ?',
        [id]
      );
      if (!row) {
        res.status(404).json({ ok: false, error: 'Redemption not found' });
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
          await admin.db.run(
            'UPDATE wallet_accounts SET available_balance_bdt = available_balance_bdt + ?, updated_at = ? WHERE uid = ?',
            [amt, now, row.user_id]
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
      };
      const id = String(body.referralId || '').trim();
      const row = await admin.db.first<{ referrer_uid: string; payload_json: string }>(
        'SELECT referrer_uid, payload_json FROM referrals WHERE id = ?',
        [id]
      );
      if (!row) {
        res.status(404).json({ ok: false, error: 'Referral not found' });
        return;
      }
      const now = Date.now();
      const existing = parseJsonSafe<Record<string, unknown>>(row.payload_json, {});
      const isCredit = body.decision === 'approve' || body.decision === 'credit';
      const status = isCredit ? 'credited' : 'revoked';
      const rewardBdt = Number(body.rewardBdt ?? existing.rewardAmountBdt ?? existing.rewardBdt ?? 30);
      const next = { ...existing, status, rewardAmountBdt: rewardBdt, updatedAt: now };
      await admin.db.run('UPDATE referrals SET status = ?, payload_json = ? WHERE id = ?', [
        status,
        JSON.stringify(next),
        id,
      ]);
      if (isCredit && rewardBdt > 0) {
        await ensureWalletAccount(admin.db, row.referrer_uid);
        await admin.db.run(
          'UPDATE wallet_accounts SET available_balance_bdt = available_balance_bdt + ?, updated_at = ? WHERE uid = ?',
          [rewardBdt, now, row.referrer_uid]
        );
      }
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
      const body = (req.body || {}) as { id?: string; data?: Record<string, unknown> };
      const docId = String(body.id || '').trim().slice(0, 128);
      if (!docId || !body.data) {
        res.status(400).json({ ok: false, error: 'Missing doc id or data.' });
        return;
      }
      const now = Date.now();
      await admin.db.run(
        `INSERT INTO catalog_overrides (collection, doc_id, deleted, payload_json, updated_at)
         VALUES (?, ?, 0, ?, ?)
         ON CONFLICT(collection, doc_id) DO UPDATE SET deleted = 0, payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
        [col, docId, JSON.stringify({ ...body.data, id: docId, updatedAt: now }), now]
      );
      res.json({ ok: true });
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
      await admin.db.run(
        `INSERT INTO catalog_overrides (collection, doc_id, deleted, payload_json, updated_at)
         VALUES (?, ?, 1, '{}', ?)
         ON CONFLICT(collection, doc_id) DO UPDATE SET deleted = 1, updated_at = excluded.updated_at`,
        [col, docId, now]
      );
      res.json({ ok: true });
    } catch (err) {
      handleRouteError(res, err, 'Failed to delete catalog item.');
    }
  });

  return router;
}
