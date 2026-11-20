// scripts/loadtest/registrations.mjs
// -----------------------------------------------------------------------------
// Player-registration rush: N people submit the public form (/register/<id>)
// at once, each over their own WebSocket like a separate phone.
//
// Every client does what the page does: subscribe to registrations:getPublicInfo,
// optionally fetch an upload signature (PHOTOS=1), then registrations:submit with
// a unique name + phone. No file is sent to Cloudinary: the photo URL is built
// from the signed public_id, which is all the server checks (the upload grant).
// WhatsApp consent is off, so no messages are queued.
//
// Measures submit latency p50/p95/p99, outcomes grouped by error message, and
// then verifies what was stored: row count, no duplicate phones.
//
// DEV DEPLOYMENT ONLY by default: it creates a throwaway tournament through
// `npx convex run --identity` (as scripts/seed-demo.mjs does) and deletes it at
// the end. Pass TOURNAMENT_ID to use an existing tournament with registration
// open instead (it is not deleted).
//
//   node scripts/loadtest/registrations.mjs                     # 200, all at once
//   N=200 RAMP_MS=60000 node scripts/loadtest/registrations.mjs # spread over 1 min
//   N=200 PHOTOS=1 node scripts/loadtest/registrations.mjs      # with photo grants
//   N=300 CONSENT=1 node scripts/loadtest/registrations.mjs     # WhatsApp consent on (see below)
//
// CONSENT=1 ticks the WhatsApp box, so every registration queues a message,
// and then waits for the outbox to drain. The numbers are made up but are
// valid Indian mobile formats, so it refuses to run unless the deployment
// sends nothing real: WHATSAPP_PROVIDER=log or WHATSAPP_NOTIFICATIONS_ENABLED=false.
//
// | Env          | Default | Meaning                                          |
// | N            | 200     | registrants                                      |
// | RAMP_MS      | 0       | spread the submits evenly over this window       |
// | PHOTOS       | off     | 1 = each registrant gets an upload signature     |
// | KEEP         | off     | 1 = don't delete the test tournament             |
// | TOURNAMENT_ID|         | use this tournament (registration open, fee 0)   |
// | CONSENT      | off     | 1 = WhatsApp consent on; needs a log provider    |
// -----------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { ConvexClient } from "convex/browser";
import { anyApi } from "convex/server";
import { summarize, sleep, fail } from "../../harness/lib.mjs";

const env = process.env;
const int = (name, dflt) => (env[name] === undefined ? dflt : Number(env[name]));
const cfg = {
  n: int("N", 200),
  rampMs: int("RAMP_MS", 0),
  photos: env.PHOTOS === "1",
  consent: env.CONSENT === "1",
  drainTimeoutMs: int("DRAIN_TIMEOUT_MS", 180_000),
  keep: env.KEEP === "1",
  tournamentId: env.TOURNAMENT_ID ?? null,
  out: env.OUT ?? `scripts/loadtest/report-registrations-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
};

const dotenv = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const url = env.CONVEX_URL || dotenv.NEXT_PUBLIC_CONVEX_URL;
const cloudName = dotenv.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
if (!url) fail("Set CONVEX_URL or NEXT_PUBLIC_CONVEX_URL in .env.local");
if (!Number.isInteger(cfg.n) || cfg.n < 1) fail(`N must be a whole number above 0, got ${env.N}`);
if (!Number.isFinite(cfg.rampMs) || cfg.rampMs < 0) fail(`RAMP_MS must be 0 or more, got ${env.RAMP_MS}`);
if (!cfg.tournamentId && !(dotenv.CONVEX_DEPLOYMENT ?? "").startsWith("dev:")) {
  fail("Without TOURNAMENT_ID this script creates and deletes data, so it only runs against a dev deployment");
}

/** A deployment env var's value ("" when unset), via the Convex CLI. */
function deploymentEnv(name) {
  try {
    return execFileSync("npx", ["convex", "env", "get", name], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}
if (cfg.consent) {
  const provider = deploymentEnv("WHATSAPP_PROVIDER");
  const enabled = deploymentEnv("WHATSAPP_NOTIFICATIONS_ENABLED");
  if (provider !== "log" && enabled !== "false") {
    fail(
      "CONSENT=1 would send real WhatsApp messages to made-up numbers. On the DEV deployment first run\n" +
        "  npx convex env set WHATSAPP_PROVIDER log\n" +
        "and afterwards\n  npx convex env remove WHATSAPP_PROVIDER",
    );
  }
}

const IDENTITY = JSON.stringify({
  subject: "loadtest-registrations",
  issuer: "https://bid11pro.invalid",
  email: "loadtest-registrations@bid11pro.invalid",
  name: "Load Test Organiser",
});
function run(fn, args = {}) {
  const out = execFileSync("npx", ["convex", "run", "--identity", IDENTITY, fn, JSON.stringify(args)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
  return out ? JSON.parse(out) : null;
}

const api = anyApi.registrations;
const ROLES = [["Batter"], ["Bowler"], ["All-Rounder"], ["Wicket Keeper"], ["Wicket Keeper", "Batter"]];

// ── setup ───────────────────────────────────────────────────────────────────
const tournamentName = `Load Test Registrations ${Date.now()}`;
let tournamentId = cfg.tournamentId;
if (!tournamentId) {
  run("auth:ensureUser");
  run("auth:setAccountType", { accountType: "organiser" });
  tournamentId = run("tournaments:create", {
    name: tournamentName,
    description: "Throwaway tournament for scripts/loadtest/registrations.mjs",
    settings: {
      basePurse: 10000000,
      minBidIncrement: 100000,
      maxPlayersPerTeam: 15,
      basePrice: 500000,
      bidTimerSeconds: 0,
      registrationOpen: true,
      registrationFee: 0,
    },
  });
  console.log(`Created test tournament ${tournamentId}`);
}

// ── registrants ─────────────────────────────────────────────────────────────
const latency = [];
const signatureLatency = [];
const outcomes = new Map(); // message -> count
const bump = (k) => outcomes.set(k, (outcomes.get(k) ?? 0) + 1);
const runTag = String(Date.now()).slice(-4);

async function registrant(i) {
  // Spread mode: each person arrives at their own moment, page load included.
  if (cfg.rampMs > 0) await sleep((cfg.rampMs * i) / cfg.n);
  const client = new ConvexClient(url, { unsavedChangesWarning: false });
  try {
    // The page loads the form first.
    const info = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("getPublicInfo timed out")), 30000);
      const unsub = client.onUpdate(api.getPublicInfo, { tournamentId }, (v) => {
        clearTimeout(t);
        unsub();
        resolve(v);
      });
    });
    if (!info?.open) throw new Error("Registration is not open");

    let photoUrl;
    if (cfg.photos) {
      const t0 = Date.now();
      const sig = await client.action(api.getUploadSignature, { tournamentId });
      signatureLatency.push(Date.now() - t0);
      photoUrl = `https://res.cloudinary.com/${cloudName ?? sig.cloudName}/image/upload/v${sig.timestamp}/${sig.folder}/${sig.public_id}.jpg`;
    }

    const t0 = Date.now();
    const res = await client.mutation(api.submit, {
      tournamentId,
      name: `Loadtest Player ${runTag}-${String(i).padStart(4, "0")}`,
      age: 18 + (i % 25),
      role: ROLES[i % ROLES.length],
      battingBowlingHand: i % 3 ? "Right-handed" : "Left-handed",
      phoneNumber: `9${runTag}${String(i).padStart(5, "0")}`,
      ...(photoUrl ? { photoUrl } : {}),
      consentWhatsApp: cfg.consent,
      deviceId: `loadtest-${runTag}-${String(i).padStart(5, "0")}`,
      website: "",
    });
    latency.push(Date.now() - t0);
    bump(res?.success ? "ok" : `refused: ${res?.reason ?? JSON.stringify(res)}`);
  } catch (err) {
    const msg = String(err?.data ?? err?.message ?? err).split("\n")[0].replace(/\[Request ID: \w+\] /, "");
    bump(`error: ${msg.slice(0, 160)}`);
  } finally {
    // Not awaited: close() on a socket whose handshake was refused never settles.
    client.close().catch(() => {});
  }
}

/** A registrant who gets no answer in REGISTRANT_TIMEOUT_MS counts as failed instead of hanging the run. */
const registrantTimeoutMs = int("REGISTRANT_TIMEOUT_MS", 120_000);
function registrantWithTimeout(i) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      bump(`error: no answer within ${registrantTimeoutMs} ms (socket never connected?)`);
      resolve();
    }, (cfg.rampMs * i) / cfg.n + registrantTimeoutMs);
  });
  return Promise.race([registrant(i), timeout]).finally(() => clearTimeout(timer));
}

console.log(
  `Submitting ${cfg.n} registrations ${cfg.rampMs ? `over ${cfg.rampMs} ms` : "at once"}` +
    `${cfg.photos ? " (with photo grants)" : ""} to ${url}`,
);
const started = Date.now();
const keepAlive = setInterval(() => {}, 1000); // a stuck socket must not let node exit mid-run
await Promise.all(Array.from({ length: cfg.n }, (_, i) => registrantWithTimeout(i)));
clearInterval(keepAlive);
const wallMs = Date.now() - started;

// ── consent: wait for the outbox to drain ───────────────────────────────────
let outbox = null;
if (cfg.consent) {
  const t0 = Date.now();
  let rowsNow = [];
  for (;;) {
    rowsNow = run("notifications:listForTournament", { tournamentId });
    const pending = rowsNow.filter((r) => r.status === "queued" || r.status === "sending").length;
    if ((rowsNow.length > 0 && pending === 0) || Date.now() - t0 > cfg.drainTimeoutMs) break;
    await sleep(3000);
  }
  const byStatus = {};
  for (const r of rowsNow) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  outbox = { rows: rowsNow.length, byStatus, drainMs: Date.now() - t0 };
}

// ── verify what was stored ──────────────────────────────────────────────────
const stored = run("registrations:list", { tournamentId });
const rows = (Array.isArray(stored) ? stored : stored?.registrations ?? []).filter((r) =>
  r.name?.startsWith(`Loadtest Player ${runTag}-`),
);
const phones = new Set(rows.map((r) => r.phoneNumber));
const ok = outcomes.get("ok") ?? 0;

const s = summarize(latency);
const report = {
  at: new Date().toISOString(),
  url,
  tournamentId,
  config: cfg,
  wallMs,
  submitLatencyMs: s,
  ...(cfg.photos ? { signatureLatencyMs: summarize(signatureLatency) } : {}),
  outcomes: Object.fromEntries(outcomes),
  stored: rows.length,
  duplicatePhones: rows.length - phones.size,
  ...(outbox ? { outbox } : {}),
};

console.log("\n── Registration load test ──");
console.log(`Wall time            ${wallMs} ms`);
console.log(`Submit latency (ms)  p50 ${s.p50}  p95 ${s.p95}  p99 ${s.p99}  max ${s.max}`);
if (cfg.photos) {
  const g = summarize(signatureLatency);
  console.log(`Signature (ms)       p50 ${g.p50}  p95 ${g.p95}  p99 ${g.p99}  max ${g.max}`);
}
console.log("Outcomes:");
for (const [k, c] of [...outcomes].sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(5)}  ${k}`);
console.log(`Stored rows          ${rows.length} (expected ${ok})`);
console.log(`Duplicate phones     ${report.duplicatePhones}`);
if (outbox) {
  console.log(`Outbox rows          ${outbox.rows} (expected ${ok})  ${JSON.stringify(outbox.byStatus)}`);
  console.log(`Outbox drained in    ${outbox.drainMs} ms after the last submit`);
}

writeFileSync(cfg.out, JSON.stringify(report, null, 2));
console.log(`Report: ${cfg.out}`);

// ── cleanup ─────────────────────────────────────────────────────────────────
if (!cfg.tournamentId && !cfg.keep) {
  run("tournaments:deleteTournament", { id: tournamentId, confirmName: tournamentName });
  console.log(`Deleted test tournament ${tournamentId}`);
}

const pass =
  ok === cfg.n &&
  rows.length === ok &&
  report.duplicatePhones === 0 &&
  (!outbox || (outbox.rows === ok && (outbox.byStatus.sent ?? 0) + (outbox.byStatus.skipped ?? 0) === ok));
console.log(pass ? "\nPASS" : "\nFAIL");
process.exit(pass ? 0 : 1);
