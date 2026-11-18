import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType, reauthenticateOwnerWithGoogle } from './firebase';
import { apiUrl } from './apiClient';
import {
  DEFAULT_AD_NETWORKS,
  DEFAULT_ADVERTISEMENTS,
  DEFAULT_BANNERS,
  DEFAULT_CATEGORIES,
  DEFAULT_COUPONS,
  DEFAULT_PRODUCTS,
  DEFAULT_SITE_SETTINGS,
} from './seedData';
import { DIGITAL_HUB_AD_PROVIDER_CONFIG, mergeAdUnitsWithOverrides } from './adProviderConfig';
import {
  AdNetworkConfig,
  AdPlacementSlot,
  AdRevenueEntry,
  AdRewardTransaction,
  AdViewingSession,
  AdminRecord,
  Advertisement,
  Announcement,
  AppNotification,
  AuditLog,
  AuthMethod,
  Banner,
  CartItem,
  Category,
  Coupon,
  ManagedAdUnitConfig,
  Order,
  OrderStatus,
  Payment,
  PaymentMethod,
  Product,
  Referral,
  Review,
  RewardedAdClaim,
  SiteSettings,
  SupportTicket,
  UserProfile,
  WalletAccount,
  WalletTransaction,
  WithdrawalRequest,
} from '../types/marketplace';

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

// Public Subscriptions
export function subscribeCategories(cb: (items: Category[]) => void): Unsubscribe {
  const q = query(collection(db, 'categories'), orderBy('sortOrder', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Category);
      cb(list.length > 0 ? list : DEFAULT_CATEGORIES);
    },
    () => cb(DEFAULT_CATEGORIES)
  );
}

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

export function subscribeProducts(cb: (items: Product[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'products'),
    (snap) => {
      if (snap.empty) {
        cb(DEFAULT_PRODUCTS);
        return;
      }
      const deletedIds = new Set<string>();
      try {
        const raw = localStorage.getItem('dh_deleted_prod_ids');
        if (raw) (JSON.parse(raw) as string[]).forEach((id) => deletedIds.add(id));
      } catch {
        // Non-fatal
      }

      const firestoreItems = snap.docs.map((d) => {
        const prod = d.data() as Product;
        const def = DEFAULT_PRODUCTS_BY_ID.get(prod.id);
        return mergeUpgradedProduct(prod, def);
      });

      const seenIds = new Set(firestoreItems.map((p) => p.id));
      const missingDefaults = DEFAULT_PRODUCTS.filter(
        (p) => !seenIds.has(p.id) && !deletedIds.has(p.id)
      );
      const combined = [...firestoreItems, ...missingDefaults].sort(
        (a, b) => (a.sortOrder ?? 99999) - (b.sortOrder ?? 99999)
      );
      cb(combined);
    },
    () => cb(DEFAULT_PRODUCTS)
  );
}

export function subscribeAdvertisements(cb: (items: Advertisement[]) => void): Unsubscribe {
  const q = query(collection(db, 'advertisements'), orderBy('sortOrder', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Advertisement);
      if (list.length === 0) {
        cb(DEFAULT_ADVERTISEMENTS);
        return;
      }
      const seen = new Set(list.map((a) => a.id));
      const missingAd07 = DEFAULT_ADVERTISEMENTS.filter((a) => a.id === 'ad_07' && !seen.has(a.id));
      cb([...list, ...missingAd07]);
    },
    () => cb(DEFAULT_ADVERTISEMENTS)
  );
}

export function subscribeBanners(cb: (items: Banner[]) => void): Unsubscribe {
  const q = query(collection(db, 'banners'), orderBy('sortOrder', 'asc'));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Banner);
      if (list.length === 0) {
        cb(DEFAULT_BANNERS);
        return;
      }
      const seen = new Set(list.map((b) => b.id));
      const missingAd07Ban = DEFAULT_BANNERS.filter((b) => b.id === 'ban_between_2' && !seen.has(b.id));
      cb([...list, ...missingAd07Ban]);
    },
    () => cb(DEFAULT_BANNERS)
  );
}

export function subscribeCoupons(cb: (items: Coupon[]) => void): Unsubscribe {
  const q = query(collection(db, 'coupons'), where('active', '==', true));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => d.data() as Coupon);
      cb(list.length > 0 ? list : DEFAULT_COUPONS);
    },
    () => cb(DEFAULT_COUPONS)
  );
}

export function subscribeApprovedReviews(cb: (items: Review[]) => void): Unsubscribe {
  const q = query(collection(db, 'reviews'), where('approved', '==', true));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as Review)),
    () => cb([])
  );
}

export function subscribeSiteSettings(cb: (settings: SiteSettings) => void): Unsubscribe {
  return onSnapshot(
    doc(db, 'siteSettings', 'global'),
    (snap) => {
      if (snap.exists()) {
        const data = snap.data() as SiteSettings;
        const normalizedNagad =
          !data.nagadNumber || data.nagadNumber === '01727936180'
            ? DEFAULT_SITE_SETTINGS.nagadNumber
            : data.nagadNumber;
        const normalizedTelegram =
          !data.telegramLink || data.telegramLink === 'https://t.me/digitalhub_bd'
            ? DEFAULT_SITE_SETTINGS.telegramLink
            : data.telegramLink;
        const normalizedWhatsapp =
          !data.whatsappLink ? DEFAULT_SITE_SETTINGS.whatsappLink : data.whatsappLink;
        const normalizedTelegramChannel =
          !data.telegramChannelLink
            ? DEFAULT_SITE_SETTINGS.telegramChannelLink
            : data.telegramChannelLink;
        cb({
          ...DEFAULT_SITE_SETTINGS,
          ...data,
          nagadNumber: normalizedNagad,
          telegramLink: normalizedTelegram,
          whatsappLink: normalizedWhatsapp,
          telegramChannelLink: normalizedTelegramChannel,
        });
      } else {
        cb(DEFAULT_SITE_SETTINGS);
      }
    },
    () => cb(DEFAULT_SITE_SETTINGS)
  );
}

export function subscribeAdNetworks(cb: (items: AdNetworkConfig[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'adNetworks'),
    (snap) => {
      const list = snap.docs.map((d) => d.data() as AdNetworkConfig);
      cb(list.length > 0 ? list : DEFAULT_AD_NETWORKS);
    },
    () => cb(DEFAULT_AD_NETWORKS)
  );
}

export function subscribeManagedAdUnits(cb: (items: ManagedAdUnitConfig[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'advertisingUnits'),
    (snap) => {
      const overrides = snap.docs.map((d) => d.data() as ManagedAdUnitConfig);
      cb(mergeAdUnitsWithOverrides(overrides));
    },
    () => cb(DIGITAL_HUB_AD_PROVIDER_CONFIG)
  );
}

async function commitChunkedOperations(
  ops: Array<(batch: ReturnType<typeof writeBatch>) => void>
): Promise<void> {
  const CHUNK_SIZE = 350;
  for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
    const chunk = ops.slice(i, i + CHUNK_SIZE);
    const batch = writeBatch(db);
    chunk.forEach((fn) => fn(batch));
    await batch.commit();
  }
}

export async function seedMarketplaceToFirestore(forceOverwrite = false): Promise<{ addedCount: number }> {
  const path = 'siteSettings/global';
  try {
    const [
      existingSettings,
      existingCatsSnap,
      existingProdsSnap,
      existingAdsSnap,
      existingBannersSnap,
      existingCouponsSnap,
      existingNetsSnap,
    ] = await Promise.all([
      getDoc(doc(db, 'siteSettings', 'global')),
      getDocs(collection(db, 'categories')),
      getDocs(collection(db, 'products')),
      getDocs(collection(db, 'advertisements')),
      getDocs(collection(db, 'banners')),
      getDocs(collection(db, 'coupons')),
      getDocs(collection(db, 'adNetworks')),
    ]);

    const existingCatIds = new Set(existingCatsSnap.docs.map((d) => d.id));
    const existingAdIds = new Set(existingAdsSnap.docs.map((d) => d.id));
    const existingBannerIds = new Set(existingBannersSnap.docs.map((d) => d.id));
    const existingCouponIds = new Set(existingCouponsSnap.docs.map((d) => d.id));
    const existingNetIds = new Set(existingNetsSnap.docs.map((d) => d.id));

    const existingProdsById = new Map<string, Product>(
      existingProdsSnap.docs.map((d) => [d.id, d.data() as Product])
    );

    const ops: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

    if (forceOverwrite || !existingSettings.exists()) {
      ops.push((b) =>
        b.set(doc(db, 'siteSettings', 'global'), {
          ...DEFAULT_SITE_SETTINGS,
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      const sData = existingSettings.data() as Partial<SiteSettings> | undefined;
      const patch: Partial<SiteSettings> & { updatedAt?: ReturnType<typeof serverTimestamp> } = {};
      if (sData?.nagadNumber === '01727936180') {
        patch.nagadNumber = '01772558301';
      }
      if (!sData?.telegramLink || sData.telegramLink === 'https://t.me/digitalhub_bd') {
        patch.telegramLink = DEFAULT_SITE_SETTINGS.telegramLink;
      }
      if (!sData?.whatsappLink) {
        patch.whatsappLink = DEFAULT_SITE_SETTINGS.whatsappLink;
      }
      if (!sData?.telegramChannelLink) {
        patch.telegramChannelLink = DEFAULT_SITE_SETTINGS.telegramChannelLink;
      }
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = serverTimestamp();
        ops.push((b) => b.update(doc(db, 'siteSettings', 'global'), patch));
      }
    }

    for (const cat of DEFAULT_CATEGORIES) {
      if (forceOverwrite || !existingCatIds.has(cat.id)) {
        ops.push((b) =>
          b.set(doc(db, 'categories', cat.id), {
            ...cat,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
    }

    for (const prod of DEFAULT_PRODUCTS) {
      const existingProd = existingProdsById.get(prod.id);
      if (forceOverwrite || !existingProd) {
        ops.push((b) =>
          b.set(doc(db, 'products', prod.id), {
            ...prod,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      } else if (isLegacySeededProduct(existingProd, prod)) {
        ops.push((b) =>
          b.update(doc(db, 'products', prod.id), {
            priceBdt: prod.priceBdt,
            originalPriceBdt: prod.originalPriceBdt,
            discountPercent: 0,
            ...(prod.packages ? { packages: prod.packages } : {}),
            imageUrl: prod.imageUrl,
            descriptionBn: prod.descriptionBn,
            descriptionEn: prod.descriptionEn,
            validityBn: (prod.validityBn || '').slice(0, 200),
            validityEn: (prod.validityEn || '').slice(0, 200),
            benefitsBn: (prod.benefitsBn || '').slice(0, 1000),
            benefitsEn: (prod.benefitsEn || '').slice(0, 1000),
            instructionsBn: (prod.instructionsBn || '').slice(0, 1000),
            instructionsEn: (prod.instructionsEn || '').slice(0, 1000),
            termsBn: (prod.termsBn || '').slice(0, 1000),
            termsEn: (prod.termsEn || '').slice(0, 1000),
            updatedAt: serverTimestamp(),
          })
        );
      }
    }

    for (const ad of DEFAULT_ADVERTISEMENTS) {
      if (forceOverwrite || !existingAdIds.has(ad.id)) {
        ops.push((b) =>
          b.set(doc(db, 'advertisements', ad.id), {
            ...ad,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
    }

    for (const banner of DEFAULT_BANNERS) {
      if (forceOverwrite || !existingBannerIds.has(banner.id)) {
        ops.push((b) =>
          b.set(doc(db, 'banners', banner.id), {
            ...banner,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
    }

    for (const coupon of DEFAULT_COUPONS) {
      if (forceOverwrite || !existingCouponIds.has(coupon.id)) {
        ops.push((b) =>
          b.set(doc(db, 'coupons', coupon.id), {
            ...coupon,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
    }

    for (const net of DEFAULT_AD_NETWORKS) {
      if (forceOverwrite || !existingNetIds.has(net.id)) {
        ops.push((b) =>
          b.set(doc(db, 'adNetworks', net.id), {
            ...net,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        );
      }
    }

    if (ops.length > 0) {
      await commitChunkedOperations(ops);
    }
    return { addedCount: ops.length };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

const inFlightProfileEnsures = new Map<string, Promise<UserProfile | null>>();

export async function hasExistingUserProfile(uid: string): Promise<boolean> {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid || !auth.currentUser.emailVerified) {
    return false;
  }
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    return snap.exists();
  } catch {
    return false;
  }
}

const CLIENT_BENGALI_DIGITS: Record<string, string> = {
  '০': '0',
  '১': '1',
  '২': '2',
  '৩': '3',
  '৪': '4',
  '৫': '5',
  '৬': '6',
  '৭': '7',
  '৮': '8',
  '৯': '9',
};

export function normalizeBangladeshPhoneClient(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const ascii = raw.replace(/[০-৯]/g, (d) => CLIENT_BENGALI_DIGITS[d] || d);
  const cleaned = ascii.replace(/[\s\-().]/g, '').trim();
  if (!cleaned) return null;
  if (/^\+8801[3-9]\d{8}$/.test(cleaned)) return cleaned;
  if (/^8801[3-9]\d{8}$/.test(cleaned)) return `+${cleaned}`;
  if (/^01[3-9]\d{8}$/.test(cleaned)) return `+88${cleaned}`;
  if (/^1[3-9]\d{8}$/.test(cleaned)) return `+880${cleaned}`;
  return null;
}

export async function ensureUserProfile(
  uid: string,
  email: string,
  displayName: string,
  language: 'bn' | 'en' = 'bn',
  referredByCode?: string,
  photoUrl?: string,
  authMethod?: AuthMethod,
  phone?: string
): Promise<UserProfile | null> {
  if (!uid || !auth.currentUser || auth.currentUser.uid !== uid || !auth.currentUser.emailVerified) {
    return null;
  }

  const existingPromise = inFlightProfileEnsures.get(uid);
  if (existingPromise) {
    return existingPromise;
  }

  const run = (async (): Promise<UserProfile | null> => {
    const userPath = `users/${uid}`;
    try {
      const normalizedEmail = (email || auth.currentUser?.email || '').trim().toLowerCase().slice(0, 200);
      if (!normalizedEmail || normalizedEmail.length < 3) {
        return null;
      }

      const normalizedPhone = phone
        ? normalizeBangladeshPhoneClient(phone) || phone.trim().slice(0, 30)
        : '';

      const userRef = doc(db, 'users', uid);
      const walletRef = doc(db, 'walletAccounts', uid);
      const [snap, walletSnap] = await Promise.all([
        getDoc(userRef),
        getDoc(walletRef).catch(() => null),
      ]);

      if (walletSnap && !walletSnap.exists()) {
        await setDoc(walletRef, {
          uid,
          availableBalanceBdt: 0,
          promotionalCreditsBdt: 0,
          totalAddedBdt: 0,
          totalSpentBdt: 0,
          updatedAt: serverTimestamp(),
        }).catch((walletErr) => {
          console.warn('Non-fatal wallet account initialization error:', walletErr);
        });
      }

      const safeUidPrefix = uid
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 6)
        .toUpperCase()
        .padEnd(6, '0');
      const fallbackCode = `DH${safeUidPrefix}`;

      if (snap.exists()) {
        const existingProf = snap.data() as UserProfile;

        // Backfill missing photoUrl or phone on existing profile without overwriting existing data
        const safePhotoBackfill =
          !existingProf.photoUrl && typeof photoUrl === 'string' && photoUrl.trim().startsWith('https://')
            ? photoUrl.trim().slice(0, 250000)
            : '';
        const safePhoneBackfill = !existingProf.phone && normalizedPhone ? normalizedPhone : '';
        if (safePhotoBackfill || safePhoneBackfill) {
          updateDoc(userRef, {
            ...(safePhotoBackfill ? { photoUrl: safePhotoBackfill } : {}),
            ...(safePhoneBackfill ? { phone: safePhoneBackfill } : {}),
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }

        const ownCode = (existingProf.referralCode || fallbackCode).trim().toUpperCase();
        if (/^[A-Z0-9_-]{4,24}$/.test(ownCode)) {
          const refCodeRef = doc(db, 'referralCodes', ownCode);
          getDoc(refCodeRef)
            .then((refCodeSnap) => {
              if (!refCodeSnap.exists()) {
                return setDoc(refCodeRef, {
                  code: ownCode,
                  userId: uid,
                  createdAt: serverTimestamp(),
                });
              }
              return undefined;
            })
            .catch(() => {});
        }
        const refToLink =
          existingProf.referredBy ||
          (referredByCode && referredByCode.trim().toUpperCase() !== ownCode
            ? referredByCode.trim().toUpperCase()
            : '');
        if (refToLink) {
          registerReferralServer(refToLink).catch(() => {});
        }
        return {
          ...existingProf,
          ...(safePhotoBackfill ? { photoUrl: safePhotoBackfill } : {}),
          ...(safePhoneBackfill ? { phone: safePhoneBackfill } : {}),
        };
      }

      const code = fallbackCode;
      const cleanReferredBy =
        referredByCode && referredByCode.trim().toUpperCase() !== code
          ? referredByCode.trim().toUpperCase().slice(0, 24)
          : '';

      const isOwner = normalizedEmail === 'ftake810@gmail.com' && auth.currentUser?.emailVerified === true;
      const cleanDisplayName = (
        displayName.trim() ||
        normalizedEmail.split('@')[0] ||
        'Customer'
      ).slice(0, 120);
      const safePhotoUrl =
        typeof photoUrl === 'string' && photoUrl.trim().startsWith('https://')
          ? photoUrl.trim().slice(0, 250000)
          : '';

      const inferredAuthMethod: AuthMethod =
        authMethod ||
        (auth.currentUser?.providerData.some((p) => p.providerId === 'google.com')
          ? 'google'
          : normalizedPhone
            ? 'phone'
            : 'email');

      const newProfile: UserProfile = {
        uid,
        displayName: cleanDisplayName,
        email: normalizedEmail,
        role: isOwner ? 'admin' : 'user',
        authMethod: inferredAuthMethod,
        phone: normalizedPhone,
        ...(safePhotoUrl ? { photoUrl: safePhotoUrl } : {}),
        referralCode: code,
        ...(cleanReferredBy ? { referredBy: cleanReferredBy } : {}),
        promotionalCredits: 0,
        language,
        status: 'active',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      await setDoc(userRef, newProfile);

      const refCodeRef = doc(db, 'referralCodes', code);
      getDoc(refCodeRef)
        .then((refCodeSnap) => {
          if (!refCodeSnap.exists()) {
            return setDoc(refCodeRef, {
              code,
              userId: uid,
              createdAt: serverTimestamp(),
            });
          }
          return undefined;
        })
        .catch(() => {});

      if (cleanReferredBy) {
        registerReferralServer(cleanReferredBy).catch(() => {});
      }
      return newProfile;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, userPath);
    } finally {
      inFlightProfileEnsures.delete(uid);
    }
  })();

  inFlightProfileEnsures.set(uid, run);
  return run;
}

export interface PhoneAuthApiError extends Error {
  code?: string;
}

function createPhoneAuthError(code: string, message: string): PhoneAuthApiError {
  const err = new Error(message) as PhoneAuthApiError;
  err.code = code;
  return err;
}

export async function checkPhoneRegisteredServer(
  phone: string
): Promise<{ ok: boolean; normalizedPhone: string; exists: boolean }> {
  const resp = await fetch(apiUrl('/api/auth/phone/check'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    normalizedPhone?: string;
    exists?: boolean;
    code?: string;
    error?: string;
  };
  if (!resp.ok || !data.ok) {
    throw createPhoneAuthError(
      data.code || 'auth/network-request-failed',
      data.error || 'Could not verify phone number.'
    );
  }
  return {
    ok: true,
    normalizedPhone: data.normalizedPhone || '',
    exists: Boolean(data.exists),
  };
}

export async function registerPhoneIndexServer(
  phone: string
): Promise<{ ok: boolean; normalizedPhone: string }> {
  const current = auth.currentUser;
  if (!current || !current.emailVerified) {
    throw createPhoneAuthError('auth/requires-recent-login', 'Verified user session required.');
  }
  const idToken = await current.getIdToken();
  const resp = await fetch(apiUrl('/api/auth/phone/index'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ phone }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    normalizedPhone?: string;
    code?: string;
    error?: string;
  };
  if (!resp.ok || !data.ok) {
    throw createPhoneAuthError(
      data.code || 'auth/internal-error',
      data.error || 'Failed to register phone number.'
    );
  }
  return { ok: true, normalizedPhone: data.normalizedPhone || '' };
}

export async function authenticatePhoneServer(
  phone: string,
  password: string
): Promise<{ ok: boolean; normalizedPhone: string; authEmail: string }> {
  const resp = await fetch(apiUrl('/api/auth/phone/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    normalizedPhone?: string;
    authEmail?: string;
    code?: string;
    error?: string;
  };
  if (!resp.ok || !data.ok || !data.authEmail) {
    throw createPhoneAuthError(
      data.code || 'auth/invalid-credential',
      data.error || 'Phone authentication failed.'
    );
  }
  return {
    ok: true,
    normalizedPhone: data.normalizedPhone || '',
    authEmail: data.authEmail,
  };
}

export async function recoverPhoneAccountServer(
  phone: string
): Promise<{ ok: boolean; normalizedPhone: string; maskedEmail: string }> {
  const resp = await fetch(apiUrl('/api/auth/phone/recover'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    normalizedPhone?: string;
    maskedEmail?: string;
    code?: string;
    error?: string;
  };
  if (!resp.ok || !data.ok) {
    throw createPhoneAuthError(
      data.code || 'auth/user-not-found',
      data.error || 'Phone recovery failed.'
    );
  }
  return {
    ok: true,
    normalizedPhone: data.normalizedPhone || '',
    maskedEmail: data.maskedEmail || '***',
  };
}

export interface PendingAuthMeta {
  uid: string;
  authMethod: AuthMethod;
  displayName?: string;
  phone?: string;
  referralCode?: string;
}

const PENDING_AUTH_META_KEY = 'dh_pending_auth_meta_v1';

export function savePendingAuthMeta(meta: PendingAuthMeta): void {
  try {
    sessionStorage.setItem(PENDING_AUTH_META_KEY, JSON.stringify(meta));
  } catch {
    // Non-fatal
  }
}

export function readPendingAuthMeta(uid: string): PendingAuthMeta | null {
  try {
    const raw = sessionStorage.getItem(PENDING_AUTH_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingAuthMeta>;
    if (parsed && parsed.uid === uid && (parsed.authMethod === 'google' || parsed.authMethod === 'email' || parsed.authMethod === 'phone')) {
      return {
        uid: parsed.uid,
        authMethod: parsed.authMethod,
        displayName: typeof parsed.displayName === 'string' ? parsed.displayName : undefined,
        phone: typeof parsed.phone === 'string' ? parsed.phone : undefined,
        referralCode: typeof parsed.referralCode === 'string' ? parsed.referralCode : undefined,
      };
    }
  } catch {
    // Non-fatal
  }
  return null;
}

export function clearPendingAuthMeta(): void {
  try {
    sessionStorage.removeItem(PENDING_AUTH_META_KEY);
  } catch {
    // Non-fatal
  }
}

export interface BackendAuthSession {
  ok: boolean;
  uid: string;
  email: string;
  emailVerified: boolean;
  role: 'admin' | 'user';
  status: 'active' | 'suspended';
  authTime: number;
  freshAuth: boolean;
}

export async function syncBackendAuthSession(): Promise<BackendAuthSession | null> {
  const current = auth.currentUser;
  if (!current) return null;
  try {
    const idToken = await current.getIdToken();
    const resp = await fetch(apiUrl('/api/auth/session'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (!resp.ok) return null;
    return (await resp.json()) as BackendAuthSession;
  } catch {
    return null;
  }
}

export async function verifyOwnerAdminServer(): Promise<boolean> {
  const current = auth.currentUser;
  if (!current || !current.emailVerified) return false;
  if ((current.email || '').trim().toLowerCase() !== 'ftake810@gmail.com') return false;
  try {
    const idToken = await current.getIdToken();
    const resp = await fetch(apiUrl('/api/admin/verify'), {
      method: 'GET',
      headers: { Authorization: `Bearer ${idToken}` },
    });
    if (!resp.ok) return false;
    const data = (await resp.json()) as { authorized?: boolean; email?: string };
    return data.authorized === true && (data.email || '').toLowerCase() === 'ftake810@gmail.com';
  } catch {
    return false;
  }
}

export async function checkIsAdminInDb(_uid: string): Promise<boolean> {
  return verifyOwnerAdminServer();
}

export async function updateUserProfileFields(
  uid: string,
  updates: { displayName: string; phone: string; language: 'bn' | 'en'; photoUrl?: string }
): Promise<void> {
  const path = `users/${uid}`;
  try {
    await updateDoc(doc(db, 'users', uid), {
      displayName: updates.displayName.trim().slice(0, 120),
      phone: updates.phone.trim().slice(0, 30),
      language: updates.language,
      ...(updates.photoUrl !== undefined ? { photoUrl: updates.photoUrl.slice(0, 250000) } : {}),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// Customer Subscriptions
export function subscribeCustomerWallet(uid: string, cb: (w: WalletAccount) => void): Unsubscribe {
  return onSnapshot(
    doc(db, 'walletAccounts', uid),
    (snap) => {
      if (snap.exists()) {
        cb(snap.data() as WalletAccount);
      } else {
        cb({
          uid,
          availableBalanceBdt: 0,
          promotionalCreditsBdt: 0,
          totalAddedBdt: 0,
          totalSpentBdt: 0,
        });
      }
    },
    (err) => handleFirestoreError(err, OperationType.GET, `walletAccounts/${uid}`)
  );
}

export function subscribeCustomerWalletTx(uid: string, cb: (txs: WalletTransaction[]) => void): Unsubscribe {
  const q = query(collection(db, 'walletTransactions'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as WalletTransaction);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'walletTransactions')
  );
}

export function subscribeCustomerOrders(uid: string, cb: (orders: Order[]) => void): Unsubscribe {
  const q = query(collection(db, 'orders'), where('customerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as Order);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'orders')
  );
}

export function subscribeCustomerPayments(uid: string, cb: (payments: Payment[]) => void): Unsubscribe {
  const q = query(collection(db, 'payments'), where('customerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as Payment);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'payments')
  );
}

export function subscribeCustomerNotifications(
  uid: string,
  cb: (notifications: AppNotification[]) => void
): Unsubscribe {
  const q = query(collection(db, 'notifications'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as AppNotification);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
  );
}

export function subscribeCustomerTickets(uid: string, cb: (tickets: SupportTicket[]) => void): Unsubscribe {
  const q = query(collection(db, 'supportTickets'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as SupportTicket);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'supportTickets')
  );
}

export function subscribeCustomerReferrals(uid: string, cb: (referrals: Referral[]) => void): Unsubscribe {
  const q = query(collection(db, 'referrals'), where('referrerId', '==', uid));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as Referral)),
    (err) => handleFirestoreError(err, OperationType.LIST, 'referrals')
  );
}

async function resolveAuthoritativeOrderTotals(params: {
  items: CartItem[];
  couponCode?: string;
}): Promise<{
  subtotalBdt: number;
  discountBdt: number;
  totalPriceBdt: number;
  itemsSummary: string;
}> {
  const uniqueIds = Array.from(new Set(params.items.map((it) => it.product.id)));
  const snaps = await Promise.all(uniqueIds.map((id) => getDoc(doc(db, 'products', id))));
  const liveById = new Map<string, Product>();
  snaps.forEach((snap, idx) => {
    if (snap.exists()) {
      const rawLive = snap.data() as Product;
      const def = DEFAULT_PRODUCTS_BY_ID.get(uniqueIds[idx]);
      liveById.set(uniqueIds[idx], mergeUpgradedProduct(rawLive, def));
    }
  });

  const primary = params.items[0]?.product;
  if (!primary || !liveById.has(primary.id)) {
    throw new Error('Product catalog is syncing. Please retry after admin catalog sync.');
  }

  let subtotalBdt = 0;
  const summaryParts: string[] = [];

  for (const it of params.items) {
    const qty = Math.max(1, Math.round(it.quantity || 1));
    const live = liveById.get(it.product.id) || it.product;
    const stock = typeof live.stockCount === 'number' ? live.stockCount : live.availability === 'out_of_stock' ? 0 : 100;
    if (!live.active || live.availability === 'out_of_stock' || stock <= 0) {
      throw new Error(`"${live.titleEn}" is currently out of stock.`);
    }
    if (qty > stock) {
      throw new Error(`Only ${stock} unit(s) available for "${live.titleEn}".`);
    }

    let unitPrice = live.priceBdt;
    let pkgLabel = '';
    if (it.selectedPackage) {
      const matchedPkg = (live.packages || []).find((pk) => pk.id === it.selectedPackage?.id);
      if (matchedPkg) {
        unitPrice = matchedPkg.priceBdt;
        pkgLabel = ` [${matchedPkg.nameEn}]`;
      } else {
        unitPrice = it.selectedPackage.priceBdt;
        pkgLabel = ` [${it.selectedPackage.nameEn}]`;
      }
    }
    const lineTotal = Math.max(1, Math.round(unitPrice)) * qty;
    subtotalBdt += lineTotal;
    summaryParts.push(`${live.titleEn}${pkgLabel} x${qty} (৳${lineTotal})`);
  }

  let verifiedDiscountBdt = 0;
  const cleanCode = params.couponCode?.trim().toUpperCase();
  if (cleanCode) {
    const cSnap = await getDocs(
      query(collection(db, 'coupons'), where('code', '==', cleanCode), where('active', '==', true))
    );
    const coupon = cSnap.docs[0]?.data() as Coupon | undefined;
    const today = new Date().toISOString().slice(0, 10);
    if (
      coupon &&
      (!coupon.expiresAt || coupon.expiresAt >= today) &&
      coupon.usedCount < coupon.usageLimit &&
      subtotalBdt >= coupon.minOrderBdt
    ) {
      verifiedDiscountBdt =
        coupon.discountType === 'percent'
          ? Math.min(subtotalBdt, Math.round((subtotalBdt * coupon.discountValue) / 100))
          : Math.min(subtotalBdt, coupon.discountValue);
    }
  }

  return {
    subtotalBdt,
    discountBdt: verifiedDiscountBdt,
    totalPriceBdt: Math.max(1, Math.round(subtotalBdt - verifiedDiscountBdt)),
    itemsSummary: summaryParts.join(', ').slice(0, 950),
  };
}

// Cart & Single Product Order Submission (Manual MFS -> Verification Pending)
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

  const normalizedTxId = params.transactionId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (normalizedTxId.length < 6) {
    throw new Error('Transaction ID must be at least 6 alphanumeric characters.');
  }

  const authoritative = await resolveAuthoritativeOrderTotals({
    items: params.items,
    couponCode: params.couponCode,
  });

  const txRef = doc(db, 'txRegistry', normalizedTxId);
  const existingTx = await getDoc(txRef);
  if (existingTx.exists()) {
    throw new Error('This Transaction ID has already been submitted. Duplicate transactions are not allowed.');
  }

  const orderId = generateId('ord');
  const paymentId = generateId('pay');
  const notifId = generateId('notif');
  const orderNumber = `DH-${Math.floor(100000 + Math.random() * 900000)}`;
  const totalQty = params.items.reduce((s, it) => s + it.quantity, 0);
  const selectedPackageName = params.items[0]?.selectedPackage?.nameEn?.slice(0, 160) || '';

  const batch = writeBatch(db);

  batch.set(txRef, {
    txId: normalizedTxId,
    orderId,
    customerId: params.customerId,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'orders', orderId), {
    id: orderId,
    orderNumber,
    customerId: params.customerId,
    customerEmail: params.customerEmail.slice(0, 200),
    customerName: params.customerName.slice(0, 120),
    productId: primary.id,
    productTitleBn: (params.items.length > 1 ? `${primary.titleBn} (+${params.items.length - 1})` : primary.titleBn).slice(0, 200),
    productTitleEn: (params.items.length > 1 ? `${primary.titleEn} (+${params.items.length - 1})` : primary.titleEn).slice(0, 200),
    ...(selectedPackageName ? { selectedPackageName } : {}),
    itemsSummary: authoritative.itemsSummary,
    quantity: totalQty,
    ...(params.couponCode && authoritative.discountBdt > 0
      ? { couponCode: params.couponCode.slice(0, 32), discountBdt: authoritative.discountBdt }
      : {}),
    totalPriceBdt: authoritative.totalPriceBdt,
    paymentMethod: params.method,
    transactionId: normalizedTxId,
    senderNumber: params.senderNumber.trim().slice(0, 24),
    deliveryNote: params.deliveryNote.trim().slice(0, 1200),
    ...(params.referenceAttachmentUrl
      ? { referenceAttachmentUrl: params.referenceAttachmentUrl.slice(0, 350000) }
      : {}),
    status: 'Verification Pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'payments', paymentId), {
    id: paymentId,
    orderId,
    orderNumber,
    customerId: params.customerId,
    purpose: 'order',
    method: params.method,
    receiverNumber: params.receiverNumber.trim().slice(0, 24),
    senderNumber: params.senderNumber.trim().slice(0, 24),
    transactionId: normalizedTxId,
    amountBdt: authoritative.totalPriceBdt,
    ...(params.receiptDataUrl ? { receiptDataUrl: params.receiptDataUrl.slice(0, 350000) } : {}),
    status: 'Verification Pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'notifications', notifId), {
    id: notifId,
    userId: params.customerId,
    titleBn: 'অর্ডার ও পেমেন্ট জমা হয়েছে',
    titleEn: 'Order & Payment Submitted',
    messageBn: `অর্ডার #${orderNumber} (${normalizedTxId}) Verification Pending অবস্থায় আছে।`,
    messageEn: `Order #${orderNumber} (${normalizedTxId}) is Verification Pending until admin review.`,
    type: 'payment',
    read: false,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return { orderId, orderNumber };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `orders/${orderId}`);
  }
}

// Atomic Wallet Balance Checkout (Strictly verified balance debit via Firestore Rules getAfter)
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

  const authoritative = await resolveAuthoritativeOrderTotals({
    items: params.items,
    couponCode: params.couponCode,
  });
  const totalCost = authoritative.totalPriceBdt;
  if (params.wallet.availableBalanceBdt < totalCost) {
    throw new Error('Insufficient verified wallet balance.');
  }

  const orderId = generateId('ord');
  const walletTxId = generateId('wtx');
  const notifId = generateId('notif');
  const orderNumber = `DH-${Math.floor(100000 + Math.random() * 900000)}`;
  const totalQty = params.items.reduce((s, it) => s + it.quantity, 0);
  const selectedPackageName = params.items[0]?.selectedPackage?.nameEn?.slice(0, 160) || '';

  const batch = writeBatch(db);

  batch.update(doc(db, 'walletAccounts', params.customerId), {
    availableBalanceBdt: params.wallet.availableBalanceBdt - totalCost,
    totalSpentBdt: params.wallet.totalSpentBdt + totalCost,
    lastTxId: walletTxId,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'walletTransactions', walletTxId), {
    id: walletTxId,
    userId: params.customerId,
    userEmail: params.customerEmail.slice(0, 200),
    type: 'purchase',
    method: 'wallet',
    transactionId: walletTxId,
    amountBdt: totalCost,
    status: 'Approved',
    note: `Order #${orderNumber}`,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'orders', orderId), {
    id: orderId,
    orderNumber,
    customerId: params.customerId,
    customerEmail: params.customerEmail.slice(0, 200),
    customerName: params.customerName.slice(0, 120),
    productId: primary.id,
    productTitleBn: (params.items.length > 1 ? `${primary.titleBn} (+${params.items.length - 1})` : primary.titleBn).slice(0, 200),
    productTitleEn: (params.items.length > 1 ? `${primary.titleEn} (+${params.items.length - 1})` : primary.titleEn).slice(0, 200),
    ...(selectedPackageName ? { selectedPackageName } : {}),
    itemsSummary: authoritative.itemsSummary,
    quantity: totalQty,
    ...(params.couponCode && authoritative.discountBdt > 0
      ? { couponCode: params.couponCode.slice(0, 32), discountBdt: authoritative.discountBdt }
      : {}),
    totalPriceBdt: totalCost,
    paymentMethod: 'wallet',
    transactionId: walletTxId,
    senderNumber: 'WALLET',
    deliveryNote: params.deliveryNote.trim().slice(0, 1200),
    ...(params.referenceAttachmentUrl
      ? { referenceAttachmentUrl: params.referenceAttachmentUrl.slice(0, 350000) }
      : {}),
    status: 'Processing',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'notifications', notifId), {
    id: notifId,
    userId: params.customerId,
    titleBn: 'ওয়ালেট পেমেন্ট সম্পন্ন',
    titleEn: 'Wallet Order Confirmed',
    messageBn: `অর্ডার #${orderNumber} ওয়ালেট ব্যালেন্স থেকে পরিশোধ হয়ে প্রসেসিং-এ রয়েছে।`,
    messageEn: `Order #${orderNumber} was paid from your wallet balance and is now Processing.`,
    type: 'order',
    read: false,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return { orderId, orderNumber };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `orders/${orderId}`);
  }
}

// Add Money Deposit Submission (Manual Verification Pending)
export async function submitAddMoneyDeposit(params: {
  userId: string;
  userEmail: string;
  amountBdt: number;
  method: PaymentMethod;
  receiverNumber: string;
  senderNumber: string;
  transactionId: string;
  receiptDataUrl?: string;
}): Promise<string> {
  const normalizedTxId = params.transactionId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (normalizedTxId.length < 6) {
    throw new Error('Transaction ID must be at least 6 alphanumeric characters.');
  }

  const txRef = doc(db, 'txRegistry', normalizedTxId);
  const existingTx = await getDoc(txRef);
  if (existingTx.exists()) {
    throw new Error('This Transaction ID has already been submitted.');
  }

  const walletTxId = generateId('wdep');
  const paymentId = generateId('pay');
  const notifId = generateId('notif');
  const cleanAmt = Math.max(10, Math.round(params.amountBdt));

  const batch = writeBatch(db);

  batch.set(txRef, {
    txId: normalizedTxId,
    orderId: walletTxId,
    customerId: params.userId,
    createdAt: serverTimestamp(),
  });

  batch.set(doc(db, 'walletTransactions', walletTxId), {
    id: walletTxId,
    userId: params.userId,
    userEmail: params.userEmail.slice(0, 200),
    type: 'deposit',
    method: params.method,
    senderNumber: params.senderNumber.trim().slice(0, 24),
    transactionId: normalizedTxId,
    amountBdt: cleanAmt,
    ...(params.receiptDataUrl ? { receiptDataUrl: params.receiptDataUrl.slice(0, 350000) } : {}),
    status: 'Verification Pending',
    note: 'Add Money request',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'payments', paymentId), {
    id: paymentId,
    orderId: walletTxId,
    orderNumber: walletTxId,
    customerId: params.userId,
    purpose: 'add_money',
    method: params.method,
    receiverNumber: params.receiverNumber.trim().slice(0, 24),
    senderNumber: params.senderNumber.trim().slice(0, 24),
    transactionId: normalizedTxId,
    amountBdt: cleanAmt,
    ...(params.receiptDataUrl ? { receiptDataUrl: params.receiptDataUrl.slice(0, 350000) } : {}),
    status: 'Verification Pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'notifications', notifId), {
    id: notifId,
    userId: params.userId,
    titleBn: 'অ্যাড মানি অনুরোধ জমা হয়েছে',
    titleEn: 'Add Money Request Submitted',
    messageBn: `৳${cleanAmt} অ্যাড মানি অনুরোধ (${normalizedTxId}) Verification Pending অবস্থায় আছে।`,
    messageEn: `Add Money request for ৳${cleanAmt} (${normalizedTxId}) is Verification Pending.`,
    type: 'wallet',
    read: false,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return walletTxId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `walletTransactions/${walletTxId}`);
  }
}

export async function submitCustomerReview(params: {
  productId: string;
  orderId: string;
  userId: string;
  authorName: string;
  rating: number;
  comment: string;
}): Promise<void> {
  const id = generateId('rev');
  try {
    await setDoc(doc(db, 'reviews', id), {
      id,
      productId: params.productId,
      orderId: params.orderId,
      userId: params.userId,
      authorName: params.authorName.trim().slice(0, 100),
      rating: Math.min(5, Math.max(1, Math.round(params.rating))),
      comment: params.comment.trim().slice(0, 1000),
      approved: false,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `reviews/${id}`);
  }
}

export async function cancelCustomerOrder(
  orderId: string,
  meta?: { customerId?: string; orderNumber?: string }
): Promise<void> {
  const targetUid = meta?.customerId || auth.currentUser?.uid;
  const orderLabel = meta?.orderNumber || orderId;
  const batch = writeBatch(db);
  batch.update(doc(db, 'orders', orderId), {
    status: 'Cancelled',
    updatedAt: serverTimestamp(),
  });
  if (targetUid) {
    const notifId = generateId('notif');
    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      userId: targetUid,
      titleBn: 'অর্ডার বাতিল করা হয়েছে',
      titleEn: 'Order Cancelled',
      messageBn: `আপনার অর্ডার #${orderLabel} সফলভাবে বাতিল করা হয়েছে।`,
      messageEn: `Your order #${orderLabel} has been cancelled.`,
      type: 'order',
      read: false,
      createdAt: serverTimestamp(),
    });
  }
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${orderId}`);
  }
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'notifications', notificationId), { read: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `notifications/${notificationId}`);
  }
}

export async function createSupportTicket(params: {
  userId: string;
  userEmail: string;
  subject: string;
  message: string;
  orderNumber?: string;
}): Promise<void> {
  const id = generateId('tkt');
  try {
    await setDoc(doc(db, 'supportTickets', id), {
      id,
      userId: params.userId,
      userEmail: params.userEmail.slice(0, 200),
      subject: params.subject.trim().slice(0, 160),
      message: params.message.trim().slice(0, 2000),
      ...(params.orderNumber ? { orderNumber: params.orderNumber.trim().slice(0, 40) } : {}),
      status: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `supportTickets/${id}`);
  }
}

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

function resolveFirestoreAdDocId(rawId: string): string | null {
  const clean = sanitizeId(rawId);
  if (/^ad_\d+$/i.test(clean)) return clean.toLowerCase();
  const codeMatch = clean.match(/^AD0?(\d+)$/i);
  if (codeMatch?.[1]) {
    const num = Number(codeMatch[1]);
    if (num >= 1 && num <= 99) {
      return `ad_${String(num).padStart(2, '0')}`;
    }
  }
  return null;
}

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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      adId: cleanAdId,
      type,
      placement,
      adFormat,
      sessionId: getAdSessionId(),
    }),
  }).catch(() => {});

  const user = auth.currentUser;
  const firestoreAdId = resolveFirestoreAdDocId(cleanAdId);
  if (user && user.emailVerified && firestoreAdId) {
    const colName = type === 'click' ? 'adClicks' : 'adImpressions';
    const eventId = generateId(type === 'click' ? 'clk' : 'imp');
    try {
      await setDoc(doc(db, colName, eventId), {
        id: eventId,
        adId: firestoreAdId,
        placement: placement.slice(0, 40),
        userId: user.uid,
        createdAt: serverTimestamp(),
      });
    } catch {
      // Non-fatal
    }
  }
}

// ==================== ADMIN OPERATIONS ====================

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
  const unsubs: Unsubscribe[] = [];

  unsubs.push(
    onSnapshot(
      collection(db, 'users'),
      (snap) => callbacks.onUsers(snap.docs.map((d) => d.data() as UserProfile)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'users')
    )
  );
  unsubs.push(
    onSnapshot(
      collection(db, 'orders'),
      (snap) =>
        callbacks.onOrders(
          snap.docs.map((d) => d.data() as Order).sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'orders')
    )
  );
  unsubs.push(
    onSnapshot(
      collection(db, 'payments'),
      (snap) =>
        callbacks.onPayments(
          snap.docs.map((d) => d.data() as Payment).sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'payments')
    )
  );
  unsubs.push(
    onSnapshot(
      collection(db, 'walletTransactions'),
      (snap) =>
        callbacks.onWalletTx(
          snap.docs
            .map((d) => d.data() as WalletTransaction)
            .sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'walletTransactions')
    )
  );
  unsubs.push(
    onSnapshot(
      collection(db, 'walletAccounts'),
      (snap) => callbacks.onWallets(snap.docs.map((d) => d.data() as WalletAccount)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'walletAccounts')
    )
  );
  unsubs.push(
    onSnapshot(
      collection(db, 'coupons'),
      (snap) => callbacks.onCoupons(snap.docs.map((d) => d.data() as Coupon)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'coupons')
    )
  );
  unsubs.push(
    onSnapshot(
      collection(db, 'reviews'),
      (snap) => callbacks.onReviews(snap.docs.map((d) => d.data() as Review)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'reviews')
    )
  );
  unsubs.push(
    onSnapshot(
      collection(db, 'supportTickets'),
      (snap) =>
        callbacks.onTickets(
          snap.docs
            .map((d) => d.data() as SupportTicket)
            .sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'supportTickets')
    )
  );
  unsubs.push(
    onSnapshot(
      collection(db, 'referrals'),
      (snap) => callbacks.onReferrals(snap.docs.map((d) => d.data() as Referral)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'referrals')
    )
  );
  unsubs.push(
    onSnapshot(
      collection(db, 'auditLogs'),
      (snap) =>
        callbacks.onAuditLogs(
          snap.docs
            .map((d) => d.data() as AuditLog)
            .sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
    )
  );
  unsubs.push(
    onSnapshot(
      collection(db, 'admins'),
      (snap) => callbacks.onAdmins(snap.docs.map((d) => d.data() as AdminRecord)),
      (err) => handleFirestoreError(err, OperationType.LIST, 'admins')
    )
  );

  return unsubs;
}

export async function validateTransactionIdServer(params: {
  transactionId: string;
  senderNumber?: string;
  method?: PaymentMethod;
}): Promise<string> {
  const cleanTx = params.transactionId.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  const idToken = await auth.currentUser?.getIdToken().catch(() => '');
  const resp = await fetch(apiUrl('/api/payments/validate-tx'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({
      transactionId: cleanTx,
      ...(params.senderNumber ? { senderNumber: params.senderNumber.trim() } : {}),
      ...(params.method ? { method: params.method } : {}),
    }),
  });
  if (!resp.ok) {
    const d = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(d.error || 'Duplicate or invalid Transaction ID');
  }
  return cleanTx;
}

export async function adminVerifyPaymentServer(params: {
  payment: Payment;
  decision: 'approve' | 'reject';
  rejectionReason?: string;
  nextOrderStatus?: 'Paid' | 'Payment Approved' | 'Processing';
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required');
  const idToken = await user.getIdToken();

  const resp = await fetch(apiUrl('/api/admin/verify-payment'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      paymentId: params.payment.id,
      orderId: params.payment.orderId,
      customerId: params.payment.customerId,
      orderNumber: params.payment.orderNumber || params.payment.orderId,
      decision: params.decision,
      rejectionReason: params.rejectionReason || '',
      nextOrderStatus: params.nextOrderStatus || 'Processing',
    }),
  });

  if (!resp.ok) {
    const errData = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(errData.error || 'Server payment verification failed');
  }
}

export async function adminVerifyAddMoneyServer(params: {
  walletTx: WalletTransaction;
  decision: 'approve' | 'reject';
  rejectionReason?: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required');
  const idToken = await user.getIdToken();

  const resp = await fetch(apiUrl('/api/admin/verify-add-money'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      walletTxId: params.walletTx.id,
      customerId: params.walletTx.userId,
      amountBdt: params.walletTx.amountBdt,
      decision: params.decision,
      rejectionReason: params.rejectionReason || '',
    }),
  });

  if (!resp.ok) {
    const errData = (await resp.json().catch(() => ({}))) as { error?: string };
    throw new Error(errData.error || 'Server add-money verification failed');
  }
}

export async function adminUpdateOrderStatus(
  order: Order,
  status: OrderStatus,
  adminNote?: string
): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', order.id), {
      status,
      ...(adminNote !== undefined ? { adminNote: adminNote.slice(0, 500) } : {}),
      updatedAt: serverTimestamp(),
    });
    const notifId = generateId('notif');
    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      userId: order.customerId,
      titleBn: `অর্ডার #${order.orderNumber} আপডেট`,
      titleEn: `Order #${order.orderNumber} Updated`,
      messageBn: `আপনার অর্ডারের বর্তমান অবস্থা: ${status}${adminNote ? ` (${adminNote})` : ''}`,
      messageEn: `Your order status is now: ${status}${adminNote ? ` (${adminNote})` : ''}`,
      type: 'order',
      read: false,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `orders/${order.id}`);
  }
}

export async function adminSaveCategory(cat: Category, isNew: boolean): Promise<void> {
  try {
    if (isNew) {
      await setDoc(doc(db, 'categories', cat.id), {
        ...cat,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'categories', cat.id), {
        slug: cat.slug,
        nameBn: cat.nameBn,
        nameEn: cat.nameEn,
        descriptionBn: cat.descriptionBn || '',
        descriptionEn: cat.descriptionEn || '',
        imageUrl: cat.imageUrl || '',
        sortOrder: cat.sortOrder,
        active: cat.active,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `categories/${cat.id}`);
  }
}

export async function adminDeleteCategory(categoryId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'categories', categoryId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `categories/${categoryId}`);
  }
}

export async function adminAdjustWalletBalance(params: {
  targetUid: string;
  userEmail?: string;
  currentWallet?: WalletAccount;
  mode: 'add' | 'deduct' | 'set';
  amountBdt: number;
  note?: string;
}): Promise<{ nextBalance: number }> {
  const cleanUid = sanitizeId(params.targetUid);
  const rawAmt = Math.round(Number(params.amountBdt) || 0);
  if (params.mode !== 'set' && rawAmt < 1) {
    throw new Error('Adjustment amount must be at least ৳1.');
  }
  if (params.mode === 'set' && rawAmt < 0) {
    throw new Error('Balance cannot be negative.');
  }

  const existing = params.currentWallet;
  const prevBalance = existing?.availableBalanceBdt ?? 0;
  let nextBalance = prevBalance;
  if (params.mode === 'add') {
    nextBalance = prevBalance + rawAmt;
  } else if (params.mode === 'deduct') {
    if (prevBalance < rawAmt) {
      throw new Error(`Cannot deduct ৳${rawAmt} from balance ৳${prevBalance}.`);
    }
    nextBalance = prevBalance - rawAmt;
  } else {
    nextBalance = rawAmt;
  }
  nextBalance = Math.min(10000000, Math.max(0, Math.round(nextBalance)));

  const delta = nextBalance - prevBalance;
  const txAmount = Math.max(1, Math.abs(delta));
  const txId = generateId('wadj');
  const notifId = generateId('notif');
  const auditId = generateId('aud');
  const modeTag = params.mode === 'add' ? 'CREDIT' : params.mode === 'deduct' ? 'DEDUCT' : 'SET';
  const noteText = `[${modeTag}] ${params.note?.trim() || 'Admin balance update'} (৳${prevBalance} -> ৳${nextBalance})`.slice(0, 390);

  const batch = writeBatch(db);
  const walletRef = doc(db, 'walletAccounts', cleanUid);

  if (existing) {
    batch.update(walletRef, {
      availableBalanceBdt: nextBalance,
      totalAddedBdt:
        delta > 0 ? existing.totalAddedBdt + delta : existing.totalAddedBdt,
      totalSpentBdt:
        delta < 0 ? existing.totalSpentBdt + Math.abs(delta) : existing.totalSpentBdt,
      lastTxId: txId,
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(walletRef, {
      uid: cleanUid,
      availableBalanceBdt: nextBalance,
      promotionalCreditsBdt: 0,
      totalAddedBdt: nextBalance,
      totalSpentBdt: 0,
      lastTxId: txId,
      updatedAt: serverTimestamp(),
    });
  }

  batch.set(doc(db, 'walletTransactions', txId), {
    id: txId,
    userId: cleanUid,
    ...(params.userEmail ? { userEmail: params.userEmail.slice(0, 200) } : {}),
    type: 'admin_adjustment',
    method: 'system',
    transactionId: txId,
    amountBdt: txAmount,
    status: 'Approved',
    note: noteText,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'notifications', notifId), {
    id: notifId,
    userId: cleanUid,
    titleBn: 'ওয়ালেট ব্যালেন্স আপডেট হয়েছে',
    titleEn: 'Wallet Balance Updated',
    messageBn: `আপনার বর্তমান ভেরিফায়েড ওয়ালেট ব্যালেন্স এখন ৳${nextBalance}।`,
    messageEn: `Your verified wallet balance is now ৳${nextBalance}.`,
    type: 'wallet',
    read: false,
    createdAt: serverTimestamp(),
  });

  const actor = auth.currentUser;
  if (actor) {
    batch.set(doc(db, 'auditLogs', auditId), {
      id: auditId,
      actorUid: actor.uid,
      ...(actor.email ? { actorEmail: actor.email } : {}),
      action: 'wallet_balance_adjustment',
      targetCollection: 'walletAccounts',
      targetId: cleanUid,
      summary: noteText.slice(0, 480),
      createdAt: serverTimestamp(),
    });
  }

  try {
    await batch.commit();
    return { nextBalance };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `walletAccounts/${cleanUid}`);
  }
}

export async function adminSaveProduct(prod: Product, isNew: boolean): Promise<void> {
  const cleanPackages = (prod.packages || [])
    .filter((pk) => pk.nameEn.trim() && pk.priceBdt > 0)
    .slice(0, 200)
    .map((pk, idx) => ({
      id: sanitizeId(pk.id || `pkg_${idx + 1}`),
      nameBn: (pk.nameBn || pk.nameEn).trim().slice(0, 120),
      nameEn: (pk.nameEn || pk.nameBn).trim().slice(0, 120),
      priceBdt: Math.max(1, Math.round(pk.priceBdt)),
      ...(pk.originalPriceBdt && pk.originalPriceBdt > 0
        ? { originalPriceBdt: Math.round(pk.originalPriceBdt) }
        : {}),
      ...(pk.tag ? { tag: pk.tag.trim().slice(0, 32) } : {}),
    }));

  const cleanStock =
    typeof prod.stockCount === 'number' && !Number.isNaN(prod.stockCount)
      ? Math.min(1000000, Math.max(0, Math.round(prod.stockCount)))
      : prod.availability === 'out_of_stock'
        ? 0
        : prod.availability === 'limited'
          ? 12
          : 100;

  const payload = {
    categoryId: prod.categoryId,
    subcategoryBn: (prod.subcategoryBn || '').trim().slice(0, 100),
    subcategoryEn: (prod.subcategoryEn || '').trim().slice(0, 100),
    brandKey: (prod.brandKey || '').trim().slice(0, 40),
    titleBn: prod.titleBn.trim().slice(0, 160),
    titleEn: prod.titleEn.trim().slice(0, 160),
    descriptionBn: (prod.descriptionBn || prod.descriptionEn).trim().slice(0, 1500),
    descriptionEn: (prod.descriptionEn || prod.descriptionBn).trim().slice(0, 1500),
    priceBdt: Math.max(1, Number(prod.priceBdt) || 1),
    originalPriceBdt: Number(prod.originalPriceBdt) || 0,
    discountPercent: Math.min(95, Math.max(0, Number(prod.discountPercent) || 0)),
    ...(cleanPackages.length > 0 ? { packages: cleanPackages } : {}),
    availability: prod.availability,
    stockCount: cleanStock,
    ...(prod.orderFormType ? { orderFormType: prod.orderFormType } : {}),
    deliveryDurationBn: prod.deliveryDurationBn.trim().slice(0, 100),
    deliveryDurationEn: prod.deliveryDurationEn.trim().slice(0, 100),
    validityBn: (prod.validityBn || '').trim().slice(0, 200),
    validityEn: (prod.validityEn || '').trim().slice(0, 200),
    instructionsBn: (prod.instructionsBn || '').trim().slice(0, 1000),
    instructionsEn: (prod.instructionsEn || '').trim().slice(0, 1000),
    termsBn: (prod.termsBn || '').trim().slice(0, 1000),
    termsEn: (prod.termsEn || '').trim().slice(0, 1000),
    benefitsBn: (prod.benefitsBn || '').trim().slice(0, 1000),
    benefitsEn: (prod.benefitsEn || '').trim().slice(0, 1000),
    sectionTag: prod.sectionTag || 'standard',
    imageUrl: (prod.imageUrl || '').trim().slice(0, 200000) || '/assets/products/prod_ff_bd_diamonds.jpg',
    ...(prod.bannerUrl ? { bannerUrl: prod.bannerUrl.trim().slice(0, 200000) } : {}),
    ...(prod.customLogoUrl ? { customLogoUrl: prod.customLogoUrl.trim().slice(0, 200000) } : {}),
    featured: Boolean(prod.featured),
    ...(typeof prod.sortOrder === 'number' && !Number.isNaN(prod.sortOrder)
      ? { sortOrder: Math.min(1000000, Math.max(0, Math.round(prod.sortOrder))) }
      : {}),
    active: prod.active,
  };

  try {
    const docRef = doc(db, 'products', prod.id);
    if (isNew) {
      await setDoc(docRef, {
        id: prod.id,
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingSnap = await getDoc(docRef);
      if (existingSnap.exists()) {
        await updateDoc(docRef, {
          ...payload,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(docRef, {
          id: prod.id,
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `products/${prod.id}`);
  }
}

export async function adminQuickUpdatePackage(
  prod: Product,
  updates: Partial<Pick<Product, 'active' | 'featured' | 'sectionTag' | 'sortOrder' | 'availability'>>
): Promise<void> {
  await adminSaveProduct({ ...prod, ...updates }, false);
}

export async function adminDeleteProduct(productId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'products', productId));
    try {
      const raw = localStorage.getItem('dh_deleted_prod_ids');
      const existing = raw ? (JSON.parse(raw) as string[]) : [];
      if (!existing.includes(productId)) {
        localStorage.setItem('dh_deleted_prod_ids', JSON.stringify([...existing, productId]));
      }
    } catch {
      // Non-fatal
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `products/${productId}`);
  }
}

export async function adminSaveAdvertisement(ad: Advertisement, isNew: boolean): Promise<void> {
  try {
    if (isNew) {
      await setDoc(doc(db, 'advertisements', ad.id), {
        ...ad,
        adFormat: ad.adFormat || 'direct_link',
        networkName: ad.networkName || 'Direct Partner',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'advertisements', ad.id), {
        code: ad.code,
        titleBn: ad.titleBn,
        titleEn: ad.titleEn,
        descriptionBn: ad.descriptionBn || '',
        descriptionEn: ad.descriptionEn || '',
        targetUrl: ad.targetUrl,
        mediaType: ad.mediaType,
        adFormat: ad.adFormat || 'direct_link',
        networkName: ad.networkName || 'Direct Partner',
        mediaUrl: ad.mediaUrl || '',
        thumbnailUrl: ad.thumbnailUrl || '',
        placement: ad.placement,
        priority: ad.priority,
        sortOrder: ad.sortOrder,
        enabled: ad.enabled,
        startDate: ad.startDate || '',
        endDate: ad.endDate || '',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `advertisements/${ad.id}`);
  }
}

export async function adminDeleteAdvertisement(adId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'advertisements', adId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `advertisements/${adId}`);
  }
}

export function subscribeAdRevenueEntries(cb: (items: AdRevenueEntry[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'adRevenueEntries'),
    (snap) => {
      const items = snap.docs.map((d) => d.data() as AdRevenueEntry);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'adRevenueEntries')
  );
}

const FORBIDDEN_DIRECT_AD_HOSTS = /(asiafilm\.org\/4\/|auctionr\.org\/4\/|arwf\.org\/4\/|bicea\.org\/22\/)/i;

export async function adminSaveAdNetwork(net: AdNetworkConfig, isNew: boolean): Promise<void> {
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
  try {
    if (isNew) {
      await setDoc(doc(db, 'adNetworks', net.id), {
        ...net,
        supportsIncentivizedRewards: allowRewards,
        scriptSrc: cleanSrc,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'adNetworks', net.id), {
        provider: net.provider,
        name: net.name,
        adFormat: net.adFormat,
        placement: net.placement,
        publisherId: net.publisherId || '',
        zoneId: net.zoneId || '',
        scriptSrc: cleanSrc,
        containerId: net.containerId || '',
        supportsIncentivizedRewards: allowRewards,
        approvalStatus: net.approvalStatus,
        enabled: net.enabled,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `adNetworks/${net.id}`);
  }
}

export async function adminDeleteAdNetwork(networkId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'adNetworks', networkId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `adNetworks/${networkId}`);
  }
}

export async function adminAddAdRevenueEntry(entry: Omit<AdRevenueEntry, 'createdAt'>): Promise<void> {
  try {
    await setDoc(doc(db, 'adRevenueEntries', entry.id), {
      ...entry,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `adRevenueEntries/${entry.id}`);
  }
}

export async function adminDeleteAdRevenueEntry(entryId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'adRevenueEntries', entryId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `adRevenueEntries/${entryId}`);
  }
}

export async function adminSaveBanner(banner: Banner, isNew: boolean): Promise<void> {
  try {
    if (isNew) {
      await setDoc(doc(db, 'banners', banner.id), {
        ...banner,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'banners', banner.id), {
        titleBn: banner.titleBn,
        titleEn: banner.titleEn,
        subtitleBn: banner.subtitleBn || '',
        subtitleEn: banner.subtitleEn || '',
        slot: banner.slot,
        targetUrl: banner.targetUrl,
        imageUrl: banner.imageUrl || '',
        mobileImageUrl: banner.mobileImageUrl || '',
        adCode: banner.adCode || '',
        sortOrder: banner.sortOrder,
        priority: banner.priority,
        enabled: banner.enabled,
        startDate: banner.startDate || '',
        endDate: banner.endDate || '',
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `banners/${banner.id}`);
  }
}

export async function adminDeleteBanner(bannerId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'banners', bannerId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `banners/${bannerId}`);
  }
}

export async function adminSaveCoupon(coupon: Coupon, isNew: boolean): Promise<void> {
  try {
    const cleanCode = coupon.code.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (isNew) {
      await setDoc(doc(db, 'coupons', coupon.id), {
        ...coupon,
        code: cleanCode,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'coupons', coupon.id), {
        code: cleanCode,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
        minOrderBdt: coupon.minOrderBdt,
        usageLimit: coupon.usageLimit,
        usedCount: coupon.usedCount,
        expiresAt: coupon.expiresAt || '',
        active: coupon.active,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `coupons/${coupon.id}`);
  }
}

export async function adminDeleteCoupon(couponId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'coupons', couponId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `coupons/${couponId}`);
  }
}

export async function adminToggleReviewApproval(reviewId: string, approved: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'reviews', reviewId), { approved });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `reviews/${reviewId}`);
  }
}

export async function adminDeleteReview(reviewId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'reviews', reviewId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `reviews/${reviewId}`);
  }
}

export async function adminSaveSiteSettings(settings: SiteSettings): Promise<void> {
  try {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(settings)) {
      if (v !== undefined) {
        if ((k === 'bkashLogoUrl' || k === 'nagadLogoUrl' || k === 'rocketLogoUrl') && typeof v === 'string') {
          cleaned[k] = v.trim().slice(0, 200000);
        } else {
          cleaned[k] = v;
        }
      }
    }
    await setDoc(doc(db, 'siteSettings', 'global'), {
      ...cleaned,
      id: 'global',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'siteSettings/global');
  }
}

export async function triggerLogoutAllDevicesServer(): Promise<{ ok: boolean }> {
  const current = auth.currentUser;
  if (!current) throw new Error('Authentication required');
  const idToken = await current.getIdToken();
  const resp = await fetch(apiUrl('/api/auth/logout-all'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  });
  const data = (await resp.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!resp.ok) throw new Error(data.error || 'Failed to revoke sessions');
  return { ok: true };
}

export async function submitAccountDeletionRequestServer(reason: string): Promise<{ requestId: string }> {
  const current = auth.currentUser;
  if (!current) throw new Error('Authentication required');
  const idToken = await current.getIdToken();
  const resp = await fetch(apiUrl('/api/auth/request-deletion'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ reason }),
  });
  const data = (await resp.json().catch(() => ({}))) as { requestId?: string; error?: string };
  if (!resp.ok) throw new Error(data.error || 'Could not submit account deletion request');
  return { requestId: data.requestId || '' };
}

export async function adminMigratePhase1Server(): Promise<{ updatedNagad: boolean; addedAd07: boolean; addedBanner07: boolean }> {
  const current = auth.currentUser;
  if (!current) throw new Error('Authentication required');
  const idToken = await current.getIdToken(true);
  const resp = await fetch(apiUrl('/api/admin/migrate-phase1'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
  });
  const data = (await resp.json().catch(() => ({}))) as {
    updatedNagad?: boolean;
    addedAd07?: boolean;
    addedBanner07?: boolean;
    code?: string;
    error?: string;
  };
  if (resp.status === 401 && data.code === 'REAUTH_REQUIRED') {
    await reauthenticateOwnerWithGoogle();
    return adminMigratePhase1Server();
  }
  if (!resp.ok) throw new Error(data.error || 'Migration sync failed');
  return {
    updatedNagad: Boolean(data.updatedNagad),
    addedAd07: Boolean(data.addedAd07),
    addedBanner07: Boolean(data.addedBanner07),
  };
}

export async function adminUpdateCustomer(
  uid: string,
  updates: { status: 'active' | 'suspended'; promotionalCredits: number }
): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', uid), {
      status: updates.status,
      promotionalCredits: Math.max(0, Number(updates.promotionalCredits) || 0),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
  }
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
  const notifId = generateId('notif');
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'users', params.userId), {
      promotionalCredits: Math.max(0, params.currentCredits + params.bonusBdt),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      userId: params.userId,
      titleBn: params.titleBn,
      titleEn: params.titleEn,
      messageBn: params.messageBn,
      messageEn: params.messageEn,
      type: 'promo',
      read: false,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${params.userId}`);
  }
}

export async function adminReplyTicket(
  ticket: SupportTicket,
  status: SupportTicket['status'],
  adminReply: string
): Promise<void> {
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'supportTickets', ticket.id), {
      status,
      adminReply: adminReply.slice(0, 2000),
      updatedAt: serverTimestamp(),
    });
    const notifId = generateId('notif');
    batch.set(doc(db, 'notifications', notifId), {
      id: notifId,
      userId: ticket.userId,
      titleBn: 'সাপোর্ট টিকেট উত্তর',
      titleEn: 'Support Ticket Reply',
      messageBn: `টিকেট "${ticket.subject}"-এ অ্যাডমিন উত্তর দিয়েছেন (${status})।`,
      messageEn: `Admin replied to ticket "${ticket.subject}" (${status}).`,
      type: 'support',
      read: false,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `supportTickets/${ticket.id}`);
  }
}

export async function adminUpdateReferralStatus(
  referralId: string,
  status: Referral['status']
): Promise<void> {
  try {
    await updateDoc(doc(db, 'referrals', referralId), { status });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `referrals/${referralId}`);
  }
}

export async function adminAddAuthorizedAdmin(
  uid: string,
  email: string,
  role: 'admin' | 'super_admin',
  addedByUid: string
): Promise<void> {
  const cleanUid = sanitizeId(uid);
  try {
    await setDoc(doc(db, 'admins', cleanUid), {
      uid: cleanUid,
      email: email.trim().slice(0, 200),
      role,
      addedBy: addedByUid,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `admins/${cleanUid}`);
  }
}

export async function adminRemoveAuthorizedAdmin(uid: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'admins', uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `admins/${uid}`);
  }
}

export function subscribeCustomerWithdrawals(
  uid: string,
  cb: (items: WithdrawalRequest[]) => void
): Unsubscribe {
  const q = query(collection(db, 'withdrawals'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as WithdrawalRequest);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'withdrawals')
  );
}

export function subscribeCustomerRewardClaims(
  uid: string,
  cb: (items: RewardedAdClaim[]) => void
): Unsubscribe {
  const q = query(collection(db, 'rewardedAdClaims'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as RewardedAdClaim);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'rewardedAdClaims')
  );
}

export function subscribeAnnouncements(cb: (items: Announcement[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'announcements'),
    (snap) => {
      const items = snap.docs
        .map((d) => d.data() as Announcement)
        .filter((a) => a.active)
        .sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt));
      cb(items);
    },
    () => cb([])
  );
}

export async function submitWithdrawalRequest(params: {
  userId: string;
  userEmail: string;
  wallet: WalletAccount;
  method: PaymentMethod;
  accountNumber: string;
  amountBdt: number;
}): Promise<string> {
  const cleanAmount = Math.round(Number(params.amountBdt) || 0);
  if (cleanAmount < 50) {
    throw new Error('Minimum withdrawal amount is ৳50.');
  }
  const cleanAccount = params.accountNumber.trim().slice(0, 24);
  if (!/^01[3-9]\d{8}$/.test(cleanAccount)) {
    throw new Error('Enter a valid 11-digit Bangladesh mobile wallet number (01XXXXXXXXX).');
  }
  if (params.wallet.availableBalanceBdt < cleanAmount) {
    throw new Error(`Insufficient wallet balance (Available: ৳${params.wallet.availableBalanceBdt}).`);
  }

  const withdrawalId = generateId('wdr');
  const notifId = generateId('notif');
  const batch = writeBatch(db);

  batch.update(doc(db, 'walletAccounts', params.userId), {
    availableBalanceBdt: params.wallet.availableBalanceBdt - cleanAmount,
    lastTxId: withdrawalId,
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'walletTransactions', withdrawalId), {
    id: withdrawalId,
    userId: params.userId,
    userEmail: params.userEmail.slice(0, 200),
    type: 'withdrawal',
    method: params.method,
    senderNumber: cleanAccount,
    transactionId: withdrawalId,
    amountBdt: cleanAmount,
    status: 'Verification Pending',
    note: `Withdrawal request to ${params.method.toUpperCase()} (${cleanAccount})`,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'withdrawals', withdrawalId), {
    id: withdrawalId,
    userId: params.userId,
    userEmail: params.userEmail.slice(0, 200),
    method: params.method,
    accountNumber: cleanAccount,
    amountBdt: cleanAmount,
    status: 'Pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(db, 'notifications', notifId), {
    id: notifId,
    userId: params.userId,
    titleBn: 'উইথড্রয়াল অনুরোধ জমা হয়েছে',
    titleEn: 'Withdrawal Request Submitted',
    messageBn: `৳${cleanAmount} (${params.method.toUpperCase()} - ${cleanAccount}) উইথড্রয়াল অনুরোধ পেন্ডিং অবস্থায় আছে।`,
    messageEn: `Your ৳${cleanAmount} withdrawal to ${params.method.toUpperCase()} (${cleanAccount}) is Pending admin payout.`,
    type: 'wallet',
    read: false,
    createdAt: serverTimestamp(),
  });

  try {
    await batch.commit();
    return withdrawalId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `withdrawals/${withdrawalId}`);
  }
}

export async function submitRewardedAdClaimServer(networkId: string): Promise<{
  ok: boolean;
  claimId: string;
  amountBdt: number;
  dailyCount: number;
  dailyLimit: number;
}> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required');
  const idToken = await user.getIdToken();
  const resp = await fetch(apiUrl('/api/ads/claim-reward'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ networkId }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    claimId?: string;
    amountBdt?: number;
    dailyCount?: number;
    dailyLimit?: number;
    error?: string;
  };
  if (!resp.ok) {
    throw new Error(data.error || 'Could not claim rewarded ad payout');
  }
  return {
    ok: true,
    claimId: data.claimId || '',
    amountBdt: data.amountBdt || 0,
    dailyCount: data.dailyCount || 1,
    dailyLimit: data.dailyLimit || 5,
  };
}

export function subscribeAllWithdrawals(cb: (items: WithdrawalRequest[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'withdrawals'),
    (snap) => {
      const items = snap.docs.map((d) => d.data() as WithdrawalRequest);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'withdrawals')
  );
}

export function subscribeAllRewardedClaims(cb: (items: RewardedAdClaim[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'rewardedAdClaims'),
    (snap) => {
      const items = snap.docs.map((d) => d.data() as RewardedAdClaim);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'rewardedAdClaims')
  );
}

export function subscribeAllAnnouncements(cb: (items: Announcement[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'announcements'),
    (snap) => {
      const items = snap.docs.map((d) => d.data() as Announcement);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'announcements')
  );
}

async function postAdminWithReauth<T>(path: string, payload: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required');

  const sendRequest = async (forceRefresh: boolean) => {
    const idToken = await user.getIdToken(forceRefresh);
    return fetch(apiUrl(path), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(payload),
    });
  };

  let resp = await sendRequest(false);
  if (resp.status === 401) {
    const body = (await resp.json().catch(() => ({}))) as { code?: string; error?: string };
    if (body.code === 'REAUTH_REQUIRED') {
      await reauthenticateOwnerWithGoogle();
      resp = await sendRequest(true);
    } else {
      throw new Error(body.error || 'Owner authentication required');
    }
  }

  const data = (await resp.json().catch(() => ({}))) as T & { error?: string };
  if (!resp.ok) {
    throw new Error(data.error || 'Admin request failed');
  }
  return data;
}

export async function adminUpdateUserStatusServer(
  targetUid: string,
  status: 'active' | 'suspended',
  reason?: string
): Promise<void> {
  await postAdminWithReauth('/api/admin/update-user-status', {
    targetUid,
    status,
    reason,
  });
}

export async function adminProcessWithdrawalServer(params: {
  withdrawalId: string;
  decision: 'approve' | 'reject';
  payoutReference?: string;
  adminNote?: string;
  rejectionReason?: string;
}): Promise<void> {
  await postAdminWithReauth('/api/admin/process-withdrawal', params);
}

export async function adminCompleteOrderWithRewardsServer(
  orderId: string,
  adminNote?: string
): Promise<{ awardedCashbackBdt: number; awardedReferralBdt: number }> {
  return postAdminWithReauth('/api/admin/complete-order-rewards', {
    orderId,
    adminNote,
  });
}

export async function adminRefundAndCancelOrderServer(params: {
  orderId: string;
  rejectionReason?: string;
  refundToWallet?: boolean;
}): Promise<{ status: string; refundedBdt: number }> {
  return postAdminWithReauth('/api/admin/refund-cancel-order', params);
}

export async function adminBroadcastAnnouncementServer(params: {
  titleBn: string;
  titleEn: string;
  messageBn: string;
  messageEn: string;
  type: 'info' | 'promo' | 'policy' | 'maintenance';
}): Promise<{ id: string }> {
  return postAdminWithReauth('/api/admin/broadcast-announcement', params);
}

export async function adminToggleAnnouncementActive(id: string, active: boolean): Promise<void> {
  try {
    await updateDoc(doc(db, 'announcements', id), { active });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `announcements/${id}`);
  }
}

export async function adminDeleteAnnouncement(id: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'announcements', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `announcements/${id}`);
  }
}

export async function adminSettleRewardClaimServer(params: {
  claimId: string;
  decision: 'credit' | 'reject';
  rejectionReason?: string;
}): Promise<void> {
  await postAdminWithReauth('/api/admin/settle-reward-claim', params);
}

// ==================== 24 AD UNITS, WATCH & EARN & REFERRAL SYSTEM ====================

export async function adminSaveManagedAdUnit(unit: {
  id: string;
  enabled: boolean;
  placements: AdPlacementSlot[];
  showOnMobile: boolean;
  showOnDesktop: boolean;
  priority: number;
  rotationSeconds: number;
  supportsRewardedVerification?: boolean;
}): Promise<void> {
  try {
    await setDoc(doc(db, 'advertisingUnits', unit.id), {
      id: unit.id,
      enabled: Boolean(unit.enabled),
      placements: unit.placements.slice(0, 12),
      showOnMobile: Boolean(unit.showOnMobile),
      showOnDesktop: Boolean(unit.showOnDesktop),
      priority: Math.max(1, Math.min(999, Number(unit.priority) || 1)),
      rotationSeconds: Math.max(5, Math.min(300, Number(unit.rotationSeconds) || 20)),
      supportsRewardedVerification: Boolean(unit.supportsRewardedVerification),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `advertisingUnits/${unit.id}`);
  }
}

export function subscribeCustomerViewingSessions(
  uid: string,
  cb: (items: AdViewingSession[]) => void
): Unsubscribe {
  const q = query(collection(db, 'adViewingSessions'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as AdViewingSession);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'adViewingSessions')
  );
}

export function subscribeCustomerAdRewardTransactions(
  uid: string,
  cb: (items: AdRewardTransaction[]) => void
): Unsubscribe {
  const q = query(collection(db, 'adRewardTransactions'), where('userId', '==', uid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => d.data() as AdRewardTransaction);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'adRewardTransactions')
  );
}

export function subscribeAllViewingSessions(cb: (items: AdViewingSession[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'adViewingSessions'),
    (snap) => {
      const items = snap.docs.map((d) => d.data() as AdViewingSession);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'adViewingSessions')
  );
}

export function subscribeAllAdRewardTransactions(cb: (items: AdRewardTransaction[]) => void): Unsubscribe {
  return onSnapshot(
    collection(db, 'adRewardTransactions'),
    (snap) => {
      const items = snap.docs.map((d) => d.data() as AdRewardTransaction);
      cb(items.sort((a, b) => getTimeMs(b.createdAt) - getTimeMs(a.createdAt)));
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'adRewardTransactions')
  );
}

export async function startWatchEarnSessionServer(params: {
  unitId: string;
  provider: string;
}): Promise<{
  ok: boolean;
  sessionId: string;
  sessionToken: string;
  status: string;
  requiresS2SCallback: boolean;
  message: string;
}> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required');
  const idToken = await user.getIdToken();
  const resp = await fetch(apiUrl('/api/watch-earn/start-session'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(params),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    sessionId?: string;
    sessionToken?: string;
    status?: string;
    requiresS2SCallback?: boolean;
    message?: string;
    error?: string;
  };
  if (!resp.ok) throw new Error(data.error || 'Could not start rewarded session');
  return {
    ok: true,
    sessionId: data.sessionId || '',
    sessionToken: data.sessionToken || '',
    status: data.status || 'verification_failed',
    requiresS2SCallback: data.requiresS2SCallback !== false,
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
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required');
  const idToken = await user.getIdToken();
  const resp = await fetch(apiUrl('/api/watch-earn/verify-session'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
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
  return {
    ok: Boolean(data.ok),
    verified: Boolean(data.verified),
    status: data.status || 'verification_failed',
    coinsAwarded: data.coinsAwarded || 0,
    message: data.message || '',
  };
}

export async function getWatchEarnSummaryServer(): Promise<{
  coinsAvailable: number;
  coinsLifetimeEarned: number;
  coinsRedeemed: number;
  creditedSessions: Array<{
    sessionId: string;
    provider: string;
    providerEventId: string;
    coins: number;
    creditedAt: string;
  }>;
}> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) {
    return { coinsAvailable: 0, coinsLifetimeEarned: 0, coinsRedeemed: 0, creditedSessions: [] };
  }
  const idToken = await user.getIdToken();
  const resp = await fetch(apiUrl('/api/watch-earn/summary'), {
    headers: { Authorization: `Bearer ${idToken}` },
  });
  if (!resp.ok) {
    return { coinsAvailable: 0, coinsLifetimeEarned: 0, coinsRedeemed: 0, creditedSessions: [] };
  }
  const data = (await resp.json().catch(() => ({}))) as {
    coinsAvailable?: number;
    coinsLifetimeEarned?: number;
    coinsRedeemed?: number;
    creditedSessions?: Array<{
      sessionId: string;
      provider: string;
      providerEventId: string;
      coins: number;
      creditedAt: string;
    }>;
  };
  return {
    coinsAvailable: data.coinsAvailable || 0,
    coinsLifetimeEarned: data.coinsLifetimeEarned || 0,
    coinsRedeemed: data.coinsRedeemed || 0,
    creditedSessions: data.creditedSessions || [],
  };
}

export async function redeemWatchEarnCoinsServer(coins: number): Promise<{
  ok: boolean;
  coinsRedeemed: number;
  bdtCredited: number;
  coinsAvailable: number;
  status: string;
}> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required');
  const idToken = await user.getIdToken();
  const resp = await fetch(apiUrl('/api/watch-earn/redeem-coins'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ coins }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    coinsRedeemed?: number;
    bdtCredited?: number;
    coinsAvailable?: number;
    status?: string;
    error?: string;
  };
  if (!resp.ok) throw new Error(data.error || 'Coin redemption failed');
  return {
    ok: true,
    coinsRedeemed: data.coinsRedeemed || 0,
    bdtCredited: data.bdtCredited || 0,
    coinsAvailable: data.coinsAvailable ?? 0,
    status: data.status || 'Pending Credit',
  };
}

export async function adminSettleCoinRedemptionServer(params: {
  txId: string;
  decision: 'credit' | 'reject';
  reason?: string;
}): Promise<{ ok: boolean; status: string }> {
  return postAdminWithReauth('/api/admin/settle-coin-redemption', params);
}

export async function registerReferralServer(referralCode: string): Promise<{
  ok: boolean;
  registered: boolean;
  status?: string;
  message?: string;
}> {
  const user = auth.currentUser;
  if (!user || !user.emailVerified || !referralCode.trim()) {
    return { ok: false, registered: false };
  }
  const idToken = await user.getIdToken();
  const resp = await fetch(apiUrl('/api/referrals/register'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ referralCode: referralCode.trim() }),
  });
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: boolean;
    registered?: boolean;
    status?: string;
    message?: string;
  };
  return {
    ok: resp.ok,
    registered: Boolean(data.registered),
    status: data.status,
    message: data.message,
  };
}

export async function adminSettleReferralServer(params: {
  referralId: string;
  decision: 'credit' | 'revoke';
  reason?: string;
}): Promise<{ ok: boolean; status: string }> {
  return postAdminWithReauth('/api/admin/settle-referral', params);
}

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
