-- ============================================================================
-- HealthTrack — Initial Database Schema
-- Migration: 001_initial_schema.sql
-- Created: 2026-04-25
-- Database: PostgreSQL 16+
-- 
-- Design principles:
--   - Agent-first: OpenClaw and future AI agents are first-class consumers
--   - Multi-source ready: schema supports Whoop, Apple Health, manual entry
--   - Single-user now, multi-user ready (user_id on all tables)
--   - Offline-sync friendly (logged_at vs created_at distinction)
--   - Food library builds over time from confirmed AI scans
-- ============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- USERS
-- Single user (Alidas) for now. Multi-user schema from day one.
-- ============================================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(255) UNIQUE NOT NULL,
    name            VARCHAR(100) NOT NULL,
    timezone        VARCHAR(50) NOT NULL DEFAULT 'America/Chicago',
    
    -- Flexible preferences blob for UI settings, units, notification prefs, etc.
    -- Example: {"units": "imperial", "dark_mode": true, "notifications": {"morning": true, "evening": true}}
    preferences     JSONB NOT NULL DEFAULT '{}',

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- API KEYS
-- Each client (PWA, OpenClaw, cron agents) gets its own key.
-- Keys are hashed; raw key is shown once at creation and never stored.
-- ============================================================================
CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key_hash        VARCHAR(128) NOT NULL,
    label           VARCHAR(100) NOT NULL,  -- e.g. 'pwa', 'openclaw', 'morning_agent'
    
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_used_at    TIMESTAMPTZ,
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash) WHERE is_active = TRUE;

-- ============================================================================
-- DAILY GOALS
-- Goals change over time. Each row has an effective_date so historical 
-- progress is measured against the goals that were active at that time.
-- ============================================================================
CREATE TABLE daily_goals (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    effective_date      DATE NOT NULL,          -- goal applies from this date forward
    
    calories_target     INTEGER NOT NULL,       -- kcal
    protein_g_target    NUMERIC(6,1) NOT NULL,
    carbs_g_target      NUMERIC(6,1) NOT NULL,
    fat_g_target        NUMERIC(6,1) NOT NULL,
    
    -- Optional micro targets (nullable — only tracked if user sets them)
    fiber_g_target      NUMERIC(6,1),
    sodium_mg_target    NUMERIC(7,1),
    sugar_g_target      NUMERIC(6,1),
    
    notes               TEXT,                   -- e.g. "cutting phase", "maintenance"
    
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Only one active goal per user per effective_date
    UNIQUE(user_id, effective_date)
);

-- ============================================================================
-- FOOD LIBRARY
-- Personal database of confirmed foods. Grows as user verifies AI scans.
-- Also supports manually added custom foods.
-- ============================================================================
CREATE TABLE food_library (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    food_name           VARCHAR(255) NOT NULL,
    brand               VARCHAR(255),           -- nullable, for packaged foods
    
    -- Default serving (what gets pre-filled when selecting this food)
    default_quantity    NUMERIC(8,2) NOT NULL,
    default_unit        VARCHAR(20) NOT NULL,    -- 'g', 'oz', 'cup', 'each', 'ml', etc.
    
    -- Nutrition per default serving
    calories            NUMERIC(7,1) NOT NULL,
    protein_g           NUMERIC(6,1) NOT NULL,
    carbs_g             NUMERIC(6,1) NOT NULL,
    fat_g               NUMERIC(6,1) NOT NULL,
    fiber_g             NUMERIC(6,1),
    sodium_mg           NUMERIC(7,1),
    sugar_g             NUMERIC(6,1),
    
    -- Barcode (UPC/EAN) for packaged food scanning
    barcode             VARCHAR(20),            -- UPC-A (12 digits), EAN-13, or EAN-8
    
    -- External database references for cross-referencing
    usda_fdc_id         VARCHAR(20),            -- USDA FoodData Central ID
    openfoodfacts_id    VARCHAR(50),            -- Open Food Facts barcode/ID
    
    -- Usage tracking for "frequent foods" feature
    use_count           INTEGER NOT NULL DEFAULT 0,
    last_used_at        TIMESTAMPTZ,
    
    -- Metadata
    is_custom           BOOLEAN NOT NULL DEFAULT FALSE,  -- user-created vs. verified scan
    tags                TEXT[],                           -- e.g. {'high-protein', 'post-workout', 'meal-prep'}
    
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_food_library_user ON food_library(user_id);
CREATE INDEX idx_food_library_name ON food_library(user_id, food_name);
CREATE INDEX idx_food_library_frequent ON food_library(user_id, use_count DESC);
CREATE INDEX idx_food_library_barcode ON food_library(barcode) WHERE barcode IS NOT NULL;

-- ============================================================================
-- MEALS
-- One row per meal event. A meal contains one or more meal_items.
-- logged_at = when the user ate. created_at = when the record was saved.
-- This distinction supports offline logging (log now, sync later).
-- ============================================================================
CREATE TABLE meals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    meal_type       VARCHAR(20) NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
    logged_at       TIMESTAMPTZ NOT NULL,       -- when the meal was actually eaten
    
    notes           TEXT,                       -- optional context, e.g. "post-workout meal"
    photo_url       TEXT,                       -- path/URL to meal photo if scanned
    
    -- How was this meal logged?
    source          VARCHAR(30) NOT NULL DEFAULT 'app' 
                    CHECK (source IN ('app', 'openclaw', 'agent', 'import')),
    
    -- For offline sync: client generates a UUID before syncing
    -- If the same client_ref is submitted twice, we upsert instead of duplicating
    client_ref      UUID UNIQUE,
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meals_user_date ON meals(user_id, logged_at);
CREATE INDEX idx_meals_user_type ON meals(user_id, meal_type);

-- ============================================================================
-- MEAL ITEMS
-- Individual food entries within a meal.
-- Links to food_library when the item came from a known food.
-- ============================================================================
CREATE TABLE meal_items (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    meal_id             UUID NOT NULL REFERENCES meals(id) ON DELETE CASCADE,
    food_library_id     UUID REFERENCES food_library(id) ON DELETE SET NULL,  -- nullable, links to known food
    
    food_name           VARCHAR(255) NOT NULL,   -- denormalized for display even if library entry is deleted
    quantity            NUMERIC(8,2) NOT NULL,
    unit                VARCHAR(20) NOT NULL,
    
    -- Nutrition for this specific serving
    calories            NUMERIC(7,1) NOT NULL,
    protein_g           NUMERIC(6,1) NOT NULL,
    carbs_g             NUMERIC(6,1) NOT NULL,
    fat_g               NUMERIC(6,1) NOT NULL,
    fiber_g             NUMERIC(6,1),
    sodium_mg           NUMERIC(7,1),
    sugar_g             NUMERIC(6,1),
    
    -- AI scan metadata
    confidence_score    NUMERIC(3,2),           -- 0.00 to 1.00, null if manual entry
    data_source         VARCHAR(30) NOT NULL DEFAULT 'manual'
                        CHECK (data_source IN ('manual', 'ai_estimate', 'usda', 'openfoodfacts', 'library', 'barcode_scan')),
    verified            BOOLEAN NOT NULL DEFAULT FALSE,  -- user confirmed AI estimate
    
    sort_order          INTEGER NOT NULL DEFAULT 0,      -- display order within meal
    
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meal_items_meal ON meal_items(meal_id);

-- ============================================================================
-- HEALTH DATA
-- Extensible table for future integrations (Whoop, Apple Health, manual).
-- Stores any timestamped health metric as a key-value with typed metadata.
-- Empty in MVP but ready for Phase 2+.
-- ============================================================================
CREATE TABLE health_data (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    source          VARCHAR(30) NOT NULL 
                    CHECK (source IN ('whoop', 'apple_health', 'manual', 'garmin', 'oura', 'custom')),
    data_type       VARCHAR(50) NOT NULL,       -- 'sleep', 'recovery', 'strain', 'steps', 'weight', 'body_fat', 'resting_hr', etc.
    
    value           NUMERIC(10,3) NOT NULL,
    unit            VARCHAR(20) NOT NULL,        -- 'hours', 'score', 'steps', 'kg', 'lbs', '%', 'bpm', etc.
    
    recorded_at     TIMESTAMPTZ NOT NULL,        -- when the measurement occurred
    
    -- Source-specific metadata that doesn't fit the flat schema
    -- e.g. Whoop: {"recovery_score": 85, "hrv": 45, "rhr": 52}
    metadata        JSONB NOT NULL DEFAULT '{}',
    
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_health_data_user_type ON health_data(user_id, data_type, recorded_at);
CREATE INDEX idx_health_data_user_date ON health_data(user_id, recorded_at);

-- ============================================================================
-- SCAN HISTORY
-- Audit log of AI food scans. Useful for debugging AI accuracy over time,
-- and for the coaching agent to understand scan patterns.
-- ============================================================================
CREATE TABLE scan_history (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meal_id             UUID REFERENCES meals(id) ON DELETE SET NULL,  -- linked after user confirms
    
    photo_url           TEXT NOT NULL,
    context_text        TEXT,                   -- user-provided context ("chicken and rice")
    
    -- Raw AI response stored for analysis/debugging
    ai_model            VARCHAR(50) NOT NULL,   -- 'claude-sonnet-4.6', 'gpt-4o', etc.
    ai_response         JSONB NOT NULL,         -- full structured response from vision model
    
    -- Cross-reference results
    usda_matches        JSONB,                  -- matches found in USDA
    openfoodfacts_matches JSONB,                -- matches found in Open Food Facts
    
    -- Outcome
    was_confirmed       BOOLEAN NOT NULL DEFAULT FALSE,
    user_adjustments    JSONB,                  -- what the user changed from AI estimate
    
    processing_time_ms  INTEGER,                -- how long the scan took
    
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scan_history_user ON scan_history(user_id, created_at);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- Auto-update the updated_at column on any row modification.
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_food_library_updated_at
    BEFORE UPDATE ON food_library
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_meals_updated_at
    BEFORE UPDATE ON meals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
