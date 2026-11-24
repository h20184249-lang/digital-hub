import { SignJWT, importPKCS8 } from 'jose';
import { AppDatabase, getRuntimeEnvVar } from './db.ts';
import { generateSecureId } from './authCrypto.ts';

export type NotificationPreferenceKey =
  | 'new_offers'
  | 'important_announcements'
  | 'service_updates'
  | 'order_notifications'
  | 'payment_notifications'
  | 'account_notifications';

export interface NotificationPreferencesRecord {
  userId: string;
  newOffers: boolean;
  importantAnnouncements: boolean;
  serviceUpdates: boolean;
  orderNotifications: boolean;
  paymentNotifications: boolean;
  accountNotifications: boolean;
  updatedAt: number;
}

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  role: string;
  is_admin_device: number;
  device_label: string;
  platform: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  fcm_token: string;
  user_agent: string;
  active: number;
  last_success_at: number;
  last_error: string;
  created_at: number;
  updated_at: number;
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  icon?: string;
  badge?: string;
  orderId?: string;
  category?: string;
  requireInteraction?: boolean;
  data?: Record<string, unknown>;
}

interface StoredVapidKeys {
  publicKey: string;
  privateKey: string;
  privateJwk: JsonWebKey;
  subject: string;
  createdAt: number;
}

const textEncoder = new TextEncoder();
let cachedVapidConfig: StoredVapidKeys | null = null;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(str: string): Uint8Array {
  const normalized = str.trim().replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + pad);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function hmacSha256(keyBytes: Uint8Array, dataBytes: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign(
    'HMAC',
    key,
    dataBytes.buffer.slice(dataBytes.byteOffset, dataBytes.byteOffset + dataBytes.byteLength) as ArrayBuffer
  );
  return new Uint8Array(sig);
}

async function generateVapidKeyPair(): Promise<StoredVapidKeys> {
  const kp = (await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;

  const rawPub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const privateJwk = (await crypto.subtle.exportKey('jwk', kp.privateKey)) as JsonWebKey;
  const publicKey = bytesToBase64Url(rawPub);
  const privateKey = String(privateJwk.d || '');
  const subject = getRuntimeEnvVar('VAPID_SUBJECT') || 'mailto:support@digitalhubbd.com';

  return {
    publicKey,
    privateKey,
    privateJwk,
    subject,
    createdAt: Date.now(),
  };
}

function buildJwkFromRawEnv(publicKeyB64Url: string, privateKeyB64Url: string): JsonWebKey | null {
  try {
    const pubBytes = base64UrlToBytes(publicKeyB64Url);
    if (pubBytes.length !== 65 || pubBytes[0] !== 0x04) return null;
    const x = bytesToBase64Url(pubBytes.slice(1, 33));
    const y = bytesToBase64Url(pubBytes.slice(33, 65));
    return {
      kty: 'EC',
      crv: 'P-256',
      x,
      y,
      d: privateKeyB64Url.trim(),
      ext: true,
    };
  } catch {
    return null;
  }
}

export async function getOrCreateVapidConfig(db: AppDatabase): Promise<StoredVapidKeys> {
  const envPublic = getRuntimeEnvVar('VAPID_PUBLIC_KEY').trim();
  const envPrivate = getRuntimeEnvVar('VAPID_PRIVATE_KEY').trim();
  const envSubject = getRuntimeEnvVar('VAPID_SUBJECT').trim() || 'mailto:support@digitalhubbd.com';

  if (envPublic && envPrivate) {
    const envJwk = buildJwkFromRawEnv(envPublic, envPrivate);
    if (envJwk) {
      cachedVapidConfig = {
        publicKey: envPublic,
        privateKey: envPrivate,
        privateJwk: envJwk,
        subject: envSubject,
        createdAt: 0,
      };
      return cachedVapidConfig;
    }
  }

  if (cachedVapidConfig) return cachedVapidConfig;

  const row = await db.first<{ payload_json: string }>(
    `SELECT payload_json FROM catalog_overrides WHERE collection = 'system_secrets' AND doc_id = 'vapid_keys' AND deleted = 0 LIMIT 1`
  );
  if (row?.payload_json) {
    try {
      const parsed = JSON.parse(row.payload_json) as StoredVapidKeys;
      if (parsed.publicKey && parsed.privateJwk?.d) {
        cachedVapidConfig = {
          ...parsed,
          subject: envSubject || parsed.subject || 'mailto:support@digitalhubbd.com',
        };
        return cachedVapidConfig;
      }
    } catch {
      // regenerate below
    }
  }

  const generated = await generateVapidKeyPair();
  await db.run(
    `INSERT INTO catalog_overrides (collection, doc_id, deleted, payload_json, updated_at)
     VALUES ('system_secrets', 'vapid_keys', 0, ?, ?)
     ON CONFLICT(collection, doc_id) DO UPDATE SET
       deleted = 0,
       payload_json = excluded.payload_json,
       updated_at = excluded.updated_at`,
    [JSON.stringify(generated), Date.now()]
  );
  cachedVapidConfig = generated;
  return generated;
}

async function createVapidJwt(audience: string, config: StoredVapidKeys): Promise<string> {
  const header = bytesToBase64Url(textEncoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const payload = bytesToBase64Url(
    textEncoder.encode(
      JSON.stringify({
        aud: audience,
        exp,
        sub: config.subject || 'mailto:support@digitalhubbd.com',
      })
    )
  );
  const signingInput = `${header}.${payload}`;
  const signingKey = await crypto.subtle.importKey(
    'jwk',
    config.privateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      signingKey,
      textEncoder.encode(signingInput)
    )
  );
  return `${signingInput}.${bytesToBase64Url(sig)}`;
}

async function encryptRfc8291Payload(
  uaPublicB64Url: string,
  authSecretB64Url: string,
  plaintextJson: string
): Promise<Uint8Array> {
  const uaPublic = base64UrlToBytes(uaPublicB64Url);
  const authSecret = base64UrlToBytes(authSecretB64Url);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) {
    throw new Error('Invalid client p256dh key');
  }
  if (authSecret.length < 12) {
    throw new Error('Invalid client auth secret');
  }

  const ephemeral = (await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits']
  )) as CryptoKeyPair;

  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic.buffer.slice(uaPublic.byteOffset, uaPublic.byteOffset + uaPublic.byteLength) as ArrayBuffer,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256)
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyInfo = concatBytes(textEncoder.encode('WebPush: info\0'), uaPublic, asPublic);
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const ikm = (await hmacSha256(prkKey, concatBytes(keyInfo, new Uint8Array([1])))).slice(0, 32);

  const prk = await hmacSha256(salt, ikm);
  const cekInfo = concatBytes(textEncoder.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1]));
  const cekBytes = (await hmacSha256(prk, cekInfo)).slice(0, 16);

  const nonceInfo = concatBytes(textEncoder.encode('Content-Encoding: nonce\0'), new Uint8Array([1]));
  const nonceBytes = (await hmacSha256(prk, nonceInfo)).slice(0, 12);

  const plaintextBytes = textEncoder.encode(plaintextJson);
  const paddedPlaintext = concatBytes(plaintextBytes, new Uint8Array([2]));

  const aesKey = await crypto.subtle.importKey(
    'raw',
    cekBytes.buffer.slice(cekBytes.byteOffset, cekBytes.byteOffset + cekBytes.byteLength) as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonceBytes.buffer.slice(nonceBytes.byteOffset, nonceBytes.byteOffset + nonceBytes.byteLength) as ArrayBuffer,
        tagLength: 128,
      },
      aesKey,
      paddedPlaintext.buffer.slice(
        paddedPlaintext.byteOffset,
        paddedPlaintext.byteOffset + paddedPlaintext.byteLength
      ) as ArrayBuffer
    )
  );

  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, 4096, false);
  const header = concatBytes(salt, rsBytes, new Uint8Array([asPublic.length]), asPublic);
  return concatBytes(header, ciphertext);
}

interface FirebaseServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

let cachedFcmToken: { token: string; expiresAt: number } | null = null;

async function getFcmAccessToken(sa: FirebaseServiceAccount): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedFcmToken && cachedFcmToken.expiresAt > nowSec + 60) {
    return cachedFcmToken.token;
  }
  const key = await importPKCS8(sa.private_key, 'RS256');
  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(nowSec)
    .setExpirationTime(nowSec + 3600)
    .sign(key);

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!resp.ok) {
    throw new Error(`FCM OAuth token error (${resp.status})`);
  }
  const data = (await resp.json()) as { access_token: string; expires_in?: number };
  cachedFcmToken = {
    token: data.access_token,
    expiresAt: nowSec + Number(data.expires_in || 3500),
  };
  return data.access_token;
}

async function sendFcmMessage(token: string, payload: PushPayload): Promise<{ ok: boolean; status: number; error?: string }> {
  const rawSa = getRuntimeEnvVar('FIREBASE_SERVICE_ACCOUNT_JSON').trim();
  if (!rawSa) {
    return { ok: false, status: 501, error: 'FCM service account not configured' };
  }
  let sa: FirebaseServiceAccount;
  try {
    sa = JSON.parse(rawSa) as FirebaseServiceAccount;
  } catch {
    return { ok: false, status: 500, error: 'Invalid FIREBASE_SERVICE_ACCOUNT_JSON' };
  }
  const accessToken = await getFcmAccessToken(sa);
  const fcmResp = await fetch(
    `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token,
          notification: {
            title: payload.title,
            body: payload.body,
          },
          webpush: {
            fcm_options: {
              link: payload.url || '/',
            },
            notification: {
              icon: payload.icon || '/pwa-192x192.png',
              badge: payload.badge || '/pwa-192x192.png',
              tag: payload.tag || 'digitalhub-alert',
              requireInteraction: Boolean(payload.requireInteraction),
            },
          },
          data: {
            url: String(payload.url || '/'),
            orderId: String(payload.orderId || ''),
            category: String(payload.category || 'system'),
          },
        },
      }),
    }
  );
  if (fcmResp.ok) {
    return { ok: true, status: fcmResp.status };
  }
  const errText = await fcmResp.text().catch(() => '');
  return { ok: false, status: fcmResp.status, error: errText.slice(0, 240) };
}

export async function getUserNotificationPreferences(
  db: AppDatabase,
  userId: string
): Promise<NotificationPreferencesRecord> {
  const row = await db.first<{
    user_id: string;
    new_offers: number;
    important_announcements: number;
    service_updates: number;
    order_notifications: number;
    payment_notifications: number;
    account_notifications: number;
    updated_at: number;
  }>('SELECT * FROM notification_preferences WHERE user_id = ? LIMIT 1', [userId]);

  if (!row) {
    return {
      userId,
      newOffers: true,
      importantAnnouncements: true,
      serviceUpdates: true,
      orderNotifications: true,
      paymentNotifications: true,
      accountNotifications: true,
      updatedAt: 0,
    };
  }
  return {
    userId: row.user_id,
    newOffers: row.new_offers !== 0,
    importantAnnouncements: row.important_announcements !== 0,
    serviceUpdates: row.service_updates !== 0,
    orderNotifications: row.order_notifications !== 0,
    paymentNotifications: row.payment_notifications !== 0,
    accountNotifications: row.account_notifications !== 0,
    updatedAt: Number(row.updated_at || 0),
  };
}

export async function saveUserNotificationPreferences(
  db: AppDatabase,
  userId: string,
  prefs: Partial<Omit<NotificationPreferencesRecord, 'userId' | 'updatedAt'>>
): Promise<NotificationPreferencesRecord> {
  const existing = await getUserNotificationPreferences(db, userId);
  const next: NotificationPreferencesRecord = {
    userId,
    newOffers: prefs.newOffers !== undefined ? Boolean(prefs.newOffers) : existing.newOffers,
    importantAnnouncements:
      prefs.importantAnnouncements !== undefined
        ? Boolean(prefs.importantAnnouncements)
        : existing.importantAnnouncements,
    serviceUpdates:
      prefs.serviceUpdates !== undefined ? Boolean(prefs.serviceUpdates) : existing.serviceUpdates,
    orderNotifications:
      prefs.orderNotifications !== undefined ? Boolean(prefs.orderNotifications) : existing.orderNotifications,
    paymentNotifications:
      prefs.paymentNotifications !== undefined
        ? Boolean(prefs.paymentNotifications)
        : existing.paymentNotifications,
    accountNotifications:
      prefs.accountNotifications !== undefined
        ? Boolean(prefs.accountNotifications)
        : existing.accountNotifications,
    updatedAt: Date.now(),
  };

  await db.run(
    `INSERT INTO notification_preferences (
       user_id, new_offers, important_announcements, service_updates,
       order_notifications, payment_notifications, account_notifications, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       new_offers = excluded.new_offers,
       important_announcements = excluded.important_announcements,
       service_updates = excluded.service_updates,
       order_notifications = excluded.order_notifications,
       payment_notifications = excluded.payment_notifications,
       account_notifications = excluded.account_notifications,
       updated_at = excluded.updated_at`,
    [
      userId,
      next.newOffers ? 1 : 0,
      next.importantAnnouncements ? 1 : 0,
      next.serviceUpdates ? 1 : 0,
      next.orderNotifications ? 1 : 0,
      next.paymentNotifications ? 1 : 0,
      next.accountNotifications ? 1 : 0,
      next.updatedAt,
    ]
  );
  return next;
}

export function mapNotificationTypeToPrefKey(type: string): NotificationPreferenceKey {
  switch (type) {
    case 'promo':
    case 'reward':
      return 'new_offers';
    case 'announcement':
      return 'important_announcements';
    case 'new_app':
    case 'app_update':
    case 'download':
      return 'service_updates';
    case 'order':
      return 'order_notifications';
    case 'payment':
    case 'wallet':
      return 'payment_notifications';
    default:
      return 'account_notifications';
  }
}

function isPrefAllowed(prefs: NotificationPreferencesRecord, key: NotificationPreferenceKey): boolean {
  switch (key) {
    case 'new_offers':
      return prefs.newOffers;
    case 'important_announcements':
      return prefs.importantAnnouncements;
    case 'service_updates':
      return prefs.serviceUpdates;
    case 'order_notifications':
      return prefs.orderNotifications;
    case 'payment_notifications':
      return prefs.paymentNotifications;
    case 'account_notifications':
      return prefs.accountNotifications;
  }
}

export async function sendPushToSubscriptions(
  db: AppDatabase,
  subscriptions: PushSubscriptionRow[],
  payload: PushPayload,
  options?: { dedupeKey?: string }
): Promise<{ sent: number; failed: number; deactivated: number; skippedDedupe?: boolean }> {
  if (subscriptions.length === 0) {
    return { sent: 0, failed: 0, deactivated: 0 };
  }

  const dedupeKey = options?.dedupeKey?.trim();
  if (dedupeKey) {
    const existing = await db.first<{ dedupe_key: string }>(
      'SELECT dedupe_key FROM push_dispatch_log WHERE dedupe_key = ? LIMIT 1',
      [dedupeKey]
    );
    if (existing) {
      return { sent: 0, failed: 0, deactivated: 0, skippedDedupe: true };
    }
    await db.run(
      'INSERT OR IGNORE INTO push_dispatch_log (dedupe_key, created_at) VALUES (?, ?)',
      [dedupeKey, Date.now()]
    );
  }

  const vapidConfig = await getOrCreateVapidConfig(db);
  const fullPayload: PushPayload = {
    title: payload.title.slice(0, 120),
    body: payload.body.slice(0, 400),
    url: payload.url || '/',
    tag: payload.tag || `dh-${generateSecureId('tag', 4)}`,
    icon: payload.icon || '/pwa-192x192.png',
    badge: payload.badge || '/pwa-192x192.png',
    orderId: payload.orderId || '',
    category: payload.category || 'system',
    requireInteraction: Boolean(payload.requireInteraction),
    data: {
      url: payload.url || '/',
      orderId: payload.orderId || '',
      category: payload.category || 'system',
      ...(payload.data || {}),
    },
  };
  const bodyJson = JSON.stringify(fullPayload);

  let sent = 0;
  let failed = 0;
  let deactivated = 0;
  const now = Date.now();

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        if (sub.fcm_token && (!sub.p256dh || !sub.auth)) {
          const fcmRes = await sendFcmMessage(sub.fcm_token, fullPayload);
          if (fcmRes.ok) {
            sent += 1;
            await db.run(
              `UPDATE push_subscriptions SET last_success_at = ?, last_error = '', updated_at = ? WHERE id = ?`,
              [now, now, sub.id]
            );
          } else {
            failed += 1;
            const isDead = fcmRes.status === 404 || fcmRes.status === 410 || (fcmRes.error || '').includes('UNREGISTERED');
            if (isDead) deactivated += 1;
            await db.run(
              `UPDATE push_subscriptions SET active = ?, last_error = ?, updated_at = ? WHERE id = ?`,
              [isDead ? 0 : 1, (fcmRes.error || `HTTP ${fcmRes.status}`).slice(0, 240), now, sub.id]
            );
          }
          return;
        }

        const endpointUrl = new URL(sub.endpoint);
        const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
        const jwt = await createVapidJwt(audience, vapidConfig);
        const encryptedBody = await encryptRfc8291Payload(sub.p256dh, sub.auth, bodyJson);

        const pushResp = await fetch(sub.endpoint, {
          method: 'POST',
          headers: {
            Authorization: `vapid t=${jwt}, k=${vapidConfig.publicKey}`,
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: '86400',
            Urgency: 'high',
          },
          body: encryptedBody.buffer.slice(
            encryptedBody.byteOffset,
            encryptedBody.byteOffset + encryptedBody.byteLength
          ) as ArrayBuffer,
        });

        if (pushResp.ok || pushResp.status === 201 || pushResp.status === 202) {
          sent += 1;
          await db.run(
            `UPDATE push_subscriptions SET last_success_at = ?, last_error = '', updated_at = ? WHERE id = ?`,
            [now, now, sub.id]
          );
        } else {
          failed += 1;
          const errText = await pushResp.text().catch(() => '');
          const isGone = pushResp.status === 404 || pushResp.status === 410;
          if (isGone) deactivated += 1;
          await db.run(
            `UPDATE push_subscriptions SET active = ?, last_error = ?, updated_at = ? WHERE id = ?`,
            [isGone ? 0 : 1, `HTTP ${pushResp.status}: ${errText}`.slice(0, 240), now, sub.id]
          );
        }
      } catch (err) {
        failed += 1;
        await db.run(
          `UPDATE push_subscriptions SET last_error = ?, updated_at = ? WHERE id = ?`,
          [err instanceof Error ? err.message.slice(0, 240) : 'Push send error', now, sub.id]
        );
      }
    })
  );

  return { sent, failed, deactivated };
}

export async function dispatchCustomerPush(
  db: AppDatabase,
  userId: string,
  notificationType: string,
  payload: PushPayload,
  dedupeKey?: string
): Promise<void> {
  try {
    const prefs = await getUserNotificationPreferences(db, userId);
    const prefKey = mapNotificationTypeToPrefKey(notificationType);
    if (!isPrefAllowed(prefs, prefKey)) return;

    const subs = await db.all<PushSubscriptionRow>(
      `SELECT * FROM push_subscriptions WHERE user_id = ? AND active = 1 LIMIT 20`,
      [userId]
    );
    if (subs.length === 0) return;

    await sendPushToSubscriptions(db, subs, payload, { dedupeKey });
  } catch {
    // Non-blocking push delivery
  }
}

export async function dispatchBroadcastPush(
  db: AppDatabase,
  userIds: string[],
  notificationType: string,
  payload: PushPayload,
  dedupePrefix?: string
): Promise<void> {
  try {
    if (userIds.length === 0) return;
    const prefKey = mapNotificationTypeToPrefKey(notificationType);
    const subs = await db.all<PushSubscriptionRow>(
      `SELECT * FROM push_subscriptions WHERE active = 1 LIMIT 500`
    );
    if (subs.length === 0) return;

    const targetSet = new Set(userIds);
    const prefRows = await db.all<{
      user_id: string;
      new_offers: number;
      important_announcements: number;
      service_updates: number;
      order_notifications: number;
      payment_notifications: number;
      account_notifications: number;
    }>('SELECT * FROM notification_preferences');

    const prefMap = new Map<string, NotificationPreferencesRecord>();
    for (const r of prefRows) {
      prefMap.set(r.user_id, {
        userId: r.user_id,
        newOffers: r.new_offers !== 0,
        importantAnnouncements: r.important_announcements !== 0,
        serviceUpdates: r.service_updates !== 0,
        orderNotifications: r.order_notifications !== 0,
        paymentNotifications: r.payment_notifications !== 0,
        accountNotifications: r.account_notifications !== 0,
        updatedAt: 0,
      });
    }

    const eligibleSubs = subs.filter((s) => {
      if (!targetSet.has(s.user_id)) return false;
      const p = prefMap.get(s.user_id);
      if (!p) return true;
      return isPrefAllowed(p, prefKey);
    });

    if (eligibleSubs.length > 0) {
      await sendPushToSubscriptions(db, eligibleSubs, payload, {
        dedupeKey: dedupePrefix ? `${dedupePrefix}_${notificationType}` : undefined,
      });
    }
  } catch {
    // Non-blocking broadcast push
  }
}

export async function dispatchAdminDevicesPush(
  db: AppDatabase,
  payload: PushPayload,
  dedupeKey?: string
): Promise<{ sent: number; failed: number; deactivated: number }> {
  try {
    const adminSubs = await db.all<PushSubscriptionRow>(
      `SELECT * FROM push_subscriptions WHERE is_admin_device = 1 AND active = 1 LIMIT 50`
    );
    if (adminSubs.length === 0) {
      return { sent: 0, failed: 0, deactivated: 0 };
    }
    return await sendPushToSubscriptions(db, adminSubs, payload, { dedupeKey });
  } catch {
    return { sent: 0, failed: 0, deactivated: 0 };
  }
}
