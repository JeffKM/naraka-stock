import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import {
  createSignupCodes,
  deleteUnusedSignupCodes,
  listSignupCodes,
} from "@/services/adminService";

export async function GET() {
  try {
    await requireAdmin();
    return apiOk(await listSignupCodes());
  } catch (error) {
    return handleApiError(error);
  }
}

const createSchema = z.object({
  count: z.number().int().min(1).max(200),
  isAdmin: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "생성 개수는 1~200 사이여야 합니다.");
    }
    return apiOk({
      codes: await createSignupCodes(parsed.data.count, parsed.data.isAdmin),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE() {
  try {
    await requireAdmin();
    return apiOk({ deleted: await deleteUnusedSignupCodes() });
  } catch (error) {
    return handleApiError(error);
  }
}
