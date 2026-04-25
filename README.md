# HealthTrack API

Personal nutrition tracking API. Agent-first architecture designed for AI health ecosystem integration.

## Quick Start (Mac Mini Setup)

### 1. Install PostgreSQL

```bash
brew install postgresql@16
brew services start postgresql@16
```

### 2. Create the database

```bash
createdb healthtrack
```

### 3. Clone and install

```bash
git clone https://github.com/brandonjherrera/healthtrack.git
cd healthtrack
npm install
```

### 4. Configure environment

```bash
cp .env.example .env
# Edit .env with your database URL and API keys
```

Your `.env` should have at minimum:

```
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://$(whoami)@localhost:5432/healthtrack
```

### 5. Run migrations

```bash
npm run migrate
```

### 6. Generate your API keys

```bash
npm run generate-key -- --label pwa
npm run generate-key -- --label openclaw
```

Save the keys that are printed — they're shown once and never stored in plaintext.

### 7. Start the server

```bash
npm run dev    # development with auto-reload
npm start      # production
```

### 8. Test it

```bash
curl http://localhost:3000/api/v1/health-check

# With auth:
curl -H "Authorization: Bearer htk_your_key_here" \
     http://localhost:3000/api/v1/goals
```

## API Documentation

See `healthtrack_api_spec_v1.md` in the project root for full endpoint documentation, request/response formats, and OpenClaw integration patterns.

## Project Structure

```
healthtrack/
├── src/
│   ├── index.js              # Server entry point
│   ├── config/database.js    # PostgreSQL connection
│   ├── middleware/
│   │   ├── auth.js           # API key authentication
│   │   └── errorHandler.js   # Error handling
│   ├── routes/               # Express route handlers
│   │   ├── meals.js          # Meal CRUD
│   │   ├── nutrition.js      # Daily/weekly/trend summaries
│   │   ├── foods.js          # Food library + barcode lookup
│   │   ├── goals.js          # Nutritional targets
│   │   ├── health.js         # Health metrics (Whoop, etc.)
│   │   ├── user.js           # Profile/preferences
│   │   ├── scan.js           # AI food photo scanning (TODO)
│   │   └── export.js         # Data export (JSON/CSV)
│   ├── services/             # External integrations (TODO)
│   └── utils/
│       ├── validation.js     # Input validation
│       └── formatting.js     # Response formatting
├── migrations/               # SQL migration files
├── scripts/
│   ├── migrate.js            # Migration runner
│   └── generateApiKey.js     # API key generator
└── .env.example              # Environment template
```

## What's Implemented

- Full CRUD for meals and meal items
- Nutrition daily/summary/trends endpoints
- Food library with search and frequent foods
- Barcode lookup endpoint (external API integration TODO)
- Goals with historical tracking
- Health data storage (future Whoop/Apple Health)
- JSON and CSV data export
- API key authentication per-client
- Input validation and error handling

## What's TODO

- AI food photo scanning (`src/routes/scan.js`)
- Barcode external API lookup (`src/services/barcodeLookup.js`)
- USDA + Open Food Facts cross-reference service
- PWA frontend
- OpenClaw nutrition skill
- Offline sync queue (schema supports it via `client_ref`)

## Tech Stack

- **Runtime:** Node.js 20+
- **Framework:** Express
- **Database:** PostgreSQL 16
- **Auth:** bcrypt-hashed API keys
- **Host:** Mac Mini (local, 24/7)
