# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # start with hot-reload (node --watch)
npm start            # production start
npm run migrate      # run schema migration against DATABASE_URL
npm run seed         # seed local user + starter goals (uses SEED_* env vars)
npm run generate-key -- --label <label>   # create a new API key (DB must be running + seeded)
npm test             # node --test tests/**/*.test.js
```

## Architecture

Single-user personal nutrition API designed to be called by AI agents (primarily OpenClaw) and a future PWA. Runs locally on a Mac Mini.

**Request flow:** client → Bearer auth middleware → route handler → PostgreSQL

All routes live under `/api/v1/*` and require a Bearer API key except `GET /api/v1/health-check`. Keys are bcrypt-hashed in the `api_keys` table; auth validates by comparing against all active keys and caches hits for 5 minutes in a process-local Map to avoid bcrypt cost on every request.

**Route registration order in `src/index.js` matters.** Specific subroutes (`/meals/scan`, `/meals/estimate`) must be registered before the parent (`/meals`) or Express swallows them.

**Services layer** (`src/services/`) handles external calls:
- `aiVision.js` — base64 photo → structured food items (Claude vision)
- `macroEstimator.js` — plain-text description → structured food items (Claude text)
- `barcodeLookup.js` — barcode → Open Food Facts (no key) with USDA FoodData Central fallback (requires `USDA_API_KEY`)

Both AI services use `AI_VISION_MODEL` from env (default `claude-sonnet-4-6`). If `ANTHROPIC_API_KEY` is missing they return a 503, not a 500.

**Database patterns:** `src/config/database.js` exports `query()` for single statements and `getClient()` for transactions (BEGIN/COMMIT/ROLLBACK). Meals are inserted transactionally: meal row first, then meal_items, then food_library use_count increments.

**Key data model decisions:**
- `meals.source` tracks the originating client (`openclaw`, `app`, `scan`, `manual`)
- `meal_items.data_source` tracks data provenance (`manual`, `ai_estimate`, `barcode_scan`)
- `meal_items.client_ref` UUID supports offline sync / idempotency
- `daily_goals` uses `effective_date` — new goals are inserted, not overwritten, preserving history
- Nutrition queries in `nutrition.js` are timezone-aware using `users.timezone` from the DB

**OpenClaw integration points:**
- `POST /meals/estimate` — send a plain-text food description, get back macro-estimated items ready to pass into `POST /meals`
- `POST /meals/scan` — send a base64 photo, get back the same structure
- `GET /nutrition/daily` — today's totals, goals, progress %, and remaining macros
- All meal logs from OpenClaw should include `source: "openclaw"`
