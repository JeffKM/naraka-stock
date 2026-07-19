import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { enforceRateLimit, getClientIp } from "@/lib/rate-limit";
import { visitBonusSchema } from "@/lib/validation/auth";
import { claimVisitBonus } from "@/services/bonusService";

// 방문 보너스 코드 입력 (T-104)
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const parsed = visitBonusSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }

    // 코드 추측 방어: 계정 단위가 정밀 방어선(수령은 DB가 1일 1회 강제).
    // IP는 자동 대입만 차단하되 카페 공유 WiFi를 고려해 넉넉히 둔다.
    await enforceRateLimit(`bonus:user:${user.id}`, 20, 300);
    await enforceRateLimit(`bonus:ip:${getClientIp(request)}`, 120, 300);

    return apiOk(await claimVisitBonus(user.id, parsed.data.code));
  } catch (error) {
    return handleApiError(error);
  }
}
