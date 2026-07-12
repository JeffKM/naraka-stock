-- 종목 소개문을 변경된 등급에 맞게 갱신 (2026-07-12)
-- 옥자디아: 테마주 → 우량 배당주 / 나라카증권: 배당주 문구 제거 / 미호: 테마주 톤

update stocks set description = '명계 AI 반도체의 절대 강자. 시가총액 1위 대장주, 배당주.'
  where code = 'OKJA';
update stocks set description = '저승 금융의 중심. 명부 자산관리 1위 증권사.'
  where code = 'NRKS';
update stocks set description = '구미호 소속사. 데뷔·스캔들 한 방에 천당과 지옥을 오간다.'
  where code = 'MIHO';
