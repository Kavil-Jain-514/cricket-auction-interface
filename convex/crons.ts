// convex/crons.ts - Scheduled housekeeping.
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Idempotency keys only need to outlive a reconnect retry.
crons.daily("purge old console request ids", { hourUTC: 21, minuteUTC: 0 }, internal.idempotency.purgeOldRequests, {});

// Rate-limit windows only matter for a minute.
crons.daily("purge old rate-limit windows", { hourUTC: 21, minuteUTC: 10 }, internal.rateLimit.purgeOldWindows, {});

// Live-ops panel history: 30 days of webhooks and client errors.
crons.daily("purge old ops records", { hourUTC: 21, minuteUTC: 20 }, internal.ops.purgeOld, {});

// Deleted tournaments: purge the snapshot and kept registrations once the
// retention period is over, then delete their files (convex/fileCleanup.ts).
crons.daily("purge deleted tournaments", { hourUTC: 21, minuteUTC: 30 }, internal.fileCleanup.purgeDueTournaments, {});
crons.hourly("delete stored files of deleted tournaments", { minuteUTC: 15 }, internal.fileCleanup.processDue, {});

export default crons;
