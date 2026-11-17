import { useState } from 'react';
import { CheckoutPaymentMethod, Language, PaymentMethod, Product, SiteSettings } from '../types/marketplace';
import {
  isCustomUploadedProductImage,
  resolveProductBanner,
  resolveStudioImage,
  STUDIO_IMAGES,
} from '../lib/studioAssets';

interface PaymentLogoProps {
  method: CheckoutPaymentMethod;
  compact?: boolean;
  customLogoUrl?: string;
  settings?: SiteSettings;
}

export const PAYMENT_BRAND_META: Record<
  PaymentMethod,
  {
    nameEn: string;
    nameBn: string;
    primaryColor: string;
    secondaryColor: string;
    gradient: string;
    softBg: string;
    borderColor: string;
    defaultLogoPath: string;
  }
> = {
  bkash: {
    nameEn: 'bKash',
    nameBn: 'বিকাশ',
    primaryColor: '#E2136E',
    secondaryColor: '#C4105D',
    gradient: 'linear-gradient(135deg, #E2136E 0%, #C4105D 100%)',
    softBg: '#FFF1F7',
    borderColor: 'rgba(226, 19, 110, 0.35)',
    defaultLogoPath: '/assets/payments/bkash.svg',
  },
  nagad: {
    nameEn: 'Nagad',
    nameBn: 'নগদ',
    primaryColor: '#ED1C24',
    secondaryColor: '#F7941D',
    gradient: 'linear-gradient(135deg, #ED1C24 0%, #F7941D 100%)',
    softBg: '#FFF4ED',
    borderColor: 'rgba(237, 28, 36, 0.35)',
    defaultLogoPath: '/assets/payments/nagad.svg',
  },
  rocket: {
    nameEn: 'Rocket',
    nameBn: 'রকেট',
    primaryColor: '#8C3494',
    secondaryColor: '#691F70',
    gradient: 'linear-gradient(135deg, #8C3494 0%, #691F70 100%)',
    softBg: '#FAF2FC',
    borderColor: 'rgba(140, 52, 148, 0.35)',
    defaultLogoPath: '/assets/payments/rocket.svg',
  },
};

export function resolvePaymentLogoUrl(method: PaymentMethod, settings?: SiteSettings, customOverride?: string): string {
  if (customOverride && customOverride.trim()) return customOverride.trim();
  const fromSettings =
    method === 'bkash'
      ? settings?.bkashLogoUrl
      : method === 'nagad'
        ? settings?.nagadLogoUrl
        : settings?.rocketLogoUrl;
  if (fromSettings && fromSettings.trim()) return fromSettings.trim();
  return PAYMENT_BRAND_META[method].defaultLogoPath;
}

export function PaymentProviderLogo({ method, compact = false, customLogoUrl, settings }: PaymentLogoProps) {
  const [failedUrl, setFailedUrl] = useState('');

  if (method === 'wallet') {
    return (
      <div className="inline-flex items-center gap-2 select-none">
        <svg
          width={compact ? 28 : 36}
          height={compact ? 28 : 36}
          viewBox="0 0 40 40"
          fill="none"
          aria-hidden="true"
          className="shrink-0"
        >
          <rect width="40" height="40" rx="10" fill="#172033" />
          <rect x="9" y="13" width="22" height="15" rx="3.5" stroke="#FF9B19" strokeWidth="2.2" />
          <path d="M23 18.5H31V22.5H23C21.9 22.5 21 21.6 21 20.5C21 19.4 21.9 18.5 23 18.5Z" fill="#FF9B19" />
          <circle cx="23.5" cy="20.5" r="1" fill="#172033" />
        </svg>
        <div className="leading-none">
          <span className={`font-extrabold tracking-tight text-[#172033] ${compact ? 'text-xs' : 'text-sm'}`}>
            Wallet
          </span>
        </div>
      </div>
    );
  }

  const meta = PAYMENT_BRAND_META[method];
  const logoSrc = resolvePaymentLogoUrl(method, settings, customLogoUrl);
  const effectiveSrc = failedUrl === logoSrc ? meta.defaultLogoPath : logoSrc;
  const accountType =
    method === 'bkash'
      ? settings?.bkashType || 'Personal'
      : method === 'nagad'
        ? settings?.nagadType || 'Personal'
        : settings?.rocketType || 'Personal';

  return (
    <div className="inline-flex items-center gap-2 select-none min-w-0">
      <div
        className={`shrink-0 rounded-xl bg-white border border-[#E6ECFA] shadow-2xs flex items-center justify-center overflow-hidden ${
          compact ? 'h-8 px-1.5 min-w-[54px]' : 'h-10 px-2 min-w-[74px]'
        }`}
      >
        <img
          src={effectiveSrc}
          alt={meta.nameEn}
          referrerPolicy="no-referrer"
          onError={() => {
            if (effectiveSrc !== meta.defaultLogoPath) {
              setFailedUrl(effectiveSrc);
            }
          }}
          className={`${compact ? 'h-6 w-auto max-w-[66px]' : 'h-8 w-auto max-w-[84px]'} object-contain`}
        />
      </div>
      {!compact && (
        <div className="leading-none min-w-0">
          <span className="font-extrabold tracking-tight text-sm block" style={{ color: meta.primaryColor }}>
            {meta.nameEn}
          </span>
          <span className="block text-[10px] font-semibold text-[#777777] mt-0.5">{accountType}</span>
        </div>
      )}
    </div>
  );
}

export interface BrandMeta {
  bg: string;
  bgEnd: string;
  accent: string;
  label: string;
  sublabel: string;
  abbr: string;
}

export const BRAND_META: Record<string, BrandMeta> = {
  // Gaming
  freefire: { bg: '#220E08', bgEnd: '#7C2D12', accent: '#FF7A00', label: 'Free Fire', sublabel: 'Diamonds · UID', abbr: 'FF' },
  freefire_wm: { bg: '#2C1108', bgEnd: '#9A3412', accent: '#FBBF24', label: 'FF Membership', sublabel: 'Weekly / Monthly', abbr: 'W/M' },
  freefire_wlite: { bg: '#1D1829', bgEnd: '#6D28D9', accent: '#FDBA74', label: 'FF Weekly Lite', sublabel: '7-Day Budget Pass', abbr: 'LITE' },
  freefire_lvl: { bg: '#1F140A', bgEnd: '#B45309', accent: '#FDE047', label: 'FF Level Up', sublabel: 'Evo & Rank Pass', abbr: 'LVL' },
  freefire_likes: { bg: '#2B0D16', bgEnd: '#BE123C', accent: '#FB7185', label: 'FF Profile Likes', sublabel: 'Instant Like Boost', abbr: 'LIKE' },
  freefire_indo: { bg: '#27100D', bgEnd: '#991B1B', accent: '#F87171', label: 'Free Fire ID', sublabel: 'Indonesia UID', abbr: 'ID' },
  pubg: { bg: '#1E1A0D', bgEnd: '#854D0E', accent: '#F2A900', label: 'PUBG Mobile', sublabel: 'Global UC', abbr: 'UC' },
  efootball: { bg: '#08124D', bgEnd: '#1E3A8A', accent: '#FFE600', label: 'eFootball™', sublabel: 'Konami Coins', abbr: 'eF' },
  roblox: { bg: '#12151E', bgEnd: '#334155', accent: '#FFFFFF', label: 'Roblox', sublabel: 'Official Robux', abbr: 'RBX' },
  eafc: { bg: '#0A2616', bgEnd: '#166534', accent: '#4ADE80', label: 'EA SPORTS FC', sublabel: 'Coins & Packs', abbr: 'FC' },
  dls: { bg: '#0C2342', bgEnd: '#0369A1', accent: '#FACC15', label: 'DLS 2026', sublabel: 'Gems & Season', abbr: 'DLS' },
  coc: { bg: '#2B1707', bgEnd: '#92400E', accent: '#FBBF24', label: 'Clash of Clans', sublabel: 'Gold Pass & Gems', abbr: 'CoC' },
  clashroyale: { bg: '#0D214F', bgEnd: '#1D4ED8', accent: '#FACC15', label: 'Clash Royale', sublabel: 'Pass & Gems', abbr: 'CR' },
  unipin: { bg: '#211309', bgEnd: '#C2410C', accent: '#FF8500', label: 'UniPin', sublabel: 'Official Voucher', abbr: 'UP' },
  airdrop: { bg: '#0F2238', bgEnd: '#0E7490', accent: '#FDE047', label: 'In-Game Airdrop', sublabel: 'Special Crate', abbr: 'DROP' },
  mlbb: { bg: '#0E1930', bgEnd: '#1E40AF', accent: '#38BDF8', label: 'Mobile Legends', sublabel: 'MLBB Diamonds', abbr: 'ML' },
  valorant: { bg: '#210D14', bgEnd: '#9F1239', accent: '#FF4655', label: 'Valorant', sublabel: 'Riot VP', abbr: 'VP' },
  genshin: { bg: '#141B38', bgEnd: '#4338CA', accent: '#C4B5FD', label: 'Genshin Impact', sublabel: 'Welkin & Crystals', abbr: 'GI' },
  codm: { bg: '#161A1D', bgEnd: '#475569', accent: '#EAB308', label: 'COD Mobile', sublabel: 'CP Recharge', abbr: 'CP' },

  // Social Media
  telegram: { bg: '#082032', bgEnd: '#0284C7', accent: '#38BDF8', label: 'Telegram', sublabel: 'Official Premium', abbr: 'TG' },
  telegram_stars: { bg: '#1B1938', bgEnd: '#6D28D9', accent: '#FACC15', label: 'Telegram Stars', sublabel: 'Direct Username', abbr: '★' },
  facebook: { bg: '#091A3A', bgEnd: '#1D4ED8', accent: '#60A5FA', label: 'Facebook', sublabel: 'Page & Growth', abbr: 'fb' },
  tiktok: { bg: '#0B0B10', bgEnd: '#1E293B', accent: '#25F4EE', label: 'TikTok', sublabel: 'Growth & Coins', abbr: 'TT' },
  youtube: { bg: '#260808', bgEnd: '#991B1B', accent: '#FF0000', label: 'YouTube', sublabel: 'Subs · Views · Likes', abbr: 'YT' },
  instagram: { bg: '#2B0B24', bgEnd: '#9D174D', accent: '#F472B6', label: 'Instagram', sublabel: 'Followers & Reels', abbr: 'IG' },
  discord: { bg: '#15193B', bgEnd: '#4338CA', accent: '#818CF8', label: 'Discord', sublabel: 'Nitro & Boosts', abbr: 'DC' },
  vip: { bg: '#1B160B', bgEnd: '#78350F', accent: '#FACC15', label: 'VIP Community', sublabel: 'Private Access', abbr: 'VIP' },

  // Premium Subscriptions
  netflix: { bg: '#140607', bgEnd: '#7F1D1D', accent: '#E50914', label: 'Netflix', sublabel: '4K Ultra HD', abbr: 'N' },
  primevideo: { bg: '#071D2B', bgEnd: '#0369A1', accent: '#00A8E1', label: 'Prime Video', sublabel: 'Amazon UHD', abbr: 'PV' },
  chorki: { bg: '#24070B', bgEnd: '#991B1B', accent: '#ED1C24', label: 'Chorki', sublabel: 'Bangla OTT', abbr: 'CK' },
  crunchyroll: { bg: '#261105', bgEnd: '#C2410C', accent: '#F47521', label: 'Crunchyroll', sublabel: 'Anime Mega Fan', abbr: 'CR' },
  goodshorts: { bg: '#260A18', bgEnd: '#9D174D', accent: '#FB7185', label: 'GoodShorts', sublabel: 'Short Drama VIP', abbr: 'GS' },
  capcut: { bg: '#0F172A', bgEnd: '#334155', accent: '#F8FAFC', label: 'CapCut Pro', sublabel: 'Video Studio', abbr: 'CC' },
  spotify: { bg: '#0A2313', bgEnd: '#15803D', accent: '#1DB954', label: 'Spotify', sublabel: 'Ad-Free Music', abbr: 'SP' },
  vpn: { bg: '#0B1D3B', bgEnd: '#1E40AF', accent: '#60A5FA', label: 'VPN Pro', sublabel: 'Nord / Express', abbr: 'VPN' },

  // AI Premium Services
  chatgpt: { bg: '#07241C', bgEnd: '#047857', accent: '#10A37F', label: 'ChatGPT Plus', sublabel: 'OpenAI Official', abbr: 'GPT' },
  gemini: { bg: '#0F1B3D', bgEnd: '#4338CA', accent: '#60A5FA', label: 'Google Gemini', sublabel: 'Advanced AI', abbr: 'GEM' },
  claude: { bg: '#24140E', bgEnd: '#9A3412', accent: '#D97757', label: 'Claude AI', sublabel: 'Anthropic Pro', abbr: 'CLD' },
  perplexity: { bg: '#0B2329', bgEnd: '#0E7490', accent: '#20B8CD', label: 'Perplexity AI', sublabel: 'Pro Research', abbr: 'PPX' },
  grok: { bg: '#090D16', bgEnd: '#1E293B', accent: '#E2E8F0', label: 'Grok AI', sublabel: 'SuperGrok xAI', abbr: 'GRK' },
  grammarly: { bg: '#08241C', bgEnd: '#047857', accent: '#15C39A', label: 'Grammarly', sublabel: 'Pro Writing', abbr: 'Gr' },

  // Design & Software
  canva: { bg: '#08262B', bgEnd: '#5B21B6', accent: '#00C4CC', label: 'Canva Pro', sublabel: 'Brand & Design', abbr: 'Cv' },
  photoshop: { bg: '#001E36', bgEnd: '#075985', accent: '#31A8FF', label: 'Adobe Photoshop', sublabel: 'Creative Cloud', abbr: 'Ps' },
  illustrator: { bg: '#2B0B00', bgEnd: '#7C2D12', accent: '#FF9A00', label: 'Adobe Illustrator', sublabel: 'Vector Studio', abbr: 'Ai' },
  premiere: { bg: '#0F0836', bgEnd: '#3730A3', accent: '#A5B4FC', label: 'Adobe Premiere', sublabel: 'Pro Video Edit', abbr: 'Pr' },
  lightroom: { bg: '#001E36', bgEnd: '#0369A1', accent: '#38BDF8', label: 'Adobe Lightroom', sublabel: 'Photo Grade', abbr: 'Lr' },
  adobe: { bg: '#24080A', bgEnd: '#991B1B', accent: '#FF2B2B', label: 'Adobe CC', sublabel: 'All Apps Suite', abbr: 'CC' },
  office: { bg: '#2A0B05', bgEnd: '#9A3412', accent: '#EA3E23', label: 'Microsoft Office', sublabel: '365 & 2021 Pro', abbr: 'OFF' },
  windows: { bg: '#0B1D36', bgEnd: '#0369A1', accent: '#38BDF8', label: 'Windows 11/10', sublabel: 'Retail License', abbr: 'WIN' },
  microsoft: { bg: '#111C2E', bgEnd: '#1D4ED8', accent: '#00A4EF', label: 'Microsoft', sublabel: 'Genuine Keys', abbr: 'MS' },
  idm: { bg: '#0D2136', bgEnd: '#0369A1', accent: '#22C55E', label: 'IDM Official', sublabel: 'Lifetime Serial', abbr: 'IDM' },
  antivirus: { bg: '#09241B', bgEnd: '#047857', accent: '#34D399', label: 'Antivirus Pro', sublabel: 'Internet Security', abbr: 'AV' },

  // Gift Cards
  googleplay: { bg: '#0F222D', bgEnd: '#065F46', accent: '#00E676', label: 'Google Play', sublabel: 'Gift Card US', abbr: 'GP' },
  apple: { bg: '#111827', bgEnd: '#334155', accent: '#F8FAFC', label: 'Apple Card', sublabel: 'App Store & iTunes', abbr: 'APL' },
  steam: { bg: '#171A21', bgEnd: '#1E3A5F', accent: '#66C0F4', label: 'Steam Wallet', sublabel: 'Global USD Pin', abbr: 'STM' },
  roblox_card: { bg: '#18181B', bgEnd: '#B91C1C', accent: '#FCA5A5', label: 'Roblox Card', sublabel: 'Digital Gift PIN', abbr: 'RBX' },
  playstation: { bg: '#00246B', bgEnd: '#1D4ED8', accent: '#60A5FA', label: 'PlayStation', sublabel: 'PSN Store Card', abbr: 'PSN' },
  xbox: { bg: '#0A2E0A', bgEnd: '#15803D', accent: '#4ADE80', label: 'Xbox Card', sublabel: 'Store & Game Pass', abbr: 'XB' },
  razer: { bg: '#091409', bgEnd: '#14532D', accent: '#44D62C', label: 'Razer Gold', sublabel: 'Global Direct PIN', abbr: 'RZR' },

  // Other Digital Services
  domain: { bg: '#0F172A', bgEnd: '#1D4ED8', accent: '#60A5FA', label: 'Domain Reg.', sublabel: '.COM / .ORG / .NET', abbr: '.COM' },
  hosting: { bg: '#0B1D2E', bgEnd: '#0E7490', accent: '#38BDF8', label: 'Web Hosting', sublabel: 'NVMe SSD cPanel', abbr: 'HOST' },
  ssl: { bg: '#092319', bgEnd: '#047857', accent: '#34D399', label: 'SSL Certificate', sublabel: 'HTTPS Security', abbr: 'SSL' },
  webdesign: { bg: '#161333', bgEnd: '#4338CA', accent: '#818CF8', label: 'Website Design', sublabel: 'Responsive UI', abbr: 'WEB' },
  logodesign: { bg: '#211133', bgEnd: '#7E22CE', accent: '#E879F9', label: 'Logo Design', sublabel: 'Custom Branding', abbr: 'LOGO' },
  bannerdesign: { bg: '#26140A', bgEnd: '#C2410C', accent: '#FB923C', label: 'Banner Design', sublabel: 'Social & Web Ads', abbr: 'BNR' },
  videoediting: { bg: '#1B112B', bgEnd: '#9D174D', accent: '#F472B6', label: 'Video Editing', sublabel: 'Reels & YouTube', abbr: 'VID' },
  templates: { bg: '#161D2E', bgEnd: '#334155', accent: '#FF8500', label: 'Templates', sublabel: 'Editable Assets', abbr: 'TPL' },
  design: { bg: '#1D1433', bgEnd: '#6D28D9', accent: '#C084FC', label: 'Design Studio', sublabel: 'Creative Kit', abbr: 'DS' },
  ebook: { bg: '#1A1C2C', bgEnd: '#9A3412', accent: '#FF8500', label: 'Digital Kit', sublabel: 'Playbook & Kit', abbr: 'DK' },
};

const FULL_TILE_BRAND_SVGS = new Set([
  'photoshop',
  'illustrator',
  'premiere',
  'lightroom',
  'chorki',
  'goodshorts',
  'telegram_stars',
  'vip',
  'freefire_wm',
  'freefire_wlite',
  'freefire_lvl',
  'freefire_likes',
  'freefire_indo',
]);

export function ServiceBrandLogo({
  brandKey,
  size = 38,
  customLogoUrl,
}: {
  brandKey?: string;
  size?: number;
  customLogoUrl?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string>('');
  const key = (brandKey || '').toLowerCase();
  const meta = BRAND_META[key] || {
    bg: '#172033',
    bgEnd: '#23314d',
    accent: '#FF8500',
    label: 'DIGITAL HUB',
    sublabel: 'Verified Service',
    abbr: 'DH',
  };

  if (customLogoUrl && failedSrc !== customLogoUrl) {
    return (
      <img
        src={customLogoUrl}
        alt={meta.label}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        onError={() => setFailedSrc(customLogoUrl)}
        style={{ width: size, height: size }}
        className="shrink-0 rounded-xl object-cover shadow-md border border-white/25 bg-white"
      />
    );
  }

  const brandAssetPath = key && BRAND_META[key] ? `/assets/brands/${key}.svg` : '';
  if (brandAssetPath && failedSrc !== brandAssetPath) {
    const isFullTile = FULL_TILE_BRAND_SVGS.has(key);
    return (
      <div
        style={{ width: size, height: size }}
        className={`shrink-0 rounded-xl overflow-hidden shadow-md flex items-center justify-center ${
          isFullTile
            ? 'border border-white/25 bg-[#172033]'
            : 'bg-white border border-[#E6ECFA] p-1.5'
        }`}
      >
        <img
          src={brandAssetPath}
          alt={meta.label}
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(brandAssetPath)}
          className={`w-full h-full ${isFullTile ? 'object-cover' : 'object-contain'}`}
        />
      </div>
    );
  }

  const renderGlyph = () => {
    switch (key) {
      case 'netflix':
        return (
          <path d="M13.5 9.5H18L22.5 22V9.5H26.5V30.5H22.2L17.8 18.2V30.5H13.5V9.5Z" fill="#E50914" />
        );

      case 'primevideo':
        return (
          <>
            <polygon points="16,12 27,18.5 16,25" fill="#FFFFFF" />
            <path
              d="M11.5 26.5C16.8 30.2 23.8 30.2 28.8 26.2"
              stroke="#00A8E1"
              strokeWidth="2.4"
              strokeLinecap="round"
            />
            <path d="M26.5 25.4L29.6 26L28.5 29" stroke="#00A8E1" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
          </>
        );

      case 'chorki':
        return (
          <>
            <circle cx="20" cy="20" r="11" stroke="#ED1C24" strokeWidth="3.2" />
            <circle cx="20" cy="14" r="1.8" fill="#FFFFFF" />
            <circle cx="25.5" cy="18.2" r="1.8" fill="#FFFFFF" />
            <circle cx="23.4" cy="24.6" r="1.8" fill="#FFFFFF" />
            <circle cx="16.6" cy="24.6" r="1.8" fill="#FFFFFF" />
            <circle cx="14.5" cy="18.2" r="1.8" fill="#FFFFFF" />
          </>
        );

      case 'crunchyroll':
        return (
          <>
            <circle cx="20" cy="20" r="11" fill="#F47521" />
            <circle cx="22.4" cy="19.6" r="6.2" fill="#261105" />
            <circle cx="24" cy="18.6" r="2.5" fill="#FFFFFF" />
          </>
        );

      case 'goodshorts':
        return (
          <>
            <rect x="11" y="10" width="18" height="20" rx="4" stroke="#FB7185" strokeWidth="2.2" />
            <polygon points="17.5,15.5 25,20 17.5,24.5" fill="#FBBF24" />
          </>
        );

      case 'capcut':
        return (
          <>
            <path d="M12 14L20 19.5L28 14V18.2L20 23.6L12 18.2V14Z" fill="#FFFFFF" />
            <path d="M12 26L20 20.5L28 26V21.8L20 16.4L12 21.8V26Z" fill="#38BDF8" opacity="0.88" />
          </>
        );

      case 'spotify':
        return (
          <>
            <circle cx="20" cy="20" r="11.5" fill="#1DB954" />
            <path d="M14 17.2C17.8 16 22.6 16.3 26.2 18.2" stroke="#091E10" strokeWidth="2.1" strokeLinecap="round" />
            <path d="M15 20.6C18.1 19.7 21.9 20 24.8 21.5" stroke="#091E10" strokeWidth="1.9" strokeLinecap="round" />
            <path d="M16 23.8C18.4 23.2 21.3 23.4 23.4 24.5" stroke="#091E10" strokeWidth="1.7" strokeLinecap="round" />
          </>
        );

      case 'vpn':
        return (
          <>
            <path d="M20 9L30 13V21C30 26.8 25.8 30.8 20 32.5C14.2 30.8 10 26.8 10 21V13L20 9Z" fill="#2563EB" />
            <path d="M14 23L18.2 17.2L21.5 21.2L24.2 18L27 23H14Z" fill="#FFFFFF" />
          </>
        );

      case 'youtube':
        return (
          <>
            <rect x="8.5" y="12.5" width="23" height="15" rx="4.5" fill="#FF0000" />
            <path d="M17.5 16.5L24.5 20L17.5 23.5V16.5Z" fill="#FFFFFF" />
          </>
        );

      case 'telegram':
        return (
          <>
            <circle cx="20" cy="20" r="12" fill="#26A5E4" />
            <path
              d="M25.6 13.8L12.6 18.9C11.7 19.2 11.7 20 12.5 20.3L15.8 21.3L23.4 16.5C23.8 16.3 24.1 16.4 23.8 16.7L17.6 22.3L17.4 25.5C17.8 25.5 18 25.3 18.3 25L20 23.4L23.5 25.9C24.1 26.3 24.6 26.1 24.8 25.3L26.8 14.9C27 14 26.4 13.5 25.6 13.8Z"
              fill="#FFFFFF"
            />
          </>
        );

      case 'telegram_stars':
        return (
          <>
            <circle cx="20" cy="20" r="12" fill="#26A5E4" />
            <path
              d="M20 11L22.6 16.8L28.8 17.5L24.1 21.7L25.4 27.8L20 24.7L14.6 27.8L15.9 21.7L11.2 17.5L17.4 16.8L20 11Z"
              fill="#FACC15"
            />
          </>
        );

      case 'tiktok':
        return (
          <>
            <path
              d="M22.8 10.5V22.5C22.8 25 20.8 27 18.3 27C16.2 27 14.5 25.3 14.5 23.2C14.5 21 16.4 19.3 18.7 19.5V22.3C17.9 22.1 17.2 22.6 17.2 23.4C17.2 24.1 17.8 24.6 18.5 24.6C19.4 24.6 20 24 20 22.9V10.5H22.8Z"
              fill="#25F4EE"
            />
            <path
              d="M24 11.4V23.4C24 25.9 22 27.9 19.5 27.9C17.4 27.9 15.7 26.2 15.7 24.1C15.7 21.9 17.6 20.2 19.9 20.4V23.2C19.1 23 18.4 23.5 18.4 24.3C18.4 25 19 25.5 19.7 25.5C20.6 25.5 21.2 24.9 21.2 23.8V11.4H24C24.4 13.8 26.1 15.6 28.4 16V18.7C26.4 18.5 24.8 17.4 24 15.8"
              fill="#FE2C55"
            />
            <path
              d="M23.4 11V23C23.4 25.5 21.4 27.5 18.9 27.5C16.8 27.5 15.1 25.8 15.1 23.7C15.1 21.5 17 19.8 19.3 20V22.8C18.5 22.6 17.8 23.1 17.8 23.9C17.8 24.6 18.4 25.1 19.1 25.1C20 25.1 20.6 24.5 20.6 23.4V11H23.4C23.8 13.4 25.5 15.2 27.8 15.6V18.3C25.8 18.1 24.2 17 23.4 15.4"
              fill="#FFFFFF"
            />
          </>
        );

      case 'facebook':
        return (
          <>
            <circle cx="20" cy="20" r="12" fill="#1877F2" />
            <path
              d="M22.2 21.4L22.7 18.2H19.6V16.1C19.6 15.2 20 14.4 21.4 14.4H22.9V11.7C22.9 11.7 21.6 11.4 20.3 11.4C17.7 11.4 16 13 16 15.8V18.2H13.2V21.4H16V29.3H19.6V21.4H22.2Z"
              fill="#FFFFFF"
            />
          </>
        );

      case 'instagram':
        return (
          <>
            <defs>
              <linearGradient id="igBrandGrad" x1="10" y1="30" x2="30" y2="10" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#FCAF45" />
                <stop offset="50%" stopColor="#E1306C" />
                <stop offset="100%" stopColor="#833AB4" />
              </linearGradient>
            </defs>
            <rect x="10.5" y="10.5" width="19" height="19" rx="5.5" stroke="url(#igBrandGrad)" strokeWidth="2.6" />
            <circle cx="20" cy="20" r="4.5" stroke="#FFFFFF" strokeWidth="2.1" />
            <circle cx="25.5" cy="14.5" r="1.4" fill="#FCAF45" />
          </>
        );

      case 'discord':
        return (
          <>
            <rect x="9.5" y="13" width="21" height="14" rx="6" fill="#5865F2" />
            <circle cx="16" cy="20" r="2.1" fill="#FFFFFF" />
            <circle cx="24" cy="20" r="2.1" fill="#FFFFFF" />
          </>
        );

      case 'vip':
        return (
          <>
            <path d="M10 26L12.5 14L17.5 19L20 12L22.5 19L27.5 14L30 26H10Z" fill="#FACC15" />
            <rect x="11" y="27.5" width="18" height="2.6" rx="1.3" fill="#FDE047" />
          </>
        );

      // AI Services
      case 'chatgpt':
        return (
          <>
            <circle cx="20" cy="20" r="12" fill="#10A37F" />
            <g stroke="#FFFFFF" strokeWidth="1.65" fill="none">
              <circle cx="20" cy="15.5" r="3.8" />
              <circle cx="23.9" cy="17.8" r="3.8" />
              <circle cx="23.9" cy="22.2" r="3.8" />
              <circle cx="20" cy="24.5" r="3.8" />
              <circle cx="16.1" cy="22.2" r="3.8" />
              <circle cx="16.1" cy="17.8" r="3.8" />
            </g>
          </>
        );

      case 'gemini':
        return (
          <>
            <defs>
              <linearGradient id="geminiGrad" x1="10" y1="10" x2="30" y2="30" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#4285F4" />
                <stop offset="50%" stopColor="#9B72CB" />
                <stop offset="100%" stopColor="#D96570" />
              </linearGradient>
            </defs>
            <path
              d="M20 8.5C20.5 15.4 24.6 19.5 31.5 20C24.6 20.5 20.5 24.6 20 31.5C19.5 24.6 15.4 20.5 8.5 20C15.4 19.5 19.5 15.4 20 8.5Z"
              fill="url(#geminiGrad)"
            />
          </>
        );

      case 'claude':
        return (
          <>
            <g stroke="#D97757" strokeWidth="2.4" strokeLinecap="round">
              <line x1="20" y1="9.5" x2="20" y2="30.5" />
              <line x1="9.5" y1="20" x2="30.5" y2="20" />
              <line x1="12.5" y1="12.5" x2="27.5" y2="27.5" />
              <line x1="27.5" y1="12.5" x2="12.5" y2="27.5" />
            </g>
            <circle cx="20" cy="20" r="3.2" fill="#FDBA74" />
          </>
        );

      case 'perplexity':
        return (
          <>
            <path d="M20 9V31M11 15L20 20L29 15M11 25L20 20L29 25" stroke="#20B8CD" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="13" y="13" width="14" height="14" stroke="#67E8F9" strokeWidth="1.6" />
          </>
        );

      case 'grok':
        return (
          <>
            <circle cx="20" cy="20" r="10.5" stroke="#E2E8F0" strokeWidth="2.6" />
            <line x1="11.5" y1="28.5" x2="29" y2="11" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" />
          </>
        );

      case 'grammarly':
        return (
          <>
            <circle cx="20" cy="20" r="11.5" fill="#15C39A" />
            <path d="M25.5 15.5A7 7 0 1 0 26.8 22H21.5" stroke="#FFFFFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </>
        );

      // Design & Software
      case 'canva':
        return (
          <>
            <defs>
              <linearGradient id="canvaGrad" x1="8" y1="8" x2="32" y2="32" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stopColor="#00C4CC" />
                <stop offset="60%" stopColor="#3B82F6" />
                <stop offset="100%" stopColor="#7D2AE8" />
              </linearGradient>
            </defs>
            <circle cx="20" cy="20" r="12.5" fill="url(#canvaGrad)" />
            <path
              d="M24.6 15.8C23.5 14.7 21.8 14.3 20.1 14.7C17 15.4 15 18.6 15.6 21.7C16.1 24.4 18.5 25.9 21.2 25.3C22.8 24.9 24.2 23.7 25 22.3"
              stroke="#FFFFFF"
              strokeWidth="2.8"
              strokeLinecap="round"
            />
          </>
        );

      case 'photoshop':
      case 'illustrator':
      case 'premiere':
      case 'lightroom': {
        const adobeMap: Record<string, { border: string; fg: string; code: string }> = {
          photoshop: { border: '#31A8FF', fg: '#31A8FF', code: 'Ps' },
          illustrator: { border: '#FF9A00', fg: '#FF9A00', code: 'Ai' },
          premiere: { border: '#9999FF', fg: '#9999FF', code: 'Pr' },
          lightroom: { border: '#31A8FF', fg: '#31A8FF', code: 'Lr' },
        };
        const a = adobeMap[key];
        return (
          <>
            <rect x="6" y="6" width="28" height="28" rx="6.5" stroke={a.border} strokeWidth="2.2" />
            <text
              x="20"
              y="24.5"
              textAnchor="middle"
              fill={a.fg}
              fontSize="14.5"
              fontWeight="900"
              fontFamily="Plus Jakarta Sans, sans-serif"
            >
              {a.code}
            </text>
          </>
        );
      }

      case 'adobe':
        return (
          <>
            <rect x="7" y="7" width="26" height="26" rx="6" fill="#FF0000" />
            <path d="M22.5 12H28V28L22.5 12ZM17.5 12H12V28L17.5 12ZM20 18.5L23.5 28H20.8L19.8 25.2H17.5L20 18.5Z" fill="#FFFFFF" />
          </>
        );

      case 'microsoft':
      case 'windows':
        return (
          <>
            <rect x="10.5" y="10.5" width="8.5" height="8.5" rx="1" fill={key === 'windows' ? '#38BDF8' : '#F25022'} />
            <rect x="21" y="10.5" width="8.5" height="8.5" rx="1" fill={key === 'windows' ? '#0EA5E9' : '#7FBA00'} />
            <rect x="10.5" y="21" width="8.5" height="8.5" rx="1" fill={key === 'windows' ? '#0284C7' : '#00A4EF'} />
            <rect x="21" y="21" width="8.5" height="8.5" rx="1" fill={key === 'windows' ? '#0369A1' : '#FFB900'} />
          </>
        );

      case 'office':
        return (
          <path d="M12 13L22.5 9.5L28 11.5V28.5L22.5 30.5L12 27L22.5 28V14L15 16.5V25.5L12 24.5V13Z" fill="#EA3E23" />
        );

      case 'idm':
        return (
          <>
            <circle cx="20" cy="20" r="11" stroke="#38BDF8" strokeWidth="2.4" />
            <path d="M20 12V24M14.5 19.5L20 25L25.5 19.5" stroke="#22C55E" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="14" y1="27.5" x2="26" y2="27.5" stroke="#EF4444" strokeWidth="2.2" strokeLinecap="round" />
          </>
        );

      case 'antivirus':
        return (
          <>
            <path d="M20 8.5L29.5 12.5V20.5C29.5 26 25.4 30.2 20 32C14.6 30.2 10.5 26 10.5 20.5V12.5L20 8.5Z" fill="#10B981" />
            <path d="M15.5 20.2L18.7 23.4L25 16.8" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
          </>
        );

      // Gift Cards
      case 'googleplay':
        return (
          <>
            <path d="M13 10.5L27 20L13 29.5V10.5Z" fill="#00E676" />
            <path d="M13 10.5L21.5 19L24.5 16L13 10.5Z" fill="#00B0FF" />
            <path d="M13 29.5L24.5 24L21.5 21L13 29.5Z" fill="#FF3D00" />
          </>
        );

      case 'apple':
        return (
          <>
            <path
              d="M23.8 20.6C23.8 18.2 25.8 17 25.9 16.9C24.7 15.2 22.9 14.9 22.3 14.9C20.8 14.7 19.3 15.8 18.5 15.8C17.7 15.8 16.5 14.9 15.2 14.9C13.6 15 12 15.9 11.2 17.4C9.4 20.4 10.7 24.9 12.4 27.3C13.3 28.5 14.2 29.9 15.6 29.8C16.9 29.8 17.4 29 18.9 29C20.5 29 20.9 29.8 22.3 29.8C23.7 29.8 24.5 28.5 25.4 27.3C26.4 25.9 26.8 24.5 26.8 24.4C26.7 24.3 23.8 23.2 23.8 20.6Z"
              fill="#FFFFFF"
            />
            <path d="M21.3 13C22 12.1 22.5 10.9 22.3 9.7C21.3 9.7 20 10.4 19.3 11.2C18.7 11.9 18.1 13.1 18.3 14.3C19.4 14.4 20.6 13.8 21.3 13Z" fill="#FFFFFF" />
          </>
        );

      case 'steam':
        return (
          <>
            <circle cx="23.5" cy="15.5" r="5" stroke="#FFFFFF" strokeWidth="2.4" />
            <circle cx="23.5" cy="15.5" r="2.1" fill="#66C0F4" />
            <circle cx="15" cy="25.5" r="4" stroke="#FFFFFF" strokeWidth="2.2" />
            <line x1="17.8" y1="22.8" x2="21.2" y2="18.5" stroke="#66C0F4" strokeWidth="3" strokeLinecap="round" />
          </>
        );

      case 'roblox':
      case 'roblox_card':
        return (
          <g transform="rotate(14 20 20)">
            <rect x="11" y="11" width="18" height="18" rx="2.5" fill={key === 'roblox_card' ? '#FCA5A5' : '#FFFFFF'} />
            <rect x="17" y="17" width="6" height="6" rx="0.8" fill="#151821" />
          </g>
        );

      case 'playstation':
        return (
          <>
            <polygon points="15,12 19,19 11,19" stroke="#FFFFFF" strokeWidth="2" fill="none" />
            <circle cx="25.5" cy="15.5" r="3.3" stroke="#60A5FA" strokeWidth="2" />
            <rect x="22" y="22.5" width="6.5" height="6.5" rx="1" stroke="#FFFFFF" strokeWidth="2" />
            <path d="M12.5 23L17.5 28M17.5 23L12.5 28" stroke="#60A5FA" strokeWidth="2" strokeLinecap="round" />
          </>
        );

      case 'xbox':
        return (
          <>
            <circle cx="20" cy="20" r="11.5" fill="#107C10" />
            <path d="M13 13C17.5 16.5 22.5 23.5 27 27M27 13C22.5 16.5 17.5 23.5 13 27" stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" />
          </>
        );

      case 'razer':
        return (
          <>
            <circle cx="20" cy="20" r="11.5" stroke="#44D62C" strokeWidth="2.4" />
            <path d="M14.5 15.5C17 13.5 20.5 14 20 18.5M25.5 15.5C27 18.5 25 22 21 20.5M18 26.5C15 25 14.5 21.5 18 19.5" stroke="#F59E0B" strokeWidth="2.2" strokeLinecap="round" />
            <circle cx="20" cy="20" r="2.2" fill="#44D62C" />
          </>
        );

      // Free Fire Unique Variant Badges
      case 'freefire':
        return (
          <>
            <path d="M20 7.5L30.5 17.5L20 32.5L9.5 17.5L20 7.5Z" fill="#38BDF8" />
            <path d="M20 11.5L25.8 17.5L20 27L14.2 17.5L20 11.5Z" fill="#E0F2FE" />
            <path d="M20 14L23.5 17.5L20 23.5L16.5 17.5L20 14Z" fill="#FF7A00" />
          </>
        );

      case 'freefire_wm':
        return (
          <>
            <path d="M10 23L12.5 13.5L17.5 17.5L20 10.5L22.5 17.5L27.5 13.5L30 23H10Z" fill="#FBBF24" />
            <path d="M20 24L25 28L20 33L15 28L20 24Z" fill="#38BDF8" />
          </>
        );

      case 'freefire_wlite':
        return (
          <>
            <rect x="9" y="11" width="22" height="18" rx="4" fill="#8B5CF6" stroke="#FDBA74" strokeWidth="2" />
            <path d="M20 14L24.5 19.5L20 25L15.5 19.5L20 14Z" fill="#FDBA74" />
          </>
        );

      case 'freefire_lvl':
        return (
          <>
            <path d="M11 22L20 12L29 22" stroke="#FDE047" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M14 28L20 21.5L26 28" stroke="#FF8500" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
          </>
        );

      case 'freefire_likes':
        return (
          <>
            <path
              d="M20 30C20 30 10.5 23.8 10.5 16.8C10.5 13.4 13.1 11 16.2 11C18.1 11 19.4 12 20 13.3C20.6 12 21.9 11 23.8 11C26.9 11 29.5 13.4 29.5 16.8C29.5 23.8 20 30 20 30Z"
              fill="#FB7185"
            />
            <path d="M20 16.5L23.2 20L20 24.5L16.8 20L20 16.5Z" fill="#FFF1F2" />
          </>
        );

      case 'freefire_indo':
        return (
          <>
            <circle cx="20" cy="20" r="11" fill="#FFFFFF" />
            <path d="M9 20A11 11 0 0 1 31 20H9Z" fill="#DC2626" />
            <path d="M20 14L24.5 20L20 26L15.5 20L20 14Z" fill="#F59E0B" stroke="#172033" strokeWidth="1.2" />
          </>
        );

      case 'pubg':
        return (
          <>
            <rect x="9.5" y="12" width="21" height="16" rx="3.2" stroke="#F2A900" strokeWidth="2.4" />
            <text x="20" y="23.5" textAnchor="middle" fill="#F2A900" fontSize="10.5" fontWeight="900" fontFamily="sans-serif">
              UC
            </text>
          </>
        );

      case 'mlbb':
        return (
          <>
            <path d="M20 8.5L29 13V21.5C29 26.8 24.8 30.8 20 32.2C15.2 30.8 11 26.8 11 21.5V13L20 8.5Z" fill="#1D4ED8" stroke="#38BDF8" strokeWidth="1.8" />
            <path d="M20 13.5L24.5 20L20 26.5L15.5 20L20 13.5Z" fill="#FACC15" />
          </>
        );

      case 'genshin':
        return (
          <>
            <path d="M20 8L23 17L32 20L23 23L20 32L17 23L8 20L17 17L20 8Z" fill="#C4B5FD" />
            <circle cx="20" cy="20" r="3.2" fill="#FFFFFF" />
          </>
        );

      case 'codm':
        return (
          <>
            <circle cx="20" cy="20" r="10.5" stroke="#EAB308" strokeWidth="2.2" />
            <line x1="20" y1="8" x2="20" y2="14" stroke="#EAB308" strokeWidth="2" />
            <line x1="20" y1="26" x2="20" y2="32" stroke="#EAB308" strokeWidth="2" />
            <line x1="8" y1="20" x2="14" y2="20" stroke="#EAB308" strokeWidth="2" />
            <line x1="26" y1="20" x2="32" y2="20" stroke="#EAB308" strokeWidth="2" />
            <text x="20" y="23.5" textAnchor="middle" fill="#FFFFFF" fontSize="10" fontWeight="900" fontFamily="sans-serif">
              CP
            </text>
          </>
        );

      case 'clashroyale':
      case 'coc':
        return (
          <>
            <path d="M10.5 25L12.5 14.5L17.5 19L20 12L22.5 19L27.5 14.5L29.5 25H10.5Z" fill="#FACC15" />
            <circle cx="20" cy="21" r="2.3" fill={key === 'clashroyale' ? '#38BDF8' : '#22C55E'} />
          </>
        );

      case 'efootball':
      case 'eafc':
      case 'dls':
        return (
          <>
            <circle cx="20" cy="20" r="10.5" stroke={meta.accent} strokeWidth="2.3" />
            <polygon points="20,14 24.5,17.2 22.8,22.5 17.2,22.5 15.5,17.2" fill={meta.accent} />
          </>
        );

      case 'valorant':
        return (
          <>
            <path d="M10.5 12L18.5 22.5H13.5L10.5 18.5V12Z" fill="#FF4655" />
            <path d="M29.5 12V18.5L23.5 26.5H18.5L29.5 12Z" fill="#FF4655" />
          </>
        );

      case 'unipin':
        return (
          <>
            <circle cx="20" cy="20" r="11" fill="#F58220" />
            <path d="M21.5 11.5L14.5 21H20L18.5 28.5L25.5 19H20L21.5 11.5Z" fill="#FFFFFF" />
          </>
        );

      case 'airdrop':
        return (
          <>
            <path d="M10.5 17.5C10.5 12.2 14.7 9 20 9C25.3 9 29.5 12.2 29.5 17.5H10.5Z" fill="#FDE047" />
            <line x1="12.5" y1="17.5" x2="17" y2="23" stroke="#E2E8F0" strokeWidth="1.6" />
            <line x1="27.5" y1="17.5" x2="23" y2="23" stroke="#E2E8F0" strokeWidth="1.6" />
            <rect x="15" y="23" width="10" height="7.5" rx="1.5" fill="#F97316" stroke="#FFFFFF" strokeWidth="1.3" />
          </>
        );

      // Other Digital Services
      case 'domain':
        return (
          <>
            <circle cx="20" cy="20" r="10.5" stroke="#60A5FA" strokeWidth="2.1" />
            <ellipse cx="20" cy="20" rx="4.8" ry="10.5" stroke="#93C5FD" strokeWidth="1.6" />
            <line x1="9.5" y1="20" x2="30.5" y2="20" stroke="#93C5FD" strokeWidth="1.6" />
          </>
        );

      case 'hosting':
        return (
          <>
            <rect x="10" y="11" width="20" height="7" rx="2" fill="#38BDF8" />
            <rect x="10" y="21.5" width="20" height="7" rx="2" fill="#0284C7" />
            <circle cx="14" cy="14.5" r="1.2" fill="#FFFFFF" />
            <circle cx="14" cy="25" r="1.2" fill="#22C55E" />
          </>
        );

      case 'ssl':
        return (
          <>
            <path d="M14.5 17V14.5C14.5 11.4 17 9 20 9C23 9 25.5 11.4 25.5 14.5V17" stroke="#34D399" strokeWidth="2.4" />
            <rect x="12" y="17" width="16" height="13" rx="3" fill="#10B981" />
            <circle cx="20" cy="23.5" r="2" fill="#092319" />
          </>
        );

      case 'webdesign':
        return (
          <>
            <rect x="9" y="11" width="22" height="18" rx="3" stroke="#818CF8" strokeWidth="2.1" />
            <line x1="9" y1="16" x2="31" y2="16" stroke="#818CF8" strokeWidth="1.8" />
            <rect x="12" y="19" width="7" height="7" rx="1.2" fill="#818CF8" />
            <rect x="21" y="19" width="7" height="3" rx="1" fill="#C7D2FE" />
            <rect x="21" y="23.5" width="7" height="2.5" rx="1" fill="#C7D2FE" />
          </>
        );

      case 'logodesign':
      case 'design':
        return (
          <>
            <path d="M20 9.5L26.5 21L22.5 29H17.5L13.5 21L20 9.5Z" fill="#E879F9" />
            <line x1="20" y1="9.5" x2="20" y2="19" stroke="#211133" strokeWidth="2" />
            <circle cx="20" cy="20" r="2" fill="#FFFFFF" />
          </>
        );

      case 'bannerdesign':
        return (
          <>
            <rect x="8.5" y="12" width="23" height="16" rx="3" stroke="#FB923C" strokeWidth="2.2" />
            <path d="M11 25L16.5 19L21 23L24 20.5L29 25H11Z" fill="#FB923C" />
            <circle cx="24.5" cy="16.5" r="1.8" fill="#FDE047" />
          </>
        );

      case 'videoediting':
        return (
          <>
            <rect x="9.5" y="13" width="21" height="15" rx="3" fill="#F472B6" />
            <polygon points="17.5,16.8 24.5,20.5 17.5,24.2" fill="#1B112B" />
          </>
        );

      case 'templates':
        return (
          <>
            <rect x="9.5" y="10" width="9.5" height="9.5" rx="2" fill="#FF8500" />
            <rect x="21" y="10" width="9.5" height="9.5" rx="2" fill="#38BDF8" />
            <rect x="9.5" y="21.5" width="21" height="8.5" rx="2" fill="#E2E8F0" />
          </>
        );

      case 'ebook':
        return (
          <>
            <path d="M10 12C14 11 17.5 12 20 14C22.5 12 26 11 30 12V28C26 27 22.5 28 20 30C17.5 28 14 27 10 28V12Z" stroke="#FF8500" strokeWidth="2.2" fill="none" />
            <line x1="20" y1="14" x2="20" y2="30" stroke="#FDBA74" strokeWidth="1.8" />
          </>
        );

      default:
        return (
          <text
            x="20"
            y="24"
            textAnchor="middle"
            fill={meta.accent}
            fontSize={meta.abbr.length > 3 ? '9.5' : meta.abbr.length > 2 ? '11' : '13'}
            fontWeight="900"
            fontFamily="Plus Jakarta Sans, sans-serif"
          >
            {meta.abbr}
          </text>
        );
    }
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-label={meta.label}
      className="shrink-0 rounded-xl shadow-md border border-white/25"
    >
      <rect width="40" height="40" rx="11" fill={meta.bg} />
      {renderGlyph()}
    </svg>
  );
}

/**
 * Generates an unmistakable product-specific ambient decorative SVG composition behind the brand emblem,
 * ensuring that related items (e.g., Free Fire Diamonds vs Weekly Lite vs Level Up vs Profile Likes,
 * Steam vs PlayStation vs Xbox vs Google Play, ChatGPT vs Gemini vs Claude) never share an identical visual.
 */
function ProductSceneAccent({
  product,
  accent,
}: {
  product: Product;
  accent: string;
}) {
  const pid = (product.id || '').toLowerCase();
  const bk = (product.brandKey || '').toLowerCase();

  // Gift card tilted card frame layout
  if (
    product.categoryId === 'cat_giftcards' ||
    ['unipin', 'steam', 'googleplay', 'playstation', 'xbox', 'apple', 'roblox_card', 'razer'].includes(bk)
  ) {
    return (
      <svg viewBox="0 0 320 200" fill="none" className="absolute inset-0 w-full h-full pointer-events-none opacity-45">
        <rect x="28" y="24" width="264" height="152" rx="18" stroke={accent} strokeWidth="1.5" strokeDasharray="6 4" opacity="0.45" />
        <rect x="44" y="42" width="38" height="26" rx="5" stroke="#FFFFFF" strokeWidth="1.2" opacity="0.35" />
        <line x1="44" y1="55" x2="82" y2="55" stroke="#FFFFFF" strokeWidth="1" opacity="0.25" />
        <circle cx="272" cy="146" r="52" fill={accent} opacity="0.16" />
        <path d="M22 152L110 24" stroke="#FFFFFF" strokeWidth="18" opacity="0.06" />
      </svg>
    );
  }

  // Free Fire per-product battle patterns
  if (pid === 'prod_ff_bd_diamonds' || bk === 'freefire') {
    return (
      <svg viewBox="0 0 320 200" fill="none" className="absolute inset-0 w-full h-full pointer-events-none opacity-45">
        <polygon points="56,30 78,56 56,88 34,56" stroke="#38BDF8" strokeWidth="1.5" fill="#38BDF8" fillOpacity="0.14" />
        <polygon points="270,40 292,68 270,100 248,68" stroke="#FF8500" strokeWidth="1.5" fill="#FF8500" fillOpacity="0.18" />
        <line x1="0" y1="170" x2="320" y2="30" stroke={accent} strokeWidth="1" opacity="0.22" />
      </svg>
    );
  }
  if (pid === 'prod_ff_weekly_monthly' || bk === 'freefire_wm') {
    return (
      <svg viewBox="0 0 320 200" fill="none" className="absolute inset-0 w-full h-full pointer-events-none opacity-45">
        <rect x="24" y="28" width="90" height="44" rx="10" stroke="#FBBF24" strokeWidth="1.4" opacity="0.4" />
        <rect x="206" y="128" width="90" height="44" rx="10" stroke="#FBBF24" strokeWidth="1.4" opacity="0.4" />
        <circle cx="160" cy="100" r="78" stroke="#FBBF24" strokeWidth="1" strokeDasharray="4 6" opacity="0.35" />
      </svg>
    );
  }
  if (pid === 'prod_ff_level_evo' || bk === 'freefire_lvl') {
    return (
      <svg viewBox="0 0 320 200" fill="none" className="absolute inset-0 w-full h-full pointer-events-none opacity-45">
        <path d="M24 140L64 100L104 140" stroke="#FDE047" strokeWidth="3" opacity="0.3" />
        <path d="M216 100L256 60L296 100" stroke="#FF8500" strokeWidth="3" opacity="0.35" />
        <path d="M216 132L256 92L296 132" stroke="#FDE047" strokeWidth="2" opacity="0.25" />
      </svg>
    );
  }
  if (pid === 'prod_ff_likes' || bk === 'freefire_likes') {
    return (
      <svg viewBox="0 0 320 200" fill="none" className="absolute inset-0 w-full h-full pointer-events-none opacity-45">
        <circle cx="62" cy="54" r="32" fill="#FB7185" opacity="0.2" />
        <circle cx="264" cy="144" r="40" fill="#FB7185" opacity="0.16" />
        <path d="M40 160H280" stroke="#FB7185" strokeWidth="1" strokeDasharray="3 5" opacity="0.35" />
      </svg>
    );
  }

  // AI Neural grid
  if (product.categoryId === 'cat_ai') {
    return (
      <svg viewBox="0 0 320 200" fill="none" className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
        <circle cx="60" cy="48" r="4" fill={accent} />
        <circle cx="260" cy="54" r="4" fill={accent} />
        <circle cx="250" cy="154" r="5" fill={accent} />
        <circle cx="70" cy="148" r="3.5" fill={accent} />
        <line x1="60" y1="48" x2="160" y2="100" stroke={accent} strokeWidth="1" opacity="0.5" />
        <line x1="260" y1="54" x2="160" y2="100" stroke={accent} strokeWidth="1" opacity="0.5" />
        <line x1="250" y1="154" x2="160" y2="100" stroke={accent} strokeWidth="1" opacity="0.5" />
        <line x1="70" y1="148" x2="160" y2="100" stroke={accent} strokeWidth="1" opacity="0.5" />
      </svg>
    );
  }

  // OTT Cinema & Media timeline
  if (product.categoryId === 'cat_streaming' || bk === 'capcut' || bk === 'youtube') {
    return (
      <svg viewBox="0 0 320 200" fill="none" className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
        <rect x="20" y="20" width="280" height="160" rx="14" stroke="#FFFFFF" strokeWidth="1" opacity="0.16" />
        <line x1="36" y1="170" x2="284" y2="170" stroke="#FFFFFF" strokeWidth="2.5" opacity="0.2" />
        <line x1="36" y1="170" x2="196" y2="170" stroke={accent} strokeWidth="3" opacity="0.85" />
        <circle cx="196" cy="170" r="4.5" fill={accent} />
      </svg>
    );
  }

  // Deterministic geometric pattern seeded by product.id
  let seed = 0;
  for (let i = 0; i < pid.length; i++) seed = (seed * 17 + pid.charCodeAt(i)) % 100;
  const cx1 = 36 + (seed % 45);
  const cx2 = 240 + (seed % 50);

  return (
    <svg viewBox="0 0 320 200" fill="none" className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
      <circle cx={cx1} cy={46 + (seed % 30)} r="36" stroke={accent} strokeWidth="1.2" opacity="0.3" />
      <circle cx={cx2} cy={145 - (seed % 30)} r="46" fill={accent} opacity="0.12" />
      <path d={`M0 ${160 - (seed % 40)} L320 ${40 + (seed % 40)}`} stroke="#FFFFFF" strokeWidth="1" opacity="0.1" />
    </svg>
  );
}

/**
 * Unique visual stage rendered inside every ProductCard and Product Detail Page.
 * Renders vivid, full-contrast custom or curated studio artwork alongside the product's
 * authentic local brand SVG logo and unique geometric frame motif—zero washed-out placeholders.
 */
export function ProductVisualArtwork({
  product,
  lang,
  variant = 'card',
}: {
  product: Product;
  lang: Language;
  variant?: 'card' | 'hero' | 'banner';
}) {
  const bk = (product.brandKey || '').toLowerCase();
  const meta = BRAND_META[bk];
  const imgSrc =
    variant === 'banner'
      ? resolveProductBanner(product.bannerUrl, product.imageUrl, product.categoryId, product.brandKey, product.id)
      : resolveStudioImage(product.imageUrl, product.categoryId, product.brandKey, product.id);
  const isGeneratedProductCard = variant !== 'banner' && imgSrc.startsWith('/assets/products/');
  const hasCustomImage =
    variant === 'banner'
      ? isCustomUploadedProductImage(product.bannerUrl)
      : isCustomUploadedProductImage(product.imageUrl);
  const title = lang === 'bn' ? product.titleBn : product.titleEn;
  const subLabel =
    (lang === 'bn' ? product.subcategoryBn : product.subcategoryEn) || meta?.sublabel || 'DIGITAL HUB';

  if (hasCustomImage) {
    return (
      <div className="relative w-full h-full overflow-hidden bg-[#172033]">
        <img
          src={imgSrc}
          alt={title}
          referrerPolicy="no-referrer"
          onError={(e) => {
            e.currentTarget.src = STUDIO_IMAGES.hero;
          }}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
        />
        {!isGeneratedProductCard && (
          <div className="absolute inset-0 bg-gradient-to-t from-[#0F172A]/85 via-[#0F172A]/25 to-transparent pointer-events-none" />
        )}
        {!isGeneratedProductCard && (product.brandKey || product.customLogoUrl) && variant !== 'banner' && (
          <div className="absolute top-2.5 left-2.5 drop-shadow-lg">
            <ServiceBrandLogo
              brandKey={product.brandKey}
              customLogoUrl={product.customLogoUrl}
              size={variant === 'hero' ? 48 : 36}
            />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none"
      style={{
        background: meta
          ? `linear-gradient(135deg, ${meta.bg} 0%, ${meta.bgEnd} 100%)`
          : 'linear-gradient(135deg, #172033 0%, #23314d 100%)',
      }}
    >
      <img
        src={imgSrc}
        alt={title}
        referrerPolicy="no-referrer"
        onError={(e) => {
          e.currentTarget.src = STUDIO_IMAGES.hero;
        }}
        className="w-full h-full object-cover opacity-75 group-hover:scale-105 transition-transform duration-300"
        loading="lazy"
      />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: meta
            ? `radial-gradient(circle at 22% 30%, ${meta.accent}35 0%, transparent 62%), linear-gradient(180deg, rgba(15,23,42,0.18) 0%, ${meta.bg}D8 72%, ${meta.bg}F5 100%)`
            : 'linear-gradient(180deg, rgba(15,23,42,0.22) 0%, rgba(23,32,51,0.92) 100%)',
        }}
      />

      <ProductSceneAccent product={product} accent={meta?.accent || '#FF8500'} />

      {variant === 'banner' ? (
        <div className="relative z-10 w-full h-full flex items-end justify-between p-4 sm:p-6">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="shrink-0 drop-shadow-xl">
              <ServiceBrandLogo
                brandKey={product.brandKey}
                customLogoUrl={product.customLogoUrl}
                size={62}
              />
            </div>
            <div className="min-w-0">
              <p
                className="text-[11px] font-extrabold uppercase tracking-wider truncate"
                style={{ color: meta?.accent || '#FF9B19' }}
              >
                {subLabel}
              </p>
              <p className="text-lg sm:text-2xl font-extrabold text-white tracking-tight truncate drop-shadow-sm">
                {title}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="relative z-10 w-full h-full flex flex-col justify-between p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="transform group-hover:scale-105 transition-transform duration-200 drop-shadow-lg">
              <ServiceBrandLogo
                brandKey={product.brandKey}
                customLogoUrl={product.customLogoUrl}
                size={variant === 'hero' ? 68 : 42}
              />
            </div>
          </div>

          <div className="text-left">
            <p
              className={`font-extrabold tracking-wide uppercase truncate drop-shadow-sm ${
                variant === 'hero' ? 'text-xs' : 'text-[10px]'
              }`}
              style={{ color: meta?.accent || '#FF9B19' }}
            >
              {subLabel}
            </p>
            <p
              className={`font-extrabold text-white tracking-tight leading-tight truncate drop-shadow-sm ${
                variant === 'hero' ? 'text-xl sm:text-2xl mt-0.5' : 'text-xs sm:text-sm'
              }`}
            >
              {meta ? meta.label : title}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
