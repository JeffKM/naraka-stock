import { apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { getUserWeeklyBadges, resolveDisplayWeekStart } from "@/services/weeklyBadgeService";

// 본인 표시 주차(최근 정산 완료 주, 폴백: 진행 중 주) 보유 배지
export async function GET() {
  try {
    const user = await requireUser();
    const weekStart = await resolveDisplayWeekStart();
    const badges = await getUserWeeklyBadges(user.id, weekStart);
    return apiOk({ weekStart, badges });
  } catch (error) {
    return handleApiError(error);
  }
}
