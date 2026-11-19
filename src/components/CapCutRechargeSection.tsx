import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Monitor,
  MonitorSmartphone,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
} from 'lucide-react';
import type { Language, Product, ProductPackage } from '../types/marketplace';

interface CapCutRechargeSectionProps {
  products: Product[];
  lang: Language;
  onOrderPackage: (product: Product, pkg: ProductPackage) => void;
  onAddToCart: (product: Product, pkg: ProductPackage) => void;
}

export const CAPCUT_RECHARGE_PRODUCT_ID = 'prod_capcut_premium_recharge';

interface CapCutPlanCardMeta {
  packageId: string;
  title: string;
  priceBdt: number;
  durationBn: string;
  durationEn: string;
  deviceBn: string;
  deviceEn: string;
  platformType: 'both' | 'pc' | 'mobile';
  badgeBn: string;
  badgeEn: string;
  accentGradient: string;
  imageUrl: string;
  imagePosition: string;
  highlightsBn: string[];
  highlightsEn: string[];
}

const CAPCUT_OFFICIAL_PLANS: CapCutPlanCardMeta[] = [
  {
    packageId: 'cc_prem_private_max_2dev',
    title: 'CapCut 1 Month Private Max – 2 Devices (Mobile + PC)',
    priceBdt: 670,
    durationBn: '১ মাস (৩০ দিন)',
    durationEn: '1 Month (30 Days)',
    deviceBn: '২টি ডিভাইস (Mobile + PC)',
    deviceEn: '2 Devices (Mobile + PC)',
    platformType: 'both',
    badgeBn: 'সেরা প্যাক • Private Max',
    badgeEn: 'Best Value • Private Max',
    accentGradient: 'from-[#0EA5E9] to-[#2563EB]',
    imageUrl: '/assets/capcut/capcut-private-max.jpg',
    imagePosition: 'object-center',
    highlightsBn: [
      'একই সাথে Mobile ও PC (সর্বোচ্চ ২টি ডিভাইস)',
      '৪কে ওয়াটারমার্ক-মুক্ত এক্সপোর্ট ও সব AI Pro টুলস',
    ],
    highlightsEn: [
      'Works on both Mobile & PC (Up to 2 Devices)',
      '4K watermark-free export & full AI Pro suite',
    ],
  },
  {
    packageId: 'cc_prem_pc_single_1dev',
    title: 'CapCut PC Single Device – 1 Device Max',
    priceBdt: 420,
    durationBn: '১ মাস (৩০ দিন)',
    durationEn: '1 Month (30 Days)',
    deviceBn: '১টি ডিভাইস সর্বোচ্চ (PC)',
    deviceEn: '1 Device Max (PC)',
    platformType: 'pc',
    badgeBn: 'PC এডিশন',
    badgeEn: 'PC Pro Edition',
    accentGradient: 'from-[#172033] to-[#334155]',
    imageUrl: '/assets/capcut/capcut-pc-editor.jpg',
    imagePosition: 'object-left-top',
    highlightsBn: [
      'Windows / Mac ডেস্কটপ এডিটরের জন্য ডেডিকেটেড',
      'প্রো ফিল্টার, ট্রানজিশন, অটো-ক্যাপশন ও ইফেক্টস',
    ],
    highlightsEn: [
      'Dedicated for CapCut Windows / Mac Desktop',
      'Pro filters, transitions, auto-captions & effects',
    ],
  },
  {
    packageId: 'cc_prem_mobile_single_1dev',
    title: 'CapCut 1 Month Single Device (Mobile)',
    priceBdt: 370,
    durationBn: '১ মাস (৩০ দিন)',
    durationEn: '1 Month (30 Days)',
    deviceBn: '১টি ডিভাইস (Mobile)',
    deviceEn: '1 Device (Mobile)',
    platformType: 'mobile',
    badgeBn: 'জনপ্রিয় • Mobile',
    badgeEn: 'Popular • Mobile',
    accentGradient: 'from-[#FF8500] to-[#F97316]',
    imageUrl: '/assets/capcut/capcut-mobile-editor.jpg',
    imagePosition: 'object-[50%_20%]',
    highlightsBn: [
      'Android ও iPhone মোবাইল অ্যাপের জন্য প্রিমিয়াম প্যাক',
      'AutoCut, প্রো টেমপ্লেট ও দ্রুত হাই-রেজোলিউশন এক্সপোর্ট',
    ],
    highlightsEn: [
      'Official Pro access for Android & iOS Mobile App',
      'AutoCut, Pro templates & fast HD/4K export',
    ],
  },
];

const FALLBACK_CAPCUT_PRODUCT: Product = {
  id: CAPCUT_RECHARGE_PRODUCT_ID,
  categoryId: 'cat_software',
  subcategoryBn: 'CapCut প্রিমিয়াম রিচার্জ',
  subcategoryEn: 'CapCut Premium Recharge',
  brandKey: 'capcut',
  customLogoUrl: '/assets/capcut/capcut-logo.png',
  orderFormType: 'subscription',
  titleBn: 'CapCut Premium Recharge Package',
  titleEn: 'CapCut Premium Recharge Package',
  descriptionBn:
    'অফিশিয়াল CapCut Pro রিচার্জ প্যাকেজ — Mobile ও PC-তে ওয়াটারমার্ক-মুক্ত 4K এক্সপোর্ট, AI অটো-ক্যাপশন ও প্রিমিয়াম ইফেক্ট।',
  descriptionEn:
    'Official CapCut Premium Recharge plans for Mobile & PC with watermark-free 4K export, AI Auto Captions, and all Pro effects.',
  priceBdt: 370,
  packages: CAPCUT_OFFICIAL_PLANS.map((plan) => ({
    id: plan.packageId,
    nameBn: plan.title,
    nameEn: plan.title,
    priceBdt: plan.priceBdt,
    tag: plan.badgeEn,
  })),
  availability: 'in_stock',
  deliveryDurationBn: '১০ - ৩০ মিনিট',
  deliveryDurationEn: '10 - 30 mins',
  instructionsBn: 'আপনার CapCut অ্যাকাউন্ট ইমেইল (Account Info) এবং WhatsApp নম্বর সঠিকভাবে দিন।',
  instructionsEn: 'Enter your CapCut Account Email (Account Info) and WhatsApp number accurately.',
  sectionTag: 'standard',
  imageUrl: '/assets/capcut/capcut-private-max.jpg',
  featured: false,
  active: true,
};

export function CapCutRechargeSection({
  products,
  lang,
  onOrderPackage,
  onAddToCart,
}: CapCutRechargeSectionProps) {
  const catalogProduct =
    products.find((p) => p.id === CAPCUT_RECHARGE_PRODUCT_ID && p.active) || FALLBACK_CAPCUT_PRODUCT;

  const resolvePackage = (plan: CapCutPlanCardMeta): ProductPackage => {
    const fromCatalog = (catalogProduct.packages || []).find((p) => p.id === plan.packageId);
    if (fromCatalog) return fromCatalog;
    return {
      id: plan.packageId,
      nameBn: plan.title,
      nameEn: plan.title,
      priceBdt: plan.priceBdt,
      tag: plan.badgeEn,
    };
  };

  const renderDeviceIcon = (platformType: CapCutPlanCardMeta['platformType']) => {
    if (platformType === 'both') return <MonitorSmartphone className="w-3.5 h-3.5 text-[#FF8500] shrink-0" />;
    if (platformType === 'pc') return <Monitor className="w-3.5 h-3.5 text-[#FF8500] shrink-0" />;
    return <Smartphone className="w-3.5 h-3.5 text-[#FF8500] shrink-0" />;
  };

  return (
    <section
      aria-label="CapCut Premium Recharge Package"
      className="space-y-4"
    >
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-2xl bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-700 shadow-sm p-1.5 flex items-center justify-center shrink-0">
            <img
              src="/assets/capcut/capcut-logo.png"
              alt="CapCut Official Logo"
              className="w-full h-full object-contain rounded-lg"
            />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg sm:text-xl font-extrabold text-[#172033] dark:text-slate-50 tracking-tight leading-snug">
                CapCut Premium Recharge Package
              </h2>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800/70 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="w-3 h-3" />
                {lang === 'bn' ? 'অফিশিয়াল প্যাক' : 'Official Pro'}
              </span>
            </div>
            <p className="text-xs sm:text-sm text-[#64748B] dark:text-slate-400 mt-0.5">
              {lang === 'bn'
                ? 'পছন্দের CapCut Pro প্যাকেজ সিলেক্ট করে দ্রুত অর্ডার সম্পন্ন করুন'
                : 'Select your preferred CapCut Pro recharge plan for instant activation'}
            </p>
          </div>
        </div>
      </div>

      {/* 3 Premium Responsive Package Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-5">
        {CAPCUT_OFFICIAL_PLANS.map((plan) => {
          const pkg = resolvePackage(plan);
          const highlights = lang === 'bn' ? plan.highlightsBn : plan.highlightsEn;

          return (
            <article
              key={plan.packageId}
              className="group dh-card dh-card-hover rounded-3xl overflow-hidden flex flex-col bg-white dark:bg-slate-900 border border-[#E2E9F7] dark:border-slate-800"
            >
              {/* Official CapCut Package Image + Authentic CapCut Logo */}
              <div className="relative aspect-[16/10] w-full overflow-hidden bg-[#0B1120]">
                <img
                  src={plan.imageUrl}
                  alt={plan.title}
                  loading="lazy"
                  className={`w-full h-full object-cover ${plan.imagePosition} transition-transform duration-500 group-hover:scale-[1.04]`}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#0B1120]/85 via-[#0B1120]/20 to-transparent" />

                {/* Top-Left Official CapCut Logo Badge */}
                <div className="absolute top-3 left-3 flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-white/95 backdrop-blur-xs shadow-md border border-white/80">
                  <img
                    src="/assets/capcut/capcut-logo.png"
                    alt="CapCut"
                    className="w-5 h-5 object-contain rounded-xs"
                  />
                  <span className="text-[11px] font-extrabold text-[#111827] tracking-tight">
                    CapCut Pro
                  </span>
                </div>

                {/* Top-Right Plan Tag */}
                <span
                  className={`absolute top-3 right-3 px-2.5 py-1 rounded-xl bg-gradient-to-r ${plan.accentGradient} text-white text-[10px] font-extrabold tracking-wide shadow-md`}
                >
                  {lang === 'bn' ? plan.badgeBn : plan.badgeEn}
                </span>

                {/* Bottom-Left Quick Device Tag on Artwork */}
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-xs border border-white/15 text-[11px] font-semibold text-white">
                    {renderDeviceIcon(plan.platformType)}
                    <span>{lang === 'bn' ? plan.deviceBn : plan.deviceEn}</span>
                  </span>
                </div>
              </div>

              {/* Card Details Body */}
              <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between gap-4">
                <div className="space-y-3">
                  {/* Package Name */}
                  <h3 className="text-[15px] sm:text-base font-extrabold text-[#172033] dark:text-slate-50 leading-snug">
                    {plan.title}
                  </h3>

                  {/* Duration & Device Info Grid */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-xl bg-[#F5F8FF] dark:bg-slate-800/80 border border-[#E6ECFA] dark:border-slate-700/70 px-3 py-2">
                      <span className="block text-[10px] font-bold uppercase tracking-wide text-[#64748B] dark:text-slate-400">
                        {lang === 'bn' ? 'মেয়াদ' : 'Duration'}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-xs font-extrabold text-[#172033] dark:text-slate-100">
                        <Clock className="w-3.5 h-3.5 text-[#FF8500] shrink-0" />
                        <span className="truncate">
                          {lang === 'bn' ? plan.durationBn : plan.durationEn}
                        </span>
                      </span>
                    </div>

                    <div className="rounded-xl bg-[#F5F8FF] dark:bg-slate-800/80 border border-[#E6ECFA] dark:border-slate-700/70 px-3 py-2">
                      <span className="block text-[10px] font-bold uppercase tracking-wide text-[#64748B] dark:text-slate-400">
                        {lang === 'bn' ? 'ডিভাইস সংখ্যা' : 'Device Limit'}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-xs font-extrabold text-[#172033] dark:text-slate-100">
                        {renderDeviceIcon(plan.platformType)}
                        <span className="truncate">
                          {lang === 'bn' ? plan.deviceBn : plan.deviceEn}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Concise Feature Highlights */}
                  <ul className="space-y-1.5 text-xs text-[#5C6B84] dark:text-slate-300">
                    {highlights.map((line) => (
                      <li key={line} className="flex items-start gap-1.5 leading-snug">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Price & Order Actions */}
                <div className="pt-3 border-t border-[#E6ECFA] dark:border-slate-800 flex items-center justify-between gap-3">
                  <div>
                    <span className="block text-[10px] font-bold uppercase tracking-wide text-[#64748B] dark:text-slate-400">
                      {lang === 'bn' ? 'প্যাকেজ মূল্য' : 'Package Price'}
                    </span>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-extrabold font-mono-num text-[#FF8500] leading-none">
                        ৳{pkg.priceBdt}
                      </span>
                      <span className="text-[11px] font-semibold text-[#64748B] dark:text-slate-400">
                        {lang === 'bn' ? '/ ১ মাস' : '/ month'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onAddToCart(catalogProduct, pkg)}
                      aria-label={lang === 'bn' ? 'কার্টে যোগ করুন' : 'Add to Cart'}
                      title={lang === 'bn' ? 'কার্টে যোগ করুন' : 'Add to Cart'}
                      className="w-10 h-10 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 hover:bg-[#FFF3E5] dark:hover:bg-slate-700 border border-[#E2E9F7] dark:border-slate-700 text-[#172033] dark:text-slate-200 hover:text-[#FF8500] flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <ShoppingCart className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onOrderPackage(catalogProduct, pkg)}
                      className="min-h-[40px] px-4 py-2 rounded-xl dh-orange-gradient hover:opacity-95 active:scale-[0.99] text-white text-xs sm:text-sm font-extrabold inline-flex items-center gap-1.5 shadow-[0_6px_16px_rgba(255,133,0,0.28)] transition-all cursor-pointer"
                    >
                      <span>{lang === 'bn' ? 'অর্ডার করুন' : 'Order Now'}</span>
                      <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
