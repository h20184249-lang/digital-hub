-- DIGITAL HUB BD - Persistent Media Assets for Package Logos & Artwork
-- Non-destructive migration: preserves all existing tables, users, balances, orders, packages, and settings.

CREATE TABLE IF NOT EXISTS media_assets (
  id TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  data_base64 TEXT NOT NULL,
  uploaded_by TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_assets_created ON media_assets(created_at DESC);
