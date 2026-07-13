import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { clearTodayMarketHours, setTodayMarketHours } from "@/services/adminService";

const overrideSchema = z
  .object({
    openHour: z.number().int().min(0).max(23),
    closeHour: z.number().int().min(1).max(24),
  })
  .refine((d) => d.closeHour > d.openHour, {
    message: "마감 시간은 개장 시간보다 늦어야 합니다",
  });

// 오늘 하루만 장 시간 변경 (자정 폐장 후 ~ 당일 개장 전에만 허용)
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const parsed = overrideSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    return apiOk(await setTodayMarketHours(parsed.data.openHour, parsed.data.closeHour));
  } catch (error) {
    return handleApiError(error);
  }
}

// 오늘 오버라이드 해제 → 기본 장 시간으로 복귀
export async function DELETE() {
  try {
    await requireAdmin();
    await clearTodayMarketHours();
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
