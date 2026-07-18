import { apiOk, handleApiError } from "@/lib/api/response";
import { listBadgeCatalog } from "@/services/weeklyBadgeService";

// 활성 배지 카탈로그 12종 (React Query 길게 캐시)
export async function GET() {
  try {
    return apiOk({ badges: await listBadgeCatalog() });
  } catch (error) {
    return handleApiError(error);
  }
}
