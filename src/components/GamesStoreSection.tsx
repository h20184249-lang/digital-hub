import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Download,
  ExternalLink,
  Eye,
  Flame,
  Gamepad2,
  Play,
  Search,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import type {
  GameCategoryId,
  GameItem,
  GameMetaPayload,
  Language,
  Product,
} from '../types/marketplace';
import {
  DEFAULT_GAMES_CATALOG,
  GAME_CATEGORIES,
  getGameCategoryMeta,
} from '../lib/gamesCatalog';
import {
  fetchGameMeta,
  trackContentView,
  trackDownloadClick,
  trackExternalLinkClick,
  trackPlayClick,
  trackSearchQuery,
} from '../lib/firestoreService';

interface GamesStoreSectionProps {
  mode: 'home' | 'page';
  lang: Language;
  games?: GameItem[];
  products: Product[];
  maxHomeItems?: number;
  onSelectProduct?: (product: Product) => void;
  onNavigateAll?: () => void;
  onBackHome?: () => void;
}

const EMPTY_GAMES: GameItem[] = [];

export function GamesStoreSection({
  mode,
  lang,
  games = EMPTY_GAMES,
  products,
  maxHomeItems = 8,
  onSelectProduct,
  onNavigateAll,
  onBackHome,
}: GamesStoreSectionProps) {
  const catalogGames = useMemo(
    () => (games.length > 0 ? games : [...DEFAULT_GAMES_CATALOG]),
    [games]
  );

  const [gameMeta, setGameMeta] = useState<GameMetaPayload>({ statsByGame: {} });
  const [selectedCategory, setSelectedCategory] = useState<'all' | GameCategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [detailsGame, setDetailsGame] = useState<GameItem | null>(null);
  const [activeShot, setActiveShot] = useState('');
  const searchTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    fetchGameMeta()
      .then((m) => {
        if (active) setGameMeta(m);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) return;
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      trackSearchQuery(q, 'games');
    }, 650);
    return () => {
      if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: catalogGames.length };
    for (const g of catalogGames) {
      counts[g.category] = (counts[g.category] || 0) + 1;
      if (g.popular && g.category !== 'popular_games') {
        counts.popular_games = (counts.popular_games || 0) + 1;
      }
      if (g.isNew && g.category !== 'new_games') {
        counts.new_games = (counts.new_games || 0) + 1;
      }
    }
    return counts;
  }, [catalogGames]);

  const filteredGames = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return catalogGames.filter((g) => {
      if (selectedCategory !== 'all') {
        if (selectedCategory === 'popular_games') {
          if (g.category !== 'popular_games' && !g.popular) return false;
        } else if (selectedCategory === 'new_games') {
          if (g.category !== 'new_games' && !g.isNew) return false;
        } else if (g.category !== selectedCategory) {
          return false;
        }
      }
      if (!q) return true;
      const cat = getGameCategoryMeta(g.category);
      const hay = [
        g.titleEn,
        g.titleBn,
        g.developer,
        g.shortDescEn,
        g.shortDescBn,
        cat.labelEn,
        cat.labelBn,
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [catalogGames, selectedCategory, searchQuery]);

  const visibleGames =
    mode === 'home' && selectedCategory === 'all' && !searchQuery.trim()
      ? filteredGames.slice(0, Math.max(4, maxHomeItems))
      : filteredGames;

  const openDetails = (game: GameItem) => {
    setDetailsGame(game);
    setActiveShot(game.screenshots?.[0] || game.imageUrl);
    trackContentView({
      contentId: game.id,
      contentType: 'game',
      contentCategory: game.category,
      pagePath: mode === 'page' ? '/games' : '/',
    });
    setGameMeta((prev) => {
      const cur = prev.statsByGame[game.id] || { views: 0, plays: 0, downloads: 0 };
      return {
        statsByGame: {
          ...prev.statsByGame,
          [game.id]: { ...cur, views: cur.views + 1 },
        },
      };
    });
  };

  const handlePlayAction = (game: GameItem) => {
    trackPlayClick({
      contentId: game.id,
      contentCategory: game.category,
      pagePath: mode === 'page' ? '/games' : '/',
    });
    if (game.playUrl) {
      trackExternalLinkClick({
        contentId: game.id,
        contentType: 'game',
        targetUrl: game.playUrl,
        pagePath: mode === 'page' ? '/games' : '/',
      });
    }
    setGameMeta((prev) => {
      const cur = prev.statsByGame[game.id] || { views: 0, plays: 0, downloads: 0 };
      return {
        statsByGame: {
          ...prev.statsByGame,
          [game.id]: { ...cur, plays: cur.plays + 1 },
        },
      };
    });
  };

  const handleDownloadAction = (game: GameItem) => {
    trackDownloadClick({
      contentId: game.id,
      contentType: 'game',
      contentCategory: game.category,
      pagePath: mode === 'page' ? '/games' : '/',
    });
    if (game.downloadUrl || game.playUrl) {
      trackExternalLinkClick({
        contentId: game.id,
        contentType: 'game',
        targetUrl: game.downloadUrl || game.playUrl || '',
        pagePath: mode === 'page' ? '/games' : '/',
      });
    }
    setGameMeta((prev) => {
      const cur = prev.statsByGame[game.id] || { views: 0, plays: 0, downloads: 0 };
      return {
        statsByGame: {
          ...prev.statsByGame,
          [game.id]: { ...cur, downloads: cur.downloads + 1 },
        },
      };
    });
  };

  const findRelatedProduct = (game: GameItem | null): Product | undefined => {
    if (!game?.relatedProductId) return undefined;
    return products.find((p) => p.id === game.relatedProductId && p.active);
  };

  const wrapperClass =
    mode === 'page'
      ? 'max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-5 sm:py-8 space-y-6'
      : 'space-y-4';

  return (
    <section aria-label="Games Hub" className={wrapperClass}>
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="space-y-1.5 min-w-0">
          {mode === 'page' && onBackHome && (
            <button
              type="button"
              onClick={onBackHome}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-[#64748B] dark:text-slate-400 hover:text-[#FF8500] transition-colors mb-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{lang === 'bn' ? 'হোম পেজে ফিরুন' : 'Back to Home'}</span>
            </button>
          )}
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl dh-orange-gradient text-white flex items-center justify-center shrink-0 shadow-xs">
              <Gamepad2 className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xl sm:text-2xl font-extrabold text-[#172033] dark:text-slate-50 tracking-tight leading-tight">
                {lang === 'bn' ? 'গেমস হাব ও প্লে স্টোর' : 'Games Hub & Mobile Play Store'}
              </h2>
              <p className="text-xs sm:text-sm text-[#64748B] dark:text-slate-400 mt-0.5 flex flex-wrap items-center gap-x-2">
                <span>{lang === 'bn' ? 'অফিশিয়াল অ্যান্ড্রয়েড, অনলাইন ও জনপ্রিয় গেমস' : 'Official Android, Online & Casual Games'}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-num tabular-nums">
                  {catalogGames.length} {lang === 'bn' ? 'টি গেম' : 'Games'}
                </span>
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-4 h-4 text-[#64748B] dark:text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={lang === 'bn' ? 'গেম খুঁজুন (Free Fire, PUBG)...' : 'Search games (Free Fire, eFootball)...'}
              className="w-full pl-10 pr-8 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-700 text-xs sm:text-sm text-[#172033] dark:text-slate-100 focus:outline-none focus:border-[#FF8500]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {mode === 'home' && onNavigateAll && (
            <button
              type="button"
              onClick={onNavigateAll}
              className="min-h-[42px] px-4 py-2 rounded-xl bg-[#172033] dark:bg-slate-800 hover:bg-[#FF8500] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer"
            >
              <span>{lang === 'bn' ? `সব ${catalogGames.length}টি গেম` : `All ${catalogGames.length} Games`}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Category Filter Strip */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
        <button
          type="button"
          onClick={() => setSelectedCategory('all')}
          className={`min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
            selectedCategory === 'all'
              ? 'bg-[#FF8500] text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-800 text-[#475569] dark:text-slate-300 hover:border-[#FF8500]'
          }`}
        >
          {lang === 'bn' ? 'সব গেমস' : 'All Games'}{' '}
          <span className="font-mono-num tabular-nums opacity-85">({categoryCounts.all || 0})</span>
        </button>

        {GAME_CATEGORIES.map((cat) => {
          const active = selectedCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={`min-h-[38px] px-3.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                active
                  ? 'bg-[#FF8500] text-white shadow-xs'
                  : 'bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-800 text-[#475569] dark:text-slate-300 hover:border-[#FF8500]'
              }`}
            >
              {lang === 'bn' ? cat.labelBn : cat.labelEn}{' '}
              <span className="font-mono-num tabular-nums opacity-85">({categoryCounts[cat.id] || 0})</span>
            </button>
          );
        })}
      </div>

      {/* Games Grid */}
      {visibleGames.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-800 p-8 text-center space-y-3">
          <p className="text-sm font-bold text-[#172033] dark:text-slate-100">
            {lang === 'bn' ? 'কোনো গেম পাওয়া যায়নি।' : 'No matching games found.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setSelectedCategory('all');
              setSearchQuery('');
            }}
            className="px-4 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold"
          >
            {lang === 'bn' ? 'ফিল্টার রিসেট' : 'Reset Filters'}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5 sm:gap-4">
          {visibleGames.map((game) => {
            const catMeta = getGameCategoryMeta(game.category);
            const stats = gameMeta.statsByGame[game.id];
            const relatedProduct = findRelatedProduct(game);
            return (
              <article
                key={game.id}
                className="group rounded-2xl bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-800 overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_28px_rgba(23,32,51,0.08)]"
              >
                <button
                  type="button"
                  onClick={() => openDetails(game)}
                  className="relative aspect-[16/10] w-full overflow-hidden bg-[#0F172A] block text-left cursor-pointer"
                >
                  <img
                    src={game.imageUrl}
                    alt={lang === 'bn' ? game.titleBn : game.titleEn}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0F172A]/85 via-transparent to-transparent" />
                  {(game.isNew || game.trending || game.popular) && (
                    <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-[#FF8500] text-white text-[10px] font-extrabold uppercase tracking-wider inline-flex items-center gap-1">
                      {game.isNew ? (
                        <>
                          <Sparkles className="w-2.5 h-2.5" /> New
                        </>
                      ) : game.trending ? (
                        <>
                          <TrendingUp className="w-2.5 h-2.5" /> Trending
                        </>
                      ) : (
                        <>
                          <Flame className="w-2.5 h-2.5" /> Popular
                        </>
                      )}
                    </span>
                  )}
                  <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-[10px] font-mono-num text-white/90">
                    <span>{game.sizeLabel || 'Android'}</span>
                    {stats && (stats.views > 0 || stats.plays > 0) && (
                      <span className="inline-flex items-center gap-2">
                        {stats.views > 0 && (
                          <span className="inline-flex items-center gap-0.5">
                            <Eye className="w-3 h-3" /> {stats.views}
                          </span>
                        )}
                        {stats.plays > 0 && (
                          <span className="inline-flex items-center gap-0.5">
                            <Play className="w-3 h-3" /> {stats.plays}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </button>

                <div className="p-3.5 flex-1 flex flex-col justify-between gap-2.5">
                  <div className="space-y-1">
                    <h3 className="text-sm font-extrabold text-[#172033] dark:text-slate-50 leading-snug line-clamp-1">
                      {lang === 'bn' ? game.titleBn : game.titleEn}
                    </h3>
                    <p className="text-[11px] font-medium text-[#64748B] dark:text-slate-400 truncate">
                      {lang === 'bn' ? catMeta.labelBn : catMeta.labelEn} · {game.developer}
                    </p>
                    <p className="text-[11px] text-[#5C6B84] dark:text-slate-300 line-clamp-2 leading-relaxed">
                      {lang === 'bn' ? game.shortDescBn : game.shortDescEn}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-[#EDF2FA] dark:border-slate-800 space-y-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => openDetails(game)}
                        className="min-h-[36px] px-2.5 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E2E9F7] dark:border-slate-700 text-[#172033] dark:text-slate-100 text-[11px] font-bold hover:border-[#FF8500] cursor-pointer"
                      >
                        {lang === 'bn' ? 'বিস্তারিত' : 'Details'}
                      </button>
                      <a
                        href={game.playUrl || game.downloadUrl || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => handlePlayAction(game)}
                        className="min-h-[36px] px-2.5 py-1.5 rounded-xl dh-orange-gradient text-white text-[11px] font-extrabold inline-flex items-center justify-center gap-1 hover:opacity-95"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>{lang === 'bn' ? 'খেলুন / ডাউনলোড' : 'Play / Get'}</span>
                      </a>
                    </div>
                    {relatedProduct && onSelectProduct && (
                      <button
                        type="button"
                        onClick={() => onSelectProduct(relatedProduct)}
                        className="w-full py-1.5 px-2.5 rounded-xl bg-[#FFF7EE] dark:bg-orange-950/30 border border-[#FF8500]/30 text-[#FF8500] text-[11px] font-bold inline-flex items-center justify-center gap-1 hover:bg-[#FF8500] hover:text-white transition-colors cursor-pointer"
                      >
                        <Zap className="w-3 h-3" />
                        <span>
                          {lang === 'bn' ? 'ডায়মন্ড / টপ-আপ কিনুন' : 'Buy Top-Up'} (৳{relatedProduct.priceBdt})
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Game Details Modal */}
      {detailsGame && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-[#0F172A]/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
          onClick={() => setDetailsGame(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl border border-[#E2E9F7] dark:border-slate-800 shadow-2xl max-h-[90vh] flex flex-col overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-[#EDF2FA] dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base sm:text-lg font-extrabold text-[#172033] dark:text-slate-50 truncate">
                  {lang === 'bn' ? detailsGame.titleBn : detailsGame.titleEn}
                </h3>
                <p className="text-xs text-[#64748B] dark:text-slate-400 truncate">
                  {detailsGame.developer} · {lang === 'bn' ? getGameCategoryMeta(detailsGame.category).labelBn : getGameCategoryMeta(detailsGame.category).labelEn}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailsGame(null)}
                className="p-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 text-[#64748B] hover:text-[#172033] dark:hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="rounded-2xl overflow-hidden border border-[#E2E9F7] dark:border-slate-800 bg-[#0F172A] h-56 sm:h-68">
                <img
                  src={activeShot || detailsGame.imageUrl}
                  alt={detailsGame.titleEn}
                  className="w-full h-full object-cover"
                />
              </div>

              {detailsGame.screenshots && detailsGame.screenshots.length > 1 && (
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {detailsGame.screenshots.map((shot, idx) => (
                    <button
                      key={shot + idx}
                      type="button"
                      onClick={() => setActiveShot(shot)}
                      className={`w-16 h-11 rounded-lg overflow-hidden border-2 shrink-0 ${
                        activeShot === shot ? 'border-[#FF8500]' : 'border-transparent opacity-70'
                      }`}
                    >
                      <img src={shot} alt="" className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-4 p-3 rounded-2xl bg-[#F8FAFF] dark:bg-slate-800/70 border border-[#E2E9F7] dark:border-slate-700 text-xs font-mono-num">
                <span>v{detailsGame.version || '1.0'}</span>
                <span>{detailsGame.sizeLabel || 'Mobile'}</span>
                <span className="inline-flex items-center gap-1 text-[#64748B] dark:text-slate-300">
                  <Eye className="w-3.5 h-3.5 text-[#FF8500]" />
                  {gameMeta.statsByGame[detailsGame.id]?.views || 0} {lang === 'bn' ? 'ভিউ' : 'views'}
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                  <Play className="w-3.5 h-3.5" />
                  {gameMeta.statsByGame[detailsGame.id]?.plays || 0} {lang === 'bn' ? 'প্লে ক্লিক' : 'play clicks'}
                </span>
                <span className="inline-flex items-center gap-1 text-[#0EA5E9] font-bold">
                  <Download className="w-3.5 h-3.5" />
                  {gameMeta.statsByGame[detailsGame.id]?.downloads || 0} {lang === 'bn' ? 'ডাউনলোড ক্লিক' : 'download clicks'}
                </span>
              </div>

              <p className="text-sm text-[#334155] dark:text-slate-200 leading-relaxed">
                {lang === 'bn' ? detailsGame.shortDescBn : detailsGame.shortDescEn}
              </p>

              <div className="flex flex-wrap items-center gap-2.5 pt-2">
                {detailsGame.playUrl && (
                  <a
                    href={detailsGame.playUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handlePlayAction(detailsGame)}
                    className="px-4 py-2.5 rounded-xl dh-orange-gradient text-white text-xs font-extrabold inline-flex items-center gap-1.5 shadow-sm"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>{lang === 'bn' ? 'এখনই খেলুন / প্লে স্টোর' : 'Play / Open Official Game'}</span>
                  </a>
                )}
                {detailsGame.downloadUrl && (
                  <a
                    href={detailsGame.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleDownloadAction(detailsGame)}
                    className="px-4 py-2.5 rounded-xl bg-[#16A34A] hover:bg-[#15803D] text-white text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <Download className="w-4 h-4" />
                    <span>{lang === 'bn' ? 'ডাউনলোড লিংক' : 'Download Link'}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                {(() => {
                  const related = findRelatedProduct(detailsGame);
                  if (!related || !onSelectProduct) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => {
                        setDetailsGame(null);
                        onSelectProduct(related);
                      }}
                      className="px-4 py-2.5 rounded-xl bg-[#172033] dark:bg-slate-800 text-white text-xs font-bold inline-flex items-center gap-1.5 hover:bg-[#FF8500] cursor-pointer"
                    >
                      <Zap className="w-4 h-4 text-[#FF8500]" />
                      <span>
                        {lang === 'bn' ? 'গেম টপ-আপ অর্ডার করুন' : 'Order Game Top-Up'} · ৳{related.priceBdt}
                      </span>
                    </button>
                  );
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
