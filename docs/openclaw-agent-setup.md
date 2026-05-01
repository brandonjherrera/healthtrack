# OpenClaw Agent Setup

Use OpenClaw as a HealthTrack API client. All core endpoints are live: meal logging, macro estimation, AI photo scanning, barcode lookup, nutrition queries, recipes, and meal plans.

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
| `get_week_plan` | `GET /meal-plans/week` | Read the 7-day meal plan grid with planned macros vs goals |
| `list_recipes` | `GET /recipes` | Search saved recipes; supports `q`, `tags`, and `goal_match=true` |
| `create_recipe` | `POST /recipes` | Save a recipe with ingredients and computed per-serving macros |
| `log_recipe` | `POST /recipes/:id/log` | Log a cooked recipe as a real meal; include `source: "openclaw"` |
| `plan_meal` | `POST /meal-plans` | Schedule a recipe for a day and meal slot |
| `update_plan_status` | `PUT /meal-plans/:id` | Mark a planned meal as `planned`, `logged`, or `skipped` |
| `search_foods` | `GET /foods?q=term` | Search the personal food library before creating recipe ingredients |

## Agent System Prompt Rules

- You are a nutrition assistant with access to the user's personal HealthTrack API.
- Always call `get_today_nutrition` before answering questions about today's progress, remaining macros, or whether the user is on track.
- When logging a meal from text, call `estimate_meal` first, show the estimated items and macros, ask for confirmation, then call `log_meal`.
- When logging a recipe, confirm the recipe and number of servings before calling `log_recipe`.
- When the user asks what they should eat or what fits their goals, call `get_today_nutrition` and then `list_recipes` with `goal_match=true`.
- Every meal log created by OpenClaw must include `source: "openclaw"`.

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

## Recipe and Meal Plan Workflow

Use recipes for repeatable meals and meal prep. Ingredient macros are stored as recipe totals, and the API returns both total and per-serving macros.

```json
POST /api/v1/recipes
{
  "name": "High Protein Chicken Bowl",
  "servings": 4,
  "source": "openclaw",
  "tags": ["meal-prep", "high-protein"],
  "ingredients": [
    {
      "food_name": "Chicken Breast",
      "quantity": 600,
      "unit": "g",
      "calories": 990,
      "protein_g": 186,
      "carbs_g": 0,
      "fat_g": 21.6
    }
  ]
}
```

Schedule a recipe:

```json
POST /api/v1/meal-plans
{
  "plan_date": "2026-05-04",
  "meal_type": "dinner",
  "recipe_id": "recipe_uuid",
  "servings": 1
}
```

Log a planned recipe. Include `plan_id` when the meal came from the weekly plan so HealthTrack can mark the plan as logged and link it to the created meal. OpenClaw should send `source: "openclaw"`; if omitted, the API records the meal as `manual`.

```json
POST /api/v1/recipes/recipe_uuid/log
{
  "plan_id": "meal_plan_uuid",
  "meal_type": "dinner",
  "logged_at": "2026-05-04T18:30:00-05:00",
  "servings": 1,
  "source": "openclaw"
}
```

Useful reads:

```http
GET /api/v1/meal-plans/week?start_date=2026-05-04
GET /api/v1/recipes?goal_match=true
GET /api/v1/foods?q=chicken
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
