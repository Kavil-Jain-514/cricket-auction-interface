"use client";

// components/marketing/DesignPlayground.tsx - The interactive half of /design:
// live contrast ratios read from the rendered CSS, the price roll, the SOLD
// moment, and the dialog / sheet / select / toast primitives.
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ds/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ds/dialog";
import { Field, Input } from "@/components/ds/input";
import { PriceTicker } from "@/components/ds/price-ticker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ds/select";
import { AppToaster, toast } from "@/components/ds/toast";
import { AA_LARGE_OR_UI, AA_TEXT, contrastRatio } from "@/lib/design/contrast";
import { COLOR_ROLES } from "@/lib/design/tokens";

const TEXT_PAIRS = ["ink", "ink-muted", "signal", "sold", "unsold", "timer"];
const UI_PAIRS = ["line-strong", "focus"];

/** Swatches plus the ratio of each role against canvas, read from computed CSS. */
export function ContrastTable() {
  const ref = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!ref.current) return;
    const style = getComputedStyle(ref.current);
    setValues(
      Object.fromEntries(COLOR_ROLES.map(({ role }) => [role, style.getPropertyValue(`--fl-${role}`).trim()])),
    );
  }, []);

  return (
    <div ref={ref} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {COLOR_ROLES.map(({ role, use }) => {
        const hex = values[role];
        const isText = TEXT_PAIRS.includes(role);
        const isUi = UI_PAIRS.includes(role) || role === "signal";
        const ratio = hex && values.canvas && (isText || isUi) ? contrastRatio(hex, values.canvas) : null;
        const pass = ratio !== null && ratio >= (isText ? AA_TEXT : AA_LARGE_OR_UI);
        return (
          <div key={role} className="flex items-center gap-3 rounded-control border border-line bg-surface p-2">
            <span className="size-11 shrink-0 rounded-control border border-line" style={{ background: `var(--fl-${role})` }} />
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-sm text-ink">{role}</span>
              <span className="block truncate text-xs text-ink-muted">
                {use} · {hex || "…"}
              </span>
            </span>
            {ratio !== null && (
              <span className={`text-sm font-semibold tabular ${pass ? "text-sold" : "text-unsold"}`}>
                {ratio.toFixed(2)}:1
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const BIDS = [2000000, 2200000, 2400000, 2600000, 3000000, 3500000, 4000000, 4500000, 5000000, 9750000];

/** Price roll and SOLD stamp, driven by buttons. */
export function MotionDemo() {
  const [step, setStep] = useState(0);
  const [sold, setSold] = useState(false);

  return (
    <div className="flex flex-col gap-4 rounded-panel border border-line bg-surface p-6">
      <div aria-live="polite" className="flex min-h-28 items-center gap-6">
        <PriceTicker amount={BIDS[step]} className="text-7xl text-ink" />
        {sold && (
          <span className="animate-fl-sold rounded-control border-4 border-sold px-4 py-1 font-head text-5xl font-bold text-sold uppercase">
            Sold
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            setSold(false);
            setStep((s) => Math.min(s + 1, BIDS.length - 1));
          }}
        >
          Raise
        </Button>
        <Button variant="secondary" onClick={() => setSold(true)}>
          Sold!
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setSold(false);
            setStep(0);
          }}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

/** Dialog, sheet, select, input and toast in one place. */
export function PrimitivesDemo() {
  return (
    <div className="flex flex-col gap-6 rounded-panel border border-line bg-surface p-6">
      <AppToaster />
      <div className="flex flex-wrap gap-2">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Mark unsold</Button>
        <Button disabled>Disabled</Button>
        <Button size="lg">Raise to ₹24.00L</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Team name" htmlFor="ds-team" hint="2–40 characters">
          <Input id="ds-team" placeholder="Mumbai Mavericks" aria-describedby="ds-team-hint" />
        </Field>
        <Field label="Purse (₹)" htmlFor="ds-purse" error="Purse must be at least ₹1,00,000">
          <Input id="ds-purse" defaultValue="500" aria-invalid aria-describedby="ds-purse-error" />
        </Field>
        <div className="flex flex-col gap-1.5">
          <span id="ds-mode-label" className="text-sm font-medium text-ink">
            Who can bid
          </span>
          <Select defaultValue="confirm">
            <SelectTrigger aria-labelledby="ds-mode-label">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="admin_only">Auctioneer only</SelectItem>
              <SelectItem value="confirm">Owners raise, auctioneer confirms</SelectItem>
              <SelectItem value="open">Owners raise directly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogTitle>Mark player unsold?</DialogTitle>
            <DialogDescription>They go to the unsold pool and can come back in the next round.</DialogDescription>
            <div className="flex justify-end gap-2">
              <Button variant="ghost">Cancel</Button>
              <Button variant="danger">Mark unsold</Button>
            </div>
          </DialogContent>
        </Dialog>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="secondary">Open sheet</Button>
          </SheetTrigger>
          <SheetContent>
            <SheetTitle>Squads</SheetTitle>
            <SheetDescription>Bottom sheet for phones: safe-area aware, swipe handle, Escape to close.</SheetDescription>
          </SheetContent>
        </Sheet>
        <Button variant="secondary" onClick={() => toast.success("Sold to Mumbai Mavericks for ₹24.00L")}>
          Success toast
        </Button>
        <Button variant="secondary" onClick={() => toast.error("Above your max bid of ₹18.50L")}>
          Error toast
        </Button>
      </div>
    </div>
  );
}
