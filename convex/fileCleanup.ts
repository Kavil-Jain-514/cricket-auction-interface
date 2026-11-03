// convex/fileCleanup.ts - What deleting a tournament leaves to do later:
// purge the safety snapshot and paid registrations after RETENTION_MS, then
// delete the tournament's files from Cloudinary.
//
// deleteTournament (one transaction) removes the rows and calls
// scheduleTournamentPurge, which records every file URL as "waiting". The
// daily purgeDueTournaments deletes the snapshot and kept registrations and
// makes those files "pending"; the hourly processDue deletes them in batches
// through the Cloudinary Admin API, keeping any file another tournament still
// shows, and retries with backoff up to MAX_ATTEMPTS before marking "failed".
// Every step is idempotent: re-running finds nothing left to do.
//
// findOrphans / deleteOrphans are the one-off tools for files left by
// deletions before this existed: a dry-run report first, then delete only
// the ids you approve (see RUNBOOK.md).

import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type MutationCtx,
} from "./_generated/server";
import { getCurrentUser } from "./auth";
import { isSuperAdmin } from "./policy";

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_SIZE = 100; // Cloudinary's limit per delete call
const MAX_ATTEMPTS = 8;
const RETRY_BASE_MS = 10 * 60 * 1000; // 10m, 20m, 40m … capped at a day
const RETRY_MAX_MS = 24 * 60 * 60 * 1000;
const STUCK_DELETING_MS = 15 * 60 * 1000;
// A file uploaded in the last day may belong to a form someone is still
// filling in, so the orphan tools never touch it.
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
const ROOT_FOLDER = "cricket-auction/";

const CLOUDINARY_URL = /https:\/\/res\.cloudinary\.com\/[^\s"'\\]+/g;

/** Tables whose rows can show a stored file. auditLogs and this queue don't count. */
const REFERENCING_TABLES = ["tournaments", "teams", "players", "registrations", "teamRequests", "snapshotChunks"] as const;
type ReferencingTable = (typeof REFERENCING_TABLES)[number];

/**
 * The Cloudinary public id of one of our stored images, or null for anything
 * else (another cloud or host, outside our folder, not an image upload).
 * Transformations and the version segment are dropped, as is the extension.
 */
export function cloudinaryPublicId(url: string, cloudName: string): string | null {
  const prefix = `https://res.cloudinary.com/${cloudName}/image/upload/`;
  if (!url.startsWith(prefix)) return null;
  const parts = url.slice(prefix.length).split(/[?#]/)[0].split("/");
  while (parts.length > 1 && (parts[0].includes(",") || /^[a-z]{1,2}_/.test(parts[0]))) parts.shift();
  if (parts.length > 1 && /^v\d+$/.test(parts[0])) parts.shift();
  const id = decodeURIComponent(parts.join("/")).replace(/\.[a-z0-9]+$/i, "");
  return id.startsWith(ROOT_FOLDER) ? id : null;
}

/** Every Cloudinary URL in a document, whatever field it sits in. */
function urlsIn(doc: unknown): string[] {
  return JSON.stringify(doc).match(CLOUDINARY_URL) ?? [];
}

/**
 * Record a deleted tournament's files and schedule its purge. Called by
 * deleteTournament inside its transaction, with every row it is deleting
 * (and the registrations it keeps until the purge).
 */
export async function scheduleTournamentPurge(
  ctx: MutationCtx,
  args: { tournament: Doc<"tournaments">; rows: unknown[]; userId: Id<"users"> },
): Promise<Id<"tournamentPurges">> {
  const now = Date.now();
  const purgeId = await ctx.db.insert("tournamentPurges", {
    tournamentId: args.tournament._id,
    tournamentName: args.tournament.name,
    purgeAt: now + RETENTION_MS,
    status: "scheduled",
    createdBy: args.userId,
    createdAt: now,
  });
  const urls = new Set([args.tournament, ...args.rows].flatMap(urlsIn));
  for (const url of urls) {
    const existing = await ctx.db
      .query("fileCleanup")
      .withIndex("by_url", (q) => q.eq("url", url))
      .first();
    // Already queued or gone: one row per file, ever.
    if (existing && existing.status !== "in_use") continue;
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("fileCleanup", { url, purgeId, status: "waiting", attempts: 0, nextAttemptAt: now + RETENTION_MS, createdAt: now });
  }
  return purgeId;
}

/**
 * Daily: purge tournaments deleted more than RETENTION_MS ago: their safety
 * snapshots and the registrations kept for refunds (registrationOrders, which
 * hold only the payment reference and amount, stay). Their files become due.
 */
export const purgeDueTournaments = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("tournamentPurges")
      .withIndex("by_status_purgeAt", (q) => q.eq("status", "scheduled").lte("purgeAt", now))
      .take(5);
    for (const purge of due) {
      const snapshots = await ctx.db
        .query("tournamentSnapshots")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", purge.tournamentId))
        .collect();
      for (const snapshot of snapshots) {
        const chunks = await ctx.db
          .query("snapshotChunks")
          .withIndex("by_snapshot", (q) => q.eq("snapshotId", snapshot._id))
          .collect();
        await Promise.all(chunks.map((c) => ctx.db.delete(c._id)));
        await ctx.db.delete(snapshot._id);
      }
      const kept = await ctx.db
        .query("registrations")
        .withIndex("by_tournament", (q) => q.eq("tournamentId", purge.tournamentId))
        .collect();
      await Promise.all(kept.map((r) => ctx.db.delete(r._id)));

      const files = await ctx.db
        .query("fileCleanup")
        .withIndex("by_purge", (q) => q.eq("purgeId", purge._id))
        .collect();
      await Promise.all(
        files.filter((f) => f.status === "waiting").map((f) => ctx.db.patch(f._id, { status: "pending", nextAttemptAt: now })),
      );
      await ctx.db.patch(purge._id, { status: "done", doneAt: now });
      console.log(`Purged deleted tournament "${purge.tournamentName}": ${snapshots.length} snapshots, ${kept.length} registrations, ${files.length} files due`);
    }
  },
});

/** Claim up to BATCH_SIZE due files (and any a crashed run left in "deleting"). */
export const claimDue = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const [due, stuck] = await Promise.all([
      ctx.db
        .query("fileCleanup")
        .withIndex("by_status_next", (q) => q.eq("status", "pending").lte("nextAttemptAt", now))
        .take(BATCH_SIZE),
      ctx.db
        .query("fileCleanup")
        .withIndex("by_status_next", (q) => q.eq("status", "deleting"))
        .take(BATCH_SIZE),
    ]);
    const claimed = [...due, ...stuck.filter((f) => (f.claimedAt ?? 0) < now - STUCK_DELETING_MS)].slice(0, BATCH_SIZE);
    await Promise.all(claimed.map((f) => ctx.db.patch(f._id, { status: "deleting", claimedAt: now })));
    return claimed.map((f) => ({ _id: f._id, url: f.url, attempts: f.attempts }));
  },
});

/** One page of a table's stored-file URLs (for the in-use check and the orphan report). */
export const referencedUrlsPage = internalQuery({
  args: { table: v.union(...REFERENCING_TABLES.map((t) => v.literal(t))), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query(args.table).paginate({ numItems: 500, cursor: args.cursor });
    return { urls: [...new Set(page.page.flatMap(urlsIn))], isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

/** Every stored-file URL any row still shows. */
async function allReferencedUrls(ctx: ActionCtx): Promise<Set<string>> {
  const urls = new Set<string>();
  for (const table of REFERENCING_TABLES) {
    let cursor: string | null = null;
    for (;;) {
      const page: { urls: string[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(
        internal.fileCleanup.referencedUrlsPage,
        { table: table as ReferencingTable, cursor },
      );
      page.urls.forEach((u) => urls.add(u));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
  }
  return urls;
}

export const recordResults = internalMutation({
  args: {
    results: v.array(
      v.object({
        id: v.id("fileCleanup"),
        outcome: v.union(v.literal("done"), v.literal("in_use"), v.literal("skipped"), v.literal("retry")),
        error: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    for (const r of args.results) {
      const row = await ctx.db.get(r.id);
      if (!row || row.status !== "deleting") continue;
      if (r.outcome !== "retry") {
        await ctx.db.patch(r.id, { status: r.outcome, doneAt: now, claimedAt: undefined, lastError: undefined });
        continue;
      }
      const attempts = row.attempts + 1;
      await ctx.db.patch(r.id, {
        status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
        attempts,
        nextAttemptAt: now + Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempts - 1)),
        claimedAt: undefined,
        lastError: r.error?.slice(0, 300),
      });
    }
  },
});

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME ?? process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  return cloudName && apiKey && apiSecret ? { cloudName, auth: `Basic ${btoa(`${apiKey}:${apiSecret}`)}` } : null;
}

/**
 * Delete up to 100 images by public id (Admin API). Returns each id's
 * outcome: "deleted" and "not_found" both mean gone.
 */
async function deleteFromCloudinary(
  config: { cloudName: string; auth: string },
  publicIds: string[],
): Promise<Record<string, string>> {
  const params = new URLSearchParams();
  publicIds.forEach((id) => params.append("public_ids[]", id));
  const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/resources/image/upload?${params}`, {
    method: "DELETE",
    headers: { Authorization: config.auth },
  });
  if (!res.ok) throw new Error(`Cloudinary ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { deleted?: Record<string, string> };
  return body.deleted ?? {};
}

type Claimed = { _id: Id<"fileCleanup">; url: string; attempts: number };

/** Hourly: delete due files, keeping any still shown elsewhere. Never throws. */
export const processDue = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const claimed: Claimed[] = await ctx.runMutation(internal.fileCleanup.claimDue, {});
    if (claimed.length === 0) return;
    const config = cloudinaryConfig();
    if (!config) {
      await ctx.runMutation(internal.fileCleanup.recordResults, {
        results: claimed.map((f) => ({ id: f._id, outcome: "retry" as const, error: "not_configured: set CLOUDINARY_* in the Convex env" })),
      });
      return;
    }

    const referenced = await allReferencedUrls(ctx);
    const results: Array<{ id: Id<"fileCleanup">; outcome: "done" | "in_use" | "skipped" | "retry"; error?: string }> = [];
    const toDelete = new Map<string, Id<"fileCleanup">[]>();
    for (const f of claimed) {
      const publicId = cloudinaryPublicId(f.url, config.cloudName);
      if (!publicId) results.push({ id: f._id, outcome: "skipped" });
      else if (referenced.has(f.url)) results.push({ id: f._id, outcome: "in_use" });
      else toDelete.set(publicId, [...(toDelete.get(publicId) ?? []), f._id]);
    }

    if (toDelete.size > 0) {
      try {
        const deleted = await deleteFromCloudinary(config, [...toDelete.keys()]);
        for (const [publicId, ids] of toDelete) {
          const outcome = deleted[publicId];
          const gone = outcome === undefined || outcome === "deleted" || outcome === "not_found";
          ids.forEach((id) => results.push(gone ? { id, outcome: "done" } : { id, outcome: "retry", error: `Cloudinary: ${outcome}` }));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`File cleanup: ${toDelete.size} files not deleted: ${message}`);
        for (const ids of toDelete.values()) ids.forEach((id) => results.push({ id, outcome: "retry", error: message }));
      }
    }
    await ctx.runMutation(internal.fileCleanup.recordResults, { results });
    console.log(`File cleanup: ${results.filter((r) => r.outcome === "done").length} deleted, ${results.filter((r) => r.outcome === "in_use").length} still in use, ${results.filter((r) => r.outcome === "retry").length} to retry`);
  },
});

/** Queue health for /admin/live (super-admin only; null for anyone else). */
export const stats = query({
  args: {},
  handler: async (ctx) => {
    if (!isSuperAdmin(await getCurrentUser(ctx))) return null;
    const count = async (status: Doc<"fileCleanup">["status"]) =>
      (await ctx.db.query("fileCleanup").withIndex("by_status_next", (q) => q.eq("status", status)).take(1000)).length;
    const failed = await ctx.db
      .query("fileCleanup")
      .withIndex("by_status_next", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(5);
    return {
      waiting: await count("waiting"),
      pending: await count("pending"),
      failed: await count("failed"),
      recentFailures: failed.map((f) => ({ url: f.url, lastError: f.lastError ?? "" })),
    };
  },
});

type CloudinaryResource = { public_id: string; created_at: string; bytes: number; secure_url: string };

/** Every image under our root folder (Admin API, paged). */
async function listStoredImages(config: { cloudName: string; auth: string }): Promise<CloudinaryResource[]> {
  const all: CloudinaryResource[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ prefix: ROOT_FOLDER, max_results: "500", type: "upload" });
    if (cursor) params.set("next_cursor", cursor);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/resources/image?${params}`, {
      headers: { Authorization: config.auth },
    });
    if (!res.ok) throw new Error(`Cloudinary ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { resources: CloudinaryResource[]; next_cursor?: string };
    all.push(...body.resources);
    cursor = body.next_cursor;
  } while (cursor);
  return all;
}

/** Stored images no row refers to, older than a day, and not already queued. */
async function findUnreferenced(
  ctx: ActionCtx,
  config: { cloudName: string; auth: string },
): Promise<{ stored: number; orphans: CloudinaryResource[] }> {
  const [stored, referenced, queued]: [CloudinaryResource[], Set<string>, string[]] = await Promise.all([
    listStoredImages(config),
    allReferencedUrls(ctx),
    ctx.runQuery(internal.fileCleanup.queuedPublicIdsPage, {}),
  ]);
  const referencedIds = new Set([...referenced].map((u) => cloudinaryPublicId(u, config.cloudName)).filter((id) => id !== null));
  const queuedIds = new Set(queued.map((u) => cloudinaryPublicId(u, config.cloudName)).filter((id) => id !== null));
  const cutoff = Date.now() - ORPHAN_MIN_AGE_MS;
  return {
    stored: stored.length,
    orphans: stored.filter(
      (r) => !referencedIds.has(r.public_id) && !queuedIds.has(r.public_id) && Date.parse(r.created_at) < cutoff,
    ),
  };
}

/** URLs already queued for deletion (not orphans: the worker owns them). */
export const queuedPublicIdsPage = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await Promise.all(
      (["waiting", "pending", "deleting", "failed"] as const).map((status) =>
        ctx.db.query("fileCleanup").withIndex("by_status_next", (q) => q.eq("status", status)).collect(),
      ),
    );
    return rows.flat().map((r) => r.url);
  },
});

/**
 * Dry run, deletes nothing: `npx convex run fileCleanup:findOrphans`. Lists
 * stored images (older than a day) that no tournament, team, player,
 * registration, team request or snapshot refers to.
 */
type OrphanReport = {
  stored: number;
  orphanCount: number;
  orphanBytes: number;
  orphans: Array<{ publicId: string; createdAt: string; bytes: number; url: string }>;
};

export const findOrphans = internalAction({
  args: {},
  handler: async (ctx): Promise<OrphanReport> => {
    const config = cloudinaryConfig();
    if (!config) throw new Error("Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in the Convex env");
    const { stored, orphans } = await findUnreferenced(ctx, config);
    return {
      stored,
      orphanCount: orphans.length,
      orphanBytes: orphans.reduce((n, r) => n + r.bytes, 0),
      orphans: orphans.map((r) => ({ publicId: r.public_id, createdAt: r.created_at, bytes: r.bytes, url: r.secure_url })),
    };
  },
});

/**
 * Delete approved orphans: pass the public ids from findOrphans' report.
 * Each is re-checked first; anything referenced again, newer than a day or
 * not in the report's set is left alone and listed under `kept`.
 */
export const deleteOrphans = internalAction({
  args: { publicIds: v.array(v.string()) },
  handler: async (ctx, args): Promise<{ deleted: string[]; kept: string[] }> => {
    const config = cloudinaryConfig();
    if (!config) throw new Error("Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET in the Convex env");
    const { orphans } = await findUnreferenced(ctx, config);
    const stillOrphans = new Set(orphans.map((r) => r.public_id));
    const approved = args.publicIds.filter((id) => stillOrphans.has(id));
    const kept = args.publicIds.filter((id) => !stillOrphans.has(id));
    const deleted: string[] = [];
    for (let i = 0; i < approved.length; i += BATCH_SIZE) {
      const result = await deleteFromCloudinary(config, approved.slice(i, i + BATCH_SIZE));
      deleted.push(...Object.entries(result).filter(([, o]) => o === "deleted" || o === "not_found").map(([id]) => id));
    }
    console.log(`Orphan cleanup: deleted ${deleted.length}, kept ${kept.length}`);
    return { deleted, kept };
  },
});
