// convex/http.ts - HTTP endpoints. Razorpay posts plan and registration-fee
// payments here:
//   <CONVEX_SITE_URL>/razorpay/webhook   (set RAZORPAY_WEBHOOK_SECRET in Convex env)
// Meta posts WhatsApp delivery receipts and replies here:
//   <CONVEX_SITE_URL>/whatsapp/webhook   (WHATSAPP_APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN)
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifyMetaSignature, verifyRazorpaySignature } from "./razorpaySignature";
import { normalizePhone } from "./notifications";

const http = httpRouter();

http.route({
  path: "/razorpay/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error("RAZORPAY_WEBHOOK_SECRET is not set; refusing webhook");
      await ctx.runMutation(internal.ops.recordWebhook, { event: "unknown", outcome: "not configured" });
      return new Response("Webhook not configured", { status: 500 });
    }

    // Verify against the raw body exactly as sent, before parsing anything.
    const rawBody = await request.text();
    const ok = await verifyRazorpaySignature(rawBody, request.headers.get("X-Razorpay-Signature"), secret);
    if (!ok) {
      await ctx.runMutation(internal.ops.recordWebhook, { event: "unknown", outcome: "invalid signature" });
      return new Response("Invalid signature", { status: 401 });
    }

    const event = JSON.parse(rawBody) as {
      event?: string;
      payload?: {
        payment?: { entity?: { id?: string; amount?: number; order_id?: string } };
        order?: { entity?: { id?: string; notes?: { tournamentId?: string; registrationId?: string } } };
      };
    };
    if (event.event !== "order.paid") {
      await ctx.runMutation(internal.ops.recordWebhook, { event: event.event ?? "unknown", outcome: "ignored event" });
      return Response.json({ ignored: event.event ?? "unknown" });
    }

    const payment = event.payload?.payment?.entity;
    const order = event.payload?.order?.entity;
    const razorpayOrderId = order?.id ?? payment?.order_id;
    if (!payment?.id || payment.amount === undefined || !razorpayOrderId) {
      await ctx.runMutation(internal.ops.recordWebhook, { event: event.event, outcome: "incomplete payload" });
      return Response.json({ ignored: "incomplete payload" });
    }

    // 200 even when not applied, so Razorpay doesn't retry a payment we have
    // deliberately ignored (mismatch) or already applied (replay). Orders for
    // a registration fee carry notes.registrationId; plan upgrades don't.
    const registrationId = order?.notes?.registrationId;
    const result = registrationId
      ? await ctx.runMutation(internal.registrations.applyRegistrationPayment, {
          razorpayOrderId,
          paymentId: payment.id,
          amount: payment.amount,
          notesRegistrationId: registrationId,
        })
      : await ctx.runMutation(internal.payments.applyRazorpayPayment, {
          razorpayOrderId,
          paymentId: payment.id,
          amount: payment.amount,
          notesTournamentId: order?.notes?.tournamentId,
        });
    if (!result.applied) console.warn(`Razorpay ${razorpayOrderId}: ${result.reason}`);
    await ctx.runMutation(internal.ops.recordWebhook, {
      event: event.event,
      orderId: razorpayOrderId,
      outcome: result.applied ? "applied" : `not applied: ${result.reason}`,
    });
    return Response.json(result);
  }),
});

// Meta's one-time subscription check: echo the challenge only for our token.
http.route({
  path: "/whatsapp/webhook",
  method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const params = new URL(request.url).searchParams;
    const token = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    if (token && params.get("hub.mode") === "subscribe" && params.get("hub.verify_token") === token) {
      return new Response(params.get("hub.challenge") ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }),
});

const STOP_WORDS = new Set(["stop", "unsubscribe", "stop all", "cancel"]);
const START_WORDS = new Set(["start", "subscribe", "unstop"]);

type WhatsAppChange = {
  statuses?: Array<{ id?: string; status?: string; errors?: Array<{ title?: string; code?: number }> }>;
  messages?: Array<{ from?: string; type?: string; text?: { body?: string } }>;
};

/**
 * Delivery receipts (delivered / read / failed) and STOP / START replies.
 * Signed with the Meta app secret; anything unsigned is refused before it
 * is parsed. Always 200 once verified, so Meta doesn't retry what we ignore.
 */
http.route({
  path: "/whatsapp/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.WHATSAPP_APP_SECRET;
    if (!secret) {
      console.error("WHATSAPP_APP_SECRET is not set; refusing webhook");
      return new Response("Webhook not configured", { status: 500 });
    }
    const rawBody = await request.text();
    if (!(await verifyMetaSignature(rawBody, request.headers.get("X-Hub-Signature-256"), secret))) {
      return new Response("Invalid signature", { status: 401 });
    }

    const body = JSON.parse(rawBody) as { entry?: Array<{ changes?: Array<{ value?: WhatsAppChange }> }> };
    const values = (body.entry ?? []).flatMap((e) => (e.changes ?? []).map((c) => c.value ?? {}));
    const statuses = values.flatMap((v) => v.statuses ?? []).flatMap((s) =>
      s.id && s.status ? [{ id: s.id, status: s.status, error: s.errors?.[0]?.title }] : [],
    );
    if (statuses.length > 0) await ctx.runMutation(internal.notifications.applyStatuses, { statuses });

    for (const message of values.flatMap((v) => v.messages ?? [])) {
      const word = message.text?.body?.trim().toLowerCase() ?? "";
      const phone = message.from ? normalizePhone(`+${message.from}`, "91") : null;
      if (!phone) continue;
      if (STOP_WORDS.has(word)) await ctx.runMutation(internal.notifications.setOptOut, { phone, optedOut: true });
      else if (START_WORDS.has(word)) await ctx.runMutation(internal.notifications.setOptOut, { phone, optedOut: false });
    }
    return Response.json({ ok: true });
  }),
});

export default http;
