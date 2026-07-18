import { apiOk, handleApiError } from "@/lib/api/response";
import { getSession } from "@/lib/auth/session";
import { getNewsFeed } from "@/services/newsService";

// 뉴스 피드 (공개 API) — 로그인 시 본인 반응(myReaction) 표시
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const stock = params.get("stock");
    const outlet = params.get("outlet");
    const pageParam = Number(params.get("page") ?? "1");
    const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
    const session = await getSession();
    return apiOk(
      await getNewsFeed(
        { stockCode: stock ? stock.toUpperCase() : null, outletSlug: outlet },
        page,
        session?.uid ?? null
      )
    );
  } catch (error) {
    return handleApiError(error);
  }
}
