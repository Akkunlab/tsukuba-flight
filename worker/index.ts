// Cloudflare Worker：静的ファイル（ゲーム本体）の配信と、プレイ記録 API。
import { parseElement, parseFlight } from './validate';
import { buildStats, type FlightRow } from './stats';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const MAX_BODY = 512 * 1024;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

async function readJson(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new Error('body too large');
  return JSON.parse(text);
}

export async function handleApi(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  try {
    if (path === '/api/health') return json({ ok: true });

    if (path === '/api/flights' && req.method === 'POST') {
      const r = parseFlight(await readJson(req));
      if (!r.ok) return json({ error: r.error }, 400);
      const f = r.value;
      await env.DB.prepare(
        `INSERT OR IGNORE INTO flights (id, player_id, created_at, generation, mode, vehicle, fuel, passengers, trail_color,
          outcome, cause, duration_s, distance_m, max_alt_m, max_speed_ms, checkpoints, score, device, end_x, end_y, end_z, path,
          track, music, events, extra)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          f.id, f.playerId, Date.now(), f.generation, f.mode, f.vehicle, f.fuel, JSON.stringify(f.passengers), f.trailColor,
          f.outcome, f.cause, f.duration, f.distance, f.maxAlt, f.maxSpeed, f.checkpoints, f.score, f.device,
          f.end[0], f.end[1], f.end[2], JSON.stringify(f.path),
          JSON.stringify(f.track), JSON.stringify(f.music), JSON.stringify(f.events), JSON.stringify(f.extra),
        )
        .run();
      return json({ ok: true });
    }

    if (path === '/api/elements' && req.method === 'POST') {
      const r = parseElement(await readJson(req));
      if (!r.ok) return json({ error: r.error }, 400);
      const e = r.value;
      // 同じ id を同じプレイヤーが保存したら上書き。他人の id は上書きできない
      await env.DB.prepare(
        `INSERT INTO elements (id, player_id, created_at, kind, name, recipe) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, recipe = excluded.recipe, created_at = excluded.created_at
         WHERE elements.player_id = excluded.player_id`,
      )
        .bind(e.id, e.playerId, Date.now(), e.kind, e.name, JSON.stringify(e.recipe))
        .run();
      return json({ ok: true });
    }

    if (path === '/api/elements' && req.method === 'GET') {
      const player = url.searchParams.get('player') ?? '';
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(player)) return json({ error: 'invalid player' }, 400);
      const { results } = await env.DB.prepare(
        'SELECT id, kind, name, recipe FROM elements WHERE player_id = ? ORDER BY created_at DESC LIMIT 100',
      )
        .bind(player)
        .all<{ id: string; kind: string; name: string; recipe: string }>();
      return json({ elements: results.map((r) => ({ ...r, recipe: JSON.parse(r.recipe) })) });
    }

    if (path === '/api/summary' && req.method === 'GET') {
      const row = await env.DB.prepare(
        'SELECT COUNT(DISTINCT player_id) AS pilots, COUNT(*) AS flights, COALESCE(SUM(score), 0) AS total, COALESCE(SUM(distance_m), 0) AS distance FROM flights',
      ).first<{ pilots: number; flights: number; total: number; distance: number }>();
      return json({
        pilots: Number(row?.pilots ?? 0),
        flights: Number(row?.flights ?? 0),
        totalScore: Number(row?.total ?? 0),
        totalDistance: Math.round(Number(row?.distance ?? 0)),
      });
    }

    if (path === '/api/stats' && req.method === 'GET') {
      const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days') ?? 14) || 14));
      const since = Date.now() - days * 86400_000;
      const { results } = await env.DB.prepare(
        `SELECT created_at, generation, mode, vehicle, fuel, passengers, trail_color, outcome, duration_s, distance_m,
                max_alt_m, max_speed_ms, checkpoints, score, device, end_x, end_y, end_z, music
         FROM flights WHERE created_at >= ? ORDER BY created_at DESC LIMIT 5000`,
      )
        .bind(since)
        .all<FlightRow>();
      const el = await env.DB.prepare('SELECT recipe FROM elements WHERE created_at >= ? LIMIT 2000').bind(since).all<{ recipe: string }>();
      return json(buildStats(results, el.results, days));
    }

    return json({ error: 'not found' }, 404);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'error' }, 400);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) return handleApi(req, env);
    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
