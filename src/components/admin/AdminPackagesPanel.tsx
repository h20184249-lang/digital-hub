import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  BadgePercent,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Edit3,
  Eye,
  Image as ImageIcon,
  Layers,
  ListChecks,
  MoreVertical,
  Package,
  Plus,
  Power,
  Search,
  Sparkles,
  Star,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Category, Language, Product, ProductPackage, ProductSectionTag } from '../../types/marketplace';
import {
  adminDeleteProduct,
  adminQuickUpdatePackage,
  adminSaveProduct,
  adminUploadMediaAsset,
  formatDateShort,
  optimizePackageLogoFile,
} from '../../lib/firestoreService';
import { ServiceBrandLogo } from '../BrandLogos';
import { ProductCard } from '../StorefrontPages';
import { ConfirmDialog } from './ConfirmDialog';

interface AdminPackagesPanelProps {
  lang: Language;
  products: Product[];
  categories: Category[];
  initialSearchQuery?: string;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

type StatusFilter = 'all' | 'active' | 'inactive' | 'featured';
type SortOption = 'sortOrder' | 'price_asc' | 'price_desc' | 'updated_desc' | 'name_asc';
type DurationUnit = 'days' | 'months' | 'years' | 'lifetime';

const BADGE_PRESETS = ['', 'Popular', 'Premium', 'Best Value', 'New', 'Hot Deal', 'Official'];
const PAGE_SIZE = 12;

function calcDiscountPercent(priceBdt: number, originalPriceBdt: number): number {
  if (!Number.isFinite(priceBdt) || !Number.isFinite(originalPriceBdt)) return 0;
  if (originalPriceBdt <= priceBdt || originalPriceBdt <= 0) return 0;
  return Math.min(95, Math.max(1, Math.round(((originalPriceBdt - priceBdt) / originalPriceBdt) * 100)));
}

function buildDurationLabels(value: number, unit: DurationUnit): { bn: string; en: string } {
  if (unit === 'lifetime') {
    return { bn: 'লাইফটাইম অ্যাক্সেস', en: 'Lifetime' };
  }
  const n = Math.max(1, Math.round(value || 1));
  if (unit === 'days') {
    return { bn: `${n} দিন`, en: `${n} ${n === 1 ? 'Day' : 'Days'}` };
  }
  if (unit === 'months') {
    return { bn: `${n} মাস`, en: `${n} ${n === 1 ? 'Month' : 'Months'}` };
  }
  return { bn: `${n} বছর`, en: `${n} ${n === 1 ? 'Year' : 'Years'}` };
}

function extractFeaturesList(prod: Product): string[] {
  if (Array.isArray(prod.features) && prod.features.length > 0) {
    return prod.features.filter(Boolean);
  }
  const raw = (prod.benefitsEn || prod.benefitsBn || '').trim();
  if (!raw) return [];
  return raw
    .split(/\s*[•|\n;]+\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveDurationDisplay(prod: Product, lang: Language): string {
  if (lang === 'bn' && prod.durationLabelBn) return prod.durationLabelBn;
  if (lang === 'en' && prod.durationLabelEn) return prod.durationLabelEn;
  if (lang === 'bn' && prod.validityBn) return prod.validityBn;
  if (prod.validityEn) return prod.validityEn;
  if (prod.durationUnit) {
    const lbl = buildDurationLabels(prod.durationValue || 1, prod.durationUnit);
    return lang === 'bn' ? lbl.bn : lbl.en;
  }
  return lang === 'bn' ? prod.deliveryDurationBn || 'স্ট্যান্ডার্ড' : prod.deliveryDurationEn || 'Standard';
}

function toSafeTimestamp(val: unknown): number {
  if (typeof val === 'number' && Number.isFinite(val)) return val;
  if (typeof val === 'string') {
    const n = Date.parse(val);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

function makeUniquePackageId(baseName: string, existingIds: Set<string>): string {
  const slug = baseName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  const prefix = slug ? `pkg_${slug}` : 'pkg_custom';
  if (!existingIds.has(prefix)) return prefix;
  for (let i = 2; i < 999; i += 1) {
    const candidate = `${prefix}_${i}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${prefix}_${Date.now().toString(36)}`;
}

interface EditorDraft {
  id: string;
  isNew: boolean;
  originalProduct?: Product;
  titleEn: string;
  titleBn: string;
  categoryId: string;
  subcategoryEn: string;
  subcategoryBn: string;
  brandKey: string;
  badge: string;
  priceBdt: string;
  originalPriceBdt: string;
  durationValue: string;
  durationUnit: DurationUnit;
  durationLabelEn: string;
  durationLabelBn: string;
  deliveryDurationEn: string;
  deliveryDurationBn: string;
  descriptionEn: string;
  descriptionBn: string;
  instructionsEn: string;
  instructionsBn: string;
  features: string[];
  packages: ProductPackage[];
  availability: 'in_stock' | 'limited' | 'out_of_stock';
  stockCount: string;
  sectionTag: ProductSectionTag;
  sortOrder: string;
  active: boolean;
  featured: boolean;
  customLogoUrl: string;
  pendingLogoDataUrl: string;
  imageUrl: string;
  pendingCoverDataUrl: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function createDraftFromProduct(prod: Product): EditorDraft {
  return {
    id: prod.id,
    isNew: false,
    originalProduct: prod,
    titleEn: prod.titleEn || prod.titleBn || '',
    titleBn: prod.titleBn || prod.titleEn || '',
    categoryId: prod.categoryId || 'cat_digital',
    subcategoryEn: prod.subcategoryEn || '',
    subcategoryBn: prod.subcategoryBn || '',
    brandKey: prod.brandKey || '',
    badge: prod.badge || '',
    priceBdt: String(prod.priceBdt || 1),
    originalPriceBdt: prod.originalPriceBdt && prod.originalPriceBdt > 0 ? String(prod.originalPriceBdt) : '',
    durationValue: String(prod.durationValue || 30),
    durationUnit: prod.durationUnit || 'days',
    durationLabelEn: prod.durationLabelEn || prod.validityEn || '',
    durationLabelBn: prod.durationLabelBn || prod.validityBn || '',
    deliveryDurationEn: prod.deliveryDurationEn || '5 - 15 mins',
    deliveryDurationBn: prod.deliveryDurationBn || '৫ - ১৫ মিনিট',
    descriptionEn: prod.descriptionEn || '',
    descriptionBn: prod.descriptionBn || '',
    instructionsEn: prod.instructionsEn || '',
    instructionsBn: prod.instructionsBn || '',
    features: extractFeaturesList(prod),
    packages: (prod.packages || []).map((pk) => ({ ...pk })),
    availability: prod.availability || 'in_stock',
    stockCount: String(typeof prod.stockCount === 'number' ? prod.stockCount : 100),
    sectionTag: prod.sectionTag || 'standard',
    sortOrder: String(typeof prod.sortOrder === 'number' ? prod.sortOrder : 100),
    active: Boolean(prod.active),
    featured: Boolean(prod.featured),
    customLogoUrl: prod.customLogoUrl || '',
    pendingLogoDataUrl: '',
    imageUrl: prod.imageUrl || '/assets/products/prod_ff_bd_diamonds.jpg',
    pendingCoverDataUrl: '',
    createdAt: prod.createdAt,
    updatedAt: prod.updatedAt,
  };
}

function createEmptyDraft(categories: Category[], nextSortOrder: number): EditorDraft {
  const defaultLabels = buildDurationLabels(30, 'days');
  return {
    id: '',
    isNew: true,
    titleEn: '',
    titleBn: '',
    categoryId: categories[0]?.id || 'cat_digital',
    subcategoryEn: '',
    subcategoryBn: '',
    brandKey: '',
    badge: 'Popular',
    priceBdt: '',
    originalPriceBdt: '',
    durationValue: '30',
    durationUnit: 'days',
    durationLabelEn: defaultLabels.en,
    durationLabelBn: defaultLabels.bn,
    deliveryDurationEn: '5 - 15 mins',
    deliveryDurationBn: '৫ - ১৫ মিনিট',
    descriptionEn: '',
    descriptionBn: '',
    instructionsEn: '',
    instructionsBn: '',
    features: ['Official verified activation', 'Fast delivery via Digital Hub BD', 'Dedicated WhatsApp & Telegram support'],
    packages: [],
    availability: 'in_stock',
    stockCount: '100',
    sectionTag: 'standard',
    sortOrder: String(nextSortOrder),
    active: true,
    featured: false,
    customLogoUrl: '',
    pendingLogoDataUrl: '',
    imageUrl: '/assets/products/prod_ff_bd_diamonds.jpg',
    pendingCoverDataUrl: '',
  };
}

export function AdminPackagesPanel({
  lang,
  products,
  categories,
  initialSearchQuery = '',
  onSuccess,
  onError,
}: AdminPackagesPanelProps) {
  const [search, setSearch] = useState(initialSearchQuery);
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortBy, setSortBy] = useState<SortOption>('sortOrder');
  const [page, setPage] = useState(1);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Full Add / Edit Modal state
  const [editorDraft, setEditorDraft] = useState<EditorDraft | null>(null);
  const [newFeatureInput, setNewFeatureInput] = useState('');
  const [savingEditor, setSavingEditor] = useState(false);
  const [pendingEditorPriceConfirm, setPendingEditorPriceConfirm] = useState<{
    oldPrice: number;
    newPrice: number;
  } | null>(null);

  // Quick Modals state
  const [quickLogoTarget, setQuickLogoTarget] = useState<Product | null>(null);
  const [quickLogoPreview, setQuickLogoPreview] = useState('');
  const [quickLogoRemoved, setQuickLogoRemoved] = useState(false);
  const [quickLogoBusy, setQuickLogoBusy] = useState(false);

  const [quickPriceTarget, setQuickPriceTarget] = useState<Product | null>(null);
  const [quickPriceVal, setQuickPriceVal] = useState('');
  const [quickOrigPriceVal, setQuickOrigPriceVal] = useState('');
  const [quickSubPackages, setQuickSubPackages] = useState<ProductPackage[]>([]);
  const [quickPriceConfirmOpen, setQuickPriceConfirmOpen] = useState(false);
  const [quickPriceBusy, setQuickPriceBusy] = useState(false);

  const [quickDurationTarget, setQuickDurationTarget] = useState<Product | null>(null);
  const [quickDurValue, setQuickDurValue] = useState('30');
  const [quickDurUnit, setQuickDurUnit] = useState<DurationUnit>('days');
  const [quickDurLabelEn, setQuickDurLabelEn] = useState('');
  const [quickDurLabelBn, setQuickDurLabelBn] = useState('');
  const [quickDurBusy, setQuickDurBusy] = useState(false);

  const [quickFeaturesTarget, setQuickFeaturesTarget] = useState<Product | null>(null);
  const [quickFeaturesList, setQuickFeaturesList] = useState<string[]>([]);
  const [quickFeatureDraft, setQuickFeatureDraft] = useState('');
  const [quickFeaturesBusy, setQuickFeaturesBusy] = useState(false);

  const [previewTarget, setPreviewTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState(false);

  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const quickLogoInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (initialSearchQuery) {
      setSearch(initialSearchQuery);
      setPage(1);
    }
  }, [initialSearchQuery]);

  // Close action menu when clicking outside
  useEffect(() => {
    if (!openMenuId) return;
    const onDocClick = () => setOpenMenuId(null);
    window.addEventListener('click', onDocClick);
    return () => window.removeEventListener('click', onDocClick);
  }, [openMenuId]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, Category>();
    for (const c of categories) map.set(c.id, c);
    return map;
  }, [categories]);

  const existingIds = useMemo(() => new Set(products.map((p) => p.id)), [products]);

  const stats = useMemo(() => {
    const active = products.filter((p) => p.active).length;
    const inactive = products.length - active;
    const featured = products.filter((p) => p.featured).length;
    const discounted = products.filter((p) => (p.discountPercent || 0) > 0).length;
    const withCustomLogo = products.filter((p) => Boolean(p.customLogoUrl)).length;
    return { total: products.length, active, inactive, featured, discounted, withCustomLogo };
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = products.filter((p) => {
      if (categoryFilter !== 'ALL' && p.categoryId !== categoryFilter) return false;
      if (statusFilter === 'active' && !p.active) return false;
      if (statusFilter === 'inactive' && p.active) return false;
      if (statusFilter === 'featured' && !p.featured) return false;
      if (!q) return true;
      const cat = categoryMap.get(p.categoryId);
      return (
        p.id.toLowerCase().includes(q) ||
        (p.titleEn || '').toLowerCase().includes(q) ||
        (p.titleBn || '').toLowerCase().includes(q) ||
        (p.subcategoryEn || '').toLowerCase().includes(q) ||
        (p.badge || '').toLowerCase().includes(q) ||
        (p.brandKey || '').toLowerCase().includes(q) ||
        (cat?.nameEn || '').toLowerCase().includes(q) ||
        String(p.priceBdt).includes(q)
      );
    });

    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortBy === 'price_asc') return (a.priceBdt || 0) - (b.priceBdt || 0);
      if (sortBy === 'price_desc') return (b.priceBdt || 0) - (a.priceBdt || 0);
      if (sortBy === 'updated_desc') return toSafeTimestamp(b.updatedAt) - toSafeTimestamp(a.updatedAt);
      if (sortBy === 'name_asc') return (a.titleEn || a.titleBn).localeCompare(b.titleEn || b.titleBn);
      return (a.sortOrder ?? 99999) - (b.sortOrder ?? 99999);
    });
    return sorted;
  }, [products, search, categoryFilter, statusFilter, sortBy, categoryMap]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visibleProducts = useMemo(
    () => filteredProducts.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredProducts, safePage]
  );

  // Full Editor Handlers
  const openAddPackage = () => {
    const maxSort = products.reduce((m, p) => Math.max(m, Number(p.sortOrder || 0)), 0);
    setEditorDraft(createEmptyDraft(categories, maxSort > 0 && maxSort < 9999 ? maxSort + 10 : products.length + 1));
    setNewFeatureInput('');
    setPendingEditorPriceConfirm(null);
  };

  const openEditPackage = (prod: Product) => {
    setEditorDraft(createDraftFromProduct(prod));
    setNewFeatureInput('');
    setPendingEditorPriceConfirm(null);
  };

  const handleEditorLogoFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editorDraft) return;
    try {
      const optimized = await optimizePackageLogoFile(file, 512);
      setEditorDraft((prev) => (prev ? { ...prev, pendingLogoDataUrl: optimized } : prev));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Invalid logo image file.');
    }
  };

  const handleEditorCoverFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !editorDraft) return;
    try {
      const optimized = await optimizePackageLogoFile(file, 960);
      setEditorDraft((prev) => (prev ? { ...prev, pendingCoverDataUrl: optimized } : prev));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Invalid cover image file.');
    }
  };

  const commitEditorSave = async (reason?: string) => {
    if (!editorDraft) return;
    const titleEn = editorDraft.titleEn.trim() || editorDraft.titleBn.trim();
    const titleBn = editorDraft.titleBn.trim() || titleEn;
    const priceNum = Math.round(Number(editorDraft.priceBdt));
    const origNum = editorDraft.originalPriceBdt.trim() ? Math.round(Number(editorDraft.originalPriceBdt)) : 0;

    if (titleEn.length < 2) {
      onError(lang === 'bn' ? 'প্যাকেজের নাম কমপক্ষে ২ অক্ষর হতে হবে।' : 'Package name must be at least 2 characters.');
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum < 1) {
      onError(lang === 'bn' ? 'সঠিক প্যাকেজ মূল্য (সর্বনিম্ন ৳১) দিন।' : 'Enter a valid package price (minimum ৳1).');
      return;
    }
    if (origNum < 0 || !Number.isFinite(origNum)) {
      onError(lang === 'bn' ? 'পূর্বের মূল্য সঠিক নয়।' : 'Previous/original price must be a valid positive number.');
      return;
    }

    const finalId = editorDraft.isNew
      ? (editorDraft.id.trim()
          ? editorDraft.id
              .trim()
              .toLowerCase()
              .replace(/[^a-z0-9_-]+/g, '_')
          : makeUniquePackageId(titleEn, existingIds))
      : editorDraft.id;

    if (editorDraft.isNew && existingIds.has(finalId)) {
      onError(
        lang === 'bn'
          ? `প্যাকেজ ID "${finalId}" ইতিমধ্যে ব্যবহৃত হয়েছে। অন্য ইউনিক ID দিন।`
          : `Package ID "${finalId}" already exists. Choose a unique Package ID.`
      );
      return;
    }

    setSavingEditor(true);
    try {
      let finalLogoUrl = editorDraft.customLogoUrl.trim();
      if (editorDraft.pendingLogoDataUrl) {
        const uploaded = await adminUploadMediaAsset(editorDraft.pendingLogoDataUrl);
        finalLogoUrl = uploaded.url;
      }

      let finalImageUrl = editorDraft.imageUrl.trim() || '/assets/products/prod_ff_bd_diamonds.jpg';
      if (editorDraft.pendingCoverDataUrl) {
        const uploadedCover = await adminUploadMediaAsset(editorDraft.pendingCoverDataUrl);
        finalImageUrl = uploadedCover.url;
      }

      const durValNum = Math.max(1, Math.round(Number(editorDraft.durationValue) || 1));
      const fallbackLabels = buildDurationLabels(durValNum, editorDraft.durationUnit);
      const durEn = editorDraft.durationLabelEn.trim() || fallbackLabels.en;
      const durBn = editorDraft.durationLabelBn.trim() || fallbackLabels.bn;
      const cleanFeatures = editorDraft.features.map((f) => f.trim()).filter(Boolean);
      const cleanDiscount = calcDiscountPercent(priceNum, origNum);
      const stockNum = Math.max(0, Math.round(Number(editorDraft.stockCount) || 0));
      const sortNum = Math.max(0, Math.round(Number(editorDraft.sortOrder) || 0));

      const productPayload: Product = {
        ...(editorDraft.originalProduct || {}),
        id: finalId,
        categoryId: editorDraft.categoryId,
        subcategoryEn: editorDraft.subcategoryEn.trim(),
        subcategoryBn: editorDraft.subcategoryBn.trim() || editorDraft.subcategoryEn.trim(),
        brandKey: editorDraft.brandKey.trim().toLowerCase(),
        badge: editorDraft.badge.trim(),
        titleEn,
        titleBn,
        descriptionEn: editorDraft.descriptionEn.trim() || editorDraft.descriptionBn.trim() || titleEn,
        descriptionBn: editorDraft.descriptionBn.trim() || editorDraft.descriptionEn.trim() || titleBn,
        priceBdt: priceNum,
        originalPriceBdt: origNum,
        regularPriceBdt: origNum || priceNum,
        discountPercent: cleanDiscount,
        currency: 'BDT',
        durationValue: editorDraft.durationUnit === 'lifetime' ? undefined : durValNum,
        durationUnit: editorDraft.durationUnit,
        durationLabelEn: durEn,
        durationLabelBn: durBn,
        validityEn: durEn,
        validityBn: durBn,
        deliveryDurationEn: editorDraft.deliveryDurationEn.trim() || '5 - 15 mins',
        deliveryDurationBn: editorDraft.deliveryDurationBn.trim() || '৫ - ১৫ মিনিট',
        instructionsEn: editorDraft.instructionsEn.trim(),
        instructionsBn: editorDraft.instructionsBn.trim(),
        features: cleanFeatures,
        benefitsEn: cleanFeatures.join(' • '),
        benefitsBn: cleanFeatures.join(' • '),
        packages: editorDraft.packages.filter((pk) => pk.nameEn.trim() && pk.priceBdt > 0),
        availability: editorDraft.availability,
        stockCount: stockNum,
        sectionTag: editorDraft.sectionTag,
        sortOrder: sortNum,
        active: editorDraft.active,
        featured: editorDraft.featured,
        customLogoUrl: finalLogoUrl,
        imageUrl: finalImageUrl,
        createdAt: editorDraft.createdAt,
      };

      const priceChanged =
        !editorDraft.isNew &&
        editorDraft.originalProduct &&
        editorDraft.originalProduct.priceBdt !== priceNum;

      await adminSaveProduct(productPayload, editorDraft.isNew, {
        auditAction: editorDraft.isNew ? 'create' : priceChanged ? 'price_change' : 'update',
        auditReason: reason,
        previousSnapshot: editorDraft.originalProduct,
      });

      setPendingEditorPriceConfirm(null);
      setEditorDraft(null);
      onSuccess(
        editorDraft.isNew
          ? lang === 'bn'
            ? `নতুন প্যাকেজ "${titleBn}" সফলভাবে তৈরি হয়েছে।`
            : `Package "${titleEn}" created and synced live.`
          : lang === 'bn'
            ? `প্যাকেজ "${titleBn}" সফলভাবে আপডেট হয়েছে।`
            : `Package "${titleEn}" updated and synced live.`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save package.');
    } finally {
      setSavingEditor(false);
    }
  };

  const handleEditorSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!editorDraft) return;
    const newPrice = Math.round(Number(editorDraft.priceBdt));
    if (!Number.isFinite(newPrice) || newPrice < 1) {
      onError(lang === 'bn' ? 'সঠিক প্যাকেজ মূল্য (সর্বনিম্ন ৳১) দিন।' : 'Enter a valid package price (minimum ৳1).');
      return;
    }
    if (!editorDraft.isNew && editorDraft.originalProduct && editorDraft.originalProduct.priceBdt !== newPrice) {
      setPendingEditorPriceConfirm({
        oldPrice: editorDraft.originalProduct.priceBdt,
        newPrice,
      });
      return;
    }
    void commitEditorSave();
  };

  // Quick Logo Modal Handlers
  const openQuickLogo = (prod: Product) => {
    setQuickLogoTarget(prod);
    setQuickLogoPreview('');
    setQuickLogoRemoved(false);
  };

  const handleQuickLogoFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const optimized = await optimizePackageLogoFile(file, 512);
      setQuickLogoPreview(optimized);
      setQuickLogoRemoved(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Invalid image file.');
    }
  };

  const saveQuickLogo = async () => {
    if (!quickLogoTarget) return;
    setQuickLogoBusy(true);
    try {
      let nextLogoUrl = quickLogoTarget.customLogoUrl || '';
      if (quickLogoRemoved) {
        nextLogoUrl = '';
      } else if (quickLogoPreview) {
        const uploaded = await adminUploadMediaAsset(quickLogoPreview);
        nextLogoUrl = uploaded.url;
      }
      await adminQuickUpdatePackage(
        quickLogoTarget,
        { customLogoUrl: nextLogoUrl },
        { auditAction: 'logo_change', auditReason: quickLogoRemoved ? 'Removed custom logo' : 'Uploaded new package logo' }
      );
      onSuccess(
        lang === 'bn'
          ? `"${quickLogoTarget.titleBn}"-এর লোগো সফলভাবে আপডেট হয়েছে।`
          : `Logo updated permanently for "${quickLogoTarget.titleEn}".`
      );
      setQuickLogoTarget(null);
      setQuickLogoPreview('');
      setQuickLogoRemoved(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update package logo.');
    } finally {
      setQuickLogoBusy(false);
    }
  };

  // Quick Price Modal Handlers
  const openQuickPrice = (prod: Product) => {
    setQuickPriceTarget(prod);
    setQuickPriceVal(String(prod.priceBdt || 1));
    setQuickOrigPriceVal(prod.originalPriceBdt && prod.originalPriceBdt > 0 ? String(prod.originalPriceBdt) : '');
    setQuickSubPackages((prod.packages || []).map((pk) => ({ ...pk })));
    setQuickPriceConfirmOpen(false);
  };

  const requestQuickPriceConfirm = (e: FormEvent) => {
    e.preventDefault();
    const p = Math.round(Number(quickPriceVal));
    if (!Number.isFinite(p) || p < 1) {
      onError(lang === 'bn' ? 'সর্বনিম্ন মূল্য ৳১ হতে হবে।' : 'Package price must be at least ৳1.');
      return;
    }
    setQuickPriceConfirmOpen(true);
  };

  const commitQuickPrice = async (reason: string) => {
    if (!quickPriceTarget) return;
    const p = Math.max(1, Math.round(Number(quickPriceVal)));
    const orig = quickOrigPriceVal.trim() ? Math.max(0, Math.round(Number(quickOrigPriceVal))) : 0;
    setQuickPriceBusy(true);
    try {
      const updatedProduct: Product = {
        ...quickPriceTarget,
        priceBdt: p,
        originalPriceBdt: orig,
        regularPriceBdt: orig || p,
        discountPercent: calcDiscountPercent(p, orig),
        ...(quickSubPackages.length > 0 ? { packages: quickSubPackages } : {}),
      };
      await adminSaveProduct(updatedProduct, false, {
        auditAction: 'price_change',
        auditReason: reason,
        previousSnapshot: quickPriceTarget,
      });
      onSuccess(
        lang === 'bn'
          ? `"${quickPriceTarget.titleBn}"-এর মূল্য ৳${quickPriceTarget.priceBdt} থেকে ৳${p} আপডেট হয়েছে।`
          : `Price updated for "${quickPriceTarget.titleEn}": ৳${quickPriceTarget.priceBdt} → ৳${p}`
      );
      setQuickPriceConfirmOpen(false);
      setQuickPriceTarget(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update package price.');
    } finally {
      setQuickPriceBusy(false);
    }
  };

  // Quick Duration Modal Handlers
  const openQuickDuration = (prod: Product) => {
    setQuickDurationTarget(prod);
    const unit = prod.durationUnit || 'days';
    const val = String(prod.durationValue || 30);
    setQuickDurUnit(unit);
    setQuickDurValue(val);
    setQuickDurLabelEn(prod.durationLabelEn || prod.validityEn || buildDurationLabels(Number(val), unit).en);
    setQuickDurLabelBn(prod.durationLabelBn || prod.validityBn || buildDurationLabels(Number(val), unit).bn);
  };

  const saveQuickDuration = async (e: FormEvent) => {
    e.preventDefault();
    if (!quickDurationTarget) return;
    setQuickDurBusy(true);
    try {
      const n = Math.max(1, Math.round(Number(quickDurValue) || 1));
      const fallback = buildDurationLabels(n, quickDurUnit);
      const labelEn = quickDurLabelEn.trim() || fallback.en;
      const labelBn = quickDurLabelBn.trim() || fallback.bn;
      await adminQuickUpdatePackage(
        quickDurationTarget,
        {
          durationValue: quickDurUnit === 'lifetime' ? undefined : n,
          durationUnit: quickDurUnit,
          durationLabelEn: labelEn,
          durationLabelBn: labelBn,
          validityEn: labelEn,
          validityBn: labelBn,
        },
        { auditAction: 'duration_change', auditReason: `Duration set to ${labelEn}` }
      );
      onSuccess(
        lang === 'bn'
          ? `"${quickDurationTarget.titleBn}"-এর মেয়াদ আপডেট হয়েছে।`
          : `Duration updated for "${quickDurationTarget.titleEn}" (${labelEn}).`
      );
      setQuickDurationTarget(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update package duration.');
    } finally {
      setQuickDurBusy(false);
    }
  };

  // Quick Features Modal Handlers
  const openQuickFeatures = (prod: Product) => {
    setQuickFeaturesTarget(prod);
    setQuickFeaturesList(extractFeaturesList(prod));
    setQuickFeatureDraft('');
  };

  const saveQuickFeatures = async (e: FormEvent) => {
    e.preventDefault();
    if (!quickFeaturesTarget) return;
    setQuickFeaturesBusy(true);
    try {
      const clean = quickFeaturesList.map((f) => f.trim()).filter(Boolean);
      await adminQuickUpdatePackage(
        quickFeaturesTarget,
        {
          features: clean,
          benefitsEn: clean.join(' • '),
          benefitsBn: clean.join(' • '),
        },
        { auditAction: 'features_change', auditReason: `${clean.length} feature(s) saved` }
      );
      onSuccess(
        lang === 'bn'
          ? `"${quickFeaturesTarget.titleBn}"-এর ফিচার তালিকা আপডেট হয়েছে।`
          : `Features updated for "${quickFeaturesTarget.titleEn}".`
      );
      setQuickFeaturesTarget(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update package features.');
    } finally {
      setQuickFeaturesBusy(false);
    }
  };

  // Quick Status Toggle & Duplicate & Delete
  const handleToggleActive = async (prod: Product) => {
    setBusyId(prod.id);
    try {
      const nextActive = !prod.active;
      await adminQuickUpdatePackage(
        prod,
        { active: nextActive },
        { auditAction: 'status_change', auditReason: nextActive ? 'Activated package' : 'Deactivated package' }
      );
      onSuccess(
        nextActive
          ? lang === 'bn'
            ? `"${prod.titleBn}" এখন ওয়েবসাইটে সক্রিয়।`
            : `Package "${prod.titleEn}" is now Active on storefront.`
          : lang === 'bn'
            ? `"${prod.titleBn}" নিষ্ক্রিয় করা হয়েছে (কেনার তালিকা থেকে লুকানো)।`
            : `Package "${prod.titleEn}" deactivated and hidden from storefront.`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update package status.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDuplicate = async (prod: Product) => {
    setBusyId(prod.id);
    try {
      const copyId = makeUniquePackageId(`${prod.id}_copy`, existingIds);
      const clone: Product = {
        ...prod,
        id: copyId,
        titleEn: `${prod.titleEn} (Copy)`,
        titleBn: `${prod.titleBn} (কপি)`,
        sortOrder: (prod.sortOrder ?? products.length) + 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await adminSaveProduct(clone, true, {
        auditAction: 'duplicate',
        auditReason: `Duplicated from ${prod.id}`,
      });
      onSuccess(
        lang === 'bn'
          ? `"${prod.titleBn}"-এর নতুন কপি (${copyId}) তৈরি হয়েছে।`
          : `Duplicated "${prod.titleEn}" as independent package (${copyId}).`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to duplicate package.');
    } finally {
      setBusyId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await adminDeleteProduct(deleteTarget.id);
      onSuccess(
        lang === 'bn'
          ? `প্যাকেজ "${deleteTarget.titleBn}" মুছে ফেলা হয়েছে।`
          : `Package "${deleteTarget.titleEn}" deleted permanently.`
      );
      setDeleteTarget(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete package.');
    } finally {
      setDeleting(false);
    }
  };

  const liveEditorDiscount = editorDraft
    ? calcDiscountPercent(Number(editorDraft.priceBdt || 0), Number(editorDraft.originalPriceBdt || 0))
    : 0;

  const liveQuickDiscount = calcDiscountPercent(Number(quickPriceVal || 0), Number(quickOrigPriceVal || 0));

  return (
    <div className="space-y-5">
      {/* Top Command Banner & Stats */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 text-slate-100">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-9 h-9 rounded-xl bg-[#FF8500]/15 border border-[#FF8500]/30 text-[#FF8500] flex items-center justify-center shrink-0">
                <Package className="w-5 h-5" />
              </span>
              <div>
                <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-white">
                  {lang === 'bn' ? 'অ্যাডভান্সড প্যাকেজ ম্যানেজমেন্ট' : 'Advanced Package Management'}
                </h2>
                <p className="text-xs text-slate-400">
                  {lang === 'bn'
                    ? 'প্রতিটি প্যাকেজের লোগো, মূল্য, ডিসকাউন্ট, মেয়াদ ও ফিচার আলাদাভাবে নিয়ন্ত্রণ করুন — লাইভ ওয়েবসাইটে সাথে সাথে সিঙ্ক হয়।'
                    : 'Independently manage every package logo, price, discount, duration, and features — persisted in database and synced live.'}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={openAddPackage}
            className="px-4 py-2.5 rounded-xl bg-[#FF8500] hover:bg-[#e57600] text-white text-xs font-extrabold inline-flex items-center justify-center gap-2 shadow-sm shrink-0 transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>{lang === 'bn' ? 'নতুন প্যাকেজ যোগ করুন' : 'Add New Package'}</span>
          </button>
        </div>

        {/* Clean Tabular Summary Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4 pt-4 border-t border-slate-800">
          {[
            { label: lang === 'bn' ? 'মোট প্যাকেজ' : 'Total Packages', val: stats.total, color: 'text-white' },
            { label: lang === 'bn' ? 'সক্রিয়' : 'Active', val: stats.active, color: 'text-emerald-400' },
            { label: lang === 'bn' ? 'নিষ্ক্রিয়' : 'Inactive', val: stats.inactive, color: 'text-rose-400' },
            { label: lang === 'bn' ? 'ফিচার্ড' : 'Featured', val: stats.featured, color: 'text-amber-400' },
            { label: lang === 'bn' ? 'ডিসকাউন্টেড' : 'Discounted', val: stats.discounted, color: 'text-sky-400' },
          ].map((m) => (
            <div key={m.label} className="rounded-xl bg-slate-950/70 border border-slate-800/80 px-3.5 py-2.5">
              <p className="text-[11px] font-semibold text-slate-400">{m.label}</p>
              <p className={`text-xl font-extrabold font-mono-num mt-0.5 ${m.color}`}>{m.val}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Filter, Search & Sort Controls */}
      <div className="rounded-2xl bg-slate-900 border border-slate-800 p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-5 relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder={
                lang === 'bn'
                  ? 'প্যাকেজের নাম, ইউনিক ID, ক্যাটাগরি বা মূল্য খুঁজুন...'
                  : 'Search package name, unique ID, category, badge, price...'
              }
              className="w-full pl-10 pr-9 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-[#FF8500]"
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setPage(1);
                }}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="md:col-span-4">
            <select
              value={categoryFilter}
              onChange={(e) => {
                setCategoryFilter(e.target.value);
                setPage(1);
              }}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-[#FF8500]"
            >
              <option value="ALL">
                {lang === 'bn' ? `সব ক্যাটাগরি (${products.length})` : `All Categories (${products.length})`}
              </option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {lang === 'bn' ? cat.nameBn : cat.nameEn}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-3">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortOption)}
              className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-[#FF8500]"
            >
              <option value="sortOrder">{lang === 'bn' ? 'সাজান: ডিসপ্লে অর্ডার' : 'Sort: Display Order'}</option>
              <option value="price_asc">{lang === 'bn' ? 'মূল্য: কম থেকে বেশি' : 'Price: Low to High'}</option>
              <option value="price_desc">{lang === 'bn' ? 'মূল্য: বেশি থেকে কম' : 'Price: High to Low'}</option>
              <option value="updated_desc">{lang === 'bn' ? 'সাম্প্রতিক আপডেট' : 'Recently Updated'}</option>
              <option value="name_asc">{lang === 'bn' ? 'নাম (A → Z)' : 'Name (A → Z)'}</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: lang === 'bn' ? 'সব' : 'All', count: stats.total },
                { id: 'active', label: lang === 'bn' ? 'সক্রিয়' : 'Active', count: stats.active },
                { id: 'inactive', label: lang === 'bn' ? 'নিষ্ক্রিয়' : 'Inactive', count: stats.inactive },
                { id: 'featured', label: lang === 'bn' ? 'ফিচার্ড' : 'Featured', count: stats.featured },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.id);
                  setPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-[#FF8500] text-white'
                    : 'bg-slate-950 border border-slate-800 text-slate-300 hover:border-slate-700'
                }`}
              >
                {tab.label} <span className="font-mono-num opacity-80">({tab.count})</span>
              </button>
            ))}
          </div>

          <p className="text-[11px] font-mono-num text-slate-400">
            {lang === 'bn'
              ? `দেখানো হচ্ছে ${visibleProducts.length} / ${filteredProducts.length} প্যাকেজ`
              : `Showing ${visibleProducts.length} of ${filteredProducts.length} package(s)`}
          </p>
        </div>
      </div>

      {/* Package Management Cards Grid */}
      {visibleProducts.length === 0 ? (
        <div className="rounded-2xl bg-slate-900 border border-slate-800 p-10 text-center space-y-3">
          <Package className="w-8 h-8 text-slate-500 mx-auto" />
          <p className="text-sm font-bold text-slate-200">
            {lang === 'bn' ? 'কোনো প্যাকেজ পাওয়া যায়নি' : 'No matching packages found'}
          </p>
          <p className="text-xs text-slate-400">
            {lang === 'bn'
              ? 'সার্চ ফিল্টার পরিবর্তন করুন অথবা নতুন প্যাকেজ তৈরি করুন।'
              : 'Try adjusting your search or filter, or create a brand new package.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {visibleProducts.map((prod) => {
            const cat = categoryMap.get(prod.categoryId);
            const discount = calcDiscountPercent(prod.priceBdt, prod.originalPriceBdt || 0);
            const durationStr = resolveDurationDisplay(prod, lang);
            const isBusy = busyId === prod.id;
            const menuOpen = openMenuId === prod.id;

            return (
              <div
                key={prod.id}
                className={`rounded-2xl bg-slate-900 border transition-colors flex flex-col justify-between ${
                  prod.active
                    ? 'border-slate-800 hover:border-slate-700'
                    : 'border-rose-900/50 bg-slate-900/75 opacity-85'
                }`}
              >
                {/* Top Card Section */}
                <div className="p-4 space-y-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      {/* Independent Package Logo with Quick Upload Trigger */}
                      <button
                        type="button"
                        onClick={() => openQuickLogo(prod)}
                        title={lang === 'bn' ? 'প্যাকেজ লোগো পরিবর্তন করুন' : 'Change Package Logo'}
                        className="relative group shrink-0 rounded-xl focus:outline-none cursor-pointer"
                      >
                        <ServiceBrandLogo
                          brandKey={prod.brandKey}
                          customLogoUrl={prod.customLogoUrl}
                          size={48}
                        />
                        <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-md bg-slate-950 border border-slate-700 text-slate-200 group-hover:bg-[#FF8500] group-hover:border-[#FF8500] group-hover:text-white flex items-center justify-center transition-colors">
                          <Camera className="w-3 h-3" />
                        </span>
                      </button>

                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                              prod.active
                                ? 'bg-emerald-950/80 border border-emerald-800/70 text-emerald-400'
                                : 'bg-rose-950/80 border border-rose-800/70 text-rose-400'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${prod.active ? 'bg-emerald-400' : 'bg-rose-400'}`}
                            />
                            {prod.active ? 'Active' : 'Inactive'}
                          </span>
                          {prod.featured && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-amber-950/80 border border-amber-800/60 text-amber-400 text-[10px] font-bold">
                              <Star className="w-2.5 h-2.5 fill-amber-400" />
                              Featured
                            </span>
                          )}
                          {prod.badge && (
                            <span className="px-1.5 py-0.5 rounded-md bg-slate-800 border border-slate-700 text-slate-200 text-[10px] font-bold">
                              {prod.badge}
                            </span>
                          )}
                        </div>

                        <h3 className="text-sm font-extrabold text-white leading-snug mt-1.5 line-clamp-2">
                          {lang === 'bn' ? prod.titleBn : prod.titleEn}
                        </h3>
                        <p className="text-[10px] font-mono-num text-slate-400 truncate mt-0.5">
                          ID: {prod.id}
                        </p>
                      </div>
                    </div>

                    {/* More Options Menu */}
                    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => setOpenMenuId(menuOpen ? null : prod.id)}
                        aria-label="More package options"
                        className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>

                      {menuOpen && (
                        <div className="absolute right-0 mt-1.5 w-56 rounded-xl bg-slate-950 border border-slate-700 shadow-2xl py-1.5 z-40 text-xs">
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              openEditPackage(prod);
                            }}
                            className="w-full px-3.5 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center gap-2.5"
                          >
                            <Edit3 className="w-3.5 h-3.5 text-sky-400" />
                            <span>{lang === 'bn' ? 'সম্পূর্ণ এডিট করুন' : 'Edit Package'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              openQuickLogo(prod);
                            }}
                            className="w-full px-3.5 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center gap-2.5"
                          >
                            <ImageIcon className="w-3.5 h-3.5 text-violet-400" />
                            <span>{lang === 'bn' ? 'প্যাকেজ লোগো পরিবর্তন' : 'Change Package Logo'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              openQuickPrice(prod);
                            }}
                            className="w-full px-3.5 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center gap-2.5"
                          >
                            <BadgePercent className="w-3.5 h-3.5 text-[#FF8500]" />
                            <span>{lang === 'bn' ? 'মূল্য পরিবর্তন করুন' : 'Change Package Price'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              openQuickDuration(prod);
                            }}
                            className="w-full px-3.5 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center gap-2.5"
                          >
                            <Clock className="w-3.5 h-3.5 text-amber-400" />
                            <span>{lang === 'bn' ? 'মেয়াদ পরিবর্তন করুন' : 'Change Package Duration'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              openQuickFeatures(prod);
                            }}
                            className="w-full px-3.5 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center gap-2.5"
                          >
                            <ListChecks className="w-3.5 h-3.5 text-emerald-400" />
                            <span>{lang === 'bn' ? 'ফিচার আপডেট করুন' : 'Update Package Features'}</span>
                          </button>
                          <div className="my-1 border-t border-slate-800" />
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              void handleToggleActive(prod);
                            }}
                            className="w-full px-3.5 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center gap-2.5"
                          >
                            <Power className={`w-3.5 h-3.5 ${prod.active ? 'text-amber-400' : 'text-emerald-400'}`} />
                            <span>
                              {prod.active
                                ? lang === 'bn'
                                  ? 'প্যাকেজ নিষ্ক্রিয় করুন'
                                  : 'Deactivate Package'
                                : lang === 'bn'
                                  ? 'প্যাকেজ সক্রিয় করুন'
                                  : 'Activate Package'}
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              void handleDuplicate(prod);
                            }}
                            className="w-full px-3.5 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center gap-2.5"
                          >
                            <Copy className="w-3.5 h-3.5 text-slate-400" />
                            <span>{lang === 'bn' ? 'ডুপ্লিকেট করুন' : 'Duplicate Package'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              setPreviewTarget(prod);
                            }}
                            className="w-full px-3.5 py-2 text-left text-slate-200 hover:bg-slate-800 flex items-center gap-2.5"
                          >
                            <Eye className="w-3.5 h-3.5 text-sky-400" />
                            <span>{lang === 'bn' ? 'লাইভ প্রিভিউ' : 'Preview Package'}</span>
                          </button>
                          <div className="my-1 border-t border-slate-800" />
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenuId(null);
                              setDeleteTarget(prod);
                            }}
                            className="w-full px-3.5 py-2 text-left text-rose-400 hover:bg-rose-950/60 flex items-center gap-2.5 font-bold"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{lang === 'bn' ? 'প্যাকেজ মুছুন' : 'Delete Package'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Price & Duration Row */}
                  <div className="rounded-xl bg-slate-950 border border-slate-800/90 p-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        {lang === 'bn' ? 'বর্তমান মূল্য (BDT)' : 'Current Price (BDT)'}
                      </p>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="text-xl font-extrabold font-mono-num text-[#FF8500]">
                          ৳{prod.priceBdt}
                        </span>
                        {prod.originalPriceBdt && prod.originalPriceBdt > prod.priceBdt ? (
                          <span className="text-xs font-mono-num text-slate-500 line-through">
                            ৳{prod.originalPriceBdt}
                          </span>
                        ) : null}
                        {discount > 0 && (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-800 text-emerald-400 text-[10px] font-extrabold font-mono-num">
                            -{discount}%
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-right min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                        {lang === 'bn' ? 'মেয়াদ' : 'Duration'}
                      </p>
                      <p className="text-xs font-bold text-slate-200 truncate mt-1">{durationStr}</p>
                    </div>
                  </div>

                  {/* Meta Strip */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
                    <span className="truncate max-w-[60%]">
                      {cat ? (lang === 'bn' ? cat.nameBn : cat.nameEn) : prod.categoryId}
                      {prod.packages && prod.packages.length > 1 ? (
                        <span className="text-sky-400 font-mono-num ml-1.5">
                          · {prod.packages.length} plans
                        </span>
                      ) : null}
                    </span>
                    <span className="font-mono-num text-[10px] text-slate-500">
                      Order #{prod.sortOrder ?? 0}
                    </span>
                  </div>
                </div>

                {/* Card Footer Buttons */}
                <div className="px-4 py-3 border-t border-slate-800/90 bg-slate-950/50 rounded-b-2xl flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditPackage(prod)}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-[#FF8500]" />
                      <span>{lang === 'bn' ? 'এডিট' : 'Edit'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openQuickPrice(prod)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-[#FF8500] text-slate-200 text-xs font-bold inline-flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <span>৳</span>
                      <span className="hidden sm:inline">{lang === 'bn' ? 'মূল্য' : 'Price'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewTarget(prod)}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 hover:border-sky-500 text-slate-200 text-xs font-bold inline-flex items-center gap-1 transition-colors cursor-pointer"
                      title={lang === 'bn' ? 'প্রিভিউ দেখুন' : 'Preview Package'}
                    >
                      <Eye className="w-3.5 h-3.5 text-sky-400" />
                    </button>
                  </div>

                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleToggleActive(prod)}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer disabled:opacity-50 ${
                      prod.active
                        ? 'bg-emerald-950/60 border border-emerald-800/70 text-emerald-400 hover:bg-rose-950/60 hover:border-rose-800 hover:text-rose-400'
                        : 'bg-rose-950/60 border border-rose-800/70 text-rose-400 hover:bg-emerald-950/60 hover:border-emerald-800 hover:text-emerald-400'
                    }`}
                  >
                    {isBusy ? '...' : prod.active ? 'Active' : 'Inactive'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-900 border border-slate-800 px-4 py-3 text-xs">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-bold disabled:opacity-40 hover:border-[#FF8500] cursor-pointer"
          >
            ← {lang === 'bn' ? 'পূর্ববর্তী' : 'Previous'}
          </button>
          <span className="font-mono-num text-slate-400 font-bold">
            Page {safePage} / {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            className="px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-bold disabled:opacity-40 hover:border-[#FF8500] cursor-pointer"
          >
            {lang === 'bn' ? 'পরবর্তী' : 'Next'} →
          </button>
        </div>
      )}

      {/* ==================== MODAL A: FULL ADD / EDIT PACKAGE ==================== */}
      {editorDraft && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-xs">
          <div className="w-full max-w-4xl max-h-[92vh] rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl flex flex-col overflow-hidden text-slate-100">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between gap-3 shrink-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-[#FF8500]/15 border border-[#FF8500]/30 text-[#FF8500] flex items-center justify-center shrink-0">
                  <Package className="w-5 h-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-extrabold text-white truncate">
                    {editorDraft.isNew
                      ? lang === 'bn'
                        ? 'নতুন প্যাকেজ তৈরি করুন'
                        : 'Create New Package'
                      : lang === 'bn'
                        ? `প্যাকেজ এডিট: ${editorDraft.titleBn}`
                        : `Edit Package: ${editorDraft.titleEn}`}
                  </h3>
                  <p className="text-[11px] font-mono-num text-slate-400 truncate">
                    {editorDraft.isNew
                      ? 'Auto-assigns unique ID if left empty · Persists in live database'
                      : `ID: ${editorDraft.id}${editorDraft.updatedAt ? ` · Last updated ${formatDateShort(editorDraft.updatedAt, lang)}` : ''}`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={savingEditor}
                onClick={() => setEditorDraft(null)}
                className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleEditorSubmit} className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Section 1: Identity & Logo Upload */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                {/* Individual Logo Uploader */}
                <div className="lg:col-span-4 rounded-2xl bg-slate-950 border border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-white">
                      {lang === 'bn' ? 'প্যাকেজ লোগো / আইকন' : 'Package Logo / Icon'}
                    </span>
                    <span className="text-[10px] font-mono-num text-slate-400">PNG · JPG · WebP</span>
                  </div>

                  <div className="flex items-center gap-3.5">
                    {editorDraft.pendingLogoDataUrl || editorDraft.customLogoUrl ? (
                      <img
                        src={editorDraft.pendingLogoDataUrl || editorDraft.customLogoUrl}
                        alt="Package logo preview"
                        className="w-16 h-16 rounded-2xl object-cover border border-slate-700 bg-white shrink-0"
                      />
                    ) : (
                      <ServiceBrandLogo brandKey={editorDraft.brandKey} size={64} />
                    )}
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleEditorLogoFile}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => logoInputRef.current?.click()}
                        className="w-full px-3 py-2 rounded-xl bg-[#FF8500] hover:bg-[#e57600] text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>
                          {editorDraft.pendingLogoDataUrl || editorDraft.customLogoUrl
                            ? lang === 'bn'
                              ? 'লোগো পরিবর্তন'
                              : 'Replace Logo'
                            : lang === 'bn'
                              ? 'লোগো আপলোড'
                              : 'Upload Logo'}
                        </span>
                      </button>
                      {(editorDraft.pendingLogoDataUrl || editorDraft.customLogoUrl) && (
                        <button
                          type="button"
                          onClick={() =>
                            setEditorDraft((prev) =>
                              prev ? { ...prev, customLogoUrl: '', pendingLogoDataUrl: '' } : prev
                            )
                          }
                          className="w-full px-3 py-1.5 rounded-xl bg-slate-900 border border-rose-900/60 text-rose-400 hover:bg-rose-950/60 text-[11px] font-bold cursor-pointer"
                        >
                          {lang === 'bn' ? 'লোগো রিমুভ করুন' : 'Remove Logo'}
                        </button>
                      )}
                    </div>
                  </div>
                  {editorDraft.pendingLogoDataUrl && (
                    <p className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Preview ready — uploads permanently on Save
                    </p>
                  )}

                  {/* Optional Cover Banner Upload */}
                  <div className="pt-3 border-t border-slate-800 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-300">
                        {lang === 'bn' ? 'কার্ড ব্যানার ছবি (ঐচ্ছিক)' : 'Card Cover Image (Optional)'}
                      </span>
                      <input
                        ref={coverInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleEditorCoverFile}
                        className="hidden"
                      />
                      <button
                        type="button"
                        onClick={() => coverInputRef.current?.click()}
                        className="text-[11px] font-bold text-[#FF8500] hover:underline cursor-pointer"
                      >
                        {lang === 'bn' ? 'ছবি আপলোড' : 'Upload Cover'}
                      </button>
                    </div>
                    {(editorDraft.pendingCoverDataUrl || editorDraft.imageUrl) && (
                      <img
                        src={editorDraft.pendingCoverDataUrl || editorDraft.imageUrl}
                        alt="Cover preview"
                        className="w-full h-24 rounded-xl object-cover border border-slate-800 bg-slate-900"
                      />
                    )}
                  </div>
                </div>

                {/* Core Package Fields */}
                <div className="lg:col-span-8 space-y-3.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">
                        Package Name (English) *
                      </label>
                      <input
                        required
                        value={editorDraft.titleEn}
                        onChange={(e) => setEditorDraft({ ...editorDraft, titleEn: e.target.value })}
                        placeholder="e.g. CapCut Pro 1 Month Private"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-[#FF8500]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">
                        প্যাকেজের নাম (বাংলা)
                      </label>
                      <input
                        value={editorDraft.titleBn}
                        onChange={(e) => setEditorDraft({ ...editorDraft, titleBn: e.target.value })}
                        placeholder="যেমন: ক্যাপকাট প্রো ১ মাস প্রাইভেট"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-[#FF8500]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">
                        Unique Package ID
                      </label>
                      <input
                        disabled={!editorDraft.isNew}
                        value={editorDraft.id}
                        onChange={(e) => setEditorDraft({ ...editorDraft, id: e.target.value })}
                        placeholder="Auto-generated if blank"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono-num text-slate-200 disabled:opacity-60 focus:outline-none focus:border-[#FF8500]"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">Category *</label>
                      <select
                        value={editorDraft.categoryId}
                        onChange={(e) => setEditorDraft({ ...editorDraft, categoryId: e.target.value })}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-[#FF8500]"
                      >
                        {categories.map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {lang === 'bn' ? cat.nameBn : cat.nameEn}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">
                        Badge (Popular / Premium / Best Value)
                      </label>
                      <input
                        list="dh-badge-presets"
                        value={editorDraft.badge}
                        onChange={(e) => setEditorDraft({ ...editorDraft, badge: e.target.value })}
                        placeholder="Popular, Premium, Best Value..."
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-[#FF8500]"
                      />
                      <datalist id="dh-badge-presets">
                        {BADGE_PRESETS.filter(Boolean).map((b) => (
                          <option key={b} value={b} />
                        ))}
                      </datalist>
                    </div>
                  </div>

                  {/* Pricing Controls Box */}
                  <div className="rounded-2xl bg-slate-950 border border-slate-800 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5 text-[#FF8500]" />
                        {lang === 'bn' ? 'মূল্য এবং অটো ডিসকাউন্ট (BDT ৳)' : 'Pricing & Auto Discount (BDT ৳)'}
                      </span>
                      {liveEditorDiscount > 0 ? (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-950 border border-emerald-800 text-emerald-400 text-[11px] font-extrabold font-mono-num">
                          Auto Discount: -{liveEditorDiscount}%
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-500">No active discount</span>
                      )}
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 mb-1">
                          Current / Discounted Price (৳) *
                        </label>
                        <input
                          required
                          type="number"
                          min={1}
                          step={1}
                          value={editorDraft.priceBdt}
                          onChange={(e) => setEditorDraft({ ...editorDraft, priceBdt: e.target.value })}
                          placeholder="e.g. 499"
                          className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm font-extrabold font-mono-num text-[#FF8500] focus:outline-none focus:border-[#FF8500]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 mb-1">
                          Previous / Regular Price (৳, Optional)
                        </label>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={editorDraft.originalPriceBdt}
                          onChange={(e) => setEditorDraft({ ...editorDraft, originalPriceBdt: e.target.value })}
                          placeholder="e.g. 699"
                          className="w-full px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-sm font-mono-num text-slate-200 focus:outline-none focus:border-[#FF8500]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-bold text-slate-300 mb-1">Currency</label>
                        <input
                          disabled
                          value="BDT (৳)"
                          className="w-full px-3 py-2 rounded-xl bg-slate-900/60 border border-slate-800 text-xs font-mono-num text-slate-400"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Duration & Delivery Controls */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">Duration Value</label>
                      <input
                        type="number"
                        min={1}
                        disabled={editorDraft.durationUnit === 'lifetime'}
                        value={editorDraft.durationValue}
                        onChange={(e) => {
                          const val = e.target.value;
                          const lbl = buildDurationLabels(Number(val) || 1, editorDraft.durationUnit);
                          setEditorDraft({
                            ...editorDraft,
                            durationValue: val,
                            durationLabelEn: lbl.en,
                            durationLabelBn: lbl.bn,
                          });
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono-num text-white disabled:opacity-50"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">Duration Unit</label>
                      <select
                        value={editorDraft.durationUnit}
                        onChange={(e) => {
                          const unit = e.target.value as DurationUnit;
                          const lbl = buildDurationLabels(Number(editorDraft.durationValue) || 1, unit);
                          setEditorDraft({
                            ...editorDraft,
                            durationUnit: unit,
                            durationLabelEn: lbl.en,
                            durationLabelBn: lbl.bn,
                          });
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                      >
                        <option value="days">Days</option>
                        <option value="months">Months</option>
                        <option value="years">Years</option>
                        <option value="lifetime">Lifetime</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">Duration Label (EN)</label>
                      <input
                        value={editorDraft.durationLabelEn}
                        onChange={(e) => setEditorDraft({ ...editorDraft, durationLabelEn: e.target.value })}
                        placeholder="1 Month (30 Days)"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-300 mb-1">Delivery Speed</label>
                      <input
                        value={editorDraft.deliveryDurationEn}
                        onChange={(e) =>
                          setEditorDraft({
                            ...editorDraft,
                            deliveryDurationEn: e.target.value,
                            deliveryDurationBn: e.target.value,
                          })
                        }
                        placeholder="5 - 15 mins"
                        className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 2: Description & Features List */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">Description (English)</label>
                    <textarea
                      rows={3}
                      value={editorDraft.descriptionEn}
                      onChange={(e) => setEditorDraft({ ...editorDraft, descriptionEn: e.target.value })}
                      placeholder="Clear package description shown on product detail page..."
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-300 mb-1">বিবরণ (বাংলা)</label>
                    <textarea
                      rows={3}
                      value={editorDraft.descriptionBn}
                      onChange={(e) => setEditorDraft({ ...editorDraft, descriptionBn: e.target.value })}
                      placeholder="প্যাকেজের বিস্তারিত বাংলায়..."
                      className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-[#FF8500]"
                    />
                  </div>
                </div>

                {/* Dynamic Features List Editor */}
                <div className="rounded-2xl bg-slate-950 border border-slate-800 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                      <ListChecks className="w-3.5 h-3.5 text-emerald-400" />
                      Package Features List ({editorDraft.features.length})
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={newFeatureInput}
                      onChange={(e) => setNewFeatureInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const trimmed = newFeatureInput.trim();
                          if (trimmed) {
                            setEditorDraft({
                              ...editorDraft,
                              features: [...editorDraft.features, trimmed],
                            });
                            setNewFeatureInput('');
                          }
                        }
                      }}
                      placeholder="Add a feature (press Enter or +)"
                      className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-[#FF8500]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const trimmed = newFeatureInput.trim();
                        if (trimmed) {
                          setEditorDraft({
                            ...editorDraft,
                            features: [...editorDraft.features, trimmed],
                          });
                          setNewFeatureInput('');
                        }
                      }}
                      className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {editorDraft.features.map((feat, idx) => (
                      <div
                        key={`${idx}-${feat.slice(0, 12)}`}
                        className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5"
                      >
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        <input
                          value={feat}
                          onChange={(e) => {
                            const next = [...editorDraft.features];
                            next[idx] = e.target.value;
                            setEditorDraft({ ...editorDraft, features: next });
                          }}
                          className="flex-1 bg-transparent text-xs text-slate-200 focus:outline-none"
                        />
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => {
                            const next = [...editorDraft.features];
                            [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                            setEditorDraft({ ...editorDraft, features: next });
                          }}
                          className="p-1 text-slate-400 hover:text-white disabled:opacity-30"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === editorDraft.features.length - 1}
                          onClick={() => {
                            const next = [...editorDraft.features];
                            [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
                            setEditorDraft({ ...editorDraft, features: next });
                          }}
                          className="p-1 text-slate-400 hover:text-white disabled:opacity-30"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setEditorDraft({
                              ...editorDraft,
                              features: editorDraft.features.filter((_, i) => i !== idx),
                            })
                          }
                          className="p-1 text-rose-400 hover:text-rose-300"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                    {editorDraft.features.length === 0 && (
                      <p className="text-[11px] text-slate-500 text-center py-3">
                        No bullet features added yet.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 3: Sub-Plans (if multi-tier package) */}
              {editorDraft.packages.length > 0 && (
                <div className="rounded-2xl bg-slate-950 border border-slate-800 p-4 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-sky-400" />
                      Sub-Tier Plans ({editorDraft.packages.length})
                    </span>
                  </div>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {editorDraft.packages.map((pk, idx) => (
                      <div key={pk.id || idx} className="grid grid-cols-12 gap-2 items-center">
                        <input
                          value={pk.nameEn}
                          onChange={(e) => {
                            const next = [...editorDraft.packages];
                            next[idx] = { ...next[idx], nameEn: e.target.value, nameBn: e.target.value };
                            setEditorDraft({ ...editorDraft, packages: next });
                          }}
                          placeholder="Plan name"
                          className="col-span-6 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white"
                        />
                        <input
                          type="number"
                          min={1}
                          value={pk.priceBdt}
                          onChange={(e) => {
                            const next = [...editorDraft.packages];
                            next[idx] = { ...next[idx], priceBdt: Math.max(1, Number(e.target.value) || 1) };
                            setEditorDraft({ ...editorDraft, packages: next });
                          }}
                          placeholder="Price ৳"
                          className="col-span-3 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono-num text-[#FF8500] font-bold"
                        />
                        <input
                          value={pk.tag || ''}
                          onChange={(e) => {
                            const next = [...editorDraft.packages];
                            next[idx] = { ...next[idx], tag: e.target.value };
                            setEditorDraft({ ...editorDraft, packages: next });
                          }}
                          placeholder="Tag"
                          className="col-span-2 px-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-300"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setEditorDraft({
                              ...editorDraft,
                              packages: editorDraft.packages.filter((_, i) => i !== idx),
                            })
                          }
                          className="col-span-1 p-1.5 text-rose-400 hover:text-rose-300 flex justify-center"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 4: Display Order, Availability, Visibility & Timestamps */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">Display Order</label>
                  <input
                    type="number"
                    min={0}
                    value={editorDraft.sortOrder}
                    onChange={(e) => setEditorDraft({ ...editorDraft, sortOrder: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono-num text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">Availability</label>
                  <select
                    value={editorDraft.availability}
                    onChange={(e) =>
                      setEditorDraft({
                        ...editorDraft,
                        availability: e.target.value as 'in_stock' | 'limited' | 'out_of_stock',
                      })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                  >
                    <option value="in_stock">In Stock</option>
                    <option value="limited">Limited</option>
                    <option value="out_of_stock">Out of Stock</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">Stock Count</label>
                  <input
                    type="number"
                    min={0}
                    value={editorDraft.stockCount}
                    onChange={(e) => setEditorDraft({ ...editorDraft, stockCount: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono-num text-white"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">Homepage Section</label>
                  <select
                    value={editorDraft.sectionTag}
                    onChange={(e) =>
                      setEditorDraft({ ...editorDraft, sectionTag: e.target.value as ProductSectionTag })
                    }
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white"
                  >
                    <option value="standard">Standard Catalog</option>
                    <option value="flash_sale">Flash Sale</option>
                    <option value="hot_product">Hot Product</option>
                    <option value="trending">Trending</option>
                    <option value="best_seller">Best Seller</option>
                    <option value="new_arrival">New Arrival</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-slate-950 border border-slate-800 px-4 py-3">
                <div className="flex flex-wrap items-center gap-5">
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editorDraft.active}
                      onChange={(e) => setEditorDraft({ ...editorDraft, active: e.target.checked })}
                      className="w-4 h-4 accent-[#FF8500]"
                    />
                    <span>{lang === 'bn' ? 'সক্রিয় (স্টোরফ্রন্টে দৃশ্যমান)' : 'Active (Visible on Storefront)'}</span>
                  </label>
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editorDraft.featured}
                      onChange={(e) => setEditorDraft({ ...editorDraft, featured: e.target.checked })}
                      className="w-4 h-4 accent-[#FF8500]"
                    />
                    <span>{lang === 'bn' ? 'ফিচার্ড প্যাকেজ' : 'Featured Package'}</span>
                  </label>
                </div>
                {!editorDraft.isNew && (
                  <div className="text-[10px] font-mono-num text-slate-500 flex items-center gap-3">
                    {editorDraft.createdAt ? (
                      <span>Created: {formatDateShort(editorDraft.createdAt, lang)}</span>
                    ) : null}
                    {editorDraft.updatedAt ? (
                      <span>Updated: {formatDateShort(editorDraft.updatedAt, lang)}</span>
                    ) : null}
                  </div>
                )}
              </div>

              {/* Sticky Footer Buttons */}
              <div className="pt-2 border-t border-slate-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  disabled={savingEditor}
                  onClick={() => setEditorDraft(null)}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold cursor-pointer"
                >
                  {lang === 'bn' ? 'বাতিল' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={savingEditor}
                  className="px-5 py-2.5 rounded-xl bg-[#FF8500] hover:bg-[#e57600] text-white text-xs font-extrabold disabled:opacity-50 cursor-pointer"
                >
                  {savingEditor
                    ? lang === 'bn'
                      ? 'সংরক্ষণ হচ্ছে...'
                      : 'Saving...'
                    : editorDraft.isNew
                      ? lang === 'bn'
                        ? 'প্যাকেজ তৈরি করুন'
                        : 'Create Package'
                      : lang === 'bn'
                        ? 'পরিবর্তন সংরক্ষণ করুন'
                        : 'Save Package Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL B: QUICK CHANGE PACKAGE LOGO ==================== */}
      {quickLogoTarget && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden text-slate-100">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold text-white truncate">
                  {lang === 'bn' ? 'প্যাকেজ লোগো পরিবর্তন' : 'Change Package Logo'}
                </h3>
                <p className="text-[11px] text-slate-400 truncate">{quickLogoTarget.titleEn}</p>
              </div>
              <button
                type="button"
                disabled={quickLogoBusy}
                onClick={() => setQuickLogoTarget(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex flex-col items-center gap-3 p-5 rounded-2xl bg-slate-950 border border-slate-800">
                {!quickLogoRemoved && (quickLogoPreview || quickLogoTarget.customLogoUrl) ? (
                  <img
                    src={quickLogoPreview || quickLogoTarget.customLogoUrl}
                    alt={quickLogoTarget.titleEn}
                    className="w-24 h-24 rounded-2xl object-cover border border-slate-700 bg-white shadow-lg"
                  />
                ) : (
                  <ServiceBrandLogo brandKey={quickLogoTarget.brandKey} size={88} />
                )}
                <p className="text-[11px] text-slate-400 text-center">
                  {quickLogoPreview
                    ? 'New image preview ready. Click Save Logo to upload permanently.'
                    : quickLogoRemoved
                      ? 'Custom logo will be removed (reverts to default brand icon).'
                      : 'Upload PNG, JPG, JPEG, or WebP from phone or computer.'}
                </p>
              </div>

              <input
                ref={quickLogoInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={handleQuickLogoFile}
                className="hidden"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => quickLogoInputRef.current?.click()}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-4 h-4 text-[#FF8500]" />
                  <span>{lang === 'bn' ? 'ছবি বাছাই করুন' : 'Choose Image'}</span>
                </button>
                {(quickLogoPreview || quickLogoTarget.customLogoUrl) && !quickLogoRemoved && (
                  <button
                    type="button"
                    onClick={() => {
                      setQuickLogoPreview('');
                      setQuickLogoRemoved(true);
                    }}
                    className="px-3.5 py-2.5 rounded-xl bg-rose-950/60 border border-rose-800/70 text-rose-400 text-xs font-bold cursor-pointer"
                  >
                    {lang === 'bn' ? 'রিমুভ' : 'Remove'}
                  </button>
                )}
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-800 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={quickLogoBusy}
                onClick={() => setQuickLogoTarget(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={quickLogoBusy || (!quickLogoPreview && !quickLogoRemoved)}
                onClick={() => void saveQuickLogo()}
                className="px-4 py-2 rounded-xl bg-[#FF8500] hover:bg-[#e57600] text-white text-xs font-extrabold disabled:opacity-40 cursor-pointer"
              >
                {quickLogoBusy ? 'Uploading...' : 'Save Logo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== MODAL C: QUICK CHANGE PACKAGE PRICE ==================== */}
      {quickPriceTarget && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden text-slate-100">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold text-white truncate">
                  {lang === 'bn' ? 'প্যাকেজ মূল্য পরিবর্তন' : 'Change Package Price'}
                </h3>
                <p className="text-[11px] text-slate-400 truncate">{quickPriceTarget.titleEn}</p>
              </div>
              <button
                type="button"
                disabled={quickPriceBusy}
                onClick={() => setQuickPriceTarget(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={requestQuickPriceConfirm} className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Current Price (BDT ৳) *
                  </label>
                  <input
                    required
                    type="number"
                    min={1}
                    step={1}
                    value={quickPriceVal}
                    onChange={(e) => setQuickPriceVal(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-base font-extrabold font-mono-num text-[#FF8500] focus:outline-none focus:border-[#FF8500]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">
                    Previous Price (Optional ৳)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={quickOrigPriceVal}
                    onChange={(e) => setQuickOrigPriceVal(e.target.value)}
                    placeholder="0"
                    className="w-full px-3 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-base font-mono-num text-slate-200 focus:outline-none focus:border-[#FF8500]"
                  />
                </div>
              </div>

              <div className="rounded-xl bg-slate-950 border border-slate-800 px-3.5 py-2.5 flex items-center justify-between text-xs">
                <span className="text-slate-400">Auto-Calculated Discount</span>
                <span
                  className={`font-extrabold font-mono-num ${
                    liveQuickDiscount > 0 ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {liveQuickDiscount > 0 ? `-${liveQuickDiscount}% OFF` : '0%'}
                </span>
              </div>

              {quickSubPackages.length > 0 && (
                <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                  <p className="text-[11px] font-bold text-slate-300">Sub-Plan Prices (BDT ৳)</p>
                  {quickSubPackages.map((pk, idx) => (
                    <div key={pk.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-slate-300 flex-1">{pk.nameEn}</span>
                      <input
                        type="number"
                        min={1}
                        value={pk.priceBdt}
                        onChange={(e) => {
                          const next = [...quickSubPackages];
                          next[idx] = { ...next[idx], priceBdt: Math.max(1, Number(e.target.value) || 1) };
                          setQuickSubPackages(next);
                        }}
                        className="w-24 px-2.5 py-1 rounded-lg bg-slate-950 border border-slate-700 font-mono-num font-bold text-[#FF8500]"
                      />
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[11px] text-slate-400 leading-relaxed">
                Historical completed orders automatically preserve their original purchase price.
              </p>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setQuickPriceTarget(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[#FF8500] hover:bg-[#e57600] text-white text-xs font-extrabold cursor-pointer"
                >
                  Review & Confirm Price
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL D: QUICK CHANGE DURATION ==================== */}
      {quickDurationTarget && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden text-slate-100">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold text-white truncate">Change Package Duration</h3>
                <p className="text-[11px] text-slate-400 truncate">{quickDurationTarget.titleEn}</p>
              </div>
              <button
                type="button"
                disabled={quickDurBusy}
                onClick={() => setQuickDurationTarget(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={saveQuickDuration} className="p-5 space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">Value</label>
                  <input
                    type="number"
                    min={1}
                    disabled={quickDurUnit === 'lifetime'}
                    value={quickDurValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      const lbl = buildDurationLabels(Number(v) || 1, quickDurUnit);
                      setQuickDurValue(v);
                      setQuickDurLabelEn(lbl.en);
                      setQuickDurLabelBn(lbl.bn);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono-num text-white disabled:opacity-40"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 mb-1">Unit</label>
                  <select
                    value={quickDurUnit}
                    onChange={(e) => {
                      const u = e.target.value as DurationUnit;
                      const lbl = buildDurationLabels(Number(quickDurValue) || 1, u);
                      setQuickDurUnit(u);
                      setQuickDurLabelEn(lbl.en);
                      setQuickDurLabelBn(lbl.bn);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                  >
                    <option value="days">Days</option>
                    <option value="months">Months</option>
                    <option value="years">Years</option>
                    <option value="lifetime">Lifetime</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">Display Label (English)</label>
                <input
                  value={quickDurLabelEn}
                  onChange={(e) => setQuickDurLabelEn(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-slate-300 mb-1">ডিসপ্লে লেবেল (বাংলা)</label>
                <input
                  value={quickDurLabelBn}
                  onChange={(e) => setQuickDurLabelBn(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                />
              </div>
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setQuickDurationTarget(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={quickDurBusy}
                  className="px-4 py-2 rounded-xl bg-[#FF8500] hover:bg-[#e57600] text-white text-xs font-extrabold disabled:opacity-50 cursor-pointer"
                >
                  {quickDurBusy ? 'Saving...' : 'Save Duration'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL E: QUICK UPDATE FEATURES ==================== */}
      {quickFeaturesTarget && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden text-slate-100">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold text-white truncate">Update Package Features</h3>
                <p className="text-[11px] text-slate-400 truncate">{quickFeaturesTarget.titleEn}</p>
              </div>
              <button
                type="button"
                disabled={quickFeaturesBusy}
                onClick={() => setQuickFeaturesTarget(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={saveQuickFeatures} className="p-5 space-y-3.5">
              <div className="flex gap-2">
                <input
                  value={quickFeatureDraft}
                  onChange={(e) => setQuickFeatureDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const v = quickFeatureDraft.trim();
                      if (v) {
                        setQuickFeaturesList((prev) => [...prev, v]);
                        setQuickFeatureDraft('');
                      }
                    }
                  }}
                  placeholder="Enter new feature bullet..."
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white"
                />
                <button
                  type="button"
                  onClick={() => {
                    const v = quickFeatureDraft.trim();
                    if (v) {
                      setQuickFeaturesList((prev) => [...prev, v]);
                      setQuickFeatureDraft('');
                    }
                  }}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                >
                  Add
                </button>
              </div>

              <div className="space-y-1.5 max-h-60 overflow-y-auto pr-1">
                {quickFeaturesList.map((feat, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2"
                  >
                    <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <input
                      value={feat}
                      onChange={(e) => {
                        const next = [...quickFeaturesList];
                        next[idx] = e.target.value;
                        setQuickFeaturesList(next);
                      }}
                      className="flex-1 bg-transparent text-xs text-slate-100 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setQuickFeaturesList((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-rose-400 hover:text-rose-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {quickFeaturesList.length === 0 && (
                  <p className="text-xs text-slate-500 text-center py-4">No features listed yet.</p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setQuickFeaturesTarget(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 text-slate-200 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={quickFeaturesBusy}
                  className="px-4 py-2 rounded-xl bg-[#FF8500] hover:bg-[#e57600] text-white text-xs font-extrabold disabled:opacity-50 cursor-pointer"
                >
                  {quickFeaturesBusy ? 'Saving...' : 'Save Features'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ==================== MODAL F: LIVE STOREFRONT PREVIEW ==================== */}
      {previewTarget && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden text-slate-100">
            <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#FF8500]" />
                <h3 className="text-sm font-extrabold text-white">Live Storefront Preview</h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTarget(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 bg-[#F3F6FF] space-y-4">
              <div className="max-w-xs mx-auto">
                <ProductCard
                  product={previewTarget}
                  lang={lang}
                  onSelect={() => {}}
                  onQuickOrder={() => {}}
                  onAddToCart={() => {}}
                />
              </div>
              {extractFeaturesList(previewTarget).length > 0 && (
                <div className="rounded-xl bg-white border border-[#E6ECFA] p-3.5 space-y-1.5">
                  <p className="text-[11px] font-extrabold text-[#172033]">Features Preview</p>
                  <ul className="space-y-1 text-xs text-[#5C6B84]">
                    {extractFeaturesList(previewTarget).map((f, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
              <span>Status: {previewTarget.active ? 'Live on Storefront' : 'Hidden (Inactive)'}</span>
              <button
                type="button"
                onClick={() => setPreviewTarget(null)}
                className="px-4 py-1.5 rounded-lg bg-slate-800 text-white font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================== CONFIRMATION DIALOGS ==================== */}
      <ConfirmDialog
        open={Boolean(pendingEditorPriceConfirm)}
        lang={lang}
        tone="warning"
        optionalReason
        title={lang === 'bn' ? 'প্যাকেজ মূল্য পরিবর্তন নিশ্চিত করুন' : 'Confirm Package Price Change'}
        description={
          pendingEditorPriceConfirm && editorDraft
            ? `You are changing "${editorDraft.titleEn}" from ৳${pendingEditorPriceConfirm.oldPrice} to ৳${pendingEditorPriceConfirm.newPrice}. The new price will immediately apply on the live website. Existing completed orders keep their original purchase price.`
            : ''
        }
        confirmLabel={lang === 'bn' ? 'হ্যাঁ, নতুন মূল্য সেভ করুন' : 'Confirm & Save New Price'}
        busy={savingEditor}
        onCancel={() => setPendingEditorPriceConfirm(null)}
        onConfirm={(reason) => commitEditorSave(reason)}
      />

      <ConfirmDialog
        open={quickPriceConfirmOpen && Boolean(quickPriceTarget)}
        lang={lang}
        tone="warning"
        optionalReason
        title={lang === 'bn' ? 'প্যাকেজ মূল্য পরিবর্তন নিশ্চিত করুন' : 'Confirm Package Price Change'}
        description={
          quickPriceTarget
            ? `Confirm updating "${quickPriceTarget.titleEn}" from ৳${quickPriceTarget.priceBdt} to ৳${quickPriceVal}${liveQuickDiscount > 0 ? ` (-${liveQuickDiscount}% auto discount)` : ''}. Previous orders remain unaffected.`
            : ''
        }
        confirmLabel={lang === 'bn' ? 'মূল্য আপডেট করুন' : 'Confirm Price Update'}
        busy={quickPriceBusy}
        onCancel={() => setQuickPriceConfirmOpen(false)}
        onConfirm={(reason) => commitQuickPrice(reason)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        lang={lang}
        tone="danger"
        title={lang === 'bn' ? 'প্যাকেজ স্থায়ীভাবে মুছবেন?' : 'Delete Package Permanently?'}
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.titleEn}" (ID: ${deleteTarget.id})? It will be removed from the storefront immediately. Historical order records will stay safely preserved.`
            : ''
        }
        confirmLabel={lang === 'bn' ? 'হ্যাঁ, প্যাকেজ মুছুন' : 'Delete Package'}
        busy={deleting}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
