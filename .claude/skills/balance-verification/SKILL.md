---
name: balance-verification
description: 나라카 모의주식의 밸런스·공정성·무결성을 검증하는 방법론 스킬. 가격 엔진(GBM·상하한·드리프트)·거래 RPC(체결·수수료·잔고)·폐장 배치/틱 생성·공정성(초기자금·뉴스편향·순위) 검증 시 반드시 사용. 밸런스 리그레션, 차익거래 탐지, 조작 방지, 시뮬레이션 해석, 경계면 교차검증에 적용. price-engine-verifier·trade-integrity-verifier·batch-tick-verifier·fairness-auditor 에이전트가 공유.
---

# Balance Verification — 밸런스 검증 방법론

나라카 모의주식은 **상품이 걸린 이벤트**다. 따라서 검증의 목표는 "버그가 없다"가 아니라 **"어떤 참가자도 구조적 부당 이득을 얻을 수 없다"**를 입증하는 것이다. 모든 검증은 이 공정성 관점에서 수행한다.

## 왜 이렇게 검증하는가

- **조작 방지 = 공정성.** 아키텍처 1원칙(모든 돈 계산은 서버에서)이 무너지면 그 자체가 불공정이다.
- **개별 정상 ≠ 통합 정상.** 엔진·거래·배치가 각자 옳아도 경계면에서 계약이 어긋나면 결함이다. 정적 리뷰·빌드 통과로는 못 잡으니 **교차 비교**로 검증한다.
- **상대 해석.** 밸런스는 절대 수익률이 아니라 참가자 간 기회 균등으로 판단한다.

## 공통 원칙

1. **적대적으로 접근한다.** "이 규칙을 악용해 무위험 초과수익을 내는 방법이 있는가?"를 항상 자문한다. 과거 OU 엔진이 지정가 브라켓 차익거래로 폐기된 전례가 있다.
2. **재현 가능하게 기록한다.** 모든 FAIL/의심은 재현 명령(시뮬 시드·SQL·curl)과 함께 기록한다. 재현 불가능한 지적은 가치가 낮다.
3. **상충은 병기한다.** 결과가 상충하면 삭제하지 않고 조건·출처를 병기한다.
4. **좀비 방지.** 장시간 프로세스(시뮬·dev 서버)는 워치독으로 감싸고, 동일 작업을 중복 병렬 실행하지 않는다.

## 검증 대상 지도

| 도메인 | 핵심 아티팩트 | 담당 에이전트 | 참조 |
|--------|--------------|--------------|------|
| 가격 엔진·시뮬 | `src/lib/engine/{randomWalk,bias,rng}.ts`, `scripts/simulate.ts` | price-engine-verifier | `references/price-engine.md` |
| 거래 무결성 | `execute_trade`·`place_limit_order`·`settle_limit_orders` RPC | trade-integrity-verifier | `references/trade-integrity.md` |
| 배치·틱 생성 | `apply_daily_batch`·`replace_future_ticks`·`reschedule_daily_batch` | batch-tick-verifier | `references/batch-tick.md` |
| 공정성·종합 | 초기자금·보너스·뉴스편향·순위, 경계면 교차검증 | fairness-auditor | `references/fairness-audit.md` |

## 사용법

자신의 도메인에 해당하는 `references/{domain}.md`를 **필요할 때 로드**한다(progressive disclosure). 각 참조는 검증 체크리스트 + 재현 명령 + 과거 장애 회귀 항목을 담는다. SKILL.md 본문은 공통 원칙만 유지하고, 도메인 세부는 참조로 분리한다.

## 산출물 형식 (공통)

각 검증관 리포트는 다음 구조를 따른다:

```markdown
# {도메인} 검증 리포트 — {날짜}
## 요약: PASS N / FAIL N / 의심 N
## 항목별 결과
| 항목 | 판정 | 근거 | 재현 |
|------|------|------|------|
## 발견 이슈 (심각도순)
1. [심각도] 제목 — 재현 방법 — 영향(공정성 관점)
## 경계면 노트 (다른 도메인과 얽히는 지점)
```

> 데이터 스키마·재현 명령 상세는 각 `references/` 파일 참조.
