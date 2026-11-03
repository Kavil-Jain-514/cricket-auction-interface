// convex/emails.ts - Invite emails: a team-owner invite link (when the
// organiser gives the owner's address) and "you've been added" for new
// tournament staff (owners and auctioneers).
//
// Outbox, like the WhatsApp one (notifications.ts): the invite or staff
// change only inserts a row in its own transaction, so email can never block
// or fail it. processEmails sends through an EmailProvider (Resend, or a
// log-only one for development), retries server errors with backoff up to
// MAX_ATTEMPTS, and fails at once on 4xx (a bad address or an unverified
// sending domain won't fix itself). Each send carries the row's dedupeKey as
// Resend's Idempotency-Key, so a retry after a timeout never sends twice.
//
// A team-owner invite's one-time link is the only secret here: it is kept
// in the row just until the email is sent or abandoned, then wiped, and an
// invite revoked, used or expired before sending is not emailed at all.

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, query, type MutationCtx } from "./_generated/server";
import { getCurrentUser } from "./auth";
import { isSuperAdmin } from "./policy";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 10;
const RETRY_BASE_MS = 30_000; // 30s, 60s, 2m, 4m
const STUCK_SENDING_MS = 5 * 60_000;
// Where links point. Same as SITE_URL in lib/marketing/content.ts; set
// APP_URL in the Convex env for other deployments (e.g. http://localhost:3000).
const DEFAULT_APP_URL = "https://bid11pro.kaviljain.com";

type Email = Doc<"emails">;
type InvitePayload = Extract<Email["payload"], { teamName: string }>;
type StaffPayload = Extract<Email["payload"], { role: string }>;

export const appUrl = () => (process.env.APP_URL ?? DEFAULT_APP_URL).replace(/\/+$/, "");

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** "j***@gmail.com": enough to tell addresses apart in logs. */
function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 1)}***@${domain}`;
}

/** Insert one outbox row unless already queued, and wake the worker. */
export async function enqueueEmail(
  ctx: MutationCtx,
  row: Pick<Email, "kind" | "dedupeKey" | "tournamentId" | "to" | "payload"> & Partial<Pick<Email, "inviteId">>,
): Promise<Id<"emails"> | null> {
  const existing = await ctx.db
    .query("emails")
    .withIndex("by_dedupe", (q) => q.eq("dedupeKey", row.dedupeKey))
    .first();
  if (existing) return null;
  const now = Date.now();
  const id = await ctx.db.insert("emails", { ...row, status: "queued", attempts: 0, nextAttemptAt: now, createdAt: now });
  await ctx.scheduler.runAfter(0, internal.emails.processEmails, {});
  return id;
}

type Rendered = { subject: string; text: string; html: string };

/** A short branded HTML email: heading, paragraphs, one button, footer. */
function layout(heading: string, paragraphs: string[], button: { label: string; url: string }, footer: string): string {
  const p = paragraphs.map((t) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#334155">${t}</p>`).join("");
  return `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;padding:28px">
<tr><td>
<p style="margin:0 0 20px;font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#ea580c">Bid11Pro</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#0f172a">${heading}</h1>
${p}
<p style="margin:24px 0"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#ea580c;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${button.label}</a></p>
<p style="margin:0;font-size:12px;line-height:1.5;color:#64748b">${footer}</p>
</td></tr></table></td></tr></table></body></html>`;
}

/** Subject and bodies for one email. Every value from users is escaped in HTML. */
export function renderEmail(kind: Email["kind"], payload: Email["payload"]): Rendered | null {
  if (kind === "team_owner_invite") {
    const p = payload as InvitePayload;
    if (!p.link) return null;
    const expires = new Date(p.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
    return {
      subject: `You're invited to own ${p.teamName} in ${p.tournamentName}`,
      text: [
        `${p.inviterName} has invited you to be the owner of ${p.teamName} in ${p.tournamentName} on Bid11Pro.`,
        `Open this link to join, then bid for your team from your phone during the auction:`,
        p.link,
        `The link works once and expires on ${expires}. If you weren't expecting this, you can ignore this email.`,
      ].join("\n\n"),
      html: layout(
        `You're invited to own ${escapeHtml(p.teamName)}`,
        [
          `${escapeHtml(p.inviterName)} has invited you to be the owner of <strong>${escapeHtml(p.teamName)}</strong> in <strong>${escapeHtml(p.tournamentName)}</strong>.`,
          `Join with the button below, then bid for your team from your phone during the auction.`,
        ],
        { label: "Join your team", url: p.link },
        `The link works once and expires on ${escapeHtml(expires)}. If you weren't expecting this, you can ignore this email.`,
      ),
    };
  }
  const p = payload as StaffPayload;
  const link = `${appUrl()}/tournament/${p.tournamentId}`;
  const greeting = p.inviteeName ? `Hi ${p.inviteeName},` : "Hi,";
  const what =
    p.role === "auctioneer"
      ? "As an auctioneer you can run the live auction: start players, take bids, sell and correct sales."
      : "As an owner you can manage the tournament: settings, teams, players, staff and the auction.";
  const subject = p.role === "auctioneer" ? `You're an auctioneer for ${p.tournamentName}` : `You're now an owner of ${p.tournamentName}`;
  const added = `${p.inviterName} added you as ${p.role === "auctioneer" ? "an auctioneer" : "an owner"} for ${p.tournamentName} on Bid11Pro.`;
  return {
    subject,
    text: [greeting, added, what, `Open the tournament: ${link}`].join("\n\n"),
    html: layout(
      escapeHtml(subject),
      [
        escapeHtml(greeting),
        `${escapeHtml(p.inviterName)} added you as ${p.role === "auctioneer" ? "an auctioneer" : "an owner"} for <strong>${escapeHtml(p.tournamentName)}</strong>.`,
        escapeHtml(what),
      ],
      { label: "Open the tournament", url: link },
      "Sign in with this email address to see it. If you weren't expecting this, you can ignore this email.",
    ),
  };
}

type SendResult = { outcome: "sent"; id?: string } | { outcome: "retry" | "failed" | "skipped"; detail: string };

/** Where email goes: Resend in production, or the log (EMAIL_PROVIDER=log). */
export interface EmailProvider {
  send(email: { to: string; idempotencyKey: string } & Rendered): Promise<SendResult>;
}

const resendProvider = (apiKey: string, from: string): EmailProvider => ({
  async send(email) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": email.idempotencyKey },
        body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
      });
      if (res.ok) return { outcome: "sent", id: ((await res.json()) as { id?: string }).id };
      const detail = `resend_${res.status}: ${(await res.text()).slice(0, 300)}`;
      console.error(`[email] Resend error ${res.status} for ${maskEmail(email.to)}`);
      // 429 and 5xx may pass on a retry; other 4xx (bad address, unverified domain) won't.
      return { outcome: res.status === 429 || res.status >= 500 ? "retry" : "failed", detail };
    } catch (err) {
      return { outcome: "retry", detail: `network_error: ${String(err).slice(0, 200)}` };
    }
  },
});

const logProvider: EmailProvider = {
  async send(email) {
    console.log(`[email:log] to ${maskEmail(email.to)}: ${email.subject}\n${email.text}`);
    return { outcome: "sent", id: `log-${Date.now()}` };
  },
};

function providerFromEnv(): EmailProvider | { skip: string } {
  if (process.env.EMAIL_ENABLED === "false") return { skip: "emails_disabled" };
  if (process.env.EMAIL_PROVIDER === "log") return logProvider;
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) return { skip: "not_configured: set RESEND_API_KEY and EMAIL_FROM" };
  return resendProvider(apiKey, from);
}

/** Wipe an invite's one-time link from a row we're done with. */
function withoutLink(row: Email): Partial<Email> {
  return row.kind === "team_owner_invite" ? { payload: { ...(row.payload as InvitePayload), link: undefined } } : {};
}

/** Claim up to BATCH_SIZE due rows (and any stuck in "sending"); drop dead invites. */
export const claimDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [due, stuck] = await Promise.all([
      ctx.db.query("emails").withIndex("by_status_next", (q) => q.eq("status", "queued").lte("nextAttemptAt", now)).take(BATCH_SIZE),
      ctx.db.query("emails").withIndex("by_status_next", (q) => q.eq("status", "sending")).take(BATCH_SIZE),
    ]);
    const claimed: Array<{ _id: Id<"emails">; kind: Email["kind"]; to: string; dedupeKey: string; payload: Email["payload"] }> = [];
    for (const row of [...due, ...stuck.filter((r) => (r.claimedAt ?? 0) < now - STUCK_SENDING_MS)].slice(0, BATCH_SIZE)) {
      if (row.inviteId) {
        const invite = await ctx.db.get(row.inviteId);
        if (!invite || invite.revokedAt !== undefined || invite.usedBy !== undefined || invite.expiresAt <= now) {
          await ctx.db.patch(row._id, { status: "skipped", lastError: "invite_no_longer_valid", ...withoutLink(row) });
          continue;
        }
      }
      await ctx.db.patch(row._id, { status: "sending", claimedAt: now, attempts: row.attempts + 1 });
      claimed.push({ _id: row._id, kind: row.kind, to: row.to, dedupeKey: row.dedupeKey, payload: row.payload });
    }
    return claimed;
  },
});

export const recordResult = internalMutation({
  args: {
    id: v.id("emails"),
    outcome: v.union(v.literal("sent"), v.literal("retry"), v.literal("failed"), v.literal("skipped")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return;
    const now = Date.now();
    if (args.outcome === "sent") {
      await ctx.db.patch(row._id, { status: "sent", sentAt: now, providerId: args.detail, lastError: undefined, ...withoutLink(row) });
    } else if (args.outcome === "skipped") {
      await ctx.db.patch(row._id, { status: "skipped", lastError: args.detail, ...withoutLink(row) });
    } else if (args.outcome === "failed" || row.attempts >= MAX_ATTEMPTS) {
      await ctx.db.patch(row._id, { status: "failed", lastError: args.detail, ...withoutLink(row) });
    } else {
      await ctx.db.patch(row._id, { status: "queued", lastError: args.detail, nextAttemptAt: now + RETRY_BASE_MS * 2 ** (row.attempts - 1) });
    }
  },
});

/** Earliest retry still queued, or null when the outbox is drained. */
export const nextDueAt = internalQuery({
  args: {},
  handler: async (ctx) => {
    const next = await ctx.db.query("emails").withIndex("by_status_next", (q) => q.eq("status", "queued")).first();
    return next?.nextAttemptAt ?? null;
  },
});

/** Drain the outbox one batch at a time, then reschedule for the next batch or retry. */
export const processEmails = internalAction({
  args: {},
  // Explicit types: this action calls back into its own module through `internal`.
  handler: async (ctx): Promise<{ processed: number }> => {
    const claimed: Array<{ _id: Id<"emails">; kind: Email["kind"]; to: string; dedupeKey: string; payload: Email["payload"] }> =
      await ctx.runMutation(internal.emails.claimDue, {});
    const provider = providerFromEnv();
    for (const row of claimed) {
      const rendered = renderEmail(row.kind, row.payload);
      const result: SendResult =
        "skip" in provider
          ? { outcome: "skipped", detail: provider.skip }
          : !rendered
            ? { outcome: "skipped", detail: "nothing_to_send" }
            : await provider.send({ to: row.to, idempotencyKey: row.dedupeKey, ...rendered });
      await ctx.runMutation(internal.emails.recordResult, {
        id: row._id,
        outcome: result.outcome,
        detail: result.outcome === "sent" ? result.id : result.detail,
      });
    }
    if (claimed.length === BATCH_SIZE) {
      await ctx.scheduler.runAfter(1000, internal.emails.processEmails, {});
    } else {
      const next: number | null = await ctx.runQuery(internal.emails.nextDueAt, {});
      if (next !== null) await ctx.scheduler.runAfter(Math.max(0, next - Date.now()), internal.emails.processEmails, {});
    }
    return { processed: claimed.length };
  },
});

/** Outbox health for /admin/live. Super-admin only; null for anyone else. */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    if (!isSuperAdmin(await getCurrentUser(ctx))) return null;
    const count = async (status: Email["status"]) =>
      (await ctx.db.query("emails").withIndex("by_status_next", (q) => q.eq("status", status)).take(1000)).length;
    const lastFailure = await ctx.db.query("emails").withIndex("by_status_next", (q) => q.eq("status", "failed")).order("desc").first();
    return { queued: await count("queued"), failed: await count("failed"), lastError: lastFailure?.lastError ?? null };
  },
});
