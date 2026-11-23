import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Crop,
  ExternalLink,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Link2,
  Maximize2,
  Monitor,
  MousePointerClick,
  Plus,
  RefreshCw,
  Save,
  Smartphone,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  AppRoute,
  HeroBanner,
  HeroBannerDevice,
  HeroBannerIconName,
  HeroBannerImageFit,
  HeroBannerLinkType,
  Language,
  SiteSettings,
} from '../../types/marketplace';
import {
  adminDeleteHeroBanner,
  adminSaveHeroBanner,
  adminSaveSiteSettings,
  adminUploadMediaAsset,
  generateId,
  optimizePackageLogoFile,
  subscribeHeroBanners,
} from '../../lib/firestoreService';
import { HERO_BANNER_ICON_OPTIONS, HeroBannerIconBadge } from '../../lib/heroBannerIcons';
import { ConfirmDialog } from './ConfirmDialog';

interface AdminBannerManagerPanelProps {
  lang: Language;
  settings: SiteSettings;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

const INTERNAL_ROUTE_OPTIONS: Array<{ value: AppRoute; labelEn: string; labelBn: string }> = [
  { value: 'gaming-store', labelEn: 'Gaming Top-Up Store', labelBn: 'গেমিং টপ-আপ স্টোর' },
  { value: 'games-store', labelEn: 'Online & Android Games', labelBn: 'অনলাইন ও অ্যান্ড্রয়েড গেমস' },
  { value: 'mobile-apps', labelEn: 'Smart App Store', labelBn: 'স্মার্ট অ্যাপ স্টোর' },
  { value: 'services', labelEn: 'All Digital Services', labelBn: 'সকল ডিজিটাল সার্ভিস' },
  { value: 'gift-cards', labelEn: 'Gift Cards & Vouchers', labelBn: 'গিফট কার্ড ও ভাউচার' },
  { value: 'streaming-store', labelEn: 'Streaming Subscriptions', labelBn: 'স্ট্রিমিং সাবস্ক্রিপশন' },
  { value: 'telegram-store', labelEn: 'Telegram Services', labelBn: 'টেলিগ্রাম সার্ভিস' },
  { value: 'telegram-stars', labelEn: 'Telegram Stars', labelBn: 'টেলিগ্রাম স্টার্স' },
  { value: 'vip-groups', labelEn: 'VIP Channels & Groups', labelBn: 'ভিআইপি চ্যানেল ও গ্রুপ' },
  { value: 'ai-marketplace', labelEn: 'AI Tools & Plans', labelBn: 'এআই টুলস ও প্ল্যান' },
  { value: 'software-store', labelEn: 'Software & Licenses', labelBn: 'সফটওয়্যার ও লাইসেন্স' },
  { value: 'digital-products', labelEn: 'Digital Products', labelBn: 'ডিজিটাল প্রোডাক্টস' },
  { value: 'graphic-design', labelEn: 'Graphic Design Assets', labelBn: 'গ্রাফিক ডিজাইন অ্যাসেটস' },
  { value: 'social-media', labelEn: 'Social Media Services', labelBn: 'সোশ্যাল মিডিয়া সার্ভিস' },
  { value: 'offers', labelEn: 'Special Offers & Deals', labelBn: 'স্পেশাল অফার ও ডিলস' },
  { value: 'watch-earn', labelEn: 'Watch & Earn Coins', labelBn: 'ওয়াচ অ্যান্ড আর্ন কয়েন' },
  { value: 'add-money', labelEn: 'Add Money / Deposit', labelBn: 'অ্যাড মানি / ডিপোজিট' },
  { value: 'wallet', labelEn: 'My Wallet & Coins', labelBn: 'আমার ওয়ালেট ও কয়েন' },
  { value: 'support', labelEn: 'Customer Support', labelBn: 'কাস্টমার সাপোর্ট' },
  { value: 'home', labelEn: 'Homepage', labelBn: 'হোমপেজ' },
];

function getEmptyDraft(nextOrder: number): HeroBanner {
  return {
    id: generateId('hero'),
    badgeEn: 'SPECIAL PROMO',
    badgeBn: 'স্পেশাল প্রোমো',
    titleEn: 'Instant Digital Services BD',
    titleBn: 'দ্রুত ডিজিটাল সার্ভিস BD',
    subtitleEn: 'Fast delivery via verified bKash, Nagad & Rocket',
    subtitleBn: 'যাচাইকৃত বিকাশ, নগদ ও রকেট পেমেন্টে দ্রুত ডেলিভারি',
    buttonTextEn: 'Explore Now',
    buttonTextBn: 'এখনই দেখুন',
    linkType: 'internal_route',
    ctaRoute: 'gaming-store',
    targetUrl: '',
    openInNewTab: false,
    clickable: true,
    iconName: 'sparkles',
    showIcon: true,
    imageFit: 'cover',
    imageUrl: '',
    mobileImageUrl: '',
    deviceVisibility: 'both',
    sortOrder: nextOrder,
    enabled: true,
    startDate: '',
    endDate: '',
  };
}

function normalizeBannerForDraft(b: HeroBanner): HeroBanner {
  return {
    ...b,
    clickable: b.clickable !== false,
    showIcon: b.showIcon !== false,
    iconName: b.iconName || 'sparkles',
    imageFit: b.imageFit === 'contain' ? 'contain' : 'cover',
    deviceVisibility: b.deviceVisibility || 'both',
    enabled: b.enabled !== false,
  };
}

export function AdminBannerManagerPanel({
  lang,
  settings,
  onSuccess,
  onError,
}: AdminBannerManagerPanelProps) {
  const [heroBanners, setHeroBanners] = useState<HeroBanner[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNewSlide, setIsNewSlide] = useState(false);
  const [draft, setDraft] = useState<HeroBanner>(() => getEmptyDraft(1));
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Slider auto-rotation duration inside optional settings
  const [autoPlaySeconds, setAutoPlaySeconds] = useState<number>(() =>
    Math.max(2, Math.min(20, Math.round((settings.heroAutoPlayMs || 5500) / 1000)))
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    setAutoPlaySeconds(Math.max(2, Math.min(20, Math.round((settings.heroAutoPlayMs || 5500) / 1000))));
  }, [settings.heroAutoPlayMs]);

  useEffect(() => {
    const unsub = subscribeHeroBanners((items) => {
      setHeroBanners(items);
    });
    return () => unsub();
  }, []);

  const orderedBanners = useMemo(
    () =>
      [...heroBanners].sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)),
    [heroBanners]
  );

  // Immediately load current active banner on first open so Preview & Editor open directly
  useEffect(() => {
    if (orderedBanners.length === 0) return;
    if (!initializedRef.current) {
      initializedRef.current = true;
      const activeFirst = orderedBanners.find((b) => b.enabled) || orderedBanners[0];
      setSelectedId(activeFirst.id);
      setIsNewSlide(false);
      setDraft(normalizeBannerForDraft(activeFirst));
    }
  }, [orderedBanners]);

  const selectBanner = (banner: HeroBanner) => {
    setIsNewSlide(false);
    setSelectedId(banner.id);
    setDraft(normalizeBannerForDraft(banner));
  };

  const startNewBanner = () => {
    const maxOrder = orderedBanners.reduce((m, b) => Math.max(m, Number(b.sortOrder) || 0), 0);
    const fresh = getEmptyDraft(maxOrder + 1);
    setIsNewSlide(true);
    setSelectedId(fresh.id);
    setDraft(fresh);
  };

  const handleBannerFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const optimized = await optimizePackageLogoFile(file, 1600);
      const uploaded = await adminUploadMediaAsset(optimized);
      setDraft((prev) => ({
        ...prev,
        imageUrl: uploaded.url,
        // Clear mobile override when replacing main banner so new photo displays everywhere unless explicitly set
        mobileImageUrl: '',
      }));
      onSuccess(
        lang === 'bn'
          ? 'ব্যানার ছবি আপলোড হয়েছে। প্রিভিউ দেখে "Save Banner" চাপুন।'
          : 'Banner image uploaded. Review preview and click "Save Banner" to publish.'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to upload banner image.');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveBanner = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.imageUrl.trim()) {
      onError(
        lang === 'bn'
          ? 'অনুগ্রহ করে আগে একটি ব্যানার ছবি আপলোড করুন।'
          : 'Please upload a banner image before saving.'
      );
      return;
    }
    if (draft.clickable !== false && draft.linkType === 'external_url') {
      const cleanUrl = (draft.targetUrl || '').trim();
      if (!/^https?:\/\//i.test(cleanUrl)) {
        onError(
          lang === 'bn'
            ? 'সঠিক URL দিন (https:// দিয়ে শুরু করুন)।'
            : 'External destination URL must start with https:// or http://'
        );
        return;
      }
    }
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
      onError('Expiration date cannot be earlier than start date.');
      return;
    }

    setSaving(true);
    try {
      const targetId = draft.id || generateId('hero');
      const payload: HeroBanner = {
        ...draft,
        id: targetId,
        badgeEn: (draft.badgeEn || '').trim(),
        badgeBn: (draft.badgeBn || draft.badgeEn || '').trim(),
        titleEn: (draft.titleEn || draft.titleBn || 'Digital Hub BD').trim(),
        titleBn: (draft.titleBn || draft.titleEn || 'ডিজিটাল হাব বিডি').trim(),
        subtitleEn: (draft.subtitleEn || draft.subtitleBn || '').trim(),
        subtitleBn: (draft.subtitleBn || draft.subtitleEn || '').trim(),
        buttonTextEn: (draft.buttonTextEn || 'Explore Now').trim(),
        buttonTextBn: (draft.buttonTextBn || draft.buttonTextEn || 'এখনই দেখুন').trim(),
        clickable: draft.clickable !== false,
        iconName: (draft.iconName || 'sparkles') as HeroBannerIconName,
        showIcon: draft.showIcon !== false,
        imageFit: draft.imageFit === 'contain' ? 'contain' : 'cover',
        linkType: draft.linkType || 'internal_route',
        ctaRoute: draft.linkType === 'internal_route' ? (draft.ctaRoute || 'gaming-store') : undefined,
        targetUrl: draft.linkType === 'external_url' ? (draft.targetUrl || '').trim() : undefined,
        openInNewTab: draft.linkType === 'external_url' ? Boolean(draft.openInNewTab) : false,
        imageUrl: draft.imageUrl.trim(),
        mobileImageUrl: (draft.mobileImageUrl || '').trim() || undefined,
        deviceVisibility: draft.deviceVisibility || 'both',
        sortOrder: Math.max(0, Math.round(Number(draft.sortOrder) || 1)),
        enabled: draft.enabled !== false,
        startDate: (draft.startDate || '').trim() || undefined,
        endDate: (draft.endDate || '').trim() || undefined,
      };

      await adminSaveHeroBanner(payload, isNewSlide);

      // Save autoplay seconds seamlessly if changed
      const clampedMs = Math.max(2, Math.min(20, Math.round(Number(autoPlaySeconds) || 5))) * 1000;
      if (clampedMs !== (settings.heroAutoPlayMs || 5500)) {
        await adminSaveSiteSettings({ ...settings, heroAutoPlayMs: clampedMs });
      }

      setIsNewSlide(false);
      setSelectedId(targetId);
      setDraft(payload);
      onSuccess(
        lang === 'bn'
          ? 'ব্যানার সফলভাবে সংরক্ষিত হয়েছে এবং মূল ওয়েবসাইটে প্রকাশিত হয়েছে!'
          : 'Banner saved permanently and updated live on Digital Hub BD!'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save banner.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveBanner = async () => {
    setRemoving(true);
    try {
      if (!isNewSlide && draft.id) {
        await adminDeleteHeroBanner(draft.id);
      }
      const remaining = orderedBanners.filter((b) => b.id !== draft.id);
      if (remaining.length > 0) {
        selectBanner(remaining[0]);
      } else {
        startNewBanner();
      }
      setRemoveConfirmOpen(false);
      onSuccess(
        lang === 'bn'
          ? 'ব্যানার সফলভাবে সরানো হয়েছে।'
          : 'Banner removed successfully.'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to remove banner.');
    } finally {
      setRemoving(false);
    }
  };

  const previewImg =
    previewDevice === 'mobile' && draft.mobileImageUrl?.trim()
      ? draft.mobileImageUrl.trim()
      : draft.imageUrl.trim();

  const isFitContain = draft.imageFit === 'contain';
  const isClickable = draft.clickable !== false;
  const isIconVisible = draft.showIcon !== false;

  return (
    <div className="max-w-5xl mx-auto space-y-5 text-xs">
      {/* Hidden Gallery / File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={uploading}
        onChange={(e) => void handleBannerFilePicked(e)}
      />

      {/* Top Slide Switcher Bar — Minimal, Direct, Zero Submenus */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {orderedBanners.map((b, idx) => {
            const active = !isNewSlide && selectedId === b.id;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => selectBanner(b)}
                className={`px-3.5 py-2 rounded-xl font-bold flex items-center gap-2 transition-all cursor-pointer ${
                  active
                    ? 'bg-[#172033] dark:bg-[#FF8500] text-white shadow-xs'
                    : 'bg-[#F3F6FF] dark:bg-slate-800 text-[#172033] dark:text-slate-200 hover:border-[#FF8500] border border-transparent'
                }`}
              >
                <span className="w-2 h-2 rounded-full shrink-0 bg-[#FF8500]" style={active ? { backgroundColor: '#FFFFFF' } : undefined} />
                <span>
                  {lang === 'bn' ? `ব্যানার ${idx + 1}` : `Banner ${idx + 1}`}
                </span>
                {!b.enabled && (
                  <span className="text-[10px] opacity-70">(Off)</span>
                )}
              </button>
            );
          })}
          <button
            type="button"
            onClick={startNewBanner}
            className={`px-3.5 py-2 rounded-xl font-bold inline-flex items-center gap-1.5 border transition-colors cursor-pointer ${
              isNewSlide
                ? 'bg-[#FF8500] border-[#FF8500] text-white'
                : 'bg-white dark:bg-slate-900 border-dashed border-[#FF8500] text-[#FF8500] hover:bg-[#FFF3E5] dark:hover:bg-orange-950/30'
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{lang === 'bn' ? 'নতুন ব্যানার' : 'Add New Banner'}</span>
          </button>
        </div>

        <span className="text-[11px] font-semibold text-[#777777] dark:text-slate-400">
          {orderedBanners.length} {lang === 'bn' ? 'টি ব্যানার সক্রিয়' : 'Banner(s)'}
        </span>
      </div>

      {/* 1. LIVE BANNER PREVIEW (Shown Immediately at the Top) */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 sm:p-6 space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-[#FFF3E5] dark:bg-orange-950/40 text-[#FF8500] flex items-center justify-center">
              <Eye className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-sm sm:text-base font-extrabold text-[#172033] dark:text-slate-100">
                {lang === 'bn' ? 'বর্তমান ব্যানার প্রিভিউ' : 'Live Banner Preview'}
              </h2>
              <p className="text-[11px] text-[#777777] dark:text-slate-400">
                {lang === 'bn'
                  ? 'সেভ করার আগেই ডেস্কটপ ও মোবাইলে কেমন দেখাবে তা দেখুন'
                  : 'See how your banner looks on Desktop & Mobile before saving'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Fit / Crop Quick Toggle */}
            <div className="inline-flex rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 p-1">
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, imageFit: 'cover' }))}
                className={`px-2.5 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                  !isFitContain
                    ? 'bg-[#FF8500] text-white'
                    : 'text-[#5C6B84] dark:text-slate-300'
                }`}
              >
                <Crop className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'ক্রপ / ফিল' : 'Crop & Fill'}</span>
              </button>
              <button
                type="button"
                onClick={() => setDraft((prev) => ({ ...prev, imageFit: 'contain' }))}
                className={`px-2.5 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                  isFitContain
                    ? 'bg-[#FF8500] text-white'
                    : 'text-[#5C6B84] dark:text-slate-300'
                }`}
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'ফিট (কাটবে না)' : 'Fit Full Image'}</span>
              </button>
            </div>

            {/* Desktop vs Mobile Preview Toggle */}
            <div className="inline-flex rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 p-1">
              <button
                type="button"
                onClick={() => setPreviewDevice('desktop')}
                className={`px-2.5 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                  previewDevice === 'desktop'
                    ? 'bg-[#172033] text-white'
                    : 'text-[#5C6B84] dark:text-slate-300'
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                <span>Desktop</span>
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice('mobile')}
                className={`px-2.5 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                  previewDevice === 'mobile'
                    ? 'bg-[#172033] text-white'
                    : 'text-[#5C6B84] dark:text-slate-300'
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                <span>Mobile</span>
              </button>
            </div>
          </div>
        </div>

        {/* Live Preview Canvas */}
        <div
          className={`relative rounded-3xl overflow-hidden bg-[#172033] shadow-lg mx-auto transition-all ${
            previewDevice === 'mobile'
              ? 'max-w-[360px] min-h-[210px]'
              : 'w-full min-h-[230px] sm:min-h-[260px]'
          } ${isClickable ? 'ring-2 ring-[#FF8500]/40' : ''}`}
        >
          {previewImg ? (
            <img
              src={previewImg}
              alt="Banner preview"
              className={`absolute inset-0 w-full h-full transition-all duration-300 ${
                isFitContain ? 'object-contain object-center opacity-90' : 'object-cover opacity-60'
              }`}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40 gap-2">
              <ImageIcon className="w-10 h-10" />
              <span className="text-xs font-bold">
                {lang === 'bn' ? 'কোনো ব্যানার ছবি নির্বাচিত নেই' : 'No Banner Image Selected'}
              </span>
            </div>
          )}

          <div
            className={`absolute inset-0 ${
              isFitContain
                ? 'bg-gradient-to-r from-[#172033]/90 via-[#172033]/55 to-transparent'
                : 'bg-gradient-to-r from-[#172033] via-[#172033]/85 to-[#172033]/35'
            }`}
          />

          <div className="relative z-10 p-5 sm:p-7 flex flex-col justify-center min-h-[220px] max-w-xl space-y-2.5">
            {(draft.badgeEn || draft.badgeBn || isIconVisible) && (
              <span className="self-start inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#FF8500] text-white text-[11px] font-extrabold tracking-wide shadow-xs">
                {isIconVisible && (
                  <HeroBannerIconBadge name={draft.iconName} className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>
                  {(lang === 'bn' ? draft.badgeBn || draft.badgeEn : draft.badgeEn || draft.badgeBn) ||
                    'DIGITAL HUB BD'}
                </span>
              </span>
            )}
            <h3 className="text-lg sm:text-2xl font-extrabold text-white leading-tight">
              {(lang === 'bn' ? draft.titleBn || draft.titleEn : draft.titleEn || draft.titleBn) ||
                'Your Banner Headline'}
            </h3>
            {(draft.subtitleEn || draft.subtitleBn) && (
              <p className="text-xs sm:text-sm text-white/80 line-clamp-2">
                {lang === 'bn' ? draft.subtitleBn || draft.subtitleEn : draft.subtitleEn || draft.subtitleBn}
              </p>
            )}
            <div className="pt-1 flex flex-wrap items-center gap-2">
              {isClickable ? (
                <span className="px-4 py-1.5 rounded-full bg-[#FACC15] text-[#172033] text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm">
                  <span>
                    {lang === 'bn'
                      ? draft.buttonTextBn || draft.buttonTextEn || 'এখনই দেখুন'
                      : draft.buttonTextEn || draft.buttonTextBn || 'Explore Now'}
                  </span>
                  {draft.linkType === 'external_url' && <ExternalLink className="w-3.5 h-3.5" />}
                </span>
              ) : (
                <span className="px-3 py-1 rounded-full bg-white/15 text-white/75 text-[11px] font-bold">
                  {lang === 'bn' ? 'ব্যানার ক্লিক বন্ধ আছে' : 'Banner Click Disabled'}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Direct Quick Upload / Replace / Remove Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2.5 rounded-xl dh-orange-gradient text-white font-extrabold inline-flex items-center gap-2 shadow-sm hover:opacity-95 disabled:opacity-50 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>
                {uploading
                  ? lang === 'bn'
                    ? 'আপলোড হচ্ছে...'
                    : 'Uploading...'
                  : draft.imageUrl
                    ? lang === 'bn'
                      ? 'Replace Banner (ছবি পরিবর্তন)'
                      : 'Replace Banner'
                    : lang === 'bn'
                      ? 'Upload Banner (গ্যালারি / ফাইল)'
                      : 'Upload Banner'}
              </span>
            </button>

            {draft.imageUrl && (
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-100 font-bold inline-flex items-center gap-1.5 hover:border-[#FF8500] cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-[#FF8500]" />
                <span>{lang === 'bn' ? 'নতুন ছবি দিন' : 'Upload New Photo'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setRemoveConfirmOpen(true)}
              className="px-3.5 py-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 text-[#DC2626] font-bold inline-flex items-center gap-1.5 hover:bg-red-100 dark:hover:bg-red-950/70 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'Remove Banner' : 'Remove Banner'}</span>
            </button>
          </div>

          <button
            type="button"
            disabled={saving || uploading}
            onClick={(e) => void handleSaveBanner(e as unknown as FormEvent)}
            className="px-5 py-2.5 rounded-xl bg-[#172033] dark:bg-[#FF8500] text-white font-extrabold inline-flex items-center gap-2 hover:opacity-95 disabled:opacity-50 cursor-pointer shadow-sm"
          >
            <Save className="w-4 h-4" />
            <span>
              {saving
                ? lang === 'bn'
                  ? 'সেভ হচ্ছে...'
                  : 'Saving...'
                : lang === 'bn'
                  ? 'Save Banner'
                  : 'Save Banner'}
            </span>
          </button>
        </div>
      </div>

      {/* 2. DIRECT BANNER EDITOR FORM (Icon, Link, Text & Optional Schedule) */}
      <form
        onSubmit={handleSaveBanner}
        className="rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 sm:p-6 space-y-5"
      >
        {/* Icon Picker + Show/Hide Toggle */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
                {lang === 'bn' ? 'ব্যানার আইকন' : 'Banner Icon'}
              </h3>
              <p className="text-[11px] text-[#777777] dark:text-slate-400">
                {lang === 'bn'
                  ? 'ব্যানারের সাথে দেখানোর জন্য একটি আইকন নির্বাচন করুন অথবা লুকিয়ে রাখুন'
                  : 'Choose an icon to show on the banner or hide it completely'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft((prev) => ({ ...prev, showIcon: !isIconVisible }))}
              className={`px-3.5 py-2 rounded-xl font-bold inline-flex items-center gap-2 border transition-colors cursor-pointer ${
                isIconVisible
                  ? 'bg-[#FFF3E5] dark:bg-orange-950/40 border-[#FF8500]/50 text-[#FF8500]'
                  : 'bg-[#F3F6FF] dark:bg-slate-800 border-[#E6ECFA] dark:border-slate-700 text-[#777777]'
              }`}
            >
              {isIconVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span>
                {isIconVisible
                  ? lang === 'bn'
                    ? 'আইকন দেখানো হচ্ছে (ON)'
                    : 'Icon Visible (ON)'
                  : lang === 'bn'
                    ? 'আইকন লুকানো (OFF)'
                    : 'Icon Hidden (OFF)'}
              </span>
            </button>
          </div>

          {isIconVisible && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {HERO_BANNER_ICON_OPTIONS.map((item) => {
                const IconComp = item.Icon;
                const active = (draft.iconName || 'sparkles') === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, iconName: item.id }))}
                    className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1.5 font-bold transition-all cursor-pointer ${
                      active
                        ? 'bg-[#FF8500] border-[#FF8500] text-white shadow-xs'
                        : 'bg-[#F8FAFF] dark:bg-slate-800/60 border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200 hover:border-[#FF8500]'
                    }`}
                  >
                    <IconComp className="w-4 h-4" />
                    <span className="text-[10px] truncate w-full text-center">
                      {lang === 'bn' ? item.labelBn : item.labelEn}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Banner Click & Destination Control */}
        <div className="pt-4 border-t border-[#E6ECFA] dark:border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
                <Link2 className="w-4 h-4 text-[#FF8500]" />
                <span>{lang === 'bn' ? 'ব্যানার লিংক ও ক্লিক কন্ট্রোল' : 'Banner Link & Click Action'}</span>
              </h3>
              <p className="text-[11px] text-[#777777] dark:text-slate-400">
                {lang === 'bn'
                  ? 'ব্যানারে ক্লিক করলে কোন পেজ বা সার্ভিস খুলবে তা নির্বাচন করুন অথবা ক্লিক বন্ধ রাখুন'
                  : 'Select which page, service, or URL opens when clicked, or turn off click'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDraft((prev) => ({ ...prev, clickable: !isClickable }))}
              className={`px-3.5 py-2 rounded-xl font-bold inline-flex items-center gap-2 border transition-colors cursor-pointer ${
                isClickable
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                  : 'bg-[#F3F6FF] dark:bg-slate-800 border-[#E6ECFA] dark:border-slate-700 text-[#777777]'
              }`}
            >
              <MousePointerClick className="w-3.5 h-3.5" />
              <span>
                {isClickable
                  ? lang === 'bn'
                    ? 'সম্পূর্ণ ক্লিকযোগ্য (ON)'
                    : 'Banner Clickable (ON)'
                  : lang === 'bn'
                    ? 'ক্লিক বন্ধ (OFF)'
                    : 'Click Disabled (OFF)'}
              </span>
            </button>
          </div>

          {isClickable && (
            <div className="rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/50 border border-[#E6ECFA] dark:border-slate-700 p-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {(['internal_route', 'external_url'] as HeroBannerLinkType[]).map((lt) => (
                  <button
                    key={lt}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, linkType: lt }))}
                    className={`px-3.5 py-1.5 rounded-xl font-bold cursor-pointer transition-colors ${
                      draft.linkType === lt
                        ? 'bg-[#FF8500] text-white'
                        : 'bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 text-[#5C6B84] dark:text-slate-300'
                    }`}
                  >
                    {lt === 'internal_route'
                      ? lang === 'bn'
                        ? 'ওয়েবসাইট পেজ / সার্ভিস'
                        : 'Website Page / Service'
                      : lang === 'bn'
                        ? 'কাস্টম লিংক (URL)'
                        : 'Custom External URL'}
                  </button>
                ))}
              </div>

              {draft.linkType === 'internal_route' ? (
                <select
                  value={draft.ctaRoute || 'gaming-store'}
                  onChange={(e) => setDraft((prev) => ({ ...prev, ctaRoute: e.target.value as AppRoute }))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 font-semibold"
                >
                  {INTERNAL_ROUTE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {lang === 'bn' ? `${opt.labelBn} (/${opt.value})` : `${opt.labelEn} — /${opt.value}`}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="space-y-2">
                  <input
                    type="url"
                    value={draft.targetUrl || ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, targetUrl: e.target.value }))}
                    placeholder="https://example.com/promo"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                  />
                  <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.openInNewTab)}
                      onChange={(e) => setDraft((prev) => ({ ...prev, openInNewTab: e.target.checked }))}
                      className="accent-[#FF8500]"
                    />
                    <span>{lang === 'bn' ? 'নতুন ট্যাবে খুলবে' : 'Open link in new tab'}</span>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Simple Text & Image URL Controls */}
        <div className="pt-4 border-t border-[#E6ECFA] dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block font-bold mb-1">
              {lang === 'bn' ? 'শিরোনাম (English)' : 'Banner Title (English)'}
            </label>
            <input
              type="text"
              value={draft.titleEn}
              onChange={(e) => setDraft((prev) => ({ ...prev, titleEn: e.target.value }))}
              placeholder="Instant Free Fire Diamonds & Top-Up"
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">
              {lang === 'bn' ? 'শিরোনাম (বাংলা)' : 'Banner Title (Bangla)'}
            </label>
            <input
              type="text"
              value={draft.titleBn}
              onChange={(e) => setDraft((prev) => ({ ...prev, titleBn: e.target.value }))}
              placeholder="দ্রুত ডিজিটাল সার্ভিস ও টপ-আপ"
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">
              {lang === 'bn' ? 'সাবটাইটেল (English)' : 'Subtitle (English)'}
            </label>
            <input
              type="text"
              value={draft.subtitleEn}
              onChange={(e) => setDraft((prev) => ({ ...prev, subtitleEn: e.target.value }))}
              placeholder="Fast delivery via bKash, Nagad & Rocket"
              className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">
              {lang === 'bn' ? 'বাটন টেক্সট (EN / BN)' : 'CTA Button Label'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={draft.buttonTextEn}
                onChange={(e) => setDraft((prev) => ({ ...prev, buttonTextEn: e.target.value }))}
                placeholder="Explore Now"
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
              <input
                type="text"
                value={draft.buttonTextBn}
                onChange={(e) => setDraft((prev) => ({ ...prev, buttonTextBn: e.target.value }))}
                placeholder="এখনই দেখুন"
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
            </div>
          </div>
        </div>

        {/* Collapsible Optional Schedule, Device & Slider Timing (Kept Cleanly Out of the Way) */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowMoreOptions((v) => !v)}
            className="text-[11px] font-bold text-[#5C6B84] dark:text-slate-400 hover:text-[#FF8500] inline-flex items-center gap-1 cursor-pointer"
          >
            {showMoreOptions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>
              {lang === 'bn'
                ? 'ঐচ্ছিক সেটিংস (শিডিউল, ডিভাইস, অর্ডার ও স্লাইডার টাইম)'
                : 'Optional Settings (Badge, Visibility, Schedule & Slider Speed)'}
            </span>
          </button>

          {showMoreOptions && (
            <div className="mt-3 rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/50 border border-[#E6ECFA] dark:border-slate-700 p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block font-bold mb-1">Badge (EN)</label>
                <input
                  type="text"
                  value={draft.badgeEn}
                  onChange={(e) => setDraft((prev) => ({ ...prev, badgeEn: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Badge (BN)</label>
                <input
                  type="text"
                  value={draft.badgeBn}
                  onChange={(e) => setDraft((prev) => ({ ...prev, badgeBn: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Device Display</label>
                <select
                  value={draft.deviceVisibility}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, deviceVisibility: e.target.value as HeroBannerDevice }))
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700"
                >
                  <option value="both">Desktop & Mobile</option>
                  <option value="desktop">Desktop Only</option>
                  <option value="mobile">Mobile Only</option>
                </select>
              </div>
              <div>
                <label className="block font-bold mb-1">Slide Order</label>
                <input
                  type="number"
                  min={1}
                  value={draft.sortOrder}
                  onChange={(e) => setDraft((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
                  className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Start Date</label>
                <input
                  type="date"
                  value={draft.startDate || ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, startDate: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Expiry Date</label>
                <input
                  type="date"
                  value={draft.endDate || ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, endDate: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Slider Speed (sec)</label>
                <input
                  type="number"
                  min={2}
                  max={20}
                  value={autoPlaySeconds}
                  onChange={(e) => setAutoPlaySeconds(Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                />
              </div>
              <label className="flex items-center gap-2 font-bold cursor-pointer self-end pb-1.5">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(e) => setDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
                  className="accent-[#FF8500] w-4 h-4"
                />
                <span>Banner Active</span>
              </label>
            </div>
          )}
        </div>

        {/* Sticky Bottom Save Footer */}
        <div className="pt-4 border-t border-[#E6ECFA] dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-[#777777] dark:text-slate-400">
            {lang === 'bn'
              ? 'Save Changes চাপলে ব্যানারটি ডাটাবেজে স্থায়ীভাবে সেভ হয়ে ওয়েবসাইটে দেখাবে।'
              : 'Clicking Save Banner stores changes permanently and updates the live site.'}
          </p>
          <button
            type="submit"
            disabled={saving || uploading}
            className="px-6 py-2.5 rounded-xl dh-orange-gradient text-white font-extrabold inline-flex items-center gap-2 shadow-sm hover:opacity-95 disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            <span>
              {saving
                ? lang === 'bn'
                  ? 'সংরক্ষণ হচ্ছে...'
                  : 'Saving...'
                : lang === 'bn'
                  ? 'Save Changes'
                  : 'Save Banner'}
            </span>
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={removeConfirmOpen}
        lang={lang}
        title={lang === 'bn' ? 'ব্যানার সরিয়ে ফেলবেন?' : 'Remove Current Banner?'}
        description={
          lang === 'bn'
            ? `"${draft.titleBn || draft.titleEn}" ব্যানারটি হোমপেজ থেকে স্থায়ীভাবে সরানো হবে।`
            : `Remove "${draft.titleEn || draft.titleBn}" permanently from the homepage banner carousel?`
        }
        tone="danger"
        confirmLabel={lang === 'bn' ? 'Remove Banner' : 'Remove Banner'}
        busy={removing}
        onCancel={() => setRemoveConfirmOpen(false)}
        onConfirm={handleRemoveBanner}
      />
    </div>
  );
}
