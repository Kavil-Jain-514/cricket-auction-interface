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
| Operator (console) | `/auction/<ROOM_ID>` — signed in as the tournament's **owner** or an **auctioneer** (or the super-admin) |
| Projector / spectators | same `/auction/<ROOM_ID>` — **no login needed** (viewer mode). Open it signed out or in a private window; the header shows **Viewer** and no operator buttons. |
| Operator on a viewer screen | click **Sign in** in the viewer header — you return to the same room with controls once signed in as an owner or auctioneer |
| Team owner (paddle) | same URL, signed in with the account that claimed the team's invite |
| Live ops (super-admin) | `/admin/live` — running rooms, who is connected, WhatsApp queue, webhooks, refunds due |
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
| **Revert** | Undo the last bid (removes only the one you saw on top). |
| **Re-bid** | Clear ALL bids for the current player and restart bidding (player stays up). |
| **Finalize** | Sell to the highest bidder, or mark unsold if no bids. Advances to next player automatically. |
| **Final Unsold** | (Unsold round only) Remove this player from the auction entirely. |
| **Restart** | ⚠️ **DESTRUCTIVE** — resets EVERY player, purse, and bid. Owners only. Refused while live: **Pause** first, then type the tournament name. A snapshot is saved first, so it can be undone (see *Recover*). |
| **Rehearsal / End rehearsal** | Owners, before the auction starts: a practice run with a blue *Rehearsal* banner on every screen and no WhatsApp; **End rehearsal** puts everything back. |

> **Timer note:** the on-screen countdown is cosmetic. Bids are **never** rejected for being "late" — take a called bid whenever it comes (fixed in P0-1).

### What the console's messages mean

Every console action carries the player and price the console was showing, so a tap that is out of date
is **refused, never applied to the wrong player**. These are safe; read the screen and act again.

| Message | Meaning | Do |
|---|---|---|
| **Price changed, current bid is ₹X** | Another bid landed first (second console, owner paddle). | Call the next bid from ₹X. |
| **Player changed: a different player is up now** | The tap was for the previous player (often a tap held during a Wi-Fi drop). | Nothing was changed. Carry on with the player on screen. |
| **No player in auction** | The player was already sold/unsold (e.g. by the other console). | Nothing to do. |
| **Reconnecting… · last update Ns ago** (amber, bottom) | This device lost its connection; the screen is frozen at that moment. | Wait; it resyncs by itself. If **Reload** appears, tap it. |

## Restart mid-auction without losing state

- **Just reopen the room URL.** State is in Convex. Nothing to restore.
- To pause the room while you sort out a device: click **Pause**, fix the device, click **Resume**. The current player, bids, and purses are preserved.
- Do **NOT** click **Restart** to recover from a glitch — that wipes the auction. Restart is only for starting a fresh event.

## If the auctioneer's connection drops

1. The console shows the amber **Reconnecting…** badge. **Don't keep tapping.** Anything tapped while offline is
   sent when the link returns, and a stale tap is refused ("Player changed" / "Price changed"), never applied to
   the wrong player or price.
2. If it hasn't come back in ~15 s: switch to the **standby console** (same room URL). It has the live state
   already. Carry on from what the projector shows.
3. When the first console returns, it resyncs by itself. Only one person calls bids at a time; the other console
   watches.
4. If both consoles are down: **the auction just waits**. Nothing advances on its own (no auto-sell, the timer is
   only a display). Tell the room, fix the link, resume.

## Recover

- **Wrong sale / price:** console → *Manage players* → change status, price or team. Every change is audited and the
  purses follow.
- **Purses look wrong:** the console's reconciliation badge says which team; *Recalculate purse* rebuilds it from the
  sold players.
- **Restart (or a bad correction) by mistake:** pause, then tournament page → **Snapshots** → *Restore* the one from
  just before it (type the tournament name). The current state is snapshotted first, so a restore can be undone.
  Rooms that were live come back **paused**; press Resume.
- **WhatsApp not arriving:** /admin/live → *WhatsApp queue*. Failed rows show Meta's error (template name, token,
  number). The sale is never affected. Each player gets at most one message per team.
- **A payment went through but nothing changed:** /admin/live → *Refunds due* and *Razorpay webhooks*. A plan paid
  after a higher one, or a second registration fee, is kept as *refund due*: refund it in the Razorpay dashboard.

## Roll back a bad deploy

The **frontend (Vercel)** and **backend (Convex)** deploy separately — check which one you changed.

- **Frontend (UI looks broken / white screen):** Vercel dashboard → Deployments → last known-good → **⋯ → Promote to Production**. (or `vercel rollback`). ~30s.
- **Backend (mutations/queries misbehaving):** re-deploy the previous good commit: `git checkout <good-sha> && npx convex deploy`. ⚠️ If the bad deploy changed the **schema**, confirm the rollback schema still matches existing data before deploying.
- When in doubt during a live event, prefer **Pause** + call the developer over a hot rollback.

---

## Auction-day checklist

**The day before**

- [ ] **Convex plan / quota.** Confirm the production plan's monthly function-call and bandwidth limits have headroom for the expected viewers. Quota exhaustion mid-event stalls the auction. Upgrade if unsure.
- [ ] Run `scripts/loadtest/run.mjs` against **staging** at the expected viewer count with `CHAOS=1` (see `scripts/loadtest/README.md`). Pass = p95 < 1 s, 0 errors, 0 divergence. Note the KB per bid and check it against the quota.
- [ ] **Rehearse** in the real room: owner → *Rehearsal*, run 3–4 players with both consoles and a couple of owner paddles, then *End rehearsal*. Check the tournament page shows the rehearsal snapshot.
- [ ] Settings checked (purse, increments, squad rules, bid mode) — they lock once the auction starts.
- [ ] Reconciliation badge on the console is green.
- [ ] Super-admin opens **/admin/live**: WhatsApp queue 0 failed, no refunds due, last webhook *applied*.

**On the day, before Start**

- [ ] Main console on a **phone hotspot** (the one device that writes gets the most reliable link); projector and viewers on venue Wi-Fi. Hotspot phone on a charger, screen sleep off.
- [ ] **Second console** signed in as an auctioneer on another device, same room URL, as a standby (it shows a green *Live* dot when connected).
- [ ] Projector: viewer page signed out, full screen. The screen stays awake while the auction is live (Wake Lock); still set the laptop's own sleep to *never*.
- [ ] Backup projector device on the viewer page.
- [ ] /admin/live shows both consoles connected.
- [ ] Press **Start**. A snapshot is taken automatically.

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
- Spam guards: a hidden honeypot field, at most 3 sign-ups per phone number per tournament per day, and at most
  30 sign-ups and 60 photo uploads per tournament per minute. There is no CAPTCHA yet.
- **Cap photo size in Cloudinary:** uploads are signed, but Cloudinary only enforces size through an upload
  preset. Create one with a max file size (e.g. 5 MB) and image formats only.
- A registrant can open checkout up to 10 times; a second paid fee is listed as *refund due* on /admin/live and
  `registrations:listRefundsDue`.

## Who to call

| Role | Name | Contact |
|---|---|---|
| Developer / on-call | Kavil Dani | +91-7406486484 |
| Convex status | — | https://status.convex.dev |
| Vercel status | — | https://www.vercel-status.com |

_(Fill in event-day operator + backup operator names/numbers before the event.)_
