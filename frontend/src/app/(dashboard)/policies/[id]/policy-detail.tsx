"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Chart, type Point } from "@/components/chart";
import { useFeedback } from "@/components/feedback";
import { Meter } from "@/components/meter";
import { Badge, Button, Callout, Card, CardHead, Empty, ErrorBox, PageHead, Spinner, Table, Td, Th, Tile } from "@/components/ui";
import { useAction, useLoad } from "@/hooks/use-load";
import { api } from "@/lib/api";
import { download, fmtDate, fmtDay, money, num, plural, yesterday } from "@/lib/format";
import { PERILS } from "@/lib/perils";
import type { Contract, Evaluation, EvaluateResponse, EvaluationSummary, Payout, TriggerSpec } from "@/lib/types";

async function loadPolicy(id: string) {
  const [contract, evals, payouts] = await Promise.all([
    api<Contract>(`/v1/contracts/${id}`),
    api<EvaluationSummary[]>(`/v1/contracts/${id}/evaluations`),
    api<Payout[]>("/v1/payouts", { query: { contract_id: id } }),
  ]);
  const latest = evals.length ? await api<Evaluation>(`/v1/evaluations/${evals[0].id}`) : null;
  return { contract, evals, payouts, latest };
}

export function PolicyDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast, prompt } = useFeedback();
  const { busy, run } = useAction();
  const { data, error, reload } = useLoad(() => loadPolicy(id), [id]);
  const [asOf, setAsOf] = useState(yesterday);

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Spinner />;
  const { contract: c, evals, payouts, latest } = data;
  const raised = payouts.reduce((a, x) => a + x.amount, 0);

  function evaluate(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      const r = await api<EvaluateResponse>(`/v1/contracts/${id}/evaluate`, { method: "POST", query: { as_of: asOf } });
      toast(r.payout ? `Payout of ${money(r.payout.amount, c.currency)} raised.` : r.warnings.length ? `Checked. ${r.warnings[0]}` : "Checked. No new payout due.");
      reload();
    });
  }

  async function cancel() {
    const typed = await prompt({ title: "Cancel this policy?", label: "Type CANCEL to confirm. No further payouts will be raised.", placeholder: "CANCEL", confirm: "Cancel policy" });
    if (typed !== "CANCEL") return;
    run(async () => {
      await api(`/v1/contracts/${id}/cancel`, { method: "POST" });
      toast("Policy cancelled.");
      reload();
    });
  }

  return (
    <>
      <PageHead
        crumb={<><Link className="text-accent" href="/policies">Policies</Link> › {c.policy_ref}</>}
        title={<>{c.policy_ref} <Badge status={c.status} /></>}
        sub={`Farmer ${c.insured_ref}${c.crop ? ` · ${c.crop}` : ""} · cover ${money(c.sum_insured, c.currency)}`}
        actions={
          <>
            {c.status === "active" && <Button variant="danger" onClick={cancel}>Cancel policy</Button>}
            <form onSubmit={evaluate} className="flex items-center gap-2">
              <input type="date" className="input w-auto" value={asOf} max={yesterday()} onChange={(e) => setAsOf(e.target.value)} aria-label="Check as of" />
              <Button variant="primary" busy={busy}>Check now</Button>
            </form>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Tile label="Payout due so far" value={money(latest?.total_payout ?? 0, c.currency)} sub={latest ? `As of ${fmtDate(latest.as_of)}` : "Not checked yet"} />
        <Tile label="Payouts raised" value={money(raised, c.currency)} sub={plural(payouts.length, "payout", "payouts")} />
        <Tile label="Grid cell" value={<code className="text-base">{c.cell_id}</code>} sub={`${num(c.lat, 4)}, ${num(c.lon, 4)}`} />
      </div>

      {latest?.provider === "synthetic" && (
        <Callout warn className="mt-4">
          This result uses <strong>synthetic demo data</strong>, not real weather. Never use it to pay a real farmer.
        </Callout>
      )}

      <Card className="mt-4">
        <CardHead title="Triggers" sub="Shaded area is where the policy pays. Blue shows where the index stands now." />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {c.triggers.map((t, i) => {
            const r = latest?.results[i] ?? null;
            const p = PERILS[t.peril];
            const provisional = r?.detail?.provisional_fraction_if_window_closed_today;
            return (
              <div key={i} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{t.label || p.name}</h3>
                    <div className="text-[13px] text-ink-3">
                      {p.name} · {fmtDate(t.window_start)} – {fmtDate(t.window_end)} · {num(t.share * 100)}% of cover
                    </div>
                  </div>
                  <Badge status={r?.status ?? "not_started"} />
                </div>
                <div className="mt-2.5 text-[22px] font-semibold tabular-nums">
                  {r?.index_value != null ? num(r.index_value, 1) : "—"}{" "}
                  <small className="text-[13px] font-medium text-ink-3">{p.unit} · {p.index.toLowerCase()}</small>
                </div>
                <Meter spec={t} result={r} />
                <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-ink-2">Payout from this trigger</dt>
                  <dd><strong>{money(r?.payout_amount ?? 0, c.currency)}</strong>{r && ` (${num(r.payout_fraction * 100, 1)}% of its share)`}</dd>
                  {provisional ? (
                    <>
                      <dt className="text-ink-2">If the window closed today</dt>
                      <dd>{num(provisional * 100, 1)}% would be paid</dd>
                    </>
                  ) : null}
                  {r && (
                    <>
                      <dt className="text-ink-2">Data coverage</dt>
                      <dd>{num(r.days_observed)} of {num(r.days_expected)} days</dd>
                    </>
                  )}
                </dl>
              </div>
            );
          })}
        </div>
      </Card>

      {latest && <WeatherChart contract={c} evaluation={latest} />}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title="Evidence" sub="Every check stores the exact data used. Anyone can re-run it and confirm the result." />
          {evals.length ? <EvidenceTable contract={c} evals={evals} /> : <Empty><p>No checks yet. Click <strong>Check now</strong> to calculate the indices.</p></Empty>}
        </Card>
        <Card>
          <CardHead title="Payouts" sub={<>Approve and record payment on the <Link className="text-accent" href="/payouts">Payouts</Link> page.</>} />
          {payouts.length ? (
            <Table>
              <thead><tr><Th>Raised</Th><Th num>Amount</Th><Th>Status</Th></tr></thead>
              <tbody>
                {payouts.map((x) => (
                  <tr key={x.id}>
                    <Td>{fmtDate(x.created_at)}{x.note && <><br /><span className="text-xs text-ink-3">{x.note}</span></>}</Td>
                    <Td num>{money(x.amount, x.currency)}</Td>
                    <Td><Badge status={x.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty><p>No payouts raised for this policy.</p></Empty>
          )}
        </Card>
      </div>
    </>
  );
}

function EvidenceTable({ contract, evals }: { contract: Contract; evals: EvaluationSummary[] }) {
  const { toast } = useFeedback();
  const { run } = useAction();

  const verify = (id: string) =>
    run(async () => {
      const r = await api<{ verified: boolean }>(`/v1/evaluations/${id}/verify`);
      toast(r.verified ? "Verified: re-running the calculation gives the same result and fingerprint." : "Mismatch: this record does not reproduce. Contact ClimaSure.", !r.verified);
    });

  const save = (id: string) =>
    run(async () => {
      const ev = await api<Evaluation>(`/v1/evaluations/${id}`);
      download(`climasure-evidence-${contract.policy_ref}-${ev.as_of}.json`, JSON.stringify(ev, null, 2), "application/json");
    });

  return (
    <Table>
      <thead><tr><Th>As of</Th><Th num>Payout due</Th><Th>Fingerprint</Th><Th /></tr></thead>
      <tbody>
        {evals.slice(0, 12).map((v) => (
          <tr key={v.id}>
            <Td>{fmtDate(v.as_of)}</Td>
            <Td num>{money(v.total_payout, contract.currency)}</Td>
            <Td className="font-mono text-xs text-ink-2"><span title={v.evidence_hash}>{v.evidence_hash.slice(0, 12)}…</span></Td>
            <Td num>
              <span className="inline-flex gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => verify(v.id)}>Verify</Button>
                <Button variant="ghost" size="sm" onClick={() => save(v.id)}>Download</Button>
              </span>
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function chartFor(t: TriggerSpec, ev: Evaluation) {
  const days = ev.data.filter((d) => d.date >= t.window_start && d.date <= t.window_end);
  if (t.peril === "drought") {
    let acc = 0;
    const points: Point[] = days.map((d) => ({ x: d.date, y: (acc += d.rain_mm ?? 0), tip: `${fmtDay(d.date)} · ${num(d.rain_mm ?? 0, 1)} mm that day` }));
    return {
      title: "Rainfall so far this window",
      sub: "Running total. The policy pays if it ends the window below the trigger line.",
      kind: "line" as const,
      unit: " mm",
      points,
      refs: [{ y: t.trigger, label: `Trigger ${num(t.trigger)} mm` }, { y: t.exit, label: `Exit ${num(t.exit)} mm` }],
    };
  }
  if (t.peril === "heat") {
    const thr = t.heat_threshold_c ?? 35;
    return {
      title: "Daily maximum temperature",
      sub: "Full-colour bars are days counted as hot.",
      kind: "bar" as const,
      unit: " °C",
      points: days.map((d) => ({ x: d.date, y: d.tmax_c ?? 0, tip: fmtDay(d.date) })),
      refs: [{ y: thr, label: `Hot day ≥ ${thr} °C` }],
      highlight: (p: Point) => p.y >= thr,
    };
  }
  return {
    title: "Daily rainfall",
    sub: t.peril === "dry_spell" ? `Days under ${t.dry_day_mm ?? 1} mm count as dry. The policy measures the longest run of them.` : `The policy measures the wettest ${t.rolling_days ?? 1}-day run in the window.`,
    kind: "bar" as const,
    unit: " mm",
    points: days.map((d) => ({ x: d.date, y: d.rain_mm ?? 0, tip: fmtDay(d.date) })),
    refs: [],
  };
}

function WeatherChart({ contract, evaluation }: { contract: Contract; evaluation: Evaluation }) {
  const [pick, setPick] = useState(0);
  const spec = useMemo(() => chartFor(contract.triggers[pick], evaluation), [contract, evaluation, pick]);
  return (
    <Card className="mt-4">
      <CardHead
        title={spec.title}
        sub={spec.sub}
        actions={
          contract.triggers.length > 1 ? (
            <select className="input w-auto" value={pick} onChange={(e) => setPick(Number(e.target.value))} aria-label="Trigger">
              {contract.triggers.map((t, i) => (
                <option key={i} value={i}>{t.label || PERILS[t.peril].name}</option>
              ))}
            </select>
          ) : null
        }
      />
      <Chart
        points={spec.points}
        kind={spec.kind}
        refs={spec.refs}
        label={spec.title}
        fmt={(v) => num(v, v < 10 ? 1 : 0) + spec.unit}
        xfmt={fmtDay}
        highlight={"highlight" in spec ? spec.highlight : undefined}
      />
    </Card>
  );
}
