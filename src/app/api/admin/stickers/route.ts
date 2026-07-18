import { z } from "zod";
import { apiError, apiOk, handleApiError } from "@/lib/api/response";
import { requireAdmin } from "@/lib/auth/guards";
import {
  createSticker,
  deleteSticker,
  listStickers,
  setStickerActive,
  updateSticker,
} from "@/services/stickerService";

// 어드민 스티커 관리 — 최종 권한 검증은 requireAdmin이 담당.
export async function GET() {
  try {
    await requireAdmin();
    return apiOk({ stickers: await listStickers(false) });
  } catch (error) {
    return handleApiError(error);
  }
}

const createSchema = z.object({
  id: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(60),
  imageDataUri: z.string().min(1),
  sortOrder: z.number().int().optional(),
});

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    await createSticker(parsed.data);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

const patchSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string().trim().min(1).max(60).optional(),
  sortOrder: z.number().int().optional(),
  imageDataUri: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return apiError("VALIDATION", parsed.error.issues[0].message);
    }
    const { id, isActive, label, sortOrder, imageDataUri } = parsed.data;
    if (isActive !== undefined) await setStickerActive(id, isActive);
    if (label !== undefined || sortOrder !== undefined || imageDataUri !== undefined) {
      await updateSticker(id, { label, sortOrder, imageDataUri });
    }
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    await requireAdmin();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return apiError("VALIDATION", "삭제할 스티커 id가 필요합니다.");
    await deleteSticker(id);
    return apiOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
