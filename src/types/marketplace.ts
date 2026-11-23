export type Language = 'bn' | 'en';

export type PaymentMethod = 'bkash' | 'nagad' | 'rocket' | (string & {});
export type CheckoutPaymentMethod = PaymentMethod | 'wallet';

export type OrderStatus =
  | 'Pending Payment'
  | 'Verification Pending'
  | 'Paid'
  | 'Payment Approved'
  | 'Processing'
  | 'Completed'
  | 'Rejected'
  | 'Cancelled';

export type PaymentStatus =
  | 'Awaiting Payment'
  | 'Verification Pending'
  | 'Approved'
  | 'Rejected'
  | 'Refunded';

export type OrderFormType =
  | 'freefire'
  | 'pubg_uid'
  | 'telegram'
  | 'giftcard'
  | 'social'
  | 'subscription'
  | 'design';

export type ProductSectionTag =
  | 'flash_sale'
  | 'hot_product'
  | 'trending'
  | 'best_seller'
  | 'new_arrival'
  | 'standard';

export type BannerSlot =
  | 'home_top'
  | 'home_middle'
  | 'home_bottom'
  | 'between_sections'
  | 'service_page'
  | 'product_page'
  | 'dashboard_promo';

export type AppRoute =
  | 'home'
  | 'services'
  | 'telegram-store'
  | 'vip-groups'
  | 'telegram-stars'
  | 'ai-marketplace'
  | 'software-store'
  | 'mobile-apps'
  | 'digital-products'
  | 'graphic-design'
  | 'social-media'
  | 'gaming-store'
  | 'games-store'
  | 'streaming-store'
  | 'gift-cards'
  | 'offers'
  | 'ads'
  | 'watch-earn'
  | 'orders'
  | 'add-money'
  | 'wallet'
  | 'account'
  | 'support'
  | 'about'
  | 'contact'
  | 'privacy'
  | 'terms'
  | 'refund'
  | 'product-detail'
  | 'admin';

export type AdFormat = 'banner' | 'native' | 'social_bar' | 'direct_link' | 'publisher_script';

export type AdPlacement =
  | 'player'
  | 'service_banner'
  | 'product_page'
  | 'dashboard_promo'
  | 'ads_page'
  | 'between_sections'
  | 'social_bar'
  | 'all';

export type AuthMethod = 'phone' | 'email';

export interface AuthUser {
  uid: string;
  phone: string;
  displayName: string;
  email?: string;
  authMethod?: AuthMethod;
  photoURL?: string;
  role: 'super_admin' | 'admin' | 'user';
  status: 'active' | 'suspended';
  referralCode: string;
  createdAt?: number;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role?: 'super_admin' | 'admin' | 'user';
  authMethod?: AuthMethod;
  phone?: string;
  photoUrl?: string;
  referralCode: string;
  referredBy?: string;
  promotionalCredits: number;
  language?: Language;
  status: 'active' | 'suspended';
  adminNotes?: string;
  lastLoginAt?: number;
  lastLoginIp?: string;
  sessionRevokedAt?: number;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface PaymentMethodConfig {
  id: string;
  code: string;
  name: string;
  type: 'mobile_banking' | 'bank_transfer' | 'custom';
  accountNumber: string;
  accountName: string;
  instructionsBn: string;
  instructionsEn: string;
  requirementsBn: string;
  requirementsEn: string;
  minAmount: number;
  maxAmount: number;
  supportsDeposit: boolean;
  supportsWithdrawal: boolean;
  enabled: boolean;
  sortOrder: number;
  updatedAt?: number;
}

export interface AccountDeletionRequest {
  id: string;
  userId: string;
  userEmail: string;
  reason?: string;
  status: 'pending' | 'reviewed' | 'completed' | 'rejected';
  adminNote?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AdminRecord {
  uid: string;
  email: string;
  role: 'super_admin' | 'admin';
  addedBy?: string;
  createdAt: unknown;
}

export interface Category {
  id: string;
  slug: string;
  type?: 'service' | 'app' | 'game';
  nameBn: string;
  nameEn: string;
  descriptionBn?: string;
  descriptionEn?: string;
  imageUrl?: string;
  sortOrder: number;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ProductPackage {
  id: string;
  nameBn: string;
  nameEn: string;
  priceBdt: number;
  originalPriceBdt?: number;
  supplierPriceBdt?: number;
  availability?: 'in_stock' | 'limited' | 'out_of_stock';
  durationBn?: string;
  durationEn?: string;
  deliveryDurationBn?: string;
  deliveryDurationEn?: string;
  tag?: string;
}

export interface Product {
  id: string;
  categoryId: string;
  catalogSectionId?: string;
  subcategoryBn?: string;
  subcategoryEn?: string;
  brandKey?: string;
  titleBn: string;
  titleEn: string;
  descriptionBn: string;
  descriptionEn: string;
  priceBdt: number;
  originalPriceBdt?: number;
  supplierPriceBdt?: number;
  discountPercent?: number;
  packages?: ProductPackage[];
  availability: 'in_stock' | 'limited' | 'out_of_stock';
  stockCount?: number;
  orderFormType?: OrderFormType;
  deliveryDurationBn: string;
  deliveryDurationEn: string;
  validityBn?: string;
  validityEn?: string;
  instructionsBn?: string;
  instructionsEn?: string;
  termsBn?: string;
  termsEn?: string;
  benefitsBn?: string;
  benefitsEn?: string;
  sectionTag?: ProductSectionTag;
  badge?: string;
  currency?: 'BDT';
  regularPriceBdt?: number;
  durationValue?: number;
  durationUnit?: 'days' | 'months' | 'years' | 'lifetime';
  durationLabelBn?: string;
  durationLabelEn?: string;
  features?: string[];
  imageUrl: string;
  bannerUrl?: string;
  customLogoUrl?: string;
  featured?: boolean;
  sortOrder?: number;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CartItem {
  product: Product;
  quantity: number;
  selectedPackage?: ProductPackage;
}

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  customerEmail?: string;
  customerName?: string;
  productId: string;
  productTitleBn?: string;
  productTitleEn?: string;
  selectedPackageName?: string;
  itemsSummary?: string;
  quantity?: number;
  couponCode?: string;
  discountBdt?: number;
  totalPriceBdt: number;
  paymentMethod: CheckoutPaymentMethod;
  transactionId: string;
  senderNumber: string;
  deliveryNote?: string;
  referenceAttachmentUrl?: string;
  status: OrderStatus;
  rejectionReason?: string;
  adminNote?: string;
  cashbackBdt?: number;
  cashbackAwarded?: boolean;
  referralProcessed?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Payment {
  id: string;
  orderId: string;
  orderNumber?: string;
  customerId: string;
  purpose?: 'order' | 'add_money';
  method: PaymentMethod;
  receiverNumber: string;
  senderNumber: string;
  transactionId: string;
  amountBdt: number;
  receiptDataUrl?: string;
  status: PaymentStatus;
  rejectionReason?: string;
  verifiedBy?: string;
  verifiedAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface WalletAccount {
  uid: string;
  availableBalanceBdt: number;
  promotionalCreditsBdt: number;
  totalAddedBdt: number;
  totalSpentBdt: number;
  coinsAvailable?: number;
  coinsPending?: number;
  coinsLifetimeEarned?: number;
  coinsRedeemed?: number;
  lastTxId?: string;
  updatedAt?: unknown;
}

export interface WalletTransaction {
  id: string;
  userId: string;
  userEmail?: string;
  type:
    | 'deposit'
    | 'purchase'
    | 'promo_credit'
    | 'refund'
    | 'admin_adjustment'
    | 'cashback'
    | 'referral'
    | 'rewarded_ad'
    | 'watch_earn_coin_redeem'
    | 'withdrawal'
    | 'withdrawal_refund';
  method: PaymentMethod | 'wallet' | 'system' | string;
  senderNumber?: string;
  transactionId: string;
  amountBdt: number;
  signedDeltaBdt?: number;
  receiptDataUrl?: string;
  status: 'Verification Pending' | 'Approved' | 'Rejected';
  note?: string;
  rejectionReason?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Advertisement {
  id: string;
  code: string;
  titleBn: string;
  titleEn: string;
  descriptionBn?: string;
  descriptionEn?: string;
  targetUrl: string;
  mediaType: 'external' | 'video' | 'image';
  adFormat?: AdFormat;
  networkName?: string;
  mediaUrl?: string;
  thumbnailUrl?: string;
  durationSeconds?: number;
  rewardAmountBdt?: number;
  placement: AdPlacement;
  priority: number;
  sortOrder: number;
  enabled: boolean;
  startDate?: string;
  endDate?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type AdNetworkProvider = 'adsense' | 'adsterra' | 'monetag' | 'propellerads' | 'custom_https';

export interface AdNetworkConfig {
  id: string;
  provider: AdNetworkProvider;
  name: string;
  adFormat: 'banner' | 'native' | 'social_bar';
  placement: BannerSlot | 'social_bar' | 'all';
  publisherId?: string;
  zoneId?: string;
  scriptSrc?: string;
  containerId?: string;
  supportsIncentivizedRewards?: boolean;
  approvalStatus: 'pending_approval' | 'active' | 'paused';
  enabled: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AdRevenueEntry {
  id: string;
  networkName: string;
  periodLabel: string;
  verifiedAmountBdt: number;
  reportedUsd?: number;
  referenceId?: string;
  verifiedBy: string;
  createdAt?: unknown;
}

export interface Banner {
  id: string;
  titleBn: string;
  titleEn: string;
  subtitleBn?: string;
  subtitleEn?: string;
  slot: BannerSlot;
  targetUrl: string;
  imageUrl?: string;
  mobileImageUrl?: string;
  adCode?: string;
  sortOrder: number;
  priority: number;
  enabled: boolean;
  startDate?: string;
  endDate?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type HeroBannerLinkType = 'internal_route' | 'external_url';
export type HeroBannerDevice = 'both' | 'desktop' | 'mobile';
export type HeroBannerImageFit = 'cover' | 'contain';
export type HeroBannerIconName =
  | 'sparkles'
  | 'gamepad'
  | 'gift'
  | 'flame'
  | 'zap'
  | 'crown'
  | 'tv'
  | 'star'
  | 'shopping'
  | 'shield'
  | 'smartphone'
  | 'award';

export interface HeroBanner {
  id: string;
  badgeBn: string;
  badgeEn: string;
  titleBn: string;
  titleEn: string;
  subtitleBn: string;
  subtitleEn: string;
  buttonTextBn: string;
  buttonTextEn: string;
  linkType: HeroBannerLinkType;
  ctaRoute?: AppRoute;
  targetUrl?: string;
  openInNewTab?: boolean;
  clickable?: boolean;
  iconName?: HeroBannerIconName;
  showIcon?: boolean;
  imageFit?: HeroBannerImageFit;
  imageUrl: string;
  mobileImageUrl?: string;
  deviceVisibility: HeroBannerDevice;
  sortOrder: number;
  enabled: boolean;
  startDate?: string;
  endDate?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface DailyRewardDayItem {
  dayNumber: number;
  labelEn: string;
  labelBn: string;
  coins: number;
  claimed: boolean;
  isCurrent: boolean;
  isBonusMilestone: boolean;
}

export interface DailyRewardClaimRecord {
  id: string;
  userId: string;
  displayName?: string;
  contact?: string;
  claimDate: string;
  streakDay: number;
  baseCoins: number;
  bonusCoins: number;
  totalCoins: number;
  status: 'Credited' | 'Rejected' | string;
  transactionId: string;
  createdAt: number;
}

export interface DailyRewardStatus {
  enabled: boolean;
  dailyCoins: number;
  streakEnabled: boolean;
  streakDay7BonusCoins: number;
  todayDate: string;
  nextResetAt: number;
  isAuthenticated: boolean;
  claimedToday: boolean;
  currentStreak: number;
  longestStreak: number;
  lastClaimDate: string;
  totalClaims: number;
  coinsAvailable: number;
  todayClaim?: DailyRewardClaimRecord | null;
  weekDays: DailyRewardDayItem[];
}

export type AdSlotCategory =
  | 'main_ad'
  | 'reward_ad'
  | 'banner_ad'
  | 'small_banner'
  | 'medium_banner'
  | 'large_banner'
  | 'additional_ads';

export type AdPlacementSlot =
  | 'top_header'
  | 'home_main'
  | 'sidebar'
  | 'product_page'
  | 'dashboard'
  | 'watch_earn'
  | 'slider'
  | 'in_page'
  | 'footer'
  | 'available_ads'
  | AdSlotCategory;

export type ManagedAdUnitFormat = 'script_pop' | 'direct_link' | 'native_widget' | 'banner_iframe';
export type ManagedAdUnitStatus = 'idle' | 'loading' | 'loaded' | 'blocked' | 'error';
export type AdUnitProviderName = 'AFDERS' | 'ARWF' | 'BICEA' | 'AUCTIONR' | 'ASIAFILM' | 'DIGITAL_HUB';

export interface ManagedAdUnitConfig {
  id: string;
  unitNumber: number;
  provider: AdUnitProviderName;
  slotCategory?: AdSlotCategory;
  label: string;
  labelBn: string;
  format: ManagedAdUnitFormat;
  originalUrl: string;
  rawScriptHtml: string;
  bannerKey?: string;
  dimensions?: { width: number; height: number };
  containerId?: string;
  placements: AdPlacementSlot[];
  enabled: boolean;
  showOnMobile: boolean;
  showOnDesktop: boolean;
  priority: number;
  rotationSeconds: number;
  supportsRewardedVerification: boolean;
  loadStatus?: ManagedAdUnitStatus;
  lastError?: string;
  updatedAt?: unknown;
}

export interface AdViewingSession {
  id: string;
  userId: string;
  userEmail?: string;
  unitId: string;
  provider: string;
  sessionToken: string;
  status:
    | 'initiated'
    | 'watching'
    | 'awaiting_callback'
    | 'verified'
    | 'credited'
    | 'load_failed'
    | 'verification_failed'
    | 'expired';
  coinsAwarded: number;
  failureReason?: string;
  providerEventId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  verifiedAt?: unknown;
}

export interface AdRewardTransaction {
  id: string;
  sessionId: string;
  userId: string;
  userEmail?: string;
  unitId?: string;
  adTitle?: string;
  provider: string;
  coins: number;
  bdtEquivalent: number;
  type:
    | 'coin_credit'
    | 'watch_earn_credit'
    | 'coin_redemption'
    | 'daily_login_reward'
    | 'daily_login_streak_bonus'
    | 'admin_coin_credit'
    | 'admin_coin_deduct';
  status: 'Pending Credit' | 'Credited' | 'Rejected';
  note?: string;
  refId?: string;
  createdAt?: unknown;
}

export interface Referral {
  id: string;
  referrerId: string;
  referredUserId: string;
  referredEmail?: string;
  referralCode: string;
  rewardAmountBdt: number;
  invitedRewardBdt?: number;
  eligibilityRule?: 'verified_signup' | 'first_paid_order' | 'first_rewarded_ad';
  suspiciousFlag?: boolean;
  suspiciousReason?: string;
  status: 'pending' | 'qualified' | 'credited' | 'revoked' | 'flagged';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ReferralReward {
  id: string;
  referralId: string;
  userId: string;
  amountBdt: number;
  status: 'credited' | 'revoked';
  createdAt?: unknown;
}

export interface Coupon {
  id: string;
  code: string;
  discountType: 'fixed' | 'percent';
  discountValue: number;
  minOrderBdt: number;
  usageLimit: number;
  usedCount: number;
  expiresAt?: string;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Review {
  id: string;
  productId: string;
  orderId: string;
  userId: string;
  authorName: string;
  rating: number;
  comment: string;
  approved: boolean;
  createdAt?: unknown;
}

export interface AppNotification {
  id: string;
  userId: string;
  titleBn: string;
  titleEn: string;
  messageBn: string;
  messageEn: string;
  type:
    | 'order'
    | 'payment'
    | 'promo'
    | 'support'
    | 'wallet'
    | 'referral'
    | 'system'
    | 'new_app'
    | 'app_update'
    | 'announcement'
    | 'download'
    | 'reward';
  read: boolean;
  createdAt?: unknown;
}

export interface SupportTicket {
  id: string;
  userId: string;
  userEmail?: string;
  category?: string;
  subject: string;
  message: string;
  orderNumber?: string;
  screenshotDataUrl?: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  adminReply?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface SiteSettings {
  id: string;
  siteName: string;
  logoUrl?: string;
  faviconUrl?: string;
  taglineBn?: string;
  taglineEn?: string;
  descriptionBn?: string;
  descriptionEn?: string;
  announcementBn?: string;
  announcementEn?: string;
  bkashNumber: string;
  nagadNumber: string;
  rocketNumber: string;
  bkashType?: 'Personal' | 'Merchant' | 'Agent';
  nagadType?: 'Personal' | 'Merchant' | 'Agent';
  rocketType?: 'Personal' | 'Merchant' | 'Agent';
  bkashEnabled?: boolean;
  nagadEnabled?: boolean;
  rocketEnabled?: boolean;
  bkashLogoUrl?: string;
  nagadLogoUrl?: string;
  rocketLogoUrl?: string;
  bkashNoteBn?: string;
  bkashNoteEn?: string;
  nagadNoteBn?: string;
  nagadNoteEn?: string;
  rocketNoteBn?: string;
  rocketNoteEn?: string;
  registrationEnabled?: boolean;
  emailAuthEnabled?: boolean;
  phoneAuthEnabled?: boolean;
  withdrawalsEnabled?: boolean;
  minWithdrawalBdt?: number;
  referralBonusBdt: number;
  invitedUserRewardBdt?: number;
  referralEnabled?: boolean;
  referralMinOrderBdt?: number;
  referralMaxRewardBdt?: number;
  referralEligibility?: 'verified_signup' | 'first_paid_order' | 'first_rewarded_ad';
  cashbackEnabled?: boolean;
  cashbackPercent?: number;
  cashbackMinOrderBdt?: number;
  cashbackMaxPerOrderBdt?: number;
  rewardedAdEnabled?: boolean;
  rewardedAdAmountBdt?: number;
  rewardedAdCooldownMinutes?: number;
  rewardedAdDailyLimit?: number;
  watchEarnEnabled?: boolean;
  watchEarnCoinsPerAd?: number;
  watchEarnCoinsPerBdt?: number;
  watchEarnDailyCoinLimit?: number;
  watchEarnMinRedeemCoins?: number;
  heroAutoPlayMs?: number;
  dailyRewardEnabled?: boolean;
  dailyRewardCoins?: number;
  streakEnabled?: boolean;
  streakDay7BonusCoins?: number;
  adsEnabled: boolean;
  maintenanceMode?: boolean;
  defaultTheme?: 'light' | 'dark';
  loginAlertsEnabled?: boolean;
  contactEmail?: string;
  contactPhone?: string;
  supportContact?: string;
  whatsappLink?: string;
  telegramLink?: string;
  telegramChannelLink?: string;
  messengerLink?: string;
  facebookLink?: string;
  aboutBn?: string;
  aboutEn?: string;
  termsBn?: string;
  termsEn?: string;
  privacyBn?: string;
  privacyEn?: string;
  refundBn?: string;
  refundEn?: string;
  accentColor?: string;
  homepageSections?: HomepageSectionConfig[];
  updatedAt?: unknown;
}

export type HomepageSectionId =
  | 'hero'
  | 'daily_reward'
  | 'quick_categories'
  | 'browse_23'
  | 'pwa_card'
  | 'watch_earn'
  | 'capcut_recharge'
  | 'featured_apps'
  | 'featured_games'
  | 'gaming_topups'
  | 'flash_sale'
  | 'hot_products'
  | 'streaming_ai'
  | 'trending_services'
  | 'best_sellers'
  | 'payment_channels'
  | 'spotlight'
  | 'ad_player'
  | 'reviews'
  | 'why_faq';

export interface HomepageSectionConfig {
  id: HomepageSectionId;
  labelEn: string;
  labelBn: string;
  visible: boolean;
  order: number;
  limit?: number;
}

export type GameCategoryId =
  | 'android_games'
  | 'online_games'
  | 'casual_games'
  | 'popular_games'
  | 'new_games';

export interface GameItem {
  id: string;
  slug: string;
  titleEn: string;
  titleBn: string;
  category: GameCategoryId;
  developer: string;
  shortDescBn: string;
  shortDescEn: string;
  imageUrl: string;
  screenshots?: string[];
  playUrl?: string;
  downloadUrl?: string;
  relatedProductId?: string;
  version?: string;
  sizeLabel?: string;
  featured?: boolean;
  popular?: boolean;
  trending?: boolean;
  isNew?: boolean;
  visible?: boolean;
  updatedAt?: number;
}

export interface GameMetaPayload {
  statsByGame: Record<string, { views: number; plays: number; downloads: number }>;
}

export interface DownloadHistoryItem {
  id: string;
  appId: string;
  contentId: string;
  contentType: string;
  pagePath: string;
  deviceType: string;
  eventType: string;
  createdAt: number;
}

export type WithdrawalStatus = 'Pending' | 'Approved' | 'Processing' | 'Paid' | 'Rejected';

export interface WithdrawalRequest {
  id: string;
  userId: string;
  userName?: string;
  userEmail: string;
  method: string;
  methodName?: string;
  accountNumber: string;
  accountHolderName?: string;
  amountBdt: number;
  status: WithdrawalStatus;
  walletTxId?: string;
  payoutReference?: string;
  adminNote?: string;
  rejectionReason?: string;
  processedBy?: string;
  paidAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type AnnouncementType =
  | 'info'
  | 'promo'
  | 'policy'
  | 'maintenance'
  | 'general'
  | 'offer'
  | 'update'
  | 'important';

export interface Announcement {
  id: string;
  titleBn: string;
  titleEn: string;
  messageBn: string;
  messageEn: string;
  type: AnnouncementType;
  imageUrl?: string;
  startDate?: string;
  expiresAt?: string;
  dismissible?: boolean;
  createdBy: string;
  active: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RewardedAdClaim {
  id: string;
  userId: string;
  userEmail?: string;
  networkId: string;
  networkName: string;
  amountBdt: number;
  claimDate: string;
  status: 'Pending Credit' | 'Credited' | 'Rejected';
  rejectionReason?: string;
  creditedBy?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface AuditLog {
  id: string;
  actorUid: string;
  actorEmail?: string;
  action: string;
  targetCollection: string;
  targetId: string;
  targetUserId?: string;
  previousValue?: string;
  newValue?: string;
  reason?: string;
  transactionId?: string;
  summary: string;
  createdAt?: unknown;
}

export interface AdminUserDetailPayload {
  profile: UserProfile;
  wallet: WalletAccount;
  summary: {
    totalEarningsBdt: number;
    referralEarningsBdt: number;
    totalWithdrawnBdt: number;
    pendingWithdrawalBdt: number;
    referralCount: number;
    orderCount: number;
    activeSessionCount: number;
  };
  walletTxs: WalletTransaction[];
  withdrawals: WithdrawalRequest[];
  referrals: Referral[];
  orders: Order[];
  sessions: Array<{
    id: string;
    ipAddress: string;
    userAgent: string;
    createdAt: number;
    lastSeenAt: number;
    expiresAt: number;
  }>;
  auditLogs: AuditLog[];
}

export interface AdminSecurityPayload {
  superAdminEmail: string;
  activeSessions: Array<{
    id: string;
    userId: string;
    userName: string;
    userIdentifier: string;
    role: 'super_admin' | 'admin' | 'user';
    ipAddress: string;
    userAgent: string;
    createdAt: number;
    lastSeenAt: number;
    expiresAt: number;
    isCurrent: boolean;
  }>;
  authAttempts: Array<{
    key: string;
    attempts: number;
    windowStart: number;
    lockedUntil: number;
    isLocked: boolean;
  }>;
  deletionRequests: AccountDeletionRequest[];
  flaggedReferrals: Referral[];
  suspiciousAccounts?: Array<{
    uid: string;
    userName: string;
    identifier: string;
    severity: 'high' | 'medium';
    reason: string;
    details: string;
    lastSeenAt: number;
  }>;
  repeatedPaymentAttempts?: Array<{
    key: string;
    label: string;
    totalCount: number;
    rejectedCount: number;
    recent24hCount: number;
    totalAmountBdt: number;
    lastAttemptAt: number;
    reason: string;
  }>;
  abnormalReferrals?: Array<{
    referrerId: string;
    referrerLabel: string;
    totalReferrals: number;
    last24hCount: number;
    flaggedCount: number;
    lastReferralAt: number;
    reason: string;
  }>;
}

export interface ServerAdAnalytics {
  totalImpressions: number;
  totalClicks: number;
  ctr: number;
  blockedFakeClicks?: number;
  byFormat?: Record<string, { impressions: number; clicks: number }>;
  byAd: Record<
    string,
    {
      impressions: number;
      clicks: number;
      byPlacement: Record<string, { impressions: number; clicks: number }>;
      lastEventAt: string;
    }
  >;
}

export type AnalyticsEventType =
  | 'page_view'
  | 'homepage_view'
  | 'heartbeat'
  | 'app_view'
  | 'app_download'
  | 'download_click'
  | 'game_view'
  | 'play_click'
  | 'product_view'
  | 'service_view'
  | 'external_link_click'
  | 'search'
  | 'favorite'
  | 'signup'
  | 'login'
  | 'order_created'
  | 'order_completed';

export interface AdminAnalyticsPayload {
  range: { from: number; to: number };
  kpis: {
    totalUsers: number;
    todayNewUsers: number;
    activeUsersToday: number;
    activeUsers7d: number;
    activeUsers30d: number;
    totalVisitors: number;
    uniqueVisitors: number;
    onlineUsers: number;
    totalDownloads: number;
    todayDownloads: number;
    totalRewardClaims: number;
    totalCoinsDistributed: number;
    todayDailyRewardClaims?: number;
    totalDailyRewardClaims?: number;
    totalDailyRewardCoins?: number;
    activeHeroBanners?: number;
    publishedAnnouncements?: number;
    pendingWithdrawals: number;
    pendingTickets: number;
  };
  overview?: {
    visitorsToday: number;
    visitorsYesterday: number;
    visitorsTodayPageViews: number;
    visitorsYesterdayPageViews: number;
    visitorsThisMonth: number;
    visitorsLast7d: number;
    visitorsPrev7d: number;
    totalVisitorsOverall: number;
    uniqueVisitorsInRange: number;
    returningVisitorsInRange: number;
    currentlyActiveVisitors: number;
    totalPageViews: number;
    totalHomepageViews: number;
    totalAppViews: number;
    totalGameViews: number;
    totalProductViews: number;
    totalServiceViews: number;
    totalDownloadClicks: number;
    todayDownloadClicks: number;
    totalPlayClicks: number;
    totalExternalClicks: number;
    totalSearches: number;
    totalOrders: number;
    pendingOrders: number;
    completedOrders: number;
    ordersInRange: number;
  };
  comparisonSummary?: {
    current: { uniqueVisitors: number; pageViews: number; downloadClicks: number; orders: number };
    previous: { uniqueVisitors: number; pageViews: number; downloadClicks: number; orders: number };
    deltasPct: { uniqueVisitors: number; pageViews: number; downloadClicks: number; orders: number };
  };
  deviceSplit: { mobile: number; tablet?: number; desktop: number };
  browserSplit?: Array<{ name: string; count: number }>;
  osSplit?: Array<{ name: string; count: number }>;
  countrySplit?: Array<{ name: string; count: number }>;
  dailySeries: Array<{
    date: string;
    visitors?: number;
    uniqueVisitors: number;
    returningVisitors?: number;
    pageViews: number;
    appViews?: number;
    gameViews?: number;
    serviceViews?: number;
    downloads: number;
    downloadClicks?: number;
    playClicks?: number;
    orders?: number;
    registrations: number;
    coinsDistributed: number;
  }>;
  topPages: Array<{ path: string; views: number }>;
  topApps: Array<{ appId: string; downloads: number }>;
  trafficSources: Array<{ source: string; visits: number }>;
  liveVisitors?: {
    activeCount: number;
    activeSessions: Array<{
      sessionId: string;
      visitorId: string;
      isMember: boolean;
      isReturning: boolean;
      visitCount: number;
      currentPage: string;
      lastEventType: string;
      lastContentId: string;
      deviceType: string;
      browser: string;
      os: string;
      referrerHost: string;
      country: string;
      firstSeenAt: number;
      lastSeenAt: number;
    }>;
    recentEvents: Array<{
      id: string;
      visitorId: string;
      isMember: boolean;
      eventType: string;
      pagePath: string;
      contentId: string;
      contentType: string;
      deviceType: string;
      browser: string;
      os: string;
      country: string;
      referrerHost: string;
      createdAt: number;
    }>;
  };
  contentStats?: Array<{
    id: string;
    contentType: 'app' | 'game' | 'service';
    category: string;
    totalViews: number;
    uniqueViews: number;
    viewsToday: number;
    viewsYesterday: number;
    views7d: number;
    views30d: number;
    downloadClicks: number;
    playClicks: number;
    externalClicks: number;
    favoritesCount: number;
    ordersCount: number;
    conversionRate: number;
    lastViewedAt: number;
  }>;
}

export interface AdminCoinsOverview {
  balances: Array<{
    userId: string;
    displayName: string;
    contact: string;
    coinsAvailable: number;
    coinsLifetimeEarned: number;
    coinsRedeemed: number;
    updatedAt: number;
  }>;
  transactions: AdRewardTransaction[];
  rewardClaims: RewardedAdClaim[];
}

export interface AppReviewItem {
  id: string;
  appId: string;
  userId: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: number;
}

export interface AppMetaPayload {
  statsByApp: Record<string, { views?: number; downloads: number; ratingAvg: number; ratingCount: number }>;
  reviews: AppReviewItem[];
  favoriteAppIds: string[];
}

export interface AppBrokenReport {
  id: string;
  appId: string;
  appName: string;
  userId: string;
  reason: string;
  status: 'open' | 'resolved' | string;
  createdAt: number;
}

export type DeveloperRank = 'verified' | 'blue' | 'silver' | 'gold';

export interface DeveloperSocialLinks {
  github?: string;
  linkedin?: string;
  portfolio?: string;
  telegram?: string;
  facebook?: string;
  x?: string;
}

export interface DeveloperProfile {
  id: string;
  name: string;
  title: string;
  rank: DeveloperRank;
  verified: boolean;
  bio: string;
  photoUrl: string;
  socialLinks?: DeveloperSocialLinks;
  sortOrder: number;
  active: boolean;
  createdAt?: number;
  updatedAt?: number;
}

