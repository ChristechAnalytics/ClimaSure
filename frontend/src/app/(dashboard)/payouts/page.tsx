"use client";

import Link from "next/link";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { Badge, Button, Card, Empty, ErrorBox, PageHead, Spinner, Table, Td, Th, cx } from "@/components/ui";
import { useAction, useLoad } from "@/hooks/use-load";
import { api } from "@/lib/api";
import { toCSV } from "@/lib/csv";
import { download, fmtDate, money, plural, yesterday } from "@/lib/format";
import type { Payout, PayoutStatus } from "@/lib/types";

const TABS: [PayoutStatus | "", string][] = [
  ["pending_approval", "Awaiting approval"],
  ["approved", "Approved"],
  ["paid", "Paid"],
  ["rejected", "Rejected"],
  ["", "All"],
];

type Action = "approve" | "reject" | "mark-paid";

export default function PayoutsPage() {
  const { toast, prompt } = useFeedback();
  const { busy, run } = useAction();
  const [tab, setTab] = useState<PayoutStatus | "">("pending_approval");
  const { data, error, loading, reload } = useLoad(() => api<Payout[]>("/v1/payouts", { query: { status: tab } }), [tab]);

  async function act(p: Payout, action: Action) {
    let note: string | null = null;
    if (action === "reject") {
      note = await prompt({ title: "Reject payout", label: "Reason (kept on record)", placeholder: "e.g. duplicate policy", confirm: "Reject" });
      if (!note) return;
    }
    if (action === "mark-paid") {
      note = await prompt({ title: "Record payment", label: "Payment reference", placeholder: "e.g. mobile money transaction ID", confirm: "Mark paid" });
      if (!note) return;
    }
    run(async () => {
      await api(`/v1/payouts/${p.id}/${action}`, { method: "POST", body: note ? { note } : undefined });
      toast({ approve: "Payout approved.", reject: "Payout rejected.", "mark-paid": "Payment recorded." }[action]);
      reload();
    });
  }

  function exportApproved() {
    run(async () => {
      const rows = await api<Payout[]>("/v1/payouts", { query: { status: "approved" } });
      if (!rows.length) return toast("No approved payouts to export.");
      download(`climasure-approved-payouts-${yesterday()}.csv`, toCSV(rows, ["id", "insured_ref", "amount", "currency", "contract_id", "evaluation_id", "created_at"]), "text/csv");
    });
  }

  const rows = data ?? [];
  const total = rows.reduce((a, x) => a + x.amount, 0);

  return (
    <>
      <PageHead
        title="Payouts"
        sub="ClimaSure raises payouts automatically. You approve them, pay the farmer, then record the payment reference."
        actions={<Button variant="ghost" onClick={exportApproved} busy={busy}>Export approved for payment (CSV)</Button>}
      />
      <Card>
        <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
          {TABS.map(([k, label]) => (
            <button
              key={label}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cx("-mb-px border-b-2 px-3 py-2 font-medium whitespace-nowrap", tab === k ? "border-accent text-ink" : "border-transparent text-ink-2 hover:text-ink")}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? (
          <ErrorBox>{error}</ErrorBox>
        ) : loading && !data ? (
          <Spinner />
        ) : rows.length ? (
          <>
            <p className="mb-2 text-ink-3">{plural(rows.length, "payout", "payouts")} · {money(total)}</p>
            <Table>
              <thead>
                <tr><Th>Raised</Th><Th>Farmer</Th><Th>Policy</Th><Th num>Amount</Th><Th>Status</Th><Th>Note</Th><Th /></tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id}>
                    <Td>{fmtDate(x.created_at)}</Td>
                    <Td>{x.insured_ref}</Td>
                    <Td><Link className="text-accent" href={`/policies/${x.contract_id}`}>View</Link></Td>
                    <Td num><strong>{money(x.amount, x.currency)}</strong></Td>
                    <Td><Badge status={x.status} /></Td>
                    <Td className="text-ink-3">{x.note}</Td>
                    <Td num>
                      <span className="inline-flex gap-1.5">
                        {x.status === "pending_approval" && <Button variant="primary" size="sm" onClick={() => act(x, "approve")}>Approve</Button>}
                        {x.status === "approved" && <Button variant="primary" size="sm" onClick={() => act(x, "mark-paid")}>Mark paid</Button>}
                        {(x.status === "pending_approval" || x.status === "approved") && (
                          <Button variant="danger" size="sm" onClick={() => act(x, "reject")}>Reject</Button>
                        )}
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        ) : (
          <Empty title="Nothing here">
            <p>{tab === "pending_approval" ? "No payouts waiting for approval." : "No payouts in this list."}</p>
          </Empty>
        )}
      </Card>
    </>
  );
}
