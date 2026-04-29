# OpenClaw Agent Setup

Use OpenClaw as a HealthTrack API client. All core endpoints are live: meal logging, macro estimation, AI photo scanning, barcode lookup, and nutrition queries.

## Local Setup

1. Confirm `.env` has `DATABASE_URL`, `ANTHROPIC_API_KEY`, and the `SEED_*` values filled in.
2. Run the schema migration:

```bash
npm run migrate
```

3. Seed the local user and starter goals:

```bash
npm run seed
```

4. Generate a dedicated OpenClaw API key:

```bash
npm run generate-key -- --label openclaw
```

5. Start the API:

```bash
npm run dev
```

## Agent Environment

Configure the Claw agent with:

```bash
HEALTHTRACK_BASE_URL=http://localhost:3000/api/v1
HEALTHTRACK_API_KEY=htk_generated_openclaw_key
```

Every authenticated request must include:

```http
Authorization: Bearer htk_generated_openclaw_key
Content-Type: application/json
```

## Core Agent Actions

| Action | Endpoint | Purpose |
| --- | --- | --- |
| `get_today_nutrition` | `GET /nutrition/daily` | Today's totals, goals, progress %, and remaining macros |
| `get_goals` | `GET /goals` | Read current calorie and macro targets |
| `list_recent_meals` | `GET /meals?limit=10` | Inspect recent meals before correcting or summarizing |
| `estimate_meal` | `POST /meals/estimate` | Convert plain-text food description → structured items with macros |
| `log_meal` | `POST /meals` | Log a meal with items; always include `source: "openclaw"` |

## Recommended Meal Logging Workflow

1. User describes food in plain text → send to `POST /meals/estimate`
2. Review the returned `items` array (check `confidence_score` and `assumptions`)
3. Pass items directly into `POST /meals` with `source: "openclaw"`

```json
// Step 1 — Estimate
POST /api/v1/meals/estimate
{
  "description": "2 scrambled eggs, wheat toast with butter, black coffee"
}

// Step 2 — Log (using items from estimate response)
POST /api/v1/meals
{
  "meal_type": "breakfast",
  "logged_at": "2026-04-28T08:30:00-05:00",
  "source": "openclaw",
  "items": [
    {
      "food_name": "Scrambled Eggs",
      "quantity": 2,
      "unit": "each",
      "calories": 182,
      "protein_g": 12,
      "carbs_g": 2,
      "fat_g": 14,
      "confidence_score": 0.95,
      "data_source": "ai_estimate",
      "verified": false
    }
  ]
}
```

## Photo Scanning (Optional)

Send a base64-encoded photo to get estimated food items:

```json
POST /api/v1/meals/scan
{
  "image": "<base64_string>",
  "mime_type": "image/jpeg"
}
```

Returns the same item structure as `/meals/estimate`. Log the result with `source: "scan"`.

## Barcode Lookup (Optional)

```http
GET /api/v1/foods/barcode/012345678901
```

Checks local food library first, then Open Food Facts, then USDA FoodData Central (requires `USDA_API_KEY` in `.env`). Returns a `product` object ready to use as a meal item.

## Nutrition Summary

```http
GET /api/v1/nutrition/daily          # today
GET /api/v1/nutrition/daily?date=2026-04-27   # specific date
GET /api/v1/nutrition/summary?range=week      # week/month averages + goal adherence
```
