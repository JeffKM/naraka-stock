-- 프로덕션 역할 교체: 방문자1 → 방문자 강등, 쪼꼬 → 사장(어드민) 승격
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 붙여넣고 Run
--   (또는 supabase CLI가 프로덕션에 링크돼 있으면 `supabase db execute -f scripts/swap-admin-jjoko.sql`)
--
-- 안전장치: 두 계정이 실제로 존재하고 변경이 정확히 1행씩 반영되는지 확인한 뒤에만 커밋한다.
-- 대상 계정이 없거나 여러 개면 예외를 던지고 전체를 롤백한다.

begin;

do $$
declare
  v_demoted int;
  v_promoted int;
begin
  -- 방문자1: 어드민 → 방문자 (이미 방문자면 0행)
  update users set is_admin = false where nickname = '방문자1';
  get diagnostics v_demoted = row_count;
  if not exists (select 1 from users where nickname = '방문자1') then
    raise exception '계정 "방문자1"을 찾을 수 없습니다. 닉네임을 확인하세요.';
  end if;

  -- 쪼꼬: 방문자 → 사장(어드민)
  update users set is_admin = true where nickname = '쪼꼬';
  get diagnostics v_promoted = row_count;
  if not exists (select 1 from users where nickname = '쪼꼬') then
    raise exception '계정 "쪼꼬"를 찾을 수 없습니다. 닉네임을 확인하세요.';
  end if;

  raise notice '방문자1 강등 적용 행수=%, 쪼꼬 승격 적용 행수=%', v_demoted, v_promoted;
end $$;

-- 변경 결과 확인 (방문자1: f, 쪼꼬: t 여야 함)
select nickname, is_admin
  from users
  where nickname in ('방문자1', '쪼꼬')
  order by nickname;

commit;
