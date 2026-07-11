import { z } from "zod";

// 매매 요청: 수량만 받는다 — 가격은 서버가 현재 틱에서 결정 (아키텍처 원칙 1)
export const tradeSchema = z.object({
  stockCode: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  quantity: z
    .number()
    .int("수량은 정수여야 합니다")
    .positive("수량은 1 이상이어야 합니다")
    .max(1_000_000, "수량이 너무 큽니다"),
});

export type TradeInput = z.infer<typeof tradeSchema>;
