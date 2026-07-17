import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { setStockSector } from "@/services/adminService";

const schema = z.object({ code: z.string().min(1), sector: z.string().min(1) });

// 종목 섹터 재배치
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "code와 sector가 필요합니다.");
    }
    await setStockSector(parsed.data.code.toUpperCase(), parsed.data.sector);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
