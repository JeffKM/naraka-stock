import "server-only";
import { ApiException } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { TradeInput } from "@/lib/validation/trade";
import type { ApiErrorCode } from "@/types/api";

export interface TradeResult {
  tradeId: number;
  price: number;
  quantity: number;
  fee: number;
  cash: number;
}

// DB 함수의 도메인 예외 → ApiException 매핑
const DB_ERROR_MAP: Array<{ token: string; code: ApiErrorCode; message: string }> = [
  { token: "MARKET_CLOSED", code: "MARKET_CLOSED", message: "지금은 장 시간이 아닙니다." },
  { token: "TRADING_HALTED", code: "TRADING_HALTED", message: "거래가 일시 정지된 종목입니다." },
  { token: "INSUFFICIENT_CASH", code: "INSUFFICIENT_CASH", message: "잔고가 부족합니다." },
  { token: "INSUFFICIENT_QUANTITY", code: "INSUFFICIENT_QUANTITY", message: "보유 수량이 부족합니다." },
  { token: "BANNED", code: "BANNED", message: "정지된 계정입니다." },
  { token: "VALIDATION", code: "VALIDATION", message: "잘못된 주문입니다." },
];

// 시장가 체결 (T-301/302): 검증·체결·기록 전부 execute_trade 단일 트랜잭션
export async function executeTrade(userId: number, input: TradeInput): Promise<TradeResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("execute_trade", {
    p_user_id: userId,
    p_stock_code: input.stockCode,
    p_side: input.side,
    p_quantity: input.quantity,
  });

  if (error) {
    const mapped = DB_ERROR_MAP.find((m) => error.message.includes(m.token));
    if (mapped) throw new ApiException(mapped.code, mapped.message);
    throw error;
  }

  return data as TradeResult;
}
