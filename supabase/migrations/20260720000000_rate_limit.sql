-- 요청 속도 제한 (rate limit) — 무차별 대입·스팸 방어
--
-- 배경: 상품이 걸린 이벤트라 로그인 무차별 대입(약한 비밀번호 탈취), 방문 보너스
-- 코드 추측, 가입 API 스팸이 실질 위협이다. Cloudflare 같은 앞단 프록시 대신,
-- 이 프로젝트 철학(모든 상태는 서버/DB, 아키텍처 원칙 1)에 맞게 DB에서 처리한다.
-- Vercel 서버리스는 인스턴스가 매 요청 갈릴 수 있어 인메모리 카운터는 신뢰할 수 없다.
--
-- 고정 윈도우(fixed window) 방식: 버킷별로 윈도우 시작 시각과 카운트를 들고,
-- 윈도우가 지나면 리셋한다. upsert 단일 문장이라 동시 요청에도 원자적이다.

create table rate_limits (
  bucket text primary key, -- 예: 'login:ip:1.2.3.4', 'login:nick:홍길동'
  window_start timestamptz not null default now(),
  count int not null default 0
);

-- 오래된 버킷 정리용 (배치/수동 청소 시 인덱스 활용)
create index rate_limits_window_start_idx on rate_limits (window_start);

-- 전 테이블 기본 차단 관례에 맞춤 (service_role만 접근, 클라이언트 직접 접근 봉쇄)
alter table rate_limits enable row level security;
alter table rate_limits force row level security;

-- 요청 1건을 기록하고 허용 여부를 반환한다.
--   반환: true = 허용(한도 이내), false = 차단(한도 초과)
--   p_at은 테스트용 시각 오버라이드 (실서비스는 now()).
create or replace function check_rate_limit(
  p_bucket text,
  p_limit int,
  p_window_seconds int,
  p_at timestamptz default now()
) returns boolean
language plpgsql
as $$
declare
  v_count int;
  v_expired boolean;
begin
  -- upsert 단일 문장으로 원자적 증가. 윈도우가 만료됐으면 1로 리셋하고 시작 시각 갱신.
  insert into rate_limits (bucket, window_start, count)
    values (p_bucket, p_at, 1)
  on conflict (bucket) do update
    set count = case
          when rate_limits.window_start < p_at - make_interval(secs => p_window_seconds)
            then 1
          else rate_limits.count + 1
        end,
        window_start = case
          when rate_limits.window_start < p_at - make_interval(secs => p_window_seconds)
            then p_at
          else rate_limits.window_start
        end
    returning count into v_count;

  return v_count <= p_limit;
end $$;
