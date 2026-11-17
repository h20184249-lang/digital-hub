import { Language, OrderFormType, Product } from '../types/marketplace';

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

  // 1. Free Fire family
  if (brand.startsWith('freefire') || id.startsWith('prod_ff_')) {
    return 'freefire';
  }

  // 2. Other UID / Player Tag / In-Game Top-ups
  if (
    ['pubg', 'mlbb', 'efootball', 'valorant', 'roblox', 'genshin', 'eafc', 'coc', 'clashroyale', 'codm', 'dls', 'airdrop'].includes(
      brand
    ) ||
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

  // 4. Telegram Services & VIP Groups
  if (
    cat === 'cat_telegram' ||
    cat === 'cat_vip' ||
    ['telegram', 'telegram_stars', 'vip'].includes(brand) ||
    id.startsWith('prod_tg_') ||
    id.startsWith('prod_vip_')
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

  // 7. Streaming, AI Premium & Software Licenses
  return 'subscription';
}

/**
 * Deterministic fallback stock count when an older seeded product in Firestore
 * does not yet have an explicit stockCount field stored.
 */
export function getProductStockCount(product: Product): number {
  if (typeof product.stockCount === 'number' && !Number.isNaN(product.stockCount)) {
    return Math.max(0, Math.floor(product.stockCount));
  }
  if (product.availability === 'out_of_stock') return 0;
  if (product.availability === 'limited') return 14;
  // Deterministic 45..250 stock based on product ID hash
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
        'সঠিক প্লেয়ার UID ও সঠিক সার্ভার (BD / Indonesia / Singapore / Global) দিন।',
        'গেমের ভেতরের নাম/UID একবার সাবমিট করার পর ভুল হলে অর্ডার ফেরতযোগ্য নয়।',
        'টপ-আপ সাধারণত ১ থেকে ১০ মিনিটের মধ্যে সরাসরি গেম অ্যাকাউন্টে পৌঁছে যায়।',
      ],
      pubg_uid: [
        'প্লেয়ার ID / Supercell Tag / Riot ID এবং সঠিক Region নিশ্চিত করে লিখুন।',
        'ভুল Region বা ভুল Player ID দিলে ডেলিভারি ব্যর্থ হতে পারে।',
        'অর্ডার প্রসেসিং শুরু হলে স্ট্যাটাস রিয়েল-টাইমে আপডেট হবে।',
      ],
      telegram: [
        'সঠিক Telegram @ইউজারনেম দিন এবং প্রোফাইল পাবলিক রাখুন।',
        'Telegram Premium বা Stars সরাসরি আপনার @ইউজারনেমে পাঠানো হবে (পাসওয়ার্ড লাগবে না)।',
        'ইউজারনেম পরিবর্তন করলে ডেলিভারির আগে সাপোর্টে জানাবেন।',
      ],
      giftcard: [
        'কার্ডের Region (US / Global / UK / TR / BD) আপনার অ্যাকাউন্টের সাথে মিলিয়ে নিন।',
        'ডিজিটাল রিডিম কোড একবার ইস্যু বা ডেলিভারি হলে রিফান্ড বা এক্সচেঞ্জ প্রযোজ্য নয়।',
        'ভেরিফাইড ইমেইল ও My Orders ড্যাশবোর্ডে কোড ডেলিভারি করা হবে।',
      ],
      social: [
        'সঠিক পাবলিক প্রোফাইল/ভিডিও লিংক দিন — প্রোফাইল প্রাইভেট রাখবেন না।',
        'অর্ডার চলাকালীন ইউজারনেম বা পোস্ট URL পরিবর্তন করবেন না।',
        'অর্ডার সম্পূর্ণ হতে প্যাকেজভেদে ১–২৪ ঘণ্টা সময় লাগতে পারে।',
      ],
      subscription: [
        'নিরাপত্তার স্বার্থে আমরা কখনোই আপনার ইমেইল বা কোনো অ্যাকাউন্টের পাসওয়ার্ড চাই না।',
        'সঠিক ডেলিভারি ইমেইল ও WhatsApp/Telegram নম্বর দিন — অ্যাক্টিভেশন/ইনভাইট পাঠানো হবে।',
        'ওয়ারেন্টি ও রিপ্লেসমেন্ট সাপোর্ট প্যাকেজের মেয়াদ অনুযায়ী প্রযোজ্য।',
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
      'Provide your exact numeric Free Fire Player UID and matching game server (BD / ID / SG / Global).',
      'Orders delivered to an incorrect UID provided by the customer cannot be reversed.',
      'Delivery typically completes within 1–10 minutes after payment verification.',
    ],
    pubg_uid: [
      'Double-check your Player ID / Supercell Tag / Riot ID and region before submitting.',
      'Wrong region or mismatched ID may delay or invalidate automated fulfillment.',
      'Real-time order progress is visible inside My Orders.',
    ],
    telegram: [
      'Enter your active Telegram @username and ensure gift/star reception is enabled.',
      'Zero passwords needed — Premium & Stars are gifted directly to your @handle.',
      'Do not change your @username until order status turns Completed.',
    ],
    giftcard: [
      'Verify the Gift Card region (USA, Global, UK, TR, BD) matches your account store region.',
      'Digital voucher/redeem keys are non-refundable once issued and delivered.',
      'Codes are delivered cleanly in Order Details and to your verified email.',
    ],
    social: [
      'Provide a valid public profile, channel, or video URL (private accounts cannot receive delivery).',
      'Do not change handle or delete the post while delivery is in progress.',
      'Completion begins promptly after payment verification and finishes within the stated window.',
    ],
    subscription: [
      'Security guarantee: DIGITAL HUB never asks for your personal email or account password.',
      'Provide an active delivery email & WhatsApp/Telegram contact to receive invites or license keys.',
      'Full validity period replacement warranty applies for authorized workspace/license tiers.',
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
 * when rendered in MangoTop-style Select Package / Select Recharge sections.
 */
export function getNormalizedPackages(product: Product) {
  if (product.packages && product.packages.length > 0) {
    return product.packages;
  }
  return [
    {
      id: `${product.id}_std`,
      nameBn: product.titleBn,
      nameEn: product.titleEn,
      priceBdt: product.priceBdt,
      originalPriceBdt: product.originalPriceBdt,
      tag: 'Standard',
    },
  ];
}
