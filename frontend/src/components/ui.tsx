// Small building blocks shared by every page.
import Link from "next/link";
import { STATUS, type Tone } from "@/lib/perils";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "ghost" | "danger" | "soft";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  ghost: "border border-line bg-transparent text-ink hover:bg-surface-2",
  danger: "border border-line bg-transparent text-critical hover:bg-surface-2",
  soft: "bg-surface-2 text-ink hover:brightness-95",
};
const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-progress disabled:opacity-55";
const sizes = { md: "px-3.5 py-2 text-sm", sm: "px-2.5 py-1 text-[13px]" };

export function Button({
  variant = "soft",
  size = "md",
  busy,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "sm"; busy?: boolean }) {
  return (
    <button {...props} disabled={busy || props.disabled} className={cx(btnBase, variants[variant], sizes[size], className)}>
      {busy ? "Working…" : children}
    </button>
  );
}

export function LinkButton({ href, variant = "soft", size = "md", children }: { href: string; variant?: Variant; size?: "md" | "sm"; children: React.ReactNode }) {
  return (
    <Link href={href} className={cx(btnBase, variants[variant], sizes[size], "hover:no-underline")}>
      {children}
    </Link>
  );
}

export function PageHead({ title, sub, crumb, actions }: { title: React.ReactNode; sub?: React.ReactNode; crumb?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {crumb && <div className="mb-1 text-[13px] text-ink-3">{crumb}</div>}
        <h1 className="flex flex-wrap items-center gap-2.5 text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-ink-2">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cx("rounded-xl border border-line bg-surface p-5 shadow-sm", className)}>{children}</section>;
}

export function CardHead({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-[17px] font-semibold">{title}</h2>
        {sub && <p className="mt-0.5 text-[13px] text-ink-2">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Tile({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4.5 py-4 shadow-sm">
      <div className="text-[13px] text-ink-2">{label}</div>
      <div className="mt-1 text-[26px] font-semibold tracking-tight tabular-nums">{value}</div>
      {sub && <div className="mt-0.5 text-[13px] text-ink-3">{sub}</div>}
    </div>
  );
}

const dot: Record<Tone, string> = {
  good: "bg-good",
  warning: "bg-warning",
  serious: "bg-serious",
  critical: "bg-critical",
  info: "bg-info",
  neutral: "bg-neutral",
};

/** Status badge: the dot carries colour, the text carries meaning. */
export function Badge({ status, tone, label }: { status?: string; tone?: Tone; label?: string }) {
  const [t, l] = status ? (STATUS[status] ?? ["neutral", status]) : [tone ?? "neutral", label ?? ""];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-0.5 pr-2.5 pl-2 text-[13px] font-medium whitespace-nowrap text-ink">
      <span className={cx("size-2 rounded-full", dot[t])} />
      {label ?? l}
    </span>
  );
}

export function Field({ label, hint, children, className }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("flex min-w-0 flex-col gap-1 text-[13px] font-medium text-ink-2", className)}>
      {label}
      {children}
      {hint && <small className="font-normal text-ink-3">{hint}</small>}
    </label>
  );
}

export function Empty({ title, children }: { title?: string; children?: React.ReactNode }) {
  return (
    <div className="px-4 py-9 text-center text-ink-2">
      {title && <h3 className="mb-1.5 font-semibold text-ink">{title}</h3>}
      {children}
    </div>
  );
}

export const Spinner = ({ label = "Loading…" }: { label?: string }) => <div className="py-10 text-center text-ink-3">{label}</div>;

export function ErrorBox({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-critical bg-surface px-3.5 py-3 whitespace-pre-line text-ink">{children}</div>;
}

export function Callout({ children, warn, className }: { children: React.ReactNode; warn?: boolean; className?: string }) {
  return (
    <div className={cx("rounded-lg px-3.5 py-3 text-sm text-ink", warn ? "border-l-3 border-warning bg-surface-2" : "bg-accent-soft", className)}>
      {children}
    </div>
  );
}

export const Table = ({ children }: { children: React.ReactNode }) => (
  <div className="-mx-1 overflow-x-auto">
    <table className="w-full border-collapse text-sm">{children}</table>
  </div>
);
export const Th = ({ children, num }: { children?: React.ReactNode; num?: boolean }) => (
  <th className={cx("border-b border-line px-2.5 py-2 text-xs font-semibold tracking-wide whitespace-nowrap text-ink-2 uppercase", num ? "text-right" : "text-left")}>
    {children}
  </th>
);
export const Td = ({ children, num, className }: { children?: React.ReactNode; num?: boolean; className?: string }) => (
  <td className={cx("border-b border-grid px-2.5 py-2.5 align-middle", num && "text-right whitespace-nowrap tabular-nums", className)}>{children}</td>
);

export function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-[34px] place-items-center rounded-[9px] bg-accent" aria-hidden="true">
        <svg viewBox="0 0 32 32" className="size-5 fill-on-accent">
          <path d="M16 6c-4 6-7 9.5-7 13a7 7 0 0 0 14 0c0-3.5-3-7-7-13z" />
        </svg>
      </span>
      <span>
        <strong className="block text-base">ClimaSure</strong>
        <small className="block text-xs text-ink-3">Weather triggers</small>
      </span>
    </div>
  );
}

export { cx };
