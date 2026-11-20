// @vitest-environment node
import { describe, expect, test, vi } from "vitest";
import { renderToString } from "react-dom/server";

// The overlay must work as a bare OBS Browser Source: no Clerk provider, no
// session. Convex hooks are stubbed; Clerk is NOT mocked or provided, so any
// Clerk hook use would throw here.
const queryResults = new Map<string, unknown>();
const connection = { kind: "live" as "live" | "reconnecting" };
vi.mock("@/lib/useConnectionView", () => ({
  useConnectionView: () =>
    connection.kind === "live" ? { kind: "live" } : { kind: "reconnecting", secondsStale: 5, offerReload: false },
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    if (args === "skip") return undefined;
    return queryResults.get(String((ref as { _name?: string })?._name ?? ref));
  },
  useConvexAuth: () => {
    throw new Error("overlay must not read auth state");
  },
}));
vi.mock("@/convex/_generated/api", () => ({
  api: {
    auctions: {
      getLiveAuction: { _name: "getLiveAuction" },
      getAuctionRoster: { _name: "getAuctionRoster" },
      getLatestSaleEvent: { _name: "getLatestSaleEvent" },
    },
  },
}));

import { BroadcastOverlay } from "./BroadcastOverlay";
import { OverlayStage, TeamsPanel, type OverlayView } from "./OverlayStage";
import { OverlayResult } from "./OverlayResult";

const now = Date.now();
const live = {
  auctionRoom: {
    _id: "room1",
    tournamentId: "t1",
    status: "live",
    currentPlayerId: "p1",
    bidTimerEndsAt: now + 20_000,
  },
  currentBidAmount: 150_000,
  currentBidTeamId: "teamA",
  currentBidTeam: { _id: "teamA", name: "Mumbai Mavericks", colorPrimary: "#1d4ed8" },
  recentBids: [
    { _id: "b2", teamId: "teamA", amount: 150_000, timestamp: now },
    { _id: "b1", teamId: "teamB", amount: 125_000, timestamp: now - 1_000 },
  ],
  totalBidsCount: 2,
  serverTime: now,
};
const roster = {
  currentPlayer: { _id: "p1", name: "Virat Kohli", role: "Batter", basePrice: 100_000 },
  teams: [
    { _id: "teamA", name: "Mumbai Mavericks", colorPrimary: "#1d4ed8", purseRemaining: 850_000, purseSpent: 150_000, playerCount: 1 },
    { _id: "teamB", name: "Delhi Dynamos", colorPrimary: "#dc2626", purseRemaining: 1_000_000, purseSpent: 0, playerCount: 0 },
  ],
  tournament: {
    _id: "t1",
    name: "Test Cup",
    settings: { basePurse: 1_000_000, minBidIncrement: 25_000, maxPlayersPerTeam: 3, bidTimerSeconds: 30, footerText: "Hosted by Sunrise CC" },
  },
  soldPlayers: [],
  stats: { total: 10, pending: 8, sold: 1, unsold: 0, inAuction: 1 },
};

function setData() {
  queryResults.set("getLiveAuction", live);
  queryResults.set("getAuctionRoster", roster);
  queryResults.set("getLatestSaleEvent", null);
}

describe("BroadcastOverlay — no session", () => {
  test("mounts while data is loading", () => {
    queryResults.clear();
    const html = renderToString(
      <BroadcastOverlay roomId="room1" mode="lower-third" theme="dark" safe={false} />,
    );
    expect(html).toContain("data-broadcast-overlay");
  });

  test("mounts with live data: branding and footer, player held until the photo loads", () => {
    setData();
    const html = renderToString(
      <BroadcastOverlay roomId="room1" mode="lower-third" theme="dark" safe={false} />,
    );
    expect(html).toContain("Hosted by Sunrise CC");
    // Effects never run on the server, so the photo preload hasn't finished.
    expect(html).not.toContain("data-lower-third");
  });

  test("full mode keeps team purses behind the Teams button, not on screen", () => {
    setData();
    const html = renderToString(
      <BroadcastOverlay roomId="room1" mode="full" theme="light" safe />,
    );
    expect(html).toContain("data-teams-button");
    expect(html).not.toContain("data-teams-panel");
    expect(html).not.toContain("₹10.00L"); // Delhi's purse
  });
});

const stageView: OverlayView = {
  mode: "lower-third",
  theme: "dark",
  safe: false,
  tournament: { name: "Test Cup", footerText: "Hosted by Sunrise CC" },
  status: "live",
  player: { _id: "p1", name: "Virat Kohli", role: "Batter", playerNumber: 18, age: 36, battingBowlingHand: "Right-handed" },
  basePrice: 100_000,
  currentBid: 150_000,
  isFirstBid: false,
  leadingTeam: { name: "Mumbai Mavericks", colorPrimary: "#1d4ed8" },
  ticker: [
    { id: "b2", teamName: "Mumbai Mavericks", teamColor: "#1d4ed8", amount: 150_000 },
    { id: "b1", teamName: "Delhi Dynamos", teamColor: "#dc2626", amount: 125_000 },
  ],
  teams: [],
  countdown: { enabled: true, secondsLeft: 8, fraction: 0.27, tone: "amber", paused: false, expired: false },
};

const twoTeams = roster.teams;

describe("OverlayStage — layouts", () => {
  test("lower-third: player, base, bid, leading team, ticker, timer", () => {
    const html = renderToString(<OverlayStage {...stageView} />);
    expect(html).toContain("data-lower-third");
    expect(html).toContain("Virat Kohli");
    expect(html).toContain("Base ₹1.00L");
    expect(html).toContain("₹1.50L");
    expect(html).toContain("Delhi Dynamos");
    expect(html).toContain('role="timer"');
    expect(html).not.toContain("data-teams-button"); // no teams in this view
  });

  test("player number, hand and age show with the other details in both layouts", () => {
    for (const mode of ["lower-third", "full"] as const) {
      const html = renderToString(<OverlayStage {...stageView} mode={mode} />);
      expect(html).toContain("#<!-- -->18");
      expect(html).toContain("Right-handed");
      expect(html).toContain("36 yrs");
    }
  });

  test("full layout: large photo, no team strip, Teams button when there are teams", () => {
    const html = renderToString(<OverlayStage {...stageView} mode="full" teams={twoTeams} />);
    expect(html).toContain("data-full-layout");
    expect(html).toContain("w-180!");
    expect(html).toContain("data-teams-button");
    expect(html).not.toContain("Delhi Dynamos · "); // teams stay hidden until asked for
    expect(html).not.toContain("data-teams-panel");
  });

  test("teams panel: every team with players bought and purse left", () => {
    const html = renderToString(
      <TeamsPanel view={{ ...stageView, mode: "full", teams: twoTeams, maxPlayersPerTeam: 15 }} onClose={() => {}} />,
    );
    expect(html).toContain("data-teams-panel");
    expect(html).toContain("Test Cup · Teams");
    expect(html).toContain("Mumbai Mavericks");
    expect(html).toContain("Delhi Dynamos");
    expect(html).toContain("₹8.50L");
    expect(html).toContain("₹10.00L");
    expect(html).toContain("Spent ₹1.50L");
    expect(html).toContain(" / 15");
  });

  test("timer off hides the ring", () => {
    const html = renderToString(
      <OverlayStage {...stageView} countdown={{ ...stageView.countdown, enabled: false }} />,
    );
    expect(html).not.toContain('role="timer"');
  });
});

describe("BroadcastOverlay — connection (AUDIT 2026-10 P1-13)", () => {
  test("hides the card while disconnected instead of streaming a frozen price", () => {
    setData();
    connection.kind = "reconnecting";
    try {
      const html = renderToString(
        <BroadcastOverlay roomId="room1" mode="full" theme="dark" safe={false} />,
      );
      expect(html).toContain("data-broadcast-overlay");
      expect(html).not.toContain("data-teams-button");
      expect(html).not.toContain("Hosted by Sunrise CC");
    } finally {
      connection.kind = "live";
    }
  });
});

describe("OverlayResult — static SOLD / UNSOLD card", () => {
  test("sold: player, team and price, with no animation", () => {
    const html = renderToString(
      <OverlayResult sold playerName="Virat Kohli" teamName="Mumbai Mavericks" teamColor="#1d4ed8" amount={150_000} />,
    );
    expect(html).toContain("SOLD!");
    expect(html).toContain("Virat Kohli");
    expect(html).toContain("Mumbai Mavericks");
    expect(html).toContain("₹1.50L");
    expect(html).not.toMatch(/animate|transform/);
  });

  test("unsold: base price and no team", () => {
    const html = renderToString(
      <OverlayResult sold={false} playerName="Virat Kohli" teamName={null} amount={100_000} />,
    );
    expect(html).toContain("UNSOLD");
    expect(html).toContain("Base Price: ₹1.00L");
    expect(html).toContain("No bids received");
  });
});
