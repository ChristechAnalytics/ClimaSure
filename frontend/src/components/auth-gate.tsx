"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "./session";
import { Sidebar } from "./sidebar";
import { Spinner } from "./ui";

/** Dashboard shell. Content renders only once a signed-in client is known (in the browser). */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, me } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (ready && !me) router.replace("/login");
  }, [ready, me, router]);

  if (!ready || !me) return <Spinner />;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Suspense>
        <Sidebar />
      </Suspense>
      <main className="w-full max-w-310 min-w-0 flex-1 px-4 pt-5 pb-16 md:px-8 md:pt-7">{children}</main>
    </div>
  );
}
