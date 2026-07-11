import { apiOk, handleApiError } from "@/lib/api/response";
import { getChartData } from "@/services/chartService";

// 종목 차트 데이터 (T-402) — 미래 틱·미래 요약은 서버에서 차단
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await params;
    return apiOk(await getChartData(code.toUpperCase()));
  } catch (error) {
    return handleApiError(error);
  }
}
