import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// 서버 전용 Supabase 클라이언트 (service role).
//
// 이 프로젝트는 커스텀 인증(닉네임+비밀번호)을 쓰므로 Supabase Auth·브라우저 클라이언트를
// 사용하지 않는다. 모든 DB 접근은 API route/Server Component에서 이 클라이언트로만 수행하고,
// RLS는 전 테이블 기본 차단으로 클라이언트의 직접 접근을 봉쇄한다 (PRD §9.1 조작 방지 원칙).
let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 환경 변수가 설정되지 않았습니다. (.env.example 참고)"
    );
  }

  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}
