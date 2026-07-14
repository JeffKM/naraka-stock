import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import {
  deleteManualNews,
  listManualNews,
  publishNews,
} from "@/services/adminService";

// 수동 뉴스는 항상 찌라시(rumor) — 등급 선택 없이 출처(기자·매체명)만 입력받는다.
const schema = z.object({
  stockCode: z.string().nullable(),
  source: z.string().min(1).max(30),
  title: z.string().min(1).max(100),
  body: z.string().min(1).max(500),
});

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    return apiOk(
      await publishNews({
        ...parsed.data,
        stockCode: parsed.data.stockCode?.toUpperCase() ?? null,
      })
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET() {
  try {
    await requireAdmin();
    return apiOk({ items: await listManualNews() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return apiError("VALIDATION", "삭제할 뉴스 id가 올바르지 않습니다.");
    }
    const result = await deleteManualNews(id);
    if (result.deleted === 0) {
      return apiError("NOT_FOUND", "삭제할 수동 뉴스를 찾을 수 없습니다.");
    }
    return apiOk(result);
  } catch (error) {
    return handleApiError(error);
  }
}
