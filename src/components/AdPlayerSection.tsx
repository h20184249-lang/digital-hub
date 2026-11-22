import { MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  Tv,
} from 'lucide-react';
import { Advertisement, Language } from '../types/marketplace';
import { t } from '../lib/i18n';
import { trackAdEvent } from '../lib/firestoreService';
import { resolveStudioImage, STUDIO_IMAGES } from '../lib/studioAssets';
import {
  classifyAdMediaUrl,
  resolveAdBrowserUrl,
  tryAcquireAdLaunchLock,
} from '../lib/adNavigation';
import { getDhakaDateString } from '../lib/adProviderConfig';

interface AdPlayerSectionProps {
  ads: Advertisement[];
  adsEnabled: boolean;
  lang: Language;
  placementFilter?: string;
}

export function AdPlayerSection({
  ads,
  adsEnabled,
  lang,
  placementFilter = 'player',
}: AdPlayerSectionProps) {
  const today = getDhakaDateString();

  const activeAds = useMemo(() => {
    return ads
      .filter((ad) => {
        if (!ad.enabled) return false;
        if (ad.startDate && ad.startDate > today) return false;
        if (ad.endDate && ad.endDate < today) return false;
        if (placementFilter === 'ads_page') return true;
        return ad.placement === 'all' || ad.placement === placementFilter || ad.placement === 'player';
      })
      .sort((a, b) => a.sortOrder - b.sortOrder || b.priority - a.priority);
  }, [ads, placementFilter, today]);

  const [selectedId, setSelectedId] = useState<string>('');
  const [mediaState, setMediaState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [retryNonce, setRetryNonce] = useState(0);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);
  const trackedSet = useRef<Set<string>>(new Set());
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (activeAds.length > 0 && !activeAds.some((a) => a.id === selectedId)) {
      setSelectedId(activeAds[0].id);
    }
  }, [activeAds, selectedId]);

  const selectedAd = activeAds.find((a) => a.id === selectedId) || activeAds[0];

  const selectedMedia = useMemo(() => {
    if (!selectedAd || selectedAd.mediaType !== 'video') {
      return { kind: 'external' as const, playableSrc: '' };
    }
    return classifyAdMediaUrl(selectedAd.mediaUrl);
  }, [selectedAd]);

  useEffect(() => {
    if (!selectedAd) return;
    if (selectedMedia.kind === 'direct_video' || selectedMedia.kind === 'embed_video') {
      setMediaState('loading');
    } else {
      setMediaState('ready');
    }
  }, [selectedAd?.id, selectedMedia.kind, retryNonce]);

  useEffect(() => {
    if (!adsEnabled || !selectedAd) return;
    if (trackedSet.current.has(selectedAd.id)) return;
    trackedSet.current.add(selectedAd.id);
    trackAdEvent(selectedAd.code || selectedAd.id, 'impression', placementFilter, selectedAd.adFormat || 'banner');
  }, [adsEnabled, selectedAd, placementFilter]);

  useEffect(() => {
    if (!duplicateNotice) return;
    const timer = setTimeout(() => setDuplicateNotice(null), 2200);
    return () => clearTimeout(timer);
  }, [duplicateNotice]);

  if (!adsEnabled || activeAds.length === 0) return null;

  const selectedLaunch = selectedAd ? resolveAdBrowserUrl(selectedAd.targetUrl) : null;

  const handleDirectLinkClick = (
    e: MouseEvent<HTMLAnchorElement>,
    ad: Advertisement,
    subPlacement: string
  ) => {
    const launch = resolveAdBrowserUrl(ad.targetUrl);
    if (!launch.ok) {
      e.preventDefault();
      setMediaState('error');
      return;
    }
    const acquired = tryAcquireAdLaunchLock(ad.code || ad.id, launch.finalHttpUrl);
    if (!acquired) {
      e.preventDefault();
      setDuplicateNotice(
        lang === 'bn'
          ? 'বিজ্ঞাপনটি ইতিমধ্যে নতুন ট্যাবে খোলা হচ্ছে—অনুগ্রহ করে একটু অপেক্ষা করুন।'
          : 'This ad was just opened—prevented duplicate tab.'
      );
      return;
    }
    setSelectedId(ad.id);
    trackAdEvent(ad.code || ad.id, 'click', subPlacement, ad.adFormat || 'direct_link');
  };

  const handleVideoPlaylistSelect = (ad: Advertisement) => {
    setSelectedId(ad.id);
    setMediaState('loading');
    setRetryNonce((n) => n + 1);
    trackAdEvent(ad.code || ad.id, 'click', 'player_video_select', 'video');
    setTimeout(() => {
      videoRef.current?.play().catch(() => {});
    }, 60);
  };

  const handleRetryStage = () => {
    setMediaState(selectedMedia.kind === 'external' ? 'ready' : 'loading');
    setRetryNonce((n) => n + 1);
  };

  return (
    <section className="dh-card rounded-3xl p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5 pb-4 border-b border-[#E6ECFA]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#FFF3E5] text-[#FF8500] flex items-center justify-center shrink-0">
            <Tv className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-[#172033]">
              {t(lang, 'adPlayerTitle')}
            </h2>
            <p className="text-xs text-[#777777]">{t(lang, 'adPlayerSubtitle')}</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-[#F3F6FF] text-[#172033] text-xs font-semibold border border-[#E6ECFA] self-start sm:self-auto">
          <ShieldCheck className="w-3.5 h-3.5 text-[#16A34A]" />
          {lang === 'bn' ? 'সরাসরি ক্রোম ব্রাউজার রিডাইরেক্ট' : 'Direct Chrome Tab Launch'}
        </span>
      </div>

      {duplicateNotice && (
        <div className="mb-3 px-3.5 py-2 rounded-xl bg-[#FFF3E5] border border-[#FF8500]/30 text-xs font-semibold text-[#172033] flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-[#FF8500] shrink-0" />
          <span>{duplicateNotice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Main Player / Interactive Ad Stage */}
        {selectedAd && (
          <div className="lg:col-span-7 rounded-2xl overflow-hidden border border-[#E6ECFA] bg-[#172033] text-white flex flex-col">
            <div className="relative aspect-video bg-[#0F172A] flex items-center justify-center overflow-hidden">
              {selectedMedia.kind === 'direct_video' ? (
                <>
                  <video
                    key={`${selectedAd.id}_${retryNonce}`}
                    ref={videoRef}
                    src={selectedMedia.playableSrc}
                    poster={selectedAd.thumbnailUrl ? resolveStudioImage(selectedAd.thumbnailUrl) : undefined}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadStart={() => setMediaState('loading')}
                    onCanPlay={() => setMediaState('ready')}
                    onLoadedData={() => setMediaState('ready')}
                    onError={() => setMediaState('error')}
                    className="w-full h-full object-cover"
                  />
                  {mediaState === 'loading' && (
                    <div className="pointer-events-none absolute inset-0 bg-[#0F172A]/70 flex flex-col items-center justify-center gap-2">
                      <Loader2 className="w-8 h-8 text-[#FF8500] animate-spin" />
                      <span className="text-xs font-semibold text-white/90">
                        {lang === 'bn' ? 'ভিডিও বিজ্ঞাপন লোড হচ্ছে...' : 'Loading video ad...'}
                      </span>
                    </div>
                  )}
                  {mediaState === 'error' && (
                    <div className="absolute inset-0 bg-[#172033]/95 flex flex-col items-center justify-center p-5 text-center gap-3">
                      <AlertCircle className="w-8 h-8 text-[#FF8500]" />
                      <p className="text-sm font-bold text-white">
                        {lang === 'bn'
                          ? 'ভিডিও বিজ্ঞাপনটি লোড করা যায়নি'
                          : 'Video advertisement failed to load'}
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={handleRetryStage}
                          className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold inline-flex items-center gap-1.5"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>{lang === 'bn' ? 'আবার চেষ্টা করুন' : 'Retry'}</span>
                        </button>
                        {selectedLaunch?.ok && (
                          <a
                            href={selectedLaunch.href}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            onClick={(e) => handleDirectLinkClick(e, selectedAd, 'player_video_fallback')}
                            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white text-xs font-bold inline-flex items-center gap-1.5"
                          >
                            <span>{t(lang, 'openDestination')}</span>
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : selectedMedia.kind === 'embed_video' ? (
                <>
                  <iframe
                    key={`${selectedAd.id}_embed_${retryNonce}`}
                    title={lang === 'bn' ? selectedAd.titleBn : selectedAd.titleEn}
                    src={selectedMedia.playableSrc}
                    allow="autoplay; encrypted-media; picture-in-picture"
                    allowFullScreen
                    onLoad={() => setMediaState('ready')}
                    onError={() => setMediaState('error')}
                    className="w-full h-full border-0"
                  />
                  {mediaState === 'loading' && (
                    <div className="pointer-events-none absolute inset-0 bg-[#0F172A]/60 flex items-center justify-center">
                      <Loader2 className="w-7 h-7 text-[#FF8500] animate-spin" />
                    </div>
                  )}
                </>
              ) : selectedLaunch?.ok && mediaState !== 'error' ? (
                <a
                  href={selectedLaunch.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  onClick={(e) => handleDirectLinkClick(e, selectedAd, 'player_stage')}
                  className="group relative w-full h-full flex items-center justify-center cursor-pointer"
                >
                  {selectedAd.thumbnailUrl && (
                    <img
                      src={resolveStudioImage(selectedAd.thumbnailUrl)}
                      alt={lang === 'bn' ? selectedAd.titleBn : selectedAd.titleEn}
                      onError={(e) => {
                        e.currentTarget.src = STUDIO_IMAGES.bannerVip;
                      }}
                      className="w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-300"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#172033] via-[#172033]/55 to-transparent flex flex-col items-center justify-center p-5 text-center">
                    <span className="px-2.5 py-1 rounded-lg bg-[#FF8500] text-white text-[11px] font-bold font-mono-num mb-3">
                      {selectedAd.code}
                    </span>
                    <h3 className="text-base sm:text-xl font-bold text-white max-w-md mb-1.5 group-hover:text-[#FF9B19] transition-colors">
                      {lang === 'bn' ? selectedAd.titleBn : selectedAd.titleEn}
                    </h3>
                    <p className="text-xs text-white/80 max-w-md mb-4">
                      {t(lang, 'externalPartnerNotice')}
                    </p>
                    <span className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl dh-orange-gradient text-white text-sm font-bold shadow-lg group-hover:opacity-95 transition-opacity">
                      <Play className="w-4 h-4 fill-current" />
                      <span>{t(lang, 'openDestination')}</span>
                      <ExternalLink className="w-4 h-4" />
                    </span>
                  </div>
                </a>
              ) : (
                <div className="absolute inset-0 bg-[#172033] flex flex-col items-center justify-center p-5 text-center gap-3">
                  <AlertCircle className="w-8 h-8 text-[#FF8500]" />
                  <p className="text-sm font-bold text-white">
                    {lang === 'bn'
                      ? 'এই বিজ্ঞাপনটির লিংক বর্তমানে অনুপলব্ধ'
                      : 'This advertisement link is currently unavailable'}
                  </p>
                  <button
                    type="button"
                    onClick={handleRetryStage}
                    className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>{lang === 'bn' ? 'পুনরায় চেষ্টা করুন' : 'Retry'}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-[#172033]">
              <div className="min-w-0">
                <p className="text-sm font-bold text-white truncate">
                  {lang === 'bn' ? selectedAd.titleBn : selectedAd.titleEn}
                </p>
                {(selectedAd.descriptionBn || selectedAd.descriptionEn) && (
                  <p className="text-xs text-white/70 truncate mt-0.5">
                    {lang === 'bn' ? selectedAd.descriptionBn : selectedAd.descriptionEn}
                  </p>
                )}
              </div>
              {selectedLaunch?.ok ? (
                <a
                  href={selectedLaunch.href}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  onClick={(e) => handleDirectLinkClick(e, selectedAd, 'player_footer')}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-[#FF8500] text-white text-xs font-bold transition-colors shrink-0 self-start sm:self-auto"
                >
                  <span>{t(lang, 'openDestination')}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              ) : (
                <button
                  type="button"
                  onClick={handleRetryStage}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-[#FF8500] text-white text-xs font-bold transition-colors shrink-0 self-start sm:self-auto"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>{lang === 'bn' ? 'রিলোড' : 'Retry'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {/* Ordered Clickable Playlist Cards */}
        <div className="lg:col-span-5 flex flex-col gap-2.5 max-h-[420px] overflow-y-auto pr-1">
          {activeAds.map((ad, idx) => {
            const isSelected = selectedAd?.id === ad.id;
            const title = lang === 'bn' ? ad.titleBn : ad.titleEn;
            const mediaInfo = ad.mediaType === 'video' ? classifyAdMediaUrl(ad.mediaUrl) : null;
            const isPlayableVideo =
              mediaInfo?.kind === 'direct_video' || mediaInfo?.kind === 'embed_video';
            const cardLaunch = resolveAdBrowserUrl(ad.targetUrl);

            if (isPlayableVideo) {
              return (
                <div
                  key={ad.id}
                  onClick={() => handleVideoPlaylistSelect(ad)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      handleVideoPlaylistSelect(ad);
                    }
                  }}
                  className={`rounded-2xl p-3 border transition-all flex items-center gap-3 cursor-pointer ${
                    isSelected
                      ? 'bg-[#FFF7EE] border-[#FF8500] shadow-xs'
                      : 'bg-white border-[#E6ECFA] hover:border-[#FF8500]/60'
                  }`}
                >
                  <span className="w-10 h-10 rounded-xl dh-orange-gradient text-white flex items-center justify-center shrink-0 shadow-xs">
                    <Play className="w-4 h-4 fill-current ml-0.5" />
                  </span>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[10px] font-bold font-mono-num px-1.5 py-0.5 rounded bg-[#172033] text-white">
                        {ad.code}
                      </span>
                      <span className="text-[10px] text-[#FF8500] font-bold">
                        #{idx + 1} · {lang === 'bn' ? 'ভিডিও প্লে' : 'Video Ad'}
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm font-bold text-[#172033] truncate">{title}</p>
                  </div>
                  {cardLaunch.ok && (
                    <a
                      href={cardLaunch.href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDirectLinkClick(e, ad, 'player_list_ext');
                      }}
                      className="p-2 rounded-xl bg-[#F3F6FF] text-[#172033] hover:bg-[#FF8500] hover:text-white transition-colors shrink-0"
                      title={t(lang, 'openDestination')}
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  )}
                </div>
              );
            }

            if (!cardLaunch.ok) {
              return (
                <div
                  key={ad.id}
                  className="rounded-2xl p-3 border border-amber-200 bg-amber-50/70 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <span className="text-[10px] font-bold font-mono-num text-[#172033]">{ad.code}</span>
                    <p className="text-xs font-bold text-[#172033] truncate">{title}</p>
                    <p className="text-[11px] text-amber-800">
                      {lang === 'bn' ? 'লিংক অনুপলব্ধ' : 'Destination unavailable'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleRetryStage}
                    className="px-2.5 py-1.5 rounded-lg bg-white border border-amber-300 text-xs font-bold text-[#172033] shrink-0 inline-flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>{lang === 'bn' ? 'রিট্রাই' : 'Retry'}</span>
                  </button>
                </div>
              );
            }

            return (
              <a
                key={ad.id}
                href={cardLaunch.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                onClick={(e) => handleDirectLinkClick(e, ad, 'player_list_card')}
                className={`group rounded-2xl p-3 border transition-all flex items-center gap-3 cursor-pointer ${
                  isSelected
                    ? 'bg-[#FFF7EE] border-[#FF8500] shadow-xs'
                    : 'bg-white border-[#E6ECFA] hover:border-[#FF8500] hover:bg-[#FFF9F2]'
                }`}
              >
                <span className="w-10 h-10 rounded-xl dh-orange-gradient text-white flex items-center justify-center shrink-0 shadow-xs group-hover:scale-105 transition-transform">
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                </span>

                <div className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-bold font-mono-num px-1.5 py-0.5 rounded bg-[#172033] text-white">
                      {ad.code}
                    </span>
                    <span className="text-[10px] text-[#777777] font-semibold">
                      #{idx + 1} · {lang === 'bn' ? 'সরাসরি ওপেন' : 'Direct Partner Link'}
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm font-bold text-[#172033] group-hover:text-[#FF8500] truncate transition-colors">
                    {title}
                  </p>
                </div>

                <span className="p-2 rounded-xl bg-[#F3F6FF] text-[#172033] group-hover:bg-[#FF8500] group-hover:text-white transition-colors shrink-0">
                  <ExternalLink className="w-4 h-4" />
                </span>
              </a>
            );
          })}
        </div>
      </div>
    </section>
  );
}
