import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { placeOrderSchema } from "@/lib/validation/order";
import { cancelLimitOrder, listMyOrders, placeLimitOrder } from "@/services/orderService";

// 내 지정가 주문 목록 (미체결 + 최근 내역) — 조회 시 lazy 소급 정산 수행
export async function GET() {
  try {
    const user = await requireUser();
    return apiOk(await listMyOrders(user.id));
  } catch (error) {
    return handleApiError(error);
  }
}

// 지정가 주문 접수 (즉시 충족이면 서버가 즉시 시장가 체결)
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const parsed = placeOrderSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    return apiOk(await placeLimitOrder(user.id, parsed.data));
  } catch (error) {
    return handleApiError(error);
  }
}

// 미체결 지정가 취소 (?id=)
export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return apiError("VALIDATION", "취소할 주문 id가 필요합니다.");
    }
    await cancelLimitOrder(user.id, id);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
