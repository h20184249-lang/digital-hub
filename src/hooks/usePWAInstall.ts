import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type InstallListener = () => void;

let capturedDeferredPrompt: BeforeInstallPromptEvent | null = null;
let capturedJustInstalled = false;
let captureInitialized = false;
const listeners = new Set<InstallListener>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

export function detectStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    nav.standalone === true ||
    document.referrer.startsWith('android-app://')
  );
}

/**
 * Call once at application boot (main.tsx) so early `beforeinstallprompt`
 * events fired before React mounts are never lost.
 */
export function initPWAInstallCapture(): void {
  if (captureInitialized || typeof window === 'undefined') return;
  captureInitialized = true;

  window.addEventListener('beforeinstallprompt', (event: Event) => {
    event.preventDefault();
    capturedDeferredPrompt = event as BeforeInstallPromptEvent;
    notifyListeners();
  });

  window.addEventListener('appinstalled', () => {
    capturedDeferredPrompt = null;
    capturedJustInstalled = true;
    notifyListeners();
  });
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(
    () => capturedDeferredPrompt
  );
  const [isStandalone, setIsStandalone] = useState<boolean>(() => detectStandaloneMode());
  const [justInstalled, setJustInstalled] = useState<boolean>(() => capturedJustInstalled);
  const [hasRelatedInstalledApp, setHasRelatedInstalledApp] = useState<boolean>(false);
  const [isInstalling, setIsInstalling] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [isAndroid, setIsAndroid] = useState<boolean>(false);

  useEffect(() => {
    initPWAInstallCapture();

    const syncFromStore = () => {
      setDeferredPrompt(capturedDeferredPrompt);
      setJustInstalled(capturedJustInstalled);
      setIsStandalone(detectStandaloneMode());
    };

    listeners.add(syncFromStore);
    syncFromStore();

    // Detect device platform accurately (including iPadOS desktop-mode UA)
    const ua = window.navigator.userAgent.toLowerCase();
    const isIPadOS =
      window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
    setIsIOS(/iphone|ipad|ipod/.test(ua) || isIPadOS);
    setIsAndroid(/android/.test(ua));

    // Listen for live display-mode transitions (e.g., opening in standalone window)
    const mql = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = () => setIsStandalone(detectStandaloneMode());
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handleDisplayModeChange);
    }

    // Check installed related apps on Android Chrome when available
    const navWithRelated = window.navigator as Navigator & {
      getInstalledRelatedApps?: () => Promise<Array<{ platform?: string; url?: string }>>;
    };
    if (typeof navWithRelated.getInstalledRelatedApps === 'function') {
      navWithRelated
        .getInstalledRelatedApps()
        .then((apps) => {
          if (Array.isArray(apps) && apps.length > 0) {
            setHasRelatedInstalledApp(true);
          }
        })
        .catch(() => {
          // Ignore unsupported browser errors
        });
    }

    return () => {
      listeners.delete(syncFromStore);
      if (typeof mql.removeEventListener === 'function') {
        mql.removeEventListener('change', handleDisplayModeChange);
      }
    };
  }, []);

  const install = useCallback(async (): Promise<'accepted' | 'dismissed' | 'unavailable'> => {
    const promptEvent = capturedDeferredPrompt || deferredPrompt;
    if (!promptEvent) return 'unavailable';
    try {
      setIsInstalling(true);
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        capturedDeferredPrompt = null;
        capturedJustInstalled = true;
        setDeferredPrompt(null);
        setJustInstalled(true);
        notifyListeners();
        return 'accepted';
      }
      return 'dismissed';
    } catch {
      return 'unavailable';
    } finally {
      setIsInstalling(false);
    }
  }, [deferredPrompt]);

  const isInstalled = isStandalone || justInstalled || hasRelatedInstalledApp;

  return {
    isInstallable: Boolean(deferredPrompt) && !isInstalled,
    isInstalled,
    isStandalone,
    justInstalled,
    isInstalling,
    isIOS,
    isAndroid,
    install,
  };
}

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
