"use client";

import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import { useSession } from "@/components/session";
import { Badge, Button, Card, CardHead, Empty, ErrorBox, Field, PageHead, Spinner, Table, Td, Th } from "@/components/ui";
import { useAction, useLoad } from "@/hooks/use-load";
import { api } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import type { Delivery, Me } from "@/lib/types";

export default function SettingsPage() {
  const { me, setMe } = useSession();
  const { toast } = useFeedback();
  const { busy, run } = useAction();
  const [webhook, setWebhook] = useState(me?.webhook_url ?? "");
  const [autoApprove, setAutoApprove] = useState(Boolean(me?.auto_approve));
  const deliveries = useLoad(() => api<Delivery[]>("/v1/webhooks/deliveries", { query: { limit: 50 } }));

  if (!me) return <Spinner />;

  function save(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      setMe(await api<Me>("/v1/me", { method: "PATCH", body: { webhook_url: webhook || null, auto_approve: autoApprove } }));
      toast("Settings saved.");
    });
  }

  return (
    <>
      <PageHead title="Settings" sub="How ClimaSure connects to your systems." />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHead title="Account" />
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-ink-2">Organisation</dt><dd>{me.name}</dd>
            <dt className="text-ink-2">Client ID</dt><dd><code>{me.id}</code></dd>
            <dt className="text-ink-2">Since</dt><dd>{fmtDate(me.created_at)}</dd>
          </dl>
        </Card>

        <Card>
          <form onSubmit={save}>
            <CardHead title="Notifications and approvals" sub="ClimaSure sends a signed message to your system whenever a payout is raised." />
            <div className="flex flex-col gap-4">
              <Field label="Webhook URL" hint="Leave empty to just use this dashboard. See the API reference for how to verify signatures.">
                <input className="input" type="url" placeholder="https://your-system.example/climasure-webhook" value={webhook} onChange={(e) => setWebhook(e.target.value)} />
              </Field>
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" className="size-4 accent-accent" checked={autoApprove} onChange={(e) => setAutoApprove(e.target.checked)} />
                Approve payouts automatically
              </label>
              <p className="text-[13px] text-ink-3">
                When on, payouts go straight to <em>Approved</em>, ready to pay. When off, someone on your team approves each one first.
              </p>
            </div>
            <div className="mt-4 flex justify-end"><Button variant="primary" busy={busy}>Save</Button></div>
          </form>
        </Card>

        <Card>
          <CardHead title="Recent notifications" sub="The last 50 messages ClimaSure tried to send you." />
          {deliveries.error ? (
            <ErrorBox>{deliveries.error}</ErrorBox>
          ) : !deliveries.data ? (
            <Spinner />
          ) : deliveries.data.length ? (
            <Table>
              <thead><tr><Th>Time</Th><Th>Event</Th><Th>Result</Th><Th>Detail</Th></tr></thead>
              <tbody>
                {deliveries.data.map((d) => (
                  <tr key={d.id}>
                    <Td>{new Date(d.created_at).toLocaleString("en-GB")}</Td>
                    <Td><code>{d.event}</code></Td>
                    <Td>
                      {d.ok ? <Badge tone="good" label="Delivered" /> : d.url ? <Badge tone="critical" label="Failed" /> : <Badge tone="neutral" label="Not sent" />}
                    </Td>
                    <Td className="text-ink-3">{d.ok ? `HTTP ${d.status_code}` : d.error}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty><p>No notifications yet.</p></Empty>
          )}
        </Card>
      </div>
    </>
  );
}
