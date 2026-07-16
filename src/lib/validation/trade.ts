import { z } from "zod";

// 매매 요청: 금액(원) 또는 수량(주) 중 정확히 하나. 체결가는 서버가 현재 틱에서
// 결정한다 (아키텍처 원칙 1). 매수는 금액 기준만, 매도는 금액·수량 둘 다 허용.
export const tradeSchema = z
  .object({
    stockCode: z.string().min(1),
    side: z.enum(["buy", "sell"]),
    // 금액 지정 (매수·매도 금액모드) — 정수 원
    amount: z
      .number()
      .int("금액은 정수여야 합니다")
      .positive("금액은 1 이상이어야 합니다")
      .max(100_000_000, "금액이 너무 큽니다")
      .optional(),
    // 수량 지정 (매도 수량모드 = 소수점 허용 / 매수 수량모드 = 정수, UI에서 보장·서버 재검증)
    quantity: z
      .number()
      .positive("수량은 0보다 커야 합니다")
      .max(1_000_000, "수량이 너무 큽니다")
      .optional(),
  })
  .refine((d) => (d.amount == null) !== (d.quantity == null), {
    message: "금액 또는 수량 중 하나만 지정해야 합니다",
  });

export type TradeInput = z.infer<typeof tradeSchema>;
