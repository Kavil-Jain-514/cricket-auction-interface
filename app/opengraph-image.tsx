import { OG_SIZE, ogCard } from "@/lib/og/card";

// Default share card for every page that doesn't set its own.
export const alt = "Bid11Pro - cricket auction software";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function Image() {
  return ogCard({
    eyebrow: "Cricket auction software",
    title: "Run your player auction like the IPL",
    detail: "Live bidding · Server-checked purses · Projector view",
  });
}
