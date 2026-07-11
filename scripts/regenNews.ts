// 특정 날짜의 힌트 뉴스를 새 템플릿으로 재생성해 SQL로 출력 (일회성 운영 도구)
// 사용: npx tsx scripts/regenNews.ts '{"NRKS":10,...}' 2026-07-12 <seed>

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
