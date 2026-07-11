import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { tradeSchema } from "@/lib/validation/trade";
import { executeTrade } from "@/services/tradeService";

// 시장가 매수/매도 (T-302) — 가격은 서버가 결정, 클라이언트는 수량만 보낸다
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const parsed = tradeSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    return apiOk(await executeTrade(user.id, parsed.data));
  } catch (error) {
    return handleApiError(error);
  }
}
