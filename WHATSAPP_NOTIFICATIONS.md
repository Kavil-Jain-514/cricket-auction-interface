# WhatsApp "Player Sold" Notifications

When a player is sold in the live auction (`finalizePlayerSale`), we send them a
WhatsApp message containing the tournament name, team name, owner name, captain
name, and sold price. Sent via the **Meta WhatsApp Cloud API**.

## How it works

1. `convex/auctions.ts` → `finalizePlayerSale` commits the sale, then schedules
   `internal.notifications.sendPlayerSoldWhatsApp` via `ctx.scheduler.runAfter(0, …)`.
2. `convex/notifications.ts` sends the message through the **Meta Cloud API**
   (`graph.facebook.com/.../messages`) using an **approved message template**.

The send is **best-effort**: it runs *after* the sale commits, so if WhatsApp
fails (bad number, Meta down, not configured) the auction is unaffected — it
just logs a warning. Players with no phone number are silently skipped.

## Why a template is required (important)

WhatsApp does **not** allow free-form business-initiated messages to a user who
hasn't messaged you in the last 24 hours. Since players don't text us first, the
message body **must be a pre-approved template**. The dynamic values are passed
in as ordered body parameters `{{1}}…{{6}}`.

## One-time setup

### 1. Create a Meta app + WhatsApp Business number

- Go to https://developers.facebook.com/ → create an app (type **Business**).
- Add the **WhatsApp** product to the app.
- In **WhatsApp → API Setup** you'll get:
  - a **Phone number ID** (the sender), and
  - a temporary access token (valid ~24h, fine for first tests).
- For **testing**: Meta gives you a free test number that can only message a
  short list of recipient numbers you add under "To" in API Setup.
- For **production**: add and verify your own business phone number, and
  complete Meta Business verification.

### 2. Create a permanent access token (for production)

The temporary token expires in ~24h. For a real deployment, create a
**System User** token:

- **business.facebook.com → Business Settings → Users → System Users** → add a
  system user → generate token with the `whatsapp_business_messaging` (and
  `whatsapp_business_management`) permissions. Set it to **never expire**.

### 3. Create & submit the message template

In **WhatsApp Manager → Account tools → Message templates → Create template**
(category **Utility**), name it `player_sold`, language **English**, with this
body, then submit for approval:

```
Congratulations {{1}}! 🎉

You've been sold in *{{2}}*.

🏏 Team: {{3}}
👤 Owner: {{4}}
🧢 Captain: {{5}}
💰 Sold Price: {{6}}

Welcome to the squad!
```

**The parameter order must stay exactly as below** (the code maps to these):

| Var    | Value             |
| ------ | ----------------- |
| `{{1}}` | Player name       |
| `{{2}}` | Tournament name   |
| `{{3}}` | Team name         |
| `{{4}}` | Owner name        |
| `{{5}}` | Captain name      |
| `{{6}}` | Sold price (e.g. `₹1,50,000`) |

> Meta may ask for **sample values** for each variable during template creation —
> provide realistic examples (e.g. "Virat", "Summer Cup", "Royal XI", "R. Sharma",
> "M. Dhoni", "₹1,50,000").
>
> If you change the parameter order in the template, update the `bodyParams`
> array in `convex/notifications.ts` to match.

### 4. Set Convex environment variables

These live in your **Convex deployment** (not `.env.local`). Set them with:

```bash
npx convex env set WHATSAPP_PHONE_NUMBER_ID  1234567890            # sender's Phone number ID
npx convex env set WHATSAPP_ACCESS_TOKEN     EAAG...               # system-user (permanent) token
```

Optional (sensible defaults shown):

```bash
npx convex env set WHATSAPP_TEMPLATE_NAME    player_sold           # default: player_sold
npx convex env set WHATSAPP_TEMPLATE_LANG    en                    # default: en  (must match template language)
npx convex env set WHATSAPP_GRAPH_VERSION    v21.0                 # default: v21.0
npx convex env set WHATSAPP_DEFAULT_COUNTRY_CODE 91                # default: 91 (India), for bare 10-digit numbers
npx convex env set WHATSAPP_NOTIFICATIONS_ENABLED false            # kill switch — disable all sends
```

> `WHATSAPP_TEMPLATE_LANG` must exactly match the template's language code in
> Meta (e.g. `en` vs `en_US`) or the send fails with a "template not found" error.

## Phone number formatting

Player numbers are normalized to E.164 digits in `normalizePhone`:

- `+91 98765 43210`, `9876543210`, `0091-9876543210` → all send to `919876543210`
- Bare 10-digit numbers get `WHATSAPP_DEFAULT_COUNTRY_CODE` (default `91`) prepended.
- Numbers shorter than 7 digits are treated as invalid and skipped.

Store numbers with an explicit `+<country code>` for players outside the default
country to be safe.

## Testing

1. Set the env vars above (temporary token + test number is fine to start).
2. Under **WhatsApp → API Setup**, add your own phone to the allowed recipient
   list, and set that number on a test player.
3. Sell that player in a live auction.
4. Check the Convex logs (`npx convex logs` or the dashboard) for a
   `[whatsapp] Sent sold notification …` line, and your phone for the message.

## Notes / possible extensions

- New WhatsApp business numbers start throttled (e.g. ~250 business-initiated
  conversations/day) until your quality rating and limits ramp up.
- Only the live-auction sale path (`finalizePlayerSale`) triggers a message.
  Admin reassignments in `convex/admin.ts` do **not** — wire the same scheduler
  call there if you want those covered too.
- Delivery status webhooks, retries, and a per-player "notified" flag (to avoid
  duplicate sends on re-runs) are not implemented — add if needed.
