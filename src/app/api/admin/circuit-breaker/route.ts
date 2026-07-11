import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { setCircuitBreaker } from "@/services/adminService";

const schema = z.object({ minutes: z.number().int().min(1).max(60).nullable() });

// minutes: null이면 해제
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "정지 시간은 1~60분 또는 null(해제)이어야 합니다.");
    }
    return apiOk(await setCircuitBreaker(parsed.data.minutes));
  } catch (error) {
    return handleApiError(error);
  }
}
