# CLAUDE.md

Bid11Pro (repo: cricket-auction-interface) is a live cricket player-auction app.

Stack: Next.js 16 App Router (all pages are client components), React 19, Tailwind 4, Convex 1.31 backend
(`convex/*.ts`), Clerk auth, Cloudinary images, Vitest + convex-test.

## Commands

```bash
npm install          # install dependencies
npx convex dev       # run/push Convex functions to the dev deployment (keep running)
npm run dev          # Next.js dev server
npm test             # vitest run (unit + convex-test)
npm run lint         # eslint
npx tsc --noEmit     # typecheck
```

## Architecture rules

- **The server enforces every rule.** Business rules live in `convex/*.ts`. UI checks are a convenience
  only; never rely on them.
- **Hot/cold split on the auction page.**
  - `auctions:getLiveAuction` is the hot query. It re-runs on every bid and must stay small.
  - `auctions:getAuctionRoster` is the cold query. It re-runs once per player.
  - Never make the hot query read the `players`/`teams` tables broadly. Never make the cold query read the
    `auctionRooms` document.
- **Shared viewer queries stay identity-free.** Do not read `ctx.auth` in a query every viewer shares
  unless it is necessary. Reading identity per viewer stops Convex from sharing one cached result across
  all viewers. Put private data in separate admin-only queries instead.
- **Status changes resync counts.** Any mutation that changes a player's `auctionStatus` must call
  `syncTournamentAuctionCounts` (`convex/auctionCounts.ts`).
- **Money invariants.** Any mutation that moves money must keep, for every team:
  - `purseRemaining + purseSpent == basePurse`
  - `purseSpent == sum(soldPrice of the team's players)`

  It must also call `logAdminAction` (`convex/auth.ts`).
- **Error shape.** In auction mutations, expected rule failures return `{ success: false, reason }`. Only
  not-found cases throw.

## Testing rules

- Every change to `convex/` needs a convex-test case in `convex/*.test.ts`. Follow the fixtures in
  `convex/auctions.test.ts` (the `setup()` seeder, `ADMIN_IDENTITY`, and the `import.meta.glob` modules
  pattern).
- Write the failing test first, run it red, then implement.

## Do not touch (unless the task says so)

- `convex/_generated/`
- `harness/`
- The animation timings in `app/auction/[roomId]/page.tsx`

## Definition of done

- `npm test`, `npm run lint` and `npx tsc --noEmit` are all green.
- No unrelated files changed.
- The PR description includes a short summary of behaviour changes.

## Baseline (2026-10-26)

Branch `chore/claude-setup`, taken from `develop` at `81b4b2d`.

```
npm test
 ✓ lib/groupDraw.test.ts (22 tests)
 ✓ convex/teams.test.ts (5 tests)
 ✓ convex/groupDraws.test.ts (6 tests)
 ✓ convex/auctions.test.ts (13 tests)
 Test Files  4 passed (4)
      Tests  46 passed (46)

npm run lint      -> exit 0, no warnings or errors
npx tsc --noEmit  -> exit 0, no errors
```

Nothing failed.
