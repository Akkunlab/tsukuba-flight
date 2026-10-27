// 1 回のフライトの進行（カウントダウン → 飛行 → 着陸／墜落／燃料切れ）と記録。three.js に依存しない。
import type { FuelDef, ModeDef, VehicleDef } from '../content/types';
import { createCraft, step, launchThrottle, type Craft, type Input, type Vec3 } from './physics';
import { inRunwayArea, PAD, RUNWAY_START, type World } from './world';

export type Phase = 'countdown' | 'flying' | 'ended';
export type Outcome = 'landed' | 'crashed' | 'fuel' | 'out' | 'timeout' | 'quit';

export const RING_RADIUS = 38;
export const COUNTDOWN = 3;

export interface FlightEvent {
  type: 'countdown' | 'start' | 'takeoff' | 'checkpoint' | 'allCheckpoints' | 'touchdown' | 'end' | 'warning';
  value?: number;
  text?: string;
}

export interface FlightStats {
  duration: number;
  distance: number;
  maxAlt: number;
  maxSpeed: number;
  checkpoints: number;
  path: [number, number, number][];
}

export interface FlightSetup {
  vehicle: VehicleDef;
  fuel: FuelDef;
  mode: ModeDef;
  /** 風向きなどを決める乱数のたね */
  seed: number;
}

export function windFor(mode: ModeDef, seed: number, t: number): Vec3 {
  const dir = ((seed % 360) * Math.PI) / 180;
  const gust = 1 + 0.35 * Math.sin(t * 0.21 + seed) + 0.2 * Math.sin(t * 0.67 + seed * 2);
  const s = mode.wind * gust;
  return { x: Math.sin(dir) * s, y: 0, z: -Math.cos(dir) * s };
}

export class Flight {
  readonly setup: FlightSetup;
  readonly world: World;
  readonly craft: Craft;
  phase: Phase = 'countdown';
  outcome: Outcome | null = null;
  cause = '';
  /** カウントダウン中は残り秒、飛行中は経過秒 */
  time = -COUNTDOWN;
  nextCheckpoint = 0;
  tookOff = false;
  wind: Vec3 = { x: 0, y: 0, z: 0 };
  stats: FlightStats = { duration: 0, distance: 0, maxAlt: 0, maxSpeed: 0, checkpoints: 0, path: [] };
  /** 地面からの高さ */
  altitude = 0;
  private settle = 0;
  private lastPathT = -1;
  private lastCount = COUNTDOWN + 1;
  private warnedFuel = false;

  constructor(world: World, setup: FlightSetup) {
    this.world = world;
    this.setup = setup;
    const start = setup.vehicle.start === 'runway' ? RUNWAY_START : PAD;
    const y = world.terrainHeight(start.x, start.z);
    this.craft = createCraft(setup.vehicle, { x: start.x, y, z: start.z }, 0);
  }

  get checkpoints() {
    return this.setup.mode.checkpoints;
  }

  checkpointPosition(i: number): Vec3 | null {
    const c = this.checkpoints[i];
    if (!c) return null;
    return { x: c.x, y: this.world.terrainHeight(c.x, c.z) + c.alt, z: c.z };
  }

  /** dt 秒進める。起きた出来事を返す */
  update(input: Input, dt: number): FlightEvent[] {
    const ev: FlightEvent[] = [];
    if (this.phase === 'ended') return ev;
    this.time += dt;
    if (this.phase === 'countdown') {
      const n = Math.ceil(-this.time);
      if (n < this.lastCount && n > 0) {
        this.lastCount = n;
        ev.push({ type: 'countdown', value: n });
      }
      if (this.time >= 0) {
        this.phase = 'flying';
        this.time = 0;
        ev.push({ type: 'start' });
      }
      return ev;
    }

    const { vehicle, fuel, mode } = this.setup;
    const c = this.craft;
    this.wind = windFor(mode, this.setup.seed, this.time);
    const before = { ...c.pos };
    const ground = this.world.surfaceHeight(c.pos.x, c.pos.z);
    step(c, vehicle, fuel, input, this.wind, ground.height, dt);

    // 接地・着陸・墜落
    const surf = this.world.surfaceHeight(c.pos.x, c.pos.z);
    this.altitude = c.pos.y - surf.height;
    if (c.pos.y <= surf.height) {
      if (!c.onGround) {
        const verdict = this.judgeTouchdown(surf.kind);
        if (verdict) return this.end('crashed', verdict, ev);
        c.onGround = true;
        if (this.tookOff) ev.push({ type: 'touchdown' });
      }
      c.pos.y = surf.height;
      if (c.vel.y < 0) c.vel.y = 0;
      if (vehicle.model === 'plane' && c.pitch < 0) c.pitch = 0;
    } else if (c.onGround && this.altitude > 0.3) {
      c.onGround = false;
    }
    if (!this.tookOff && this.altitude > 12) {
      this.tookOff = true;
      ev.push({ type: 'takeoff' });
    }

    // 建物・森への衝突
    const hit = this.world.hitTest(c.pos.x, c.pos.y + vehicle.radius * 0.5, c.pos.z, vehicle.radius);
    if (hit && !(c.onGround && hit.top <= c.pos.y + 0.5)) {
      const what = hit.kind === 'tree' ? '森の木' : hit.name ?? this.world.nearestName(c.pos.x, c.pos.z) ?? '建物';
      return this.end('crashed', `${what}にぶつかった`, ev);
    }

    // 記録
    const d = Math.hypot(c.pos.x - before.x, c.pos.y - before.y, c.pos.z - before.z);
    this.stats.distance += d;
    this.stats.maxAlt = Math.max(this.stats.maxAlt, this.altitude);
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, d / dt);
    this.stats.duration = this.time;
    if (this.time - this.lastPathT >= 1 && this.stats.path.length < 900) {
      this.lastPathT = this.time;
      this.stats.path.push([Math.round(c.pos.x), Math.round(c.pos.y), Math.round(c.pos.z)]);
    }

    // チェックポイント
    const cp = this.checkpointPosition(this.nextCheckpoint);
    if (cp && Math.hypot(c.pos.x - cp.x, c.pos.y - cp.y, c.pos.z - cp.z) < RING_RADIUS + vehicle.radius) {
      this.nextCheckpoint++;
      this.stats.checkpoints = this.nextCheckpoint;
      ev.push({ type: 'checkpoint', value: this.nextCheckpoint, text: this.checkpoints[this.nextCheckpoint - 1].name });
      if (this.nextCheckpoint === this.checkpoints.length) ev.push({ type: 'allCheckpoints' });
    }

    // 着陸完了（地上で止まった）
    const horiz = Math.hypot(c.vel.x, c.vel.z);
    if (c.onGround && this.tookOff) {
      const still = vehicle.model === 'plane' ? horiz < 2 : horiz < 2 && c.throttle < 0.62;
      this.settle = still ? this.settle + dt : 0;
      if (this.settle > 1.2) return this.end('landed', surf.kind === 'building' ? `${surf.name ?? '建物'}の屋上に着陸` : '着陸成功', ev);
    } else {
      this.settle = 0;
    }

    if (c.fuel <= 0) return this.end('fuel', '燃料切れ', ev);
    if (!this.warnedFuel && c.fuel < 0.2) {
      this.warnedFuel = true;
      ev.push({ type: 'warning', text: '燃料が残りわずか！' });
    }
    if (this.world.outOfBounds(c.pos.x, c.pos.z)) return this.end('out', 'エリアの外に出た', ev);
    if (mode.timeLimit > 0 && this.time > mode.timeLimit) return this.end('timeout', '時間切れ', ev);
    return ev;
  }

  /** 接地の瞬間の判定。墜落なら理由を返す */
  private judgeTouchdown(kind: 'building' | 'tree' | 'terrain'): string | null {
    const c = this.craft;
    const v = this.setup.vehicle;
    const vs = c.vel.y;
    const horiz = Math.hypot(c.vel.x, c.vel.z);
    if (kind === 'tree') return '森の木に突っ込んだ';
    switch (v.model) {
      case 'plane':
        if (vs < -6) return 'ドスン！ 降下が速すぎた';
        if (Math.abs(c.roll) > 0.45) return '傾いたまま接地した';
        if (c.pitch < -0.25) return '機首から地面に突っ込んだ';
        if (kind !== 'terrain' || !inRunwayArea(c.pos.x, c.pos.z, 8)) {
          return horiz > 8 ? '滑走路以外に不時着した' : null;
        }
        return null;
      case 'hover':
        if (vs < -5) return 'ドスン！ 降下が速すぎた';
        if (horiz > 14) return '速すぎるまま接地した';
        return null;
      case 'balloon':
        if (vs < -5) return 'バスケットが地面に激突した';
        return null;
      case 'rocket':
        if (vs < -7 || horiz > 12) return '地面に激突した';
        return null;
    }
  }

  private end(outcome: Outcome, cause: string, ev: FlightEvent[]): FlightEvent[] {
    this.phase = 'ended';
    this.outcome = outcome;
    this.cause = cause;
    this.craft.throttle = 0;
    this.stats.duration = Math.max(0, this.time);
    const c = this.craft;
    this.stats.path.push([Math.round(c.pos.x), Math.round(c.pos.y), Math.round(c.pos.z)]);
    ev.push({ type: 'end', text: cause });
    return ev;
  }

  quit() {
    if (this.phase !== 'ended') this.end('quit', 'やめた', []);
  }

  /** スタート時に入れるスロットル */
  get launchThrottle() {
    return launchThrottle(this.setup.vehicle);
  }

  score(): number {
    const s = this.stats;
    let score = s.checkpoints * 500 + Math.floor(s.distance / 20);
    if (this.outcome === 'landed') {
      score += 1500;
      if (this.checkpoints.length > 0 && s.checkpoints === this.checkpoints.length) score += 2000;
      score += Math.round(this.craft.fuel * 1000);
    }
    return score;
  }
}
