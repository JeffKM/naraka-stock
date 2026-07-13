import { apiOk, handleApiError } from "@/lib/api/response";
import { getPopularStocks } from "@/services/popularService";

// 실시간 인기 종목 (최근 10분 체결 건수 상위) — 익명 집계라 공개 API
export async function GET() {
  try {
    return apiOk({ stocks: await getPopularStocks() });
  } catch (error) {
    return handleApiError(error);
  }
}
