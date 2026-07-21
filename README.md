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
4. Run:

```bash
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Railway

1. Connect this GitHub repository to Railway.
2. Add a PostgreSQL service.
3. Ensure `DATABASE_URL` is available to the application service.
4. Build command: `npm run build`.
5. Start command: `npm run start`.
6. Before first use, run `npm run db:push && npm run db:seed` in Railway shell.

## MVP roadmap

- MVP 1: Financial Database
- MVP 2: Fundamental Analysis and scoring
- MVP 3: Valuation engine
- MVP 4: AI Investment Analyst with RAG
- MVP 5: Portfolio intelligence and alerts

## Important control principle

AI-extracted financial values must be previewed, mapped, and verified before they enter the canonical database.
