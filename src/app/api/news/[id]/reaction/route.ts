import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { toggleNewsReaction } from "@/services/newsService";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z.object({ kind: z.enum(["up", "down"]) });

// 뉴스 카드 엄지업/엄지다운 토글 (로그인 필요)
export async function POST(request: Request, { params }: RouteContext) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const newsId = Number(id);
    if (!Number.isInteger(newsId) || newsId <= 0) {
      return apiError("VALIDATION", "잘못된 뉴스 id입니다.");
    }
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "잘못된 반응 종류입니다.");
    }
    return apiOk(await toggleNewsReaction(user.id, newsId, parsed.data.kind));
  } catch (error) {
    return handleApiError(error);
  }
}
