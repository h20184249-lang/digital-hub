import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { apiUrl } from './apiClient';
import {
  logoutAllSessions,
  normalizeBangladeshPhoneClient,
} from './authClient';
import {
  DEFAULT_AD_NETWORKS,
  DEFAULT_ADVERTISEMENTS,
  DEFAULT_BANNERS,
  DEFAULT_CATEGORIES,
  DEFAULT_COUPONS,
  DEFAULT_HERO_BANNERS,
  DEFAULT_PRODUCTS,
  DEFAULT_SITE_SETTINGS,
} from './seedData';
import { DIGITAL_HUB_AD_PROVIDER_CONFIG, mergeAdUnitsWithOverrides } from './adProviderConfig';
import { mergeGamesCatalog } from './gamesCatalog';
import { mergeMobileAppsCatalog, MobileAppItem } from './mobileAppsCatalog';
import {
  AccountDeletionRequest,
  AdNetworkConfig,
  AdPlacementSlot,
  AdRevenueEntry,
  AdRewardTransaction,
  AdViewingSession,
  AdminAnalyticsPayload,
  AdminCoinsOverview,
  AdminRecord,
  AdminSecurityPayload,
  AdminUserDetailPayload,
  Advertisement,
  AnalyticsEventType,
  Announcement,
  AnnouncementType,
  AppBrokenReport,
  AppMetaPayload,
  AppNotification,
  AuditLog,
  AuthUser,
  Banner,
  CartItem,
  Category,
  Coupon,
  DailyRewardClaimRecord,
  DailyRewardStatus,
  DownloadHistoryItem,
  GameItem,
  GameMetaPayload,
  HeroBanner,
  ManagedAdUnitConfig,
  Order,
  OrderStatus,
  Payment,
  PaymentMethod,
  PaymentMethodConfig,
  Product,
  Referral,
  Review,
  RewardedAdClaim,
  ServerAdAnalytics,
  SiteSettings,
  SupportTicket,
  UserProfile,
  WalletAccount,
  WalletTransaction,
  WithdrawalRequest,
  WithdrawalStatus,
} from '../types/marketplace';

export { normalizeBangladeshPhoneClient };

export function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120);
}

export function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return sanitizeId(`${prefix}_${Date.now()}_${rand}`);
}

export async function compressImageToDataUrl(file: File, maxWidth = 900, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxWidth / img.width);
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas context unavailable'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        let dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (dataUrl.length > 185000) {
          dataUrl = canvas.toDataURL('image/jpeg', 0.45);
        }
        if (dataUrl.length > 185000) {
          const smallCanvas = document.createElement('canvas');
          const sw = Math.max(1, Math.round(w * 0.65));
          const sh = Math.max(1, Math.round(h * 0.65));
          smallCanvas.width = sw;
          smallCanvas.height = sh;
          const sctx = smallCanvas.getContext('2d');
          if (sctx) {
            sctx.drawImage(canvas, 0, 0, sw, sh);
            dataUrl = smallCanvas.toDataURL('image/jpeg', 0.45);
          }
        }
        resolve(dataUrl.slice(0, 195000));
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = String(reader.result || '');
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

// =========================================================================
// REACTIVE INVALIDATION BUS (DASHBOARD & CATALOG OVERRIDES)
// =========================================================================

const dashboardListeners = new Set<() => void>();
const catalogListeners = new Set<() => void>();

export function subscribeDashboardInvalidation(cb: () => void): () => void {
  dashboardListeners.add(cb);
  return () => {
    dashboardListeners.delete(cb);
  };
}

export function notifyDashboardInvalidation(): void {
  adminSnapshotCache = null;
  dashboardListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Non-fatal
    }
  });
}

export function subscribeCatalogInvalidation(cb: () => void): () => void {
  catalogListeners.add(cb);
  return () => {
    catalogListeners.delete(cb);
  };
}

export function notifyCatalogInvalidation(): void {
  catalogOverridesCache = null;
  catalogListeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // Non-fatal
    }
  });
}

// =========================================================================
// COOKIE-AUTHENTICATED API HELPERS (NO FIREBASE AUTH)
// =========================================================================

async function apiJson<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown } = {}
): Promise<T> {
  const method = options.method || 'GET';
  const resp = await fetch(apiUrl(path), {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = (await resp.json().catch(() => ({}))) as T & {
    ok?: boolean;
    error?: string;
    message?: string;
    code?: string;
  };
  if (!resp.ok || data.ok === false) {
    const err = new Error(data.error || data.message || `Request failed (${resp.status})`) as Error & {
      code?: string;
      status?: number;
    };
    err.code = data.code;
    err.status = resp.status;
    throw err;
  }
  return data;
}

// =========================================================================
// PUBLIC CATALOG OVERRIDES CACHE (D1 / SQLITE + FIRESTORE READ-ONLY FALLBACK)
// =========================================================================

interface CatalogOverrideRow {
  id: string;
  deleted: boolean;
  data: Record<string, unknown>;
}

interface CatalogOverridesPayload {
  overrides: Record<string, CatalogOverrideRow[]>;
  reviews: Review[];
  announcements: Announcement[];
  paymentMethods: PaymentMethodConfig[];
  allPaymentMethods: PaymentMethodConfig[];
}

let catalogOverridesCache: { ts: number; data: CatalogOverridesPayload } | null = null;
let catalogOverridesInFlight: Promise<CatalogOverridesPayload> | null = null;

async function fetchCatalogOverrides(force = false): Promise<CatalogOverridesPayload> {
  const now = Date.now();
  if (!force && catalogOverridesCache && now - catalogOverridesCache.ts < 15000) {
    return catalogOverridesCache.data;
  }
  if (!force && catalogOverridesInFlight) {
    return catalogOverridesInFlight;
  }
  catalogOverridesInFlight = (async () => {
    try {
      const resp = await fetch(apiUrl('/api/catalog/overrides'), {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!resp.ok) {
        return { overrides: {}, reviews: [], announcements: [], paymentMethods: [], allPaymentMethods: [] };
      }
      const json = (await resp.json().catch(() => ({}))) as Partial<CatalogOverridesPayload>;
      const pmList = Array.isArray(json.paymentMethods) ? json.paymentMethods : [];
      const payload: CatalogOverridesPayload = {
        overrides: json.overrides || {},
        reviews: Array.isArray(json.reviews) ? json.reviews : [],
        announcements: Array.isArray(json.announcements) ? json.announcements : [],
        paymentMethods: pmList,
        allPaymentMethods: Array.isArray(json.allPaymentMethods) ? json.allPaymentMethods : pmList,
      };
      catalogOverridesCache = { ts: Date.now(), data: payload };
      return payload;
    } catch {
      return { overrides: {}, reviews: [], announcements: [], paymentMethods: [], allPaymentMethods: [] };
    } finally {
      catalogOverridesInFlight = null;
    }
  })();
  return catalogOverridesInFlight;
}

function applyCollectionOverrides<T extends { id: string }>(
  baseItems: T[],
  rows?: CatalogOverrideRow[]
): T[] {
  if (!rows || rows.length === 0) return baseItems;
  const map = new Map<string, T>();
  baseItems.forEach((item) => map.set(item.id, item));
  for (const row of rows) {
    if (row.deleted) {
      map.delete(row.id);
    } else if (row.data && typeof row.data === 'object') {
      const prev = map.get(row.id);
      map.set(row.id, { ...(prev || {}), ...(row.data as unknown as T), id: row.id });
    }
  }
  return Array.from(map.values());
}

// =========================================================================
// PUBLIC STOREFRONT SUBSCRIPTIONS
// =========================================================================

const DEFAULT_PRODUCTS_BY_ID = new Map(DEFAULT_PRODUCTS.map((p) => [p.id, p]));
const BRAND_UPGRADE_IDS = new Set([
  'prod_ff_level_evo',
  'prod_ff_indo',
  'prod_tg_stars_100',
  'prod_sw_win11_key',
  'prod_sw_office_pro',
  'prod_des_logo',
  'prod_dig_templates',
  'prod_dls_gems',
]);

function isLegacySeededProduct(prod: Product, def?: Product): boolean {
  if (!def) return false;
  return Boolean(
    (prod.discountPercent && prod.discountPercent > 0) ||
      !prod.imageUrl?.startsWith('/assets/products/') ||
      !prod.validityEn ||
      !prod.termsEn ||
      (prod.originalPriceBdt ?? 0) > prod.priceBdt
  );
}

function mergeUpgradedProduct(prod: Product, def?: Product): Product {
  if (!def) return prod;
  const legacy = isLegacySeededProduct(prod, def);
  return {
    ...prod,
    brandKey:
      BRAND_UPGRADE_IDS.has(prod.id) &&
      def.brandKey &&
      (!prod.brandKey ||
        prod.brandKey === 'freefire' ||
        prod.brandKey === 'telegram' ||
        prod.brandKey === 'microsoft' ||
        prod.brandKey === 'design' ||
        prod.brandKey === 'ebook')
        ? def.brandKey
        : prod.brandKey || def.brandKey,
    subcategoryBn: prod.subcategoryBn || def.subcategoryBn,
    subcategoryEn: prod.subcategoryEn || def.subcategoryEn,
    bannerUrl: prod.bannerUrl || def.bannerUrl,
    stockCount: prod.stockCount ?? def.stockCount,
    orderFormType: prod.orderFormType ?? def.orderFormType,
    ...(legacy
      ? {
          priceBdt: def.priceBdt,
          originalPriceBdt: def.originalPriceBdt,
          discountPercent: 0,
          packages: def.packages,
          imageUrl: def.imageUrl,
          descriptionBn: def.descriptionBn,
          descriptionEn: def.descriptionEn,
          validityBn: def.validityBn,
          validityEn: def.validityEn,
          benefitsBn: def.benefitsBn,
          benefitsEn: def.benefitsEn,
          instructionsBn: def.instructionsBn,
          instructionsEn: def.instructionsEn,
          termsBn: def.termsBn,
          termsEn: def.termsEn,
        }
      : {
          validityBn: prod.validityBn || def.validityBn,
          validityEn: prod.validityEn || def.validityEn,
          benefitsBn: prod.benefitsBn || def.benefitsBn,
          benefitsEn: prod.benefitsEn || def.benefitsEn,
          instructionsBn: prod.instructionsBn || def.instructionsBn,
          instructionsEn: prod.instructionsEn || def.instructionsEn,
          termsBn: prod.termsBn || def.termsBn,
          termsEn: prod.termsEn || def.termsEn,
        }),
  };
}

export function subscribeCategories(cb: (items: Category[]) => void): Unsubscribe {
  let fsBase: Category[] = DEFAULT_CATEGORIES;
  const emit = async (force = false) => {
    const { overrides } = await fetchCatalogOverrides(force);
    const merged = applyCollectionOverrides(fsBase, overrides.categories).sort(
      (a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)
    );
    cb(merged.length > 0 ? merged : DEFAULT_CATEGORIES);
  };
  emit(false).catch(() => cb(DEFAULT_CATEGORIES));
  const unsubCat = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  let unsubFs: Unsubscribe = () => {};
  try {
    const q = query(collection(db, 'categories'), orderBy('sortOrder', 'asc'));
    unsubFs = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Category);
        fsBase = list.length > 0 ? list : DEFAULT_CATEGORIES;
        emit(false).catch(() => {});
      },
      () => {
        fsBase = DEFAULT_CATEGORIES;
        emit(false).catch(() => {});
      }
    );
  } catch {
    // Firestore read-only fallback unavailable
  }
  return () => {
    unsubFs();
    unsubCat();
  };
}

export function subscribeProducts(cb: (items: Product[]) => void): Unsubscribe {
  let fsBase: Product[] = DEFAULT_PRODUCTS;
  const emit = async (force = false) => {
    const { overrides } = await fetchCatalogOverrides(force);
    const merged = applyCollectionOverrides(fsBase, overrides.products).sort(
      (a, b) => (a.sortOrder ?? 99999) - (b.sortOrder ?? 99999)
    );
    cb(merged);
  };
  emit(false).catch(() => cb(DEFAULT_PRODUCTS));
  const unsubCat = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  let unsubFs: Unsubscribe = () => {};
  try {
    unsubFs = onSnapshot(
      collection(db, 'products'),
      (snap) => {
        if (snap.empty) {
          fsBase = DEFAULT_PRODUCTS;
        } else {
          const firestoreItems = snap.docs.map((d) => {
            const prod = d.data() as Product;
            const def = DEFAULT_PRODUCTS_BY_ID.get(prod.id);
            return mergeUpgradedProduct(prod, def);
          });
          const seenIds = new Set(firestoreItems.map((p) => p.id));
          const missingDefaults = DEFAULT_PRODUCTS.filter((p) => !seenIds.has(p.id));
          fsBase = [...firestoreItems, ...missingDefaults].sort(
            (a, b) => (a.sortOrder ?? 99999) - (b.sortOrder ?? 99999)
          );
        }
        emit(false).catch(() => {});
      },
      () => {
        fsBase = DEFAULT_PRODUCTS;
        emit(false).catch(() => {});
      }
    );
  } catch {
    // Non-fatal
  }
  return () => {
    unsubFs();
    unsubCat();
  };
}

export function subscribeAdvertisements(cb: (items: Advertisement[]) => void): Unsubscribe {
  let fsBase: Advertisement[] = DEFAULT_ADVERTISEMENTS;
  const emit = async (force = false) => {
    const { overrides } = await fetchCatalogOverrides(force);
    const merged = applyCollectionOverrides(fsBase, overrides.advertisements).sort(
      (a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)
    );
    cb(merged.length > 0 ? merged : DEFAULT_ADVERTISEMENTS);
  };
  emit(false).catch(() => cb(DEFAULT_ADVERTISEMENTS));
  const unsubCat = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  let unsubFs: Unsubscribe = () => {};
  try {
    const q = query(collection(db, 'advertisements'), orderBy('sortOrder', 'asc'));
    unsubFs = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Advertisement);
        if (list.length === 0) {
          fsBase = DEFAULT_ADVERTISEMENTS;
        } else {
          const seen = new Set(list.map((a) => a.id));
          const missingAd07 = DEFAULT_ADVERTISEMENTS.filter((a) => a.id === 'ad_07' && !seen.has(a.id));
          fsBase = [...list, ...missingAd07];
        }
        emit(false).catch(() => {});
      },
      () => {
        fsBase = DEFAULT_ADVERTISEMENTS;
        emit(false).catch(() => {});
      }
    );
  } catch {
    // Non-fatal
  }
  return () => {
    unsubFs();
    unsubCat();
  };
}

export function subscribeBanners(cb: (items: Banner[]) => void): Unsubscribe {
  let fsBase: Banner[] = DEFAULT_BANNERS;
  const emit = async (force = false) => {
    const { overrides } = await fetchCatalogOverrides(force);
    const merged = applyCollectionOverrides(fsBase, overrides.banners).sort(
      (a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999)
    );
    cb(merged.length > 0 ? merged : DEFAULT_BANNERS);
  };
  emit(false).catch(() => cb(DEFAULT_BANNERS));
  const unsubCat = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  let unsubFs: Unsubscribe = () => {};
  try {
    const q = query(collection(db, 'banners'), orderBy('sortOrder', 'asc'));
    unsubFs = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Banner);
        if (list.length === 0) {
          fsBase = DEFAULT_BANNERS;
        } else {
          const seen = new Set(list.map((b) => b.id));
          const missingAd07Ban = DEFAULT_BANNERS.filter((b) => b.id === 'ban_between_2' && !seen.has(b.id));
          fsBase = [...list, ...missingAd07Ban];
        }
        emit(false).catch(() => {});
      },
      () => {
        fsBase = DEFAULT_BANNERS;
        emit(false).catch(() => {});
      }
    );
  } catch {
    // Non-fatal
  }
  return () => {
    unsubFs();
    unsubCat();
  };
}

export function subscribeCoupons(cb: (items: Coupon[]) => void): Unsubscribe {
  let fsBase: Coupon[] = DEFAULT_COUPONS;
  const emit = async (force = false) => {
    const { overrides } = await fetchCatalogOverrides(force);
    const merged = applyCollectionOverrides(fsBase, overrides.coupons).filter((c) => c.active);
    cb(merged.length > 0 ? merged : DEFAULT_COUPONS);
  };
  emit(false).catch(() => cb(DEFAULT_COUPONS));
  const unsubCat = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  let unsubFs: Unsubscribe = () => {};
  try {
    const q = query(collection(db, 'coupons'), where('active', '==', true));
    unsubFs = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as Coupon);
        fsBase = list.length > 0 ? list : DEFAULT_COUPONS;
        emit(false).catch(() => {});
      },
      () => {
        fsBase = DEFAULT_COUPONS;
        emit(false).catch(() => {});
      }
    );
  } catch {
    // Non-fatal
  }
  return () => {
    unsubFs();
    unsubCat();
  };
}

export function subscribeApprovedReviews(cb: (items: Review[]) => void): Unsubscribe {
  let fsBase: Review[] = [];
  const emit = async (force = false) => {
    const { reviews } = await fetchCatalogOverrides(force);
    const byId = new Map<string, Review>();
    fsBase.forEach((r) => byId.set(r.id, r));
    reviews.forEach((r) => byId.set(r.id, r));
    cb(
      Array.from(byId.values())
        .filter((r) => r.approved)
        .sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt))
    );
  };
  emit(false).catch(() => cb([]));
  const unsubCat = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  let unsubFs: Unsubscribe = () => {};
  try {
    const q = query(collection(db, 'reviews'), where('approved', '==', true));
    unsubFs = onSnapshot(
      q,
      (snap) => {
        fsBase = snap.docs.map((d) => d.data() as Review);
        emit(false).catch(() => {});
      },
      () => {
        emit(false).catch(() => {});
      }
    );
  } catch {
    // Non-fatal
  }
  return () => {
    unsubFs();
    unsubCat();
  };
}

export function subscribeSiteSettings(cb: (settings: SiteSettings) => void): Unsubscribe {
  let fsBase: Partial<SiteSettings> = {};
  const normalizeSettings = (
    raw: Partial<SiteSettings>,
    allMethods: PaymentMethodConfig[] = []
  ): SiteSettings => {
    const merged = { ...DEFAULT_SITE_SETTINGS, ...raw };
    const findMethod = (code: string) =>
      allMethods.find((m) => String(m.code || '').trim().toLowerCase() === code);
    const bkashPm = findMethod('bkash');
    const nagadPm = findMethod('nagad');
    const rocketPm = findMethod('rocket');

    const normalizeAccountType = (val: string | undefined, fallback?: 'Personal' | 'Merchant' | 'Agent') => {
      if (val === 'Personal' || val === 'Merchant' || val === 'Agent') return val;
      return fallback;
    };

    return {
      ...merged,
      bkashNumber: bkashPm ? bkashPm.accountNumber : merged.bkashNumber || DEFAULT_SITE_SETTINGS.bkashNumber,
      bkashType: normalizeAccountType(bkashPm?.accountName, merged.bkashType),
      bkashEnabled: bkashPm ? bkashPm.enabled : merged.bkashEnabled,
      bkashNoteBn: bkashPm?.instructionsBn || merged.bkashNoteBn,
      bkashNoteEn: bkashPm?.instructionsEn || merged.bkashNoteEn,
      nagadNumber: nagadPm ? nagadPm.accountNumber : merged.nagadNumber || DEFAULT_SITE_SETTINGS.nagadNumber,
      nagadType: normalizeAccountType(nagadPm?.accountName, merged.nagadType),
      nagadEnabled: nagadPm ? nagadPm.enabled : merged.nagadEnabled,
      nagadNoteBn: nagadPm?.instructionsBn || merged.nagadNoteBn,
      nagadNoteEn: nagadPm?.instructionsEn || merged.nagadNoteEn,
      rocketNumber: rocketPm ? rocketPm.accountNumber : merged.rocketNumber || DEFAULT_SITE_SETTINGS.rocketNumber,
      rocketType: normalizeAccountType(rocketPm?.accountName, merged.rocketType),
      rocketEnabled: rocketPm ? rocketPm.enabled : merged.rocketEnabled,
      rocketNoteBn: rocketPm?.instructionsBn || merged.rocketNoteBn,
      rocketNoteEn: rocketPm?.instructionsEn || merged.rocketNoteEn,
      telegramLink:
        !merged.telegramLink || merged.telegramLink === 'https://t.me/digitalhub_bd'
          ? DEFAULT_SITE_SETTINGS.telegramLink
          : merged.telegramLink,
      whatsappLink: merged.whatsappLink || DEFAULT_SITE_SETTINGS.whatsappLink,
      telegramChannelLink: merged.telegramChannelLink || DEFAULT_SITE_SETTINGS.telegramChannelLink,
    };
  };
  const emit = async (force = false) => {
    const { overrides, allPaymentMethods } = await fetchCatalogOverrides(force);
    const globalOverride = (overrides.settings || []).find((r) => r.id === 'global' && !r.deleted);
    cb(
      normalizeSettings(
        { ...fsBase, ...((globalOverride?.data as Partial<SiteSettings>) || {}) },
        allPaymentMethods
      )
    );
  };
  emit(false).catch(() => cb(DEFAULT_SITE_SETTINGS));
  const unsubCat = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  let unsubFs: Unsubscribe = () => {};
  try {
    unsubFs = onSnapshot(
      doc(db, 'siteSettings', 'global'),
      (snap) => {
        fsBase = snap.exists() ? (snap.data() as Partial<SiteSettings>) : {};
        emit(false).catch(() => {});
      },
      () => {
        emit(false).catch(() => {});
      }
    );
  } catch {
    // Non-fatal
  }
  return () => {
    unsubFs();
    unsubCat();
  };
}

export function subscribeAdNetworks(cb: (items: AdNetworkConfig[]) => void): Unsubscribe {
  let fsBase: AdNetworkConfig[] = DEFAULT_AD_NETWORKS;
  const emit = async (force = false) => {
    const { overrides } = await fetchCatalogOverrides(force);
    const merged = applyCollectionOverrides(fsBase, overrides.adNetworks);
    cb(merged.length > 0 ? merged : DEFAULT_AD_NETWORKS);
  };
  emit(false).catch(() => cb(DEFAULT_AD_NETWORKS));
  const unsubCat = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  let unsubFs: Unsubscribe = () => {};
  try {
    unsubFs = onSnapshot(
      collection(db, 'adNetworks'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as AdNetworkConfig);
        fsBase = list.length > 0 ? list : DEFAULT_AD_NETWORKS;
        emit(false).catch(() => {});
      },
      () => {
        fsBase = DEFAULT_AD_NETWORKS;
        emit(false).catch(() => {});
      }
    );
  } catch {
    // Non-fatal
  }
  return () => {
    unsubFs();
    unsubCat();
  };
}

export function subscribeManagedAdUnits(cb: (items: ManagedAdUnitConfig[]) => void): Unsubscribe {
  let fsOverrides: ManagedAdUnitConfig[] = [];
  const emit = async (force = false) => {
    const { overrides } = await fetchCatalogOverrides(force);
    const d1Overrides = (overrides.managedAdUnits || [])
      .filter((r) => !r.deleted)
      .map((r) => r.data as unknown as ManagedAdUnitConfig);
    const combined = mergeAdUnitsWithOverrides([...fsOverrides, ...d1Overrides]);
    cb(combined);
  };
  emit(false).catch(() => cb(DIGITAL_HUB_AD_PROVIDER_CONFIG));
  const unsubCat = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  let unsubFs: Unsubscribe = () => {};
  try {
    unsubFs = onSnapshot(
      collection(db, 'advertisingUnits'),
      (snap) => {
        fsOverrides = snap.docs.map((d) => d.data() as ManagedAdUnitConfig);
        emit(false).catch(() => {});
      },
      () => {
        emit(false).catch(() => {});
      }
    );
  } catch {
    // Non-fatal
  }
  return () => {
    unsubFs();
    unsubCat();
  };
}

function getDhakaTodayIso(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Dhaka',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10);
  }
}

export function subscribeAnnouncements(cb: (items: Announcement[]) => void): Unsubscribe {
  const emit = async (force = false) => {
    const { announcements } = await fetchCatalogOverrides(force);
    const today = getDhakaTodayIso();
    cb(
      announcements
        .filter((a) => {
          if (!a.active) return false;
          if (a.startDate && a.startDate > today) return false;
          if (a.expiresAt && a.expiresAt < today) return false;
          return true;
        })
        .sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt))
    );
  };
  emit(false).catch(() => cb([]));
  const unsub1 = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  const unsub2 = subscribeDashboardInvalidation(() => {
    emit(true).catch(() => {});
  });
  return () => {
    unsub1();
    unsub2();
  };
}

export function subscribeHeroBanners(cb: (items: HeroBanner[]) => void): Unsubscribe {
  const emit = async (force = false) => {
    const { overrides } = await fetchCatalogOverrides(force);
    const rows = overrides.heroBanners || [];
    if (rows.length === 0) {
      cb(DEFAULT_HERO_BANNERS);
      return;
    }
    const merged = applyCollectionOverrides(DEFAULT_HERO_BANNERS, rows);
    cb(merged.sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99)));
  };
  emit(false).catch(() => cb(DEFAULT_HERO_BANNERS));
  const unsubCat = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  return () => {
    unsubCat();
  };
}

export function subscribePaymentMethods(cb: (items: PaymentMethodConfig[]) => void): Unsubscribe {
  const emit = async (force = false) => {
    const { paymentMethods } = await fetchCatalogOverrides(force);
    cb(paymentMethods);
  };
  emit(false).catch(() => cb([]));
  const unsub1 = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  const unsub2 = subscribeDashboardInvalidation(() => {
    emit(true).catch(() => {});
  });
  return () => {
    unsub1();
    unsub2();
  };
}

export function subscribeMobileApps(
  cb: (items: MobileAppItem[]) => void,
  includeHidden = false
): Unsubscribe {
  const emit = async (force = false) => {
    const { overrides } = await fetchCatalogOverrides(force);
    cb(mergeMobileAppsCatalog(overrides.mobileApps, includeHidden));
  };
  emit(false).catch(() => cb(mergeMobileAppsCatalog(undefined, includeHidden)));
  const unsubCat = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  return () => {
    unsubCat();
  };
}

export function subscribeGames(
  cb: (items: GameItem[]) => void,
  includeHidden = false
): Unsubscribe {
  const emit = async (force = false) => {
    const { overrides } = await fetchCatalogOverrides(force);
    cb(mergeGamesCatalog(overrides.games, includeHidden));
  };
  emit(false).catch(() => cb(mergeGamesCatalog(undefined, includeHidden)));
  const unsubCat = subscribeCatalogInvalidation(() => {
    emit(true).catch(() => {});
  });
  return () => {
    unsubCat();
  };
}

export async function seedMarketplaceToFirestore(_forceOverwrite = false): Promise<{ addedCount: number }> {
  notifyCatalogInvalidation();
  return { addedCount: 0 };
}

// =========================================================================
// CUSTOMER DASHBOARD & ACCOUNT OPERATIONS (COOKIE-AUTHENTICATED)
// =========================================================================

export interface CustomerDashboardPayload {
  user: AuthUser;
  profile: UserProfile;
  wallet: WalletAccount;
  walletTxs: WalletTransaction[];
  orders: Order[];
  payments: Payment[];
  referrals: Referral[];
  notifications: AppNotification[];
  tickets: SupportTicket[];
  withdrawals: WithdrawalRequest[];
  rewardClaims: RewardedAdClaim[];
  viewingSessions: AdViewingSession[];
  adRewardTransactions: AdRewardTransaction[];
  announcements: Announcement[];
  favoriteAppIds?: string[];
  totalDownloads?: number;
  downloadHistory?: DownloadHistoryItem[];
}

export async function fetchCustomerDashboardServer(): Promise<CustomerDashboardPayload | null> {
  try {
    const data = await apiJson<CustomerDashboardPayload & { ok: true }>('/api/me/dashboard', {
      method: 'GET',
    });
    return data;
  } catch {
    return null;
  }
}

export async function verifyOwnerAdminServer(): Promise<boolean> {
  try {
    const resp = await fetch(apiUrl('/api/admin/verify'), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) return false;
    const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; isAdmin?: boolean };
    return data.ok === true && data.isAdmin === true;
  } catch {
    return false;
  }
}

export async function checkIsAdminInDb(_uid: string): Promise<boolean> {
  return verifyOwnerAdminServer();
}

export async function updateUserProfileFields(
  _uid: string,
  updates: { displayName: string; phone: string; language: 'bn' | 'en'; photoUrl?: string; email?: string }
): Promise<{ user: AuthUser; profile: UserProfile }> {
  const res = await apiJson<{ ok: true; user: AuthUser; profile: UserProfile }>('/api/me/profile', {
    method: 'PATCH',
    body: {
      displayName: updates.displayName.trim().slice(0, 120),
      phone: updates.phone.trim().slice(0, 30),
      language: updates.language,
      ...(updates.photoUrl !== undefined ? { photoUrl: updates.photoUrl.slice(0, 250000) } : {}),
      ...(updates.email !== undefined ? { email: updates.email.trim().slice(0, 200) } : {}),
    },
  });
  notifyDashboardInvalidation();
  return { user: res.user, profile: res.profile };
}

export async function validateTransactionIdServer(params: {
  transactionId: string;
  senderNumber?: string;
  method?: PaymentMethod;
}): Promise<string> {
  const cleanTx = params.transactionId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  await apiJson<{ ok: true; duplicate: boolean }>('/api/payments/validate-txid', {
    method: 'POST',
    body: {
      transactionId: cleanTx,
      ...(params.senderNumber ? { senderNumber: params.senderNumber.trim() } : {}),
      ...(params.method ? { method: params.method } : {}),
    },
  });
  return cleanTx;
}

function buildOrderSummary(items: CartItem[]): {
  totalQty: number;
  selectedPackageName: string;
  itemsSummary: string;
} {
  const totalQty = items.reduce((s, it) => s + Math.max(1, Math.round(it.quantity || 1)), 0);
  const selectedPackageName = items[0]?.selectedPackage?.nameEn?.slice(0, 160) || '';
  const summaryParts = items.map((it) => {
    const qty = Math.max(1, Math.round(it.quantity || 1));
    const unitPrice = it.selectedPackage ? it.selectedPackage.priceBdt : it.product.priceBdt;
    const pkgLabel = it.selectedPackage ? ` [${it.selectedPackage.nameEn}]` : '';
    return `${it.product.titleEn}${pkgLabel} x${qty} (৳${Math.max(1, Math.round(unitPrice)) * qty})`;
  });
  return {
    totalQty,
    selectedPackageName,
    itemsSummary: summaryParts.join(', ').slice(0, 950),
  };
}

export async function submitOrderWithManualPayment(params: {
  customerId: string;
  customerEmail: string;
  customerName: string;
  items: CartItem[];
  couponCode?: string;
  discountBdt?: number;
  totalPriceBdt: number;
  method: PaymentMethod;
  receiverNumber: string;
  senderNumber: string;
  transactionId: string;
  deliveryNote: string;
  receiptDataUrl?: string;
  referenceAttachmentUrl?: string;
}): Promise<{ orderId: string; orderNumber: string }> {
  const primary = params.items[0]?.product;
  if (!primary) throw new Error('Cart is empty.');
  const { totalQty, selectedPackageName, itemsSummary } = buildOrderSummary(params.items);

  const res = await apiJson<{ ok: true; orderId: string; orderNumber: string; paymentId: string }>(
    '/api/orders/manual',
    {
      method: 'POST',
      body: {
        productId: primary.id,
        productTitleBn:
          params.items.length > 1 ? `${primary.titleBn} (+${params.items.length - 1})` : primary.titleBn,
        productTitleEn:
          params.items.length > 1 ? `${primary.titleEn} (+${params.items.length - 1})` : primary.titleEn,
        selectedPackageName,
        itemsSummary,
        quantity: totalQty,
        couponCode: params.couponCode || '',
        discountBdt: params.discountBdt || 0,
        totalPriceBdt: Math.max(1, Math.round(params.totalPriceBdt)),
        paymentMethod: params.method,
        receiverNumber: params.receiverNumber.trim(),
        senderNumber: params.senderNumber.trim(),
        transactionId: params.transactionId.trim(),
        deliveryNote: params.deliveryNote.trim(),
        receiptDataUrl: params.receiptDataUrl || '',
        referenceAttachmentUrl: params.referenceAttachmentUrl || '',
      },
    }
  );
  notifyDashboardInvalidation();
  return { orderId: res.orderId, orderNumber: res.orderNumber };
}

export async function submitOrderWithWalletBalance(params: {
  customerId: string;
  customerEmail: string;
  customerName: string;
  wallet: WalletAccount;
  items: CartItem[];
  couponCode?: string;
  discountBdt?: number;
  totalPriceBdt: number;
  deliveryNote: string;
  referenceAttachmentUrl?: string;
}): Promise<{ orderId: string; orderNumber: string }> {
  const primary = params.items[0]?.product;
  if (!primary) throw new Error('Cart is empty.');
  const { totalQty, selectedPackageName, itemsSummary } = buildOrderSummary(params.items);

  const res = await apiJson<{ ok: true; orderId: string; orderNumber: string }>('/api/orders/wallet', {
    method: 'POST',
    body: {
      productId: primary.id,
      productTitleBn:
        params.items.length > 1 ? `${primary.titleBn} (+${params.items.length - 1})` : primary.titleBn,
      productTitleEn:
        params.items.length > 1 ? `${primary.titleEn} (+${params.items.length - 1})` : primary.titleEn,
      selectedPackageName,
      itemsSummary,
      quantity: totalQty,
      couponCode: params.couponCode || '',
      discountBdt: params.discountBdt || 0,
      totalPriceBdt: Math.max(1, Math.round(params.totalPriceBdt)),
      deliveryNote: params.deliveryNote.trim(),
      referenceAttachmentUrl: params.referenceAttachmentUrl || '',
    },
  });
  notifyDashboardInvalidation();
  return { orderId: res.orderId, orderNumber: res.orderNumber };
}

export async function submitAddMoneyDeposit(params: {
  userId: string;
  userEmail: string;
  amountBdt: number;
  method: string;
  receiverNumber: string;
  senderNumber: string;
  transactionId: string;
  receiptDataUrl?: string;
}): Promise<string> {
  const res = await apiJson<{ ok: true; id: string }>('/api/wallet/deposit', {
    method: 'POST',
    body: {
      amountBdt: Math.max(10, Math.round(params.amountBdt)),
      method: params.method,
      receiverNumber: params.receiverNumber.trim(),
      senderNumber: params.senderNumber.trim(),
      transactionId: params.transactionId.trim(),
      receiptDataUrl: params.receiptDataUrl || '',
    },
  });
  notifyDashboardInvalidation();
  return res.id;
}

export async function submitWithdrawalRequest(params: {
  userId: string;
  userEmail: string;
  wallet: WalletAccount;
  method: string;
  accountNumber: string;
  accountHolderName?: string;
  amountBdt: number;
}): Promise<string> {
  const res = await apiJson<{ ok: true; id: string }>('/api/wallet/withdraw', {
    method: 'POST',
    body: {
      amountBdt: Math.round(Number(params.amountBdt) || 0),
      method: params.method,
      accountNumber: params.accountNumber.trim(),
      accountHolderName: (params.accountHolderName || '').trim(),
    },
  });
  notifyDashboardInvalidation();
  return res.id;
}

export async function submitCustomerReview(params: {
  productId: string;
  orderId: string;
  userId: string;
  authorName: string;
  rating: number;
  comment: string;
}): Promise<void> {
  await apiJson('/api/reviews', {
    method: 'POST',
    body: {
      productId: params.productId,
      orderId: params.orderId,
      rating: params.rating,
      comment: params.comment,
    },
  });
  notifyDashboardInvalidation();
}

export async function cancelCustomerOrder(
  orderId: string,
  _meta?: { customerId?: string; orderNumber?: string }
): Promise<void> {
  await apiJson(`/api/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    body: {},
  });
  notifyDashboardInvalidation();
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await apiJson(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: 'POST',
    body: {},
  });
  notifyDashboardInvalidation();
}

export async function markAllNotificationsRead(): Promise<{ updatedCount: number }> {
  const res = await apiJson<{ ok: true; updatedCount: number }>('/api/notifications/mark-all-read', {
    method: 'POST',
    body: {},
  });
  notifyDashboardInvalidation();
  return { updatedCount: Number(res.updatedCount || 0) };
}

export async function createSupportTicket(params: {
  userId: string;
  userEmail: string;
  subject: string;
  message: string;
  orderNumber?: string;
  category?: string;
  screenshotDataUrl?: string;
}): Promise<void> {
  await apiJson('/api/tickets', {
    method: 'POST',
    body: {
      subject: params.subject,
      message: params.message,
      orderNumber: params.orderNumber || '',
      category: params.category || 'general',
      ...(params.screenshotDataUrl ? { screenshotDataUrl: params.screenshotDataUrl } : {}),
    },
  });
  notifyDashboardInvalidation();
}

export async function triggerLogoutAllDevicesServer(): Promise<{ ok: boolean }> {
  await logoutAllSessions();
  return { ok: true };
}

export async function submitAccountDeletionRequestServer(reason: string): Promise<{ requestId: string }> {
  const res = await apiJson<{ ok: true; requestId: string }>('/api/account/deletion-request', {
    method: 'POST',
    body: { reason },
  });
  return { requestId: res.requestId || 'submitted' };
}

export async function submitRewardedAdClaimServer(networkId: string): Promise<{
  ok: boolean;
  claimId: string;
  amountBdt: number;
  dailyCount: number;
  dailyLimit: number;
}> {
  const res = await apiJson<{
    ok: true;
    id?: string;
    claimId?: string;
    amountBdt?: number;
    dailyCount?: number;
    dailyLimit?: number;
  }>('/api/rewards/claim', {
    method: 'POST',
    body: { networkId },
  });
  notifyDashboardInvalidation();
  return {
    ok: true,
    claimId: res.claimId || res.id || '',
    amountBdt: res.amountBdt || 0,
    dailyCount: res.dailyCount || 1,
    dailyLimit: res.dailyLimit || 5,
  };
}

export async function registerReferralServer(referralCode: string): Promise<{
  ok: boolean;
  registered: boolean;
  status?: string;
  message?: string;
}> {
  if (!referralCode.trim()) return { ok: false, registered: false };
  try {
    const res = await apiJson<{ ok: true; registered?: boolean; status?: string; message?: string }>(
      '/api/referrals/register',
      {
        method: 'POST',
        body: { referralCode: referralCode.trim() },
      }
    );
    notifyDashboardInvalidation();
    return {
      ok: true,
      registered: Boolean(res.registered),
      status: res.status,
      message: res.message,
    };
  } catch {
    return { ok: false, registered: false };
  }
}

export async function startWatchEarnSessionServer(params: {
  unitId: string;
  provider: string;
  launchUrl?: string;
  adTitle?: string;
}): Promise<{
  ok: boolean;
  sessionId: string;
  sessionToken: string;
  status: string;
  requiredSeconds: number;
  rewardCoins: number;
  serverStartedAt: number;
  requiresS2SCallback: boolean;
  message: string;
}> {
  const data = await apiJson<{
    ok: true;
    sessionId?: string;
    sessionToken?: string;
    status?: string;
    requiredSeconds?: number;
    rewardCoins?: number;
    serverStartedAt?: number;
    requiresS2SCallback?: boolean;
    message?: string;
  }>('/api/watch-earn/session/start', {
    method: 'POST',
    body: params,
  });
  notifyDashboardInvalidation();
  return {
    ok: true,
    sessionId: data.sessionId || '',
    sessionToken: data.sessionToken || '',
    status: data.status || 'watching',
    requiredSeconds: Number(data.requiredSeconds || 5),
    rewardCoins: Number(data.rewardCoins || 5),
    serverStartedAt: Number(data.serverStartedAt || Date.now()),
    requiresS2SCallback: data.requiresS2SCallback === true,
    message: data.message || '',
  };
}

export async function completeWatchEarnSessionServer(params: {
  sessionId: string;
  sessionToken: string;
  adLoaded: boolean;
  failureReason?: string;
}): Promise<{
  ok: boolean;
  verified: boolean;
  alreadyCredited: boolean;
  status: string;
  coinsAwarded: number;
  bdtEquivalent: number;
  coinsAvailable: number;
  coinsLifetimeEarned: number;
  coinsRedeemed: number;
  adsWatchedToday: number;
  coinsEarnedToday: number;
  dailyAdLimit: number;
  dailyCoinLimit: number;
  message: string;
}> {
  const resp = await fetch(apiUrl('/api/watch-earn/session/complete'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(params),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    verified?: boolean;
    alreadyCredited?: boolean;
    status?: string;
    coinsAwarded?: number;
    bdtEquivalent?: number;
    coinsAvailable?: number;
    coinsLifetimeEarned?: number;
    coinsRedeemed?: number;
    adsWatchedToday?: number;
    coinsEarnedToday?: number;
    dailyAdLimit?: number;
    dailyCoinLimit?: number;
    message?: string;
    error?: string;
  };
  if (!resp.ok) {
    throw new Error(data.error || data.message || 'Could not complete ad reward verification.');
  }
  notifyDashboardInvalidation();
  return {
    ok: Boolean(data.ok),
    verified: Boolean(data.verified),
    alreadyCredited: Boolean(data.alreadyCredited),
    status: data.status || 'credited',
    coinsAwarded: Number(data.coinsAwarded || 0),
    bdtEquivalent: Number(data.bdtEquivalent || 0),
    coinsAvailable: Number(data.coinsAvailable || 0),
    coinsLifetimeEarned: Number(data.coinsLifetimeEarned || 0),
    coinsRedeemed: Number(data.coinsRedeemed || 0),
    adsWatchedToday: Number(data.adsWatchedToday || 0),
    coinsEarnedToday: Number(data.coinsEarnedToday || 0),
    dailyAdLimit: Number(data.dailyAdLimit || 10),
    dailyCoinLimit: Number(data.dailyCoinLimit || 100),
    message: data.message || '',
  };
}

export async function verifyWatchEarnSessionServer(sessionId: string): Promise<{
  ok: boolean;
  verified: boolean;
  status: string;
  coinsAwarded: number;
  message: string;
}> {
  const resp = await fetch(apiUrl('/api/watch-earn/session/verify'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ sessionId }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    verified?: boolean;
    status?: string;
    coinsAwarded?: number;
    message?: string;
    error?: string;
  };
  if (!resp.ok && resp.status !== 202) {
    throw new Error(data.error || data.message || 'Verification failed');
  }
  notifyDashboardInvalidation();
  return {
    ok: Boolean(data.ok),
    verified: Boolean(data.verified),
    status: data.status || 'verification_failed',
    coinsAwarded: data.coinsAwarded || 0,
    message: data.message || '',
  };
}

export interface WatchEarnSummaryPayload {
  coinsAvailable: number;
  coinsLifetimeEarned: number;
  coinsRedeemed: number;
  adsWatchedToday: number;
  remainingAdsToday: number;
  coinsEarnedToday: number;
  dailyAdLimit: number;
  dailyCoinLimit: number;
  coinsPerAd: number;
  coinsPerBdt: number;
  minRedeemCoins: number;
  resetTimezone: string;
  watchedUnitIdsToday: string[];
  watchEarnEnabled: boolean;
  creditedSessions: Array<{
    sessionId: string;
    unitId?: string;
    provider: string;
    providerEventId: string;
    coins: number;
    creditedAt: string;
  }>;
}

const EMPTY_WATCH_EARN_SUMMARY: WatchEarnSummaryPayload = {
  coinsAvailable: 0,
  coinsLifetimeEarned: 0,
  coinsRedeemed: 0,
  adsWatchedToday: 0,
  remainingAdsToday: 10,
  coinsEarnedToday: 0,
  dailyAdLimit: 10,
  dailyCoinLimit: 100,
  coinsPerAd: 5,
  coinsPerBdt: 10,
  minRedeemCoins: 50,
  resetTimezone: 'Asia/Dhaka',
  watchedUnitIdsToday: [],
  watchEarnEnabled: true,
  creditedSessions: [],
};

export async function getWatchEarnSummaryServer(): Promise<WatchEarnSummaryPayload> {
  try {
    const resp = await fetch(apiUrl('/api/watch-earn/summary'), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) {
      return EMPTY_WATCH_EARN_SUMMARY;
    }
    const data = (await resp.json().catch(() => ({}))) as Partial<WatchEarnSummaryPayload>;
    const adsWatchedToday = Number(data.adsWatchedToday || 0);
    const dailyAdLimit = Number(data.dailyAdLimit || 10);
    return {
      coinsAvailable: Number(data.coinsAvailable || 0),
      coinsLifetimeEarned: Number(data.coinsLifetimeEarned || 0),
      coinsRedeemed: Number(data.coinsRedeemed || 0),
      adsWatchedToday,
      remainingAdsToday:
        typeof data.remainingAdsToday === 'number'
          ? data.remainingAdsToday
          : Math.max(0, dailyAdLimit - adsWatchedToday),
      coinsEarnedToday: Number(data.coinsEarnedToday || 0),
      dailyAdLimit,
      dailyCoinLimit: Number(data.dailyCoinLimit || 100),
      coinsPerAd: Number(data.coinsPerAd || 5),
      coinsPerBdt: Number(data.coinsPerBdt || 10),
      minRedeemCoins: Number(data.minRedeemCoins || 50),
      resetTimezone: data.resetTimezone || 'Asia/Dhaka',
      watchedUnitIdsToday: Array.isArray(data.watchedUnitIdsToday) ? data.watchedUnitIdsToday : [],
      watchEarnEnabled: data.watchEarnEnabled !== false,
      creditedSessions: Array.isArray(data.creditedSessions) ? data.creditedSessions : [],
    };
  } catch {
    return EMPTY_WATCH_EARN_SUMMARY;
  }
}

export async function redeemWatchEarnCoinsServer(coins: number): Promise<{
  ok: boolean;
  coinsRedeemed: number;
  bdtCredited: number;
  coinsAvailable: number;
  status: string;
}> {
  const data = await apiJson<{
    ok: true;
    coinsRedeemed?: number;
    bdtCredited?: number;
    coinsAvailable?: number;
    status?: string;
  }>('/api/watch-earn/redeem', {
    method: 'POST',
    body: { coins },
  });
  notifyDashboardInvalidation();
  return {
    ok: true,
    coinsRedeemed: data.coinsRedeemed || 0,
    bdtCredited: data.bdtCredited || 0,
    coinsAvailable: data.coinsAvailable ?? 0,
    status: data.status || 'Pending Credit',
  };
}

// =========================================================================
// AD EVENT TRACKING (SERVER ANALYTICS ENDPOINT)
// =========================================================================

function getAdSessionId(): string {
  try {
    const key = 'dh_ad_session_v3';
    const existing = sessionStorage.getItem(key);
    if (existing && /^[a-zA-Z0-9_-]{6,64}$/.test(existing)) return existing;
    const created = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return 'sess_browser';
  }
}

const localAdCooldown = new Map<string, number>();

export async function trackAdEvent(
  adId: string,
  type: 'impression' | 'click',
  placement: string,
  adFormat = 'direct_link'
): Promise<void> {
  const cleanAdId = sanitizeId(adId || 'unknown');
  if (!cleanAdId) return;

  const now = Date.now();
  const dedupKey = `${cleanAdId}:${type}:${placement}`;
  const lastTs = localAdCooldown.get(dedupKey);
  const cooldownMs = type === 'click' ? 45000 : 25000;
  if (lastTs && now - lastTs < cooldownMs) {
    return;
  }
  localAdCooldown.set(dedupKey, now);

  fetch(apiUrl('/api/ads/track'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      adId: cleanAdId,
      type,
      placement,
      adFormat,
      sessionId: getAdSessionId(),
    }),
  }).catch(() => {});
}

// =========================================================================
// ADMIN DASHBOARD SNAPSHOT CACHE & SUBSCRIPTIONS (COOKIE RBAC)
// =========================================================================

export interface AdminDashboardPayload {
  superAdminEmail?: string;
  users: UserProfile[];
  wallets: WalletAccount[];
  walletTxs: WalletTransaction[];
  orders: Order[];
  payments: Payment[];
  referrals: Referral[];
  tickets: SupportTicket[];
  reviews: Review[];
  withdrawals: WithdrawalRequest[];
  rewardClaims: RewardedAdClaim[];
  announcements: Announcement[];
  viewingSessions: AdViewingSession[];
  adRewardTransactions: AdRewardTransaction[];
  auditLogs: AuditLog[];
  paymentMethods?: PaymentMethodConfig[];
  deletionRequests?: AccountDeletionRequest[];
}

let adminSnapshotCache: { ts: number; data: AdminDashboardPayload } | null = null;
let adminSnapshotInFlight: Promise<AdminDashboardPayload | null> | null = null;

export async function fetchAdminDashboardServer(force = false): Promise<AdminDashboardPayload | null> {
  const now = Date.now();
  if (!force && adminSnapshotCache && now - adminSnapshotCache.ts < 2500) {
    return adminSnapshotCache.data;
  }
  if (!force && adminSnapshotInFlight) {
    return adminSnapshotInFlight;
  }
  adminSnapshotInFlight = (async () => {
    try {
      const data = await apiJson<AdminDashboardPayload & { ok: true }>('/api/admin/dashboard', {
        method: 'GET',
      });
      adminSnapshotCache = { ts: Date.now(), data };
      return data;
    } catch {
      return null;
    } finally {
      adminSnapshotInFlight = null;
    }
  })();
  return adminSnapshotInFlight;
}

export function subscribeAllAdminCollections(callbacks: {
  onUsers: (u: UserProfile[]) => void;
  onOrders: (o: Order[]) => void;
  onPayments: (p: Payment[]) => void;
  onWalletTx: (w: WalletTransaction[]) => void;
  onWallets: (wa: WalletAccount[]) => void;
  onCoupons: (c: Coupon[]) => void;
  onReviews: (r: Review[]) => void;
  onTickets: (t: SupportTicket[]) => void;
  onReferrals: (r: Referral[]) => void;
  onAuditLogs: (a: AuditLog[]) => void;
  onAdmins: (adm: AdminRecord[]) => void;
}): Unsubscribe[] {
  let active = true;
  const load = async (force = false) => {
    const [snap, cat] = await Promise.all([
      fetchAdminDashboardServer(force),
      fetchCatalogOverrides(force),
    ]);
    if (!active) return;
    if (snap) {
      callbacks.onUsers(snap.users || []);
      callbacks.onOrders(snap.orders || []);
      callbacks.onPayments(snap.payments || []);
      callbacks.onWalletTx(snap.walletTxs || []);
      callbacks.onWallets(snap.wallets || []);
      callbacks.onReviews(snap.reviews || []);
      callbacks.onTickets(snap.tickets || []);
      callbacks.onReferrals(snap.referrals || []);
      callbacks.onAuditLogs(snap.auditLogs || []);
      callbacks.onAdmins(
        (snap.users || [])
          .filter((u) => u.role === 'admin' || u.role === 'super_admin')
          .map((u) => ({
            uid: u.uid,
            email: u.phone || u.email || '',
            role: u.role === 'super_admin' ? 'super_admin' : 'admin',
            createdAt: u.createdAt,
          }))
      );
    }
    const mergedCoupons = applyCollectionOverrides(DEFAULT_COUPONS, cat.overrides.coupons);
    callbacks.onCoupons(mergedCoupons);
  };

  load(true).catch(() => {});
  const unsubDash = subscribeDashboardInvalidation(() => {
    load(true).catch(() => {});
  });
  const unsubCat = subscribeCatalogInvalidation(() => {
    load(true).catch(() => {});
  });
  const timer = setInterval(() => {
    load(true).catch(() => {});
  }, 20000);

  return [
    () => {
      active = false;
      unsubDash();
      unsubCat();
      clearInterval(timer);
    },
  ];
}

export function subscribeAdRevenueEntries(cb: (items: AdRevenueEntry[]) => void): Unsubscribe {
  let active = true;
  const load = async (force = false) => {
    const { overrides } = await fetchCatalogOverrides(force);
    if (!active) return;
    const list = (overrides.adRevenueEntries || [])
      .filter((r) => !r.deleted)
      .map((r) => r.data as unknown as AdRevenueEntry)
      .sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt));
    cb(list);
  };
  load(false).catch(() => cb([]));
  const unsub = subscribeCatalogInvalidation(() => {
    load(true).catch(() => {});
  });
  return () => {
    active = false;
    unsub();
  };
}

function createAdminFieldSubscription<K extends keyof AdminDashboardPayload>(
  field: K,
  cb: (items: AdminDashboardPayload[K]) => void
): Unsubscribe {
  let active = true;
  const load = async (force = false) => {
    const snap = await fetchAdminDashboardServer(force);
    if (!active || !snap) return;
    cb(snap[field]);
  };
  load(false).catch(() => {});
  const unsub = subscribeDashboardInvalidation(() => {
    load(false).catch(() => {});
  });
  return () => {
    active = false;
    unsub();
  };
}

export function subscribeAllWithdrawals(cb: (items: WithdrawalRequest[]) => void): Unsubscribe {
  return createAdminFieldSubscription('withdrawals', cb);
}

export function subscribeAllRewardedClaims(cb: (items: RewardedAdClaim[]) => void): Unsubscribe {
  return createAdminFieldSubscription('rewardClaims', cb);
}

export function subscribeAllAnnouncements(cb: (items: Announcement[]) => void): Unsubscribe {
  return createAdminFieldSubscription('announcements', cb);
}

export function subscribeAllViewingSessions(cb: (items: AdViewingSession[]) => void): Unsubscribe {
  return createAdminFieldSubscription('viewingSessions', cb);
}

export function subscribeAllAdRewardTransactions(cb: (items: AdRewardTransaction[]) => void): Unsubscribe {
  return createAdminFieldSubscription('adRewardTransactions', cb);
}

// =========================================================================
// ADMIN MUTATION OPERATIONS (ALL VIA COOKIE-AUTH /api/admin/*)
// =========================================================================

export async function adminVerifyPaymentServer(params: {
  payment: Payment;
  decision: 'approve' | 'reject';
  rejectionReason?: string;
  nextOrderStatus?: 'Paid' | 'Payment Approved' | 'Processing';
}): Promise<void> {
  await apiJson('/api/admin/verify-payment', {
    method: 'POST',
    body: {
      paymentId: params.payment.id,
      orderId: params.payment.orderId,
      decision: params.decision,
      rejectionReason: params.rejectionReason || '',
      nextOrderStatus: params.nextOrderStatus || 'Processing',
    },
  });
  notifyDashboardInvalidation();
}

export async function adminVerifyAddMoneyServer(params: {
  walletTx: WalletTransaction;
  decision: 'approve' | 'reject';
  rejectionReason?: string;
}): Promise<void> {
  await apiJson('/api/admin/verify-add-money', {
    method: 'POST',
    body: {
      walletTxId: params.walletTx.id,
      decision: params.decision,
      rejectionReason: params.rejectionReason || '',
    },
  });
  notifyDashboardInvalidation();
}

export async function adminUpdateOrderStatus(
  order: Order,
  status: OrderStatus,
  adminNote?: string
): Promise<void> {
  await apiJson(`/api/admin/orders/${encodeURIComponent(order.id)}/status`, {
    method: 'POST',
    body: {
      status,
      ...(adminNote !== undefined ? { adminNote: adminNote.slice(0, 500) } : {}),
    },
  });
  notifyDashboardInvalidation();
}

export async function adminCompleteOrderWithRewardsServer(
  orderId: string,
  adminNote?: string
): Promise<{ awardedCashbackBdt: number; awardedReferralBdt: number }> {
  const res = await apiJson<{ ok: true; awardedCashbackBdt: number; awardedReferralBdt: number }>(
    '/api/admin/complete-order-with-rewards',
    {
      method: 'POST',
      body: { orderId, adminNote },
    }
  );
  notifyDashboardInvalidation();
  return {
    awardedCashbackBdt: res.awardedCashbackBdt || 0,
    awardedReferralBdt: res.awardedReferralBdt || 0,
  };
}

export async function adminRefundAndCancelOrderServer(params: {
  orderId: string;
  rejectionReason?: string;
  refundToWallet?: boolean;
}): Promise<{ status: string; refundedBdt: number }> {
  const res = await apiJson<{ ok: true; status: string; refundedBdt: number }>(
    '/api/admin/refund-cancel-order',
    {
      method: 'POST',
      body: params,
    }
  );
  notifyDashboardInvalidation();
  return { status: res.status || 'Cancelled', refundedBdt: res.refundedBdt || 0 };
}

export async function adminAdjustWalletBalance(params: {
  targetUid: string;
  userEmail?: string;
  currentWallet?: WalletAccount;
  mode: 'add' | 'deduct' | 'set';
  amountBdt: number;
  reason?: string;
  note?: string;
}): Promise<{ previousBalance: number; nextBalance: number; transactionId: string }> {
  const cleanReason = (params.reason ?? params.note ?? '').trim();
  const res = await apiJson<{ ok: true; previousBalance: number; nextBalance: number; transactionId: string }>(
    '/api/admin/wallet/adjust',
    {
      method: 'POST',
      body: {
        targetUid: sanitizeId(params.targetUid),
        mode: params.mode,
        amountBdt: Math.round(Number(params.amountBdt) || 0),
        reason: cleanReason,
      },
    }
  );
  notifyDashboardInvalidation();
  return {
    previousBalance: res.previousBalance,
    nextBalance: res.nextBalance,
    transactionId: res.transactionId,
  };
}

export async function adminFetchUserDetail(uid: string): Promise<AdminUserDetailPayload> {
  const res = await apiJson<AdminUserDetailPayload & { ok: true }>(
    `/api/admin/users/${encodeURIComponent(uid)}`,
    { method: 'GET' }
  );
  return res;
}

export async function adminUpdateUserProfile(
  uid: string,
  updates: { displayName?: string; phone?: string; language?: 'bn' | 'en'; adminNotes?: string; reason?: string }
): Promise<UserProfile> {
  const res = await apiJson<{ ok: true; profile: UserProfile }>(
    `/api/admin/users/${encodeURIComponent(uid)}`,
    { method: 'PATCH', body: updates }
  );
  notifyDashboardInvalidation();
  return res.profile;
}

export async function adminFetchPaymentMethods(): Promise<PaymentMethodConfig[]> {
  const res = await apiJson<{ ok: true; paymentMethods: PaymentMethodConfig[] }>('/api/admin/payment-methods', {
    method: 'GET',
  });
  return res.paymentMethods || [];
}

export async function adminSavePaymentMethod(
  pm: Partial<PaymentMethodConfig> & { name: string }
): Promise<PaymentMethodConfig | null> {
  const res = await apiJson<{ ok: true; paymentMethod: PaymentMethodConfig | null }>('/api/admin/payment-methods', {
    method: 'POST',
    body: pm,
  });
  notifyDashboardInvalidation();
  notifyCatalogInvalidation();
  return res.paymentMethod;
}

export async function adminDeletePaymentMethod(id: string): Promise<void> {
  await apiJson(`/api/admin/payment-methods/${encodeURIComponent(id)}`, { method: 'DELETE' });
  notifyDashboardInvalidation();
  notifyCatalogInvalidation();
}

export async function adminFetchAnalytics(
  fromMs?: number,
  toMs?: number,
  compare = true
): Promise<AdminAnalyticsPayload> {
  const qs = new URLSearchParams();
  if (fromMs && fromMs > 0) qs.set('from', String(Math.floor(fromMs)));
  if (toMs && toMs > 0) qs.set('to', String(Math.floor(toMs)));
  if (compare) qs.set('compare', '1');
  const qStr = qs.toString() ? `?${qs.toString()}` : '';
  return apiJson<AdminAnalyticsPayload & { ok: true }>(`/api/admin/analytics${qStr}`, { method: 'GET' });
}

export async function adminFetchCoinsOverview(): Promise<AdminCoinsOverview> {
  return apiJson<AdminCoinsOverview & { ok: true }>('/api/admin/coins/overview', { method: 'GET' });
}

export async function adminAdjustUserCoins(params: {
  targetUid: string;
  mode: 'add' | 'deduct' | 'set';
  coins: number;
  reason: string;
}): Promise<{ previousCoins: number; coinsAvailable: number; transactionId: string }> {
  const res = await apiJson<{
    ok: true;
    previousCoins: number;
    coinsAvailable: number;
    transactionId: string;
  }>('/api/admin/coins/adjust', {
    method: 'POST',
    body: params,
  });
  notifyDashboardInvalidation();
  return {
    previousCoins: res.previousCoins,
    coinsAvailable: res.coinsAvailable,
    transactionId: res.transactionId,
  };
}

export async function adminSaveMobileApp(
  app: MobileAppItem & { notifyUsers?: boolean },
  isNew: boolean
): Promise<void> {
  await saveCatalogOverride(
    'mobileApps',
    app.id,
    {
      ...app,
      logoUrl: app.iconUrl,
      bannerImageUrl: app.bannerImageUrl || app.screenUrl,
      playStoreUrl: app.officialStoreUrl,
      notifyUsers: Boolean(app.notifyUsers),
      updatedAt: Date.now(),
    },
    { auditAction: isNew ? 'create' : 'update' }
  );
  notifyCatalogInvalidation();
}

export async function adminDeleteMobileApp(appId: string): Promise<void> {
  await deleteCatalogOverride('mobileApps', appId);
  notifyCatalogInvalidation();
}

export async function adminSaveGame(game: GameItem, isNew: boolean): Promise<void> {
  await saveCatalogOverride(
    'games',
    game.id,
    {
      ...game,
      updatedAt: Date.now(),
    },
    { auditAction: isNew ? 'create' : 'update' }
  );
  notifyCatalogInvalidation();
}

export async function adminDeleteGame(gameId: string): Promise<void> {
  await deleteCatalogOverride('games', gameId);
  notifyCatalogInvalidation();
}

export async function adminFetchAppReports(): Promise<AppBrokenReport[]> {
  const res = await apiJson<{ ok: true; reports: AppBrokenReport[] }>('/api/admin/app-reports', {
    method: 'GET',
  });
  return res.reports || [];
}

export async function adminResolveAppReport(reportId: string): Promise<void> {
  await apiJson(`/api/admin/app-reports/${encodeURIComponent(reportId)}/resolve`, {
    method: 'POST',
    body: {},
  });
}

// =========================================================================
// PRIVACY-RESPECTING ANALYTICS & SMART APP STORE / GAMES PUBLIC CLIENT APIS
// =========================================================================

function getOrCreateClientVisitorId(): string {
  try {
    const key = 'dh_visitor_id_v1';
    const existing = localStorage.getItem(key);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
    const created = `vis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, created);
    return created;
  } catch {
    return 'vis_anon_client';
  }
}

function getOrCreateClientSessionId(): string {
  try {
    const key = 'dh_analytics_sess_v1';
    const existing = sessionStorage.getItem(key);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
    const created = `asess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return 'asess_browser';
  }
}

function isAnalyticsOptedOut(): boolean {
  try {
    const optOut = localStorage.getItem('dh_analytics_optout') === '1';
    const dnt = typeof navigator !== 'undefined' && navigator.doNotTrack === '1';
    return optOut || dnt;
  } catch {
    return false;
  }
}

function detectClientDeviceType(): 'mobile' | 'desktop' {
  if (typeof window === 'undefined') return 'desktop';
  return window.innerWidth < 768 ? 'mobile' : 'desktop';
}

export async function trackAnalyticsEvent(params: {
  visitorId?: string;
  sessionId?: string;
  eventType: AnalyticsEventType;
  pagePath?: string;
  appId?: string;
  contentId?: string;
  contentType?: string;
  contentCategory?: string;
  deviceType?: 'mobile' | 'desktop';
  referrerHost?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (isAnalyticsOptedOut()) return;
  try {
    await fetch(apiUrl('/api/analytics/track'), {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitorId: params.visitorId || getOrCreateClientVisitorId(),
        sessionId: params.sessionId || getOrCreateClientSessionId(),
        deviceType: params.deviceType || detectClientDeviceType(),
        ...params,
      }),
    });
  } catch {
    // Non-blocking analytics
  }
}

export function trackContentView(params: {
  contentId: string;
  contentType: 'app' | 'game' | 'service';
  contentCategory?: string;
  pagePath?: string;
}): void {
  const eventType: AnalyticsEventType =
    params.contentType === 'game'
      ? 'game_view'
      : params.contentType === 'service'
        ? 'product_view'
        : 'app_view';
  void trackAnalyticsEvent({
    eventType,
    contentId: params.contentId,
    contentType: params.contentType,
    contentCategory: params.contentCategory || '',
    appId: params.contentType === 'app' ? params.contentId : '',
    pagePath: params.pagePath || (typeof window !== 'undefined' ? window.location.pathname : '/'),
  });
}

export function trackDownloadClick(params: {
  contentId: string;
  contentType: 'app' | 'game';
  contentCategory?: string;
  pagePath?: string;
}): void {
  void trackAnalyticsEvent({
    eventType: 'download_click',
    contentId: params.contentId,
    contentType: params.contentType,
    contentCategory: params.contentCategory || '',
    appId: params.contentType === 'app' ? params.contentId : '',
    pagePath: params.pagePath || '/apps',
  });
}

export function trackPlayClick(params: {
  contentId: string;
  contentCategory?: string;
  pagePath?: string;
}): void {
  void trackAnalyticsEvent({
    eventType: 'play_click',
    contentId: params.contentId,
    contentType: 'game',
    contentCategory: params.contentCategory || '',
    pagePath: params.pagePath || '/games',
  });
}

export function trackExternalLinkClick(params: {
  contentId?: string;
  contentType?: string;
  targetUrl?: string;
  pagePath?: string;
}): void {
  void trackAnalyticsEvent({
    eventType: 'external_link_click',
    contentId: params.contentId || '',
    contentType: params.contentType || '',
    pagePath: params.pagePath || (typeof window !== 'undefined' ? window.location.pathname : '/'),
    metadata: params.targetUrl ? { targetUrl: params.targetUrl.slice(0, 180) } : undefined,
  });
}

export function trackSearchQuery(queryText: string, scope: 'services' | 'apps' | 'games'): void {
  const q = queryText.trim().slice(0, 80);
  if (q.length < 2) return;
  void trackAnalyticsEvent({
    eventType: 'search',
    contentCategory: scope,
    pagePath: typeof window !== 'undefined' ? window.location.pathname : '/',
    metadata: { query: q, scope },
  });
}

export async function fetchAppMeta(): Promise<AppMetaPayload> {
  try {
    const res = await apiJson<AppMetaPayload & { ok: true }>('/api/apps/meta', { method: 'GET' });
    return {
      statsByApp: res.statsByApp || {},
      reviews: Array.isArray(res.reviews) ? res.reviews : [],
      favoriteAppIds: Array.isArray(res.favoriteAppIds) ? res.favoriteAppIds : [],
    };
  } catch {
    return { statsByApp: {}, reviews: [], favoriteAppIds: [] };
  }
}

export async function fetchGameMeta(): Promise<GameMetaPayload> {
  try {
    const res = await apiJson<GameMetaPayload & { ok: true }>('/api/games/meta', { method: 'GET' });
    return {
      statsByGame: res.statsByGame || {},
    };
  } catch {
    return { statsByGame: {} };
  }
}

export async function recordAppDownload(params: {
  appId: string;
  appName: string;
  visitorId?: string;
  deviceType?: 'mobile' | 'desktop';
}): Promise<number> {
  try {
    const res = await apiJson<{ ok: true; downloads: number }>(
      `/api/apps/${encodeURIComponent(params.appId)}/download`,
      {
        method: 'POST',
        body: {
          appName: params.appName,
          visitorId: params.visitorId || '',
          deviceType: params.deviceType || 'desktop',
        },
      }
    );
    notifyDashboardInvalidation();
    return Number(res.downloads || 0);
  } catch {
    return 0;
  }
}

export async function toggleAppFavorite(appId: string): Promise<{ favorited: boolean; favoriteAppIds: string[] }> {
  const res = await apiJson<{ ok: true; favorited: boolean; favoriteAppIds: string[] }>(
    `/api/apps/${encodeURIComponent(appId)}/favorite`,
    { method: 'POST', body: {} }
  );
  notifyDashboardInvalidation();
  return { favorited: Boolean(res.favorited), favoriteAppIds: res.favoriteAppIds || [] };
}

export async function submitAppReview(params: {
  appId: string;
  rating: number;
  comment: string;
}): Promise<AppMetaPayload['reviews'][number]> {
  const res = await apiJson<{ ok: true; review: AppMetaPayload['reviews'][number] }>(
    `/api/apps/${encodeURIComponent(params.appId)}/review`,
    {
      method: 'POST',
      body: { rating: params.rating, comment: params.comment },
    }
  );
  return res.review;
}

export async function reportBrokenAppLink(params: {
  appId: string;
  appName: string;
  reason: string;
}): Promise<void> {
  await apiJson(`/api/apps/${encodeURIComponent(params.appId)}/report-link`, {
    method: 'POST',
    body: { appName: params.appName, reason: params.reason },
  });
}

export async function adminSendNotification(params: {
  targetUid?: string;
  targetUids?: string[];
  titleBn: string;
  titleEn: string;
  messageBn: string;
  messageEn: string;
  type?: AppNotification['type'];
}): Promise<{ recipientCount: number }> {
  const res = await apiJson<{ ok: true; recipientCount: number }>('/api/admin/notifications/send', {
    method: 'POST',
    body: params,
  });
  notifyDashboardInvalidation();
  return { recipientCount: res.recipientCount || 0 };
}

export async function optimizePackageLogoFile(file: File, maxDim = 512): Promise<string> {
  const allowedMimes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);
  const mime = (file.type || '').toLowerCase();
  const extMatch = /\.(png|jpe?g|webp)$/i.test(file.name || '');
  if (!allowedMimes.has(mime) && !extMatch) {
    throw new Error('Only PNG, JPG, JPEG, or WebP images are supported.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Selected image must be 5MB or smaller.');
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const ratio = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
        const width = Math.max(1, Math.round((img.width || 1) * ratio));
        const height = Math.max(1, Math.round((img.height || 1) * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const outputMime =
          mime === 'image/png' ? 'image/png' : mime === 'image/webp' ? 'image/webp' : 'image/jpeg';
        const optimized =
          outputMime === 'image/png'
            ? canvas.toDataURL('image/png')
            : canvas.toDataURL(outputMime, 0.88);
        resolve(optimized);
      };
      img.onerror = () => reject(new Error('Failed to decode selected image file.'));
      img.src = dataUrl;
    };
    reader.onerror = () => reject(new Error('Failed to read selected image file.'));
    reader.readAsDataURL(file);
  });
}

export async function adminUploadMediaAsset(dataUrl: string): Promise<{
  id: string;
  url: string;
  mimeType: string;
  byteSize: number;
}> {
  const res = await apiJson<{
    ok: true;
    id: string;
    url: string;
    mimeType: string;
    byteSize: number;
  }>('/api/admin/media/upload', {
    method: 'POST',
    body: { dataUrl },
  });
  notifyDashboardInvalidation();
  return {
    id: res.id,
    url: res.url,
    mimeType: res.mimeType,
    byteSize: res.byteSize,
  };
}

export async function adminDeleteMediaAsset(mediaId: string): Promise<void> {
  await apiJson(`/api/admin/media/${encodeURIComponent(mediaId)}`, {
    method: 'DELETE',
  });
  notifyDashboardInvalidation();
}

export async function adminFetchDatabaseBackup(): Promise<Record<string, unknown>> {
  const res = await apiJson<{ ok: true; backup: Record<string, unknown> }>('/api/admin/backup/export', {
    method: 'GET',
  });
  notifyDashboardInvalidation();
  return res.backup;
}

export function exportRecordsToCsv(
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | boolean | null | undefined>>
): void {
  const escapeCell = (val: string | number | boolean | null | undefined): string => {
    const str = val === null || val === undefined ? '' : String(val);
    if (/[",\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const csvLines = [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))];
  const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJsonFile(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.json') ? filename : `${filename}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function adminFetchSecurityOverview(): Promise<AdminSecurityPayload> {
  const res = await apiJson<AdminSecurityPayload & { ok: true }>('/api/admin/security', { method: 'GET' });
  return res;
}

export async function adminRevokeSession(params: { sessionId?: string; targetUid?: string }): Promise<void> {
  await apiJson('/api/admin/security/revoke-session', { method: 'POST', body: params });
  notifyDashboardInvalidation();
}

export async function adminUnlockAuthAttempt(key: string): Promise<void> {
  await apiJson('/api/admin/security/unlock-attempt', { method: 'POST', body: { key } });
  notifyDashboardInvalidation();
}

export async function fetchServerAdAnalytics(): Promise<ServerAdAnalytics> {
  try {
    const resp = await fetch(apiUrl('/api/ads/analytics'), {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) {
      return { totalImpressions: 0, totalClicks: 0, ctr: 0, blockedFakeClicks: 0, byAd: {} };
    }
    return (await resp.json()) as ServerAdAnalytics;
  } catch {
    return { totalImpressions: 0, totalClicks: 0, ctr: 0, blockedFakeClicks: 0, byAd: {} };
  }
}

export async function adminUpdateUserStatusServer(
  targetUid: string,
  status: 'active' | 'suspended',
  reason?: string
): Promise<void> {
  await apiJson('/api/admin/update-user-status', {
    method: 'POST',
    body: { targetUid, status, reason },
  });
  notifyDashboardInvalidation();
}

export async function adminUpdateCustomer(
  uid: string,
  updates: { status: 'active' | 'suspended'; promotionalCredits: number }
): Promise<void> {
  await adminUpdateUserStatusServer(uid, updates.status);
}

export async function adminSendPromoReward(params: {
  userId: string;
  currentCredits: number;
  bonusBdt: number;
  titleBn: string;
  titleEn: string;
  messageBn: string;
  messageEn: string;
}): Promise<void> {
  await apiJson('/api/admin/wallet/adjust', {
    method: 'POST',
    body: {
      targetUid: params.userId,
      promoDeltaBdt: Math.max(0, Math.round(params.bonusBdt)),
      reason: `${params.titleEn}: ${params.messageEn}`.slice(0, 280),
    },
  });
  notifyDashboardInvalidation();
}

export async function adminProcessWithdrawalServer(params: {
  withdrawalId: string;
  status?: Exclude<WithdrawalStatus, 'Pending'>;
  decision?: 'approve' | 'processing' | 'paid' | 'reject';
  payoutReference?: string;
  adminNote?: string;
  rejectionReason?: string;
}): Promise<{ status: WithdrawalStatus; paidAt?: number }> {
  const res = await apiJson<{ ok: true; status: WithdrawalStatus; paidAt?: number }>('/api/admin/process-withdrawal', {
    method: 'POST',
    body: params,
  });
  notifyDashboardInvalidation();
  return { status: res.status, paidAt: res.paidAt };
}

export async function adminBroadcastAnnouncementServer(params: {
  titleBn: string;
  titleEn: string;
  messageBn: string;
  messageEn: string;
  type: AnnouncementType;
  imageUrl?: string;
  startDate?: string;
  expiresAt?: string;
  dismissible?: boolean;
  active?: boolean;
}): Promise<{ id: string }> {
  const res = await apiJson<{ ok: true; id: string }>('/api/admin/broadcast-announcement', {
    method: 'POST',
    body: params,
  });
  notifyDashboardInvalidation();
  notifyCatalogInvalidation();
  return { id: res.id };
}

export async function adminUpdateAnnouncementServer(
  id: string,
  params: {
    titleBn?: string;
    titleEn?: string;
    messageBn?: string;
    messageEn?: string;
    type?: AnnouncementType;
    imageUrl?: string;
    startDate?: string;
    expiresAt?: string;
    dismissible?: boolean;
    active?: boolean;
  }
): Promise<void> {
  await apiJson(`/api/admin/announcements/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: params,
  });
  notifyDashboardInvalidation();
  notifyCatalogInvalidation();
}

export async function adminToggleAnnouncementActive(id: string, active: boolean): Promise<void> {
  await apiJson(`/api/admin/announcements/${encodeURIComponent(id)}/toggle`, {
    method: 'POST',
    body: { active },
  });
  notifyDashboardInvalidation();
  notifyCatalogInvalidation();
}

export async function adminDeleteAnnouncement(id: string): Promise<void> {
  await apiJson(`/api/admin/announcements/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  notifyDashboardInvalidation();
  notifyCatalogInvalidation();
}

export async function adminReplyTicket(
  ticket: SupportTicket,
  status: SupportTicket['status'],
  adminReply: string
): Promise<void> {
  await apiJson(`/api/admin/tickets/${encodeURIComponent(ticket.id)}/reply`, {
    method: 'POST',
    body: { status, adminReply: adminReply.slice(0, 2000) },
  });
  notifyDashboardInvalidation();
}

export async function adminSettleRewardClaimServer(params: {
  claimId: string;
  decision: 'credit' | 'reject';
  rejectionReason?: string;
}): Promise<void> {
  await apiJson('/api/admin/settle-reward-claim', {
    method: 'POST',
    body: params,
  });
  notifyDashboardInvalidation();
}

export async function adminSettleCoinRedemptionServer(params: {
  txId: string;
  decision: 'credit' | 'reject';
  reason?: string;
}): Promise<{ ok: boolean; status: string }> {
  const res = await apiJson<{ ok: true; status: string }>('/api/admin/settle-coin-redemption', {
    method: 'POST',
    body: params,
  });
  notifyDashboardInvalidation();
  return { ok: true, status: res.status };
}

export async function adminSettleReferralServer(params: {
  referralId: string;
  decision: 'credit' | 'revoke';
  reason?: string;
}): Promise<{ ok: boolean; status: string }> {
  const res = await apiJson<{ ok: true; status: string }>('/api/admin/settle-referral', {
    method: 'POST',
    body: params,
  });
  notifyDashboardInvalidation();
  return { ok: true, status: res.status };
}

export async function adminUpdateReferralStatus(
  referralId: string,
  status: Referral['status']
): Promise<void> {
  await adminSettleReferralServer({
    referralId,
    decision: status === 'credited' ? 'credit' : 'revoke',
  });
}

export async function adminToggleReviewApproval(reviewId: string, approved: boolean): Promise<void> {
  await apiJson(`/api/admin/reviews/${encodeURIComponent(reviewId)}/approval`, {
    method: 'POST',
    body: { approved },
  });
  notifyDashboardInvalidation();
  notifyCatalogInvalidation();
}

export async function adminDeleteReview(reviewId: string): Promise<void> {
  await apiJson(`/api/admin/reviews/${encodeURIComponent(reviewId)}`, {
    method: 'DELETE',
  });
  notifyDashboardInvalidation();
  notifyCatalogInvalidation();
}

async function saveCatalogOverride(
  collectionName: string,
  id: string,
  data: Record<string, unknown>,
  extra?: { auditAction?: string; auditReason?: string; previousSnapshot?: Record<string, unknown> }
): Promise<void> {
  await apiJson(`/api/admin/catalog/${encodeURIComponent(collectionName)}`, {
    method: 'POST',
    body: {
      id,
      data,
      ...(extra?.auditAction ? { auditAction: extra.auditAction } : {}),
      ...(extra?.auditReason ? { auditReason: extra.auditReason } : {}),
      ...(extra?.previousSnapshot ? { previousSnapshot: extra.previousSnapshot } : {}),
    },
  });
  notifyCatalogInvalidation();
  notifyDashboardInvalidation();
}

async function deleteCatalogOverride(collectionName: string, docId: string): Promise<void> {
  await apiJson(`/api/admin/catalog/${encodeURIComponent(collectionName)}/${encodeURIComponent(docId)}`, {
    method: 'DELETE',
  });
  notifyCatalogInvalidation();
  notifyDashboardInvalidation();
}

export async function adminSaveCategory(cat: Category, _isNew: boolean): Promise<void> {
  await saveCatalogOverride('categories', cat.id, cat as unknown as Record<string, unknown>);
}

export async function adminDeleteCategory(categoryId: string): Promise<void> {
  await deleteCatalogOverride('categories', categoryId);
}

export async function adminSaveProduct(
  prod: Product,
  isNew: boolean,
  options?: {
    auditAction?:
      | 'create'
      | 'update'
      | 'price_change'
      | 'logo_change'
      | 'status_change'
      | 'duration_change'
      | 'features_change'
      | 'duplicate';
    auditReason?: string;
    previousSnapshot?: Product;
  }
): Promise<void> {
  const cleanPackages = (prod.packages || [])
    .filter((pk) => pk.nameEn.trim() && pk.priceBdt > 0)
    .slice(0, 200)
    .map((pk, idx) => {
      const cleanPkPrice = Math.max(1, Math.round(pk.priceBdt));
      const rawPkOrig = pk.originalPriceBdt && pk.originalPriceBdt > 0 ? Math.round(pk.originalPriceBdt) : 0;
      const genuinePkOrig = rawPkOrig > cleanPkPrice ? rawPkOrig : 0;
      const rawPkSupplier =
        typeof pk.supplierPriceBdt === 'number' && pk.supplierPriceBdt > 0
          ? Math.round(pk.supplierPriceBdt)
          : rawPkOrig > 0 && rawPkOrig <= cleanPkPrice
            ? rawPkOrig
            : 0;
      return {
        id: sanitizeId(pk.id || `pkg_${idx + 1}`),
        nameBn: (pk.nameBn || pk.nameEn).trim().slice(0, 120),
        nameEn: (pk.nameEn || pk.nameBn).trim().slice(0, 120),
        priceBdt: cleanPkPrice,
        ...(genuinePkOrig > 0 ? { originalPriceBdt: genuinePkOrig } : {}),
        ...(rawPkSupplier > 0 ? { supplierPriceBdt: rawPkSupplier } : {}),
        ...(pk.availability ? { availability: pk.availability } : {}),
        ...(pk.durationBn ? { durationBn: pk.durationBn.trim().slice(0, 60) } : {}),
        ...(pk.durationEn ? { durationEn: pk.durationEn.trim().slice(0, 60) } : {}),
        ...(pk.deliveryDurationBn ? { deliveryDurationBn: pk.deliveryDurationBn.trim().slice(0, 60) } : {}),
        ...(pk.deliveryDurationEn ? { deliveryDurationEn: pk.deliveryDurationEn.trim().slice(0, 60) } : {}),
        ...(pk.tag ? { tag: pk.tag.trim().slice(0, 32) } : {}),
      };
    });

  const cleanStock =
    typeof prod.stockCount === 'number' && !Number.isNaN(prod.stockCount)
      ? Math.min(1000000, Math.max(0, Math.round(prod.stockCount)))
      : prod.availability === 'out_of_stock'
        ? 0
        : prod.availability === 'limited'
          ? 12
          : 100;

  const cleanPrice = Math.max(1, Math.round(Number(prod.priceBdt) || 1));
  const rawOrig = Math.round(Number(prod.originalPriceBdt ?? prod.regularPriceBdt ?? 0) || 0);
  const cleanOrig = rawOrig > cleanPrice ? rawOrig : 0;
  const cleanSupplier =
    typeof prod.supplierPriceBdt === 'number' && prod.supplierPriceBdt > 0
      ? Math.round(prod.supplierPriceBdt)
      : rawOrig > 0 && rawOrig <= cleanPrice
        ? rawOrig
        : 0;
  const computedDiscount =
    cleanOrig > cleanPrice
      ? Math.min(95, Math.max(1, Math.round(((cleanOrig - cleanPrice) / cleanOrig) * 100)))
      : 0;

  const cleanFeatures = Array.isArray(prod.features)
    ? prod.features
        .map((f) => String(f || '').trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, 30)
    : undefined;

  const durationUnit = prod.durationUnit;
  const durationValue =
    typeof prod.durationValue === 'number' && Number.isFinite(prod.durationValue) && prod.durationValue > 0
      ? Math.round(prod.durationValue)
      : undefined;

  const payload: Record<string, unknown> = {
    id: prod.id,
    categoryId: prod.categoryId,
    ...(prod.catalogSectionId ? { catalogSectionId: prod.catalogSectionId.trim().slice(0, 60) } : {}),
    subcategoryBn: (prod.subcategoryBn || '').trim().slice(0, 100),
    subcategoryEn: (prod.subcategoryEn || '').trim().slice(0, 100),
    brandKey: (prod.brandKey || '').trim().slice(0, 40),
    titleBn: (prod.titleBn || prod.titleEn).trim().slice(0, 160),
    titleEn: (prod.titleEn || prod.titleBn).trim().slice(0, 160),
    descriptionBn: (prod.descriptionBn || prod.descriptionEn || '').trim().slice(0, 1500),
    descriptionEn: (prod.descriptionEn || prod.descriptionBn || '').trim().slice(0, 1500),
    priceBdt: cleanPrice,
    originalPriceBdt: cleanOrig,
    regularPriceBdt: cleanOrig || cleanPrice,
    ...(cleanSupplier > 0 ? { supplierPriceBdt: cleanSupplier } : {}),
    discountPercent: computedDiscount,
    currency: 'BDT',
    ...(cleanPackages.length > 0 ? { packages: cleanPackages } : { packages: [] }),
    availability: prod.availability || 'in_stock',
    stockCount: prod.availability === 'out_of_stock' ? 0 : cleanStock,
    ...(prod.orderFormType ? { orderFormType: prod.orderFormType } : {}),
    deliveryDurationBn: (prod.deliveryDurationBn || prod.deliveryDurationEn || '৫ - ১৫ মিনিট').trim().slice(0, 100),
    deliveryDurationEn: (prod.deliveryDurationEn || prod.deliveryDurationBn || '5 - 15 mins').trim().slice(0, 100),
    validityBn: (prod.durationLabelBn || prod.validityBn || '').trim().slice(0, 200),
    validityEn: (prod.durationLabelEn || prod.validityEn || '').trim().slice(0, 200),
    ...(durationUnit ? { durationUnit } : {}),
    ...(durationValue ? { durationValue } : {}),
    ...(prod.durationLabelBn ? { durationLabelBn: prod.durationLabelBn.trim().slice(0, 120) } : {}),
    ...(prod.durationLabelEn ? { durationLabelEn: prod.durationLabelEn.trim().slice(0, 120) } : {}),
    instructionsBn: (prod.instructionsBn || '').trim().slice(0, 1000),
    instructionsEn: (prod.instructionsEn || '').trim().slice(0, 1000),
    termsBn: (prod.termsBn || '').trim().slice(0, 1000),
    termsEn: (prod.termsEn || '').trim().slice(0, 1000),
    benefitsBn: (prod.benefitsBn || (cleanFeatures && cleanFeatures.length > 0 ? cleanFeatures.join(' • ') : ''))
      .trim()
      .slice(0, 1200),
    benefitsEn: (prod.benefitsEn || (cleanFeatures && cleanFeatures.length > 0 ? cleanFeatures.join(' • ') : ''))
      .trim()
      .slice(0, 1200),
    ...(cleanFeatures ? { features: cleanFeatures } : {}),
    ...(prod.badge ? { badge: prod.badge.trim().slice(0, 40) } : { badge: '' }),
    sectionTag: prod.sectionTag || 'standard',
    imageUrl: (prod.imageUrl || '').trim().slice(0, 200000) || '/assets/products/prod_ff_bd_diamonds.jpg',
    ...(prod.bannerUrl ? { bannerUrl: prod.bannerUrl.trim().slice(0, 200000) } : {}),
    customLogoUrl: (prod.customLogoUrl || '').trim().slice(0, 200000),
    featured: Boolean(prod.featured),
    ...(typeof prod.sortOrder === 'number' && !Number.isNaN(prod.sortOrder)
      ? { sortOrder: Math.min(1000000, Math.max(0, Math.round(prod.sortOrder))) }
      : {}),
    active: Boolean(prod.active),
    ...(prod.createdAt ? { createdAt: prod.createdAt } : {}),
  };

  await saveCatalogOverride('products', prod.id, payload, {
    auditAction: options?.auditAction || (isNew ? 'create' : 'update'),
    auditReason: options?.auditReason,
    previousSnapshot: options?.previousSnapshot
      ? (options.previousSnapshot as unknown as Record<string, unknown>)
      : undefined,
  });
}

export async function adminQuickUpdatePackage(
  prod: Product,
  updates: Partial<
    Pick<
      Product,
      | 'active'
      | 'featured'
      | 'sectionTag'
      | 'sortOrder'
      | 'availability'
      | 'stockCount'
      | 'priceBdt'
      | 'originalPriceBdt'
      | 'supplierPriceBdt'
      | 'packages'
      | 'customLogoUrl'
      | 'imageUrl'
      | 'badge'
      | 'durationValue'
      | 'durationUnit'
      | 'durationLabelBn'
      | 'durationLabelEn'
      | 'validityBn'
      | 'validityEn'
      | 'features'
      | 'benefitsBn'
      | 'benefitsEn'
    >
  >,
  auditOptions?: {
    auditAction?:
      | 'update'
      | 'price_change'
      | 'logo_change'
      | 'status_change'
      | 'duration_change'
      | 'features_change';
    auditReason?: string;
  }
): Promise<void> {
  await adminSaveProduct({ ...prod, ...updates }, false, {
    auditAction: auditOptions?.auditAction || 'update',
    auditReason: auditOptions?.auditReason,
    previousSnapshot: prod,
  });
}

export async function adminDeleteProduct(productId: string): Promise<void> {
  await deleteCatalogOverride('products', productId);
}

export async function adminSaveAdvertisement(ad: Advertisement, _isNew: boolean): Promise<void> {
  await saveCatalogOverride('advertisements', ad.id, {
    ...ad,
    adFormat: ad.adFormat || 'direct_link',
    networkName: ad.networkName || 'Direct Partner',
  });
}

export async function adminDeleteAdvertisement(adId: string): Promise<void> {
  await deleteCatalogOverride('advertisements', adId);
}

const FORBIDDEN_DIRECT_AD_HOSTS = /(asiafilm\.org\/4\/|auctionr\.org\/4\/|arwf\.org\/4\/|bicea\.org\/22\/)/i;

export async function adminSaveAdNetwork(net: AdNetworkConfig, _isNew: boolean): Promise<void> {
  const cleanSrc = (net.scriptSrc || '').trim();
  if (cleanSrc) {
    if (!cleanSrc.startsWith('https://')) {
      throw new Error('Official Ad Network Script URL must start with https://');
    }
    if (FORBIDDEN_DIRECT_AD_HOSTS.test(cleanSrc)) {
      throw new Error(
        'Direct advertisement URLs (asiafilm.org, auctionr.org, arwf.org, bicea.org) cannot be used as publisher scripts. Keep them as Direct Link advertisements.'
      );
    }
  }
  if (net.provider === 'adsense' && net.supportsIncentivizedRewards) {
    throw new Error('Policy violation: Google AdSense does not allow incentivized or rewarded user clicks.');
  }
  const allowRewards = net.provider === 'adsense' ? false : Boolean(net.supportsIncentivizedRewards);
  await saveCatalogOverride('adNetworks', net.id, {
    ...net,
    supportsIncentivizedRewards: allowRewards,
    scriptSrc: cleanSrc,
  });
}

export async function adminDeleteAdNetwork(networkId: string): Promise<void> {
  await deleteCatalogOverride('adNetworks', networkId);
}

export async function adminAddAdRevenueEntry(entry: Omit<AdRevenueEntry, 'createdAt'>): Promise<void> {
  await saveCatalogOverride('adRevenueEntries', entry.id, {
    ...entry,
    createdAt: Date.now(),
  });
}

export async function adminDeleteAdRevenueEntry(entryId: string): Promise<void> {
  await deleteCatalogOverride('adRevenueEntries', entryId);
}

export async function adminSaveBanner(banner: Banner, _isNew: boolean): Promise<void> {
  await saveCatalogOverride('banners', banner.id, banner as unknown as Record<string, unknown>);
}

export async function adminDeleteBanner(bannerId: string): Promise<void> {
  await deleteCatalogOverride('banners', bannerId);
}

export async function adminSaveHeroBanner(banner: HeroBanner, _isNew: boolean): Promise<void> {
  await saveCatalogOverride('heroBanners', banner.id, banner as unknown as Record<string, unknown>);
}

export async function adminDeleteHeroBanner(bannerId: string): Promise<void> {
  await deleteCatalogOverride('heroBanners', bannerId);
}

export async function fetchDailyRewardStatusServer(): Promise<DailyRewardStatus | null> {
  try {
    const res = await apiJson<{ ok: true; status: DailyRewardStatus }>('/api/rewards/daily-status', {
      method: 'GET',
    });
    return res.status;
  } catch {
    return null;
  }
}

export async function claimDailyRewardServer(): Promise<{
  ok: boolean;
  alreadyClaimed?: boolean;
  claimId?: string;
  transactionId?: string;
  baseCoins?: number;
  bonusCoins?: number;
  totalCoins?: number;
  streakDay?: number;
  status?: DailyRewardStatus;
  message?: string;
  error?: string;
}> {
  const resp = await fetch(apiUrl('/api/rewards/daily-claim'), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({}),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    alreadyClaimed?: boolean;
    claimId?: string;
    transactionId?: string;
    baseCoins?: number;
    bonusCoins?: number;
    totalCoins?: number;
    streakDay?: number;
    status?: DailyRewardStatus;
    message?: string;
    error?: string;
  };
  notifyDashboardInvalidation();
  return {
    ok: Boolean(resp.ok && data.ok),
    alreadyClaimed: data.alreadyClaimed,
    claimId: data.claimId,
    transactionId: data.transactionId,
    baseCoins: data.baseCoins,
    bonusCoins: data.bonusCoins,
    totalCoins: data.totalCoins,
    streakDay: data.streakDay,
    status: data.status,
    message: data.message,
    error: data.error,
  };
}

export async function fetchMyCoinHistoryServer(): Promise<{
  coinsAvailable: number;
  coinsLifetimeEarned: number;
  coinsRedeemed: number;
  dailyRewardStatus: DailyRewardStatus | null;
  transactions: AdRewardTransaction[];
} | null> {
  try {
    const res = await apiJson<{
      ok: true;
      coinsAvailable: number;
      coinsLifetimeEarned: number;
      coinsRedeemed: number;
      dailyRewardStatus: DailyRewardStatus | null;
      transactions: AdRewardTransaction[];
    }>('/api/me/coin-history', { method: 'GET' });
    return res;
  } catch {
    return null;
  }
}

export async function adminFetchDailyRewardClaims(params?: {
  date?: string;
  search?: string;
  limit?: number;
}): Promise<{
  todayDate: string;
  stats: {
    todayClaims: number;
    todayCoinsDistributed: number;
    totalClaims: number;
    totalCoinsDistributed: number;
    activeStreaks: number;
  };
  claims: DailyRewardClaimRecord[];
}> {
  const q = new URLSearchParams();
  if (params?.date) q.set('date', params.date);
  if (params?.search) q.set('search', params.search);
  if (params?.limit) q.set('limit', String(params.limit));
  const qs = q.toString();
  const res = await apiJson<{
    ok: true;
    todayDate: string;
    stats: {
      todayClaims: number;
      todayCoinsDistributed: number;
      totalClaims: number;
      totalCoinsDistributed: number;
      activeStreaks: number;
    };
    claims: DailyRewardClaimRecord[];
  }>(`/api/admin/rewards/daily-claims${qs ? `?${qs}` : ''}`, { method: 'GET' });
  return { todayDate: res.todayDate, stats: res.stats, claims: res.claims };
}

export async function adminSaveCoupon(coupon: Coupon, _isNew: boolean): Promise<void> {
  const cleanCode = coupon.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  await saveCatalogOverride('coupons', coupon.id, {
    ...coupon,
    code: cleanCode,
  });
}

export async function adminDeleteCoupon(couponId: string): Promise<void> {
  await deleteCatalogOverride('coupons', couponId);
}

export async function adminSaveSiteSettings(settings: SiteSettings): Promise<void> {
  const cleaned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(settings)) {
    if (v !== undefined) {
      if (
        (k === 'bkashLogoUrl' ||
          k === 'nagadLogoUrl' ||
          k === 'rocketLogoUrl' ||
          k === 'logoUrl' ||
          k === 'faviconUrl') &&
        typeof v === 'string'
      ) {
        cleaned[k] = v.trim().slice(0, 200000);
      } else {
        cleaned[k] = v;
      }
    }
  }
  await saveCatalogOverride('settings', 'global', { ...cleaned, id: 'global' });
}

export async function adminSaveManagedAdUnit(unit: {
  id: string;
  enabled: boolean;
  placements: AdPlacementSlot[];
  showOnMobile: boolean;
  showOnDesktop: boolean;
  priority: number;
  rotationSeconds: number;
  supportsRewardedVerification?: boolean;
  originalUrl?: string;
  rawScriptHtml?: string;
  label?: string;
  labelBn?: string;
}): Promise<void> {
  await saveCatalogOverride('managedAdUnits', unit.id, {
    id: unit.id,
    enabled: Boolean(unit.enabled),
    placements: unit.placements.slice(0, 17),
    showOnMobile: Boolean(unit.showOnMobile),
    showOnDesktop: Boolean(unit.showOnDesktop),
    priority: Math.max(1, Math.min(999, Number(unit.priority) || 1)),
    rotationSeconds: Math.max(5, Math.min(300, Number(unit.rotationSeconds) || 20)),
    supportsRewardedVerification: Boolean(unit.supportsRewardedVerification),
    ...(unit.originalUrl ? { originalUrl: unit.originalUrl.trim() } : {}),
    ...(unit.rawScriptHtml ? { rawScriptHtml: unit.rawScriptHtml } : {}),
    ...(unit.label ? { label: unit.label.trim() } : {}),
    ...(unit.labelBn ? { labelBn: unit.labelBn.trim() } : {}),
  });
}

export async function adminMigratePhase1Server(): Promise<{
  updatedNagad: boolean;
  addedAd07: boolean;
  addedBanner07: boolean;
}> {
  notifyCatalogInvalidation();
  return { updatedNagad: true, addedAd07: true, addedBanner07: true };
}

// =========================================================================
// TIMESTAMP FORMATTING UTILITIES
// =========================================================================

export function getTimeMs(ts: unknown): number {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') return Date.parse(ts) || 0;
  if (
    typeof ts === 'object' &&
    ts !== null &&
    'toMillis' in ts &&
    typeof (ts as { toMillis: () => number }).toMillis === 'function'
  ) {
    return (ts as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export function formatDateShort(ts: unknown, lang: 'bn' | 'en'): string {
  const ms = getTimeMs(ts);
  if (!ms) return lang === 'bn' ? 'এইমাত্র' : 'Just now';
  return new Date(ms).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
