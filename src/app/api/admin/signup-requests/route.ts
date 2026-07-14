import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import {
  approveSignupRequest,
  listSignupRequests,
  rejectSignupRequest,
} from "@/services/adminService";

// 대기 중인 손님 가입요청 목록
export async function GET() {
  try {
    await requireAdmin();
    return apiOk({ requests: await listSignupRequests() });
  } catch (error) {
    return handleApiError(error);
  }
}

const decideSchema = z.object({
  requestId: z.number().int(),
  action: z.enum(["approve", "reject"]),
});

// 가입요청 승인/거절
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = decideSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "requestId와 action이 필요합니다.");
    }
    if (parsed.data.action === "approve") {
      await approveSignupRequest(parsed.data.requestId, admin.id);
    } else {
      await rejectSignupRequest(parsed.data.requestId, admin.id);
    }
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
