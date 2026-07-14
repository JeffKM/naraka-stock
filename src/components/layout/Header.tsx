import Image from "next/image";
import Link from "next/link";
import { AuthButton } from "./AuthButton";
import { MarketStatusBadge } from "./MarketStatusBadge";
import { SettingsDialog } from "./SettingsDialog";

// 상단 고정 헤더: 나라카 로고 + 장 상태 배지 + 설정 + 로그인/로그아웃
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-lg items-center justify-between px-4">
        <Link href="/" aria-label="나라카증권 홈">
          <Image src="/logo.png" alt="나라카증권" width={94} height={40} priority className="dark:invert" />
        </Link>
        <div className="flex items-center gap-2">
          <MarketStatusBadge />
          <SettingsDialog />
          <AuthButton />
        </div>
      </div>
    </header>
  );
}
