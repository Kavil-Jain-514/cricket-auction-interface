// POST /api/registrations/order { registrationId }
// Creates the Razorpay order for a registration fee. No sign-in: registrants
// are anonymous. The fee comes from the registration on the server, and only
// the signed webhook (convex/http.ts) can mark it paid.
import { NextRequest, NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export async function POST(request: NextRequest) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return NextResponse.json({ error: "Online payment isn't set up. Pay the organiser directly." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { registrationId?: string } | null;
  if (!body?.registrationId) return NextResponse.json({ error: "Missing registration" }, { status: 400 });
  const registrationId = body.registrationId as Id<"registrations">;

  const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  const info = await convex.query(api.registrations.getPaymentInfo, { registrationId }).catch(() => null);
  if (!info) return NextResponse.json({ error: "Registration not found" }, { status: 404 });
  if (info.status !== "pending_payment") return NextResponse.json({ error: "Nothing to pay" }, { status: 400 });
  // Refuse before creating a Razorpay order nobody can record (P1-9).
  if (info.ordersLeft === 0) {
    return NextResponse.json({ error: "Too many payment attempts. Contact the organiser." }, { status: 429 });
  }

  const amount = info.fee * 100;
  const razorpay = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
    },
    body: JSON.stringify({
      amount,
      currency: "INR",
      receipt: `reg_${registrationId.slice(-30)}`.slice(0, 40),
      notes: { registrationId, tournamentId: info.tournamentId, purpose: `Registration · ${info.tournamentName}` },
    }),
  });
  if (!razorpay.ok) {
    console.error("Razorpay order failed", razorpay.status, await razorpay.text());
    return NextResponse.json({ error: "Couldn't start the payment. Try again." }, { status: 502 });
  }
  const order = (await razorpay.json()) as { id: string; amount: number; currency: string };
  await convex.mutation(api.registrations.recordOrder, { registrationId, razorpayOrderId: order.id, amount: order.amount });
  return NextResponse.json({ orderId: order.id, amount: order.amount, currency: order.currency, keyId });
}
