"use client";

import { useState } from "react";
import { Chart } from "@/components/chart";
import { TemplatePicker, TriggerEditor, draftFrom, toSpec, type TriggerDraft } from "@/components/trigger-editor";
import { Button, Callout, Card, CardHead, Field, PageHead, Tile } from "@/components/ui";
import { useAction } from "@/hooks/use-load";
import { api } from "@/lib/api";
import { money, num } from "@/lib/format";
import type { Backtest, Climatology } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SyntheticNote = () => (
  <Callout warn className="mb-3">Synthetic demo data. Switch the server to real data before using these numbers.</Callout>
);

export default function DesignPage() {
  return (
    <>
      <PageHead title="Product design" sub="Test trigger levels against past seasons before you sell a product." />
      <Callout warn className="mb-4">
        Results are a starting point for your actuary, not final pricing. Check them against seasons your farmers remember as bad.
      </Callout>
      <div className="flex flex-col gap-4">
        <RainfallHistory />
        <BacktestCard />
      </div>
    </>
  );
}

function RainfallHistory() {
  const { busy, run } = useAction();
  const [q, setQ] = useState({ lat: "12.0", lon: "8.52", start_month: "6", end_month: "9", years: "20" });
  const [res, setRes] = useState<Climatology | null>(null);
  const set = (k: keyof typeof q) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setQ({ ...q, [k]: e.target.value });

  return (
    <Card>
      <CardHead title="Season rainfall history" sub="How much rain fell in past seasons at a location. A useful first step for picking a drought trigger." />
      <form
        className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => setRes(await api<Climatology>("/v1/climatology", { query: q })));
        }}
      >
        <Field label="Latitude"><input className="input" type="number" step="any" required value={q.lat} onChange={set("lat")} /></Field>
        <Field label="Longitude"><input className="input" type="number" step="any" required value={q.lon} onChange={set("lon")} /></Field>
        <Field label="From month">
          <select className="input" value={q.start_month} onChange={set("start_month")}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        </Field>
        <Field label="To month">
          <select className="input" value={q.end_month} onChange={set("end_month")}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        </Field>
        <Field label="Years"><input className="input" type="number" min="3" max="40" value={q.years} onChange={set("years")} /></Field>
        <Button variant="primary" busy={busy}>Show history</Button>
      </form>

      {res && (
        <div className="mt-4">
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Average season" value={`${num(res.mean_mm)} mm`} />
            <Tile label="Median season" value={`${num(res.median_mm)} mm`} />
            <Tile label="1-in-5 dry season" value={`${num(res.p20_mm)} mm`} sub="A drought trigger here pays ~1 year in 5" />
            <Tile label="1-in-10 dry season" value={`${num(res.p10_mm)} mm`} />
          </div>
          {res.provider === "synthetic" && <SyntheticNote />}
          <Chart
            label="Season rainfall by year"
            points={res.seasons.map((s) => ({ x: String(s.year), y: s.rain_mm }))}
            refs={[{ y: res.p20_mm, label: `1-in-5 dry: ${num(res.p20_mm)} mm` }]}
            fmt={(v) => `${num(v)} mm`}
          />
        </div>
      )}
    </Card>
  );
}

function BacktestCard() {
  const { busy, run } = useAction();
  const [f, setF] = useState({ lat: "12.0", lon: "8.52", sum_insured: "200000", years: "20", loading_factor: "1.5" });
  const [triggers, setTriggers] = useState<TriggerDraft[]>([draftFrom()]);
  const [res, setRes] = useState<Backtest | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      const body = {
        contract: { policy_ref: "draft", insured_ref: "draft", lat: Number(f.lat), lon: Number(f.lon), sum_insured: Number(f.sum_insured), triggers: triggers.map(toSpec) },
        years: Number(f.years),
        loading_factor: Number(f.loading_factor),
      };
      setRes(await api<Backtest>("/v1/backtest", { method: "POST", body }));
    });
  }

  return (
    <Card>
      <CardHead title="Backtest a product" sub="Apply proposed terms to each past season: how often would it have paid, and how much?" />
      <form onSubmit={submit}>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3">
          <Field label="Latitude"><input className="input" type="number" step="any" required value={f.lat} onChange={set("lat")} /></Field>
          <Field label="Longitude"><input className="input" type="number" step="any" required value={f.lon} onChange={set("lon")} /></Field>
          <Field label="Sum insured"><input className="input" type="number" min="1" required value={f.sum_insured} onChange={set("sum_insured")} /></Field>
          <Field label="Years"><input className="input" type="number" min="3" max="40" value={f.years} onChange={set("years")} /></Field>
          <Field label="Loading factor" hint="Multiplier on burn cost for expenses and margin">
            <input className="input" type="number" step="0.1" min="1" max="5" value={f.loading_factor} onChange={set("loading_factor")} />
          </Field>
        </div>
        <div className="mt-3.5"><TemplatePicker onLoad={(ts) => setTriggers(ts.map(draftFrom))} /></div>
        <div className="mt-3.5"><TriggerEditor value={triggers} onChange={setTriggers} /></div>
        <div className="mt-4 flex justify-end"><Button variant="primary" busy={busy}>Run backtest</Button></div>
      </form>

      {res && (
        <div className="mt-4">
          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="Would have paid in" value={`${num(res.payout_frequency * 100)}%`} sub={`of the last ${res.years} seasons`} />
            <Tile label="Burn cost" value={`${num(res.burn_cost_pct, 2)}%`} sub="Average payout, % of cover" />
            <Tile label="Worst season" value={`${num(res.worst_year_pct, 1)}%`} sub="of cover paid" />
            <Tile label="Indicative premium" value={money(res.indicative_premium)} sub={`${num(res.indicative_premium_pct, 2)}% of cover`} />
          </div>
          {res.provider === "synthetic" && <SyntheticNote />}
          <h3 className="mb-2 font-semibold">Payout by season (% of cover)</h3>
          <Chart
            label="Backtest payout by season"
            points={[...res.seasons].reverse().map((s) => ({ x: s.season_start.slice(0, 4), y: s.payout_pct }))}
            fmt={(v) => `${num(v, 1)}%`}
          />
        </div>
      )}
    </Card>
  );
}
