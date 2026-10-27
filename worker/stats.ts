// 改善ループ（LLM）に渡す集計。
// ここに自由入力の文字列は一切入れない。数値と、ゲームに実在する ID だけを返す
// （プレイヤーが送った文字列で LLM を操作されるのを防ぐため）。
import { FUELS, MODES, PASSENGERS, VEHICLES, GENERATION } from '../src/content/index';

export interface FlightRow {
  created_at: number;
  generation: number;
  mode: string;
  vehicle: string;
  fuel: string;
  passengers: string;
  trail_color: string;
  outcome: string;
  duration_s: number;
  distance_m: number;
  max_alt_m: number;
  max_speed_ms: number;
  checkpoints: number;
  score: number;
  device: string;
  end_x: number | null;
  end_y: number | null;
  end_z: number | null;
  /** 0.5 秒ごとの音楽の状態 [時刻×10, BPM, 勢い%, 細かさ, 移調, 逆再生] の JSON */
  music?: string | null;
}

const KNOWN = {
  vehicle: new Set(VEHICLES.map((v) => v.id)),
  fuel: new Set(FUELS.map((f) => f.id)),
  passenger: new Set(PASSENGERS.map((p) => p.id)),
  mode: new Set(MODES.map((m) => m.id)),
};
const OUTCOMES = new Set(['landed', 'crashed', 'fuel', 'out', 'timeout', 'quit']);

function known(set: Set<string>, id: string, fallback = 'other') {
  if (set.has(id)) return id;
  return id.startsWith('custom-') ? 'custom' : fallback;
}

interface Group {
  flights: number;
  avgDuration: number;
  avgDistance: number;
  avgScore: number;
  outcomes: Record<string, number>;
}

function group(rows: FlightRow[], key: (r: FlightRow) => string[]): Record<string, Group> {
  const acc: Record<string, { n: number; d: number; dist: number; s: number; o: Record<string, number> }> = {};
  for (const r of rows) {
    for (const k of key(r)) {
      const a = (acc[k] ??= { n: 0, d: 0, dist: 0, s: 0, o: {} });
      a.n++;
      a.d += r.duration_s;
      a.dist += r.distance_m;
      a.s += r.score;
      const o = OUTCOMES.has(r.outcome) ? r.outcome : 'other';
      a.o[o] = (a.o[o] ?? 0) + 1;
    }
  }
  const out: Record<string, Group> = {};
  for (const [k, a] of Object.entries(acc)) {
    out[k] = {
      flights: a.n,
      avgDuration: Math.round(a.d / a.n),
      avgDistance: Math.round(a.dist / a.n),
      avgScore: Math.round(a.s / a.n),
      outcomes: a.o,
    };
  }
  return out;
}

function parsePassengers(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function buildStats(rows: FlightRow[], elements: { recipe: string }[], days: number) {
  // 個人単位の集計はしない
  const total = rows.length;
  const hotspots: Record<string, number> = {};
  for (const r of rows) {
    if (r.outcome !== 'crashed' || r.end_x === null || r.end_z === null) continue;
    const k = `${Math.round(r.end_x / 200) * 200},${Math.round(r.end_z / 200) * 200}`;
    hotspots[k] = (hotspots[k] ?? 0) + 1;
  }
  const waves: Record<string, number> = {};
  let bpmSum = 0;
  let bpmN = 0;
  for (const e of elements) {
    try {
      const r = JSON.parse(e.recipe);
      const w = ['sine', 'square', 'sawtooth', 'triangle', 'noise'].includes(r?.sound?.wave) ? r.sound.wave : 'other';
      waves[w] = (waves[w] ?? 0) + 1;
      if (typeof r?.sound?.bpm === 'number') {
        bpmSum += r.sound.bpm;
        bpmN++;
      }
    } catch {
      /* 壊れたレシピは数えない */
    }
  }
  const trailHue: Record<string, number> = {};
  for (const r of rows) {
    const h = hueBucket(r.trail_color);
    trailHue[h] = (trailHue[h] ?? 0) + 1;
  }
  const byDay: Record<string, number> = {};
  for (const r of rows) {
    const d = new Date(r.created_at).toISOString().slice(0, 10);
    byDay[d] = (byDay[d] ?? 0) + 1;
  }
  const passengerCounts = rows.map((r) => parsePassengers(r.passengers).length);
  // 搭乗者の音楽がどう鳴っていたか（数値だけ）
  let mN = 0, bpm = 0, energy = 0, reversed = 0;
  const density = [0, 0, 0];
  for (const r of rows) {
    let m: unknown;
    try {
      m = JSON.parse(r.music ?? '[]');
    } catch {
      continue;
    }
    if (!Array.isArray(m)) continue;
    for (const row of m) {
      if (!Array.isArray(row) || row.length !== 6 || !row.every((x) => typeof x === 'number')) continue;
      mN++;
      bpm += row[1];
      energy += row[2];
      if (row[3] >= 0 && row[3] <= 2) density[row[3]]++;
      reversed += row[5] ? 1 : 0;
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    currentGeneration: GENERATION,
    days,
    totalFlights: total,
    flightsPerDay: byDay,
    avgDuration: total ? Math.round(rows.reduce((a, r) => a + r.duration_s, 0) / total) : 0,
    avgPassengers: total ? +(passengerCounts.reduce((a, b) => a + b, 0) / total).toFixed(2) : 0,
    devices: count(rows.map((r) => (r.device === 'touch' ? 'touch' : 'desktop'))),
    byGeneration: group(rows, (r) => [String(Math.round(r.generation))]),
    byMode: group(rows, (r) => [known(KNOWN.mode, r.mode)]),
    byVehicle: group(rows, (r) => [known(KNOWN.vehicle, r.vehicle)]),
    byFuel: group(rows, (r) => [known(KNOWN.fuel, r.fuel)]),
    byPassenger: group(rows, (r) => {
      const ps = parsePassengers(r.passengers).map((p) => known(KNOWN.passenger, p));
      return ps.length ? ps : ['none'];
    }),
    checkpointsReached: count(rows.map((r) => String(Math.min(20, Math.round(r.checkpoints))))),
    crashHotspots: Object.entries(hotspots)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([k, n]) => {
        const [x, z] = k.split(',').map(Number);
        return { x, z, crashes: n };
      }),
    trailHues: trailHue,
    customElements: { total: elements.length, waves, avgBpm: bpmN ? Math.round(bpmSum / bpmN) : null },
    music: mN
      ? {
          samples: mN,
          avgBpm: Math.round(bpm / mN),
          avgEnergy: Math.round(energy / mN),
          densityShare: { half: +(density[0] / mN).toFixed(2), normal: +(density[1] / mN).toFixed(2), double: +(density[2] / mN).toFixed(2) },
          reversedShare: +(reversed / mN).toFixed(2),
        }
      : null,
  };
}

function count(list: string[]): Record<string, number> {
  const o: Record<string, number> = {};
  for (const k of list) o[k] = (o[k] ?? 0) + 1;
  return o;
}

function hueBucket(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return 'other';
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 0.12) return max > 0.7 ? 'white' : 'gray';
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  const names = ['red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'];
  const edges = [15, 45, 70, 160, 200, 255, 290, 345];
  const i = edges.findIndex((e) => h < e);
  return i === -1 ? 'red' : names[i];
}
