"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { postJson } from "@/lib/api/client";
import { hangulToQwerty, withHangulToQwerty } from "@/lib/hangulToQwerty";
import { loginSchema, type LoginInput } from "@/lib/validation/auth";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  async function onSubmit(values: LoginInput) {
    try {
      // 한글 IME 잔여물 방지: 제출 직전에도 한 번 더 영문 변환
      await postJson("/api/auth/login", { ...values, password: hangulToQwerty(values.password) });
      // 로그인 전 캐시된 비로그인 상태(me 등)를 비워 헤더 버튼·잔고가 즉시 갱신되게 한다
      queryClient.clear();
      // 보호 라우트에서 넘어온 경우 원래 목적지로 (외부 URL 방지: 경로만 허용)
      const next = searchParams.get("next");
      router.push(next?.startsWith("/") ? next : "/");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "로그인에 실패했습니다.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>로그인</CardTitle>
        <CardDescription>닉네임과 비밀번호를 입력해주세요</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!errors.nickname}>
              <FieldLabel htmlFor="nickname">닉네임</FieldLabel>
              <Input
                id="nickname"
                autoComplete="username"
                aria-invalid={!!errors.nickname}
                {...register("nickname")}
              />
              <FieldError errors={[errors.nickname]} />
            </Field>
            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="password">비밀번호</FieldLabel>
              {/* 한/영 전환을 깜빡해도 두벌식 자판 기준 영문으로 입력되게 변환 */}
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={!!errors.password}
                {...withHangulToQwerty(register("password"))}
              />
              <FieldError errors={[errors.password]} />
            </Field>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "로그인 중..." : "로그인"}
            </Button>
          </FieldGroup>
        </form>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          아직 계좌가 없나요?{" "}
          <Link href="/signup" className="text-primary-accent underline underline-offset-4">
            계좌 개설
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

// useSearchParams는 Suspense 경계가 필요하다
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
