import heroImg from '../assets/images/hero_digital_hub_1794694293792.jpg';
import telegramImg from '../assets/images/cat_telegram_services_1794694294575.jpg';
import subscriptionsImg from '../assets/images/cat_digital_subscriptions_1794694294678.jpg';
import designImg from '../assets/images/cat_graphic_design_1794694295278.jpg';
import socialImg from '../assets/images/cat_social_media_1794694294911.jpg';
import bannerVipImg from '../assets/images/banner_promo_vip_1794694295674.jpg';
import gameBattleImg from '../assets/images/game_battle_royale_1794696842906.jpg';
import giftVoucherImg from '../assets/images/game_gift_vouchers_1794696843083.jpg';
import streamingImg from '../assets/images/streaming_entertainment_pass_1794696843520.jpg';
import aiSuiteImg from '../assets/images/ai_creator_suite_1794696843958.jpg';
import artPubgTacticalImg from '../assets/images/art_pubg_tactical_1794698334309.jpg';
import artFootballStadiumImg from '../assets/images/art_football_stadium_1794698333992.jpg';
import artClashFantasyImg from '../assets/images/art_clash_fantasy_1794698335867.jpg';
import artWebCloudHostingImg from '../assets/images/art_web_cloud_hosting_1794698335147.jpg';
import artAdobeCreativeStudioImg from '../assets/images/art_adobe_creative_studio_1794698335228.jpg';
import ffDiamondsVaultImg from '../assets/images/ff_diamonds_vault_1794733165784.jpg';
import ffMembershipPassImg from '../assets/images/ff_membership_pass_1794733165209.jpg';
import gamingMobaValorantImg from '../assets/images/gaming_moba_valorant_1794733167006.jpg';
import giftCardsPremiumImg from '../assets/images/gift_cards_premium_1794733167051.jpg';
import ottBanglaCinemaImg from '../assets/images/ott_bangla_cinema_1794733166953.jpg';
import aiNeuralHologramImg from '../assets/images/ai_neural_hologram_1794733166943.jpg';
import softwareWindowsOfficeImg from '../assets/images/software_windows_office_1794733168151.jpg';
import telegramStarsVipImg from '../assets/images/telegram_stars_vip_1794733169136.jpg';

export const STUDIO_IMAGES = {
  hero: heroImg,
  telegram: telegramImg,
  telegramStarsVip: telegramStarsVipImg,
  subscriptions: subscriptionsImg,
  design: designImg,
  social: socialImg,
  bannerVip: bannerVipImg,
  gameBattle: gameBattleImg,
  ffDiamondsVault: ffDiamondsVaultImg,
  ffMembershipPass: ffMembershipPassImg,
  gamingMobaValorant: gamingMobaValorantImg,
  giftVouchers: giftVoucherImg,
  giftCardsPremium: giftCardsPremiumImg,
  streaming: streamingImg,
  ottBanglaCinema: ottBanglaCinemaImg,
  aiSuite: aiSuiteImg,
  aiNeuralHologram: aiNeuralHologramImg,
  softwareWindowsOffice: softwareWindowsOfficeImg,
  artPubgTactical: artPubgTacticalImg,
  artFootballStadium: artFootballStadiumImg,
  artClashFantasy: artClashFantasyImg,
  artWebCloudHosting: artWebCloudHostingImg,
  artAdobeCreativeStudio: artAdobeCreativeStudioImg,
} as const;

const LEGACY_PATH_MAP: Record<string, string> = {
  '/src/assets/images/hero_digital_hub_1794694293792.jpg': heroImg,
  '/src/assets/images/cat_telegram_services_1794694294575.jpg': telegramImg,
  '/src/assets/images/cat_digital_subscriptions_1794694294678.jpg': subscriptionsImg,
  '/src/assets/images/cat_graphic_design_1794694295278.jpg': designImg,
  '/src/assets/images/cat_social_media_1794694294911.jpg': socialImg,
  '/src/assets/images/banner_promo_vip_1794694295674.jpg': bannerVipImg,
  '/src/assets/images/game_battle_royale_1794696842906.jpg': gameBattleImg,
  '/src/assets/images/game_gift_vouchers_1794696843083.jpg': giftVoucherImg,
  '/src/assets/images/streaming_entertainment_pass_1794696843520.jpg': streamingImg,
  '/src/assets/images/ai_creator_suite_1794696843958.jpg': aiSuiteImg,
  '/src/assets/images/art_pubg_tactical_1794698334309.jpg': artPubgTacticalImg,
  '/src/assets/images/art_football_stadium_1794698333992.jpg': artFootballStadiumImg,
  '/src/assets/images/art_clash_fantasy_1794698335867.jpg': artClashFantasyImg,
  '/src/assets/images/art_web_cloud_hosting_1794698335147.jpg': artWebCloudHostingImg,
  '/src/assets/images/art_adobe_creative_studio_1794698335228.jpg': artAdobeCreativeStudioImg,
  '/src/assets/images/ff_diamonds_vault_1794733165784.jpg': ffDiamondsVaultImg,
  '/src/assets/images/ff_membership_pass_1794733165209.jpg': ffMembershipPassImg,
  '/src/assets/images/gaming_moba_valorant_1794733167006.jpg': gamingMobaValorantImg,
  '/src/assets/images/gift_cards_premium_1794733167051.jpg': giftCardsPremiumImg,
  '/src/assets/images/ott_bangla_cinema_1794733166953.jpg': ottBanglaCinemaImg,
  '/src/assets/images/ai_neural_hologram_1794733166943.jpg': aiNeuralHologramImg,
  '/src/assets/images/software_windows_office_1794733168151.jpg': softwareWindowsOfficeImg,
  '/src/assets/images/telegram_stars_vip_1794733169136.jpg': telegramStarsVipImg,
};

const STUDIO_BUNDLE_SET = new Set<string>([
  heroImg,
  telegramImg,
  telegramStarsVipImg,
  subscriptionsImg,
  designImg,
  socialImg,
  bannerVipImg,
  gameBattleImg,
  ffDiamondsVaultImg,
  ffMembershipPassImg,
  gamingMobaValorantImg,
  giftVoucherImg,
  giftCardsPremiumImg,
  streamingImg,
  ottBanglaCinemaImg,
  aiSuiteImg,
  aiNeuralHologramImg,
  softwareWindowsOfficeImg,
  artPubgTacticalImg,
  artFootballStadiumImg,
  artClashFantasyImg,
  artWebCloudHostingImg,
  artAdobeCreativeStudioImg,
  ...Object.keys(LEGACY_PATH_MAP),
]);

export function isCustomUploadedProductImage(url?: string): boolean {
  if (!url) return false;
  if (STUDIO_BUNDLE_SET.has(url)) return false;
  return url.startsWith('data:') || url.startsWith('https://') || url.startsWith('/assets/');
}

export function resolveStudioImage(
  url?: string,
  categoryId?: string,
  brandKey?: string,
  productId?: string
): string {
  if (url && isCustomUploadedProductImage(url)) {
    return url;
  }

  const pid = (productId || '').toLowerCase();
  const bk = (brandKey || '').toLowerCase();

  // Specific Free Fire sub-products get distinct artwork
  if (pid === 'prod_ff_bd_diamonds' || bk === 'freefire') return ffDiamondsVaultImg;
  if (pid === 'prod_ff_weekly_monthly' || pid === 'prod_ff_weekly_lite' || bk === 'freefire_wm' || bk === 'freefire_wlite') {
    return ffMembershipPassImg;
  }
  if (pid === 'prod_ff_level_evo' || pid === 'prod_ff_likes' || pid === 'prod_ff_indo' || bk === 'freefire_lvl' || bk === 'freefire_likes' || bk === 'freefire_indo') {
    return gameBattleImg;
  }

  if (bk === 'pubg' || bk === 'codm' || bk === 'airdrop') return artPubgTacticalImg;
  if (bk === 'mlbb' || bk === 'valorant' || bk === 'genshin' || bk === 'roblox') return gamingMobaValorantImg;
  if (bk === 'efootball' || bk === 'eafc' || bk === 'dls') return artFootballStadiumImg;
  if (bk === 'coc' || bk === 'clashroyale') return artClashFantasyImg;
  if (['domain', 'hosting', 'ssl', 'webdesign', 'antivirus', 'idm'].includes(bk)) return artWebCloudHostingImg;
  if (['photoshop', 'illustrator', 'premiere', 'lightroom', 'adobe', 'videoediting', 'canva'].includes(bk)) {
    return artAdobeCreativeStudioImg;
  }
  if (['chorki', 'goodshorts', 'crunchyroll'].includes(bk)) return ottBanglaCinemaImg;
  if (['netflix', 'primevideo', 'spotify', 'youtube', 'capcut', 'vpn'].includes(bk)) return streamingImg;
  if (['chatgpt', 'gemini', 'claude'].includes(bk)) return aiNeuralHologramImg;
  if (['perplexity', 'grok', 'grammarly'].includes(bk)) return aiSuiteImg;
  if (bk === 'telegram_stars') return telegramStarsVipImg;
  if (bk === 'telegram') return telegramImg;
  if (bk === 'vip') return bannerVipImg;
  if (['facebook', 'tiktok', 'instagram', 'discord'].includes(bk)) return socialImg;
  if (['googleplay', 'apple', 'steam', 'playstation'].includes(bk)) return giftCardsPremiumImg;
  if (['roblox_card', 'xbox', 'razer', 'unipin'].includes(bk)) return giftVoucherImg;
  if (['logodesign', 'bannerdesign', 'templates', 'design', 'ebook'].includes(bk)) return designImg;
  if (['windows', 'office', 'microsoft'].includes(bk)) return softwareWindowsOfficeImg;

  if (url) {
    if (LEGACY_PATH_MAP[url]) return LEGACY_PATH_MAP[url];
    if (STUDIO_BUNDLE_SET.has(url)) return url;
  }

  switch (categoryId) {
    case 'cat_gaming':
      return ffDiamondsVaultImg;
    case 'cat_giftcards':
      return giftCardsPremiumImg;
    case 'cat_streaming':
      return streamingImg;
    case 'cat_ai':
      return aiNeuralHologramImg;
    case 'cat_software':
      return softwareWindowsOfficeImg;
    case 'cat_telegram':
      return telegramImg;
    case 'cat_vip':
      return bannerVipImg;
    case 'cat_social':
      return socialImg;
    case 'cat_design':
      return designImg;
    case 'cat_digital':
      return artWebCloudHostingImg;
    default:
      return heroImg;
  }
}

export function resolveProductBanner(
  bannerUrl?: string,
  imageUrl?: string,
  categoryId?: string,
  brandKey?: string,
  productId?: string
): string {
  if (bannerUrl && isCustomUploadedProductImage(bannerUrl)) {
    return bannerUrl;
  }
  const bk = (brandKey || '').toLowerCase();
  if (bk === 'freefire') return ffMembershipPassImg;
  if (bk === 'freefire_wm' || bk === 'freefire_wlite') return ffDiamondsVaultImg;
  if (bk === 'telegram') return telegramStarsVipImg;
  if (bk === 'telegram_stars') return telegramImg;
  if (bk === 'netflix' || bk === 'primevideo') return ottBanglaCinemaImg;
  if (bk === 'chorki' || bk === 'crunchyroll' || bk === 'goodshorts') return streamingImg;
  if (bk === 'chatgpt' || bk === 'gemini' || bk === 'claude') return aiSuiteImg;
  if (bk === 'perplexity' || bk === 'grok' || bk === 'grammarly') return aiNeuralHologramImg;
  if (['googleplay', 'apple', 'steam', 'playstation'].includes(bk)) return giftVoucherImg;
  if (['roblox_card', 'xbox', 'razer', 'unipin'].includes(bk)) return giftCardsPremiumImg;
  return resolveStudioImage(imageUrl, categoryId, brandKey, productId);
}
