"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFeedback } from "@/components/feedback";
import { useSession } from "@/components/session";
import { Brand, Button, Callout, Card, CardHead, Empty, ErrorBox, Field, LinkButton, PageHead, Spinner, Table, Td, Th } from "@/components/ui";
import { useAction, useLoad } from "@/hooks/use-load";
import { api } from "@/lib/api";
import { fmtDate, money, num, plural, yesterday } from "@/lib/format";
import type { AdminClient, DailyRunSummary } from "@/lib/types";

interface NewClient {
  client_id: string;
  name: string;
  api_key: string;
  webhook_secret: string;
}

export default function AdminPage() {
  const { ready, hasAdminKey, setAdminKey, me } = useSession();
  const [key, setKey] = useState("");
  const [version, setVersion] = useState(0);

  if (!ready) return <Spinner />;

  return (
    <div className="mx-auto max-w-275 px-4 pt-6 pb-16 md:px-8">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Brand />
        <LinkButton href={me ? "/" : "/login"} variant="ghost">{me ? "Back to dashboard" : "Back to sign in"}</LinkButton>
      </div>
      <PageHead title="ClimaSure admin" sub="Create client accounts and run the daily settlement job. For ClimaSure staff only." />

      <Card className="mb-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) setAdminKey(key.trim());
            setKey("");
            setVersion((v) => v + 1);
          }}
        >
          <CardHead title="Admin key" sub={<>From <code>CLIMASURE_ADMIN_API_KEY</code> in the server&apos;s <code>.env</code>. Kept in this tab only.</>} />
          <div className="flex flex-wrap gap-2">
            <input className="input max-w-90" type="password" autoComplete="off" placeholder={hasAdminKey ? "Saved for this tab" : "Admin key"} value={key} onChange={(e) => setKey(e.target.value)} required={!hasAdminKey} />
            <Button variant="primary">Unlock</Button>
            {hasAdminKey && <Button type="button" variant="ghost" onClick={() => setAdminKey(null)}>Forget key</Button>}
          </div>
        </form>
      </Card>

      {hasAdminKey && <AdminBody key={version} />}
    </div>
  );
}

function AdminBody() {
  const { setAdminKey } = useSession();
  const { data: clients, error, reload } = useLoad(() => api<AdminClient[]>("/v1/admin/clients", { admin: true }));

  if (error) {
    return (
      <ErrorBox>
        {error === "invalid admin key" ? "That admin key is wrong." : error}{" "}
        <button className="ml-2 underline" onClick={() => setAdminKey(null)}>Try another key</button>
      </ErrorBox>
    );
  }
  if (!clients) return <Spinner />;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <NewClientCard onCreated={reload} />
        <DailyRunCard />
      </div>
      <Card>
        <CardHead title="Clients" />
        {clients.length ? (
          <Table>
            <thead><tr><Th>Name</Th><Th>Client ID</Th><Th num>Policies</Th><Th>Auto-approve</Th><Th>Webhook</Th><Th>Created</Th></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id}>
                  <Td><strong>{c.name}</strong></Td>
                  <Td><code className="text-xs">{c.id}</code></Td>
                  <Td num>{num(c.contracts)}</Td>
                  <Td>{c.auto_approve ? "Yes" : "No"}</Td>
                  <Td className="text-ink-3">{c.webhook_url || "—"}</Td>
                  <Td>{fmtDate(c.created_at)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <Empty><p>No clients yet. Create the first one above.</p></Empty>
        )}
      </Card>
    </div>
  );
}

function NewClientCard({ onCreated }: { onCreated: () => void }) {
  const router = useRouter();
  const { signIn } = useSession();
  const { toast } = useFeedback();
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: "", webhook_url: "", auto_approve: false });
  const [created, setCreated] = useState<NewClient | null>(null);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied.");
    } catch {
      toast("Copy failed. Select the text and copy it manually.", true);
    }
  };

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const r = await api<NewClient>("/v1/admin/clients", { method: "POST", admin: true, body: { name: f.name, webhook_url: f.webhook_url || null, auto_approve: f.auto_approve } });
            setCreated(r);
            setF({ name: "", webhook_url: "", auto_approve: false });
            onCreated();
          });
        }}
      >
        <CardHead title="New client" sub="An insurer, MFI or aggregator." />
        <div className="flex flex-col gap-3.5">
          <Field label="Organisation name"><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Webhook URL (optional)"><input className="input" type="url" value={f.webhook_url} onChange={(e) => setF({ ...f, webhook_url: e.target.value })} /></Field>
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" className="size-4 accent-accent" checked={f.auto_approve} onChange={(e) => setF({ ...f, auto_approve: e.target.checked })} />
            Approve payouts automatically
          </label>
        </div>
        <div className="mt-4 flex justify-end"><Button variant="primary" busy={busy}>Create client</Button></div>
      </form>

      {created && (
        <div className="mt-4 flex flex-col gap-3">
          <Callout warn><strong>Copy these now.</strong> They are shown only once. Send them to the client separately and securely.</Callout>
          {[
            ["API key", created.api_key],
            ["Webhook secret", created.webhook_secret],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-[13px] text-ink-2">{label}</div>
              <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed border-line bg-surface-2 px-3 py-2.5 font-mono text-[13px] break-all">
                <span>{value}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => copy(value)}>Copy</Button>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              run(async () => {
                await signIn(created.api_key);
                router.push("/");
              })
            }
          >
            Open the dashboard as {created.name}
          </Button>
        </div>
      )}
    </Card>
  );
}

function DailyRunCard() {
  const { busy, run } = useAction();
  const [asOf, setAsOf] = useState(yesterday);
  const [res, setRes] = useState<DailyRunSummary | null>(null);

  return (
    <Card>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => setRes(await api<DailyRunSummary>("/v1/admin/run-daily", { method: "POST", admin: true, query: { as_of: asOf } })));
        }}
      >
        <CardHead title="Daily settlement" sub="Checks every active policy for all clients. Normally runs on a schedule each morning." />
        <Field label="Evaluate as of"><input className="input" type="date" value={asOf} max={yesterday()} onChange={(e) => setAsOf(e.target.value)} /></Field>
        <div className="mt-4 flex justify-end"><Button variant="primary" busy={busy}>Run now</Button></div>
      </form>
      {res && (
        <Callout className="mt-3.5">
          Checked {plural(res.evaluated, "policy", "policies")} ({num(res.skipped)} not started yet). {plural(res.payouts_raised, "payout", "payouts")} raised, {money(res.payout_total)}.
          {res.errors.length > 0 && <> <strong>{plural(res.errors.length, "error", "errors")}</strong>: {res.errors[0].error}</>}
        </Callout>
      )}
    </Card>
  );
}
