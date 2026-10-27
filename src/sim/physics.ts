// 飛び方の物理（ゲーム向けに単純化したもの）。three.js に依存しない。
import type { FuelDef, VehicleDef } from '../content/types';

export const G = 9.8;
/** 燃料タンクの基準容量。fuelUse はこれに対する 1 秒あたりの消費量 */
export const TANK = 150;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** 操作入力。x: 右が + / y: 上（機首上げ・前進）が + / throttle: 0..1 */
export interface Input {
  x: number;
  y: number;
  throttle: number;
}

export interface Craft {
  pos: Vec3;
  vel: Vec3;
  /** 向き。yaw=0 で北（-z）を向く。右回りで増える */
  yaw: number;
  /** 機首の上下（+ が上） */
  pitch: number;
  /** 傾き（+ が右に傾く） */
  roll: number;
  /** 前向きの速さ（plane / hover） */
  speed: number;
  /** 残り燃料 0..1 */
  fuel: number;
  throttle: number;
  onGround: boolean;
  /** 熱気球の温度 0..1 */
  heat: number;
  /** plane の失速による沈み込み [m/s] */
  sink: number;
  stalled: boolean;
  /** plane の離陸直後の自動上昇中か */
  climbOut: boolean;
}

export function forward(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

export function createCraft(v: VehicleDef, pos: Vec3, yaw: number): Craft {
  return {
    pos: { ...pos },
    vel: { x: 0, y: 0, z: 0 },
    yaw,
    pitch: v.model === 'rocket' ? Math.PI / 2 - 0.001 : 0,
    roll: 0,
    speed: 0,
    fuel: 1,
    throttle: 0,
    onGround: true,
    heat: 0,
    sink: 0,
    stalled: false,
    climbOut: false,
  };
}

const ease = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * Math.min(1, rate * dt);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** 燃料の消費。throttle 0 でも少しずつ減る */
export function burnFuel(c: Craft, v: VehicleDef, f: FuelDef, dt: number) {
  const use = v.fuelUse * (0.15 + 0.85 * c.throttle) * dt;
  c.fuel = Math.max(0, c.fuel - use / (TANK * f.capacity));
}

/**
 * 1 ステップ進める。地面との接触（着地・墜落）はここでは決めず、呼び出し側が c.pos.y と地面を比べて扱う。
 * groundY は今いる場所の地面の高さ（地上走行・離陸判定に使う）。
 */
export function step(c: Craft, v: VehicleDef, f: FuelDef, input: Input, wind: Vec3, groundY: number, dt: number) {
  const hasFuel = c.fuel > 0;
  c.throttle = hasFuel ? clamp(input.throttle, 0, 1) : 0;
  const power = f.power;
  switch (v.model) {
    case 'plane':
      stepPlane(c, v, power, input, wind, groundY, dt);
      break;
    case 'hover':
      stepHover(c, v, power, input, wind, groundY, dt);
      break;
    case 'rocket':
      stepRocket(c, v, power, input, wind, groundY, dt);
      break;
    case 'balloon':
      stepBalloon(c, v, power, input, wind, groundY, dt);
      break;
  }
  burnFuel(c, v, f, dt);
}

function stepPlane(c: Craft, v: VehicleDef, power: number, input: Input, wind: Vec3, groundY: number, dt: number) {
  const thrust = c.throttle * v.accel * power;
  const drag = (v.accel / (v.maxSpeed * v.maxSpeed)) * c.speed * c.speed;
  const lift = clamp((c.speed / v.takeoffSpeed) ** 2, 0, 1);
  if (c.onGround) {
    c.roll = ease(c.roll, 0, 6, dt);
    // 地上では左右で向きを変えられる（タキシング）
    c.yaw += input.x * 0.6 * Math.min(1, c.speed / 8) * dt;
    const canRotate = c.speed >= v.takeoffSpeed;
    // 離陸速度に達したら自動で少し機首を上げる（操作が簡単になるように）
    // （着陸後の減速中はスロットルを絞っているので、勝手に浮き上がらない）
    const assist = c.throttle > 0.5 ? 0.12 : 0;
    c.pitch = ease(c.pitch, canRotate ? Math.max(assist, input.y * 0.35) : 0, 3, dt);
    c.climbOut = canRotate && assist > 0;
    const brake = c.throttle < 0.08 ? 5 : 0.6;
    c.speed += (thrust - drag - brake * Math.sign(c.speed)) * dt;
    if (Math.abs(c.speed) < 0.3 && thrust < 0.6) c.speed = 0;
    c.speed = Math.max(0, c.speed);
    c.sink = 0;
    c.stalled = false;
  } else {
    c.stalled = c.speed < v.takeoffSpeed * 0.8;
    c.roll = ease(c.roll, input.x * 1.0, 3, dt);
    c.yaw += v.turnRate * Math.sin(c.roll) * clamp(c.speed / v.takeoffSpeed, 0.3, 1.5) * dt;
    // 離陸直後は、スティックを下に入れるか十分な高さになるまで自動で上昇を続ける
    if (c.climbOut && (input.y < -0.1 || c.pos.y - groundY > 40)) c.climbOut = false;
    let targetPitch = c.climbOut ? Math.max(input.y * 0.6, 0.15) : input.y * 0.6;
    if (c.stalled) targetPitch = Math.min(targetPitch, -0.35);
    c.pitch = ease(c.pitch, targetPitch, 2, dt);
    c.speed += (thrust - drag - G * Math.sin(c.pitch) * 0.7) * dt;
    c.speed = clamp(c.speed, 0, v.maxSpeed * 1.4);
    c.sink = ease(c.sink, (1 - lift) * 14, 1.5, dt);
  }
  const fw = forward(c.yaw, c.pitch);
  const air = c.onGround ? 0 : 1;
  c.vel = {
    x: fw.x * c.speed + wind.x * air,
    y: fw.y * c.speed - c.sink,
    z: fw.z * c.speed + wind.z * air,
  };
  move(c, dt);
  if (c.onGround && c.pos.y < groundY) c.pos.y = groundY;
}

function stepHover(c: Craft, v: VehicleDef, power: number, input: Input, wind: Vec3, groundY: number, dt: number) {
  const hasFuel = c.fuel > 0;
  const lift = hasFuel ? applyDeadzone((c.throttle - 0.5) * 2, 0.12) : -1.5;
  const targetVy = lift * v.climbRate * (lift > 0 ? power : 1);
  c.vel.y = ease(c.vel.y, targetVy, 2.5, dt);
  if (c.onGround && c.vel.y < 0) c.vel.y = 0;
  const airborne = !c.onGround;
  if (airborne || c.vel.y > 0) c.yaw += input.x * v.turnRate * dt;
  const targetSpeed = airborne && hasFuel ? input.y * v.maxSpeed * Math.min(power, 1.3) : 0;
  const prev = c.speed;
  c.speed = ease(c.speed, targetSpeed, v.accel / Math.max(v.maxSpeed, 1) * 2, dt);
  c.pitch = ease(c.pitch, clamp(-(c.speed - prev) / dt * 0.05 - input.y * 0.12, -0.45, 0.45), 4, dt);
  c.roll = ease(c.roll, input.x * 0.3 * (airborne ? 1 : 0), 4, dt);
  const fw = forward(c.yaw, 0);
  const drift = airborne ? 0.6 : 0;
  c.vel.x = fw.x * c.speed + wind.x * drift;
  c.vel.z = fw.z * c.speed + wind.z * drift;
  c.stalled = false;
  move(c, dt);
  if (c.onGround && c.pos.y < groundY) c.pos.y = groundY;
}

function stepRocket(c: Craft, v: VehicleDef, power: number, input: Input, wind: Vec3, groundY: number, dt: number) {
  c.pitch = clamp(c.pitch + input.y * v.turnRate * dt, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.001);
  c.yaw += input.x * v.turnRate * dt;
  c.roll = ease(c.roll, input.x * 0.4, 4, dt);
  const nose = forward(c.yaw, c.pitch);
  const thrust = c.throttle * v.accel * power;
  const sp = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
  const k = v.accel / (v.maxSpeed * v.maxSpeed);
  const ax = nose.x * thrust - c.vel.x * sp * k;
  let ay = nose.y * thrust - G - c.vel.y * sp * k;
  const az = nose.z * thrust - c.vel.z * sp * k;
  if (c.onGround && ay < 0) ay = 0;
  c.vel.x += ax * dt;
  c.vel.y += ay * dt;
  c.vel.z += az * dt;
  if (c.onGround && c.vel.y <= 0) {
    c.vel.x *= 0.9;
    c.vel.z *= 0.9;
    c.vel.y = 0;
  }
  // 尾翼の効果：速いと進行方向が機首の向きにそろう
  if (!c.onGround && sp > 8) {
    const t = Math.min(1, dt * 1.6);
    const s = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
    c.vel.x += (nose.x * s - c.vel.x) * t;
    c.vel.y += (nose.y * s - c.vel.y) * t;
    c.vel.z += (nose.z * s - c.vel.z) * t;
  }
  if (!c.onGround) {
    c.vel.x += (wind.x - c.vel.x) * 0.02 * dt;
    c.vel.z += (wind.z - c.vel.z) * 0.02 * dt;
  }
  c.speed = Math.hypot(c.vel.x, c.vel.y, c.vel.z);
  c.stalled = false;
  move(c, dt);
  if (c.onGround && c.pos.y < groundY) c.pos.y = groundY;
}

function stepBalloon(c: Craft, v: VehicleDef, power: number, input: Input, wind: Vec3, groundY: number, dt: number) {
  c.heat = ease(c.heat, c.throttle, 0.3, dt);
  const targetVy = (c.heat - 0.45) * 2.2 * v.climbRate * (c.heat > 0.45 ? power : 1);
  c.vel.y = ease(c.vel.y, targetVy, 0.6, dt);
  if (c.onGround && c.vel.y < 0) c.vel.y = 0;
  const airborne = !c.onGround;
  if (airborne) c.yaw += input.x * v.turnRate * dt;
  c.speed = ease(c.speed, airborne ? input.y * v.maxSpeed * 0.6 : 0, 0.5, dt);
  const fw = forward(c.yaw, 0);
  const w = airborne ? 1 : 0;
  c.vel.x = fw.x * c.speed + wind.x * w;
  c.vel.z = fw.z * c.speed + wind.z * w;
  c.pitch = 0;
  c.roll = ease(c.roll, Math.sin(performanceNow() * 0.0007) * 0.03, 1, dt);
  c.stalled = false;
  move(c, dt);
  if (c.onGround && c.pos.y < groundY) c.pos.y = groundY;
}

function move(c: Craft, dt: number) {
  c.pos.x += c.vel.x * dt;
  c.pos.y += c.vel.y * dt;
  c.pos.z += c.vel.z * dt;
}

function applyDeadzone(v: number, dz: number) {
  if (Math.abs(v) < dz) return 0;
  return (v - Math.sign(v) * dz) / (1 - dz);
}

function performanceNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** 「スタート！」の瞬間に入るスロットル。何もしなくても飛び立つようにしてある */
export function launchThrottle(v: VehicleDef): number {
  switch (v.model) {
    case 'plane':
      return 0.85;
    case 'hover':
      return 0.72;
    case 'rocket':
      return 1;
    case 'balloon':
      return 0.75;
  }
}
