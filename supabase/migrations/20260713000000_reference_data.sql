-- 운영 기준 데이터 (종목·기준가·게임 설정)
--
-- 테스트 계정·코드와 달리 이 데이터는 프로덕션에도 필요하므로 시드가 아니라
-- 마이그레이션으로 관리한다. 재실행·로컬 시드와의 충돌은 on conflict로 방어.

-- 종목 8종 (PRD §3.2 확정)
insert into stocks (code, name, tier, description) values
  ('NRKE', '나라카전자', 'stable', '나라카 그룹 대표 대형주. 저승 가전·부적 반도체의 절대 강자, 배당주.'),
  ('NRKS', '나라카증권', 'stable', '저승 금융의 중심. 명부 자산관리 1위, 배당주.'),
  ('NRKM', '나라카모터스', 'normal', '전동 상여·자율주행 저승길 안내 시스템. 신모델 이슈가 잦다.'),
  ('MIHO', '미호엔터테인먼트', 'normal', '구미호 소속사. 소속 요괴 데뷔·스캔들로 주가가 출렁인다.'),
  ('MERU', '메루크로소프트', 'normal', '저승 업무 소프트웨어·명부 OS 독점 기업.'),
  ('BNZN', '바나존', 'normal', '저승 커머스·택배. 명절 물량 특수를 탄다.'),
  ('OKJA', '옥자디아', 'wild', '명계 AI 반도체 테마주. 염라 데이터센터 수주설에 급등락 단골.'),
  ('NRKB', '나라카바이오', 'wild', '환생 임상시험 전문. 성공/실패 루머가 끊이지 않는다.')
on conflict (code) do nothing;

-- 기준가 (이벤트 전일 2026-07-31 종가 = 개장 첫날 틱 생성 기준)
insert into daily_summary (stock_code, date, open, high, low, close, bias) values
  ('NRKE', '2026-07-31', 62000, 62000, 62000, 62000, 0),
  ('NRKS', '2026-07-31', 48000, 48000, 48000, 48000, 0),
  ('NRKM', '2026-07-31', 35000, 35000, 35000, 35000, 0),
  ('MIHO', '2026-07-31', 21000, 21000, 21000, 21000, 0),
  ('MERU', '2026-07-31', 54000, 54000, 54000, 54000, 0),
  ('BNZN', '2026-07-31', 28000, 28000, 28000, 28000, 0),
  ('OKJA', '2026-07-31', 9800, 9800, 9800, 9800, 0),
  ('NRKB', '2026-07-31', 6400, 6400, 6400, 6400, 0)
on conflict (stock_code, date) do nothing;

-- 게임 설정 기본값
insert into config (key, value) values
  ('event_start', '"2026-08-01"'),
  ('event_end', '"2026-08-30"'),
  ('market_open_hour', '15'),
  ('market_close_hour', '22'),
  ('tick_interval_minutes', '5'),
  ('closed_weekdays', '[]'),
  ('holiday_exceptions', '[]'),
  ('extra_open_days', '[]'),
  ('initial_cash', '1000000'),
  ('visit_bonus', '100000'),
  ('sell_fee_bp', '50'),
  ('price_limit_percent', '30'),
  ('dividend_percent', '1'),
  ('currency_label', '"원"')
on conflict (key) do nothing;
