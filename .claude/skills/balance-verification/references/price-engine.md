# 가격 엔진·시뮬레이션 검증 참조

price-engine-verifier가 로드한다. 가격 생성 엔진과 몬테카를로 밸런스 분포를 적대적으로 검증한다.

## 검증 대상

- `src/lib/engine/randomWalk.ts` — `generateDailyPath`, GBM 랜덤워크(σ 등급별 .005/.009/.015), 우상향 드리프트
- `src/lib/engine/bias.ts` — `drawDailyBiases`·`drawSectorEvents`·`applySectorEvents`·`realizeBias`(뉴스 편향 → 가격 반영)
- `src/lib/engine/rng.ts` — `createRng`·`hashSeed`(시드 결정론)
- `scripts/simulate.ts` — `npm run simulate -- --runs N`, 전략별 최종 자산 분포

## 체크리스트

1. **결정론**: 동일 시드로 `simulate` 2회 실행 → 분포 재현 확인.
   ```bash
   npm run simulate -- --runs 500 | tee /tmp/run1.txt
   npm run simulate -- --runs 500 | tee /tmp/run2.txt
   diff /tmp/run1.txt /tmp/run2.txt
   ```
2. **상하한 ±30%**: 직전 개장일 종가 기준 밴드가 `generateDailyPath` 경로에서 지켜지는지, 밴드 클램프가 편향을 만들지 않는지 확인.
3. **VI(변동성 완화)**: 급변 시 발동 조건과 완화 후 경로가 차익 기회를 만들지 않는지.
4. **드리프트**: 우상향이 특정 전략(존버)에 무위험 우위를 주지 않는지 — 전략 간 중앙값 배수로 판단.
5. **차익거래 사냥**: 상하한 근처 지정가·VI 발동·드리프트 편향을 조합한 자멸 패턴을 시뮬로 재현 시도.
6. **σ 튜닝**: 등급별 변동성이 의도한 티어 서열(저위험 저변동)을 유지하는지.

## 밸런스 해석 기준

- 절대 배수가 아니라 **중앙값 대비 상위/하위 배수**로 판단(기저 드리프트 선재).
- 상위 4명(잠정)이 상품을 받으므로, 상위권 분산이 운(runs 간 변동)보다 전략 실력에 의해 갈리는지 본다.
- 과거 결정: 중앙값~10배는 현행 유지(상대 해석). 이 기준선에서 벗어나는 리그레션만 FAIL.

## 과거 장애 회귀 (반드시 확인)

- **OU 엔진 폐기 전례**: 지정가 브라켓 차익거래로 자멸 → GBM 재튜닝(σ .005/.009/.015)·VI±8%·우상향으로 대체됨. 이 취약 패턴이 재발하지 않는지.
- **뉴스 후반부 노출**: 정식뉴스가 steepest→tail로 이동, 뉴스추종 이득 제거. middle 노출 금지 확인.

## 좀비 방지

`simulate`가 대량 runs로 오래 걸리면 워치독으로 감싼다:
```bash
( npm run simulate -- --runs 5000 & pid=$!; ( sleep 300; kill -9 $pid 2>/dev/null ) & wd=$!; wait $pid; kill $wd 2>/dev/null )
```
