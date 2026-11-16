"use client";

import { useFeedback } from "./feedback";
import { Button } from "./ui";
import { useAction, useLoad } from "@/hooks/use-load";
import { api } from "@/lib/api";
import { money, plural } from "@/lib/format";
import type { BatchSummary, DemoInfo } from "@/lib/types";

const PROVIDER_LABEL: Record<string, string> = {
  synthetic: "simulated weather (synthetic provider)",
  "open-meteo": "real weather from Open-Meteo (ERA5 reanalysis)",
};

/** Explains the public demo and lets visitors settle the season or start over. */
export function DemoBanner({ onDataChanged }: { onDataChanged: () => void }) {
  const { toast } = useFeedback();
  const info = useLoad(() => api<DemoInfo>("/v1/demo"));
  const settle = useAction();
  const reset = useAction();
  const d = info.data;

  function settleSeason() {
    settle.run(async () => {
      const r = await api<BatchSummary>("/v1/contracts/evaluate-all", { method: "POST" });
      if (r.evaluated === 0) {
        toast("This season is already settled. Reset the demo to run it again.");
      } else {
        const payouts = r.payouts_raised
          ? `${plural(r.payouts_raised, "payout", "payouts")} raised, ${money(r.payout_total)} in total. Review them on Payouts.`
          : "no trigger was crossed, so no payouts are due.";
        toast(`Settled ${plural(r.evaluated, "policy", "policies")}: ${payouts}`);
      }
      if (r.errors.length) toast(`${plural(r.errors.length, "policy", "policies")} could not be settled: ${r.errors[0].error}`, true);
      onDataChanged();
    });
  }

  function resetDemo() {
    reset.run(async () => {
      await api<DemoInfo>("/v1/demo/reset", { method: "POST" });
      toast("Demo reset: fresh, unsettled policies loaded.");
      info.reload();
      onDataChanged();
    });
  }

  return (
    <section aria-label="About this demo" className="mb-5 rounded-xl border border-line bg-accent-soft px-4 py-3.5 text-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-ink">Live demo: a fictional microfinance bank in Kano State, Nigeria</p>
          <p className="mt-0.5 text-ink-2">
            {d ? (
              <>
                {d.policies} policies for the {d.season_year} season: maize farms covered for drought and poultry farms covered for heat stress,
                using {PROVIDER_LABEL[d.provider] ?? d.provider}. Settle the season to see which triggers were crossed and what each farmer is paid.
                {d.resets_every_hours ? ` Shared with other visitors; resets every ${d.resets_every_hours} hours.` : " Shared with other visitors."}
              </>
            ) : (
              "Fictional policies, real trigger engine. Settle the season to see which farmers get paid."
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="primary" busy={settle.busy} disabled={reset.busy} onClick={settleSeason}>
            {d ? `Settle the ${d.season_year} season` : "Settle the season"}
          </Button>
          <Button variant="ghost" busy={reset.busy} disabled={settle.busy} onClick={resetDemo}>
            Reset demo
          </Button>
        </div>
      </div>
    </section>
  );
}
