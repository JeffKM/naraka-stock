import { apiOk, handleApiError } from "@/lib/api/response";
import { getQuoteBoard } from "@/services/quoteService";

// 전 종목 현재가 (공개 API — 시세판은 비로그인도 볼 수 있다)
export async function GET() {
  try {
    return apiOk(await getQuoteBoard());
  } catch (error) {
    return handleApiError(error);
  }
}
