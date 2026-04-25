# HealthTrack API Specification v1

> **Last Updated:** 2026-04-25  
> **Status:** Approved architecture — pre-implementation  
> **Stack:** Node.js (Express or Fastify) + PostgreSQL  
> **Host:** Mac Mini (local, 24/7) — accessible on LAN, tunnelable via Cloudflare/ngrok for remote  
> **Auth:** API key (Bearer token), single-user with multi-user schema  
> **Base URL:** `http://localhost:3000/api/v1` (local dev)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                   │
│                                                                  │
│   ┌─────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐  │
│   │   PWA   │    │ OpenClaw  │    │  Cron    │    │  Future  │  │
│   │  (Web)  │    │  Agents   │    │  Jobs    │    │  Agents  │  │
│   └────┬────┘    └─────┬─────┘    └────┬─────┘    └────┬─────┘  │
│        │               │               │               │         │
│        └───────────────┼───────────────┼───────────────┘         │
│                        │               │                         │
│                   ┌────▼───────────────▼────┐                    │
│                   │    HealthTrack API        │                    │
│                   │    (Express/Fastify)     │                    │
│                   │    Port 3000            │                    │
│                   └────┬──────┬──────┬─────┘                    │
│                        │      │      │                           │
│              ┌─────────┘      │      └─────────┐                │
│              │                │                │                 │
│         ┌────▼────┐    ┌─────▼──────┐   ┌─────▼──────┐         │
│         │PostgreSQL│    │ AI Vision  │   │ Food DBs   │         │
│         │  (local) │    │ (Claude/   │   │ (USDA +    │         │
│         │         │    │  GPT-4o)   │   │  OpenFood) │         │
│         └─────────┘    └────────────┘   └────────────┘         │
│                                                                  │
│                     Mac Mini (24/7)                               │
└──────────────────────────────────────────────────────────────────┘
```

---

## Authentication

All requests require a Bearer token in the `Authorization` header:

```
Authorization: Bearer htk_abc123...
```

Keys are generated per-client (PWA gets one, OpenClaw gets one, each agent gets one). Keys are hashed in the database — the raw key is shown once at creation and never stored in plaintext.

**Endpoints that don't require auth:** None. Every endpoint is authenticated.

**Rate limiting:** Not enforced in MVP (single user), but the middleware hook is there for future use.

---

## Endpoints

### Meals

#### `POST /api/v1/meals`
Log a new meal with one or more food items.

**Request body:**
```json
{
    "meal_type": "lunch",
    "logged_at": "2026-06-15T12:30:00-05:00",
    "notes": "Post-workout meal",
    "source": "app",
    "client_ref": "optional-uuid-for-offline-sync",
    "items": [
        {
            "food_name": "Grilled Chicken Breast",
            "quantity": 8,
            "unit": "oz",
            "calories": 370,
            "protein_g": 70,
            "carbs_g": 0,
            "fat_g": 8,
            "data_source": "library",
            "food_library_id": "uuid-if-from-library",
            "verified": true
        },
        {
            "food_name": "Brown Rice",
            "quantity": 1.5,
            "unit": "cup",
            "calories": 340,
            "protein_g": 7,
            "carbs_g": 72,
            "fat_g": 3,
            "data_source": "usda",
            "verified": true
        }
    ]
}
```

**Response:** `201 Created`
```json
{
    "id": "meal-uuid",
    "meal_type": "lunch",
    "logged_at": "2026-06-15T12:30:00-05:00",
    "totals": {
        "calories": 710,
        "protein_g": 77,
        "carbs_g": 72,
        "fat_g": 11
    },
    "items": [ ... ],
    "created_at": "2026-06-15T12:35:00-05:00"
}
```

**OpenClaw usage example:**
```
User: "I just had 2 eggs and toast"
Agent: POST /api/v1/meals with meal_type="breakfast", source="openclaw"
       Items auto-populated from food_library or AI estimation
```

#### `GET /api/v1/meals`
List meals with optional filters.

**Query parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `date` | `YYYY-MM-DD` | Filter by date (uses user's timezone) |
| `start_date` | `YYYY-MM-DD` | Range start |
| `end_date` | `YYYY-MM-DD` | Range end |
| `meal_type` | string | Filter by type |
| `source` | string | Filter by logging source |
| `limit` | integer | Pagination (default 50) |
| `offset` | integer | Pagination offset |

**Response:** `200 OK`
```json
{
    "meals": [ ... ],
    "count": 4,
    "daily_totals": {
        "calories": 2150,
        "protein_g": 185,
        "carbs_g": 220,
        "fat_g": 65
    }
}
```

#### `GET /api/v1/meals/:id`
Single meal with all items.

#### `PUT /api/v1/meals/:id`
Update meal metadata or items. Supports partial updates.

#### `DELETE /api/v1/meals/:id`
Delete a meal and its items.

---

### Meal Scanning (AI Food Recognition)

#### `POST /api/v1/meals/scan`
Submit a photo for AI nutritional analysis. Does NOT auto-log — returns analysis for user confirmation.

**Request body:**
```json
{
    "photo": "base64-encoded-image-data",
    "photo_format": "jpeg",
    "context": "grilled chicken breast, about 8oz, with a cup of rice",
    "meal_type": "lunch"
}
```

**Response:** `200 OK`
```json
{
    "scan_id": "scan-uuid",
    "ai_model": "claude-sonnet-4.6",
    "items": [
        {
            "food_name": "Grilled Chicken Breast",
            "quantity": 8,
            "unit": "oz",
            "calories": 370,
            "protein_g": 70,
            "carbs_g": 0,
            "fat_g": 8,
            "confidence_score": 0.92,
            "cross_reference": {
                "usda": {
                    "match": "Chicken, broilers or fryers, breast, meat only, cooked, grilled",
                    "fdc_id": "171477",
                    "calories_per_serving": 365,
                    "discrepancy": "minimal"
                },
                "openfoodfacts": {
                    "match": "Grilled chicken breast",
                    "calories_per_serving": 372,
                    "discrepancy": "minimal"
                }
            }
        },
        {
            "food_name": "White Rice, cooked",
            "quantity": 1,
            "unit": "cup",
            "calories": 206,
            "protein_g": 4.3,
            "carbs_g": 44.5,
            "fat_g": 0.4,
            "confidence_score": 0.78,
            "cross_reference": { ... },
            "notes": "AI detected rice but couldn't confirm brown vs white — user context didn't specify"
        }
    ],
    "total_estimate": {
        "calories": 576,
        "protein_g": 74.3,
        "carbs_g": 44.5,
        "fat_g": 8.4
    },
    "processing_time_ms": 2340
}
```

**Confirmation flow:**
After user reviews and adjusts, the client sends `POST /api/v1/meals` with the confirmed data and includes `scan_id` to link the meal to the scan history.

---

### Barcode Scanning

#### `GET /api/v1/foods/barcode/:code`
Look up a food product by UPC/EAN barcode. Checks local food library first, then queries Open Food Facts and USDA FoodData Central.

**URL parameter:** `code` — UPC-A (12 digits), EAN-13 (13 digits), or EAN-8 (8 digits)

**Response:** `200 OK`
```json
{
    "barcode": "041196910759",
    "found_in": "openfoodfacts",
    "in_library": false,
    "product": {
        "food_name": "Kirkland Signature Organic Peanut Butter",
        "brand": "Kirkland Signature",
        "serving_size": 32,
        "serving_unit": "g",
        "servings_per_container": 28,
        "calories": 190,
        "protein_g": 7,
        "carbs_g": 7,
        "fat_g": 16,
        "fiber_g": 2,
        "sodium_mg": 0,
        "sugar_g": 1,
        "usda_fdc_id": null,
        "openfoodfacts_id": "041196910759",
        "image_url": "https://images.openfoodfacts.org/..."
    }
}
```

**Response when not found:** `404 Not Found`
```json
{
    "barcode": "000000000000",
    "found_in": null,
    "suggestion": "Product not found in any database. You can add it manually."
}
```

**PWA barcode scanning flow:**
1. User taps "Scan Barcode" button in the PWA
2. Camera opens using `html5-qrcode` or `quagga2` (JS barcode reading library, works in PWA — no native app needed)
3. Library reads the UPC/EAN number from the camera feed
4. PWA calls `GET /api/v1/foods/barcode/{code}`
5. If found: product info pre-fills the meal item form, user adjusts quantity and confirms
6. If the product exists in the user's food library (`in_library: true`), it uses the user's saved version (which may have custom adjustments)
7. On confirmation, product is saved to `food_library` with the barcode for instant lookup next time

**Data sources (lookup order):**
1. Local `food_library` (barcode column) — instant, user's confirmed data
2. Open Food Facts API (`https://world.openfoodfacts.org/api/v2/product/{barcode}`) — free, no API key needed, millions of products
3. USDA FoodData Central (`https://api.nal.usda.gov/fdc/v1/foods/search?query={barcode}`) — free with API key, strong US coverage

**Supported barcode formats:**
- UPC-A (12 digits) — standard US product barcodes
- EAN-13 (13 digits) — international standard
- EAN-8 (8 digits) — smaller packages

---

### Nutrition Summaries

#### `GET /api/v1/nutrition/daily`
Macro and calorie totals for a specific date.

**Query parameters:**
| Param | Type | Default |
|-------|------|---------|
| `date` | `YYYY-MM-DD` | today |

**Response:** `200 OK`
```json
{
    "date": "2026-06-15",
    "totals": {
        "calories": 2150,
        "protein_g": 185,
        "carbs_g": 220,
        "fat_g": 65,
        "fiber_g": 28,
        "sodium_mg": 1800,
        "sugar_g": 45
    },
    "goals": {
        "calories_target": 2500,
        "protein_g_target": 200,
        "carbs_g_target": 250,
        "fat_g_target": 80
    },
    "progress": {
        "calories_pct": 86,
        "protein_pct": 92.5,
        "carbs_pct": 88,
        "fat_pct": 81.25
    },
    "meals_logged": 3,
    "remaining": {
        "calories": 350,
        "protein_g": 15,
        "carbs_g": 30,
        "fat_g": 15
    }
}
```

**This is the primary endpoint for OpenClaw's "how am I doing today" queries.** The `remaining` field directly supports coaching prompts like "you need 15g more protein — a protein shake would cover that."

#### `GET /api/v1/nutrition/summary`
Aggregated stats over a date range.

**Query parameters:**
| Param | Type | Default |
|-------|------|---------|
| `range` | `week`, `month`, `custom` | `week` |
| `start_date` | `YYYY-MM-DD` | auto |
| `end_date` | `YYYY-MM-DD` | auto |

**Response:** `200 OK`
```json
{
    "range": "week",
    "start_date": "2026-06-09",
    "end_date": "2026-06-15",
    "averages": {
        "calories": 2300,
        "protein_g": 190,
        "carbs_g": 235,
        "fat_g": 72
    },
    "goal_adherence": {
        "days_on_target": 5,
        "days_over": 1,
        "days_under": 1,
        "protein_consistency_pct": 88
    },
    "daily_breakdown": [
        { "date": "2026-06-09", "calories": 2400, "protein_g": 195, ... },
        ...
    ]
}
```

#### `GET /api/v1/nutrition/trends`
Trend data formatted for charting.

**Query parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `metric` | string | `calories`, `protein`, `carbs`, `fat`, `weight` |
| `range` | string | `week`, `month`, `3month`, `6month`, `year` |
| `granularity` | string | `daily`, `weekly` (auto-selected based on range) |

**Response:** `200 OK`
```json
{
    "metric": "protein",
    "unit": "g",
    "range": "month",
    "data_points": [
        { "date": "2026-06-01", "value": 180, "target": 200 },
        { "date": "2026-06-02", "value": 205, "target": 200 },
        ...
    ],
    "trend": "improving",
    "average": 192
}
```

---

### Food Library

#### `GET /api/v1/foods`
Search the personal food library.

**Query parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Search term |
| `tags` | string | Comma-separated tags |
| `limit` | integer | Default 20 |

#### `POST /api/v1/foods`
Add a custom food to the library.

#### `GET /api/v1/foods/frequent`
Returns most-used foods, sorted by `use_count`. Powers the "quick add" feature in the PWA.

**Query parameters:**
| Param | Type | Default |
|-------|------|---------|
| `limit` | integer | 10 |
| `meal_type` | string | optional — filter by meal context |

#### `GET /api/v1/foods/barcode/:code`
Look up a food product by UPC/EAN barcode. See **Barcode Scanning** section above for full details.

---

### Goals

#### `GET /api/v1/goals`
Returns the currently active goal (latest `effective_date` that's <= today).

#### `PUT /api/v1/goals`
Create a new goal entry with a new `effective_date`. Does not overwrite history.

```json
{
    "effective_date": "2026-07-01",
    "calories_target": 2800,
    "protein_g_target": 220,
    "carbs_g_target": 280,
    "fat_g_target": 85,
    "notes": "Increasing for heavier training volume"
}
```

#### `GET /api/v1/goals/history`
Returns all goal changes over time. Useful for the coaching agent to understand progression.

---

### Health Data (Future-Ready)

#### `POST /api/v1/health`
Log a health metric from any source.

```json
{
    "source": "manual",
    "data_type": "weight",
    "value": 185.5,
    "unit": "lbs",
    "recorded_at": "2026-06-15T07:00:00-05:00",
    "metadata": {}
}
```

#### `GET /api/v1/health`
Query health data.

**Query parameters:**
| Param | Type | Description |
|-------|------|-------------|
| `data_type` | string | Filter by metric type |
| `source` | string | Filter by source |
| `start_date` | `YYYY-MM-DD` | Range start |
| `end_date` | `YYYY-MM-DD` | Range end |

---

### User Profile

#### `GET /api/v1/user/profile`
Returns user info and preferences.

#### `PUT /api/v1/user/profile`
Update preferences (units, notification settings, macro colors, etc.).

---

### Data Export

#### `GET /api/v1/export`
Export all nutrition data.

**Query parameters:**
| Param | Type | Options |
|-------|------|---------|
| `format` | string | `json`, `csv` |
| `start_date` | `YYYY-MM-DD` | optional |
| `end_date` | `YYYY-MM-DD` | optional |
| `include` | string | Comma-separated: `meals`, `foods`, `goals`, `health`, `scans` |

---

## OpenClaw Integration Patterns

### Natural Language → API Translation

The OpenClaw nutrition skill translates conversational input to API calls:

| User says | API call | Notes |
|-----------|----------|-------|
| "I just had 2 eggs and toast" | `POST /meals` | Agent estimates macros from food library or AI |
| "How much protein today?" | `GET /nutrition/daily` | Return `totals.protein_g` and `remaining.protein_g` |
| "Log a protein shake" | `POST /meals` + food library lookup | Match against frequent foods first |
| "I scanned this barcode: 041196910759" | `GET /foods/barcode/041196910759` → `POST /meals` | Barcode lookup, then log with confirmed data |
| "Show me this week's stats" | `GET /nutrition/summary?range=week` | Format for chat response |
| "Am I on track today?" | `GET /nutrition/daily` | Compare progress percentages to thresholds |
| "I'm changing my goal to 2800 cal" | `PUT /goals` | New effective_date = today |
| [sends photo] | `POST /meals/scan` → confirm → `POST /meals` | Two-step: scan then confirm |

### Cron Agent Queries

| Schedule | Endpoint | Agent behavior |
|----------|----------|---------------|
| 7:00 AM | `GET /nutrition/daily?date=yesterday` | Morning briefing: "Yesterday you hit X% protein..." |
| 7:00 PM | `GET /nutrition/daily` | Evening nudge: "You've logged X calories, need Y more protein" |
| Monday 8:00 AM | `GET /nutrition/summary?range=week` | Weekly report with trends |

### Coaching Agent (Phase 4) Data Access

The coaching agent will query multiple endpoints per interaction:
1. `GET /nutrition/daily` — today's intake
2. `GET /nutrition/trends?metric=protein&range=week` — recent patterns  
3. `GET /health?data_type=recovery&source=whoop` — recovery context (Phase 2+)
4. `GET /goals` — current targets
5. Synthesize all data into personalized recommendation

---

## Error Responses

All errors follow this format:
```json
{
    "error": {
        "code": "VALIDATION_ERROR",
        "message": "meal_type must be one of: breakfast, lunch, dinner, snack",
        "details": { ... }
    }
}
```

**Standard codes:**
| HTTP Status | Code | When |
|-------------|------|------|
| 400 | `VALIDATION_ERROR` | Bad request body / params |
| 401 | `UNAUTHORIZED` | Missing or invalid API key |
| 404 | `NOT_FOUND` | Resource doesn't exist |
| 409 | `CONFLICT` | Duplicate `client_ref` (offline sync collision) |
| 500 | `INTERNAL_ERROR` | Server error |

---

## File Structure (Planned)

```
healthtrack/
├── package.json
├── .env                     # DB connection, API keys, AI model config
├── src/
│   ├── index.js             # Server entry point
│   ├── config/
│   │   └── database.js      # PostgreSQL connection pool
│   ├── middleware/
│   │   ├── auth.js           # API key validation
│   │   └── errorHandler.js   # Global error handling
│   ├── routes/
│   │   ├── meals.js
│   │   ├── nutrition.js
│   │   ├── foods.js
│   │   ├── goals.js
│   │   ├── health.js
│   │   ├── user.js
│   │   ├── scan.js
│   │   ├── barcode.js        # Barcode lookup endpoint
│   │   └── export.js
│   ├── services/
│   │   ├── aiVision.js       # Claude/GPT-4o food scanning
│   │   ├── foodLookup.js     # USDA + OpenFoodFacts cross-reference
│   │   ├── barcodeLookup.js  # UPC/EAN barcode → product info (OpenFoodFacts + USDA)
│   │   └── nutritionCalc.js  # Summary/trend calculations
│   ├── models/               # Database query functions (no ORM, raw SQL or Knex)
│   │   ├── meals.js
│   │   ├── mealItems.js
│   │   ├── foodLibrary.js
│   │   ├── goals.js
│   │   ├── healthData.js
│   │   └── scanHistory.js
│   └── utils/
│       ├── validation.js     # Input validation helpers
│       └── formatting.js     # Response formatting
├── migrations/
│   └── 001_initial_schema.sql
├── seeds/
│   └── default_user.sql
└── tests/
    └── ...
```

---

## Model Recommendations by Task

Use this when deciding which AI model to use for each build phase:

| Task | Model | Why |
|------|-------|-----|
| Schema & API architecture (this session) | Claude Opus 4.6 | Complex design reasoning |
| API implementation (Express routes, DB queries) | Claude Sonnet 4.6 or GPT 5.5 | Straightforward code generation |
| PWA frontend build | Claude Sonnet 4.6 or GPT 5.5 | Component-level work |
| AI scan service (vision integration) | Claude Opus 4.6 | Tricky multi-model orchestration |
| Styling & CSS | Claude Sonnet 4.6 or GPT 5.5 | Your CSS is strong, just need generation speed |
| OpenClaw skill development | Claude Opus 4.6 | Agent design requires deeper reasoning |
| Deployment & DevOps (Mac Mini setup) | Claude Sonnet 4.6 or GPT 5.5 | Standard setup tasks |
| Testing & debugging | Either Sonnet or GPT 5.5 | Routine code work |
| Coaching agent logic (Phase 4) | Claude Opus 4.6 | Complex behavioral design |
