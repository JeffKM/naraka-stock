import { apiOk, handleApiError } from "@/lib/api/response";
import { listStickers } from "@/services/stickerService";

// 공개 스티커 카탈로그(활성만). 클라이언트가 1회 캐시해 댓글의 sticker_id를 이미지로 매핑한다.
export async function GET() {
  try {
    const stickers = await listStickers(true);
    return apiOk({
      stickers: stickers.map((s) => ({ id: s.id, label: s.label, imageUrl: s.imageUrl })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
