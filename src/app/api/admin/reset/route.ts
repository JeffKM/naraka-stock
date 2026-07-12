import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { resetRehearsalData } from "@/services/adminService";

const schema = z.object({ confirm: z.literal("초기화") });

// 리허설 데이터 초기화 — 파괴적 작업이라 확인 문구를 요구한다
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "확인 문구('초기화')가 필요합니다.");
    }
    return apiOk(await resetRehearsalData());
  } catch (error) {
    return handleApiError(error);
  }
}
