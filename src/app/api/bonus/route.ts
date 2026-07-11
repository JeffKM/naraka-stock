import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
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
    return apiOk(await claimVisitBonus(user.id, parsed.data.code));
  } catch (error) {
    return handleApiError(error);
  }
}
