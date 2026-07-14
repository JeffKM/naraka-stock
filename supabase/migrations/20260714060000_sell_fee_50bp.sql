-- 매도 수수료 0.3% → 0.5% 상향 (초단타 스팸 억제 강화)
-- 배경: 상하한 ±30%·5분 틱 환경에서 빈틈을 노린 초단타가 다수 예상됨.
-- 왕복 억제력을 높이되, 막판 역전(공정성)을 해치지 않는 선인 0.5%로 조정.
-- 이미 적용된 DB의 config 행을 갱신한다 (reference_data seed는 on conflict do nothing이라 갱신 안 됨).
update config set value = '50' where key = 'sell_fee_bp';
