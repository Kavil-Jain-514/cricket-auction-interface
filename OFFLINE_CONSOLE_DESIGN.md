# Venue-proof console (L6) — design

Status: items 1, 2 and 5 implemented on `feat/remaining-roadmap`; 3 and 4 proposed only.

## Problem

Venue Wi-Fi drops. The console freezes on its last state behind the "Reconnecting" badge
(`components/ui/connection-status.tsx`). Two risks matter: an action applied **twice** when it is retried after
reconnecting, and an auctioneer who can't tell whether a tap landed.

Convex already queues mutations while offline and replays them on reconnect within one client session. What it
can't protect against is an application-level retry: a page reload, a second tab, a double tap, or a "retry"
button resending the same action. Those are what we guard.

## 1. Idempotency keys — implemented

- `placeBid` and `finalizePlayerSale` take an optional `requestId`; `acceptBidRequest` takes `idempotencyKey`
  (its `requestId` argument was already the raise being accepted).
- `convex/idempotency.ts` → `withIdempotency(ctx, kind, roomId, key, apply)`: checks tournament access, then looks
  up `bidRequestsSeen` by `(auctionRoomId, "<kind>:<key>")`. Seen → return the stored result, apply nothing.
  Not seen → run, store the result (success **or** refusal), return it.
- Keys are scoped to room and kind; a daily cron (`convex/crons.ts`) drops keys older than 24h.
- Clients generate one key per action (`newRequestId()` in `lib/optimisticBid.ts`).

Trade-offs: one index read + one insert per keyed bid on the hot write path (the hot *query* is untouched).
Remembering refusals means a retry can't flip "Minimum bid is X" into a success later; a genuinely new attempt
gets a new key. Calls without a key behave exactly as before (harness scripts, old clients).

## 2. Optimistic bid on the console — implemented

`placeBid` uses a Convex optimistic update (`applyOptimisticBid`): the amount, leading team, ticker and bid
count update the moment the auctioneer taps. Convex discards the guess when the mutation returns and the real
`getLiveAuction` result arrives, so a `{ success: false }` rolls back by itself (with the existing toast).
Viewers never see optimistic state; only the console that tapped does.

Trade-off: during a drop the console shows the bid while it is still queued. That is the intended
"it's on its way" signal, and item 1 makes the replay safe.

## 3. One queued action while offline — proposed, not built

Show at most one pending admin action as "Will send when online" (a bid or a pause, never a finalize). Today
Convex's own queue already holds it; the missing part is UI. Needs: reading the client's connection state,
blocking a second action, and an explicit cancel. Deferred until we see real venue behaviour.

## 4. Hotspot fallback — proposed for RUNBOOK.md

Run the console on a phone hotspot and the projector on venue Wi-Fi, so the one device that writes has the most
reliable link; viewers recover on their own. Keep the hotspot phone on a charger and set it to not sleep.

## 5. Chaos scenario — implemented

`harness/admin-reconnect.mjs`: per round, send a bid with a `requestId`, kill the admin socket immediately, wait
5 s, reconnect and resend the same id. Pass = each round adds exactly one live bid and all viewers converge.
Run against staging before an event (see `harness/README.md`).

Tests: `convex/idempotency.test.ts` (replays of bid, failed bid, finalize, accept; scoping; purge) and
`lib/optimisticBid.test.ts`.
