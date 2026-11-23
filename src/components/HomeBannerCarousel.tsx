import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink } from 'lucide-react';
import type { AppRoute, HeroBanner, HeroBannerThemeVariant, Language } from '../types/marketplace';

export interface BannerThemeStyle {
  id: HeroBannerThemeVariant;
  labelBn: string;
  labelEn: string;
  swatchBg: string;
  swatchAccent: string;
  containerClass: string;
  accentOverlayClass: string;
  accentCornerClass: string;
  imageScrimCoverClass: string;
  imageScrimContainClass: string;
  titleClass: string;
  subtitleClass: string;
  buttonClass: string;
}

export const BANNER_THEME_STYLES: Record<HeroBannerThemeVariant, BannerThemeStyle> = {
  navy_services: {
    id: 'navy_services',
    labelBn: 'ডার্ক নেভি ও অরেঞ্জ',
    labelEn: 'Dark Navy & Orange',
    swatchBg: '#172033',
    swatchAccent: '#FF8500',
    containerClass:
      'bg-gradient-to-br from-[#172033] via-[#1C2840] to-[#11192B] border border-[#24324D]',
    accentOverlayClass:
      'bg-[radial-gradient(circle_at_90%_20%,rgba(255,133,0,0.22),transparent_52%)]',
    accentCornerClass: 'bg-[#FF8500]/90',
    imageScrimCoverClass: 'bg-gradient-to-r from-[#172033] via-[#172033]/85 to-[#172033]/35',
    imageScrimContainClass: 'bg-gradient-to-r from-[#172033]/92 via-[#172033]/60 to-transparent',
    titleClass: 'text-white',
    subtitleClass: 'text-slate-200',
    buttonClass: 'bg-[#FF8500] hover:bg-[#EA7600] text-white shadow-sm',
  },
  white_wallet: {
    id: 'white_wallet',
    labelBn: 'ক্লিন হোয়াইট ও অরেঞ্জ',
    labelEn: 'Clean White & Orange',
    swatchBg: '#FFFFFF',
    swatchAccent: '#FF8500',
    containerClass:
      'bg-white border border-[#E6ECFA] shadow-[0_10px_30px_rgba(23,32,51,0.08)]',
    accentOverlayClass:
      'bg-[radial-gradient(circle_at_92%_50%,rgba(255,133,0,0.12),transparent_52%)]',
    accentCornerClass: 'bg-[#FF8500]',
    imageScrimCoverClass: 'bg-gradient-to-r from-white via-white/90 to-white/40',
    imageScrimContainClass: 'bg-gradient-to-r from-white/95 via-white/75 to-transparent',
    titleClass: 'text-[#172033]',
    subtitleClass: 'text-[#475569]',
    buttonClass: 'bg-[#FF8500] hover:bg-[#EA7600] text-white shadow-sm',
  },
  orange_gaming: {
    id: 'orange_gaming',
    labelBn: 'অরেঞ্জ ও ডার্ক নেভি',
    labelEn: 'Signature Orange',
    swatchBg: '#FF8500',
    swatchAccent: '#172033',
    containerClass:
      'bg-gradient-to-br from-[#FF8500] via-[#F77B00] to-[#DE6400] border border-[#FF9924]',
    accentOverlayClass:
      'bg-[radial-gradient(circle_at_95%_85%,rgba(23,32,51,0.22),transparent_55%)]',
    accentCornerClass: 'bg-[#172033]',
    imageScrimCoverClass: 'bg-gradient-to-r from-[#DE6400] via-[#FF8500]/85 to-[#FF8500]/35',
    imageScrimContainClass: 'bg-gradient-to-r from-[#DE6400]/92 via-[#FF8500]/65 to-transparent',
    titleClass: 'text-white',
    subtitleClass: 'text-white/95',
    buttonClass: 'bg-[#172033] hover:bg-[#0F172A] text-white shadow-sm',
  },
  navy_support: {
    id: 'navy_support',
    labelBn: 'ক্লাসিক নেভি ও হোয়াইট',
    labelEn: 'Classic Navy & White',
    swatchBg: '#0F172A',
    swatchAccent: '#FFFFFF',
    containerClass:
      'bg-gradient-to-br from-[#101829] via-[#172033] to-[#1E2B45] border border-[#293856]',
    accentOverlayClass:
      'bg-[radial-gradient(circle_at_88%_80%,rgba(255,255,255,0.09),transparent_50%)]',
    accentCornerClass: 'bg-white/90',
    imageScrimCoverClass: 'bg-gradient-to-r from-[#101829] via-[#172033]/85 to-[#172033]/35',
    imageScrimContainClass: 'bg-gradient-to-r from-[#101829]/92 via-[#172033]/60 to-transparent',
    titleClass: 'text-white',
    subtitleClass: 'text-slate-200',
    buttonClass: 'bg-white hover:bg-[#F3F6FF] text-[#172033] shadow-sm',
  },
};

export const BANNER_THEME_LIST: BannerThemeStyle[] = [
  BANNER_THEME_STYLES.navy_services,
  BANNER_THEME_STYLES.white_wallet,
  BANNER_THEME_STYLES.orange_gaming,
  BANNER_THEME_STYLES.navy_support,
];

export function resolveBannerTheme(variant?: HeroBannerThemeVariant): BannerThemeStyle {
  if (variant && variant in BANNER_THEME_STYLES) {
    return BANNER_THEME_STYLES[variant];
  }
  return BANNER_THEME_STYLES.navy_services;
}

interface BannerSlideVisualProps {
  banner: HeroBanner;
  lang: Language;
  isMobileViewport?: boolean;
  preview?: boolean;
  onAction?: (banner: HeroBanner) => void;
}

export function BannerSlideVisual({
  banner,
  lang,
  isMobileViewport = false,
  preview = false,
  onAction,
}: BannerSlideVisualProps) {
  const theme = resolveBannerTheme(banner.themeVariant);
  const rawImg =
    isMobileViewport && banner.mobileImageUrl?.trim()
      ? banner.mobileImageUrl.trim()
      : (banner.imageUrl || '').trim();
  const [failedSrc, setFailedSrc] = useState<string>('');
  const showImage = Boolean(rawImg) && failedSrc !== rawImg;

  const isContain = banner.imageFit === 'contain';
  const clickable = banner.clickable !== false;
  const isExternal = clickable && banner.linkType === 'external_url' && Boolean(banner.targetUrl);

  const title =
    (lang === 'bn' ? banner.titleBn || banner.titleEn : banner.titleEn || banner.titleBn) ||
    'DIGITAL HUB BD';
  const subtitle =
    lang === 'bn' ? banner.subtitleBn || banner.subtitleEn : banner.subtitleEn || banner.subtitleBn;
  const buttonLabel =
    (lang === 'bn'
      ? banner.buttonTextBn || banner.buttonTextEn
      : banner.buttonTextEn || banner.buttonTextBn) ||
    (lang === 'bn' ? 'সার্ভিস দেখুন' : 'Explore Now');

  return (
    <div
      className={`relative w-full overflow-hidden rounded-2xl sm:rounded-3xl shadow-md flex items-center select-none ${
        preview ? 'min-h-[190px] sm:min-h-[220px]' : 'min-h-[195px] sm:min-h-[245px]'
      } ${theme.containerClass}`}
    >
      {showImage ? (
        <>
          <img
            src={rawImg}
            alt={title}
            draggable={false}
            referrerPolicy="no-referrer"
            onError={() => setFailedSrc(rawImg)}
            className={`absolute inset-0 w-full h-full pointer-events-none ${
              isContain ? 'object-contain object-right sm:object-center opacity-95' : 'object-cover opacity-55'
            }`}
          />
          <div
            className={`absolute inset-0 pointer-events-none ${
              isContain ? theme.imageScrimContainClass : theme.imageScrimCoverClass
            }`}
          />
        </>
      ) : (
        <>
          <div className={`absolute inset-0 pointer-events-none ${theme.accentOverlayClass}`} />
          <div
            aria-hidden="true"
            className="hidden sm:block absolute right-6 lg:right-10 top-1/2 -translate-y-1/2 pointer-events-none"
          >
            <div className="relative w-36 h-36 lg:w-44 lg:h-44 rounded-3xl border border-current/10 opacity-20 rotate-12 flex items-center justify-center">
              <div className={`w-16 h-16 lg:w-20 lg:h-20 rounded-2xl ${theme.accentCornerClass} opacity-80`} />
            </div>
          </div>
        </>
      )}

      {/* Clean left accent hairline */}
      <div
        aria-hidden="true"
        className={`absolute left-0 top-6 bottom-6 w-1 rounded-r-full pointer-events-none ${theme.accentCornerClass}`}
      />

      <div className="relative z-10 w-full px-5 py-6 sm:px-9 sm:py-8 md:px-11 flex flex-col items-start justify-center max-w-2xl space-y-2.5 sm:space-y-3">
        {preview ? (
          <h3 className={`text-lg sm:text-2xl md:text-[26px] font-extrabold leading-snug tracking-tight ${theme.titleClass}`}>
            {title}
          </h3>
        ) : (
          <h1 className={`text-lg sm:text-2xl md:text-[28px] font-extrabold leading-snug tracking-tight ${theme.titleClass}`}>
            {title}
          </h1>
        )}

        {subtitle && (
          <p className={`text-xs sm:text-sm md:text-[15px] leading-relaxed max-w-xl ${theme.subtitleClass}`}>
            {subtitle}
          </p>
        )}

        {clickable && (
          <div className="pt-1">
            {isExternal && !preview ? (
              <a
                href={banner.targetUrl}
                target={banner.openInNewTab ? '_blank' : '_self'}
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-extrabold inline-flex items-center gap-2 transition-all cursor-pointer ${theme.buttonClass}`}
              >
                <span>{buttonLabel}</span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0" />
              </a>
            ) : (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!preview && onAction) onAction(banner);
                }}
                className={`px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl text-xs sm:text-sm font-extrabold inline-flex items-center gap-2 transition-all cursor-pointer ${theme.buttonClass}`}
              >
                <span>{buttonLabel}</span>
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface HomeBannerCarouselProps {
  slides: HeroBanner[];
  fallbackBanner: HeroBanner;
  lang: Language;
  isMobileViewport: boolean;
  autoPlayMs: number;
  onNavigate: (route: AppRoute) => void;
}

export function HomeBannerCarousel({
  slides,
  fallbackBanner,
  lang,
  isMobileViewport,
  autoPlayMs,
  onNavigate,
}: HomeBannerCarouselProps) {
  const displaySlides = slides.length > 0 ? slides : [fallbackBanner];
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [dragOffsetPx, setDragOffsetPx] = useState(0);

  const swipeStartXRef = useRef<number | null>(null);
  const didDragRef = useRef(false);

  const safeIndex = displaySlides.length > 0 ? activeIndex % displaySlides.length : 0;

  useEffect(() => {
    if (displaySlides.length <= 1 || isPaused) return;
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % displaySlides.length);
    }, autoPlayMs);
    return () => window.clearInterval(timer);
  }, [displaySlides.length, autoPlayMs, isPaused]);

  const goPrev = useCallback(() => {
    if (displaySlides.length <= 1) return;
    setActiveIndex((prev) => (prev - 1 + displaySlides.length) % displaySlides.length);
  }, [displaySlides.length]);

  const goNext = useCallback(() => {
    if (displaySlides.length <= 1) return;
    setActiveIndex((prev) => (prev + 1) % displaySlides.length);
  }, [displaySlides.length]);

  const handleSlideAction = useCallback(
    (banner: HeroBanner) => {
      if (banner.clickable === false) return;
      if (banner.linkType === 'external_url' && banner.targetUrl) {
        if (banner.openInNewTab) {
          window.open(banner.targetUrl, '_blank', 'noopener,noreferrer');
        } else {
          window.location.href = banner.targetUrl;
        }
        return;
      }
      onNavigate(banner.ctaRoute || 'services');
    },
    [onNavigate]
  );

  const startSwipe = (clientX: number) => {
    if (displaySlides.length <= 1) return;
    swipeStartXRef.current = clientX;
    didDragRef.current = false;
    setIsPaused(true);
  };

  const moveSwipe = (clientX: number) => {
    if (swipeStartXRef.current === null) return;
    const delta = clientX - swipeStartXRef.current;
    if (Math.abs(delta) > 8) didDragRef.current = true;
    setDragOffsetPx(Math.max(-90, Math.min(90, delta)));
  };

  const endSwipe = () => {
    if (swipeStartXRef.current === null) return;
    const delta = dragOffsetPx;
    swipeStartXRef.current = null;
    setDragOffsetPx(0);
    setIsPaused(false);
    if (delta <= -40) {
      goNext();
    } else if (delta >= 40) {
      goPrev();
    }
  };

  return (
    <div
      className="relative group"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => {
        setIsPaused(false);
        endSwipe();
      }}
    >
      <div
        className="overflow-hidden rounded-2xl sm:rounded-3xl touch-pan-y"
        onTouchStart={(e) => {
          if (e.touches[0]) startSwipe(e.touches[0].clientX);
        }}
        onTouchMove={(e) => {
          if (e.touches[0]) moveSwipe(e.touches[0].clientX);
        }}
        onTouchEnd={endSwipe}
        onTouchCancel={endSwipe}
        onMouseDown={(e) => {
          const target = e.target as HTMLElement | null;
          if (target?.closest('button, a')) return;
          startSwipe(e.clientX);
        }}
        onMouseMove={(e) => moveSwipe(e.clientX)}
        onMouseUp={endSwipe}
      >
        <div
          className="flex will-change-transform"
          style={{
            transform: `translate3d(calc(-${safeIndex * 100}% + ${dragOffsetPx}px), 0, 0)`,
            transition: dragOffsetPx !== 0 ? 'none' : 'transform 450ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {displaySlides.map((slide) => (
            <div
              key={slide.id}
              onClick={() => {
                if (didDragRef.current) {
                  didDragRef.current = false;
                  return;
                }
                if (slide.clickable !== false) handleSlideAction(slide);
              }}
              className={`w-full shrink-0 ${slide.clickable !== false ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <BannerSlideVisual
                banner={slide}
                lang={lang}
                isMobileViewport={isMobileViewport}
                onAction={handleSlideAction}
              />
            </div>
          ))}
        </div>
      </div>

      {displaySlides.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goPrev();
            }}
            aria-label={lang === 'bn' ? 'আগের ব্যানার' : 'Previous banner'}
            className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-[#172033]/65 hover:bg-[#FF8500] text-white items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-md cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              goNext();
            }}
            aria-label={lang === 'bn' ? 'পরবর্তী ব্যানার' : 'Next banner'}
            className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-20 w-9 h-9 rounded-full bg-[#172033]/65 hover:bg-[#FF8500] text-white items-center justify-center opacity-0 group-hover:opacity-100 transition-all shadow-md cursor-pointer"
          >
            <ArrowRight className="w-4 h-4" />
          </button>

          <div className="mt-2.5 flex items-center justify-center gap-1.5">
            {displaySlides.map((slide, idx) => {
              const isActive = safeIndex === idx;
              return (
                <button
                  key={slide.id}
                  type="button"
                  onClick={() => setActiveIndex(idx)}
                  aria-label={`${lang === 'bn' ? 'ব্যানার' : 'Banner'} ${idx + 1}`}
                  aria-current={isActive ? 'true' : undefined}
                  className={`h-1.5 rounded-full transition-all cursor-pointer ${
                    isActive
                      ? 'w-6 bg-[#FF8500]'
                      : 'w-2 bg-[#172033]/20 dark:bg-slate-600 hover:bg-[#FF8500]/50'
                  }`}
                />
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
