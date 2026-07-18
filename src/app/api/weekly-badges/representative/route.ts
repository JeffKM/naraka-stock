import { apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { resolveDisplayWeekStart, setRepresentativeBadge } from "@/services/weeklyBadgeService";

// 대표 배지 설정 (표시 주차 = 최근 정산 완료 주, 폴백: 진행 중 주 보유분만). badgeId=null이면 해제.
// 미보유 배지면 서비스가 ApiException("VALIDATION")을 던지고 handleApiError가 400으로 변환.
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const body = (await request.json()) as { badgeId?: string | null };
    const badgeId = body.badgeId ?? null;
    const weekStart = await resolveDisplayWeekStart();
    await setRepresentativeBadge(user.id, badgeId, weekStart);
    return apiOk({ representativeBadgeId: badgeId });
  } catch (error) {
    return handleApiError(error);
  }
}
