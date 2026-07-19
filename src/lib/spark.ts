// 스파크라인 다운샘플: 홈/시세판 spark는 수십 px로 렌더돼 고해상도가 무의미하다.
// 10초 틱 전환으로 완료 버킷이 종목당 최대 720점까지 늘어 10초 폴링 페이로드를
// 부풀리므로, 시각적으로 동일한 고정 상한으로 균등 다운샘플한다. 첫·끝 점은 보존한다
// (끝 점 = 현재가/현재 지수라 라인이 현재까지 이어져야 한다).
export const SPARK_MAX_POINTS = 60;

export function downsampleSpark(points: number[], maxPoints: number = SPARK_MAX_POINTS): number[] {
  if (points.length <= maxPoints) return points;
  const out: number[] = [];
  const stride = (points.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    out.push(points[Math.round(i * stride)]);
  }
  return out;
}
