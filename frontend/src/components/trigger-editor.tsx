"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PERILS } from "@/lib/perils";
import type { Peril, TriggerSpec } from "@/lib/types";
import { useAction } from "@/hooks/use-load";
import { useFeedback } from "./feedback";
import { Button, Field } from "./ui";

/** Form state for one trigger (inputs hold strings until submit). */
export interface TriggerDraft {
  key: number;
  label: string;
  peril: Peril;
  window_start: string;
  window_end: string;
  trigger: string;
  exit: string;
  share: string;
  rolling_days: string;
  heat_threshold_c: string;
  dry_day_mm: string;
}

let nextKey = 1;
const str = (v: unknown, fallback: string) => (v === undefined || v === null ? fallback : String(v));

export function draftFrom(t: Partial<TriggerSpec> = {}): TriggerDraft {
  return {
    key: nextKey++,
    label: t.label ?? "",
    peril: t.peril ?? "drought",
    window_start: t.window_start ?? "",
    window_end: t.window_end ?? "",
    trigger: str(t.trigger, ""),
    exit: str(t.exit, ""),
    share: str(t.share, "1"),
    rolling_days: str(t.rolling_days, "3"),
    heat_threshold_c: str(t.heat_threshold_c, "38"),
    dry_day_mm: str(t.dry_day_mm, "1"),
  };
}

export function toSpec(d: TriggerDraft): TriggerSpec {
  const t: TriggerSpec = {
    peril: d.peril,
    window_start: d.window_start,
    window_end: d.window_end,
    trigger: Number(d.trigger),
    exit: Number(d.exit),
    share: Number(d.share || 1),
  };
  if (d.label.trim()) t.label = d.label.trim();
  if (d.peril === "excess_rain") t.rolling_days = Number(d.rolling_days);
  if (d.peril === "heat") t.heat_threshold_c = Number(d.heat_threshold_c);
  if (d.peril === "dry_spell") t.dry_day_mm = Number(d.dry_day_mm);
  return t;
}

function hint(d: TriggerDraft) {
  const p = PERILS[d.peril];
  const tr = d.trigger || "the trigger";
  const ex = d.exit || "the exit";
  return p.lowerWorse
    ? `Pays when ${p.index.toLowerCase()} is below ${tr} ${p.unit}, reaching 100% at ${ex} ${p.unit}. Exit must be lower than trigger.`
    : `Pays when ${p.index.toLowerCase()} goes above ${tr} ${p.unit}, reaching 100% at ${ex} ${p.unit}. Exit must be higher than trigger.`;
}

export function TriggerEditor({ value, onChange }: { value: TriggerDraft[]; onChange: (v: TriggerDraft[]) => void }) {
  const { toast } = useFeedback();
  const set = (key: number, patch: Partial<TriggerDraft>) => onChange(value.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  return (
    <div>
      <div className="flex flex-col gap-2.5">
        {value.map((d) => (
          <div key={d.key} className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] items-end gap-2.5">
              <Field label="Label">
                <input className="input" value={d.label} placeholder="e.g. Season rainfall" onChange={(e) => set(d.key, { label: e.target.value })} />
              </Field>
              <Field label="Peril">
                <select className="input" value={d.peril} onChange={(e) => set(d.key, { peril: e.target.value as Peril })}>
                  {Object.entries(PERILS).map(([k, p]) => (
                    <option key={k} value={k}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Window start">
                <input className="input" type="date" required value={d.window_start} onChange={(e) => set(d.key, { window_start: e.target.value })} />
              </Field>
              <Field label="Window end">
                <input className="input" type="date" required value={d.window_end} onChange={(e) => set(d.key, { window_end: e.target.value })} />
              </Field>
              <Field label={`Trigger (${PERILS[d.peril].unit})`}>
                <input className="input" type="number" step="any" required value={d.trigger} onChange={(e) => set(d.key, { trigger: e.target.value })} />
              </Field>
              <Field label={`Exit, 100% (${PERILS[d.peril].unit})`}>
                <input className="input" type="number" step="any" required value={d.exit} onChange={(e) => set(d.key, { exit: e.target.value })} />
              </Field>
              <Field label="Share of cover">
                <input className="input" type="number" step="0.05" min="0.05" max="1" value={d.share} onChange={(e) => set(d.key, { share: e.target.value })} />
              </Field>
              {d.peril === "excess_rain" && (
                <Field label="Rolling days">
                  <input className="input" type="number" min="1" max="30" value={d.rolling_days} onChange={(e) => set(d.key, { rolling_days: e.target.value })} />
                </Field>
              )}
              {d.peril === "heat" && (
                <Field label="Hot day ≥ °C">
                  <input className="input" type="number" step="0.5" value={d.heat_threshold_c} onChange={(e) => set(d.key, { heat_threshold_c: e.target.value })} />
                </Field>
              )}
              {d.peril === "dry_spell" && (
                <Field label="Dry day < mm">
                  <input className="input" type="number" step="0.5" value={d.dry_day_mm} onChange={(e) => set(d.key, { dry_day_mm: e.target.value })} />
                </Field>
              )}
              <Button
                type="button"
                variant="danger"
                size="sm"
                onClick={() => (value.length > 1 ? onChange(value.filter((x) => x.key !== d.key)) : toast("A policy needs at least one trigger.", true))}
              >
                Remove
              </Button>
            </div>
            <p className="mt-2 text-xs text-ink-3">{hint(d)}</p>
          </div>
        ))}
      </div>
      <Button type="button" variant="ghost" size="sm" className="mt-2.5" onClick={() => onChange([...value, draftFrom({ share: 0.5 })])}>
        + Add trigger
      </Button>
    </div>
  );
}

let templateCache: Promise<Record<string, string>> | null = null;
export const loadTemplates = () => (templateCache ??= api<Record<string, string>>("/v1/templates").catch((e) => ((templateCache = null), Promise.reject(e))));

export const templateTriggers = (name: string, seasonYear: number | string) =>
  api<{ triggers: TriggerSpec[] }>(`/v1/templates/${encodeURIComponent(name)}`, { query: { season_year: seasonYear } }).then((r) => r.triggers);

/** Pick a starter template and season year, then load its triggers into the editor. */
export function TemplatePicker({ onLoad }: { onLoad: (triggers: TriggerSpec[]) => void }) {
  const { toast } = useFeedback();
  const { busy, run } = useAction();
  const [list, setList] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [year, setYear] = useState(String(new Date().getFullYear()));

  useEffect(() => {
    loadTemplates()
      .then(setList)
      .catch((e: Error) => toast(e.message, true));
  }, [toast]);

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] items-end gap-3">
      <Field label="Start from a template" hint={name ? list[name] : undefined}>
        <select className="input" value={name} onChange={(e) => setName(e.target.value)}>
          <option value="">Choose…</option>
          {Object.keys(list).map((k) => (
            <option key={k} value={k}>
              {k.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Season year">
        <input className="input" type="number" min="1990" max="2100" value={year} onChange={(e) => setYear(e.target.value)} />
      </Field>
      <Button
        type="button"
        variant="ghost"
        busy={busy}
        onClick={() => {
          if (!name) return toast("Choose a template first.", true);
          run(async () => {
            onLoad(await templateTriggers(name, year));
            toast("Template loaded. Adjust the levels for this location before saving.");
          });
        }}
      >
        Load template
      </Button>
    </div>
  );
}
