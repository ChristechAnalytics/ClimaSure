"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { PolicyMap } from "@/components/policy-map";
import { Badge, Card, CardHead, Empty, ErrorBox, LinkButton, PageHead, Spinner, Table, Td, Th, Tile } from "@/components/ui";
import { useLoad } from "@/hooks/use-load";
import { api } from "@/lib/api";
import { fmtDate, money, moneyShort, num, plural } from "@/lib/format";
import type { Contract, Payout, Summary } from "@/lib/types";

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export default function OverviewPage() {
  const router = useRouter();
  const { data, error } = useLoad(() =>
    Promise.all([api<Summary>("/v1/summary"), api<Contract[]>("/v1/contracts", { query: { limit: 1000 } }), api<Payout[]>("/v1/payouts")]),
  );

  const points = useMemo(
    () =>
      (data?.[1] ?? []).map((k) => ({
        lat: k.lat,
        lon: k.lon,
        popupHtml: `<strong>${escHtml(k.policy_ref)}</strong><br>${escHtml(k.insured_ref)}<br>${escHtml(money(k.sum_insured, k.currency))}<br><a href="/policies/${encodeURIComponent(k.id)}">Open policy</a>`,
      })),
    [data],
  );

  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!data) return <Spinner />;
  const [sum, , payouts] = data;
  const c = sum.contracts;
  const p = sum.payouts;
  const active = c.active ?? { count: 0, sum_insured: 0 };
  const pending = p.pending_approval ?? { count: 0, amount: 0 };
  const approved = p.approved ?? { count: 0, amount: 0 };
  const paid = p.paid ?? { count: 0, amount: 0 };
  const total = Object.values(c).reduce((a, x) => a + (x?.count ?? 0), 0);

  return (
    <>
      <PageHead
        title="Overview"
        sub="Your portfolio at a glance. Indices update every morning with yesterday's weather."
        actions={
          <>
            <LinkButton href="/policies/upload" variant="ghost">Upload CSV</LinkButton>
            <LinkButton href="/policies/new" variant="primary">New policy</LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Active policies" value={num(active.count)} sub={`${num(total)} in total`} />
        <Tile label="Cover in force" value={moneyShort(active.sum_insured)} sub="Sum insured, active policies" />
        <Tile
          label="Awaiting your approval"
          value={moneyShort(pending.amount)}
          sub={<>{plural(pending.count, "payout", "payouts")} · <Link className="text-accent" href="/payouts">review</Link></>}
        />
        <Tile label="Paid to farmers" value={moneyShort(paid.amount)} sub={`${num(paid.count)} paid · ${moneyShort(approved.amount)} approved, not yet paid`} />
      </div>

      {total === 0 ? (
        <Card className="mt-4">
          <Empty title="No policies yet">
            <p>Register farmers one at a time, or upload a CSV of your whole loan book.</p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <LinkButton href="/policies/new" variant="primary">Create a policy</LinkButton>
              <LinkButton href="/policies/upload" variant="ghost">Upload CSV</LinkButton>
              <LinkButton href="/design" variant="ghost">Design a product first</LinkButton>
            </div>
          </Empty>
        </Card>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHead title="Where your policies are" sub="Each dot is a policy. Click one to open it." />
            <PolicyMap points={points} />
          </Card>
          <Card>
            <CardHead
              title="Latest payouts"
              sub="Raised automatically when an index crosses its trigger."
              actions={<LinkButton href="/payouts" variant="ghost" size="sm">All payouts</LinkButton>}
            />
            {payouts.length ? (
              <Table>
                <thead>
                  <tr><Th>Farmer</Th><Th num>Amount</Th><Th>Status</Th></tr>
                </thead>
                <tbody>
                  {payouts.slice(0, 8).map((x) => (
                    <tr key={x.id} className="cursor-pointer hover:bg-surface-2" onClick={() => router.push(`/policies/${x.contract_id}`)}>
                      <Td>{x.insured_ref}<br /><span className="text-xs text-ink-3">{fmtDate(x.created_at)}</span></Td>
                      <Td num>{money(x.amount, x.currency)}</Td>
                      <Td><Badge status={x.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <Empty><p>No payouts yet. They appear here as soon as a trigger is hit.</p></Empty>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
