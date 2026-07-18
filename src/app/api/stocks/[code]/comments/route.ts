import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { getSession } from "@/lib/auth/session";
import {
  adminDeleteComment,
  createComment,
  deleteComment,
  listComments,
  updateComment,
} from "@/services/commentService";

type RouteContext = { params: Promise<{ code: string }> };

// 댓글 목록 — 비로그인도 볼 수 있고, 로그인 상태면 내 댓글 표시(mine)가 붙는다
export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { code } = await params;
    const session = await getSession();
    return apiOk({
      comments: await listComments(code.toUpperCase(), session?.uid ?? null),
      // UI 삭제 버튼 노출용 힌트 — 실제 삭제 권한은 DELETE 핸들러가 DB로 재검증한다
      viewerIsAdmin: session?.isAdmin ?? false,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const contentField = z
  .string()
  .trim()
  .min(1, "내용을 입력해주세요")
  .max(200, "댓글은 200자 이하로 입력해주세요");

const stickerIdField = z.string().trim().min(1).max(64);

const createSchema = z
  .object({
    content: contentField.optional(),
    stickerId: stickerIdField.optional(),
  })
  .refine((d) => Boolean(d.content) || Boolean(d.stickerId), {
    message: "내용이나 스티커를 입력해주세요",
  });

const updateSchema = z.object({
  id: z.number().int().positive(),
  content: contentField,
});

// 댓글 작성 (텍스트·스티커 중 최소 하나)
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const user = await requireUser();
    const { code } = await params;
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    await createComment(
      user.id,
      code.toUpperCase(),
      parsed.data.content ?? null,
      parsed.data.stickerId ?? null
    );
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

// 본인 댓글 수정
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    await updateComment(user.id, parsed.data.id, parsed.data.content);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

// 댓글 삭제 (?id=) — 본인 것만, 단 어드민은 어떤 댓글이든 삭제 가능
export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return apiError("VALIDATION", "삭제할 댓글 id가 필요합니다.");
    }
    if (user.isAdmin) {
      await adminDeleteComment(id);
    } else {
      await deleteComment(user.id, id);
    }
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
