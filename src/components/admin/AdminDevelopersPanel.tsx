import { ChangeEvent, FormEvent, useMemo, useRef, useState } from 'react';
import {
  BadgeCheck,
  ChevronDown,
  ChevronUp,
  Code2,
  Edit3,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  DeveloperProfile,
  DeveloperRank,
  DeveloperSocialLinks,
  Language,
} from '../../types/marketplace';
import {
  adminDeleteDeveloper,
  adminReorderDevelopers,
  adminSaveDeveloper,
  adminUploadMediaAsset,
  generateId,
  optimizePackageLogoFile,
  subscribeDevelopers,
} from '../../lib/firestoreService';
import {
  DEVELOPER_RANK_META,
  DEVELOPER_RANK_ORDER,
  isDefaultRankTitle,
  normalizeDeveloperRank,
  sortDevelopersByRank,
} from '../../lib/developerRankTheme';
import { DeveloperProfileCard } from '../DeveloperTeamSection';
import { ConfirmDialog } from './ConfirmDialog';
import { useEffect } from 'react';

interface AdminDevelopersPanelProps {
  lang: Language;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

const RANK_SELECTOR_ORDER: DeveloperRank[] = ['verified', 'blue', 'silver', 'gold'];

function createEmptyDeveloperDraft(nextOrder: number, lang: Language = 'en'): DeveloperProfile {
  return {
    id: generateId('dev'),
    name: '',
    title:
      lang === 'bn'
        ? DEVELOPER_RANK_META.verified.defaultTitleBn
        : DEVELOPER_RANK_META.verified.defaultTitle,
    rank: 'verified',
    verified: true,
    bio: '',
    photoUrl: '',
    socialLinks: {},
    sortOrder: nextOrder,
    active: true,
  };
}

function readImageFileVerbatim(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Failed to read selected image file.'));
    reader.readAsDataURL(file);
  });
}

export function AdminDevelopersPanel({
  lang,
  onSuccess,
  onError,
}: AdminDevelopersPanelProps) {
  const [developers, setDevelopers] = useState<DeveloperProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<DeveloperProfile>(() => createEmptyDeveloperDraft(0, lang));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeveloperProfile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let first = true;
    const unsub = subscribeDevelopers((list) => {
      setDevelopers(sortDevelopersByRank(list));
      if (first) {
        first = false;
        setLoading(false);
      }
    }, true);
    return unsub;
  }, []);

  const nextSortOrder = useMemo(() => {
    if (developers.length === 0) return 0;
    return Math.max(...developers.map((d) => Number(d.sortOrder) || 0)) + 1;
  }, [developers]);

  const groupedByRank = useMemo(() => {
    const groups: Record<DeveloperRank, DeveloperProfile[]> = {
      gold: [],
      silver: [],
      blue: [],
      verified: [],
    };
    for (const dev of sortDevelopersByRank(developers)) {
      groups[normalizeDeveloperRank(dev.rank)].push(dev);
    }
    return groups;
  }, [developers]);

  const handleSelectRank = (newRank: DeveloperRank) => {
    setDraft((prev) => {
      const nextDefaultTitle =
        lang === 'bn'
          ? DEVELOPER_RANK_META[newRank].defaultTitleBn
          : DEVELOPER_RANK_META[newRank].defaultTitle;
      const shouldUpdateTitle = isDefaultRankTitle(prev.title || '');
      return {
        ...prev,
        rank: newRank,
        title: shouldUpdateTitle ? nextDefaultTitle : prev.title,
      };
    });
  };

  const handlePhotoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingPhoto(true);
    try {
      const mime = (file.type || '').toLowerCase();
      const extMatch = /\.(png|jpe?g|webp)$/i.test(file.name || '');
      if (!new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']).has(mime) && !extMatch) {
        throw new Error('Only PNG, JPG, JPEG, or WebP images are supported.');
      }
      // Preserve uploaded logos/stickers/covered-face images pixel-verbatim when <= 1.5MB; resize only oversized photos
      const dataUrl =
        file.size <= 1.5 * 1024 * 1024
          ? await readImageFileVerbatim(file)
          : await optimizePackageLogoFile(file, 1024);
      const uploaded = await adminUploadMediaAsset(dataUrl);
      setDraft((prev) => ({ ...prev, photoUrl: uploaded.url }));
      onSuccess(
        lang === 'bn'
          ? 'ছবি/লোগো মূল রূপে আপলোড হয়েছে।'
          : 'Developer photo/logo uploaded intact.'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to upload image.');
    } finally {
      setUploadingPhoto(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const updateSocialLink = (key: keyof DeveloperSocialLinks, value: string) => {
    setDraft((prev) => ({
      ...prev,
      socialLinks: {
        ...(prev.socialLinks || {}),
        [key]: value,
      },
    }));
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    const cleanName = draft.name.trim();
    if (cleanName.length < 2) {
      onError(
        lang === 'bn'
          ? 'ডেভেলপারের নাম কমপক্ষে ২ অক্ষরের হতে হবে।'
          : 'Developer name must be at least 2 characters.'
      );
      return;
    }

    setSaving(true);
    try {
      const cleanSocial: DeveloperSocialLinks = {};
      if (draft.socialLinks) {
        (['github', 'portfolio', 'linkedin', 'telegram', 'facebook', 'x'] as const).forEach((k) => {
          const val = (draft.socialLinks?.[k] || '').trim();
          if (val) {
            cleanSocial[k] = /^https?:\/\//i.test(val) ? val : `https://${val}`;
          }
        });
      }

      const payload: DeveloperProfile = {
        ...draft,
        id: editingId || draft.id || generateId('dev'),
        name: cleanName,
        title: draft.title.trim() || DEVELOPER_RANK_META[draft.rank].defaultTitle,
        rank: normalizeDeveloperRank(draft.rank),
        verified: Boolean(draft.verified),
        bio: draft.bio.trim(),
        photoUrl: draft.photoUrl.trim(),
        socialLinks: cleanSocial,
        sortOrder: editingId ? Number(draft.sortOrder || 0) : nextSortOrder,
        active: draft.active !== false,
      };

      await adminSaveDeveloper(payload);
      onSuccess(
        editingId
          ? lang === 'bn'
            ? `"${cleanName}" প্রোফাইল আপডেট হয়েছে।`
            : `Updated developer profile "${cleanName}".`
          : lang === 'bn'
            ? `"${cleanName}" টিমে যুক্ত হয়েছে।`
            : `Published developer "${cleanName}" to Developer Team.`
      );
      setEditingId(null);
      setDraft(createEmptyDeveloperDraft(nextSortOrder + 1, lang));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save developer.');
    } finally {
      setSaving(false);
    }
  };

  const handleEditStart = (dev: DeveloperProfile) => {
    setEditingId(dev.id);
    setDraft({
      ...dev,
      rank: normalizeDeveloperRank(dev.rank),
      socialLinks: { ...(dev.socialLinks || {}) },
    });
    editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleResetNew = () => {
    setEditingId(null);
    setDraft(createEmptyDeveloperDraft(nextSortOrder, lang));
  };

  const handleQuickUpdate = async (dev: DeveloperProfile, updates: Partial<DeveloperProfile>) => {
    setBusyId(dev.id);
    try {
      const nextRank = updates.rank ? normalizeDeveloperRank(updates.rank) : normalizeDeveloperRank(dev.rank);
      const nextTitle =
        updates.rank && isDefaultRankTitle(dev.title || '')
          ? DEVELOPER_RANK_META[nextRank].defaultTitle
          : dev.title;
      await adminSaveDeveloper({
        ...dev,
        ...updates,
        rank: nextRank,
        title: nextTitle,
      });
      onSuccess(lang === 'bn' ? 'প্রোফাইল আপডেট হয়েছে।' : `Updated ${dev.name}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setBusyId(null);
    }
  };

  const handleMoveWithinRank = async (rank: DeveloperRank, index: number, direction: -1 | 1) => {
    const list = groupedByRank[rank];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const reordered = [...list];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);

    const payload = reordered.map((item, idx) => ({
      id: item.id,
      sortOrder: idx,
    }));

    setBusyId(moved.id);
    try {
      await adminReorderDevelopers(payload);
      onSuccess(lang === 'bn' ? 'ক্রম আপডেট হয়েছে।' : 'Display order updated.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to reorder.');
    } finally {
      setBusyId(null);
    }
  };

  const activeCount = developers.filter((d) => d.active !== false).length;

  return (
    <div className="space-y-6">
      {/* Top Overview Bar */}
      <div className="dh-card rounded-3xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Code2 className="w-5 h-5 text-[#FF8500]" />
            <h2 className="text-lg font-extrabold text-[#172033] dark:text-slate-100">
              {lang === 'bn' ? 'ডেভেলপার টিম ও র‍্যাংক ম্যানেজমেন্ট' : 'Developer Team & Rank Management'}
            </h2>
          </div>
          <p className="text-xs text-[#777777] dark:text-slate-400">
            {lang === 'bn'
              ? 'ইউজার প্রোফাইলের Developer Team সেকশনে দেখানোর জন্য র‍্যাংক, ব্যাজ, ছবি ও পরিচিতি ম্যানেজ করুন।'
              : 'Manage developer profiles, 4-tier rank badges (Gold → Silver → Blue → Verified), and verification seals shown in User Profile.'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs font-bold font-mono-num tabular-nums text-[#475569] dark:text-slate-300 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700">
            {lang === 'bn'
              ? `সক্রিয়: ${activeCount} / মোট: ${developers.length}`
              : `Active: ${activeCount} / Total: ${developers.length}`}
          </span>
          <button
            type="button"
            onClick={handleResetNew}
            className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'bn' ? 'নতুন ডেভেলপার' : 'Add Developer'}</span>
          </button>
        </div>
      </div>

      {/* Create / Edit Form + Live Preview Split */}
      <div
        ref={editorRef}
        className="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start"
      >
        {/* Editor Form */}
        <form
          onSubmit={handleSave}
          className="xl:col-span-7 dh-card rounded-3xl p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-[#E6ECFA] dark:border-slate-800">
            <div>
              <h3 className="text-base font-extrabold text-[#172033] dark:text-slate-100">
                {editingId
                  ? lang === 'bn'
                    ? 'ডেভেলপার প্রোফাইল এডিট করুন'
                    : 'Edit Developer Profile'
                  : lang === 'bn'
                    ? 'নতুন ডেভেলপার যুক্ত করুন'
                    : 'Add New Developer'}
              </h3>
              <p className="text-[11px] text-[#777777] dark:text-slate-400">
                {lang === 'bn'
                  ? 'লোগো, স্টিকার বা ঢাকা মুখের ছবি কোনো পরিবর্তন ছাড়াই হুবহু দেখানো হবে।'
                  : 'Uploaded profile photos, logos, or stickers are displayed verbatim with zero alteration.'}
              </p>
            </div>
            {editingId && (
              <button
                type="button"
                onClick={handleResetNew}
                className="px-3 py-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 text-xs font-bold text-[#172033] dark:text-slate-300 inline-flex items-center gap-1"
              >
                <X className="w-3.5 h-3.5" />
                <span>{lang === 'bn' ? 'বাতিল' : 'Cancel Edit'}</span>
              </button>
            )}
          </div>

          {/* Photo Upload + URL */}
          <div className="space-y-2.5">
            <label className="block text-xs font-bold text-[#172033] dark:text-slate-200">
              {lang === 'bn' ? 'প্রোফাইল ছবি বা লোগো' : 'Profile Photo / Logo'}
            </label>
            <div className="flex flex-wrap items-center gap-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                onChange={handlePhotoUpload}
                className="hidden"
              />
              <button
                type="button"
                disabled={uploadingPhoto}
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-[#FFF7EE] dark:bg-orange-950/30 border border-[#FF8500]/50 text-xs font-bold text-[#172033] dark:text-orange-200 inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                {uploadingPhoto ? (
                  <RefreshCw className="w-4 h-4 animate-spin text-[#FF8500]" />
                ) : (
                  <Upload className="w-4 h-4 text-[#FF8500]" />
                )}
                <span>
                  {uploadingPhoto
                    ? lang === 'bn'
                      ? 'আপলোড হচ্ছে...'
                      : 'Uploading...'
                    : draft.photoUrl
                      ? lang === 'bn'
                        ? 'ছবি পরিবর্তন করুন'
                        : 'Replace Photo'
                      : lang === 'bn'
                        ? 'ছবি আপলোড করুন'
                        : 'Upload Photo'}
                </span>
              </button>

              {draft.photoUrl && (
                <button
                  type="button"
                  onClick={() => setDraft((prev) => ({ ...prev, photoUrl: '' }))}
                  className="px-3 py-2 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-xs font-bold text-[#DC2626]"
                >
                  {lang === 'bn' ? 'ছবি সরান' : 'Remove Photo'}
                </button>
              )}
            </div>
            <input
              type="text"
              value={draft.photoUrl}
              onChange={(e) => setDraft((prev) => ({ ...prev, photoUrl: e.target.value }))}
              placeholder={
                lang === 'bn'
                  ? 'অথবা ছবির লিংক দিন (https://... বা /assets/...)'
                  : 'Or paste image URL (https://... or /api/media/...)'
              }
              className="w-full px-3.5 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs"
            />
          </div>

          {/* Rank Selector (Rank 1 -> Rank 4) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold text-[#172033] dark:text-slate-200">
                {lang === 'bn' ? 'ডেভেলপার র‍্যাংক (নিম্ন থেকে উচ্চ)' : 'Developer Rank Tier (Rank 1 → Rank 4)'}
              </label>
              <span className="text-[11px] text-[#777777] dark:text-slate-400">
                {lang === 'bn' ? 'র‍্যাংক বাছাই করলে থিম ও ব্যাজ স্বয়ংক্রিয় আপডেট হবে' : 'Auto-updates badge, border & frame'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {RANK_SELECTOR_ORDER.map((rKey) => {
                const meta = DEVELOPER_RANK_META[rKey];
                const Icon = meta.Icon;
                const selected = draft.rank === rKey;
                return (
                  <button
                    key={rKey}
                    type="button"
                    onClick={() => handleSelectRank(rKey)}
                    className={`p-3 rounded-2xl border text-left transition-all flex flex-col gap-1.5 ${
                      selected
                        ? 'bg-[#0B111E] border-[#FF8500] ring-2 ring-[#FF8500]/30 text-white shadow-md'
                        : 'bg-[#F3F6FF] dark:bg-slate-800/70 border-[#E6ECFA] dark:border-slate-700 hover:border-slate-400 text-[#172033] dark:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={`w-7 h-7 rounded-lg flex items-center justify-center ${
                          selected ? 'bg-slate-800' : 'bg-white dark:bg-slate-900'
                        }`}
                      >
                        <Icon
                          className={`w-4 h-4 ${
                            selected ? meta.titleTextClass : 'text-slate-500 dark:text-slate-300'
                          }`}
                        />
                      </span>
                      <span className="text-[10px] font-mono-num font-bold opacity-75">
                        R{meta.tierLevel}
                      </span>
                    </div>
                    <p className="text-xs font-extrabold leading-tight">
                      {lang === 'bn' ? meta.labelBn : meta.labelEn}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Name & Official Position / Title */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
                {lang === 'bn' ? 'ডেভেলপারের নাম *' : 'Developer Name *'}
              </label>
              <input
                type="text"
                required
                maxLength={120}
                value={draft.name}
                onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                placeholder={lang === 'bn' ? 'যেমন: মো. তারিকুল ইসলাম' : 'e.g. Tariqul Islam'}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-[#172033] dark:text-slate-200 mb-1">
                {lang === 'bn' ? 'পদবী / টাইটেল' : 'Official Title / Role'}
              </label>
              <input
                type="text"
                maxLength={120}
                value={draft.title}
                onChange={(e) => setDraft((prev) => ({ ...prev, title: e.target.value }))}
                placeholder={DEVELOPER_RANK_META[draft.rank].defaultTitle}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-sm"
              />
            </div>
          </div>

          {/* Short Bio */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-[#172033] dark:text-slate-200">
                {lang === 'bn' ? 'সংক্ষিপ্ত পরিচিতি (Bio)' : 'Short Bio / Description'}
              </label>
              <span className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400">
                {draft.bio.length}/400
              </span>
            </div>
            <textarea
              rows={3}
              maxLength={400}
              value={draft.bio}
              onChange={(e) => setDraft((prev) => ({ ...prev, bio: e.target.value }))}
              placeholder={
                lang === 'bn'
                  ? 'যেমন: ফুল-স্ট্যাক ওয়েব ইঞ্জিনিয়ার, পেমেন্ট সিস্টেম ও সিকিউরিটি আর্কিটেক্ট...'
                  : 'e.g. Full-stack systems engineer specializing in security, cloud APIs, and marketplace architecture.'
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-sm resize-none"
            />
          </div>

          {/* Independent Verification & Visibility Toggles */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setDraft((prev) => ({ ...prev, verified: !prev.verified }))}
              className={`p-3 rounded-2xl border flex items-center justify-between gap-2 text-left transition-colors ${
                draft.verified
                  ? 'bg-sky-50 dark:bg-sky-950/30 border-sky-300 dark:border-sky-700 text-[#0369A1] dark:text-sky-200'
                  : 'bg-[#F3F6FF] dark:bg-slate-800 border-[#E6ECFA] dark:border-slate-700 text-[#475569] dark:text-slate-300'
              }`}
            >
              <span className="flex items-center gap-2 text-xs font-bold">
                <BadgeCheck className={`w-4 h-4 ${draft.verified ? 'text-sky-500' : 'text-slate-400'}`} />
                <span>{lang === 'bn' ? 'ভেরিফায়েড ব্যাজ' : 'Verified Badge'}</span>
              </span>
              <span className="text-[11px] font-extrabold uppercase">
                {draft.verified ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setDraft((prev) => ({ ...prev, active: !prev.active }))}
              className={`p-3 rounded-2xl border flex items-center justify-between gap-2 text-left transition-colors ${
                draft.active
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700 text-[#15803D] dark:text-emerald-200'
                  : 'bg-[#F3F6FF] dark:bg-slate-800 border-[#E6ECFA] dark:border-slate-700 text-[#475569] dark:text-slate-300'
              }`}
            >
              <span className="flex items-center gap-2 text-xs font-bold">
                {draft.active ? (
                  <Eye className="w-4 h-4 text-emerald-600" />
                ) : (
                  <EyeOff className="w-4 h-4 text-slate-400" />
                )}
                <span>{lang === 'bn' ? 'ইউজার প্রোফাইলে দৃশ্যমান' : 'Visible in Profile'}</span>
              </span>
              <span className="text-[11px] font-extrabold uppercase">
                {draft.active ? 'ACTIVE' : 'HIDDEN'}
              </span>
            </button>
          </div>

          {/* Optional Social Links */}
          <div className="space-y-2.5 pt-2 border-t border-[#E6ECFA] dark:border-slate-800">
            <p className="text-xs font-bold text-[#172033] dark:text-slate-200">
              {lang === 'bn' ? 'সোশ্যাল / পোর্টফোলিও লিংক (ঐচ্ছিক)' : 'Optional Social & Portfolio Links'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {(
                [
                  { key: 'github', label: 'GitHub URL', ph: 'https://github.com/username' },
                  { key: 'portfolio', label: 'Portfolio / Website', ph: 'https://portfolio.dev' },
                  { key: 'linkedin', label: 'LinkedIn URL', ph: 'https://linkedin.com/in/...' },
                  { key: 'telegram', label: 'Telegram Link', ph: 'https://t.me/username' },
                  { key: 'facebook', label: 'Facebook URL', ph: 'https://facebook.com/...' },
                  { key: 'x', label: 'X / Twitter URL', ph: 'https://x.com/...' },
                ] as const
              ).map((item) => (
                <div key={item.key}>
                  <label className="block text-[11px] font-semibold text-[#777777] dark:text-slate-400 mb-1">
                    {item.label}
                  </label>
                  <input
                    type="text"
                    value={draft.socialLinks?.[item.key] || ''}
                    onChange={(e) => updateSocialLink(item.key, e.target.value)}
                    placeholder={item.ph}
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Submit */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="px-6 py-2.5 rounded-xl dh-orange-gradient text-white text-sm font-bold inline-flex items-center gap-2 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              <span>
                {saving
                  ? lang === 'bn'
                    ? 'সংরক্ষণ হচ্ছে...'
                    : 'Saving...'
                  : editingId
                    ? lang === 'bn'
                      ? 'পরিবর্তন সেভ করুন'
                      : 'Update Developer'
                    : lang === 'bn'
                      ? 'টিমে যুক্ত ও প্রকাশ করুন'
                      : 'Publish Developer'}
              </span>
            </button>
          </div>
        </form>

        {/* Live Card Preview Panel */}
        <div className="xl:col-span-5 rounded-3xl bg-[#0B111E] border border-slate-800 p-5 sm:p-6 space-y-4 sticky top-20">
          <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">
                {lang === 'bn' ? 'লাইভ কার্ড প্রিভিউ' : 'Live Card Preview'}
              </p>
              <h4 className="text-sm font-extrabold text-white">
                {lang === 'bn'
                  ? 'ইউজার প্রোফাইলে যেমন দেখাবে'
                  : 'Exact appearance inside User Profile'}
              </h4>
            </div>
            <span className="text-[11px] font-mono-num text-slate-400">
              {DEVELOPER_RANK_META[draft.rank].shortLabel}
            </span>
          </div>

          <DeveloperProfileCard developer={draft} lang={lang} preview />

          <div className="text-[11px] text-slate-400 leading-relaxed pt-1">
            {lang === 'bn'
              ? 'সকল ডেভেলপার প্রোফাইল ইউজার প্রোফাইল পেজে স্বয়ংক্রিয়ভাবে Gold → Silver → Blue → Verified ক্রমানুসারে সাজানো হয়।'
              : 'Profiles automatically sort highest-to-lowest (Gold → Silver → Blue → Verified) and by your manual order within each rank.'}
          </div>
        </div>
      </div>

      {/* Developer Roster Grouped By Rank */}
      <div className="dh-card rounded-3xl p-5 sm:p-6 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h3 className="text-base font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-2">
            <Users className="w-4 h-4 text-[#FF8500]" />
            <span>
              {lang === 'bn'
                ? 'কেন্দ্রীয় ডেভেলপার তালিকা (র‍্যাংক অনুযায়ী)'
                : 'Centralized Developer Roster (Sorted by Rank)'}
            </span>
          </h3>
        </div>

        {loading ? (
          <div className="py-10 text-center text-xs text-[#777777]">
            {lang === 'bn' ? 'তালিকা লোড হচ্ছে...' : 'Loading developer roster...'}
          </div>
        ) : developers.length === 0 ? (
          <div className="rounded-2xl bg-[#F3F6FF] dark:bg-slate-800/50 border border-[#E6ECFA] dark:border-slate-700 py-10 px-4 text-center space-y-2">
            <Code2 className="w-7 h-7 text-[#FF8500] mx-auto" />
            <p className="text-sm font-bold text-[#172033] dark:text-slate-100">
              {lang === 'bn'
                ? 'এখনো কোনো ডেভেলপার যুক্ত করা হয়নি'
                : 'No Developers Added Yet'}
            </p>
            <p className="text-xs text-[#777777] dark:text-slate-400 max-w-md mx-auto">
              {lang === 'bn'
                ? 'উপরের ফর্ম ব্যবহার করে আপনার প্রথম টিম মেম্বার যুক্ত করুন।'
                : 'Use the form above to add your first developer with a Rank badge and profile card.'}
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {DEVELOPER_RANK_ORDER.map((rKey) => {
              const items = groupedByRank[rKey];
              if (items.length === 0) return null;
              const meta = DEVELOPER_RANK_META[rKey];
              const Icon = meta.Icon;

              return (
                <div key={rKey} className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-[#E6ECFA] dark:border-slate-800">
                    <div className="flex items-center gap-2">
                      <Icon className="w-4 h-4 text-[#FF8500]" />
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-[#172033] dark:text-slate-200">
                        {lang === 'bn' ? meta.labelBn : meta.labelEn}
                      </h4>
                    </div>
                    <span className="text-[11px] font-mono-num tabular-nums font-bold text-[#777777] dark:text-slate-400">
                      {items.length}
                    </span>
                  </div>

                  <div className="space-y-2.5">
                    {items.map((dev, idx) => {
                      const isBusy = busyId === dev.id;
                      return (
                        <div
                          key={dev.id}
                          className={`p-3.5 rounded-2xl border flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-colors ${
                            dev.active
                              ? 'bg-[#F8FAFF] dark:bg-slate-800/60 border-[#E6ECFA] dark:border-slate-700'
                              : 'bg-slate-100/80 dark:bg-slate-900/60 border-slate-200 dark:border-slate-800 opacity-75'
                          }`}
                        >
                          {/* Identity */}
                          <div className="flex items-center gap-3 min-w-0">
                            {dev.photoUrl ? (
                              <img
                                src={dev.photoUrl}
                                alt={dev.name}
                                referrerPolicy="no-referrer"
                                className="w-11 h-11 rounded-xl object-cover bg-slate-900 border border-slate-700 shrink-0"
                              />
                            ) : (
                              <div className="w-11 h-11 rounded-xl bg-[#172033] text-white flex items-center justify-center font-extrabold text-xs shrink-0">
                                {dev.name.slice(0, 2).toUpperCase()}
                              </div>
                            )}

                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="text-sm font-extrabold text-[#172033] dark:text-slate-100 truncate">
                                  {dev.name}
                                </p>
                                {dev.verified && (
                                  <BadgeCheck className="w-4 h-4 text-sky-500 shrink-0" />
                                )}
                                {!dev.active && (
                                  <span className="text-[10px] font-bold uppercase text-amber-600 dark:text-amber-400">
                                    · Hidden
                                  </span>
                                )}
                              </div>
                              <p className="text-xs font-semibold text-[#475569] dark:text-slate-300 truncate">
                                {dev.title}
                              </p>
                              {dev.bio && (
                                <p className="text-[11px] text-[#777777] dark:text-slate-400 truncate max-w-xl">
                                  {dev.bio}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Controls */}
                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                            {/* Within-Rank Reorder */}
                            <div className="inline-flex items-center rounded-xl border border-[#E6ECFA] dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
                              <button
                                type="button"
                                disabled={idx === 0 || isBusy}
                                onClick={() => handleMoveWithinRank(rKey, idx, -1)}
                                title="Move Up"
                                className="p-1.5 hover:bg-[#F3F6FF] dark:hover:bg-slate-800 disabled:opacity-35"
                              >
                                <ChevronUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                disabled={idx === items.length - 1 || isBusy}
                                onClick={() => handleMoveWithinRank(rKey, idx, 1)}
                                title="Move Down"
                                className="p-1.5 border-l border-[#E6ECFA] dark:border-slate-700 hover:bg-[#F3F6FF] dark:hover:bg-slate-800 disabled:opacity-35"
                              >
                                <ChevronDown className="w-3.5 h-3.5" />
                              </button>
                            </div>

                            {/* Quick Rank Switcher */}
                            <select
                              aria-label={`Change rank for ${dev.name}`}
                              disabled={isBusy}
                              value={normalizeDeveloperRank(dev.rank)}
                              onChange={(e) =>
                                handleQuickUpdate(dev, {
                                  rank: normalizeDeveloperRank(e.target.value),
                                })
                              }
                              className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 text-xs font-bold"
                            >
                              <option value="gold">Gold Rank</option>
                              <option value="silver">Silver Rank</option>
                              <option value="blue">Blue Rank</option>
                              <option value="verified">Verified</option>
                            </select>

                            {/* Verified Toggle */}
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleQuickUpdate(dev, { verified: !dev.verified })}
                              className={`px-2.5 py-1.5 rounded-xl border text-xs font-bold inline-flex items-center gap-1 ${
                                dev.verified
                                  ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-300 dark:border-sky-700 text-[#0369A1] dark:text-sky-200'
                                  : 'bg-white dark:bg-slate-900 border-[#E6ECFA] dark:border-slate-700 text-slate-500'
                              }`}
                            >
                              <BadgeCheck className="w-3.5 h-3.5" />
                              <span>{dev.verified ? 'Verified' : 'Unverified'}</span>
                            </button>

                            {/* Visibility Toggle */}
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleQuickUpdate(dev, { active: !dev.active })}
                              title={dev.active ? 'Hide from profile' : 'Show in profile'}
                              className="p-1.5 rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-[#FF8500]"
                            >
                              {dev.active ? (
                                <Eye className="w-4 h-4 text-emerald-600" />
                              ) : (
                                <EyeOff className="w-4 h-4 text-slate-400" />
                              )}
                            </button>

                            {/* Edit */}
                            <button
                              type="button"
                              onClick={() => handleEditStart(dev)}
                              className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 hover:border-[#FF8500] text-xs font-bold inline-flex items-center gap-1"
                            >
                              <Edit3 className="w-3.5 h-3.5 text-[#FF8500]" />
                              <span>{lang === 'bn' ? 'এডিট' : 'Edit'}</span>
                            </button>

                            {/* Delete */}
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(dev)}
                              className="p-1.5 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 text-[#DC2626] hover:bg-red-100"
                              title="Delete Developer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
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
        title={
          lang === 'bn'
            ? `"${deleteTarget?.name || ''}" মুছে ফেলবেন?`
            : `Delete "${deleteTarget?.name || ''}"?`
        }
        description={
          lang === 'bn'
            ? 'এই ডেভেলপার প্রোফাইল স্থায়ীভাবে মুছে ফেলা হবে এবং সকল ইউজার প্রোফাইল থেকে সরে যাবে।'
            : 'This developer profile will be permanently deleted and immediately removed from all User Profile pages.'
        }
        tone="danger"
        confirmLabel={lang === 'bn' ? 'মুছে ফেলুন' : 'Delete Permanently'}
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleting(true);
          try {
            await adminDeleteDeveloper(deleteTarget.id);
            if (editingId === deleteTarget.id) {
              handleResetNew();
            }
            onSuccess(
              lang === 'bn'
                ? `"${deleteTarget.name}" মুছে ফেলা হয়েছে।`
                : `Deleted developer "${deleteTarget.name}".`
            );
            setDeleteTarget(null);
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to delete developer.');
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
