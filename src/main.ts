import './style.css';
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { EVOLUTION_LOG, GENERATION, SCENERY, fuelById, modeById, passengerById, vehicleById } from './content/index';
import type { PassengerDef } from './content/types';
import { AudioEngine } from './audio/sound';
import { Controls } from './input/controls';
import { Hangar } from './ui/hangar';
import { Flight, RING_RADIUS, type FlightEvent, type Phase } from './sim/flight';
import { forward } from './sim/physics';
import { PAD, RUNWAY_START, World, type WorldData } from './sim/world';
import { buildAirfield, buildBuildings, buildTerrain, buildTrees, buildWater, loadTexture, makePhotoSampler } from './world/terrain';
import { buildScenery, type SceneryObject } from './world/scenery';
import { buildVehicleModel, emojiSprite, type VehicleModel } from './render/vehicleMesh';
import { Explosion, Rings, Trail, blobShadow } from './render/effects';
import { flushQueue, loadSettings, playerId, randomId, saveSettings, sendFlight } from './net/api';

type Screen = 'loading' | 'title' | 'hangar' | 'flying' | 'result';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
document.body.classList.add(isTouch ? 'touch' : 'desktop');

const debug = { errors: [] as string[], frames: 0 };
window.addEventListener('error', (e) => debug.errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => debug.errors.push(String(e.reason)));

// ---------- three.js の基本 ----------
const canvas = $<HTMLCanvasElement>('#scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.75;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 140000);
camera.position.set(0, 400, 900);
scene.fog = new THREE.Fog(0xbdd2e6, 2500, 38000);

const sky = new Sky();
sky.scale.setScalar(120000);
const sun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(50), THREE.MathUtils.degToRad(200));
const su = sky.material.uniforms;
su.turbidity.value = 4;
su.rayleigh.value = 1.4;
su.mieCoefficient.value = 0.004;
su.mieDirectionalG.value = 0.8;
su.sunPosition.value.copy(sun);
scene.add(sky);
scene.add(new THREE.HemisphereLight(0xe6f1ff, 0x56603e, 1.5));
const sunLight = new THREE.DirectionalLight(0xfff3e0, 2.2);
sunLight.position.copy(sun).multiplyScalar(1000);
scene.add(sunLight);

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
let passengersOnBoard: { def: PassengerDef; sprite: THREE.Sprite }[] = [];
let scenery: SceneryObject[] = [];
const trail = new Trail();
const rings = new Rings();
const explosion = new Explosion();
const shadow = blobShadow();
scene.add(trail.mesh, rings.group, explosion.group, shadow);
let cameraMode: 'chase' | 'far' | 'cockpit' = 'chase';
let paused = false;
let endTimer = 0;
let messageTimer = 0;
let clock = 0;
let previewModel: THREE.Group | null = null;
let currentWind = { x: 0, y: 0, z: 0 };

function setScreen(s: Screen) {
  screen = s;
  $('#title').classList.toggle('hidden', s !== 'title');
  $('#hangar').classList.toggle('hidden', s !== 'hangar');
  $('#hud').classList.toggle('hidden', s !== 'flying' && s !== 'result');
  $('#result').classList.toggle('hidden', s !== 'result');
  document.body.classList.toggle('flying', s === 'flying');
  controls.enabled = s === 'flying';
  if (s !== 'hangar' && previewModel) {
    scene.remove(previewModel);
    previewModel = null;
  }
  if (s === 'hangar') updatePreview();
}

function setLoading(p: number, text?: string) {
  $('#loading-fill').style.width = `${Math.round(p * 100)}%`;
  if (text) $('#loading-text').textContent = text;
}

async function fetchWorld(): Promise<WorldData> {
  const res = await fetch('/data/world.json');
  const total = Number(res.headers.get('content-length')) || 1_800_000;
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

async function init() {
  setLoading(0.05, '地形データを読み込んでいます…');
  const [data, nearTex, farTex] = await Promise.all([
    fetchWorld(),
    loadTexture('/data/near.jpg', renderer),
    loadTexture('/data/far.jpg', renderer),
  ]);
  setLoading(0.6, 'キャンパスを組み立てています…');
  await new Promise((r) => setTimeout(r, 0));
  world = new World(data);
  scene.add(buildTerrain(world, nearTex, farTex));
  const sampler = makePhotoSampler(nearTex.image as HTMLImageElement, world);
  setLoading(0.75, '建物を建てています…');
  await new Promise((r) => setTimeout(r, 0));
  scene.add(buildBuildings(world, sampler));
  setLoading(0.85, '木を植えています…');
  await new Promise((r) => setTimeout(r, 0));
  scene.add(buildTrees(world, isTouch ? 6000 : 14000));
  scene.add(buildWater(world));
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
  $('#generation').textContent = `第 ${GENERATION} 世代 ・ ${last.title}`;
  $('#evolution-list').innerHTML = [...EVOLUTION_LOG]
    .reverse()
    .map((e) => `<li><b>第${e.generation}世代「${escapeHtml(e.title)}」</b>（${e.date}）<br>${escapeHtml(e.summary)}</li>`)
    .join('');
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function updatePreview() {
  if (!world) return;
  if (previewModel) scene.remove(previewModel);
  const s = hangar.settings;
  const v = vehicleById(s.vehicle);
  const m = buildVehicleModel(v.shape, s.vehicleColor ?? v.color);
  const start = v.start === 'runway' ? RUNWAY_START : PAD;
  m.group.position.set(start.x, world.terrainHeight(start.x, start.z), start.z);
  m.group.rotation.order = 'YXZ';
  if (v.model === 'rocket') m.group.rotation.x = Math.PI / 2;
  s.passengers.forEach((id, i) => {
    const p = passengerById(id, hangar.custom);
    if (!p) return;
    const size = Math.max(1, v.radius * 0.35);
    const sp = emojiSprite(p.emoji, size);
    sp.position.copy(m.seat).add(new THREE.Vector3((i - (s.passengers.length - 1) / 2) * size, 0, 0));
    m.group.add(sp);
  });
  previewModel = m.group;
  previewModel.userData.radius = v.radius;
  scene.add(previewModel);
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
  passengersOnBoard = [];
  s.passengers.forEach((id, i) => {
    const def = passengerById(id, hangar.custom);
    if (!def) return;
    const size = Math.max(1, vehicle.radius * 0.35);
    const sprite = emojiSprite(def.emoji, size);
    sprite.position.copy(model!.seat).add(new THREE.Vector3((i - (s.passengers.length - 1) / 2) * size, 0, 0));
    model!.group.add(sprite);
    passengersOnBoard.push({ def, sprite });
  });
  trail.clear();
  trail.setting = { ...s.trail };
  trail.baseWidth = Math.max(0.6, vehicle.radius * 0.3);
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
  $('#hud-cp-cell').classList.toggle('hidden', mode.checkpoints.length === 0);
  $('#hud-target').classList.toggle('hidden', true);
  controls.reset(0);
  audio.startFlight(vehicle.engine, vehicle.enginePitch * fuel.tone, passengersOnBoard.map((p) => p.def.sound));
  paused = false;
  endTimer = 0;
  cameraMode = 'chase';
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
        if (flight!.checkpoints.length) $('#hud-target').classList.remove('hidden');
        break;
      case 'takeoff':
        showMessage('離陸！');
        break;
      case 'checkpoint':
        audio.sfx('checkpoint');
        showMessage(`${e.text} 通過！`);
        rings.setCurrent(flight!.nextCheckpoint);
        break;
      case 'allCheckpoints':
        showMessage('全部くぐった！ どこかに着陸しよう', 4);
        $('#hud-target').classList.add('hidden');
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
  endTimer = 1.8;
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
    checkpoints: f.stats.checkpoints,
    score: f.score(),
    device: isTouch ? 'touch' : 'desktop',
    end: [Math.round(f.craft.pos.x), Math.round(f.craft.pos.y), Math.round(f.craft.pos.z)],
    path: f.stats.path,
  });
}

function showResult() {
  const f = flight!;
  const titles = { landed: '着陸成功！', crashed: '墜落…', fuel: '燃料切れ…', out: 'エリア外…', timeout: '時間切れ…', quit: 'おしまい' } as const;
  const emojis = { landed: '🎉', crashed: '💥', fuel: '⛽', out: '🧭', timeout: '⏰', quit: '🛬' } as const;
  $('#result-emoji').textContent = emojis[f.outcome!];
  $('#result-title').textContent = titles[f.outcome!];
  $('#result-cause').textContent = f.cause;
  $('#result-score').textContent = `${f.score().toLocaleString()} 点`;
  const s = f.stats;
  const rows: [string, string][] = [
    ['飛行時間', formatTime(s.duration)],
    ['飛んだ距離', `${(s.distance / 1000).toFixed(2)} km`],
    ['最高高度', `${Math.round(s.maxAlt)} m`],
    ['最高速度', `${Math.round(s.maxSpeed * 3.6)} km/h`],
  ];
  if (f.checkpoints.length) rows.push(['リング', `${s.checkpoints} / ${f.checkpoints.length}`]);
  rows.push(['残り燃料', `${Math.round(f.craft.fuel * 100)}%`]);
  $('#result-stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  setScreen('result');
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
  const cols = passengersOnBoard.map((p) => new THREE.Color(p.def.trailColor));
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
  $('#btn-mute').textContent = audio.muted ? '🔇' : '🔊';
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
  setScreen('hangar');
}

controls.onAction = (a) => {
  if (a === 'camera') cycleCamera();
  if (a === 'pause') togglePause();
  if (a === 'mute') toggleMute();
};
function cycleCamera() {
  cameraMode = cameraMode === 'chase' ? 'far' : cameraMode === 'far' ? 'cockpit' : 'chase';
}

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

  if ((screen === 'flying' || screen === 'result') && flight && !paused) {
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
  } else if (screen === 'title' || screen === 'hangar') {
    updateAttractCamera();
  }

  if (messageTimer > 0) {
    messageTimer -= dt;
    if (messageTimer <= 0) $('#hud-message').textContent = '';
  }
  rings.update(clock);
  explosion.update(dt);
  for (const s of scenery) s.update?.(dt, clock);
  renderer.render(scene, camera);
}

function updateFlightVisuals(dt: number) {
  const f = flight!;
  const c = f.craft;
  const v = f.setup.vehicle;
  if (model) {
    const g = model.group;
    g.position.set(c.pos.x, c.pos.y, c.pos.z);
    g.rotation.set(c.pitch, -c.yaw, -c.roll, 'YXZ');
    const spin = f.phase === 'countdown' ? 0.3 : Math.max(0.15, c.throttle);
    for (const s of model.spinners) s.obj.rotation[s.axis] += s.speed * spin * dt;
    const burning = f.phase === 'flying' && c.fuel > 0 ? c.throttle : 0;
    for (const fl of model.flames) {
      const k = v.model === 'balloon' ? Math.max(0, burning - 0.4) * 1.7 : burning;
      fl.visible = k > 0.03;
      fl.scale.setScalar(0.4 + k * (0.8 + Math.random() * 0.3));
    }
    passengersOnBoard.forEach((p, i) => {
      p.sprite.position.y = model!.seat.y + Math.abs(Math.sin(clock * 6 + i)) * 0.15 * Math.max(1, v.radius * 0.3);
    });

    // 軌跡
    g.updateMatrixWorld();
    const tail = model.tail.clone().applyMatrix4(g.matrixWorld);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(g.quaternion);
    if (v.model === 'rocket' || v.model === 'balloon') right.set(Math.cos(c.yaw), 0, Math.sin(c.yaw));
    const level = audio.passengerLevel();
    const color = trail.setting.mode === 'custom' ? new THREE.Color(trail.setting.color) : autoTrailColor(clock);
    color.offsetHSL(0, 0, level * 0.15);
    trail.update(dt, tail, right, color, level, f.phase === 'flying' && !c.onGround && model.group.visible);
  }

  // 影
  const surf = world.surfaceHeight(c.pos.x, c.pos.z);
  const alt = c.pos.y - surf.height;
  shadow.visible = alt < 300 && model?.group.visible !== false;
  shadow.position.set(c.pos.x, surf.height + 0.25, c.pos.z);
  const size = v.radius * 2.2 * (1 + alt / 120);
  shadow.scale.set(size, 1, size);
  (shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - alt / 300);

  audio.update({ throttle: c.throttle, speed: c.speed, altitude: alt });
  updateFlightCamera(dt);
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
    const p = previewModel.position;
    const r = Math.max(previewModel.userData.radius as number, 1.5);
    const a = clock * 0.25;
    const d = r * 3.5 + 6;
    camera.position.set(p.x + Math.sin(a) * d, p.y + r * 1.2 + 2, p.z + Math.cos(a) * d);
    camera.lookAt(p.x, p.y + r * 0.6, p.z);
    return;
  }
  const a = clock * 0.04;
  camera.position.set(Math.sin(a) * 1400, 420, Math.cos(a) * 1400 + 200);
  camera.lookAt(0, 30, 200);
}

function updateHud() {
  const f = flight!;
  const c = f.craft;
  const alt = Math.max(0, c.pos.y - world.surfaceHeight(c.pos.x, c.pos.z).height);
  $('#hud-speed').textContent = String(Math.round(Math.hypot(c.vel.x, c.vel.y, c.vel.z) * 3.6));
  $('#hud-alt').textContent = String(Math.round(alt));
  $('#hud-time').textContent = formatTime(Math.max(0, f.time));
  $('#hud-cp').textContent = `${f.nextCheckpoint}/${f.checkpoints.length}`;
  $('#hud-fuel').style.width = `${Math.round(c.fuel * 100)}%`;
  if (f.phase === 'flying' && c.stalled && messageTimer <= 0) showMessage('失速！ 機首を下げて', 0.6);
  const cp = f.checkpointPosition(f.nextCheckpoint);
  if (cp) {
    const dx = cp.x - c.pos.x;
    const dz = cp.z - c.pos.z;
    const bearing = Math.atan2(dx, -dz);
    const rel = bearing - c.yaw;
    $('#hud-arrow').style.transform = `rotate(${rel}rad)`;
    const d = Math.hypot(dx, dz);
    const dy = cp.y - c.pos.y;
    const updown = Math.abs(dy) > 25 ? (dy > 0 ? ' ↑上へ' : ' ↓下へ') : '';
    $('#hud-target-text').textContent = `${f.checkpoints[f.nextCheckpoint].name} ${d > 1000 ? (d / 1000).toFixed(1) + 'km' : Math.round(d) + 'm'}${updown}`;
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
