import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import { adjustUserCash, searchUsers, setUserBanned } from "@/services/adminService";

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

// 현금 지급(양수)/회수(음수) — 오조작 방지로 1회 조정액 상한 1억원
const cashSchema = z.object({
  userId: z.number().int(),
  amount: z
    .number()
    .int("금액은 정수여야 합니다.")
    .refine((v) => v !== 0, "0원은 조정할 수 없습니다.")
    .refine((v) => Math.abs(v) <= 100_000_000, "1회 조정액은 1억원을 넘을 수 없습니다."),
  reason: z.string().max(100).optional(),
});

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = cashSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0]?.message ?? "잘못된 요청입니다.");
    }
    if (parsed.data.userId === admin.id) {
      return apiError("VALIDATION", "자기 자신은 조정할 수 없습니다.");
    }
    const { cash } = await adjustUserCash(
      parsed.data.userId,
      admin.id,
      parsed.data.amount,
      parsed.data.reason ?? ""
    );
    return apiOk({ cash });
  } catch (error) {
    return handleApiError(error);
  }
}
