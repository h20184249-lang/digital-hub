import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  Flag,
  FolderTree,
  Gamepad2,
  LayoutGrid,
  LifeBuoy,
  MessageSquare,
  Plus,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type {
  AppBrokenReport,
  Category,
  GameCategoryId,
  GameItem,
  GameMetaPayload,
  HomepageSectionConfig,
  Language,
  Product,
  SiteSettings,
  SupportTicket,
} from '../../types/marketplace';
import { GAME_CATEGORIES, getGameCategoryMeta } from '../../lib/gamesCatalog';
import { MOBILE_APP_CATEGORIES, type MobileAppItem } from '../../lib/mobileAppsCatalog';
import { DEFAULT_HOMEPAGE_SECTIONS } from '../../lib/seedData';
import {
  adminDeleteCategory,
  adminDeleteGame,
  adminFetchAppReports,
  adminReplyTicket,
  adminResolveAppReport,
  adminSaveCategory,
  adminSaveGame,
  adminSaveSiteSettings,
  adminUploadMediaAsset,
  fetchGameMeta,
  formatDateShort,
  generateId,
  optimizePackageLogoFile,
  subscribeGames,
} from '../../lib/firestoreService';
import { ConfirmDialog } from './ConfirmDialog';

const EMPTY_PRODUCTS: Product[] = [];
const EMPTY_APPS: MobileAppItem[] = [];
const EMPTY_GAMES: GameItem[] = [];
const EMPTY_CATEGORIES: Category[] = [];
const EMPTY_TICKETS: SupportTicket[] = [];

const ACCENT_PRESETS = ['#FF8500', '#2563EB', '#059669', '#DC2626', '#7C3AED'];

// =========================================================================
// 1. GAMES CMS PANEL
// =========================================================================

function emptyGameDraft(): GameItem & { screenshotsText: string } {
  const id = generateId('game');
  return {
    id,
    slug: id,
    titleEn: '',
    titleBn: '',
    category: 'android_games',
    developer: 'Game Studio',
    shortDescBn: '',
    shortDescEn: '',
    imageUrl: '/assets/products/prod_ff_bd_diamonds.jpg',
    screenshots: [],
    screenshotsText: '',
    playUrl: '',
    downloadUrl: '',
    relatedProductId: '',
    version: '1.0.0',
    sizeLabel: '120 MB',
    featured: false,
    popular: false,
    trending: false,
    isNew: true,
    visible: true,
    updatedAt: Date.now(),
  };
}

interface AdminGamesPanelProps {
  lang: Language;
  products?: Product[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminGamesPanel({
  lang,
  products = EMPTY_PRODUCTS,
  onSuccess,
  onError,
}: AdminGamesPanelProps) {
  const [games, setGames] = useState<GameItem[]>([]);
  const [gameMeta, setGameMeta] = useState<GameMetaPayload>({ statsByGame: {} });
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState<'all' | GameCategoryId>('all');
  const [visFilter, setVisFilter] = useState<'all' | 'visible' | 'hidden'>('all');

  const [editing, setEditing] = useState<{
    isNew: boolean;
    draft: GameItem & { screenshotsText: string };
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingThumb, setUploadingThumb] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GameItem | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const unsub = subscribeGames((list) => setGames(list), true);
    fetchGameMeta().then(setGameMeta).catch(() => {});
    return () => unsub();
  }, []);

  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase();
    return games.filter((g) => {
      if (catFilter !== 'all' && g.category !== catFilter) return false;
      if (visFilter === 'visible' && g.visible === false) return false;
      if (visFilter === 'hidden' && g.visible !== false) return false;
      if (!q) return true;
      return (
        g.titleEn.toLowerCase().includes(q) ||
        g.titleBn.toLowerCase().includes(q) ||
        g.developer.toLowerCase().includes(q) ||
        g.id.toLowerCase().includes(q)
      );
    });
  }, [games, catFilter, visFilter, search]);

  const handleThumbUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editing) return;
    setUploadingThumb(true);
    try {
      const optimized = await optimizePackageLogoFile(file, 640);
      const uploaded = await adminUploadMediaAsset(optimized);
      setEditing((prev) =>
        prev
          ? {
              ...prev,
              draft: { ...prev.draft, imageUrl: uploaded.url },
            }
          : null
      );
      onSuccess('Game artwork uploaded.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to upload image.');
    } finally {
      setUploadingThumb(false);
      e.target.value = '';
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const d = editing.draft;
    if (!d.titleEn.trim() && !d.titleBn.trim()) {
      onError('Game title is required.');
      return;
    }
    setSaving(true);
    try {
      const screenshots = d.screenshotsText
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      const { screenshotsText: _unused, ...clean } = d;
      await adminSaveGame(
        {
          ...clean,
          titleEn: (d.titleEn || d.titleBn).trim(),
          titleBn: (d.titleBn || d.titleEn).trim(),
          slug: (d.slug || d.titleEn || d.id)
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9-]+/g, '-'),
          screenshots,
          updatedAt: Date.now(),
        },
        editing.isNew
      );
      setEditing(null);
      onSuccess(editing.isNew ? 'Game created successfully.' : 'Game updated successfully.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save game.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 text-xs">
      {/* Header Toolbar */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
          <div className="relative flex-1 min-w-[180px] max-w-xs">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search games..."
              className="w-full pl-8 pr-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
          </div>
          <select
            value={catFilter}
            onChange={(e) => setCatFilter(e.target.value as 'all' | GameCategoryId)}
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold"
          >
            <option value="all">All Categories ({games.length})</option>
            {GAME_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {lang === 'bn' ? c.labelBn : c.labelEn}
              </option>
            ))}
          </select>
          <select
            value={visFilter}
            onChange={(e) => setVisFilter(e.target.value as 'all' | 'visible' | 'hidden')}
            className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold"
          >
            <option value="all">All Visibility</option>
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
          </select>
        </div>

        <button
          type="button"
          onClick={() => setEditing({ isNew: true, draft: emptyGameDraft() })}
          className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Add New Game
        </button>
      </div>

      {/* Games Table */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-[#E6ECFA] dark:border-slate-800 bg-[#F8FAFF] dark:bg-slate-800/60 text-[#777777] dark:text-slate-400 uppercase text-[10px]">
                <th className="py-3 px-4 font-bold">Game</th>
                <th className="py-3 px-3 font-bold">Category</th>
                <th className="py-3 px-3 font-bold">Stats (Views / Plays / DL)</th>
                <th className="py-3 px-3 font-bold">Flags</th>
                <th className="py-3 px-4 font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
              {filteredGames.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[#777777]">
                    No games match the current filter.
                  </td>
                </tr>
              ) : (
                filteredGames.map((g) => {
                  const st = gameMeta.statsByGame[g.id] || { views: 0, plays: 0, downloads: 0 };
                  const cat = getGameCategoryMeta(g.category);
                  return (
                    <tr key={g.id} className="hover:bg-[#F8FAFF] dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-3">
                          <img
                            src={g.imageUrl || '/assets/products/prod_ff_bd_diamonds.jpg'}
                            alt={g.titleEn}
                            className="w-10 h-10 rounded-xl object-cover border border-[#E6ECFA] dark:border-slate-700 shrink-0"
                          />
                          <div className="min-w-0">
                            <p className="font-bold text-[#172033] dark:text-slate-100 truncate">
                              {lang === 'bn' ? g.titleBn : g.titleEn}
                            </p>
                            <p className="text-[10px] text-[#777777] truncate">
                              {g.developer} · {g.version || '1.0'} · {g.sizeLabel || '—'}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-bold text-[#172033] dark:text-slate-300">
                        {lang === 'bn' ? cat.labelBn : cat.labelEn}
                      </td>
                      <td className="py-2.5 px-3 font-mono-num tabular-nums">
                        <span className="font-bold">{st.views}</span> views ·{' '}
                        <span className="text-emerald-600 font-bold">{st.plays}</span> plays ·{' '}
                        <span className="text-[#FF8500] font-bold">{st.downloads}</span> dl
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {g.visible === false ? (
                            <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-600 text-[10px] font-bold">
                              Hidden
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 text-[10px] font-bold">
                              Visible
                            </span>
                          )}
                          {g.featured && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] font-bold">
                              Featured
                            </span>
                          )}
                          {g.popular && (
                            <span className="px-1.5 py-0.5 rounded bg-orange-50 text-[#FF8500] text-[10px] font-bold">
                              Popular
                            </span>
                          )}
                          {g.isNew && (
                            <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-600 text-[10px] font-bold">
                              New
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                await adminSaveGame({ ...g, visible: g.visible === false }, false);
                                onSuccess(`Game "${g.titleEn}" ${g.visible === false ? 'shown' : 'hidden'}.`);
                              } catch (err) {
                                onError(err instanceof Error ? err.message : 'Visibility update failed.');
                              }
                            }}
                            className="p-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 text-[#172033] dark:text-slate-200"
                            title={g.visible === false ? 'Show' : 'Hide'}
                          >
                            {g.visible === false ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEditing({
                                isNew: false,
                                draft: {
                                  ...g,
                                  screenshotsText: (g.screenshots || []).join('\n'),
                                },
                              })
                            }
                            className="p-1.5 rounded-lg bg-[#FFF3E5] dark:bg-orange-950/50 text-[#FF8500]"
                            title="Edit"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(g)}
                            className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/50 text-[#DC2626]"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Game Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-[#E6ECFA] dark:border-slate-800 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-[#E6ECFA] dark:border-slate-800 pb-3">
              <h3 className="text-base font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-2">
                <Gamepad2 className="w-4 h-4 text-[#FF8500]" />
                {editing.isNew ? 'Add New Game' : `Edit Game: ${editing.draft.titleEn}`}
              </h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Title (English) *</label>
                  <input
                    type="text"
                    required
                    value={editing.draft.titleEn}
                    onChange={(e) =>
                      setEditing({ ...editing, draft: { ...editing.draft, titleEn: e.target.value } })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Title (Bangla)</label>
                  <input
                    type="text"
                    value={editing.draft.titleBn}
                    onChange={(e) =>
                      setEditing({ ...editing, draft: { ...editing.draft, titleBn: e.target.value } })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Category</label>
                  <select
                    value={editing.draft.category}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        draft: { ...editing.draft, category: e.target.value as GameCategoryId },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-bold"
                  >
                    {GAME_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.labelEn}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold mb-1">Developer / Studio</label>
                  <input
                    type="text"
                    value={editing.draft.developer}
                    onChange={(e) =>
                      setEditing({ ...editing, draft: { ...editing.draft, developer: e.target.value } })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Play URL (Web / Store)</label>
                  <input
                    type="url"
                    value={editing.draft.playUrl || ''}
                    onChange={(e) =>
                      setEditing({ ...editing, draft: { ...editing.draft, playUrl: e.target.value } })
                    }
                    placeholder="https://..."
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Download URL (APK / Store)</label>
                  <input
                    type="url"
                    value={editing.draft.downloadUrl || ''}
                    onChange={(e) =>
                      setEditing({ ...editing, draft: { ...editing.draft, downloadUrl: e.target.value } })
                    }
                    placeholder="https://..."
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                </div>
                <div>
                  <label className="block font-bold mb-1">Version &amp; Size</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={editing.draft.version || ''}
                      onChange={(e) =>
                        setEditing({ ...editing, draft: { ...editing.draft, version: e.target.value } })
                      }
                      placeholder="v1.0.0"
                      className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                    />
                    <input
                      type="text"
                      value={editing.draft.sizeLabel || ''}
                      onChange={(e) =>
                        setEditing({ ...editing, draft: { ...editing.draft, sizeLabel: e.target.value } })
                      }
                      placeholder="120 MB"
                      className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                    />
                  </div>
                </div>
                <div>
                  <label className="block font-bold mb-1">Linked Top-Up Product</label>
                  <select
                    value={editing.draft.relatedProductId || ''}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        draft: { ...editing.draft, relatedProductId: e.target.value },
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  >
                    <option value="">None</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.titleEn} (৳{p.priceBdt})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold mb-1">Thumbnail Image URL (or Upload)</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editing.draft.imageUrl}
                    onChange={(e) =>
                      setEditing({ ...editing, draft: { ...editing.draft, imageUrl: e.target.value } })
                    }
                    className="flex-1 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                  />
                  <label className="px-3 py-2 rounded-xl bg-[#172033] text-white font-bold inline-flex items-center gap-1 cursor-pointer shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    {uploadingThumb ? '...' : 'Upload'}
                    <input type="file" accept="image/*" className="hidden" onChange={handleThumbUpload} />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold mb-1">Description (EN)</label>
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
                  <label className="block font-bold mb-1">Description (BN)</label>
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
                <label className="block font-bold mb-1">Screenshots URLs (one per line)</label>
                <textarea
                  rows={2}
                  value={editing.draft.screenshotsText}
                  onChange={(e) =>
                    setEditing({ ...editing, draft: { ...editing.draft, screenshotsText: e.target.value } })
                  }
                  placeholder="/assets/products/..."
                  className="w-full px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num"
                />
              </div>

              <div className="flex flex-wrap gap-3 pt-1">
                {(
                  [
                    ['visible', 'Visible on Storefront'],
                    ['featured', 'Featured'],
                    ['popular', 'Popular'],
                    ['trending', 'Trending'],
                    ['isNew', 'New Release'],
                  ] as const
                ).map(([flag, lbl]) => (
                  <label
                    key={flag}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 font-bold cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={flag === 'visible' ? editing.draft.visible !== false : Boolean(editing.draft[flag])}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          draft: { ...editing.draft, [flag]: e.target.checked },
                        })
                      }
                      className="accent-[#FF8500] w-3.5 h-3.5"
                    />
                    <span>{lbl}</span>
                  </label>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[#E6ECFA] dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="px-4 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Save className="w-3.5 h-3.5" />
                  {saving ? 'Saving...' : 'Save Game'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        lang={lang}
        title={`Delete "${deleteTarget?.titleEn}"?`}
        description="This will remove the game from the catalog and storefront."
        tone="danger"
        confirmLabel="Delete Game"
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          setDeleting(true);
          try {
            await adminDeleteGame(deleteTarget.id);
            onSuccess(`Deleted game "${deleteTarget.titleEn}".`);
            setDeleteTarget(null);
          } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to delete game.');
          } finally {
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}

// =========================================================================
// 2. UNIFIED CATEGORIES MANAGER PANEL
// =========================================================================

interface AdminUnifiedCategoriesPanelProps {
  lang: Language;
  categories?: Category[];
  products?: Product[];
  apps?: MobileAppItem[];
  games?: GameItem[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminUnifiedCategoriesPanel({
  lang,
  categories = EMPTY_CATEGORIES,
  products = EMPTY_PRODUCTS,
  apps = EMPTY_APPS,
  games = EMPTY_GAMES,
  onSuccess,
  onError,
}: AdminUnifiedCategoriesPanelProps) {
  const [tab, setTab] = useState<'services' | 'apps' | 'games'>('services');
  const [nameEn, setNameEn] = useState('');
  const [nameBn, setNameBn] = useState('');
  const [descEn, setDescEn] = useState('');
  const [saving, setSaving] = useState(false);

  const productCountsByCat = useMemo(() => {
    const map = new Map<string, number>();
    products.forEach((p) => map.set(p.categoryId, (map.get(p.categoryId) || 0) + 1));
    return map;
  }, [products]);

  const appCountsByCat = useMemo(() => {
    const map = new Map<string, number>();
    apps.forEach((a) => map.set(a.category, (map.get(a.category) || 0) + 1));
    return map;
  }, [apps]);

  const gameCountsByCat = useMemo(() => {
    const map = new Map<string, number>();
    games.forEach((g) => map.set(g.category, (map.get(g.category) || 0) + 1));
    return map;
  }, [games]);

  const handleCreateCategory = async (e: FormEvent) => {
    e.preventDefault();
    if (!nameEn.trim()) return;
    setSaving(true);
    try {
      const slug = nameEn.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await adminSaveCategory(
        {
          id: generateId('cat'),
          slug,
          type: 'service',
          nameEn: nameEn.trim(),
          nameBn: (nameBn || nameEn).trim(),
          descriptionEn: descEn.trim(),
          sortOrder: categories.length + 1,
          active: true,
        },
        true
      );
      setNameEn('');
      setNameBn('');
      setDescEn('');
      onSuccess('Category created.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create category.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 text-xs">
      <div className="flex flex-wrap gap-2">
        {(
          [
            ['services', `Digital Service Categories (${categories.length})`],
            ['apps', `App Categories (${MOBILE_APP_CATEGORIES.length})`],
            ['games', `Game Categories (${GAME_CATEGORIES.length})`],
          ] as const
        ).map(([id, lbl]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3.5 py-2 rounded-xl font-bold border ${
              tab === id
                ? 'bg-[#FF8500] text-white border-[#FF8500]'
                : 'bg-white dark:bg-slate-900 border-[#E6ECFA] dark:border-slate-800'
            }`}
          >
            {lbl}
          </button>
        ))}
      </div>

      {tab === 'services' && (
        <div className="space-y-4">
          <form
            onSubmit={handleCreateCategory}
            className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 grid grid-cols-1 sm:grid-cols-4 gap-2"
          >
            <input
              type="text"
              required
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="Category Name (EN) *"
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
            <input
              type="text"
              value={nameBn}
              onChange={(e) => setNameBn(e.target.value)}
              placeholder="Category Name (BN)"
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
            <input
              type="text"
              value={descEn}
              onChange={(e) => setDescEn(e.target.value)}
              placeholder="Short description..."
              className="px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
            />
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Category
            </button>
          </form>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {categories.map((c) => {
              const count = productCountsByCat.get(c.id) || 0;
              return (
                <div
                  key={c.id}
                  className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-extrabold text-[#172033] dark:text-slate-100 truncate">
                      <FolderTree className="w-3.5 h-3.5 inline mr-1.5 text-[#FF8500]" />
                      {lang === 'bn' ? c.nameBn : c.nameEn}
                    </p>
                    <p className="text-[11px] font-mono-num text-[#777777] mt-0.5">
                      {count} item(s) · /{c.slug} · {c.active ? 'Active' : 'Hidden'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={async () => {
                        await adminSaveCategory({ ...c, active: !c.active }, false);
                        onSuccess(`Category "${c.nameEn}" ${!c.active ? 'enabled' : 'hidden'}.`);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 font-bold"
                    >
                      {c.active ? 'Hide' : 'Show'}
                    </button>
                    <button
                      type="button"
                      disabled={count > 0}
                      title={count > 0 ? `${count} attached item(s) — reassign before deleting` : 'Delete category'}
                      onClick={async () => {
                        await adminDeleteCategory(c.id);
                        onSuccess(`Deleted category "${c.nameEn}".`);
                      }}
                      className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/50 text-[#DC2626] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'apps' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {MOBILE_APP_CATEGORIES.map((cat) => (
            <div
              key={cat.id}
              className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex items-center justify-between gap-2"
            >
              <div>
                <p className="font-extrabold text-[#172033] dark:text-slate-100">
                  {lang === 'bn' ? cat.labelBn : cat.labelEn}
                </p>
                <p className="text-[11px] font-mono-num text-[#777777]">ID: {cat.id}</p>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-[#FFF3E5] dark:bg-orange-950/40 text-[#FF8500] font-mono-num font-extrabold">
                {appCountsByCat.get(cat.id) || 0} apps
              </span>
            </div>
          ))}
        </div>
      )}

      {tab === 'games' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {GAME_CATEGORIES.map((cat) => (
            <div
              key={cat.id}
              className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 flex items-center justify-between gap-2"
            >
              <div>
                <p className="font-extrabold text-[#172033] dark:text-slate-100">
                  {lang === 'bn' ? cat.labelBn : cat.labelEn}
                </p>
                <p className="text-[11px] font-mono-num text-[#777777]">ID: {cat.id}</p>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-violet-50 dark:bg-violet-950/40 text-violet-600 dark:text-violet-300 font-mono-num font-extrabold">
                {gameCountsByCat.get(cat.id) || 0} games
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// 3. HOMEPAGE SECTION & THEME EDITOR PANEL
// =========================================================================

interface AdminHomepageEditorPanelProps {
  lang: Language;
  settings: SiteSettings;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminHomepageEditorPanel({
  lang,
  settings,
  onSuccess,
  onError,
}: AdminHomepageEditorPanelProps) {
  const [sections, setSections] = useState<HomepageSectionConfig[]>(() =>
    (settings.homepageSections && settings.homepageSections.length > 0
      ? settings.homepageSections
      : DEFAULT_HOMEPAGE_SECTIONS
    )
      .slice()
      .sort((a, b) => a.order - b.order)
  );
  const [accentColor, setAccentColor] = useState(settings.accentColor || '#FF8500');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const incoming =
      settings.homepageSections && settings.homepageSections.length > 0
        ? settings.homepageSections
        : DEFAULT_HOMEPAGE_SECTIONS;
    setSections(incoming.slice().sort((a, b) => a.order - b.order));
    setAccentColor(settings.accentColor || '#FF8500');
  }, [settings]);

  const moveSection = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= sections.length) return;
    const next = sections.slice();
    const tmp = next[idx];
    next[idx] = next[target];
    next[target] = tmp;
    setSections(next.map((s, i) => ({ ...s, order: i + 1 })));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await adminSaveSiteSettings({
        ...settings,
        accentColor,
        homepageSections: sections.map((s, i) => ({ ...s, order: i + 1 })),
      });
      onSuccess(
        lang === 'bn'
          ? 'হোমপেজ লেআউট ও থিম অ্যাকসেন্ট সেভ হয়েছে।'
          : 'Homepage sections & accent theme saved live.'
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save homepage layout.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5 text-xs">
      {/* Theme Accent Bar */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#FF8500]" />
            Storefront Brand Accent Color
          </h3>
          <p className="text-[#777777]">Controls gradients, buttons, and highlight tokens across Digital Hub BD.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map((hex) => (
            <button
              key={hex}
              type="button"
              onClick={() => setAccentColor(hex)}
              className={`w-7 h-7 rounded-full border-2 ${
                accentColor.toUpperCase() === hex.toUpperCase()
                  ? 'border-[#172033] dark:border-white scale-110'
                  : 'border-transparent'
              }`}
              style={{ backgroundColor: hex }}
              aria-label={`Select color ${hex}`}
            />
          ))}
          <input
            type="color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
          />
          <input
            type="text"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            className="w-24 px-2.5 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num uppercase"
          />
        </div>
      </div>

      {/* Section Ordering & Visibility */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 overflow-hidden">
        <div className="p-4 border-b border-[#E6ECFA] dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-[#FF8500]" />
            Homepage Sections Order &amp; Visibility ({sections.filter((s) => s.visible).length}/{sections.length} visible)
          </h3>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSections(DEFAULT_HOMEPAGE_SECTIONS.map((s) => ({ ...s })))}
              className="px-3 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 font-bold inline-flex items-center gap-1"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset Defaults
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="px-4 py-1.5 rounded-xl dh-orange-gradient text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              {saving ? 'Saving...' : 'Save Layout'}
            </button>
          </div>
        </div>

        <div className="divide-y divide-[#E6ECFA] dark:divide-slate-800">
          {sections.map((sec, idx) => (
            <div
              key={sec.id}
              className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-[#F8FAFF] dark:hover:bg-slate-800/40"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-6 h-6 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 font-mono-num font-bold text-center leading-6 shrink-0">
                  {idx + 1}
                </span>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sec.visible}
                    onChange={(e) => {
                      const next = sections.slice();
                      next[idx] = { ...sec, visible: e.target.checked };
                      setSections(next);
                    }}
                    className="accent-[#FF8500] w-4 h-4"
                  />
                  <span className={`font-bold ${sec.visible ? 'text-[#172033] dark:text-slate-100' : 'text-slate-400 line-through'}`}>
                    {lang === 'bn' ? sec.labelBn : sec.labelEn}
                  </span>
                </label>
                <span className="text-[10px] font-mono-num text-[#777777]">({sec.id})</span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {typeof sec.limit === 'number' && (
                  <label className="inline-flex items-center gap-1 text-[11px] font-bold text-[#777777]">
                    Limit:
                    <input
                      type="number"
                      min={1}
                      max={40}
                      value={sec.limit}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(40, Number(e.target.value) || 4));
                        const next = sections.slice();
                        next[idx] = { ...sec, limit: val };
                        setSections(next);
                      }}
                      className="w-14 px-2 py-1 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 font-mono-num text-center"
                    />
                  </label>
                )}
                <button
                  type="button"
                  disabled={idx === 0}
                  onClick={() => moveSection(idx, -1)}
                  className="p-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 disabled:opacity-30"
                  title="Move up"
                >
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  disabled={idx === sections.length - 1}
                  onClick={() => moveSection(idx, 1)}
                  className="p-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 disabled:opacity-30"
                  title="Move down"
                >
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// 4. DEDICATED SUPPORT CENTER PANEL (TICKETS + BROKEN LINK REPORTS)
// =========================================================================

interface AdminSupportCenterPanelProps {
  lang: Language;
  tickets?: SupportTicket[];
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export function AdminSupportCenterPanel({
  lang,
  tickets = EMPTY_TICKETS,
  onSuccess,
  onError,
}: AdminSupportCenterPanelProps) {
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [replies, setReplies] = useState<Record<string, string>>({});
  const [reports, setReports] = useState<AppBrokenReport[]>([]);
  const [resolvingId, setResolvingId] = useState('');

  useEffect(() => {
    adminFetchAppReports().then(setReports).catch(() => {});
  }, []);

  const filteredTickets = useMemo(() => {
    return tickets.filter((tk) => {
      if (statusFilter === 'open') return tk.status === 'open' || tk.status === 'in_progress';
      if (statusFilter === 'resolved') return tk.status === 'resolved' || tk.status === 'closed';
      return true;
    });
  }, [tickets, statusFilter]);

  const openReports = reports.filter((r) => r.status !== 'resolved');

  return (
    <div className="space-y-5 text-xs">
      {/* Broken Link Reports Alert Section */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-3">
        <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-2">
          <Flag className="w-4 h-4 text-[#DC2626]" />
          Broken App Link Reports ({openReports.length} open / {reports.length} total)
        </h3>
        {reports.length === 0 ? (
          <p className="text-[#777777] py-2">No broken link reports submitted.</p>
        ) : (
          <div className="space-y-2">
            {reports.slice(0, 15).map((r) => (
              <div
                key={r.id}
                className="p-3 rounded-xl bg-[#F8FAFF] dark:bg-slate-800/60 border border-[#E6ECFA] dark:border-slate-700 flex flex-wrap items-center justify-between gap-2"
              >
                <div>
                  <p className="font-bold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-[#FF8500]" />
                    {r.appName} ({r.appId})
                  </p>
                  <p className="text-[11px] text-[#777777]">
                    {r.reason} · {formatDateShort(r.createdAt, lang)}
                  </p>
                </div>
                {r.status === 'resolved' ? (
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Resolved
                  </span>
                ) : (
                  <button
                    type="button"
                    disabled={resolvingId === r.id}
                    onClick={async () => {
                      setResolvingId(r.id);
                      try {
                        await adminResolveAppReport(r.id);
                        setReports((prev) =>
                          prev.map((item) => (item.id === r.id ? { ...item, status: 'resolved' } : item))
                        );
                        onSuccess(`Marked report for "${r.appName}" resolved.`);
                      } catch (err) {
                        onError(err instanceof Error ? err.message : 'Failed to resolve report.');
                      } finally {
                        setResolvingId('');
                      }
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold disabled:opacity-50"
                  >
                    Mark Resolved
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Customer Support Tickets */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-100 flex items-center gap-2">
            <LifeBuoy className="w-4 h-4 text-[#FF8500]" />
            Customer Support Tickets ({tickets.length})
          </h3>
          <div className="flex gap-1.5">
            {(
              [
                ['all', 'All'],
                ['open', 'Open'],
                ['resolved', 'Resolved'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setStatusFilter(k)}
                className={`px-3 py-1 rounded-xl font-bold ${
                  statusFilter === k
                    ? 'bg-[#FF8500] text-white'
                    : 'bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        {filteredTickets.length === 0 ? (
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-8 text-center text-[#777777]">
            No support tickets match the selected status.
          </div>
        ) : (
          filteredTickets.map((tk) => (
            <div
              key={tk.id}
              className="rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 p-4 space-y-2.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-bold text-[#172033] dark:text-slate-100 flex items-center gap-1.5">
                    <MessageSquare className="w-3.5 h-3.5 text-[#FF8500]" />
                    {tk.subject}
                  </p>
                  {tk.category && (
                    <span className="px-2 py-0.5 rounded-md bg-[#FFF3E5] dark:bg-orange-950/40 text-[#FF8500] font-bold uppercase text-[10px]">
                      {tk.category}
                    </span>
                  )}
                  {tk.orderNumber && (
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-mono-num text-[10px]">
                      #{tk.orderNumber}
                    </span>
                  )}
                </div>
                <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 font-bold uppercase text-[10px]">
                  {tk.status}
                </span>
              </div>

              <p className="text-[#777777] dark:text-slate-300">{tk.message}</p>
              <p className="text-[10px] font-mono-num text-[#777777]">
                From: {tk.userEmail || tk.userId} · {formatDateShort(tk.createdAt, lang)}
              </p>

              {tk.screenshotDataUrl && (
                <a
                  href={tk.screenshotDataUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block rounded-xl overflow-hidden border border-[#E6ECFA] dark:border-slate-700"
                >
                  <img
                    src={tk.screenshotDataUrl}
                    alt="Ticket attachment"
                    className="max-h-36 w-auto object-contain bg-slate-50 dark:bg-slate-950"
                  />
                </a>
              )}

              <div className="flex flex-wrap gap-2 pt-1">
                <input
                  type="text"
                  value={replies[tk.id] ?? tk.adminReply ?? ''}
                  onChange={(e) => setReplies({ ...replies, [tk.id]: e.target.value })}
                  placeholder="Write support reply..."
                  className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700"
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await adminReplyTicket(tk, 'resolved', replies[tk.id] || 'Resolved by support');
                      onSuccess(`Replied & resolved ticket "${tk.subject}".`);
                    } catch (err) {
                      onError(err instanceof Error ? err.message : 'Failed to reply.');
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold"
                >
                  Reply &amp; Resolve
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
