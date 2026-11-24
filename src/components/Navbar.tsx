import { useEffect, useRef, useState } from 'react';
import {
  Bell,
  CheckCheck,
  ChevronDown,
  Film,
  Gamepad2,
  Globe,
  Headphones,
  Home,
  LayoutGrid,
  Megaphone,
  Menu,
  Moon,
  Shield,
  ShoppingCart,
  Smartphone,
  Sun,
  Tag,
  User as UserIcon,
  Wallet,
  X,
} from 'lucide-react';
import {
  AppNotification,
  AppRoute,
  AuthUser,
  Language,
  SiteSettings,
  UserProfile,
} from '../types/marketplace';
import { t } from '../lib/i18n';
import { formatDateShort } from '../lib/firestoreService';
import { DigitalHubLogo } from './DigitalHubLogo';
import { FloatingSupportWidget } from './FloatingSupportWidget';

interface NavbarProps {
  route: AppRoute;
  setRoute: (r: AppRoute) => void;
  lang: Language;
  setLang: (l: Language) => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  settings: SiteSettings;
  siteName?: string;
  logoUrl?: string;
  user: AuthUser | null;
  profile: UserProfile | null;
  walletBalanceBdt: number;
  cartCount: number;
  onOpenCart: () => void;
  isAdmin: boolean;
  unreadNotifications: number;
  notifications?: AppNotification[];
  onMarkNotificationRead?: (id: string) => void;
  onMarkAllNotificationsRead?: () => void;
  onOpenNotificationCenter?: () => void;
  onNotificationClick?: (notif: AppNotification) => void;
  onOpenAuth: () => void;
  onOpenRegister?: () => void;
  announcementText?: string;
}

const EMPTY_NOTIFS: AppNotification[] = [];

export function Navbar({
  route,
  setRoute,
  lang,
  setLang,
  theme,
  onToggleTheme,
  settings,
  siteName,
  logoUrl,
  user,
  profile,
  walletBalanceBdt,
  cartCount,
  onOpenCart,
  isAdmin,
  unreadNotifications,
  notifications = EMPTY_NOTIFS,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onOpenNotificationCenter,
  onNotificationClick,
  onOpenAuth,
  onOpenRegister,
  announcementText,
}: NavbarProps) {
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerCatsOpen, setDrawerCatsOpen] = useState(false);
  const notifContainerRef = useRef<HTMLDivElement | null>(null);
  const catContainerRef = useRef<HTMLDivElement | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!notifOpen && !catMenuOpen && !menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (notifOpen && notifContainerRef.current && !notifContainerRef.current.contains(target)) {
        setNotifOpen(false);
      }
      if (catMenuOpen && catContainerRef.current && !catContainerRef.current.contains(target)) {
        setCatMenuOpen(false);
      }
      if (menuOpen && menuContainerRef.current && !menuContainerRef.current.contains(target)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNotifOpen(false);
        setCatMenuOpen(false);
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [notifOpen, catMenuOpen, menuOpen]);

  const categoryRoutes: { id: AppRoute; label: string }[] = [
    { id: 'services', label: t(lang, 'navServices') },
    { id: 'gaming-store', label: t(lang, 'navGaming') },
    { id: 'games-store', label: lang === 'bn' ? 'গেমস হাব ও প্লে' : 'Games Hub' },
    { id: 'gift-cards', label: t(lang, 'navGiftCards') },
    { id: 'streaming-store', label: t(lang, 'navStreaming') },
    { id: 'telegram-store', label: t(lang, 'navTelegram') },
    { id: 'vip-groups', label: t(lang, 'navVip') },
    { id: 'telegram-stars', label: t(lang, 'navStars') },
    { id: 'ai-marketplace', label: t(lang, 'navAi') },
    { id: 'mobile-apps', label: lang === 'bn' ? 'মোবাইল অ্যাপ স্টোর' : 'Mobile App Store' },
    { id: 'software-store', label: t(lang, 'navSoftware') },
    { id: 'digital-products', label: t(lang, 'navDigital') },
    { id: 'graphic-design', label: t(lang, 'navDesign') },
    { id: 'social-media', label: t(lang, 'navSocial') },
  ];

  const isCategoryRoute = categoryRoutes.some(
    (c) => c.id === route && c.id !== 'mobile-apps' && c.id !== 'games-store'
  );

  const go = (target: AppRoute) => {
    setRoute(target);
    setCatMenuOpen(false);
    setNotifOpen(false);
    setMenuOpen(false);
  };

  return (
    <>
      {announcementText && (
        <div className="bg-[#172033] dark:bg-slate-950 text-white text-[11px] sm:text-xs py-1.5 px-4 text-center font-medium border-b border-slate-800">
          <div className="max-w-[1520px] mx-auto flex items-center justify-center gap-2 truncate">
            <span className="truncate">{announcementText}</span>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-40 w-full max-w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-[#E6ECFA] dark:border-slate-800 shadow-xs transition-colors">
        <div className="max-w-[1520px] mx-auto px-2.5 sm:px-4 lg:px-5 h-14 flex items-center justify-between gap-2 lg:gap-3">
          {/* Logo Section: flex-shrink: 0 prevents navigation from ever squishing or overlapping the logo */}
          <button
            type="button"
            onClick={() => go('home')}
            className="text-left focus:outline-none shrink-0 flex items-center"
            aria-label={`${siteName || 'DIGITAL HUB'} Home`}
          >
            <DigitalHubLogo
              siteName={siteName}
              logoUrl={logoUrl}
              subtitle={lang === 'bn' ? 'আপনার ডিজিটাল সার্ভিস মার্কেট' : 'Your Complete Digital Services'}
              compact
            />
          </button>

          {/* Desktop Primary Nav: flex-1 single-row non-wrapping menu */}
          <nav
            aria-label="Primary Navigation"
            className="hidden lg:flex flex-1 min-w-0 items-center justify-center gap-0.5 xl:gap-1 relative"
          >
            <button
              type="button"
              onClick={() => go('home')}
              className={`px-2 xl:px-2.5 py-1.5 rounded-lg text-xs xl:text-[13px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                route === 'home'
                  ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                  : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
              }`}
            >
              <Home className="w-4 h-4 text-[#FF8500] shrink-0" />
              <span>{t(lang, 'navHome')}</span>
            </button>

            <button
              type="button"
              onClick={() => go('mobile-apps')}
              className={`px-2 xl:px-2.5 py-1.5 rounded-lg text-xs xl:text-[13px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                route === 'mobile-apps'
                  ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                  : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
              }`}
            >
              <Smartphone className="w-4 h-4 text-[#FF8500] shrink-0" />
              <span>{lang === 'bn' ? 'অ্যাপস' : 'Apps'}</span>
            </button>

            <button
              type="button"
              onClick={() => go('games-store')}
              className={`px-2 xl:px-2.5 py-1.5 rounded-lg text-xs xl:text-[13px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                route === 'games-store'
                  ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                  : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
              }`}
            >
              <Gamepad2 className="w-4 h-4 text-[#FF8500] shrink-0" />
              <span>{lang === 'bn' ? 'গেমস' : 'Games'}</span>
            </button>

            <div className="relative shrink-0" ref={catContainerRef}>
              <button
                type="button"
                onClick={() => {
                  setNotifOpen(false);
                  setMenuOpen(false);
                  setCatMenuOpen((prev) => !prev);
                }}
                aria-expanded={catMenuOpen}
                className={`px-2 xl:px-2.5 py-1.5 rounded-lg text-xs xl:text-[13px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                  isCategoryRoute
                    ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                    : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
                }`}
              >
                <LayoutGrid className="w-4 h-4 text-[#FF8500] shrink-0" />
                <span>{t(lang, 'navServices')}</span>
                <ChevronDown className={`w-3.5 h-3.5 shrink-0 transition-transform ${catMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {catMenuOpen && (
                <div
                  onMouseLeave={() => setCatMenuOpen(false)}
                  className="absolute left-0 mt-2 w-60 bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 rounded-2xl shadow-xl p-2 grid grid-cols-1 gap-0.5 z-50"
                >
                  {categoryRoutes.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => go(item.id)}
                      className={`text-left px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                        route === item.id
                          ? 'bg-[#FF8500] text-white'
                          : 'text-[#172033] dark:text-slate-200 hover:bg-[#FFF3E5] dark:hover:bg-slate-800 hover:text-[#FF8500]'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => go('offers')}
              className={`px-2 xl:px-2.5 py-1.5 rounded-lg text-xs xl:text-[13px] font-semibold inline-flex items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                route === 'offers'
                  ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                  : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
              }`}
            >
              <Tag className="w-4 h-4 text-[#FF8500] shrink-0" />
              <span>{lang === 'bn' ? 'অফার' : 'Offers'}</span>
              <span className="hidden 2xl:inline">{lang === 'bn' ? 'ও কুপন' : '& Coupons'}</span>
            </button>

            <button
              type="button"
              onClick={() => go('watch-earn')}
              className={`hidden xl:inline-flex px-2 xl:px-2.5 py-1.5 rounded-lg text-xs xl:text-[13px] font-semibold items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                route === 'watch-earn'
                  ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                  : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
              }`}
            >
              <Film className="w-4 h-4 text-[#FF8500] shrink-0" />
              <span>{lang === 'bn' ? 'দেখুন ও আয়' : 'Watch & Earn'}</span>
            </button>

            <button
              type="button"
              onClick={() => go('ads')}
              className={`hidden 2xl:inline-flex px-2.5 py-1.5 rounded-lg text-[13px] font-semibold items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                route === 'ads'
                  ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                  : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
              }`}
            >
              <Megaphone className="w-4 h-4 text-[#FF8500] shrink-0" />
              <span>{t(lang, 'navAds')}</span>
            </button>

            <button
              type="button"
              onClick={() => go('support')}
              className={`hidden xl:inline-flex px-2 xl:px-2.5 py-1.5 rounded-lg text-xs xl:text-[13px] font-semibold items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                route === 'support'
                  ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                  : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
              }`}
            >
              <Headphones className="w-4 h-4 text-[#FF8500] shrink-0" />
              <span>{t(lang, 'navSupport')}</span>
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => go('admin')}
                className={`hidden xl:inline-flex px-2 xl:px-2.5 py-1.5 rounded-lg text-xs xl:text-[13px] font-bold items-center gap-1 whitespace-nowrap shrink-0 transition-colors ${
                  route === 'admin'
                    ? 'bg-[#172033] dark:bg-[#FF8500] text-white'
                    : 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500] hover:bg-[#FF8500] hover:text-white'
                }`}
              >
                <Shield className="w-4 h-4 shrink-0" />
                <span>{t(lang, 'navAdmin')}</span>
              </button>
            )}
          </nav>

          {/* Right Header Controls: Theme + Language + Bell + Wallet Balance + Cart + Profile + Responsive Hamburger */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onToggleTheme}
              className="p-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200 hover:border-[#FF8500] transition-colors shrink-0"
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              title={theme === 'dark' ? (lang === 'bn' ? 'লাইট মোড' : 'Light Mode') : lang === 'bn' ? 'ডার্ক মোড' : 'Dark Mode'}
            >
              {theme === 'dark' ? (
                <Sun className="w-4 h-4 text-[#FF8500]" />
              ) : (
                <Moon className="w-4 h-4 text-[#172033]" />
              )}
            </button>

            <button
              type="button"
              onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}
              className="hidden sm:inline-flex items-center gap-1 px-2 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-bold text-[#172033] dark:text-slate-200 hover:border-[#FF8500] whitespace-nowrap shrink-0"
              title="Switch Language"
            >
              <Globe className="w-3.5 h-3.5 text-[#FF8500]" />
              <span>{lang === 'bn' ? 'EN' : 'বাংলা'}</span>
            </button>

            {/* Notification Bell + Interactive Popover */}
            <div className="relative shrink-0" ref={notifContainerRef}>
              <button
                type="button"
                onClick={() => {
                  if (!user) {
                    onOpenAuth();
                    return;
                  }
                  setCatMenuOpen(false);
                  setMenuOpen(false);
                  setNotifOpen((prev) => !prev);
                }}
                aria-expanded={notifOpen}
                aria-label={lang === 'bn' ? 'নোটিফিকেশন দেখুন' : 'View Notifications'}
                className="relative p-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200 hover:border-[#FF8500] transition-colors"
                title={lang === 'bn' ? 'নোটিফিকেশন' : 'Notifications'}
              >
                <Bell className="w-4 h-4" />
                {unreadNotifications > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[#DC2626] border-2 border-white dark:border-slate-900 text-white text-[9px] font-extrabold font-mono-num flex items-center justify-center leading-none">
                    {unreadNotifications > 99 ? '99+' : unreadNotifications}
                  </span>
                )}
              </button>

              {notifOpen && user && (
                <div className="fixed sm:absolute right-2 sm:right-0 top-14 sm:top-full sm:mt-2 w-[calc(100vw-1rem)] sm:w-96 max-w-sm rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 shadow-2xl z-50 overflow-hidden">
                  <div className="px-4 py-3 bg-[#FFF7EE] dark:bg-slate-800/80 border-b border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Bell className="w-4 h-4 text-[#FF8500]" />
                      <span className="text-xs font-extrabold text-[#172033] dark:text-slate-100">
                        {lang === 'bn' ? 'নোটিফিকেশন' : 'Notifications'}
                        {unreadNotifications > 0 ? ` (${unreadNotifications})` : ''}
                      </span>
                    </div>
                    {unreadNotifications > 0 && onMarkAllNotificationsRead && (
                      <button
                        type="button"
                        onClick={() => onMarkAllNotificationsRead()}
                        className="text-[11px] font-bold text-[#FF8500] hover:underline inline-flex items-center gap-1"
                      >
                        <CheckCheck className="w-3.5 h-3.5" />
                        <span>{lang === 'bn' ? 'সব পঠিত' : 'Mark all read'}</span>
                      </button>
                    )}
                  </div>

                  <div className="max-h-80 overflow-y-auto divide-y divide-[#E6ECFA] dark:divide-slate-800">
                    {notifications.length === 0 ? (
                      <p className="py-8 px-4 text-center text-xs text-[#777777] dark:text-slate-400">
                        {lang === 'bn' ? 'এখনো কোনো নোটিফিকেশন নেই।' : 'No notifications yet.'}
                      </p>
                    ) : (
                      notifications.slice(0, 6).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => {
                            setNotifOpen(false);
                            if (!n.read && onMarkNotificationRead) {
                              onMarkNotificationRead(n.id);
                            }
                            if (onNotificationClick) {
                              onNotificationClick(n);
                            } else if (onOpenNotificationCenter) {
                              onOpenNotificationCenter();
                            }
                          }}
                          className={`w-full text-left px-4 py-3 transition-colors hover:bg-[#F3F6FF] dark:hover:bg-slate-800/60 ${
                            !n.read ? 'bg-[#FFF8F0] dark:bg-orange-950/20' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-bold text-[#172033] dark:text-slate-100 line-clamp-1">
                              {!n.read && (
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#FF8500] mr-1.5 align-middle" />
                              )}
                              {lang === 'bn' ? n.titleBn || n.titleEn : n.titleEn || n.titleBn}
                            </p>
                            <span className="text-[10px] font-mono-num text-[#777777] dark:text-slate-400 shrink-0">
                              {formatDateShort(n.createdAt, lang)}
                            </span>
                          </div>
                          <p className="text-[11px] text-[#5C6B84] dark:text-slate-400 mt-0.5 line-clamp-2">
                            {lang === 'bn' ? n.messageBn || n.messageEn : n.messageEn || n.messageBn}
                          </p>
                        </button>
                      ))
                    )}
                  </div>

                  <div className="px-4 py-2.5 bg-[#F8FAFF] dark:bg-slate-800/50 border-t border-[#E6ECFA] dark:border-slate-700 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setNotifOpen(false);
                        if (onOpenNotificationCenter) {
                          onOpenNotificationCenter();
                        } else {
                          go('account');
                        }
                      }}
                      className="w-full py-1.5 rounded-xl bg-[#172033] dark:bg-[#FF8500] text-white text-xs font-bold text-center hover:opacity-95 transition-opacity"
                    >
                      {lang === 'bn' ? 'নোটিফিকেশন সেন্টার খুলুন →' : 'Open Notification Center →'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => go('wallet')}
              className="dh-orange-gradient text-white px-2 sm:px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 shadow-sm hover:opacity-95 transition-opacity whitespace-nowrap shrink-0"
              title={t(lang, 'navWallet')}
            >
              <Wallet className="w-4 h-4 shrink-0" />
              <span className="font-mono-num">৳{walletBalanceBdt.toFixed(0)}</span>
            </button>

            <button
              type="button"
              onClick={onOpenCart}
              className="relative p-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200 hover:border-[#FF8500] transition-colors shrink-0"
              aria-label={t(lang, 'cart')}
            >
              <ShoppingCart className="w-4 h-4" />
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[17px] h-[17px] px-1 rounded-full bg-[#FF8500] text-white text-[9px] font-bold flex items-center justify-center leading-none">
                  {cartCount}
                </span>
              )}
            </button>

            {user ? (
              <button
                type="button"
                onClick={() => go('account')}
                className="relative flex items-center gap-1.5 p-0.5 2xl:pr-2.5 rounded-full bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 hover:border-[#FF8500] transition-colors shrink-0"
                title={profile?.displayName || user.phone || user.email || t(lang, 'navAccount')}
              >
                {profile?.photoUrl || user.photoURL ? (
                  <img
                    src={profile?.photoUrl || user.photoURL || ''}
                    alt={profile?.displayName || 'User'}
                    className="w-7 h-7 sm:w-8 sm:h-8 rounded-full object-cover border border-[#FF8500]/40"
                  />
                ) : (
                  <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#172033] dark:bg-[#FF8500] text-white flex items-center justify-center text-xs font-bold">
                    {(profile?.displayName || user.displayName || user.phone || user.email || 'U').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="hidden 2xl:inline text-xs font-bold text-[#172033] dark:text-slate-100 max-w-[84px] truncate">
                  {profile?.displayName || t(lang, 'navAccount')}
                </span>
              </button>
            ) : (
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="px-2.5 py-1.5 rounded-xl bg-[#172033] dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold hover:opacity-90 transition-opacity whitespace-nowrap shrink-0"
                >
                  {t(lang, 'signIn')}
                </button>
                <button
                  type="button"
                  onClick={onOpenRegister || onOpenAuth}
                  className="hidden xl:inline-flex px-2.5 py-1.5 rounded-xl bg-[#FFF3E5] dark:bg-orange-500/15 border border-[#FF8500]/30 text-[#FF8500] text-xs font-bold hover:bg-[#FF8500] hover:text-white transition-colors whitespace-nowrap shrink-0"
                >
                  {lang === 'bn' ? 'সাইনআপ' : 'Sign Up'}
                </button>
              </div>
            )}

            {/* Responsive Hamburger Menu Drawer for Mobile, Tablet & Smaller Laptops (< 2xl) */}
            <div className="relative 2xl:hidden shrink-0" ref={menuContainerRef}>
              <button
                type="button"
                onClick={() => {
                  setNotifOpen(false);
                  setCatMenuOpen(false);
                  setMenuOpen((prev) => !prev);
                }}
                aria-expanded={menuOpen}
                aria-label={lang === 'bn' ? 'সম্পূর্ণ মেনু খুলুন' : 'Toggle Menu'}
                className="p-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200 hover:border-[#FF8500] transition-colors"
              >
                {menuOpen ? <X className="w-4 h-4 text-[#FF8500]" /> : <Menu className="w-4 h-4" />}
              </button>

              {menuOpen && (
                <div className="fixed sm:absolute right-2 sm:right-0 top-14 sm:top-full sm:mt-2 w-[calc(100vw-1rem)] sm:w-80 max-w-xs rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 shadow-2xl z-50 overflow-hidden">
                  <div className="p-2.5 max-h-[75vh] overflow-y-auto space-y-1">
                    <button
                      type="button"
                      onClick={() => go('home')}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
                        route === 'home'
                          ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                          : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
                      }`}
                    >
                      <Home className="w-4 h-4 text-[#FF8500] shrink-0" />
                      <span>{t(lang, 'navHome')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => go('mobile-apps')}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
                        route === 'mobile-apps'
                          ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                          : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
                      }`}
                    >
                      <Smartphone className="w-4 h-4 text-[#FF8500] shrink-0" />
                      <span>{lang === 'bn' ? 'অ্যাপস' : 'Apps'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => go('games-store')}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
                        route === 'games-store'
                          ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                          : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
                      }`}
                    >
                      <Gamepad2 className="w-4 h-4 text-[#FF8500] shrink-0" />
                      <span>{lang === 'bn' ? 'গেমস' : 'Games'}</span>
                    </button>

                    <div>
                      <button
                        type="button"
                        onClick={() => setDrawerCatsOpen((v) => !v)}
                        className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between gap-2 transition-colors ${
                          isCategoryRoute
                            ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                            : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <LayoutGrid className="w-4 h-4 text-[#FF8500] shrink-0" />
                          <span>{t(lang, 'navServices')}</span>
                        </span>
                        <ChevronDown
                          className={`w-3.5 h-3.5 transition-transform ${drawerCatsOpen ? 'rotate-180' : ''}`}
                        />
                      </button>
                      {drawerCatsOpen && (
                        <div className="mt-1 pl-4 pr-1 space-y-0.5 border-l-2 border-[#FF8500]/30 ml-4">
                          {categoryRoutes.map((cat) => (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => go(cat.id)}
                              className={`w-full text-left px-2.5 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                                route === cat.id
                                  ? 'bg-[#FF8500] text-white'
                                  : 'text-[#475569] dark:text-slate-300 hover:bg-[#FFF3E5] dark:hover:bg-slate-800'
                              }`}
                            >
                              {cat.label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => go('offers')}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
                        route === 'offers'
                          ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                          : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
                      }`}
                    >
                      <Tag className="w-4 h-4 text-[#FF8500] shrink-0" />
                      <span>{t(lang, 'navOffers')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => go('watch-earn')}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
                        route === 'watch-earn'
                          ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                          : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
                      }`}
                    >
                      <Film className="w-4 h-4 text-[#FF8500] shrink-0" />
                      <span>{lang === 'bn' ? 'দেখুন ও আয়' : 'Watch & Earn'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => go('ads')}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
                        route === 'ads'
                          ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                          : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
                      }`}
                    >
                      <Megaphone className="w-4 h-4 text-[#FF8500] shrink-0" />
                      <span>{t(lang, 'navAds')}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => go('support')}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-colors ${
                        route === 'support'
                          ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                          : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
                      }`}
                    >
                      <Headphones className="w-4 h-4 text-[#FF8500] shrink-0" />
                      <span>{t(lang, 'navSupport')}</span>
                    </button>

                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => go('admin')}
                        className={`w-full text-left px-3 py-2 rounded-xl text-xs font-extrabold flex items-center gap-2 transition-colors ${
                          route === 'admin'
                            ? 'bg-[#172033] dark:bg-[#FF8500] text-white'
                            : 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                        }`}
                      >
                        <Shield className="w-4 h-4 shrink-0" />
                        <span>{t(lang, 'navAdmin')}</span>
                      </button>
                    )}

                    <div className="pt-2 mt-1 border-t border-[#E6ECFA] dark:border-slate-800 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}
                        className="flex-1 px-3 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 text-xs font-bold text-[#172033] dark:text-slate-200 inline-flex items-center justify-center gap-1.5"
                      >
                        <Globe className="w-3.5 h-3.5 text-[#FF8500]" />
                        <span>{lang === 'bn' ? 'Switch to EN' : 'বাংলায় দেখুন'}</span>
                      </button>
                      {!user && (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            (onOpenRegister || onOpenAuth)();
                          }}
                          className="flex-1 px-3 py-2 rounded-xl dh-orange-gradient text-white text-xs font-bold text-center"
                        >
                          {lang === 'bn' ? 'সাইনআপ' : 'Sign Up'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile 5-Tab Bottom Navigation: Home | Apps | Games | Services | Profile */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 w-full max-w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-[#E6ECFA] dark:border-slate-800 shadow-[0_-6px_24px_rgba(23,32,51,0.08)] px-1.5 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] flex items-center justify-around"
      >
        {(
          [
            {
              id: 'home' as const,
              active: route === 'home',
              label: t(lang, 'navHome'),
              icon: Home,
              onClick: () => go('home'),
            },
            {
              id: 'mobile-apps' as const,
              active: route === 'mobile-apps',
              label: lang === 'bn' ? 'অ্যাপস' : 'Apps',
              icon: Smartphone,
              onClick: () => go('mobile-apps'),
            },
            {
              id: 'games-store' as const,
              active: route === 'games-store',
              label: lang === 'bn' ? 'গেমস' : 'Games',
              icon: Gamepad2,
              onClick: () => go('games-store'),
            },
            {
              id: 'services' as const,
              active: isCategoryRoute,
              label: lang === 'bn' ? 'সার্ভিস' : 'Services',
              icon: LayoutGrid,
              onClick: () => go('services'),
            },
            {
              id: 'profile' as const,
              active:
                route === 'account' ||
                route === 'orders' ||
                route === 'wallet' ||
                route === 'add-money' ||
                route === 'admin',
              label: lang === 'bn' ? 'প্রোফাইল' : 'Profile',
              icon: UserIcon,
              badge: unreadNotifications,
              onClick: () => (user ? go(isAdmin && route === 'account' ? 'admin' : 'account') : onOpenAuth()),
            },
          ] as Array<{
            id: string;
            active: boolean;
            label: string;
            icon: typeof Home;
            badge?: number;
            onClick: () => void;
          }>
        ).map((tabItem) => {
          const TabIcon = tabItem.icon;
          return (
            <button
              key={tabItem.id}
              type="button"
              onClick={tabItem.onClick}
              className={`relative flex-1 min-w-0 min-h-[48px] flex flex-col items-center justify-center gap-0.5 text-[10px] sm:text-[11px] font-bold transition-colors ${
                tabItem.active ? 'text-[#FF8500]' : 'text-[#777777] dark:text-slate-400'
              }`}
            >
              {tabItem.active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-[#FF8500]" />
              )}
              <TabIcon className="w-5 h-5" />
              <span className="truncate max-w-full px-0.5">{tabItem.label}</span>
              {tabItem.badge && tabItem.badge > 0 ? (
                <span
                  aria-label={`${tabItem.badge} unread notifications`}
                  className="absolute top-1 right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-[#DC2626] text-white text-[9px] font-extrabold font-mono-num flex items-center justify-center leading-none"
                >
                  {tabItem.badge > 99 ? '99+' : tabItem.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      {/* Expandable Floating Customer Support Buttons (Messenger, WhatsApp, Telegram) */}
      {route !== 'admin' && <FloatingSupportWidget lang={lang} settings={settings} />}
    </>
  );
}
