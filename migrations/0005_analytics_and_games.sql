-- DIGITAL HUB BD - Real-Time Visitor Analytics, Content Stats & Games Store Migration
-- Non-destructive migration: preserves all existing tables, users, balances, orders, packages, and settings.

ALTER TABLE analytics_events ADD COLUMN content_id TEXT NOT NULL DEFAULT '';
ALTER TABLE analytics_events ADD COLUMN content_type TEXT NOT NULL DEFAULT '';
ALTER TABLE analytics_events ADD COLUMN content_category TEXT NOT NULL DEFAULT '';
ALTER TABLE analytics_events ADD COLUMN browser TEXT NOT NULL DEFAULT '';
ALTER TABLE analytics_events ADD COLUMN os TEXT NOT NULL DEFAULT '';
ALTER TABLE analytics_events ADD COLUMN country TEXT NOT NULL DEFAULT '';
ALTER TABLE analytics_events ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_analytics_content_time ON analytics_events(content_id, event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_session_time ON analytics_events(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS visitor_sessions (
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
);

CREATE INDEX IF NOT EXISTS idx_visitor_sessions_last_seen ON visitor_sessions(last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_visitor ON visitor_sessions(visitor_id, last_seen_at DESC);
