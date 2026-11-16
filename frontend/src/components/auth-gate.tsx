"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { DemoBanner } from "./demo-banner";
import { useSession } from "./session";
import { Sidebar } from "./sidebar";
import { Spinner } from "./ui";

// A free-tier API host can take up to a minute to wake from sleep. Keep trying for about 90 s.
const DEMO_RETRIES = 18;
const DEMO_RETRY_MS = 5000;

/**
 * Dashboard shell. Content renders only once a signed-in client is known (in the browser).
 * With nobody signed in, it tries the public demo first and only then sends people to /login.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, me, enterDemo } = useSession();
  const router = useRouter();
  const triedDemo = useRef(false);
  const [waking, setWaking] = useState(false);
  // Bumped when the demo is settled or reset, to remount the page so it reloads its data.
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    if (!ready || me) return;
    if (triedDemo.current) {
      router.replace("/login");
      return;
    }
    triedDemo.current = true;
    let cancelled = false;
    (async () => {
      for (let attempt = 0; attempt <= DEMO_RETRIES && !cancelled; attempt++) {
        const result = await enterDemo();
        if (cancelled || result === "ok") return;
        if (result === "off") break;
        setWaking(true);
        await new Promise((r) => setTimeout(r, DEMO_RETRY_MS));
      }
      if (!cancelled) router.replace("/login");
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, me, enterDemo, router]);

  if (!ready || !me) {
    return <Spinner label={waking ? "Waking up the demo server. The first visit can take up to a minute…" : "Loading…"} />;
  }

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Suspense>
        <Sidebar />
      </Suspense>
      <main className="w-full max-w-310 min-w-0 flex-1 px-4 pt-5 pb-16 md:px-8 md:pt-7">
        {me.demo && <DemoBanner onDataChanged={() => setDataVersion((v) => v + 1)} />}
        <div key={dataVersion}>{children}</div>
      </main>
    </div>
  );
}
