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

    await ctx.db.patch(args.auctionRoomId, {
      status: "paused",
      updatedAt: Date.now(),
    });

    await ctx.db.insert("auctionEvents", {
      auctionRoomId: args.auctionRoomId,
      type: "auction_paused",
      data: {},
      timestamp: Date.now(),
    });

    return { success: true };
  },
});

// Resume the auction
export const resumeAuction = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status !== "paused") {
      throw new Error("Auction is not paused");
    }

    // If there's a current player, reset the timer
    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    const bidTimerEndsAt =
      auctionRoom.currentPlayerId && tournament
        ? Date.now() + (tournament.settings.bidTimerSeconds || 30) * 1000
        : undefined;

    await ctx.db.patch(args.auctionRoomId, {
      status: "live",
      bidTimerEndsAt,
      updatedAt: Date.now(),
    });

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
    // Get current auction state
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    if (auctionRoom.status !== "live") {
      throw new Error("Auction is not live");
    }

    if (!auctionRoom.currentPlayerId) {
      throw new Error("No player currently in auction");
    }

    // Validate team has enough purse
    const team = await ctx.db.get(args.teamId);
    if (!team) throw new Error("Team not found");

    if (team.purseRemaining < args.amount) {
      throw new Error("Insufficient purse balance");
    }

    // Validate bid amount
    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    const minBidIncrement = tournament.settings.minBidIncrement;
    const currentBid = auctionRoom.currentBidAmount || 0;

    if (args.amount < currentBid + minBidIncrement) {
      throw new Error(`Minimum bid is ₹${currentBid + minBidIncrement}`);
    }

    // Update auction room with new bid
    await ctx.db.patch(args.auctionRoomId, {
      currentBidAmount: args.amount,
      currentBidTeamId: args.teamId,
      bidTimerEndsAt: Date.now() + tournament.settings.bidTimerSeconds * 1000,
      updatedAt: Date.now(),
    });

    // Record bid in history
    await ctx.db.insert("bids", {
      auctionRoomId: args.auctionRoomId,
      playerId: auctionRoom.currentPlayerId,
      teamId: args.teamId,
      amount: args.amount,
      timestamp: Date.now(),
      isFinal: false,
    });

    // Create auction event
    await ctx.db.insert("auctionEvents", {
      auctionRoomId: args.auctionRoomId,
      type: "bid_placed",
      data: {
        teamId: args.teamId,
        playerId: auctionRoom.currentPlayerId,
        amount: args.amount,
      },
      timestamp: Date.now(),
    });

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

    const { currentPlayerId, currentBidTeamId, currentBidAmount } = auctionRoom;

    if (!currentPlayerId) throw new Error("No player in auction");

    // Player sold
    if (currentBidTeamId && currentBidAmount) {
      // Update player
      await ctx.db.patch(currentPlayerId, {
        teamId: currentBidTeamId,
        soldPrice: currentBidAmount,
        auctionStatus: "sold",
        updatedAt: Date.now(),
      });

      // Update team purse
      const team = await ctx.db.get(currentBidTeamId);
      if (team) {
        await ctx.db.patch(currentBidTeamId, {
          purseRemaining: team.purseRemaining - currentBidAmount,
          purseSpent: team.purseSpent + currentBidAmount,
          updatedAt: Date.now(),
        });
      }

      // Mark final bid
      const bids = await ctx.db
        .query("bids")
        .withIndex("by_player", (q) => q.eq("playerId", currentPlayerId))
        .order("desc")
        .take(1);

      if (bids.length > 0) {
        await ctx.db.patch(bids[0]._id, { isFinal: true });
      }

      // Create event
      await ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "player_sold",
        data: {
          playerId: currentPlayerId,
          teamId: currentBidTeamId,
          amount: currentBidAmount,
        },
        timestamp: Date.now(),
      });
    } else {
      // Player unsold
      await ctx.db.patch(currentPlayerId, {
        auctionStatus: "unsold",
        updatedAt: Date.now(),
      });

      await ctx.db.insert("auctionEvents", {
        auctionRoomId: args.auctionRoomId,
        type: "player_unsold",
        data: { playerId: currentPlayerId },
        timestamp: Date.now(),
      });
    }

    // Clear current player from auction room
    await ctx.db.patch(args.auctionRoomId, {
      currentPlayerId: undefined,
      currentBidAmount: undefined,
      currentBidTeamId: undefined,
      bidTimerEndsAt: undefined,
      updatedAt: Date.now(),
    });

    return { success: true };
  },
});

// Start auction for next player
export const startNextPlayer = mutation({
  args: {
    auctionRoomId: v.id("auctionRooms"),
  },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) throw new Error("Auction room not found");

    // Get next pending player
    const nextPlayer = await ctx.db
      .query("players")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", auctionRoom.tournamentId),
      )
      .filter((q) => q.eq(q.field("auctionStatus"), "pending"))
      .first();

    if (!nextPlayer) {
      // No more players - complete auction
      await ctx.db.patch(args.auctionRoomId, {
        status: "completed",
        updatedAt: Date.now(),
      });
      return { success: true, completed: true };
    }

    // Update player status
    await ctx.db.patch(nextPlayer._id, {
      auctionStatus: "in_auction",
      updatedAt: Date.now(),
    });

    // Get tournament settings
    const tournament = await ctx.db.get(auctionRoom.tournamentId);
    if (!tournament) throw new Error("Tournament not found");

    // Update auction room
    await ctx.db.patch(args.auctionRoomId, {
      currentPlayerId: nextPlayer._id,
      currentBidAmount: nextPlayer.basePrice,
      currentBidTeamId: undefined,
      bidTimerEndsAt: Date.now() + tournament.settings.bidTimerSeconds * 1000,
      updatedAt: Date.now(),
    });

    return { success: true, player: nextPlayer };
  },
});

// Query: Get live auction state
export const getLiveAuction = query({
  args: { auctionRoomId: v.id("auctionRooms") },
  handler: async (ctx, args) => {
    const auctionRoom = await ctx.db.get(args.auctionRoomId);
    if (!auctionRoom) return null;

    let currentPlayer = null;
    let currentBidTeam = null;

    if (auctionRoom.currentPlayerId) {
      currentPlayer = await ctx.db.get(auctionRoom.currentPlayerId);
    }

    if (auctionRoom.currentBidTeamId) {
      currentBidTeam = await ctx.db.get(auctionRoom.currentBidTeamId);
    }

    // Get all teams for this tournament
    const teams = await ctx.db
      .query("teams")
      .withIndex("by_tournament", (q) =>
        q.eq("tournamentId", auctionRoom.tournamentId),
      )
      .collect();

    // Get recent bids
    const recentBids = await ctx.db
      .query("bids")
      .withIndex("by_auction_room", (q) =>
        q.eq("auctionRoomId", args.auctionRoomId),
      )
      .order("desc")
      .take(10);

    return {
      auctionRoom,
      currentPlayer,
      currentBidTeam,
      teams,
      recentBids,
    };
  },
});
