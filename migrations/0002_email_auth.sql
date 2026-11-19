-- DIGITAL HUB — Additive Email & Password Authentication Migration
-- Non-destructive migration: preserves 100% of existing phone-number accounts,
-- wallets, orders, payments, referrals, sessions, and notifications.
-- Existing phone accounts automatically receive auth_method = 'phone' and email_normalized = NULL.

ALTER TABLE users ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'phone';
ALTER TABLE users ADD COLUMN email_normalized TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_normalized ON users(email_normalized);
