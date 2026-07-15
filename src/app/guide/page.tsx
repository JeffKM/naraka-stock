import type { LucideIcon } from "lucide-react";
import {
  ClockIcon,
  CoinsIcon,
  GiftIcon,
  MessagesSquareIcon,
  OctagonMinusIcon,
  RepeatIcon,
  SparklesIcon,
  TimerIcon,
  TrophyIcon,
  UserPlusIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "게임 방법" };

type Rule = {
  icon: LucideIcon;
  title: string;
  // 문단(string) 또는 항목 목록(string[])으로 본문 구성
  body: string | string[];
};

const RULES: Rule[] = [
  {
    icon: SparklesIcon,
    title: "나라카증권이란?",
    body: "요괴들의 도시 나라카에서 열리는 8월 한정 모의 주식 게임입니다. 가상 화폐 100만원으로 요괴 테마 27개 종목을 사고팔며, 8월 30일(일) 장 마감까지 총자산을 가장 많이 불린 상위권 손님에게 매장에서 상품을 드립니다.",
  },
  {
    icon: UserPlusIcon,
    title: "계좌 만들기",
    body: "매장에서 발급한 가입 코드와 닉네임(2~8자), 비밀번호(8~16자)로 가입합니다. 손님 코드로 신청하면 매장 승인 후에 로그인할 수 있어요. 이메일은 필요 없습니다.",
  },
  {
    icon: GiftIcon,
    title: "시작 자금과 방문 보너스",
    body: "계좌를 만들면 1,000,000원이 지급됩니다. 매장에 방문해 게시된 '오늘의 코드'를 지갑 화면에 입력하면 하루 한 번 +100,000원을 더 받을 수 있어요.",
  },
  {
    icon: ClockIcon,
    title: "장 시간",
    body: "매일 낮 12:00부터 자정 24:00까지 장이 열리고, 주가는 5분마다 새로 움직입니다. 장 시간과 휴장일은 매장 사정에 따라 바뀔 수 있으니 시세판 하단 안내를 확인하세요.",
  },
  {
    icon: RepeatIcon,
    title: "사고팔기",
    body: [
      "시장가 주문은 지금 보이는 가격으로 즉시 체결됩니다.",
      "매수는 금액으로 주문해요. 원하는 금액을 넣으면 소수점 단위까지 나눠 담아 현금을 알뜰하게 쓸 수 있어요.",
      "매도할 때만 수수료 0.5%가 빠집니다. 매수 수수료는 없어요.",
      "하루 등락폭은 전일 종가의 ±30%로 제한됩니다.",
    ],
  },
  {
    icon: TimerIcon,
    title: "지정가 예약주문",
    body: "원하는 가격을 미리 지정해 두면, 장중 그 가격에 닿았을 때 자동으로 체결됩니다. 예약은 그날 장 마감에 사라지고 한 번에 최대 10건까지 걸 수 있어요. ±30% 등락 범위를 벗어난 가격은 접수되지 않습니다.",
  },
  {
    icon: CoinsIcon,
    title: "배당",
    body: "우량주를 들고 있으면 매주 금요일 장 마감 정산 때, 보유 수량 × 종가의 1%가 현금 배당으로 들어옵니다.",
  },
  {
    icon: OctagonMinusIcon,
    title: "거래 정지",
    body: "주가가 짧은 시간에 크게 급변하면 그 종목이 5분간 거래 정지(VI)됩니다. 시장 전체가 요동칠 땐 운영자가 서킷브레이커를 발동해 전 종목 매매를 잠시 멈출 수도 있어요.",
  },
  {
    icon: MessagesSquareIcon,
    title: "토론방과 문의",
    body: "종목 상세 화면에는 손님들이 함께 이야기 나누는 토론방이 있어요. 서비스에 문제가 있거나 건의할 게 있으면 하단 '문의' 탭에서 접수하면 운영자가 답해 드립니다.",
  },
  {
    icon: TrophyIcon,
    title: "순위와 상품",
    body: "순위는 총자산(현금 + 보유 주식 평가액) 기준입니다. 최종 순위는 8월 30일(일) 장 마감 종가로 확정되며, 결과는 매장에서 발표해요. 다계정 등 부정행위가 적발되면 계정이 정지됩니다.",
  },
];

// 게임 방법 (T-406) — 설정 모달의 '게임 방법' 버튼으로 진입
export default function GuidePage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">게임 방법</h1>
        <p className="text-sm text-muted-foreground">
          나라카증권을 처음 시작하기 전에 꼭 알아두면 좋은 규칙이에요.
        </p>
      </header>

      {RULES.map((rule) => {
        const Icon = rule.icon;
        return (
          <Card key={rule.title}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon className="size-4 shrink-0 text-primary-accent" />
                {rule.title}
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-relaxed text-muted-foreground">
              {Array.isArray(rule.body) ? (
                <ul className="flex flex-col gap-2">
                  {rule.body.map((line) => (
                    <li key={line} className="flex gap-2">
                      <span
                        aria-hidden
                        className="mt-2 size-1 shrink-0 rounded-full bg-primary/60"
                      />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                rule.body
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
