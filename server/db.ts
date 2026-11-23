import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number } }>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  exec?(query: string): Promise<unknown>;
}

export interface AppDatabase {
  readonly driver: 'd1' | 'node-sqlite';
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  first<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>;
  exec(sql: string): Promise<void>;
}

export class DatabaseNotConfiguredError extends Error {
  readonly code = 'DATABASE_NOT_CONFIGURED';
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseNotConfiguredError';
  }
}

let workerRuntimeEnv: Record<string, unknown> | null = null;
let cachedD1Instance: AppDatabase | null = null;
let cachedD1RawRef: unknown = null;
let cachedNodeSqlite: AppDatabase | null = null;
let schemaInitializedFor: WeakSet<AppDatabase> = new WeakSet();
let legacyNotNullPhoneDbs: WeakSet<AppDatabase> = new WeakSet();

export function extractPublicPhone(raw: unknown): string {
  return typeof raw === 'string' && raw.startsWith('+') ? raw : '';
}

export function getEmptyPhoneStorageValue(db: AppDatabase, uid: string): string | null {
  return legacyNotNullPhoneDbs.has(db) ? `email:${uid}` : null;
}

export function setWorkerRuntimeEnv(env: Record<string, unknown>): void {
  workerRuntimeEnv = env;
}

export function getRuntimeEnvVar(name: string): string {
  if (workerRuntimeEnv && typeof workerRuntimeEnv[name] === 'string') {
    return String(workerRuntimeEnv[name]);
  }
  if (typeof process !== 'undefined' && process.env && typeof process.env[name] === 'string') {
    return String(process.env[name]);
  }
  return '';
}

function isD1Database(val: unknown): val is D1DatabaseLike {
  return Boolean(val && typeof val === 'object' && typeof (val as D1DatabaseLike).prepare === 'function');
}

function wrapD1Database(d1: D1DatabaseLike): AppDatabase {
  return {
    driver: 'd1',
    async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const stmt = params.length > 0 ? d1.prepare(sql).bind(...params) : d1.prepare(sql);
      const res = await stmt.all<T>();
      return Array.isArray(res?.results) ? res.results : [];
    },
    async first<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
      const stmt = params.length > 0 ? d1.prepare(sql).bind(...params) : d1.prepare(sql);
      const row = await stmt.first<T>();
      return row ?? null;
    },
    async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
      const stmt = params.length > 0 ? d1.prepare(sql).bind(...params) : d1.prepare(sql);
      const res = await stmt.run();
      return { changes: Number(res?.meta?.changes || 0) };
    },
    async exec(sql: string): Promise<void> {
      const statements = sql
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const stmt of statements) {
        await d1.prepare(stmt).run();
      }
    },
  };
}

function resolveNodeDbFilePath(): string | null {
  try {
    if (typeof import.meta.url === 'string' && import.meta.url.startsWith('file:')) {
      const moduleDir = path.dirname(fileURLToPath(import.meta.url));
      const dataDir = path.resolve(moduleDir, '..', '.data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      return path.join(dataDir, 'digital_hub.sqlite');
    }
  } catch {
    // Non-filesystem runtime (Cloudflare Workers)
  }
  return null;
}

async function openNodeSqliteDatabase(): Promise<AppDatabase | null> {
  if (cachedNodeSqlite) return cachedNodeSqlite;
  const dbPath = resolveNodeDbFilePath();
  if (!dbPath) return null;

  try {
    // Use dynamic import with computed specifier so Cloudflare Workers bundler does not bundle node:sqlite
    const modName = ['node', 'sqlite'].join(':');
    const sqliteMod = (await import(/* @vite-ignore */ modName)) as {
      DatabaseSync: new (filePath: string) => {
        exec(sql: string): void;
        prepare(sql: string): {
          all(...params: unknown[]): Record<string, unknown>[];
          get(...params: unknown[]): Record<string, unknown> | undefined;
          run(...params: unknown[]): { changes?: number | bigint };
        };
      };
    };

    const rawDb = new sqliteMod.DatabaseSync(dbPath);
    rawDb.exec('PRAGMA journal_mode = WAL;');
    rawDb.exec('PRAGMA foreign_keys = ON;');
    rawDb.exec('PRAGMA busy_timeout = 5000;');

    cachedNodeSqlite = {
      driver: 'node-sqlite',
      async all<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
        return rawDb.prepare(sql).all(...params) as T[];
      },
      async first<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T | null> {
        const row = rawDb.prepare(sql).get(...params);
        return (row as T | undefined) ?? null;
      },
      async run(sql: string, params: unknown[] = []): Promise<{ changes: number }> {
        const info = rawDb.prepare(sql).run(...params);
        return { changes: Number(info?.changes || 0) };
      },
      async exec(sql: string): Promise<void> {
        rawDb.exec(sql);
      },
    };
    return cachedNodeSqlite;
  } catch {
    return null;
  }
}

const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    phone_e164 TEXT UNIQUE,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    email_normalized TEXT UNIQUE,
    auth_method TEXT NOT NULL DEFAULT 'phone',
    photo_url TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    recovery_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    status TEXT NOT NULL DEFAULT 'active',
    referral_code TEXT NOT NULL UNIQUE,
    referred_by TEXT NOT NULL DEFAULT '',
    promotional_credits REAL NOT NULL DEFAULT 0,
    language TEXT NOT NULL DEFAULT 'bn',
    session_revoked_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_phone_e164 ON users(phone_e164)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code)`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    ip_address TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(uid) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)`,
  `CREATE TABLE IF NOT EXISTS auth_attempts (
    attempt_key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    window_start INTEGER NOT NULL,
    locked_until INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS wallet_accounts (
    uid TEXT PRIMARY KEY,
    available_balance_bdt REAL NOT NULL DEFAULT 0,
    promotional_credits_bdt REAL NOT NULL DEFAULT 0,
    total_added_bdt REAL NOT NULL DEFAULT 0,
    total_spent_bdt REAL NOT NULL DEFAULT 0,
    last_tx_id TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (uid) REFERENCES users(uid) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS wallet_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    amount_bdt REAL NOT NULL,
    status TEXT NOT NULL,
    transaction_id TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_id ON wallet_transactions(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT NOT NULL UNIQUE,
    customer_id TEXT NOT NULL,
    status TEXT NOT NULL,
    transaction_id TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    customer_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS used_transaction_ids (
    tx_key TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS referrals (
    id TEXT PRIMARY KEY,
    referrer_uid TEXT NOT NULL,
    referred_uid TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_uid, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Open',
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_tickets_user_id ON support_tickets(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS withdrawals (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending',
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS rewarded_claims (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Pending Verification',
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_rewarded_claims_user_id ON rewarded_claims(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS watch_earn_balances (
    user_id TEXT PRIMARY KEY,
    coins_available INTEGER NOT NULL DEFAULT 0,
    coins_lifetime_earned INTEGER NOT NULL DEFAULT 0,
    coins_redeemed INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ad_viewing_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    session_token TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'Pending',
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ad_sessions_user_id ON ad_viewing_sessions(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS ad_reward_transactions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL,
    coins INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ad_reward_tx_user_id ON ad_reward_transactions(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    active INTEGER NOT NULL DEFAULT 1,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS deletion_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_uid TEXT NOT NULL,
    action TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS catalog_overrides (
    collection TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (collection, doc_id)
  )`,
  `CREATE TABLE IF NOT EXISTS payment_methods (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'mobile_banking',
    account_number TEXT NOT NULL DEFAULT '',
    account_name TEXT NOT NULL DEFAULT '',
    instructions_bn TEXT NOT NULL DEFAULT '',
    instructions_en TEXT NOT NULL DEFAULT '',
    requirements_bn TEXT NOT NULL DEFAULT '',
    requirements_en TEXT NOT NULL DEFAULT '',
    min_amount REAL NOT NULL DEFAULT 50,
    max_amount REAL NOT NULL DEFAULT 100000,
    supports_deposit INTEGER NOT NULL DEFAULT 1,
    supports_withdrawal INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payment_methods_sort ON payment_methods(sort_order ASC, name ASC)`,
  `CREATE TABLE IF NOT EXISTS ad_stats (
    ad_id TEXT PRIMARY KEY,
    ad_format TEXT NOT NULL DEFAULT 'direct_link',
    impressions INTEGER NOT NULL DEFAULT 0,
    clicks INTEGER NOT NULL DEFAULT 0,
    blocked_clicks INTEGER NOT NULL DEFAULT 0,
    by_placement_json TEXT NOT NULL DEFAULT '{}',
    last_event_at INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS media_assets (
    id TEXT PRIMARY KEY,
    mime_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    data_base64 TEXT NOT NULL,
    uploaded_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_media_assets_created ON media_assets(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_rewarded_claims_created ON rewarded_claims(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_ad_reward_tx_created ON ad_reward_transactions(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    session_id TEXT NOT NULL DEFAULT '',
    user_id TEXT NOT NULL DEFAULT '',
    event_type TEXT NOT NULL,
    page_path TEXT NOT NULL DEFAULT '/',
    app_id TEXT NOT NULL DEFAULT '',
    content_id TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL DEFAULT '',
    content_category TEXT NOT NULL DEFAULT '',
    device_type TEXT NOT NULL DEFAULT 'desktop',
    browser TEXT NOT NULL DEFAULT '',
    os TEXT NOT NULL DEFAULT '',
    country TEXT NOT NULL DEFAULT '',
    referrer_host TEXT NOT NULL DEFAULT '',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_event_created ON analytics_events(event_type, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_analytics_visitor_created ON analytics_events(visitor_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS visitor_sessions (
    session_id TEXT PRIMARY KEY,
    visitor_id TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    visit_count INTEGER NOT NULL DEFAULT 1,
    is_returning INTEGER NOT NULL DEFAULT 0,
    current_page TEXT NOT NULL DEFAULT '/',
    last_event_type TEXT NOT NULL DEFAULT 'page_view',
    last_content_id TEXT NOT NULL DEFAULT '',
    device_type TEXT NOT NULL DEFAULT 'desktop',
    browser TEXT NOT NULL DEFAULT '',
    os TEXT NOT NULL DEFAULT '',
    referrer_host TEXT NOT NULL DEFAULT 'direct',
    country TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE INDEX IF NOT EXISTS idx_visitor_sessions_last_seen ON visitor_sessions(last_seen_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_visitor_sessions_visitor ON visitor_sessions(visitor_id, last_seen_at DESC)`,
  `CREATE TABLE IF NOT EXISTS app_favorites (
    user_id TEXT NOT NULL,
    app_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, app_id)
  )`,
  `CREATE TABLE IF NOT EXISTS app_reviews (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_app_reviews_app ON app_reviews(app_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS app_broken_reports (
    id TEXT PRIMARY KEY,
    app_id TEXT NOT NULL,
    app_name TEXT NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_app_broken_reports_created ON app_broken_reports(created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS daily_login_claims (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    claim_date TEXT NOT NULL,
    streak_day INTEGER NOT NULL DEFAULT 1,
    base_coins INTEGER NOT NULL DEFAULT 10,
    bonus_coins INTEGER NOT NULL DEFAULT 0,
    total_coins INTEGER NOT NULL DEFAULT 10,
    status TEXT NOT NULL DEFAULT 'Credited',
    transaction_id TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, claim_date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_daily_claims_date ON daily_login_claims(claim_date, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_daily_claims_user ON daily_login_claims(user_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS daily_login_streaks (
    user_id TEXT PRIMARY KEY,
    current_streak INTEGER NOT NULL DEFAULT 0,
    longest_streak INTEGER NOT NULL DEFAULT 0,
    last_claim_date TEXT NOT NULL DEFAULT '',
    total_claims INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS developers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    rank TEXT NOT NULL DEFAULT 'verified',
    verified INTEGER NOT NULL DEFAULT 1,
    bio TEXT NOT NULL DEFAULT '',
    photo_url TEXT NOT NULL DEFAULT '',
    social_links_json TEXT NOT NULL DEFAULT '{}',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_developers_active_order ON developers(active, sort_order ASC, created_at ASC)`,
];

async function seedDefaultPaymentMethodsIfEmpty(db: AppDatabase): Promise<void> {
  const existing = await db.first<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM payment_methods');
  if (Number(existing?.cnt || 0) > 0) return;
  const now = Date.now();
  const defaults = [
    {
      id: 'pm_bkash',
      code: 'bkash',
      name: 'bKash',
      type: 'mobile_banking',
      accountNumber: '01727936180',
      accountName: 'Personal',
      instructionsBn: 'বিকাশ অ্যাপ থেকে Send Money করে সঠিক TrxID ও প্রেরক নম্বর জমা দিন।',
      instructionsEn: 'Use bKash Send Money and submit the exact TrxID and sender number.',
      requirementsBn: '১১ ডিজিটের বৈধ বাংলাদেশি বিকাশ নম্বর প্রয়োজন।',
      requirementsEn: 'Valid 11-digit Bangladesh bKash number required.',
      minAmount: 50,
      maxAmount: 100000,
      supportsDeposit: 1,
      supportsWithdrawal: 1,
      enabled: 1,
      sortOrder: 1,
    },
    {
      id: 'pm_nagad',
      code: 'nagad',
      name: 'Nagad',
      type: 'mobile_banking',
      accountNumber: '01772558301',
      accountName: 'Personal',
      instructionsBn: 'নগদ অ্যাপ থেকে Send Money করে সঠিক TrxID ও স্ক্রিনশট দিন।',
      instructionsEn: 'Send Money via Nagad app and submit the exact TrxID and receipt.',
      requirementsBn: '১১ ডিজিটের বৈধ বাংলাদেশি নগদ নম্বর প্রয়োজন।',
      requirementsEn: 'Valid 11-digit Bangladesh Nagad number required.',
      minAmount: 50,
      maxAmount: 100000,
      supportsDeposit: 1,
      supportsWithdrawal: 1,
      enabled: 1,
      sortOrder: 2,
    },
    {
      id: 'pm_rocket',
      code: 'rocket',
      name: 'Rocket',
      type: 'mobile_banking',
      accountNumber: '01799792541',
      accountName: 'Personal',
      instructionsBn: 'রকেট থেকে Send Money করে সঠিক TrxID ও স্ক্রিনশট দিন।',
      instructionsEn: 'Send Money via Rocket and submit the exact TrxID and receipt.',
      requirementsBn: '১১ বা ১২ ডিজিটের বৈধ রকেট নম্বর প্রয়োজন।',
      requirementsEn: 'Valid 11 or 12-digit Rocket number required.',
      minAmount: 50,
      maxAmount: 100000,
      supportsDeposit: 1,
      supportsWithdrawal: 1,
      enabled: 1,
      sortOrder: 3,
    },
    {
      id: 'pm_bank_transfer',
      code: 'bank_transfer',
      name: 'Bank Transfer',
      type: 'bank_transfer',
      accountNumber: '',
      accountName: 'Bank Account / Routing Info',
      instructionsBn: 'ব্যাংক ট্রান্সফারের জন্য অ্যাকাউন্ট নম্বর, অ্যাকাউন্টের নাম ও ব্যাংকের নাম উল্লেখ করুন।',
      instructionsEn: 'Provide your Bank Name, Account Holder Name, Account Number, and Branch/Routing info.',
      requirementsBn: 'ব্যাংকের নাম, অ্যাকাউন্ট নম্বর ও শাখার তথ্য দিন (সর্বনিম্ন ৳৫০০)।',
      requirementsEn: 'Bank Name, Account Number & Branch details required (min ৳500).',
      minAmount: 500,
      maxAmount: 250000,
      supportsDeposit: 0,
      supportsWithdrawal: 1,
      enabled: 1,
      sortOrder: 4,
    },
  ];
  for (const pm of defaults) {
    await db.run(
      `INSERT OR IGNORE INTO payment_methods (
        id, code, name, type, account_number, account_name,
        instructions_bn, instructions_en, requirements_bn, requirements_en,
        min_amount, max_amount, supports_deposit, supports_withdrawal, enabled, sort_order, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        pm.id,
        pm.code,
        pm.name,
        pm.type,
        pm.accountNumber,
        pm.accountName,
        pm.instructionsBn,
        pm.instructionsEn,
        pm.requirementsBn,
        pm.requirementsEn,
        pm.minAmount,
        pm.maxAmount,
        pm.supportsDeposit,
        pm.supportsWithdrawal,
        pm.enabled,
        pm.sortOrder,
        now,
      ]
    );
  }
}

async function ensureSchema(db: AppDatabase): Promise<void> {
  if (schemaInitializedFor.has(db)) return;
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.run(stmt);
  }

  // Non-destructive upgrade for existing databases created by 0001/0002 migrations
  const columns = await db.all<{ name: string; notnull: number }>('PRAGMA table_info(users)');
  const colNames = new Set(columns.map((c) => c.name));
  const phoneCol = columns.find((c) => c.name === 'phone_e164');
  if (phoneCol && Number(phoneCol.notnull) === 1) {
    legacyNotNullPhoneDbs.add(db);
  }

  if (!colNames.has('auth_method')) {
    await db.run(`ALTER TABLE users ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'phone'`);
  }
  if (!colNames.has('email_normalized')) {
    await db.run(`ALTER TABLE users ADD COLUMN email_normalized TEXT`);
  }
  if (!colNames.has('admin_notes')) {
    await db.run(`ALTER TABLE users ADD COLUMN admin_notes TEXT NOT NULL DEFAULT ''`);
  }
  if (!colNames.has('last_login_at')) {
    await db.run(`ALTER TABLE users ADD COLUMN last_login_at INTEGER NOT NULL DEFAULT 0`);
  }
  if (!colNames.has('last_login_ip')) {
    await db.run(`ALTER TABLE users ADD COLUMN last_login_ip TEXT NOT NULL DEFAULT ''`);
  }
  await db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized ON users(email_normalized)`);

  // Non-destructive upgrade for analytics_events columns on existing databases
  const analyticsCols = await db.all<{ name: string }>('PRAGMA table_info(analytics_events)');
  const aColNames = new Set(analyticsCols.map((c) => c.name));
  const analyticsAddCols: Array<[string, string]> = [
    ['content_id', `TEXT NOT NULL DEFAULT ''`],
    ['content_type', `TEXT NOT NULL DEFAULT ''`],
    ['content_category', `TEXT NOT NULL DEFAULT ''`],
    ['browser', `TEXT NOT NULL DEFAULT ''`],
    ['os', `TEXT NOT NULL DEFAULT ''`],
    ['country', `TEXT NOT NULL DEFAULT ''`],
    ['metadata_json', `TEXT NOT NULL DEFAULT '{}'`],
  ];
  for (const [colName, colDef] of analyticsAddCols) {
    if (!aColNames.has(colName)) {
      await db.run(`ALTER TABLE analytics_events ADD COLUMN ${colName} ${colDef}`);
    }
  }
  await db.run(
    `CREATE INDEX IF NOT EXISTS idx_analytics_content_time ON analytics_events(content_id, event_type, created_at DESC)`
  );
  await db.run(
    `CREATE INDEX IF NOT EXISTS idx_analytics_session_time ON analytics_events(session_id, created_at DESC)`
  );

  await seedDefaultPaymentMethodsIfEmpty(db);

  schemaInitializedFor.add(db);
}

export async function getAppDatabase(): Promise<AppDatabase> {
  // 1. Cloudflare Workers D1 binding (`env.DB`)
  if (workerRuntimeEnv && isD1Database(workerRuntimeEnv.DB)) {
    if (!cachedD1Instance || cachedD1RawRef !== workerRuntimeEnv.DB) {
      cachedD1RawRef = workerRuntimeEnv.DB;
      cachedD1Instance = wrapD1Database(workerRuntimeEnv.DB);
    }
    await ensureSchema(cachedD1Instance);
    return cachedD1Instance;
  }

  // 2. Local Node.js dev/self-hosted SQLite via built-in node:sqlite
  const nodeDb = await openNodeSqliteDatabase();
  if (nodeDb) {
    await ensureSchema(nodeDb);
    return nodeDb;
  }

  throw new DatabaseNotConfiguredError(
    'Cloudflare D1 database binding "DB" is not configured. Bind a D1 database named "digital-hub-db" to variable "DB" in Cloudflare Workers Settings → Bindings.'
  );
}
