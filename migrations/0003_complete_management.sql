-- DIGITAL HUB — Additive Management, Payment Methods & D1 Ad Stats Migration
-- Non-destructive: preserves 100% of existing users, wallets, orders, payments, and sessions.

ALTER TABLE users ADD COLUMN admin_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN last_login_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN last_login_ip TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS payment_methods (
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
);

CREATE INDEX IF NOT EXISTS idx_payment_methods_sort ON payment_methods(sort_order ASC, name ASC);

CREATE TABLE IF NOT EXISTS ad_stats (
  ad_id TEXT PRIMARY KEY,
  ad_format TEXT NOT NULL DEFAULT 'direct_link',
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  blocked_clicks INTEGER NOT NULL DEFAULT 0,
  by_placement_json TEXT NOT NULL DEFAULT '{}',
  last_event_at INTEGER NOT NULL DEFAULT 0
);
