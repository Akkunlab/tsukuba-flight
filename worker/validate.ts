// API に届いたデータの検査。個人情報を受け取らないよう、決まった項目だけを取り出す。

export interface FlightRecord {
  id: string;
  playerId: string;
  generation: number;
  mode: string;
  vehicle: string;
  fuel: string;
  passengers: string[];
  trailColor: string;
  outcome: string;
  cause: string;
  duration: number;
  distance: number;
  maxAlt: number;
  maxSpeed: number;
  checkpoints: number;
  score: number;
  device: string;
  end: [number, number, number];
  path: [number, number, number][];
}

export interface ElementRecord {
  id: string;
  playerId: string;
  kind: string;
  name: string;
  recipe: unknown;
}

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
const OUTCOMES = ['landed', 'crashed', 'fuel', 'out', 'timeout', 'quit'];
const DEVICES = ['desktop', 'touch'];

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function n(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
}

/** 名前などの自由入力。制御文字と URL を落として短くする */
export function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/https?:\/\/\S+/gi, '')
    .trim()
    .slice(0, max);
}

export function parseFlight(body: unknown): Result<FlightRecord> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const b = body as Record<string, unknown>;
  const str = (k: string, re: RegExp) => (typeof b[k] === 'string' && re.test(b[k] as string) ? (b[k] as string) : null);
  const id = str('id', ID);
  const playerId = str('playerId', ID);
  const mode = str('mode', KEY);
  const vehicle = str('vehicle', KEY);
  const fuel = str('fuel', KEY);
  const trailColor = str('trailColor', COLOR);
  if (!id || !playerId || !mode || !vehicle || !fuel || !trailColor) return { ok: false, error: 'missing or invalid id/playerId/mode/vehicle/fuel/trailColor' };
  const outcome = typeof b.outcome === 'string' && OUTCOMES.includes(b.outcome) ? b.outcome : null;
  if (!outcome) return { ok: false, error: 'invalid outcome' };
  const device = typeof b.device === 'string' && DEVICES.includes(b.device) ? b.device : 'desktop';
  const passengers = Array.isArray(b.passengers) ? b.passengers.filter((p): p is string => typeof p === 'string' && KEY.test(p)).slice(0, 8) : [];
  const nums = {
    generation: n(b.generation, 0, 1e6),
    duration: n(b.duration, 0, 86400),
    distance: n(b.distance, 0, 1e7),
    maxAlt: n(b.maxAlt, 0, 1e5),
    maxSpeed: n(b.maxSpeed, 0, 1e4),
    checkpoints: n(b.checkpoints, 0, 1000),
    score: n(b.score, 0, 1e9),
  };
  for (const [k, v] of Object.entries(nums)) if (v === null) return { ok: false, error: `invalid ${k}` };
  const pt = (p: unknown): [number, number, number] | null =>
    Array.isArray(p) && p.length === 3 && p.every((x) => typeof x === 'number' && Number.isFinite(x))
      ? [Math.round(p[0]), Math.round(p[1]), Math.round(p[2])]
      : null;
  const path = Array.isArray(b.path) ? b.path.slice(0, 1000).map(pt).filter((p): p is [number, number, number] => p !== null) : [];
  const end = pt(b.end) ?? path[path.length - 1] ?? [0, 0, 0];
  return {
    ok: true,
    value: {
      id,
      playerId,
      generation: Math.round(nums.generation!),
      mode,
      vehicle,
      fuel,
      passengers,
      trailColor,
      outcome,
      cause: cleanText(b.cause, 80),
      duration: nums.duration!,
      distance: nums.distance!,
      maxAlt: nums.maxAlt!,
      maxSpeed: nums.maxSpeed!,
      checkpoints: Math.round(nums.checkpoints!),
      score: Math.round(nums.score!),
      device,
      end,
      path,
    },
  };
}

export function parseElement(body: unknown): Result<ElementRecord> {
  if (!body || typeof body !== 'object') return { ok: false, error: 'body must be an object' };
  const b = body as Record<string, unknown>;
  if (typeof b.id !== 'string' || !KEY.test(b.id)) return { ok: false, error: 'invalid id' };
  if (typeof b.playerId !== 'string' || !ID.test(b.playerId)) return { ok: false, error: 'invalid playerId' };
  const kind = b.kind === 'passenger' ? 'passenger' : null;
  if (!kind) return { ok: false, error: 'invalid kind' };
  const name = cleanText(b.name, 30);
  if (!name) return { ok: false, error: 'invalid name' };
  const recipe = b.recipe;
  if (!recipe || typeof recipe !== 'object') return { ok: false, error: 'invalid recipe' };
  const json = JSON.stringify(recipe);
  if (json.length > 8000) return { ok: false, error: 'recipe too large' };
  return { ok: true, value: { id: b.id, playerId: b.playerId, kind, name, recipe } };
}
