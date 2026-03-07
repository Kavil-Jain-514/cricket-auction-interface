// convex/auctions.ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, logAdminAction } from "./auth";

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
      // Ensure tournament status is 'active' so viewers can access the auction
      ctx.db.patch(auctionRoom.tournamentId, {
        status: "active",
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
    const admin = await requireAdmin(ctx);

    if (args.amount <= 0) {
      return { success: false, reason: "Bid amount must be positive" };
    }

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status !== "live") {
      return { success: false, reason: "Auction is not live" };
    }

    if (!auctionRoom.currentPlayerId) {
      return { success: false, reason: "No player currently in auction" };
    }

    // Timer-expiry guard: reject bids that arrive after the server deadline
    if (auctionRoom.bidTimerEndsAt && Date.now() > auctionRoom.bidTimerEndsAt) {
      return { success: false, reason: "Bidding time has expired" };
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

    // Bid rate limiting: reject if same team bid < 500ms ago (prevents spam)
    if (latestBid && latestBid.teamId === args.teamId && Date.now() - latestBid.timestamp < 500) {
      return { success: false, reason: "Please wait before bidding again" };
    }

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

    // Use tournament base price as the minimum for squad completion calculations.
    // This is a conservative estimate that avoids scanning all pending players on every bid.
    const tournamentBasePrice = tournament.settings.basePrice ?? 100000;
    const minBasePrice = player.basePrice ?? tournamentBasePrice;

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

    const playerBasePrice = player.basePrice ?? tournamentBasePrice;
    const currentBid = latestBid?.amount || playerBasePrice;
    const minBidIncrement = tournament.settings.minBidIncrement;

    if (!latestBid) {
      if (args.amount < playerBasePrice) {
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
      logAdminAction(ctx, {
        userId: admin._id,
        userEmail: admin.email,
        action: "place_bid",
        targetType: "auction",
        targetId: args.auctionRoomId,
        newData: {
          playerId: auctionRoom.currentPlayerId,
          teamId: args.teamId,
          amount: args.amount,
        },
        tournamentId: auctionRoom.tournamentId,
        auctionRoomId: args.auctionRoomId,
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
    const admin = await requireAdmin(ctx);

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
    
    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");
    
    const playerBasePrice = player.basePrice ?? tournament.settings.basePrice ?? 100000;

    const now = Date.now();
    const result = {
      playerName: player.name,
      teamName: null as string | null,
      amount: winningBid?.amount || playerBasePrice,
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

    await logAdminAction(ctx, {
      userId: admin._id,
      userEmail: admin.email,
      action: result.sold ? "player_sold" : "player_unsold",
      targetType: "player",
      targetId: currentPlayerId,
      newData: {
        playerName: result.playerName,
        teamName: result.teamName,
        amount: result.amount,
        sold: result.sold,
      },
      tournamentId: auctionRoom.tournamentId,
      auctionRoomId: args.auctionRoomId,
    });

    return { ...result, success: true };
  },
});

// Start auction for next player (Admin only)
export const startNextPlayer = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status !== "live") {
      throw new Error("Auction must be live to get next player");
    }

    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Check if all teams have filled their squads
    const maxPlayersPerTeam = tournament.settings.maxPlayersPerTeam;
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) => q.eq("tournamentId", auctionRoom.tournamentId))
      .collect();

    if (teams.length > 0) {
      const soldPlayers = await ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q.eq("tournamentId", auctionRoom.tournamentId).eq("auctionStatus", "sold")
        )
        .collect();

      // Build O(n) count map instead of O(n*m) nested filter
      const soldCountByTeam = new Map<string, number>();
      for (const p of soldPlayers) {
        if (p.teamId) {
          soldCountByTeam.set(p.teamId, (soldCountByTeam.get(p.teamId) ?? 0) + 1);
        }
      }

      const allSquadsFull = teams.every(
        (team) => (soldCountByTeam.get(team._id) ?? 0) >= maxPlayersPerTeam,
      );

      if (allSquadsFull) {
        const now = Date.now();
        await Promise.all([
          ctx.db.patch(args.auctionRoomId, {
            status: "completed",
            currentPlayerId: undefined,
            bidTimerEndsAt: undefined,
            updatedAt: now,
          }),
          ctx.db.patch(auctionRoom.tournamentId, {
            status: "completed",
            updatedAt: now,
          }),
        ]);
        return { success: true, completed: true };
      }
    }

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
          basePrice: nextPlayer.basePrice ?? tournament.settings.basePrice ?? 100000,
        },
        timestamp: now,
      }),
      logAdminAction(ctx, {
        userId: admin._id,
        userEmail: admin.email,
        action: "start_next_player",
        targetType: "player",
        targetId: nextPlayer._id,
        newData: {
          playerName: nextPlayer.name,
          basePrice: nextPlayer.basePrice ?? tournament.settings.basePrice ?? 100000,
        },
        tournamentId: auctionRoom.tournamentId,
        auctionRoomId: args.auctionRoomId,
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
      // Single collect + in-memory slice: eliminates the second count-only round-trip.
      const allLiveBids = await ctx.db
        .query("liveBids")
        .withIndex("by_player", (q) =>
          q.eq("playerId", auctionRoom.currentPlayerId!),
        )
        .order("desc")
        .collect();

      totalBidsCount = allLiveBids.length;
      const bids = allLiveBids.slice(0, 10);

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

    // Single query for all players, partitioned in memory.
    const allPlayers = await ctx.db
      .query("players")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", auctionRoom.tournamentId),
      )
      .collect();

    const pendingPlayers = allPlayers.filter((p) => p.auctionStatus === "pending");
    // Trim sold players to only the fields needed by the client (complete screen + purse map).
    const soldPlayers = allPlayers
      .filter((p) => p.auctionStatus === "sold")
      .map((p) => ({
        _id: p._id,
        name: p.name,
        role: p.role,
        soldPrice: p.soldPrice,
        teamId: p.teamId,
      }));
    const unsoldPlayers = allPlayers.filter((p) => p.auctionStatus === "unsold");

    // Calculate maxAllowedBid for each team based on squad completion requirements
    const maxPlayersPerTeam = tournament?.settings.maxPlayersPerTeam || 15;
    const tournamentBasePrice = tournament?.settings.basePrice ?? 100000;
    const minBasePrice =
      pendingPlayers.length > 0
        ? Math.min(...pendingPlayers.map((p) => p.basePrice ?? tournamentBasePrice))
        : (currentPlayer ? (currentPlayer.basePrice ?? tournamentBasePrice) : 100000);

    // Build team player counts from soldPlayers already fetched above — avoids N+1 per-team queries
    const teamPlayerCounts = new Map<string, number>();
    for (const p of soldPlayers) {
      if (p.teamId) {
        teamPlayerCounts.set(p.teamId, (teamPlayerCounts.get(p.teamId) || 0) + 1);
      }
    }

    // Calculate max allowed bids without extra DB queries
    const teamsWithMaxBid = teams.map((team) => {
      const currentTeamPlayerCount = teamPlayerCounts.get(team._id) || 0;
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
    });

    return {
      auctionRoom: {
        ...auctionRoom,
        currentBidAmount: currentBid?.amount || (currentPlayer ? (currentPlayer.basePrice ?? tournamentBasePrice) : undefined),
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
      // Server timestamp for client clock-skew correction
      serverTime: Date.now(),
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

    // Helper: run an array of promises in sequential chunks to avoid
    // exceeding Convex's per-mutation parallel write limit (~1000 ops).
    async function runInChunks<T>(ops: Promise<T>[], chunkSize = 200): Promise<void> {
      for (let i = 0; i < ops.length; i += chunkSize) {
        await Promise.all(ops.slice(i, i + chunkSize));
      }
    }

    // Reset the room and tournament first (fast, always-two ops).
    await Promise.all([
      ctx.db.patch(args.auctionRoomId, {
        status: "waiting",
        currentPlayerId: undefined,
        bidTimerEndsAt: undefined,
        pausedTimeRemaining: undefined,
        updatedAt: now,
      }),
      ctx.db.patch(auctionRoom.tournamentId, {
        status: "active",
        updatedAt: now,
      }),
    ]);

    // Reset players, teams, and delete records in bounded batches.
    await runInChunks(
      players.map((player) =>
        ctx.db.patch(player._id, {
          auctionStatus: "pending",
          soldPrice: undefined,
          teamId: undefined,
          updatedAt: now,
        }),
      ),
    );

    await runInChunks(
      teams.map((team) =>
        ctx.db.patch(team._id, {
          purseRemaining: basePurse,
          purseSpent: 0,
          updatedAt: now,
        }),
      ),
    );

    await runInChunks([
      ...liveBids.map((bid) => ctx.db.delete(bid._id)),
      ...bids.map((bid) => ctx.db.delete(bid._id)),
      ...events.map((event) => ctx.db.delete(event._id)),
    ]);

    return { success: true, message: "Auction has been reset" };
  },
});
