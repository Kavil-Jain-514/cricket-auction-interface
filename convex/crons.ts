// convex/crons.ts - Scheduled housekeeping.
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Idempotency keys only need to outlive a reconnect retry.
crons.daily("purge old console request ids", { hourUTC: 21, minuteUTC: 0 }, internal.idempotency.purgeOldRequests, {});

// Rate-limit windows only matter for a minute.
crons.daily("purge old rate-limit windows", { hourUTC: 21, minuteUTC: 10 }, internal.rateLimit.purgeOldWindows, {});

export default crons;
