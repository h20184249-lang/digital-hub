import { Award, Code2, Crown, LucideIcon, ShieldCheck } from 'lucide-react';
import type { DeveloperProfile, DeveloperRank } from '../types/marketplace';

export interface DeveloperRankMeta {
  rank: DeveloperRank;
  tierLevel: number;
  labelEn: string;
  labelBn: string;
  shortLabel: string;
  defaultTitle: string;
  defaultTitleBn: string;
  Icon: LucideIcon;
  // Visual theme tokens (deep navy/charcoal developer aesthetic)
  cardSurfaceClass: string;
  cardBorderClass: string;
  topAccentBarClass: string;
  avatarRingClass: string;
  avatarBgClass: string;
  badgeClass: string;
  titleTextClass: string;
  rankDotClass: string;
  selectorActiveClass: string;
}

export const DEVELOPER_RANK_ORDER: DeveloperRank[] = ['gold', 'silver', 'blue', 'verified'];

export const DEVELOPER_RANK_PRIORITY: Record<DeveloperRank, number> = {
  gold: 4,
  silver: 3,
  blue: 2,
  verified: 1,
};

export const DEVELOPER_RANK_META: Record<DeveloperRank, DeveloperRankMeta> = {
  gold: {
    rank: 'gold',
    tierLevel: 4,
    labelEn: 'Gold Rank',
    labelBn: 'গোল্ড র‍্যাংক',
    shortLabel: 'GOLD',
    defaultTitle: 'Lead Developer / Team Leader',
    defaultTitleBn: 'লিড ডেভেলপার / টিম লিডার',
    Icon: Crown,
    cardSurfaceClass:
      'bg-gradient-to-b from-[#171E31] via-[#111829] to-[#0C111E] shadow-[0_14px_38px_-14px_rgba(245,158,11,0.42)]',
    cardBorderClass: 'border border-amber-400/60 hover:border-amber-300/90',
    topAccentBarClass: 'bg-gradient-to-r from-transparent via-amber-400 to-transparent',
    avatarRingClass:
      'ring-2 ring-amber-400 ring-offset-2 ring-offset-[#111829] shadow-[0_0_20px_rgba(251,191,36,0.35)]',
    avatarBgClass: 'bg-amber-950/60 text-amber-200',
    badgeClass:
      'bg-gradient-to-r from-amber-600 via-amber-500 to-yellow-500 text-slate-950 border border-amber-200/70 shadow-[0_0_14px_rgba(245,158,11,0.4)]',
    titleTextClass: 'text-amber-300',
    rankDotClass: 'bg-amber-400',
    selectorActiveClass:
      'bg-gradient-to-br from-amber-500/20 to-amber-600/10 border-amber-400 text-amber-300 shadow-[0_0_16px_rgba(245,158,11,0.2)]',
  },
  silver: {
    rank: 'silver',
    tierLevel: 3,
    labelEn: 'Silver Rank',
    labelBn: 'সিলভার র‍্যাংক',
    shortLabel: 'SILVER',
    defaultTitle: 'Senior Developer / Specialist',
    defaultTitleBn: 'সিনিয়র ডেভেলপার / স্পেশালিস্ট',
    Icon: Award,
    cardSurfaceClass:
      'bg-gradient-to-b from-[#151D2E] via-[#101726] to-[#0C121E] shadow-[0_12px_32px_-14px_rgba(203,213,225,0.28)]',
    cardBorderClass: 'border border-slate-300/50 hover:border-slate-200/80',
    topAccentBarClass: 'bg-gradient-to-r from-transparent via-slate-300 to-transparent',
    avatarRingClass:
      'ring-2 ring-slate-300/90 ring-offset-2 ring-offset-[#101726] shadow-[0_0_16px_rgba(226,232,240,0.24)]',
    avatarBgClass: 'bg-slate-800 text-slate-200',
    badgeClass:
      'bg-gradient-to-r from-slate-400 via-slate-200 to-slate-300 text-slate-900 border border-white/60 shadow-[0_0_12px_rgba(226,232,240,0.25)]',
    titleTextClass: 'text-slate-200',
    rankDotClass: 'bg-slate-300',
    selectorActiveClass:
      'bg-gradient-to-br from-slate-300/20 to-slate-400/10 border-slate-300 text-slate-100 shadow-[0_0_14px_rgba(203,213,225,0.18)]',
  },
  blue: {
    rank: 'blue',
    tierLevel: 2,
    labelEn: 'Blue Rank',
    labelBn: 'ব্লু র‍্যাংক',
    shortLabel: 'BLUE',
    defaultTitle: 'Junior Developer / Developer',
    defaultTitleBn: 'জুনিয়র ডেভেলপার / ডেভেলপার',
    Icon: Code2,
    cardSurfaceClass:
      'bg-gradient-to-b from-[#111B30] via-[#0E1627] to-[#0B111E] shadow-[0_10px_28px_-14px_rgba(56,189,248,0.32)]',
    cardBorderClass: 'border border-sky-400/50 hover:border-sky-400/85',
    topAccentBarClass: 'bg-gradient-to-r from-transparent via-sky-400 to-transparent',
    avatarRingClass:
      'ring-2 ring-sky-400/90 ring-offset-2 ring-offset-[#0E1627] shadow-[0_0_14px_rgba(56,189,248,0.28)]',
    avatarBgClass: 'bg-sky-950/60 text-sky-200',
    badgeClass:
      'bg-gradient-to-r from-blue-600 to-sky-500 text-white border border-sky-300/50 shadow-[0_0_12px_rgba(56,189,248,0.3)]',
    titleTextClass: 'text-sky-300',
    rankDotClass: 'bg-sky-400',
    selectorActiveClass:
      'bg-gradient-to-br from-sky-500/20 to-blue-600/10 border-sky-400 text-sky-300 shadow-[0_0_14px_rgba(56,189,248,0.2)]',
  },
  verified: {
    rank: 'verified',
    tierLevel: 1,
    labelEn: 'Verified Developer',
    labelBn: 'ভেরিফায়েড ডেভেলপার',
    shortLabel: 'VERIFIED',
    defaultTitle: 'Developer',
    defaultTitleBn: 'ডেভেলপার',
    Icon: ShieldCheck,
    cardSurfaceClass: 'bg-[#101624]',
    cardBorderClass: 'border border-slate-700/80 hover:border-slate-500/80',
    topAccentBarClass: 'bg-gradient-to-r from-transparent via-slate-500/50 to-transparent',
    avatarRingClass: 'ring-1 ring-slate-500/70 ring-offset-2 ring-offset-[#101624]',
    avatarBgClass: 'bg-slate-800 text-slate-300',
    badgeClass: 'bg-slate-800/95 text-slate-200 border border-slate-600/90',
    titleTextClass: 'text-slate-300',
    rankDotClass: 'bg-slate-400',
    selectorActiveClass:
      'bg-slate-800/90 border-slate-400 text-slate-100',
  },
};

export function normalizeDeveloperRank(raw: unknown): DeveloperRank {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'gold' || s === 'silver' || s === 'blue' || s === 'verified') return s;
  return 'verified';
}

export function isDefaultRankTitle(title: string): boolean {
  const clean = title.trim().toLowerCase();
  if (!clean) return true;
  return Object.values(DEVELOPER_RANK_META).some(
    (m) => m.defaultTitle.toLowerCase() === clean || m.defaultTitleBn.toLowerCase() === clean
  );
}

export function sortDevelopersByRank(list: DeveloperProfile[]): DeveloperProfile[] {
  return [...list].sort((a, b) => {
    const rankDiff =
      (DEVELOPER_RANK_PRIORITY[normalizeDeveloperRank(b.rank)] || 1) -
      (DEVELOPER_RANK_PRIORITY[normalizeDeveloperRank(a.rank)] || 1);
    if (rankDiff !== 0) return rankDiff;
    const orderDiff = (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
    if (orderDiff !== 0) return orderDiff;
    return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
  });
}
