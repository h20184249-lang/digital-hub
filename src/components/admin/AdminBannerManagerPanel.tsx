import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Crop,
  Eye,
  EyeOff,
  Link2,
  Maximize2,
  Monitor,
  MousePointerClick,
  Palette,
  Plus,
  RefreshCw,
  Save,
  Smartphone,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  AppRoute,
  Banner,
  BannerSlot,
  HeroBanner,
  HeroBannerDevice,
  HeroBannerLinkType,
  HeroBannerThemeVariant,
  Language,
  SiteSettings,
} from '../../types/marketplace';
import {
  adminDeleteBanner,
  adminDeleteHeroBanner,
  adminSaveBanner,
  adminSaveHeroBanner,
  adminSaveSiteSettings,
  adminUploadMediaAsset,
  generateId,
  prepareBannerImageForUpload,
  subscribeBanners,
  subscribeHeroBanners,
} from '../../lib/firestoreService';
import {
  BANNER_THEME_LIST,
  BannerSlideVisual,
  resolveBannerTheme,
} from '../HomeBannerCarousel';
import { ConfirmDialog } from './ConfirmDialog';

interface AdminBannerManagerPanelProps {
  lang: Language;
  settings: SiteSettings;
  banners?: Banner[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

const AD_SLOT_OPTIONS: Array<{ value: BannerSlot; label: string }> = [
  { value: 'home_top', label: 'Homepage Top (Below Watch & Earn)' },
  { value: 'between_sections', label: 'Homepage Between Sections' },
  { value: 'home_middle', label: 'Homepage Middle' },
  { value: 'home_bottom', label: 'Homepage Bottom' },
  { value: 'service_page', label: 'Service Catalog Page' },
  { value: 'product_page', label: 'Product Detail Page' },
  { value: 'dashboard_promo', label: 'Customer Dashboard Promo' },
];

function getEmptyAdBannerDraft(nextOrder: number): Banner {
  return {
    id: generateId('banner'),
    titleEn: 'Special Promo Offer',
    titleBn: 'বিশেষ প্রমোশনাল অফার',
    subtitleEn: 'Limited-time partner promo',
    subtitleBn: 'সীমিত সময়ের পার্টনার প্রোমো',
    slot: 'home_top',
    targetUrl: 'https://digital-hub.h20184249.workers.dev/',
    imageUrl: '',
    mobileImageUrl: '',
    adCode: '',
    sortOrder: nextOrder,
    priority: 10,
    enabled: true,
    startDate: '',
    endDate: '',
  };
}

const INTERNAL_ROUTE_OPTIONS: Array<{ value: AppRoute; labelEn: string; labelBn: string }> = [
  { value: 'services', labelEn: 'All Digital Services', labelBn: 'সকল ডিজিটাল সার্ভিস' },
  { value: 'gaming-store', labelEn: 'Gaming Top-Up Store', labelBn: 'গেমিং টপ-আপ স্টোর' },
  { value: 'gift-cards', labelEn: 'Gift Cards & Vouchers', labelBn: 'গিফট কার্ড ও ভাউচার' },
  { value: 'add-money', labelEn: 'Add Money / Deposit', labelBn: 'অ্যাড মানি / ডিপোজিট' },
  { value: 'support', labelEn: 'Customer Support', labelBn: 'কাস্টমার সাপোর্ট' },
  { value: 'games-store', labelEn: 'Online & Android Games', labelBn: 'অনলাইন ও অ্যান্ড্রয়েড গেমস' },
  { value: 'mobile-apps', labelEn: 'Smart App Store', labelBn: 'স্মার্ট অ্যাপ স্টোর' },
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
  { value: 'wallet', labelEn: 'My Wallet & Coins', labelBn: 'আমার ওয়ালেট ও কয়েন' },
  { value: 'home', labelEn: 'Homepage', labelBn: 'হোমপেজ' },
];

function getEmptyDraft(nextOrder: number): HeroBanner {
  return {
    id: generateId('hero'),
    badgeEn: '',
    badgeBn: '',
    titleEn: 'New Promotional Banner',
    titleBn: 'নতুন প্রমোশনাল ব্যানার',
    subtitleEn: 'Order digital services, gift cards & top-ups instantly.',
    subtitleBn: 'ডিজিটাল সার্ভিস, গিফট কার্ড ও টপ-আপ সহজেই অর্ডার করুন।',
    buttonTextEn: 'Explore Now',
    buttonTextBn: 'সার্ভিস দেখুন',
    linkType: 'internal_route',
    ctaRoute: 'services',
    targetUrl: '',
    openInNewTab: false,
    clickable: true,
    showIcon: false,
    themeVariant: 'navy_services',
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
    showIcon: false,
    themeVariant: resolveBannerTheme(b.themeVariant).id,
    imageFit: b.imageFit === 'contain' ? 'contain' : 'cover',
    deviceVisibility: b.deviceVisibility || 'both',
    enabled: b.enabled !== false,
    imageUrl: (b.imageUrl || '').trim(),
    mobileImageUrl: (b.mobileImageUrl || '').trim(),
  };
}

export function AdminBannerManagerPanel({
  lang,
  settings,
  banners: initialSlotBanners,
  onSuccess,
  onError,
}: AdminBannerManagerPanelProps) {
  const [bannerMode, setBannerMode] = useState<'hero' | 'ad_small'>('hero');
  const [heroBanners, setHeroBanners] = useState<HeroBanner[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNewSlide, setIsNewSlide] = useState(false);
  const [draft, setDraft] = useState<HeroBanner>(() => getEmptyDraft(1));
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [saving, setSaving] = useState(false);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState('');
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<HeroBanner | null>(null);
  const [removing, setRemoving] = useState(false);

  // Small Promo Ad Banners (320x50 slot banners)
  const [slotBanners, setSlotBanners] = useState<Banner[]>(() => initialSlotBanners || []);
  const [adSelectedId, setAdSelectedId] = useState<string | null>(null);
  const [adIsNew, setAdIsNew] = useState(false);
  const [adDraft, setAdDraft] = useState<Banner>(() => getEmptyAdBannerDraft(1));
  const [adSaving, setAdSaving] = useState(false);
  const [adUploading, setAdUploading] = useState(false);
  const [adUploadProgress, setAdUploadProgress] = useState(0);
  const [adUploadStage, setAdUploadStage] = useState('');
  const [adDeleteTarget, setAdDeleteTarget] = useState<Banner | null>(null);
  const [adRemoving, setAdRemoving] = useState(false);

  const [autoPlaySeconds, setAutoPlaySeconds] = useState<number>(() =>
    Math.max(2, Math.min(20, Math.round((settings.heroAutoPlayMs || 5500) / 1000)))
  );

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const adFileInputRef = useRef<HTMLInputElement | null>(null);
  const initializedRef = useRef(false);
  const adInitializedRef = useRef(false);

  useEffect(() => {
    setAutoPlaySeconds(Math.max(2, Math.min(20, Math.round((settings.heroAutoPlayMs || 5500) / 1000))));
  }, [settings.heroAutoPlayMs]);

  useEffect(() => {
    const unsub = subscribeHeroBanners((items) => {
      setHeroBanners(items);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = subscribeBanners((items) => {
      setSlotBanners(items);
    });
    return () => unsub();
  }, []);

  const orderedBanners = useMemo(
    () => [...heroBanners].sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)),
    [heroBanners]
  );

  const orderedSlotBanners = useMemo(
    () => [...slotBanners].sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)),
    [slotBanners]
  );

  useEffect(() => {
    if (!initializedRef.current) {
      if (orderedBanners.length > 0) {
        initializedRef.current = true;
        const activeFirst = orderedBanners.find((b) => b.enabled) || orderedBanners[0];
        setSelectedId(activeFirst.id);
        setIsNewSlide(false);
        setDraft(normalizeBannerForDraft(activeFirst));
      } else {
        setIsNewSlide(true);
      }
    }
  }, [orderedBanners]);

  useEffect(() => {
    if (!adInitializedRef.current) {
      if (orderedSlotBanners.length > 0) {
        adInitializedRef.current = true;
        const first = orderedSlotBanners[0];
        setAdSelectedId(first.id);
        setAdIsNew(false);
        setAdDraft({ ...first });
      } else {
        setAdIsNew(true);
      }
    }
  }, [orderedSlotBanners]);

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

  const selectAdBanner = (b: Banner) => {
    setAdIsNew(false);
    setAdSelectedId(b.id);
    setAdDraft({ ...b });
  };

  const startNewAdBanner = () => {
    const maxOrder = orderedSlotBanners.reduce((m, b) => Math.max(m, Number(b.sortOrder) || 0), 0);
    const fresh = getEmptyAdBannerDraft(maxOrder + 1);
    setAdIsNew(true);
    setAdSelectedId(fresh.id);
    setAdDraft(fresh);
  };

  const handleBannerFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setUploadProgress(5);
    setUploadStage(lang === 'bn' ? 'ছবি প্রস্তুত হচ্ছে...' : 'Preparing image...');
    try {
      const prepared = await prepareBannerImageForUpload(file, {
        preset: 'hero',
        onProgress: (pct, stage) => {
          setUploadProgress(pct);
          if (stage) setUploadStage(stage);
        },
      });
      const uploaded = await adminUploadMediaAsset(prepared.dataUrl, (pct) => {
        setUploadProgress(pct);
      });
      setDraft((prev) => ({
        ...prev,
        imageUrl: uploaded.url,
        mobileImageUrl: '',
      }));
      onSuccess(
        lang === 'bn'
          ? `ব্যানার (${prepared.width}×${prepared.height}px) আপলোড হয়েছে। প্রিভিউ দেখে "Save Banner" চাপুন।`
          : `Banner (${prepared.width}×${prepared.height}px) uploaded. Review preview and click "Save Banner".`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to upload banner image.');
    } finally {
      setUploading(false);
      setTimeout(() => {
        setUploadProgress(0);
        setUploadStage('');
      }, 900);
    }
  };

  const handleAdBannerFilePicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAdUploading(true);
    setAdUploadProgress(5);
    setAdUploadStage(lang === 'bn' ? '৩২০×৫০ সাইজে অপ্টিমাইজ হচ্ছে...' : 'Optimizing for 320×50 banner...');
    try {
      const prepared = await prepareBannerImageForUpload(file, {
        preset: 'ad_small',
        onProgress: (pct, stage) => {
          setAdUploadProgress(pct);
          if (stage) setAdUploadStage(stage);
        },
      });
      const uploaded = await adminUploadMediaAsset(prepared.dataUrl, (pct) => {
        setAdUploadProgress(pct);
      });
      setAdDraft((prev) => ({
        ...prev,
        imageUrl: uploaded.url,
        mobileImageUrl: uploaded.url,
      }));
      onSuccess(
        lang === 'bn'
          ? '৩২০×৫০ অ্যাড ব্যানার ইমেজ আপলোড হয়েছে! এখন Save Ad Banner চাপুন।'
          : '320×50 Ad Banner uploaded & optimized! Click Save Ad Banner to publish.'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to upload ad banner image.');
    } finally {
      setAdUploading(false);
      setTimeout(() => {
        setAdUploadProgress(0);
        setAdUploadStage('');
      }, 900);
    }
  };

  const handleSaveAdBanner = async (e: FormEvent) => {
    e.preventDefault();
    if (!adDraft.titleEn.trim() && !adDraft.titleBn.trim()) {
      onError(lang === 'bn' ? 'অ্যাড ব্যানারের শিরোনাম লিখুন।' : 'Please enter an ad banner title.');
      return;
    }
    const cleanTarget = (adDraft.targetUrl || '').trim();
    if (!/^https?:\/\//i.test(cleanTarget)) {
      onError(lang === 'bn' ? 'সঠিক গন্তব্য URL দিন (https://)।' : 'Target URL must start with https:// or http://');
      return;
    }
    setAdSaving(true);
    try {
      const id = adDraft.id || generateId('banner');
      const payload: Banner = {
        ...adDraft,
        id,
        titleEn: (adDraft.titleEn || adDraft.titleBn).trim(),
        titleBn: (adDraft.titleBn || adDraft.titleEn).trim(),
        subtitleEn: (adDraft.subtitleEn || '').trim(),
        subtitleBn: (adDraft.subtitleBn || '').trim(),
        targetUrl: cleanTarget,
        imageUrl: (adDraft.imageUrl || '').trim() || undefined,
        mobileImageUrl: (adDraft.mobileImageUrl || adDraft.imageUrl || '').trim() || undefined,
        sortOrder: Math.max(1, Math.round(Number(adDraft.sortOrder) || 1)),
        priority: Math.max(1, Math.round(Number(adDraft.priority) || 10)),
        enabled: adDraft.enabled !== false,
      };
      await adminSaveBanner(payload, adIsNew);
      setAdIsNew(false);
      setAdSelectedId(id);
      setAdDraft(payload);
      onSuccess(lang === 'bn' ? '৩২০×৫০ অ্যাড ব্যানার সংরক্ষিত হয়েছে।' : 'Small Ad Banner saved live!');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save ad banner.');
    } finally {
      setAdSaving(false);
    }
  };

  const handleRemoveAdBanner = async () => {
    if (!adDeleteTarget) return;
    setAdRemoving(true);
    try {
      await adminDeleteBanner(adDeleteTarget.id);
      const remaining = orderedSlotBanners.filter((b) => b.id !== adDeleteTarget.id);
      if (adSelectedId === adDeleteTarget.id) {
        if (remaining.length > 0) selectAdBanner(remaining[0]);
        else startNewAdBanner();
      }
      setAdDeleteTarget(null);
      onSuccess(lang === 'bn' ? 'অ্যাড ব্যানারটি মুছে ফেলা হয়েছে।' : 'Ad banner deleted.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete ad banner.');
    } finally {
      setAdRemoving(false);
    }
  };

  const handleSaveBanner = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.titleBn.trim() && !draft.titleEn.trim()) {
      onError(
        lang === 'bn'
          ? 'অনুগ্রহ করে ব্যানারের শিরোনাম লিখুন।'
          : 'Please enter a banner title.'
      );
      return;
    }
    if (draft.clickable !== false && draft.linkType === 'external_url') {
      const cleanUrl = (draft.targetUrl || '').trim();
      if (!/^https?:\/\//i.test(cleanUrl)) {
        onError(
          lang === 'bn'
            ? 'সঠিক URL দিন (https:// দিয়ে শুরু করুন)।'
            : 'External URL must start with https:// or http://'
        );
        return;
      }
    }
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
      onError(
        lang === 'bn'
          ? 'মেয়াদ শেষের তারিখ শুরুর তারিখের আগে হতে পারবে না।'
          : 'Expiration date cannot be earlier than start date.'
      );
      return;
    }

    setSaving(true);
    try {
      const targetId = draft.id || generateId('hero');
      const payload: HeroBanner = {
        ...draft,
        id: targetId,
        badgeEn: '',
        badgeBn: '',
        titleEn: (draft.titleEn || draft.titleBn || 'Digital Hub BD').trim(),
        titleBn: (draft.titleBn || draft.titleEn || 'ডিজিটাল হাব বিডি').trim(),
        subtitleEn: (draft.subtitleEn || draft.subtitleBn || '').trim(),
        subtitleBn: (draft.subtitleBn || draft.subtitleEn || '').trim(),
        buttonTextEn: (draft.buttonTextEn || draft.buttonTextBn || 'Explore Now').trim(),
        buttonTextBn: (draft.buttonTextBn || draft.buttonTextEn || 'সার্ভিস দেখুন').trim(),
        clickable: draft.clickable !== false,
        showIcon: false,
        themeVariant: resolveBannerTheme(draft.themeVariant).id,
        imageFit: draft.imageFit === 'contain' ? 'contain' : 'cover',
        linkType: draft.linkType || 'internal_route',
        ctaRoute: draft.linkType === 'internal_route' ? (draft.ctaRoute || 'services') : undefined,
        targetUrl: draft.linkType === 'external_url' ? (draft.targetUrl || '').trim() : undefined,
        openInNewTab: draft.linkType === 'external_url' ? Boolean(draft.openInNewTab) : false,
        imageUrl: (draft.imageUrl || '').trim(),
        mobileImageUrl: (draft.mobileImageUrl || '').trim() || undefined,
        deviceVisibility: draft.deviceVisibility || 'both',
        sortOrder: Math.max(1, Math.round(Number(draft.sortOrder) || 1)),
        enabled: draft.enabled !== false,
        startDate: (draft.startDate || '').trim() || undefined,
        endDate: (draft.endDate || '').trim() || undefined,
      };

      await adminSaveHeroBanner(payload, isNewSlide);

      const clampedMs = Math.max(2, Math.min(20, Math.round(Number(autoPlaySeconds) || 5))) * 1000;
      if (clampedMs !== (settings.heroAutoPlayMs || 5500)) {
        await adminSaveSiteSettings({ ...settings, heroAutoPlayMs: clampedMs });
      }

      setIsNewSlide(false);
      setSelectedId(targetId);
      setDraft(payload);
      onSuccess(
        lang === 'bn'
          ? 'ব্যানারটি সংরক্ষণ করা হয়েছে এবং হোমপেজে আপডেট হয়েছে।'
          : 'Banner saved and updated live on Digital Hub BD!'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save banner.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleBannerVisibility = async (banner: HeroBanner) => {
    setTogglingId(banner.id);
    try {
      const nextEnabled = !banner.enabled;
      const updated: HeroBanner = { ...normalizeBannerForDraft(banner), enabled: nextEnabled };
      await adminSaveHeroBanner(updated, false);
      if (selectedId === banner.id && !isNewSlide) {
        setDraft((prev) => ({ ...prev, enabled: nextEnabled }));
      }
      onSuccess(
        nextEnabled
          ? lang === 'bn'
            ? 'ব্যানারটি হোমপেজে চালু করা হয়েছে।'
            : 'Banner enabled on homepage.'
          : lang === 'bn'
            ? 'ব্যানারটি লুকানো হয়েছে।'
            : 'Banner hidden from homepage.'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update banner visibility.');
    } finally {
      setTogglingId(null);
    }
  };

  const handleMoveBanner = async (index: number, direction: 'up' | 'down') => {
    const swapIdx = direction === 'up' ? index - 1 : index + 1;
    if (swapIdx < 0 || swapIdx >= orderedBanners.length) return;
    const reordered = [...orderedBanners];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(swapIdx, 0, moved);

    setReorderingId(moved.id);
    try {
      const updates = reordered
        .map((item, idx) => ({ item, targetOrder: idx + 1 }))
        .filter(({ item, targetOrder }) => Number(item.sortOrder) !== targetOrder || item.id === moved.id);

      await Promise.all(
        updates.map(({ item, targetOrder }) =>
          adminSaveHeroBanner({ ...normalizeBannerForDraft(item), sortOrder: targetOrder }, false)
        )
      );
      if (selectedId === moved.id && !isNewSlide) {
        setDraft((prev) => ({ ...prev, sortOrder: swapIdx + 1 }));
      }
      onSuccess(
        lang === 'bn' ? 'ব্যানারের ক্রম আপডেট হয়েছে।' : 'Banner order updated.'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to reorder banner.');
    } finally {
      setReorderingId(null);
    }
  };

  const handleRemoveBanner = async () => {
    if (!deleteTarget) return;
    setRemoving(true);
    try {
      if (!isNewSlide || deleteTarget.id !== draft.id) {
        await adminDeleteHeroBanner(deleteTarget.id);
      }
      const remaining = orderedBanners.filter((b) => b.id !== deleteTarget.id);
      if (selectedId === deleteTarget.id) {
        if (remaining.length > 0) {
          selectBanner(remaining[0]);
        } else {
          startNewBanner();
        }
      }
      setDeleteTarget(null);
      onSuccess(
        lang === 'bn' ? 'ব্যানারটি মুছে ফেলা হয়েছে।' : 'Banner deleted successfully.'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete banner.');
    } finally {
      setRemoving(false);
    }
  };

  const isFitContain = draft.imageFit === 'contain';
  const isClickable = draft.clickable !== false;
  const activeCount = orderedBanners.filter((b) => b.enabled).length;

  return (
    <div className="max-w-5xl mx-auto space-y-5 text-xs">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={uploading}
        onChange={(e) => void handleBannerFilePicked(e)}
      />
      <input
        ref={adFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        disabled={adUploading}
        onChange={(e) => void handleAdBannerFilePicked(e)}
      />

      {/* Mode Switcher: Hero Slider (1536x1024) vs Small Promo Ad Banners (320x50) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setBannerMode('hero')}
          className={`flex-1 min-w-[200px] px-4 py-2.5 rounded-xl font-extrabold text-xs transition-all cursor-pointer ${
            bannerMode === 'hero'
              ? 'dh-orange-gradient text-white shadow-sm'
              : 'bg-[#F3F6FF] dark:bg-slate-800 text-[#172033] dark:text-slate-200 hover:border-[#FF8500]'
          }`}
        >
          {lang === 'bn'
            ? `মেইন প্রমোশনাল হিরো ব্যানার (১৫৩৬×১০২৪) · ${orderedBanners.length}টি`
            : `Main Promotional Hero Banners (1536×1024) · ${orderedBanners.length}`}
        </button>
        <button
          type="button"
          onClick={() => setBannerMode('ad_small')}
          className={`flex-1 min-w-[200px] px-4 py-2.5 rounded-xl font-extrabold text-xs transition-all cursor-pointer ${
            bannerMode === 'ad_small'
              ? 'dh-orange-gradient text-white shadow-sm'
              : 'bg-[#F3F6FF] dark:bg-slate-800 text-[#172033] dark:text-slate-200 hover:border-[#FF8500]'
          }`}
        >
          {lang === 'bn'
            ? `ছোট প্রোমো অ্যাড ব্যানার (৩২০×৫০) · ${orderedSlotBanners.length}টি`
            : `Small Promo Ad Banners (320×50) · ${orderedSlotBanners.length}`}
        </button>
      </div>

      {bannerMode === 'hero' && (
      <>

      {/* 1. BANNER LIST & QUICK CONTROLS (Add, Reorder, Hide/Show, Edit, Delete) */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 sm:p-5 space-y-3 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm sm:text-base font-extrabold text-[#172033] dark:text-slate-100">
              {lang === 'bn' ? 'হোমপেজ ব্যানার ম্যানেজমেন্ট' : 'Homepage Banner Management'}
            </h2>
            <p className="text-[11px] text-[#777777] dark:text-slate-400">
              {lang === 'bn'
                ? `মোট ${orderedBanners.length}টি ব্যানার (${activeCount}টি চালু) • সব ব্যানার বন্ধ থাকলে ডিফল্ট ব্যানার দেখাবে`
                : `${orderedBanners.length} Banner(s) (${activeCount} active) • Clean default banner displays if all are hidden`}
            </p>
          </div>
          <button
            type="button"
            onClick={startNewBanner}
            className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-extrabold inline-flex items-center gap-1.5 shadow-sm hover:opacity-95 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'bn' ? 'নতুন ব্যানার যোগ করুন' : 'Add New Banner'}</span>
          </button>
        </div>

        {orderedBanners.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {orderedBanners.map((b, idx) => {
              const selected = !isNewSlide && selectedId === b.id;
              const tStyle = resolveBannerTheme(b.themeVariant);
              const titleText =
                (lang === 'bn' ? b.titleBn || b.titleEn : b.titleEn || b.titleBn) ||
                (lang === 'bn' ? `ব্যানার ${idx + 1}` : `Banner ${idx + 1}`);
              return (
                <div
                  key={b.id}
                  onClick={() => selectBanner(b)}
                  className={`rounded-2xl border p-3 flex items-center justify-between gap-2.5 transition-all cursor-pointer ${
                    selected
                      ? 'border-[#FF8500] bg-[#FFF8F0] dark:bg-orange-950/20 ring-1 ring-[#FF8500]/40'
                      : 'border-[#E6ECFA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-800/40 hover:border-[#FF8500]/50'
                  } ${!b.enabled ? 'opacity-65' : ''}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-7 h-7 rounded-xl border border-black/10 shrink-0 flex items-center justify-center font-extrabold text-[11px]"
                      style={{
                        backgroundColor: tStyle.swatchBg,
                        color: tStyle.id === 'white_wallet' ? '#172033' : '#FFFFFF',
                      }}
                    >
                      {idx + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="font-extrabold text-[#172033] dark:text-slate-100 truncate">
                        {titleText}
                      </p>
                      <p className="text-[10px] text-[#777777] dark:text-slate-400 truncate">
                        {b.enabled
                          ? lang === 'bn'
                            ? 'হোমপেজে চালু'
                            : 'Visible'
                          : lang === 'bn'
                            ? 'লুকানো (Hidden)'
                            : 'Hidden'}
                        {' · '}
                        {lang === 'bn' ? b.buttonTextBn || b.buttonTextEn : b.buttonTextEn || b.buttonTextBn}
                      </p>
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={idx === 0 || reorderingId !== null}
                      onClick={() => void handleMoveBanner(idx, 'up')}
                      title={lang === 'bn' ? 'উপরে নিন' : 'Move up'}
                      className="w-7 h-7 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-center text-[#172033] dark:text-slate-200 disabled:opacity-35 hover:border-[#FF8500] cursor-pointer"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === orderedBanners.length - 1 || reorderingId !== null}
                      onClick={() => void handleMoveBanner(idx, 'down')}
                      title={lang === 'bn' ? 'নিচে নিন' : 'Move down'}
                      className="w-7 h-7 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-center text-[#172033] dark:text-slate-200 disabled:opacity-35 hover:border-[#FF8500] cursor-pointer"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={togglingId === b.id}
                      onClick={() => void handleToggleBannerVisibility(b)}
                      title={
                        b.enabled
                          ? lang === 'bn'
                            ? 'ব্যানার লুকান'
                            : 'Hide banner'
                          : lang === 'bn'
                            ? 'ব্যানার দেখান'
                            : 'Show banner'
                      }
                      className={`w-7 h-7 rounded-lg border flex items-center justify-center cursor-pointer ${
                        b.enabled
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-600'
                          : 'bg-white dark:bg-slate-900 border-[#E6ECFA] dark:border-slate-700 text-[#777777]'
                      }`}
                    >
                      {b.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(b)}
                      title={lang === 'bn' ? 'মুছে ফেলুন' : 'Delete banner'}
                      className="w-7 h-7 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/50 flex items-center justify-center text-[#DC2626] hover:bg-red-100 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. LIVE PREVIEW CANVAS (Exact Match to Homepage Carousel) */}
      <div className="rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 sm:p-6 space-y-4 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-[#FFF3E5] dark:bg-orange-950/40 text-[#FF8500] flex items-center justify-center">
              <Eye className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
                {isNewSlide
                  ? lang === 'bn'
                    ? 'নতুন ব্যানার প্রিভিউ'
                    : 'New Banner Preview'
                  : lang === 'bn'
                    ? 'লাইভ ব্যানার প্রিভিউ'
                    : 'Live Banner Preview'}
              </h3>
              <p className="text-[11px] text-[#777777] dark:text-slate-400">
                {lang === 'bn'
                  ? 'হোমপেজে ঠিক যেভাবে দেখাবে — ডেস্কটপ ও মোবাইলে যাচাই করুন'
                  : 'Exact live look on Digital Hub BD homepage across Desktop & Mobile'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {draft.imageUrl && (
              <div className="inline-flex rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 p-1">
                <button
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, imageFit: 'cover' }))}
                  className={`px-2.5 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                    !isFitContain ? 'bg-[#FF8500] text-white' : 'text-[#5C6B84] dark:text-slate-300'
                  }`}
                >
                  <Crop className="w-3.5 h-3.5" />
                  <span>{lang === 'bn' ? 'ক্রপ / ফিল' : 'Fill'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, imageFit: 'contain' }))}
                  className={`px-2.5 py-1.5 rounded-lg font-bold inline-flex items-center gap-1 cursor-pointer transition-colors ${
                    isFitContain ? 'bg-[#FF8500] text-white' : 'text-[#5C6B84] dark:text-slate-300'
                  }`}
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>{lang === 'bn' ? 'ফিট' : 'Fit'}</span>
                </button>
              </div>
            )}

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

        <div className={previewDevice === 'mobile' ? 'max-w-[360px] mx-auto' : 'w-full'}>
          <BannerSlideVisual
            banner={draft}
            lang={lang}
            isMobileViewport={previewDevice === 'mobile'}
            preview
          />
        </div>

        {/* Photo Upload / Replace / Remove & Quick Save */}
        <div className="space-y-3 pt-1">
          {(uploading || uploadProgress > 0) && (
            <div className="rounded-2xl bg-[#FFF8F0] dark:bg-orange-950/20 border border-[#FF8500]/30 p-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-[#172033] dark:text-slate-100">
                <span>{uploadStage || (lang === 'bn' ? 'আপলোড হচ্ছে...' : 'Uploading...')}</span>
                <span className="font-mono-num text-[#FF8500]">{uploadProgress}%</span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#E6ECFA] dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full rounded-full dh-orange-gradient transition-all duration-200"
                  style={{ width: `${Math.max(4, uploadProgress)}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-100 font-bold inline-flex items-center gap-2 hover:border-[#FF8500] disabled:opacity-50 cursor-pointer"
              >
                {draft.imageUrl ? (
                  <RefreshCw className="w-3.5 h-3.5 text-[#FF8500]" />
                ) : (
                  <Upload className="w-3.5 h-3.5 text-[#FF8500]" />
                )}
                <span>
                  {uploading
                    ? lang === 'bn'
                      ? `আপলোড হচ্ছে (${uploadProgress}%)...`
                      : `Uploading (${uploadProgress}%)...`
                    : draft.imageUrl
                      ? lang === 'bn'
                        ? 'ছবি পরিবর্তন করুন (সর্বোচ্চ ১০MB)'
                        : 'Change Photo (Max 10MB)'
                      : lang === 'bn'
                        ? 'কাস্টম ছবি আপলোড (১৫৩৬×১০২৪ · সর্বোচ্চ ১০MB)'
                        : 'Upload Photo (1536×1024 · Max 10MB)'}
                </span>
              </button>

              {draft.imageUrl && (
                <button
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, imageUrl: '', mobileImageUrl: '' }))}
                  className="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 text-[#DC2626] font-bold inline-flex items-center gap-1.5 hover:bg-red-50 dark:hover:bg-red-950/30 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{lang === 'bn' ? 'ছবি সরান' : 'Remove Photo'}</span>
                </button>
              )}
            </div>

            <button
              type="button"
              disabled={saving || uploading}
              onClick={(e) => void handleSaveBanner(e as unknown as FormEvent)}
              className="px-5 py-2 rounded-xl dh-orange-gradient text-white font-extrabold inline-flex items-center gap-2 hover:opacity-95 disabled:opacity-50 cursor-pointer shadow-sm"
            >
              <Save className="w-4 h-4" />
              <span>
                {saving
                  ? lang === 'bn'
                    ? 'সংরক্ষণ হচ্ছে...'
                    : 'Saving...'
                  : 'Save Banner'}
              </span>
            </button>
          </div>
          <p className="text-[11px] text-[#777777] dark:text-slate-400">
            {lang === 'bn'
              ? 'সর্বোচ্চ ১০MB PNG/JPG/WebP সাপোর্টেড। স্বয়ংক্রিয়ভাবে রেশিও ঠিক রেখে WebP-তে অপ্টিমাইজ হয়।'
              : 'Supports PNG, JPG, WebP up to 10MB. Automatically optimized to WebP without distorting aspect ratio.'}
          </p>
        </div>
      </div>

      {/* 3. BANNER DESIGN, TEXT & BUTTON DESTINATION FORM */}
      <form
        onSubmit={handleSaveBanner}
        className="rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 sm:p-6 space-y-5"
      >
        {/* Brand Color Design Swatches (Orange, White & Dark Navy) */}
        <div className="space-y-2.5">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
            <Palette className="w-4 h-4 text-[#FF8500]" />
            <span>{lang === 'bn' ? 'ব্যানার ডিজাইন থিম (Orange · White · Dark Navy)' : 'Banner Design Style'}</span>
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            {BANNER_THEME_LIST.map((themeOpt) => {
              const active = (draft.themeVariant || 'navy_services') === themeOpt.id;
              return (
                <button
                  key={themeOpt.id}
                  type="button"
                  onClick={() =>
                    setDraft((prev) => ({
                      ...prev,
                      themeVariant: themeOpt.id as HeroBannerThemeVariant,
                    }))
                  }
                  className={`p-3 rounded-2xl border text-left flex items-center gap-2.5 transition-all cursor-pointer ${
                    active
                      ? 'border-[#FF8500] bg-[#FFF8F0] dark:bg-orange-950/20 ring-1 ring-[#FF8500]/40'
                      : 'border-[#E6ECFA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-800/40 hover:border-[#FF8500]/50'
                  }`}
                >
                  <span
                    className="w-7 h-7 rounded-xl border border-black/15 shrink-0 flex items-center justify-center"
                    style={{ backgroundColor: themeOpt.swatchBg }}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: themeOpt.swatchAccent }}
                    />
                  </span>
                  <span className="font-bold text-[11px] text-[#172033] dark:text-slate-100 leading-tight">
                    {lang === 'bn' ? themeOpt.labelBn : themeOpt.labelEn}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Title, Subtitle & Button Label */}
        <div className="pt-4 border-t border-[#E6ECFA] dark:border-slate-800 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label className="block font-bold mb-1">
              {lang === 'bn' ? 'ব্যানার শিরোনাম (বাংলা)' : 'Banner Title (Bangla)'}
            </label>
            <input
              type="text"
              value={draft.titleBn}
              onChange={(e) => setDraft((prev) => ({ ...prev, titleBn: e.target.value }))}
              placeholder="সব ডিজিটাল সার্ভিস এখন এক জায়গায়"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">
              {lang === 'bn' ? 'ব্যানার শিরোনাম (English)' : 'Banner Title (English)'}
            </label>
            <input
              type="text"
              value={draft.titleEn}
              onChange={(e) => setDraft((prev) => ({ ...prev, titleEn: e.target.value }))}
              placeholder="All Digital Services Now in One Place"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">
              {lang === 'bn' ? 'সাবটাইটেল (বাংলা)' : 'Subtitle (Bangla)'}
            </label>
            <input
              type="text"
              value={draft.subtitleBn}
              onChange={(e) => setDraft((prev) => ({ ...prev, subtitleBn: e.target.value }))}
              placeholder="গেম টপ-আপ, অ্যাপস, গিফট কার্ড ও ডিজিটাল সার্ভিস সহজেই অর্ডার করুন।"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
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
              placeholder="Order game top-ups, apps, gift cards & digital services with ease."
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">
              {lang === 'bn' ? 'বাটন টেক্সট (বাংলা)' : 'Button Label (Bangla)'}
            </label>
            <input
              type="text"
              value={draft.buttonTextBn}
              onChange={(e) => setDraft((prev) => ({ ...prev, buttonTextBn: e.target.value }))}
              placeholder="সার্ভিস দেখুন"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <div>
            <label className="block font-bold mb-1">
              {lang === 'bn' ? 'বাটন টেক্সট (English)' : 'Button Label (English)'}
            </label>
            <input
              type="text"
              value={draft.buttonTextEn}
              onChange={(e) => setDraft((prev) => ({ ...prev, buttonTextEn: e.target.value }))}
              placeholder="View Services"
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
        </div>

        {/* Button Link / Action */}
        <div className="pt-4 border-t border-[#E6ECFA] dark:border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
              <Link2 className="w-4 h-4 text-[#FF8500]" />
              <span>{lang === 'bn' ? 'বাটন লিংক ও ক্লিক অ্যাকশন' : 'Button Link & Click Action'}</span>
            </h3>
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
                    ? 'ক্লিক চালু (ON)'
                    : 'Clickable (ON)'
                  : lang === 'bn'
                    ? 'ক্লিক বন্ধ (OFF)'
                    : 'Disabled (OFF)'}
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
                        ? 'ওয়েবসাইটের পেজ / সার্ভিস'
                        : 'Website Page / Service'
                      : lang === 'bn'
                        ? 'কাস্টম লিংক (URL)'
                        : 'External URL'}
                  </button>
                ))}
              </div>

              {draft.linkType === 'internal_route' ? (
                <select
                  value={draft.ctaRoute || 'services'}
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

        {/* Collapsible Schedule, Visibility & Slider Timing */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowMoreOptions((v) => !v)}
            className="text-[11px] font-bold text-[#5C6B84] dark:text-slate-400 hover:text-[#FF8500] inline-flex items-center gap-1 cursor-pointer"
          >
            {showMoreOptions ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            <span>
              {lang === 'bn'
                ? 'অতিরিক্ত সেটিংস (অর্ডার, ডিভাইস, সময়সীমা ও স্লাইডার স্পিড)'
                : 'More Options (Order, Visibility, Schedule & Auto-Slide Speed)'}
            </span>
          </button>

          {showMoreOptions && (
            <div className="mt-3 rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/50 border border-[#E6ECFA] dark:border-slate-700 p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <div>
                <label className="block font-bold mb-1">
                  {lang === 'bn' ? 'ডিভাইস' : 'Device Display'}
                </label>
                <select
                  value={draft.deviceVisibility}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, deviceVisibility: e.target.value as HeroBannerDevice }))
                  }
                  className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700"
                >
                  <option value="both">{lang === 'bn' ? 'সব ডিভাইস' : 'Desktop & Mobile'}</option>
                  <option value="desktop">{lang === 'bn' ? 'শুধু ডেস্কটপ' : 'Desktop Only'}</option>
                  <option value="mobile">{lang === 'bn' ? 'শুধু মোবাইল' : 'Mobile Only'}</option>
                </select>
              </div>
              <div>
                <label className="block font-bold mb-1">
                  {lang === 'bn' ? 'ক্রম (Order)' : 'Slide Order'}
                </label>
                <input
                  type="number"
                  min={1}
                  value={draft.sortOrder}
                  onChange={(e) => setDraft((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
                  className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">
                  {lang === 'bn' ? 'অটো-স্লাইড (সেকেন্ড)' : 'Auto-Slide (sec)'}
                </label>
                <input
                  type="number"
                  min={2}
                  max={20}
                  value={autoPlaySeconds}
                  onChange={(e) => setAutoPlaySeconds(Number(e.target.value))}
                  className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">
                  {lang === 'bn' ? 'শুরুর তারিখ' : 'Start Date'}
                </label>
                <input
                  type="date"
                  value={draft.startDate || ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, startDate: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">
                  {lang === 'bn' ? 'শেষ তারিখ' : 'Expiry Date'}
                </label>
                <input
                  type="date"
                  value={draft.endDate || ''}
                  onChange={(e) => setDraft((prev) => ({ ...prev, endDate: e.target.value }))}
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
                <span>{lang === 'bn' ? 'ব্যানার চালু' : 'Banner Visible'}</span>
              </label>
            </div>
          )}
        </div>

        {/* Sticky Save Footer */}
        <div className="pt-4 border-t border-[#E6ECFA] dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-[#777777] dark:text-slate-400">
            {lang === 'bn'
              ? 'Save Banner চাপলে পরিবর্তনটি ডাটাবেজে সেভ হয়ে হোমপেজে দেখাবে।'
              : 'Clicking Save Banner persists changes and updates the homepage immediately.'}
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
                  ? 'Save Banner'
                  : 'Save Banner'}
            </span>
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        lang={lang}
        title={lang === 'bn' ? 'ব্যানারটি মুছে ফেলবেন?' : 'Delete Banner?'}
        description={
          deleteTarget
            ? lang === 'bn'
              ? `"${deleteTarget.titleBn || deleteTarget.titleEn}" ব্যানারটি হোমপেজ থেকে স্থায়ীভাবে মুছে ফেলা হবে।`
              : `Delete "${deleteTarget.titleEn || deleteTarget.titleBn}" permanently from the homepage carousel?`
            : ''
        }
        tone="danger"
        confirmLabel="Delete Banner"
        busy={removing}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleRemoveBanner}
      />
      </>
      )}

      {bannerMode === 'ad_small' && (
        <div className="space-y-5">
          {/* Small Ad Banners List */}
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 sm:p-5 space-y-3 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm sm:text-base font-extrabold text-[#172033] dark:text-slate-100">
                  {lang === 'bn' ? 'ছোট প্রোমো অ্যাড ব্যানার (৩২০×৫০)' : 'Small Promo Ad Banners (320×50)'}
                </h2>
                <p className="text-[11px] text-[#777777] dark:text-slate-400">
                  {lang === 'bn'
                    ? 'হোমপেজ ও সার্ভিস পেজের নির্ধারিত স্লটে ৩২০×৫০ ব্যানার দেখান (সর্বোচ্চ ১০MB ছবি আপলোড সাপোর্টেড)'
                    : 'Manage compact 320×50 promotional ad banners across storefront slots (supports up to 10MB image upload)'}
                </p>
              </div>
              <button
                type="button"
                onClick={startNewAdBanner}
                className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-extrabold inline-flex items-center gap-1.5 shadow-sm hover:opacity-95 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>{lang === 'bn' ? 'নতুন অ্যাড ব্যানার' : 'New Ad Banner'}</span>
              </button>
            </div>

            {orderedSlotBanners.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {orderedSlotBanners.map((b) => {
                  const selected = !adIsNew && adSelectedId === b.id;
                  return (
                    <div
                      key={b.id}
                      onClick={() => selectAdBanner(b)}
                      className={`rounded-2xl border p-3 flex items-center justify-between gap-2.5 transition-all cursor-pointer ${
                        selected
                          ? 'border-[#FF8500] bg-[#FFF8F0] dark:bg-orange-950/20 ring-1 ring-[#FF8500]/40'
                          : 'border-[#E6ECFA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-800/40 hover:border-[#FF8500]/50'
                      } ${!b.enabled ? 'opacity-65' : ''}`}
                    >
                      <div className="min-w-0">
                        <p className="font-extrabold text-[#172033] dark:text-slate-100 truncate">
                          {lang === 'bn' ? b.titleBn || b.titleEn : b.titleEn || b.titleBn}
                        </p>
                        <p className="text-[10px] font-mono-num text-[#777777] dark:text-slate-400 truncate">
                          Slot: {b.slot} · {b.enabled ? 'Active' : 'Hidden'}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await adminSaveBanner({ ...b, enabled: !b.enabled }, false);
                              onSuccess(!b.enabled ? 'Ad banner enabled.' : 'Ad banner hidden.');
                            } catch (err) {
                              onError(err instanceof Error ? err.message : 'Toggle failed.');
                            }
                          }}
                          className={`w-7 h-7 rounded-lg border flex items-center justify-center cursor-pointer ${
                            b.enabled
                              ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 text-emerald-600'
                              : 'bg-white dark:bg-slate-900 border-[#E6ECFA] text-[#777777]'
                          }`}
                        >
                          {b.enabled ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAdDeleteTarget(b)}
                          className="w-7 h-7 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 text-[#DC2626] flex items-center justify-center cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 320x50 Live Preview & Upload */}
          <div className="rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
                  {lang === 'bn' ? '৩২০×৫০ লাইভ প্রিভিউ' : '320×50 Live Banner Preview'}
                </h3>
                <p className="text-[11px] text-[#777777] dark:text-slate-400">
                  {lang === 'bn'
                    ? 'আপলোড করা ছবি স্বয়ংক্রিয়ভাবে ৬৪০×১০০ (৩২০×৫০ রেটিনা) WebP-তে ক্রপ ও অপ্টিমাইজ হবে'
                    : 'Uploaded images auto-optimize cleanly to crisp 640×100 Retina WebP (320×50 ratio)'}
                </p>
              </div>
              <button
                type="button"
                disabled={adUploading}
                onClick={() => adFileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>
                  {adUploading
                    ? `${adUploadProgress}%...`
                    : lang === 'bn'
                      ? '৩২০×৫০ ছবি আপলোড (সর্বোচ্চ ১০MB)'
                      : 'Upload 320×50 Image (Max 10MB)'}
                </span>
              </button>
            </div>

            {(adUploading || adUploadProgress > 0) && (
              <div className="rounded-2xl bg-[#FFF8F0] dark:bg-orange-950/20 border border-[#FF8500]/30 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-bold">
                  <span>{adUploadStage || 'Processing...'}</span>
                  <span className="font-mono-num text-[#FF8500]">{adUploadProgress}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-[#E6ECFA] dark:bg-slate-800 overflow-hidden">
                  <div
                    className="h-full rounded-full dh-orange-gradient transition-all duration-200"
                    style={{ width: `${Math.max(4, adUploadProgress)}%` }}
                  />
                </div>
              </div>
            )}

            <div className="p-4 rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/60 border border-[#E6ECFA] dark:border-slate-700 flex flex-col items-center gap-2">
              <div className="w-[320px] h-[50px] max-w-full rounded-xl overflow-hidden border border-[#FF8500]/40 bg-[#172033] flex items-center justify-between shadow-sm">
                {adDraft.imageUrl ? (
                  <img
                    src={adDraft.imageUrl}
                    alt={adDraft.titleEn || '320x50 banner'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full px-3 flex items-center justify-between text-white">
                    <span className="text-[11px] font-bold truncate">{adDraft.titleEn || '320×50 Ad Banner'}</span>
                    <span className="px-2 py-0.5 rounded bg-[#FF8500] text-[10px] font-extrabold shrink-0">OPEN</span>
                  </div>
                )}
              </div>
              <span className="text-[10px] font-mono-num text-[#777777]">Exact 320×50 px Preview Frame</span>
            </div>
          </div>

          {/* 320x50 Form */}
          <form
            onSubmit={handleSaveAdBanner}
            className="rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-4"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block font-bold mb-1">Display Slot</label>
                <select
                  value={adDraft.slot}
                  onChange={(e) => setAdDraft((prev) => ({ ...prev, slot: e.target.value as BannerSlot }))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-semibold"
                >
                  {AD_SLOT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-bold mb-1">Target URL *</label>
                <input
                  type="url"
                  required
                  value={adDraft.targetUrl}
                  onChange={(e) => setAdDraft((prev) => ({ ...prev, targetUrl: e.target.value }))}
                  placeholder="https://..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Title (English) *</label>
                <input
                  type="text"
                  required
                  value={adDraft.titleEn}
                  onChange={(e) => setAdDraft((prev) => ({ ...prev, titleEn: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Title (Bangla)</label>
                <input
                  type="text"
                  value={adDraft.titleBn}
                  onChange={(e) => setAdDraft((prev) => ({ ...prev, titleBn: e.target.value }))}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                />
              </div>
              <div>
                <label className="block font-bold mb-1">Image URL (optional or upload above)</label>
                <input
                  type="text"
                  value={adDraft.imageUrl || ''}
                  onChange={(e) => setAdDraft((prev) => ({ ...prev, imageUrl: e.target.value }))}
                  placeholder="/api/media/..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                />
              </div>
              <div className="flex items-end gap-4 pb-1">
                <div className="flex-1">
                  <label className="block font-bold mb-1">Sort Order</label>
                  <input
                    type="number"
                    min={1}
                    value={adDraft.sortOrder}
                    onChange={(e) => setAdDraft((prev) => ({ ...prev, sortOrder: Number(e.target.value) }))}
                    className="w-full px-3.5 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                  />
                </div>
                <label className="inline-flex items-center gap-2 font-bold cursor-pointer pb-2">
                  <input
                    type="checkbox"
                    checked={adDraft.enabled}
                    onChange={(e) => setAdDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
                    className="accent-[#FF8500] w-4 h-4"
                  />
                  <span>Enabled</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-[#E6ECFA] dark:border-slate-800">
              <button
                type="submit"
                disabled={adSaving || adUploading}
                className="px-6 py-2.5 rounded-xl dh-orange-gradient text-white font-extrabold inline-flex items-center gap-2 shadow-sm hover:opacity-95 disabled:opacity-50 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>{adSaving ? 'Saving...' : 'Save Ad Banner'}</span>
              </button>
            </div>
          </form>

          <ConfirmDialog
            open={Boolean(adDeleteTarget)}
            lang={lang}
            title={lang === 'bn' ? 'অ্যাড ব্যানারটি মুছে ফেলবেন?' : 'Delete Ad Banner?'}
            description={
              adDeleteTarget
                ? `Delete "${adDeleteTarget.titleEn || adDeleteTarget.titleBn}" permanently?`
                : ''
            }
            tone="danger"
            confirmLabel="Delete Ad Banner"
            busy={adRemoving}
            onCancel={() => setAdDeleteTarget(null)}
            onConfirm={handleRemoveAdBanner}
          />
        </div>
      )}
    </div>
  );
}
