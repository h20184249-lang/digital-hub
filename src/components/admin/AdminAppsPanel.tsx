import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  EyeOff,
  Flag,
  Plus,
  Search,
  Smartphone,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { AppBrokenReport, AppMetaPayload, Language } from '../../types/marketplace';
import {
  getMobileAppCategoryMeta,
  MOBILE_APP_CATEGORIES,
  type MobileAppCategoryId,
  type MobileAppItem,
} from '../../lib/mobileAppsCatalog';
import {
  adminDeleteMobileApp,
  adminFetchAppReports,
  adminResolveAppReport,
  adminSaveMobileApp,
  adminUploadMediaAsset,
  fetchAppMeta,
  formatDateShort,
  generateId,
  optimizePackageLogoFile,
  subscribeMobileApps,
} from '../../lib/firestoreService';
import { ConfirmDialog } from './ConfirmDialog';

interface AdminAppsPanelProps {
  lang: Language;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

function emptyAppDraft(): MobileAppItem & { notifyUsers: boolean; screenshotsText: string } {
  const id = generateId('mapp');
  return {
    id,
    slug: id,
    name: '',
    category: 'other_apps',
    developer: 'Android Developer',
    shortDescBn: '',
    shortDescEn: '',
    featuresBn: ['অ্যান্ড্রয়েড প্রিমিয়াম অ্যাক্সেস', 'দ্রুত ডেলিভারি'],
    featuresEn: ['Android premium activation', 'Fast delivery & setup guide'],
    iconUrl: '',
    screenUrl: '',
    bannerImageUrl: '',
    screenshots: [],
    screenshotsText: '',
    officialStoreUrl: 'https://play.google.com/store',
    officialStoreLabel: 'Google Play',
    downloadUrl: '',
    version: '1.0.0',
    sizeLabel: '45 MB',
    featured: false,
    popular: false,
    trending: false,
    visible: true,
    price1DeviceBdt: 50,
    price2DevicesBdt: 70,
    updatedAt: Date.now(),
    notifyUsers: false,
  };
}

export function AdminAppsPanel({ lang, onSuccess, onError }: AdminAppsPanelProps) {
  const [apps, setApps] = useState<MobileAppItem[]>([]);
  const [appMeta, setAppMeta] = useState<AppMetaPayload>({
    statsByApp: {},
    reviews: [],
    favoriteAppIds: [],
  });
  const [reports, setReports] = useState<AppBrokenReport[]>([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<'all' | MobileAppCategoryId>('all');
  const [visFilter, setVisFilter] = useState<'all' | 'visible' | 'hidden'>('all');

  const [editing, setEditing] = useState<{
    isNew: boolean;
    draft: MobileAppItem & { notifyUsers: boolean; screenshotsText: string };
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingField, setUploadingField] = useState<'icon' | 'screen' | ''>('');
  const [deleteTarget, setDeleteTarget] = useState<MobileAppItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [resolvingId, setResolvingId] = useState('');

  useEffect(() => {
    const unsub = subscribeMobileApps((list) => setApps(list), true);
    fetchAppMeta().then(setAppMeta).catch(() => {});
    adminFetchAppReports().then(setReports).catch(() => {});
    return () => unsub();
  }, []);

  const openReports = useMemo(() => reports.filter((r) => r.status !== 'resolved'), [reports]);

  const filteredApps = useMemo(() => {
    const q = search.trim().toLowerCase();
    return apps.filter((app) => {
      if (catFilter !== 'all' && app.category !== catFilter) return false;
      if (visFilter === 'visible' && app.visible === false) return false;
      if (visFilter === 'hidden' && app.visible !== false) return false;
      if (!q) return true;
      return (
        app.name.toLowerCase().includes(q) ||
        app.developer.toLowerCase().includes(q) ||
        app.id.toLowerCase().includes(q) ||
        (app.version || '').toLowerCase().includes(q)
      );
    });
  }, [apps, search, catFilter, visFilter]);

  const openCreateModal = () => {
    setEditing({ isNew: true, draft: emptyAppDraft() });
  };

  const openEditModal = (app: MobileAppItem) => {
    setEditing({
      isNew: false,
      draft: {
        ...app,
        bannerImageUrl: app.bannerImageUrl || app.screenUrl,
        screenshotsText: (app.screenshots || []).join('\n'),
        price1DeviceBdt: app.price1DeviceBdt ?? 50,
        price2DevicesBdt: app.price2DevicesBdt ?? 70,
        notifyUsers: false,
      },
    });
  };

  const handleUploadAsset = async (e: ChangeEvent<HTMLInputElement>, target: 'icon' | 'screen') => {
    const file = e.target.files?.[0];
    if (!file || !editing) return;
    setUploadingField(target);
    try {
      const dataUrl = await optimizePackageLogoFile(file, target === 'icon' ? 512 : 1024);
      const uploaded = await adminUploadMediaAsset(dataUrl);
      setEditing((prev) =>
        prev
          ? {
              ...prev,
              draft:
                target === 'icon'
                  ? { ...prev.draft, iconUrl: uploaded.url }
                  : { ...prev.draft, screenUrl: uploaded.url, bannerImageUrl: uploaded.url },
            }
          : null
      );
      onSuccess(target === 'icon' ? 'App icon uploaded.' : 'App screenshot/banner uploaded.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Image upload failed.');
    } finally {
      setUploadingField('');
    }
  };

  const handleSaveApp = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const d = editing.draft;
    if (!d.name.trim()) {
      onError('App name is required.');
      return;
    }
    if (!d.iconUrl.trim() || !(d.screenUrl.trim() || d.bannerImageUrl?.trim())) {
      onError('App icon URL and preview image URL are required.');
      return;
    }

    setSaving(true);
    try {
      const slug =
        d.slug?.trim() ||
        d.name
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '') ||
        d.id;
      const parsedScreenshots = d.screenshotsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const banner = (d.bannerImageUrl || d.screenUrl).trim();

      await adminSaveMobileApp(
        {
          id: d.id,
          slug,
          name: d.name.trim(),
          category: d.category,
          developer: d.developer.trim() || 'Developer',
          shortDescBn: d.shortDescBn.trim() || d.shortDescEn.trim() || `${d.name.trim()} প্রিমিয়াম মোবাইল অ্যাপ।`,
          shortDescEn: d.shortDescEn.trim() || d.shortDescBn.trim() || `${d.name.trim()} premium Android mobile app.`,
          featuresBn: d.featuresBn.filter(Boolean),
          featuresEn: d.featuresEn.filter(Boolean),
          iconUrl: d.iconUrl.trim(),
          screenUrl: banner,
          bannerImageUrl: banner,
          screenshots: parsedScreenshots.length ? parsedScreenshots : [banner],
          officialStoreUrl: d.officialStoreUrl.trim() || 'https://play.google.com/store',
          officialStoreLabel: d.officialStoreLabel || 'Google Play',
          downloadUrl: d.downloadUrl?.trim() || '',
          version: d.version?.trim() || '1.0.0',
          sizeLabel: d.sizeLabel?.trim() || '',
          featured: Boolean(d.featured),
          popular: Boolean(d.popular),
          trending: Boolean(d.trending),
          visible: d.visible !== false,
          price1DeviceBdt: Math.max(10, Math.round(Number(d.price1DeviceBdt) || 50)),
          price2DevicesBdt: Math.max(10, Math.round(Number(d.price2DevicesBdt) || 70)),
          updatedAt: Date.now(),
          notifyUsers: d.notifyUsers,
        },
        editing.isNew
      );
      onSuccess(
        editing.isNew
          ? `Mobile app "${d.name.trim()}" created${d.notifyUsers ? ' and users notified' : ''}.`
          : `Mobile app "${d.name.trim()}" updated${d.notifyUsers ? ' and users notified' : ''}.`
      );
      setEditing(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save mobile app.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleVisibility = async (app: MobileAppItem) => {
    try {
      await adminSaveMobileApp({ ...app, visible: app.visible === false }, false);
      onSuccess(`${app.name} is now ${app.visible === false ? 'visible' : 'hidden'} on storefront.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update visibility.');
    }
  };

  const handleResolveReport = async (reportId: string) => {
    setResolvingId(reportId);
    try {
      await adminResolveAppReport(reportId);
      setReports((prev) => prev.map((r) => (r.id === reportId ? { ...r, status: 'resolved' } : r)));
      onSuccess('Broken link report marked resolved.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to resolve report.');
    } finally {
      setResolvingId('');
    }
  };

  return (
    <div className="space-y-5 text-xs">
      {/* Header Toolbar */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-[#FF8500]" />
            {lang === 'bn' ? 'স্মার্ট অ্যাপ স্টোর ম্যানেজমেন্ট' : 'Smart App Store Management'}
          </h2>
          <p className="text-xs text-[#777777] dark:text-slate-400">
            {apps.length} total apps · {apps.filter((a) => a.visible !== false).length} visible ·{' '}
            {openReports.length} open link report(s)
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="px-4 py-2.5 rounded-xl dh-orange-gradient text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm hover:opacity-95 cursor-pointer self-start lg:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>{lang === 'bn' ? 'নতুন মোবাইল অ্যাপ যোগ করুন' : 'Add Mobile App'}</span>
        </button>
      </div>

      {/* Broken Link Reports Alert Box */}
      {openReports.length > 0 && (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 p-4 space-y-2.5">
          <p className="text-xs font-extrabold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
            <Flag className="w-4 h-4" />
            {lang === 'bn'
              ? `ভাঙা লিংক / অ্যাপ রিপোর্ট (${openReports.length})`
              : `Open Broken Link Reports (${openReports.length})`}
          </p>
          <div className="space-y-2">
            {openReports.map((rep) => (
              <div
                key={rep.id}
                className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-amber-200/70 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <p className="font-bold text-[#172033] dark:text-slate-100">
                    {rep.appName} <span className="font-mono-num text-[10px] text-[#777777]">({rep.appId})</span>
                  </p>
                  <p className="text-[#777777] dark:text-slate-400">
                    {rep.reason} · {rep.userId || 'Guest'} · {formatDateShort(rep.createdAt, lang)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={resolvingId === rep.id}
                  onClick={() => void handleResolveReport(rep.id)}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold inline-flex items-center gap-1 shrink-0 cursor-pointer disabled:opacity-50"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Mark Resolved</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search & Filters */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 grid grid-cols-1 md:grid-cols-4 gap-2.5">
        <div className="relative md:col-span-2">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search app name, developer, version, ID..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
          />
        </div>
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value as 'all' | MobileAppCategoryId)}
          className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
        >
          <option value="all">All Categories ({apps.length})</option>
          {MOBILE_APP_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.labelEn}
            </option>
          ))}
        </select>
        <select
          value={visFilter}
          onChange={(e) => setVisFilter(e.target.value as 'all' | 'visible' | 'hidden')}
          className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
        >
          <option value="all">All Visibility</option>
          <option value="visible">Visible Only</option>
          <option value="hidden">Hidden Only</option>
        </select>
      </div>

      {/* Apps Table / Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filteredApps.map((app) => {
          const catMeta = getMobileAppCategoryMeta(app.category);
          const stats = appMeta.statsByApp[app.id];
          const hidden = app.visible === false;
          return (
            <div
              key={app.id}
              className={`rounded-2xl bg-white dark:bg-slate-900 border p-4 flex flex-col justify-between gap-3 ${
                hidden
                  ? 'border-amber-300 dark:border-amber-900 opacity-75'
                  : 'border-[#E6ECFA] dark:border-slate-800'
              }`}
            >
              <div className="flex items-start gap-3">
                <img
                  src={app.iconUrl}
                  alt={app.name}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-xl object-cover border border-[#E6ECFA] dark:border-slate-700 shrink-0 bg-white"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1.5">
                    <p className="font-extrabold text-sm text-[#172033] dark:text-slate-100 truncate">
                      {app.name}
                    </p>
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold shrink-0 ${
                        hidden
                          ? 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                          : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600'
                      }`}
                    >
                      {hidden ? 'Hidden' : 'Live'}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#777777] dark:text-slate-400 truncate">
                    {catMeta.labelEn} · {app.developer}
                    {app.version ? ` · v${app.version}` : ''}
                    {app.sizeLabel ? ` · ${app.sizeLabel}` : ''}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-1 text-[10px] font-mono-num">
                    <span className="font-bold text-[#FF8500]">
                      ৳{app.price1DeviceBdt ?? 50} / ৳{app.price2DevicesBdt ?? 70}
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-[#0EA5E9]">
                      <Download className="w-3 h-3" />
                      {stats?.downloads || 0}
                    </span>
                    {stats?.ratingCount > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-amber-500">
                        <Star className="w-3 h-3 fill-current" />
                        {stats.ratingAvg.toFixed(1)}
                      </span>
                    )}
                    {app.trending && <span className="px-1.5 py-0.5 rounded bg-orange-100 text-[#FF8500] font-bold">Trending</span>}
                    {app.popular && <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700 font-bold">Popular</span>}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E6ECFA] dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => openEditModal(app)}
                  className="px-3 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 hover:border-[#FF8500] border border-[#E6ECFA] dark:border-slate-700 font-bold inline-flex items-center gap-1 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5 text-[#FF8500]" />
                  <span>Edit</span>
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleToggleVisibility(app)}
                    className="px-2.5 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 font-bold inline-flex items-center gap-1 cursor-pointer"
                  >
                    {hidden ? <Eye className="w-3.5 h-3.5 text-emerald-600" /> : <EyeOff className="w-3.5 h-3.5 text-slate-500" />}
                    <span>{hidden ? 'Show' : 'Hide'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(app)}
                    className="p-1.5 rounded-xl bg-red-50 dark:bg-red-950/40 text-[#DC2626] hover:bg-red-100 cursor-pointer"
                    title="Delete / Remove"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Mobile App Modal */}
      {editing && (
        <div className="fixed inset-0 z-[85] bg-slate-950/65 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveApp}
            className="w-full max-w-3xl max-h-[92vh] flex flex-col rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[#E6ECFA] dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-base font-extrabold text-[#172033] dark:text-slate-100">
                {editing.isNew ? 'Add New Mobile App' : `Edit App: ${editing.draft.name}`}
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">App Name *</label>
                  <input
                    type="text"
                    required
                    value={editing.draft.name}
                    onChange={(e) =>
                      setEditing({ ...editing, draft: { ...editing.draft, name: e.target.value } })
                    }
                    placeholder="e.g., CapCut Pro"
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Developer *</label>
                  <input
                    type="text"
                    required
                    value={editing.draft.developer}
                    onChange={(e) =>
                      setEditing({ ...editing, draft: { ...editing.draft, developer: e.target.value } })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Category *</label>
                  <select
                    value={editing.draft.category}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        draft: { ...editing.draft, category: e.target.value as MobileAppCategoryId },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  >
                    {MOBILE_APP_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.labelEn}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block font-bold mb-1">Version</label>
                    <input
                      type="text"
                      value={editing.draft.version || ''}
                      onChange={(e) =>
                        setEditing({ ...editing, draft: { ...editing.draft, version: e.target.value } })
                      }
                      placeholder="12.4.0"
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                    />
                  </div>
                  <div>
                    <label className="block font-bold mb-1">App Size</label>
                    <input
                      type="text"
                      value={editing.draft.sizeLabel || ''}
                      onChange={(e) =>
                        setEditing({ ...editing, draft: { ...editing.draft, sizeLabel: e.target.value } })
                      }
                      placeholder="95 MB"
                      className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-bold mb-1">1 Device Price (BDT)</label>
                  <input
                    type="number"
                    min={10}
                    value={editing.draft.price1DeviceBdt ?? 50}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        draft: { ...editing.draft, price1DeviceBdt: Number(e.target.value) || 50 },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">2 Devices Price (BDT)</label>
                  <input
                    type="number"
                    min={10}
                    value={editing.draft.price2DevicesBdt ?? 70}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        draft: { ...editing.draft, price2DevicesBdt: Number(e.target.value) || 70 },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                  />
                </div>
              </div>

              {/* Icon & Screenshot Uploads with Preview */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="block font-bold">App Icon URL (or Upload) *</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={editing.draft.iconUrl}
                      onChange={(e) =>
                        setEditing({ ...editing, draft: { ...editing.draft, iconUrl: e.target.value } })
                      }
                      placeholder="https://..."
                      className="flex-1 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                    />
                    <label className="px-3 py-2 rounded-xl bg-[#172033] text-white font-bold inline-flex items-center gap-1 cursor-pointer shrink-0">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{uploadingField === 'icon' ? '...' : 'Upload'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void handleUploadAsset(e, 'icon')}
                      />
                    </label>
                  </div>
                  {editing.draft.iconUrl && (
                    <img
                      src={editing.draft.iconUrl}
                      alt="Icon preview"
                      className="w-12 h-12 rounded-xl object-cover border border-[#E6ECFA]"
                    />
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="block font-bold">Banner / Preview Screenshot URL *</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      required
                      value={editing.draft.bannerImageUrl || editing.draft.screenUrl}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          draft: {
                            ...editing.draft,
                            screenUrl: e.target.value,
                            bannerImageUrl: e.target.value,
                          },
                        })
                      }
                      placeholder="https://..."
                      className="flex-1 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                    />
                    <label className="px-3 py-2 rounded-xl bg-[#172033] text-white font-bold inline-flex items-center gap-1 cursor-pointer shrink-0">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{uploadingField === 'screen' ? '...' : 'Upload'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => void handleUploadAsset(e, 'screen')}
                      />
                    </label>
                  </div>
                  {(editing.draft.bannerImageUrl || editing.draft.screenUrl) && (
                    <img
                      src={editing.draft.bannerImageUrl || editing.draft.screenUrl}
                      alt="Screen preview"
                      className="h-14 rounded-xl object-cover border border-[#E6ECFA]"
                    />
                  )}
                </div>
              </div>

              {/* URLs & Gallery */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Official Store URL *</label>
                  <input
                    type="url"
                    required
                    value={editing.draft.officialStoreUrl}
                    onChange={(e) =>
                      setEditing({ ...editing, draft: { ...editing.draft, officialStoreUrl: e.target.value } })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Direct Download URL (Optional)</label>
                  <input
                    type="url"
                    value={editing.draft.downloadUrl || ''}
                    onChange={(e) =>
                      setEditing({ ...editing, draft: { ...editing.draft, downloadUrl: e.target.value } })
                    }
                    placeholder="Defaults to Official Store URL if blank"
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Short Description (EN)</label>
                  <textarea
                    rows={2}
                    value={editing.draft.shortDescEn}
                    onChange={(e) =>
                      setEditing({ ...editing, draft: { ...editing.draft, shortDescEn: e.target.value } })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Short Description (BN)</label>
                  <textarea
                    rows={2}
                    value={editing.draft.shortDescBn}
                    onChange={(e) =>
                      setEditing({ ...editing, draft: { ...editing.draft, shortDescBn: e.target.value } })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1">Additional Screenshot URLs (one per line)</label>
                <textarea
                  rows={2}
                  value={editing.draft.screenshotsText}
                  onChange={(e) =>
                    setEditing({ ...editing, draft: { ...editing.draft, screenshotsText: e.target.value } })
                  }
                  placeholder="https://..."
                  className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                />
              </div>

              {/* Discovery Badges & Notification Switch */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                {(
                  [
                    ['visible', 'Visible'],
                    ['featured', 'Featured'],
                    ['popular', 'Popular'],
                    ['trending', 'Trending'],
                    ['notifyUsers', 'Notify Users'],
                  ] as const
                ).map(([field, label]) => (
                  <label
                    key={field}
                    className="p-2.5 rounded-xl bg-[#F8FAFF] dark:bg-slate-800/70 border border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between gap-2 cursor-pointer font-bold"
                  >
                    <span>{label}</span>
                    <input
                      type="checkbox"
                      checked={field === 'visible' ? editing.draft.visible !== false : Boolean(editing.draft[field])}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          draft: { ...editing.draft, [field]: e.target.checked },
                        })
                      }
                      className="accent-[#FF8500] w-4 h-4"
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="px-5 py-4 border-t border-[#E6ECFA] dark:border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2 rounded-xl dh-orange-gradient text-white font-extrabold disabled:opacity-50"
              >
                {saving ? 'Saving...' : editing.isNew ? 'Create App' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        lang={lang}
        title={`Remove "${deleteTarget?.name || ''}"?`}
        description="This deletes any custom catalog override for this app (built-in catalog apps can still be hidden via the Hide button)."
        tone="danger"
        confirmLabel="Remove App Override"
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleting(true);
          try {
            await adminDeleteMobileApp(deleteTarget.id);
            onSuccess(`Removed override for "${deleteTarget.name}".`);
            setDeleteTarget(null);
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to remove app.');
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
