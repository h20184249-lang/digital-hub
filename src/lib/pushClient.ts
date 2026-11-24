import { apiUrl } from './apiClient';
import { PushDeviceRecord, PushNotificationPreferences } from '../types/marketplace';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

async function getActiveRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Worker is not supported on this browser.');
  }
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) {
    return await navigator.serviceWorker.ready;
  }
  try {
    await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return await navigator.serviceWorker.ready;
  } catch {
    await navigator.serviceWorker.register('/push-sw.js', { scope: '/' });
    return await navigator.serviceWorker.ready;
  }
}

export async function getExistingSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) return null;
    return await reg.pushManager.getSubscription();
  } catch {
    return null;
  }
}

export async function fetchVapidPublicKey(): Promise<string> {
  const resp = await fetch(apiUrl('/api/push/public-key'), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; publicKey?: string; error?: string };
  if (!resp.ok || !data.publicKey) {
    throw new Error(data.error || 'Could not load Web Push public key.');
  }
  return data.publicKey;
}

export async function requestAndSubscribePush(options?: {
  isAdminDevice?: boolean;
  deviceLabel?: string;
}): Promise<{ endpoint: string; isAdminDevice: boolean }> {
  if (!isPushSupported()) {
    throw new Error('Push notifications require a modern browser with Service Worker support.');
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notification permission is blocked in browser settings. Please allow notifications to receive instant alerts.'
        : 'Notification permission was not granted.'
    );
  }

  const [publicKey, reg] = await Promise.all([fetchVapidPublicKey(), getActiveRegistration()]);
  let sub = await reg.pushManager.getSubscription();

  if (!sub) {
    const appServerKey = urlBase64ToUint8Array(publicKey);
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appServerKey.buffer.slice(
        appServerKey.byteOffset,
        appServerKey.byteOffset + appServerKey.byteLength
      ) as ArrayBuffer,
    });
  }

  const json = sub.toJSON();
  const endpoint = json.endpoint || sub.endpoint;
  const p256dh = json.keys?.p256dh || '';
  const auth = json.keys?.auth || '';
  if (!endpoint || !p256dh || !auth) {
    throw new Error('Browser failed to produce push encryption keys.');
  }

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const defaultLabel = /Android|iPhone|iPad|Mobile/i.test(ua)
    ? options?.isAdminDevice
      ? 'Admin Mobile PWA'
      : 'Customer Mobile'
    : options?.isAdminDevice
      ? 'Admin Desktop Browser'
      : 'Customer Desktop';

  const resp = await fetch(apiUrl('/api/push/subscribe'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      endpoint,
      keys: { p256dh, auth },
      isAdminDevice: Boolean(options?.isAdminDevice),
      deviceLabel: options?.deviceLabel || defaultLabel,
      platform: /Android/i.test(ua) ? 'android' : 'web',
    }),
  });
  const resData = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    isAdminDevice?: boolean;
    error?: string;
  };
  if (!resp.ok || resData.ok === false) {
    throw new Error(resData.error || 'Failed to register device for push alerts.');
  }

  return { endpoint, isAdminDevice: Boolean(resData.isAdminDevice) };
}

export async function unsubscribePush(): Promise<void> {
  const existing = await getExistingSubscription();
  const endpoint = existing?.endpoint || '';
  if (existing) {
    await existing.unsubscribe().catch(() => {});
  }
  await fetch(apiUrl('/api/push/subscribe'), {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ endpoint }),
  });
}

export async function fetchPushPreferences(): Promise<PushNotificationPreferences> {
  const resp = await fetch(apiUrl('/api/push/preferences'), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    preferences?: PushNotificationPreferences;
    error?: string;
  };
  if (!resp.ok || !data.preferences) {
    throw new Error(data.error || 'Failed to load notification preferences.');
  }
  return data.preferences;
}

export async function savePushPreferences(
  prefs: Partial<Omit<PushNotificationPreferences, 'userId' | 'updatedAt'>>
): Promise<PushNotificationPreferences> {
  const resp = await fetch(apiUrl('/api/push/preferences'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(prefs),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    preferences?: PushNotificationPreferences;
    error?: string;
  };
  if (!resp.ok || !data.preferences) {
    throw new Error(data.error || 'Failed to update notification preferences.');
  }
  return data.preferences;
}

export async function fetchAdminPushDevices(): Promise<PushDeviceRecord[]> {
  const resp = await fetch(apiUrl('/api/admin/push/devices'), {
    method: 'GET',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    devices?: PushDeviceRecord[];
    error?: string;
  };
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to load registered admin devices.');
  }
  return Array.isArray(data.devices) ? data.devices : [];
}

export async function sendAdminTestPush(): Promise<{ sent: number; failed: number; deactivated: number }> {
  const resp = await fetch(apiUrl('/api/admin/push/test'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({}),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    sent?: number;
    failed?: number;
    deactivated?: number;
    error?: string;
  };
  if (!resp.ok || data.ok === false) {
    throw new Error(data.error || 'Failed to send test push alert.');
  }
  return {
    sent: Number(data.sent || 0),
    failed: Number(data.failed || 0),
    deactivated: Number(data.deactivated || 0),
  };
}

export async function deleteAdminPushDevice(id: string): Promise<void> {
  const resp = await fetch(apiUrl(`/api/admin/push/devices/${encodeURIComponent(id)}`), {
    method: 'DELETE',
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!resp.ok) {
    const data = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Failed to remove admin device.');
  }
}
