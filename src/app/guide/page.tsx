import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "게임 방법" };

const RULES = [
  {
    title: "나라카증권이란?",
    body: "요괴 컨셉카페 나라카의 8월 한정 모의 주식 게임입니다. 가상 화폐 100만원으로 시작해 8월 30일(일) 장 마감까지 총자산을 가장 많이 불린 4명이 상품을 받습니다.",
  },
  {
    title: "⏰ 장 시간",
    body: "매일 12:00 ~ 22:00에 장이 열리고, 주가는 5분마다 움직입니다. 장 시간과 휴장일은 매장 사정에 따라 바뀔 수 있어요 (시세판 하단 안내 참고).",
  },
  {
    title: "시작 자금과 방문 보너스",
    body: "계좌 개설 시 1,000,000원이 지급됩니다. 매장에 방문하면 게시된 오늘의 코드로 하루 한 번 +100,000원을 더 받을 수 있어요.",
  },
  {
    title: "매매 규칙",
    body: "주문은 시장가만 가능하고, 현재 표시 가격으로 즉시 체결됩니다. 매도할 때만 수수료 0.3%가 빠져나갑니다. 하루 등락폭은 전일 종가의 ±30%로 제한됩니다.",
  },
  {
    title: "뉴스 읽는 법",
    body: "공시는 어제의 사실(100%), 정식 뉴스는 내일에 대한 힌트(적중률 90%), 찌라시는 반쯤 소문(적중률 55%)입니다. 다만 재료가 있어도 시장이 꼭 그대로 움직이진 않으니 과신은 금물!",
  },
  {
    title: "배당",
    body: "우량주(나라카전자·옥자디아)를 들고 있으면 매주 금요일 장 마감 때 보유 평가액의 1%가 현금으로 들어옵니다.",
  },
  {
    title: "거래 정지",
    body: "주가가 급변하면 해당 종목이 5분간 거래 정지(VI)됩니다. 시장 전체가 요동칠 땐 서킷브레이커로 전 종목이 잠시 멈출 수도 있습니다.",
  },
  {
    title: "순위와 상품",
    body: "순위는 총자산(현금+보유 주식 평가액) 기준입니다. 최종 순위는 8월 30일(일) 22:00 종가로 확정되며, 결과는 매장에서 발표됩니다. 부정행위(다계정 등)가 적발되면 계정이 정지됩니다.",
  },
];

// 게임 방법 (T-406)
export default function GuidePage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">게임 방법</h1>
      {RULES.map((rule) => (
        <Card key={rule.title}>
          <CardHeader>
            <CardTitle className="text-base">{rule.title}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-relaxed text-muted-foreground">
            {rule.body}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
