"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card, Empty, ErrorBox, LinkButton, PageHead, Spinner, Table, Td, Th } from "@/components/ui";
import { useLoad } from "@/hooks/use-load";
import { api } from "@/lib/api";
import { money, num } from "@/lib/format";
import { PERILS } from "@/lib/perils";
import type { Contract } from "@/lib/types";

export default function PoliciesPage() {
  const router = useRouter();
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const { data, error, loading } = useLoad(() => api<Contract[]>("/v1/contracts", { query: { status, limit: 1000 } }), [status]);

  const rows = (data ?? []).filter((k) => !q || `${k.policy_ref} ${k.insured_ref}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHead
        title="Policies"
        sub="Every farmer policy you have registered with ClimaSure."
        actions={
          <>
            <LinkButton href="/policies/upload" variant="ghost">Upload CSV</LinkButton>
            <LinkButton href="/policies/new" variant="primary">New policy</LinkButton>
          </>
        }
      />
      <Card>
        <div className="mb-3.5 flex flex-wrap items-center gap-2">
          <input className="input max-w-80" placeholder="Search policy or farmer reference" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input max-w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <span className="ml-auto text-[13px] text-ink-3">{num(rows.length)} {rows.length === 1 ? "policy" : "policies"}</span>
        </div>

        {error ? (
          <ErrorBox>{error}</ErrorBox>
        ) : loading && !data ? (
          <Spinner />
        ) : rows.length ? (
          <Table>
            <thead>
              <tr><Th>Policy</Th><Th>Farmer</Th><Th>Cover</Th><Th>Triggers</Th><Th>Location</Th><Th num>Sum insured</Th><Th>Status</Th></tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k.id} className="cursor-pointer hover:bg-surface-2" onClick={() => router.push(`/policies/${k.id}`)}>
                  <Td><strong>{k.policy_ref}</strong></Td>
                  <Td>{k.insured_ref}</Td>
                  <Td>{k.crop || "—"}</Td>
                  <Td>{k.triggers.map((t) => PERILS[t.peril]?.name ?? t.peril).join(", ")}</Td>
                  <Td className="text-ink-3">{num(k.lat, 3)}, {num(k.lon, 3)}</Td>
                  <Td num>{money(k.sum_insured, k.currency)}</Td>
                  <Td><Badge status={k.status} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty title="No matching policies">
            <p>Try a different search, or <Link className="text-accent" href="/policies/new">create a policy</Link>.</p>
          </Empty>
        )}
      </Card>
    </>
  );
}
