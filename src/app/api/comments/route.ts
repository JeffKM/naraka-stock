import { apiOk, handleApiError } from "@/lib/api/response";
import { getSession } from "@/lib/auth/session";
import { listAllComments } from "@/services/commentService";

// 전 종목 댓글 모아보기 (토론 세그먼트) — 비로그인도 조회, 로그인 시 mine/likedByMe 표시
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const pageParam = Number(params.get("page") ?? "1");
    const page = Number.isInteger(pageParam) && pageParam >= 1 ? pageParam : 1;
    const session = await getSession();
    return apiOk({
      comments: await listAllComments(session?.uid ?? null, page),
      viewerIsAdmin: session?.isAdmin ?? false,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
