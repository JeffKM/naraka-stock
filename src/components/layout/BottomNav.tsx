"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History } from "lucide-react";
import { Newspaper } from "lucide-react";
import { TrendingUp } from "lucide-react";
import { Trophy } from "lucide-react";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "시세", icon: TrendingUp },
  { href: "/news", label: "뉴스", icon: Newspaper },
  { href: "/ranking", label: "랭킹", icon: Trophy },
  { href: "/portfolio", label: "지갑", icon: Wallet },
  { href: "/history", label: "내역", icon: History },
] as const;

// 모바일 하단 탭 내비게이션 (5탭 고정)
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
      <div className="mx-auto grid w-full max-w-lg grid-cols-5 pb-[env(safe-area-inset-bottom)]">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[11px] transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
