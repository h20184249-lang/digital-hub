import { MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { AdNetworkConfig, Banner, BannerSlot, Language } from '../types/marketplace';
import { t } from '../lib/i18n';
import { trackAdEvent } from '../lib/firestoreService';
import { PublisherScriptSlot } from './AutomaticAdEngine';
import { resolveStudioImage, STUDIO_IMAGES } from '../lib/studioAssets';
import { resolveAdBrowserUrl, tryAcquireAdLaunchLock } from '../lib/adNavigation';

interface BannerSlotViewProps {
  slot: BannerSlot;
  banners: Banner[];
  adNetworks?: AdNetworkConfig[];
  adsEnabled: boolean;
  lang: Language;
  className?: string;
}

export function BannerSlotView({
  slot,
  banners,
  adNetworks = [],
  adsEnabled,
  lang,
  className = '',
}: BannerSlotViewProps) {
  const today = new Date().toISOString().slice(0, 10);

  const slotBanners = useMemo(() => {
    const seenUrls = new Set<string>();
    return banners
      .filter((b) => {
        if (!b.enabled || b.slot !== slot) return false;
        if (b.startDate && b.startDate > today) return false;
        if (b.endDate && b.endDate < today) return false;
        if (seenUrls.has(b.targetUrl)) return false;
        seenUrls.add(b.targetUrl);
        return true;
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || b.priority - a.priority);
  }, [banners, slot, today]);

  const [activeIdx, setActiveIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const trackedSet = useRef<Set<string>>(new Set());

  useEffect(() => {
    setActiveIdx(0);
  }, [slot, slotBanners.length]);

  useEffect(() => {
    if (slotBanners.length <= 1 || paused) return;
    const timer = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % slotBanners.length);
    }, 6500);
    return () => clearInterval(timer);
  }, [slotBanners.length, paused]);

  const current = slotBanners[activeIdx];

  useEffect(() => {
    if (!adsEnabled || !current) return;
    const key = `${current.id}_${slot}`;
    if (trackedSet.current.has(key)) return;
    trackedSet.current.add(key);
    trackAdEvent(current.adCode || current.id, 'impression', slot, 'banner');
  }, [adsEnabled, current, slot]);

  if (!adsEnabled) return null;

  const title = current ? (lang === 'bn' ? current.titleBn : current.titleEn) : '';
  const subtitle = current ? (lang === 'bn' ? current.subtitleBn : current.subtitleEn) : '';
  const launch = current ? resolveAdBrowserUrl(current.targetUrl) : null;

  const handleBannerClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!current || !launch || !launch.ok) {
      e.preventDefault();
      return;
    }
    const acquired = tryAcquireAdLaunchLock(current.adCode || current.id, launch.finalHttpUrl);
    if (!acquired) {
      e.preventDefault();
      return;
    }
    trackAdEvent(current.adCode || current.id, 'click', slot, 'banner');
  };

  return (
    <div className={`space-y-3 ${className}`}>
      <PublisherScriptSlot
        placement={slot}
        adFormat="banner"
        adNetworks={adNetworks}
        adsEnabled={adsEnabled}
      />

      {slotBanners.length > 0 && current && (
        <div
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          className="relative dh-card rounded-2xl overflow-hidden group hover:border-[#FF8500] transition-colors"
        >
          {launch?.ok ? (
            <a
              href={launch.href}
              target="_blank"
              rel="noopener noreferrer nofollow"
              onClick={handleBannerClick}
              aria-label={title}
              className="relative flex flex-col md:flex-row items-stretch cursor-pointer"
            >
              {(current.imageUrl || current.mobileImageUrl) && (
                <div className="relative md:w-64 lg:w-72 h-32 md:h-auto shrink-0 overflow-hidden bg-[#172033]">
                  {current.mobileImageUrl && (
                    <img
                      key={`mob_${current.id}_${retryNonce}`}
                      src={resolveStudioImage(current.mobileImageUrl)}
                      alt={title}
                      onError={(e) => {
                        e.currentTarget.src = STUDIO_IMAGES.bannerVip;
                      }}
                      className="w-full h-full object-cover md:hidden group-hover:scale-105 transition-transform duration-300"
                      loading="lazy"
                    />
                  )}
                  <img
                    key={`desk_${current.id}_${retryNonce}`}
                    src={resolveStudioImage(current.imageUrl || current.mobileImageUrl)}
                    alt={title}
                    onError={(e) => {
                      e.currentTarget.src = STUDIO_IMAGES.bannerVip;
                    }}
                    className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 ${
                      current.mobileImageUrl ? 'hidden md:block' : 'block'
                    }`}
                    loading="lazy"
                  />
                  <span className="absolute top-2.5 left-2.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/95 text-[#FF8500] text-[10px] font-bold uppercase tracking-wider shadow-xs">
                    <Sparkles className="w-3 h-3" />
                    {t(lang, 'sponsored')}
                  </span>
                </div>
              )}

              <div className="flex-1 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-white to-[#FFF7EE]">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {current.adCode && (
                      <span className="px-2 py-0.5 rounded-md bg-[#FFF3E5] text-[#FF8500] text-[10px] font-bold font-mono-num">
                        {current.adCode}
                      </span>
                    )}
                    {subtitle && <span className="text-xs text-[#777777] font-medium truncate">{subtitle}</span>}
                  </div>
                  <h3 className="text-sm sm:text-base font-bold text-[#172033] group-hover:text-[#FF8500] transition-colors leading-snug">
                    {title}
                  </h3>
                </div>

                <div className={`flex items-center gap-2 shrink-0 ${slotBanners.length > 1 ? 'pr-20 sm:pr-20' : ''}`}>
                  <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs sm:text-sm font-bold shadow-xs group-hover:opacity-95 transition-opacity">
                    <span>{t(lang, 'openDestination')}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </span>
                </div>
              </div>
            </a>
          ) : (
            <div className="p-4 bg-amber-50 border border-amber-200 flex items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-4 h-4 text-[#FF8500] shrink-0" />
                <div className="min-w-0">
                  <p className="font-bold text-[#172033] truncate">{title || current.adCode}</p>
                  <p className="text-amber-800">
                    {lang === 'bn' ? 'ব্যানারের গন্তব্য লিংকটি অনুপলব্ধ।' : 'Banner destination link unavailable.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRetryNonce((n) => n + 1)}
                className="px-3 py-1.5 rounded-xl bg-white border border-amber-300 text-[#172033] font-bold inline-flex items-center gap-1 shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'রিট্রাই' : 'Retry'}</span>
              </button>
            </div>
          )}

          {slotBanners.length > 1 && (
            <div className="absolute right-3 bottom-3 sm:top-1/2 sm:-translate-y-1/2 sm:bottom-auto z-10 flex items-center gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveIdx((p) => (p - 1 + slotBanners.length) % slotBanners.length);
                }}
                className="p-1.5 rounded-lg border border-[#E6ECFA] bg-white/95 text-[#172033] hover:border-[#FF8500] shadow-xs"
                aria-label="Previous banner"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveIdx((p) => (p + 1) % slotBanners.length);
                }}
                className="p-1.5 rounded-lg border border-[#E6ECFA] bg-white/95 text-[#172033] hover:border-[#FF8500] shadow-xs"
                aria-label="Next banner"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
