-- RoomTint PostgreSQL Schema
-- Run this once: psql -U postgres -d roomtint -f init_db.sql

CREATE DATABASE IF NOT EXISTS roomtint;

\c roomtint;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Saved results (color + intensity metadata only — images stay in localStorage on frontend)
CREATE TABLE IF NOT EXISTS saved_results (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    color_hex   TEXT NOT NULL,
    intensity   INTEGER NOT NULL DEFAULT 40,
    share_id    TEXT UNIQUE DEFAULT substr(md5(random()::text), 1, 8),
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Saved colors palette
CREATE TABLE IF NOT EXISTS saved_colors (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    color_hex   TEXT NOT NULL,
    color_name  TEXT,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Index for share_id lookups
CREATE INDEX IF NOT EXISTS idx_results_share_id ON saved_results(share_id);
CREATE INDEX IF NOT EXISTS idx_results_created ON saved_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_colors_created ON saved_colors(created_at DESC);
