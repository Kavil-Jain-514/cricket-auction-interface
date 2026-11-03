import type { Metadata } from "next";
import Link from "next/link";

import { CtaBand } from "@/components/marketing/CtaBand";
import { PageIntro } from "@/components/marketing/PageIntro";
import { Screenshot } from "@/components/marketing/Screenshot";

export const metadata: Metadata = {
  title: "Broadcast Overlay for OBS and vMix Cricket Auction Streams",
  description:
    "Stream your cricket auction: Bid11Pro's transparent overlay drops into OBS or vMix as a browser source, with lower-third and full-screen layouts.",
  alternates: { canonical: "/broadcast" },
};

const STEPS = [
  "Open your auction and copy the overlay link from the broadcast menu.",
  "In OBS or vMix, add a Browser Source with that link at 1920×1080.",
  "Pick the lower-third or full-screen layout, dark or light, and turn on title-safe margins if your stream needs them.",
  "The overlay is transparent and updates live with every bid. It needs no sign-in on the streaming PC.",
];

export default function BroadcastPage() {
  return (
    <>
      <PageIntro
        path="/broadcast"
        crumb="Broadcast"
        title="Put your auction on the stream"
        lead="A transparent, live overlay for OBS and vMix. The player, the current bid and the leading team, over your camera feed."
      />
      <section className="mx-auto flex max-w-7xl flex-col gap-12 px-4 py-16 sm:px-6">
        <Screenshot name="overlay" />
        <div className="grid gap-8 lg:grid-cols-2">
          <div>
            <h2 className="font-head text-3xl font-bold tracking-wide uppercase">Set up in two minutes</h2>
            <ol className="mt-4 flex flex-col gap-3">
              {STEPS.map((s, i) => (
                <li key={s} className="flex gap-4">
                  <span className="font-head text-2xl font-bold text-signal tabular">{i + 1}</span>
                  <span className="text-ink-muted">{s}</span>
                </li>
              ))}
            </ol>
          </div>
          <div>
            <h2 className="font-head text-3xl font-bold tracking-wide uppercase">In the venue</h2>
            <p className="mt-4 text-ink-muted">
              No stream? The auction page itself is built for the venue projector: the player and the price are sized
              to read from the back of the hall. See <Link href="/features" className="text-signal hover:underline">all features</Link>.
            </p>
          </div>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
