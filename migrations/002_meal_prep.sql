-- ============================================================================
-- HealthTrack — Meal Prep
-- Migration: 002_meal_prep.sql
-- Created: 2026-04-29
-- ============================================================================

-- Extend meals.source to allow 'recipe' (logged from a recipe)
ALTER TABLE meals DROP CONSTRAINT IF EXISTS meals_source_check;
ALTER TABLE meals ADD CONSTRAINT meals_source_check
    CHECK (source IN ('app', 'openclaw', 'agent', 'import', 'recipe'));

-- ============================================================================
-- RECIPES
-- A recipe has a name, makes N servings, and is built from ingredients.
-- Per-serving macros are computed at query time from recipe_ingredients.
-- ============================================================================
CREATE TABLE recipes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    name            VARCHAR(255) NOT NULL,
    description     TEXT,

    servings        NUMERIC(4,1) NOT NULL DEFAULT 1,
    prep_time_min   INTEGER,
    cook_time_min   INTEGER,

    tags            TEXT[],
    notes           TEXT,

    source          VARCHAR(20) NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual', 'openclaw', 'import')),

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recipes_user      ON recipes(user_id);
CREATE INDEX idx_recipes_user_name ON recipes(user_id, name);

-- ============================================================================
-- RECIPE INGREDIENTS
-- Mirrors meal_items structure. Macros are totals for the listed quantity
-- (not per-serving). Divide by recipes.servings to get per-serving values.
-- ============================================================================
CREATE TABLE recipe_ingredients (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipe_id           UUID NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
    food_library_id     UUID REFERENCES food_library(id) ON DELETE SET NULL,

    food_name           VARCHAR(255) NOT NULL,
    quantity            NUMERIC(8,2) NOT NULL,
    unit                VARCHAR(20) NOT NULL,

    calories            NUMERIC(7,1) NOT NULL,
    protein_g           NUMERIC(6,1) NOT NULL,
    carbs_g             NUMERIC(6,1) NOT NULL,
    fat_g               NUMERIC(6,1) NOT NULL,
    fiber_g             NUMERIC(6,1),
    sodium_mg           NUMERIC(7,1),
    sugar_g             NUMERIC(6,1),

    sort_order          INTEGER NOT NULL DEFAULT 0,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_recipe_ingredients_recipe ON recipe_ingredients(recipe_id);

-- ============================================================================
-- MEAL PLANS
-- Schedule a recipe to a day/slot. meal_id is populated after logging.
-- ============================================================================
CREATE TABLE meal_plans (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    plan_date   DATE NOT NULL,
    meal_type   VARCHAR(20) NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),

    recipe_id   UUID REFERENCES recipes(id) ON DELETE SET NULL,
    servings    NUMERIC(4,1) NOT NULL DEFAULT 1,

    notes       TEXT,

    status      VARCHAR(20) NOT NULL DEFAULT 'planned'
                CHECK (status IN ('planned', 'logged', 'skipped')),

    meal_id     UUID REFERENCES meals(id) ON DELETE SET NULL,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_meal_plans_user_date ON meal_plans(user_id, plan_date);

CREATE TRIGGER update_recipes_updated_at
    BEFORE UPDATE ON recipes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_meal_plans_updated_at
    BEFORE UPDATE ON meal_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
