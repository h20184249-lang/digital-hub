import { useState } from 'react';
import {
  ChevronDown,
  Film,
  Globe,
  Headphones,
  Home,
  LayoutGrid,
  Megaphone,
  Moon,
  PackageCheck,
  Plus,
  Shield,
  ShoppingCart,
  Sun,
  Tag,
  User as UserIcon,
  Wallet,
} from 'lucide-react';
import { AppRoute, AuthUser, Language, SiteSettings, UserProfile } from '../types/marketplace';
import { t } from '../lib/i18n';
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
  onOpenAuth: () => void;
  onOpenRegister?: () => void;
  announcementText?: string;
}

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
  onOpenAuth,
  onOpenRegister,
  announcementText,
}: NavbarProps) {
  const [catMenuOpen, setCatMenuOpen] = useState(false);

  const categoryRoutes: { id: AppRoute; label: string }[] = [
    { id: 'services', label: t(lang, 'navServices') },
    { id: 'gaming-store', label: t(lang, 'navGaming') },
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

  const isCategoryRoute = categoryRoutes.some((c) => c.id === route);

  const go = (target: AppRoute) => {
    setRoute(target);
    setCatMenuOpen(false);
  };

  return (
    <>
      {announcementText && (
        <div className="bg-[#172033] dark:bg-slate-950 text-white text-[11px] sm:text-xs py-1.5 px-4 text-center font-medium border-b border-slate-800">
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 truncate">
            <span className="truncate">{announcementText}</span>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-40 w-full max-w-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-[#E6ECFA] dark:border-slate-800 shadow-xs transition-colors">
        <div className="max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={() => go('home')}
            className="text-left focus:outline-none min-w-0 shrink"
            aria-label={`${siteName || 'DIGITAL HUB'} Home`}
          >
            <DigitalHubLogo
              siteName={siteName}
              logoUrl={logoUrl}
              subtitle={lang === 'bn' ? 'আপনার ডিজিটাল সার্ভিস মার্কেট' : 'Your Complete Digital Services'}
              compact
            />
          </button>

          {/* Desktop Primary Nav */}
          <nav className="hidden lg:flex items-center gap-1 relative">
            <button
              type="button"
              onClick={() => go('home')}
              className={`px-3 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-colors ${
                route === 'home'
                  ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                  : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
              }`}
            >
              {t(lang, 'navHome')}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setCatMenuOpen((prev) => !prev)}
                className={`px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  isCategoryRoute
                    ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                    : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
                }`}
              >
                <LayoutGrid className="w-4 h-4 text-[#FF8500]" />
                {t(lang, 'navServices')}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${catMenuOpen ? 'rotate-180' : ''}`} />
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
              className={`px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                route === 'offers'
                  ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                  : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
              }`}
            >
              <Tag className="w-4 h-4 text-[#FF8500]" />
              {t(lang, 'navOffers')}
            </button>

            <button
              type="button"
              onClick={() => go('watch-earn')}
              className={`px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                route === 'watch-earn'
                  ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                  : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
              }`}
            >
              <Film className="w-4 h-4 text-[#FF8500]" />
              {lang === 'bn' ? 'দেখুন ও আয়' : 'Watch & Earn'}
            </button>

            <button
              type="button"
              onClick={() => go('ads')}
              className={`px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                route === 'ads'
                  ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                  : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
              }`}
            >
              <Megaphone className="w-4 h-4 text-[#FF8500]" />
              {t(lang, 'navAds')}
            </button>

            <button
              type="button"
              onClick={() => go('support')}
              className={`px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                route === 'support'
                  ? 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500]'
                  : 'text-[#172033] dark:text-slate-200 hover:bg-[#F3F6FF] dark:hover:bg-slate-800'
              }`}
            >
              <Headphones className="w-4 h-4 text-[#FF8500]" />
              {t(lang, 'navSupport')}
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => go('admin')}
                className={`px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                  route === 'admin'
                    ? 'bg-[#172033] dark:bg-[#FF8500] text-white'
                    : 'bg-[#FFF3E5] dark:bg-orange-500/15 text-[#FF8500] hover:bg-[#FF8500] hover:text-white'
                }`}
              >
                <Shield className="w-4 h-4" />
                {t(lang, 'navAdmin')}
              </button>
            )}
          </nav>

          {/* Right Header Controls: Theme + Language + Wallet Balance + Cart + Profile */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={onToggleTheme}
              className="p-1.5 sm:p-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200 hover:border-[#FF8500] transition-colors"
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
              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-xs font-bold text-[#172033] dark:text-slate-200 hover:border-[#FF8500]"
              title="Switch Language"
            >
              <Globe className="w-3.5 h-3.5 text-[#FF8500]" />
              <span>{lang === 'bn' ? 'EN' : 'বাংলা'}</span>
            </button>

            <button
              type="button"
              onClick={() => go('wallet')}
              className="dh-orange-gradient text-white px-2 sm:px-3.5 py-1.5 sm:py-2 rounded-xl sm:rounded-2xl text-[11px] sm:text-sm font-bold flex items-center gap-1 sm:gap-1.5 shadow-sm hover:opacity-95 transition-opacity whitespace-nowrap"
              title={t(lang, 'navWallet')}
            >
              <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
              <span className="font-mono-num">৳{walletBalanceBdt.toFixed(0)}</span>
            </button>

            <button
              type="button"
              onClick={onOpenCart}
              className="relative p-1.5 sm:p-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 text-[#172033] dark:text-slate-200 hover:border-[#FF8500] transition-colors"
              aria-label={t(lang, 'cart')}
            >
              <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5" />
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF8500] text-white text-[10px] font-bold flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </button>

            {user ? (
              <button
                type="button"
                onClick={() => go('account')}
                className="relative flex items-center gap-2 p-0.5 sm:pr-2.5 rounded-full bg-[#F3F6FF] dark:bg-slate-800 border border-[#E6ECFA] dark:border-slate-700 hover:border-[#FF8500] transition-colors"
                title={profile?.displayName || user.phone || user.email || t(lang, 'navAccount')}
              >
                {profile?.photoUrl || user.photoURL ? (
                  <img
                    src={profile?.photoUrl || user.photoURL || ''}
                    alt={profile?.displayName || 'User'}
                    className="w-7 h-7 sm:w-9 sm:h-9 rounded-full object-cover border border-[#FF8500]/40"
                  />
                ) : (
                  <div className="w-7 h-7 sm:w-9 sm:h-9 rounded-full bg-[#172033] dark:bg-[#FF8500] text-white flex items-center justify-center text-xs font-bold">
                    {(profile?.displayName || user.displayName || user.phone || user.email || 'U').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="hidden xl:inline text-xs font-bold text-[#172033] dark:text-slate-100 max-w-[90px] truncate">
                  {profile?.displayName || t(lang, 'navAccount')}
                </span>
                {unreadNotifications > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#DC2626] border-2 border-white dark:border-slate-900" />
                )}
              </button>
            ) : (
              <div className="flex items-center gap-1 sm:gap-1.5">
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl bg-[#172033] dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] sm:text-xs font-bold hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  {t(lang, 'signIn')}
                </button>
                <button
                  type="button"
                  onClick={onOpenRegister || onOpenAuth}
                  className="hidden sm:inline-flex px-3.5 py-2 rounded-xl bg-[#FFF3E5] dark:bg-orange-500/15 border border-[#FF8500]/30 text-[#FF8500] text-xs font-bold hover:bg-[#FF8500] hover:text-white transition-colors whitespace-nowrap"
                >
                  {lang === 'bn' ? 'সাইনআপ' : 'Sign Up'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile 5-Tab Bottom Navigation */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 w-full max-w-full bg-white dark:bg-slate-900 border-t border-[#E6ECFA] dark:border-slate-800 shadow-[0_-6px_24px_rgba(23,32,51,0.08)] px-1.5 h-16 flex items-center justify-around"
      >
        <button
          type="button"
          onClick={() => go('home')}
          className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 text-[10px] sm:text-[11px] font-semibold ${
            route === 'home' ? 'text-[#FF8500]' : 'text-[#777777] dark:text-slate-400'
          }`}
        >
          <Home className="w-5 h-5" />
          <span className="truncate max-w-full px-0.5">{t(lang, 'navHome')}</span>
        </button>

        <button
          type="button"
          onClick={() => go('orders')}
          className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 text-[10px] sm:text-[11px] font-semibold ${
            route === 'orders' ? 'text-[#FF8500]' : 'text-[#777777] dark:text-slate-400'
          }`}
        >
          <PackageCheck className="w-5 h-5" />
          <span className="truncate max-w-full px-0.5">{t(lang, 'navOrders')}</span>
        </button>

        <button
          type="button"
          onClick={() => go('add-money')}
          className="relative -top-3.5 flex-1 min-w-0 flex flex-col items-center justify-center"
        >
          <span className="w-12 h-12 rounded-full dh-orange-gradient text-white flex items-center justify-center shadow-lg border-4 border-white dark:border-slate-900">
            <Plus className="w-6 h-6" />
          </span>
          <span
            className={`mt-0.5 text-[10px] font-bold truncate max-w-full ${
              route === 'add-money' ? 'text-[#FF8500]' : 'text-[#172033] dark:text-slate-200'
            }`}
          >
            {t(lang, 'navAddMoney')}
          </span>
        </button>

        <button
          type="button"
          onClick={() => go('wallet')}
          className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 text-[10px] sm:text-[11px] font-semibold ${
            route === 'wallet' ? 'text-[#FF8500]' : 'text-[#777777] dark:text-slate-400'
          }`}
        >
          <Wallet className="w-5 h-5" />
          <span className="truncate max-w-full px-0.5">{t(lang, 'navWallet')}</span>
        </button>

        <button
          type="button"
          onClick={() => (user ? go(isAdmin && route === 'account' ? 'admin' : 'account') : onOpenAuth())}
          className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 text-[10px] sm:text-[11px] font-semibold relative ${
            route === 'account' || route === 'admin' ? 'text-[#FF8500]' : 'text-[#777777] dark:text-slate-400'
          }`}
        >
          <UserIcon className="w-5 h-5" />
          <span className="truncate max-w-full px-0.5">{t(lang, 'navAccount')}</span>
          {unreadNotifications > 0 && (
            <span className="absolute top-0 right-2 w-2 h-2 rounded-full bg-[#DC2626]" />
          )}
        </button>
      </nav>

      {/* Expandable Floating Customer Support Buttons (Messenger, WhatsApp, Telegram) */}
      {route !== 'admin' && <FloatingSupportWidget lang={lang} settings={settings} />}
    </>
  );
}
