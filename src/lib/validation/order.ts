import { z } from "zod";

// 지정가 예약주문 접수 (PRD §4.5).
// 매수는 금액(원) 기준, 매도는 수량(주) 기준. 지정가는 정수 원.
// 체결·밴드밖 차단·즉시 시장가 체결 여부는 전부 서버(place_limit_order)가 판정한다.
export const placeOrderSchema = z
  .object({
    stockCode: z.string().min(1),
    side: z.enum(["buy", "sell"]),
    limitPrice: z
      .number()
      .int("지정가는 정수여야 합니다")
      .positive("지정가는 1 이상이어야 합니다")
      .max(1_000_000_000, "지정가가 너무 큽니다"),
    // 매수 예약 금액 (정수 원)
    amount: z
      .number()
      .int("금액은 정수여야 합니다")
      .positive("금액은 1 이상이어야 합니다")
      .max(100_000_000, "금액이 너무 큽니다")
      .optional(),
    // 매도 예약 수량 (소수점 주식 — 서버가 6자리 절사)
    quantity: z
      .number()
      .positive("수량은 0보다 커야 합니다")
      .max(1_000_000, "수량이 너무 큽니다")
      .optional(),
  })
  .refine((d) => (d.side === "buy" ? d.amount != null && d.quantity == null : true), {
    message: "매수는 금액(amount)만 지정해야 합니다",
  })
  .refine((d) => (d.side === "sell" ? d.quantity != null && d.amount == null : true), {
    message: "매도는 수량(quantity)만 지정해야 합니다",
  });

export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;
