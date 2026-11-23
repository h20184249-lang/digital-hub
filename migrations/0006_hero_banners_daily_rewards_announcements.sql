-- DIGITAL HUB BD - Hero Banners, Daily Login Rewards & Announcement Enhancements Migration
-- Non-destructive migration: preserves all existing tables, users, balances, orders, packages, and settings.

CREATE TABLE IF NOT EXISTS daily_login_claims (
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
);

CREATE INDEX IF NOT EXISTS idx_daily_claims_date ON daily_login_claims(claim_date, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_claims_user ON daily_login_claims(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS daily_login_streaks (
  user_id TEXT PRIMARY KEY,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_streak INTEGER NOT NULL DEFAULT 0,
  last_claim_date TEXT NOT NULL DEFAULT '',
  total_claims INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
