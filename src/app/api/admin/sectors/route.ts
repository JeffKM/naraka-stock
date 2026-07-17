import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import {
  createSector,
  deleteSector,
  listSectors,
  updateSector,
} from "@/services/adminService";

export async function GET() {
  try {
    await requireAdmin();
    return apiOk({ sectors: await listSectors() });
  } catch (error) {
    return handleApiError(error);
  }
}

const codeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,29}$/, "섹터 코드는 소문자 slug(영문 소문자로 시작)여야 합니다");

const createSchema = z.object({
  code: codeSchema,
  labelKo: z.string().min(1).max(20),
  sortOrder: z.number().int().min(0).max(9999).default(100),
});

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    await createSector(parsed.data);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

const updateSchema = z.object({
  code: z.string().min(1),
  labelKo: z.string().min(1).max(20).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "code와 수정할 값(labelKo/sortOrder)이 필요합니다.");
    }
    const { code, ...patch } = parsed.data;
    await updateSector(code, patch);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

const deleteSchema = z.object({ code: z.string().min(1) });

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    const parsed = deleteSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", "code가 필요합니다.");
    }
    await deleteSector(parsed.data.code);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
