"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFeedback } from "@/components/feedback";
import { PolicyMap } from "@/components/policy-map";
import { TemplatePicker, TriggerEditor, draftFrom, toSpec, type TriggerDraft } from "@/components/trigger-editor";
import { Button, Card, CardHead, Field, LinkButton, PageHead } from "@/components/ui";
import { useAction } from "@/hooks/use-load";
import { api } from "@/lib/api";
import type { Contract } from "@/lib/types";

export default function NewPolicyPage() {
  const router = useRouter();
  const { toast } = useFeedback();
  const { busy, run } = useAction();
  const [f, setF] = useState({ policy_ref: "", insured_ref: "", lat: "", lon: "", sum_insured: "", currency: "NGN", crop: "" });
  const [triggers, setTriggers] = useState<TriggerDraft[]>([draftFrom()]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(async () => {
      const body = {
        policy_ref: f.policy_ref,
        insured_ref: f.insured_ref,
        lat: Number(f.lat),
        lon: Number(f.lon),
        sum_insured: Number(f.sum_insured),
        currency: f.currency.toUpperCase(),
        ...(f.crop ? { crop: f.crop } : {}),
        triggers: triggers.map(toSpec),
      };
      const c = await api<Contract>("/v1/contracts", { method: "POST", body });
      toast("Policy created.");
      router.push(`/policies/${c.id}`);
    });
  }

  return (
    <>
      <PageHead
        crumb={<><Link className="text-accent" href="/policies">Policies</Link> › New</>}
        title="New policy"
        sub={<>Register one farmer. For many farmers at once, <Link className="text-accent" href="/policies/upload">upload a CSV</Link>.</>}
      />
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Card>
          <CardHead title="Who and where" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] content-start gap-3">
              <Field label="Policy reference"><input className="input" required placeholder="Your policy number" value={f.policy_ref} onChange={set("policy_ref")} /></Field>
              <Field label="Farmer reference" hint="A code, not a name or phone number.">
                <input className="input" required placeholder="e.g. BORROWER-1042" value={f.insured_ref} onChange={set("insured_ref")} />
              </Field>
              <Field label="Latitude"><input className="input" type="number" step="any" min="-90" max="90" required value={f.lat} onChange={set("lat")} /></Field>
              <Field label="Longitude"><input className="input" type="number" step="any" min="-180" max="180" required value={f.lon} onChange={set("lon")} /></Field>
              <Field label="Sum insured"><input className="input" type="number" step="any" min="1" required value={f.sum_insured} onChange={set("sum_insured")} /></Field>
              <Field label="Currency"><input className="input" maxLength={3} required value={f.currency} onChange={set("currency")} /></Field>
              <Field label="Crop / cover"><input className="input" placeholder="e.g. maize" value={f.crop} onChange={set("crop")} /></Field>
            </div>
            <div>
              <PolicyMap
                className="h-60"
                onPick={(lat, lon) => setF((prev) => ({ ...prev, lat: String(lat), lon: String(lon) }))}
                picked={f.lat && f.lon ? { lat: Number(f.lat), lon: Number(f.lon) } : null}
              />
              <p className="mt-1.5 text-[13px] text-ink-3">Click the map to set the farm location.</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead title="Triggers" sub="When the weather index crosses the trigger, the policy pays automatically." />
          <TemplatePicker onLoad={(ts) => setTriggers(ts.map(draftFrom))} />
          <div className="mt-3.5">
            <TriggerEditor value={triggers} onChange={setTriggers} />
          </div>
        </Card>

        <div className="flex justify-end gap-2">
          <LinkButton href="/policies" variant="ghost">Cancel</LinkButton>
          <Button variant="primary" busy={busy}>Create policy</Button>
        </div>
      </form>
    </>
  );
}
