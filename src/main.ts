import './style.css';
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EVOLUTION_LOG, GENERATION, SCENERY, fuelById, modeById, passengerById, vehicleById } from './content/index';
import type { PassengerDef } from './content/types';
import { AudioEngine } from './audio/sound';
import { Controls } from './input/controls';
import { Hangar } from './ui/hangar';
import { icon } from './ui/icons';
import { Flight, RING_RADIUS, type FlightEvent, type Phase } from './sim/flight';
import { forward } from './sim/physics';
import { PAD, RUNWAY_START, World, inRunwayArea, type WorldData } from './sim/world';
import { buildAirfield, buildBuildings, buildTerrain, buildTrees, buildWater, loadTexture, makePhotoSampler } from './world/terrain';
import { buildScenery, type SceneryObject } from './world/scenery';
import { buildVehicleModel, type VehicleModel } from './render/vehicleMesh';
import { Balloons, Explosion, Rings, Trail, blobShadow, pathLine } from './render/effects';
import { ReplayPlayer, type ReplayCamera } from './render/replay';
import { fetchSummary, flushQueue, loadSettings, playerId, randomId, saveBest, saveSettings, sendFlight } from './net/api';

type Screen = 'loading' | 'title' | 'hangar' | 'flying' | 'result';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.add(isTouch ? 'touch' : 'desktop');

/** 描画の品質。?quality=low|medium|high で指定できる（省略時はスマホ medium、パソコン high） */
type Quality = 'low' | 'medium' | 'high';
const qParam = new URLSearchParams(location.search).get('quality');
const quality: Quality = qParam === 'low' || qParam === 'medium' || qParam === 'high' ? qParam : isTouch ? 'medium' : 'high';
const Q = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 1024, shadowHalf: 200, trees: 3000, sampler: 512 },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 2048, shadowHalf: 260, trees: 7000, sampler: 1024 },
  high: { pixelRatio: 2, shadows: true, shadowMap: 4096, shadowHalf: 420, trees: 18000, sampler: 2048 },
}[quality];

const debug = { errors: [] as string[], frames: 0 };
window.addEventListener('error', (e) => debug.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => debug.errors.push(String(e.reason)));

// ---------- three.js の基本 ----------
const canvas = $<HTMLCanvasElement>('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, Q.pixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;
renderer.shadowMap.enabled = Q.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.3, 140000);
camera.position.set(0, 400, 900);
// 遠くほど霞む（大気の厚み）
const HAZE = new THREE.Color(0xb4c6d6);
scene.fog = new THREE.FogExp2(HAZE, 0.00005);

// 空。太陽は南西のやや高い位置（午後の光）
const sky = new Sky();
sky.scale.setScalar(120000);
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(215));
const su = sky.material.uniforms;
su.turbidity.value = 5.5;
su.rayleigh.value = 1.6;
su.mieCoefficient.value = 0.005;
su.mieDirectionalG.value = 0.82;
su.sunPosition.value.copy(sunDir);
scene.add(sky);

// 空の色を周りの映り込み（環境光）に使う
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = new Sky();
envSky.scale.setScalar(1000);
Object.assign(envSky.material.uniforms.sunPosition.value, sunDir);
for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG'] as const) envSky.material.uniforms[k].value = su[k].value;
envScene.add(envSky);
envScene.add(new THREE.Mesh(new THREE.CircleGeometry(900, 16).rotateX(-Math.PI / 2).translate(0, -10, 0), new THREE.MeshBasicMaterial({ color: 0x4d5a3d })));
scene.environment = pmrem.fromScene(envScene, 0.02).texture;
scene.environmentIntensity = 0.55;

scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5236, 0.7));
const sunLight = new THREE.DirectionalLight(0xfff0dc, 2.6);
sunLight.castShadow = Q.shadows;
const SHADOW_HALF = Q.shadowHalf;
sunLight.shadow.mapSize.set(Q.shadowMap, Q.shadowMap);
const sc = sunLight.shadow.camera;
sc.left = -SHADOW_HALF;
sc.right = SHADOW_HALF;
sc.top = SHADOW_HALF;
sc.bottom = -SHADOW_HALF;
sc.near = 10;
sc.far = 5000;
sunLight.shadow.bias = -0.0004;
sunLight.shadow.normalBias = 0.6;
scene.add(sunLight, sunLight.target);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- 状態 ----------
const audio = new AudioEngine();
const controls = new Controls($('#hud'));
let screen: Screen = 'loading';
let world: World;
let hangar: Hangar;
let flight: Flight | null = null;
let model: VehicleModel | null = null;
let passengersOnBoard: PassengerDef[] = [];
let scenery: SceneryObject[] = [];
let water: THREE.Mesh | null = null;
const trail = new Trail();
const rings = new Rings();
const balloons = new Balloons();
const explosion = new Explosion();
const shadow = blobShadow();
const replay = new ReplayPlayer();
let route: THREE.Line | null = null;
scene.add(trail.mesh, rings.group, balloons.group, explosion.group, shadow);
let cameraMode: 'chase' | 'far' | 'cockpit' = 'chase';
let paused = false;
let endTimer = 0;
let messageTimer = 0;
let clock = 0;
let previewModel: VehicleModel | null = null;
let currentWind = { x: 0, y: 0, z: 0 };
let replayExploded = false;
const focus = new THREE.Vector3();

function setScreen(s: Screen) {
  screen = s;
  $('#title').classList.toggle('hidden', s !== 'title');
  $('#hangar').classList.toggle('hidden', s !== 'hangar');
  $('#hud').classList.toggle('hidden', s !== 'flying');
  $('#result').classList.toggle('hidden', s !== 'result');
  document.body.classList.toggle('flying', s === 'flying' || s === 'result');
  document.body.classList.toggle('in-hangar', s === 'hangar');
  controls.enabled = s === 'flying';
  if (s !== 'hangar' && previewModel) {
    scene.remove(previewModel.group);
    previewModel = null;
  }
  if (s !== 'result') {
    replay.stop();
    if (route) scene.remove(route);
    route = null;
  }
  if (s === 'hangar') updatePreview();
  if (s === 'title') void renderSummary();
}

function setLoading(p: number, text?: string) {
  $('#loading-fill').style.width = `${Math.round(p * 100)}%`;
  if (text) $('#loading-text').textContent = text;
}

async function fetchWorld(): Promise<WorldData> {
  const res = await fetch('/data/world.json');
  const total = Number(res.headers.get('content-length')) || 1_900_000;
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    setLoading(0.1 + 0.4 * Math.min(1, got / total));
  }
  const buf = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.length;
  }
  return JSON.parse(new TextDecoder().decode(buf));
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function init() {
  setLoading(0.05, '地形データを読み込んでいます…');
  const [data, nearTex, farTex] = await Promise.all([
    fetchWorld(),
    loadTexture('/data/near.jpg', renderer),
    loadTexture('/data/far.jpg', renderer),
  ]);
  setLoading(0.6, 'キャンパスを組み立てています…');
  await tick();
  world = new World(data);
  scene.add(buildTerrain(world, nearTex, farTex));
  const sampler = makePhotoSampler(nearTex.image as HTMLImageElement, world, Q.sampler);
  setLoading(0.72, '建物を建てています…');
  await tick();
  scene.add(buildBuildings(world, sampler));
  setLoading(0.85, '木を植えています…');
  await tick();
  scene.add(buildTrees(world, Q.trees));
  water = buildWater(world);
  scene.add(water);
  scene.add(buildAirfield(world));
  scenery = buildScenery(SCENERY, { world, wind: () => currentWind });
  for (const s of scenery) scene.add(s.object);
  setLoading(1, 'できました');

  hangar = new Hangar(loadSettings(), audio);
  audio.volumes = { ...hangar.settings.volumes };
  hangar.onChange = () => {
    saveSettings(hangar.settings);
    if (screen === 'hangar') updatePreview();
  };
  renderTitle();
  setScreen('title');
  $('#loading').classList.add('hidden');
  void flushQueue();
}

function renderTitle() {
  const last = EVOLUTION_LOG[EVOLUTION_LOG.length - 1];
  $('#st-gen').textContent = String(GENERATION);
  $('#generation').textContent = `第 ${GENERATION} 世代「${last.title}」（${last.date}）`;
  $('#evolution-list').innerHTML = [...EVOLUTION_LOG]
    .reverse()
    .map((e) => `<li><b>第${e.generation}世代「${escapeHtml(e.title)}」</b>（${e.date}）<br>${escapeHtml(e.summary)}</li>`)
    .join('');
}

async function renderSummary() {
  const s = await fetchSummary();
  const fmt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n.toLocaleString());
  $('#st-pilots').textContent = s ? fmt(s.pilots) : '—';
  $('#st-flights').textContent = s ? fmt(s.flights) : '—';
  $('#st-score').textContent = s ? fmt(s.totalScore) : '—';
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function placeModel(m: VehicleModel, x: number, z: number, model: string) {
  m.group.position.set(x, world.terrainHeight(x, z), z);
  m.group.rotation.order = 'YXZ';
  if (model === 'rocket') m.group.rotation.x = Math.PI / 2;
}

function updatePreview() {
  if (!world) return;
  if (previewModel) scene.remove(previewModel.group);
  const s = hangar.settings;
  const v = vehicleById(s.vehicle);
  const m = buildVehicleModel(v.shape, s.vehicleColor ?? v.color);
  const start = v.start === 'runway' ? RUNWAY_START : PAD;
  placeModel(m, start.x, start.z, v.model);
  m.group.userData.radius = v.radius;
  previewModel = m;
  scene.add(m.group);
}

// ---------- フライト ----------
function startFlight() {
  const s = hangar.settings;
  audio.unlock();
  const vehicle = vehicleById(s.vehicle);
  const fuel = fuelById(s.fuel);
  const mode = modeById(s.mode);
  flight = new Flight(world, { vehicle, fuel, mode, seed: Math.floor(Math.random() * 100000) });
  if (model) scene.remove(model.group);
  model = buildVehicleModel(vehicle.shape, s.vehicleColor ?? vehicle.color);
  model.group.rotation.order = 'YXZ';
  scene.add(model.group);
  passengersOnBoard = s.passengers.map((id) => passengerById(id, hangar.custom)).filter((p): p is PassengerDef => !!p);
  trail.clear();
  trail.setting = { ...s.trail };
  trail.baseWidth = Math.max(0.35, vehicle.radius * 0.12);
  explosion.clear();
  rings.set(
    mode.checkpoints.map((_, i) => {
      const p = flight!.checkpointPosition(i)!;
      return new THREE.Vector3(p.x, p.y, p.z);
    }),
    RING_RADIUS,
    (x, z) => world.terrainHeight(x, z),
  );
  rings.group.visible = mode.checkpoints.length > 0;
  balloons.set(flight.targets, mode.targets?.radius ?? 8);
  balloons.group.visible = flight.targets.length > 0;
  $('#hud-mode').textContent = mode.name;
  $('#hud-objective').textContent = mode.objective;
  $('#hud-target').classList.add('hidden');
  controls.reset(0);
  audio.startFlight(vehicle.engine, vehicle.enginePitch * fuel.tone, passengersOnBoard.map((p) => p.sound));
  paused = false;
  endTimer = 0;
  cameraMode = 'chase';
  $('#result').classList.remove('collapsed');
  setScreen('flying');
  $('#help').classList.remove('hidden');
  setTimeout(() => $('#help').classList.add('hidden'), 9000);
  showMessage('');
  audio.say('よーい');
}

function showMessage(text: string, seconds = 2.5) {
  $('#hud-message').textContent = text;
  messageTimer = seconds;
}

function handleEvents(ev: FlightEvent[]) {
  for (const e of ev) {
    switch (e.type) {
      case 'countdown':
        $('#hud-count').textContent = String(e.value);
        audio.sfx('beep');
        break;
      case 'start':
        $('#hud-count').textContent = 'スタート！';
        setTimeout(() => ($('#hud-count').textContent = ''), 900);
        audio.sfx('go');
        audio.say('スタート！');
        controls.reset(flight!.launchThrottle);
        break;
      case 'takeoff':
        showMessage('離陸');
        break;
      case 'checkpoint':
        audio.sfx('checkpoint');
        showMessage(`${e.text} 通過`);
        rings.setCurrent(flight!.nextCheckpoint);
        break;
      case 'allCheckpoints':
        showMessage('全リング通過 ― 着陸してボーナス', 4);
        break;
      case 'pop':
        audio.sfx('checkpoint');
        balloons.pop(e.value!);
        showMessage(`風船 ${flight!.stats.targets} / ${flight!.targets.length}`, 1.5);
        break;
      case 'allTargets':
        showMessage('全部割った ― 着陸してボーナス', 4);
        break;
      case 'touchdown':
        showMessage('接地', 1.2);
        break;
      case 'warning':
        audio.sfx('warning');
        showMessage(e.text ?? '', 3);
        break;
      case 'end':
        onFlightEnd();
        break;
    }
  }
}

function onFlightEnd() {
  const f = flight!;
  if (f.outcome === 'crashed') {
    audio.sfx('crash');
    const c = f.craft.pos;
    explosion.burst(new THREE.Vector3(c.x, c.y + 1, c.z), Math.max(1.5, f.setup.vehicle.radius * 0.6));
    if (model) model.group.visible = false;
  } else if (f.outcome === 'landed') {
    audio.sfx('landed');
  } else if (f.outcome === 'fuel') {
    audio.sfx('warning');
  }
  audio.stopFlight();
  showMessage(f.cause, 3);
  endTimer = f.outcome === 'quit' ? 0.01 : 1.8;
  const s = hangar.settings;
  const trailColor = s.trail.mode === 'custom' ? s.trail.color : '#' + autoTrailColor(0).getHexString();
  void sendFlight({
    id: randomId('f'),
    playerId: playerId(),
    generation: GENERATION,
    mode: f.setup.mode.id,
    vehicle: f.setup.vehicle.id,
    fuel: f.setup.fuel.id,
    passengers: s.passengers,
    trailColor,
    outcome: f.outcome!,
    cause: f.cause,
    duration: Math.round(f.stats.duration * 10) / 10,
    distance: Math.round(f.stats.distance),
    maxAlt: Math.round(f.stats.maxAlt),
    maxSpeed: Math.round(f.stats.maxSpeed * 10) / 10,
    checkpoints: f.stats.checkpoints + f.stats.targets,
    score: f.score(),
    device: isTouch ? 'touch' : 'desktop',
    end: [Math.round(f.craft.pos.x), Math.round(f.craft.pos.y), Math.round(f.craft.pos.z)],
    path: f.stats.path,
  });
}

const OUTCOME_TITLE = { landed: '着陸成功', crashed: '墜落', fuel: '燃料切れ', out: 'エリア外', timeout: '時間切れ', quit: '飛行終了' } as const;
const OUTCOME_ICON = { landed: 'landed', crashed: 'crashed', fuel: 'fuel', out: 'out', timeout: 'timeout', quit: 'quit' } as const;

function showResult() {
  const f = flight!;
  $('#result-icon').innerHTML = icon(OUTCOME_ICON[f.outcome!]);
  $('#result-title').textContent = OUTCOME_TITLE[f.outcome!];
  $('#result-cause').textContent = `${f.setup.mode.name} ・ ${f.setup.vehicle.name} ・ ${f.cause}`;
  const score = f.score();
  $('#result-score').textContent = `${score.toLocaleString()} pts`;
  $('#result-best').textContent = f.outcome !== 'quit' && score > 0 && saveBest(f.setup.mode.id, score) ? '自己ベスト更新' : '';
  const s = f.stats;
  const rows: [string, string][] = [
    ['飛行時間', formatTime(s.duration)],
    ['飛んだ距離', `${(s.distance / 1000).toFixed(2)} km`],
    ['最高高度', `${Math.round(s.maxAlt)} m`],
    ['最高速度', `${Math.round(s.maxSpeed * 3.6)} km/h`],
  ];
  if (f.checkpoints.length) rows.push(['リング', `${s.checkpoints} / ${f.checkpoints.length}`]);
  if (f.targets.length) rows.push(['風船', `${s.targets} / ${f.targets.length}`]);
  rows.push(['残り燃料', `${Math.round(f.craft.fuel * 100)}%`]);
  $('#result-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  setScreen('result');
  // リプレイと、飛んだ道すじ
  if (f.replay.length > 1) {
    replay.start(f.replay, f.outcome === 'crashed');
    replayExploded = false;
    route = pathLine(f.replay.map((r) => ({ x: r[1], y: r[2], z: r[3] })), (x, z) => world.terrainHeight(x, z));
    scene.add(route);
    if (model) model.group.visible = true;
    trail.clear();
  }
  updateReplayLabel();
}

const REPLAY_CAM_LABEL: Record<ReplayCamera, string> = { chase: 'CHASE', side: 'SIDE', tower: 'GROUND', top: 'OVERHEAD' };
function updateReplayLabel() {
  $('#replay-cam').textContent = `${REPLAY_CAM_LABEL[replay.camera]}${replay.auto ? ' ・ AUTO' : ''}`;
}

function formatTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** おまかせの軌跡の色：燃料の色と、搭乗者の色を時間で巡る */
function autoTrailColor(t: number): THREE.Color {
  const f = flight ? flight.setup.fuel : fuelById(hangar.settings.fuel);
  const base = new THREE.Color(f.trailColor);
  const cols = passengersOnBoard.map((p) => new THREE.Color(p.trailColor));
  if (cols.length === 0) return base;
  const phase = (t / 1.6) % cols.length;
  const i = Math.floor(phase);
  const c = cols[i].clone().lerp(cols[(i + 1) % cols.length], phase - i);
  return c.lerp(base, 0.25);
}

function togglePause(force?: boolean) {
  if (screen !== 'flying' || !flight || flight.phase === 'ended') return;
  paused = force ?? !paused;
  $('#pause').classList.toggle('hidden', !paused);
  if (audio.ctx) {
    if (paused) void audio.ctx.suspend();
    else void audio.ctx.resume();
  }
}

function toggleMute() {
  audio.muted = !audio.muted;
  audio.applyVolumes();
  $('#btn-mute').innerHTML = icon(audio.muted ? 'mute' : 'sound');
}

function quitFlight() {
  if (flight && flight.phase !== 'ended') {
    flight.quit();
    onFlightEnd();
  }
  paused = false;
  if (audio.ctx?.state === 'suspended') void audio.ctx.resume();
  $('#pause').classList.add('hidden');
  if (model) scene.remove(model.group);
  model = null;
  flight = null;
  trail.clear();
  rings.group.visible = false;
  balloons.group.visible = false;
  setScreen('hangar');
}

controls.onAction = (a) => {
  if (a === 'camera') cycleCamera();
  if (a === 'pause') togglePause();
  if (a === 'mute') toggleMute();
};
function cycleCamera() {
  if (screen === 'result') {
    cycleReplayCamera();
    return;
  }
  cameraMode = cameraMode === 'chase' ? 'far' : cameraMode === 'far' ? 'cockpit' : 'chase';
}
function cycleReplayCamera() {
  const order: ReplayCamera[] = ['chase', 'side', 'tower', 'top'];
  if (replay.auto) replay.auto = false;
  else replay.camera = order[(order.indexOf(replay.camera) + 1) % order.length];
  updateReplayLabel();
}

$('#btn-camera').innerHTML = icon('camera');
$('#btn-mute').innerHTML = icon('sound');
$('#btn-pause').innerHTML = icon('pause');
$('#hud-arrow').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 20 20 12 15.5 4 20z"/></svg>';

$('#btn-hangar').addEventListener('click', () => {
  audio.unlock();
  setScreen('hangar');
});
$('#btn-back-title').addEventListener('click', () => setScreen('title'));
$('#btn-start').addEventListener('click', startFlight);
$('#btn-retry').addEventListener('click', () => {
  if (model) scene.remove(model.group);
  startFlight();
});
$('#btn-to-hangar').addEventListener('click', quitFlight);
$('#btn-camera').addEventListener('click', cycleCamera);
$('#btn-mute').addEventListener('click', toggleMute);
$('#btn-pause').addEventListener('click', () => togglePause());
$('#btn-resume').addEventListener('click', () => togglePause(false));
$('#btn-quit').addEventListener('click', quitFlight);
$('#btn-replay-cam').addEventListener('click', cycleReplayCamera);
$('#btn-replay-panel').addEventListener('click', () => {
  const r = $('#result');
  r.classList.toggle('collapsed');
  $('#btn-replay-panel').textContent = r.classList.contains('collapsed') ? '結果を見る' : '結果を隠す';
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) togglePause(true);
});

// ---------- 毎フレーム ----------
const tmpV = new THREE.Vector3();
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
let last = performance.now();

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  clock += dt;
  debug.frames++;
  if (screen === 'loading') return;

  if (screen === 'flying' && flight && !paused) {
    const input = controls.read(dt);
    if (flight.phase !== 'ended') {
      const n = Math.max(1, Math.ceil(dt / (1 / 60)));
      const f = flight;
      for (let i = 0; i < n; i++) {
        handleEvents(f.update(input, dt / n));
        if ((f.phase as Phase) === 'ended') break;
      }
    }
    currentWind = flight.wind;
    updateFlightVisuals(dt);
    updateHud();
    if (endTimer > 0) {
      endTimer -= dt;
      if (endTimer <= 0 && screen === 'flying') showResult();
    }
  } else if (screen === 'result' && flight) {
    updateReplay(dt);
  } else if (screen === 'title' || screen === 'hangar') {
    updateAttractCamera();
  }

  if (messageTimer > 0) {
    messageTimer -= dt;
    if (messageTimer <= 0) $('#hud-message').textContent = '';
  }
  rings.update(clock);
  balloons.update(dt, clock);
  explosion.update(dt);
  for (const s of scenery) s.update?.(dt, clock);
  if (water) {
    const nm = (water.material as THREE.MeshStandardMaterial).normalMap;
    if (nm) nm.offset.set(clock * 0.004, clock * 0.0025);
  }
  updateSun();
  renderer.render(scene, camera);
}

/** 影を落とす範囲を、いま見ている所に合わせて動かす（ちらつかないよう影の画素単位でそろえる） */
function updateSun() {
  if (screen === 'flying' || screen === 'result') {
    if (model) focus.copy(model.group.position);
  } else if (screen === 'hangar' && previewModel) {
    focus.copy(previewModel.group.position);
  } else {
    focus.set(camera.position.x * 0.5, 30, camera.position.z * 0.5 + 100);
  }
  const texel = (SHADOW_HALF * 2) / sunLight.shadow.mapSize.x;
  const fx = Math.round(focus.x / texel) * texel;
  const fz = Math.round(focus.z / texel) * texel;
  sunLight.target.position.set(fx, focus.y, fz);
  sunLight.position.set(fx + sunDir.x * 2000, focus.y + sunDir.y * 2000, fz + sunDir.z * 2000);
}

function poseModel(m: VehicleModel, pos: THREE.Vector3 | { x: number; y: number; z: number }, yaw: number, pitch: number, roll: number, throttle: number, dt: number, idle: boolean) {
  const g = m.group;
  g.position.set(pos.x, pos.y, pos.z);
  g.rotation.set(pitch, -yaw, -roll, 'YXZ');
  const spin = idle ? 0.3 : Math.max(0.15, throttle);
  for (const s of m.spinners) s.obj.rotation[s.axis] += s.speed * spin * dt;
  // 速く回るほど、羽根は見えにくく、残像の円盤が見える
  const blur = Math.max(0, Math.min(1, (spin - 0.25) * 1.6));
  for (const d of m.discs) (d.material as THREE.MeshBasicMaterial).opacity = blur * 0.28;
  for (const s of m.spinners) s.obj.visible = blur < 0.85;
}

function updateFlightVisuals(dt: number) {
  const f = flight!;
  const c = f.craft;
  const v = f.setup.vehicle;
  if (model) {
    poseModel(model, c.pos, c.yaw, c.pitch, c.roll, c.throttle, dt, f.phase === 'countdown');
    const burning = f.phase === 'flying' && c.fuel > 0 ? c.throttle : 0;
    for (const fl of model.flames) {
      const k = v.model === 'balloon' ? Math.max(0, burning - 0.4) * 1.7 : burning;
      fl.visible = k > 0.03;
      fl.scale.setScalar(0.4 + k * (0.8 + Math.random() * 0.3));
    }

    // 軌跡
    const g = model.group;
    g.updateMatrixWorld();
    const tail = model.tail.clone().applyMatrix4(g.matrixWorld);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
    if (v.model === 'rocket' || v.model === 'balloon') right.set(Math.cos(c.yaw), 0, Math.sin(c.yaw));
    const level = audio.passengerLevel();
    const color = trail.setting.mode === 'custom' ? new THREE.Color(trail.setting.color) : autoTrailColor(clock);
    color.offsetHSL(0, 0, level * 0.15);
    trail.update(dt, tail, right, color, level, f.phase === 'flying' && !c.onGround && model.group.visible);
  }

  // 影（真下の目安。実際の影は太陽の影）
  const surf = world.surfaceHeight(c.pos.x, c.pos.z);
  const alt = c.pos.y - surf.height;
  shadow.visible = alt > 60 && alt < 400 && model?.group.visible !== false;
  shadow.position.set(c.pos.x, surf.height + 0.25, c.pos.z);
  const size = v.radius * 2.2 * (1 + alt / 120);
  shadow.scale.set(size, 1, size);
  (shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.6 - alt / 600);

  audio.update({ throttle: c.throttle, speed: c.speed, altitude: alt });
  updateFlightCamera(dt);
}

function updateReplay(dt: number) {
  const f = flight!;
  const pose = replay.update(dt);
  if (!pose || !model) {
    updateAttractCamera();
    return;
  }
  const end = replay.frames[replay.frames.length - 1][0];
  const atEnd = pose.t >= end - 0.02;
  poseModel(model, pose.pos, pose.yaw, pose.pitch, pose.roll, pose.throttle, dt, false);
  if (replay.crashed) {
    model.group.visible = !atEnd;
    if (atEnd && !replayExploded) {
      replayExploded = true;
      explosion.burst(pose.pos.clone().add(new THREE.Vector3(0, 1, 0)), Math.max(1.5, f.setup.vehicle.radius * 0.6));
      audio.sfx('crash');
    }
    if (!atEnd) replayExploded = false;
  }
  for (const fl of model.flames) fl.visible = pose.throttle > 0.1 && !atEnd;
  replay.place(camera, pose, f.setup.vehicle.radius, (x, z) => world.surfaceHeight(x, z).height);
  updateReplayLabel();
}

function updateFlightCamera(dt: number) {
  const f = flight!;
  const c = f.craft;
  const v = f.setup.vehicle;
  const r = Math.max(v.radius, 1.5);
  const fw = forward(c.yaw, 0);
  const pos = tmpV.set(c.pos.x, c.pos.y, c.pos.z);
  if (cameraMode === 'cockpit') {
    const nose = forward(c.yaw, v.model === 'rocket' ? c.pitch : c.pitch * 0.6);
    camPos.set(pos.x + nose.x * r * 0.8, pos.y + r * 0.6 + 1, pos.z + nose.z * r * 0.8);
    camera.position.copy(camPos);
    camera.lookAt(camPos.x + nose.x * 100, camPos.y + nose.y * 100, camPos.z + nose.z * 100);
    return;
  }
  const dist = cameraMode === 'far' ? r * 10 + 40 : r * 4.5 + 10;
  const height = cameraMode === 'far' ? r * 4 + 25 : r * 1.4 + 4;
  const targetPos = new THREE.Vector3(pos.x - fw.x * dist, pos.y + height, pos.z - fw.z * dist);
  const minY = world.surfaceHeight(targetPos.x, targetPos.z).height + 2;
  targetPos.y = Math.max(targetPos.y, minY);
  camPos.lerp(targetPos, Math.min(1, dt * 3.5));
  if (camPos.distanceTo(targetPos) > dist * 4) camPos.copy(targetPos);
  camera.position.copy(camPos);
  camTarget.lerp(new THREE.Vector3(pos.x + fw.x * r * 2, pos.y + r * 0.5, pos.z + fw.z * r * 2), Math.min(1, dt * 6));
  if (camTarget.distanceTo(pos) > dist * 4) camTarget.copy(pos);
  camera.lookAt(camTarget);
}

function updateAttractCamera() {
  if (screen === 'hangar' && previewModel) {
    const p = previewModel.group.position;
    const r = Math.max(previewModel.group.userData.radius as number, 1.5);
    const a = clock * 0.18 + 2.2;
    const d = r * 3.2 + 6;
    // 画面の中央の空いたところに機体が来るよう、少し下から見上げる
    camera.position.set(p.x + Math.sin(a) * d, p.y + r * 0.7 + 1.2, p.z + Math.cos(a) * d);
    camera.lookAt(p.x, p.y + r * 0.45, p.z);
    for (const s of previewModel.spinners) s.obj.rotation[s.axis] += s.speed * 0.05 * 0.016;
    return;
  }
  const a = clock * 0.03;
  camera.position.set(Math.sin(a) * 1300 - 100, 360, Math.cos(a) * 1300 + 200);
  camera.lookAt(0, 40, 100);
}

// ---------- 計器 ----------
const DIR8 = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];
function dirName(rad: number) {
  const deg = ((THREE.MathUtils.radToDeg(rad) % 360) + 360) % 360;
  return DIR8[Math.round(deg / 45) % 8];
}

function flightStatus(f: Flight, vs: number, alt: number): string {
  const c = f.craft;
  const v = f.setup.vehicle;
  if (f.phase === 'countdown') return '発進準備';
  if (c.onGround) {
    if (Math.hypot(c.vel.x, c.vel.z) > 1) return v.model === 'plane' ? '滑走中' : '地上';
    return f.tookOff ? '停止' : '地上待機';
  }
  if (c.stalled) return '失速';
  if (v.model === 'plane' && f.tookOff && vs < -1 && alt < 80 && inRunwayArea(c.pos.x, c.pos.z, 400)) return '着陸進入';
  if (vs > 2.5) return '上昇中';
  if (vs < -2.5) return '降下中';
  if (v.model !== 'plane' && Math.hypot(c.vel.x, c.vel.z) < 3) return 'ホバリング';
  return '巡航中';
}

let hudSlow = 0;
function updateHud() {
  const f = flight!;
  const c = f.craft;
  const alt = Math.max(0, c.pos.y - world.surfaceHeight(c.pos.x, c.pos.z).height);
  const vs = c.vel.y;
  $('#hud-speed').textContent = String(Math.round(Math.hypot(c.vel.x, c.vel.y, c.vel.z) * 3.6));
  $('#hud-alt').textContent = String(Math.round(alt));
  $('#hud-vs').textContent = `${vs >= 0 ? '▲' : '▼'} ${Math.abs(vs).toFixed(1)} m/s`;
  const limit = f.setup.mode.timeLimit;
  $('#hud-time').textContent = limit > 0 && f.phase === 'flying' ? `残り ${formatTime(Math.max(0, limit - f.time))}` : formatTime(Math.max(0, f.time));
  $('#hud-fuel').style.width = `${Math.round(c.fuel * 100)}%`;
  $('#hud-fuel').classList.toggle('low', c.fuel < 0.2);
  $('#hud-fuel-pct').textContent = `${Math.round(c.fuel * 100)}%`;
  $('#hud-thr').textContent = `${Math.round(c.throttle * 100)}%`;
  const hdg = ((THREE.MathUtils.radToDeg(c.yaw) % 360) + 360) % 360;
  $('#hud-heading').textContent = `${String(Math.round(hdg) % 360).padStart(3, '0')}° ${dirName(c.yaw)}`;
  if (f.phase === 'flying' && c.stalled && messageTimer <= 0) showMessage('失速 ― 機首を下げて', 0.6);

  // 場所と風は 4 回/秒で十分
  hudSlow -= 1;
  if (hudSlow <= 0) {
    hudSlow = 15;
    const place = world.placeName(c.pos.x, c.pos.z);
    $('#hud-place').textContent = alt < 4 ? place.name : place.near ? `${place.name} 上空` : `${place.name} 付近`;
    $('#hud-status').textContent = flightStatus(f, vs, alt) + (c.fuel < 0.2 ? ' ・ 燃料わずか' : '');
    const w = f.wind;
    const ws = Math.hypot(w.x, w.z);
    $('#hud-wind').textContent = ws < 0.3 ? '無風' : `${dirName(Math.atan2(-w.x, w.z))}から ${ws.toFixed(1)} m/s`;
  }

  // 次の目標（リング → 一番近い風船）
  let target: { x: number; y: number; z: number } | null = null;
  let label = '';
  const cp = f.checkpointPosition(f.nextCheckpoint);
  if (cp) {
    target = cp;
    label = `リング ${f.nextCheckpoint + 1}/${f.checkpoints.length} ${f.checkpoints[f.nextCheckpoint].name}`;
  } else if (f.targets.length && f.stats.targets < f.targets.length) {
    let bd = Infinity;
    f.targets.forEach((p, i) => {
      if (f.popped[i]) return;
      const d = Math.hypot(p.x - c.pos.x, p.z - c.pos.z);
      if (d < bd) {
        bd = d;
        target = p;
      }
    });
    label = `風船 ${f.stats.targets}/${f.targets.length} ・ 一番近い風船`;
  } else if (f.tookOff && (f.checkpoints.length || f.targets.length)) {
    label = '着陸してボーナス';
  }
  $('#hud-target').classList.toggle('hidden', !label || f.phase !== 'flying');
  if (target) {
    const t = target as { x: number; y: number; z: number };
    const dx = t.x - c.pos.x;
    const dz = t.z - c.pos.z;
    const rel = Math.atan2(dx, -dz) - c.yaw;
    $('#hud-arrow').style.transform = `rotate(${rel}rad)`;
    $('#hud-arrow').classList.remove('hidden');
    const d = Math.hypot(dx, dz);
    const dy = t.y - c.pos.y;
    const updown = Math.abs(dy) > 25 ? (dy > 0 ? ' ・ 上へ' : ' ・ 下へ') : '';
    $('#hud-target-text').textContent = `${label} ${d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m'}${updown}`;
  } else {
    $('#hud-arrow').classList.add('hidden');
    $('#hud-target-text').textContent = label;
  }
}

// e2e テスト用の窓口
(window as unknown as { __tf: unknown }).__tf = {
  debug,
  state: () => ({
    screen,
    phase: flight?.phase ?? null,
    outcome: flight?.outcome ?? null,
    altitude: flight?.altitude ?? 0,
    fuel: flight?.craft.fuel ?? 0,
    time: flight?.time ?? 0,
  }),
};

requestAnimationFrame(frame);
init().catch((e) => {
  console.error(e);
  debug.errors.push(String(e));
  setLoading(0, '読み込みに失敗しました。再読み込みしてください。');
});
