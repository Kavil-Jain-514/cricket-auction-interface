// convex/http.ts - HTTP endpoints. Razorpay posts plan payments here:
//   <CONVEX_SITE_URL>/razorpay/webhook   (set RAZORPAY_WEBHOOK_SECRET in Convex env)
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { verifyRazorpaySignature } from "./razorpaySignature";

const http = httpRouter();

http.route({
  path: "/razorpay/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      console.error("RAZORPAY_WEBHOOK_SECRET is not set; refusing webhook");
      return new Response("Webhook not configured", { status: 500 });
    }

    // Verify against the raw body exactly as sent, before parsing anything.
    const rawBody = await request.text();
    const ok = await verifyRazorpaySignature(rawBody, request.headers.get("X-Razorpay-Signature"), secret);
    if (!ok) return new Response("Invalid signature", { status: 401 });

    const event = JSON.parse(rawBody) as {
      event?: string;
      payload?: {
        payment?: { entity?: { id?: string; amount?: number; order_id?: string } };
        order?: { entity?: { id?: string; notes?: { tournamentId?: string } } };
      };
    };
    if (event.event !== "order.paid") {
      return Response.json({ ignored: event.event ?? "unknown" });
    }

    const payment = event.payload?.payment?.entity;
    const order = event.payload?.order?.entity;
    const razorpayOrderId = order?.id ?? payment?.order_id;
    if (!payment?.id || payment.amount === undefined || !razorpayOrderId) {
      return Response.json({ ignored: "incomplete payload" });
    }

    // 200 even when not applied, so Razorpay doesn't retry a payment we have
    // deliberately ignored (mismatch) or already applied (replay).
    const result = await ctx.runMutation(internal.payments.applyRazorpayPayment, {
      razorpayOrderId,
      paymentId: payment.id,
      amount: payment.amount,
      notesTournamentId: order?.notes?.tournamentId,
    });
    if (!result.applied) console.warn(`Razorpay ${razorpayOrderId}: ${result.reason}`);
    return Response.json(result);
  }),
});

export default http;
