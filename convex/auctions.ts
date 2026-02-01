// convex/auctions.ts
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// Create a new auction room
export const createAuctionRoom = mutation({
  args: {
    tournamentId: v.id("tournaments"),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not authenticated");

    // Find user
    const user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", identity.email!))
      .first();

    if (!user) throw new Error("User not found");

    // Create auction room
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

// Start the auction (set status to live)
export const startAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status === "live") {
      return { success: true, message: "Auction already live" };
    }

    if (auctionRoom.status === "completed") {
      throw new Error("Auction has already completed");
    }

    await ctx.db.patch(args.auctionRoomId, {
      status: "live",
      updatedAt: Date.now(),
    });

    // Create auction started event
    await ctx.db.insert("auctionEvents", {
      auctionRoomId: args.auctionRoomId,
      type: "auction_started",
      data: {},
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

// Pause the auction
export const pauseAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    // Quick return if already paused
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

    // Single patch + event insert in parallel
    await Promise.all([
      ctx.db.patch(args.auctionRoomId, {
        status: "paused",
        updatedAt: Date.now(),
        pausedTimeRemaining: remainingTime,
        bidTimerEndsAt: undefined,
      }),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "auction_paused",
        data: { remainingTime },
        timestamp: Date.now(),
      }),
    ]);

    return { success: true, remainingTime };
  },
});

// Resume the auction
export const resumeAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    // Fetch both in parallel
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    // Quick return if already live
    if (auctionRoom.status === "live") {
      return { success: true, alreadyLive: true };
    }

    if (auctionRoom.status !== "paused") {
      throw new Error("Auction is not paused");
    }

    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const now = Date.now();
    // Use remaining time if available, otherwise full timer
    const timerDuration = auctionRoom.pausedTimeRemaining
      ? auctionRoom.pausedTimeRemaining * 1000
      : tournament.settings.bidTimerSeconds * 1000;

    const updates: Record<string, unknown> = {
      status: "live",
      updatedAt: now,
      pausedTimeRemaining: undefined,
    };

    if (auctionRoom.currentPlayerId) {
      updates.bidTimerEndsAt = now + timerDuration;
    }

    await ctx.db.patch(args.auctionRoomId, updates);

    return { success: true };
  },
});

// Place a bid in the auction
export const placeBid = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
    teamId: v.id("teams"),
    amount: v.number(),
  },
  handler: async (ctx, args) => {
    // Fetch auction room and team in parallel for better performance
    const [auctionRoom, team] = await Promise.all([
      ctx.db.get(args.auctionRoomId),
      ctx.db.get(args.teamId),
    ]);

    if (!auctionRoom) throw new Error("Auction room not found");
    if (!team) throw new Error("Team not found");

    if (auctionRoom.status !== "live") {
      return { success: false, reason: "Auction is not live" };
    }

    if (!auctionRoom.currentPlayerId) {
      return { success: false, reason: "No player currently in auction" };
    }

    // Quick purse check before fetching more data
    if (team.purseRemaining < args.amount) {
      return { success: false, reason: "Insufficient purse balance" };
    }

    // Fetch player and tournament in parallel (only if we passed initial checks)
    const [player, tournament] = await Promise.all([
      ctx.db.get(auctionRoom.currentPlayerId),
      ctx.db.get(auctionRoom.tournamentId),
    ]);

    if (!player) throw new Error("Player not found");
    if (!tournament) throw new Error("Tournament not found");

    const minBidIncrement = tournament.settings.minBidIncrement;
    const currentBid = auctionRoom.currentBidAmount || player.basePrice || 0;

    // Validate bid amount
    if (currentBid === 0 || currentBid === player.basePrice) {
      if (args.amount < player.basePrice) {
        return {
          success: false,
          reason: `First bid must be at least base price: ₹${player.basePrice}`,
        };
      }
    } else {
      if (args.amount < currentBid) {
        return {
          success: false,
          reason: `Bid must be at least the current bid ₹${currentBid}`,
        };
      }

      if (
        args.amount > currentBid &&
        args.amount < currentBid + minBidIncrement
      ) {
        return {
          success: false,
          reason: `Minimum increase is ₹${minBidIncrement} (next valid: ₹${currentBid + minBidIncrement})`,
        };
      }
    }

    const now = Date.now();
    const timerDuration = tournament.settings.bidTimerSeconds * 1000;

    // Execute all writes in parallel
    await Promise.all([
      ctx.db.patch(args.auctionRoomId, {
        currentBidAmount: args.amount,
        currentBidTeamId: args.teamId,
        bidTimerEndsAt: now + timerDuration,
        updatedAt: now,
      }),
      ctx.db.insert("bids", {
        auctionRoomId: args.auctionRoomId,
        playerId: auctionRoom.currentPlayerId,
        teamId: args.teamId,
        amount: args.amount,
        timestamp: now,
        isFinal: false,
      }),
      ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "bid_placed",
        data: {
          teamId: args.teamId,
          playerId: auctionRoom.currentPlayerId,
          amount: args.amount,
        },
        timestamp: now,
      }),
    ]);

    return { success: true };
  },
});

// Finalize player sale
export const finalizePlayerSale = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    // Allow finalize only when auction is live
    if (auctionRoom.status !== "live") {
      return { success: false, reason: "Auction is not live" };
    }

    const { currentPlayerId, currentBidTeamId, currentBidAmount } = auctionRoom;

    if (!currentPlayerId) {
      return { success: false, reason: "No player in auction" };
    }

    // Fetch player and team in parallel if sold
    const [player, team] = await Promise.all([
      ctx.db.get(currentPlayerId),
      currentBidTeamId ? ctx.db.get(currentBidTeamId) : null,
    ]);

    if (!player) throw new Error("Player not found");

    const now = Date.now();
    const result = {
      playerName: player.name,
      teamName: null as string | null,
      amount: currentBidAmount || 0,
      sold: false,
    };

    // Player sold
    if (currentBidTeamId && currentBidAmount && team) {
      result.teamName = team.name;
      result.sold = true;

      // Get final bid for marking
      const bids = await ctx.db
        .query("bids")
        .withIndex("by_player", (q) => q.eq("playerId", currentPlayerId))
        .order("desc")
        .take(1);

      // Batch all writes together for sold player
      const writes: Promise<unknown>[] = [
        ctx.db.patch(currentPlayerId, {
          teamId: currentBidTeamId,
          soldPrice: currentBidAmount,
          auctionStatus: "sold",
          updatedAt: now,
        }),
        ctx.db.patch(currentBidTeamId, {
          purseRemaining: team.purseRemaining - currentBidAmount,
          purseSpent: team.purseSpent + currentBidAmount,
          updatedAt: now,
        }),
        ctx.db.patch(args.auctionRoomId, {
          currentPlayerId: undefined,
          currentBidAmount: undefined,
          currentBidTeamId: undefined,
          bidTimerEndsAt: undefined,
          updatedAt: now,
        }),
        ctx.db.insert("auctionEvents", {
          auctionRoomId: args.auctionRoomId,
          type: "player_sold",
          data: {
            playerId: currentPlayerId,
            teamId: currentBidTeamId,
            amount: currentBidAmount,
          },
          timestamp: now,
        }),
      ];

      if (bids.length > 0) {
        writes.push(ctx.db.patch(bids[0]._id, { isFinal: true }));
      }

      await Promise.all(writes);
    } else {
      // Player unsold - batch writes
      await Promise.all([
        ctx.db.patch(currentPlayerId, {
          auctionStatus: "unsold",
          updatedAt: now,
        }),
        ctx.db.patch(args.auctionRoomId, {
          currentPlayerId: undefined,
          currentBidAmount: undefined,
          currentBidTeamId: undefined,
          bidTimerEndsAt: undefined,
          updatedAt: now,
        }),
        ctx.db.insert("auctionEvents", {
          auctionRoomId: args.auctionRoomId,
          type: "player_unsold",
          data: { playerId: currentPlayerId },
          timestamp: now,
        }),
      ]);
    }

    return { ...result, success: true };
  },
});

// Start auction for next player
export const startNextPlayer = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    // Fetch auction room and tournament in parallel
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    // Check if auction is live
    if (auctionRoom.status !== "live") {
      throw new Error("Auction must be live to get next player");
    }

    // Get tournament settings early (needed for timer)
    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Use compound index for efficient pending player lookup
    let pendingPlayers = await ctx.db
      .query("players")
      .withIndex("by_tournament_status", (q) =>
        q
          .eq("tournamentId", auctionRoom.tournamentId)
          .eq("auctionStatus", "pending"),
      )
      .collect();

    // If no pending players, check for unsold players (second chance)
    if (pendingPlayers.length === 0) {
      pendingPlayers = await ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q
            .eq("tournamentId", auctionRoom.tournamentId)
            .eq("auctionStatus", "unsold"),
        )
        .collect();
    }

    // Also check for stuck in_auction players (edge case recovery)
    if (pendingPlayers.length === 0) {
      pendingPlayers = await ctx.db
        .query("players")
        .withIndex("by_tournament_status", (q) =>
          q
            .eq("tournamentId", auctionRoom.tournamentId)
            .eq("auctionStatus", "in_auction"),
        )
        .collect();
    }

    if (pendingPlayers.length === 0) {
      // No more players - complete auction (batch the updates)
      await Promise.all([
        ctx.db.patch(args.auctionRoomId, {
          status: "completed",
          updatedAt: Date.now(),
        }),
        ctx.db.patch(auctionRoom.tournamentId, {
          status: "completed",
          updatedAt: Date.now(),
        }),
      ]);

      return { success: true, completed: true };
    }

    // Pick a random player from the list
    const randomIndex = Math.floor(Math.random() * pendingPlayers.length);
    const nextPlayer = pendingPlayers[randomIndex];

    const bidTimerSeconds = tournament.settings.bidTimerSeconds || 30;
    const now = Date.now();

    // Batch player and room updates together
    await Promise.all([
      ctx.db.patch(nextPlayer._id, {
        auctionStatus: "in_auction",
        updatedAt: now,
      }),
      ctx.db.patch(args.auctionRoomId, {
        currentPlayerId: nextPlayer._id,
        currentBidAmount: nextPlayer.basePrice,
        currentBidTeamId: undefined,
        bidTimerEndsAt: now + bidTimerSeconds * 1000,
        updatedAt: now,
      }),
    ]);

    return {
      success: true,
      player: nextPlayer,
      remainingPlayers: pendingPlayers.length - 1,
    };
  },
});

// Revert last bid
export const revertLastBid = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (!auctionRoom.currentPlayerId) {
      throw new Error("No player currently in auction");
    }

    // Fetch tournament and player in parallel while getting bids
    const [bids, tournament, player] = await Promise.all([
      ctx.db
        .query("bids")
        .withIndex("by_player", (q) =>
          q.eq("playerId", auctionRoom.currentPlayerId!),
        )
        .order("desc")
        .take(2), // Only need last 2 bids
      ctx.db.get(auctionRoom.tournamentId),
      ctx.db.get(auctionRoom.currentPlayerId),
    ]);

    if (bids.length === 0) {
      throw new Error("No bids to revert");
    }

    if (!tournament) throw new Error("Tournament not found");
    if (!player) throw new Error("Player not found");

    const now = Date.now();
    const newTimerEnd = now + tournament.settings.bidTimerSeconds * 1000;

    // Delete last bid and update room in parallel
    if (bids.length > 1) {
      const previousBid = bids[1];
      await Promise.all([
        ctx.db.delete(bids[0]._id),
        ctx.db.patch(args.auctionRoomId, {
          currentBidAmount: previousBid.amount,
          currentBidTeamId: previousBid.teamId,
          bidTimerEndsAt: newTimerEnd,
          updatedAt: now,
        }),
      ]);
    } else {
      // No previous bids, reset to base price
      await Promise.all([
        ctx.db.delete(bids[0]._id),
        ctx.db.patch(args.auctionRoomId, {
          currentBidAmount: player.basePrice,
          currentBidTeamId: undefined,
          bidTimerEndsAt: newTimerEnd,
          updatedAt: now,
        }),
      ]);
    }

    return { success: true };
  },
});

// Query: Get live auction state
export const getLiveAuction = query({
  args: { auctionRoomId: v.id("auctionRooms") },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) return null;

    const [currentPlayer, currentBidTeam, teams, tournament, allPlayers] =
      await Promise.all([
        auctionRoom.currentPlayerId
          ? ctx.db.get(auctionRoom.currentPlayerId)
          : null,
        auctionRoom.currentBidTeamId
          ? ctx.db.get(auctionRoom.currentBidTeamId)
          : null,
        ctx.db
          .query("teams")
          .withIndex("by_tournament", (q) =>
            q.eq("tournamentId", auctionRoom.tournamentId),
          )
          .collect(),
        ctx.db.get(auctionRoom.tournamentId),
        ctx.db
          .query("players")
          .withIndex("by_tournament", (q) =>
            q.eq("tournamentId", auctionRoom.tournamentId),
          )
          .collect(),
      ]);

    // Get recent bids
    let recentBids = [];
    if (auctionRoom.currentPlayerId) {
      recentBids = await ctx.db
        .query("bids")
        .withIndex("by_player", (q) =>
          q.eq("playerId", auctionRoom.currentPlayerId!),
        )
        .order("desc")
        .take(10);
    }

    const pendingCount = allPlayers.filter(
      (p) => p.auctionStatus === "pending",
    ).length;
    const soldPlayers = allPlayers.filter((p) => p.auctionStatus === "sold");
    const soldCount = soldPlayers.length;
    const unsoldCount = allPlayers.filter(
      (p) => p.auctionStatus === "unsold" || p.auctionStatus === "unsold-twice",
    ).length;
    const inAuctionCount = allPlayers.filter(
      (p) => p.auctionStatus === "in_auction",
    ).length;

    return {
      auctionRoom,
      currentPlayer,
      currentBidTeam,
      teams,
      recentBids,
      tournament,
      soldPlayers, // Include sold players for auction summary
      stats: {
        total: allPlayers.length,
        pending: pendingCount,
        sold: soldCount,
        unsold: unsoldCount,
        inAuction: inAuctionCount,
      },
    };
  },
});

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
