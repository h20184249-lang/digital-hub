import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Calendar,
  Edit3,
  ExternalLink,
  Eye,
  Image as ImageIcon,
  Layers,
  Monitor,
  Plus,
  Save,
  Smartphone,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  AppRoute,
  HeroBanner,
  HeroBannerDevice,
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
import { ConfirmDialog } from './ConfirmDialog';

interface AdminBannerManagerPanelProps {
  lang: Language;
  settings: SiteSettings;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

const INTERNAL_ROUTE_OPTIONS: Array<{ value: AppRoute; labelEn: string; labelBn: string }> = [
  { value: 'gaming-store', labelEn: 'Gaming Top-Up Store', labelBn: 'গেমিং টপ-আপ স্টোর' },
  { value: 'games-store', labelEn: 'Online & Android Games', labelBn: 'অনলাইন ও অ্যান্ড্রয়েড গেমস' },
  { value: 'mobile-apps', labelEn: 'Smart App Store', labelBn: 'স্মার্ট অ্যাপ স্টোর' },
  { value: 'services', labelEn: 'All Digital Services', labelBn: 'সকল ডিজিটাল সার্ভিস' },
  { value: 'gift-cards', labelEn: 'Gift Cards & Vouchers', labelBn: 'গিফট কার্ড ও ভাউচার' },
  { value: 'streaming-store', labelEn: 'Streaming Subscriptions', labelBn: 'স্ট্রিমিং সাবস্ক্রিপশন' },
  { value: 'telegram-store', labelEn: 'Telegram Services', labelBn: 'টেলিগ্রাম সার্ভিস' },
  { value: 'telegram-stars', labelEn: 'Telegram Stars', labelBn: 'টেলিগ্রাম স্টার্স' },
  { value: 'vip-groups', labelEn: 'VIP Channels & Groups', labelBn: 'ভিআইপি চ্যানেল ও গ্রুপ' },
  { value: 'ai-marketplace', labelEn: 'AI Tools & Plans', labelBn: 'এআই টুলস ও প্ল্যান' },
  { value: 'software-store', labelEn: 'Software & Licenses', labelBn: 'সফটওয়্যার ও লাইসেন্স' },
  { value: 'digital-products', labelEn: 'Digital Products', labelBn: 'ডিজিটাল প্রোডাক্টস' },
  { value: 'graphic-design', labelEn: 'Graphic Design Assets', labelBn: 'গ্রাফিক ডিজাইন অ্যাসেটস' },
  { value: 'social-media', labelEn: 'Social Media Boost', labelBn: 'সোশ্যাল মিডিয়া সার্ভিস' },
  { value: 'offers', labelEn: 'Special Offers & Deals', labelBn: 'স্পেশাল অফার ও ডিলস' },
  { value: 'watch-earn', labelEn: 'Watch & Earn Coins', labelBn: 'ওয়াচ অ্যান্ড আর্ন কয়েন' },
  { value: 'add-money', labelEn: 'Add Money / Deposit', labelBn: 'অ্যাড মানি / ডিপোজিট' },
  { value: 'wallet', labelEn: 'My Wallet & Coins', labelBn: 'আমার ওয়ালেট ও কয়েন' },
  { value: 'support', labelEn: 'Customer Support', labelBn: 'কাস্টমার সাপোর্ট' },
  { value: 'home', labelEn: 'Homepage', labelBn: 'হোমপেজ' },
];

function getTodayDhakaIso(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function getEmptyDraft(nextOrder: number): HeroBanner {
  return {
    id: generateId('hero'),
    badgeEn: 'SPECIAL PROMO',
    badgeBn: 'স্পেশাল প্রোমো',
    titleEn: '',
    titleBn: '',
    subtitleEn: '',
    subtitleBn: '',
    buttonTextEn: 'Explore Now',
    buttonTextBn: 'এখনই দেখুন',
    linkType: 'internal_route',
    ctaRoute: 'gaming-store',
    targetUrl: '',
    openInNewTab: false,
    imageUrl: '',
    mobileImageUrl: '',
    deviceVisibility: 'both',
    sortOrder: nextOrder,
    enabled: true,
    startDate: '',
    endDate: '',
  };
}

export function AdminBannerManagerPanel({
  lang,
  settings,
  onSuccess,
  onError,
}: AdminBannerManagerPanelProps) {
  const [heroBanners, setHeroBanners] = useState<HeroBanner[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<HeroBanner>(() => getEmptyDraft(1));
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [saving, setSaving] = useState(false);
  const [uploadingField, setUploadingField] = useState<'imageUrl' | 'mobileImageUrl' | null>(null);
  const [reorderingId, setReorderingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HeroBanner | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Global Carousel Autoplay Settings
  const [autoPlaySeconds, setAutoPlaySeconds] = useState<number>(() =>
    Math.max(2, Math.min(20, Math.round((settings.heroAutoPlayMs || 5500) / 1000)))
  );
  const [savingTimer, setSavingTimer] = useState(false);

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
      [...heroBanners].sort(
        (a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0)
      ),
    [heroBanners]
  );

  const todayDhaka = getTodayDhakaIso();

  const getBannerScheduleStatus = (b: HeroBanner) => {
    if (!b.enabled) {
      return { key: 'paused', label: 'Paused', cls: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400' };
    }
    if (b.startDate && b.startDate > todayDhaka) {
      return { key: 'scheduled', label: `Starts ${b.startDate}`, cls: 'bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300' };
    }
    if (b.endDate && b.endDate < todayDhaka) {
      return { key: 'expired', label: `Expired ${b.endDate}`, cls: 'bg-red-50 dark:bg-red-950/40 text-[#DC2626]' };
    }
    return { key: 'active', label: 'Active Live', cls: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400' };
  };

  const resetForm = () => {
    const maxOrder = orderedBanners.reduce((m, b) => Math.max(m, Number(b.sortOrder) || 0), 0);
    setEditingId(null);
    setDraft(getEmptyDraft(maxOrder + 1));
  };

  const handleUploadImage = async (e: ChangeEvent<HTMLInputElement>, field: 'imageUrl' | 'mobileImageUrl') => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingField(field);
    try {
      const optimized = await optimizePackageLogoFile(file, 1600);
      const uploaded = await adminUploadMediaAsset(optimized);
      setDraft((prev) => ({ ...prev, [field]: uploaded.url }));
      onSuccess(
        field === 'imageUrl'
          ? 'Desktop hero banner image uploaded.'
          : 'Mobile hero banner image uploaded.'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to upload banner image.');
    } finally {
      setUploadingField(null);
    }
  };

  const handleSaveTimer = async () => {
    const clampedSec = Math.max(2, Math.min(20, Math.round(Number(autoPlaySeconds) || 5)));
    setSavingTimer(true);
    try {
      await adminSaveSiteSettings({
        ...settings,
        heroAutoPlayMs: clampedSec * 1000,
      });
      onSuccess(`Hero carousel auto-slide duration updated to ${clampedSec}s.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save carousel duration.');
    } finally {
      setSavingTimer(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.titleEn.trim() && !draft.titleBn.trim()) {
      onError('Banner title is required.');
      return;
    }
    if (!draft.imageUrl.trim()) {
      onError('Please upload or enter a desktop banner image URL.');
      return;
    }
    if (draft.linkType === 'external_url') {
      const cleanUrl = (draft.targetUrl || '').trim();
      if (!/^https?:\/\//i.test(cleanUrl)) {
        onError('External URL must start with https:// or http://');
        return;
      }
    }
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate) {
      onError('Expiration date cannot be earlier than start date.');
      return;
    }

    setSaving(true);
    try {
      const payload: HeroBanner = {
        ...draft,
        id: editingId || draft.id || generateId('hero'),
        badgeEn: (draft.badgeEn || 'FEATURED').trim(),
        badgeBn: (draft.badgeBn || draft.badgeEn || 'ফিচার্ড').trim(),
        titleEn: (draft.titleEn || draft.titleBn).trim(),
        titleBn: (draft.titleBn || draft.titleEn).trim(),
        subtitleEn: (draft.subtitleEn || draft.subtitleBn || '').trim(),
        subtitleBn: (draft.subtitleBn || draft.subtitleEn || '').trim(),
        buttonTextEn: (draft.buttonTextEn || 'Explore Now').trim(),
        buttonTextBn: (draft.buttonTextBn || draft.buttonTextEn || 'এখনই দেখুন').trim(),
        linkType: draft.linkType,
        ctaRoute: draft.linkType === 'internal_route' ? (draft.ctaRoute || 'gaming-store') : undefined,
        targetUrl: draft.linkType === 'external_url' ? (draft.targetUrl || '').trim() : undefined,
        openInNewTab: draft.linkType === 'external_url' ? Boolean(draft.openInNewTab) : false,
        imageUrl: draft.imageUrl.trim(),
        mobileImageUrl: (draft.mobileImageUrl || '').trim() || undefined,
        deviceVisibility: draft.deviceVisibility || 'both',
        sortOrder: Math.max(0, Math.round(Number(draft.sortOrder) || 0)),
        enabled: Boolean(draft.enabled),
        startDate: (draft.startDate || '').trim() || undefined,
        endDate: (draft.endDate || '').trim() || undefined,
      };
      await adminSaveHeroBanner(payload, !editingId);
      onSuccess(editingId ? 'Hero banner updated live.' : 'New hero banner published to homepage.');
      resetForm();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save hero banner.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (banner: HeroBanner) => {
    try {
      await adminSaveHeroBanner({ ...banner, enabled: !banner.enabled }, false);
      onSuccess(`Banner "${banner.titleEn}" ${!banner.enabled ? 'enabled' : 'disabled'}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update banner status.');
    }
  };

  const handleMoveOrder = async (index: number, direction: -1 | 1) => {
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= orderedBanners.length) return;
    const current = orderedBanners[index];
    const neighbor = orderedBanners[targetIdx];
    setReorderingId(current.id);
    try {
      const currentOrder = Number(current.sortOrder) || index + 1;
      const neighborOrder = Number(neighbor.sortOrder) || targetIdx + 1;
      const nextCurrentOrder = currentOrder === neighborOrder ? targetIdx + 1 : neighborOrder;
      const nextNeighborOrder = currentOrder === neighborOrder ? index + 1 : currentOrder;
      await Promise.all([
        adminSaveHeroBanner({ ...current, sortOrder: nextCurrentOrder }, false),
        adminSaveHeroBanner({ ...neighbor, sortOrder: nextNeighborOrder }, false),
      ]);
      onSuccess('Banner order updated.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to reorder hero banners.');
    } finally {
      setReorderingId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminDeleteHeroBanner(deleteTarget.id);
      if (editingId === deleteTarget.id) resetForm();
      onSuccess('Hero banner deleted.');
      setDeleteTarget(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete hero banner.');
    } finally {
      setDeleting(false);
    }
  };

  const previewImg =
    previewDevice === 'mobile' && draft.mobileImageUrl?.trim()
      ? draft.mobileImageUrl.trim()
      : draft.imageUrl.trim();

  return (
    <div className="space-y-5 text-xs">
      {/* 1. Carousel Rotation Timer Settings */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#FF8500]" />
            <span>
              {lang === 'bn'
                ? 'হোমপেজ হিরো স্লাইডার সেটিংস'
                : 'Homepage Hero Carousel Auto-Rotation'}
            </span>
          </h3>
          <p className="text-[11px] text-[#777777] dark:text-slate-400">
            Control automatic slide transition interval across desktop and mobile devices (2s – 20s).
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <label className="font-bold text-[#172033] dark:text-slate-200">Slide Interval (sec):</label>
          <input
            type="number"
            min={2}
            max={20}
            value={autoPlaySeconds}
            onChange={(e) => setAutoPlaySeconds(Number(e.target.value))}
            className="w-20 px-3 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num font-bold text-center"
          />
          <button
            type="button"
            disabled={savingTimer}
            onClick={() => void handleSaveTimer()}
            className="px-3.5 py-2 rounded-xl bg-[#172033] dark:bg-[#FF8500] text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{savingTimer ? 'Saving...' : 'Save Timing'}</span>
          </button>
        </div>
      </div>

      {/* 2. Create / Edit Hero Banner + Live Preview */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        <form
          onSubmit={handleSubmit}
          className="xl:col-span-7 rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-4"
        >
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-[#FF8500]" />
              <span>
                {editingId
                  ? lang === 'bn'
                    ? 'হিরো ব্যানার এডিট করুন'
                    : 'Edit Homepage Hero Banner'
                  : lang === 'bn'
                    ? 'নতুন হিরো ব্যানার তৈরি করুন'
                    : 'Add New Homepage Hero Banner'}
              </span>
            </h3>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold inline-flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3 h-3" />
                Cancel Edit
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-bold mb-1">Badge (EN)</label>
              <input
                type="text"
                value={draft.badgeEn}
                onChange={(e) => setDraft({ ...draft, badgeEn: e.target.value })}
                placeholder="e.g., GAMING TOP-UP"
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">Badge (BN)</label>
              <input
                type="text"
                value={draft.badgeBn}
                onChange={(e) => setDraft({ ...draft, badgeBn: e.target.value })}
                placeholder="যেমন: গেমিং টপ-আপ"
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
            </div>

            <div>
              <label className="block font-bold mb-1">Banner Headline (EN) *</label>
              <input
                type="text"
                required
                value={draft.titleEn}
                onChange={(e) => setDraft({ ...draft, titleEn: e.target.value })}
                placeholder="e.g., Free Fire, PUBG & Valorant Top-Up"
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">Banner Headline (BN)</label>
              <input
                type="text"
                value={draft.titleBn}
                onChange={(e) => setDraft({ ...draft, titleBn: e.target.value })}
                placeholder="বাংলায় শিরোনাম"
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
            </div>

            <div>
              <label className="block font-bold mb-1">Subtitle (EN)</label>
              <textarea
                rows={2}
                value={draft.subtitleEn}
                onChange={(e) => setDraft({ ...draft, subtitleEn: e.target.value })}
                placeholder="Short promotional description..."
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">Subtitle (BN)</label>
              <textarea
                rows={2}
                value={draft.subtitleBn}
                onChange={(e) => setDraft({ ...draft, subtitleBn: e.target.value })}
                placeholder="বাংলায় সংক্ষিপ্ত বিবরণ..."
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
            </div>

            <div>
              <label className="block font-bold mb-1">CTA Button Text (EN)</label>
              <input
                type="text"
                value={draft.buttonTextEn}
                onChange={(e) => setDraft({ ...draft, buttonTextEn: e.target.value })}
                placeholder="Explore Top-Up"
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">CTA Button Text (BN)</label>
              <input
                type="text"
                value={draft.buttonTextBn}
                onChange={(e) => setDraft({ ...draft, buttonTextBn: e.target.value })}
                placeholder="টপ-আপ দেখুন"
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              />
            </div>
          </div>

          {/* Destination Selector */}
          <div className="rounded-xl bg-[#F8FAFF] dark:bg-slate-800/50 border border-[#E6ECFA] dark:border-slate-700 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-extrabold text-[#172033] dark:text-slate-100">Button Link Destination</span>
              <div className="inline-flex rounded-lg bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 p-0.5">
                {(['internal_route', 'external_url'] as HeroBannerLinkType[]).map((lt) => (
                  <button
                    key={lt}
                    type="button"
                    onClick={() => setDraft({ ...draft, linkType: lt })}
                    className={`px-3 py-1 rounded-md font-bold cursor-pointer transition-colors ${
                      draft.linkType === lt
                        ? 'bg-[#FF8500] text-white'
                        : 'text-[#777777] dark:text-slate-400'
                    }`}
                  >
                    {lt === 'internal_route' ? 'Internal Page' : 'External URL'}
                  </button>
                ))}
              </div>
            </div>

            {draft.linkType === 'internal_route' ? (
              <select
                value={draft.ctaRoute || 'gaming-store'}
                onChange={(e) => setDraft({ ...draft, ctaRoute: e.target.value as AppRoute })}
                className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700"
              >
                {INTERNAL_ROUTE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.labelEn} — /{opt.value}
                  </option>
                ))}
              </select>
            ) : (
              <div className="space-y-2">
                <input
                  type="url"
                  value={draft.targetUrl || ''}
                  onChange={(e) => setDraft({ ...draft, targetUrl: e.target.value })}
                  placeholder="https://example.com/promo"
                  className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                />
                <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.openInNewTab)}
                    onChange={(e) => setDraft({ ...draft, openInNewTab: e.target.checked })}
                    className="accent-[#FF8500]"
                  />
                  <span>Open external destination in new tab</span>
                </label>
              </div>
            )}
          </div>

          {/* Banner Images */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block font-bold">Desktop / Main Banner Image *</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={draft.imageUrl}
                  onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })}
                  placeholder="/assets/... or https://... or upload"
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                />
                <label className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold inline-flex items-center gap-1 cursor-pointer hover:border-[#FF8500] shrink-0">
                  <Upload className="w-3.5 h-3.5 text-[#FF8500]" />
                  <span>{uploadingField === 'imageUrl' ? '...' : 'Upload'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={uploadingField !== null}
                    onChange={(e) => void handleUploadImage(e, 'imageUrl')}
                  />
                </label>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block font-bold">Mobile Image Override (Optional)</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={draft.mobileImageUrl || ''}
                  onChange={(e) => setDraft({ ...draft, mobileImageUrl: e.target.value })}
                  placeholder="Optional mobile image URL"
                  className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                />
                <label className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold inline-flex items-center gap-1 cursor-pointer hover:border-[#FF8500] shrink-0">
                  <Upload className="w-3.5 h-3.5 text-[#FF8500]" />
                  <span>{uploadingField === 'mobileImageUrl' ? '...' : 'Upload'}</span>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    disabled={uploadingField !== null}
                    onChange={(e) => void handleUploadImage(e, 'mobileImageUrl')}
                  />
                </label>
              </div>
            </div>
          </div>

          {/* Scheduling, Device Visibility, Order, Active Toggle */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block font-bold mb-1">Device Visibility</label>
              <select
                value={draft.deviceVisibility}
                onChange={(e) => setDraft({ ...draft, deviceVisibility: e.target.value as HeroBannerDevice })}
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
              >
                <option value="both">Desktop & Mobile</option>
                <option value="desktop">Desktop Only</option>
                <option value="mobile">Mobile Only</option>
              </select>
            </div>
            <div>
              <label className="block font-bold mb-1">Sort Order</label>
              <input
                type="number"
                min={0}
                value={draft.sortOrder}
                onChange={(e) => setDraft({ ...draft, sortOrder: Number(e.target.value) })}
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">Start Date</label>
              <input
                type="date"
                value={draft.startDate || ''}
                onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
              />
            </div>
            <div>
              <label className="block font-bold mb-1">Expiry Date</label>
              <input
                type="date"
                value={draft.endDate || ''}
                onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                className="accent-[#FF8500] w-4 h-4"
              />
              <span>Publish Immediately (Active)</span>
            </label>
            <button
              type="submit"
              disabled={saving || uploadingField !== null}
              className="px-4 py-2.5 rounded-xl dh-orange-gradient text-white font-extrabold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>{saving ? 'Saving...' : editingId ? 'Update Hero Banner' : 'Publish Hero Banner'}</span>
            </button>
          </div>
        </form>

        {/* Live Banner Preview Card */}
        <div className="xl:col-span-5 rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
              <Eye className="w-4 h-4 text-[#FF8500]" />
              <span>Live Banner Preview</span>
            </h4>
            <div className="inline-flex rounded-lg bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 p-0.5">
              <button
                type="button"
                onClick={() => setPreviewDevice('desktop')}
                className={`px-2.5 py-1 rounded-md font-bold inline-flex items-center gap-1 cursor-pointer ${
                  previewDevice === 'desktop' ? 'bg-[#172033] text-white' : 'text-[#777777]'
                }`}
              >
                <Monitor className="w-3 h-3" /> Desktop
              </button>
              <button
                type="button"
                onClick={() => setPreviewDevice('mobile')}
                className={`px-2.5 py-1 rounded-md font-bold inline-flex items-center gap-1 cursor-pointer ${
                  previewDevice === 'mobile' ? 'bg-[#172033] text-white' : 'text-[#777777]'
                }`}
              >
                <Smartphone className="w-3 h-3" /> Mobile
              </button>
            </div>
          </div>

          <div
            className={`relative rounded-2xl overflow-hidden bg-[#172033] border border-[#E6ECFA] dark:border-slate-800 mx-auto transition-all ${
              previewDevice === 'mobile' ? 'max-w-[300px] min-h-[200px]' : 'w-full min-h-[220px]'
            }`}
          >
            {previewImg ? (
              <img
                src={previewImg}
                alt="Banner preview"
                className="w-full h-full object-cover absolute inset-0"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-white/30">
                <ImageIcon className="w-10 h-10" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-r from-[#0F172A]/95 via-[#0F172A]/75 to-[#0F172A]/20" />
            <div className="relative z-10 p-5 sm:p-6 flex flex-col justify-center min-h-[220px] max-w-md space-y-2.5">
              {(draft.badgeEn || draft.badgeBn) && (
                <span className="self-start px-2.5 py-0.5 rounded-full bg-[#FF8500]/25 border border-[#FF8500]/40 text-[#FFAB36] text-[10px] font-extrabold uppercase tracking-wider">
                  {lang === 'bn' ? draft.badgeBn || draft.badgeEn : draft.badgeEn || draft.badgeBn}
                </span>
              )}
              <h3 className="text-base sm:text-xl font-extrabold text-white leading-snug">
                {(lang === 'bn' ? draft.titleBn || draft.titleEn : draft.titleEn || draft.titleBn) ||
                  'Your Hero Headline Will Appear Here'}
              </h3>
              <p className="text-[11px] text-slate-200 line-clamp-2">
                {(lang === 'bn'
                  ? draft.subtitleBn || draft.subtitleEn
                  : draft.subtitleEn || draft.subtitleBn) ||
                  'Promotional subtitle and instant delivery details.'}
              </p>
              <div>
                <span className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl dh-orange-gradient text-white text-[11px] font-extrabold shadow-sm">
                  {lang === 'bn'
                    ? draft.buttonTextBn || draft.buttonTextEn || 'দেখুন'
                    : draft.buttonTextEn || draft.buttonTextBn || 'Explore Now'}
                  {draft.linkType === 'external_url' && <ExternalLink className="w-3 h-3" />}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-xl bg-[#F8FAFF] dark:bg-slate-800/50 border border-[#E6ECFA] dark:border-slate-700 p-3 text-[11px] text-[#5C6B84] dark:text-slate-300 space-y-1">
            <p>
              <strong className="text-[#172033] dark:text-white">Target:</strong>{' '}
              {draft.linkType === 'internal_route'
                ? `Internal Page (/${draft.ctaRoute || 'gaming-store'})`
                : draft.targetUrl || 'External URL not set'}
            </p>
            <p>
              <strong className="text-[#172033] dark:text-white">Devices:</strong>{' '}
              {draft.deviceVisibility === 'both'
                ? 'Desktop + Mobile'
                : draft.deviceVisibility === 'desktop'
                  ? 'Desktop Only'
                  : 'Mobile Only'}
              {' · '}
              <strong className="text-[#172033] dark:text-white">Order:</strong> #{draft.sortOrder}
            </p>
          </div>
        </div>
      </div>

      {/* 3. Active & Scheduled Hero Banners List */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E6ECFA] dark:border-slate-800 flex items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100">
            Managed Homepage Hero Banners ({orderedBanners.length})
          </h3>
          <span className="text-[11px] text-[#777777] dark:text-slate-400">
            Default promotional slides appear automatically if zero active custom banners match.
          </span>
        </div>

        {orderedBanners.length === 0 ? (
          <div className="p-8 text-center text-[#777777] dark:text-slate-400">
            No custom hero banners added yet. Add a banner above to customize the homepage slider.
          </div>
        ) : (
          <div className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
            {orderedBanners.map((b, idx) => {
              const status = getBannerScheduleStatus(b);
              return (
                <div
                  key={b.id}
                  className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[#F8FAFF] dark:hover:bg-slate-800/40"
                >
                  <div className="flex items-start gap-3.5 min-w-0">
                    <div className="w-24 h-14 rounded-xl bg-slate-900 overflow-hidden shrink-0 border border-[#E6ECFA] dark:border-slate-700">
                      {b.imageUrl ? (
                        <img
                          src={b.imageUrl}
                          alt={b.titleEn}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-500">
                          <ImageIcon className="w-5 h-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono-num font-bold text-[10px]">
                          #{b.sortOrder}
                        </span>
                        <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${status.cls}`}>
                          {status.label}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold text-[10px] capitalize">
                          {b.deviceVisibility === 'both' ? 'All Devices' : `${b.deviceVisibility} only`}
                        </span>
                        {b.badgeEn && (
                          <span className="px-2 py-0.5 rounded-md bg-[#FFF3E5] dark:bg-orange-950/40 text-[#FF8500] font-bold text-[10px]">
                            {b.badgeEn}
                          </span>
                        )}
                      </div>
                      <p className="font-extrabold text-[#172033] dark:text-slate-100 truncate">
                        {b.titleEn}
                      </p>
                      <p className="text-[11px] text-[#777777] dark:text-slate-400 truncate">
                        CTA: "{b.buttonTextEn}" →{' '}
                        {b.linkType === 'external_url' ? b.targetUrl : `/${b.ctaRoute || 'home'}`}
                        {(b.startDate || b.endDate) && (
                          <span className="ml-2 inline-flex items-center gap-1 font-mono-num">
                            <Calendar className="w-3 h-3" />
                            {b.startDate || 'Any'} → {b.endDate || 'No expiry'}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={idx === 0 || reorderingId === b.id}
                      onClick={() => void handleMoveOrder(idx, -1)}
                      className="p-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                      title="Move Up"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === orderedBanners.length - 1 || reorderingId === b.id}
                      onClick={() => void handleMoveOrder(idx, 1)}
                      className="p-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 disabled:opacity-40 cursor-pointer"
                      title="Move Down"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleEnabled(b)}
                      className={`px-2.5 py-1.5 rounded-lg font-bold text-[11px] cursor-pointer ${
                        b.enabled
                          ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {b.enabled ? 'Enabled' : 'Disabled'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(b.id);
                        setDraft({ ...b });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      className="p-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200 cursor-pointer"
                      title="Edit Banner"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(b)}
                      className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-[#DC2626] cursor-pointer"
                      title="Delete Banner"
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

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        lang={lang}
        title="Delete Hero Banner?"
        description={
          deleteTarget
            ? `Remove "${deleteTarget.titleEn}" permanently from homepage hero carousel?`
            : ''
        }
        tone="danger"
        confirmLabel="Delete Banner"
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
