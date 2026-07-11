import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { publishNews } from "@/services/adminService";

const schema = z.object({
  stockCode: z.string().nullable(),
  grade: z.enum(["disclosure", "news", "rumor"]),
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
