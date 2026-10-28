# RUNBOOK — Live Cricket Auction (Bid11Pro)

One page. Keep it open on the operator laptop during the event.

**Key fact that makes everything below safe:** all auction state (current player,
bids, purses, sold/unsold) lives in **Convex**, not in the browser. Reloading a
page, swapping devices, or redeploying the frontend does **not** lose state — any
page that reopens the room resyncs the full current state automatically.

---

## Roles & URLs

| | URL / action |
|---|---|
| Operator (admin) | `/auction/<ROOM_ID>` — signed in as an **admin** user |
| Projector / spectators | same `/auction/<ROOM_ID>` — **no login needed** (viewer mode). Open it signed out or in a private window; the header shows **Viewer** and no operator buttons. |
| Operator on a viewer screen | click **Sign in** in the viewer header — you return to the same room with controls once signed in as admin |
| Convex dashboard | https://dashboard.convex.dev → this project |
| Vercel dashboard | https://vercel.com → this project → Deployments |

Find the room id: Convex dashboard → Data → `auctionRooms`, or `npx convex data auctionRooms`.

---

## If the projector freezes or goes blank

1. **Reload the tab** (`Cmd/Ctrl + R`). Convex resyncs the full live state in <3s. This fixes ~all freezes.
2. If the browser/machine is wedged: open `/auction/<ROOM_ID>` on the **backup device** (phone/laptop) — no login required. Keep one backup device ready before the event.
3. The auction itself is unaffected by a frozen projector — the operator can keep taking bids; the projector is just a mirror of Convex.

## If a viewer's phone stops updating

- It's almost always a network blip. Convex auto-reconnects and resyncs. Tell them to **wait 5s or pull-to-refresh**.
- No data is lost or wrong on reconnect — the client always gets the true current state, never a partial replay.

## Operator controls (header buttons)

| Button | Effect |
|---|---|
| **Pause / Resume** | Freeze/unfreeze bidding. Safe anytime. |
| **Revert** | Undo the last bid (removes only the most recent). |
| **Re-bid** | Clear ALL bids for the current player and restart bidding (player stays up). |
| **Finalize** | Sell to the highest bidder, or mark unsold if no bids. Advances to next player automatically. |
| **Final Unsold** | (Unsold round only) Remove this player from the auction entirely. |
| **Restart** | ⚠️ **DESTRUCTIVE** — resets EVERY player, purse, and bid. Only between events, never mid-auction. Confirm twice. |

> **Timer note:** the on-screen countdown is cosmetic. Bids are **never** rejected for being "late" — take a called bid whenever it comes (fixed in P0-1).

## Restart mid-auction without losing state

- **Just reopen the room URL.** State is in Convex. Nothing to restore.
- To pause the room while you sort out a device: click **Pause**, fix the device, click **Resume**. The current player, bids, and purses are preserved.
- Do **NOT** click **Restart** to recover from a glitch — that wipes the auction. Restart is only for starting a fresh event.

## Roll back a bad deploy

The **frontend (Vercel)** and **backend (Convex)** deploy separately — check which one you changed.

- **Frontend (UI looks broken / white screen):** Vercel dashboard → Deployments → last known-good → **⋯ → Promote to Production**. (or `vercel rollback`). ~30s.
- **Backend (mutations/queries misbehaving):** re-deploy the previous good commit: `git checkout <good-sha> && npx convex deploy`. ⚠️ If the bad deploy changed the **schema**, confirm the rollback schema still matches existing data before deploying.
- When in doubt during a live event, prefer **Pause** + call the developer over a hot rollback.

---

## Pre-event checklist (do the day before)

- [ ] **Convex plan / quota (AUDIT P0-2, OPEN).** Confirm the production Convex plan tier and its monthly function-call + bandwidth limits have headroom for ~250 viewers × the full bid volume. A free-tier quota exhaustion mid-event stalls the auction. Upgrade if unsure.
- [ ] Run the load harness against the **production** deployment (see `harness/README.md`) and confirm p95 < 500ms, p99 < 1200ms at 250 viewers.
- [ ] Run the chaos harness; confirm 0 divergence, 0 duplicate acceptances.
- [ ] One admin account confirmed working; one **backup device** loads the viewer page **signed out** (private window) and shows live bids.
- [ ] Venue wifi tested with ~10 phones on the room URL simultaneously.
- [ ] Confirm `bidTimerSeconds` / `minBidIncrement` / `basePurse` in tournament settings.

## Organisers, plans and payments (one-time setup)

- **After deploying organiser isolation, run once:** `npx convex run staff:backfillTournamentOwners`
  (makes every existing tournament's creator its owner; safe to re-run).
- **Plans:** new tournaments start on Free (4 teams, 60 players). Club ₹999 (8/150), League ₹2,999 (12/250),
  Pro ₹6,999 (20/500), per tournament; an upgrade pays only the difference. Tournaments created before plans
  have no limits. Prices live in `convex/planTiers.ts`.
- **Offline payment (bank transfer, comp):** as super-admin, open the tournament → plan card → *Grant*, with a
  reason. It is audit-logged.
- **Razorpay keys** (Dashboard → Settings → API Keys / Webhooks):
  - Next.js env (Vercel): `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`. Without them the Upgrade button says
    payments aren't set up.
  - Convex env: `npx convex env set RAZORPAY_WEBHOOK_SECRET <secret>`.
  - Webhook URL: `<NEXT_PUBLIC_CONVEX_SITE_URL>/razorpay/webhook`, event **order.paid** only.
- **A paid plan didn't apply:** Convex logs show `Razorpay <order>: <reason>` (unknown order, amount mismatch,
  already paid). Razorpay → Webhooks → resend is safe: replays are ignored.

## Player registration (self sign-up)

- Owner: Settings → General → *Open player registration*, optional fee. Share the form link from
  Tournament → Registrations → *Copy form link* (`/register/<tournamentId>`).
- Review under Registrations: *Ready* entries (paid, or free) can be approved one by one or with
  *Approve all ready*; each becomes a pending player with the normal validation and plan limits. Possible
  duplicates (same name + phone) are flagged. Reject needs a reason.
- Photo uploads sign in Convex, so set these in the **Convex** env (not just Next.js):
  `npx convex env set CLOUDINARY_CLOUD_NAME <name>`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
  Without them the form still works, just without a photo.
- Fees use the same Razorpay keys and the same webhook as plans; a fee payment carries `registrationId` in
  its order notes.
- Spam guards: a hidden honeypot field, and at most 3 sign-ups per phone number per tournament per day.

## Who to call

| Role | Name | Contact |
|---|---|---|
| Developer / on-call | Kavil Dani | +91-7406486484 |
| Convex status | — | https://status.convex.dev |
| Vercel status | — | https://www.vercel-status.com |

_(Fill in event-day operator + backup operator names/numbers before the event.)_
