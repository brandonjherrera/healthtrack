-- ============================================================================
-- HealthTrack — Expand Meal Sources
-- Migration: 003_expand_meal_sources.sql
-- Created: 2026-05-01
-- ============================================================================

-- Keep the database constraint aligned with application validation.
ALTER TABLE meals DROP CONSTRAINT IF EXISTS meals_source_check;
ALTER TABLE meals ADD CONSTRAINT meals_source_check
    CHECK (source IN ('app', 'openclaw', 'scan', 'manual', 'agent', 'import', 'recipe'));
