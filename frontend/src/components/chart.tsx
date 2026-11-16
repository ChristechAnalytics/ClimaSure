"use client";

import { useEffect, useRef, useState } from "react";
import { num } from "@/lib/format";

export interface Point {
  x: string;
  y: number;
  tip?: string;
}

interface ChartProps {
  points: Point[];
  kind?: "bar" | "line";
  refs?: { y: number; label: string }[];
  fmt?: (v: number) => string;
  xfmt?: (x: string) => string;
  height?: number;
  label: string;
  /** Bars failing this test are drawn dimmer (e.g. days that don't count). */
  highlight?: (p: Point) => boolean;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** Single-series chart: thin bars or a 2px line, dashed reference lines, hover tooltip, data table. */
export function Chart({ points, kind = "bar", refs = [], fmt = (v) => num(v, 1), xfmt = (x) => x, height = 240, label, highlight }: ChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = height;
  const m = { t: 18, r: 16, b: 28, l: 52 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const n = points.length;
  const ymax = niceMax(Math.max(1, ...points.map((p) => p.y), ...refs.map((r) => r.y)) * 1.08);
  const y = (v: number) => m.t + ih - (v / ymax) * ih;
  const band = iw / Math.max(1, n);
  const xc = (i: number) => (kind === "bar" ? m.l + band * (i + 0.5) : m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw));
  const step = Math.max(1, Math.ceil(n / 7));
  const barW = Math.max(1, band - 2); // 2px surface gap between bars

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    const i = kind === "bar" ? Math.floor((px - m.l) / band) : Math.round(((px - m.l) / iw) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  const hp = hover !== null ? points[hover] : null;

  return (
    <div>
      <div ref={wrap} className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block h-auto w-full overflow-visible">
          {[0, 1, 2, 3, 4].map((k) => {
            const v = (ymax * k) / 4;
            return (
              <g key={k}>
                <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className={k ? "stroke-grid" : "stroke-line"} />
                <text x={m.l - 8} y={y(v) + 4} textAnchor="end" className="fill-ink-3 text-[11px]">
                  {fmt(v)}
                </text>
              </g>
            );
          })}
          {points.map((p, i) =>
            i % step === 0 ? (
              <text key={p.x} x={xc(i)} y={H - 8} textAnchor="middle" className="fill-ink-3 text-[11px]">
                {xfmt(p.x)}
              </text>
            ) : null,
          )}

          {kind === "bar" &&
            points.map((p, i) => {
              if (p.y <= 0) return null;
              const x0 = xc(i) - barW / 2;
              const top = y(p.y);
              const base = y(0);
              const r = Math.min(4, barW / 2, base - top);
              const d = `M${x0},${base}V${top + r}Q${x0},${top} ${x0 + r},${top}H${x0 + barW - r}Q${x0 + barW},${top} ${x0 + barW},${top + r}V${base}Z`;
              const dim = highlight && !highlight(p);
              return <path key={p.x} d={d} className={`fill-series ${dim ? "opacity-40" : ""} ${hover === i ? "brightness-110" : ""}`} />;
            })}

          {kind === "line" && n > 0 && (
            <path
              d={points.map((p, i) => `${i ? "L" : "M"}${xc(i).toFixed(1)},${y(p.y).toFixed(1)}`).join("")}
              className="fill-none stroke-series"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {refs.map((r) => (
            <g key={r.label}>
              <line x1={m.l} x2={W - m.r} y1={y(r.y)} y2={y(r.y)} className="stroke-ink-2" strokeWidth={1.5} strokeDasharray="5 4" />
              <text x={W - m.r} y={y(r.y) - 5} textAnchor="end" className="fill-ink-2 text-[11px] font-semibold">
                {r.label}
              </text>
            </g>
          ))}

          {hp && hover !== null && (
            <>
              <line x1={xc(hover)} x2={xc(hover)} y1={m.t} y2={m.t + ih} className="stroke-ink-3" />
              {kind === "line" && <circle cx={xc(hover)} cy={y(hp.y)} r={5} className="fill-series stroke-surface" strokeWidth={2} />}
            </>
          )}
          <rect x={m.l} y={0} width={Math.max(0, iw)} height={H} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>

        {hp && hover !== null && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[110%] rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap text-ink shadow-md"
            style={{ left: `${(xc(hover) / W) * 100}%`, top: `${(y(hp.y) / H) * 100}%` }}
          >
            <b className="block text-[13px]">{fmt(hp.y)}</b>
            {hp.tip ?? xfmt(hp.x)}
          </div>
        )}
      </div>

      <details className="mt-2.5 text-[13px]">
        <summary className="cursor-pointer text-ink-2">Show data table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <tbody>
              {points.map((p) => (
                <tr key={p.x} className="border-b border-grid">
                  <td className="px-2 py-1">{p.tip ?? xfmt(p.x)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{fmt(p.y)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
