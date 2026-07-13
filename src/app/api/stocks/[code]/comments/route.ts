import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { getSession } from "@/lib/auth/session";
import { createComment, deleteComment, listComments } from "@/services/commentService";

type RouteContext = { params: Promise<{ code: string }> };

// 댓글 목록 — 비로그인도 볼 수 있고, 로그인 상태면 내 댓글 표시(mine)가 붙는다
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { code } = await params;
    const session = await getSession();
    return apiOk({
      comments: await listComments(code.toUpperCase(), session?.uid ?? null),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const createSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "내용을 입력해주세요")
    .max(200, "댓글은 200자 이하로 입력해주세요"),
});

// 댓글 작성
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const user = await requireUser();
    const { code } = await params;
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    await createComment(user.id, code.toUpperCase(), parsed.data.content);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

// 본인 댓글 삭제 (?id=)
export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return apiError("VALIDATION", "삭제할 댓글 id가 필요합니다.");
    }
    await deleteComment(user.id, id);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
