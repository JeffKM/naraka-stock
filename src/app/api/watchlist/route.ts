import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireUser } from "@/lib/auth/guards";
import { getWatchlist, toggleWatchlist } from "@/services/watchlistService";

// 내 관심종목 코드 목록
export async function GET() {
  try {
    const user = await requireUser();
    return apiOk({ codes: await getWatchlist(user.id) });
  } catch (error) {
    return handleApiError(error);
  }
}

const toggleSchema = z.object({ stockCode: z.string().min(1) });

// 관심종목 등록/해제 토글
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const parsed = toggleSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    const watching = await toggleWatchlist(user.id, parsed.data.stockCode.toUpperCase());
    return apiOk({ watching });
  } catch (error) {
    return handleApiError(error);
  }
}
