import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Headphones,
  Mail,
  MessageCircle,
  Phone,
  Search,
  Send,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Tag,
} from 'lucide-react';
import {
  AdNetworkConfig,
  Advertisement,
  AppRoute,
  Banner,
  Category,
  Coupon,
  Language,
  Product,
  SiteSettings,
} from '../types/marketplace';
import { t } from '../lib/i18n';
import {
  CATALOG_23_CATEGORIES,
  CATALOG_23_MAP,
  formatBdt,
  getDisplayStartingPrice,
  getEffectiveProductAvailability,
  getProductCatalogSectionId,
  hasGenuineDiscount,
} from '../lib/catalogHelpers';
import { ProductVisualArtwork } from './BrandLogos';
import { BannerSlotView } from './BannerSlotView';
import { NativeAdRow } from './AutomaticAdEngine';

const EMPTY_ADVERTISEMENTS: Advertisement[] = [];
const EMPTY_AD_NETWORKS: AdNetworkConfig[] = [];
const EMPTY_BANNERS: Banner[] = [];

interface ProductCardProps {
  product: Product;
  lang: Language;
  onSelect: (p: Product) => void;
  onQuickOrder?: (p: Product) => void;
  onAddToCart: (p: Product) => void;
}

export function ProductCard({
  product,
  lang,
  onSelect,
  onQuickOrder,
  onAddToCart,
}: ProductCardProps) {
  const title = lang === 'bn' ? product.titleBn : product.titleEn;
  const delivery = lang === 'bn' ? product.deliveryDurationBn : product.deliveryDurationEn;
  const subcategory = lang === 'bn' ? product.subcategoryBn : product.subcategoryEn;

  const pkgCount = product.packages?.length || 0;
  const effectiveAvail = getEffectiveProductAvailability(product);
  const stockCount =
    typeof product.stockCount === 'number'
      ? Math.max(0, Math.floor(product.stockCount))
      : effectiveAvail === 'out_of_stock'
        ? 0
        : effectiveAvail === 'limited'
          ? 14
          : 85;
  const isOutOfStock = effectiveAvail === 'out_of_stock' || stockCount <= 0;
  const displayPrice = getDisplayStartingPrice(product);
  const showCompareAt = hasGenuineDiscount(displayPrice, product.originalPriceBdt);
  const autoDiscount =
    showCompareAt && product.originalPriceBdt
      ? Math.min(
          95,
          Math.max(1, Math.round(((product.originalPriceBdt - displayPrice) / product.originalPriceBdt) * 100))
        )
      : 0;
  const durationLabel =
    lang === 'bn'
      ? product.durationLabelBn || product.validityBn || ''
      : product.durationLabelEn || product.validityEn || '';
  const badgeText = product.badge?.trim() || (product.featured ? (lang === 'bn' ? 'জনপ্রিয়' : 'Popular') : '');

  return (
    <div
      className={`dh-card dh-card-hover rounded-2xl overflow-hidden flex flex-col bg-white group ${
        isOutOfStock ? 'opacity-85' : ''
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(product)}
        className="relative aspect-[16/10] w-full overflow-hidden bg-[#172033] text-left focus:outline-none"
      >
        <ProductVisualArtwork product={product} lang={lang} variant="card" />

        {badgeText && !isOutOfStock && (
          <span
            className={`absolute ${
              product.customLogoUrl ? 'bottom-2 left-2' : 'top-2 left-2'
            } px-2 py-0.5 rounded-lg bg-[#FF8500] text-white text-[10px] font-extrabold uppercase tracking-wide shadow-xs`}
          >
            {badgeText}
          </span>
        )}

        {isOutOfStock ? (
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-[#DC2626] text-white text-[10px] font-extrabold uppercase tracking-wide shadow-xs">
            {t(lang, 'outOfStock')}
          </span>
        ) : autoDiscount > 0 ? (
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-[#DC2626] text-white text-[11px] font-extrabold font-mono-num shadow-xs">
            -{autoDiscount}%
          </span>
        ) : effectiveAvail === 'limited' ? (
          <span className="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-[#172033]/90 text-[#FF9B19] text-[10px] font-bold">
            {t(lang, 'limited')}
          </span>
        ) : null}
      </button>

      <div className="p-3 sm:p-3.5 flex-1 flex flex-col justify-between gap-2 text-center">
        <div>
          {(subcategory || pkgCount > 1) && (
            <p className="text-[10px] font-bold text-[#777777] uppercase tracking-wide truncate mb-0.5">
              {subcategory}
              {subcategory && pkgCount > 1 ? ' · ' : ''}
              {pkgCount > 1 ? (
                <span className="text-[#FF8500] font-mono-num">
                  {pkgCount} {t(lang, 'packagesAvailable')}
                </span>
              ) : null}
            </p>
          )}

          <button
            type="button"
            onClick={() => onSelect(product)}
            className="text-xs sm:text-sm font-bold text-[#172033] hover:text-[#FF8500] line-clamp-2 leading-snug"
          >
            {title}
          </button>
          <p className="text-[11px] text-[#777777] mt-0.5 truncate">
            {durationLabel || delivery}
            {' · '}
            <span
              className={`font-mono-num font-semibold ${
                isOutOfStock
                  ? 'text-[#DC2626]'
                  : effectiveAvail === 'limited'
                    ? 'text-[#FF8500]'
                    : 'text-[#059669]'
              }`}
            >
              {isOutOfStock
                ? t(lang, 'outOfStock')
                : effectiveAvail === 'limited'
                  ? t(lang, 'limited')
                  : lang === 'bn'
                    ? 'স্টকে আছে'
                    : 'In Stock'}
            </span>
          </p>
        </div>

        <div className="space-y-2 pt-0.5">
          <div className="flex items-baseline justify-center gap-1.5">
            {pkgCount > 1 && (
              <span className="text-[10px] font-semibold text-[#777777]">
                {t(lang, 'startingFrom')}
              </span>
            )}
            {showCompareAt && product.originalPriceBdt && (
              <span className="text-xs font-mono-num text-[#777777] line-through">
                {formatBdt(product.originalPriceBdt)}
              </span>
            )}
            <span className="text-base sm:text-lg font-extrabold font-mono-num text-[#FF8500]">
              {formatBdt(displayPrice)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={isOutOfStock}
              onClick={() => (onQuickOrder ? onQuickOrder(product) : onSelect(product))}
              className="flex-1 py-2 px-2.5 rounded-xl dh-orange-gradient text-white text-xs font-bold flex items-center justify-center gap-1 shadow-xs hover:opacity-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="truncate">
                {isOutOfStock
                  ? t(lang, 'outOfStock')
                  : pkgCount > 1
                    ? t(lang, 'orderNow')
                    : t(lang, 'buyNow')}
              </span>
            </button>
            <button
              type="button"
              disabled={isOutOfStock}
              onClick={() => onAddToCart(product)}
              title={isOutOfStock ? t(lang, 'outOfStock') : t(lang, 'addToCart')}
              aria-label={isOutOfStock ? t(lang, 'outOfStock') : t(lang, 'addToCart')}
              className="p-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-[#172033] hover:border-[#FF8500] hover:text-[#FF8500] disabled:opacity-45 disabled:cursor-not-allowed shrink-0"
            >
              <ShoppingCart className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CategoryCatalogPage({
  route,
  categories,
  products,
  banners,
  advertisements = EMPTY_ADVERTISEMENTS,
  adNetworks = EMPTY_AD_NETWORKS,
  settings,
  lang,
  initialSearch = '',
  initialCatalogSection = '',
  onSelectCatalogSection,
  onSelectProduct,
  onQuickOrder,
  onAddToCart,
  onNavigate,
}: {
  route: AppRoute;
  categories: Category[];
  products: Product[];
  banners: Banner[];
  advertisements?: Advertisement[];
  adNetworks?: AdNetworkConfig[];
  settings: SiteSettings;
  lang: Language;
  initialSearch?: string;
  initialCatalogSection?: string;
  onSelectCatalogSection?: (sectionId: string) => void;
  onSelectProduct: (p: Product) => void;
  onQuickOrder?: (p: Product) => void;
  onAddToCart: (p: Product) => void;
  onNavigate: (r: AppRoute) => void;
}) {
  const [search, setSearch] = useState(initialSearch);
  const [selectedCat, setSelectedCat] = useState<string>('all');
  const [selectedSection, setSelectedSection] = useState<string>(initialCatalogSection || 'all');
  const [selectedSubcat, setSelectedSubcat] = useState<string>('all');
  const [availFilter, setAvailFilter] = useState<'all' | 'in_stock' | 'limited' | 'out_of_stock'>('all');
  const [sortBy, setSortBy] = useState<'popular' | 'price_low' | 'price_high' | 'name_az'>('popular');
  const [expand23, setExpand23] = useState(false);

  useEffect(() => {
    setSelectedSubcat('all');
  }, [route, selectedCat, selectedSection]);

  useEffect(() => {
    if (initialSearch) {
      setSearch(initialSearch);
    }
  }, [initialSearch]);

  useEffect(() => {
    setSelectedSection(initialCatalogSection || 'all');
    if (initialCatalogSection) {
      setSelectedCat('all');
    }
  }, [initialCatalogSection]);

  const routeCatMap: Partial<Record<AppRoute, string>> = {
    'gaming-store': 'cat_gaming',
    'gift-cards': 'cat_giftcards',
    'streaming-store': 'cat_streaming',
    'telegram-store': 'cat_telegram',
    'vip-groups': 'cat_vip',
    'telegram-stars': 'cat_telegram',
    'ai-marketplace': 'cat_ai',
    'software-store': 'cat_software',
    'digital-products': 'cat_digital',
    'graphic-design': 'cat_design',
    'social-media': 'cat_social',
  };

  const activeCatFilter = routeCatMap[route] || (selectedCat === 'all' ? '' : selectedCat);
  const active23Section = selectedSection !== 'all' ? CATALOG_23_MAP.get(selectedSection) : undefined;

  const sectionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of products) {
      if (!p.active) continue;
      const secId = getProductCatalogSectionId(p);
      if (secId) counts.set(secId, (counts.get(secId) || 0) + 1);
    }
    return counts;
  }, [products]);

  const categoryScopedProducts = useMemo(() => {
    return products.filter((p) => {
      if (!p.active) return false;
      if (selectedSection !== 'all') {
        return getProductCatalogSectionId(p) === selectedSection;
      }
      if (route === 'telegram-stars') {
        return p.titleEn.toLowerCase().includes('star') || p.categoryId === 'cat_telegram';
      }
      if (route === 'streaming-store') {
        return (
          p.categoryId === 'cat_streaming' ||
          ['prod_sw_capcut_pro', 'prod_ai_chatgpt_plus', 'prod_sw_vpn_pro'].includes(p.id)
        );
      }
      if (route === 'social-media') {
        return p.categoryId === 'cat_social' || p.categoryId === 'cat_telegram';
      }
      if (route === 'gift-cards') {
        return p.categoryId === 'cat_giftcards' || p.id === 'prod_unipin_voucher';
      }
      if (route === 'digital-products') {
        return p.categoryId === 'cat_digital' || p.categoryId === 'cat_design';
      }
      if (activeCatFilter && p.categoryId !== activeCatFilter) return false;
      return true;
    });
  }, [products, route, activeCatFilter, selectedSection]);

  const subcategories = useMemo(() => {
    const map = new Map<string, string>();
    categoryScopedProducts.forEach((p) => {
      if (p.subcategoryEn) {
        map.set(p.subcategoryEn, lang === 'bn' ? p.subcategoryBn || p.subcategoryEn : p.subcategoryEn);
      }
    });
    return Array.from(map.entries()).map(([key, label]) => ({ key, label }));
  }, [categoryScopedProducts, lang]);

  const filtered = useMemo(() => {
    const base = categoryScopedProducts.filter((p) => {
      if (selectedSubcat !== 'all' && p.subcategoryEn !== selectedSubcat) return false;
      const effAvail = getEffectiveProductAvailability(p);
      if (availFilter !== 'all' && effAvail !== availFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const secDef = CATALOG_23_MAP.get(getProductCatalogSectionId(p) || '');
        const pkgMatch = (p.packages || []).some(
          (pk) => pk.nameEn.toLowerCase().includes(q) || pk.nameBn.toLowerCase().includes(q)
        );
        return (
          pkgMatch ||
          p.titleBn.toLowerCase().includes(q) ||
          p.titleEn.toLowerCase().includes(q) ||
          p.descriptionBn.toLowerCase().includes(q) ||
          p.descriptionEn.toLowerCase().includes(q) ||
          (p.subcategoryBn || '').toLowerCase().includes(q) ||
          (p.subcategoryEn || '').toLowerCase().includes(q) ||
          (p.brandKey || '').toLowerCase().includes(q) ||
          (secDef?.nameEn || '').toLowerCase().includes(q) ||
          (secDef?.nameBn || '').toLowerCase().includes(q)
        );
      }
      return true;
    });

    if (sortBy === 'price_low') {
      return [...base].sort((a, b) => getDisplayStartingPrice(a) - getDisplayStartingPrice(b));
    }
    if (sortBy === 'price_high') {
      return [...base].sort((a, b) => getDisplayStartingPrice(b) - getDisplayStartingPrice(a));
    }
    if (sortBy === 'name_az') {
      return [...base].sort((a, b) => a.titleEn.localeCompare(b.titleEn));
    }
    return [...base].sort((a, b) => {
      const ordDiff = (a.sortOrder ?? 99999) - (b.sortOrder ?? 99999);
      if (ordDiff !== 0) return ordDiff;
      return Number(Boolean(b.featured)) - Number(Boolean(a.featured));
    });
  }, [categoryScopedProducts, selectedSubcat, availFilter, search, sortBy]);

  const matchedCategory = categories.find((c) => c.id === activeCatFilter);

  const handleSelect23 = (sectionId: string) => {
    setSelectedSection(sectionId);
    setSelectedCat('all');
    onSelectCatalogSection?.(sectionId === 'all' ? '' : sectionId);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <BannerSlotView
        slot="service_page"
        banners={banners}
        adNetworks={adNetworks}
        adsEnabled={settings.adsEnabled}
        lang={lang}
      />

      <div className="dh-card rounded-3xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-[#172033]">
            {active23Section
              ? lang === 'bn'
                ? active23Section.nameBn
                : active23Section.nameEn
              : route === 'telegram-stars'
                ? t(lang, 'navStars')
                : matchedCategory
                  ? lang === 'bn'
                    ? matchedCategory.nameBn
                    : matchedCategory.nameEn
                  : t(lang, 'navServices')}
          </h1>
          <p className="text-xs sm:text-sm text-[#777777] mt-0.5">
            {active23Section
              ? lang === 'bn'
                ? `${active23Section.nameBn} — অফিশিয়াল প্যাকেজ, দ্রুত ডেলিভারি ও নিরাপদ পেমেন্ট।`
                : `${active23Section.nameEn} — Official packages, fast delivery & verified BDT pricing.`
              : matchedCategory
                ? lang === 'bn'
                  ? matchedCategory.descriptionBn
                  : matchedCategory.descriptionEn
                : lang === 'bn'
                  ? 'সকল ২৩টি ডিজিটাল ও গেমিং ক্যাটাগরি — ফ্রি ফায়ার, eFootball Android/iPhone, PUBG, TikTok, VPN, OTT ও ChatGPT।'
                  : 'Browse all 23 organized catalog categories — Free Fire, eFootball Android/iPhone, PUBG, TikTok, VPN, OTT & ChatGPT.'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2.5 w-full lg:w-auto">
          <div className="relative flex-1 sm:w-72">
            <Search className="w-4 h-4 text-[#777777] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t(lang, 'searchPlaceholder')}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs sm:text-sm focus:outline-none focus:border-[#FF8500]"
            />
          </div>

          <div className="flex items-center gap-2">
            <select
              value={availFilter}
              onChange={(e) =>
                setAvailFilter(e.target.value as 'all' | 'in_stock' | 'limited' | 'out_of_stock')
              }
              className="px-3 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-bold text-[#172033] focus:outline-none focus:border-[#FF8500]"
            >
              <option value="all">{t(lang, 'allStatuses')}</option>
              <option value="in_stock">{t(lang, 'inStock')}</option>
              <option value="limited">{t(lang, 'limited')}</option>
              <option value="out_of_stock">{t(lang, 'outOfStock')}</option>
            </select>

            <div className="relative flex items-center">
              <SlidersHorizontal className="w-3.5 h-3.5 text-[#FF8500] absolute left-2.5 pointer-events-none" />
              <select
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as 'popular' | 'price_low' | 'price_high' | 'name_az')
                }
                className="pl-8 pr-3 py-2.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-bold text-[#172033] focus:outline-none focus:border-[#FF8500]"
              >
                <option value="popular">{t(lang, 'sortPopular')}</option>
                <option value="price_low">{t(lang, 'sortPriceLow')}</option>
                <option value="price_high">{t(lang, 'sortPriceHigh')}</option>
                <option value="name_az">{t(lang, 'sortNameAZ')}</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {route === 'services' && (
        <div className="space-y-2.5">
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => {
                setSelectedCat('all');
                handleSelect23('all');
              }}
              className={`px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 ${
                selectedCat === 'all' && selectedSection === 'all'
                  ? 'dh-orange-gradient text-white'
                  : 'bg-white border border-[#E6ECFA] text-[#172033]'
              }`}
            >
              {t(lang, 'allCategories')}
            </button>
            {categories
              .filter((c) => c.active)
              .map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setSelectedCat(cat.id);
                    setSelectedSection('all');
                    onSelectCatalogSection?.('');
                  }}
                  className={`px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 ${
                    selectedCat === cat.id && selectedSection === 'all'
                      ? 'dh-orange-gradient text-white'
                      : 'bg-white border border-[#E6ECFA] text-[#172033]'
                  }`}
                >
                  {lang === 'bn' ? cat.nameBn : cat.nameEn}
                </button>
              ))}
          </div>

          {/* Complete 23-Category Quick Filter Strip */}
          <div className="rounded-2xl bg-white border border-[#E6ECFA] p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-extrabold text-[#172033] uppercase tracking-wider">
                {lang === 'bn' ? 'সকল ২৩টি সার্ভিস ক্যাটাগরি' : 'All 23 Catalog Categories'}
              </span>
              <button
                type="button"
                onClick={() => setExpand23((prev) => !prev)}
                className="text-[11px] font-bold text-[#FF8500] hover:underline"
              >
                {expand23
                  ? lang === 'bn'
                    ? 'সংক্ষিপ্ত করুন'
                    : 'Compact View'
                  : lang === 'bn'
                    ? 'সব ২৩টি একসাথে দেখুন'
                    : 'Expand All 23'}
              </button>
            </div>
            <div
              className={
                expand23
                  ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-1.5'
                  : 'flex gap-1.5 overflow-x-auto pb-1'
              }
            >
              <button
                type="button"
                onClick={() => handleSelect23('all')}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0 text-left transition-colors ${
                  selectedSection === 'all'
                    ? 'bg-[#172033] text-white'
                    : 'bg-[#F3F6FF] text-[#172033] hover:bg-[#FFF3E5] hover:text-[#FF8500]'
                }`}
              >
                {lang === 'bn' ? 'সব সার্ভিস' : 'All Services'}
              </button>
              {CATALOG_23_CATEGORIES.map((sec) => {
                const count = sectionCounts.get(sec.id) || 0;
                const isActive = selectedSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    type="button"
                    onClick={() => handleSelect23(sec.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0 flex items-center justify-between gap-1.5 transition-colors ${
                      isActive
                        ? 'bg-[#FF8500] text-white shadow-xs'
                        : 'bg-[#F3F6FF] text-[#172033] hover:bg-[#FFF3E5] hover:text-[#FF8500]'
                    }`}
                  >
                    <span className="truncate">{lang === 'bn' ? sec.shortBn : sec.shortEn}</span>
                    {count > 0 && (
                      <span
                        className={`text-[10px] font-mono-num ${
                          isActive ? 'text-white/90' : 'text-[#777777]'
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {subcategories.length > 1 && selectedSection === 'all' && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedSubcat('all')}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold shrink-0 ${
              selectedSubcat === 'all'
                ? 'bg-[#172033] text-white'
                : 'bg-white border border-[#E6ECFA] text-[#777777] hover:text-[#172033]'
            }`}
          >
            {t(lang, 'allSubcategories')}
          </button>
          {subcategories.map((sub) => (
            <button
              key={sub.key}
              type="button"
              onClick={() => setSelectedSubcat(sub.key)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold shrink-0 ${
                selectedSubcat === sub.key
                  ? 'bg-[#172033] text-white'
                  : 'bg-white border border-[#E6ECFA] text-[#777777] hover:text-[#172033]'
              }`}
            >
              {sub.label}
            </button>
          ))}
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="dh-card rounded-3xl p-10 text-center space-y-3">
          <p className="text-sm font-semibold text-[#777777]">
            {lang === 'bn' ? 'কোনো সার্ভিস পাওয়া যায়নি।' : 'No matching services found.'}
          </p>
          <button
            type="button"
            onClick={() => {
              setSelectedCat('all');
              setSelectedSection('all');
              onSelectCatalogSection?.('');
              setSelectedSubcat('all');
              setAvailFilter('all');
              setSearch('');
              onNavigate('services');
            }}
            className="px-5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold"
          >
            {t(lang, 'allCategories')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {filtered.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              lang={lang}
              onSelect={onSelectProduct}
              onQuickOrder={onQuickOrder}
              onAddToCart={onAddToCart}
            />
          ))}
        </div>
      )}

      <NativeAdRow
        placement="service_page"
        advertisements={advertisements}
        adNetworks={adNetworks}
        adsEnabled={settings.adsEnabled}
        lang={lang}
        maxCards={3}
      />
    </div>
  );
}

export function OffersPage({
  coupons,
  products,
  banners = EMPTY_BANNERS,
  advertisements = EMPTY_ADVERTISEMENTS,
  adNetworks = EMPTY_AD_NETWORKS,
  settings,
  lang,
  onSelectProduct,
  onQuickOrder,
  onAddToCart,
}: {
  coupons: Coupon[];
  products: Product[];
  banners?: Banner[];
  advertisements?: Advertisement[];
  adNetworks?: AdNetworkConfig[];
  settings: SiteSettings;
  lang: Language;
  onSelectProduct: (p: Product) => void;
  onQuickOrder?: (p: Product) => void;
  onAddToCart: (p: Product) => void;
}) {
  const [copiedCode, setCopiedCode] = useState('');
  const discounted = products.filter(
    (p) => p.active && ((p.discountPercent && p.discountPercent > 0) || p.sectionTag === 'flash_sale')
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <BannerSlotView
        slot="service_page"
        banners={banners}
        adNetworks={adNetworks}
        adsEnabled={settings.adsEnabled}
        lang={lang}
      />
      <div className="dh-card rounded-3xl p-6 bg-gradient-to-r from-[#172033] to-[#23314d] text-white border-none">
        <div className="flex items-center gap-2 text-[#FF9B19] text-xs font-bold uppercase mb-1">
          <Tag className="w-4 h-4" />
          <span>{t(lang, 'navOffers')}</span>
        </div>
        <h1 className="text-2xl font-extrabold">{t(lang, 'specialOffers')}</h1>
        <p className="text-xs sm:text-sm text-white/75 mt-1">
          {lang === 'bn'
            ? 'কুপন কোড কপি করে চেকআউটে ব্যবহার করুন এবং তাৎক্ষণিক ডিসকাউন্ট পান।'
            : 'Copy active coupon codes for checkout and browse discounted flash deals.'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {coupons
          .filter((c) => c.active)
          .map((c) => (
            <div key={c.id} className="dh-card rounded-2xl p-5 flex items-center justify-between gap-3">
              <div>
                <p className="text-lg font-extrabold font-mono-num text-[#FF8500]">
                  {c.discountType === 'percent' ? `${c.discountValue}% OFF` : `${formatBdt(c.discountValue)} OFF`}
                </p>
                <p className="text-xs font-mono-num font-bold text-[#172033] mt-0.5">{c.code}</p>
                <p className="text-[11px] text-[#777777] mt-1">
                  {lang === 'bn'
                    ? `ন্যূনতম অর্ডার: ${formatBdt(c.minOrderBdt)}`
                    : `Min order: ${formatBdt(c.minOrderBdt)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(c.code).catch(() => {});
                  setCopiedCode(c.code);
                  setTimeout(() => setCopiedCode(''), 1800);
                }}
                className="px-3.5 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold flex items-center gap-1.5"
              >
                {copiedCode === c.code ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copiedCode === c.code ? t(lang, 'copied') : lang === 'bn' ? 'কপি' : 'Copy'}
              </button>
            </div>
          ))}
      </div>

      <div>
        <h2 className="text-lg font-extrabold text-[#172033] mb-4">{t(lang, 'flashSale')}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {discounted.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              lang={lang}
              onSelect={onSelectProduct}
              onQuickOrder={onQuickOrder}
              onAddToCart={onAddToCart}
            />
          ))}
        </div>
      </div>

      <NativeAdRow
        placement="service_page"
        advertisements={advertisements}
        adNetworks={adNetworks}
        adsEnabled={settings.adsEnabled}
        lang={lang}
        maxCards={3}
      />
    </div>
  );
}

export function SupportAndContactPage({
  mode,
  settings,
  lang,
  onGoToTickets,
}: {
  mode: 'support' | 'contact';
  settings: SiteSettings;
  lang: Language;
  onGoToTickets: () => void;
}) {
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div className="dh-card rounded-3xl p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-[#FFF3E5] text-[#FF8500] text-xs font-bold">
            <Headphones className="w-4 h-4" />
            <span>{mode === 'support' ? t(lang, 'navSupport') : lang === 'bn' ? 'যোগাযোগ' : 'Contact Us'}</span>
          </div>
          <h1 className="text-2xl font-extrabold text-[#172033]">
            {lang === 'bn' ? '২৪/৭ কাস্টমার সাপোর্ট ও সহায়তা কেন্দ্র' : '24/7 Customer Support & Contact Center'}
          </h1>
          <p className="text-xs sm:text-sm text-[#777777]">
            {lang === 'bn'
              ? 'পেমেন্ট যাচাই, অর্ডার ডেলিভারি বা যেকোনো প্রশ্নে আমাদের সাথে সরাসরি যোগাযোগ করুন।'
              : 'Reach our support team for payment verification, delivery updates, or service questions.'}
          </p>
        </div>

        <button
          type="button"
          onClick={onGoToTickets}
          className="px-5 py-3 rounded-xl dh-orange-gradient text-white text-sm font-bold flex items-center gap-2 shrink-0 self-start md:self-auto"
        >
          <MessageCircle className="w-4 h-4" />
          {lang === 'bn' ? 'সাপোর্ট টিকেট খুলুন' : 'Open Support Ticket'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="dh-card rounded-2xl p-5 space-y-2">
          <Phone className="w-5 h-5 text-[#FF8500]" />
          <h3 className="text-sm font-bold text-[#172033]">
            {lang === 'bn' ? 'অফিশিয়াল পেমেন্ট নম্বরসমূহ' : 'Official Payment Numbers'}
          </h3>
          <p className="text-xs font-mono-num text-[#777777]">
            bKash ({settings.bkashType || 'Personal'}): {settings.bkashNumber}
          </p>
          <p className="text-xs font-mono-num text-[#777777]">
            Nagad ({settings.nagadType || 'Personal'}): {settings.nagadNumber}
          </p>
          <p className="text-xs font-mono-num text-[#777777]">
            Rocket ({settings.rocketType || 'Personal'}): {settings.rocketNumber}
          </p>
        </div>

        <div className="dh-card rounded-2xl p-5 space-y-2">
          <Mail className="w-5 h-5 text-[#FF8500]" />
          <h3 className="text-sm font-bold text-[#172033]">
            {lang === 'bn' ? 'অফিশিয়াল সাপোর্ট ইমেইল' : 'Support Email'}
          </h3>
          <p className="text-xs font-mono-num text-[#777777]">
            {settings.supportContact || 'support@digitalhub.bd'}
          </p>
        </div>

        <div className="dh-card rounded-2xl p-5 space-y-2.5 min-w-0">
          <Send className="w-5 h-5 text-[#FF8500]" />
          <h3 className="text-sm font-bold text-[#172033] dark:text-slate-100">
            {lang === 'bn' ? 'সরাসরি কাস্টমার সাপোর্ট ও চ্যানেল' : 'Direct Customer Support & Channels'}
          </h3>
          <div className="space-y-2 pt-1">
            <a
              href={settings.messengerLink || settings.facebookLink || 'https://m.me/digitalhubbd'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800/80 hover:bg-[#FFF3E5] dark:hover:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-bold text-[#172033] dark:text-slate-100 transition-colors"
            >
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <MessageCircle className="w-3.5 h-3.5 text-[#0084FF] shrink-0" />
                <span className="truncate">{lang === 'bn' ? 'মেসেঞ্জার সাপোর্ট' : 'Messenger Support'}</span>
              </span>
              <span className="text-[11px] font-bold text-[#0084FF] shrink-0">
                {lang === 'bn' ? 'চ্যাট করুন' : 'Open Chat'}
              </span>
            </a>

            <a
              href={settings.whatsappLink || 'https://wa.me/8801352838945'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800/80 hover:bg-[#FFF3E5] dark:hover:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-bold text-[#172033] dark:text-slate-100 transition-colors"
            >
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <MessageCircle className="w-3.5 h-3.5 text-[#16A34A] shrink-0" />
                <span className="truncate">{t(lang, 'whatsappAdminLabel')}</span>
              </span>
              <span className="font-mono-num text-[#16A34A] shrink-0">+880 1352-838945</span>
            </a>

            <a
              href={settings.telegramLink || 'https://t.me/zenvoofficial'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800/80 hover:bg-[#FFF3E5] dark:hover:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-bold text-[#172033] dark:text-slate-100 transition-colors"
            >
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <Send className="w-3.5 h-3.5 text-[#0088cc] shrink-0" />
                <span className="truncate">{t(lang, 'telegramAdminLabel')}</span>
              </span>
              <span className="font-mono-num text-[#FF8500] shrink-0">@zenvoofficial</span>
            </a>

            <a
              href={settings.telegramChannelLink || 'https://t.me/ZENVOOfficialTelegramChannel'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[#172033] hover:bg-[#FF8500] text-xs font-bold text-white transition-colors"
            >
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <Send className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{t(lang, 'telegramChannelLabel')}</span>
              </span>
              <span className="text-[11px] opacity-90 shrink-0">
                {lang === 'bn' ? 'চ্যানেল খুলুন' : 'Open Channel'}
              </span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PolicyPage({
  kind,
  settings,
  lang,
}: {
  kind: 'about' | 'privacy' | 'terms' | 'refund';
  settings: SiteSettings;
  lang: Language;
}) {
  const title =
    kind === 'about'
      ? lang === 'bn'
        ? 'আমাদের সম্পর্কে (About Us)'
        : 'About DIGITAL HUB'
      : kind === 'privacy'
        ? lang === 'bn'
          ? 'প্রাইভেসি পলিসি'
          : 'Privacy Policy'
        : kind === 'terms'
          ? lang === 'bn'
            ? 'শর্তাবলী (Terms & Conditions)'
            : 'Terms & Conditions'
          : lang === 'bn'
            ? 'রিফান্ড ও বাতিলকরণ নীতিমালা'
            : 'Refund & Cancellation Policy';

  const body =
    kind === 'about'
      ? lang === 'bn'
        ? settings.aboutBn
        : settings.aboutEn
      : kind === 'privacy'
        ? lang === 'bn'
          ? settings.privacyBn
          : settings.privacyEn
        : kind === 'terms'
          ? lang === 'bn'
            ? settings.termsBn
            : settings.termsEn
          : lang === 'bn'
            ? settings.refundBn
            : settings.refundEn;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="dh-card rounded-3xl p-6 sm:p-8 space-y-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-xl bg-[#FFF3E5] text-[#FF8500] text-xs font-bold">
          <ShieldCheck className="w-4 h-4" />
          <span>DIGITAL HUB</span>
        </div>
        <h1 className="text-2xl font-extrabold text-[#172033]">{title}</h1>
        <p className="text-sm sm:text-base text-[#172033]/85 leading-relaxed whitespace-pre-line">
          {body}
        </p>
      </div>
    </div>
  );
}
