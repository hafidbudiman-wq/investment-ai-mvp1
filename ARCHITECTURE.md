# InvestAI MVP 1 Architecture

```text
User Interface (Next.js)
        |
Validation & Ratio Libraries
        |
API / Server Actions (next implementation)
        |
Prisma ORM
        |
PostgreSQL
```

## Canonical data flow

```text
File or manual input
→ raw account labels
→ account mapping
→ extraction review
→ validation checks
→ user verification
→ canonical financial entries
→ ratios and charts
```

## Definition of done for MVP 1

- Add company
- Add or upload financial report
- Review account mapping
- Verify and save values
- Store data in PostgreSQL
- Show historical statements
- Calculate fundamental ratios
- Display data warnings
