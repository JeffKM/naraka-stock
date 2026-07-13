"use client";

import { useCountUp } from "@/hooks/useCountUp";
import { usePriceWiggle } from "@/hooks/usePriceWiggle";
import { useQuotes } from "@/hooks/useQuotes";
import { formatMoney } from "@/lib/market";
import { cn } from "@/lib/utils";

// 총자산 실시간 연출 (홈 자산 카드 + 지갑 공용):
// - 실제 값 변화(5분 틱·체결)엔 카운트업 + 등락색 플래시
// - 틱 사이엔 주식 평가액 부분만 ±0.1% 미세 진동 (현금만 있으면 안 움직인다)
// 순수 표시용 눈속임 — 체결·정산은 항상 서버 값 (아키텍처 원칙 4).
export function LiveTotalAssets({
  cash,
  totalAssets,
  className,
}: {
  cash: number;
  totalAssets: number;
  className?: string;
}) {
  const { data: quotesData } = useQuotes();
  const stockValue = totalAssets - cash;
  const liveStock = usePriceWiggle(
    stockValue,
    quotesData?.marketState === "open" && stockValue > 0
  );
  const real = useCountUp(totalAssets); // 방향·플래시 — 실제 변화에만 반응
  const smooth = useCountUp(cash + liveStock, 700); // 표시 숫자 — 진동까지 부드럽게

  return (
    <p
      key={real.seq}
      className={cn(
        "tabular-nums",
        real.direction === "up" && "animate-flash-bull",
        real.direction === "down" && "animate-flash-bear",
        className
      )}
    >
      {formatMoney(smooth.display)}
    </p>
  );
}
