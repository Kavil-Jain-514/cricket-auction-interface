# WhatsApp Notifications

Players get three WhatsApp messages, sent via the **Meta WhatsApp Cloud API**:

| When | Template | Who |
| ---- | -------- | --- |
| They submit the public registration form | `registration_received` | registrants who ticked the WhatsApp box |
| The organiser approves their registration | `registration_approved` | same |
| They are sold in the live auction (`finalizePlayerSale`) | `player_sold` | players with a phone who didn't decline |

## How it works

1. The sale (`finalizePlayerSale`), the registration (`registrations:submit`) or
   the approval (`registrations:approve` / `bulkApprove`) adds one row to the
   `notifications` outbox in its own transaction. Nothing is sent inside them, so
   WhatsApp can never slow down or fail a sale or a registration.
2. `convex/notifications.ts` → `processQueue` sends queued rows through the
   **Meta Cloud API** (`graph.facebook.com/.../messages`) using an **approved
   message template**, at most 10 a second.

- **Never twice.** One row per event and person (`dedupeKey`): one "sold" per
  player and team, one "received" and one "approved" per registration. Restarts,
  retries and double clicks reuse the row.
- **Retries.** A failed send is retried after 30s, 60s, 2m and 4m; after 5
  attempts the row is marked `failed` with the last error. Rows a crashed run left
  in `sending` are picked up again after 5 minutes.
- **Never affects the sale.** If WhatsApp fails (bad number, Meta down, not
  configured), the auction is unaffected.
- **Skipped:** players with no phone number, players who declined WhatsApp on the
  registration form (`consentWhatsApp: false`), and every send when the env vars
  are missing (`not_configured`) or `WHATSAPP_NOTIFICATIONS_ENABLED=false`.
- Phone numbers are masked in logs (`+91•••••3210`).
- **Opt-outs.** A player who replies STOP (or UNSUBSCRIBE) is never messaged again
  (`whatsappOptOuts`) until they reply START. The registration form says so.
- **Delivery.** The webhook below marks messages `delivered`, or `failed` if Meta
  accepted a message but couldn't deliver it.
- **Organisers** see each registration's messages (sent / delivered / failed /
  not sent) on the Registrations page, with **Resend** on failed ones. Resend
  re-queues the same row, so it can't send twice.
- Queue depth and the last failure: `/admin/live` (`notifications:queueStats`).
- **Local development:** `npx convex env set WHATSAPP_PROVIDER log` logs each
  message (masked) instead of sending it.

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

### 3. Create & submit the message templates

In **WhatsApp Manager → Account tools → Message templates → Create template**
create these three (category **Utility**, language **English**) and submit them
for approval. Use exactly these names, or set the env vars below to yours.

#### `registration_received`

```
Hi {{1}}, thanks for registering for *{{2}}*! 🏏

The organiser will review your entry. We'll message you here once you're approved.
```

| Var | Value | Sample |
| --- | ----- | ------ |
| `{{1}}` | Player name | Virat |
| `{{2}}` | Tournament name | Summer Cup |

#### `registration_approved`

```
Good news, {{1}}! ✅ You're approved for *{{2}}* and in the player pool for the auction.

We'll message you here when a team picks you.
```

| Var | Value | Sample |
| --- | ----- | ------ |
| `{{1}}` | Player name | Virat |
| `{{2}}` | Tournament name | Summer Cup |

#### `player_sold`

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
> If you change the parameter order in a template, update `templateFor` in
> `convex/notifications.ts` to match.
>
> Meta adds its own "reply STOP to unsubscribe" handling for marketing templates
> only; these are Utility templates, so our webhook handles STOP itself.

### 4. Set Convex environment variables

These live in your **Convex deployment** (not `.env.local`). Set them with:

```bash
npx convex env set WHATSAPP_PHONE_NUMBER_ID  1234567890            # sender's Phone number ID
npx convex env set WHATSAPP_ACCESS_TOKEN     EAAG...               # system-user (permanent) token
```

Optional (sensible defaults shown):

```bash
npx convex env set WHATSAPP_TEMPLATE_NAME    player_sold           # default: player_sold
npx convex env set WHATSAPP_TEMPLATE_REGISTERED registration_received  # default: registration_received
npx convex env set WHATSAPP_TEMPLATE_APPROVED   registration_approved  # default: registration_approved
npx convex env set WHATSAPP_TEMPLATE_LANG    en                    # default: en  (must match template language)
npx convex env set WHATSAPP_GRAPH_VERSION    v21.0                 # default: v21.0
npx convex env set WHATSAPP_DEFAULT_COUNTRY_CODE 91                # default: 91 (India), for bare 10-digit numbers
npx convex env set WHATSAPP_NOTIFICATIONS_ENABLED false            # kill switch — disable all sends
npx convex env set WHATSAPP_PROVIDER         log                   # development: log instead of sending
```

### 5. Delivery and STOP webhook

In the Meta app: **WhatsApp → Configuration → Webhook**:

- Callback URL: `<NEXT_PUBLIC_CONVEX_SITE_URL>/whatsapp/webhook`
- Verify token: any long random string; set the same one in Convex:
  `npx convex env set WHATSAPP_WEBHOOK_VERIFY_TOKEN <token>`
- Subscribe to the **messages** field.
- App secret (**App settings → Basic → App secret**):
  `npx convex env set WHATSAPP_APP_SECRET <secret>`. Every POST is checked
  against its `X-Hub-Signature-256`; unsigned or mis-signed requests get a 401
  and change nothing. Without the secret the webhook refuses everything.

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

## Notes

- New WhatsApp business numbers start throttled (e.g. ~250 business-initiated
  conversations/day) until your quality rating and limits ramp up. A big
  registration day can hit that; messages over the limit fail and can be resent.
- Only the live-auction sale path (`finalizePlayerSale`) sends "sold". Admin
  reassignments in `convex/admin.ts` do **not**.
- Players added by the organiser (not through the form) get no registration
  messages; they never opted in.
