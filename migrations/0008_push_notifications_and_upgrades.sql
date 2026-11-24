-- 0008_push_notifications_and_upgrades.sql
-- Adds real Web Push / FCM device subscriptions, 6-category notification preferences,
-- push dispatch deduplication log, and verified user badge column.

ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  is_admin_device INTEGER NOT NULL DEFAULT 0,
  device_label TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT 'web',
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL DEFAULT '',
  auth TEXT NOT NULL DEFAULT '',
  fcm_token TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  last_success_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id, active);
CREATE INDEX IF NOT EXISTS idx_push_subs_admin ON push_subscriptions(is_admin_device, active);

CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id TEXT PRIMARY KEY,
  new_offers INTEGER NOT NULL DEFAULT 1,
  important_announcements INTEGER NOT NULL DEFAULT 1,
  service_updates INTEGER NOT NULL DEFAULT 1,
  order_notifications INTEGER NOT NULL DEFAULT 1,
  payment_notifications INTEGER NOT NULL DEFAULT 1,
  account_notifications INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS push_dispatch_log (
  dedupe_key TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
