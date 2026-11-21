import express from 'express';
import crypto from 'node:crypto';
import { getAppDatabase, getRuntimeEnvVar } from './db.ts';
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

interface AdStatsRow {
  ad_id: string;
  ad_format: string;
  impressions: number;
  clicks: number;
  blocked_clicks: number;
  by_placement_json: string;
  last_event_at: number;
}

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
  app.use(createJsonBodyParser(4 * 1024 * 1024));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    const cspDirectives = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "font-src 'self' data: https:",
      "img-src 'self' data: blob: https:",
      "media-src 'self' data: blob: https:",
      "connect-src 'self' https:",
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
  app.use('/api/auth', applyApiRateLimit('auth', 60, 60000));
  app.use('/api/admin', applyApiRateLimit('admin', 180, 60000));

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'DIGITAL HUB API',
      authMode: 'phone_email_password_d1',
      timestamp: new Date().toISOString(),
    });
  });

  // Track real ad impressions and clicks persisted in Cloudflare D1 / SQLite `ad_stats`
  app.post('/api/ads/track', async (req, res) => {
    const body = (req.body || {}) as {
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

    const recordBlockedClick = async () => {
      try {
        const db = await getAppDatabase();
        await db.run(
          `INSERT INTO ad_stats (ad_id, ad_format, impressions, clicks, blocked_clicks, by_placement_json, last_event_at)
           VALUES (?, ?, 0, 0, 1, '{}', ?)
           ON CONFLICT(ad_id) DO UPDATE SET blocked_clicks = blocked_clicks + 1, last_event_at = excluded.last_event_at`,
          [adId, adFormat, now]
        );
      } catch {
        // non-fatal
      }
    };

    const actorKey = `${req.ip || 'unknown'}:${sessionId}:${type}`;
    const burst = burstWindow.get(actorKey);
    const maxPerMinute = type === 'click' ? 12 : 45;
    if (burst && now < burst.resetAt) {
      if (burst.count >= maxPerMinute) {
        if (type === 'click') await recordBlockedClick();
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
      if (type === 'click') await recordBlockedClick();
      let counts = { impressions: 0, clicks: 0 };
      try {
        const db = await getAppDatabase();
        const existing = await db.first<{ impressions: number; clicks: number }>(
          'SELECT impressions, clicks FROM ad_stats WHERE ad_id = ?',
          [adId]
        );
        if (existing) {
          counts = { impressions: Number(existing.impressions || 0), clicks: Number(existing.clicks || 0) };
        }
      } catch {
        // ignore
      }
      res.json({ ok: true, deduplicated: true, adId, type, counts });
      return;
    }
    recentAdEvents.set(dedupKey, now);

    try {
      const db = await getAppDatabase();
      const existing = await db.first<AdStatsRow>(
        'SELECT ad_id, ad_format, impressions, clicks, blocked_clicks, by_placement_json, last_event_at FROM ad_stats WHERE ad_id = ?',
        [adId]
      );
      let byPlacement: Record<string, { impressions: number; clicks: number }> = {};
      if (existing?.by_placement_json) {
        try {
          byPlacement = JSON.parse(existing.by_placement_json) as Record<
            string,
            { impressions: number; clicks: number }
          >;
        } catch {
          byPlacement = {};
        }
      }
      if (!byPlacement[placement]) byPlacement[placement] = { impressions: 0, clicks: 0 };
      let nextImpressions = Number(existing?.impressions || 0);
      let nextClicks = Number(existing?.clicks || 0);
      if (type === 'impression') {
        nextImpressions += 1;
        byPlacement[placement].impressions += 1;
      } else {
        nextClicks += 1;
        byPlacement[placement].clicks += 1;
      }

      await db.run(
        `INSERT INTO ad_stats (ad_id, ad_format, impressions, clicks, blocked_clicks, by_placement_json, last_event_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(ad_id) DO UPDATE SET
           ad_format = excluded.ad_format,
           impressions = excluded.impressions,
           clicks = excluded.clicks,
           by_placement_json = excluded.by_placement_json,
           last_event_at = excluded.last_event_at`,
        [
          adId,
          adFormat,
          nextImpressions,
          nextClicks,
          Number(existing?.blocked_clicks || 0),
          JSON.stringify(byPlacement),
          now,
        ]
      );

      res.json({
        ok: true,
        deduplicated: false,
        adId,
        type,
        counts: { impressions: nextImpressions, clicks: nextClicks },
      });
    } catch {
      res.json({ ok: true, deduplicated: false, adId, type, counts: { impressions: 0, clicks: 0 } });
    }
  });

  // Server-authorized Ad Analytics (verified via HTTP-only session cookie RBAC, read from D1/SQLite)
  app.get('/api/ads/analytics', async (req, res) => {
    try {
      const resolved = await resolveSessionFromRequest(req);
      if (!resolved || (resolved.user.role !== 'admin' && resolved.user.role !== 'super_admin')) {
        res.status(403).json({ error: 'Administrator authorization required' });
        return;
      }
      const rows = await resolved.db.all<AdStatsRow>(
        'SELECT ad_id, ad_format, impressions, clicks, blocked_clicks, by_placement_json, last_event_at FROM ad_stats'
      );
      let totalImpressions = 0;
      let totalClicks = 0;
      let blockedFakeClicks = 0;
      const byFormat: Record<string, { impressions: number; clicks: number }> = {};
      const byAd: Record<
        string,
        {
          impressions: number;
          clicks: number;
          byPlacement: Record<string, { impressions: number; clicks: number }>;
          lastEventAt: string;
        }
      > = {};

      for (const r of rows) {
        const imp = Number(r.impressions || 0);
        const clk = Number(r.clicks || 0);
        const blk = Number(r.blocked_clicks || 0);
        totalImpressions += imp;
        totalClicks += clk;
        blockedFakeClicks += blk;
        const fmt = r.ad_format || 'direct_link';
        if (!byFormat[fmt]) byFormat[fmt] = { impressions: 0, clicks: 0 };
        byFormat[fmt].impressions += imp;
        byFormat[fmt].clicks += clk;
        let byPlacement: Record<string, { impressions: number; clicks: number }> = {};
        try {
          byPlacement = JSON.parse(r.by_placement_json || '{}');
        } catch {
          byPlacement = {};
        }
        byAd[r.ad_id] = {
          impressions: imp,
          clicks: clk,
          byPlacement,
          lastEventAt: r.last_event_at ? new Date(r.last_event_at).toISOString() : '',
        };
      }

      const ctr = totalImpressions > 0 ? Number(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0;
      res.json({
        totalImpressions,
        totalClicks,
        ctr,
        blockedFakeClicks,
        byFormat,
        byAd,
      });
    } catch {
      res.status(403).json({ error: 'Administrator authorization required' });
    }
  });

  // S2S Ad Network Postback verification endpoint (atomically credits verified sessions in D1/SQLite)
  const handlePostback = async (req: express.Request, res: express.Response) => {
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

    try {
      const db = await getAppDatabase();
      const sessionRow = await db.first<{
        id: string;
        user_id: string;
        status: string;
        payload_json: string;
      }>('SELECT id, user_id, status, payload_json FROM ad_viewing_sessions WHERE session_token = ? LIMIT 1', [
        sessionToken,
      ]);

      if (!sessionRow) {
        res.status(404).json({ ok: false, error: 'Session token not found' });
        return;
      }

      if (String(sessionRow.status || '').toLowerCase() === 'credited') {
        res.json({ ok: true, recorded: true, alreadyCredited: true, provider: providerRaw, sessionToken });
        return;
      }

      const settingsRow = await db.first<{ payload_json: string }>(
        `SELECT payload_json FROM catalog_overrides WHERE collection = 'settings' AND doc_id = 'global' AND deleted = 0 LIMIT 1`
      );
      let settingsObj: Record<string, unknown> = {};
      if (settingsRow?.payload_json) {
        try {
          settingsObj = JSON.parse(settingsRow.payload_json) as Record<string, unknown>;
        } catch {
          settingsObj = {};
        }
      }
      const coinsPerAd = Math.max(1, Math.floor(Number(settingsObj.watchEarnCoinsPerAd ?? 5) || 5));
      const coinsPerBdt = Math.max(1, Number(settingsObj.watchEarnCoinsPerBdt ?? 10) || 10);

      // Duplicate provider event ID prevention across all sessions
      const dupEvent = await db.first<{ id: string }>(
        `SELECT id FROM ad_viewing_sessions WHERE json_extract(payload_json, '$.providerEventId') = ? LIMIT 1`,
        [providerEventId]
      );
      if (dupEvent) {
        res.json({
          ok: true,
          recorded: true,
          alreadyCredited: true,
          credited: false,
          coinsAwarded: 0,
          provider: providerRaw,
          sessionToken,
        });
        return;
      }

      let payloadObj: Record<string, unknown> = {};
      try {
        payloadObj = JSON.parse(sessionRow.payload_json || '{}') as Record<string, unknown>;
      } catch {
        payloadObj = {};
      }
      const now = Date.now();
      const rewardCoins = Math.max(1, Math.floor(Number(payloadObj.rewardCoins || coinsPerAd) || coinsPerAd));
      const updatedPayload = {
        ...payloadObj,
        status: 'credited',
        coinsAwarded: rewardCoins,
        providerEventId,
        verifiedAt: now,
        creditedAt: new Date(now).toISOString(),
        updatedAt: now,
      };

      const upd = await db.run(
        `UPDATE ad_viewing_sessions
         SET status = 'credited', payload_json = ?, updated_at = ?
         WHERE id = ? AND LOWER(status) IN ('watching', 'pending', 'awaiting_callback', 'initiated')`,
        [JSON.stringify(updatedPayload), now, sessionRow.id]
      );

      if (upd.changes > 0) {
        await db.run(
          `INSERT INTO watch_earn_balances (user_id, coins_available, coins_lifetime_earned, coins_redeemed, updated_at)
           VALUES (?, ?, ?, 0, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             coins_available = coins_available + excluded.coins_available,
             coins_lifetime_earned = coins_lifetime_earned + excluded.coins_lifetime_earned,
             updated_at = excluded.updated_at`,
          [sessionRow.user_id, rewardCoins, rewardCoins, now]
        );
        const rtxId = `rtx_${now.toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
        const bdtEquivalent = Number((rewardCoins / coinsPerBdt).toFixed(2));
        const unitIdStr = String(payloadObj.unitId || providerRaw.toUpperCase());
        const adTitleStr = String(payloadObj.adTitle || `Reward Ad (${unitIdStr})`);
        const rtxPayload = {
          id: rtxId,
          sessionId: sessionRow.id,
          userId: sessionRow.user_id,
          userEmail: String(payloadObj.userEmail || ''),
          unitId: unitIdStr,
          adTitle: adTitleStr,
          provider: String(payloadObj.provider || providerRaw.toUpperCase()),
          type: 'watch_earn_credit',
          coins: rewardCoins,
          bdtEquivalent,
          status: 'Credited',
          note: `S2S verified reward: ${adTitleStr} (+${rewardCoins} coins)`,
          createdAt: now,
        };
        await db.run(
          `INSERT INTO ad_reward_transactions (id, user_id, type, status, coins, payload_json, created_at)
           VALUES (?, ?, 'watch_earn_credit', 'Credited', ?, ?, ?)`,
          [rtxId, sessionRow.user_id, rewardCoins, JSON.stringify(rtxPayload), now]
        );
      }

      res.json({
        ok: true,
        recorded: true,
        credited: upd.changes > 0,
        coinsAwarded: upd.changes > 0 ? rewardCoins : 0,
        provider: providerRaw,
        sessionToken,
      });
    } catch {
      res.status(500).json({ ok: false, error: 'Failed to settle S2S postback' });
    }
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
