import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { toggleCommentLike } from "@/services/commentService";

type RouteContext = { params: Promise<{ id: string }> };

// 댓글 엄지업 토글 (로그인 필요)
export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const commentId = Number(id);
    if (!Number.isInteger(commentId) || commentId <= 0) {
      return apiError("VALIDATION", "잘못된 댓글 id입니다.");
    }
    return apiOk(await toggleCommentLike(user.id, commentId));
  } catch (error) {
    return handleApiError(error);
  }
}
