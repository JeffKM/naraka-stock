"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mascot } from "@/components/mascot/Mascot";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api/client";
import { hangulToQwerty, withHangulToQwerty } from "@/lib/hangulToQwerty";
import { signupSchema } from "@/lib/validation/auth";

// 비밀번호 확인은 클라이언트 전용 검증 (이메일이 없어 분실 시 복구 불가 → 오타 방지)
const formSchema = signupSchema
  .extend({ passwordConfirm: z.string() })
  .refine((v) => v.password === v.passwordConfirm, {
    message: "비밀번호가 일치하지 않습니다",
    path: ["passwordConfirm"],
  });

type FormValues = z.infer<typeof formSchema>;

export default function SignupPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(formSchema) });

  async function onSubmit(values: FormValues) {
    try {
      const result = await postJson<{ status: "active" | "pending" }>(
        "/api/auth/signup",
        {
          code: values.code,
          nickname: values.nickname,
          // 한글 IME 잔여물 방지: 제출 직전에도 한 번 더 영문 변환
          password: hangulToQwerty(values.password),
        }
      );
      // 손님 코드는 매장 승인 대기 상태로 접수된다. 자동 로그인 없이 로그인 페이지로 안내한다.
      if (result.status === "pending") {
        toast.success("가입 요청이 접수되었습니다. 매장 승인 후 로그인해주세요");
        router.push("/login");
        return;
      }
      // 어드민 코드는 자동 로그인이므로 캐시된 비로그인 상태(me 등)를 비워 헤더가 즉시 갱신되게 한다
      queryClient.clear();
      toast.success("계좌 개설 완료! 10,000,000원이 지급되었습니다");
      router.push("/");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "가입에 실패했습니다.");
    }
  }

  return (
    <Card>
      <CardHeader className="items-center text-center">
        <Mascot pose="wave" size={96} />
        <CardTitle>나라카에 온 걸 환영해요</CardTitle>
        <CardDescription>
          매장에서 받은 가입 코드로 나라카증권 계좌를 만들어보세요
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!errors.code}>
              <FieldLabel htmlFor="code">가입 코드</FieldLabel>
              <Input
                id="code"
                placeholder="매장 발급 코드"
                autoComplete="off"
                aria-invalid={!!errors.code}
                {...register("code")}
              />
              <FieldError errors={[errors.code]} />
            </Field>
            <Field data-invalid={!!errors.nickname}>
              <FieldLabel htmlFor="nickname">닉네임</FieldLabel>
              <Input
                id="nickname"
                placeholder="2~8자, 랭킹에 공개됩니다"
                aria-invalid={!!errors.nickname}
                {...register("nickname")}
              />
              <FieldError errors={[errors.nickname]} />
            </Field>
            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="password">비밀번호</FieldLabel>
              {/* 한/영 전환을 깜빡해도 두벌식 자판 기준 영문으로 입력되게 변환 (로그인과 동일 규칙) */}
              <Input
                id="password"
                type="password"
                placeholder="영문·숫자·특수문자 포함 8~16자"
                autoComplete="new-password"
                aria-invalid={!!errors.password}
                {...withHangulToQwerty(register("password"))}
              />
              <FieldError errors={[errors.password]} />
            </Field>
            <Field data-invalid={!!errors.passwordConfirm}>
              <FieldLabel htmlFor="passwordConfirm">비밀번호 확인</FieldLabel>
              <Input
                id="passwordConfirm"
                type="password"
                autoComplete="new-password"
                aria-invalid={!!errors.passwordConfirm}
                {...withHangulToQwerty(register("passwordConfirm"))}
              />
              <FieldError errors={[errors.passwordConfirm]} />
            </Field>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "개설 중..." : "계좌 개설"}
            </Button>
          </FieldGroup>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          이미 계좌가 있나요?{" "}
          <Link href="/login" className="text-primary-accent underline underline-offset-4">
            로그인
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
