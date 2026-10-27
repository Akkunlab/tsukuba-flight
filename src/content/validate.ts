// 要素データの検査。テストと、ユーザーが作った要素の読み込み時に使う。
import type { FuelDef, ModeDef, PassengerDef, SceneryDef, SoundRecipe, VehicleDef } from './types';

const WAVES = ['sine', 'square', 'sawtooth', 'triangle', 'noise'];
const MODELS = ['plane', 'hover', 'rocket', 'balloon'];
const ENGINES = ['jet', 'prop', 'rotor', 'multirotor', 'rocket', 'burner', 'hiss', 'whoosh', 'none'];
const COLOR = /^#[0-9a-fA-F]{6}$/;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

function num(errors: string[], where: string, v: unknown, min: number, max: number) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    errors.push(`${where}: ${String(v)} は ${min}〜${max} の数値であること`);
  }
}
function str(errors: string[], where: string, v: unknown, max = 200) {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) errors.push(`${where}: 1〜${max} 文字の文字列であること`);
}

export function validateSound(s: SoundRecipe, where: string): string[] {
  const e: string[] = [];
  if (!WAVES.includes(s.wave)) e.push(`${where}.wave: 不明な波形 ${s.wave}`);
  num(e, `${where}.base`, s.base, 20, 5000);
  if (!Array.isArray(s.pattern) || s.pattern.length === 0 || s.pattern.length > 64) {
    e.push(`${where}.pattern: 1〜64 ステップの配列であること`);
  } else {
    s.pattern.forEach((p, i) => p !== null && num(e, `${where}.pattern[${i}]`, p, -36, 36));
  }
  num(e, `${where}.bpm`, s.bpm, 20, 400);
  num(e, `${where}.gate`, s.gate, 0.01, 1);
  num(e, `${where}.attack`, s.attack, 0, 2);
  num(e, `${where}.release`, s.release, 0, 4);
  num(e, `${where}.filter`, s.filter, 50, 20000);
  num(e, `${where}.vibratoHz`, s.vibratoHz, 0, 60);
  num(e, `${where}.vibratoDepth`, s.vibratoDepth, 0, 12);
  num(e, `${where}.voices`, s.voices, 1, 8);
  num(e, `${where}.detune`, s.detune, 0, 200);
  num(e, `${where}.glide`, s.glide, 0, 1);
  num(e, `${where}.gain`, s.gain, 0, 1);
  if (s.harmonics) {
    if (!Array.isArray(s.harmonics) || s.harmonics.length > 32) e.push(`${where}.harmonics: 32 個までの配列`);
    else s.harmonics.forEach((h, i) => num(e, `${where}.harmonics[${i}]`, h, 0, 1));
  }
  if (s.follow?.altitude !== undefined) num(e, `${where}.follow.altitude`, s.follow.altitude, -12, 12);
  if (s.follow?.speed !== undefined) num(e, `${where}.follow.speed`, s.follow.speed, 0, 4);
  return e;
}

export function validateVehicle(v: VehicleDef, fuelIds: string[]): string[] {
  const e: string[] = [];
  const w = `vehicle ${v.id}`;
  if (!ID.test(v.id)) e.push(`${w}: id は英小文字・数字・ハイフン`);
  str(e, `${w}.name`, v.name, 30);
  str(e, `${w}.description`, v.description);
  if (!MODELS.includes(v.model)) e.push(`${w}.model: 不明 ${v.model}`);
  if (!ENGINES.includes(v.engine)) e.push(`${w}.engine: 不明 ${v.engine}`);
  if (!COLOR.test(v.color)) e.push(`${w}.color: #rrggbb`);
  num(e, `${w}.radius`, v.radius, 0.3, 30);
  num(e, `${w}.maxSpeed`, v.maxSpeed, 1, 400);
  num(e, `${w}.accel`, v.accel, 0.1, 60);
  num(e, `${w}.turnRate`, v.turnRate, 0.05, 5);
  num(e, `${w}.climbRate`, v.climbRate, 0, 60);
  num(e, `${w}.takeoffSpeed`, v.takeoffSpeed, 0, v.maxSpeed);
  num(e, `${w}.fuelUse`, v.fuelUse, 0.01, 10);
  num(e, `${w}.enginePitch`, v.enginePitch, 0.1, 5);
  if (v.model === 'plane' && v.takeoffSpeed <= 0) e.push(`${w}: plane は takeoffSpeed > 0`);
  if (v.model === 'plane' && v.start !== 'runway') e.push(`${w}: plane は滑走路から出発する`);
  if (v.fuels) {
    if (v.fuels.length === 0) e.push(`${w}.fuels: 空にしない`);
    v.fuels.forEach((f) => !fuelIds.includes(f) && e.push(`${w}.fuels: 不明な燃料 ${f}`));
  }
  return e;
}

export function validateFuel(f: FuelDef): string[] {
  const e: string[] = [];
  const w = `fuel ${f.id}`;
  if (!ID.test(f.id)) e.push(`${w}: id は英小文字・数字・ハイフン`);
  str(e, `${w}.name`, f.name, 30);
  num(e, `${w}.capacity`, f.capacity, 0.2, 5);
  num(e, `${w}.power`, f.power, 0.2, 3);
  num(e, `${w}.tone`, f.tone, 0.2, 4);
  if (!COLOR.test(f.trailColor)) e.push(`${w}.trailColor: #rrggbb`);
  return e;
}

export function validatePassenger(p: PassengerDef): string[] {
  const e: string[] = [];
  const w = `passenger ${p.id}`;
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(p.id)) e.push(`${w}: id は英小文字・数字・ハイフン`);
  str(e, `${w}.name`, p.name, 30);
  str(e, `${w}.emoji`, p.emoji, 16);
  if (!COLOR.test(p.trailColor)) e.push(`${w}.trailColor: #rrggbb`);
  return e.concat(validateSound(p.sound, `${w}.sound`));
}

export function validateMode(m: ModeDef): string[] {
  const e: string[] = [];
  const w = `mode ${m.id}`;
  if (!ID.test(m.id)) e.push(`${w}: id は英小文字・数字・ハイフン`);
  str(e, `${w}.name`, m.name, 30);
  num(e, `${w}.timeLimit`, m.timeLimit, 0, 3600);
  num(e, `${w}.wind`, m.wind, 0, 30);
  m.checkpoints.forEach((c, i) => {
    num(e, `${w}.checkpoints[${i}].x`, c.x, -12000, 12000);
    num(e, `${w}.checkpoints[${i}].z`, c.z, -12000, 12000);
    num(e, `${w}.checkpoints[${i}].alt`, c.alt, 15, 1500);
  });
  return e;
}

export function validateScenery(s: SceneryDef, kinds: string[]): string[] {
  const e: string[] = [];
  if (!ID.test(s.id)) e.push(`scenery ${s.id}: id は英小文字・数字・ハイフン`);
  if (!kinds.includes(s.kind)) e.push(`scenery ${s.id}: 不明な kind ${s.kind}（world/scenery.ts に実装が要る）`);
  return e;
}

export function uniqueIds(list: { id: string }[], label: string): string[] {
  const seen = new Set<string>();
  const e: string[] = [];
  for (const x of list) {
    if (seen.has(x.id)) e.push(`${label}: id ${x.id} が重複`);
    seen.add(x.id);
  }
  return e;
}
