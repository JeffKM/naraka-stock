import { z } from "zod";

// 고객센터 글 작성
export const supportPostSchema = z.object({
  category: z.enum(["bug", "inquiry", "suggestion"]),
  content: z
    .string()
    .trim()
    .min(2, "내용을 2자 이상 입력해주세요")
    .max(1000, "내용은 1,000자 이하로 입력해주세요"),
});

// 운영자 답변/상태 변경
export const supportAnswerSchema = z.object({
  id: z.number().int(),
  reply: z.string().trim().max(1000, "답변은 1,000자 이하로 입력해주세요").optional(),
  status: z.enum(["open", "done"]).optional(),
});

export type SupportPostInput = z.infer<typeof supportPostSchema>;
export type SupportAnswerInput = z.infer<typeof supportAnswerSchema>;
