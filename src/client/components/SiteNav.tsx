"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { Logo } from "@/client/components/Logo";
import { ThemeToggle } from "@/client/components/ThemeToggle";

const LINKS = [
  {
    href: "/",
    label: "コース",
  },
  {
    href: "/training",
    label: "トレーニング",
  },
];

/**
 * 全ページ共通のヘッダーナビ。現在ページをハイライトし、テーマ切替を備える。
 */
export const SiteNav = (): React.JSX.Element => {
  const pathname = usePathname();
  return (
    <nav
      className="sticky top-0 z-30 flex h-[var(--nav-h)] shrink-0 items-center gap-1 border-b border-border bg-surface/85 backdrop-blur supports-[backdrop-filter]:bg-surface/70"
      style={{
        paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
        paddingRight: "max(0.75rem, env(safe-area-inset-right))",
      }}
    >
      <Link href="/" aria-label="runon ホーム" className="mr-1 shrink-0 sm:mr-3">
        <Logo />
      </Link>

      <div className="flex min-w-0 items-center gap-1">
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={`whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-accent-soft text-accent-soft-fg"
                  : "text-muted hover:bg-surface-2 hover:text-fg"
              }`}
            >
              {l.label}
            </Link>
          );
        })}
      </div>

      <div className="ml-auto shrink-0">
        <ThemeToggle />
      </div>
    </nav>
  );
};
