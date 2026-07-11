import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { searchUsers, setUserBanned } from "@/services/adminService";

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return apiOk({ users: await searchUsers(q) });
  } catch (error) {
    return handleApiError(error);
  }
}

const banSchema = z.object({ userId: z.number().int(), banned: z.boolean() });

// 계정 정지/해제
export async function PATCH(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = banSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "userId와 banned가 필요합니다.");
    }
    if (parsed.data.userId === admin.id) {
      return apiError("VALIDATION", "자기 자신은 정지할 수 없습니다.");
    }
    await setUserBanned(parsed.data.userId, parsed.data.banned);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
