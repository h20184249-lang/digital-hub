import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import firebaseAppletConfig from '../firebase-applet-config.json';

interface FirebaseConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

function isConfiguredEnvValue(raw: string | undefined): boolean {
  const val = (raw || '').trim();
  if (!val) return false;
  const upper = val.toUpperCase();
  if (
    upper.startsWith('YOUR_') ||
    upper.startsWith('REPLACE_') ||
    upper.startsWith('MY_') ||
    upper.includes('YOUR_') ||
    upper.includes('CHANGEME') ||
    upper.includes('EXAMPLE.COM') ||
    val.startsWith('<')
  ) {
    return false;
  }
  return true;
}

function getFirebaseConfig(): FirebaseConfig {
  const base = firebaseAppletConfig as Partial<FirebaseConfig>;
  return {
    projectId: isConfiguredEnvValue(process.env.FIREBASE_PROJECT_ID)
      ? String(process.env.FIREBASE_PROJECT_ID).trim()
      : String(base.projectId || ''),
    apiKey: String(base.apiKey || ''),
    firestoreDatabaseId: isConfiguredEnvValue(process.env.FIREBASE_DATABASE_ID)
      ? String(process.env.FIREBASE_DATABASE_ID).trim()
      : String(base.firestoreDatabaseId || '(default)'),
  };
}

function getBootstrappedAdminEmail(): string {
  const envAdminEmail = (process.env.SUPER_ADMIN_EMAIL || '').trim().toLowerCase();
  return isConfiguredEnvValue(envAdminEmail) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(envAdminEmail)
    ? envAdminEmail
    : 'ftake810@gmail.com';
}

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  authTime: number;
  token: string;
}

async function verifyBearerToken(authHeader: string | undefined): Promise<VerifiedFirebaseUser | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const cfg = getFirebaseConfig();
  if (!token || !cfg.projectId) return null;

  try {
    const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${cfg.projectId}`,
      audience: cfg.projectId,
    });
    const uid = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email : '';
    const emailVerified = payload.email_verified === true;
    const authTime = typeof payload.auth_time === 'number' ? payload.auth_time : Number(payload.auth_time) || 0;
    if (!uid) return null;
    return { uid, email, emailVerified, authTime, token };
  } catch {
    return null;
  }
}

function firestoreDocUrl(collectionPath: string, docId: string): string {
  const cfg = getFirebaseConfig();
  const dbId = cfg.firestoreDatabaseId || '(default)';
  return `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${dbId}/documents/${collectionPath}/${encodeURIComponent(docId)}`;
}

async function getAdminRole(user: VerifiedFirebaseUser): Promise<'super_admin' | 'admin' | 'user'> {
  if (!user.emailVerified || !user.email) return 'user';
  const normalizedEmail = user.email.trim().toLowerCase();
  if (normalizedEmail === getBootstrappedAdminEmail()) {
    return 'super_admin';
  }
  try {
    const adminDoc = await getFirestoreDoc('admins', user.uid, user.token);
    if (adminDoc.ok && adminDoc.fields) {
      const docEmail = fromFirestoreString(adminDoc.fields.email).trim().toLowerCase();
      const docRole = fromFirestoreString(adminDoc.fields.role);
      if (docEmail === normalizedEmail && (docRole === 'super_admin' || docRole === 'admin')) {
        return docRole;
      }
    }
  } catch {
    // Fallback to user
  }
  return 'user';
}

async function isAuthorizedAdmin(user: VerifiedFirebaseUser): Promise<boolean> {
  return (await getAdminRole(user)) !== 'user';
}

async function isSuperAdmin(user: VerifiedFirebaseUser): Promise<boolean> {
  return (await getAdminRole(user)) === 'super_admin';
}

function isFreshAdminAuth(user: VerifiedFirebaseUser, maxAgeSeconds = 900): boolean {
  if (!user.authTime || user.authTime <= 0) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  return nowSec - user.authTime <= maxAgeSeconds;
}

function toFirestoreValue(val: unknown): Record<string, unknown> {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  return { stringValue: String(val) };
}

function fromFirestoreNumber(field: unknown): number {
  if (!field || typeof field !== 'object') return 0;
  const rec = field as Record<string, unknown>;
  if (typeof rec.integerValue === 'string') return Number(rec.integerValue) || 0;
  if (typeof rec.doubleValue === 'number') return rec.doubleValue;
  return 0;
}

function fromFirestoreString(field: unknown): string {
  if (!field || typeof field !== 'object') return '';
  const rec = field as Record<string, unknown>;
  return typeof rec.stringValue === 'string' ? rec.stringValue : '';
}

function fromFirestoreBool(field: unknown, fallback = false): boolean {
  if (!field || typeof field !== 'object') return fallback;
  const rec = field as Record<string, unknown>;
  return typeof rec.booleanValue === 'boolean' ? rec.booleanValue : fallback;
}

function fromFirestoreTimestampMs(field: unknown): number {
  if (!field || typeof field !== 'object') return 0;
  const rec = field as Record<string, unknown>;
  if (typeof rec.timestampValue === 'string') {
    return Date.parse(rec.timestampValue) || 0;
  }
  return 0;
}

async function getFirestoreDoc(
  collectionPath: string,
  docId: string,
  token: string
): Promise<{ ok: boolean; fields?: Record<string, unknown> }> {
  const resp = await fetch(firestoreDocUrl(collectionPath, docId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) return { ok: false };
  const data = (await resp.json()) as { fields?: Record<string, unknown> };
  return { ok: true, fields: data.fields };
}

async function runFirestoreEqualQuery(
  collectionId: string,
  fieldPath: string,
  value: string,
  token: string,
  limit = 20
): Promise<Array<{ id: string; fields: Record<string, unknown> }>> {
  const cfg = getFirebaseConfig();
  const dbId = cfg.firestoreDatabaseId || '(default)';
  const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${dbId}/documents:runQuery`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: 'EQUAL',
            value: { stringValue: value },
          },
        },
        limit,
      },
    }),
  });
  if (!resp.ok) return [];
  const rows = (await resp.json()) as Array<{ document?: { name: string; fields?: Record<string, unknown> } }>;
  const results: Array<{ id: string; fields: Record<string, unknown> }> = [];
  for (const row of rows) {
    if (row.document && row.document.fields) {
      const parts = row.document.name.split('/');
      results.push({ id: parts[parts.length - 1] || '', fields: row.document.fields });
    }
  }
  return results;
}

function splitFirestoreFieldsAndTransforms(fields: Record<string, unknown>): {
  firestoreFields: Record<string, unknown>;
  fieldPaths: string[];
  updateTransforms: Array<{ fieldPath: string; setToServerValue: 'REQUEST_TIME' }>;
} {
  const firestoreFields: Record<string, unknown> = {};
  const fieldPaths: string[] = [];
  const updateTransforms: Array<{ fieldPath: string; setToServerValue: 'REQUEST_TIME' }> = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v instanceof Date) {
      updateTransforms.push({ fieldPath: k, setToServerValue: 'REQUEST_TIME' });
    } else {
      firestoreFields[k] = toFirestoreValue(v);
      fieldPaths.push(k);
    }
  }
  return { firestoreFields, fieldPaths, updateTransforms };
}

function firestoreCommitUrl(): string {
  const cfg = getFirebaseConfig();
  const dbId = cfg.firestoreDatabaseId || '(default)';
  return `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${dbId}/documents:commit`;
}

function firestoreResourceName(collectionPath: string, docId: string): string {
  const cfg = getFirebaseConfig();
  const dbId = cfg.firestoreDatabaseId || '(default)';
  return `projects/${cfg.projectId}/databases/${dbId}/documents/${collectionPath}/${docId}`;
}

async function commitSingleWrite(
  writeObj: Record<string, unknown>,
  token: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const resp = await fetch(firestoreCommitUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes: [writeObj] }),
  });
  const body = await resp.text();
  return { ok: resp.ok, status: resp.status, body };
}

async function patchFirestoreDoc(
  collectionPath: string,
  docId: string,
  fields: Record<string, unknown>,
  token: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const { firestoreFields, fieldPaths, updateTransforms } = splitFirestoreFieldsAndTransforms(fields);
  const docName = firestoreResourceName(collectionPath, docId);
  if (fieldPaths.length === 0 && updateTransforms.length > 0) {
    return commitSingleWrite(
      {
        transform: { document: docName, fieldTransforms: updateTransforms },
        currentDocument: { exists: true },
      },
      token
    );
  }
  return commitSingleWrite(
    {
      update: { name: docName, fields: firestoreFields },
      updateMask: { fieldPaths },
      ...(updateTransforms.length > 0 ? { updateTransforms } : {}),
      currentDocument: { exists: true },
    },
    token
  );
}

async function createFirestoreDoc(
  collectionPath: string,
  docId: string,
  fields: Record<string, unknown>,
  token: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const { firestoreFields, updateTransforms } = splitFirestoreFieldsAndTransforms(fields);
  const docName = firestoreResourceName(collectionPath, docId);
  return commitSingleWrite(
    {
      update: { name: docName, fields: firestoreFields },
      ...(updateTransforms.length > 0 ? { updateTransforms } : {}),
      currentDocument: { exists: false },
    },
    token
  );
}

async function setFirestoreDoc(
  collectionPath: string,
  docId: string,
  fields: Record<string, unknown>,
  token: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const { firestoreFields, updateTransforms } = splitFirestoreFieldsAndTransforms(fields);
  const docName = firestoreResourceName(collectionPath, docId);
  return commitSingleWrite(
    {
      update: { name: docName, fields: firestoreFields },
      ...(updateTransforms.length > 0 ? { updateTransforms } : {}),
    },
    token
  );
}

async function deleteFirestoreDoc(
  collectionPath: string,
  docId: string,
  token: string
): Promise<{ ok: boolean; status: number; body: string }> {
  const docName = firestoreResourceName(collectionPath, docId);
  return commitSingleWrite({ delete: docName }, token);
}

// Persistent server-side ad telemetry store (strictly real tracked events, no fabricated earnings)
interface AdAnalyticsEntry {
  impressions: number;
  clicks: number;
  byPlacement: Record<string, { impressions: number; clicks: number }>;
  lastEventAt: string;
}

interface AdAnalyticsState {
  byAd: Record<string, AdAnalyticsEntry>;
  byFormat: Record<string, { impressions: number; clicks: number }>;
  blockedFakeClicks: number;
}

function resolveDataDir(): string | null {
  try {
    if (typeof import.meta.url === 'string' && import.meta.url.startsWith('file:')) {
      const moduleDir = path.dirname(fileURLToPath(import.meta.url));
      return path.resolve(moduleDir, '..', '.data');
    }
  } catch {
    // Non-filesystem runtime (e.g. Cloudflare Workers)
  }
  return null;
}

const dataDir = resolveDataDir();
const analyticsFile = dataDir ? path.join(dataDir, 'ad_analytics.json') : '';

function loadAnalytics(): AdAnalyticsState {
  if (!analyticsFile) return { byAd: {}, byFormat: {}, blockedFakeClicks: 0 };
  try {
    if (fs.existsSync(analyticsFile)) {
      const parsed = JSON.parse(fs.readFileSync(analyticsFile, 'utf-8')) as Partial<AdAnalyticsState> &
        Record<string, unknown>;
      if (parsed && typeof parsed === 'object' && parsed.byAd) {
        return {
          byAd: parsed.byAd,
          byFormat: parsed.byFormat || {},
          blockedFakeClicks: Number(parsed.blockedFakeClicks) || 0,
        };
      }
      // Migrate legacy flat store if present
      const legacyByAd: Record<string, AdAnalyticsEntry> = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (v && typeof v === 'object' && 'impressions' in v) {
          legacyByAd[k] = v as AdAnalyticsEntry;
        }
      }
      return { byAd: legacyByAd, byFormat: {}, blockedFakeClicks: 0 };
    }
  } catch {
    // ignore
  }
  return { byAd: {}, byFormat: {}, blockedFakeClicks: 0 };
}

function saveAnalytics(state: AdAnalyticsState): void {
  if (!dataDir || !analyticsFile) return;
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(analyticsFile, JSON.stringify(state, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

let adAnalyticsState: AdAnalyticsState = loadAnalytics();

// Anti-fake-click & duplicate impression memory window
const recentAdEvents = new Map<string, number>();
const burstWindow = new Map<string, { count: number; resetAt: number }>();

function cleanupRateMaps(now: number): void {
  if (recentAdEvents.size > 5000) {
    for (const [k, ts] of recentAdEvents.entries()) {
      if (now - ts > 120000) recentAdEvents.delete(k);
    }
  }
  if (burstWindow.size > 2000) {
    for (const [k, v] of burstWindow.entries()) {
      if (now > v.resetAt) burstWindow.delete(k);
    }
  }
}

function loadJsonStore<T>(filePath: string, fallback: T): T {
  if (!filePath) return fallback;
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    }
  } catch {
    // ignore
  }
  return fallback;
}

function saveJsonStore(filePath: string, data: unknown): void {
  if (!dataDir || !filePath) return;
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  } catch {
    // ignore
  }
}

interface VerifiedS2SReceipt {
  sessionToken: string;
  provider: string;
  providerEventId: string;
  receivedAt: string;
  coinsOverride?: number;
  consumed?: boolean;
}

const s2sReceiptsFile = dataDir ? path.join(dataDir, 'watch_earn_s2s.json') : '';
let verifiedS2SReceipts: Record<string, VerifiedS2SReceipt> = loadJsonStore<Record<string, VerifiedS2SReceipt>>(
  s2sReceiptsFile,
  {}
);

interface WatchEarnUserCoinLedger {
  coinsAvailable: number;
  coinsLifetimeEarned: number;
  coinsRedeemed: number;
  creditedSessions: Array<{
    sessionId: string;
    provider: string;
    providerEventId: string;
    coins: number;
    creditedAt: string;
  }>;
}

const watchEarnLedgerFile = dataDir ? path.join(dataDir, 'watch_earn_ledger.json') : '';
let watchEarnLedger: Record<string, WatchEarnUserCoinLedger> = loadJsonStore<
  Record<string, WatchEarnUserCoinLedger>
>(watchEarnLedgerFile, {});

function getUserCoinLedger(uid: string): WatchEarnUserCoinLedger {
  if (!watchEarnLedger[uid]) {
    watchEarnLedger[uid] = {
      coinsAvailable: 0,
      coinsLifetimeEarned: 0,
      coinsRedeemed: 0,
      creditedSessions: [],
    };
  }
  return watchEarnLedger[uid];
}

interface ReferralIpGuardState {
  byIpHash: Record<string, Array<{ userId: string; referrerId: string; at: number }>>;
}
const referralGuardFile = dataDir ? path.join(dataDir, 'referral_ip_guard.json') : '';
let referralIpGuard: ReferralIpGuardState = loadJsonStore<ReferralIpGuardState>(referralGuardFile, {
  byIpHash: {},
});

const AUTHORIZED_24_UNIT_PROVIDERS = new Set(['AFDERS', 'ARWF', 'BICEA', 'AUCTIONR', 'ASIAFILM']);

function getConfiguredCorsOrigins(): Set<string> {
  const origins = new Set<string>([
    'https://localhost',
    'http://localhost',
    'http://localhost:3000',
    'capacitor://localhost',
  ]);
  if (isConfiguredEnvValue(process.env.APP_URL) && String(process.env.APP_URL).trim().startsWith('http')) {
    try {
      origins.add(new URL(String(process.env.APP_URL).trim()).origin);
    } catch {
      // ignore invalid APP_URL
    }
  }
  if (process.env.ALLOWED_CORS_ORIGINS) {
    for (const rawOrigin of process.env.ALLOWED_CORS_ORIGINS.split(',')) {
      const clean = rawOrigin.trim().replace(/\/+$/, '');
      if (!isConfiguredEnvValue(clean)) continue;
      try {
        origins.add(new URL(clean).origin);
      } catch {
        // ignore invalid origin entry
      }
    }
  }
  return origins;
}

// Lightweight native UTF-8 JSON body parser compatible with both Node.js and Cloudflare Workers (`workerd`),
// avoiding `body-parser` -> `iconv-lite` CommonJS dynamic stream patching issues under edge bundlers.
function createJsonBodyParser(maxBytes: number): express.RequestHandler {
  return (req, res, next) => {
    if (req.body !== undefined) {
      next();
      return;
    }
    req.body = {};
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
      next();
      return;
    }
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.includes('application/json') && !contentType.includes('+json')) {
      next();
      return;
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let settled = false;

    const finishWithError = (status: number, error: string) => {
      if (settled) return;
      settled = true;
      res.status(status).json({ error });
    };

    req.on('data', (chunk: Buffer | string) => {
      if (settled) return;
      const buf = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      totalBytes += buf.length;
      if (totalBytes > maxBytes) {
        finishWithError(413, 'Request payload too large');
        req.resume();
        return;
      }
      chunks.push(buf);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        req.body = {};
        next();
        return;
      }
      try {
        req.body = JSON.parse(raw);
        next();
      } catch {
        res.status(400).json({ error: 'Invalid JSON request body' });
      }
    });

    req.on('error', () => {
      finishWithError(400, 'Failed to read request body');
    });
  };
}

export function createApiApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(createJsonBodyParser(1024 * 1024));

  // Content Security Policy & hardening headers (preserves Vite dev mode, Firebase Auth, Google Fonts, and sandboxed Ad iframes)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://apis.google.com https://www.gstatic.com https://accounts.google.com https://securetoken.googleapis.com https://pagead2.googlesyndication.com https://afders.org https://bicea.org",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "connect-src 'self' https://*.googleapis.com https://*.firebaseio.com https://*.firebaseapp.com https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.google-analytics.com https:",
      "frame-src 'self' https://accounts.google.com https://*.firebaseapp.com https://bicea.org https://afders.org https://arwf.org https://auctionr.org https://asiafilm.org https:",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ');
    res.setHeader('Content-Security-Policy', cspDirectives);
    next();
  });

  // Enable strict allowlisted CORS for Capacitor Android WebView & configured origins on /api/*
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    const hostHeader = req.headers.host;
    let isSameHostOrigin = false;
    if (origin && hostHeader) {
      try {
        isSameHostOrigin = new URL(origin).host === hostHeader;
      } catch {
        isSameHostOrigin = false;
      }
    }
    const configuredCorsOrigins = getConfiguredCorsOrigins();
    if (origin && (configuredCorsOrigins.has(origin) || isSameHostOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  const apiRateMap = new Map<string, { count: number; resetAt: number }>();
  const applyApiRateLimit = (bucket: string, maxRequests: number, windowMs: number) => {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const now = Date.now();
      const key = `${bucket}:${req.ip || 'unknown'}`;
      const existing = apiRateMap.get(key);
      if (existing && now < existing.resetAt) {
        if (existing.count >= maxRequests) {
          res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
          return;
        }
        existing.count += 1;
      } else {
        apiRateMap.set(key, { count: 1, resetAt: now + windowMs });
      }
      if (apiRateMap.size > 4000) {
        for (const [k, v] of apiRateMap.entries()) {
          if (now > v.resetAt) apiRateMap.delete(k);
        }
      }
      next();
    };
  };

  app.use('/api/payments', applyApiRateLimit('payments', 30, 60000));
  app.use('/api/auth', applyApiRateLimit('auth', 25, 60000));
  app.use('/api/ads/claim-reward', applyApiRateLimit('reward_claim', 15, 60000));
  app.use('/api/admin', applyApiRateLimit('admin', 80, 60000));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'DIGITAL HUB API', timestamp: new Date().toISOString() });
  });

  // Track real ad impressions and clicks with anti-fake-click & dedup protection
  app.post('/api/ads/track', (req, res) => {
    const body = req.body as {
      adId?: unknown;
      type?: unknown;
      placement?: unknown;
      adFormat?: unknown;
      sessionId?: unknown;
    };
    const adId = typeof body.adId === 'string' ? body.adId.trim() : '';
    const type = body.type === 'click' || body.type === 'impression' ? body.type : null;
    const placement = typeof body.placement === 'string' ? body.placement.trim().slice(0, 40) : 'general';
    const adFormat = typeof body.adFormat === 'string' ? body.adFormat.trim().slice(0, 30) : 'direct_link';
    const sessionId =
      typeof body.sessionId === 'string' && /^[a-zA-Z0-9_-]{6,64}$/.test(body.sessionId)
        ? body.sessionId
        : req.ip || 'anon';

    if (!adId || !/^[a-zA-Z0-9_-]{1,64}$/.test(adId) || !type) {
      res.status(400).json({ error: 'Invalid adId or event type' });
      return;
    }

    const now = Date.now();
    cleanupRateMaps(now);

    // Per-IP / session burst limiter (anti-bot fake click protection)
    const actorKey = `${req.ip || 'unknown'}:${sessionId}:${type}`;
    const burst = burstWindow.get(actorKey);
    const maxPerMinute = type === 'click' ? 12 : 45;
    if (burst && now < burst.resetAt) {
      if (burst.count >= maxPerMinute) {
        if (type === 'click') {
          adAnalyticsState.blockedFakeClicks += 1;
          saveAnalytics(adAnalyticsState);
        }
        res.status(429).json({ ok: false, deduplicated: true, reason: 'Rate limit exceeded (anti-fake-click guard)' });
        return;
      }
      burst.count += 1;
    } else {
      burstWindow.set(actorKey, { count: 1, resetAt: now + 60000 });
    }

    // Cooldown deduplication: ignore repeat click within 45s or repeat impression within 25s for same session+ad+placement
    const dedupKey = `${sessionId}:${adId}:${placement}:${type}`;
    const lastTs = recentAdEvents.get(dedupKey);
    const cooldownMs = type === 'click' ? 45000 : 25000;
    if (lastTs && now - lastTs < cooldownMs) {
      if (type === 'click') {
        adAnalyticsState.blockedFakeClicks += 1;
        saveAnalytics(adAnalyticsState);
      }
      res.json({
        ok: true,
        deduplicated: true,
        adId,
        type,
        counts: adAnalyticsState.byAd[adId]
          ? {
              impressions: adAnalyticsState.byAd[adId].impressions,
              clicks: adAnalyticsState.byAd[adId].clicks,
            }
          : { impressions: 0, clicks: 0 },
      });
      return;
    }
    recentAdEvents.set(dedupKey, now);

    if (!adAnalyticsState.byAd[adId]) {
      adAnalyticsState.byAd[adId] = {
        impressions: 0,
        clicks: 0,
        byPlacement: {},
        lastEventAt: new Date().toISOString(),
      };
    }

    const entry = adAnalyticsState.byAd[adId];
    if (!entry.byPlacement[placement]) {
      entry.byPlacement[placement] = { impressions: 0, clicks: 0 };
    }
    if (!adAnalyticsState.byFormat[adFormat]) {
      adAnalyticsState.byFormat[adFormat] = { impressions: 0, clicks: 0 };
    }

    if (type === 'impression') {
      entry.impressions += 1;
      entry.byPlacement[placement].impressions += 1;
      adAnalyticsState.byFormat[adFormat].impressions += 1;
    } else {
      entry.clicks += 1;
      entry.byPlacement[placement].clicks += 1;
      adAnalyticsState.byFormat[adFormat].clicks += 1;
    }
    entry.lastEventAt = new Date().toISOString();
    saveAnalytics(adAnalyticsState);

    res.json({
      ok: true,
      deduplicated: false,
      adId,
      type,
      counts: { impressions: entry.impressions, clicks: entry.clicks },
    });
  });

  // Server-side RBAC admin role verification
  app.get('/api/admin/verify', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user) {
      res.status(403).json({
        authorized: false,
        error: 'Restricted: Authorized Super Admin account required.',
      });
      return;
    }
    const adminRole = await getAdminRole(user);
    if (adminRole === 'user') {
      res.status(403).json({
        authorized: false,
        error: 'Restricted: Authorized Super Admin account required.',
      });
      return;
    }
    res.json({
      authorized: true,
      uid: user.uid,
      email: user.email,
      role: adminRole === 'super_admin' ? 'owner' : 'admin',
      adminRole,
      freshAuth: isFreshAdminAuth(user, 900),
    });
  });

  app.get('/api/ads/analytics', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    let totalImpressions = 0;
    let totalClicks = 0;
    for (const entry of Object.values(adAnalyticsState.byAd)) {
      totalImpressions += entry.impressions;
      totalClicks += entry.clicks;
    }
    const ctr = totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0;
    res.json({
      totalImpressions,
      totalClicks,
      ctr,
      blockedFakeClicks: adAnalyticsState.blockedFakeClicks,
      byFormat: adAnalyticsState.byFormat,
      byAd: adAnalyticsState.byAd,
    });
  });

  // Validate Transaction ID format & duplicate prevention (Authenticated & Verified Users Only)
  app.post('/api/payments/validate-tx', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !user.emailVerified) {
      res.status(401).json({ valid: false, error: 'Verified authentication required to validate Transaction IDs.' });
      return;
    }
    const body = req.body as { transactionId?: unknown; senderNumber?: unknown; method?: unknown };
    const txId = typeof body.transactionId === 'string' ? body.transactionId.trim().toUpperCase() : '';
    const senderNumber = typeof body.senderNumber === 'string' ? body.senderNumber.trim() : '';
    const method = typeof body.method === 'string' ? body.method : '';

    if (method && !['bkash', 'nagad', 'rocket'].includes(method)) {
      res.status(400).json({ valid: false, error: 'Invalid payment method' });
      return;
    }
    if (senderNumber && !/^01[3-9]\d{8}$/.test(senderNumber)) {
      res.status(400).json({ valid: false, error: 'Invalid Bangladesh mobile number format (01XXXXXXXXX)' });
      return;
    }
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(txId)) {
      res.status(400).json({ valid: false, error: 'Transaction ID must be 6-64 alphanumeric characters' });
      return;
    }

    try {
      const resp = await fetch(firestoreDocUrl('txRegistry', txId), {
        headers: { Authorization: `Bearer ${user.token}` },
      });
      if (resp.ok || resp.status === 403) {
        res.status(409).json({ valid: false, duplicate: true, error: 'Duplicate Transaction ID detected' });
        return;
      }
    } catch {
      // Fallback to client batch check
    }
    res.json({ valid: true, duplicate: false, normalizedTxId: txId });
  });

  // Server-authorized admin order payment verification (authoritative DB checks + idempotency + fresh auth)
  app.post('/api/admin/verify-payment', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    if (!isFreshAdminAuth(user, 900)) {
      res.status(401).json({
        error: 'Recent owner Google re-authentication required to verify payments.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }

    const body = req.body as {
      paymentId?: string;
      orderId?: string;
      decision?: 'approve' | 'reject';
      rejectionReason?: string;
      nextOrderStatus?: 'Paid' | 'Payment Approved' | 'Processing';
    };

    const paymentId = typeof body.paymentId === 'string' ? body.paymentId.trim() : '';
    const decision = body.decision;
    const rejectionReason = typeof body.rejectionReason === 'string' ? body.rejectionReason.trim().slice(0, 400) : '';

    if (!paymentId || (decision !== 'approve' && decision !== 'reject')) {
      res.status(400).json({ error: 'Missing required payment verification fields' });
      return;
    }
    if (decision === 'reject' && rejectionReason.length < 3) {
      res.status(400).json({ error: 'Rejection reason is required' });
      return;
    }

    const payDoc = await getFirestoreDoc('payments', paymentId, user.token);
    if (!payDoc.ok || !payDoc.fields) {
      res.status(404).json({ error: 'Payment record not found' });
      return;
    }
    const currentPayStatus = fromFirestoreString(payDoc.fields.status);
    if (currentPayStatus !== 'Verification Pending') {
      res.status(409).json({ error: `Payment has already been processed (${currentPayStatus}).` });
      return;
    }

    const orderId = fromFirestoreString(payDoc.fields.orderId) || (typeof body.orderId === 'string' ? body.orderId.trim() : '');
    if (!orderId) {
      res.status(400).json({ error: 'Payment record has no linked orderId' });
      return;
    }
    const orderDoc = await getFirestoreDoc('orders', orderId, user.token);
    if (!orderDoc.ok || !orderDoc.fields) {
      res.status(404).json({ error: 'Linked order record not found' });
      return;
    }

    const customerId = fromFirestoreString(orderDoc.fields.customerId);
    const payCustomerId = fromFirestoreString(payDoc.fields.customerId);
    if (!customerId || (payCustomerId && payCustomerId !== customerId)) {
      res.status(400).json({ error: 'Customer ownership mismatch between payment and order' });
      return;
    }

    const payAmountBdt = fromFirestoreNumber(payDoc.fields.amountBdt);
    const orderTotalBdt = fromFirestoreNumber(orderDoc.fields.totalPriceBdt);
    if (decision === 'approve' && payAmountBdt < orderTotalBdt) {
      res.status(400).json({ error: `Payment amount (৳${payAmountBdt}) is less than order total (৳${orderTotalBdt}).` });
      return;
    }

    const orderNumber = fromFirestoreString(orderDoc.fields.orderNumber) || orderId;
    const now = new Date();
    const paymentStatus = decision === 'approve' ? 'Approved' : 'Rejected';
    const orderStatus = decision === 'approve' ? (body.nextOrderStatus || 'Processing') : 'Rejected';

    const payPatch = await patchFirestoreDoc(
      'payments',
      paymentId,
      {
        status: paymentStatus,
        rejectionReason: decision === 'reject' ? rejectionReason : '',
        verifiedBy: user.uid,
        verifiedAt: now,
        updatedAt: now,
      },
      user.token
    );
    if (!payPatch.ok) {
      res.status(payPatch.status).json({ error: 'Failed to update payment record', details: payPatch.body });
      return;
    }

    const orderPatch = await patchFirestoreDoc(
      'orders',
      orderId,
      {
        status: orderStatus,
        rejectionReason: decision === 'reject' ? rejectionReason : '',
        updatedAt: now,
      },
      user.token
    );
    if (!orderPatch.ok) {
      res.status(orderPatch.status).json({ error: 'Failed to update order status', details: orderPatch.body });
      return;
    }

    const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'notifications',
      notifId,
      {
        id: notifId,
        userId: customerId,
        titleBn: decision === 'approve' ? 'পেমেন্ট অনুমোদিত হয়েছে' : 'পেমেন্ট প্রত্যাখ্যাত হয়েছে',
        titleEn: decision === 'approve' ? 'Payment Approved' : 'Payment Rejected',
        messageBn:
          decision === 'approve'
            ? `অর্ডার #${orderNumber} এর পেমেন্ট যাচাই সম্পন্ন হয়েছে (${orderStatus})।`
            : `অর্ডার #${orderNumber} এর পেমেন্ট প্রত্যাখ্যাত হয়েছে। কারণ: ${rejectionReason}`,
        messageEn:
          decision === 'approve'
            ? `Payment for order #${orderNumber} has been verified (${orderStatus}).`
            : `Payment for order #${orderNumber} was rejected. Reason: ${rejectionReason}`,
        type: 'payment',
        read: false,
        createdAt: now,
      },
      user.token
    );

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: decision === 'approve' ? 'PAYMENT_APPROVED' : 'PAYMENT_REJECTED',
        targetCollection: 'payments',
        targetId: paymentId,
        summary: `${decision === 'approve' ? 'Approved' : 'Rejected'} payment ${paymentId} (৳${payAmountBdt}) for order ${orderNumber}${rejectionReason ? ` (${rejectionReason})` : ''}`,
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true, paymentStatus, orderStatus });
  });

  // Server-authorized admin Add Money verification (authoritative DB read + idempotency + fresh auth)
  app.post('/api/admin/verify-add-money', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    if (!isFreshAdminAuth(user, 900)) {
      res.status(401).json({
        error: 'Recent owner Google re-authentication required to credit wallet deposits.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }

    const body = req.body as {
      walletTxId?: string;
      decision?: 'approve' | 'reject';
      rejectionReason?: string;
    };

    const walletTxId = typeof body.walletTxId === 'string' ? body.walletTxId.trim() : '';
    const decision = body.decision;
    const rejectionReason = typeof body.rejectionReason === 'string' ? body.rejectionReason.trim().slice(0, 400) : '';

    if (!walletTxId || (decision !== 'approve' && decision !== 'reject')) {
      res.status(400).json({ error: 'Invalid add-money verification payload' });
      return;
    }
    if (decision === 'reject' && rejectionReason.length < 3) {
      res.status(400).json({ error: 'Rejection reason is required' });
      return;
    }

    const txDoc = await getFirestoreDoc('walletTransactions', walletTxId, user.token);
    if (!txDoc.ok || !txDoc.fields) {
      res.status(404).json({ error: 'Wallet deposit transaction not found' });
      return;
    }
    const txType = fromFirestoreString(txDoc.fields.type);
    const currentStatus = fromFirestoreString(txDoc.fields.status);
    if (txType !== 'deposit') {
      res.status(400).json({ error: 'Transaction is not a deposit record' });
      return;
    }
    if (currentStatus !== 'Verification Pending') {
      res.status(409).json({ error: `Deposit has already been processed (${currentStatus}).` });
      return;
    }

    const customerId = fromFirestoreString(txDoc.fields.userId);
    const amountBdt = fromFirestoreNumber(txDoc.fields.amountBdt);
    if (!customerId || amountBdt <= 0) {
      res.status(400).json({ error: 'Invalid deposit owner or amount in database record' });
      return;
    }

    const now = new Date();
    const txStatus = decision === 'approve' ? 'Approved' : 'Rejected';

    const txPatch = await patchFirestoreDoc(
      'walletTransactions',
      walletTxId,
      {
        status: txStatus,
        rejectionReason: decision === 'reject' ? rejectionReason : '',
        updatedAt: now,
      },
      user.token
    );
    if (!txPatch.ok) {
      res.status(txPatch.status).json({ error: 'Failed to update wallet transaction', details: txPatch.body });
      return;
    }

    if (decision === 'approve') {
      const existingWallet = await getFirestoreDoc('walletAccounts', customerId, user.token);
      if (existingWallet.ok && existingWallet.fields) {
        const curAvail = fromFirestoreNumber(existingWallet.fields.availableBalanceBdt);
        const curAdded = fromFirestoreNumber(existingWallet.fields.totalAddedBdt);
        await patchFirestoreDoc(
          'walletAccounts',
          customerId,
          {
            availableBalanceBdt: curAvail + amountBdt,
            totalAddedBdt: curAdded + amountBdt,
            lastTxId: walletTxId,
            updatedAt: now,
          },
          user.token
        );
      } else {
        await createFirestoreDoc(
          'walletAccounts',
          customerId,
          {
            uid: customerId,
            availableBalanceBdt: amountBdt,
            promotionalCreditsBdt: 0,
            totalAddedBdt: amountBdt,
            totalSpentBdt: 0,
            lastTxId: walletTxId,
            updatedAt: now,
          },
          user.token
        );
      }
    }

    // Sync matching payment record in /payments so Complete Payment History stays accurate
    try {
      const linkedPayments = await runFirestoreEqualQuery('payments', 'orderId', walletTxId, user.token, 5);
      for (const lp of linkedPayments) {
        await patchFirestoreDoc(
          'payments',
          lp.id,
          {
            status: txStatus,
            rejectionReason: decision === 'reject' ? rejectionReason : '',
            verifiedBy: user.uid,
            verifiedAt: now,
            updatedAt: now,
          },
          user.token
        );
      }
    } catch {
      // Non-fatal sync
    }

    const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'notifications',
      notifId,
      {
        id: notifId,
        userId: customerId,
        titleBn: decision === 'approve' ? 'ওয়ালেট অ্যাড মানি অনুমোদিত' : 'ওয়ালেট অ্যাড মানি প্রত্যাখ্যাত',
        titleEn: decision === 'approve' ? 'Wallet Deposit Approved' : 'Wallet Deposit Rejected',
        messageBn:
          decision === 'approve'
            ? `আপনার ওয়ালেটে ৳${amountBdt} যোগ করা হয়েছে।`
            : `৳${amountBdt} অ্যাড মানি অনুরোধ প্রত্যাখ্যাত হয়েছে। কারণ: ${rejectionReason}`,
        messageEn:
          decision === 'approve'
            ? `৳${amountBdt} has been credited to your DIGITAL HUB wallet.`
            : `Your ৳${amountBdt} Add Money request was rejected. Reason: ${rejectionReason}`,
        type: 'wallet',
        read: false,
        createdAt: now,
      },
      user.token
    );

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: decision === 'approve' ? 'ADD_MONEY_APPROVED' : 'ADD_MONEY_REJECTED',
        targetCollection: 'walletTransactions',
        targetId: walletTxId,
        summary: `${decision === 'approve' ? 'Credited' : 'Rejected'} ৳${amountBdt} for user ${customerId}`,
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true, txStatus });
  });

  // Server-side deterministic role session verification
  app.post('/api/auth/session', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Authentication token required' });
      return;
    }
    const adminRole = await getAdminRole(user);
    const role: 'admin' | 'user' = adminRole !== 'user' ? 'admin' : 'user';
    let accountStatus: 'active' | 'suspended' = 'active';
    try {
      const profileDoc = await getFirestoreDoc('users', user.uid, user.token);
      if (profileDoc.ok && profileDoc.fields) {
        const st = fromFirestoreString(profileDoc.fields.status);
        if (st === 'suspended') accountStatus = 'suspended';
      }
    } catch {
      // Non-fatal if profile doc not yet initialized
    }
    res.json({
      ok: true,
      uid: user.uid,
      email: user.email,
      emailVerified: user.emailVerified,
      role,
      adminRole,
      status: accountStatus,
      authTime: user.authTime,
      freshAuth: isFreshAdminAuth(user, 900),
    });
  });

  // Owner-only user block/unblock with fresh re-authentication enforcement
  app.post('/api/admin/update-user-status', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    if (!isFreshAdminAuth(user, 900)) {
      res.status(401).json({
        error: 'Recent owner Google re-authentication required before modifying user access.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }

    const body = req.body as { targetUid?: string; status?: 'active' | 'suspended'; reason?: string };
    const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim() : '';
    const nextStatus = body.status === 'active' || body.status === 'suspended' ? body.status : null;
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 200) : '';

    if (!targetUid || !nextStatus) {
      res.status(400).json({ error: 'targetUid and valid status required' });
      return;
    }
    if (targetUid === user.uid && nextStatus === 'suspended') {
      res.status(400).json({ error: 'Cannot suspend the owner admin account.' });
      return;
    }

    const now = new Date();
    const patchRes = await patchFirestoreDoc(
      'users',
      targetUid,
      { status: nextStatus, updatedAt: now },
      user.token
    );
    if (!patchRes.ok) {
      res.status(patchRes.status).json({ error: 'Failed to update user status', details: patchRes.body });
      return;
    }

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: nextStatus === 'suspended' ? 'USER_BLOCKED' : 'USER_UNBLOCKED',
        targetCollection: 'users',
        targetId: targetUid,
        summary: `${nextStatus === 'suspended' ? 'Blocked' : 'Unblocked'} user ${targetUid}${reason ? ` (${reason})` : ''}`,
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true, targetUid, status: nextStatus });
  });

  // Owner-only withdrawal approval or atomic rejection + refund
  app.post('/api/admin/process-withdrawal', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    if (!isFreshAdminAuth(user, 900)) {
      res.status(401).json({
        error: 'Recent owner Google re-authentication required for withdrawal payouts.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }

    const body = req.body as {
      withdrawalId?: string;
      decision?: 'approve' | 'reject';
      payoutReference?: string;
      adminNote?: string;
      rejectionReason?: string;
    };

    const withdrawalId = typeof body.withdrawalId === 'string' ? body.withdrawalId.trim() : '';
    const decision = body.decision;
    const payoutReference = typeof body.payoutReference === 'string' ? body.payoutReference.trim().slice(0, 120) : '';
    const adminNote = typeof body.adminNote === 'string' ? body.adminNote.trim().slice(0, 400) : '';
    const rejectionReason = typeof body.rejectionReason === 'string' ? body.rejectionReason.trim().slice(0, 400) : '';

    if (!withdrawalId || (decision !== 'approve' && decision !== 'reject')) {
      res.status(400).json({ error: 'Invalid withdrawal payload' });
      return;
    }
    if (decision === 'approve' && payoutReference.length < 3) {
      res.status(400).json({ error: 'Payout reference / TxID is required when approving a withdrawal.' });
      return;
    }
    if (decision === 'reject' && rejectionReason.length < 3) {
      res.status(400).json({ error: 'Rejection reason is required.' });
      return;
    }

    const wDoc = await getFirestoreDoc('withdrawals', withdrawalId, user.token);
    if (!wDoc.ok || !wDoc.fields) {
      res.status(404).json({ error: 'Withdrawal request not found' });
      return;
    }
    const currentStatus = fromFirestoreString(wDoc.fields.status);
    if (currentStatus !== 'Pending') {
      res.status(409).json({ error: `Withdrawal has already been ${currentStatus}.` });
      return;
    }

    const targetUid = fromFirestoreString(wDoc.fields.userId);
    const targetEmail = fromFirestoreString(wDoc.fields.userEmail);
    const amountBdt = fromFirestoreNumber(wDoc.fields.amountBdt);
    const method = fromFirestoreString(wDoc.fields.method) || 'bkash';
    const now = new Date();
    const nextStatus = decision === 'approve' ? 'Approved' : 'Rejected';

    const wPatch = await patchFirestoreDoc(
      'withdrawals',
      withdrawalId,
      {
        status: nextStatus,
        payoutReference: decision === 'approve' ? payoutReference : '',
        adminNote,
        rejectionReason: decision === 'reject' ? rejectionReason : '',
        processedBy: user.uid,
        updatedAt: now,
      },
      user.token
    );
    if (!wPatch.ok) {
      res.status(wPatch.status).json({ error: 'Failed to update withdrawal record', details: wPatch.body });
      return;
    }

    await patchFirestoreDoc(
      'walletTransactions',
      withdrawalId,
      {
        status: nextStatus,
        rejectionReason: decision === 'reject' ? rejectionReason : '',
        note: decision === 'approve' ? `Payout Ref: ${payoutReference}` : `Withdrawal rejected: ${rejectionReason}`,
        updatedAt: now,
      },
      user.token
    );

    if (decision === 'reject' && targetUid && amountBdt > 0) {
      const existingWallet = await getFirestoreDoc('walletAccounts', targetUid, user.token);
      const refundTxId = `wref_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const curAvail = existingWallet.ok && existingWallet.fields
        ? fromFirestoreNumber(existingWallet.fields.availableBalanceBdt)
        : 0;
      if (existingWallet.ok && existingWallet.fields) {
        await patchFirestoreDoc(
          'walletAccounts',
          targetUid,
          {
            availableBalanceBdt: curAvail + amountBdt,
            lastTxId: refundTxId,
            updatedAt: now,
          },
          user.token
        );
      }
      await createFirestoreDoc(
        'walletTransactions',
        refundTxId,
        {
          id: refundTxId,
          userId: targetUid,
          userEmail: targetEmail,
          type: 'withdrawal_refund',
          method: 'system',
          transactionId: refundTxId,
          amountBdt,
          status: 'Approved',
          note: `Refund for rejected withdrawal (${withdrawalId})`,
          createdAt: now,
          updatedAt: now,
        },
        user.token
      );
    }

    const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'notifications',
      notifId,
      {
        id: notifId,
        userId: targetUid,
        titleBn: decision === 'approve' ? 'উইথড্রয়াল সম্পন্ন হয়েছে' : 'উইথড্রয়াল প্রত্যাখ্যাত ও ব্যালেন্স ফেরত',
        titleEn: decision === 'approve' ? 'Withdrawal Approved & Paid' : 'Withdrawal Rejected & Refunded',
        messageBn:
          decision === 'approve'
            ? `আপনার ৳${amountBdt} (${method.toUpperCase()}) উইথড্রয়াল পাঠানো হয়েছে। রেফারেন্স: ${payoutReference}`
            : `আপনার ৳${amountBdt} উইথড্রয়াল বাতিল হয়ে ওয়ালেটে ফেরত এসেছে। কারণ: ${rejectionReason}`,
        messageEn:
          decision === 'approve'
            ? `Your ৳${amountBdt} (${method.toUpperCase()}) withdrawal was paid. Ref: ${payoutReference}`
            : `Your ৳${amountBdt} withdrawal was rejected and refunded to your wallet. Reason: ${rejectionReason}`,
        type: 'wallet',
        read: false,
        createdAt: now,
      },
      user.token
    );

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: decision === 'approve' ? 'WITHDRAWAL_APPROVED' : 'WITHDRAWAL_REJECTED_REFUNDED',
        targetCollection: 'withdrawals',
        targetId: withdrawalId,
        summary: `${decision === 'approve' ? `Paid ৳${amountBdt} via ${method} (Ref: ${payoutReference})` : `Rejected & refunded ৳${amountBdt} (${rejectionReason})`} for ${targetEmail || targetUid}`,
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true, status: nextStatus });
  });

  // Owner-only order completion with idempotent Cashback & Referral Commission settlement
  app.post('/api/admin/complete-order-rewards', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }

    const body = req.body as { orderId?: string; adminNote?: string };
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    const adminNote = typeof body.adminNote === 'string' ? body.adminNote.trim().slice(0, 500) : undefined;
    if (!orderId) {
      res.status(400).json({ error: 'orderId required' });
      return;
    }

    const orderDoc = await getFirestoreDoc('orders', orderId, user.token);
    if (!orderDoc.ok || !orderDoc.fields) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const fields = orderDoc.fields;
    const currentStatus = fromFirestoreString(fields.status);
    if (currentStatus === 'Rejected' || currentStatus === 'Cancelled') {
      res.status(400).json({ error: `Cannot complete a ${currentStatus} order.` });
      return;
    }

    const customerId = fromFirestoreString(fields.customerId);
    const customerEmail = fromFirestoreString(fields.customerEmail);
    const orderNumber = fromFirestoreString(fields.orderNumber) || orderId;
    const totalPriceBdt = fromFirestoreNumber(fields.totalPriceBdt);
    const alreadyCashback = fromFirestoreBool(fields.cashbackAwarded, false);
    const alreadyReferral = fromFirestoreBool(fields.referralProcessed, false);
    const now = new Date();

    const settingsDoc = await getFirestoreDoc('siteSettings', 'global', user.token);
    const sf = settingsDoc.fields || {};
    const cashbackEnabled = fromFirestoreBool(sf.cashbackEnabled, true);
    const cashbackPercent = fromFirestoreNumber(sf.cashbackPercent) || 2;
    const cashbackMinOrder = fromFirestoreNumber(sf.cashbackMinOrderBdt) || 100;
    const cashbackMaxPerOrder = fromFirestoreNumber(sf.cashbackMaxPerOrderBdt) || 100;

    const referralEnabled = fromFirestoreBool(sf.referralEnabled, true);
    const referralBonusBdt = fromFirestoreNumber(sf.referralBonusBdt) || 50;
    const referralMinOrder = fromFirestoreNumber(sf.referralMinOrderBdt) || 100;

    let awardedCashbackBdt = 0;
    let awardedReferralBdt = 0;

    // 1. Idempotent Cashback credit
    if (cashbackEnabled && !alreadyCashback && totalPriceBdt >= cashbackMinOrder && cashbackPercent > 0 && customerId) {
      const rawCb = Math.round((totalPriceBdt * cashbackPercent) / 100);
      awardedCashbackBdt = cashbackMaxPerOrder > 0 ? Math.min(cashbackMaxPerOrder, rawCb) : rawCb;
      if (awardedCashbackBdt > 0) {
        const cbTxId = `cb_${orderId}`.slice(0, 64);
        const existingCbTx = await getFirestoreDoc('walletTransactions', cbTxId, user.token);
        if (!existingCbTx.ok) {
          const custWallet = await getFirestoreDoc('walletAccounts', customerId, user.token);
          const curAvail = custWallet.ok && custWallet.fields
            ? fromFirestoreNumber(custWallet.fields.availableBalanceBdt)
            : 0;
          const curAdded = custWallet.ok && custWallet.fields
            ? fromFirestoreNumber(custWallet.fields.totalAddedBdt)
            : 0;
          if (custWallet.ok && custWallet.fields) {
            await patchFirestoreDoc(
              'walletAccounts',
              customerId,
              {
                availableBalanceBdt: curAvail + awardedCashbackBdt,
                totalAddedBdt: curAdded + awardedCashbackBdt,
                lastTxId: cbTxId,
                updatedAt: now,
              },
              user.token
            );
          } else {
            await createFirestoreDoc(
              'walletAccounts',
              customerId,
              {
                uid: customerId,
                availableBalanceBdt: awardedCashbackBdt,
                promotionalCreditsBdt: 0,
                totalAddedBdt: awardedCashbackBdt,
                totalSpentBdt: 0,
                lastTxId: cbTxId,
                updatedAt: now,
              },
              user.token
            );
          }
          await createFirestoreDoc(
            'walletTransactions',
            cbTxId,
            {
              id: cbTxId,
              userId: customerId,
              userEmail: customerEmail,
              type: 'cashback',
              method: 'system',
              transactionId: cbTxId,
              amountBdt: awardedCashbackBdt,
              status: 'Approved',
              note: `Cashback (${cashbackPercent}%) on Order #${orderNumber}`,
              createdAt: now,
              updatedAt: now,
            },
            user.token
          );
          const cbNotifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          await createFirestoreDoc(
            'notifications',
            cbNotifId,
            {
              id: cbNotifId,
              userId: customerId,
              titleBn: 'ক্যাশব্যাক যোগ হয়েছে!',
              titleEn: 'Cashback Credited!',
              messageBn: `অর্ডার #${orderNumber} সম্পন্ন হওয়ায় ৳${awardedCashbackBdt} ক্যাশব্যাক আপনার ওয়ালেটে যোগ হয়েছে।`,
              messageEn: `৳${awardedCashbackBdt} cashback from Order #${orderNumber} has been credited to your wallet.`,
              type: 'wallet',
              read: false,
              createdAt: now,
            },
            user.token
          );
        } else {
          awardedCashbackBdt = 0;
        }
      }
    }

    // 2. Idempotent First-Order Referral Commission (updates existing pending/qualified referral or creates if absent)
    if (referralEnabled && !alreadyReferral && totalPriceBdt >= referralMinOrder && referralBonusBdt > 0 && customerId) {
      const custProfile = await getFirestoreDoc('users', customerId, user.token);
      const referredByCode = custProfile.ok && custProfile.fields
        ? fromFirestoreString(custProfile.fields.referredBy).trim()
        : '';
      if (referredByCode) {
        const refId = `ref_${customerId}`.slice(0, 64);
        const existingRefDoc = await getFirestoreDoc('referrals', refId, user.token);
        const existingStatus = existingRefDoc.ok && existingRefDoc.fields
          ? fromFirestoreString(existingRefDoc.fields.status)
          : '';
        if (existingStatus !== 'credited' && existingStatus !== 'revoked' && existingStatus !== 'flagged') {
          let referrerId = existingRefDoc.ok && existingRefDoc.fields
            ? fromFirestoreString(existingRefDoc.fields.referrerId)
            : '';
          let referrerEmail = '';
          if (!referrerId) {
            const referrerMatches = await runFirestoreEqualQuery(
              'users',
              'referralCode',
              referredByCode,
              user.token,
              2
            );
            const referrer = referrerMatches[0];
            if (referrer && referrer.id && fromFirestoreString(referrer.fields.status) === 'active') {
              referrerId = referrer.id;
              referrerEmail = fromFirestoreString(referrer.fields.email);
            }
          } else {
            const rDoc = await getFirestoreDoc('users', referrerId, user.token);
            if (rDoc.ok && rDoc.fields) {
              referrerEmail = fromFirestoreString(rDoc.fields.email);
            }
          }

          if (referrerId && referrerId !== customerId) {
            const refTxId = `rtx_${customerId}`.slice(0, 64);
            const invitedTxId = `ritx_${customerId}`.slice(0, 64);
            const invitedRewardBdt = Math.max(0, fromFirestoreNumber(sf.invitedUserRewardBdt));
            awardedReferralBdt = referralBonusBdt;
            if (existingRefDoc.ok) {
              await patchFirestoreDoc(
                'referrals',
                refId,
                {
                  rewardAmountBdt: awardedReferralBdt,
                  invitedRewardBdt,
                  status: 'credited',
                  updatedAt: now,
                },
                user.token
              );
            } else {
              await createFirestoreDoc(
                'referrals',
                refId,
                {
                  id: refId,
                  referrerId,
                  referredUserId: customerId,
                  referredEmail: customerEmail,
                  referralCode: referredByCode,
                  rewardAmountBdt: awardedReferralBdt,
                  invitedRewardBdt,
                  eligibilityRule: fromFirestoreString(sf.referralEligibility) || 'first_paid_order',
                  status: 'credited',
                  createdAt: now,
                  updatedAt: now,
                },
                user.token
              );
            }
            const rewId = `rew_${customerId}`.slice(0, 64);
            const existingRew = await getFirestoreDoc('referralRewards', rewId, user.token);
            if (!existingRew.ok) {
              await createFirestoreDoc(
                'referralRewards',
                rewId,
                {
                  id: rewId,
                  referralId: refId,
                  userId: referrerId,
                  amountBdt: awardedReferralBdt,
                  status: 'credited',
                  createdAt: now,
                },
                user.token
              );
            }
            const existingRefTx = await getFirestoreDoc('walletTransactions', refTxId, user.token);
            if (!existingRefTx.ok) {
              const refWallet = await getFirestoreDoc('walletAccounts', referrerId, user.token);
              const rAvail = refWallet.ok && refWallet.fields
                ? fromFirestoreNumber(refWallet.fields.availableBalanceBdt)
                : 0;
              const rAdded = refWallet.ok && refWallet.fields
                ? fromFirestoreNumber(refWallet.fields.totalAddedBdt)
                : 0;
              if (refWallet.ok && refWallet.fields) {
                await patchFirestoreDoc(
                  'walletAccounts',
                  referrerId,
                  {
                    availableBalanceBdt: rAvail + awardedReferralBdt,
                    totalAddedBdt: rAdded + awardedReferralBdt,
                    lastTxId: refTxId,
                    updatedAt: now,
                  },
                  user.token
                );
              } else {
                await createFirestoreDoc(
                  'walletAccounts',
                  referrerId,
                  {
                    uid: referrerId,
                    availableBalanceBdt: awardedReferralBdt,
                    promotionalCreditsBdt: 0,
                    totalAddedBdt: awardedReferralBdt,
                    totalSpentBdt: 0,
                    lastTxId: refTxId,
                    updatedAt: now,
                  },
                  user.token
                );
              }
              await createFirestoreDoc(
                'walletTransactions',
                refTxId,
                {
                  id: refTxId,
                  userId: referrerId,
                  userEmail: referrerEmail,
                  type: 'referral',
                  method: 'system',
                  transactionId: refTxId,
                  amountBdt: awardedReferralBdt,
                  status: 'Approved',
                  note: `Referral commission for invited user order #${orderNumber}`,
                  createdAt: now,
                  updatedAt: now,
                },
                user.token
              );
              const refNotifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
              await createFirestoreDoc(
                'notifications',
                refNotifId,
                {
                  id: refNotifId,
                  userId: referrerId,
                  titleBn: 'রেফারেল কমিশন যোগ হয়েছে!',
                  titleEn: 'Referral Commission Credited!',
                  messageBn: `আপনার আমন্ত্রিত কাস্টমারের প্রথম অর্ডার সম্পন্ন হওয়ায় ৳${awardedReferralBdt} ওয়ালেটে যোগ হয়েছে।`,
                  messageEn: `৳${awardedReferralBdt} referral commission has been credited to your wallet for your invited customer's completed order.`,
                  type: 'promo',
                  read: false,
                  createdAt: now,
                },
                user.token
              );
            }

            if (invitedRewardBdt > 0) {
              const existingInvTx = await getFirestoreDoc('walletTransactions', invitedTxId, user.token);
              if (!existingInvTx.ok) {
                const invWallet = await getFirestoreDoc('walletAccounts', customerId, user.token);
                const iAvail = invWallet.ok && invWallet.fields
                  ? fromFirestoreNumber(invWallet.fields.availableBalanceBdt)
                  : 0;
                const iAdded = invWallet.ok && invWallet.fields
                  ? fromFirestoreNumber(invWallet.fields.totalAddedBdt)
                  : 0;
                if (invWallet.ok && invWallet.fields) {
                  await patchFirestoreDoc(
                    'walletAccounts',
                    customerId,
                    {
                      availableBalanceBdt: iAvail + invitedRewardBdt,
                      totalAddedBdt: iAdded + invitedRewardBdt,
                      lastTxId: invitedTxId,
                      updatedAt: now,
                    },
                    user.token
                  );
                } else {
                  await createFirestoreDoc(
                    'walletAccounts',
                    customerId,
                    {
                      uid: customerId,
                      availableBalanceBdt: invitedRewardBdt,
                      promotionalCreditsBdt: 0,
                      totalAddedBdt: invitedRewardBdt,
                      totalSpentBdt: 0,
                      lastTxId: invitedTxId,
                      updatedAt: now,
                    },
                    user.token
                  );
                }
                await createFirestoreDoc(
                  'walletTransactions',
                  invitedTxId,
                  {
                    id: invitedTxId,
                    userId: customerId,
                    userEmail: customerEmail,
                    type: 'referral',
                    method: 'system',
                    transactionId: invitedTxId,
                    amountBdt: invitedRewardBdt,
                    status: 'Approved',
                    note: `Invited-user referral welcome bonus (Order #${orderNumber})`,
                    createdAt: now,
                    updatedAt: now,
                  },
                  user.token
                );
              }
            }
          }
        }
      }
    }

    // 3. Patch Order Completed + reward flags
    const orderPatchFields: Record<string, unknown> = {
      status: 'Completed',
      cashbackAwarded: alreadyCashback || awardedCashbackBdt > 0,
      referralProcessed: true,
      updatedAt: now,
    };
    if (awardedCashbackBdt > 0) {
      orderPatchFields.cashbackBdt = awardedCashbackBdt;
    }
    if (adminNote !== undefined) {
      orderPatchFields.adminNote = adminNote;
    }
    await patchFirestoreDoc('orders', orderId, orderPatchFields, user.token);

    if (currentStatus !== 'Completed') {
      const ordNotifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await createFirestoreDoc(
        'notifications',
        ordNotifId,
        {
          id: ordNotifId,
          userId: customerId,
          titleBn: `অর্ডার #${orderNumber} সম্পন্ন হয়েছে`,
          titleEn: `Order #${orderNumber} Completed`,
          messageBn: `আপনার অর্ডার #${orderNumber} ডেলিভারি সম্পন্ন হয়েছে।${adminNote ? ` (${adminNote})` : ''}`,
          messageEn: `Your order #${orderNumber} has been completed.${adminNote ? ` (${adminNote})` : ''}`,
          type: 'order',
          read: false,
          createdAt: now,
        },
        user.token
      );
    }

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: 'ORDER_COMPLETED',
        targetCollection: 'orders',
        targetId: orderId,
        summary: `Completed order #${orderNumber}. Cashback: ৳${awardedCashbackBdt}, Referral: ৳${awardedReferralBdt}`,
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true, status: 'Completed', awardedCashbackBdt, awardedReferralBdt });
  });

  // Owner-only order cancellation with automatic idempotent wallet refund
  app.post('/api/admin/refund-cancel-order', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    if (!isFreshAdminAuth(user, 900)) {
      res.status(401).json({
        error: 'Recent owner Google re-authentication required to cancel and refund orders.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }

    const body = req.body as {
      orderId?: string;
      rejectionReason?: string;
      refundToWallet?: boolean;
    };
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    const rejectionReason =
      typeof body.rejectionReason === 'string' ? body.rejectionReason.trim().slice(0, 400) : '';
    if (!orderId) {
      res.status(400).json({ error: 'orderId required' });
      return;
    }

    const orderDoc = await getFirestoreDoc('orders', orderId, user.token);
    if (!orderDoc.ok || !orderDoc.fields) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }

    const fields = orderDoc.fields;
    const currentStatus = fromFirestoreString(fields.status);
    if (currentStatus === 'Cancelled') {
      res.status(409).json({ error: 'Order is already Cancelled.' });
      return;
    }

    const customerId = fromFirestoreString(fields.customerId);
    const customerEmail = fromFirestoreString(fields.customerEmail);
    const orderNumber = fromFirestoreString(fields.orderNumber) || orderId;
    const totalPriceBdt = fromFirestoreNumber(fields.totalPriceBdt);
    const paymentMethod = fromFirestoreString(fields.paymentMethod);
    const cleanReason = rejectionReason || 'Cancelled by administrator';
    const now = new Date();

    const eligibleForRefund =
      totalPriceBdt > 0 &&
      Boolean(customerId) &&
      (paymentMethod === 'wallet' ||
        (Boolean(body.refundToWallet) &&
          ['Paid', 'Payment Approved', 'Processing', 'Completed'].includes(currentStatus)));

    let refundedBdt = 0;
    if (eligibleForRefund) {
      const refTxId = `ordref_${orderId}`.slice(0, 64);
      const existingRefTx = await getFirestoreDoc('walletTransactions', refTxId, user.token);
      if (!existingRefTx.ok) {
        const custWallet = await getFirestoreDoc('walletAccounts', customerId, user.token);
        const curAvail =
          custWallet.ok && custWallet.fields
            ? fromFirestoreNumber(custWallet.fields.availableBalanceBdt)
            : 0;
        if (custWallet.ok && custWallet.fields) {
          await patchFirestoreDoc(
            'walletAccounts',
            customerId,
            {
              availableBalanceBdt: curAvail + totalPriceBdt,
              lastTxId: refTxId,
              updatedAt: now,
            },
            user.token
          );
        } else {
          await createFirestoreDoc(
            'walletAccounts',
            customerId,
            {
              uid: customerId,
              availableBalanceBdt: totalPriceBdt,
              promotionalCreditsBdt: 0,
              totalAddedBdt: 0,
              totalSpentBdt: 0,
              lastTxId: refTxId,
              updatedAt: now,
            },
            user.token
          );
        }

        await createFirestoreDoc(
          'walletTransactions',
          refTxId,
          {
            id: refTxId,
            userId: customerId,
            userEmail: customerEmail,
            type: 'refund',
            method: 'system',
            transactionId: refTxId,
            amountBdt: totalPriceBdt,
            status: 'Approved',
            note: `Order #${orderNumber} cancellation refund (${cleanReason})`.slice(0, 400),
            createdAt: now,
            updatedAt: now,
          },
          user.token
        );
        refundedBdt = totalPriceBdt;
      }
    }

    const patchRes = await patchFirestoreDoc(
      'orders',
      orderId,
      {
        status: 'Cancelled',
        rejectionReason: cleanReason,
        updatedAt: now,
      },
      user.token
    );
    if (!patchRes.ok) {
      res.status(patchRes.status).json({ error: 'Failed to cancel order', details: patchRes.body });
      return;
    }

    if (customerId) {
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await createFirestoreDoc(
        'notifications',
        notifId,
        {
          id: notifId,
          userId: customerId,
          titleBn:
            refundedBdt > 0
              ? `অর্ডার #${orderNumber} বাতিল ও ৳${refundedBdt} রিফান্ড হয়েছে`
              : `অর্ডার #${orderNumber} বাতিল হয়েছে`,
          titleEn:
            refundedBdt > 0
              ? `Order #${orderNumber} Cancelled & ৳${refundedBdt} Refunded`
              : `Order #${orderNumber} Cancelled`,
          messageBn:
            refundedBdt > 0
              ? `অর্ডার #${orderNumber} বাতিল করা হয়েছে (${cleanReason}) এবং ৳${refundedBdt} আপনার ওয়ালেটে রিফান্ড করা হয়েছে।`
              : `অর্ডার #${orderNumber} বাতিল করা হয়েছে। কারণ: ${cleanReason}`,
          messageEn:
            refundedBdt > 0
              ? `Order #${orderNumber} was cancelled (${cleanReason}) and ৳${refundedBdt} has been refunded to your wallet.`
              : `Order #${orderNumber} was cancelled. Reason: ${cleanReason}`,
          type: refundedBdt > 0 ? 'wallet' : 'order',
          read: false,
          createdAt: now,
        },
        user.token
      );
    }

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: refundedBdt > 0 ? 'ORDER_CANCELLED_REFUNDED' : 'ORDER_CANCELLED',
        targetCollection: 'orders',
        targetId: orderId,
        summary: `Cancelled order #${orderNumber}. Refunded: ৳${refundedBdt}. Reason: ${cleanReason}`.slice(0, 500),
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true, status: 'Cancelled', refundedBdt });
  });

  // Owner-only global announcement broadcast
  app.post('/api/admin/broadcast-announcement', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    if (!isFreshAdminAuth(user, 900)) {
      res.status(401).json({
        error: 'Recent owner Google re-authentication required to broadcast announcements.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }

    const body = req.body as {
      titleBn?: string;
      titleEn?: string;
      messageBn?: string;
      messageEn?: string;
      type?: 'info' | 'promo' | 'policy' | 'maintenance';
    };

    const titleBn = typeof body.titleBn === 'string' ? body.titleBn.trim().slice(0, 160) : '';
    const titleEn = typeof body.titleEn === 'string' ? body.titleEn.trim().slice(0, 160) : '';
    const messageBn = typeof body.messageBn === 'string' ? body.messageBn.trim().slice(0, 1000) : '';
    const messageEn = typeof body.messageEn === 'string' ? body.messageEn.trim().slice(0, 1000) : '';
    const type =
      body.type === 'promo' || body.type === 'policy' || body.type === 'maintenance' ? body.type : 'info';

    if (!titleEn && !titleBn) {
      res.status(400).json({ error: 'Announcement title required' });
      return;
    }
    if (!messageEn && !messageBn) {
      res.status(400).json({ error: 'Announcement message required' });
      return;
    }

    const id = `ann_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date();
    const createRes = await createFirestoreDoc(
      'announcements',
      id,
      {
        id,
        titleBn: titleBn || titleEn,
        titleEn: titleEn || titleBn,
        messageBn: messageBn || messageEn,
        messageEn: messageEn || messageBn,
        type,
        createdBy: user.email || user.uid,
        active: true,
        createdAt: now,
      },
      user.token
    );
    if (!createRes.ok) {
      res.status(createRes.status).json({ error: 'Failed to create announcement', details: createRes.body });
      return;
    }

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: 'ANNOUNCEMENT_BROADCAST',
        targetCollection: 'announcements',
        targetId: id,
        summary: `Broadcast [${type}] announcement: ${titleEn || titleBn}`,
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true, id });
  });

  // Policy-compliant Rewarded Ad claim submission (explicitly excludes AdSense / non-incentivized providers)
  app.post('/api/ads/claim-reward', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !user.emailVerified) {
      res.status(401).json({ error: 'Verified account required to claim rewarded ad payout' });
      return;
    }

    const body = req.body as { networkId?: string };
    const networkId = typeof body.networkId === 'string' ? body.networkId.trim() : '';
    if (!networkId || !/^[a-zA-Z0-9_-]{1,64}$/.test(networkId)) {
      res.status(400).json({ error: 'Valid incentivized ad networkId required' });
      return;
    }

    const userDoc = await getFirestoreDoc('users', user.uid, user.token);
    if (userDoc.ok && userDoc.fields && fromFirestoreString(userDoc.fields.status) === 'suspended') {
      res.status(403).json({ error: 'Account is blocked and cannot earn ad rewards.' });
      return;
    }

    const [settingsDoc, netDoc, userClaims] = await Promise.all([
      getFirestoreDoc('siteSettings', 'global', user.token),
      getFirestoreDoc('adNetworks', networkId, user.token),
      runFirestoreEqualQuery('rewardedAdClaims', 'userId', user.uid, user.token, 50),
    ]);

    const sf = settingsDoc.fields || {};
    const rewardedAdEnabled = fromFirestoreBool(sf.rewardedAdEnabled, true);
    if (!rewardedAdEnabled) {
      res.status(403).json({ error: 'Rewarded ads are currently paused by administrator.' });
      return;
    }

    if (!netDoc.ok || !netDoc.fields) {
      res.status(404).json({ error: 'Configured incentivized ad network not found in database.' });
      return;
    }
    const provider = fromFirestoreString(netDoc.fields.provider);
    const networkName = fromFirestoreString(netDoc.fields.name) || provider;
    const netEnabled = fromFirestoreBool(netDoc.fields.enabled, false);
    const supportsRewards = fromFirestoreBool(netDoc.fields.supportsIncentivizedRewards, false);

    if (provider === 'adsense' || !supportsRewards || !netEnabled) {
      res.status(403).json({
        error: 'Policy block: Only enabled ad networks explicitly marked as incentivized-compatible (never Google AdSense) can issue rewards.',
      });
      return;
    }

    const amountBdt = Math.max(1, Math.min(500, fromFirestoreNumber(sf.rewardedAdAmountBdt) || 2));
    const cooldownMins = Math.max(1, fromFirestoreNumber(sf.rewardedAdCooldownMinutes) || 5);
    const dailyLimit = Math.max(1, fromFirestoreNumber(sf.rewardedAdDailyLimit) || 5);
    const today = new Date().toISOString().slice(0, 10);

    const todayClaims = userClaims.filter((c) => fromFirestoreString(c.fields.claimDate) === today);
    if (todayClaims.length >= dailyLimit) {
      res.status(429).json({ error: `Daily rewarded ad cap (${dailyLimit}/day) reached.` });
      return;
    }

    const latestMs = userClaims.reduce((max, c) => {
      const ts = fromFirestoreTimestampMs(c.fields.createdAt);
      return ts > max ? ts : max;
    }, 0);
    if (latestMs > 0 && Date.now() - latestMs < cooldownMins * 60000) {
      const waitSecs = Math.ceil((cooldownMins * 60000 - (Date.now() - latestMs)) / 1000);
      res.status(429).json({ error: `Cooldown active. Please wait ${waitSecs}s before claiming again.` });
      return;
    }

    const claimId = `rewad_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date();
    const createRes = await createFirestoreDoc(
      'rewardedAdClaims',
      claimId,
      {
        id: claimId,
        userId: user.uid,
        userEmail: user.email,
        networkId,
        networkName,
        amountBdt,
        claimDate: today,
        status: 'Pending Credit',
        createdAt: now,
        updatedAt: now,
      },
      user.token
    );
    if (!createRes.ok) {
      res.status(createRes.status).json({ error: 'Could not record rewarded ad claim', details: createRes.body });
      return;
    }

    res.json({ ok: true, claimId, amountBdt, status: 'Pending Credit' });
  });

  // Owner-only settlement (credit or reject) for Rewarded Ad claims
  app.post('/api/admin/settle-reward-claim', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    if (!isFreshAdminAuth(user, 900)) {
      res.status(401).json({
        error: 'Recent owner Google re-authentication required to credit rewarded ad payouts.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }

    const body = req.body as { claimId?: string; decision?: 'approve' | 'reject'; rejectionReason?: string };
    const claimId = typeof body.claimId === 'string' ? body.claimId.trim() : '';
    const decision = body.decision;
    const rejectionReason = typeof body.rejectionReason === 'string' ? body.rejectionReason.trim().slice(0, 400) : '';
    if (!claimId || (decision !== 'approve' && decision !== 'reject')) {
      res.status(400).json({ error: 'Invalid claim settlement payload' });
      return;
    }

    const cDoc = await getFirestoreDoc('rewardedAdClaims', claimId, user.token);
    if (!cDoc.ok || !cDoc.fields) {
      res.status(404).json({ error: 'Rewarded ad claim not found' });
      return;
    }
    if (fromFirestoreString(cDoc.fields.status) !== 'Pending Credit') {
      res.status(409).json({ error: 'Claim already settled' });
      return;
    }

    const targetUid = fromFirestoreString(cDoc.fields.userId);
    const targetEmail = fromFirestoreString(cDoc.fields.userEmail);
    const networkName = fromFirestoreString(cDoc.fields.networkName);
    const settingsDoc = await getFirestoreDoc('siteSettings', 'global', user.token);
    const configuredRewardBdt = Math.max(1, Math.min(500, fromFirestoreNumber(settingsDoc.fields?.rewardedAdAmountBdt) || 2));
    const storedAmountBdt = fromFirestoreNumber(cDoc.fields.amountBdt);
    const amountBdt = Math.max(1, Math.min(storedAmountBdt, configuredRewardBdt));
    const now = new Date();
    const nextStatus = decision === 'approve' ? 'Credited' : 'Rejected';

    await patchFirestoreDoc(
      'rewardedAdClaims',
      claimId,
      {
        status: nextStatus,
        rejectionReason: decision === 'reject' ? (rejectionReason || 'Verification failed') : '',
        creditedBy: user.uid,
        updatedAt: now,
      },
      user.token
    );

    if (decision === 'approve' && targetUid && amountBdt > 0) {
      const wTxId = `rwad_${claimId}`.slice(0, 64);
      const existingWallet = await getFirestoreDoc('walletAccounts', targetUid, user.token);
      const curAvail = existingWallet.ok && existingWallet.fields
        ? fromFirestoreNumber(existingWallet.fields.availableBalanceBdt)
        : 0;
      const curAdded = existingWallet.ok && existingWallet.fields
        ? fromFirestoreNumber(existingWallet.fields.totalAddedBdt)
        : 0;
      if (existingWallet.ok && existingWallet.fields) {
        await patchFirestoreDoc(
          'walletAccounts',
          targetUid,
          {
            availableBalanceBdt: curAvail + amountBdt,
            totalAddedBdt: curAdded + amountBdt,
            lastTxId: wTxId,
            updatedAt: now,
          },
          user.token
        );
      } else {
        await createFirestoreDoc(
          'walletAccounts',
          targetUid,
          {
            uid: targetUid,
            availableBalanceBdt: amountBdt,
            promotionalCreditsBdt: 0,
            totalAddedBdt: amountBdt,
            totalSpentBdt: 0,
            lastTxId: wTxId,
            updatedAt: now,
          },
          user.token
        );
      }

      await createFirestoreDoc(
        'walletTransactions',
        wTxId,
        {
          id: wTxId,
          userId: targetUid,
          userEmail: targetEmail,
          type: 'rewarded_ad',
          method: 'system',
          transactionId: wTxId,
          amountBdt,
          status: 'Approved',
          note: `Rewarded Ad payout (${networkName})`,
          createdAt: now,
          updatedAt: now,
        },
        user.token
      );
    }

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: decision === 'approve' ? 'REWARDED_AD_CREDITED' : 'REWARDED_AD_REJECTED',
        targetCollection: 'rewardedAdClaims',
        targetId: claimId,
        summary: `${nextStatus} ৳${amountBdt} rewarded ad claim (${networkName}) for ${targetEmail || targetUid}`,
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true, status: nextStatus });
  });

  app.post('/api/admin/audit', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    const body = req.body as { action?: string; targetCollection?: string; targetId?: string; summary?: string };
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    const result = await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: String(body.action || 'ADMIN_ACTION').slice(0, 100),
        targetCollection: String(body.targetCollection || 'system').slice(0, 60),
        targetId: String(body.targetId || 'global').slice(0, 128),
        summary: String(body.summary || 'Admin update').slice(0, 500),
        createdAt: now,
      },
      user.token
    );
    res.status(result.ok ? 200 : result.status).json({ ok: result.ok });
  });

  // Revoke user sessions marker (sign out from all devices)
  app.post('/api/auth/logout-all', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const now = Date.now();
    const patchRes = await patchFirestoreDoc(
      'users',
      user.uid,
      { sessionRevokedAt: now, updatedAt: new Date() },
      user.token
    );
    if (!patchRes.ok) {
      res.status(patchRes.status).json({ error: 'Failed to mark session revocation' });
      return;
    }
    res.json({ ok: true, sessionRevokedAt: now });
  });

  // Account deletion request queued for owner review (preserves financial/audit integrity)
  app.post('/api/auth/request-deletion', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !user.emailVerified) {
      res.status(401).json({ error: 'Verified account required to submit account deletion request' });
      return;
    }
    const body = req.body as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    const requestId = `del_${user.uid.slice(0, 12)}_${Date.now()}`;
    const now = new Date();
    const createRes = await createFirestoreDoc(
      'accountDeletionRequests',
      requestId,
      {
        id: requestId,
        userId: user.uid,
        userEmail: user.email,
        reason,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
      user.token
    );
    if (!createRes.ok) {
      res.status(createRes.status).json({ error: 'Failed to submit deletion request', details: createRes.body });
      return;
    }
    res.json({ ok: true, requestId, status: 'pending' });
  });

  // Idempotent Phase 1 migration: update Nagad 01727936180 -> 01772558301 (preserve bKash/Rocket) + ensure AD07 exists
  app.post('/api/admin/migrate-phase1', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    if (!isFreshAdminAuth(user, 900)) {
      res.status(401).json({
        error: 'Recent owner Google re-authentication required for database migration.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }

    const now = new Date();
    let updatedNagad = false;
    let addedAd07 = false;
    let addedBanner07 = false;

    const settingsDoc = await getFirestoreDoc('siteSettings', 'global', user.token);
    if (settingsDoc.ok && settingsDoc.fields) {
      const currentNagad = fromFirestoreString(settingsDoc.fields.nagadNumber);
      if (!currentNagad || currentNagad === '01727936180') {
        const patch = await patchFirestoreDoc(
          'siteSettings',
          'global',
          { nagadNumber: '01772558301', nagadType: 'Personal', updatedAt: now },
          user.token
        );
        if (patch.ok) updatedNagad = true;
      }
    }

    const ad07Doc = await getFirestoreDoc('advertisements', 'ad_07', user.token);
    if (!ad07Doc.ok) {
      const createAd = await createFirestoreDoc(
        'advertisements',
        'ad_07',
        {
          id: 'ad_07',
          code: 'AD07',
          titleBn: 'পার্টনার শোকেস ০৭ — স্পন্সরড নেটওয়ার্ক ডিলস',
          titleEn: 'Partner Showcase 07 — Sponsored Network Deals',
          descriptionBn: 'হোম ও সার্ভিস পেজে প্রদর্শিত অনুমোদিত ৭ম পার্টনার বিজ্ঞাপন।',
          descriptionEn: 'Authorized 7th partner advertisement displayed across marketplace slots.',
          targetUrl: 'https://bicea.org/22/c4bf83d2d9461da3b65434ab9cb069b2',
          mediaType: 'external',
          adFormat: 'native',
          networkName: 'Bicea Direct',
          mediaUrl: '',
          thumbnailUrl: '/assets/studio/ai_suite.jpg',
          placement: 'all',
          priority: 7,
          sortOrder: 7,
          enabled: true,
          startDate: '2026-01-01',
          endDate: '2027-12-31',
          createdAt: now,
          updatedAt: now,
        },
        user.token
      );
      if (createAd.ok) addedAd07 = true;
    }

    const ban07Doc = await getFirestoreDoc('banners', 'ban_between_2', user.token);
    if (!ban07Doc.ok) {
      const createBan = await createFirestoreDoc(
        'banners',
        'ban_between_2',
        {
          id: 'ban_between_2',
          titleBn: 'পার্টনার নেটওয়ার্ক ০৭ — ডিজিটাল প্রমোশনাল অফার',
          titleEn: 'Partner Network 07 — Featured Promotional Deals',
          subtitleBn: 'যাচাইকৃত পার্টনার লিংক · AD07',
          subtitleEn: 'Verified Partner Link · AD07',
          slot: 'between_sections',
          targetUrl: 'https://bicea.org/22/c4bf83d2d9461da3b65434ab9cb069b2',
          imageUrl: '/assets/studio/ai_suite.jpg',
          mobileImageUrl: '/assets/studio/ai_suite.jpg',
          adCode: 'AD07',
          sortOrder: 2,
          priority: 7,
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
        user.token
      );
      if (createBan.ok) addedBanner07 = true;
    }

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: 'PHASE1_MIGRATION_SYNC',
        targetCollection: 'siteSettings',
        targetId: 'global',
        summary: `Nagad updated: ${updatedNagad}, AD07 added: ${addedAd07}, Banner07 added: ${addedBanner07}`,
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true, updatedNagad, addedAd07, addedBanner07 });
  });

  // ==================== WATCH & EARN (STRICT S2S PROVIDER VERIFICATION) ====================

  app.post('/api/watch-earn/start-session', applyApiRateLimit('watch_earn_start', 20, 60000), async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !user.emailVerified) {
      res.status(401).json({ error: 'Verified account required to start a Watch & Earn session.' });
      return;
    }

    const body = req.body as { unitId?: unknown; provider?: unknown };
    const unitId = typeof body.unitId === 'string' ? body.unitId.trim() : '';
    const provider = typeof body.provider === 'string' ? body.provider.trim().toUpperCase() : '';
    if (!unitId || !/^[a-zA-Z0-9_-]{1,64}$/.test(unitId) || !provider) {
      res.status(400).json({ error: 'Valid unitId and provider are required.' });
      return;
    }
    if (provider === 'ADSENSE') {
      res.status(403).json({
        error: 'Policy block: Google AdSense cannot be used for Watch & Earn or incentivized rewards.',
      });
      return;
    }

    const userDoc = await getFirestoreDoc('users', user.uid, user.token);
    if (userDoc.ok && userDoc.fields && fromFirestoreString(userDoc.fields.status) === 'suspended') {
      res.status(403).json({ error: 'Account is suspended and cannot access Watch & Earn.' });
      return;
    }

    const [settingsDoc, netDoc, unitOverrideDoc, userSessions] = await Promise.all([
      getFirestoreDoc('siteSettings', 'global', user.token),
      getFirestoreDoc('adNetworks', unitId, user.token),
      getFirestoreDoc('advertisingUnits', unitId, user.token),
      runFirestoreEqualQuery('adViewingSessions', 'userId', user.uid, user.token, 100),
    ]);

    const sf = settingsDoc.fields || {};
    const watchEnabled = fromFirestoreBool(sf.watchEarnEnabled, true);
    const rewardedEnabled = fromFirestoreBool(sf.rewardedAdEnabled, true);
    if (!watchEnabled || !rewardedEnabled) {
      res.status(403).json({ error: 'Watch & Earn is currently disabled by administrator.' });
      return;
    }

    const dailyLimitAds = Math.max(1, fromFirestoreNumber(sf.rewardedAdDailyLimit) || 5);
    const dailyCoinCap = Math.max(10, fromFirestoreNumber(sf.watchEarnDailyCoinLimit) || 100);
    const cooldownMins = Math.max(1, fromFirestoreNumber(sf.rewardedAdCooldownMinutes) || 5);
    const ledger = getUserCoinLedger(user.uid);
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayCreditedSessions = userSessions.filter((s) => {
      const status = fromFirestoreString(s.fields.status);
      const ms = fromFirestoreTimestampMs(s.fields.createdAt);
      const d = ms > 0 ? new Date(ms).toISOString().slice(0, 10) : '';
      return status === 'credited' && d === todayStr;
    });
    const todayLedgerAds = ledger.creditedSessions.filter((s) => s.creditedAt.slice(0, 10) === todayStr);
    const todayCoins = Math.max(
      todayCreditedSessions.reduce((sum, s) => sum + fromFirestoreNumber(s.fields.coinsAwarded), 0),
      todayLedgerAds.reduce((sum, s) => sum + s.coins, 0)
    );
    const todayCount = Math.max(todayCreditedSessions.length, todayLedgerAds.length);

    if (todayCount >= dailyLimitAds || todayCoins >= dailyCoinCap) {
      res.status(429).json({
        error: `Daily Watch & Earn limit reached (${todayCount}/${dailyLimitAds} ads, ${todayCoins}/${dailyCoinCap} coins).`,
      });
      return;
    }

    const lastLedgerMs = todayLedgerAds.reduce((m, s) => {
      const ms = Date.parse(s.creditedAt) || 0;
      return ms > m ? ms : m;
    }, 0);
    const lastCreditedMs = Math.max(
      lastLedgerMs,
      todayCreditedSessions.reduce((m, s) => {
        const ms = fromFirestoreTimestampMs(s.fields.createdAt);
        return ms > m ? ms : m;
      }, 0)
    );
    if (lastCreditedMs > 0 && Date.now() - lastCreditedMs < cooldownMins * 60000) {
      const waitSec = Math.ceil((cooldownMins * 60000 - (Date.now() - lastCreditedMs)) / 1000);
      res.status(429).json({ error: `Cooldown active. Please wait ${waitSec}s before next rewarded ad.` });
      return;
    }

    // Determine whether provider supports real server-side rewarded postbacks & secret is configured
    const netSupports =
      netDoc.ok &&
      netDoc.fields &&
      fromFirestoreBool(netDoc.fields.enabled, false) &&
      fromFirestoreBool(netDoc.fields.supportsIncentivizedRewards, false) &&
      fromFirestoreString(netDoc.fields.provider) !== 'adsense';
    const unitSupports =
      unitOverrideDoc.ok &&
      unitOverrideDoc.fields &&
      fromFirestoreBool(unitOverrideDoc.fields.supportsRewardedVerification, false);
    const secretEnvKey = `AD_POSTBACK_SECRET_${provider.replace(/[^A-Z0-9_]/g, '_')}`;
    const hasPostbackSecret =
      isConfiguredEnvValue(process.env[secretEnvKey]) ||
      isConfiguredEnvValue(process.env.WATCH_EARN_S2S_SECRET);

    const isAuthorizedRewarded = Boolean((netSupports || unitSupports) && hasPostbackSecret);
    if (!isAuthorizedRewarded) {
      const failMsg =
        !netSupports && !unitSupports
          ? `Unit ${unitId} (${provider}) is a standard display/direct sponsor ad and does not issue coins. Only S2S-enabled rewarded providers award coins.`
          : `S2S callback secret (${secretEnvKey}) is not configured on server for ${provider}; rewarded verification requires valid publisher S2S credentials.`;

      res.json({
        ok: false,
        sessionId: '',
        sessionToken: '',
        status: 'not_rewarded',
        requiresS2SCallback: true,
        message: failMsg,
      });
      return;
    }

    const sessionId = `wes_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const sessionToken = crypto.randomBytes(16).toString('hex');
    const now = new Date();

    await createFirestoreDoc(
      'adViewingSessions',
      sessionId,
      {
        id: sessionId,
        userId: user.uid,
        userEmail: user.email,
        unitId,
        provider: AUTHORIZED_24_UNIT_PROVIDERS.has(provider) ? provider : provider.slice(0, 40),
        sessionToken,
        status: 'awaiting_callback',
        coinsAwarded: 0,
        failureReason: '',
        createdAt: now,
        updatedAt: now,
      },
      user.token
    );

    res.json({
      ok: true,
      sessionId,
      sessionToken,
      status: 'awaiting_callback',
      requiresS2SCallback: true,
      message: 'Rewarded session started. Watch the partner ad in the opened Chrome tab; coins credit once the S2S callback arrives.',
    });
  });

  // Authoritative Watch & Earn coin balance & S2S ledger summary
  app.get('/api/watch-earn/summary', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !user.emailVerified) {
      res.status(401).json({ error: 'Verified account required.' });
      return;
    }
    const ledger = getUserCoinLedger(user.uid);
    res.json({
      ok: true,
      coinsAvailable: ledger.coinsAvailable,
      coinsLifetimeEarned: ledger.coinsLifetimeEarned,
      coinsRedeemed: ledger.coinsRedeemed,
      creditedSessions: ledger.creditedSessions.slice(-25).reverse(),
    });
  });

  // Trusted Server-to-Server Ad Network Postback Receiver (HMAC / Secret verified — never accepts unsigned client requests)
  const handlePostback = (req: express.Request, res: express.Response) => {
    const providerRaw = String(req.params.provider || '').trim().toUpperCase();
    if (!providerRaw || providerRaw === 'ADSENSE') {
      res.status(403).json({ error: 'Invalid or non-rewarded provider' });
      return;
    }
    const secretEnvKey = `AD_POSTBACK_SECRET_${providerRaw.replace(/[^A-Z0-9_]/g, '_')}`;
    const configuredSecret = isConfiguredEnvValue(process.env[secretEnvKey])
      ? String(process.env[secretEnvKey]).trim()
      : isConfiguredEnvValue(process.env.WATCH_EARN_S2S_SECRET)
        ? String(process.env.WATCH_EARN_S2S_SECRET).trim()
        : '';
    if (!configuredSecret) {
      res.status(503).json({
        error: `S2S postback secret (${secretEnvKey}) is not configured in server environment.`,
      });
      return;
    }

    const q = (req.method === 'GET' ? req.query : { ...req.query, ...(req.body || {}) }) as Record<
      string,
      unknown
    >;
    const sessionToken = String(
      q.session_token || q.sub_id || q.subid || q.click_id || q.clickid || q.sessionToken || ''
    ).trim();
    const providerEventId = String(
      q.event_id || q.tx_id || q.txid || q.transaction_id || q.conversion_id || ''
    ).trim();
    const providedSig = String(q.sig || q.secret || req.headers['x-postback-secret'] || '').trim();
    const callbackStatus = String(q.status || 'completed').trim().toLowerCase();

    if (!sessionToken || !providerEventId || !providedSig) {
      res.status(400).json({ error: 'session_token/sub_id, event_id/tx_id, and sig/secret are required' });
      return;
    }

    const expectedHmac = crypto
      .createHmac('sha256', configuredSecret)
      .update(`${providerRaw}:${sessionToken}:${providerEventId}`)
      .digest('hex');

    const matchesHmac =
      providedSig.length === expectedHmac.length &&
      crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedHmac));
    const matchesDirectSecret =
      providedSig.length === configuredSecret.length &&
      crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(configuredSecret));

    if (!matchesHmac && !matchesDirectSecret) {
      res.status(403).json({ error: 'Invalid postback signature or secret' });
      return;
    }

    if (callbackStatus === 'rejected' || callbackStatus === 'failed' || callbackStatus === 'reversed') {
      res.json({ ok: true, recorded: false, rejected: true, provider: providerRaw, sessionToken });
      return;
    }

    if (!verifiedS2SReceipts[sessionToken]) {
      verifiedS2SReceipts[sessionToken] = {
        sessionToken,
        provider: providerRaw,
        providerEventId,
        receivedAt: new Date().toISOString(),
        coinsOverride: Number(q.coins) > 0 ? Number(q.coins) : undefined,
      };
      saveJsonStore(s2sReceiptsFile, verifiedS2SReceipts);
    }

    res.json({ ok: true, recorded: true, provider: providerRaw, sessionToken });
  };
  app.get('/api/ads/postback/:provider', handlePostback);
  app.post('/api/ads/postback/:provider', handlePostback);

  // Verify Watch & Earn Session ONLY against genuine recorded S2S provider callback (Zero client-timer auto-credit)
  app.post('/api/watch-earn/verify-session', applyApiRateLimit('watch_earn_verify', 30, 60000), async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !user.emailVerified) {
      res.status(401).json({ error: 'Verified account required.' });
      return;
    }
    const body = req.body as { sessionId?: unknown; finalizeIfMissing?: unknown };
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
    const finalizeIfMissing = body.finalizeIfMissing === true;
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId is required' });
      return;
    }

    const sDoc = await getFirestoreDoc('adViewingSessions', sessionId, user.token);
    if (!sDoc.ok || !sDoc.fields) {
      res.status(404).json({ error: 'Viewing session not found' });
      return;
    }
    if (fromFirestoreString(sDoc.fields.userId) !== user.uid) {
      res.status(403).json({ error: 'Session does not belong to current user' });
      return;
    }

    const ledger = getUserCoinLedger(user.uid);
    const alreadyCredited = ledger.creditedSessions.find((s) => s.sessionId === sessionId);
    const currentStatus = fromFirestoreString(sDoc.fields.status);
    if (currentStatus === 'credited' || alreadyCredited) {
      res.status(200).json({
        ok: true,
        verified: true,
        status: 'credited',
        coinsAwarded: alreadyCredited?.coins || fromFirestoreNumber(sDoc.fields.coinsAwarded),
        message: 'Session rewards were verified and credited.',
      });
      return;
    }

    const sessionToken = fromFirestoreString(sDoc.fields.sessionToken);
    const provider = fromFirestoreString(sDoc.fields.provider);
    const createdMs = fromFirestoreTimestampMs(sDoc.fields.createdAt);
    const sessionAgeMs = createdMs > 0 ? Date.now() - createdMs : 0;
    const isExpired = sessionAgeMs > 15 * 60 * 1000;
    const s2s = verifiedS2SReceipts[sessionToken];
    const now = new Date();

    if (!s2s || s2s.consumed || s2s.provider.toUpperCase() !== provider.toUpperCase()) {
      const shouldFail = finalizeIfMissing || isExpired;
      const pendingOrFailReason = shouldFail
        ? 'No verified S2S completion callback was received from this ad provider within the session window.'
        : 'Still waiting for verified S2S completion callback from the ad provider. Please keep the ad open and retry shortly.';

      if (shouldFail) {
        await patchFirestoreDoc(
          'adViewingSessions',
          sessionId,
          {
            status: 'verification_failed',
            failureReason: pendingOrFailReason,
            updatedAt: now,
          },
          user.token
        );
      }

      res.status(202).json({
        ok: false,
        verified: false,
        status: shouldFail ? 'verification_failed' : 'awaiting_callback',
        coinsAwarded: 0,
        message: pendingOrFailReason,
      });
      return;
    }

    const settingsDoc = await getFirestoreDoc('siteSettings', 'global', user.token);
    const sf = settingsDoc.fields || {};
    const coinsPerAd = Math.max(1, fromFirestoreNumber(sf.watchEarnCoinsPerAd) || 10);
    const awardedCoins = s2s.coinsOverride ? Math.min(500, s2s.coinsOverride) : coinsPerAd;

    // Credit server-authoritative coin ledger first & mark S2S receipt consumed
    s2s.consumed = true;
    saveJsonStore(s2sReceiptsFile, verifiedS2SReceipts);

    ledger.coinsAvailable += awardedCoins;
    ledger.coinsLifetimeEarned += awardedCoins;
    ledger.creditedSessions.push({
      sessionId,
      provider,
      providerEventId: s2s.providerEventId,
      coins: awardedCoins,
      creditedAt: now.toISOString(),
    });
    saveJsonStore(watchEarnLedgerFile, watchEarnLedger);

    // Only admin token updates Firestore credited status/wallet directly; non-admin stays protected by server ledger
    if (await isAuthorizedAdmin(user)) {
      await patchFirestoreDoc(
        'adViewingSessions',
        sessionId,
        {
          status: 'credited',
          coinsAwarded: awardedCoins,
          providerEventId: s2s.providerEventId,
          failureReason: '',
          verifiedAt: now,
          updatedAt: now,
        },
        user.token
      );
    }

    // If user has a pending referral waiting on first_rewarded_ad, log qualification note
    const refDoc = await getFirestoreDoc('referrals', `ref_${user.uid}`.slice(0, 64), user.token);
    if (
      refDoc.ok &&
      refDoc.fields &&
      fromFirestoreString(refDoc.fields.status) === 'pending' &&
      fromFirestoreString(refDoc.fields.eligibilityRule) === 'first_rewarded_ad' &&
      (await isAuthorizedAdmin(user))
    ) {
      await patchFirestoreDoc(
        'referrals',
        `ref_${user.uid}`.slice(0, 64),
        { status: 'qualified', updatedAt: now },
        user.token
      );
    }

    res.json({
      ok: true,
      verified: true,
      status: 'credited',
      coinsAwarded: awardedCoins,
      coinsAvailable: ledger.coinsAvailable,
      message: `${awardedCoins} coins verified and credited via S2S callback.`,
    });
  });

  // Convert verified Watch & Earn Coins into Wallet BDT request (deducts authoritative server coin balance)
  app.post('/api/watch-earn/redeem-coins', applyApiRateLimit('watch_earn_redeem', 10, 60000), async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !user.emailVerified) {
      res.status(401).json({ error: 'Verified account required.' });
      return;
    }

    const body = req.body as { coins?: unknown };
    const coins = Math.floor(Number(body.coins) || 0);
    if (coins <= 0 || coins > 1000000) {
      res.status(400).json({ error: 'Valid coin amount required.' });
      return;
    }

    const settingsDoc = await getFirestoreDoc('siteSettings', 'global', user.token);
    const sf = settingsDoc.fields || {};
    const coinsPerBdt = Math.max(1, fromFirestoreNumber(sf.watchEarnCoinsPerBdt) || 10);
    const minRedeem = Math.max(10, fromFirestoreNumber(sf.watchEarnMinRedeemCoins) || 50);

    if (coins < minRedeem) {
      res.status(400).json({ error: `Minimum redemption is ${minRedeem} coins.` });
      return;
    }

    const ledger = getUserCoinLedger(user.uid);
    if (ledger.coinsAvailable < coins) {
      res.status(400).json({ error: `Insufficient verified coin balance (${ledger.coinsAvailable} available).` });
      return;
    }

    const bdtCredited = Number((coins / coinsPerBdt).toFixed(2));
    if (bdtCredited < 1) {
      res.status(400).json({ error: `Coins must equal at least ৳1 (${coinsPerBdt} coins = ৳1).` });
      return;
    }

    const now = new Date();
    const redeemId = `credem_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const isAdminActor = await isAuthorizedAdmin(user);

    ledger.coinsAvailable -= coins;
    ledger.coinsRedeemed += coins;
    saveJsonStore(watchEarnLedgerFile, watchEarnLedger);

    const artId = `art_${redeemId}`.slice(0, 64);
    await createFirestoreDoc(
      'adRewardTransactions',
      artId,
      {
        id: artId,
        sessionId: redeemId,
        userId: user.uid,
        userEmail: user.email,
        provider: 'SYSTEM',
        coins,
        bdtEquivalent: bdtCredited,
        type: 'coin_redemption',
        status: isAdminActor ? 'Credited' : 'Pending Credit',
        note: `Converted ${coins} verified Watch & Earn coins to ৳${bdtCredited} wallet balance`,
        createdAt: now,
      },
      user.token
    );

    if (isAdminActor) {
      const wDoc = await getFirestoreDoc('walletAccounts', user.uid, user.token);
      const curAvail = wDoc.ok && wDoc.fields ? fromFirestoreNumber(wDoc.fields.availableBalanceBdt) : 0;
      const curAdded = wDoc.ok && wDoc.fields ? fromFirestoreNumber(wDoc.fields.totalAddedBdt) : 0;
      if (wDoc.ok && wDoc.fields) {
        await patchFirestoreDoc(
          'walletAccounts',
          user.uid,
          {
            availableBalanceBdt: Number((curAvail + bdtCredited).toFixed(2)),
            totalAddedBdt: Number((curAdded + bdtCredited).toFixed(2)),
            lastTxId: redeemId,
            updatedAt: now,
          },
          user.token
        );
      }
      await createFirestoreDoc(
        'walletTransactions',
        redeemId,
        {
          id: redeemId,
          userId: user.uid,
          userEmail: user.email,
          type: 'watch_earn_coin_redeem',
          method: 'system',
          transactionId: redeemId,
          amountBdt: bdtCredited,
          status: 'Approved',
          note: `Redeemed ${coins} Watch & Earn coins (৳${bdtCredited})`,
          createdAt: now,
          updatedAt: now,
        },
        user.token
      );
    }

    res.json({
      ok: true,
      coinsRedeemed: coins,
      bdtCredited,
      coinsAvailable: ledger.coinsAvailable,
      status: isAdminActor ? 'Credited' : 'Pending Credit',
    });
  });

  // Owner-only settlement of Watch & Earn Coin Redemptions -> Wallet Balance (recomputes rate + fresh auth + audit log)
  app.post('/api/admin/settle-coin-redemption', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    if (!isFreshAdminAuth(user, 900)) {
      res.status(401).json({
        error: 'Recent owner Google re-authentication required to settle Watch & Earn redemptions.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }
    const body = req.body as { txId?: string; decision?: 'credit' | 'reject'; reason?: string };
    const txId = typeof body.txId === 'string' ? body.txId.trim() : '';
    const decision = body.decision;
    if (!txId || (decision !== 'credit' && decision !== 'reject')) {
      res.status(400).json({ error: 'Valid txId and decision required' });
      return;
    }
    const [txDoc, settingsDoc] = await Promise.all([
      getFirestoreDoc('adRewardTransactions', txId, user.token),
      getFirestoreDoc('siteSettings', 'global', user.token),
    ]);
    if (!txDoc.ok || !txDoc.fields) {
      res.status(404).json({ error: 'Coin redemption transaction not found' });
      return;
    }
    if (fromFirestoreString(txDoc.fields.type) !== 'coin_redemption') {
      res.status(400).json({ error: 'Transaction is not a coin redemption record' });
      return;
    }
    if (fromFirestoreString(txDoc.fields.status) !== 'Pending Credit') {
      res.status(409).json({ error: 'Transaction has already been settled.' });
      return;
    }

    const targetUid = fromFirestoreString(txDoc.fields.userId);
    const targetEmail = fromFirestoreString(txDoc.fields.userEmail);
    const coins = Math.max(0, Math.round(fromFirestoreNumber(txDoc.fields.coins)));
    const storedBdt = Math.max(0, fromFirestoreNumber(txDoc.fields.bdtEquivalent));
    const coinsPerBdt = Math.max(1, fromFirestoreNumber(settingsDoc.fields?.watchEarnCoinsPerBdt) || 10);
    const expectedBdt = Number((coins / coinsPerBdt).toFixed(2));
    if (decision === 'credit' && storedBdt > expectedBdt + 0.05) {
      res.status(400).json({ error: 'Redemption rate mismatch detected against server conversion rate.' });
      return;
    }
    const bdtAmount = Math.max(0, Math.min(storedBdt, expectedBdt));
    const now = new Date();
    const nextStatus = decision === 'credit' ? 'Credited' : 'Rejected';

    await patchFirestoreDoc(
      'adRewardTransactions',
      txId,
      {
        status: nextStatus,
        ...(body.reason ? { note: String(body.reason).slice(0, 300) } : {}),
      },
      user.token
    );

    if (decision === 'credit' && targetUid && bdtAmount > 0) {
      const wDoc = await getFirestoreDoc('walletAccounts', targetUid, user.token);
      const curAvail = wDoc.ok && wDoc.fields ? fromFirestoreNumber(wDoc.fields.availableBalanceBdt) : 0;
      const curAdded = wDoc.ok && wDoc.fields ? fromFirestoreNumber(wDoc.fields.totalAddedBdt) : 0;
      const walletTxId = `wetc_${txId}`.slice(0, 64);

      if (wDoc.ok && wDoc.fields) {
        await patchFirestoreDoc(
          'walletAccounts',
          targetUid,
          {
            availableBalanceBdt: Number((curAvail + bdtAmount).toFixed(2)),
            totalAddedBdt: Number((curAdded + bdtAmount).toFixed(2)),
            lastTxId: walletTxId,
            updatedAt: now,
          },
          user.token
        );
      } else {
        await createFirestoreDoc(
          'walletAccounts',
          targetUid,
          {
            uid: targetUid,
            availableBalanceBdt: bdtAmount,
            promotionalCreditsBdt: 0,
            totalAddedBdt: bdtAmount,
            totalSpentBdt: 0,
            lastTxId: walletTxId,
            updatedAt: now,
          },
          user.token
        );
      }

      await createFirestoreDoc(
        'walletTransactions',
        walletTxId,
        {
          id: walletTxId,
          userId: targetUid,
          userEmail: targetEmail,
          type: 'watch_earn_coin_redeem',
          method: 'system',
          transactionId: walletTxId,
          amountBdt: bdtAmount,
          status: 'Approved',
          note: `Redeemed ${coins} Watch & Earn coins (৳${bdtAmount})`,
          createdAt: now,
          updatedAt: now,
        },
        user.token
      );
    } else if (decision === 'reject' && targetUid && coins > 0) {
      const ledger = getUserCoinLedger(targetUid);
      ledger.coinsAvailable += coins;
      ledger.coinsRedeemed = Math.max(0, ledger.coinsRedeemed - coins);
      saveJsonStore(watchEarnLedgerFile, watchEarnLedger);
    }

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: decision === 'credit' ? 'COIN_REDEMPTION_CREDITED' : 'COIN_REDEMPTION_REJECTED',
        targetCollection: 'adRewardTransactions',
        targetId: txId,
        summary: `${nextStatus} ${coins} coins (৳${bdtAmount}) for ${targetEmail || targetUid}`,
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true, status: nextStatus });
  });

  // ==================== REFERRAL SYSTEM REGISTRATION & ADMIN SETTLEMENT ====================

  app.post('/api/referrals/register', applyApiRateLimit('referral_register', 15, 60000), async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !user.emailVerified) {
      res.status(401).json({ error: 'Verified account required.' });
      return;
    }

    const body = req.body as { referralCode?: unknown };
    const code = typeof body.referralCode === 'string' ? body.referralCode.trim().toUpperCase() : '';
    if (!code || !/^[A-Z0-9_-]{4,24}$/.test(code)) {
      res.status(400).json({ ok: false, registered: false, error: 'Valid referral code required' });
      return;
    }

    const refId = `ref_${user.uid}`.slice(0, 64);
    const existingRef = await getFirestoreDoc('referrals', refId, user.token);
    if (existingRef.ok && existingRef.fields) {
      res.json({
        ok: true,
        registered: true,
        status: fromFirestoreString(existingRef.fields.status),
        message: 'Referral relationship already recorded.',
      });
      return;
    }

    const [codeDoc, settingsDoc] = await Promise.all([
      getFirestoreDoc('referralCodes', code, user.token),
      getFirestoreDoc('siteSettings', 'global', user.token),
    ]);

    if (!codeDoc.ok || !codeDoc.fields) {
      res.status(404).json({ ok: false, registered: false, error: 'Referral code not found.' });
      return;
    }

    const referrerId = fromFirestoreString(codeDoc.fields.userId);
    if (!referrerId || referrerId === user.uid) {
      res.status(400).json({ ok: false, registered: false, error: 'Self-referral is strictly prohibited.' });
      return;
    }

    const sf = settingsDoc.fields || {};
    const referralEnabled = fromFirestoreBool(sf.referralEnabled, true);
    if (!referralEnabled) {
      res.status(403).json({ ok: false, registered: false, error: 'Referral system is paused.' });
      return;
    }

    const bonusBdt = Math.max(0, fromFirestoreNumber(sf.referralBonusBdt) || 50);
    const invitedBdt = Math.max(0, fromFirestoreNumber(sf.invitedUserRewardBdt) || 0);
    const eligibilityRaw = fromFirestoreString(sf.referralEligibility) || 'first_paid_order';
    const eligibilityRule = ['verified_signup', 'first_paid_order', 'first_rewarded_ad'].includes(eligibilityRaw)
      ? eligibilityRaw
      : 'first_paid_order';

    // Abuse guard: detect multiple signups from same IP hash targeting the same referrer within 24h
    const ipRaw = String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim();
    const ipHash = crypto.createHash('sha256').update(ipRaw).digest('hex').slice(0, 24);
    const nowMs = Date.now();
    const recentForIp = (referralIpGuard.byIpHash[ipHash] || []).filter((e) => nowMs - e.at < 86400000);
    const suspicious = recentForIp.filter((e) => e.referrerId === referrerId && e.userId !== user.uid).length >= 2;
    recentForIp.push({ userId: user.uid, referrerId, at: nowMs });
    referralIpGuard.byIpHash[ipHash] = recentForIp.slice(-20);
    saveJsonStore(referralGuardFile, referralIpGuard);

    const status = suspicious
      ? 'flagged'
      : eligibilityRule === 'verified_signup'
        ? 'qualified'
        : 'pending';
    const now = new Date();

    const createRes = await createFirestoreDoc(
      'referrals',
      refId,
      {
        id: refId,
        referrerId,
        referredUserId: user.uid,
        referredEmail: user.email,
        referralCode: code,
        rewardAmountBdt: bonusBdt,
        invitedRewardBdt: invitedBdt,
        eligibilityRule,
        suspiciousFlag: suspicious,
        suspiciousReason: suspicious ? 'Multiple referral signups from same network IP in 24h' : '',
        status,
        createdAt: now,
        updatedAt: now,
      },
      user.token
    );

    if (!createRes.ok) {
      res.status(createRes.status).json({ error: 'Could not register referral', details: createRes.body });
      return;
    }

    res.json({
      ok: true,
      registered: true,
      status,
      message: suspicious
        ? 'Referral logged for manual admin security review.'
        : status === 'qualified'
          ? 'Referral qualified! Reward ready for payout verification.'
          : `Referral linked! Unlocks upon ${eligibilityRule.replace(/_/g, ' ')}.`,
    });
  });

  app.post('/api/admin/settle-referral', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    if (!isFreshAdminAuth(user, 900)) {
      res.status(401).json({
        error: 'Recent owner Google re-authentication required before settling referral payouts.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }

    const body = req.body as { referralId?: string; decision?: 'credit' | 'revoke'; reason?: string };
    const referralId = typeof body.referralId === 'string' ? body.referralId.trim() : '';
    const decision = body.decision;
    if (!referralId || (decision !== 'credit' && decision !== 'revoke')) {
      res.status(400).json({ error: 'Invalid referral settlement request' });
      return;
    }

    const [rDoc, settingsDoc] = await Promise.all([
      getFirestoreDoc('referrals', referralId, user.token),
      getFirestoreDoc('siteSettings', 'global', user.token),
    ]);
    if (!rDoc.ok || !rDoc.fields) {
      res.status(404).json({ error: 'Referral record not found' });
      return;
    }
    const curStatus = fromFirestoreString(rDoc.fields.status);
    if (curStatus === 'credited' && decision === 'credit') {
      res.status(409).json({ error: 'Referral already credited.' });
      return;
    }
    if (curStatus === 'revoked' && decision === 'credit') {
      res.status(409).json({ error: 'Revoked referrals cannot be credited.' });
      return;
    }

    const sf = settingsDoc.fields || {};
    const maxReferralBonus = Math.max(0, fromFirestoreNumber(sf.referralBonusBdt) || 50);
    const maxInvitedBonus = Math.max(0, fromFirestoreNumber(sf.invitedUserRewardBdt) || 0);
    const referrerId = fromFirestoreString(rDoc.fields.referrerId);
    const referredUserId = fromFirestoreString(rDoc.fields.referredUserId);
    const referredEmail = fromFirestoreString(rDoc.fields.referredEmail);
    const rewardAmountBdt = Math.max(0, Math.min(fromFirestoreNumber(rDoc.fields.rewardAmountBdt), maxReferralBonus));
    const invitedRewardBdt = Math.max(0, Math.min(fromFirestoreNumber(rDoc.fields.invitedRewardBdt), maxInvitedBonus));
    const now = new Date();
    const nextStatus = decision === 'credit' ? 'credited' : 'revoked';

    await patchFirestoreDoc(
      'referrals',
      referralId,
      {
        status: nextStatus,
        rewardAmountBdt,
        invitedRewardBdt,
        ...(body.reason ? { suspiciousReason: String(body.reason).slice(0, 200) } : {}),
        updatedAt: now,
      },
      user.token
    );

    if (decision === 'credit' && referrerId && referrerId !== referredUserId) {
      if (rewardAmountBdt > 0) {
        const refTxId = `rtx_${referredUserId}`.slice(0, 64);
        const existingTx = await getFirestoreDoc('walletTransactions', refTxId, user.token);
        if (!existingTx.ok) {
          const wDoc = await getFirestoreDoc('walletAccounts', referrerId, user.token);
          const curAvail = wDoc.ok && wDoc.fields ? fromFirestoreNumber(wDoc.fields.availableBalanceBdt) : 0;
          const curAdded = wDoc.ok && wDoc.fields ? fromFirestoreNumber(wDoc.fields.totalAddedBdt) : 0;
          if (wDoc.ok && wDoc.fields) {
            await patchFirestoreDoc(
              'walletAccounts',
              referrerId,
              {
                availableBalanceBdt: curAvail + rewardAmountBdt,
                totalAddedBdt: curAdded + rewardAmountBdt,
                lastTxId: refTxId,
                updatedAt: now,
              },
              user.token
            );
          } else {
            await createFirestoreDoc(
              'walletAccounts',
              referrerId,
              {
                uid: referrerId,
                availableBalanceBdt: rewardAmountBdt,
                promotionalCreditsBdt: 0,
                totalAddedBdt: rewardAmountBdt,
                totalSpentBdt: 0,
                lastTxId: refTxId,
                updatedAt: now,
              },
              user.token
            );
          }
          await createFirestoreDoc(
            'walletTransactions',
            refTxId,
            {
              id: refTxId,
              userId: referrerId,
              userEmail: '',
              type: 'referral',
              method: 'system',
              transactionId: refTxId,
              amountBdt: rewardAmountBdt,
              status: 'Approved',
              note: `Verified referral bonus for ${referredEmail || referredUserId}`,
              createdAt: now,
              updatedAt: now,
            },
            user.token
          );
        }
      }

      if (invitedRewardBdt > 0 && referredUserId) {
        const invTxId = `ritx_${referredUserId}`.slice(0, 64);
        const existingInvTx = await getFirestoreDoc('walletTransactions', invTxId, user.token);
        if (!existingInvTx.ok) {
          const invW = await getFirestoreDoc('walletAccounts', referredUserId, user.token);
          const iAvail = invW.ok && invW.fields ? fromFirestoreNumber(invW.fields.availableBalanceBdt) : 0;
          const iAdded = invW.ok && invW.fields ? fromFirestoreNumber(invW.fields.totalAddedBdt) : 0;
          if (invW.ok && invW.fields) {
            await patchFirestoreDoc(
              'walletAccounts',
              referredUserId,
              {
                availableBalanceBdt: iAvail + invitedRewardBdt,
                totalAddedBdt: iAdded + invitedRewardBdt,
                lastTxId: invTxId,
                updatedAt: now,
              },
              user.token
            );
          } else {
            await createFirestoreDoc(
              'walletAccounts',
              referredUserId,
              {
                uid: referredUserId,
                availableBalanceBdt: invitedRewardBdt,
                promotionalCreditsBdt: 0,
                totalAddedBdt: invitedRewardBdt,
                totalSpentBdt: 0,
                lastTxId: invTxId,
                updatedAt: now,
              },
              user.token
            );
          }
          await createFirestoreDoc(
            'walletTransactions',
            invTxId,
            {
              id: invTxId,
              userId: referredUserId,
              userEmail: referredEmail,
              type: 'referral',
              method: 'system',
              transactionId: invTxId,
              amountBdt: invitedRewardBdt,
              status: 'Approved',
              note: `Invited-user referral welcome bonus`,
              createdAt: now,
              updatedAt: now,
            },
            user.token
          );
        }
      }
    }

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: decision === 'credit' ? 'REFERRAL_CREDITED' : 'REFERRAL_REVOKED',
        targetCollection: 'referrals',
        targetId: referralId,
        summary: `${nextStatus} referral ${referralId} (Inviter: ৳${rewardAmountBdt}, Invited: ৳${invitedRewardBdt})`,
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true, status: nextStatus });
  });

  // Server-side order pricing & stock validation before checkout commit
  app.post('/api/orders/validate-checkout', applyApiRateLimit('orders_validate', 30, 60000), async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !user.emailVerified) {
      res.status(401).json({ error: 'Verified authentication required.' });
      return;
    }
    const body = req.body as {
      items?: Array<{ productId?: string; packageId?: string; quantity?: number }>;
      couponCode?: string;
    };
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length === 0 || items.length > 50) {
      res.status(400).json({ error: 'Valid order items are required.' });
      return;
    }

    let subtotalBdt = 0;
    for (const item of items) {
      const productId = typeof item.productId === 'string' ? item.productId.trim() : '';
      const qty = Math.max(1, Math.min(1000, Math.round(Number(item.quantity) || 1)));
      if (!productId) {
        res.status(400).json({ error: 'Invalid productId in checkout.' });
        return;
      }
      const pDoc = await getFirestoreDoc('products', productId, user.token);
      if (!pDoc.ok || !pDoc.fields) {
        res.status(404).json({ error: `Product ${productId} not found.` });
        return;
      }
      if (!fromFirestoreBool(pDoc.fields.active, true) || fromFirestoreString(pDoc.fields.availability) === 'out_of_stock') {
        res.status(400).json({ error: 'One or more products are currently unavailable.' });
        return;
      }
      let unitPrice = fromFirestoreNumber(pDoc.fields.priceBdt);
      const packagesField = pDoc.fields.packages as { arrayValue?: { values?: Array<{ mapValue?: { fields?: Record<string, unknown> } }> } } | undefined;
      const pkgValues = packagesField?.arrayValue?.values || [];
      if (item.packageId && pkgValues.length > 0) {
        const matched = pkgValues.find((v) => fromFirestoreString(v.mapValue?.fields?.id) === item.packageId);
        if (matched?.mapValue?.fields) {
          const pkgPrice = fromFirestoreNumber(matched.mapValue.fields.priceBdt);
          if (pkgPrice > 0) unitPrice = pkgPrice;
        }
      }
      subtotalBdt += Math.max(1, Math.round(unitPrice)) * qty;
    }

    let discountBdt = 0;
    const cleanCode = typeof body.couponCode === 'string' ? body.couponCode.trim().toUpperCase() : '';
    if (cleanCode) {
      const coupons = await runFirestoreEqualQuery('coupons', 'code', cleanCode, user.token, 2);
      const c = coupons[0]?.fields;
      const today = new Date().toISOString().slice(0, 10);
      if (
        c &&
        fromFirestoreBool(c.active, false) &&
        (!fromFirestoreString(c.expiresAt) || fromFirestoreString(c.expiresAt) >= today) &&
        fromFirestoreNumber(c.usedCount) < fromFirestoreNumber(c.usageLimit) &&
        subtotalBdt >= fromFirestoreNumber(c.minOrderBdt)
      ) {
        const dtype = fromFirestoreString(c.discountType);
        const dval = fromFirestoreNumber(c.discountValue);
        discountBdt =
          dtype === 'percent'
            ? Math.min(subtotalBdt, Math.round((subtotalBdt * dval) / 100))
            : Math.min(subtotalBdt, dval);
      }
    }

    res.json({
      ok: true,
      subtotalBdt,
      discountBdt,
      totalPriceBdt: Math.max(1, Math.round(subtotalBdt - discountBdt)),
    });
  });

  // Server-authorized admin order status update + customer notification + audit log
  app.post('/api/admin/update-order-status', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    const body = req.body as { orderId?: string; status?: string; adminNote?: string };
    const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : '';
    const status = typeof body.status === 'string' ? body.status.trim() : '';
    const allowedStatuses = ['Pending Payment', 'Verification Pending', 'Paid', 'Payment Approved', 'Processing', 'Completed', 'Rejected', 'Cancelled'];
    if (!orderId || !allowedStatuses.includes(status)) {
      res.status(400).json({ error: 'Valid orderId and status required' });
      return;
    }
    const orderDoc = await getFirestoreDoc('orders', orderId, user.token);
    if (!orderDoc.ok || !orderDoc.fields) {
      res.status(404).json({ error: 'Order not found' });
      return;
    }
    const customerId = fromFirestoreString(orderDoc.fields.customerId);
    const orderNumber = fromFirestoreString(orderDoc.fields.orderNumber) || orderId;
    const adminNote = typeof body.adminNote === 'string' ? body.adminNote.trim().slice(0, 500) : undefined;
    const now = new Date();

    const patchRes = await patchFirestoreDoc(
      'orders',
      orderId,
      {
        status,
        ...(adminNote !== undefined ? { adminNote } : {}),
        updatedAt: now,
      },
      user.token
    );
    if (!patchRes.ok) {
      res.status(patchRes.status).json({ error: 'Failed to update order status', details: patchRes.body });
      return;
    }

    if (customerId) {
      const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await createFirestoreDoc(
        'notifications',
        notifId,
        {
          id: notifId,
          userId: customerId,
          titleBn: `অর্ডার #${orderNumber} আপডেট`,
          titleEn: `Order #${orderNumber} Updated`,
          messageBn: `আপনার অর্ডারের বর্তমান অবস্থা: ${status}${adminNote ? ` (${adminNote})` : ''}`,
          messageEn: `Your order status is now: ${status}${adminNote ? ` (${adminNote})` : ''}`,
          type: 'order',
          read: false,
          createdAt: now,
        },
        user.token
      );
    }

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: 'ORDER_STATUS_UPDATED',
        targetCollection: 'orders',
        targetId: orderId,
        summary: `Updated order #${orderNumber} status -> ${status}`,
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true, status });
  });

  // Server-authorized admin wallet adjustment with fresh auth + authoritative balance read + audit log
  app.post('/api/admin/adjust-wallet', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    if (!isFreshAdminAuth(user, 900)) {
      res.status(401).json({
        error: 'Recent owner Google re-authentication required for wallet balance adjustments.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }
    const body = req.body as {
      targetUid?: string;
      userEmail?: string;
      mode?: 'add' | 'deduct' | 'set';
      amountBdt?: number;
      note?: string;
    };
    const targetUid = typeof body.targetUid === 'string' ? body.targetUid.trim().replace(/[^a-zA-Z0-9_-]/g, '') : '';
    const mode = body.mode;
    const rawAmt = Math.round(Number(body.amountBdt) || 0);
    if (!targetUid || (mode !== 'add' && mode !== 'deduct' && mode !== 'set')) {
      res.status(400).json({ error: 'Valid targetUid and adjustment mode required' });
      return;
    }
    if (mode !== 'set' && rawAmt < 1) {
      res.status(400).json({ error: 'Adjustment amount must be at least ৳1.' });
      return;
    }
    if (mode === 'set' && rawAmt < 0) {
      res.status(400).json({ error: 'Balance cannot be negative.' });
      return;
    }

    const wDoc = await getFirestoreDoc('walletAccounts', targetUid, user.token);
    const prevBalance = wDoc.ok && wDoc.fields ? fromFirestoreNumber(wDoc.fields.availableBalanceBdt) : 0;
    const prevAdded = wDoc.ok && wDoc.fields ? fromFirestoreNumber(wDoc.fields.totalAddedBdt) : 0;
    const prevSpent = wDoc.ok && wDoc.fields ? fromFirestoreNumber(wDoc.fields.totalSpentBdt) : 0;

    let nextBalance = prevBalance;
    if (mode === 'add') {
      nextBalance = prevBalance + rawAmt;
    } else if (mode === 'deduct') {
      if (prevBalance < rawAmt) {
        res.status(400).json({ error: `Cannot deduct ৳${rawAmt} from balance ৳${prevBalance}.` });
        return;
      }
      nextBalance = prevBalance - rawAmt;
    } else {
      nextBalance = rawAmt;
    }
    nextBalance = Math.min(10000000, Math.max(0, Math.round(nextBalance)));

    const delta = nextBalance - prevBalance;
    const txAmount = Math.max(1, Math.abs(delta));
    const txId = `wadj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const notifId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const modeTag = mode === 'add' ? 'CREDIT' : mode === 'deduct' ? 'DEDUCT' : 'SET';
    const noteText = `[${modeTag}] ${String(body.note || '').trim() || 'Admin balance update'} (৳${prevBalance} -> ৳${nextBalance})`.slice(0, 390);
    const now = new Date();

    if (wDoc.ok && wDoc.fields) {
      await patchFirestoreDoc(
        'walletAccounts',
        targetUid,
        {
          availableBalanceBdt: nextBalance,
          totalAddedBdt: delta > 0 ? prevAdded + delta : prevAdded,
          totalSpentBdt: delta < 0 ? prevSpent + Math.abs(delta) : prevSpent,
          lastTxId: txId,
          updatedAt: now,
        },
        user.token
      );
    } else {
      await createFirestoreDoc(
        'walletAccounts',
        targetUid,
        {
          uid: targetUid,
          availableBalanceBdt: nextBalance,
          promotionalCreditsBdt: 0,
          totalAddedBdt: nextBalance,
          totalSpentBdt: 0,
          lastTxId: txId,
          updatedAt: now,
        },
        user.token
      );
    }

    await createFirestoreDoc(
      'walletTransactions',
      txId,
      {
        id: txId,
        userId: targetUid,
        userEmail: String(body.userEmail || '').slice(0, 200),
        type: 'admin_adjustment',
        method: 'system',
        transactionId: txId,
        amountBdt: txAmount,
        status: 'Approved',
        note: noteText,
        createdAt: now,
        updatedAt: now,
      },
      user.token
    );

    await createFirestoreDoc(
      'notifications',
      notifId,
      {
        id: notifId,
        userId: targetUid,
        titleBn: 'ওয়ালেট ব্যালেন্স আপডেট হয়েছে',
        titleEn: 'Wallet Balance Updated',
        messageBn: `আপনার বর্তমান ভেরিফায়েড ওয়ালেট ব্যালেন্স এখন ৳${nextBalance}।`,
        messageEn: `Your verified wallet balance is now ৳${nextBalance}.`,
        type: 'wallet',
        read: false,
        createdAt: now,
      },
      user.token
    );

    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: 'WALLET_BALANCE_ADJUSTED',
        targetCollection: 'walletAccounts',
        targetId: targetUid,
        summary: noteText,
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true, nextBalance });
  });

  // Server-authorized siteSettings save (payment receiver numbers, reward rates, CMS) with fresh auth + audit log
  app.post('/api/admin/save-settings', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isAuthorizedAdmin(user))) {
      res.status(403).json({ error: 'Administrator authorization required' });
      return;
    }
    if (!isFreshAdminAuth(user, 900)) {
      res.status(401).json({
        error: 'Recent owner Google re-authentication required before updating payment or global settings.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object') {
      res.status(400).json({ error: 'Invalid siteSettings payload' });
      return;
    }
    const now = new Date();
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(body)) {
      if (v !== undefined && k !== 'updatedAt') {
        if ((k === 'bkashLogoUrl' || k === 'nagadLogoUrl' || k === 'rocketLogoUrl') && typeof v === 'string') {
          cleaned[k] = v.trim().slice(0, 200000);
        } else {
          cleaned[k] = v;
        }
      }
    }
    cleaned.id = 'global';
    cleaned.updatedAt = now;

    const saveRes = await setFirestoreDoc('siteSettings', 'global', cleaned, user.token);
    if (!saveRes.ok) {
      res.status(saveRes.status).json({ error: 'Failed to save site settings', details: saveRes.body });
      return;
    }

    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: 'SITE_SETTINGS_UPDATED',
        targetCollection: 'siteSettings',
        targetId: 'global',
        summary: `Updated global payment/reward/CMS settings`,
        createdAt: now,
      },
      user.token
    );

    res.json({ ok: true });
  });

  // Super-Admin-only RBAC management for /admins/{uid}
  app.post('/api/admin/manage-admins', async (req, res) => {
    const user = await verifyBearerToken(req.headers.authorization);
    if (!user || !(await isSuperAdmin(user))) {
      res.status(403).json({ error: 'Super Admin privileges required to manage administrator roles.' });
      return;
    }
    if (!isFreshAdminAuth(user, 900)) {
      res.status(401).json({
        error: 'Recent Super Admin Google re-authentication required to modify admin roles.',
        code: 'REAUTH_REQUIRED',
      });
      return;
    }
    const body = req.body as { action?: 'add' | 'remove'; uid?: string; email?: string; role?: 'admin' | 'super_admin' };
    const uid = typeof body.uid === 'string' ? body.uid.trim().replace(/[^a-zA-Z0-9_-]/g, '') : '';
    const action = body.action;
    if (!uid || (action !== 'add' && action !== 'remove')) {
      res.status(400).json({ error: 'Valid uid and action (add/remove) required' });
      return;
    }
    if (action === 'remove' && uid === user.uid) {
      res.status(400).json({ error: 'Cannot remove your own Super Admin record.' });
      return;
    }
    const now = new Date();
    if (action === 'add') {
      const email = typeof body.email === 'string' ? body.email.trim().slice(0, 200) : '';
      const role = body.role === 'super_admin' ? 'super_admin' : 'admin';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.status(400).json({ error: 'Valid administrator email is required' });
        return;
      }
      const resAdd = await createFirestoreDoc(
        'admins',
        uid,
        { uid, email, role, addedBy: user.uid, createdAt: now },
        user.token
      );
      if (!resAdd.ok) {
        res.status(resAdd.status).json({ error: 'Failed to add administrator', details: resAdd.body });
        return;
      }
      const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await createFirestoreDoc(
        'auditLogs',
        logId,
        {
          id: logId,
          actorUid: user.uid,
          actorEmail: user.email,
          action: 'ADMIN_ROLE_GRANTED',
          targetCollection: 'admins',
          targetId: uid,
          summary: `Granted ${role} role to ${email} (${uid})`,
          createdAt: now,
        },
        user.token
      );
      res.json({ ok: true, uid, role });
      return;
    }

    const resDel = await deleteFirestoreDoc('admins', uid, user.token);
    if (!resDel.ok) {
      res.status(resDel.status).json({ error: 'Failed to remove administrator', details: resDel.body });
      return;
    }
    const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await createFirestoreDoc(
      'auditLogs',
      logId,
      {
        id: logId,
        actorUid: user.uid,
        actorEmail: user.email,
        action: 'ADMIN_ROLE_REVOKED',
        targetCollection: 'admins',
        targetId: uid,
        summary: `Revoked administrator role for UID ${uid}`,
        createdAt: now,
      },
      user.token
    );
    res.json({ ok: true, uid });
  });


  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  return app;
}
