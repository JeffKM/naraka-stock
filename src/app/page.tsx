import { Card, CardContent } from "@/components/ui/card";

// 시세판 홈 — Phase 4(T-401)에서 전 종목 전광판으로 교체 예정인 플레이스홀더
export default function Home() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">시세판</h1>
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <span className="text-5xl" aria-hidden>
            👹
          </span>
          <p className="font-medium">거래소 개장 준비 중</p>
          <p className="text-sm text-muted-foreground">
            2026년 8월 1일 15:00, 요괴들의 장이 열립니다
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
