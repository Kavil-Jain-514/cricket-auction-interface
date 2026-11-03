# Load and chaos test

`run.mjs` reproduces auction day against a real Convex deployment, over the same
WebSocket transport the browser uses:

- `NUM_VIEWERS` viewers with the viewer page's subscriptions (hot `getLiveAuction`,
  slim `getAuctionRoster`, `getLatestSaleEvent`), connected 100 every 200 ms
- 1 overlay client (hot query, full roster, sale event)
- 20 bidders racing on the same price every round. Every bid carries the expected
  player and price, so stale bids are refused and counted, not applied:
  - with `OWNER_EMAILS`: real owner paddles (`raiseBid`; set the room to **open** bidding)
  - otherwise: bids for 20 teams sent through **2 auctioneer consoles**
- `CHAOS=1`: halfway through, every viewer disconnects and reconnects at the same moment

It uses the helpers in `harness/lib.mjs` (auth, percentiles) and needs the same
environment (`harness/README.md`).

## Run (staging or a rehearsal room only: it places real bids)

```bash
# 500 viewers, with the all-clients reconnect storm, bids cleared at the end
CONVEX_URL=https://<staging>.convex.cloud ROOM_ID=<live room with a player up> \
CONVEX_ADMIN_KEY=<deploy key> ADMIN_EMAIL=<admin email> \
NUM_VIEWERS=500 CHAOS=1 RESET=1 node scripts/loadtest/run.mjs

# 2,500 viewers (run from a machine with a good uplink; ~2,500 sockets)
NUM_VIEWERS=2500 CHAOS=1 RESET=1 node scripts/loadtest/run.mjs

# Real owner paddles instead of console bids (owners linked to teams, room in "open" mode)
OWNER_EMAILS=o1@x.com,...,o20@x.com NUM_VIEWERS=500 node scripts/loadtest/run.mjs
```

| Env | Default | Meaning |
|---|---|---|
| `NUM_VIEWERS` | 500 | viewer clients |
| `NUM_BIDDERS` | 20 | teams bidding each round (console mode) |
| `ROUNDS` | 40 | bidding rounds; every bidder tries once per round |
| `ROUND_GAP_MS` | 400 | pause between rounds |
| `CHAOS` | off | `1` = all viewers drop and reconnect at once, mid-run |
| `RESET` | off | `1` = clear the current player's bids at the end |
| `OUT` | `scripts/loadtest/report-<time>.json` | JSON report (gitignored) |

## What it reports

| Metric | Target |
|---|---|
| bid → viewer delivery p95 | **< 1,000 ms** |
| bid → viewer delivery p99 | reported |
| errors (exceptions from any bid) | 0 |
| refused as stale | expected under contention: proof the guard works |
| divergence after settle | 0 clients |
| chaos: reconnect → first fresh payload p95 | reported |
| JSON delivered per accepted bid (all clients) | reported: the bandwidth estimate |

The exit code is 0 only if p95 < 1 s, there are no errors and nothing diverged.
For billed function calls and bandwidth, compare the Convex dashboard's **Usage**
page over the window the script prints at the end.

## Results

Not run yet. Record each run here: date, deployment, viewers, p50/p95/p99, errors,
chaos reconnect p95, divergence, KB per bid, dashboard function calls and bandwidth.

| Date | Deployment | Viewers | p50 | p95 | p99 | Errors | Chaos p95 | Diverged | KB/bid |
|---|---|---|---|---|---|---|---|---|---|
