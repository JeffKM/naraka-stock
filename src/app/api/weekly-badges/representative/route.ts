import { apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { resolveCurrentWeekStart, setRepresentativeBadge } from "@/services/weeklyBadgeService";

// 대표 배지 설정 (본인 이번 주 보유분만). badgeId=null이면 해제.
// 미보유 배지면 서비스가 ApiException("VALIDATION")을 던지고 handleApiError가 400으로 변환.
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { badgeId?: string | null };
    const badgeId = body.badgeId ?? null;
    const weekStart = await resolveCurrentWeekStart();
    await setRepresentativeBadge(user.id, badgeId, weekStart);
    return apiOk({ representativeBadgeId: badgeId });
  } catch (error) {
    return handleApiError(error);
  }
}
