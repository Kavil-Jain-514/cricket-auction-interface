# AUDIT — Live Cricket Auction (Bid11Pro)

## Status (updated as fixes land — all on branch `develop`, NOT yet deployed)

| ID | Severity | State | Ref |
|---|---|---|---|
| P0-1 | P0 | ✅ Fixed — server timer-expiry guard removed (option a) | `d24c4e6` |
| P0-2 | P0 | ⚠️ **Open** — measured: 250-viewer fan-out p95 ≈ 1.2s on **dev**; must measure prod + confirm plan | RUNBOOK pre-event checklist |
| P1-1 | P1 | ✅ Fixed — "Reconnecting…" indicator | `5f7cd73` |
| P1-2 | P1 | ✅ Fixed — getLatestSaleEvent no longer re-fans per bid after unsold | `67b4613` |
| P1-3 | P1 | ⛔ Deferred — a countdown-to-zero now misleads (P0-1 removed the guard); needs a design call |
| P1-4 | P1 | ◑ Partial — hero image prioritized (LCP); "preload next player" is architecturally blocked | `f81b3fa` |
| P1-5 | P1 | ✅ Fixed — duplicate Toaster removed | `186fda3` |
| P1-6 | P1 | ✅ Fixed — viewer flashes use totalBidsCount | `58b8fb6` |
| P2-2 | P2 | ⛔ Open — money-path bid-limit alignment; proposed, not auto-applied (risk) |
| P2-3 | P2 | ✅ Done — concurrency test added | `398122a` |
| P2-1 | P2 | ⛔ Open — verify Clerk middleware / upload route before touching (auth-path risk) |

**⚠️ None of the fixes are live** until `npx convex deploy` (backend) + a Vercel deploy (frontend). They exist only on `develop`.

---

**Phase 0, read-only.** No files were modified. Baseline established:

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint .` | 0 errors, 7 warnings (all cosmetic / generated files) |
| `npx vitest run` | 44 passing (validation, group draw, teams, captains) |

Stack confirmed: Next 16.1.4 (App Router, all pages `"use client"` shells), Convex 1.31.6 as the realtime backend over WebSockets, Clerk auth, Cloudinary images, Vercel Hobby single-region (`iad1`). **The 250-viewer realtime load lives entirely on Convex, not on `next start`.**

---

## What is already right (so we don't "fix" it)

These are the top-5 failure modes, and the code already defends most of them well. Read this before touching anything.

- **Bid ordering & races (top failure mode #1).** Convex mutations are serializable transactions with automatic optimistic-concurrency retry. `placeBid` reads the latest bid, then inserts; two bids arriving within 50ms are serialized, and the loser re-executes against the winner's committed state, so the min-increment check is always evaluated against the true current bid. **Out-of-order or double-accepted bids at the same price are not possible through this path.** (`convex/auctions.ts:214–289`)
- **Reconnect / silent divergence (failure mode #2).** Convex re-runs *full* subscribed queries on reconnect and delivers complete current results, **not deltas**. A phone backgrounded for 5 minutes, or off wifi for 10s, gets a fresh consistent snapshot when the socket returns — there is no delta-replay gap to diverge through. This removes an entire class of bugs.
- **Operator double-submit (failure mode #3).** Three layers: client `bidding` lock (300ms, `page.tsx:418–424`), server per-team rate limit (500ms, `auctions.ts:223–230`), and serializable finalize guarded by `currentPlayerId` (`auctions.ts:339–342`). A second `Finalize` no-ops with `"No player in auction"` (handled at `page.tsx:182`).
- **Two operators conflicting.** All writes require `requireAdmin` and are serialized by Convex. `startNextPlayer` refuses to load a player while one is in the ring (`auctions.ts:586–592`); the losing tab gets a benign `"already in auction"`.
- **Sold/unsold is one transaction.** `finalizePlayerSale` does the player patch, purse patch, room clear, `bids` archive, event insert, and live-bid cleanup in a single mutation — it cannot half-commit (`auctions.ts:380–418`). WhatsApp is scheduled *after* commit so a messaging failure can't roll back a sale.
- **Capacity architecture.** Deliberate hot/cold query split: `getLiveAuction` (room + current player's bids, re-fans on every bid) is tiny; `getAuctionRoster` (full roster) is keyed on `currentPlayerId` so per-bid room patches do **not** invalidate it. Counts are denormalized onto the tournament doc write-side (`auctionCounts.ts`). This is the right shape for 250 viewers.

The residual risk is concentrated in the findings below — a much shorter list than a hand-rolled realtime app would have.

---

## Findings

### P0 — Event-blocking

| ID | File:line | Problem | Trigger | Blast radius | Fix (risk) | Effort |
|---|---|---|---|---|---|---|
| **P0-1** | `convex/auctions.ts:203` | `placeBid` hard-rejects any bid arriving after `bidTimerEndsAt` with `"Bidding time has expired"`, **but no countdown is rendered anywhere and there is no auto-finalize.** The timer is `bidTimerSeconds` (default **30s**) from the last bid/player-start. | New player is introduced; auctioneer talks for >30s before the first bid is called; OR a mid-lull while the auctioneer coaxes a raise. The next legitimately-called bid is silently rejected. | Every operator. A real called bid is *dropped*; the room shows a stale price. Recoverable only by Re-bid/Restart. Directly = "missing bid data." This is the single most likely thing to bite on the night. | This behavior is **tested** (`auctions.test.ts` "rejects bids after the timer has expired"), so confirm intent before changing. Safe options, low risk: (a) remove the server expiry guard — auctioneer paces manually anyway; (b) render a visible countdown so operators see it; (c) make the window large/configurable. **Needs your call — see Question A.** | S |
| **P0-2** | Convex plan / deployment | A single 250-viewer event can exhaust the Convex **free-tier monthly function-call/bandwidth quota mid-auction**, at which point Convex throttles functions and the auction stalls for everyone. Every bid re-fans `getLiveAuction` to all subscribers; a ~300-player auction at ~10 bids each ≈ 750k+ query executions in one evening. | Real event traffic on a free/Starter Convex deployment. "Server falling over at 250" (failure mode #5) — but via quota, not CPU. | Entire event, all viewers, unrecoverable without a plan upgrade mid-event. | **Verify the current Convex plan tier and its monthly function-call + bandwidth limits before the event; upgrade to a paid plan with headroom.** Then run the existing `load-test-auction.js` (k6) against the **production** deployment, not dev. Config/ops change, no code risk. | S (verify) |

### P1 — Event-degrading

| ID | File:line | Problem | Trigger | Blast radius | Fix (risk) | Effort |
|---|---|---|---|---|---|---|
| **P1-1** | `app/providers.tsx` / `app/auction/[roomId]/page.tsx` | **No connection-state indicator.** Convex auto-reconnects and resyncs correctly, but during a disconnect the UI freezes on the last value with *zero* signal. A team owner on flaky venue wifi can be bidding against a stale number without knowing. (Failure mode #2: "a phone that silently stops updating".) | Any network blip, backgrounded tab, iOS lock/Low-Power WebSocket suspension. | Every viewer, intermittently. Data is correct once reconnected (no divergence), but the *staleness is invisible*. | Add a small "Reconnecting…" badge driven by Convex's connection state (`convex.connectionState()` / `useConvex`). No data-path change, low risk. Highest-value P1. | S–M |
| **P1-2** | `convex/auctions.ts:1159–1163` | `getLatestSaleEvent` reads the **room doc** inside the `if (!sold)` branch. Convex tracks that read, so **after any UNSOLD result, every subsequent bid's timer patch to the room re-fans this query to all 250 viewers** for the entire duration of the next player's bidding. Roughly doubles fan-out after unsold players. | Any unsold player, then normal bidding on the next player. | All viewers; amplified backend load exactly when the room is busy. Feeds P0-2. | Stop reading the room here: write the unsold player's base price into the `player_unsold` event `data` at finalize time and read it from the event, so the query never touches the room. Low risk. | S |
| **P1-3** | `app/auction/[roomId]/page.tsx` (no timer UI) | **No visible bid countdown at all**, despite a server-enforced deadline (pairs with P0-1). `serverTime` is threaded to the client for clock-skew correction but never used. Operators and the room can't see how long is left. | Every player. | Operators fly blind on the timer; contributes to P0-1 surprise rejections. | Render a countdown from `bidTimerEndsAt` corrected by `serverTime`. Only build this if we keep the timer (Question A). Transform/opacity only. | M |
| **P1-4** | `page.tsx:965`, `components/ui/player-avatar.tsx` | Hero player photo is a plain `<img>` via Cloudinary transform (`next/image` is not used anywhere). **The next player's image is not preloaded**, and there's no `fetchpriority`/decoding hint. On 4G the projector/phone shows initials, then pops to the photo. CLS is mostly contained (`aspect-square` reserves space), but LCP suffers. | Every new player, especially first load on 4G. | Projector + all phones: image pop-in each player. Brief target: LCP < 2.5s, CLS < 0.05. | Preload the next player's Cloudinary URL (`<link rel=preload as=image>` or `new Image()`) while the current one is bid on; add `fetchpriority="high"` to the hero. Low risk. | S–M |
| **P1-5** | `app/layout.tsx:38` + `app/providers.tsx:59` | **Two `<Toaster>` components** are mounted (different props: `richColors` vs custom styles). Toasts can render twice / inconsistently. | Any toast (bid rejected, errors). | Operators mainly; visual noise, possible double toasts. | Remove one Toaster; keep a single configured instance. Trivial, low risk. | S |
| **P1-6** | `page.tsx:275,304,312` | Viewer "New Bid!" / "Reverted" flash logic compares `recentBids.length`, but `getLiveAuction` **caps `recentBids` at 10** (`auctions.ts:910`). After the 10th bid on a player, `length` sticks at 10 and these flashes stop firing. | Any player that draws >10 bids. | Viewers only; cosmetic flashes silently stop in hot bidding wars. | Drive the flash off `totalBidsCount` (already returned) instead of `recentBids.length`. Low risk. | S |

### P2 — Post-event

| ID | File:line | Problem | Fix | Effort |
|---|---|---|---|---|
| **P2-1** | `app/api/upload/route.ts:22`, no `middleware.ts` | Route uses Clerk `auth()` (server), but there is **no `clerkMiddleware()`** in the repo. In Clerk v6 `auth()` throws without it → image **upload/delete likely broken**. Pre-event setup only (roster building), and existing data already has photos, so not event-night — but verify. | Add `middleware.ts` with `clerkMiddleware()`, or confirm uploads currently work. | S |
| **P2-2** | `auctions.ts:253` vs `auctions.ts:1002` | `placeBid` computes the squad-reserve with `tournamentBasePrice`; `getAuctionRoster` (client display) uses `minPendingBasePrice`. The `maxAllowedBid` the operator sees can differ from what the server enforces → a bid shown as allowed gets rejected (or vice-versa). | Align both to the same base-price source. | S |
| **P2-3** | test suite | No concurrency test (two racing bids), no reconnect/resync test. Validation is well covered; the race path that matters most is not. | Add a convex-test that fires two `placeBid`s and asserts one wins at the correct increment. | M |
| **P2-4** | `auctions.ts:1128–1139` | `getLatestSaleEvent` scans only the last 25 events; a pathological run of >25 non-sale events (many restarts/pauses) between two sales would miss a viewer popup. Very unlikely in practice. | Query sold/unsold event types directly, or widen the window. | S |
| **P2-5** | `convex/players.ts:233`, `load-test*.js` | Lint warnings: unused `_stripped`, unused `_e`, anonymous default export, stale eslint-disable directives. | `eslint --fix` + manual cleanup. | S |

---

## Answers to the brief's specific questions

**Realtime correctness**
- *Two bids within 50ms?* Serialized by Convex OCC; loser re-runs against the winner's committed bid and is validated correctly. Safe.
- *Monotonic sequence/version?* No explicit version field. Ordering is by `timestamp` (`Date.now()`) via the `by_player` index, with insertion order breaking same-ms ties. Enforced monotonic increments make amount order safe; the only edge is two identical-ms bids where "latest" is decided by insertion, not amount — negligible because increments prevent equal amounts.
- *Idempotent / duplicate delivery?* Convex client de-dupes; mutations aren't client-retried on success. A genuine double-tap creates two inserts, caught by the 300ms client lock + 500ms server per-team rate limit.
- *Reconnect = full resync or deltas?* **Full resync** — Convex re-runs queries and sends complete results. No silent divergence. ✅
- *Phone backgrounded 5 min?* Socket suspends; on return Convex reconnects and resyncs full state. Functionally correct — **but no visible "reconnecting" state (P1-1).**
- *Heartbeat / reconnecting UI?* Convex has internal WS keepalive. **No UI indicator (P1-1).**

**Write path**
- *Double-submit via double-tap / Enter+click?* Guarded (P0 "right" list). Safe.
- *Server-side validation?* Yes — amount, purse, squad-reserve, increment, timer, admin-only all enforced in `placeBid` server-side.
- *Two operator sessions conflict?* Serialized single-writer via Convex + `requireAdmin`; `startNextPlayer` and `finalizePlayerSale` both guard on room state. Safe.
- *Sold/unsold transactional?* Yes — single mutation, cannot half-fail.

**Capacity**
- *Provider concurrent-connection limit?* Convex scales WebSocket clients; the real ceiling is the **plan's monthly function-call/bandwidth quota (P0-2)** — must be verified.
- *Payload × 250 × bid rate?* `getLiveAuction` is intentionally tiny, but fan-out count is 250× per bid; over a full auction this is the quota driver (P0-2), amplified after unsold players (P1-2).
- *Connection 251?* No hard app-level cap; failure mode is quota throttling, not a rejected 251st socket. Vercel Hobby only serves the static shell, not realtime, so it is not the bottleneck.

**Projector view**
- There is **no dedicated projector route** — the projector shows the viewer (non-admin) page, which needs no login (Convex queries run unauthenticated). Hero text is large (name up to `text-7xl`, bid `text-8xl`) — legible at 10m. Secondary chrome (progress pill, footer credit) is `text-[10px]` — illegible at distance but non-critical. Nothing depends on hover for core info. 3h soak: animations are transform/opacity and unmount per player; confetti is time-bounded (5s) with `cancelAnimationFrame` cleanup — no obvious leak.
- *Under 1920px dependency?* Layout is responsive down; no hard min-width break found.

**Mobile view**
- *First-load JS?* Not measured in Phase 0 (needs a build). Heavy conditional components (`PlayerResultPopup`, `AuctionCompleteScreen`, `AdminPlayerManager`) are already `dynamic()`/`ssr:false`. framer-motion + canvas-confetti are the largest always-on deps.
- *Layout shift on photo load?* Mostly reserved via `aspect-square`; no width/height on `<img>` and no preload → pop-in, not shift (P1-4).
- *iOS Safari Low Power Mode?* WebSocket suspends on lock/background and Convex reconnects on resume — functionally OK, but the invisible-staleness gap (P1-1) is worst here.

---

## Verdict

**Would I run this event on this code tonight? — Qualified yes,** *after* two cheap checks, which is unusual for a brief like this. The realtime core is not hand-rolled; it rides Convex's serializable transactions and full-state resync, so the scary failure modes (out-of-order bids, silent divergence, half-committed sales, double-submits) are already engineered out and tested. That is the hard part, and it's done well.

The three things I'd fix first:
1. **P0-1 — the 30s timer that silently rejects real bids.** Confirm intent, then make it visible or remove it. This is the most probable on-the-night failure.
2. **P0-2 — confirm the Convex plan quota and load-test production.** "Falling over at 250" here means hitting a billing quota, not CPU — a five-minute check that prevents a dead auction.
3. **P1-1 — a "Reconnecting…" indicator.** Small change that closes the "phone silently froze" gap the brief ranks second.

Everything below that is polish. I did **not** modify any files and will not until you approve this audit.

---

## One decision I need before Phase 1 (Question A)

The `bidTimerEndsAt` expiry rejection (P0-1) is *tested*, so it may be intentional. For an **auctioneer-paced** event where a human calls "sold" (manual `Finalize`, no auto-finalize on expiry), a hard server rejection of a late-but-legitimate bid is a footgun. Which do you want?
- **(a)** Remove the server-side expiry guard entirely — the auctioneer controls pacing.
- **(b)** Keep it but render a visible countdown so operators are never surprised.
- **(c)** Keep it, but make the window long/configurable (e.g. 120s) and visible.

I recommend **(b)**. I'll wait for your steer before writing any Phase 1 fixes.
