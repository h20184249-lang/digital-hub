import { Capacitor } from '@capacitor/core';

const DEFAULT_REMOTE_API_ORIGIN =
  import.meta.env.VITE_API_BASE_URL ||
  'https://ais-pre-dl2jj6tadnbvqjdv56jzw4-957575354594.asia-southeast1.run.app';

export function isNativeAndroidApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function apiUrl(path: string): string {
  if (!path.startsWith('/')) return path;
  if (isNativeAndroidApp()) {
    const base = String(DEFAULT_REMOTE_API_ORIGIN || '').replace(/\/+$/, '');
    return base ? `${base}${path}` : path;
  }
  return path;
}
