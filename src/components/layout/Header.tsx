import Link from "next/link";
import { MarketStatusBadge } from "./MarketStatusBadge";

// 상단 고정 헤더: 로고 + 장 상태 배지
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-lg items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-1.5 font-heading text-lg font-bold">
          <span aria-hidden>🦋</span>
          <span>
            <span className="text-primary">나라카</span>증권
          </span>
        </Link>
        <MarketStatusBadge />
      </div>
    </header>
  );
}
