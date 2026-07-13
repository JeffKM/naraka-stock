import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { supportAnswerSchema } from "@/lib/validation/support";
import { answerSupportPost, listSupportPosts } from "@/services/supportService";

// 문의 전체 목록 (?status=open|done 필터)
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const status = new URL(request.url).searchParams.get("status");
    return apiOk({
      posts: await listSupportPosts(
        status === "open" || status === "done" ? status : null
      ),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// 답변 저장 / 완료·미처리 상태 변경
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const parsed = supportAnswerSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    await answerSupportPost(parsed.data);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
