import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { initPWAInstallCapture, reportSwUpdateAvailable } from './hooks/usePWAInstall.ts';
import './index.css';

// Capture `beforeinstallprompt` and `appinstalled` before React mounts
initPWAInstallCapture();

// Register Service Worker on web (skip inside native Capacitor shell)
if (!Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      reportSwUpdateAvailable(updateSW);
    },
    onRegisterError(error) {
      console.warn('PWA Service Worker registration failed:', error);
    },
  });
}

async function initNativeAndroidShell() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const [{ StatusBar, Style }, { SplashScreen }, { App: CapApp }] = await Promise.all([
      import('@capacitor/status-bar'),
      import('@capacitor/splash-screen'),
      import('@capacitor/app'),
    ]);

    await StatusBar.setBackgroundColor({ color: '#172033' }).catch(() => {});
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
    await SplashScreen.hide().catch(() => {});

    CapApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        CapApp.exitApp();
      }
    }).catch(() => {});
  } catch {
    // Web fallback ignores native Capacitor bridge errors
  }
}

void initNativeAndroidShell();

createRoot(document.getElementById('root')!).render(<App />);
