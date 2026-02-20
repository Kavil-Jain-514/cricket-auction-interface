// convex/auctions.ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin } from "./auth";

// Create a new auction room (Admin only)
export const createAuctionRoom = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireAdmin(ctx);

    const auctionRoomId = await ctx.db.insert("auctionRooms", {
      tournamentId: args.tournamentId,
      name: args.name,
      status: "waiting",
      createdBy: user._id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    return auctionRoomId;
  },
});

// Start the auction (Admin only)
export const startAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status === "live") {
      return { success: true, message: "Auction already live" };
    }

    if (auctionRoom.status === "completed") {
      throw new Error("Auction has already completed");
    }

    const now = Date.now();
    await Promise.all([
      ctx.db.patch(args.auctionRoomId, {
        status: "live",
        updatedAt: now,
      }),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "auction_started",
        data: {},
        timestamp: now,
      }),
    ]);

    return { success: true };
  },
});

// Pause the auction (Admin only)
export const pauseAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status === "paused") {
      return { success: true, alreadyPaused: true };
    }

    let remainingTime = 0;
    if (auctionRoom.bidTimerEndsAt) {
      remainingTime = Math.max(
        0,
        Math.ceil((auctionRoom.bidTimerEndsAt - Date.now()) / 1000),
      );
    }

    const now = Date.now();
    await Promise.all([
      ctx.db.patch(args.auctionRoomId, {
        status: "paused",
        pausedTimeRemaining: remainingTime,
        bidTimerEndsAt: undefined,
        updatedAt: now,
      }),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "auction_paused",
        data: { remainingTime },
        timestamp: now,
      }),
    ]);

    return { success: true, remainingTime };
  },
});

// Resume the auction (Admin only)
export const resumeAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status === "live") {
      return { success: true, alreadyLive: true };
    }

    if (auctionRoom.status !== "paused") {
      throw new Error("Auction is not paused");
    }

    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const now = Date.now();
    const timerDuration = auctionRoom.pausedTimeRemaining
      ? auctionRoom.pausedTimeRemaining * 1000
      : (tournament.settings.bidTimerSeconds || 30) * 1000;

    const updates: Record<string, unknown> = {
      status: "live",
      pausedTimeRemaining: undefined,
      updatedAt: now,
    };

    if (auctionRoom.currentPlayerId) {
      updates.bidTimerEndsAt = now + timerDuration;
    }

    await Promise.all([
      ctx.db.patch(args.auctionRoomId, updates),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "auction_resumed",
        data: {},
        timestamp: now,
      }),
    ]);

    return { success: true };
  },
});

// FAST BID - Only writes to liveBids table, NO auctionRoom update (Admin only)
export const placeBid = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
    teamId: v.id("teams"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    // Only admins can place bids
    await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status !== "live") {
      return { success: false, reason: "Auction is not live" };
    }

    if (!auctionRoom.currentPlayerId) {
      return { success: false, reason: "No player currently in auction" };
    }

    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found");

    if (team.purseRemaining < args.amount) {
      return { success: false, reason: "Insufficient purse balance" };
    }

    // Get latest bid using index (NO .collect())
    const latestBid = await ctx.db
      .query("liveBids")
      .withIndex("by_player", (q) =>
        q.eq("playerId", auctionRoom.currentPlayerId!),
      )
      .order("desc")
      .first();

    const [player, tournament, teamPlayers] = await Promise.all([
      ctx.db.get(auctionRoom.currentPlayerId),
      ctx.db.get(auctionRoom.tournamentId),
      ctx.db
        .query("players")
        .withIndex("by_team", (q) => q.eq("teamId", args.teamId))
        .collect(),
    ]);

    if (!player) throw new Error("Player not found");
    if (!tournament) throw new Error("Tournament not found");

    // Purse validation for squad completion
    // Formula: maxAllowedBid = remainingPurse - ((playersNeeded - 1) * basePrice)
    // This ensures the team can still complete their squad at minimum base prices
    const maxPlayersPerTeam = tournament.settings.maxPlayersPerTeam;
    const currentTeamPlayerCount = teamPlayers.length;
    const playersNeeded = maxPlayersPerTeam - currentTeamPlayerCount;

    // Get the minimum base price in the tournament for remaining calculations
    const pendingPlayers = await ctx.db
      .query("players")
      .withIndex("by_tournament_status", (q) =>
        q
          .eq("tournamentId", auctionRoom.tournamentId)
          .eq("auctionStatus", "pending"),
      )
      .collect();

    // Use the minimum base price among pending players, or the current player's base price as fallback
    const minBasePrice =
      pendingPlayers.length > 0
        ? Math.min(...pendingPlayers.map((p) => p.basePrice))
        : player.basePrice;

    // Calculate max allowed bid to ensure squad can be completed
    // If team needs more players after this one, reserve purse for them
    if (playersNeeded > 1) {
      const reserveForRemainingPlayers = (playersNeeded - 1) * minBasePrice;
      const maxAllowedBid = team.purseRemaining - reserveForRemainingPlayers;

      if (args.amount > maxAllowedBid) {
        return {
          success: false,
          reason: `Cannot bid this amount. Insufficient purse to complete squad. Max allowed: ₹${(maxAllowedBid / 100000).toFixed(2)}L`,
          maxAllowedBid,
        };
      }
    }

    const currentBid = latestBid?.amount || player.basePrice;
    const minBidIncrement = tournament.settings.minBidIncrement;

    if (!latestBid) {
      if (args.amount < player.basePrice) {
        return {
          success: false,
          reason: "First bid must be at least base price",
        };
      }
    } else {
      if (args.amount < currentBid + minBidIncrement) {
        return {
          success: false,
          reason: "Minimum bid is " + (currentBid + minBidIncrement),
        };
      }
    }

    const now = Date.now();
    const bidTimerSeconds = tournament.settings.bidTimerSeconds || 30;

    // Insert bid AND reset timer on every bid
    await Promise.all([
      ctx.db.insert("liveBids", {
        auctionRoomId: args.auctionRoomId,
        playerId: auctionRoom.currentPlayerId,
        teamId: args.teamId,
        amount: args.amount,
        timestamp: now,
      }),
      // Reset timer on every bid
      ctx.db.patch(args.auctionRoomId, {
        bidTimerEndsAt: now + bidTimerSeconds * 1000,
        updatedAt: now,
      }),
    ]);

    return { success: true, amount: args.amount, teamId: args.teamId };
  },
});

// Finalize player sale - handles SOLD/UNSOLD (Admin only)
export const finalizePlayerSale = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status !== "live") {
      return { success: false, reason: "Auction is not live" };
    }

    const currentPlayerId = auctionRoom.currentPlayerId;
    if (!currentPlayerId) {
      return { success: false, reason: "No player in auction" };
    }

    const winningBid = await ctx.db
      .query("liveBids")
      .withIndex("by_player", (q) => q.eq("playerId", currentPlayerId))
      .order("desc")
      .first();

    const player = await ctx.db.get(currentPlayerId);
    if (!player) throw new Error("Player not found");

    const now = Date.now();
    const result = {
      playerName: player.name,
      teamName: null as string | null,
      amount: winningBid?.amount || player.basePrice,
      sold: false,
    };

    if (winningBid) {
      // PLAYER SOLD
      const team = await ctx.db.get(winningBid.teamId);
      if (!team) throw new Error("Winning team not found");

      result.teamName = team.name;
      result.sold = true;

      const allLiveBids = await ctx.db
        .query("liveBids")
        .withIndex("by_player", (q) => q.eq("playerId", currentPlayerId))
        .collect();

      await Promise.all([
        ctx.db.patch(currentPlayerId, {
          teamId: winningBid.teamId,
          soldPrice: winningBid.amount,
          auctionStatus: "sold",
          updatedAt: now,
        }),
        ctx.db.patch(winningBid.teamId, {
          purseRemaining: team.purseRemaining - winningBid.amount,
          purseSpent: team.purseSpent + winningBid.amount,
          updatedAt: now,
        }),
        ctx.db.patch(args.auctionRoomId, {
          currentPlayerId: undefined,
          bidTimerEndsAt: undefined,
          updatedAt: now,
        }),
        ctx.db.insert("bids", {
          auctionRoomId: args.auctionRoomId,
          playerId: currentPlayerId,
          teamId: winningBid.teamId,
          amount: winningBid.amount,
          timestamp: winningBid.timestamp,
          isFinal: true,
        }),
        ctx.db.insert("auctionEvents", {
          auctionRoomId: args.auctionRoomId,
          type: "player_sold",
          data: {
            playerId: currentPlayerId,
            teamId: winningBid.teamId,
            amount: winningBid.amount,
            playerName: player.name,
            teamName: team.name,
          },
          timestamp: now,
        }),
        ...allLiveBids.map((bid) => ctx.db.delete(bid._id)),
      ]);
    } else {
      // PLAYER UNSOLD
      await Promise.all([
        ctx.db.patch(currentPlayerId, {
          auctionStatus: "unsold",
          updatedAt: now,
        }),
        ctx.db.patch(args.auctionRoomId, {
          currentPlayerId: undefined,
          bidTimerEndsAt: undefined,
          updatedAt: now,
        }),
        ctx.db.insert("auctionEvents", {
          auctionRoomId: args.auctionRoomId,
          type: "player_unsold",
          data: { playerId: currentPlayerId, playerName: player.name },
          timestamp: now,
        }),
      ]);
    }

    return { ...result, success: true };
  },
});

// Start auction for next player (Admin only)
export const startNextPlayer = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status !== "live") {
      throw new Error("Auction must be live to get next player");
    }

    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Get all pending players and pick randomly
    const pendingPlayers = await ctx.db
      .query("players")
      .withIndex("by_tournament_status", (q) =>
        q
          .eq("tournamentId", auctionRoom.tournamentId)
          .eq("auctionStatus", "pending"),
      )
      .collect();

    let nextPlayer = null;

    if (pendingPlayers.length > 0) {
      // Shuffle and pick a random player from pending
      const randomIndex = Math.floor(Math.random() * pendingPlayers.length);
      nextPlayer = pendingPlayers[randomIndex];
    } else {
      // No pending players, check for unsold players (second round)
      const unsoldPlayers = await ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q
            .eq("tournamentId", auctionRoom.tournamentId)
            .eq("auctionStatus", "unsold"),
        )
        .collect();

      if (unsoldPlayers.length > 0) {
        // Shuffle and pick a random player from unsold
        const randomIndex = Math.floor(Math.random() * unsoldPlayers.length);
        nextPlayer = unsoldPlayers[randomIndex];
      }
    }

    if (!nextPlayer) {
      // No pending or unsold players - auction complete
      const now = Date.now();
      await Promise.all([
        ctx.db.patch(args.auctionRoomId, {
          status: "completed",
          updatedAt: now,
        }),
        ctx.db.patch(auctionRoom.tournamentId, {
          status: "completed",
          updatedAt: now,
        }),
      ]);
      return { success: true, completed: true };
    }

    const bidTimerSeconds = tournament.settings.bidTimerSeconds || 30;
    const now = Date.now();

    await Promise.all([
      ctx.db.patch(nextPlayer._id, {
        auctionStatus: "in_auction",
        updatedAt: now,
      }),
      ctx.db.patch(args.auctionRoomId, {
        currentPlayerId: nextPlayer._id,
        bidTimerEndsAt: now + bidTimerSeconds * 1000,
        updatedAt: now,
      }),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "player_started",
        data: {
          playerId: nextPlayer._id,
          playerName: nextPlayer.name,
          basePrice: nextPlayer.basePrice,
        },
        timestamp: now,
      }),
    ]);

    return { success: true, player: nextPlayer };
  },
});

// Revert last bid (Admin only)
export const revertLastBid = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (!auctionRoom.currentPlayerId) {
      throw new Error("No player currently in auction");
    }

    const latestBid = await ctx.db
      .query("liveBids")
      .withIndex("by_player", (q) =>
        q.eq("playerId", auctionRoom.currentPlayerId!),
      )
      .order("desc")
      .first();

    if (!latestBid) {
      throw new Error("No bids to revert");
    }

    await ctx.db.delete(latestBid._id);
    return { success: true };
  },
});

// Restart auction for current player only - clears all bids and resets timer
export const restartCurrentPlayer = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (!auctionRoom.currentPlayerId) {
      throw new Error("No player currently in auction");
    }

    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Delete all bids for the current player
    const allBids = await ctx.db
      .query("liveBids")
      .withIndex("by_player", (q) =>
        q.eq("playerId", auctionRoom.currentPlayerId!),
      )
      .collect();

    const now = Date.now();
    const bidTimerSeconds = tournament.settings.bidTimerSeconds || 30;

    // Delete all bids and reset the timer
    await Promise.all([
      ...allBids.map((bid) => ctx.db.delete(bid._id)),
      ctx.db.patch(args.auctionRoomId, {
        currentBidAmount: undefined,
        currentBidTeamId: undefined,
        bidTimerEndsAt: now + bidTimerSeconds * 1000,
        updatedAt: now,
      }),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "player_restarted",
        data: { playerId: auctionRoom.currentPlayerId },
        timestamp: now,
      }),
    ]);

    return { success: true };
  },
});

// Get live auction state
export const getLiveAuction = query({
  args: { auctionRoomId: v.id("auctionRooms") },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) return null;

    const [currentPlayer, teams, tournament] = await Promise.all([
      auctionRoom.currentPlayerId
        ? ctx.db.get(auctionRoom.currentPlayerId)
        : null,
      ctx.db
        .query("teams")
        .withIndex("by_tournament", (q) =>
          q.eq("tournamentId", auctionRoom.tournamentId),
        )
        .collect(),
      ctx.db.get(auctionRoom.tournamentId),
    ]);

    let currentBid = null;
    let currentBidTeam = null;
    let recentBids: Array<{
      _id: string;
      teamId: string;
      amount: number;
      timestamp: number;
    }> = [];
    let totalBidsCount = 0;

    if (auctionRoom.currentPlayerId) {
      // Get all bids to count them
      const allBids = await ctx.db
        .query("liveBids")
        .withIndex("by_player", (q) =>
          q.eq("playerId", auctionRoom.currentPlayerId!),
        )
        .collect();

      totalBidsCount = allBids.length;

      // Get recent bids (sorted by desc, take 10 for display)
      const bids = allBids
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, 10);

      if (bids.length > 0) {
        currentBid = bids[0];
        currentBidTeam = await ctx.db.get(currentBid.teamId);
      }

      recentBids = bids.map((b) => ({
        _id: b._id,
        teamId: b.teamId,
        amount: b.amount,
        timestamp: b.timestamp,
      }));
    }

    const [pendingPlayers, soldPlayers, unsoldPlayers] = await Promise.all([
      ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q
            .eq("tournamentId", auctionRoom.tournamentId)
            .eq("auctionStatus", "pending"),
        )
        .collect(),
      ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q
            .eq("tournamentId", auctionRoom.tournamentId)
            .eq("auctionStatus", "sold"),
        )
        .collect(),
      ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q
            .eq("tournamentId", auctionRoom.tournamentId)
            .eq("auctionStatus", "unsold"),
        )
        .collect(),
    ]);

    // Calculate maxAllowedBid for each team based on squad completion requirements
    const maxPlayersPerTeam = tournament?.settings.maxPlayersPerTeam || 15;
    const minBasePrice =
      pendingPlayers.length > 0
        ? Math.min(...pendingPlayers.map((p) => p.basePrice))
        : currentPlayer?.basePrice || 100000;

    // Get player counts per team and calculate max allowed bids
    const teamsWithMaxBid = await Promise.all(
      teams.map(async (team) => {
        const teamPlayers = await ctx.db
          .query("players")
          .withIndex("by_team", (q) => q.eq("teamId", team._id))
          .collect();

        const currentTeamPlayerCount = teamPlayers.length;
        const playersNeeded = maxPlayersPerTeam - currentTeamPlayerCount;

        // Calculate max allowed bid
        let maxAllowedBid = team.purseRemaining;
        if (playersNeeded > 1) {
          const reserveForRemainingPlayers = (playersNeeded - 1) * minBasePrice;
          maxAllowedBid = team.purseRemaining - reserveForRemainingPlayers;
        }

        return {
          ...team,
          playerCount: currentTeamPlayerCount,
          playersNeeded,
          maxAllowedBid: Math.max(0, maxAllowedBid),
        };
      }),
    );

    return {
      auctionRoom: {
        ...auctionRoom,
        currentBidAmount: currentBid?.amount || currentPlayer?.basePrice,
        currentBidTeamId: currentBid?.teamId,
      },
      currentPlayer,
      currentBidTeam,
      teams: teamsWithMaxBid,
      recentBids,
      totalBidsCount,
      tournament,
      soldPlayers,
      minBasePrice,
      stats: {
        total:
          pendingPlayers.length +
          soldPlayers.length +
          unsoldPlayers.length +
          (currentPlayer ? 1 : 0),
        pending: pendingPlayers.length,
        sold: soldPlayers.length,
        unsold: unsoldPlayers.length,
        inAuction: currentPlayer ? 1 : 0,
      },
    };
  },
});

// Get auction rooms for a tournament
export const getAuctionRooms = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("auctionRooms")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();
  },
});

// Check if auction is active (live or paused) for a tournament
export const isAuctionActive = query({
  args: { tournamentId: v.id("tournaments") },
  handler: async (ctx, args) => {
    const auctionRooms = await ctx.db
      .query("auctionRooms")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", args.tournamentId),
      )
      .collect();

    // Check if any auction room is live or paused
    const activeRoom = auctionRooms.find(
      (room) => room.status === "live" || room.status === "paused",
    );

    return {
      isActive: !!activeRoom,
      status: activeRoom?.status || null,
      auctionRoomId: activeRoom?._id || null,
    };
  },
});

// Restart auction - reset all players, teams, and auction state (Admin only)
export const restartAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const now = Date.now();
    const basePurse = tournament.settings.basePurse;

    // Get all related data
    const [players, teams, liveBids, bids, events] = await Promise.all([
      ctx.db
        .query("players")
        .withIndex("by_tournament", (q) =>
          q.eq("tournamentId", auctionRoom.tournamentId),
        )
        .collect(),
      ctx.db
        .query("teams")
        .withIndex("by_tournament", (q) =>
          q.eq("tournamentId", auctionRoom.tournamentId),
        )
        .collect(),
      ctx.db
        .query("liveBids")
        .withIndex("by_room", (q) => q.eq("auctionRoomId", args.auctionRoomId))
        .collect(),
      ctx.db
        .query("bids")
        .withIndex("by_auction_room", (q) =>
          q.eq("auctionRoomId", args.auctionRoomId),
        )
        .collect(),
      ctx.db
        .query("auctionEvents")
        .withIndex("by_auction_room", (q) =>
          q.eq("auctionRoomId", args.auctionRoomId),
        )
        .collect(),
    ]);

    // Reset everything in parallel
    await Promise.all([
      // Reset auction room
      ctx.db.patch(args.auctionRoomId, {
        status: "waiting",
        currentPlayerId: undefined,
        currentBidAmount: undefined,
        currentBidTeamId: undefined,
        bidTimerEndsAt: undefined,
        pausedTimeRemaining: undefined,
        updatedAt: now,
      }),
      // Reset tournament status
      ctx.db.patch(auctionRoom.tournamentId, {
        status: "setup",
        updatedAt: now,
      }),
      // Reset all players
      ...players.map((player) =>
        ctx.db.patch(player._id, {
          auctionStatus: "pending",
          soldPrice: undefined,
          teamId: undefined,
          updatedAt: now,
        }),
      ),
      // Reset all team purses
      ...teams.map((team) =>
        ctx.db.patch(team._id, {
          purseRemaining: basePurse,
          purseSpent: 0,
          updatedAt: now,
        }),
      ),
      // Delete all live bids
      ...liveBids.map((bid) => ctx.db.delete(bid._id)),
      // Delete all permanent bids
      ...bids.map((bid) => ctx.db.delete(bid._id)),
      // Delete all auction events
      ...events.map((event) => ctx.db.delete(event._id)),
    ]);

    return { success: true, message: "Auction has been reset" };
  },
});
