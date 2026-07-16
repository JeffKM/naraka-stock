-- 관심종목 테이블 및 토글 함수
-- 사용자가 특정 종목을 관심 목록에 추가/제거할 수 있습니다.

create table if not exists watchlists (
  user_id bigint not null references users(id) on delete cascade,
  stock_code text not null references stocks(code) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, stock_code)
);

-- RLS: service-role 접근만 허용 (정책 없음 = 클라이언트 직접 접근 차단)
alter table watchlists enable row level security;

-- 관심종목 토글 함수
-- 이미 등록되어 있으면 삭제 후 false 반환
-- 등록되지 않았으면 삽입 후 true 반환
create or replace function toggle_watchlist(p_user_id bigint, p_stock_code text)
returns boolean language plpgsql as $$
begin
  delete from watchlists where user_id = p_user_id and stock_code = p_stock_code;
  if found then
    return false;
  end if;
  insert into watchlists (user_id, stock_code) values (p_user_id, p_stock_code);
  return true;
end $$;
