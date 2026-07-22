# Rehearsal harness

Proves the auction holds at 250 concurrent viewers before the live event. Both
scripts drive the **Convex backend over real WebSocket subscriptions** — the same
transport the browser uses — so latencies reflect true fan-out, not HTTP polling.

> Supersedes the older root-level `load-test*.js` (k6/HTTP), which measured query
> re-execution and, by its own note, *overstated* per-viewer cost. Prefer these.

## Prerequisites

1. A **staging** (or production, off-hours) Convex deployment.
2. A **live auction room with a player currently up** (status `live`, a
   `currentPlayerId` set, at least one team with purse headroom). Start one from
   the admin UI, or it will tell you what's missing.
3. Writer auth — pick one:
   - **Preferred (no expiry):** a Convex **deploy key** + an existing admin email.
     Deploy key: Convex dashboard → Settings → Deploy Keys.
   - **Fallback:** a Convex-template Clerk JWT from an admin browser console:
     `await window.Clerk.session.getToken({ template: 'convex' })` (expires ~60s).

## Environment

| var | required | meaning |
|---|---|---|
| `CONVEX_URL` | ✓ | `https://<name>.convex.cloud` (or falls back to `NEXT_PUBLIC_CONVEX_URL`) |
| `ROOM_ID` | ✓ | live auction room id (`npx convex data auctionRooms`) |
| `CONVEX_ADMIN_KEY` + `ADMIN_EMAIL` | ✓* | writer auth via admin impersonation (preferred) |
| `ADMIN_JWT` | ✓* | writer auth via Clerk token (alternative to the above) |
| `NUM_VIEWERS` | | default 250 (load) / 30 (chaos) |
| `INTER_BID_MS` | | pacing between bids, default 200 |
| `LADDERS`, `BIDS_PER_LADDER` | | load-test volume, default 12 × 8 |
| `CHAOS_ADVANCE=1` | | chaos: also finalize+advance players (**DESTRUCTIVE**) |

\* provide either the admin-key pair **or** `ADMIN_JWT`.

## Run

```bash
# Load test — bid write → viewer update latency at 250 clients
CONVEX_URL=https://<staging>.convex.cloud \
ROOM_ID=<room id> \
CONVEX_ADMIN_KEY=<deploy key> ADMIN_EMAIL=<admin email> \
node harness/viewer-load.mjs

# Chaos test — convergence + no duplicate bids under kill/restore + dup bids
CONVEX_URL=... ROOM_ID=... CONVEX_ADMIN_KEY=... ADMIN_EMAIL=... \
NUM_VIEWERS=30 node harness/chaos.mjs
```

## Acceptance targets (from the brief)

| metric | target | which script |
|---|---|---|
| bid write → update, p95, 250 clients | < 500 ms | `viewer-load.mjs` |
| bid write → update, p99 | < 1200 ms | `viewer-load.mjs` |
| client divergence after chaos | 0 | `chaos.mjs` |
| duplicate bid acceptance | 0 | `chaos.mjs` |

## Notes & caveats

- **One process, one clock.** All viewers run in a single Node process, so
  latency samples have no cross-machine clock skew.
- **"Update" ≈ render.** We measure when a viewer's subscription callback fires
  (the network + Convex fan-out). Browser paint adds a few ms on top.
- **Coalescing.** Convex may collapse rapid updates and deliver only the latest,
  so some intermediate bid amounts won't be sampled by every viewer — the samples
  that *are* recorded are still valid end-to-end measurements. Keep `INTER_BID_MS`
  ≥ ~150 for good coverage.
- **Per-IP WebSocket limits.** 250 sockets from one machine may hit a provider
  per-IP cap; the load script reports how many viewers connected. If short,
  run from a couple of machines and sum, or ask Convex about limits.
- **Quota cost.** These runs consume Convex function calls against the target
  deployment. Relevant to AUDIT **P0-2** — run once, read the dashboard usage.
- **Chaos is stateful.** Without `CHAOS_ADVANCE` it only bids + restarts (leaves
  the player up). With it, players are consumed — run against a throwaway
  tournament and `restartAuction` afterward.
```
