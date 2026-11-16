"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/session";
import { Brand, Button, Card, ErrorBox, Field } from "@/components/ui";

export default function LoginPage() {
  const { ready, me, signIn } = useSession();
  const router = useRouter();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (ready && me) router.replace("/");
  }, [ready, me, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = key.trim();
    // Catch the common mix-ups before asking the server.
    if (value.startsWith("whsec_")) {
      setError("That's a webhook secret. Sign in with the API key instead (it starts with cs_live_).");
      return;
    }
    // ak_live_ keys were issued before the rename to ClimaSure and still work.
    if (!value.startsWith("cs_live_") && !value.startsWith("ak_live_")) {
      setError("Client API keys start with cs_live_. If this is the admin key, use the staff admin page below to create a client and open its dashboard.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(value);
      router.replace("/");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(
        msg === "invalid API key"
          ? "That key isn't registered on this server. It may be from another database, or mistyped. Ask ClimaSure staff for a new key, or create one on the admin page below."
          : msg,
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-[8vh] max-w-[440px] px-4">
      <div className="mb-6 flex justify-center">
        <Brand />
      </div>
      <Card className="p-7">
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <p className="mt-1.5 mb-4.5 text-ink-2">
          Paste the API key your ClimaSure account manager gave you. It stays in this browser tab only and is cleared when you close it.
        </p>
        {error && <div className="mb-3.5"><ErrorBox>{error}</ErrorBox></div>}
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="API key">
            <input className="input" type="password" autoComplete="off" placeholder="cs_live_…" required value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <Button variant="primary" busy={busy} className="w-full">
            Sign in
          </Button>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm">
        <Link href="/admin" className="text-accent">
          ClimaSure staff: manage client accounts
        </Link>
      </p>
    </div>
  );
}
