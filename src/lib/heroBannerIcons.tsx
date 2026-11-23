import {
  Award,
  Crown,
  Flame,
  Gamepad2,
  Gift,
  LucideIcon,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Star,
  Tv,
  Zap,
} from 'lucide-react';
import type { HeroBannerIconName } from '../types/marketplace';

export const HERO_BANNER_ICON_OPTIONS: Array<{
  id: HeroBannerIconName;
  labelEn: string;
  labelBn: string;
  Icon: LucideIcon;
}> = [
  { id: 'sparkles', labelEn: 'Sparkles', labelBn: 'স্পার্কলস', Icon: Sparkles },
  { id: 'gamepad', labelEn: 'Gaming', labelBn: 'গেমিং', Icon: Gamepad2 },
  { id: 'gift', labelEn: 'Gift', labelBn: 'গিফট', Icon: Gift },
  { id: 'flame', labelEn: 'Hot Deal', labelBn: 'হট ডিল', Icon: Flame },
  { id: 'zap', labelEn: 'Instant', labelBn: 'ইনস্ট্যান্ট', Icon: Zap },
  { id: 'crown', labelEn: 'VIP / Pro', labelBn: 'ভিআইপি', Icon: Crown },
  { id: 'tv', labelEn: 'Streaming', labelBn: 'স্ট্রিমিং', Icon: Tv },
  { id: 'star', labelEn: 'Featured', labelBn: 'ফিচার্ড', Icon: Star },
  { id: 'shopping', labelEn: 'Store', labelBn: 'স্টোর', Icon: ShoppingBag },
  { id: 'shield', labelEn: 'Verified', labelBn: 'ভেরিফায়েড', Icon: ShieldCheck },
  { id: 'smartphone', labelEn: 'Apps', labelBn: 'অ্যাপস', Icon: Smartphone },
  { id: 'award', labelEn: 'Reward', labelBn: 'রিওয়ার্ড', Icon: Award },
];

const ICON_MAP = new Map<HeroBannerIconName, LucideIcon>(
  HERO_BANNER_ICON_OPTIONS.map((item) => [item.id, item.Icon])
);

export function HeroBannerIconBadge({
  name,
  className = 'w-4 h-4',
}: {
  name?: HeroBannerIconName;
  className?: string;
}) {
  const IconComp = ICON_MAP.get(name || 'sparkles') || Sparkles;
  return <IconComp className={className} />;
}
