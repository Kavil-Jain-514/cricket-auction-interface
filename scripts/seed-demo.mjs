// scripts/seed-demo.mjs - Fictional demo tournaments for marketing screenshots
// (scripts/capture-screens.mjs). DEV DEPLOYMENT ONLY: runs public mutations
// through `npx convex run --identity` as a dedicated demo user, so every
// server rule applies exactly as in the app. No photos, no phone numbers.
//
//   node scripts/seed-demo.mjs [results|live]   (default: both)
//
// Creates:
//   "Coastal Premier League"        live room, a player mid-bidding, registration open
//   "Coastal Premier League 2025"   completed, for the public results page
// (fictional league; the description marks both as demo data)
// and prints ROOM_ID / RESULTS_ID / REGISTER_ID for capture-screens.mjs.
import { execFileSync } from "node:child_process";

if (process.argv.includes("--prod")) throw new Error("seed-demo is for the dev deployment only");

const IDENTITY = JSON.stringify({
  subject: "demo-marketing-seeder",
  issuer: "https://bid11pro.invalid",
  email: "demo-marketing@bid11pro.invalid",
  name: "Demo Organiser",
});

function run(fn, args = {}) {
  const out = execFileSync("npx", ["convex", "run", "--identity", IDENTITY, fn, JSON.stringify(args)], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  return out ? JSON.parse(out) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TEAMS = [
  { name: "Lakeside Lions", ownerName: "Demo Owner A", colorPrimary: "#f5b301", colorSecondary: "#1f2937" },
  { name: "Harbour Hawks", ownerName: "Demo Owner B", colorPrimary: "#1d4ed8", colorSecondary: "#f8fafc" },
  { name: "Old Town Tigers", ownerName: "Demo Owner C", colorPrimary: "#e11d48", colorSecondary: "#111827" },
  { name: "Riverside Royals", ownerName: "Demo Owner D", colorPrimary: "#7c3aed", colorSecondary: "#f5f3ff" },
];

// Fictional names.
const PLAYERS = [
  ["Rohan Mehra", ["All-Rounder"], "Right-handed"],
  ["Arjun Pillai", ["Batter"], "Left-handed"],
  ["Kabir Sethi", ["Bowler"], "Right-handed"],
  ["Dev Malhotra", ["Wicket Keeper", "Batter"], "Right-handed"],
  ["Ishaan Rao", ["Bowler"], "Left-handed"],
  ["Vihaan Desai", ["Batter"], "Right-handed"],
  ["Aditya Kale", ["All-Rounder"], "Right-handed"],
  ["Neel Bhatt", ["Bowler"], "Right-handed"],
  ["Samar Joshi", ["Batter"], "Left-handed"],
  ["Yash Kulkarni", ["All-Rounder"], "Right-handed"],
  ["Kunal Varma", ["Wicket Keeper"], "Right-handed"],
  ["Tanay Ghosh", ["Bowler"], "Left-handed"],
];

const SETTINGS = {
  basePurse: 10000000, // ₹1 Cr
  minBidIncrement: 100000, // ₹1 L
  maxPlayersPerTeam: 6,
  basePrice: 500000, // ₹5 L
  bidTimerSeconds: 0,
};

function seedTournament(name, settings, players) {
  const tournamentId = run("tournaments:create", {
    name,
    description: "Demo data for marketing screenshots (scripts/seed-demo.mjs)",
    settings: { ...SETTINGS, ...settings },
  });
  const teamIds = TEAMS.map((t) => run("teams:create", { tournamentId, ...t }));
  for (const [i, [pname, role, hand]] of players.entries()) {
    run("players:create", {
      tournamentId,
      name: pname,
      age: 21 + ((i * 3) % 12),
      role,
      battingBowlingHand: hand,
      basePrice: 500000,
      jerseyNumber: 7 + i * 4,
    });
  }
  const roomId = run("auctions:createAuctionRoom", { tournamentId, name: `${name} - Live Auction` });
  run("auctions:startAuction", { auctionRoomId: roomId });
  return { tournamentId, teamIds, roomId };
}

/** `pairs` rounds of rival-then-winner bids rising by the increment: the winner leads at the end. */
async function biddingWar(roomId, rival, winner, pairs) {
  let amount = 500000;
  for (let i = 0; i < pairs * 2; i++) {
    const result = run("auctions:placeBid", { auctionRoomId: roomId, teamId: i % 2 ? winner : rival, amount });
    if (result && result.success === false) throw new Error(`placeBid: ${result.reason}`);
    amount += 100000 * (i < 4 ? 1 : 2);
    await sleep(600); // same-team spacing is 500 ms
  }
}

/** Sells the next player to the team with the fewest players, so nobody bids with a full squad. */
async function sellNext(t, counts, pairs) {
  run("auctions:startNextPlayer", { auctionRoomId: t.roomId });
  const [winner, rival] = [...t.teamIds].sort((x, y) => counts[x] - counts[y]);
  await biddingWar(t.roomId, rival, winner, pairs);
  run("auctions:finalizePlayerSale", { auctionRoomId: t.roomId });
  counts[winner] += 1;
}

async function main() {
  run("auth:ensureUser");

  const only = process.argv[2];
  const ids = {};

  if (only !== "live") {
    // Completed tournament for the results page: 8 players, all sold, 2 per team.
    const done = seedTournament("Coastal Premier League 2025", { maxPlayersPerTeam: 3 }, PLAYERS.slice(0, 8));
    const doneCounts = Object.fromEntries(done.teamIds.map((id) => [id, 0]));
    for (let i = 0; i < 8; i++) await sellNext(done, doneCounts, 2 + (i % 4));
    run("auctions:startNextPlayer", { auctionRoomId: done.roomId }); // no players left: completes
    ids.RESULTS_ID = done.tournamentId;
  }

  if (only !== "results") {
    // Live tournament: five sold, the sixth mid-bidding, registration open.
    const live = seedTournament(
      "Coastal Premier League",
      { registrationOpen: true, registrationFee: 0 },
      PLAYERS,
    );
    const liveCounts = Object.fromEntries(live.teamIds.map((id) => [id, 0]));
    for (let i = 0; i < 5; i++) await sellNext(live, liveCounts, 2 + i);
    run("auctions:startNextPlayer", { auctionRoomId: live.roomId });
    await biddingWar(live.roomId, live.teamIds[2], live.teamIds[1], 3);
    ids.ROOM_ID = live.roomId;
    ids.REGISTER_ID = live.tournamentId;
  }

  console.log(Object.entries(ids).map(([k, v]) => `${k}=${v}`).join(" "));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
