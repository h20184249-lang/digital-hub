import { useEffect, useRef, useState } from 'react';
import { Headphones, X } from 'lucide-react';
import { Language, SiteSettings } from '../types/marketplace';

interface FloatingSupportWidgetProps {
  lang: Language;
  settings: SiteSettings;
}

function MessengerIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12 2C6.36 2 2 6.13 2 11.7c0 2.91 1.19 5.44 3.14 7.17.16.14.26.35.27.57l.05 1.78c.02.57.61.94 1.13.71l1.98-.87c.17-.08.36-.09.54-.05.91.25 1.88.39 2.89.39 5.64 0 10-4.13 10-9.7C22 6.13 17.64 2 12 2zm5.98 7.45-2.93 4.65c-.46.74-1.45.92-2.14.4l-2.34-1.75a.6.6 0 0 0-.72 0l-3.16 2.4c-.42.32-.97-.18-.69-.63l2.93-4.65c.46-.74 1.45-.92 2.14-.4l2.34 1.75c.21.16.51.16.72 0l3.16-2.4c.42-.32.97.18.69.63z" />
    </svg>
  );
}

function WhatsAppIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.08c-.24.69-1.42 1.31-1.97 1.39-.51.08-1.15.11-1.85-.11-.43-.14-.98-.32-1.69-.63-2.98-1.29-4.92-4.29-5.07-4.49-.15-.2-1.21-1.61-1.21-3.07 0-1.46.76-2.18 1.04-2.48.27-.3.59-.37.79-.37.2 0 .4 0 .57.01.18.01.43-.07.67.51.25.6.84 2.06.92 2.21.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.39-.45.52-.15.15-.3.31-.13.61.17.3.77 1.27 1.66 2.06 1.14 1.02 2.1 1.33 2.4 1.48.3.15.47.12.64-.08.17-.2.74-.86.94-1.16.2-.3.4-.25.67-.15.27.1 1.73.82 2.03.97.3.15.49.22.57.35.07.12.07.72-.17 1.41z" />
    </svg>
  );
}

function TelegramIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M21.84 4.19a1.5 1.5 0 0 0-1.61-.24L3.02 10.67a1.5 1.5 0 0 0 .08 2.81l4.38 1.46 1.67 5.02a1 1 0 0 0 1.65.41l2.43-2.36 4.18 3.07a1.5 1.5 0 0 0 2.36-.9l2.46-14.37a1.5 1.5 0 0 0-.39-1.62zM17.9 8.13l-7.82 6.84-.56 2.91-1.08-3.44 9.46-6.31z" />
    </svg>
  );
}

function normalizeSupportUrl(raw: string | undefined, fallback: string): string {
  const val = (raw || '').trim();
  if (!val) return fallback;
  if (/^https?:\/\//i.test(val)) return val;
  return fallback;
}

export function FloatingSupportWidget({ lang, settings }: FloatingSupportWidgetProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown, { passive: true });
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const messengerUrl = normalizeSupportUrl(
    settings.messengerLink || settings.facebookLink,
    'https://m.me/digitalhubbd'
  );
  const whatsappUrl = normalizeSupportUrl(settings.whatsappLink, 'https://wa.me/8801352838945');
  const telegramUrl = normalizeSupportUrl(settings.telegramLink, 'https://t.me/zenvoofficial');

  const items = [
    {
      id: 'messenger',
      label: 'Messenger',
      href: messengerUrl,
      bgClass: 'bg-gradient-to-br from-[#0099FF] to-[#0068FF] hover:brightness-110',
      Icon: MessengerIcon,
    },
    {
      id: 'whatsapp',
      label: 'WhatsApp',
      href: whatsappUrl,
      bgClass: 'bg-[#25D366] hover:bg-[#1ebe5d]',
      Icon: WhatsAppIcon,
    },
    {
      id: 'telegram',
      label: 'Telegram',
      href: telegramUrl,
      bgClass: 'bg-[#0088CC] hover:bg-[#0077b5]',
      Icon: TelegramIcon,
    },
  ];

  return (
    <div
      ref={rootRef}
      className="fixed right-3 sm:right-5 bottom-[74px] lg:bottom-6 z-40 flex flex-col items-end gap-2 select-none"
    >
      {/* Expandable Vertical Stack: Messenger, WhatsApp, Telegram */}
      <div
        aria-hidden={!open}
        className={`flex flex-col items-end gap-2 transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          open
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-3 pointer-events-none'
        }`}
      >
        {items.map((item) => {
          const Icon = item.Icon;
          return (
            <a
              key={item.id}
              href={item.href}
              target="_blank"
              rel="noopener noreferrer"
              tabIndex={open ? 0 : -1}
              onClick={() => setOpen(false)}
              aria-label={item.label}
              title={item.label}
              className="group flex items-center gap-2 focus:outline-none"
            >
              <span className="px-2.5 py-1 rounded-lg bg-[#172033]/95 dark:bg-slate-900/95 text-white text-[11px] font-bold shadow-md border border-white/10 whitespace-nowrap">
                {item.label}
              </span>
              <span
                className={`w-11 h-11 rounded-full ${item.bgClass} text-white shadow-[0_6px_18px_rgba(15,23,42,0.22)] flex items-center justify-center transition-transform duration-150 group-hover:scale-105 active:scale-95`}
              >
                <Icon className="w-5 h-5" />
              </span>
            </a>
          );
        })}
      </div>

      {/* Main Compact Toggle Button */}
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={
          open
            ? lang === 'bn'
              ? 'সাপোর্ট মেনু বন্ধ করুন'
              : 'Close support menu'
            : lang === 'bn'
              ? 'কাস্টমার সাপোর্ট (মেসেঞ্জার, হোয়াটসঅ্যাপ, টেলিগ্রাম)'
              : 'Customer Support (Messenger, WhatsApp, Telegram)'
        }
        title={lang === 'bn' ? 'কাস্টমার সাপোর্ট' : 'Customer Support'}
        className={`w-11 h-11 rounded-full shadow-[0_8px_22px_rgba(23,32,51,0.28)] border-2 flex items-center justify-center transition-[transform,background-color,border-color] duration-200 active:scale-95 cursor-pointer ${
          open
            ? 'bg-[#FF8500] border-white text-white rotate-90'
            : 'bg-[#172033] border-[#FF8500] text-white hover:bg-[#FF8500] hover:border-white'
        }`}
      >
        {open ? <X className="w-5 h-5" /> : <Headphones className="w-5 h-5" />}
      </button>
    </div>
  );
}
