export type Language = 'bn' | 'en';

export type PaymentMethod = 'bkash' | 'nagad' | 'rocket';
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
  tag?: string;
}

export interface Product {
  id: string;
  categoryId: string;
  subcategoryBn?: string;
  subcategoryEn?: string;
  brandKey?: string;
  titleBn: string;
  titleEn: string;
  descriptionBn: string;
  descriptionEn: string;
  priceBdt: number;
  originalPriceBdt?: number;
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
  | 'available_ads';

export type ManagedAdUnitFormat = 'script_pop' | 'direct_link' | 'native_widget' | 'banner_iframe';
export type ManagedAdUnitStatus = 'idle' | 'loading' | 'loaded' | 'blocked' | 'error';
export type AdUnitProviderName = 'AFDERS' | 'ARWF' | 'BICEA' | 'AUCTIONR' | 'ASIAFILM';

export interface ManagedAdUnitConfig {
  id: string;
  unitNumber: number;
  provider: AdUnitProviderName;
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
  status: 'initiated' | 'awaiting_callback' | 'verified' | 'credited' | 'verification_failed' | 'expired';
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
  provider: string;
  coins: number;
  bdtEquivalent: number;
  type: 'coin_credit' | 'watch_earn_credit' | 'coin_redemption';
  status: 'Pending Credit' | 'Credited' | 'Rejected';
  note?: string;
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
  type: 'order' | 'payment' | 'promo' | 'support' | 'wallet' | 'referral' | 'system';
  read: boolean;
  createdAt?: unknown;
}

export interface SupportTicket {
  id: string;
  userId: string;
  userEmail?: string;
  subject: string;
  message: string;
  orderNumber?: string;
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
  facebookLink?: string;
  aboutBn?: string;
  aboutEn?: string;
  termsBn?: string;
  termsEn?: string;
  privacyBn?: string;
  privacyEn?: string;
  refundBn?: string;
  refundEn?: string;
  updatedAt?: unknown;
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

export interface Announcement {
  id: string;
  titleBn: string;
  titleEn: string;
  messageBn: string;
  messageEn: string;
  type: 'info' | 'promo' | 'policy' | 'maintenance';
  createdBy: string;
  active: boolean;
  createdAt?: unknown;
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
