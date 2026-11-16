"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "./session";
import { Brand, Button, cx } from "./ui";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/policies", label: "Policies" },
  { href: "/payouts", label: "Payouts" },
  { href: "/design", label: "Product design" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar() {
  const path = usePathname();
  const { me, signOut } = useSession();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <aside className="sticky top-0 flex flex-wrap items-center gap-2 border-b border-line bg-surface px-4 py-2.5 md:h-screen md:w-58 md:shrink-0 md:flex-col md:flex-nowrap md:items-stretch md:border-r md:border-b-0 md:px-3.5 md:py-5">
      <Link href="/" className="text-ink hover:no-underline md:px-2 md:pb-5">
        <Brand />
      </Link>
      <nav aria-label="Main" className="order-3 flex w-full gap-0.5 overflow-x-auto md:order-none md:flex-col">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cx(
              "rounded-lg px-2.5 py-2 font-medium whitespace-nowrap hover:no-underline",
              active(n.href) ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
            )}
          >
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-2 md:mt-auto md:ml-0 md:flex-col md:items-stretch md:border-t md:border-line md:px-2 md:pt-3">
        {me && (
          <div className="hidden text-[13px] break-words text-ink-2 md:block">
            <strong className="text-ink">{me.name}</strong>
            <br />
            <span className="text-ink-3">{me.id}</span>
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </div>
    </aside>
  );
}
