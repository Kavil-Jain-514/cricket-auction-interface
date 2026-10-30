// convex/notifications.ts
// Outbound player notifications (WhatsApp via the Meta Cloud API).
//
// WhatsApp platform rule: a business-initiated message to someone who has NOT
// messaged us in the last 24h MUST use a pre-approved template. We therefore
// send a "template" message with numbered body parameters rather than free-form
// text. See the setup steps in WHATSAPP_NOTIFICATIONS.md.
//
// This runs as an internalAction scheduled AFTER the sale is committed, so a
// failure here never rolls back the sale — it is best-effort and only logs.

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { formatRupees } from "./bidRules";

/**
 * Normalize a raw phone number into E.164 digits (no leading "+").
 * - Strips spaces, dashes, parentheses, and a leading "+" or "00".
 * - If the result is a bare local number (<= 10 digits and no country code),
 *   prepends WHATSAPP_DEFAULT_COUNTRY_CODE (default "91" for India).
 * Returns null if there aren't enough digits to be a real number.
 */
export function normalizePhone(
  raw: string,
  defaultCountryCode: string,
): string | null {
  let s = raw.trim();
  if (s.startsWith("00")) s = s.slice(2);
  const hadPlus = s.startsWith("+");
  const digits = s.replace(/\D/g, "");
  if (digits.length < 7) return null; // too short to be valid

  // Already includes a country code (had a "+" or is longer than a local number).
  if (hadPlus || digits.length > 10) return digits;

  // Bare local number — prepend the default country code.
  return `${defaultCountryCode.replace(/\D/g, "")}${digits}`;
}

export { formatRupees };

/**
 * Send the "player sold" WhatsApp notification via the Meta Cloud API.
 *
 * Template body parameter order (must match your approved WhatsApp template):
 *   {{1}} playerName
 *   {{2}} tournamentName
 *   {{3}} teamName
 *   {{4}} ownerName
 *   {{5}} captainName
 *   {{6}} soldPrice (pre-formatted, e.g. "₹1,50,000")
 */
export const sendPlayerSoldWhatsApp = internalAction({
  args: {
    playerName: v.string(),
    phoneNumber: v.optional(v.string()),
    tournamentName: v.string(),
    teamName: v.string(),
    ownerName: v.string(),
    captainName: v.optional(v.string()),
    soldPrice: v.number(),
  },
  handler: async (_ctx, args) => {
    // Feature flag — set WHATSAPP_NOTIFICATIONS_ENABLED="false" to mute sends
    // (e.g. in dev) without removing the wiring.
    if (process.env.WHATSAPP_NOTIFICATIONS_ENABLED === "false") {
      return { sent: false, reason: "notifications_disabled" };
    }

    if (!args.phoneNumber || args.phoneNumber.trim() === "") {
      console.warn(
        `[whatsapp] Skipping "${args.playerName}" — no phone number on record.`,
      );
      return { sent: false, reason: "no_phone_number" };
    }

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const templateName = process.env.WHATSAPP_TEMPLATE_NAME ?? "player_sold";
    const templateLang = process.env.WHATSAPP_TEMPLATE_LANG ?? "en";
    const graphVersion = process.env.WHATSAPP_GRAPH_VERSION ?? "v21.0";
    const defaultCountryCode =
      process.env.WHATSAPP_DEFAULT_COUNTRY_CODE ?? "91";

    if (!phoneNumberId || !accessToken) {
      console.error(
        "[whatsapp] Missing Meta env vars (WHATSAPP_PHONE_NUMBER_ID, " +
          "WHATSAPP_ACCESS_TOKEN). Skipping send.",
      );
      return { sent: false, reason: "not_configured" };
    }

    const e164 = normalizePhone(args.phoneNumber, defaultCountryCode);
    if (!e164) {
      console.warn(
        `[whatsapp] Skipping "${args.playerName}" — unparseable phone "${args.phoneNumber}".`,
      );
      return { sent: false, reason: "invalid_phone" };
    }

    // Ordered body parameters — must match {{1}}..{{6}} in the approved template.
    const bodyParams = [
      args.playerName,
      args.tournamentName,
      args.teamName,
      args.ownerName,
      args.captainName?.trim() || "—",
      formatRupees(args.soldPrice),
    ].map((text) => ({ type: "text" as const, text }));

    const payload = {
      messaging_product: "whatsapp",
      to: e164,
      type: "template",
      template: {
        name: templateName,
        language: { code: templateLang },
        components: [{ type: "body", parameters: bodyParams }],
      },
    };

    try {
      const res = await fetch(
        `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const text = await res.text();
        console.error(
          `[whatsapp] Meta error ${res.status} for "${args.playerName}" (+${e164}): ${text}`,
        );
        return { sent: false, reason: `meta_${res.status}` };
      }

      const data = (await res.json()) as {
        messages?: Array<{ id?: string }>;
      };
      const messageId = data.messages?.[0]?.id;
      console.log(
        `[whatsapp] Sent sold notification to "${args.playerName}" (+${e164}), id=${messageId}`,
      );
      return { sent: true, id: messageId };
    } catch (err) {
      console.error(
        `[whatsapp] Network error sending to "${args.playerName}" (+${e164}):`,
        err,
      );
      return { sent: false, reason: "network_error" };
    }
  },
});
