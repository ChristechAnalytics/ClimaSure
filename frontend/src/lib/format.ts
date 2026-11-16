export const money = (n: number | null | undefined, cur = "NGN") =>
  (cur === "NGN" ? "₦" : `${cur} `) + Number(n ?? 0).toLocaleString("en-NG", { maximumFractionDigits: 2 });

export function moneyShort(n: number | null | undefined, cur = "NGN") {
  const v = Number(n ?? 0);
  const sym = cur === "NGN" ? "₦" : `${cur} `;
  if (Math.abs(v) >= 1e9) return `${sym}${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `${sym}${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e4) return `${sym}${(v / 1e3).toFixed(0)}k`;
  return money(v, cur);
}

export const num = (n: number | null | undefined, digits = 0) =>
  Number(n ?? 0).toLocaleString("en-NG", { maximumFractionDigits: digits });

export function fmtDate(s?: string | null) {
  if (!s) return "";
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export const fmtDay = (s: string) =>
  new Date(`${s}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Yesterday in Lagos (UTC+1): the latest day with a complete rainfall total. Call only in the browser. */
export const yesterday = () => new Date(Date.now() + 3600e3 - 86400e3).toISOString().slice(0, 10);

export const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;

export function download(filename: string, content: string, type = "text/plain") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
