import { AppRoute, Language, OrderFormType, Product, ProductPackage } from '../types/marketplace';

/**
 * Consistent professional BDT price formatting across the entire marketplace (e.g. ৳159, ৳390, ৳1,210).
 */
export function formatBdt(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  return `৳${safe.toLocaleString('en-US')}`;
}

/**
 * Only return true when compareAtPrice is genuinely higher than sellingPrice.
 * Strictly guards against ever displaying supplier purchase prices to customers.
 */
export function hasGenuineDiscount(sellingPrice: number, compareAtPrice?: number): boolean {
  return Boolean(
    typeof compareAtPrice === 'number' &&
      Number.isFinite(compareAtPrice) &&
      compareAtPrice > sellingPrice
  );
}

export interface CatalogSectionDef {
  id: string;
  nameEn: string;
  nameBn: string;
  shortEn: string;
  shortBn: string;
  parentCategoryId: string;
  route: AppRoute;
  brandKey: string;
}

/**
 * Complete 23 organized catalog categories for DIGITAL HUB BD.
 * Preserves existing top-level categoryId mapping (cat_gaming, cat_social, etc.)
 * so all legacy routes, filters, and historical orders continue working seamlessly.
 */
export const CATALOG_23_CATEGORIES: CatalogSectionDef[] = [
  {
    id: 'cat23_ff_bd',
    nameEn: 'Free Fire UID Bangladesh',
    nameBn: 'ফ্রি ফায়ার UID বাংলাদেশ',
    shortEn: 'FF UID BD',
    shortBn: 'FF UID বিডি',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'freefire',
  },
  {
    id: 'cat23_ff_indo',
    nameEn: 'Free Fire Indonesia',
    nameBn: 'ফ্রি ফায়ার ইন্দোনেশিয়া',
    shortEn: 'FF Indonesia',
    shortBn: 'FF ইন্দোনেশিয়া',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'freefire_indo',
  },
  {
    id: 'cat23_ff_wm',
    nameEn: 'Free Fire Weekly / Monthly',
    nameBn: 'ফ্রি ফায়ার উইকলি / মান্থলি',
    shortEn: 'FF Weekly/Monthly',
    shortBn: 'উইকলি/মান্থলি',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'freefire_wm',
  },
  {
    id: 'cat23_ff_wlite',
    nameEn: 'Free Fire Weekly Lite',
    nameBn: 'ফ্রি ফায়ার উইকলি লাইট',
    shortEn: 'FF Weekly Lite',
    shortBn: 'উইকলি লাইট',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'freefire_wlite',
  },
  {
    id: 'cat23_ff_lvl',
    nameEn: 'Free Fire Level Up Pass',
    nameBn: 'ফ্রি ফায়ার লেভেল আপ পাস',
    shortEn: 'FF Level Up',
    shortBn: 'লেভেল আপ পাস',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'freefire_lvl',
  },
  {
    id: 'cat23_ff_likes',
    nameEn: 'Free Fire Likes',
    nameBn: 'ফ্রি ফায়ার লাইকস',
    shortEn: 'FF Likes',
    shortBn: 'FF লাইকস',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'freefire_likes',
  },
  {
    id: 'cat23_ff_airdrop',
    nameEn: 'Free Fire Airdrop & Special Offers',
    nameBn: 'ফ্রি ফায়ার এয়ারড্রপ ও স্পেশাল অফার',
    shortEn: 'FF Airdrop',
    shortBn: 'FF এয়ারড্রপ',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'airdrop',
  },
  {
    id: 'cat23_tiktok_coins',
    nameEn: 'TikTok Coins',
    nameBn: 'টিকটক কয়েন্স',
    shortEn: 'TikTok Coins',
    shortBn: 'টিকটক কয়েন্স',
    parentCategoryId: 'cat_social',
    route: 'social-media',
    brandKey: 'tiktok',
  },
  {
    id: 'cat23_tiktok_growth',
    nameEn: 'TikTok Followers / Likes / Views',
    nameBn: 'টিকটক ফলোয়ার / লাইক / ভিউ',
    shortEn: 'TikTok Growth',
    shortBn: 'টিকটক গ্রোথ',
    parentCategoryId: 'cat_social',
    route: 'social-media',
    brandKey: 'tiktok',
  },
  {
    id: 'cat23_facebook',
    nameEn: 'Facebook Services',
    nameBn: 'ফেসবুক সার্ভিসসমূহ',
    shortEn: 'Facebook',
    shortBn: 'ফেসবুক',
    parentCategoryId: 'cat_social',
    route: 'social-media',
    brandKey: 'facebook',
  },
  {
    id: 'cat23_instagram',
    nameEn: 'Instagram Services',
    nameBn: 'ইনস্টাগ্রাম সার্ভিসসমূহ',
    shortEn: 'Instagram',
    shortBn: 'ইনস্টাগ্রাম',
    parentCategoryId: 'cat_social',
    route: 'social-media',
    brandKey: 'instagram',
  },
  {
    id: 'cat23_telegram',
    nameEn: 'Telegram Premium & Members',
    nameBn: 'টেলিগ্রাম প্রিমিয়াম ও মেম্বার্স',
    shortEn: 'Telegram',
    shortBn: 'টেলিগ্রাম',
    parentCategoryId: 'cat_telegram',
    route: 'telegram-store',
    brandKey: 'telegram',
  },
  {
    id: 'cat23_efootball_android',
    nameEn: 'eFootball Android',
    nameBn: 'ই-ফুটবল অ্যান্ড্রয়েড',
    shortEn: 'eFootball Android',
    shortBn: 'eFootball অ্যান্ড্রয়েড',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'efootball_android',
  },
  {
    id: 'cat23_efootball_iphone',
    nameEn: 'eFootball iPhone',
    nameBn: 'ই-ফুটবল আইফোন (iOS)',
    shortEn: 'eFootball iPhone',
    shortBn: 'eFootball আইফোন',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'efootball_iphone',
  },
  {
    id: 'cat23_pubg',
    nameEn: 'PUBG Mobile UC',
    nameBn: 'পাবজি মোবাইল UC',
    shortEn: 'PUBG UC',
    shortBn: 'PUBG UC',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'pubg',
  },
  {
    id: 'cat23_roblox',
    nameEn: 'Roblox Robux',
    nameBn: 'রবলক্স রোবাক্স',
    shortEn: 'Roblox Robux',
    shortBn: 'Roblox Robux',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'roblox',
  },
  {
    id: 'cat23_fc_mobile',
    nameEn: 'FC Mobile Points & Packs',
    nameBn: 'FC মোবাইল পয়েন্টস ও প্যাকস',
    shortEn: 'FC Mobile',
    shortBn: 'FC মোবাইল',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'eafc',
  },
  {
    id: 'cat23_dls',
    nameEn: 'DLS 2026',
    nameBn: 'DLS 2026',
    shortEn: 'DLS 2026',
    shortBn: 'DLS 2026',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'dls',
  },
  {
    id: 'cat23_clash_royale',
    nameEn: 'Clash Royale',
    nameBn: 'ক্ল্যাশ রয়্যাল',
    shortEn: 'Clash Royale',
    shortBn: 'ক্ল্যাশ রয়্যাল',
    parentCategoryId: 'cat_gaming',
    route: 'gaming-store',
    brandKey: 'clashroyale',
  },
  {
    id: 'cat23_vpn',
    nameEn: 'VPN Services',
    nameBn: 'ভিপিএন সার্ভিসসমূহ',
    shortEn: 'VPN Services',
    shortBn: 'VPN সার্ভিস',
    parentCategoryId: 'cat_software',
    route: 'software-store',
    brandKey: 'vpn',
  },
  {
    id: 'cat23_chorki',
    nameEn: 'Chorki Subscription',
    nameBn: 'চরকি সাবস্ক্রিপশন',
    shortEn: 'Chorki',
    shortBn: 'চরকি',
    parentCategoryId: 'cat_streaming',
    route: 'streaming-store',
    brandKey: 'chorki',
  },
  {
    id: 'cat23_crunchyroll',
    nameEn: 'Crunchyroll Premium',
    nameBn: 'ক্রাঞ্চিরোল প্রিমিয়াম',
    shortEn: 'Crunchyroll',
    shortBn: 'ক্রাঞ্চিরোল',
    parentCategoryId: 'cat_streaming',
    route: 'streaming-store',
    brandKey: 'crunchyroll',
  },
  {
    id: 'cat23_chatgpt',
    nameEn: 'ChatGPT Premium',
    nameBn: 'চ্যাটজিপিটি প্রিমিয়াম',
    shortEn: 'ChatGPT',
    shortBn: 'ChatGPT',
    parentCategoryId: 'cat_ai',
    route: 'ai-marketplace',
    brandKey: 'chatgpt',
  },
];

export const CATALOG_23_MAP = new Map<string, CatalogSectionDef>(
  CATALOG_23_CATEGORIES.map((c) => [c.id, c])
);

/**
 * Maps any product (seeded or admin-created) to one of the 23 catalog sections when applicable.
 */
export function getProductCatalogSectionId(product: Product): string | undefined {
  if (product.catalogSectionId && CATALOG_23_MAP.has(product.catalogSectionId)) {
    return product.catalogSectionId;
  }
  const id = (product.id || '').toLowerCase();
  const bk = (product.brandKey || '').toLowerCase();
  const sub = (product.subcategoryEn || '').toLowerCase();

  if (id === 'prod_ff_bd_diamonds' || (bk === 'freefire' && id !== 'prod_game_topup')) return 'cat23_ff_bd';
  if (id === 'prod_ff_indo' || bk === 'freefire_indo') return 'cat23_ff_indo';
  if (id === 'prod_ff_weekly_monthly' || bk === 'freefire_wm') return 'cat23_ff_wm';
  if (id === 'prod_ff_weekly_lite' || bk === 'freefire_wlite') return 'cat23_ff_wlite';
  if (id === 'prod_ff_level_evo' || bk === 'freefire_lvl') return 'cat23_ff_lvl';
  if (id === 'prod_ff_likes' || bk === 'freefire_likes') return 'cat23_ff_likes';
  if (id === 'prod_game_airdrop' || bk === 'airdrop') return 'cat23_ff_airdrop';
  if (id === 'prod_smm_tiktok_coins' || sub.includes('tiktok coins')) return 'cat23_tiktok_coins';
  if (id === 'prod_smm_tiktok_growth' || bk === 'tiktok') return 'cat23_tiktok_growth';
  if (id === 'prod_smm_facebook_growth' || (bk === 'facebook' && id !== 'prod_soc_branding')) return 'cat23_facebook';
  if (id === 'prod_smm_instagram_growth' || bk === 'instagram') return 'cat23_instagram';
  if (
    id === 'prod_tg_premium_3m' ||
    id === 'prod_tg_premium_12m' ||
    id === 'prod_tg_stars_100' ||
    id === 'prod_smm_telegram_members' ||
    bk === 'telegram' ||
    bk === 'telegram_stars'
  ) {
    return 'cat23_telegram';
  }
  if (id === 'prod_efootball_iphone' || bk === 'efootball_iphone' || sub.includes('efootball iphone')) {
    return 'cat23_efootball_iphone';
  }
  if (id === 'prod_efootball_coins' || bk === 'efootball_android' || bk === 'efootball') {
    return 'cat23_efootball_android';
  }
  if (id === 'prod_pubg_uc' || bk === 'pubg') return 'cat23_pubg';
  if (id === 'prod_roblox_robux' || id === 'prod_roblox_giftcard' || bk === 'roblox' || bk === 'roblox_card') {
    return 'cat23_roblox';
  }
  if (id === 'prod_eafc_points' || bk === 'eafc') return 'cat23_fc_mobile';
  if (id === 'prod_dls_gems' || bk === 'dls') return 'cat23_dls';
  if (id === 'prod_clash_royale' || bk === 'clashroyale') return 'cat23_clash_royale';
  if (id === 'prod_sw_vpn_pro' || bk === 'vpn') return 'cat23_vpn';
  if (id === 'prod_stream_chorki' || bk === 'chorki') return 'cat23_chorki';
  if (id === 'prod_stream_crunchyroll' || bk === 'crunchyroll') return 'cat23_crunchyroll';
  if (id === 'prod_ai_chatgpt_plus' || (bk === 'chatgpt' && id !== 'prod_ai_writing_pro')) return 'cat23_chatgpt';
  return undefined;
}

/**
 * Independent per-package availability resolver.
 * Never auto-activates a package or product marked out_of_stock.
 */
export function getPackageAvailability(
  pkg: ProductPackage | undefined,
  product: Product
): 'in_stock' | 'limited' | 'out_of_stock' {
  if (product.availability === 'out_of_stock') return 'out_of_stock';
  if (pkg?.availability) return pkg.availability;
  return product.availability || 'in_stock';
}

export function isPackagePurchasable(pkg: ProductPackage | undefined, product: Product): boolean {
  return getPackageAvailability(pkg, product) !== 'out_of_stock';
}

/**
 * Computes effective storefront availability for a product considering all sub-packages.
 */
export function getEffectiveProductAvailability(
  product: Product
): 'in_stock' | 'limited' | 'out_of_stock' {
  if (product.availability === 'out_of_stock') return 'out_of_stock';
  if (product.packages && product.packages.length > 0) {
    const statuses = product.packages.map((pk) => getPackageAvailability(pk, product));
    if (statuses.every((s) => s === 'out_of_stock')) return 'out_of_stock';
    if (statuses.every((s) => s === 'limited' || s === 'out_of_stock')) return 'limited';
  }
  return product.availability || 'in_stock';
}

/**
 * Returns the first purchasable (non-out-of-stock) package if available, else the first package.
 */
export function getFirstAvailablePackage(product: Product): ProductPackage | undefined {
  const pkgs = getNormalizedPackages(product);
  return pkgs.find((pk) => isPackagePurchasable(pk, product)) || pkgs[0];
}

/**
 * Returns the customer-facing starting BDT price (prefers lowest available package price).
 */
export function getDisplayStartingPrice(product: Product): number {
  if (product.packages && product.packages.length > 0) {
    const available = product.packages.filter((pk) => isPackagePurchasable(pk, product));
    const pool = available.length > 0 ? available : product.packages;
    return Math.min(...pool.map((pk) => pk.priceBdt));
  }
  return product.priceBdt;
}

/**
 * Single source of truth for resolving which service-specific order form a product uses.
 * Zero-password design across every single service vertical.
 */
export function getProductOrderFormType(product: Product): OrderFormType {
  if (product.orderFormType) {
    return product.orderFormType;
  }

  const id = (product.id || '').toLowerCase();
  const brand = (product.brandKey || '').toLowerCase();
  const cat = (product.categoryId || '').toLowerCase();

  // 1. Free Fire family (including Free Fire Airdrop & Special Offers)
  if (brand.startsWith('freefire') || id.startsWith('prod_ff_') || id === 'prod_game_airdrop' || brand === 'airdrop') {
    return 'freefire';
  }

  // 2. Other UID / Player Tag / In-Game Top-ups
  if (
    [
      'pubg',
      'mlbb',
      'efootball',
      'efootball_android',
      'efootball_iphone',
      'valorant',
      'roblox',
      'genshin',
      'eafc',
      'coc',
      'clashroyale',
      'codm',
      'dls',
    ].includes(brand) ||
    id === 'prod_game_topup'
  ) {
    return 'pubg_uid';
  }

  // 3. Gift Cards & Game Vouchers
  if (
    cat === 'cat_giftcards' ||
    ['unipin', 'steam', 'googleplay', 'psn', 'playstation', 'xbox', 'apple', 'roblox_card', 'razer'].includes(
      brand
    )
  ) {
    return 'giftcard';
  }

  // 4. Telegram Services & VIP Groups (including Telegram Channel Members)
  if (
    cat === 'cat_telegram' ||
    cat === 'cat_vip' ||
    ['telegram', 'telegram_stars', 'vip'].includes(brand) ||
    id.startsWith('prod_tg_') ||
    id.startsWith('prod_vip_') ||
    id === 'prod_smm_telegram_members'
  ) {
    return 'telegram';
  }

  // 5. Social Media Services
  if (
    cat === 'cat_social' ||
    ['tiktok', 'facebook', 'youtube', 'instagram', 'discord'].includes(brand) ||
    id.startsWith('prod_smm_') ||
    id.startsWith('prod_soc_')
  ) {
    return 'social';
  }

  // 6. Graphic Design & Custom Digital Services
  if (
    cat === 'cat_design' ||
    cat === 'cat_digital' ||
    ['webdesign', 'logodesign', 'bannerdesign', 'videoediting', 'design', 'domain', 'hosting', 'ssl', 'templates', 'ebook'].includes(
      brand
    ) ||
    id.startsWith('prod_des_') ||
    id.startsWith('prod_dig_')
  ) {
    return 'design';
  }

  // 7. Streaming, VPN, AI Premium & Software Licenses
  return 'subscription';
}

/**
 * Deterministic fallback stock count when an older seeded product
 * does not yet have an explicit stockCount field stored.
 */
export function getProductStockCount(product: Product): number {
  if (typeof product.stockCount === 'number' && !Number.isNaN(product.stockCount)) {
    return Math.max(0, Math.floor(product.stockCount));
  }
  const effective = getEffectiveProductAvailability(product);
  if (effective === 'out_of_stock') return 0;
  if (effective === 'limited') return 14;
  let hash = 0;
  for (let i = 0; i < product.id.length; i++) {
    hash = (hash * 31 + product.id.charCodeAt(i)) % 197;
  }
  return 45 + hash;
}

/**
 * Structured bilingual Rules, Conditions & Refund Policy summary tailored by service vertical.
 */
export function getRulesAndRefundPoints(product: Product, lang: Language): {
  rules: string[];
  refundPolicy: string[];
} {
  const formType = getProductOrderFormType(product);
  const customTerms = lang === 'bn' ? product.termsBn : product.termsEn;

  if (lang === 'bn') {
    const baseRulesByType: Record<OrderFormType, string[]> = {
      freefire: [
        'সঠিক প্লেয়ার UID ও সঠিক সার্ভার (Bangladesh / Indonesia / Global) দিন — কোনো পাসওয়ার্ড লাগবে না।',
        'ভুল UID বা ভুল সার্ভার দিলে ডেলিভারির পর অর্ডার পরিবর্তন বা রিফান্ড করা যাবে না।',
        'পেমেন্ট যাচাইয়ের পর সাধারণত ১ থেকে ১০ মিনিটের মধ্যে সরাসরি গেম অ্যাকাউন্টে ডেলিভারি হয়।',
      ],
      pubg_uid: [
        'সঠিক Player ID / Konami ID / Supercell Tag / Roblox Username এবং সঠিক প্ল্যাটফর্ম বা রিজিওন দিন।',
        'আমরা কখনোই আপনার গেম বা সোশ্যাল অ্যাকাউন্টের পাসওয়ার্ড চাই না।',
        'অর্ডার প্রসেসিং শুরু হলে স্ট্যাটাস রিয়েল-টাইমে My Orders-এ আপডেট হবে।',
      ],
      telegram: [
        'Telegram Premium/Stars-এর জন্য সঠিক @ইউজারনেম এবং চ্যানেল মেম্বার্সের জন্য পাবলিক চ্যানেল লিংক দিন।',
        'সম্পূর্ণ পাসওয়ার্ড-মুক্ত ডেলিভারি — কখনো Telegram লগইন কোড বা পাসওয়ার্ড দেবেন না।',
        'ডেলিভারি শেষ না হওয়া পর্যন্ত ইউজারনেম বা চ্যানেল লিংক পরিবর্তন করবেন না।',
      ],
      giftcard: [
        'কার্ডের Region (US / Global / UK / TR / BD) আপনার অ্যাকাউন্টের সাথে মিলিয়ে নিন।',
        'ডিজিটাল রিডিম কোড একবার ইস্যু বা ডেলিভারি হলে রিফান্ড বা এক্সচেঞ্জ প্রযোজ্য নয়।',
        'ভেরিফাইড ইমেইল ও My Orders ড্যাশবোর্ডে কোড ডেলিভারি করা হবে।',
      ],
      social: [
        'সঠিক পাবলিক @ইউজারনেম, প্রোফাইল লিংক বা পোস্ট/ভিডিও লিংক দিন — প্রোফাইল প্রাইভেট রাখবেন না।',
        'নিরাপত্তা গ্যারান্টি: Facebook, TikTok বা Instagram-এর কোনো পাসওয়ার্ড কখনোই চাওয়া হয় না।',
        'অর্ডার চলাকালীন ইউজারনেম পরিবর্তন বা পোস্ট ডিলিট করবেন না।',
      ],
      subscription: [
        'সঠিক WhatsApp নম্বর এবং প্রযোজ্য ক্ষেত্রে ডেলিভারি ইমেইল দিন — অ্যাক্টিভেশন ও ইনভাইট সেখানেই পাবেন।',
        'নিরাপত্তার স্বার্থে আমরা কখনোই আপনার ব্যক্তিগত অ্যাকাউন্টের পাসওয়ার্ড চাই না।',
        'ওয়ারেন্টি ও রিপ্লেসমেন্ট সাপোর্ট নির্বাচিত প্যাকেজের মেয়াদ অনুযায়ী প্রযোজ্য।',
      ],
      design: [
        'প্রজেক্টের বিবরণ, সাইজ ও পছন্দের রেফারেন্স ফাইল পরিষ্কারভাবে সংযুক্ত করুন।',
        'অর্ডারে সর্বোচ্চ ২টি ফ্রি রিভিশন অন্তর্ভুক্ত থাকে।',
        'চূড়ান্ত ফাইল হাই-রেজোলিউশন ও সোর্স ফরম্যাটে ডেলিভারি করা হবে।',
      ],
    };

    const rules = customTerms ? [customTerms, ...baseRulesByType[formType]] : baseRulesByType[formType];
    const refundPolicy = [
      'পেমেন্ট ভেরিফিকেশন পেন্ডিং থাকা অবস্থায় অর্ডার বাতিল করলে পূর্ণ অর্থ ওয়ালেটে ফেরত দেওয়া হয়।',
      'স্টক না থাকলে বা প্রযুক্তিগত কারণে ডেলিভারি ব্যর্থ হলে ১০০% ওয়ালেট রিফান্ড পাবেন।',
      'ভুল UID/লিংক প্রদান বা ডিজিটাল রিডিম কোড ডেলিভারির পর কোনো রিফান্ড প্রযোজ্য নয়।',
    ];
    return { rules, refundPolicy };
  }

  const baseRulesEn: Record<OrderFormType, string[]> = {
    freefire: [
      'Provide your exact numeric Free Fire Player UID and matching server (Bangladesh / Indonesia / Global) — zero password needed.',
      'Orders delivered to an incorrect UID provided by the customer cannot be reversed.',
      'Delivery typically completes within 1–10 minutes after payment verification.',
    ],
    pubg_uid: [
      'Double-check your Player ID / Konami ID / Supercell Tag / Roblox Username and matching platform or region.',
      'Security guarantee: DIGITAL HUB never asks for your game or account password.',
      'Real-time order progress is visible inside My Orders.',
    ],
    telegram: [
      'Enter your active Telegram @username for Premium/Stars, or public channel/group link (t.me/...) for Members.',
      'Zero passwords or OTP codes needed — fulfilled safely to your public handle or channel.',
      'Do not rename your @username or channel link until order status turns Completed.',
    ],
    giftcard: [
      'Verify the Gift Card region (USA, Global, UK, TR, BD) matches your account store region.',
      'Digital voucher/redeem keys are non-refundable once issued and delivered.',
      'Codes are delivered cleanly in Order Details and to your verified email.',
    ],
    social: [
      'Provide a valid public @username, profile URL, or post/video link (private accounts cannot receive delivery).',
      'Zero password policy: Never share Facebook, TikTok, or Instagram passwords.',
      'Do not change handle or delete the post while delivery is in progress.',
    ],
    subscription: [
      'Enter your active WhatsApp contact number and delivery email (where required) for fast activation/invite.',
      'Security guarantee: DIGITAL HUB never asks for your personal email or account password.',
      'Full validity period support applies for authorized subscription and VPN plans.',
    ],
    design: [
      'Describe brand name, dimensions, colors, and upload a reference image if available.',
      'Includes up to 2 complimentary revisions during design review.',
      'Final deliverables are provided in print/web-ready formats with invoice.',
    ],
  };

  const rules = customTerms ? [customTerms, ...baseRulesEn[formType]] : baseRulesEn[formType];
  const refundPolicy = [
    'Orders still in Verification Pending can be cancelled cleanly by the customer.',
    '100% automatic wallet refund if an item goes out of stock or cannot be fulfilled by our team.',
    'No refund applies after digital redeem codes, top-ups, or completed services are delivered to a valid/wrong target.',
  ];
  return { rules, refundPolicy };
}

/**
 * Ensures every product—even single-price items—offers clear selectable tiers
 * when rendered in Select Package / Select Recharge sections.
 */
export function getNormalizedPackages(product: Product): ProductPackage[] {
  if (product.packages && product.packages.length > 0) {
    return product.packages;
  }
  return [
    {
      id: `${product.id}_std`,
      nameBn: product.titleBn,
      nameEn: product.titleEn,
      priceBdt: product.priceBdt,
      ...(hasGenuineDiscount(product.priceBdt, product.originalPriceBdt)
        ? { originalPriceBdt: product.originalPriceBdt }
        : {}),
      availability: product.availability,
      tag: 'Standard',
    },
  ];
}
