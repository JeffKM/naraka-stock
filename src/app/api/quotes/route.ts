import { apiOk, handleApiError } from "@/lib/api/response";
import { getQuoteBoard } from "@/services/quoteService";

// 전 종목 현재가 (공개 API — 시세판은 비로그인도 볼 수 있다)
// getQuoteBoard는 쿠키/유저 컨텍스트를 읽지 않는 순수 공개 조회이며 현재 틱까지만
// 계산해 미래 틱을 반환하지 않으므로, 10초 틱 주기에 맞춰 엣지(CDN)에서 짧게 캐시해도
// 안전하다 — 오리진 계산을 10초당 1회로 공유해 폴링 부하를 줄인다.
export async function GET() {
  try {
    const res = apiOk(await getQuoteBoard());
    res.headers.set(
      "Cache-Control",
      "public, s-maxage=10, stale-while-revalidate=5"
    );
    return res;
  } catch (error) {
    return handleApiError(error);
  }
}
