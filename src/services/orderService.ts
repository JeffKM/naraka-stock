import "server-only";
import { ApiException } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import type { PlaceOrderInput } from "@/lib/validation/order";
import type { LimitOrder, OrderStatus, TradeSide } from "@/types/domain";
import type { ApiErrorCode } from "@/types/api";

// 지정가 접수 결과: 즉시 시장가 체결(immediate)이면 체결 정보, 아니면 예약 주문 정보
export interface PlaceOrderResult {
  immediate: boolean;
  orderId?: number;
  price?: number; // immediate=true 일 때 체결가
  quantity?: number;
  limitPrice?: number;
}

// DB 함수의 도메인 예외 → ApiException 매핑 (execute_trade 매핑 + 지정가 전용 2종)
const DB_ERROR_MAP: Array<{ token: string; code: ApiErrorCode; message: string }> = [
  { token: "MARKET_CLOSED", code: "MARKET_CLOSED", message: "지금은 장 시간이 아닙니다." },
  { token: "TRADING_HALTED", code: "TRADING_HALTED", message: "거래가 일시 정지된 종목입니다." },
  { token: "INSUFFICIENT_CASH", code: "INSUFFICIENT_CASH", message: "주문 가능 현금이 부족합니다." },
  {
    token: "INSUFFICIENT_QUANTITY",
    code: "INSUFFICIENT_QUANTITY",
    message: "주문 가능 수량이 부족합니다.",
  },
  { token: "BAND_OUT", code: "BAND_OUT", message: "지정가가 오늘 상하한가(±30%) 범위를 벗어났습니다." },
  {
    token: "ORDER_LIMIT",
    code: "ORDER_LIMIT",
    message: "미체결 지정가 주문은 최대 10건까지만 걸 수 있습니다.",
  },
  { token: "BANNED", code: "BANNED", message: "정지된 계정입니다." },
  { token: "VALIDATION", code: "VALIDATION", message: "잘못된 주문입니다." },
];

function mapDbError(error: { message: string }): ApiException {
  const mapped = DB_ERROR_MAP.find((m) => error.message.includes(m.token));
  if (mapped) return new ApiException(mapped.code, mapped.message);
  return new ApiException("INTERNAL", "주문 처리 중 오류가 발생했습니다.");
}

// 지정가 접수 (T-1002): 밴드밖 차단·즉시 시장가 체결·예약은 전부 place_limit_order가 처리
export async function placeLimitOrder(
  userId: number,
  input: PlaceOrderInput
): Promise<PlaceOrderResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("place_limit_order", {
    p_user_id: userId,
    p_stock_code: input.stockCode,
    p_side: input.side,
    p_limit_price: input.limitPrice,
    p_amount: input.amount ?? null,
    p_quantity: input.quantity ?? null,
  });
  if (error) throw mapDbError(error);

  const r = data as Record<string, unknown>;
  return {
    immediate: Boolean(r.immediate),
    orderId: r.orderId != null ? Number(r.orderId) : undefined,
    price: r.price != null ? Number(r.price) : undefined,
    quantity: r.quantity != null ? Number(r.quantity) : undefined,
    limitPrice: r.limitPrice != null ? Number(r.limitPrice) : undefined,
  };
}

// 미체결 지정가 취소 (T-1004): 예약을 물리적으로 옮기지 않았으므로 상태만 되돌리면 끝(환불 없음).
// 정산과의 경쟁은 status='pending' 가드로 해소된다(이미 체결됐으면 0건 → 취소 불가).
export async function cancelLimitOrder(userId: number, orderId: number): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .eq("id", orderId)
    .eq("user_id", userId)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new ApiException("NOT_FOUND", "취소할 수 있는 미체결 주문이 아닙니다.");
  }
}

// 접근 시 소급 정산 (lazy): 사용자의 미체결 주문을 now()까지 정산한다.
// 실패해도 화면 조회를 막지 않도록 best-effort (폐장 배치가 최종 보증).
export async function settleUserOrders(userId: number): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.rpc("settle_limit_orders", { p_user_id: userId });
  if (error) console.error("[orders] lazy 정산 실패:", error.message);
}

interface OrderRow {
  id: number;
  stock_code: string;
  side: string;
  limit_price: number;
  reserved_cash: number | null;
  reserved_qty: string | null;
  status: string;
  created_at: string;
  filled_at: string | null;
  filled_price: number | null;
  filled_qty: string | null;
  stocks: { name: string } | { name: string }[];
}

function toOrder(row: OrderRow): LimitOrder {
  const name = (row.stocks as unknown as { name: string }).name;
  return {
    id: row.id,
    stockCode: row.stock_code,
    stockName: name,
    side: row.side as TradeSide,
    limitPrice: row.limit_price,
    reservedCash: row.reserved_cash,
    reservedQty: row.reserved_qty != null ? Number(row.reserved_qty) : null,
    status: row.status as OrderStatus,
    createdAt: row.created_at,
    filledAt: row.filled_at,
    filledPrice: row.filled_price,
    filledQty: row.filled_qty != null ? Number(row.filled_qty) : null,
  };
}

export interface OrderList {
  pending: LimitOrder[];
  history: LimitOrder[];
}

// 내 지정가 주문 목록 (조회 전 lazy 정산 → 방금 체결된 건이 바로 반영된다)
export async function listMyOrders(userId: number): Promise<OrderList> {
  await settleUserOrders(userId);
  const supabase = getSupabaseAdmin();
  const cols =
    "id, stock_code, side, limit_price, reserved_cash, reserved_qty, status, created_at, filled_at, filled_price, filled_qty, stocks(name)";

  const [{ data: pending, error: pErr }, { data: history, error: hErr }] = await Promise.all([
    supabase
      .from("orders")
      .select(cols)
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: true }),
    // 내역은 체결·만료만 (취소는 사용자가 직접 한 것이라 목록에 남기지 않는다)
    supabase
      .from("orders")
      .select(cols)
      .eq("user_id", userId)
      .in("status", ["filled", "expired"])
      .order("created_at", { ascending: false })
      .limit(30),
  ]);
  if (pErr) throw pErr;
  if (hErr) throw hErr;

  return {
    pending: (pending as OrderRow[]).map(toOrder),
    history: (history as OrderRow[]).map(toOrder),
  };
}
