import { ReactNode, useEffect, useState } from 'react';
import {
  BadgeCheck,
  Code2,
  ExternalLink,
  Github,
  Globe,
  Linkedin,
  Send,
  Shield,
  Terminal,
  Users,
} from 'lucide-react';
import { DeveloperProfile, DeveloperSocialLinks, Language } from '../types/marketplace';
import { subscribeDevelopers } from '../lib/firestoreService';
import {
  DEVELOPER_RANK_META,
  DEVELOPER_RANK_ORDER,
  normalizeDeveloperRank,
  sortDevelopersByRank,
} from '../lib/developerRankTheme';

interface DeveloperProfileCardProps {
  developer: DeveloperProfile;
  lang: Language;
  preview?: boolean;
}

const SOCIAL_ITEMS: Array<{
  key: keyof DeveloperSocialLinks;
  label: string;
  renderIcon: () => ReactNode;
}> = [
  {
    key: 'github',
    label: 'GitHub',
    renderIcon: () => <Github className="w-3.5 h-3.5" />,
  },
  {
    key: 'portfolio',
    label: 'Portfolio',
    renderIcon: () => <Globe className="w-3.5 h-3.5" />,
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    renderIcon: () => <Linkedin className="w-3.5 h-3.5" />,
  },
  {
    key: 'telegram',
    label: 'Telegram',
    renderIcon: () => <Send className="w-3.5 h-3.5" />,
  },
  {
    key: 'facebook',
    label: 'Facebook',
    renderIcon: () => <ExternalLink className="w-3.5 h-3.5" />,
  },
  {
    key: 'x',
    label: 'X / Twitter',
    renderIcon: () => <Terminal className="w-3.5 h-3.5" />,
  },
];

function getInitials(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'DH';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

export function DeveloperProfileCard({ developer, lang, preview = false }: DeveloperProfileCardProps) {
  const rank = normalizeDeveloperRank(developer.rank);
  const meta = DEVELOPER_RANK_META[rank];
  const RankIcon = meta.Icon;
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
  }, [developer.photoUrl]);

  const hasPhoto = Boolean(developer.photoUrl && developer.photoUrl.trim()) && !imgError;
  const displayName = (developer.name || '').trim() || (lang === 'bn' ? 'ডেভেলপার নাম' : 'Developer Name');
  const displayTitle =
    (developer.title || '').trim() || (lang === 'bn' ? meta.defaultTitleBn : meta.defaultTitle);
  const displayBio = (developer.bio || '').trim();

  const activeSocials = SOCIAL_ITEMS.filter((item) => {
    const url = developer.socialLinks?.[item.key];
    return typeof url === 'string' && /^https?:\/\/[^\s]+$/i.test(url.trim());
  });

  return (
    <article
      className={`relative overflow-hidden rounded-2xl p-5 flex flex-col justify-between motion-safe:transition-all motion-safe:duration-300 motion-safe:hover:-translate-y-0.5 ${meta.cardSurfaceClass} ${meta.cardBorderClass}`}
    >
      {/* Top Rank Accent Shimmer Line */}
      <div className={`absolute inset-x-0 top-0 h-[2px] ${meta.topAccentBarClass}`} aria-hidden="true" />

      <div className="space-y-4">
        {/* Identity Header: Avatar + Rank/Verification + Name/Title */}
        <div className="flex items-start gap-3.5">
          <div className="relative shrink-0">
            {hasPhoto ? (
              <img
                src={developer.photoUrl}
                alt={displayName}
                referrerPolicy="no-referrer"
                onError={() => setImgError(true)}
                className={`w-14 h-14 rounded-2xl object-cover bg-slate-900 ${meta.avatarRingClass}`}
              />
            ) : (
              <div
                className={`w-14 h-14 rounded-2xl flex items-center justify-center font-extrabold text-base tracking-wide ${meta.avatarBgClass} ${meta.avatarRingClass}`}
              >
                {getInitials(displayName)}
              </div>
            )}

            {developer.verified && (
              <span
                title={lang === 'bn' ? 'ভেরিফায়েড ডেভেলপার' : 'Verified Developer'}
                className="absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full bg-[#0F172A] border border-slate-700 flex items-center justify-center shadow-md"
              >
                <BadgeCheck className="w-4 h-4 text-sky-400" />
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-extrabold tracking-wider uppercase whitespace-nowrap shrink-0 ${meta.badgeClass}`}
              >
                <RankIcon className="w-3 h-3 shrink-0" />
                <span>{lang === 'bn' ? meta.labelBn : meta.labelEn}</span>
              </span>

              {developer.verified && rank !== 'verified' && (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-sky-500/15 border border-sky-400/35 text-sky-300 text-[10px] font-bold whitespace-nowrap shrink-0">
                  <BadgeCheck className="w-3 h-3 shrink-0" />
                  <span>{lang === 'bn' ? 'ভেরিফায়েড' : 'Verified'}</span>
                </span>
              )}
            </div>

            <div>
              <h3 className="text-base font-extrabold text-white tracking-tight truncate">
                {displayName}
              </h3>
              <p className={`text-xs font-bold truncate ${meta.titleTextClass}`}>{displayTitle}</p>
            </div>
          </div>
        </div>

        {/* Short Bio */}
        {displayBio ? (
          <p className="text-xs text-slate-300/95 leading-relaxed line-clamp-3">{displayBio}</p>
        ) : preview ? (
          <p className="text-xs text-slate-500 italic">
            {lang === 'bn'
              ? 'ডেভেলপারের সংক্ষিপ্ত পরিচিতি বা ভূমিকা এখানে দেখাবে...'
              : 'Developer short bio or specialization summary appears here...'}
          </p>
        ) : null}
      </div>

      {/* Footer Social Links */}
      {activeSocials.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex flex-wrap items-center gap-2">
          {activeSocials.map((s) => {
            const href = developer.socialLinks?.[s.key] || '#';
            return (
              <a
                key={s.key}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={s.label}
                aria-label={`${displayName} ${s.label}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800/75 hover:bg-slate-700/80 border border-slate-700/80 text-slate-200 hover:text-white text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                {s.renderIcon()}
                <span>{s.label}</span>
              </a>
            );
          })}
        </div>
      )}
    </article>
  );
}

export function DeveloperTeamSection({ lang }: { lang: Language }) {
  const [developers, setDevelopers] = useState<DeveloperProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let firstLoad = true;
    const unsub = subscribeDevelopers((list) => {
      setDevelopers(sortDevelopersByRank(list.filter((d) => d.active !== false)));
      if (firstLoad) {
        firstLoad = false;
        setLoading(false);
      }
    }, false);
    return unsub;
  }, []);

  return (
    <section
      aria-labelledby="dh-developer-team-heading"
      className="rounded-3xl bg-[#0B111E] border border-slate-800/90 p-5 sm:p-6 lg:p-7 space-y-5 shadow-lg text-slate-100"
    >
      {/* Header Strip */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800/90">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-slate-800/90 border border-slate-700 flex items-center justify-center text-amber-400 shrink-0">
              <Code2 className="w-4 h-4" />
            </span>
            <h2
              id="dh-developer-team-heading"
              className="text-lg sm:text-xl font-extrabold text-white tracking-tight"
            >
              {lang === 'bn' ? 'অফিশিয়াল ডেভেলপার টিম' : 'Developer Team'}
            </h2>
          </div>
          <p className="text-xs text-slate-400">
            {lang === 'bn'
              ? 'ডিজিটাল হাব বিডি-এর ভেরিফায়েড ইঞ্জিনিয়ারিং টিম — র‍্যাংক অনুযায়ী তালিকাভুক্ত'
              : 'Verified software engineering & platform leadership team ranked by tier.'}
          </p>
        </div>

        {/* Clean Unboxed Rank Hierarchy Legend */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] font-semibold text-slate-300">
          {DEVELOPER_RANK_ORDER.map((rKey, idx) => {
            const meta = DEVELOPER_RANK_META[rKey];
            const Icon = meta.Icon;
            return (
              <span key={rKey} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Icon className={`w-3.5 h-3.5 ${meta.titleTextClass}`} />
                <span>{lang === 'bn' ? meta.labelBn : meta.labelEn}</span>
                {idx < DEVELOPER_RANK_ORDER.length - 1 && (
                  <span className="text-slate-600 pl-1" aria-hidden="true">
                    ·
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {/* Loading State */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-44 rounded-2xl bg-slate-900/80 border border-slate-800 animate-pulse p-5"
            />
          ))}
        </div>
      ) : developers.length === 0 ? (
        /* Empty State when no active developers are published in Admin */
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800/80 py-10 px-4 text-center space-y-2">
          <div className="w-11 h-11 rounded-2xl bg-slate-800/90 border border-slate-700 mx-auto flex items-center justify-center text-slate-400">
            <Users className="w-5 h-5" />
          </div>
          <p className="text-sm font-bold text-slate-200">
            {lang === 'bn'
              ? 'এখনো কোনো ডেভেলপার প্রোফাইল প্রকাশিত হয়নি'
              : 'No Developer Profiles Published Yet'}
          </p>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            {lang === 'bn'
              ? 'অ্যাডমিন প্যানেলের ডেভেলপার ম্যানেজমেন্ট থেকে প্রোফাইল যোগ করলে এখানে র‍্যাংক ও ব্যাজসহ দেখাবে।'
              : 'Developer team members added and activated by administrators will appear here sorted by rank.'}
          </p>
        </div>
      ) : (
        /* Ranked Grid: Gold -> Silver -> Blue -> Verified */
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {developers.map((dev) => (
            <DeveloperProfileCard key={dev.id} developer={dev} lang={lang} />
          ))}
        </div>
      )}

      {/* Subtle Footer Trust Note */}
      <div className="pt-1 flex items-center justify-between gap-2 flex-wrap text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <Shield className="w-3.5 h-3.5 text-slate-400" />
          <span>
            {lang === 'bn'
              ? 'সকল র‍্যাংক ও ভেরিফিকেশন ব্যাজ সরাসরি ডিজিটাল হাব অ্যাডমিন দ্বারা পরিচালিত।'
              : 'All ranks and verification badges are centrally verified by Digital Hub Administration.'}
          </span>
        </span>
        {!loading && developers.length > 0 && (
          <span className="font-mono-num tabular-nums text-slate-400 font-semibold">
            {lang === 'bn' ? `মোট ${developers.length} জন` : `${developers.length} Member${developers.length === 1 ? '' : 's'}`}
          </span>
        )}
      </div>
    </section>
  );
}
