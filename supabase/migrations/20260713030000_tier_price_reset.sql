-- 등급·기준가 재설정 (사장님 콘솔 변경 반영 + 가격 규칙 재적용, 2026-07-12)
--
-- 등급 (콘솔에서 변경된 최종안):
--   우량주: 나라카전자, 옥자디아 / 일반주: 나라카증권·나라카모터스·메루크로소프트·바나존
--   테마주: 미호엔터테인먼트, 나라카바이오
-- 가격 규칙: 우량주 10만원 이상 / 일반주 3만원 이상 / 테마주 저가 (진입 재미)

update stocks set tier = 'stable' where code in ('NRKE', 'OKJA');
update stocks set tier = 'normal' where code in ('NRKS', 'NRKM', 'MERU', 'BNZN');
update stocks set tier = 'wild' where code in ('MIHO', 'NRKB');

update daily_summary set open = 128000, high = 128000, low = 128000, close = 128000
  where stock_code = 'NRKE' and date = '2026-07-31';
update daily_summary set open = 105000, high = 105000, low = 105000, close = 105000
  where stock_code = 'OKJA' and date = '2026-07-31';
update daily_summary set open = 68000, high = 68000, low = 68000, close = 68000
  where stock_code = 'MERU' and date = '2026-07-31';
update daily_summary set open = 62000, high = 62000, low = 62000, close = 62000
  where stock_code = 'NRKS' and date = '2026-07-31';
update daily_summary set open = 45000, high = 45000, low = 45000, close = 45000
  where stock_code = 'NRKM' and date = '2026-07-31';
update daily_summary set open = 38000, high = 38000, low = 38000, close = 38000
  where stock_code = 'BNZN' and date = '2026-07-31';
update daily_summary set open = 18000, high = 18000, low = 18000, close = 18000
  where stock_code = 'MIHO' and date = '2026-07-31';
update daily_summary set open = 6400, high = 6400, low = 6400, close = 6400
  where stock_code = 'NRKB' and date = '2026-07-31';
