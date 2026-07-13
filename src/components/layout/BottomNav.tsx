"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Headset } from "lucide-react";
import { Newspaper } from "lucide-react";
import { TrendingUp } from "lucide-react";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

// 랭킹은 운영자 콘솔 전용 (순위는 매장에서 발표)
// 거래내역은 지갑 페이지에 통합, 그 자리에 고객센터 탭
const TABS = [
  { href: "/", label: "시세", icon: TrendingUp },
  { href: "/news", label: "뉴스", icon: Newspaper },
  { href: "/portfolio", label: "지갑", icon: Wallet },
  { href: "/support", label: "고객센터", icon: Headset },
] as const;

// 탭 아이콘 — 해당 탭으로 이동 중이면 깜빡여서 "누른 게 반응했다"는 피드백을 준다
function TabIcon({ icon: Icon }: { icon: (typeof TABS)[number]["icon"] }) {
  const { pending } = useLinkStatus();
  return <Icon className={cn("size-5", pending && "animate-pulse text-primary")} aria-hidden />;
}

// 모바일 하단 탭 내비게이션 — 운영자 콘솔에서는 숨긴다
export function BottomNav() {
  const pathname = usePathname();

  if (pathname.startsWith("/admin")) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
      <div className="mx-auto grid w-full max-w-lg grid-cols-4 pb-[env(safe-area-inset-bottom)]">
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
              <TabIcon icon={Icon} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
