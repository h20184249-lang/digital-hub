import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getRuntimeEnvVar } from './db.ts';
import { createPhoneAuthAndAppRouter, resolveSessionFromRequest } from './phoneAuthRoutes.ts';

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
    // Non-filesystem runtime (Cloudflare Workers)
  }
  return null;
}

const dataDir = resolveDataDir();
const analyticsFile = dataDir ? path.join(dataDir, 'ad_analytics.json') : '';

function loadAnalytics(): AdAnalyticsState {
  if (!analyticsFile) return { byAd: {}, byFormat: {}, blockedFakeClicks: 0 };
  try {
    if (fs.existsSync(analyticsFile)) {
      const parsed = JSON.parse(fs.readFileSync(analyticsFile, 'utf-8')) as Partial<AdAnalyticsState>;
      if (parsed && typeof parsed === 'object' && parsed.byAd) {
        return {
          byAd: parsed.byAd,
          byFormat: parsed.byFormat || {},
          blockedFakeClicks: Number(parsed.blockedFakeClicks) || 0,
        };
      }
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

const adAnalyticsState: AdAnalyticsState = loadAnalytics();
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

function getConfiguredCorsOrigins(): Set<string> {
  const origins = new Set<string>([
    'https://localhost',
    'http://localhost',
    'capacitor://localhost',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8787',
    'http://localhost:8787',
    'https://digital-hub.h20184249.workers.dev',
  ]);
  const rawList = [
    getRuntimeEnvVar('APP_URL'),
    ...getRuntimeEnvVar('ALLOWED_CORS_ORIGINS').split(','),
  ];
  for (const item of rawList) {
    const trimmed = item.trim();
    if (!isConfiguredEnvValue(trimmed)) continue;
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        origins.add(parsed.origin);
      }
    } catch {
      // Ignore malformed origins
    }
  }
  return origins;
}

// Lightweight native UTF-8 JSON body parser compatible with both Node.js and Cloudflare Workers (`workerd`)
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

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://pagead2.googlesyndication.com https://afders.org https://bicea.org",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "connect-src 'self' https://firestore.googleapis.com https://*.googleapis.com https:",
      "frame-src 'self' https://bicea.org https://afders.org https://arwf.org https://auctionr.org https://asiafilm.org https:",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ');
    res.setHeader('Content-Security-Policy', cspDirectives);
    next();
  });

  // Strict allowlisted CORS with HTTP-only cookie credentials + CSRF origin validation on /api/*
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    const hostHeader = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    let isSameHostOrigin = false;
    if (origin && hostHeader) {
      try {
        isSameHostOrigin = new URL(origin).host === hostHeader;
      } catch {
        isSameHostOrigin = false;
      }
    }
    const configuredCorsOrigins = getConfiguredCorsOrigins();
    const isAllowedOrigin = Boolean(origin && (configuredCorsOrigins.has(origin) || isSameHostOrigin));

    if (isAllowedOrigin && origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    // CSRF protection: block cross-site mutating requests from untrusted browser Origins
    if (
      origin &&
      !isAllowedOrigin &&
      (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT' || req.method === 'DELETE') &&
      !req.path.startsWith('/ads/postback/')
    ) {
      res.status(403).json({ ok: false, error: 'Blocked cross-origin request.' });
      return;
    }

    next();
  });

  const apiRateMap = new Map<string, { count: number; resetAt: number }>();
  const applyApiRateLimit = (bucket: string, maxRequests: number, windowMs: number) => {
    return (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const now = Date.now();
      const ip = String(req.headers['cf-connecting-ip'] || req.ip || 'unknown');
      const key = `${bucket}:${ip}`;
      const existing = apiRateMap.get(key);
      if (existing && now < existing.resetAt) {
        if (existing.count >= maxRequests) {
          res.status(429).json({ ok: false, error: 'অনেকবার অনুরোধ পাঠানো হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।' });
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

  app.use('/api/payments', applyApiRateLimit('payments', 40, 60000));
  app.use('/api/auth', applyApiRateLimit('auth', 40, 60000));
  app.use('/api/admin', applyApiRateLimit('admin', 100, 60000));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'DIGITAL HUB API',
      authMode: 'phone_email_password_d1',
      timestamp: new Date().toISOString(),
    });
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

    const actorKey = `${req.ip || 'unknown'}:${sessionId}:${type}`;
    const burst = burstWindow.get(actorKey);
    const maxPerMinute = type === 'click' ? 12 : 45;
    if (burst && now < burst.resetAt) {
      if (burst.count >= maxPerMinute) {
        if (type === 'click') {
          adAnalyticsState.blockedFakeClicks += 1;
          saveAnalytics(adAnalyticsState);
        }
        res.status(429).json({ ok: false, deduplicated: true, reason: 'Rate limit exceeded' });
        return;
      }
      burst.count += 1;
    } else {
      burstWindow.set(actorKey, { count: 1, resetAt: now + 60000 });
    }

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

  // Server-authorized Ad Analytics (verified via HTTP-only session cookie RBAC)
  app.get('/api/ads/analytics', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved || (resolved.user.role !== 'admin' && resolved.user.role !== 'super_admin')) {
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
    } catch {
      res.status(403).json({ error: 'Administrator authorization required' });
    }
  });

  // S2S Ad Network Postback verification endpoint
  const handlePostback = (req: express.Request, res: express.Response) => {
    const providerRaw = String(req.params.provider || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
    const envSecretKey = `AD_POSTBACK_SECRET_${providerRaw.toUpperCase()}`;
    const configuredSecret = (
      getRuntimeEnvVar(envSecretKey) || getRuntimeEnvVar('WATCH_EARN_S2S_SECRET')
    ).trim();

    if (!isConfiguredEnvValue(configuredSecret)) {
      res.status(503).json({
        ok: false,
        error: `S2S postback secret not configured for provider "${providerRaw}".`,
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
    if (!sessionToken || !providerEventId || !providedSig) {
      res.status(400).json({ error: 'session_token, event_id, and sig/secret are required' });
      return;
    }

    const expectedHmac = crypto
      .createHmac('sha256', configuredSecret)
      .update(`${providerRaw}:${sessionToken}:${providerEventId}`)
      .digest('hex');

    const matchesHmac =
      providedSig.length === expectedHmac.length &&
      crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedHmac));
    const matchesDirect =
      providedSig.length === configuredSecret.length &&
      crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(configuredSecret));

    if (!matchesHmac && !matchesDirect) {
      res.status(403).json({ error: 'Invalid postback signature' });
      return;
    }

    res.json({ ok: true, recorded: true, provider: providerRaw, sessionToken });
  };
  app.get('/api/ads/postback/:provider', handlePostback);
  app.post('/api/ads/postback/:provider', handlePostback);

  // Mount Phone + Password Authentication, Sessions, Customer Account, Wallet, Orders & Admin Router
  app.use('/api', createPhoneAuthAndAppRouter());

  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, error: 'API endpoint not found' });
  });

  return app;
}
