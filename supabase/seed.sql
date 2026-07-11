-- 로컬 개발·리허설 전용 시드 (T-004)
-- `supabase db reset` 시에만 적용된다. 프로덕션에는 절대 넣지 않는다.
-- (종목·기준가·게임 설정은 마이그레이션 20260713000000_reference_data.sql로 이동)

-- 테스트 가입 코드
insert into signup_codes (code) values
  ('TEST-0001'), ('TEST-0002'), ('TEST-0003'), ('TEST-0004'), ('TEST-0005'),
  ('TEST-0006'), ('TEST-0007'), ('TEST-0008'), ('TEST-0009'), ('TEST-0010');

-- 오늘 날짜 방문 코드 (KST 기준, 개발 편의용 고정값)
insert into visit_codes (date, code) values
  ((now() at time zone 'Asia/Seoul')::date, 'VISIT-TEST');
