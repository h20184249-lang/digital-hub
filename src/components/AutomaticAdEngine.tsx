import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, RefreshCw, Sparkles, X } from 'lucide-react';
import { AdNetworkConfig, Advertisement, BannerSlot, Language } from '../types/marketplace';
import { trackAdEvent } from '../lib/firestoreService';
import { resolveStudioImage, STUDIO_IMAGES } from '../lib/studioAssets';
import { isValidExternalAdUrl, resolveAdBrowserUrl, tryAcquireAdLaunchLock } from '../lib/adNavigation';

const FORBIDDEN_DIRECT_AD_HOSTS = /(asiafilm\.org\/4\/|auctionr\.org\/4\/|arwf\.org\/4\/|bicea\.org\/22\/)/i;

function isSafeOfficialScriptSrc(url?: string): boolean {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) return false;
  if (FORBIDDEN_DIRECT_AD_HOSTS.test(trimmed)) return false;
  return true;
}

interface PublisherScriptSlotProps {
  placement: BannerSlot | 'social_bar' | 'all';
  adFormat?: 'banner' | 'native' | 'social_bar';
  adNetworks: AdNetworkConfig[];
  adsEnabled: boolean;
}

export function PublisherScriptSlot({
  placement,
  adFormat,
  adNetworks,
  adsEnabled,
}: PublisherScriptSlotProps) {
  const activeNetwork = useMemo(() => {
    return adNetworks.find((n) => {
      if (!n.enabled || n.approvalStatus !== 'active') return false;
      if (adFormat && n.adFormat !== adFormat) return false;
      const matchesPlacement = n.placement === 'all' || n.placement === placement;
      if (!matchesPlacement) return false;
      if (n.provider === 'adsense') return Boolean(n.publisherId && n.zoneId);
      return isSafeOfficialScriptSrc(n.scriptSrc);
    });
  }, [adNetworks, placement, adFormat]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const trackedRef = useRef<string>('');

  useEffect(() => {
    if (!adsEnabled || !activeNetwork) return;
    const key = `${activeNetwork.id}_${placement}`;
    if (trackedRef.current !== key) {
      trackedRef.current = key;
      trackAdEvent(activeNetwork.id, 'impression', placement, 'publisher_script');
    }

    const host = containerRef.current;
    if (!host) return;
    host.innerHTML = '';

    const injectedNodes: HTMLElement[] = [];

    if (activeNetwork.provider === 'adsense' && activeNetwork.publisherId && activeNetwork.zoneId) {
      const existingLib = document.querySelector(
        `script[data-dh-adsense="${activeNetwork.publisherId}"]`
      );
      if (!existingLib) {
        const libScript = document.createElement('script');
        libScript.async = true;
        libScript.crossOrigin = 'anonymous';
        libScript.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(
          activeNetwork.publisherId
        )}`;
        libScript.dataset.dhAdsense = activeNetwork.publisherId;
        document.head.appendChild(libScript);
      }
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle block w-full min-h-[90px]';
      ins.setAttribute('data-ad-client', activeNetwork.publisherId);
      ins.setAttribute('data-ad-slot', activeNetwork.zoneId);
      ins.setAttribute('data-ad-format', 'auto');
      ins.setAttribute('data-full-width-responsive', 'true');
      host.appendChild(ins);
      injectedNodes.push(ins);

      const pushScript = document.createElement('script');
      pushScript.text = '(window.adsbygoogle = window.adsbygoogle || []).push({});';
      host.appendChild(pushScript);
      injectedNodes.push(pushScript);
    } else if (isSafeOfficialScriptSrc(activeNetwork.scriptSrc)) {
      if (activeNetwork.containerId) {
        const zoneDiv = document.createElement('div');
        zoneDiv.id = activeNetwork.containerId;
        host.appendChild(zoneDiv);
        injectedNodes.push(zoneDiv);
      }
      const extScript = document.createElement('script');
      extScript.async = true;
      extScript.src = activeNetwork.scriptSrc!.trim();
      host.appendChild(extScript);
      injectedNodes.push(extScript);
    }

    return () => {
      injectedNodes.forEach((n) => n.remove());
    };
  }, [adsEnabled, activeNetwork, placement]);

  if (!adsEnabled || !activeNetwork) return null;

  return (
    <div className="dh-card rounded-2xl p-3 bg-white border border-[#E6ECFA]">
      <div className="flex items-center justify-between text-[10px] text-[#777777] font-semibold mb-1.5 px-1">
        <span className="uppercase tracking-wider">{activeNetwork.name}</span>
        <span>Sponsored Network</span>
      </div>
      <div ref={containerRef} className="w-full overflow-hidden flex items-center justify-center min-h-[60px]" />
    </div>
  );
}

interface NativeAdRowProps {
  placement: BannerSlot | 'ads_page';
  advertisements: Advertisement[];
  adNetworks?: AdNetworkConfig[];
  adsEnabled: boolean;
  lang: Language;
  maxCards?: number;
  excludeAdCodes?: string[];
}

export function NativeAdRow({
  placement,
  advertisements,
  adNetworks = [],
  adsEnabled,
  lang,
  maxCards = 3,
  excludeAdCodes = [],
}: NativeAdRowProps) {
  const today = new Date().toISOString().slice(0, 10);

  const eligibleAds = useMemo(() => {
    const dedupUrls = new Set<string>();
    const list = advertisements
      .filter((ad) => {
        if (!ad.enabled) return false;
        if (!isValidExternalAdUrl(ad.targetUrl)) return false;
        if (ad.startDate && ad.startDate > today) return false;
        if (ad.endDate && ad.endDate < today) return false;
        if (excludeAdCodes.includes(ad.code)) return false;
        if (dedupUrls.has(ad.targetUrl)) return false;
        dedupUrls.add(ad.targetUrl);
        if (placement === 'ads_page') return true;
        return (
          ad.placement === 'all' ||
          ad.placement === placement ||
          (placement === 'service_page' && ad.placement === 'service_banner') ||
          ad.adFormat === 'native' ||
          ad.adFormat === 'direct_link'
        );
      })
      .sort((a, b) => b.priority - a.priority || a.sortOrder - b.sortOrder);

    return list;
  }, [advertisements, placement, today, excludeAdCodes]);

  const [rotationOffset, setRotationOffset] = useState(0);
  const [paused, setPaused] = useState(false);
  const trackedSet = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!adsEnabled || eligibleAds.length <= maxCards || paused) return;
    const timer = setInterval(() => {
      setRotationOffset((prev) => (prev + 1) % eligibleAds.length);
    }, 22000);
    return () => clearInterval(timer);
  }, [adsEnabled, eligibleAds.length, maxCards, paused]);

  const visibleAds = useMemo(() => {
    if (eligibleAds.length === 0) return [];
    const count = Math.min(maxCards, eligibleAds.length);
    const out: Advertisement[] = [];
    for (let i = 0; i < count; i++) {
      out.push(eligibleAds[(rotationOffset + i) % eligibleAds.length]);
    }
    return out;
  }, [eligibleAds, maxCards, rotationOffset]);

  useEffect(() => {
    if (!adsEnabled) return;
    visibleAds.forEach((ad) => {
      const key = `${ad.id}_${placement}_native`;
      if (!trackedSet.current.has(key)) {
        trackedSet.current.add(key);
        trackAdEvent(ad.code || ad.id, 'impression', placement, ad.adFormat || 'native');
      }
    });
  }, [adsEnabled, visibleAds, placement]);

  if (!adsEnabled) return null;

  return (
    <section
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="space-y-3"
    >
      <PublisherScriptSlot
        placement={placement === 'ads_page' ? 'all' : placement}
        adFormat="native"
        adNetworks={adNetworks}
        adsEnabled={adsEnabled}
      />

      {visibleAds.length > 0 && (
        <div className="dh-card rounded-3xl p-4 sm:p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded-md bg-[#FFF3E5] text-[#FF8500] text-[10px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                {lang === 'bn' ? 'স্পন্সরড নেটিভ ডিলস' : 'Sponsored Partner Picks'}
              </span>
              <span className="text-[11px] text-[#777777] hidden sm:inline">
                {lang === 'bn' ? 'নিরাপদ পার্টনার লিংক' : 'Safe external partner links'}
              </span>
            </div>
            {eligibleAds.length > 1 && (
              <button
                type="button"
                onClick={() => setRotationOffset((prev) => (prev + 1) % eligibleAds.length)}
                className="text-[11px] font-bold text-[#FF8500] hover:underline flex items-center gap-1"
              >
                <RefreshCw className="w-3 h-3" />
                <span>{lang === 'bn' ? 'পরবর্তী' : 'Rotate'}</span>
              </button>
            )}
          </div>

          <div className={`grid grid-cols-1 ${visibleAds.length === 2 ? 'sm:grid-cols-2' : visibleAds.length >= 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : ''} gap-3`}>
            {visibleAds.map((ad) => {
              const launch = resolveAdBrowserUrl(ad.targetUrl);
              return (
              <a
                key={`${ad.id}_${placement}`}
                href={launch.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                onClick={(e) => {
                  if (!launch.ok || !tryAcquireAdLaunchLock(ad.code || ad.id, launch.finalHttpUrl)) {
                    e.preventDefault();
                    return;
                  }
                  trackAdEvent(ad.code || ad.id, 'click', placement, ad.adFormat || 'native');
                }}
                className="group rounded-2xl p-3 bg-[#F3F6FF] border border-[#E6ECFA] hover:border-[#FF8500] transition-all flex items-center gap-3 cursor-pointer"
              >
                {ad.thumbnailUrl && (
                  <img
                    src={resolveStudioImage(ad.thumbnailUrl)}
                    alt={lang === 'bn' ? ad.titleBn : ad.titleEn}
                    onError={(e) => {
                      e.currentTarget.src = STUDIO_IMAGES.bannerVip;
                    }}
                    className="w-16 h-16 rounded-xl object-cover shrink-0 bg-[#172033]"
                    loading="lazy"
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="px-1.5 py-0.5 rounded bg-[#172033] text-white text-[10px] font-mono-num font-bold">
                      {ad.code}
                    </span>
                    <span className="text-[10px] font-bold text-[#FF8500] uppercase">
                      {ad.adFormat || 'native'}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm font-bold text-[#172033] group-hover:text-[#FF8500] line-clamp-1">
                    {lang === 'bn' ? ad.titleBn : ad.titleEn}
                  </p>
                  <p className="text-[11px] text-[#777777] line-clamp-1 mt-0.5">
                    {lang === 'bn' ? ad.descriptionBn || ad.descriptionEn : ad.descriptionEn || ad.descriptionBn}
                  </p>
                </div>
                <ExternalLink className="w-4 h-4 text-[#777777] group-hover:text-[#FF8500] shrink-0" />
              </a>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

export function SocialBarWidget({
  advertisements,
  adNetworks,
  adsEnabled,
  lang,
}: {
  advertisements: Advertisement[];
  adNetworks: AdNetworkConfig[];
  adsEnabled: boolean;
  lang: Language;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [idx, setIdx] = useState(0);
  const trackedRef = useRef<Set<string>>(new Set());

  const socialAds = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return advertisements
      .filter((a) => {
        if (!a.enabled) return false;
        if (!isValidExternalAdUrl(a.targetUrl)) return false;
        if (a.startDate && a.startDate > today) return false;
        if (a.endDate && a.endDate < today) return false;
        return a.adFormat === 'social_bar' || a.placement === 'social_bar' || a.placement === 'all';
      })
      .sort((a, b) => b.priority - a.priority || a.sortOrder - b.sortOrder);
  }, [advertisements]);

  useEffect(() => {
    if (!adsEnabled || dismissed || socialAds.length <= 1) return;
    const timer = setInterval(() => {
      setIdx((p) => (p + 1) % socialAds.length);
    }, 28000);
    return () => clearInterval(timer);
  }, [adsEnabled, dismissed, socialAds.length]);

  const active = socialAds[idx % Math.max(1, socialAds.length)];

  useEffect(() => {
    if (!adsEnabled || dismissed || !active) return;
    if (!trackedRef.current.has(active.id)) {
      trackedRef.current.add(active.id);
      trackAdEvent(active.code || active.id, 'impression', 'social_bar', 'social_bar');
    }
  }, [adsEnabled, dismissed, active]);

  if (!adsEnabled || dismissed) return null;

  return (
    <>
      <PublisherScriptSlot
        placement="social_bar"
        adFormat="social_bar"
        adNetworks={adNetworks}
        adsEnabled={adsEnabled}
      />

      {active && (() => {
        const socialLaunch = resolveAdBrowserUrl(active.targetUrl);
        if (!socialLaunch.ok) return null;
        return (
        <div className="fixed left-3 bottom-20 lg:bottom-6 z-30 max-w-[270px] sm:max-w-xs bg-white/95 backdrop-blur-md border border-[#FF8500]/50 rounded-2xl shadow-xl p-2.5 flex items-center gap-2.5">
          <a
            href={socialLaunch.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            onClick={(e) => {
              if (!tryAcquireAdLaunchLock(active.code || active.id, socialLaunch.finalHttpUrl)) {
                e.preventDefault();
                return;
              }
              trackAdEvent(active.code || active.id, 'click', 'social_bar', 'social_bar');
            }}
            className="flex-1 min-w-0 flex items-center gap-2.5 text-left group cursor-pointer"
          >
            {active.thumbnailUrl && (
              <img
                src={resolveStudioImage(active.thumbnailUrl)}
                alt={active.code}
                onError={(e) => {
                  e.currentTarget.src = STUDIO_IMAGES.bannerVip;
                }}
                className="w-10 h-10 rounded-xl object-cover shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1">
                <span className="px-1.5 py-0.2 rounded bg-[#FF8500] text-white text-[9px] font-bold font-mono-num">
                  {active.code}
                </span>
                <span className="text-[9px] font-bold uppercase text-[#777777]">Sponsored</span>
              </div>
              <p className="text-xs font-bold text-[#172033] group-hover:text-[#FF8500] truncate mt-0.5">
                {lang === 'bn' ? active.titleBn : active.titleEn}
              </p>
            </div>
          </a>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label="Close sponsored bar"
            className="p-1 rounded-lg text-[#777777] hover:bg-[#F3F6FF] hover:text-[#172033] shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        );
      })()}
    </>
  );
}
