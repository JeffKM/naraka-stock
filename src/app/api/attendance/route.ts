import { apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { claimAttendanceBonus, getAttendanceStatus } from "@/services/bonusService";

// 출석 상태 조회 (오늘 수령 여부·스트릭·다음 금액)
export async function GET() {
  try {
    const user = await requireUser();
    return apiOk(await getAttendanceStatus(user.id));
  } catch (error) {
    return handleApiError(error);
  }
}

// 출석 보너스 수령 (하루 1회, 단순 접속 기준 — 입력값 없음)
export async function POST() {
  try {
    const user = await requireUser();
    return apiOk(await claimAttendanceBonus(user.id));
  } catch (error) {
    return handleApiError(error);
  }
}
