"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { api, ApiError, setUnauthorizedHandler } from "@/lib/api";
import { ADMIN_KEY, CLIENT_KEY, readKey, subscribeKeys, writeKey } from "@/lib/keys";
import type { Me } from "@/lib/types";

interface SessionValue {
  /** True once we know whether someone is signed in (always false during server render). */
  ready: boolean;
  me: Me | null;
  hasAdminKey: boolean;
  signIn: (key: string) => Promise<void>;
  /** Sign in to the public demo account. "off": this server has no demo. "error": API unreachable or failing. */
  enterDemo: () => Promise<"ok" | "off" | "error">;
  signOut: () => void;
  setMe: (me: Me) => void;
  setAdminKey: (key: string | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

// undefined = not known yet (server render / before hydration)
const useStoredKey = (name: string) =>
  useSyncExternalStore(
    subscribeKeys,
    () => readKey(name),
    () => undefined,
  );

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const clientKey = useStoredKey(CLIENT_KEY);
  const adminKey = useStoredKey(ADMIN_KEY);
  // Who the current key belongs to. Only trusted when it matches the stored key.
  const [who, setWho] = useState<{ key: string; me: Me } | null>(null);

  const signOut = useCallback(() => {
    writeKey(CLIENT_KEY, null);
    setWho(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOut);
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  // A key found in storage (e.g. after a page reload): look up who it belongs to.
  useEffect(() => {
    if (!clientKey || who?.key === clientKey) return;
    let cancelled = false;
    api<Me>("/v1/me", { key: clientKey })
      .then((me) => !cancelled && setWho({ key: clientKey, me }))
      .catch(() => !cancelled && signOut());
    return () => {
      cancelled = true;
    };
  }, [clientKey, who, signOut]);

  const signIn = useCallback(async (key: string) => {
    const me = await api<Me>("/v1/me", { key });
    setWho({ key, me });
    writeKey(CLIENT_KEY, key);
  }, []);

  const enterDemo = useCallback(async (): Promise<"ok" | "off" | "error"> => {
    try {
      const { api_key } = await api<{ api_key: string }>("/v1/demo/session", { method: "POST" });
      await signIn(api_key);
      return "ok";
    } catch (e) {
      return e instanceof ApiError && e.status === 404 ? "off" : "error";
    }
  }, [signIn]);

  const setMe = useCallback((me: Me) => setWho((w) => (w ? { ...w, me } : w)), []);
  const setAdminKey = useCallback((key: string | null) => writeKey(ADMIN_KEY, key), []);

  const me = clientKey && who?.key === clientKey ? who.me : null;
  const ready = clientKey !== undefined && (clientKey === null || me !== null);

  const value = useMemo(
    () => ({ ready, me, hasAdminKey: Boolean(adminKey), signIn, enterDemo, signOut, setMe, setAdminKey }),
    [ready, me, adminKey, signIn, enterDemo, signOut, setMe, setAdminKey],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside SessionProvider");
  return ctx;
}
