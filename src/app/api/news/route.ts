import { apiOk, handleApiError } from "@/lib/api/response";
import { getNewsFeed } from "@/services/newsService";

// 뉴스 피드 (공개 API)
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const stock = params.get("stock");
    const outlet = params.get("outlet");
    const pageParam = Number(params.get("page") ?? "1");
    const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
    return apiOk(
      await getNewsFeed(
        { stockCode: stock ? stock.toUpperCase() : null, outletSlug: outlet },
        page
      )
    );
  } catch (error) {
    return handleApiError(error);
  }
}
