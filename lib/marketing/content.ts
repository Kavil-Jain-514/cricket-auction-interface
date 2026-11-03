// lib/marketing/content.ts - Copy for the marketing pages and their JSON-LD.
// One source so the FAQ page and the FAQPage schema can never drift apart.
// Honest copy: every claim here maps to shipped code (see the comment on each).

export const SITE_URL = "https://bid11pro.kaviljain.com";
export const SITE_NAME = "Bid11Pro";

export interface MarketingPage {
  path: string;
  /** Breadcrumb and nav label. */
  label: string;
}

export const MARKETING_PAGES: MarketingPage[] = [
  { path: "/", label: "Home" },
  { path: "/features", label: "Features" },
  { path: "/how-it-works", label: "How it works" },
  { path: "/for-organisers", label: "For organisers" },
  { path: "/broadcast", label: "Broadcast" },
  { path: "/pricing", label: "Pricing" },
  { path: "/faq", label: "FAQ" },
];

export interface Feature {
  title: string;
  body: string;
}

export const FEATURES: Feature[] = [
  {
    // convex/bidCore.ts, tournaments.settings.bidMode
    title: "Owners bid from their phones",
    body: "Invite each team owner by link. Pick who may bid: only the auctioneer, owners with the auctioneer confirming each raise, or owners raising directly.",
  },
  {
    // convex/bidRules.ts reserve formula
    title: "Purses checked on the server",
    body: "Every bid is checked against the team's purse and the money it must keep back to fill the rest of its squad. A team can't bid itself into a corner.",
  },
  {
    // settings.categories, incrementSlabs, sets
    title: "Categories, sets and increments",
    body: "Group players into categories such as Marquee or Uncapped, each with its own base price. Present them set by set, with bid increments that step up as the price rises.",
  },
  {
    // settings.squadRules, convex/squadRules.ts
    title: "Squad rules",
    body: "Require a minimum or cap a maximum per category or role, for example at least one wicket keeper. Bids that would break a rule are refused.",
  },
  {
    // lib/bidTimer.ts (advisory)
    title: "A visible bid timer",
    body: "An on-screen countdown keeps the room moving. It is advisory: the auctioneer still decides when a player is sold.",
  },
  {
    // app/(app)/auction/[roomId]/overlay
    title: "Projector view and broadcast overlay",
    body: "A full-screen view for the venue projector, plus a transparent overlay for OBS or vMix in lower-third or full-screen layouts.",
  },
  {
    // components/players/PlayerImport.tsx, app/(app)/register
    title: "Player import and registration",
    body: "Import players from a spreadsheet, or open a public registration form, with an optional entry fee paid online through Razorpay.",
  },
  {
    // app/(app)/results, ExportResultsButton, lib/generateTeamPdf.ts
    title: "Results you can share",
    body: "A public results page for WhatsApp, an Excel export for the organiser and a squad PDF for each team.",
  },
  {
    // convex/staff.ts, auth.ts RUN_AUCTION
    title: "Staff roles",
    body: "Add co-organisers and auctioneers to a tournament. Each person only sees the tournaments they work on.",
  },
  {
    // convex/reconciliation
    title: "Totals that add up",
    body: "Purse and player counts are reconciled on the server, and the auctioneer sees at a glance that they match.",
  },
  {
    // components/groups, lib/groupDraw.ts
    title: "Group draw",
    body: "After the auction, draw teams into groups with an animated reveal for the room.",
  },
  {
    // lib/insights.ts
    title: "Squad insights for owners",
    body: "Owners get simple, rule-based notes on their own squad: gaps by role, purse left per open slot.",
  },
];

export interface Step {
  title: string;
  body: string;
}

export const HOW_IT_WORKS: Step[] = [
  { title: "Create the tournament", body: "Set the purse, squad size, categories, increments and squad rules." },
  { title: "Add teams and players", body: "Add team colours and logos, import players from a spreadsheet or open registration." },
  { title: "Invite owners", body: "Send each owner an invite link so they can follow, or bid, from their phone." },
  { title: "Run the auction", body: "Put the projector view on the big screen. Players come up set by set; bids land live." },
  { title: "Share the results", body: "Publish the results page, export to Excel and send each team its squad PDF." },
];

export interface Faq {
  question: string;
  answer: string;
}

export const FAQS: Faq[] = [
  {
    question: "What is Bid11Pro?",
    answer: "Bid11Pro is cricket auction software for running an IPL-style player auction for your own tournament: teams, purses, live bidding and a projector view in one place.",
  },
  {
    question: "Can team owners bid from their own phones?",
    answer: "Yes. Invite each owner by link. You choose whether only the auctioneer bids, owners raise and the auctioneer confirms, or owners raise directly.",
  },
  {
    question: "What stops a team overspending?",
    answer: "Every bid is checked on the server against the team's purse and the amount it must keep back to fill its remaining squad slots. A bid that breaks the rule is refused.",
  },
  {
    question: "Does the timer sell players automatically?",
    answer: "No. The bid timer is a visible countdown to keep the pace up. The auctioneer always confirms the sale.",
  },
  {
    question: "Can I show the auction on a projector or a live stream?",
    answer: "Yes. Open the auction page full screen on the venue projector, and add the broadcast overlay as a browser source in OBS or vMix.",
  },
  {
    question: "How much does it cost?",
    answer: "Pricing is per tournament. The Free plan covers 4 teams and 60 players; paid plans raise the team and player limits.",
  },
  {
    question: "Can players register themselves?",
    answer: "Yes. Open a public registration form for your tournament, with an optional entry fee paid online.",
  },
  {
    question: "Can I share the results after the auction?",
    answer: "Yes. Each completed tournament gets a public results page you can share on WhatsApp, plus an Excel export and a squad PDF per team.",
  },
];
