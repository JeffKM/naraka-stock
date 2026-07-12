import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { createStock, listStocks, updateStockTier } from "@/services/adminService";

export async function GET() {
  try {
    await requireAdmin();
    return apiOk({ stocks: await listStocks() });
  } catch (error) {
    return handleApiError(error);
  }
}

const tierSchema = z.enum(["stable", "normal", "wild"]);

const createSchema = z.object({
  code: z
    .string()
    .regex(/^[A-Z0-9]{2,6}$/, "코드는 영문 대문자·숫자 2~6자여야 합니다"),
  name: z.string().min(1).max(20),
  tier: tierSchema,
  description: z.string().max(100).default(""),
  initialPrice: z
    .number()
    .int()
    .min(100, "상장가는 100원 이상이어야 합니다")
    .max(10_000_000, "상장가가 너무 큽니다"),
});

// 신규 상장
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    return apiOk(await createStock(parsed.data));
  } catch (error) {
    return handleApiError(error);
  }
}

const updateSchema = z.object({ code: z.string().min(1), tier: tierSchema });

// 등급 변경
export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "code와 tier(stable/normal/wild)가 필요합니다.");
    }
    await updateStockTier(parsed.data.code.toUpperCase(), parsed.data.tier);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
