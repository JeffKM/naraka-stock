-- 프로덕션 계정 정리: 방문자1 → 방문자 강등, 닉네임 "사장" → "쪼꼬"로 변경
--
-- 실행 방법: Supabase 대시보드 → SQL Editor에 붙여넣고 Run
--   (또는 supabase CLI가 프로덕션에 링크돼 있으면 `supabase db execute -f scripts/swap-admin-jjoko.sql`)
--
-- 안전장치: 대상 계정이 실제로 존재하는지 확인한 뒤에만 변경한다.
-- 대상이 없거나, 바꿀 닉네임 "쪼꼬"가 이미 존재하면 예외를 던지고 전체를 롤백한다.

begin;

do $$
begin
  -- 방문자1: 어드민 → 방문자 강등 (권한만 변경)
  if not exists (select 1 from users where nickname = '방문자1') then
    raise exception '계정 "방문자1"을 찾을 수 없습니다. 닉네임을 확인하세요.';
  end if;
  update users set is_admin = false where nickname = '방문자1';

  -- 닉네임 "사장" 계정 → "쪼꼬"로 이름 변경 (권한 등 나머지는 그대로 유지)
  if not exists (select 1 from users where nickname = '사장') then
    raise exception '닉네임 "사장"인 계정을 찾을 수 없습니다. 닉네임을 확인하세요.';
  end if;
  if exists (select 1 from users where nickname = '쪼꼬') then
    raise exception '닉네임 "쪼꼬"가 이미 사용 중입니다. (nickname unique 제약)';
  end if;
  update users set nickname = '쪼꼬' where nickname = '사장';

  raise notice '완료: 방문자1 강등, "사장" → "쪼꼬" 닉네임 변경';
end $$;

-- 변경 결과 확인 (방문자1: is_admin=f / 쪼꼬: 기존 권한 유지)
select id, nickname, is_admin
  from users
  where nickname in ('방문자1', '쪼꼬')
  order by nickname;

commit;
