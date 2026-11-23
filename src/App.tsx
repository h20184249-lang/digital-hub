import { FormEvent, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Award,
  CheckCircle2,
  ChevronRight,
  Clock,
  Cpu,
  Flame,
  Gamepad2,
  Gift,
  HelpCircle,
  LayoutGrid,
  Lock,
  RefreshCw,
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Tv,
  Users,
  WifiOff,
  Wrench,
  Zap,
} from 'lucide-react';
import { testConnection } from './lib/firebase';
import { fetchCurrentSession, logoutSession } from './lib/authClient';
import {
  AdNetworkConfig,
  AdRewardTransaction,
  AdViewingSession,
  Advertisement,
  Announcement,
  AppNotification,
  AppRoute,
  AuthUser,
  Banner,
  CartItem,
  Category,
  Coupon,
  DownloadHistoryItem,
  GameItem,
  HeroBanner,
  HomepageSectionConfig,
  Language,
  ManagedAdUnitConfig,
  Order,
  Payment,
  PaymentMethodConfig,
  Product,
  ProductPackage,
  Referral,
  Review,
  RewardedAdClaim,
  SiteSettings,
  SupportTicket,
  UserProfile,
  WalletAccount,
  WalletTransaction,
  WithdrawalRequest,
} from './types/marketplace';
import {
  fetchCustomerDashboardServer,
  subscribeAdNetworks,
  subscribeAdvertisements,
  subscribeAnnouncements,
  subscribeApprovedReviews,
  subscribeBanners,
  subscribeCategories,
  subscribeCoupons,
  subscribeDashboardInvalidation,
  subscribeGames,
  subscribeHeroBanners,
  subscribeManagedAdUnits,
  subscribeMobileApps,
  subscribePaymentMethods,
  subscribeProducts,
  subscribeSiteSettings,
  trackAnalyticsEvent,
} from './lib/firestoreService';
import {
  DEFAULT_AD_NETWORKS,
  DEFAULT_ADVERTISEMENTS,
  DEFAULT_BANNERS,
  DEFAULT_CATEGORIES,
  DEFAULT_COUPONS,
  DEFAULT_HERO_BANNERS,
  DEFAULT_HOMEPAGE_SECTIONS,
  DEFAULT_PRODUCTS,
  DEFAULT_SITE_SETTINGS,
  STUDIO_IMAGES,
} from './lib/seedData';
import { mergeAdUnitsWithOverrides } from './lib/adProviderConfig';
import { DEFAULT_GAMES_CATALOG } from './lib/gamesCatalog';
import { MOBILE_APPS_CATALOG, type MobileAppItem } from './lib/mobileAppsCatalog';
import { t } from './lib/i18n';
import { useOnlineStatus, useSwUpdatePrompt } from './hooks/usePWAInstall';
import { Navbar } from './components/Navbar';
import { BannerSlotView } from './components/BannerSlotView';
import { AdPlayerSection } from './components/AdPlayerSection';
import { ManagedPlacementSlot } from './components/AdUnitFrame';
import { NativeAdRow, SocialBarWidget } from './components/AutomaticAdEngine';
import { WatchEarnHomeBanner } from './components/WatchEarnWidgets';
import { AuthModal } from './components/AuthModal';
import { CartDrawer, getCartItemKey } from './components/CartDrawer';
import { HomepagePaymentSection } from './components/PremiumPaymentSection';
import { ProductCheckoutModal } from './components/ProductCheckoutModal';
import { DigitalHubLogo } from './components/DigitalHubLogo';
import { MobileAppDownloadCard } from './components/MobileAppDownloadCard';
import { CapCutRechargeSection } from './components/CapCutRechargeSection';
import { MobileAppStoreSection } from './components/MobileAppStoreSection';
import { GamesStoreSection } from './components/GamesStoreSection';
import { DailyRewardWidget } from './components/DailyRewardWidget';
import { HomeAnnouncementsBar } from './components/HomeAnnouncementsBar';
import { CategoryCatalogPage, ProductCard } from './components/StorefrontPages';
import { ServiceBrandLogo } from './components/BrandLogos';
import {
  CATALOG_23_CATEGORIES,
  getEffectiveProductAvailability,
  getFirstAvailablePackage,
  getProductCatalogSectionId,
  isPackagePurchasable,
} from './lib/catalogHelpers';

const WatchAndEarnPage = lazy(() =>
  import('./components/WatchAndEarnPage').then((m) => ({ default: m.WatchAndEarnPage }))
);
const ProductDetailPage = lazy(() =>
  import('./components/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage }))
);
const WalletAndAddMoney = lazy(() =>
  import('./components/WalletAndAddMoney').then((m) => ({ default: m.WalletAndAddMoney }))
);
const CustomerDashboard = lazy(() =>
  import('./components/CustomerDashboard').then((m) => ({ default: m.CustomerDashboard }))
);
const AdminDashboard = lazy(() =>
  import('./components/AdminDashboard').then((m) => ({ default: m.AdminDashboard }))
);
const OffersPage = lazy(() =>
  import('./components/StorefrontPages').then((m) => ({ default: m.OffersPage }))
);
const PolicyPage = lazy(() =>
  import('./components/StorefrontPages').then((m) => ({ default: m.PolicyPage }))
);
const SupportAndContactPage = lazy(() =>
  import('./components/StorefrontPages').then((m) => ({ default: m.SupportAndContactPage }))
);

function getAnalyticsVisitorId(): string {
  try {
    const key = 'dh_visitor_id_v1';
    const existing = localStorage.getItem(key);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
    const created = `vis_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, created);
    return created;
  } catch {
    return `vis_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function getAnalyticsSessionId(): string {
  try {
    const key = 'dh_analytics_sess_v1';
    const existing = sessionStorage.getItem(key);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
    const created = `asess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    return 'asess_browser';
  }
}

export default function App() {
  const [detailProductId, setDetailProductId] = useState<string>(
    () => new URLSearchParams(window.location.search).get('product') || ''
  );
  const [route, setRoute] = useState<AppRoute>(() => {
    if (new URLSearchParams(window.location.search).get('product')) return 'product-detail';
    if (window.location.pathname === '/watch-earn') return 'watch-earn';
    if (window.location.pathname === '/mobile-apps' || window.location.pathname === '/apps') return 'mobile-apps';
    if (window.location.pathname === '/games' || window.location.pathname === '/games-store') return 'games-store';
    return 'home';
  });
  const [previousRoute, setPreviousRoute] = useState<AppRoute>('services');
  const [modalInitialTab, setModalInitialTab] = useState<'details' | 'checkout'>('details');
  const [lang, setLang] = useState<Language>('bn');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [wallet, setWallet] = useState<WalletAccount | null>(null);
  const [walletTxs, setWalletTxs] = useState<WalletTransaction[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  const [categories, setCategories] = useState<Category[]>(DEFAULT_CATEGORIES);
  const [products, setProducts] = useState<Product[]>(DEFAULT_PRODUCTS);
  const [advertisements, setAdvertisements] = useState<Advertisement[]>(DEFAULT_ADVERTISEMENTS);
  const [adNetworks, setAdNetworks] = useState<AdNetworkConfig[]>(DEFAULT_AD_NETWORKS);
  const [adUnitOverrides, setAdUnitOverrides] = useState<ManagedAdUnitConfig[]>([]);
  const [banners, setBanners] = useState<Banner[]>(DEFAULT_BANNERS);
  const [heroBanners, setHeroBanners] = useState<HeroBanner[]>(DEFAULT_HERO_BANNERS);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [coupons, setCoupons] = useState<Coupon[]>(DEFAULT_COUPONS);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodConfig[]>([]);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('dh_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {
      // Non-fatal
    }
    return 'light';
  });

  const [orders, setOrders] = useState<Order[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [withdrawals, setWithdrawals] = useState<WithdrawalRequest[]>([]);
  const [rewardClaims, setRewardClaims] = useState<RewardedAdClaim[]>([]);
  const [viewingSessions, setViewingSessions] = useState<AdViewingSession[]>([]);
  const [adRewardTransactions, setAdRewardTransactions] = useState<AdRewardTransaction[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [mobileApps, setMobileApps] = useState<MobileAppItem[]>(() => [...MOBILE_APPS_CATALOG]);
  const [games, setGames] = useState<GameItem[]>(() => [...DEFAULT_GAMES_CATALOG]);
  const [favoriteAppIds, setFavoriteAppIds] = useState<string[]>([]);
  const [downloadHistory, setDownloadHistory] = useState<DownloadHistoryItem[]>([]);
  const [totalDownloads, setTotalDownloads] = useState<number>(0);
  const [analyticsOptOut, setAnalyticsOptOut] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dh_analytics_optout') === '1';
    } catch {
      return false;
    }
  });
  const langRef = useRef<Language>(lang);
  const isOnline = useOnlineStatus();
  const { swUpdateAvailable, applySwUpdate } = useSwUpdatePrompt();

  const [cart, setCart] = useState<CartItem[]>(() => {
    try {
      const saved = localStorage.getItem('dh_cart_v3');
      return saved ? (JSON.parse(saved) as CartItem[]) : [];
    } catch {
      return [];
    }
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | undefined>(undefined);
  const [capturedReferral, setCapturedReferral] = useState<string>(() => {
    const params = new URLSearchParams(window.location.search);
    const refParam = (params.get('ref') || '').trim();
    if (refParam) {
      try {
        localStorage.setItem('dh_ref', refParam);
      } catch {
        // Non-fatal
      }
      return refParam;
    }
    return localStorage.getItem('dh_ref') || '';
  });
  const capturedReferralRef = useRef<string>(capturedReferral);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'register'>(() => {
    const isRegPath = window.location.pathname === '/register';
    const hasRef = Boolean(new URLSearchParams(window.location.search).get('ref'));
    return isRegPath || hasRef ? 'register' : 'login';
  });
  const [authModalOpen, setAuthModalOpen] = useState<boolean>(() => {
    const isRegPath = window.location.pathname === '/register';
    const isLoginPath = window.location.pathname === '/login';
    const hasRef = Boolean(new URLSearchParams(window.location.search).get('ref'));
    return isRegPath || isLoginPath || hasRef;
  });
  const [homeSearch, setHomeSearch] = useState('');
  const [catalogSearchQuery, setCatalogSearchQuery] = useState('');
  const [catalogSectionFilter, setCatalogSectionFilter] = useState('');
  const [heroSlide, setHeroSlide] = useState(0);
  const [toast, setToast] = useState('');

  const managedAdUnits = useMemo(
    () => mergeAdUnitsWithOverrides(adUnitOverrides),
    [adUnitOverrides]
  );

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2600);
  };

  useEffect(() => {
    try {
      localStorage.setItem('dh_cart_v3', JSON.stringify(cart));
    } catch {
      // Non-fatal
    }
  }, [cart]);

  useEffect(() => {
    testConnection();
    const u1 = subscribeCategories(setCategories);
    const u2 = subscribeProducts(setProducts);
    const u3 = subscribeAdvertisements(setAdvertisements);
    const u4 = subscribeBanners(setBanners);
    const u5 = subscribeCoupons(setCoupons);
    const u6 = subscribeApprovedReviews(setReviews);
    const u7 = subscribeSiteSettings(setSettings);
    const u8 = subscribeAdNetworks(setAdNetworks);
    const u9 = subscribeManagedAdUnits(setAdUnitOverrides);
    const u10 = subscribeAnnouncements(setAnnouncements);
    const u11 = subscribePaymentMethods(setPaymentMethods);
    const u12 = subscribeMobileApps(setMobileApps, false);
    const u13 = subscribeGames(setGames, false);
    const u14 = subscribeHeroBanners(setHeroBanners);
    const onResize = () => setIsMobileViewport(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
      u7();
      u8();
      u9();
      u10();
      u11();
      u12();
      u13();
      u14();
      window.removeEventListener('resize', onResize);
    };
  }, []);

  useEffect(() => {
    try {
      const hasUserPref = localStorage.getItem('dh_theme');
      if (!hasUserPref && (settings.defaultTheme === 'dark' || settings.defaultTheme === 'light')) {
        setTheme(settings.defaultTheme);
      }
    } catch {
      // Non-fatal
    }
  }, [settings.defaultTheme]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  useEffect(() => {
    const color = settings.accentColor;
    if (color && /^#[0-9a-fA-F]{6}$/.test(color)) {
      document.documentElement.style.setProperty('--dh-orange', color);
      document.documentElement.style.setProperty('--dh-orange-light', color);
    }
  }, [settings.accentColor]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem('dh_theme', next);
      } catch {
        // Non-fatal
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!settings.faviconUrl) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = settings.faviconUrl;
  }, [settings.faviconUrl]);

  useEffect(() => {
    langRef.current = lang;
  }, [lang]);

  useEffect(() => {
    capturedReferralRef.current = capturedReferral;
  }, [capturedReferral]);

  const clearAuthState = useCallback(() => {
    setUser(null);
    setProfile(null);
    setWallet(null);
    setWalletTxs([]);
    setIsAdmin(false);
    setOrders([]);
    setPayments([]);
    setReferrals([]);
    setNotifications([]);
    setTickets([]);
    setWithdrawals([]);
    setRewardClaims([]);
    setViewingSessions([]);
    setAdRewardTransactions([]);
    setFavoriteAppIds([]);
    setDownloadHistory([]);
    setTotalDownloads(0);
  }, []);

  const handleLogout = useCallback(async () => {
    await logoutSession();
    clearAuthState();
    setRoute('home');
    showToast(
      langRef.current === 'bn'
        ? 'সফলভাবে লগআউট সম্পন্ন হয়েছে।'
        : 'You have been signed out.'
    );
  }, [clearAuthState]);

  const refreshCustomerDashboard = useCallback(async () => {
    const data = await fetchCustomerDashboardServer();
    if (!data) return;
    setUser(data.user);
    setProfile(data.profile);
    setIsAdmin(data.user.role === 'admin' || data.user.role === 'super_admin');
    setWallet(data.wallet);
    setWalletTxs(data.walletTxs || []);
    setOrders(data.orders || []);
    setPayments(data.payments || []);
    setReferrals(data.referrals || []);
    setNotifications(data.notifications || []);
    setTickets(data.tickets || []);
    setWithdrawals(data.withdrawals || []);
    setRewardClaims(data.rewardClaims || []);
    setViewingSessions(data.viewingSessions || []);
    setAdRewardTransactions(data.adRewardTransactions || []);
    setFavoriteAppIds(Array.isArray(data.favoriteAppIds) ? data.favoriteAppIds : []);
    setDownloadHistory(Array.isArray(data.downloadHistory) ? data.downloadHistory : []);
    setTotalDownloads(Number(data.totalDownloads || 0));
    if (Array.isArray(data.announcements)) {
      setAnnouncements(data.announcements);
    }
  }, []);

  // Restore HTTP-only cookie session on initial page load / refresh
  useEffect(() => {
    let active = true;
    fetchCurrentSession()
      .then((session) => {
        if (!active) return;
        if (session.authenticated && session.user) {
          setUser(session.user);
          setProfile(session.profile);
          setIsAdmin(session.isAdmin);
          const path = window.location.pathname;
          if (session.user.role === 'super_admin') {
            setAuthModalOpen(false);
            setRoute((prev) =>
              prev === 'home' || path === '/login' || path === '/register' || path === '/admin'
                ? 'admin'
                : prev
            );
          } else if (!session.isAdmin) {
            setRoute((prev) => (prev === 'admin' ? 'account' : prev));
            if (path === '/login' || path === '/register') {
              setAuthModalOpen(false);
            }
          }
        } else {
          clearAuthState();
        }
      })
      .catch(() => {
        if (active) clearAuthState();
      });
    return () => {
      active = false;
    };
  }, [clearAuthState]);

  // Keep signed-in customer dashboard synced with server DB
  useEffect(() => {
    if (!user?.uid) return;
    refreshCustomerDashboard().catch(() => {});
    const unsub = subscribeDashboardInvalidation(() => {
      refreshCustomerDashboard().catch(() => {});
    });
    const onFocus = () => {
      refreshCustomerDashboard().catch(() => {});
    };
    window.addEventListener('focus', onFocus);
    return () => {
      unsub();
      window.removeEventListener('focus', onFocus);
    };
  }, [user?.uid, refreshCustomerDashboard]);

  const activeHeroSlides = useMemo(() => {
    let todayDhaka = '';
    try {
      todayDhaka = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Dhaka',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      todayDhaka = new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 10);
    }
    return heroBanners
      .filter((b) => {
        if (!b.enabled) return false;
        if (b.startDate && b.startDate > todayDhaka) return false;
        if (b.endDate && b.endDate < todayDhaka) return false;
        if (b.deviceVisibility === 'mobile' && !isMobileViewport) return false;
        if (b.deviceVisibility === 'desktop' && isMobileViewport) return false;
        return true;
      })
      .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99));
  }, [heroBanners, isMobileViewport]);

  const heroIntervalMs = useMemo(
    () => Math.min(20000, Math.max(2000, Number(settings.heroAutoPlayMs || 5500) || 5500)),
    [settings.heroAutoPlayMs]
  );

  useEffect(() => {
    if (activeHeroSlides.length <= 1) return;
    const timer = setInterval(
      () => setHeroSlide((s) => (s + 1) % activeHeroSlides.length),
      heroIntervalMs
    );
    return () => clearInterval(timer);
  }, [activeHeroSlides.length, heroIntervalMs]);

  const detailProduct = useMemo(
    () => products.find((p) => p.id === detailProductId) || null,
    [products, detailProductId]
  );

  const openProductDetail = (p: Product) => {
    setPreviousRoute(route === 'product-detail' ? previousRoute : route);
    setDetailProductId(p.id);
    setRoute('product-detail');
  };

  const openQuickOrder = (p: Product) => {
    setSelectedPackageId(undefined);
    setModalInitialTab(p.packages && p.packages.length > 0 ? 'details' : 'checkout');
    setSelectedProduct(p);
  };

  const openPackageCheckout = (p: Product, pkg: ProductPackage) => {
    setSelectedPackageId(pkg.id);
    setModalInitialTab('checkout');
    setSelectedProduct(p);
  };

  useEffect(() => {
    const brand = (settings.siteName || 'DIGITAL HUB').trim();
    const titleMap: Record<AppRoute, string> = {
      home: `${brand} — Your Complete Digital Services Marketplace`,
      services: `All Digital & Gaming Services — ${brand}`,
      'gaming-store': `Gaming Top-Ups & Passes — ${brand}`,
      'gift-cards': `Gift Cards & Game Vouchers — ${brand}`,
      'streaming-store': `Streaming & OTT Subscriptions — ${brand}`,
      'telegram-store': `Telegram Store — ${brand}`,
      'vip-groups': `Telegram VIP Groups — ${brand}`,
      'telegram-stars': `Telegram Stars — ${brand}`,
      'ai-marketplace': `AI Tools Marketplace — ${brand}`,
      'mobile-apps': `Mobile App Store — ${brand}`,
      'games-store': `Games Store — ${brand}`,
      'software-store': `Software Store — ${brand}`,
      'digital-products': `Digital Products — ${brand}`,
      'graphic-design': `Graphic Design Services — ${brand}`,
      'social-media': `Social Media Services — ${brand}`,
      'product-detail': detailProduct
        ? `${detailProduct.titleEn} — ${brand}`
        : `Service Details — ${brand}`,
      offers: `Special Offers & Coupons — ${brand}`,
      ads: `Sponsored Partner Network — ${brand}`,
      'watch-earn': `Watch & Earn — ${brand}`,
      orders: `My Orders — ${brand}`,
      'add-money': `Add Money — ${brand}`,
      wallet: `My Wallet — ${brand}`,
      account: `My Account — ${brand}`,
      support: `Customer Support — ${brand}`,
      about: `About Us — ${brand}`,
      contact: `Contact Us — ${brand}`,
      privacy: `Privacy Policy — ${brand}`,
      terms: `Terms & Conditions — ${brand}`,
      refund: `Refund Policy — ${brand}`,
      admin: `Super Admin Dashboard — ${brand}`,
    };
    document.title = titleMap[route] || brand;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [route, detailProduct, settings.siteName]);

  // Privacy-respecting visitor analytics & live online heartbeat
  useEffect(() => {
    const dnt = typeof navigator !== 'undefined' && navigator.doNotTrack === '1';
    if (analyticsOptOut || dnt) return;
    const pagePath =
      route === 'product-detail' && detailProductId
        ? `/product/${detailProductId}`
        : route === 'home'
          ? '/'
          : route === 'mobile-apps'
            ? '/apps'
            : route === 'games-store'
              ? '/games'
              : `/${route}`;
    let refHost = '';
    try {
      if (document.referrer) refHost = new URL(document.referrer).hostname;
    } catch {
      refHost = '';
    }
    const visitorId = getAnalyticsVisitorId();
    const sessionId = getAnalyticsSessionId();
    const deviceType: 'mobile' | 'desktop' = window.innerWidth < 768 ? 'mobile' : 'desktop';

    void trackAnalyticsEvent({
      visitorId,
      sessionId,
      eventType: 'page_view',
      pagePath,
      deviceType,
      referrerHost: refHost,
    });
    if (route === 'home') {
      void trackAnalyticsEvent({
        visitorId,
        sessionId,
        eventType: 'homepage_view',
        pagePath: '/',
        deviceType,
        referrerHost: refHost,
      });
    }

    const hb = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void trackAnalyticsEvent({
          visitorId,
          sessionId,
          eventType: 'heartbeat',
          pagePath,
          deviceType,
        });
      }
    }, 60000);
    return () => window.clearInterval(hb);
  }, [route, detailProductId, analyticsOptOut]);

  const openCatalogSection = (sectionId: string) => {
    setCatalogSearchQuery('');
    setCatalogSectionFilter(sectionId);
    setRoute('services');
  };

  const handleAddToCart = (product: Product, qty = 1, selectedPackage?: ProductPackage) => {
    if (getEffectiveProductAvailability(product) === 'out_of_stock') {
      showToast(
        lang === 'bn'
          ? `${product.titleBn} বর্তমানে স্টকে নেই (Out of Stock)।`
          : `${product.titleEn} is currently Out of Stock.`
      );
      return;
    }
    const pkg = selectedPackage || getFirstAvailablePackage(product);
    if (!isPackagePurchasable(pkg, product)) {
      showToast(
        lang === 'bn'
          ? 'নির্বাচিত প্যাকেজটি বর্তমানে স্টকে নেই (Out of Stock)।'
          : 'Selected package is currently Out of Stock.'
      );
      return;
    }
    const itemToAdd: CartItem = { product, quantity: qty, selectedPackage: pkg };
    const targetKey = getCartItemKey(itemToAdd);

    setCart((prev) => {
      const idx = prev.findIndex((i) => getCartItemKey(i) === targetKey);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], quantity: Math.min(20, next[idx].quantity + qty) };
        return next;
      }
      return [...prev, itemToAdd];
    });
    const pkgLabel = pkg ? ` (${lang === 'bn' ? pkg.nameBn : pkg.nameEn})` : '';
    showToast(
      lang === 'bn'
        ? `${product.titleBn}${pkgLabel} কার্টে যোগ হয়েছে`
        : `${product.titleEn}${pkgLabel} added to cart`
    );
  };

  const handleUpdateQty = (cartKey: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((i) => getCartItemKey(i) !== cartKey));
      return;
    }
    setCart((prev) =>
      prev.map((i) => (getCartItemKey(i) === cartKey ? { ...i, quantity: Math.min(20, qty) } : i))
    );
  };

  const handleHomeSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    setCatalogSectionFilter('');
    setCatalogSearchQuery(homeSearch.trim());
    setRoute('services');
  };

  const unreadNotifications = notifications.filter((n) => !n.read).length;
  const cartCount = cart.reduce((s, it) => s + it.quantity, 0);

  const flashSaleProducts = useMemo(
    () => products.filter((p) => p.active && p.sectionTag === 'flash_sale'),
    [products]
  );
  const hotProducts = useMemo(
    () => products.filter((p) => p.active && (p.sectionTag === 'hot_product' || p.featured)),
    [products]
  );
  const trendingProducts = useMemo(
    () => products.filter((p) => p.active && p.sectionTag === 'trending'),
    [products]
  );
  const bestSellerProducts = useMemo(
    () => products.filter((p) => p.active && p.sectionTag === 'best_seller'),
    [products]
  );
  const newArrivalProducts = useMemo(
    () => products.filter((p) => p.active && p.sectionTag === 'new_arrival'),
    [products]
  );
  const gamingAndGiftProducts = useMemo(
    () =>
      products.filter(
        (p) => p.active && (p.categoryId === 'cat_gaming' || p.categoryId === 'cat_giftcards')
      ),
    [products]
  );
  const streamingAndAiProducts = useMemo(
    () =>
      products.filter(
        (p) => p.active && (p.categoryId === 'cat_streaming' || p.categoryId === 'cat_ai')
      ),
    [products]
  );

  const safeHeroIndex = activeHeroSlides.length > 0 ? heroSlide % activeHeroSlides.length : 0;
  const activeSlide = activeHeroSlides[safeHeroIndex] || null;

  const quickButtons: { label: string; route: AppRoute; icon: typeof Send }[] = [
    { label: lang === 'bn' ? 'গেমিং টপ-আপ' : 'Gaming Top-Up', route: 'gaming-store', icon: Gamepad2 },
    { label: lang === 'bn' ? 'গিফট কার্ড' : 'Gift Cards', route: 'gift-cards', icon: Gift },
    { label: lang === 'bn' ? 'স্ট্রিমিং ওটিটি' : 'Streaming OTT', route: 'streaming-store', icon: Tv },
    { label: lang === 'bn' ? 'টেলিগ্রাম স্টোর' : 'Telegram Store', route: 'telegram-store', icon: Send },
    { label: lang === 'bn' ? 'ভিআইপি গ্রুপ' : 'VIP Groups', route: 'vip-groups', icon: Users },
    { label: lang === 'bn' ? 'এআই মার্কেটপ্লেস' : 'AI Tools', route: 'ai-marketplace', icon: Cpu },
    { label: lang === 'bn' ? 'সফটওয়্যার স্টোর' : 'Software Store', route: 'software-store', icon: LayoutGrid },
    { label: lang === 'bn' ? 'সোশ্যাল মিডিয়া' : 'Social Media', route: 'social-media', icon: Share2 },
  ];

  const isCatalogRoute = [
    'services',
    'gaming-store',
    'gift-cards',
    'streaming-store',
    'telegram-store',
    'vip-groups',
    'telegram-stars',
    'ai-marketplace',
    'software-store',
    'digital-products',
    'graphic-design',
    'social-media',
  ].includes(route);

  const orderedHomepageSections = useMemo(() => {
    const configured =
      Array.isArray(settings.homepageSections) && settings.homepageSections.length > 0
        ? settings.homepageSections
        : DEFAULT_HOMEPAGE_SECTIONS;
    const byId = new Map<string, HomepageSectionConfig>();
    DEFAULT_HOMEPAGE_SECTIONS.forEach((sec) => byId.set(sec.id, sec));
    configured.forEach((sec) => byId.set(sec.id, sec));
    return Array.from(byId.values()).sort((a, b) => a.order - b.order);
  }, [settings.homepageSections]);

  const isMaintenanceBlocked = Boolean(settings.maintenanceMode && !isAdmin);

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-clip flex flex-col bg-[#F3F6FF] dark:bg-slate-950 text-[#172033] dark:text-slate-100 pb-20 lg:pb-0 transition-colors">
      {!isMaintenanceBlocked && route !== 'admin' && (
        <Navbar
          route={route}
          setRoute={(r) => {
            setCatalogSearchQuery('');
            setCatalogSectionFilter('');
            setRoute(r);
          }}
          lang={lang}
          setLang={setLang}
          theme={theme}
          onToggleTheme={toggleTheme}
          settings={settings}
          siteName={settings.siteName}
          logoUrl={settings.logoUrl}
          user={user}
          profile={profile}
          walletBalanceBdt={wallet?.availableBalanceBdt || 0}
          cartCount={cartCount}
          onOpenCart={() => setCartOpen(true)}
          isAdmin={isAdmin}
          unreadNotifications={unreadNotifications}
          onOpenAuth={() => {
            setAuthInitialMode('login');
            setAuthModalOpen(true);
          }}
          onOpenRegister={() => {
            setAuthInitialMode('register');
            setAuthModalOpen(true);
          }}
          announcementText={lang === 'bn' ? settings.announcementBn : settings.announcementEn}
        />
      )}

      {!isMaintenanceBlocked && route !== 'admin' && (
        <div className="max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-2 overflow-hidden">
          <ManagedPlacementSlot
            placement="top_header"
            units={managedAdUnits}
            adsEnabled={settings.adsEnabled}
            lang={lang}
          />
        </div>
      )}

      {!isOnline && (
        <div className="bg-amber-600 text-white px-4 py-1.5 text-center text-xs font-bold flex items-center justify-center gap-2">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span>
            {lang === 'bn'
              ? 'অফলাইন মোড চালু — সংরক্ষিত পেজ প্রদর্শিত হচ্ছে'
              : 'You are offline — showing cached content'}
          </span>
        </div>
      )}

      {swUpdateAvailable && (
        <div className="fixed bottom-20 lg:bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-2xl bg-[#172033] text-white text-xs font-bold shadow-2xl border border-[#FF8500] flex items-center gap-3">
          <span>
            {lang === 'bn' ? 'নতুন ভার্সন আপডেট এসেছে' : 'New version available'}
          </span>
          <button
            type="button"
            onClick={() => void applySwUpdate()}
            className="px-3 py-1 rounded-xl bg-[#FF8500] text-white font-extrabold inline-flex items-center gap-1 cursor-pointer hover:opacity-90"
          >
            <RefreshCw className="w-3 h-3" />
            <span>{lang === 'bn' ? 'রিলোড করুন' : 'Reload'}</span>
          </button>
        </div>
      )}

      {toast && (
        <div className="fixed top-20 right-3 sm:right-4 z-50 max-w-[calc(100vw-1.5rem)] sm:max-w-md px-4 py-2.5 rounded-2xl bg-[#172033] text-white text-xs font-bold shadow-xl border border-[#FF8500] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#FF8500] shrink-0" />
          <span className="break-words">{toast}</span>
        </div>
      )}

      <main className="flex-1 w-full min-w-0">
        <Suspense
          fallback={
            <div className="min-h-[60vh] flex items-center justify-center p-8">
              <div className="w-8 h-8 rounded-full border-2 border-[#FF8500] border-t-transparent animate-spin" />
            </div>
          }
        >
        {isMaintenanceBlocked ? (
          <div className="min-h-[82vh] flex items-center justify-center px-4 py-12">
            <div className="max-w-lg w-full rounded-3xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-800 shadow-lg p-7 sm:p-9 text-center space-y-5">
              <div className="flex justify-center">
                <DigitalHubLogo siteName={settings.siteName} logoUrl={settings.logoUrl} />
              </div>
              <div className="w-14 h-14 rounded-2xl bg-[#FFF3E5] dark:bg-orange-950/50 text-[#FF8500] flex items-center justify-center mx-auto">
                <Wrench className="w-7 h-7" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-extrabold text-[#172033] dark:text-slate-100">
                  {lang === 'bn' ? 'সিস্টেম রক্ষণাবেক্ষণ চলছে' : 'Scheduled Maintenance in Progress'}
                </h1>
                <p className="text-sm text-[#777777] dark:text-slate-400 leading-relaxed">
                  {lang === 'bn'
                    ? `${settings.siteName || 'DIGITAL HUB'} বর্তমানে আপগ্রেড ও নিরাপত্তার কাজে সাময়িকভাবে বন্ধ আছে। খুব শীঘ্রই আমরা ফিরে আসছি।`
                    : `${settings.siteName || 'DIGITAL HUB'} is temporarily offline for scheduled maintenance and upgrades. Please check back shortly.`}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-xs">
                {settings.contactEmail && (
                  <a
                    href={`mailto:${settings.contactEmail}`}
                    className="px-3.5 py-2 rounded-xl bg-[#F3F6FF] dark:bg-slate-800 text-[#172033] dark:text-slate-200 font-semibold"
                  >
                    {settings.contactEmail}
                  </a>
                )}
                {settings.telegramLink && (
                  <a
                    href={settings.telegramLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2 rounded-xl bg-[#0088cc]/10 text-[#0088cc] font-bold"
                  >
                    Telegram Support
                  </a>
                )}
                {settings.whatsappLink && (
                  <a
                    href={settings.whatsappLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3.5 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-[#16A34A] font-bold"
                  >
                    WhatsApp
                  </a>
                )}
              </div>
              <div className="pt-3 border-t border-[#E6ECFA] dark:border-slate-800 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setAuthInitialMode('login');
                    setAuthModalOpen(true);
                  }}
                  className="px-4 py-2 rounded-xl bg-[#172033] dark:bg-[#FF8500] text-white text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Lock className="w-3.5 h-3.5" />
                  {lang === 'bn' ? 'অ্যাডমিন লগইন' : 'Admin Sign In'}
                </button>
              </div>
            </div>
          </div>
        ) : (
        <>
        {user && profile?.status === 'suspended' && (
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-4">
            <div className="p-3.5 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-[#DC2626] text-xs sm:text-sm font-bold flex flex-wrap items-center justify-between gap-2">
              <span>
                {lang === 'bn'
                  ? 'সতর্কতা: আপনার অ্যাকাউন্টটি অ্যাডমিন কর্তৃক সাময়িকভাবে ব্লক করা হয়েছে। নতুন অর্ডার বা উইথড্রয়াল বন্ধ রয়েছে।'
                  : 'Notice: Your account is currently suspended by the administrator. New orders, withdrawals, and ad reward claims are disabled.'}
              </span>
              <button
                type="button"
                onClick={() => setRoute('support')}
                className="px-3 py-1 rounded-xl bg-[#DC2626] text-white text-xs font-bold"
              >
                {lang === 'bn' ? 'সাপোর্টে যোগাযোগ' : 'Contact Support'}
              </button>
            </div>
          </div>
        )}
        {route === 'home' && (
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6">
            <div className="min-w-0 space-y-6 sm:space-y-8">
              <HomeAnnouncementsBar announcements={announcements} lang={lang} />
              {orderedHomepageSections
                .filter((sec) => sec.visible)
                .map((sec) => {
                  switch (sec.id) {
                    case 'hero':
                      return (
                        <section key="hero" className="space-y-3">
                          {activeSlide && (
                            <div className="relative rounded-3xl overflow-hidden shadow-lg bg-[#172033] min-h-[220px] sm:min-h-[280px] flex items-center group">
                              <img
                                src={
                                  isMobileViewport && activeSlide.mobileImageUrl
                                    ? activeSlide.mobileImageUrl
                                    : activeSlide.imageUrl || STUDIO_IMAGES.hero
                                }
                                alt={lang === 'bn' ? activeSlide.titleBn : activeSlide.titleEn}
                                onError={(e) => {
                                  e.currentTarget.src = STUDIO_IMAGES.hero;
                                }}
                                className="absolute inset-0 w-full h-full object-cover opacity-55 transition-all duration-500"
                              />
                              <div className="absolute inset-0 bg-gradient-to-r from-[#172033] via-[#172033]/85 to-[#172033]/40" />

                              {activeHeroSlides.length > 1 && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setHeroSlide(
                                        (s) => (s - 1 + activeHeroSlides.length) % activeHeroSlides.length
                                      )
                                    }
                                    aria-label="Previous slide"
                                    className="hidden sm:flex absolute left-3 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/35 hover:bg-[#FF8500] text-white items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <ArrowLeft className="w-4 h-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setHeroSlide((s) => (s + 1) % activeHeroSlides.length)
                                    }
                                    aria-label="Next slide"
                                    className="hidden sm:flex absolute right-3 top-1/2 -translate-y-1/2 z-20 w-8 h-8 rounded-full bg-black/35 hover:bg-[#FF8500] text-white items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                  >
                                    <ArrowRight className="w-4 h-4" />
                                  </button>
                                </>
                              )}

                              <div className="relative z-10 w-full p-5 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-5">
                                <div className="max-w-xl space-y-2.5">
                                  {(activeSlide.badgeBn || activeSlide.badgeEn) && (
                                    <span className="inline-block px-2.5 py-0.5 rounded-md bg-[#FF8500] text-white text-[11px] font-extrabold tracking-wide">
                                      {lang === 'bn'
                                        ? activeSlide.badgeBn || activeSlide.badgeEn
                                        : activeSlide.badgeEn || activeSlide.badgeBn}
                                    </span>
                                  )}
                                  <h1 className="text-xl sm:text-3xl font-extrabold text-white leading-tight">
                                    {lang === 'bn'
                                      ? activeSlide.titleBn || activeSlide.titleEn
                                      : activeSlide.titleEn || activeSlide.titleBn}
                                  </h1>
                                  <p className="text-xs sm:text-sm text-white/80 leading-relaxed">
                                    {lang === 'bn'
                                      ? activeSlide.subtitleBn || activeSlide.subtitleEn
                                      : activeSlide.subtitleEn || activeSlide.subtitleBn}
                                  </p>
                                  <div className="pt-1 flex flex-wrap items-center gap-2.5">
                                    {activeSlide.linkType === 'external_url' && activeSlide.targetUrl ? (
                                      <a
                                        href={activeSlide.targetUrl}
                                        target={activeSlide.openInNewTab ? '_blank' : '_self'}
                                        rel="noopener noreferrer"
                                        className="px-4 sm:px-5 py-2 rounded-full bg-[#FACC15] hover:bg-[#fde047] text-[#172033] text-xs sm:text-sm font-extrabold inline-flex items-center gap-1.5 shadow-md"
                                      >
                                        <span>
                                          {(lang === 'bn' ? activeSlide.buttonTextBn : activeSlide.buttonTextEn) ||
                                            t(lang, 'shopNow')}
                                        </span>
                                        <ArrowRight className="w-4 h-4" />
                                      </a>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setRoute(activeSlide.ctaRoute || 'services')}
                                        className="px-4 sm:px-5 py-2 rounded-full bg-[#FACC15] hover:bg-[#fde047] text-[#172033] text-xs sm:text-sm font-extrabold inline-flex items-center gap-1.5 shadow-md"
                                      >
                                        <span>
                                          {(lang === 'bn' ? activeSlide.buttonTextBn : activeSlide.buttonTextEn) ||
                                            t(lang, 'shopNow')}
                                        </span>
                                        <ArrowRight className="w-4 h-4" />
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setRoute('add-money')}
                                      className="px-4 py-2 rounded-full bg-white/15 hover:bg-white/25 text-white text-xs sm:text-sm font-bold backdrop-blur-xs"
                                    >
                                      + {t(lang, 'navAddMoney')}
                                    </button>
                                  </div>
                                </div>

                                <ul className="hidden md:flex flex-col gap-1.5 bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/15 text-xs text-white font-semibold shrink-0">
                                  {[
                                    lang === 'bn' ? 'ফ্রি ফায়ার, PUBG, MLBB ও Valorant' : 'Free Fire, PUBG, MLBB & Valorant',
                                    lang === 'bn' ? 'Netflix, Spotify, YouTube ও Chorki' : 'Netflix, Spotify, YouTube & Chorki',
                                    lang === 'bn' ? 'টেলিগ্রাম প্রিমিয়াম, স্টার্স ও ভিআইপি' : 'Telegram Premium, Stars & VIP',
                                    lang === 'bn' ? 'যাচাইকৃত বিকাশ, নগদ ও রকেট পেমেন্ট' : 'Verified bKash, Nagad & Rocket',
                                  ].map((line) => (
                                    <li key={line} className="flex items-center gap-2">
                                      <CheckCircle2 className="w-4 h-4 text-[#FACC15] shrink-0" />
                                      <span>{line}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          )}

                          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                            <form onSubmit={handleHomeSearchSubmit} className="relative w-full sm:max-w-md">
                              <Search className="w-4 h-4 text-[#777777] absolute left-3.5 top-1/2 -translate-y-1/2" />
                              <input
                                type="text"
                                value={homeSearch}
                                onChange={(e) => setHomeSearch(e.target.value)}
                                placeholder={t(lang, 'searchPlaceholder')}
                                className="w-full pl-10 pr-24 py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-[#E6ECFA] dark:border-slate-700 text-xs sm:text-sm shadow-xs focus:outline-none focus:border-[#FF8500]"
                              />
                              <button
                                type="submit"
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3.5 py-1.5 rounded-xl dh-orange-gradient text-white text-xs font-bold"
                              >
                                {lang === 'bn' ? 'খুঁজুন' : 'Search'}
                              </button>
                            </form>

                            {activeHeroSlides.length > 1 && (
                              <div className="flex justify-center gap-1.5">
                                {activeHeroSlides.map((s, idx) => (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => setHeroSlide(idx)}
                                    aria-label={`Slide ${idx + 1}`}
                                    className={`h-1.5 rounded-full transition-all ${
                                      safeHeroIndex === idx ? 'w-6 bg-[#FF8500]' : 'w-2.5 bg-gray-300 dark:bg-slate-700'
                                    }`}
                                  />
                                ))}
                              </div>
                            )}
                          </div>
                        </section>
                      );

                    case 'daily_reward':
                      return (
                        <DailyRewardWidget
                          key="daily_reward"
                          lang={lang}
                          user={user}
                          onOpenAuth={() => {
                            setAuthInitialMode('login');
                            setAuthModalOpen(true);
                          }}
                          onClaimed={(msg) => showToast(msg)}
                        />
                      );

                    case 'quick_categories':
                      return (
                        <section key="quick_categories" className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-2.5">
                          {quickButtons.map((btn) => {
                            const Icon = btn.icon;
                            return (
                              <button
                                key={btn.route}
                                type="button"
                                onClick={() => setRoute(btn.route)}
                                className="dh-orange-gradient text-white rounded-2xl px-2.5 py-3 flex items-center gap-2 shadow-sm hover:opacity-95 transition-opacity text-left"
                              >
                                <span className="w-8 h-8 rounded-full bg-white text-[#FF8500] flex items-center justify-center shrink-0 shadow-xs">
                                  <Icon className="w-4 h-4" />
                                </span>
                                <span className="text-[11px] font-bold leading-tight line-clamp-2">
                                  {btn.label}
                                </span>
                              </button>
                            );
                          })}
                        </section>
                      );

                    case 'browse_23':
                      return (
                        <section key="browse_23" className="dh-card rounded-3xl p-4 sm:p-5 space-y-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <LayoutGrid className="w-4 h-4 text-[#FF8500]" />
                              <h2 className="text-sm sm:text-base font-extrabold text-[#172033]">
                                {lang === 'bn' ? 'সকল ২৩টি সার্ভিস ক্যাটাগরি' : 'Browse All 23 Catalog Categories'}
                              </h2>
                            </div>
                            <button
                              type="button"
                              onClick={() => openCatalogSection('')}
                              className="text-xs font-bold text-[#FF8500] hover:underline flex items-center gap-0.5"
                            >
                              <span>{t(lang, 'viewAll')}</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                            {CATALOG_23_CATEGORIES.map((cSec) => {
                              const matchedProds = products.filter(
                                (p) => p.active && getProductCatalogSectionId(p) === cSec.id
                              );
                              const pkgTotal = matchedProds.reduce(
                                (sum, p) => sum + Math.max(1, p.packages?.length || 1),
                                0
                              );
                              return (
                                <button
                                  key={cSec.id}
                                  type="button"
                                  onClick={() => openCatalogSection(cSec.id)}
                                  className="flex items-center gap-2 p-2 rounded-2xl bg-[#F3F6FF] hover:bg-[#FFF3E5] border border-[#E6ECFA] hover:border-[#FF8500]/50 transition-colors text-left group"
                                >
                                  <ServiceBrandLogo brandKey={cSec.brandKey} size={32} />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-bold text-[#172033] group-hover:text-[#FF8500] leading-tight line-clamp-2">
                                      {lang === 'bn' ? cSec.shortBn : cSec.shortEn}
                                    </p>
                                    {pkgTotal > 0 && (
                                      <p className="text-[10px] font-mono-num text-[#777777]">
                                        {pkgTotal} {lang === 'bn' ? 'প্যাক' : 'packs'}
                                      </p>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      );

                    case 'pwa_card':
                      return <MobileAppDownloadCard key="pwa_card" lang={lang} siteName={settings.siteName} />;

                    case 'watch_earn':
                      return (
                        <div key="watch_earn" className="space-y-6">
                          <WatchEarnHomeBanner
                            lang={lang}
                            user={user}
                            profile={profile}
                            wallet={wallet}
                            settings={settings}
                            advertisements={advertisements}
                            managedAdUnits={managedAdUnits}
                            adNetworks={adNetworks}
                            onNavigate={setRoute}
                            onOpenAuth={() => {
                              setAuthInitialMode('login');
                              setAuthModalOpen(true);
                            }}
                            onToast={showToast}
                          />
                          <BannerSlotView
                            slot="home_top"
                            banners={banners}
                            adNetworks={adNetworks}
                            adsEnabled={settings.adsEnabled}
                            lang={lang}
                          />
                          <ManagedPlacementSlot
                            placement="home_main"
                            units={managedAdUnits}
                            adsEnabled={settings.adsEnabled}
                            lang={lang}
                          />
                        </div>
                      );

                    case 'capcut_recharge':
                      return (
                        <CapCutRechargeSection
                          key="capcut_recharge"
                          products={products}
                          lang={lang}
                          onOrderPackage={openPackageCheckout}
                          onAddToCart={(prod, pkg) => handleAddToCart(prod, 1, pkg)}
                        />
                      );

                    case 'featured_apps':
                      return (
                        <MobileAppStoreSection
                          key="featured_apps"
                          mode="home"
                          lang={lang}
                          settings={settings}
                          paymentMethods={paymentMethods}
                          user={user}
                          profile={profile}
                          wallet={wallet}
                          maxHomeItems={sec.limit || 12}
                          onOpenAuth={() => {
                            setAuthInitialMode('login');
                            setAuthModalOpen(true);
                          }}
                          onNavigateAll={() => setRoute('mobile-apps')}
                          onGoToOrders={() => setRoute('orders')}
                        />
                      );

                    case 'featured_games':
                      return (
                        <GamesStoreSection
                          key="featured_games"
                          mode="home"
                          lang={lang}
                          games={games}
                          products={products}
                          maxHomeItems={sec.limit || 8}
                          onSelectProduct={openProductDetail}
                          onNavigateAll={() => setRoute('games-store')}
                        />
                      );

                    case 'gaming_topups':
                      return gamingAndGiftProducts.length > 0 ? (
                        <section key="gaming_topups" className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Gamepad2 className="w-5 h-5 text-[#FF8500]" />
                              <h2 className="text-lg sm:text-xl font-extrabold text-[#172033] tracking-tight">
                                {t(lang, 'gamingTopUpsTitle')}
                              </h2>
                            </div>
                            <button
                              type="button"
                              onClick={() => setRoute('gaming-store')}
                              className="px-3.5 py-1.5 rounded-full dh-orange-gradient text-white text-xs font-bold flex items-center gap-1"
                            >
                              <span>{t(lang, 'viewAll')}</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                            {gamingAndGiftProducts.slice(0, sec.limit || 8).map((p) => (
                              <ProductCard
                                key={p.id}
                                product={p}
                                lang={lang}
                                onSelect={openProductDetail}
                                onQuickOrder={openQuickOrder}
                                onAddToCart={(prod) => handleAddToCart(prod, 1)}
                              />
                            ))}
                          </div>
                        </section>
                      ) : null;

                    case 'flash_sale':
                      return (
                        <section key="flash_sale" className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Zap className="w-5 h-5 text-[#FF8500] fill-[#FF8500]" />
                              <h2 className="text-lg sm:text-xl font-extrabold text-[#172033] tracking-tight">
                                {t(lang, 'flashSale')}
                              </h2>
                            </div>
                            <button
                              type="button"
                              onClick={() => setRoute('offers')}
                              className="px-3.5 py-1.5 rounded-full dh-orange-gradient text-white text-xs font-bold flex items-center gap-1"
                            >
                              <span>{t(lang, 'viewAll')}</span>
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                            {(flashSaleProducts.length > 0 ? flashSaleProducts : products.filter((p) => p.active).slice(0, 4))
                              .slice(0, sec.limit || 4)
                              .map((p) => (
                                <ProductCard
                                  key={p.id}
                                  product={p}
                                  lang={lang}
                                  onSelect={openProductDetail}
                                  onQuickOrder={openQuickOrder}
                                  onAddToCart={(prod) => handleAddToCart(prod, 1)}
                                />
                              ))}
                          </div>
                        </section>
                      );

                    case 'hot_products':
                      return (
                        <div key="hot_products" className="space-y-6">
                          <section className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Flame className="w-5 h-5 text-[#FF8500] fill-[#FF8500]" />
                                <h2 className="text-lg sm:text-xl font-extrabold text-[#172033] tracking-tight">
                                  {t(lang, 'hotProducts')}
                                </h2>
                              </div>
                              <button
                                type="button"
                                onClick={() => setRoute('services')}
                                className="px-3.5 py-1.5 rounded-full dh-orange-gradient text-white text-xs font-bold flex items-center gap-1"
                              >
                                <span>{t(lang, 'viewAll')}</span>
                                <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                              {(hotProducts.length > 0 ? hotProducts : products.filter((p) => p.active).slice(0, 8))
                                .slice(0, sec.limit || 8)
                                .map((p) => (
                                  <ProductCard
                                    key={p.id}
                                    product={p}
                                    lang={lang}
                                    onSelect={openProductDetail}
                                    onQuickOrder={openQuickOrder}
                                    onAddToCart={(prod) => handleAddToCart(prod, 1)}
                                  />
                                ))}
                            </div>
                          </section>
                          <BannerSlotView
                            slot="between_sections"
                            banners={banners}
                            adNetworks={adNetworks}
                            adsEnabled={settings.adsEnabled}
                            lang={lang}
                          />
                          <ManagedPlacementSlot
                            placement="slider"
                            variant="slider"
                            units={managedAdUnits}
                            adsEnabled={settings.adsEnabled}
                            lang={lang}
                          />
                          <NativeAdRow
                            placement="between_sections"
                            advertisements={advertisements}
                            adNetworks={adNetworks}
                            adsEnabled={settings.adsEnabled}
                            lang={lang}
                            maxCards={3}
                          />
                        </div>
                      );

                    case 'streaming_ai':
                      return streamingAndAiProducts.length > 0 ? (
                        <section key="streaming_ai" className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Tv className="w-5 h-5 text-[#FF8500]" />
                              <h2 className="text-lg sm:text-xl font-extrabold text-[#172033]">
                                {t(lang, 'streamingGiftTitle')}
                              </h2>
                            </div>
                            <button
                              type="button"
                              onClick={() => setRoute('streaming-store')}
                              className="text-xs font-bold text-[#FF8500] hover:underline"
                            >
                              {t(lang, 'viewAll')} →
                            </button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                            {streamingAndAiProducts.slice(0, sec.limit || 4).map((p) => (
                              <ProductCard
                                key={p.id}
                                product={p}
                                lang={lang}
                                onSelect={openProductDetail}
                                onQuickOrder={openQuickOrder}
                                onAddToCart={(prod) => handleAddToCart(prod, 1)}
                              />
                            ))}
                          </div>
                        </section>
                      ) : null;

                    case 'trending_services':
                      return trendingProducts.length > 0 ? (
                        <section key="trending_services" className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <TrendingUp className="w-5 h-5 text-[#FF8500]" />
                              <h2 className="text-lg sm:text-xl font-extrabold text-[#172033]">
                                {t(lang, 'trendingServices')}
                              </h2>
                            </div>
                            <button
                              type="button"
                              onClick={() => setRoute('services')}
                              className="text-xs font-bold text-[#FF8500] hover:underline"
                            >
                              {t(lang, 'viewAll')} →
                            </button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                            {trendingProducts.slice(0, sec.limit || 4).map((p) => (
                              <ProductCard
                                key={p.id}
                                product={p}
                                lang={lang}
                                onSelect={openProductDetail}
                                onQuickOrder={openQuickOrder}
                                onAddToCart={(prod) => handleAddToCart(prod, 1)}
                              />
                            ))}
                          </div>
                        </section>
                      ) : null;

                    case 'best_sellers':
                      return (
                        <section key="best_sellers" className="space-y-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Award className="w-5 h-5 text-[#FF8500]" />
                              <h2 className="text-lg sm:text-xl font-extrabold text-[#172033]">
                                {t(lang, 'bestSellers')} & {t(lang, 'newArrivals')}
                              </h2>
                            </div>
                            <button
                              type="button"
                              onClick={() => setRoute('digital-products')}
                              className="text-xs font-bold text-[#FF8500] hover:underline"
                            >
                              {t(lang, 'viewAll')} →
                            </button>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
                            {[...newArrivalProducts, ...bestSellerProducts].slice(0, sec.limit || 8).map((p) => (
                              <ProductCard
                                key={p.id}
                                product={p}
                                lang={lang}
                                onSelect={openProductDetail}
                                onQuickOrder={openQuickOrder}
                                onAddToCart={(prod) => handleAddToCart(prod, 1)}
                              />
                            ))}
                          </div>
                        </section>
                      );

                    case 'payment_channels':
                      return (
                        <HomepagePaymentSection
                          key="payment_channels"
                          settings={settings}
                          lang={lang}
                          user={user}
                          profile={profile}
                          onOpenAuth={() => setAuthModalOpen(true)}
                          onNavigateAddMoney={() => setRoute('add-money')}
                        />
                      );

                    case 'spotlight':
                      return (
                        <div key="spotlight" className="space-y-6">
                          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="dh-card rounded-3xl p-4 sm:p-5 flex items-center justify-between gap-3 sm:gap-4 bg-gradient-to-br from-white to-[#FFF7EE] dark:from-slate-900 dark:to-slate-800/90 overflow-hidden">
                              <div className="space-y-1.5 min-w-0 flex-1">
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#FF8500] uppercase">
                                  <Gift className="w-3.5 h-3.5 shrink-0" />
                                  Gift Cards & Vouchers
                                </span>
                                <h3 className="text-sm sm:text-lg font-extrabold text-[#172033] dark:text-slate-100 leading-snug">
                                  {lang === 'bn' ? 'Steam, UniPin, PlayStation ও Google Play' : 'Steam, UniPin, PSN & Google Play Codes'}
                                </h3>
                                <button
                                  type="button"
                                  onClick={() => setRoute('gift-cards')}
                                  className="px-3.5 sm:px-4 py-1.5 rounded-xl dh-orange-gradient text-white text-xs font-bold mt-1"
                                >
                                  {t(lang, 'navGiftCards')} →
                                </button>
                              </div>
                              <img
                                src={STUDIO_IMAGES.giftVouchers}
                                alt="Gift Cards"
                                className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover shrink-0"
                              />
                            </div>

                            <div className="dh-card rounded-3xl p-4 sm:p-5 flex items-center justify-between gap-3 sm:gap-4 bg-gradient-to-br from-[#172033] to-[#23314d] text-white border-none overflow-hidden">
                              <div className="space-y-1.5 min-w-0 flex-1">
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#FF9B19] uppercase">
                                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                                  VIP Community
                                </span>
                                <h3 className="text-sm sm:text-lg font-extrabold leading-snug">
                                  {lang === 'bn' ? 'প্রাইভেট টেলিগ্রাম ভিআইপি গ্রুপ' : 'Telegram VIP Groups & Learning'}
                                </h3>
                                <button
                                  type="button"
                                  onClick={() => setRoute('vip-groups')}
                                  className="px-3.5 sm:px-4 py-1.5 rounded-xl bg-[#FF8500] text-white text-xs font-bold mt-1"
                                >
                                  {t(lang, 'navVip')} →
                                </button>
                              </div>
                              <img
                                src={STUDIO_IMAGES.bannerVip}
                                alt="VIP Community"
                                className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover shrink-0"
                              />
                            </div>
                          </section>
                          <BannerSlotView
                            slot="home_middle"
                            banners={banners}
                            adNetworks={adNetworks}
                            adsEnabled={settings.adsEnabled}
                            lang={lang}
                          />
                          <ManagedPlacementSlot
                            placement="in_page"
                            units={managedAdUnits}
                            adsEnabled={settings.adsEnabled}
                            lang={lang}
                          />
                        </div>
                      );

                    case 'ad_player':
                      return (
                        <AdPlayerSection
                          key="ad_player"
                          ads={advertisements}
                          adsEnabled={settings.adsEnabled}
                          lang={lang}
                        />
                      );

                    case 'reviews':
                      return reviews.length > 0 ? (
                        <section key="reviews" className="dh-card rounded-3xl p-5 sm:p-6 space-y-4">
                          <h2 className="text-lg font-extrabold text-[#172033]">{t(lang, 'customerReviews')}</h2>
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            {reviews.slice(0, sec.limit || 6).map((rev) => (
                              <div key={rev.id} className="p-4 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-[#172033]">{rev.authorName}</span>
                                  <span className="inline-flex items-center gap-0.5 text-xs font-bold text-[#FF8500]">
                                    <Star className="w-3.5 h-3.5 fill-current" />
                                    {rev.rating}/5
                                  </span>
                                </div>
                                <p className="text-xs text-[#777777]">{rev.comment}</p>
                              </div>
                            ))}
                          </div>
                        </section>
                      ) : null;

                    case 'why_faq':
                      return (
                        <div key="why_faq" className="space-y-6">
                          <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                            <div className="dh-card rounded-3xl p-5 sm:p-6 space-y-4">
                              <h2 className="text-lg font-extrabold text-[#172033]">{t(lang, 'whyChooseUs')}</h2>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                {[
                                  {
                                    icon: ShieldCheck,
                                    title: lang === 'bn' ? 'স্বচ্ছ ম্যানুয়াল পেমেন্ট যাচাই' : 'Verified Manual Payments',
                                    desc:
                                      lang === 'bn'
                                        ? 'বিকাশ, নগদ ও রকেট ট্রানজেকশন যাচাই করে নিরাপদ অর্ডার প্রসেসিং।'
                                        : 'Every bKash, Nagad & Rocket TxID is verified by an admin before processing.',
                                  },
                                  {
                                    icon: Clock,
                                    title: lang === 'bn' ? 'দ্রুত ও নির্ভরযোগ্য ডেলিভারি' : 'Fast Digital Fulfillment',
                                    desc:
                                      lang === 'bn'
                                        ? 'অনুমোদনের পর নির্ধারিত সময়ের মধ্যে সার্ভিস ডেলিভারি।'
                                        : 'Prompt delivery within each service’s stated turnaround window.',
                                  },
                                ].map((item) => {
                                  const Icon = item.icon;
                                  return (
                                    <div key={item.title} className="p-3.5 rounded-2xl bg-[#F3F6FF] border border-[#E6ECFA] space-y-1">
                                      <Icon className="w-5 h-5 text-[#FF8500]" />
                                      <p className="font-bold text-[#172033]">{item.title}</p>
                                      <p className="text-[#777777]">{item.desc}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>

                            <div className="dh-card rounded-3xl p-5 sm:p-6 space-y-3">
                              <div className="flex items-center gap-2">
                                <HelpCircle className="w-5 h-5 text-[#FF8500]" />
                                <h2 className="text-lg font-extrabold text-[#172033]">{t(lang, 'faqTitle')}</h2>
                              </div>
                              <div className="space-y-2 text-xs">
                                <div className="p-3 rounded-2xl bg-[#F3F6FF]">
                                  <p className="font-bold text-[#172033]">
                                    {lang === 'bn'
                                      ? 'পেমেন্ট করার কতক্ষণ পর অর্ডার কনফার্ম হয়?'
                                      : 'How long does payment verification take?'}
                                  </p>
                                  <p className="text-[#777777] mt-0.5">
                                    {lang === 'bn'
                                      ? 'TxID জমা দেওয়ার পর অ্যাডমিন প্রকৃত লেনদেন যাচাই করে অনুমোদন দেন।'
                                      : 'After submitting your TxID, the owner verifies the actual transaction and approves it.'}
                                  </p>
                                </div>
                                <div className="p-3 rounded-2xl bg-[#F3F6FF]">
                                  <p className="font-bold text-[#172033]">
                                    {lang === 'bn' ? 'ওয়ালেট ব্যালেন্স কীভাবে যোগ করবো?' : 'How does Add Money work?'}
                                  </p>
                                  <p className="text-[#777777] mt-0.5">
                                    {lang === 'bn'
                                      ? 'নিচের "+" বাটনে ক্লিক করে Send Money তথ্য ও TxID জমা দিন।'
                                      : 'Tap the "+" Add Money button, send money to our personal number, and submit your TxID.'}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </section>
                          <BannerSlotView
                            slot="home_bottom"
                            banners={banners}
                            adNetworks={adNetworks}
                            adsEnabled={settings.adsEnabled}
                            lang={lang}
                          />
                        </div>
                      );

                    default:
                      return null;
                  }
                })}
            </div>
          </div>
        )}

        {route === 'mobile-apps' && (
          <MobileAppStoreSection
            mode="page"
            lang={lang}
            settings={settings}
            paymentMethods={paymentMethods}
            user={user}
            profile={profile}
            wallet={wallet}
            onOpenAuth={() => {
              setAuthInitialMode('login');
              setAuthModalOpen(true);
            }}
            onBackHome={() => setRoute('home')}
            onGoToOrders={() => setRoute('orders')}
          />
        )}

        {route === 'games-store' && (
          <GamesStoreSection
            mode="page"
            lang={lang}
            games={games}
            products={products}
            onSelectProduct={openProductDetail}
            onBackHome={() => setRoute('home')}
          />
        )}

        {isCatalogRoute && (
          <CategoryCatalogPage
            route={route}
            categories={categories}
            products={products}
            banners={banners}
            advertisements={advertisements}
            adNetworks={adNetworks}
            settings={settings}
            lang={lang}
            initialSearch={catalogSearchQuery}
            initialCatalogSection={catalogSectionFilter}
            onSelectCatalogSection={setCatalogSectionFilter}
            onSelectProduct={openProductDetail}
            onQuickOrder={openQuickOrder}
            onAddToCart={(p) => handleAddToCart(p, 1)}
            onNavigate={(r) => {
              setCatalogSearchQuery('');
              setCatalogSectionFilter('');
              setRoute(r);
            }}
          />
        )}

        {route === 'product-detail' && detailProduct && (
          <ProductDetailPage
            key={detailProduct.id}
            product={detailProduct}
            allProducts={products}
            categories={categories}
            lang={lang}
            settings={settings}
            paymentMethods={paymentMethods}
            user={user}
            profile={profile}
            wallet={wallet}
            banners={banners}
            advertisements={advertisements}
            adNetworks={adNetworks}
            managedAdUnits={managedAdUnits}
            reviews={reviews}
            onBack={() => setRoute(previousRoute || 'services')}
            onNavigate={(r) => {
              setCatalogSearchQuery('');
              setRoute(r);
            }}
            onSelectProduct={openProductDetail}
            onQuickOrder={openQuickOrder}
            onAddToCart={handleAddToCart}
            onOpenAuth={() => setAuthModalOpen(true)}
            onOrderSuccess={() => setRoute('orders')}
          />
        )}

        {route === 'product-detail' && !detailProduct && (
          <div className="max-w-3xl mx-auto px-4 py-12">
            <div className="dh-card rounded-3xl p-8 text-center space-y-4">
              <p className="text-base font-bold text-[#172033]">
                {lang === 'bn' ? 'সার্ভিসটি পাওয়া যায়নি।' : 'Service not found.'}
              </p>
              <button
                type="button"
                onClick={() => setRoute('services')}
                className="px-5 py-2.5 rounded-xl dh-orange-gradient text-white text-xs font-bold"
              >
                {t(lang, 'backToStore')}
              </button>
            </div>
          </div>
        )}

        {route === 'offers' && (
          <OffersPage
            coupons={coupons}
            products={products}
            banners={banners}
            advertisements={advertisements}
            adNetworks={adNetworks}
            settings={settings}
            lang={lang}
            onSelectProduct={openProductDetail}
            onQuickOrder={openQuickOrder}
            onAddToCart={(p) => handleAddToCart(p, 1)}
          />
        )}

        {route === 'ads' && (
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            <BannerSlotView
              slot="home_top"
              banners={banners}
              adNetworks={adNetworks}
              adsEnabled={settings.adsEnabled}
              lang={lang}
            />
            <ManagedPlacementSlot
              placement="available_ads"
              variant="grid"
              units={managedAdUnits}
              adsEnabled={settings.adsEnabled}
              lang={lang}
            />
            <NativeAdRow
              placement="ads_page"
              advertisements={advertisements}
              adNetworks={adNetworks}
              adsEnabled={settings.adsEnabled}
              lang={lang}
              maxCards={3}
            />
            <AdPlayerSection
              ads={advertisements}
              adsEnabled={settings.adsEnabled}
              lang={lang}
              placementFilter="ads_page"
            />
            <BannerSlotView
              slot="home_bottom"
              banners={banners}
              adNetworks={adNetworks}
              adsEnabled={settings.adsEnabled}
              lang={lang}
            />
          </div>
        )}

        {route === 'watch-earn' && (
          <WatchAndEarnPage
            lang={lang}
            user={user}
            profile={profile}
            wallet={wallet}
            settings={settings}
            advertisements={advertisements}
            managedAdUnits={managedAdUnits}
            adNetworks={adNetworks}
            viewingSessions={viewingSessions}
            rewardTransactions={adRewardTransactions}
            onNavigate={setRoute}
            onOpenAuth={() => {
              setAuthInitialMode('login');
              setAuthModalOpen(true);
            }}
          />
        )}

        {(route === 'wallet' || route === 'add-money') && (
          <WalletAndAddMoney
            key={route}
            initialTab={route === 'add-money' ? 'add-money' : 'wallet'}
            lang={lang}
            user={user}
            profile={profile}
            wallet={wallet}
            walletTxs={walletTxs}
            adRewardTransactions={adRewardTransactions}
            withdrawals={withdrawals}
            paymentMethods={paymentMethods}
            settings={settings}
            onNavigate={setRoute}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        )}

        {(route === 'account' || route === 'orders') && (
          <CustomerDashboard
            key={route}
            initialTab={route === 'orders' ? 'orders' : 'overview'}
            lang={lang}
            setLang={setLang}
            user={user}
            profile={profile}
            wallet={wallet}
            walletTxs={walletTxs}
            adRewardTransactions={adRewardTransactions}
            favoriteAppIds={favoriteAppIds}
            downloadHistory={downloadHistory}
            totalDownloads={totalDownloads}
            mobileApps={mobileApps}
            games={games}
            orders={orders}
            payments={payments}
            referrals={referrals}
            withdrawals={withdrawals}
            rewardClaims={rewardClaims}
            announcements={announcements}
            coupons={coupons}
            notifications={notifications}
            tickets={tickets}
            banners={banners}
            advertisements={advertisements}
            adNetworks={adNetworks}
            managedAdUnits={managedAdUnits}
            settings={settings}
            isAdmin={isAdmin}
            onNavigate={setRoute}
            onOpenAuth={() => setAuthModalOpen(true)}
            onLogout={handleLogout}
          />
        )}

        {(route === 'support' || route === 'contact') && (
          <SupportAndContactPage
            mode={route}
            settings={settings}
            lang={lang}
            onGoToTickets={() => {
              if (!user) {
                setAuthModalOpen(true);
              } else {
                setRoute('account');
              }
            }}
          />
        )}

        {(route === 'about' || route === 'privacy' || route === 'terms' || route === 'refund') && (
          <PolicyPage kind={route} settings={settings} lang={lang} />
        )}

        {route === 'admin' && (
          <AdminDashboard
            lang={lang}
            setLang={setLang}
            theme={theme}
            onToggleTheme={toggleTheme}
            user={user}
            isAdmin={isAdmin}
            categories={categories}
            products={products}
            games={games}
            advertisements={advertisements}
            adNetworks={adNetworks}
            managedAdUnits={managedAdUnits}
            banners={banners}
            paymentMethods={paymentMethods}
            settings={settings}
            onBackToStore={() => setRoute('home')}
            onLogout={handleLogout}
          />
        )}
        </>
        )}
        </Suspense>
      </main>

      {!isMaintenanceBlocked && route !== 'admin' && (
        <SocialBarWidget
          advertisements={advertisements}
          adNetworks={adNetworks}
          adsEnabled={settings.adsEnabled}
          lang={lang}
        />
      )}

      {/* Footer with all Storefront & Policy Links */}
      {!isMaintenanceBlocked && route !== 'admin' && (
        <div className="max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 mt-6">
          <ManagedPlacementSlot
            placement="footer"
            units={managedAdUnits}
            adsEnabled={settings.adsEnabled}
            lang={lang}
          />
        </div>
      )}

      {!isMaintenanceBlocked && route !== 'admin' && (
      <footer className="bg-white dark:bg-slate-900 border-t border-[#E6ECFA] dark:border-slate-800 mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-xs">
          <div className="col-span-2 md:col-span-1 space-y-2">
            <p className="font-display font-extrabold text-base">
              <span className="text-[#172033] dark:text-slate-100">{settings.siteName || 'DIGITAL HUB'}</span>
            </p>
            <p className="text-[#777777] dark:text-slate-400">{lang === 'bn' ? settings.taglineBn : settings.taglineEn}</p>
            <p className="text-[11px] font-mono-num text-[#777777] dark:text-slate-400 break-words">
              bKash: {settings.bkashNumber} · Nagad: {settings.nagadNumber} · Rocket: {settings.rocketNumber}
            </p>
          </div>

          <div className="space-y-1.5">
            <p className="font-bold text-[#172033] mb-2">{t(lang, 'navServices')}</p>
            {(
              [
                ['gaming-store', t(lang, 'navGaming')],
                ['gift-cards', t(lang, 'navGiftCards')],
                ['streaming-store', t(lang, 'navStreaming')],
                ['telegram-store', t(lang, 'navTelegram')],
                ['vip-groups', t(lang, 'navVip')],
                ['ai-marketplace', t(lang, 'navAi')],
              ] as [AppRoute, string][]
            ).map(([r, label]) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoute(r)}
                className="block text-[#777777] hover:text-[#FF8500]"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <p className="font-bold text-[#172033] mb-2">{lang === 'bn' ? 'মার্কেটপ্লেস' : 'Marketplace'}</p>
            {(
              [
                ['mobile-apps', lang === 'bn' ? 'মোবাইল অ্যাপ স্টোর' : 'Mobile App Store'],
                ['games-store', lang === 'bn' ? 'গেমস স্টোর' : 'Games Store'],
                ['software-store', t(lang, 'navSoftware')],
                ['digital-products', t(lang, 'navDigital')],
                ['graphic-design', t(lang, 'navDesign')],
                ['social-media', t(lang, 'navSocial')],
                ['offers', t(lang, 'navOffers')],
                ['watch-earn', lang === 'bn' ? 'ভিডিও দেখে আয়' : 'Watch & Earn'],
                ['ads', t(lang, 'navAds')],
              ] as [AppRoute, string][]
            ).map(([r, label]) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoute(r)}
                className="block text-[#777777] hover:text-[#FF8500]"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="space-y-1.5">
            <p className="font-bold text-[#172033] mb-2">{lang === 'bn' ? 'নীতিমালা ও সহায়তা' : 'Policies & Support'}</p>
            {(
              [
                ['about', lang === 'bn' ? 'আমাদের সম্পর্কে' : 'About Us'],
                ['contact', lang === 'bn' ? 'যোগাযোগ' : 'Contact Us'],
                ['support', t(lang, 'navSupport')],
                ['privacy', lang === 'bn' ? 'প্রাইভেসি পলিসি' : 'Privacy Policy'],
                ['terms', lang === 'bn' ? 'শর্তাবলী' : 'Terms & Conditions'],
                ['refund', lang === 'bn' ? 'রিফান্ড পলিসি' : 'Refund Policy'],
              ] as [AppRoute, string][]
            ).map(([r, label]) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoute(r)}
                className="block text-[#777777] hover:text-[#FF8500]"
              >
                {label}
              </button>
            ))}
            <div className="pt-2 border-t border-[#E6ECFA] space-y-1">
              <a
                href={settings.telegramLink || 'https://t.me/zenvoofficial'}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[#0088cc] font-semibold hover:underline"
              >
                Telegram Admin: @zenvoofficial
              </a>
              <a
                href={settings.whatsappLink || 'https://wa.me/8801352838945'}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[#16A34A] font-semibold hover:underline"
              >
                WhatsApp: +880 1352-838945
              </a>
              <a
                href={settings.telegramChannelLink || 'https://t.me/ZENVOOfficialTelegramChannel'}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[#FF8500] font-semibold hover:underline"
              >
                {t(lang, 'telegramChannelLabel')}
              </a>
            </div>
          </div>
        </div>
        <div className="border-t border-[#E6ECFA] dark:border-slate-800 py-3 px-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[11px] text-[#777777] dark:text-slate-400">
          <span>© {new Date().getFullYear()} {t(lang, 'footerRights')}</span>
          <button
            type="button"
            onClick={() => {
              const next = !analyticsOptOut;
              setAnalyticsOptOut(next);
              try {
                localStorage.setItem('dh_analytics_optout', next ? '1' : '0');
              } catch {
                // Non-fatal
              }
            }}
            className="underline hover:text-[#FF8500] cursor-pointer"
          >
            {analyticsOptOut
              ? lang === 'bn'
                ? 'অ্যানালিটিক্স বন্ধ আছে (চালু করুন)'
                : 'Analytics: Opted Out (Enable)'
              : lang === 'bn'
                ? 'অ্যানালিটিক্স প্রাইভেসি (অপ্ট-আউট)'
                : 'Analytics Privacy (Opt-Out)'}
          </button>
        </div>
      </footer>
      )}

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        lang={lang}
        settings={settings}
        initialMode={authInitialMode}
        initialReferralCode={capturedReferral}
        onReferralCapture={(code) => {
          capturedReferralRef.current = code;
          setCapturedReferral(code);
          try {
            localStorage.setItem('dh_ref', code);
          } catch {
            // Non-fatal
          }
        }}
        onAuthSuccess={(signedInUser, signedInProfile, isNewAccount, keepModalOpen) => {
          const adminFlag =
            signedInUser.role === 'admin' || signedInUser.role === 'super_admin';
          setUser(signedInUser);
          setProfile(signedInProfile);
          setIsAdmin(adminFlag);
          if (!keepModalOpen) {
            setAuthModalOpen(false);
          }
          setRoute(adminFlag ? 'admin' : 'account');
          showToast(
            isNewAccount
              ? langRef.current === 'bn'
                ? 'অভিনন্দন! আপনার Digital Hub অ্যাকাউন্ট তৈরি ও লগইন সম্পন্ন হয়েছে।'
                : 'Welcome! Your Digital Hub account is ready and signed in.'
              : langRef.current === 'bn'
                ? 'স্বাগতম! আপনার অ্যাকাউন্টে সফলভাবে লগইন হয়েছে।'
                : 'Welcome back! Signed in successfully.'
          );
        }}
        supportTelegramUrl={settings.telegramLink}
        supportWhatsappUrl={settings.whatsappLink}
      />

      <CartDrawer
        open={cartOpen}
        onClose={() => setCartOpen(false)}
        items={cart}
        onUpdateQty={handleUpdateQty}
        onRemoveItem={(cartKey) => setCart((prev) => prev.filter((i) => getCartItemKey(i) !== cartKey))}
        onClearCart={() => setCart([])}
        coupons={coupons}
        settings={settings}
        paymentMethods={paymentMethods}
        lang={lang}
        user={user}
        profile={profile}
        wallet={wallet}
        onOpenAuth={() => {
          setCartOpen(false);
          setAuthModalOpen(true);
        }}
        onOrderSuccess={() => setRoute('orders')}
      />

      <ProductCheckoutModal
        product={selectedProduct}
        initialTab={modalInitialTab}
        initialPackageId={selectedPackageId}
        onClose={() => {
          setSelectedProduct(null);
          setSelectedPackageId(undefined);
        }}
        lang={lang}
        settings={settings}
        paymentMethods={paymentMethods}
        user={user}
        profile={profile}
        wallet={wallet}
        banners={banners}
        advertisements={advertisements}
        adNetworks={adNetworks}
        reviews={reviews}
        onAddToCart={handleAddToCart}
        onOpenAuth={() => {
          setSelectedProduct(null);
          setAuthModalOpen(true);
        }}
        onOrderSuccess={() => setRoute('orders')}
      />
    </div>
  );
}
