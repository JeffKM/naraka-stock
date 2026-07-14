import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { supportEditSchema, supportPostSchema } from "@/lib/validation/support";
import {
  createSupportPost,
  deleteMySupportPost,
  listMySupportPosts,
  updateMySupportPost,
} from "@/services/supportService";

// 내가 남긴 문의 목록
export async function GET() {
  try {
    const user = await requireUser();
    return apiOk({ posts: await listMySupportPosts(user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}

// 문의 접수
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const parsed = supportPostSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    const post = await createSupportPost(
      user.id,
      parsed.data.category,
      parsed.data.content
    );
    return apiOk({ post });
  } catch (error) {
    return handleApiError(error);
  }
}

// 본인 문의 수정 (접수완료 상태에서만)
export async function PATCH(request: Request) {
  try {
    const user = await requireUser();
    const parsed = supportEditSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    await updateMySupportPost(user.id, parsed.data.id, parsed.data.content);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

// 본인 문의 삭제 (접수완료 상태에서만, ?id=)
export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return apiError("VALIDATION", "삭제할 문의 id가 필요합니다.");
    }
    await deleteMySupportPost(user.id, id);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
