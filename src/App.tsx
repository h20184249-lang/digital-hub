import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
  Search,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  Tv,
  Users,
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
  Language,
  ManagedAdUnitConfig,
  Order,
  Payment,
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
  subscribeManagedAdUnits,
  subscribeProducts,
  subscribeSiteSettings,
} from './lib/firestoreService';
import {
  DEFAULT_AD_NETWORKS,
  DEFAULT_ADVERTISEMENTS,
  DEFAULT_BANNERS,
  DEFAULT_CATEGORIES,
  DEFAULT_COUPONS,
  DEFAULT_PRODUCTS,
  DEFAULT_SITE_SETTINGS,
  STUDIO_IMAGES,
} from './lib/seedData';
import { mergeAdUnitsWithOverrides } from './lib/adProviderConfig';
import { t } from './lib/i18n';
import { Navbar } from './components/Navbar';
import { BannerSlotView } from './components/BannerSlotView';
import { AdPlayerSection } from './components/AdPlayerSection';
import { ManagedPlacementSlot } from './components/AdUnitFrame';
import { NativeAdRow, SocialBarWidget } from './components/AutomaticAdEngine';
import { WatchAndEarnPage } from './components/WatchAndEarnPage';
import { AuthModal } from './components/AuthModal';
import { CartDrawer, getCartItemKey } from './components/CartDrawer';
import { HomepagePaymentSection } from './components/PremiumPaymentSection';
import { ProductCheckoutModal } from './components/ProductCheckoutModal';
import { ProductDetailPage } from './components/ProductDetailPage';
import { WalletAndAddMoney } from './components/WalletAndAddMoney';
import { CustomerDashboard } from './components/CustomerDashboard';
import { AdminDashboard } from './components/AdminDashboard';
import {
  CategoryCatalogPage,
  OffersPage,
  PolicyPage,
  ProductCard,
  SupportAndContactPage,
} from './components/StorefrontPages';

export default function App() {
  const [detailProductId, setDetailProductId] = useState<string>(
    () => new URLSearchParams(window.location.search).get('product') || ''
  );
  const [route, setRoute] = useState<AppRoute>(() => {
    if (new URLSearchParams(window.location.search).get('product')) return 'product-detail';
    if (window.location.pathname === '/watch-earn') return 'watch-earn';
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
  const [coupons, setCoupons] = useState<Coupon[]>(DEFAULT_COUPONS);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);

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
  const langRef = useRef<Language>(lang);

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
    };
  }, []);

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
          if (!session.isAdmin) {
            setRoute((prev) => (prev === 'admin' ? 'account' : prev));
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

  useEffect(() => {
    const timer = setInterval(() => setHeroSlide((s) => (s + 1) % 3), 5500);
    return () => clearInterval(timer);
  }, []);

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
    setModalInitialTab(p.packages && p.packages.length > 0 ? 'details' : 'checkout');
    setSelectedProduct(p);
  };

  useEffect(() => {
    const titleMap: Record<AppRoute, string> = {
      home: 'DIGITAL HUB — Your Complete Digital Services Marketplace',
      services: 'All Digital & Gaming Services — DIGITAL HUB',
      'gaming-store': 'Gaming Top-Ups & Passes — DIGITAL HUB',
      'gift-cards': 'Gift Cards & Game Vouchers — DIGITAL HUB',
      'streaming-store': 'Streaming & OTT Subscriptions — DIGITAL HUB',
      'telegram-store': 'Telegram Store — DIGITAL HUB',
      'vip-groups': 'Telegram VIP Groups — DIGITAL HUB',
      'telegram-stars': 'Telegram Stars — DIGITAL HUB',
      'ai-marketplace': 'AI Tools Marketplace — DIGITAL HUB',
      'software-store': 'Software Store — DIGITAL HUB',
      'digital-products': 'Digital Products — DIGITAL HUB',
      'graphic-design': 'Graphic Design Services — DIGITAL HUB',
      'social-media': 'Social Media Services — DIGITAL HUB',
      'product-detail': detailProduct
        ? `${detailProduct.titleEn} — DIGITAL HUB`
        : 'Service Details — DIGITAL HUB',
      offers: 'Special Offers & Coupons — DIGITAL HUB',
      ads: 'Sponsored Partner Network — DIGITAL HUB',
      'watch-earn': 'Watch & Earn — DIGITAL HUB',
      orders: 'My Orders — DIGITAL HUB',
      'add-money': 'Add Money — DIGITAL HUB',
      wallet: 'My Wallet — DIGITAL HUB',
      account: 'My Account — DIGITAL HUB',
      support: 'Customer Support — DIGITAL HUB',
      about: 'About Us — DIGITAL HUB',
      contact: 'Contact Us — DIGITAL HUB',
      privacy: 'Privacy Policy — DIGITAL HUB',
      terms: 'Terms & Conditions — DIGITAL HUB',
      refund: 'Refund Policy — DIGITAL HUB',
      admin: 'Administrator Dashboard — DIGITAL HUB',
    };
    document.title = titleMap[route] || 'DIGITAL HUB';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [route, detailProduct]);

  const handleAddToCart = (product: Product, qty = 1, selectedPackage?: ProductPackage) => {
    const pkg =
      selectedPackage || (product.packages && product.packages.length > 0 ? product.packages[0] : undefined);
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

  const heroSlides = [
    {
      badge: 'DIGITAL HUB',
      title: lang === 'bn' ? 'আপনার সম্পূর্ণ ডিজিটাল সার্ভিস ও গেমিং মার্কেটপ্লেস' : 'Your Complete Digital & Gaming Marketplace',
      subtitle:
        lang === 'bn'
          ? 'ফ্রি ফায়ার ডায়মন্ড, PUBG UC, গিফট কার্ড, Netflix, Telegram Premium, AI Tools এবং সোশ্যাল সার্ভিস এক ঠিকানায়।'
          : 'Free Fire Diamonds, PUBG UC, Gift Cards, Netflix, Telegram Premium, AI Tools & SMM Services.',
      image: STUDIO_IMAGES.hero,
      ctaRoute: 'gaming-store' as AppRoute,
    },
    {
      badge: lang === 'bn' ? 'গেমিং টপ-আপ' : 'INSTANT GAMING TOP-UP',
      title: lang === 'bn' ? 'ফ্রি ফায়ার, PUBG, Valorant ও গিফট কার্ড' : 'Free Fire, PUBG, Valorant & Gift Cards',
      subtitle:
        lang === 'bn'
          ? 'অফিশিয়াল প্লেয়ার UID টপ-আপ এবং ভেরিফায়েড বিকাশ, নগদ ও রকেট পেমেন্ট।'
          : 'Authorized Player UID top-ups and vouchers backed by verified bKash, Nagad & Rocket.',
      image: STUDIO_IMAGES.gameBattle,
      ctaRoute: 'gift-cards' as AppRoute,
    },
    {
      badge: lang === 'bn' ? 'ওটিটি, এআই ও টেলিগ্রাম' : 'OTT, AI & TELEGRAM',
      title: lang === 'bn' ? 'স্ট্রিমিং পাস, ChatGPT Plus ও টেলিগ্রাম স্টোর' : 'Streaming Passes, ChatGPT & Telegram Store',
      subtitle:
        lang === 'bn'
          ? 'ক্রিয়েটর ও গেমারদের জন্য নিরাপদ ডিজিটাল সাবস্ক্রিপশন এবং দ্রুত ডেলিভারি।'
          : 'Authorized streaming, AI suites, and Telegram packages delivered safely.',
      image: STUDIO_IMAGES.streaming,
      ctaRoute: 'streaming-store' as AppRoute,
    },
  ];

  const activeSlide = heroSlides[heroSlide] || heroSlides[0];

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

  return (
    <div className="min-h-screen flex flex-col bg-[#F3F6FF] text-[#172033] pb-20 lg:pb-0">
      <Navbar
        route={route}
        setRoute={(r) => {
          setCatalogSearchQuery('');
          setRoute(r);
        }}
        lang={lang}
        setLang={setLang}
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

      {route !== 'admin' && (
        <div className="max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 pt-2">
          <ManagedPlacementSlot
            placement="top_header"
            units={managedAdUnits}
            adsEnabled={settings.adsEnabled}
            lang={lang}
          />
        </div>
      )}

      {toast && (
        <div className="fixed top-20 right-4 z-50 px-4 py-2.5 rounded-2xl bg-[#172033] text-white text-xs font-bold shadow-xl border border-[#FF8500] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#FF8500]" />
          <span>{toast}</span>
        </div>
      )}

      <main className="flex-1">
        {user && profile?.status === 'suspended' && (
          <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 pt-4">
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-[#DC2626] text-xs sm:text-sm font-bold flex flex-wrap items-center justify-between gap-2">
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
            {/* 1. Hero Carousel + Integrated Quick Search */}
            <section className="space-y-3">
              <div className="relative rounded-3xl overflow-hidden shadow-lg bg-[#172033] min-h-[220px] sm:min-h-[280px] flex items-center">
                <img
                  src={activeSlide.image}
                  alt={activeSlide.title}
                  onError={(e) => {
                    e.currentTarget.src = STUDIO_IMAGES.hero;
                  }}
                  className="absolute inset-0 w-full h-full object-cover opacity-55"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-[#172033] via-[#172033]/85 to-[#172033]/40" />

                <div className="relative z-10 w-full p-5 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-5">
                  <div className="max-w-xl space-y-2.5">
                    <span className="inline-block px-2.5 py-0.5 rounded-md bg-[#FF8500] text-white text-[11px] font-extrabold tracking-wide">
                      {activeSlide.badge}
                    </span>
                    <h1 className="text-xl sm:text-3xl font-extrabold text-white leading-tight">
                      {activeSlide.title}
                    </h1>
                    <p className="text-xs sm:text-sm text-white/80 leading-relaxed">
                      {activeSlide.subtitle}
                    </p>
                    <div className="pt-1 flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setRoute(activeSlide.ctaRoute)}
                        className="px-4 sm:px-5 py-2 rounded-full bg-[#FACC15] hover:bg-[#fde047] text-[#172033] text-xs sm:text-sm font-extrabold inline-flex items-center gap-1.5 shadow-md"
                      >
                        <span>{t(lang, 'shopNow')}</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
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

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <form onSubmit={handleHomeSearchSubmit} className="relative w-full sm:max-w-md">
                  <Search className="w-4 h-4 text-[#777777] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={homeSearch}
                    onChange={(e) => setHomeSearch(e.target.value)}
                    placeholder={t(lang, 'searchPlaceholder')}
                    className="w-full pl-10 pr-24 py-2.5 rounded-2xl bg-white border border-[#E6ECFA] text-xs sm:text-sm shadow-xs focus:outline-none focus:border-[#FF8500]"
                  />
                  <button
                    type="submit"
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3.5 py-1.5 rounded-xl dh-orange-gradient text-white text-xs font-bold"
                  >
                    {lang === 'bn' ? 'খুঁজুন' : 'Search'}
                  </button>
                </form>

                <div className="flex justify-center gap-1.5">
                  {heroSlides.map((s, idx) => (
                    <button
                      key={s.badge}
                      type="button"
                      onClick={() => setHeroSlide(idx)}
                      aria-label={`Slide ${idx + 1}`}
                      className={`h-1.5 rounded-full transition-all ${
                        heroSlide === idx ? 'w-6 bg-[#FF8500]' : 'w-2.5 bg-gray-300'
                      }`}
                    />
                  ))}
                </div>
              </div>
            </section>

            {/* 2. Quick-Access 8 Service Category Tiles */}
            <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 sm:gap-2.5">
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

            {/* Homepage Top Ad Placement */}
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

            {/* 3. GAMING TOP-UPS & PASSES (MangoTopUp Core) */}
            {gamingAndGiftProducts.length > 0 && (
              <section className="space-y-3">
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
                  {gamingAndGiftProducts.slice(0, 8).map((p) => (
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
            )}

            {/* 4. FLASH SALE Section */}
            <section className="space-y-3">
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
                {(flashSaleProducts.length > 0 ? flashSaleProducts : products.slice(0, 4))
                  .slice(0, 4)
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

            {/* 5. HOT PRODUCT Section */}
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
                  .slice(0, 8)
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

            {/* Between-Sections Ad Banner & Native Ads */}
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

            {/* 6. STREAMING, OTT & AI SUBSCRIPTIONS */}
            {streamingAndAiProducts.length > 0 && (
              <section className="space-y-3">
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
                  {streamingAndAiProducts.slice(0, 4).map((p) => (
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
            )}

            {/* 7. TRENDING SERVICES */}
            {trendingProducts.length > 0 && (
              <section className="space-y-3">
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
                  {trendingProducts.slice(0, 4).map((p) => (
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
            )}

            {/* 8. BEST SELLERS & NEW ARRIVALS */}
            <section className="space-y-3">
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
                {[...newArrivalProducts, ...bestSellerProducts].slice(0, 8).map((p) => (
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

            {/* 9. Premium Official Payment Channels & Quick Deposit (bKash, Nagad & Rocket Authentic Logos) */}
            <HomepagePaymentSection
              settings={settings}
              lang={lang}
              user={user}
              profile={profile}
              onOpenAuth={() => setAuthModalOpen(true)}
              onNavigateAddMoney={() => setRoute('add-money')}
            />

            {/* 10. Gift Cards & VIP Community Spotlight */}
            <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="dh-card rounded-3xl p-5 flex items-center justify-between gap-4 bg-gradient-to-br from-white to-[#FFF7EE]">
                <div className="space-y-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#FF8500] uppercase">
                    <Gift className="w-3.5 h-3.5" />
                    Gift Cards & Vouchers
                  </span>
                  <h3 className="text-base sm:text-lg font-extrabold text-[#172033]">
                    {lang === 'bn' ? 'Steam, UniPin, PlayStation ও Google Play' : 'Steam, UniPin, PSN & Google Play Codes'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setRoute('gift-cards')}
                    className="px-4 py-1.5 rounded-xl dh-orange-gradient text-white text-xs font-bold mt-1"
                  >
                    {t(lang, 'navGiftCards')} →
                  </button>
                </div>
                <img
                  src={STUDIO_IMAGES.giftVouchers}
                  alt="Gift Cards"
                  className="w-24 h-24 rounded-2xl object-cover shrink-0"
                />
              </div>

              <div className="dh-card rounded-3xl p-5 flex items-center justify-between gap-4 bg-gradient-to-br from-[#172033] to-[#23314d] text-white border-none">
                <div className="space-y-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[#FF9B19] uppercase">
                    <Sparkles className="w-3.5 h-3.5" />
                    VIP Community
                  </span>
                  <h3 className="text-base sm:text-lg font-extrabold">
                    {lang === 'bn' ? 'প্রাইভেট টেলিগ্রাম ভিআইপি গ্রুপ' : 'Telegram VIP Groups & Learning'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setRoute('vip-groups')}
                    className="px-4 py-1.5 rounded-xl bg-[#FF8500] text-white text-xs font-bold mt-1"
                  >
                    {t(lang, 'navVip')} →
                  </button>
                </div>
                <img
                  src={STUDIO_IMAGES.bannerVip}
                  alt="VIP Community"
                  className="w-24 h-24 rounded-2xl object-cover shrink-0"
                />
              </div>
            </section>

            {/* Homepage Middle Ad Banner */}
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

            {/* 11. Dedicated Advertisement Player Section (AD01-AD06) */}
            <AdPlayerSection ads={advertisements} adsEnabled={settings.adsEnabled} lang={lang} />

            {/* 12. Verified Customer Reviews */}
            {reviews.length > 0 && (
              <section className="dh-card rounded-3xl p-5 sm:p-6 space-y-4">
                <h2 className="text-lg font-extrabold text-[#172033]">{t(lang, 'customerReviews')}</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {reviews.slice(0, 6).map((rev) => (
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
            )}

            {/* 13. Why Choose Us + FAQ */}
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

            {/* Homepage Bottom Ad Banner */}
            <BannerSlotView
              slot="home_bottom"
              banners={banners}
              adNetworks={adNetworks}
              adsEnabled={settings.adsEnabled}
              lang={lang}
            />
            </div>
          </div>
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
            onSelectProduct={openProductDetail}
            onQuickOrder={openQuickOrder}
            onAddToCart={(p) => handleAddToCart(p, 1)}
            onNavigate={(r) => {
              setCatalogSearchQuery('');
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
            withdrawals={withdrawals}
            settings={settings}
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
            user={user}
            isAdmin={isAdmin}
            categories={categories}
            products={products}
            advertisements={advertisements}
            adNetworks={adNetworks}
            managedAdUnits={managedAdUnits}
            banners={banners}
            settings={settings}
            onLogout={handleLogout}
          />
        )}
      </main>

      {route !== 'admin' && (
        <SocialBarWidget
          advertisements={advertisements}
          adNetworks={adNetworks}
          adsEnabled={settings.adsEnabled}
          lang={lang}
        />
      )}

      {/* Footer with all Storefront & Policy Links */}
      {route !== 'admin' && (
        <div className="max-w-7xl mx-auto w-full px-3 sm:px-6 lg:px-8 mt-6">
          <ManagedPlacementSlot
            placement="footer"
            units={managedAdUnits}
            adsEnabled={settings.adsEnabled}
            lang={lang}
          />
        </div>
      )}

      <footer className="bg-white border-t border-[#E6ECFA] mt-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-2 md:grid-cols-4 gap-6 text-xs">
          <div className="col-span-2 md:col-span-1 space-y-2">
            <p className="font-display font-extrabold text-base">
              <span className="text-[#172033]">DIGITAL</span>{' '}
              <span className="text-[#FF8500]">HUB</span>
            </p>
            <p className="text-[#777777]">{lang === 'bn' ? settings.taglineBn : settings.taglineEn}</p>
            <p className="text-[11px] font-mono-num text-[#777777]">
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
        <div className="border-t border-[#E6ECFA] py-3 px-4 text-center text-[11px] text-[#777777]">
          © {new Date().getFullYear()} {t(lang, 'footerRights')}
        </div>
      </footer>

      <AuthModal
        open={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        lang={lang}
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
        onClose={() => setSelectedProduct(null)}
        lang={lang}
        settings={settings}
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
