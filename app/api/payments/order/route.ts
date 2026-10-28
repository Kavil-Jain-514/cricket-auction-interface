// POST /api/payments/order { tournamentId, tier }
// Creates a Razorpay order for a plan upgrade and records it in Convex as the
// signed-in owner. The plan itself only changes when Razorpay's signed
// webhook reaches convex/http.ts. Needs RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { PLAN_ORDER, type PlanTier } from "@/convex/planTiers";
import { buildOrderRequest } from "@/lib/razorpayOrder";

export async function POST(request: NextRequest) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return NextResponse.json({ error: "Payments aren't set up yet. Contact Bid11Pro to upgrade." }, { status: 503 });
  }

  const { userId, getToken } = await auth();
  const token = userId ? await getToken({ template: "convex" }) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { tournamentId?: string; tier?: string } | null;
  const tier = body?.tier as PlanTier | undefined;
  if (!body?.tournamentId || !tier || !PLAN_ORDER.includes(tier)) {
    return NextResponse.json({ error: "Choose a tournament and a plan" }, { status: 400 });
  }
  const tournamentId = body.tournamentId as Id<"tournaments">;

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  convex.setAuth(token);
  const usage = await convex.query(api.plans.getPlanUsage, { tournamentId }).catch(() => null);
  if (!usage) return NextResponse.json({ error: "You don't have access to this tournament" }, { status: 403 });
  if (!usage.tier) return NextResponse.json({ error: "This tournament has no limits; no upgrade needed" }, { status: 400 });

  const orderRequest = buildOrderRequest(tournamentId, usage.tier, tier);
  if (!orderRequest) return NextResponse.json({ error: "That isn't an upgrade" }, { status: 400 });

  const razorpay = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
    },
    body: JSON.stringify(orderRequest),
  });
  if (!razorpay.ok) {
    console.error("Razorpay order failed", razorpay.status, await razorpay.text());
    return NextResponse.json({ error: "Couldn't start the payment. Try again." }, { status: 502 });
  }
  const order = (await razorpay.json()) as { id: string; amount: number; currency: string };

  try {
    // Owner-only and amount-checked on the server (payments:recordOrder).
    await convex.mutation(api.payments.recordOrder, { tournamentId, tier, razorpayOrderId: order.id, amount: order.amount });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 403 });
  }

  return NextResponse.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId });
}
