# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Next.js application for processing and merging election CSV data from Hyogo Prefecture's 13th and 23rd proportional representation elections. The app implements 3 different data integration algorithms with performance benchmarking capabilities.

**Key Goals:**

- Merge two election CSV files using JIS municipal codes as the key
- Implement 3 distinct data integration patterns (ETL, UNION, multi-stage JOIN)
- Measure and compare execution times for each pattern
- Store results in Supabase PostgreSQL via Prisma

**Tech Stack:** Next.js App Router, TypeScript, Prisma, Supabase (PostgreSQL), CSV processing

## Project Setup

### First-Time Initialization

```bash
# Initialize Next.js (if not already done)
npx create-next-app@latest . --typescript --tailwind --app --no-src-dir

# Install dependencies
npm install @prisma/client prisma csv-parse papaparse iconv-lite
npm install -D @types/node

# Initialize Prisma
npx prisma init

# Configure .env with Supabase credentials (see below)

# Run database migrations
npx prisma migrate dev

# Generate Prisma Client
npx prisma generate
```

### Environment Variables

Create `.env` in project root (never commit this file):

```env
DATABASE_URL="postgresql://postgres.qietjyododaswutgdpou:KUSeijiDB2025@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.qietjyododaswutgdpou:KUSeijiDB2025@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"
```

## Development Commands

```bash
# Start development server
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Run tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- lib/csv/loader.test.ts

# Prisma commands
npx prisma studio              # Open database GUI
npx prisma migrate dev         # Create and apply migration
npx prisma migrate reset       # Reset database (WARNING: deletes all data)
npx prisma generate            # Regenerate Prisma Client after schema changes
npx prisma db push            # Push schema changes without creating migration
```

## Architecture

### Directory Structure

```text
lib/
  csv/loader.ts           - CSV file loading, CP932→UTF8 conversion, header extraction
  transform/
    common.ts             - Shared utilities (turnout/relative vote calculations)
    pattern1.ts           - ETL pattern: process each election separately, then JOIN
    pattern2.ts           - UNION pattern: merge first, process once, then pivot
    pattern3.ts           - Multi-stage JOIN: create intermediate views, then combine
  output/writer.ts        - CSV file writer (handles local fs and Vercel limitations)
  metrics/runner.ts       - Performance measurement and Prisma logging
app/
  page.tsx                - Main UI with 3 pattern execution buttons
  api/run/[pattern]/route.ts - API endpoints for executing patterns
prisma/
  schema.prisma           - Database models (Municipality, ElectionResult, MergeRun)
data/csv/                 - Input CSV files (Shift_JIS encoded)
output/                   - Generated output files (gitignored)
```

### Data Flow

1. **Load** CSV files (13th & 23rd elections) with `lib/csv/loader.ts`
2. **Transform** using one of 3 patterns in `lib/transform/pattern{1,2,3}.ts`
3. **Calculate** turnout rates and relative vote shares
4. **Merge** election data by JIS code
5. **Output** to CSV and save metadata to database
6. **Display** execution time and results on UI

### The 3 Integration Patterns

**Pattern 1 - ETL/Separation Model:**

- Process each election independently through full pipeline
- JOIN results at the end by JIS code
- Pros: High maintainability, parallelizable
- Cons: Some code duplication

**Pattern 2 - UNION/Batch Model:**

- Merge all source data first (UNION ALL with election flag)
- Process once, then pivot by election × party
- Pros: Minimal code, single processing logic
- Cons: Large intermediate tables, higher memory usage

**Pattern 3 - Multi-stage JOIN Model:**

- Create intermediate views (T_Base: metadata, T_Party: party votes)
- JOIN within each election, then JOIN across elections
- Pros: Highly verifiable, step-by-step validation
- Cons: More complex, multiple JOIN operations

## Data Handling

### CSV Encoding

- Input files are **Shift_JIS (CP932)** encoded
- Must use `iconv-lite` to convert to UTF-8
- Handle BOM and empty lines gracefully

### Party Columns

- Political party columns are **dynamically extracted** from headers
- Not hardcoded - extract all non-metadata columns
- Examples: 自民, 立民, 公明, 共産, 維新, etc.

### Calculations

```typescript
turnout = ballots / electorate
relativeShare = partyVotes / validVotes
```

### Validation

- Empty values → 0
- Division by zero → 0 (log warning)
- Decimal precision: 4 decimal places
- Verify row counts match expected output

## Database Models (Prisma)

- **Municipality** - Stores JIS codes and municipal metadata
- **ElectionResult** - One row per municipality × election × party
- **MergeRun** - Execution logs with pattern, duration, row count

## Testing Guidelines

- CSV loader: test header extraction, encoding, numeric conversion
- Common transforms: test turnout/relative calculations with edge cases
- Pattern transforms: verify output column count, no duplicate keys
- E2E: call API endpoint, verify output file created

## Deployment Considerations

**Vercel Limitations:**

- Cannot write to `output/` directory in production
- Solution: Return CSV as Buffer in API response for download
- Use `NODE_ENV === 'production'` to detect environment

**Database:**

- Use `DATABASE_URL` (pgbouncer) for normal connections
- Use `DIRECT_URL` for migrations only

## Important Notes

- Never commit `.env` file or credentials
- All output files go to `output/` directory (gitignored)
- All 3 patterns must produce **identical output** (different algorithms, same result)
- See `IMPLEMENTATION.md` for detailed implementation steps
- See `DESIGN.md` for architectural rationale and pattern comparisons
