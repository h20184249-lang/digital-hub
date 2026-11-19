import { useEffect, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  MoreVertical,
  Share,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import type { Language } from '../types/marketplace';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface MobileAppDownloadCardProps {
  lang: Language;
  siteName?: string;
}

/** Crisp Google Play Store–inspired multi-color prism icon */
function PlayStoreIcon() {
  return (
    <svg
      viewBox="0 0 48 48"
      className="w-8 h-8 sm:w-9 sm:h-9 shrink-0"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="gpBlue" x1="6" y1="6" x2="26" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00C6FF" />
          <stop offset="100%" stopColor="#0072FF" />
        </linearGradient>
        <linearGradient id="gpGreen" x1="8" y1="6" x2="34" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#00E676" />
          <stop offset="100%" stopColor="#00BFA5" />
        </linearGradient>
        <linearGradient id="gpYellow" x1="27" y1="18" x2="43" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFD54F" />
          <stop offset="100%" stopColor="#FF9100" />
        </linearGradient>
        <linearGradient id="gpRed" x1="8" y1="42" x2="34" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF5252" />
          <stop offset="100%" stopColor="#D5004F" />
        </linearGradient>
      </defs>
      {/* Blue left vertical base */}
      <path
        d="M9.5 6.4C8.9 7 8.5 7.9 8.5 9.1V38.9C8.5 40.1 8.9 41 9.5 41.6L9.7 41.8L26.8 24.7V23.3L9.7 6.2L9.5 6.4Z"
        fill="url(#gpBlue)"
      />
      {/* Green top facet */}
      <path
        d="M32.5 17.6L26.8 23.3L9.7 6.2C10.5 5.4 11.9 5.3 13.5 6.2L32.5 17.6Z"
        fill="url(#gpGreen)"
      />
      {/* Red bottom facet */}
      <path
        d="M32.5 30.4L13.5 41.8C11.9 42.7 10.5 42.6 9.7 41.8L26.8 24.7L32.5 30.4Z"
        fill="url(#gpRed)"
      />
      {/* Yellow/Orange right tip */}
      <path
        d="M39.8 22.1C41.5 23.1 41.5 24.9 39.8 25.9L32.5 30.4L26.8 24.7V23.3L32.5 17.6L39.8 22.1Z"
        fill="url(#gpYellow)"
      />
    </svg>
  );
}

export function MobileAppDownloadCard({ lang, siteName }: MobileAppDownloadCardProps) {
  const {
    isInstallable,
    isInstalled,
    isStandalone,
    isInstalling,
    isIOS,
    install,
  } = usePWAInstall();
  const isOnline = useOnlineStatus();

  const [guideOpen, setGuideOpen] = useState(false);
  const [guideTab, setGuideTab] = useState<'android' | 'ios'>(isIOS ? 'ios' : 'android');

  useEffect(() => {
    setGuideTab(isIOS ? 'ios' : 'android');
  }, [isIOS]);

  useEffect(() => {
    if (!guideOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setGuideOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [guideOpen]);

  const appTitle = (siteName || 'DIGITAL HUB').trim();

  const handleInstallClick = async () => {
    if (isInstallable) {
      const result = await install();
      if (result === 'unavailable') {
        setGuideTab(isIOS ? 'ios' : 'android');
        setGuideOpen(true);
      }
      return;
    }
    setGuideTab(isIOS ? 'ios' : 'android');
    setGuideOpen(true);
  };

  return (
    <>
      <section aria-label="Download Our Mobile App">
        {isInstalled ? (
          <div className="rounded-2xl sm:rounded-3xl bg-gradient-to-r from-emerald-50/90 via-white to-emerald-50/60 dark:from-emerald-950/30 dark:via-slate-900 dark:to-slate-900 border border-emerald-200/80 dark:border-emerald-800/60 shadow-[0_6px_22px_rgba(16,185,129,0.08)] dark:shadow-[0_6px_24px_rgba(0,0,0,0.35)] p-4 sm:px-6 sm:py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-12 h-12 sm:w-13 sm:h-13 rounded-2xl bg-emerald-100 dark:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-700/60 flex items-center justify-center shrink-0 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-extrabold text-emerald-900 dark:text-emerald-200 leading-snug">
                  App Installed Successfully
                </h2>
                <p className="text-xs text-emerald-700/90 dark:text-emerald-300/80 mt-0.5 leading-relaxed">
                  {isStandalone
                    ? lang === 'bn'
                      ? `${appTitle} অ্যাপ মোডে চালু আছে — সব ফিচার ও ওয়ালেট নিরাপদে সংযুক্ত।`
                      : `${appTitle} is running in standalone app mode with full access.`
                    : lang === 'bn'
                      ? `${appTitle} অ্যাপটি আপনার ফোনের হোম স্ক্রিনে সফলভাবে ইনস্টল হয়েছে।`
                      : `${appTitle} has been added to your device home screen.`}
                </p>
              </div>
            </div>

            {!isStandalone ? (
              <a
                href="/"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors shrink-0"
              >
                <span>Open App</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : (
              <span className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600/10 dark:bg-emerald-500/15 border border-emerald-500/25 text-emerald-700 dark:text-emerald-300 text-xs font-bold shrink-0">
                <Smartphone className="w-3.5 h-3.5" />
                <span>Open App</span>
              </span>
            )}
          </div>
        ) : (
          <div className="rounded-2xl sm:rounded-3xl bg-gradient-to-r from-white via-[#F8FAFF] to-[#FFF7ED] dark:from-slate-900 dark:via-slate-900 dark:to-slate-800/95 border border-[#DCE5F7] dark:border-slate-700/80 shadow-[0_8px_28px_rgba(23,32,51,0.06)] dark:shadow-[0_8px_28px_rgba(0,0,0,0.4)] p-4 sm:px-6 sm:py-5 transition-all hover:border-[#FF8500]/45 hover:shadow-[0_12px_32px_rgba(255,133,0,0.10)]">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
                {/* Google Play Store–style Icon Badge */}
                <div className="w-13 h-13 sm:w-14 sm:h-14 rounded-2xl bg-white dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 shadow-sm flex items-center justify-center shrink-0">
                  <PlayStoreIcon />
                </div>

                <div className="min-w-0">
                  <h2 className="text-base sm:text-lg font-extrabold text-[#172033] dark:text-slate-50 tracking-tight leading-snug">
                    Download Our Mobile App
                  </h2>
                  <p className="text-xs sm:text-sm text-[#5C6B84] dark:text-slate-400 mt-0.5 leading-snug">
                    {lang === 'bn'
                      ? `${appTitle}-এর দ্রুত, নিরাপদ ও ফুল-স্ক্রিন মোবাইল অ্যাপ ইনস্টল করুন`
                      : `Get fast, full-screen access to ${appTitle} right from your home screen`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleInstallClick}
                disabled={isInstalling}
                className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 rounded-xl sm:rounded-2xl dh-orange-gradient hover:opacity-95 active:scale-[0.99] disabled:opacity-60 text-white text-xs sm:text-sm font-extrabold inline-flex items-center justify-center gap-2 shadow-[0_6px_18px_rgba(255,133,0,0.28)] transition-all cursor-pointer shrink-0"
              >
                <span>
                  {isInstalling
                    ? lang === 'bn'
                      ? 'ইনস্টল চালু হচ্ছে...'
                      : 'Opening Installer...'
                    : 'Install App — Click Here'}
                </span>
                {!isInstalling && <ArrowRight className="w-4 h-4 shrink-0" />}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Platform-Aware Manual Install Guide Modal (Android Chrome & iPhone Safari) */}
      {guideOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#0F172A]/60 backdrop-blur-xs p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-guide-title"
          onClick={() => setGuideOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 pt-5 pb-4 border-b border-[#E6ECFA] dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-center shrink-0">
                  <PlayStoreIcon />
                </div>
                <div className="min-w-0">
                  <h3
                    id="pwa-install-guide-title"
                    className="text-base font-extrabold text-[#172033] dark:text-slate-100 truncate"
                  >
                    {lang === 'bn' ? 'মোবাইল অ্যাপ ইনস্টল নির্দেশনা' : 'How to Install Mobile App'}
                  </h3>
                  <p className="text-xs text-[#64748B] dark:text-slate-400">
                    {appTitle} • Instant App
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                aria-label="Close"
                className="w-8 h-8 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 text-[#64748B] dark:text-slate-300 hover:text-[#172033] dark:hover:text-white flex items-center justify-center shrink-0 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Platform Tabs */}
              <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setGuideTab('android')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    guideTab === 'android'
                      ? 'bg-white dark:bg-slate-900 text-[#172033] dark:text-white shadow-xs'
                      : 'text-[#64748B] dark:text-slate-400'
                  }`}
                >
                  Android (Chrome)
                </button>
                <button
                  type="button"
                  onClick={() => setGuideTab('ios')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    guideTab === 'ios'
                      ? 'bg-white dark:bg-slate-900 text-[#172033] dark:text-white shadow-xs'
                      : 'text-[#64748B] dark:text-slate-400'
                  }`}
                >
                  iPhone / iPad (Safari)
                </button>
              </div>

              {guideTab === 'android' ? (
                <div className="space-y-3">
                  <p className="text-xs text-[#5C6B84] dark:text-slate-300 leading-relaxed">
                    {lang === 'bn'
                      ? 'Android Chrome ব্রাউজারে মাত্র ৩টি সহজ ধাপে অ্যাপটি ইনস্টল করুন:'
                      : 'Follow these 3 quick steps in Android Chrome to install the app:'}
                  </p>
                  <ol className="space-y-2.5 text-xs sm:text-sm">
                    <li className="flex items-start gap-3 p-3 rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/70 border border-[#E6ECFA] dark:border-slate-700/70">
                      <span className="w-6 h-6 rounded-full dh-orange-gradient text-white text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5">
                        1
                      </span>
                      <div className="text-[#172033] dark:text-slate-100 leading-snug">
                        <p className="font-bold flex items-center gap-1 flex-wrap">
                          <span>Chrome-এর উপরের ৩ ডট মেনু</span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-700">
                            <MoreVertical className="w-3.5 h-3.5 text-[#FF8500]" />
                          </span>
                          <span>চাপুন</span>
                        </p>
                        <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5">
                          Tap the 3-dot menu (⋮) in the top-right corner of Chrome.
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3 p-3 rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/70 border border-[#E6ECFA] dark:border-slate-700/70">
                      <span className="w-6 h-6 rounded-full dh-orange-gradient text-white text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5">
                        2
                      </span>
                      <div className="text-[#172033] dark:text-slate-100 leading-snug">
                        <p className="font-bold">
                          &ldquo;Add to Home Screen&rdquo; অথবা &ldquo;Install App&rdquo; সিলেক্ট করুন
                        </p>
                        <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5">
                          Tap &ldquo;Add to Home Screen&rdquo; or &ldquo;Install App&rdquo;.
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3 p-3 rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/70 border border-[#E6ECFA] dark:border-slate-700/70">
                      <span className="w-6 h-6 rounded-full dh-orange-gradient text-white text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5">
                        3
                      </span>
                      <div className="text-[#172033] dark:text-slate-100 leading-snug">
                        <p className="font-bold">&ldquo;Install&rdquo; বাটনে চাপ দিন</p>
                        <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5">
                          Confirm by tapping &ldquo;Install&rdquo; — {appTitle} will appear on your home screen.
                        </p>
                      </div>
                    </li>
                  </ol>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-[#5C6B84] dark:text-slate-300 leading-relaxed">
                    {lang === 'bn'
                      ? 'iPhone বা iPad-এ Safari ব্রাউজার থেকে অ্যাপটি ইনস্টল করুন:'
                      : 'Install on your iPhone or iPad directly from Safari:'}
                  </p>
                  <ol className="space-y-2.5 text-xs sm:text-sm">
                    <li className="flex items-start gap-3 p-3 rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/70 border border-[#E6ECFA] dark:border-slate-700/70">
                      <span className="w-6 h-6 rounded-full dh-orange-gradient text-white text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5">
                        1
                      </span>
                      <div className="text-[#172033] dark:text-slate-100 leading-snug">
                        <p className="font-bold flex items-center gap-1.5 flex-wrap">
                          <span>Safari ব্রাউজারের নিচের Share বাটনে চাপুন</span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-md bg-white dark:bg-slate-900 border border-[#E2E8F0] dark:border-slate-700">
                            <Share className="w-3.5 h-3.5 text-[#007AFF]" />
                          </span>
                        </p>
                        <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5">
                          Open this page in Safari and tap the Share button.
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3 p-3 rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/70 border border-[#E6ECFA] dark:border-slate-700/70">
                      <span className="w-6 h-6 rounded-full dh-orange-gradient text-white text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5">
                        2
                      </span>
                      <div className="text-[#172033] dark:text-slate-100 leading-snug">
                        <p className="font-bold">&ldquo;Add to Home Screen&rdquo; অপশনে চাপ দিন</p>
                        <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5">
                          Scroll down and tap &ldquo;Add to Home Screen&rdquo;.
                        </p>
                      </div>
                    </li>
                    <li className="flex items-start gap-3 p-3 rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/70 border border-[#E6ECFA] dark:border-slate-700/70">
                      <span className="w-6 h-6 rounded-full dh-orange-gradient text-white text-xs font-extrabold flex items-center justify-center shrink-0 mt-0.5">
                        3
                      </span>
                      <div className="text-[#172033] dark:text-slate-100 leading-snug">
                        <p className="font-bold">উপরের ডানদিকে &ldquo;Add&rdquo; চাপুন</p>
                        <p className="text-[11px] text-[#64748B] dark:text-slate-400 mt-0.5">
                          Tap &ldquo;Add&rdquo; to launch {appTitle} full-screen from your Home Screen.
                        </p>
                      </div>
                    </li>
                  </ol>
                </div>
              )}

              <button
                type="button"
                onClick={() => setGuideOpen(false)}
                className="w-full py-2.5 rounded-xl dh-orange-gradient text-white text-sm font-bold shadow-sm hover:opacity-95 transition-opacity cursor-pointer"
              >
                {lang === 'bn' ? 'বুঝেছি' : 'Got It'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Non-intrusive offline indicator (only shown when network connection drops) */}
      {!isOnline && (
        <div className="fixed bottom-20 sm:bottom-4 left-4 z-40 flex items-center gap-2 rounded-xl bg-amber-500 px-3.5 py-2 text-xs font-bold text-white shadow-lg">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>
            {lang === 'bn'
              ? 'অফলাইন মোড — সংযোগ ফিরলেই তথ্য আপডেট হবে'
              : 'Offline Mode — Reconnecting when back online'}
          </span>
        </div>
      )}
    </>
  );
}
