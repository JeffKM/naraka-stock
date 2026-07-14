// 특정 날짜의 힌트 뉴스를 새 템플릿으로 재생성해 SQL로 출력 (일회성 운영 도구)
// 사용: npx tsx scripts/regenNews.ts '{"MLVD":10,...}' 2026-08-01 <seed>
// 주의: DB에 접속하지 않는 오프라인 도구라 "발행 이력 제외(재사용 금지)"가 적용되지
// 않는다. 운영 중 재생성은 배치 재실행(daily-batch?date=)을 우선 사용할 것.

import { generateHintNews } from "../src/lib/news/generate";
import { createRng, hashSeed } from "../src/lib/engine/rng";

const biases = JSON.parse(process.argv[2]) as Record<string, number>;
const date = process.argv[3];
const seed = process.argv[4] ?? `regen|${date}`;

const news = generateHintNews(Object.keys(biases), biases, date, createRng(hashSeed(seed)));

const esc = (s: string) => s.replaceAll("'", "''");
const lines = [
  `delete from news where is_auto and grade in ('news','rumor') and date = '${date}';`,
  ...news.map(
    (n) =>
      `insert into news (date, stock_code, grade, title, body, is_auto) values ('${n.date}', ${
        n.stockCode ? `'${n.stockCode}'` : "null"
      }, '${n.grade}', '${esc(n.title)}', '${esc(n.body)}', true);`
  ),
];
console.log(lines.join("\n"));
