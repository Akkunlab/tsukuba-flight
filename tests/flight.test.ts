// 飛行の物理と、ゲームの進行（離陸・着陸・墜落・燃料切れ）のテスト。
import { describe, expect, it } from 'vitest';
import { FUELS, MODES, VEHICLES, fuelById, fuelsFor, modeById, vehicleById } from '../src/content/index';
import type { ModeDef } from '../src/content/types';
import { Flight, COUNTDOWN } from '../src/sim/flight';
import type { Input } from '../src/sim/physics';
import { RUNWAY, RUNWAY_START, World, makeFlatWorldData } from '../src/sim/world';

const DT = 1 / 60;
const FREE: ModeDef = { ...modeById('free'), wind: 0 };

function run(f: Flight, seconds: number, input: Input | ((f: Flight) => Input)) {
  for (let t = 0; t < seconds && f.phase !== 'ended'; t += DT) {
    f.update(typeof input === 'function' ? input(f) : input, DT);
  }
}

function launch(f: Flight) {
  run(f, COUNTDOWN + 0.05, { x: 0, y: 0, throttle: 0 });
  expect(f.phase).toBe('flying');
}

describe('どの乗り物・燃料でも、何もしなくても飛び立てる', () => {
  const world = new World(makeFlatWorldData());
  for (const v of VEHICLES) {
    for (const fuel of fuelsFor(v)) {
      it(`${v.id} × ${fuel.id}`, () => {
        const f = new Flight(world, { vehicle: v, fuel, mode: FREE, seed: 1 });
        launch(f);
        const throttle = f.launchThrottle;
        // 気球は上がるのに時間がかかる
        run(f, v.model === 'balloon' ? 60 : 40, { x: 0, y: v.model === 'plane' ? 0.25 : 0, throttle });
        expect(f.tookOff, `${v.id} が離陸しない（outcome=${f.outcome} ${f.cause}）`).toBe(true);
        expect(['crashed', 'out']).not.toContain(f.outcome);
        for (const n of [f.craft.pos.x, f.craft.pos.y, f.craft.pos.z, f.craft.fuel]) expect(Number.isFinite(n)).toBe(true);
      });
    }
  }
});

describe('飛行機の着陸', () => {
  it('滑走路にゆっくり降りて止まると「着陸成功」', () => {
    const world = new World(makeFlatWorldData());
    const v = vehicleById('prop');
    const f = new Flight(world, { vehicle: v, fuel: fuelById('jetfuel'), mode: FREE, seed: 1 });
    launch(f);
    // 離陸して上昇
    run(f, 12, { x: 0, y: 0.4, throttle: 1 });
    expect(f.tookOff).toBe(true);
    // 進入：滑走路の南から北向きに、ゆっくり降下させる
    const c = f.craft;
    c.pos = { x: RUNWAY.x, y: world.terrainHeight(RUNWAY.x, 0) + 15, z: RUNWAY.z + RUNWAY.length / 2 - 50 };
    c.yaw = 0;
    c.pitch = 0;
    c.roll = 0;
    c.speed = 32;
    c.onGround = false;
    run(f, 60, (fl) => (fl.craft.onGround ? { x: 0, y: 0, throttle: 0 } : { x: 0, y: -0.06, throttle: 0.35 }));
    expect(f.cause).toBe('着陸成功');
    expect(f.outcome).toBe('landed');
    expect(f.score()).toBeGreaterThan(1500);
  });

  it('急降下で地面に当たると墜落', () => {
    const world = new World(makeFlatWorldData());
    const f = new Flight(world, { vehicle: vehicleById('prop'), fuel: fuelById('jetfuel'), mode: FREE, seed: 1 });
    launch(f);
    run(f, 12, { x: 0, y: 0.4, throttle: 1 });
    run(f, 60, { x: 0, y: -1, throttle: 1 });
    expect(f.outcome).toBe('crashed');
  });
});

describe('当たり判定', () => {
  it('建物にぶつかると墜落し、建物の名前が理由に入る', () => {
    const wall: [number, number][] = [
      [-200, -2200],
      [400, -2200],
      [400, -2190],
      [-200, -2190],
    ];
    const world = new World(makeFlatWorldData({ buildings: [{ p: wall, h: 300, n: 'テスト棟' }] }));
    const f = new Flight(world, { vehicle: vehicleById('heli'), fuel: fuelById('jetfuel'), mode: FREE, seed: 1 });
    launch(f);
    // 上昇してから北（壁の方向）へ
    run(f, 6, { x: 0, y: 0, throttle: 1 });
    run(f, 200, { x: 0, y: 1, throttle: 0.5 });
    expect(f.outcome).toBe('crashed');
    expect(f.cause).toContain('テスト棟');
  });

  it('森に突っ込むと墜落', () => {
    const wood: [number, number][] = [
      [-300, -2800],
      [400, -2800],
      [400, -2300],
      [-300, -2300],
    ];
    const world = new World(makeFlatWorldData({ woods: [wood] }));
    const f = new Flight(world, { vehicle: vehicleById('drone'), fuel: fuelById('battery'), mode: FREE, seed: 1 });
    launch(f);
    run(f, 1.2, { x: 0, y: 0, throttle: 0.9 });
    run(f, 200, { x: 0, y: 1, throttle: 0.5 });
    expect(f.outcome).toBe('crashed');
    expect(f.cause).toContain('木');
  });

  it('ヘリは屋上に着陸できる', () => {
    const roof: [number, number][] = [
      [600, -500],
      [700, -500],
      [700, -400],
      [600, -400],
    ];
    const world = new World(makeFlatWorldData({ buildings: [{ p: roof, h: 30, n: '屋上テスト棟' }] }));
    const f = new Flight(world, { vehicle: vehicleById('heli'), fuel: fuelById('jetfuel'), mode: FREE, seed: 1 });
    launch(f);
    run(f, 10, { x: 0, y: 0, throttle: 1 });
    const c = f.craft;
    c.pos.x = 650;
    c.pos.z = -450;
    c.pos.y = Math.max(c.pos.y, world.terrainHeight(650, -450) + 60);
    c.speed = 0;
    run(f, 60, { x: 0, y: 0, throttle: 0.25 });
    expect(f.outcome).toBe('landed');
    expect(f.cause).toContain('屋上');
  });
});

describe('燃料', () => {
  it('燃料が尽きるとゲームオーバー', () => {
    const world = new World(makeFlatWorldData());
    const f = new Flight(world, { vehicle: vehicleById('drone'), fuel: fuelById('battery'), mode: FREE, seed: 1 });
    launch(f);
    run(f, 3, { x: 0, y: 0, throttle: 1 });
    f.craft.fuel = 0.001;
    run(f, 30, { x: 0, y: 0, throttle: 1 });
    expect(f.outcome).toBe('fuel');
  });

  it('容量の大きい燃料ほど長く飛べる', () => {
    const world = new World(makeFlatWorldData());
    const v = vehicleById('heli');
    const small = [...FUELS].sort((a, b) => a.capacity - b.capacity)[0];
    const big = [...FUELS].sort((a, b) => b.capacity - a.capacity)[0];
    const fs = [small, big].map((fuel) => {
      const f = new Flight(world, { vehicle: v, fuel, mode: FREE, seed: 1 });
      launch(f);
      run(f, 20, { x: 0, y: 0, throttle: 0.6 });
      return f.craft.fuel;
    });
    expect(fs[1]).toBeGreaterThan(fs[0]);
  });
});

describe('チェックポイント', () => {
  it('リングをくぐると数が増える', () => {
    const world = new World(makeFlatWorldData());
    const mode: ModeDef = { ...MODES[0], wind: 0, checkpoints: [{ name: 'テスト', x: RUNWAY_START.x + 85, z: RUNWAY_START.z - 200, alt: 40 }] };
    const f = new Flight(world, { vehicle: vehicleById('heli'), fuel: fuelById('jetfuel'), mode, seed: 1 });
    launch(f);
    const target = f.checkpointPosition(0)!;
    run(f, 120, (fl) => {
      const c = fl.craft;
      const climb = c.pos.y < target.y - 2 ? 1 : c.pos.y > target.y + 2 ? 0.2 : 0.5;
      const close = c.pos.y > target.y - 10;
      return { x: 0, y: close ? 0.5 : 0, throttle: climb };
    });
    expect(f.stats.checkpoints).toBe(1);
  });
});
