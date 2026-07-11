import { apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { ensureVisitCodes } from "@/services/adminService";

// 오늘부터 14일치 방문 코드 자동 생성(없는 날짜만) + 조회
export async function GET() {
  try {
    await requireAdmin();
    return apiOk({ codes: await ensureVisitCodes(14) });
  } catch (error) {
    return handleApiError(error);
  }
}
