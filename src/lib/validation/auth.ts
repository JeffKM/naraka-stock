import { z } from "zod";

// 닉네임: 2~8자 (DB check 제약과 동일), 한글·영문·숫자만
export const nicknameSchema = z
  .string()
  .min(2, "닉네임은 2자 이상이어야 합니다")
  .max(8, "닉네임은 8자 이하여야 합니다")
  .regex(/^[가-힣a-zA-Z0-9]+$/, "닉네임은 한글·영문·숫자만 사용할 수 있습니다");

// 비밀번호: 8~16자, 영문·숫자·특수문자 각 1자 이상 포함
export const passwordSchema = z
  .string()
  .min(8, "비밀번호는 8자 이상이어야 합니다")
  .max(16, "비밀번호는 16자 이하여야 합니다")
  .regex(/[a-zA-Z]/, "비밀번호에 영문을 포함해주세요")
  .regex(/[0-9]/, "비밀번호에 숫자를 포함해주세요")
  .regex(/[^a-zA-Z0-9]/, "비밀번호에 특수문자를 포함해주세요");

export const signupSchema = z.object({
  code: z.string().min(1, "가입 코드를 입력해주세요"),
  nickname: nicknameSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  nickname: z.string().min(1, "닉네임을 입력해주세요"),
  password: z.string().min(1, "비밀번호를 입력해주세요"),
});

export const visitBonusSchema = z.object({
  code: z.string().min(1, "방문 코드를 입력해주세요"),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type VisitBonusInput = z.infer<typeof visitBonusSchema>;
