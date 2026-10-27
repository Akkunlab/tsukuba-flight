// 本番サーバーから集計を取ってきて evolution/stats.json に保存する。
// 使い方: TF_URL=https://tsukuba-flight.<account>.workers.dev node scripts/evolve/fetch-stats.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const base = process.env.TF_URL ?? 'http://127.0.0.1:8787';
const days = process.env.TF_DAYS ?? '14';
const res = await fetch(`${base.replace(/\/$/, '')}/api/stats?days=${days}`);
if (!res.ok) {
  console.error(`stats の取得に失敗: ${res.status}`);
  process.exit(1);
}
const stats = await res.json();
mkdirSync('evolution', { recursive: true });
writeFileSync('evolution/stats.json', JSON.stringify(stats, null, 2));
console.log(`evolution/stats.json: ${stats.totalFlights} flights / generation ${stats.currentGeneration}`);
