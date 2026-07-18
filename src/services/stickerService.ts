import "server-only";
import { ApiException } from "@/lib/api/response";
import { getSupabaseAdmin } from "@/lib/supabase/server";

// 스티커 카탈로그 — 어드민이 관리, 유저 댓글에 첨부.
// 1단계는 이미지를 data URI로 DB에 저장한다. imageUrl 추상화로 2단계(Storage) 이관 대비.

export interface Sticker {
  id: string;
  label: string;
  imageUrl: string; // 1단계: data URI, 2단계: Storage 공개 URL
  sortOrder: number;
  isActive: boolean;
}

export interface StickerInput {
  id: string;
  label: string;
  imageDataUri: string;
  sortOrder?: number;
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DATA_URI_RE = /^data:image\/(png|jpe?g|webp|svg\+xml);base64,/;
const MAX_STICKER_BYTES = 100 * 1024; // 개당 100KB 상한

interface StickerRow {
  id: string;
  label: string;
  image_data_uri: string;
  sort_order: number;
  is_active: boolean;
}

function toSticker(row: StickerRow): Sticker {
  return {
    id: row.id,
    label: row.label,
    imageUrl: row.image_data_uri,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

function validateDataUri(imageDataUri: string): void {
  if (!DATA_URI_RE.test(imageDataUri)) {
    throw new ApiException("VALIDATION", "지원하지 않는 이미지 형식입니다. (png/jpeg/webp/svg)");
  }
  const base64 = imageDataUri.slice(imageDataUri.indexOf(",") + 1);
  const bytes = Buffer.from(base64, "base64").length;
  if (bytes > MAX_STICKER_BYTES) {
    throw new ApiException("VALIDATION", "스티커 이미지는 100KB 이하만 올릴 수 있어요.");
  }
}

export async function listStickers(activeOnly: boolean): Promise<Sticker[]> {
  const supabase = getSupabaseAdmin();
  let query = supabase
    .from("stickers")
    .select("id, label, image_data_uri, sort_order, is_active")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (activeOnly) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data as StickerRow[]).map(toSticker);
}

export async function createSticker(input: StickerInput): Promise<void> {
  if (!SLUG_RE.test(input.id)) {
    throw new ApiException("VALIDATION", "id는 영소문자·숫자·하이픈만 가능합니다.");
  }
  if (input.label.trim().length === 0) {
    throw new ApiException("VALIDATION", "라벨을 입력해주세요.");
  }
  validateDataUri(input.imageDataUri);
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("stickers").insert({
    id: input.id,
    label: input.label.trim(),
    image_data_uri: input.imageDataUri,
    sort_order: input.sortOrder ?? 0,
  });
  if (error) {
    if (error.code === "23505") throw new ApiException("VALIDATION", "이미 있는 스티커 id입니다.");
    throw error;
  }
}

export async function updateSticker(
  id: string,
  patch: { label?: string; sortOrder?: number; imageDataUri?: string }
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    if (patch.label.trim().length === 0) throw new ApiException("VALIDATION", "라벨을 입력해주세요.");
    update.label = patch.label.trim();
  }
  if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder;
  if (patch.imageDataUri !== undefined) {
    validateDataUri(patch.imageDataUri);
    update.image_data_uri = patch.imageDataUri;
  }
  if (Object.keys(update).length === 0) return;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stickers")
    .update(update)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiException("NOT_FOUND", "없는 스티커입니다.");
}

export async function setStickerActive(id: string, active: boolean): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stickers")
    .update({ is_active: active })
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiException("NOT_FOUND", "없는 스티커입니다.");
}

export async function deleteSticker(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  // stock_comments.sticker_id는 on delete set null FK이고, stock_comments엔
  // "content is not null or sticker_id is not null" 체크(has_body)가 걸려 있다.
  // 스티커 단독 댓글(content NULL, sticker_id=이 스티커)이 있는 상태로 스티커를
  // 곧장 삭제하면 SET NULL이 sticker_id를 지우면서 has_body를 위반해 DELETE 전체가
  // 실패한다. 그래서 스티커 삭제 전에 "텍스트 없이 스티커만 있던" 댓글을 먼저 지운다
  // (스티커가 사라지면 어차피 빈 댓글이 되므로 삭제가 맞다). 텍스트+스티커 댓글은
  // 그대로 두면 FK의 set null로 sticker_id만 NULL이 되어 텍스트만 남는다(has_body 충족).
  // admin-only 액션이라 두 단계 사이의 원자성(트랜잭션)은 요구하지 않는다.
  const { error: purgeError } = await supabase
    .from("stock_comments")
    .delete()
    .eq("sticker_id", id)
    .is("content", null);
  if (purgeError) throw purgeError;

  const { data, error } = await supabase
    .from("stickers")
    .delete()
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiException("NOT_FOUND", "없는 스티커입니다.");
}

// 댓글 작성 시 첨부 스티커가 실재하고 활성인지 검증한다.
export async function assertValidStickerId(id: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("stickers")
    .select("id")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiException("VALIDATION", "사용할 수 없는 스티커입니다.");
}
