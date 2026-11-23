import { useEffect, useState } from 'react';
import { Bell, Calendar, Megaphone, Sparkles, Tag, Wrench, X } from 'lucide-react';
import { Announcement, AnnouncementType, Language } from '../types/marketplace';
import { formatDateShort } from '../lib/firestoreService';

interface HomeAnnouncementsBarProps {
  announcements: Announcement[];
  lang: Language;
}

function getAnnouncementBadgeMeta(type: AnnouncementType, lang: Language) {
  switch (type) {
    case 'offer':
    case 'promo':
      return {
        label: lang === 'bn' ? 'অফার' : 'OFFER',
        pill: 'bg-[#FF8500] text-white',
        card: 'bg-[#FFF8F0] dark:bg-orange-950/25 border-[#FF8500]/35',
        Icon: Tag,
      };
    case 'important':
    case 'maintenance':
      return {
        label: lang === 'bn' ? 'গুরুত্বপূর্ণ' : 'IMPORTANT',
        pill: 'bg-[#DC2626] text-white',
        card: 'bg-red-50/75 dark:bg-red-950/25 border-red-200 dark:border-red-900/60',
        Icon: Wrench,
      };
    case 'update':
      return {
        label: lang === 'bn' ? 'আপডেট' : 'UPDATE',
        pill: 'bg-emerald-600 text-white',
        card: 'bg-emerald-50/70 dark:bg-emerald-950/25 border-emerald-200 dark:border-emerald-900/60',
        Icon: Sparkles,
      };
    default:
      return {
        label: lang === 'bn' ? 'ঘোষণা' : 'ANNOUNCEMENT',
        pill: 'bg-[#172033] text-white',
        card: 'bg-white dark:bg-slate-900 border-[#E6ECFA] dark:border-slate-800',
        Icon: Megaphone,
      };
  }
}

function getDismissKey(ann: Announcement): string {
  return `dh_ann_dismissed_${ann.id}_${ann.updatedAt || ann.createdAt || '1'}`;
}

export function HomeAnnouncementsBar({ announcements, lang }: HomeAnnouncementsBarProps) {
  const [dismissedIds, setDismissedIds] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const ann of announcements) {
      try {
        if (localStorage.getItem(getDismissKey(ann)) === '1') {
          next[ann.id] = true;
        }
      } catch {
        // Non-fatal
      }
    }
    setDismissedIds(next);
  }, [announcements]);

  const visibleAnnouncements = announcements.filter((a) => !dismissedIds[a.id]);

  if (visibleAnnouncements.length === 0) return null;

  const dismiss = (ann: Announcement) => {
    setDismissedIds((prev) => ({ ...prev, [ann.id]: true }));
    try {
      localStorage.setItem(getDismissKey(ann), '1');
    } catch {
      // Non-fatal
    }
  };

  return (
    <section className="space-y-2.5" aria-label={lang === 'bn' ? 'গুরুত্বপূর্ণ ঘোষণা' : 'Site Announcements'}>
      {visibleAnnouncements.slice(0, 3).map((ann) => {
        const meta = getAnnouncementBadgeMeta(ann.type, lang);
        const Icon = meta.Icon;
        const title = lang === 'bn' ? ann.titleBn || ann.titleEn : ann.titleEn || ann.titleBn;
        const message = lang === 'bn' ? ann.messageBn || ann.messageEn : ann.messageEn || ann.messageBn;
        return (
          <div
            key={ann.id}
            className={`rounded-2xl border p-3.5 sm:p-4 shadow-xs transition-all flex items-start gap-3 ${meta.card}`}
          >
            {ann.imageUrl ? (
              <img
                src={ann.imageUrl}
                alt={title}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
                className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl object-cover border border-black/10 shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-[#FF8500]/15 text-[#FF8500] flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="w-4 h-4" />
              </div>
            )}

            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wide ${meta.pill}`}>
                  {meta.label}
                </span>
                <h3 className="text-xs sm:text-sm font-extrabold text-[#172033] dark:text-slate-100">
                  {title}
                </h3>
                {ann.expiresAt && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-mono-num text-[#64748B] dark:text-slate-400">
                    <Calendar className="w-3 h-3" />
                    {lang === 'bn' ? `মেয়াদ: ${ann.expiresAt}` : `Until ${ann.expiresAt}`}
                  </span>
                )}
              </div>
              <p className="text-xs text-[#475569] dark:text-slate-300 leading-relaxed whitespace-pre-line">
                {message}
              </p>
              <p className="text-[10px] text-[#94A3B8] flex items-center gap-1">
                <Bell className="w-3 h-3" />
                <span>{formatDateShort(ann.createdAt, lang)}</span>
              </p>
            </div>

            {ann.dismissible !== false && (
              <button
                type="button"
                onClick={() => dismiss(ann)}
                aria-label={lang === 'bn' ? 'বন্ধ করুন' : 'Dismiss announcement'}
                className="p-1.5 rounded-xl text-[#64748B] hover:text-[#172033] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
