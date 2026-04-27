# OpenClaw Agent Setup

Use OpenClaw as a HealthTrack API client first. The API already supports authenticated meal logging and nutrition queries, so the first agent version should be small and reliable before adding photo scanning or food database lookup.

## Local Setup

1. Confirm `.env` has `DATABASE_URL` and the `SEED_*` values filled in.
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

Every authenticated request should include:

```http
Authorization: Bearer htk_generated_openclaw_key
Content-Type: application/json
```

## First Agent Actions

Start with these four actions:

| Action | Endpoint | Purpose |
| --- | --- | --- |
| `get_today_nutrition` | `GET /nutrition/daily` | Answer progress questions like "how am I doing today?" |
| `get_goals` | `GET /goals` | Read current calorie and macro targets. |
| `list_recent_meals` | `GET /meals?limit=10` | Inspect recent logged meals before correcting or summarizing. |
| `log_meal` | `POST /meals` | Log user-described food with `source: "openclaw"`. |

## Meal Logging Contract

OpenClaw should send full item nutrition values for now. The API does not yet estimate macros from plain text by itself.

```json
{
  "meal_type": "breakfast",
  "logged_at": "2026-04-26T08:30:00-05:00",
  "source": "openclaw",
  "items": [
    {
      "food_name": "Eggs",
      "quantity": 2,
      "unit": "each",
      "calories": 140,
      "protein_g": 12,
      "carbs_g": 1,
      "fat_g": 10,
      "data_source": "ai_estimate",
      "verified": false
    }
  ]
}
```

## Not First

Hold these until the basic loop is working:

- Photo scanning: `POST /meals/scan` currently returns `501 NOT_IMPLEMENTED`.
- External barcode lookup: local-library barcode lookup exists, but Open Food Facts and USDA service calls are still TODO.
- Autonomous coaching: start with read/log actions, then add coaching prompts after the data path is stable.
