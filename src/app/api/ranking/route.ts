import { apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { getRanking } from "@/services/rankingService";

// 랭킹 (운영자 전용 — 순위는 매장에서 발표한다)
export async function GET() {
  try {
    await requireAdmin();
    return apiOk(await getRanking());
  } catch (error) {
    return handleApiError(error);
  }
}
