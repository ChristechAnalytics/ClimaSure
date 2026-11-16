import { num } from "@/lib/format";
import { PERILS } from "@/lib/perils";
import type { TriggerResult, TriggerSpec } from "@/lib/types";

/** Horizontal gauge: hatched zone = where the policy pays, blue fill = where the index is now. */
export function Meter({ spec, result }: { spec: TriggerSpec; result: TriggerResult | null }) {
  const p = PERILS[spec.peril];
  const idx = result?.index_value ?? null;
  const max = p.lowerWorse ? Math.max(spec.trigger * 1.5, idx ?? 0) : Math.max(spec.exit * 1.15, idx ?? 0);
  const pct = (v: number) => Math.max(0, Math.min(100, (v / max) * 100));
  const zone = p.lowerWorse ? { left: 0, width: `${pct(spec.trigger)}%` } : { left: `${pct(spec.trigger)}%`, right: 0 };

  return (
    <div className="relative mt-7 mb-8 h-2.5 rounded-full bg-surface-2" aria-hidden="true">
      <div
        className="absolute inset-y-0 bg-zone"
        style={{ ...zone, backgroundImage: "repeating-linear-gradient(45deg, transparent 0 4px, rgb(208 59 59 / 0.14) 4px 6px)" }}
      />
      {idx !== null && <div className="absolute inset-y-0.5 left-0.5 rounded-full bg-series" style={{ width: `calc(${pct(idx)}% - 4px)` }} />}
      <div className="absolute -inset-y-1.5 w-0.5 bg-ink-2" style={{ left: `${pct(spec.trigger)}%` }}>
        <span className="absolute bottom-5 left-1/2 -translate-x-1/2 text-[11px] whitespace-nowrap text-ink-2">Trigger {num(spec.trigger, 1)}</span>
      </div>
      <div className="absolute -inset-y-1.5 w-0.5 bg-ink-2" style={{ left: `${pct(spec.exit)}%` }}>
        <span className="absolute top-5 left-1/2 -translate-x-1/2 text-[11px] whitespace-nowrap text-ink-2">Exit {num(spec.exit, 1)}</span>
      </div>
    </div>
  );
}
