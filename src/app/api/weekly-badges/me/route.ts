import { apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { getUserWeeklyBadges, resolveCurrentWeekStart } from "@/services/weeklyBadgeService";

// 본인 이번 주 보유 배지 + 이번 주 시작일
export async function GET() {
  try {
    const user = await requireUser();
    const weekStart = await resolveCurrentWeekStart();
    const badges = await getUserWeeklyBadges(user.id, weekStart);
    return apiOk({ weekStart, badges });
  } catch (error) {
    return handleApiError(error);
  }
}
