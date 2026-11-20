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

## Registration rush (registrations.mjs)

N people submit the public registration form at once, each on their own
WebSocket. Dev deployment only by default: it creates a throwaway tournament
(registration open, no fee), submits, verifies the stored rows (count, no
duplicate phones) and deletes the tournament. `PHOTOS=1` also fetches an upload
signature per registrant and submits a photo URL built from it (nothing is sent
to Cloudinary). WhatsApp consent is off, so nothing is queued.

```bash
node scripts/loadtest/registrations.mjs                       # 200 at once
RAMP_MS=60000 node scripts/loadtest/registrations.mjs         # 200 over a minute
PHOTOS=1 node scripts/loadtest/registrations.mjs              # with photo grants
TOURNAMENT_ID=<id> node scripts/loadtest/registrations.mjs    # existing tournament, kept
```

| Env | Default | Meaning |
|---|---|---|
| `N` | 200 | registrants |
| `RAMP_MS` | 0 | spread the submits evenly over this window |
| `PHOTOS` | off | `1` = each registrant gets an upload signature first |
| `KEEP` | off | `1` = keep the test tournament |
| `TOURNAMENT_ID` | | use this tournament (registration open, fee 0); not deleted |

Exit code 0 only if every submit succeeded and the stored rows match.

| Date | Deployment | N | Shape | p50 | p95 | p99 | OK | Failed | OCC reconnects |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-20 | dev | 200 | all at once | 3.7 s | 8.1 s | 10.0 s | 200 | 0 | yes |
| 2026-11-20 | dev | 200 | all at once | 3.5 s | 8.8 s | 14.7 s | 200 | 0 | 398 |
| 2026-11-20 | dev | 200 | over 60 s | 313 ms | 419 ms | 551 ms | 200 | 0 | 0 |
| 2026-11-20 | dev | 200 | at once + photos | 628 ms | 3.9 s | 8.0 s | 128 | 72 | 70 |
| 2026-11-20 | dev | 200 | at once + photos | 594 ms | 4.1 s | 4.7 s | 119 | 81 | |
| 2026-11-20 | dev | 300 | all at once | 1.1 s | 6.5 s | 7.0 s | 200 | 100 (rate limit) | 456 |
| 2026-11-20 | dev | 300 | over 120 s | 267 ms | 355 ms | 445 ms | 300 | 0 | 0 |

Rows above are **before** sharding. Failures and slow submits were write
conflicts on the one `rateLimits` row per tournament (`register:<id>`,
`upload:<id>`) that every submit and every upload signature read and patched,
plus the 200-a-minute submit cap.

### After: sharded limits (branch `reg-load-sharded-limits`)

The per-tournament limits are now spread over 64 rows each
(`convex/shardedRateLimit.ts`): keys `register:<id>:<0-63>`,
`upload:<id>:<0-63>`, `upload-day:<id>:<0-63>`. (16 rows still left ~30
writers per row at N=500, and a few photo signatures failed after running out
of OCC retries.) A request starts on a
server-random shard (submit) or the shard of its random upload `public_id`
(signatures), and moves to the next shard only when that one is full, so
simultaneous requests mostly touch different rows and nobody is refused until
every shard is full. `getUploadSignature` also tries `issueUploadGrant` up to
three times when it fails without a `ConvexError` (a write conflict that never
committed), because the client never resends an action.

| Limit | Before | After (effective cap) |
|---|---|---|
| Submits per tournament per minute | 200 | 600 (640) |
| Upload signatures per tournament per minute | 300 | 900 (960) |
| Upload signatures per tournament per day | 2000 | 2000 (2048) |
| Registrations per phone per tournament per day | 3 | 3 (unchanged, not sharded) |

The form also retries a "Too many … right now" refusal with backoff
(`lib/retryWhenBusy.ts`), so a registrant who does hit a cap waits and gets in.
This script calls the server directly and does **not** retry, so it measures
the server alone.

Pass criteria, for N=300 and N=500 at once, with and without `PHOTOS=1`:

- every submit (and signature) succeeds: exit code 0
- submit p95 under about 2 s
- near-zero `OptimisticConcurrencyControlFailure` reconnects in the output

```bash
N=300 node scripts/loadtest/registrations.mjs 2>&1 | tee /tmp/r300.txt; grep -c OptimisticConcurrency /tmp/r300.txt
N=500 node scripts/loadtest/registrations.mjs 2>&1 | tee /tmp/r500.txt; grep -c OptimisticConcurrency /tmp/r500.txt
N=300 PHOTOS=1 node scripts/loadtest/registrations.mjs 2>&1 | tee /tmp/r300p.txt; grep -c OptimisticConcurrency /tmp/r300p.txt
N=500 PHOTOS=1 node scripts/loadtest/registrations.mjs 2>&1 | tee /tmp/r500p.txt; grep -c OptimisticConcurrency /tmp/r500p.txt
```

| Date | Deployment | N | Shape | p50 | p95 | p99 | OK | Failed | OCC reconnects |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-20 | dev | 300 | all at once | 327 ms | 460 ms | 530 ms | 297 | 3 (socket refused) | 0 |
| 2026-11-20 | dev | 500 | all at once | 427 ms | 839 ms | 878 ms | 500 | 0 | 0 |
| 2026-11-20 | dev | 300 | at once + photos | 340 ms | 516 ms | 614 ms | 256 | 44 (socket refused) | 0 |
| 2026-11-20 | dev | 300 | at once + photos | 364 ms | 516 ms | 548 ms | 300 | 0 | 0 |
| 2026-11-20 | dev | 500 | at once + photos | 555 ms | 1.2 s | 1.6 s | 500 | 0 | 2 |

One run each from one laptop, 64 shards. "Socket refused" rows: the
WebSocket handshake itself was refused (`non-101` in the output), so those
clients never loaded the form or reached any function; it varied run to run
(0, 3, 44) and looks like a limit on one machine opening hundreds of sockets
at once, not the app. Re-measure before relying on these, ideally from more
than one machine.

### WhatsApp consent on (CONSENT=1)

Every registration then queues a WhatsApp message. Since 2026-11-20 the outbox
has one leased worker (`convex/notifications.ts`): submit only inserts its own
row and schedules a `kick`; the worker sends 10 a second until the queue is
empty. The script waits for the outbox to drain and counts the rows.

The generated numbers are valid Indian mobile formats, so the script refuses
to run unless the deployment sends nothing real. Dev has real Meta
credentials, so switch it to the log provider for the run, and back after:

```bash
npx convex env set WHATSAPP_PROVIDER log          # dev only
N=300 CONSENT=1 node scripts/loadtest/registrations.mjs
N=500 CONSENT=1 PHOTOS=1 node scripts/loadtest/registrations.mjs
npx convex env remove WHATSAPP_PROVIDER           # back to real sending
```

Pass: exit 0 (every submit succeeds, one outbox row per registration, all
`sent`), submit p95 under about 2 s, near-zero OCC reconnects, and a drain
rate at or below 10 a second. One worker waits 1 s after each batch's sends,
so it measured about 7 a second; several workers would go faster and overrun
the pace.

| Date | Deployment | N | Shape | Submit p95 | OK | Outbox | OCC reconnects | Drained |
|---|---|---|---|---|---|---|---|---|
| 2026-11-20 | dev, log provider | 300 | consent | 1.0 s | 288 | 288 sent | 0 | 19.6 s after the last submit (30 s spent waiting on 12 refused sockets) |
| 2026-11-20 | dev, log provider | 500 | consent + photos | 848 ms | 500 | 500 sent | 0 | 62.6 s after the last submit (≈ 7 a second) |

The 12 failures in the first row are WebSocket handshakes refused on the
test machine (`non-101`), as in the earlier runs; they never reached a
function. Afterwards the dev outbox and lease tables were empty and
`WHATSAPP_PROVIDER` was removed again.

## Manual check of the registration form (browser; not automated)

Unverified in a browser so far. On /register/<id> of a dev test tournament:

1. Busy retry: fill all 600/min submit shards for the tournament (as the tests do) and submit: "Lots of people are registering right now…" shows and a screen reader announces it.
2. Double-click Register (and press Enter twice): one registration only.
3. Organiser requires a photo; submit without one: "Photo is required"-style error, nothing saved.
4. Optional photo: block api.cloudinary.com in devtools, pick a photo: "Upload failed", no photo shown; Register stays enabled and submits without a photo only if you choose to.
5. Pick the same photo again after that failure: it uploads (the input is reset).
6. Go offline (devtools), press Register: after 15 s the "slow or offline" note shows; go online: success screen, one registration.
7. Dropped answer: submit, kill the connection right after the request leaves, retry: success (fee tournament: the pay buttons when it's the same browser).
8. Someone else's name + phone that is already registered, from another browser: the normal "already registered" error, not success.
