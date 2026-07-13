import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { triggerSurpriseEvent } from "@/services/adminService";

const schema = z.object({
  stockCode: z.string().min(1),
  bias: z.number().int().min(-30).max(30),
  // 편향 적용 시간(분, 30분 단위) — null이면 남은 시간 전체
  durationMinutes: z.number().int().multipleOf(30).min(30).max(420).nullable().default(null),
});

// 시세 조정: 특정 종목의 남은 오늘 경로를 새 편향으로 재생성
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError(
        "VALIDATION",
        "종목 코드, -30~30 편향, 30분 단위 적용 시간이 필요합니다."
      );
    }
    return apiOk(
      await triggerSurpriseEvent(
        parsed.data.stockCode.toUpperCase(),
        parsed.data.bias,
        parsed.data.durationMinutes
      )
    );
  } catch (error) {
    return handleApiError(error);
  }
}
