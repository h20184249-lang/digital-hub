import { Capacitor } from '@capacitor/core';

const NATIVE_FALLBACK_API_ORIGIN =
  'https://ais-pre-dl2jj6tadnbvqjdv56jzw4-957575354594.asia-southeast1.run.app';

function resolveConfiguredApiOrigin(): string {
  const raw = (import.meta.env.VITE_API_BASE_URL || '').trim();
  if (!raw) return '';
  const upper = raw.toUpperCase();
  if (
    upper.includes('YOUR_') ||
    upper.includes('REPLACE_') ||
    upper.includes('MY_') ||
    upper.includes('EXAMPLE.COM') ||
    upper.includes('CHANGEME')
  ) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.origin;
  } catch {
    return '';
  }
}

const CONFIGURED_API_ORIGIN = resolveConfiguredApiOrigin();

export function isNativeAndroidApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  if (CONFIGURED_API_ORIGIN) {
    return `${CONFIGURED_API_ORIGIN}${path}`;
  }
  if (isNativeAndroidApp()) {
    const base = NATIVE_FALLBACK_API_ORIGIN.replace(/\/+$/, '');
    return base ? `${base}${path}` : path;
  }
  return path;
}
