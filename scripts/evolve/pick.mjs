// 次の世代で「何を変えるか」をランダムに決める。プレイ記録で重みを少し変える。
// 結果は evolution/direction.json。LLM はこれを出発点にして、具体的な中身は自由に考える。
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const CATEGORIES = [
  { id: 'vehicle', weight: 3, hint: '新しい乗り物（content/vehicles.ts + render/vehicleMesh.ts の見た目）' },
  { id: 'passenger', weight: 3, hint: '新しい搭乗者と音（content/passengers.ts の SoundRecipe）' },
  { id: 'fuel', weight: 2, hint: '新しい燃料（content/fuels.ts）' },
  { id: 'scenery', weight: 3, hint: '景色の追加（world/scenery.ts にビルダー + content/scenery.ts）' },
  { id: 'mode', weight: 2, hint: '新しいモード（content/modes.ts。リングの配置やルール）' },
  { id: 'sound', weight: 2, hint: '音の表現の拡張（audio/sound.ts。エンジン音の種類、効果音、音の変化）' },
  { id: 'visual', weight: 2, hint: '見た目・演出（軌跡のスタイル、天気、時間帯、エフェクト）' },
  { id: 'tuning', weight: 1, hint: 'プレイ記録を見て難しすぎ・簡単すぎる所を調整' },
  { id: 'wildcard', weight: 1, hint: '上のどれでもない、思いつきの新要素' },
];

const stats = existsSync('evolution/stats.json') ? JSON.parse(readFileSync('evolution/stats.json', 'utf8')) : null;
const weights = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.weight]));
if (stats && stats.totalFlights > 0) {
  const crashes = Object.values(stats.byVehicle ?? {}).reduce((a, g) => a + (g.outcomes?.crashed ?? 0), 0);
  // 墜落が半分を超えるなら調整を出やすくする
  if (crashes / stats.totalFlights > 0.5) weights.tuning += 3;
  // 搭乗者がよく選ばれているなら音を増やす
  if ((stats.avgPassengers ?? 0) > 1.5) weights.passenger += 2;
  if ((stats.customElements?.total ?? 0) > 3) weights.sound += 2;
}

const seed = Number(process.env.TF_SEED ?? Date.now());
let s = seed >>> 0;
const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
const total = Object.values(weights).reduce((a, b) => a + b, 0);
const pickOne = () => {
  let r = rand() * total;
  for (const c of CATEGORIES) {
    r -= weights[c.id];
    if (r <= 0) return c;
  }
  return CATEGORIES[0];
};
const primary = pickOne();
let secondary = pickOne();
if (secondary.id === primary.id) secondary = null;

const direction = {
  seed,
  primary,
  secondary,
  note: '必ず primary を 1 つ入れる。secondary は小さくてよいし、省いてもよい。',
};
mkdirSync('evolution', { recursive: true });
writeFileSync('evolution/direction.json', JSON.stringify(direction, null, 2));
console.log(JSON.stringify(direction, null, 2));
