# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Next.js application implementing 3 different data integration algorithms to merge election CSV data from Hyogo Prefecture's 13th and 23rd proportional representation elections. Each pattern demonstrates a different SQL-inspired approach (ETL, UNION, multi-stage JOIN) with detailed performance benchmarking.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 7, Supabase (PostgreSQL), Shift_JIS CSV processing

## Development Commands

```bash
# Start development server
npm run dev

# Prisma commands (run after schema changes)
npx prisma generate            # Regenerate Prisma Client (required after schema.prisma edits)
npx prisma migrate dev         # Create and apply migration
npx prisma studio              # Open database GUI (localhost:5555)
npx prisma db push            # Push schema changes without migration (development only)

# Build and production
npm run build
npm start

# Linting
npm run lint
```

### VSCode Tasks (Windows-optimized)

Access via `Ctrl+Shift+P` → `Tasks: Run Task`:

- **Full Restart: Kill + Clean + Generate + Start** - Use this when Prisma schema changes or cache issues occur
- **Quick Restart: Kill + Start** - Fast restart without cache clearing
- **Prisma Studio** - Launch database GUI

**Note:** These tasks handle Windows-specific cleanup (`taskkill`, `rd /S /Q`) automatically.

## Environment Setup

Create `.env` in project root (gitignored):

```env
DATABASE_URL="postgresql://postgres.qietjyododaswutgdpou:KUSeijiDB2025@aws-1-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres.qietjyododaswutgdpou:KUSeijiDB2025@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"
```

- `DATABASE_URL` - Use for normal connections (pgbouncer, connection pooling)
- `DIRECT_URL` - Use for migrations only (direct connection)

## Architecture

### Dual Implementation Pattern

Each of the 3 data integration patterns has **two implementations**:

1. **In-memory version** (`pattern{1,2,3}.ts`) - Pure TypeScript, no database operations
2. **Database-first version** (`pattern{1,2,3}-db.ts`) - Full 7-step pipeline with Prisma

**7-Step Database Pipeline:**
1. CSV Load → 2. DB Write (Raw) → 3. DB Read (Raw) → 4. Compute → 5. DB Write (Result) → 6. DB Read (Result) → 7. CSV Output

Each step is individually timed by `DetailedTimer` and stored in `MergeRun` model.

### Directory Structure

```text
lib/
  csv/loader.ts              - Shift_JIS → UTF-8 conversion, dynamic party column extraction
  transform/
    common.ts                - Shared utilities (turnout/relative calculations, JOIN logic)
    pattern1.ts / pattern1-db.ts    - ETL: process elections separately, JOIN at end
    pattern2.ts / pattern2-db.ts    - UNION: merge first, process once, pivot
    pattern3.ts / pattern3-db.ts    - Multi-stage JOIN: intermediate views (T_Base, T_Party)
  output/writer.ts           - CSV writer (handles Vercel read-only filesystem)
  metrics/
    runner.ts                - Legacy performance measurement
    detailedTracker.ts       - 7-step timing tracker for database-first patterns
  prisma.ts                  - Prisma singleton with custom output path
app/
  api/run/{1,2,3}/route.ts   - API endpoints for executing patterns (DB-first versions)
  api/explain/[pattern]/route.ts - Returns SQL explanation for each pattern
  api/history/route.ts       - Returns MergeRun execution history
  api/timings/route.ts       - Returns latest timing comparison across patterns
  page.tsx                   - Main UI with execution buttons and timing displays
components/
  PatternButton.tsx          - Execution button with loading state
  TimingSummary.tsx          - Visual timing breakdown component
  HelpDialog.tsx             - Pattern explanation modal
prisma/
  schema.prisma              - Models: Municipality, RawElectionData, ElectionResult, MergeRun
data/csv/                    - Input CSV files (Shift_JIS encoded, gitignored)
output/                      - Generated output files (gitignored)
```

### Data Flow

**Database-First Pattern (used by API endpoints):**

```
CSV Files (Shift_JIS)
  ↓ [1. CSV Load]
In-Memory Objects
  ↓ [2. DB Write Raw]
RawElectionData (Prisma)
  ↓ [3. DB Read Raw]
In-Memory for Compute
  ↓ [4. Compute] - turnout, relativeShare calculations
Computed Results
  ↓ [5. DB Write Result]
ElectionResult (Prisma)
  ↓ [6. DB Read Result]
Final Output Data
  ↓ [7. CSV Write]
output/pattern{1,2,3}_result.csv + MergeRun record
```

### The 3 Integration Patterns (SQL Concepts)

**Pattern 1 - ETL/Separation Model:**
```sql
-- Process each election independently
T_13 = SELECT jisCode, turnout, party_votes... FROM election_13 GROUP BY jisCode;
T_23 = SELECT jisCode, turnout, party_votes... FROM election_23 GROUP BY jisCode;
-- JOIN at the end
SELECT * FROM T_13 JOIN T_23 ON T_13.jisCode = T_23.jisCode;
```
- **Pros:** High maintainability, parallelizable, loosely coupled
- **Cons:** Some code duplication for each election

**Pattern 2 - UNION/Batch Model:**
```sql
-- Merge first with election flag
T_Union = SELECT *, '13' as election FROM data_13 UNION ALL SELECT *, '23' as election FROM data_23;
-- Process once, then pivot
SELECT jisCode, turnout_13, turnout_23, party1_13, party1_23, ... FROM T_Union PIVOT ...;
```
- **Pros:** Minimal code, single processing logic
- **Cons:** Large intermediate tables, higher memory usage

**Pattern 3 - Multi-stage JOIN Model:**
```sql
-- Create intermediate views (per election)
T_Base_13 = SELECT DISTINCT jisCode, electorate, ballots, turnout FROM data_13;
T_Party_13 = SELECT jisCode, party, relativeShare FROM data_13 PIVOT ...;
-- JOIN within election
T_13 = SELECT * FROM T_Base_13 JOIN T_Party_13 ON jisCode;
-- Repeat for 23, then final JOIN
SELECT * FROM T_13 JOIN T_23 ON jisCode;
```
- **Pros:** Highly verifiable, step-by-step validation
- **Cons:** More complex, multiple JOIN operations

**All 3 patterns produce identical output** - only the algorithm differs.

## Data Handling

### CSV Encoding
- Input files are **Shift_JIS (CP932)** encoded
- `iconv-lite` converts to UTF-8 before parsing
- Handle BOM and empty lines gracefully

### Dynamic Party Column Extraction
- Political party columns are **NOT hardcoded**
- `loadElectionCsv` extracts all columns after fixed metadata columns
- Party names (自民, 立民, 公明, 共産, 維新, etc.) are dynamically discovered
- This allows the code to work with different election datasets without modification

### Calculations
```typescript
turnout = ballots / electorate            // 投票率
relativeShare = partyVotes / validVotes   // 相対得票率 (政党ごと)
```

**Edge cases:**
- Empty/null values → 0
- Division by zero → 0 (with console warning)
- Decimal precision: 4 decimal places

### Output Format
Final CSV columns:
```
pref_code, pref_name, jis_code, city_name,
turnout_13, turnout_23,
{party1}_13, {party1}_23, {party2}_13, {party2}_23, ...
```

## Database Models (Prisma)

**Custom Output Path:** Prisma Client is generated to `generated/prisma` (not default `node_modules/.prisma`).

**Models:**
- **Municipality** - JIS codes and municipal metadata
- **RawElectionData** - Raw CSV rows (municipality × election × party)
- **ElectionResult** - Computed results (municipality × election × party with calculations)
- **MergeRun** - Execution logs with 7-step timing breakdown (csvLoadMs, dbWriteRawMs, etc.)

**Relationships:**
```
Municipality (1) → (N) RawElectionData
Municipality (1) → (N) ElectionResult
```

## Troubleshooting

### "Cannot read properties of undefined (reading 'deleteMany')" Error

**Cause:** Prisma Client cache is stale (common after `schema.prisma` changes).

**Solution:**
1. Use VSCode task: `Full Restart: Kill + Clean + Generate + Start`
2. Or manually:
   ```bash
   taskkill /F /IM node.exe
   rd /S /Q .next
   rd /S /Q node_modules\.prisma
   rd /S /Q generated\prisma
   npx prisma generate
   npm run dev
   ```

### Port Already in Use

Next.js auto-increments to next available port (3001, 3002, etc.). Check terminal output for actual URL.

## Important Notes

- **Never commit `.env`** - Contains Supabase credentials
- **Output files** go to `output/` directory (gitignored)
- **Vercel deployment:** Cannot write to filesystem in production - API routes return CSV as Buffer for download
- **Pattern verification:** Use Prisma Studio to inspect `MergeRun` records and compare timing breakdowns
- See [README.md](README.md) for Japanese documentation on pattern design philosophy
- See [DESIGN.md](DESIGN.md) for architectural rationale and pattern comparisons
- See [IMPLEMENTATION.md](IMPLEMENTATION.md) for detailed implementation steps
