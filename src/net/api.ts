// サーバー（Cloudflare Worker）とのやりとりと、ブラウザ内の保存。
// 個人情報は送らない。player id はこのブラウザで作ったランダムな文字列。
import type { CustomPassenger, TrailSetting } from '../content/types';

const KEY_PLAYER = 'tf.player';
const KEY_SETTINGS = 'tf.settings';
const KEY_CUSTOM = 'tf.custom';
const KEY_QUEUE = 'tf.queue';
const KEY_BEST = 'tf.best';

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* プライベートモードなどでは保存しない */
  }
}

export function randomId(prefix = ''): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

export function playerId(): string {
  let id = storageGet(KEY_PLAYER);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = randomId('p');
    storageSet(KEY_PLAYER, id);
  }
  return id;
}

export interface Settings {
  vehicle: string;
  fuel: string;
  passengers: string[];
  mode: string;
  trail: TrailSetting;
  vehicleColor: string | null;
  volumes: { master: number; engine: number; passengers: number };
}

export function loadSettings(): Partial<Settings> {
  try {
    return JSON.parse(storageGet(KEY_SETTINGS) ?? '{}');
  } catch {
    return {};
  }
}
export function saveSettings(s: Settings) {
  storageSet(KEY_SETTINGS, JSON.stringify(s));
}

export function loadCustomPassengers(): CustomPassenger[] {
  try {
    const v = JSON.parse(storageGet(KEY_CUSTOM) ?? '[]');
    if (!Array.isArray(v)) return [];
    // 以前の版（絵文字のアイコン）で保存したものは、音符のアイコンにする
    return v.map((p) => (typeof p.icon === 'string' ? p : { ...p, icon: 'note', emoji: undefined }));
  } catch {
    return [];
  }
}
export function saveCustomPassengers(list: CustomPassenger[]) {
  storageSet(KEY_CUSTOM, JSON.stringify(list));
}

export interface FlightPayload {
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
  device: 'desktop' | 'touch';
  end: [number, number, number];
  path: [number, number, number][];
}

async function post(path: string, body: unknown): Promise<boolean> {
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      keepalive: JSON.stringify(body).length < 60000,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 送れなかった記録は貯めておき、次に送る */
function queue(): { path: string; body: unknown }[] {
  try {
    return JSON.parse(storageGet(KEY_QUEUE) ?? '[]');
  } catch {
    return [];
  }
}

export async function sendFlight(f: FlightPayload) {
  if (!(await post('/api/flights', f))) {
    const q = queue();
    q.push({ path: '/api/flights', body: f });
    storageSet(KEY_QUEUE, JSON.stringify(q.slice(-20)));
  }
}

export async function flushQueue() {
  const q = queue();
  if (q.length === 0) return;
  const rest: typeof q = [];
  for (const item of q) if (!(await post(item.path, item.body))) rest.push(item);
  storageSet(KEY_QUEUE, JSON.stringify(rest));
}

export async function sendElement(p: CustomPassenger) {
  await post('/api/elements', {
    id: p.id,
    playerId: playerId(),
    kind: 'passenger',
    name: p.name,
    recipe: { icon: p.icon, trailColor: p.trailColor, sound: p.sound },
  });
}

export interface Summary {
  pilots: number;
  flights: number;
  totalScore: number;
  totalDistance: number;
}

export async function fetchSummary(): Promise<Summary | null> {
  try {
    const res = await fetch('/api/summary');
    if (!res.ok) return null;
    const v = (await res.json()) as Summary;
    return typeof v.pilots === 'number' ? v : null;
  } catch {
    return null;
  }
}

export function loadBest(): Record<string, number> {
  try {
    const v = JSON.parse(storageGet(KEY_BEST) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
export function saveBest(mode: string, score: number): boolean {
  const b = loadBest();
  if ((b[mode] ?? 0) >= score) return false;
  b[mode] = score;
  storageSet(KEY_BEST, JSON.stringify(b));
  return true;
}
