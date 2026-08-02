# Investment AI – Stock Analysis Platform

**App name:** InvestAI  
**Tagline:** From Financial Statements to Investment Decisions

MVP 1 establishes the financial data foundation: company master data, financial reports, canonical accounts, account mapping, verification, ratios, and data-quality warnings.

## Features included

- Responsive dashboard and navigation
- Company master page
- Financial statement upload/review UI foundation
- Manual financial input foundation
- Fundamental ratio calculation library
- Financial data validation library
- PostgreSQL database design with Prisma
- Canonical account mapping
- Data warning and review status models
- Seed data for ICBP, BTPS, SMRA, MEDC, and POWR
- Health-check API at `/api/health`
- Railway-ready environment configuration

## Technology

- Next.js 15
- React 19
- TypeScript
- PostgreSQL
- Prisma ORM
- Recharts-ready dependency

## Run locally

1. Install Node.js 20 or newer and PostgreSQL.
2. Copy `.env.example` to `.env`.
3. Update `DATABASE_URL`.
4. Run controlled migrations and seed master data:

```bash
npm ci
npm run db:generate
npm run db:deploy
npm run db:seed
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Railway

1. Connect this GitHub repository to Railway.

Run two Railway services from the same commit. The web service uses `railway.json`; the independent PDF worker uses `railway.worker.json` (or the `npm run start:worker` start command). Both services must share `DATABASE_URL` and `OPENAI_API_KEY`. HTTP requests only persist uploads; submission and polling continue in the worker even after the browser or web instance stops.
2. Add a PostgreSQL service.
3. Ensure `DATABASE_URL` is available to the application service.
4. Build command: `npm run build`.
5. Start command: `npm run start` (runs `prisma migrate deploy` before Next.js).
6. Health check: `/api/health`; it returns ready only after a real PostgreSQL query succeeds.

Never use `prisma db push` in production. Migration files are the reproducible schema source of truth.

## MVP roadmap

- MVP 1: Financial Database
- MVP 2: Fundamental Analysis and scoring
- MVP 3: Valuation engine
- MVP 4: AI Investment Analyst with RAG
- MVP 5: Portfolio intelligence and alerts

## Important control principle

AI-extracted financial values must be previewed, mapped, and verified before they enter the canonical database.
