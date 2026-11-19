import { useState } from 'react';
import {
  ChevronDown,
  Film,
  Globe,
  Headphones,
  Home,
  LayoutGrid,
  Megaphone,
  PackageCheck,
  Plus,
  Shield,
  ShoppingCart,
  Tag,
  User as UserIcon,
  Wallet,
} from 'lucide-react';
import { AppRoute, AuthUser, Language, UserProfile } from '../types/marketplace';
import { t } from '../lib/i18n';
import { DigitalHubLogo } from './DigitalHubLogo';

interface NavbarProps {
  route: AppRoute;
  setRoute: (r: AppRoute) => void;
  lang: Language;
  setLang: (l: Language) => void;
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
        <div className="bg-[#172033] text-white text-[11px] sm:text-xs py-1.5 px-4 text-center font-medium">
          <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 truncate">
            <span className="inline-block w-2 h-2 rounded-full bg-[#FF8500] shrink-0" />
            <span className="truncate">{announcementText}</span>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-[#E6ECFA] shadow-xs">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => go('home')}
            className="text-left focus:outline-none shrink-0"
            aria-label="DIGITAL HUB Home"
          >
            <DigitalHubLogo
              subtitle={lang === 'bn' ? 'আপনার ডিজিটাল সার্ভিস মার্কেট' : 'Your Complete Digital Services'}
              compact
            />
          </button>

          {/* Desktop Primary Nav */}
          <nav className="hidden lg:flex items-center gap-1 relative">
            <button
              type="button"
              onClick={() => go('home')}
              className={`px-3 py-2 rounded-xl text-sm font-semibold transition-colors ${
                route === 'home' ? 'bg-[#FFF3E5] text-[#FF8500]' : 'text-[#172033] hover:bg-[#F3F6FF]'
              }`}
            >
              {t(lang, 'navHome')}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setCatMenuOpen((prev) => !prev)}
                className={`px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 transition-colors ${
                  isCategoryRoute ? 'bg-[#FFF3E5] text-[#FF8500]' : 'text-[#172033] hover:bg-[#F3F6FF]'
                }`}
              >
                <LayoutGrid className="w-4 h-4 text-[#FF8500]" />
                {t(lang, 'navServices')}
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${catMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {catMenuOpen && (
                <div
                  onMouseLeave={() => setCatMenuOpen(false)}
                  className="absolute left-0 mt-2 w-60 bg-white border border-[#E6ECFA] rounded-2xl shadow-xl p-2 grid grid-cols-1 gap-0.5 z-50"
                >
                  {categoryRoutes.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => go(item.id)}
                      className={`text-left px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                        route === item.id
                          ? 'bg-[#FF8500] text-white'
                          : 'text-[#172033] hover:bg-[#FFF3E5] hover:text-[#FF8500]'
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
              className={`px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 transition-colors ${
                route === 'offers' ? 'bg-[#FFF3E5] text-[#FF8500]' : 'text-[#172033] hover:bg-[#F3F6FF]'
              }`}
            >
              <Tag className="w-4 h-4 text-[#FF8500]" />
              {t(lang, 'navOffers')}
            </button>

            <button
              type="button"
              onClick={() => go('watch-earn')}
              className={`px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 transition-colors ${
                route === 'watch-earn' ? 'bg-[#FFF3E5] text-[#FF8500]' : 'text-[#172033] hover:bg-[#F3F6FF]'
              }`}
            >
              <Film className="w-4 h-4 text-[#FF8500]" />
              {lang === 'bn' ? 'দেখুন ও আয়' : 'Watch & Earn'}
            </button>

            <button
              type="button"
              onClick={() => go('ads')}
              className={`px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 transition-colors ${
                route === 'ads' ? 'bg-[#FFF3E5] text-[#FF8500]' : 'text-[#172033] hover:bg-[#F3F6FF]'
              }`}
            >
              <Megaphone className="w-4 h-4 text-[#FF8500]" />
              {t(lang, 'navAds')}
            </button>

            <button
              type="button"
              onClick={() => go('support')}
              className={`px-3 py-2 rounded-xl text-sm font-semibold flex items-center gap-1.5 transition-colors ${
                route === 'support' ? 'bg-[#FFF3E5] text-[#FF8500]' : 'text-[#172033] hover:bg-[#F3F6FF]'
              }`}
            >
              <Headphones className="w-4 h-4 text-[#FF8500]" />
              {t(lang, 'navSupport')}
            </button>

            {isAdmin && (
              <button
                type="button"
                onClick={() => go('admin')}
                className={`px-3 py-2 rounded-xl text-sm font-bold flex items-center gap-1.5 transition-colors ${
                  route === 'admin'
                    ? 'bg-[#172033] text-white'
                    : 'bg-[#FFF3E5] text-[#FF8500] hover:bg-[#FF8500] hover:text-white'
                }`}
              >
                <Shield className="w-4 h-4" />
                {t(lang, 'navAdmin')}
              </button>
            )}
          </nav>

          {/* Right Header Controls: Language + Wallet Balance + Cart + Profile */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => setLang(lang === 'bn' ? 'en' : 'bn')}
              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-xs font-bold text-[#172033] hover:border-[#FF8500]"
              title="Switch Language"
            >
              <Globe className="w-3.5 h-3.5 text-[#FF8500]" />
              <span>{lang === 'bn' ? 'EN' : 'বাংলা'}</span>
            </button>

            <button
              type="button"
              onClick={() => go('wallet')}
              className="dh-orange-gradient text-white px-3 sm:px-4 py-1.5 sm:py-2 rounded-2xl text-xs sm:text-sm font-bold flex items-center gap-1.5 shadow-sm hover:opacity-95 transition-opacity"
              title={t(lang, 'navWallet')}
            >
              <Wallet className="w-4 h-4 shrink-0" />
              <span className="font-mono-num">৳ {walletBalanceBdt.toFixed(2)}</span>
            </button>

            <button
              type="button"
              onClick={onOpenCart}
              className="relative p-2 rounded-xl bg-[#F3F6FF] border border-[#E6ECFA] text-[#172033] hover:border-[#FF8500] transition-colors"
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
                className="relative flex items-center gap-2 p-0.5 sm:pr-2.5 rounded-full bg-[#F3F6FF] border border-[#E6ECFA] hover:border-[#FF8500] transition-colors"
                title={profile?.displayName || user.phone || user.email || t(lang, 'navAccount')}
              >
                {profile?.photoUrl || user.photoURL ? (
                  <img
                    src={profile?.photoUrl || user.photoURL || ''}
                    alt={profile?.displayName || 'User'}
                    className="w-8 h-8 sm:w-9 sm:h-9 rounded-full object-cover border border-[#FF8500]/40"
                  />
                ) : (
                  <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-[#172033] text-white flex items-center justify-center text-xs font-bold">
                    {(profile?.displayName || user.displayName || user.phone || user.email || 'U').slice(0, 1).toUpperCase()}
                  </div>
                )}
                <span className="hidden xl:inline text-xs font-bold text-[#172033] max-w-[90px] truncate">
                  {profile?.displayName || t(lang, 'navAccount')}
                </span>
                {unreadNotifications > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#DC2626] border-2 border-white" />
                )}
              </button>
            ) : (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="px-3 sm:px-3.5 py-2 rounded-xl bg-[#172033] text-white text-xs font-bold hover:bg-[#23314d] transition-colors"
                >
                  {t(lang, 'signIn')}
                </button>
                <button
                  type="button"
                  onClick={onOpenRegister || onOpenAuth}
                  className="hidden sm:inline-flex px-3.5 py-2 rounded-xl bg-[#FFF3E5] border border-[#FF8500]/30 text-[#FF8500] text-xs font-bold hover:bg-[#FF8500] hover:text-white transition-colors"
                >
                  {lang === 'bn' ? 'সাইনআপ' : 'Sign Up'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Mobile 5-Tab Bottom Navigation matching Reference Screenshot */}
      <nav
        aria-label="Mobile Navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-[#E6ECFA] shadow-[0_-6px_24px_rgba(23,32,51,0.08)] px-2 h-16 flex items-center justify-around"
      >
        <button
          type="button"
          onClick={() => go('home')}
          className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] text-[11px] font-semibold ${
            route === 'home' ? 'text-[#FF8500]' : 'text-[#777777]'
          }`}
        >
          <Home className="w-5 h-5" />
          <span>{t(lang, 'navHome')}</span>
        </button>

        <button
          type="button"
          onClick={() => go('orders')}
          className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] text-[11px] font-semibold ${
            route === 'orders' ? 'text-[#FF8500]' : 'text-[#777777]'
          }`}
        >
          <PackageCheck className="w-5 h-5" />
          <span>{t(lang, 'navOrders')}</span>
        </button>

        <button
          type="button"
          onClick={() => go('add-money')}
          className="relative -top-3.5 flex flex-col items-center justify-center"
        >
          <span className="w-12 h-12 rounded-full dh-orange-gradient text-white flex items-center justify-center shadow-lg border-4 border-white">
            <Plus className="w-6 h-6" />
          </span>
          <span className={`mt-0.5 text-[10px] font-bold ${route === 'add-money' ? 'text-[#FF8500]' : 'text-[#172033]'}`}>
            {t(lang, 'navAddMoney')}
          </span>
        </button>

        <button
          type="button"
          onClick={() => go('wallet')}
          className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] text-[11px] font-semibold ${
            route === 'wallet' ? 'text-[#FF8500]' : 'text-[#777777]'
          }`}
        >
          <Wallet className="w-5 h-5" />
          <span>{t(lang, 'navWallet')}</span>
        </button>

        <button
          type="button"
          onClick={() => (user ? go(isAdmin && route === 'account' ? 'admin' : 'account') : onOpenAuth())}
          className={`flex flex-col items-center justify-center gap-0.5 min-w-[56px] text-[11px] font-semibold relative ${
            route === 'account' || route === 'admin' ? 'text-[#FF8500]' : 'text-[#777777]'
          }`}
        >
          <UserIcon className="w-5 h-5" />
          <span>{t(lang, 'navAccount')}</span>
          {unreadNotifications > 0 && (
            <span className="absolute top-0 right-2 w-2 h-2 rounded-full bg-[#DC2626]" />
          )}
        </button>
      </nav>

      {/* Floating Customer Support Button */}
      {route !== 'support' && route !== 'admin' && (
        <button
          type="button"
          onClick={() => go('support')}
          aria-label={t(lang, 'navSupport')}
          className="fixed right-3 sm:right-5 bottom-20 lg:bottom-6 z-30 w-12 h-12 rounded-full bg-[#172033] text-white shadow-lg border-2 border-[#FF8500] flex items-center justify-center hover:bg-[#FF8500] transition-colors"
        >
          <Headphones className="w-5 h-5" />
        </button>
      )}
    </>
  );
}
