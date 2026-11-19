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
    phone_e164 TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
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
];

async function ensureSchema(db: AppDatabase): Promise<void> {
  if (schemaInitializedFor.has(db)) return;
  for (const stmt of SCHEMA_STATEMENTS) {
    await db.run(stmt);
  }
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
