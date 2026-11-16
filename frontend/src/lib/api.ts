// Thin client for the ClimaSure API. Requests go to /api/* and Next.js proxies them to the backend.
import { ADMIN_KEY, CLIENT_KEY, readKey } from "./keys";

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Query; admin?: boolean; key?: string } = {},
): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== null && v !== undefined && v !== "") params.set(k, String(v));
  const url = `/api${path}${params.size ? `?${params}` : ""}`;

  const clientKey = opts.key ?? readKey(CLIENT_KEY);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.admin) headers["X-Admin-Key"] = readKey(ADMIN_KEY) ?? "";
  else if (clientKey) headers["X-API-Key"] = clientKey;

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    throw new ApiError("Can't reach the ClimaSure server. Is the API running?", 0);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    if (res.status === 401 && !opts.admin && !opts.key && clientKey) onUnauthorized?.();
    throw new ApiError(errorText(data, res.status), res.status);
  }
  return data as T;
}

function errorText(data: unknown, status: number): string {
  const detail = (data as { detail?: unknown } | null)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e: { loc?: (string | number)[]; msg?: string }) => `${(e.loc ?? []).filter((x) => x !== "body").join(" › ")}: ${e.msg}`)
      .join("\n");
  }
  if (status >= 500) return "Can't reach the ClimaSure API, or it hit an error. Check that it is running on port 8000.";
  return `Request failed (${status})`;
}
