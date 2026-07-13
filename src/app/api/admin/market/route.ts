import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { getMarketSettings, updateMarketSettings } from "@/services/adminService";

export async function GET() {
  try {
    await requireAdmin();
    return apiOk(await getMarketSettings());
  } catch (error) {
    return handleApiError(error);
  }
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "날짜는 YYYY-MM-DD 형식입니다");

const settingsSchema = z
  .object({
    openHour: z.number().int().min(0).max(23),
    closeHour: z.number().int().min(1).max(24),
    // 7일 전부 휴장이면 배치가 경로를 만들 날이 없다 — 최대 6일
    closedWeekdays: z.array(z.number().int().min(1).max(7)).max(6),
    holidayExceptions: z.array(dateSchema).max(60),
    extraOpenDays: z.array(dateSchema).max(60),
  })
  .refine((d) => d.closeHour > d.openHour, {
    message: "마감 시간은 개장 시간보다 늦어야 합니다",
  });

// 장 운영 설정 변경 — 장 시간은 익일 배치 경로부터 완전 반영
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const parsed = settingsSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    await updateMarketSettings({
      ...parsed.data,
      closedWeekdays: [...new Set(parsed.data.closedWeekdays)].sort(),
      holidayExceptions: [...new Set(parsed.data.holidayExceptions)].sort(),
      extraOpenDays: [...new Set(parsed.data.extraOpenDays)].sort(),
    });
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
