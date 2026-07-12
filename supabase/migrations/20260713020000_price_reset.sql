-- 기준가 재설정 (사장님 확정 2026-07-12)
-- 우량주 10만원 이상 / 일반주 3만원 이상 / 테마주는 저가 유지 (진입 장벽 낮은 재미 요소)

update daily_summary set open = 128000, high = 128000, low = 128000, close = 128000
  where stock_code = 'NRKE' and date = '2026-07-31';
update daily_summary set open = 105000, high = 105000, low = 105000, close = 105000
  where stock_code = 'NRKS' and date = '2026-07-31';
update daily_summary set open = 45000, high = 45000, low = 45000, close = 45000
  where stock_code = 'NRKM' and date = '2026-07-31';
update daily_summary set open = 32000, high = 32000, low = 32000, close = 32000
  where stock_code = 'MIHO' and date = '2026-07-31';
update daily_summary set open = 68000, high = 68000, low = 68000, close = 68000
  where stock_code = 'MERU' and date = '2026-07-31';
update daily_summary set open = 38000, high = 38000, low = 38000, close = 38000
  where stock_code = 'BNZN' and date = '2026-07-31';
-- OKJA 9,800 / NRKB 6,400 유지
