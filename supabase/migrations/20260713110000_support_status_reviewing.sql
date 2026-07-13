-- 고객센터 상태 3단계: open(접수완료) / reviewing(검토중) / done(답변완료)
-- 기존 2단계(open/done)에 운영자가 "보고 있다"를 표시할 중간 단계를 추가한다.

alter table support_posts drop constraint support_posts_status_check;
alter table support_posts add constraint support_posts_status_check
  check (status in ('open', 'reviewing', 'done'));
