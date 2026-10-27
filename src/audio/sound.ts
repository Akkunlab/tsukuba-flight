// 音の合成（Web Audio）。音声ファイルは使わず、すべてその場で作る。
import type { EngineKind, SoundRecipe } from '../content/types';

export interface FlightSoundState {
  throttle: number;
  speed: number;
  altitude: number;
  /** 最高速度に対する今の速さ (0..1.5) */
  speedRatio?: number;
  /** 左右の操作 (-1..1) */
  turn?: number;
  /** 上昇の速さ [m/s] */
  climb?: number;
}

let noiseBuffer: AudioBuffer | null = null;
function getNoise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const len = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  noiseBuffer = buf;
  return buf;
}

function noiseSource(ctx: AudioContext): AudioBufferSourceNode {
  const s = ctx.createBufferSource();
  s.buffer = getNoise(ctx);
  s.loop = true;
  return s;
}

export interface MusicInfo {
  bpm: number;
  energy: number;
  density: 0 | 1 | 2;
  shift: number;
  reversed: boolean;
}

export function semitone(base: number, st: number) {
  return base * Math.pow(2, st / 12);
}

/** レシピ 1 つ分の演奏者。フライト中ずっと鳴らし続け、ステップごとに音程と音量を動かす */
export class RecipePlayer {
  private ctx: AudioContext;
  private recipe: SoundRecipe;
  private out: GainNode;
  private env: GainNode;
  private filter: BiquadFilterNode;
  private oscs: OscillatorNode[] = [];
  private noise: AudioBufferSourceNode | null = null;
  private lfo: OscillatorNode | null = null;
  private stepIndex = 0;
  private nextTime = 0;
  private stopped = false;
  /** 旋律をずらす量。数小節ごとに変えて、同じ繰り返しにならないようにする */
  private rotation = 0;
  state: FlightSoundState = { throttle: 0.5, speed: 0, altitude: 0, speedRatio: 0.5 };
  /** いま鳴らしている音楽の状態（プレイ記録用）。density: 0 半分 / 1 ふつう / 2 細かい */
  info: MusicInfo = { bpm: 0, energy: 0, density: 1, shift: 0, reversed: false };

  constructor(ctx: AudioContext, recipe: SoundRecipe, dest: AudioNode, volume = 1) {
    this.ctx = ctx;
    this.recipe = recipe;
    this.out = ctx.createGain();
    this.out.gain.value = recipe.gain * volume * (recipe.voices > 1 ? 1 / Math.sqrt(recipe.voices) : 1);
    this.env = ctx.createGain();
    this.env.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = recipe.wave === 'noise' ? 'bandpass' : 'lowpass';
    this.filter.frequency.value = recipe.wave === 'noise' ? recipe.base : recipe.filter;
    this.filter.Q.value = recipe.wave === 'noise' ? 4 : 0.7;
    this.env.connect(this.filter).connect(this.out).connect(dest);

    if (recipe.vibratoHz > 0 && recipe.vibratoDepth > 0) {
      this.lfo = ctx.createOscillator();
      this.lfo.frequency.value = recipe.vibratoHz;
      this.lfo.start();
    }
    if (recipe.wave === 'noise') {
      this.noise = noiseSource(ctx);
      this.noise.connect(this.env);
      this.noise.start();
    } else {
      const wave = recipe.harmonics
        ? ctx.createPeriodicWave(new Float32Array(recipe.harmonics.length + 1), new Float32Array([0, ...recipe.harmonics]))
        : null;
      for (let i = 0; i < recipe.voices; i++) {
        const o = ctx.createOscillator();
        if (wave) o.setPeriodicWave(wave);
        else o.type = recipe.wave as OscillatorType;
        o.frequency.value = recipe.base;
        const spread = recipe.voices > 1 ? (i / (recipe.voices - 1) - 0.5) * 2 : 0;
        o.detune.value = spread * recipe.detune;
        if (this.lfo) {
          const depth = ctx.createGain();
          // 声ごとにビブラートの深さを少しずらすと群れっぽくなる
          depth.gain.value = recipe.vibratoDepth * 100 * (1 + spread * 0.3);
          this.lfo.connect(depth).connect(o.detune);
        }
        o.connect(this.env);
        o.start();
        this.oscs.push(o);
      }
    }
    this.nextTime = ctx.currentTime + 0.05;
  }

  /**
   * 先読みスケジューラ。こまめに呼ぶ。
   * 音色はレシピのまま、テンポ・リズム・旋律は飛び方で変わる：
   * 速さとスロットル → テンポと細かさ（遅いと半分、速いと 16 分）、上昇・下降 → オクターブ、
   * 右旋回 → 移調、左旋回 → 逆再生、数小節ごと → 旋律のずらし。
   */
  tick() {
    if (this.stopped) return;
    const r = this.recipe;
    const st8 = this.state;
    const ahead = this.ctx.currentTime + 0.15;
    const energy = Math.min(1, Math.max(0, (st8.speedRatio ?? 0.5) * 0.65 + st8.throttle * 0.35));
    const speedMul = 1 + (r.follow?.speed ?? 0) * Math.min(st8.speed / 60, 2);
    const stepDur = 60 / (r.bpm * speedMul * (0.75 + energy * 0.7)) / 2;
    const transpose = (r.follow?.altitude ?? 0) * Math.min(Math.max(st8.altitude, 0) / 100, 6);
    const turn = st8.turn ?? 0;
    const climb = st8.climb ?? 0;
    const len = r.pattern.length;
    const sustained = r.gate >= 0.99 && len === 1;
    this.info = {
      bpm: Math.round(30 / stepDur),
      energy,
      density: energy < 0.28 ? 0 : energy > 0.72 ? 2 : 1,
      shift: Math.round(transpose + (turn > 0.35 ? 6 : 0) + (climb < -4 ? -12 : 0)),
      reversed: turn < -0.35,
    };
    while (this.nextTime < ahead) {
      const i = this.stepIndex;
      if (i > 0 && i % 32 === 0) this.rotation = (this.rotation + 1 + Math.floor(Math.random() * 3)) % Math.max(len, 1);
      const t = this.nextTime;
      const k = (i + this.rotation) % len;
      const idx = turn < -0.35 ? len - 1 - k : k;
      let note = r.pattern[idx];
      // ゆっくりだと裏拍を休む
      if (energy < 0.28 && i % 2 === 1 && !sustained) note = null;
      const shift = transpose + (turn > 0.35 ? (i % 8 < 4 ? 5 : 7) : 0) + (climb < -4 ? -12 : 0);
      const accent = i % 4 === 0 ? 1 : 0.55 + 0.45 * st8.throttle;
      if (sustained && energy < 0.5) {
        this.play(t, (note ?? 0) + shift, stepDur, 1, true, i === 0);
      } else if (note === null) {
        this.env.gain.setTargetAtTime(0, t, Math.max(r.release, 0.005) / 3);
      } else if (energy > 0.72) {
        // 速いときは 1 拍を 2 つに割り、後ろは次の音（上昇中は 1 オクターブ上）
        const next = r.pattern[(idx + 1) % len] ?? note;
        this.play(t, note + shift, stepDur / 2, accent, false, false);
        this.play(t + stepDur / 2, (climb > 3 ? note + 12 : next) + shift, stepDur / 2, accent * 0.8, false, false);
      } else {
        this.play(t, note + shift + (climb > 3 && i % 4 === 2 ? 12 : 0), stepDur, accent, false, false);
      }
      this.nextTime += stepDur;
      this.stepIndex++;
    }
  }

  private play(t: number, st: number, dur: number, vel: number, legato: boolean, first: boolean) {
    const r = this.recipe;
    const g = this.env.gain;
    if (r.wave === 'noise') {
      this.filter.frequency.setTargetAtTime(semitone(r.base, st), t, Math.max(r.glide, 0.005));
    } else {
      for (const o of this.oscs) {
        if (r.glide > 0) o.frequency.setTargetAtTime(semitone(r.base, st), t, r.glide / 3);
        else o.frequency.setValueAtTime(semitone(r.base, st), t);
      }
    }
    if (legato) {
      if (first) g.linearRampToValueAtTime(vel, t + Math.max(r.attack, 0.003));
      else g.setTargetAtTime(vel, t, 0.05);
      return;
    }
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(vel, t + Math.max(r.attack, 0.003));
    const gate = r.gate >= 0.99 ? 0.85 : r.gate;
    g.setTargetAtTime(0, t + dur * gate, Math.max(r.release, 0.005) / 3);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const t = this.ctx.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.08);
    setTimeout(() => {
      for (const o of this.oscs) o.stop();
      this.noise?.stop();
      this.lfo?.stop();
      this.out.disconnect();
    }, 400);
  }
}

class EngineSound {
  private ctx: AudioContext;
  private kind: EngineKind;
  private pitch: number;
  private nodes: AudioScheduledSourceNode[] = [];
  private gain: GainNode;
  private update_: (s: FlightSoundState) => void = () => {};

  constructor(ctx: AudioContext, kind: EngineKind, pitch: number, dest: AudioNode) {
    this.ctx = ctx;
    this.kind = kind;
    this.pitch = pitch;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    this.gain.connect(dest);
    this.build();
  }

  private src<T extends AudioScheduledSourceNode>(n: T): T {
    n.start();
    this.nodes.push(n);
    return n;
  }

  private build() {
    const ctx = this.ctx;
    const p = this.pitch;
    const set = (param: AudioParam, v: number, tc = 0.08) => param.setTargetAtTime(v, ctx.currentTime, tc);
    switch (this.kind) {
      case 'jet': {
        const n = this.src(noiseSource(ctx));
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 0.6;
        const whine = this.src(ctx.createOscillator());
        whine.type = 'sine';
        const wg = ctx.createGain();
        n.connect(bp).connect(this.gain);
        whine.connect(wg).connect(this.gain);
        this.update_ = (s) => {
          set(bp.frequency, (300 + s.throttle * 1500) * p);
          set(whine.frequency, (900 + s.throttle * 2600) * p);
          set(wg.gain, 0.04 + s.throttle * 0.05);
          set(this.gain.gain, 0.25 + s.throttle * 0.55);
        };
        break;
      }
      case 'prop': {
        const o1 = this.src(ctx.createOscillator());
        o1.type = 'sawtooth';
        const o2 = this.src(ctx.createOscillator());
        o2.type = 'square';
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 700;
        const g2 = ctx.createGain();
        g2.gain.value = 0.3;
        o1.connect(lp);
        o2.connect(g2).connect(lp);
        lp.connect(this.gain);
        // 排気の「バラバラ」：ノイズを点火の周期で揺らす
        const ex = this.src(noiseSource(ctx));
        const exf = ctx.createBiquadFilter();
        exf.type = 'bandpass';
        exf.Q.value = 0.9;
        const exg = ctx.createGain();
        exg.gain.value = 0.2;
        const fire = this.src(ctx.createOscillator());
        fire.type = 'square';
        const fireDepth = ctx.createGain();
        fireDepth.gain.value = 0.18;
        fire.connect(fireDepth).connect(exg.gain);
        ex.connect(exf).connect(exg).connect(this.gain);
        this.update_ = (s) => {
          const f = (38 + s.throttle * 85) * p;
          set(o1.frequency, f);
          set(o2.frequency, f * 2.01);
          set(fire.frequency, f / 2);
          set(exf.frequency, 180 + s.throttle * 420);
          set(lp.frequency, 400 + s.throttle * 900);
          set(this.gain.gain, 0.18 + s.throttle * 0.4);
        };
        break;
      }
      case 'pedal': {
        // 大きなプロペラがゆっくり空気を切る音と、チェーンのカチカチ
        const n = this.src(noiseSource(ctx));
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 500;
        const am = ctx.createGain();
        const lfo = this.src(ctx.createOscillator());
        const depth = ctx.createGain();
        depth.gain.value = 0.4;
        lfo.connect(depth).connect(am.gain);
        n.connect(lp).connect(am).connect(this.gain);
        const n2 = this.src(noiseSource(ctx));
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 4000;
        const tick = ctx.createGain();
        tick.gain.value = 0;
        const tickLfo = this.src(ctx.createOscillator());
        tickLfo.type = 'square';
        const tickDepth = ctx.createGain();
        tickDepth.gain.value = 0.05;
        tickLfo.connect(tickDepth).connect(tick.gain);
        n2.connect(hp).connect(tick).connect(this.gain);
        this.update_ = (s) => {
          set(lfo.frequency, (1.5 + s.throttle * 2.5) * p);
          set(tickLfo.frequency, (6 + s.throttle * 10) * p);
          set(this.gain.gain, 0.12 + s.throttle * 0.3);
        };
        break;
      }
      case 'rotor': {
        const n = this.src(noiseSource(ctx));
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 350;
        const am = ctx.createGain();
        am.gain.value = 0.5;
        const lfo = this.src(ctx.createOscillator());
        lfo.type = 'square';
        const depth = ctx.createGain();
        depth.gain.value = 0.5;
        lfo.connect(depth).connect(am.gain);
        const whine = this.src(ctx.createOscillator());
        whine.type = 'sawtooth';
        const wg = ctx.createGain();
        wg.gain.value = 0.04;
        n.connect(lp).connect(am).connect(this.gain);
        whine.connect(wg).connect(this.gain);
        this.update_ = (s) => {
          set(lfo.frequency, (4.5 + s.throttle * 3.5) * p);
          set(whine.frequency, (420 + s.throttle * 200) * p);
          set(this.gain.gain, 0.45 + s.throttle * 0.4);
        };
        break;
      }
      case 'multirotor': {
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.Q.value = 1.2;
        bp.frequency.value = 900;
        const os: OscillatorNode[] = [];
        for (let i = 0; i < 4; i++) {
          const o = this.src(ctx.createOscillator());
          o.type = 'sawtooth';
          o.detune.value = (i - 1.5) * 18;
          o.connect(bp);
          os.push(o);
        }
        bp.connect(this.gain);
        this.update_ = (s) => {
          os.forEach((o, i) => set(o.frequency, (170 + s.throttle * 230 + i * 3) * p));
          set(this.gain.gain, 0.1 + s.throttle * 0.18);
        };
        break;
      }
      case 'rocket': {
        const n = this.src(noiseSource(ctx));
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        const n2 = this.src(noiseSource(ctx));
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 2500;
        const crackle = ctx.createGain();
        crackle.gain.value = 0.15;
        n.connect(lp).connect(this.gain);
        n2.connect(hp).connect(crackle).connect(this.gain);
        this.update_ = (s) => {
          set(lp.frequency, (250 + s.throttle * 700) * p);
          set(this.gain.gain, s.throttle * 1.1);
        };
        break;
      }
      case 'burner':
      case 'hiss':
      case 'whoosh': {
        const n = this.src(noiseSource(ctx));
        const f = ctx.createBiquadFilter();
        f.type = this.kind === 'hiss' ? 'highpass' : 'bandpass';
        f.frequency.value = this.kind === 'hiss' ? 2500 * p : 1100 * p;
        f.Q.value = 0.8;
        n.connect(f).connect(this.gain);
        this.update_ = (s) => {
          if (this.kind === 'burner') set(this.gain.gain, Math.max(0, s.throttle - 0.4) * 1.4);
          else if (this.kind === 'hiss') set(this.gain.gain, s.throttle * 0.5);
          else {
            set(f.frequency, (500 + s.speed * 25) * p);
            set(this.gain.gain, 0.05 + s.throttle * 0.15);
          }
        };
        break;
      }
      case 'ufo': {
        // 揺れる低いうなりと、速さで上がる高い音
        const hum = this.src(ctx.createOscillator());
        hum.type = 'sine';
        const hum2 = this.src(ctx.createOscillator());
        hum2.type = 'sine';
        const lfo = this.src(ctx.createOscillator());
        lfo.frequency.value = 5;
        const lfoDepth = ctx.createGain();
        lfoDepth.gain.value = 12;
        lfo.connect(lfoDepth);
        lfoDepth.connect(hum.frequency);
        lfoDepth.connect(hum2.frequency);
        const whine = this.src(ctx.createOscillator());
        whine.type = 'triangle';
        const wg = ctx.createGain();
        wg.gain.value = 0.05;
        hum.connect(this.gain);
        hum2.connect(this.gain);
        whine.connect(wg).connect(this.gain);
        this.update_ = (s) => {
          set(hum.frequency, (70 + s.throttle * 40) * p);
          set(hum2.frequency, (71.5 + s.throttle * 40) * p);
          set(lfo.frequency, 3 + s.speed * 0.08);
          set(whine.frequency, (600 + s.speed * 18) * p);
          set(this.gain.gain, 0.2 + s.throttle * 0.25);
        };
        break;
      }
      case 'none':
        break;
      default: {
        // EngineKind を足したのにここに case が無いと、型チェックで落ちる
        const missing: never = this.kind;
        throw new Error(`engine ${String(missing)} の音が未実装`);
      }
    }
  }

  update(s: FlightSoundState) {
    this.update_(s);
  }

  stop() {
    this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1);
    setTimeout(() => {
      for (const n of this.nodes) n.stop();
      this.gain.disconnect();
    }, 500);
  }
}

export interface Volumes {
  master: number;
  engine: number;
  passengers: number;
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineBus!: GainNode;
  private passengerBus!: GainNode;
  private sfxBus!: GainNode;
  private analyser!: AnalyserNode;
  private analyserData = new Uint8Array(256);
  private engine: EngineSound | null = null;
  private players: RecipePlayer[] = [];
  private wind: { gain: GainNode; filter: BiquadFilterNode; src: AudioBufferSourceNode } | null = null;
  private preview: RecipePlayer | null = null;
  private previewTimer = 0;
  private previewInterval = 0;
  volumes: Volumes = { master: 0.8, engine: 0.7, passengers: 0.9 };
  muted = false;

  /** ユーザー操作の中で呼ぶ（スマホは操作なしでは音が出せない） */
  unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
      const ctx = this.ctx;
      this.master = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(ctx.destination);
      this.engineBus = ctx.createGain();
      this.passengerBus = ctx.createGain();
      this.sfxBus = ctx.createGain();
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.engineBus.connect(this.master);
      this.passengerBus.connect(this.analyser).connect(this.master);
      this.sfxBus.connect(this.master);
      this.applyVolumes();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.05);
    this.engineBus.gain.setTargetAtTime(this.volumes.engine, t, 0.05);
    this.passengerBus.gain.setTargetAtTime(this.volumes.passengers, t, 0.05);
  }

  startFlight(engine: EngineKind, pitch: number, recipes: SoundRecipe[]) {
    this.stopFlight();
    if (!this.ctx) return;
    this.engine = new EngineSound(this.ctx, engine, pitch, this.engineBus);
    this.players = recipes.map((r) => new RecipePlayer(this.ctx!, r, this.passengerBus));
    const src = noiseSource(this.ctx);
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.engineBus);
    src.start();
    this.wind = { gain, filter, src };
  }

  /** 搭乗者の音楽の今の状態（最初の搭乗者。誰も乗っていなければ null） */
  musicState(): MusicInfo | null {
    return this.players[0]?.info ?? null;
  }

  update(s: FlightSoundState) {
    if (!this.ctx) return;
    this.engine?.update(s);
    for (const p of this.players) {
      p.state = s;
      p.tick();
    }
    if (this.wind) {
      const t = this.ctx.currentTime;
      this.wind.filter.frequency.setTargetAtTime(200 + s.speed * 18, t, 0.1);
      this.wind.gain.gain.setTargetAtTime(Math.min(0.35, s.speed / 250), t, 0.2);
    }
  }

  /** 搭乗者の音の大きさ (0..1)。軌跡の太さに使う */
  passengerLevel(): number {
    if (!this.ctx || this.players.length === 0) return 0;
    this.analyser.getByteTimeDomainData(this.analyserData);
    let sum = 0;
    for (const v of this.analyserData) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / this.analyserData.length) * 4);
  }

  stopFlight() {
    this.engine?.stop();
    this.engine = null;
    for (const p of this.players) p.stop();
    this.players = [];
    if (this.wind) {
      const w = this.wind;
      w.gain.gain.setTargetAtTime(0, this.ctx!.currentTime, 0.1);
      setTimeout(() => w.src.stop(), 400);
      this.wind = null;
    }
  }

  previewRecipe(r: SoundRecipe, seconds = 4) {
    this.unlock();
    if (!this.ctx) return;
    this.stopPreview();
    const p = new RecipePlayer(this.ctx, r, this.passengerBus);
    this.preview = p;
    this.previewInterval = window.setInterval(() => p.tick(), 40);
    p.tick();
    this.previewTimer = window.setTimeout(() => this.stopPreview(), seconds * 1000);
  }

  stopPreview() {
    if (!this.preview) return;
    clearInterval(this.previewInterval);
    clearTimeout(this.previewTimer);
    this.preview.stop();
    this.preview = null;
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', vol = 0.3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + start;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  sfx(name: 'beep' | 'go' | 'checkpoint' | 'crash' | 'landed' | 'warning' | 'click') {
    if (!this.ctx) return;
    switch (name) {
      case 'beep':
        this.tone(660, 0, 0.18, 'square', 0.15);
        break;
      case 'go':
        this.tone(1320, 0, 0.5, 'square', 0.15);
        break;
      case 'checkpoint':
        [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, i * 0.07, 0.35, 'triangle', 0.22));
        break;
      case 'landed':
        [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, i * 0.12, 0.4, 'triangle', 0.22));
        break;
      case 'warning':
        this.tone(880, 0, 0.12, 'square', 0.12);
        this.tone(880, 0.2, 0.12, 'square', 0.12);
        break;
      case 'click':
        this.tone(1200, 0, 0.05, 'sine', 0.08);
        break;
      case 'crash': {
        const ctx = this.ctx;
        const t = ctx.currentTime;
        const burst = (start: number, dur: number, type: BiquadFilterType, f0: number, f1: number, gain: number, q = 0.7) => {
          const n = noiseSource(ctx);
          const f = ctx.createBiquadFilter();
          f.type = type;
          f.Q.value = q;
          f.frequency.setValueAtTime(f0, t + start);
          f.frequency.exponentialRampToValueAtTime(f1, t + start + dur);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t + start);
          g.gain.exponentialRampToValueAtTime(gain, t + start + 0.01);
          g.gain.exponentialRampToValueAtTime(0.0001, t + start + dur);
          n.connect(f).connect(g).connect(this.sfxBus);
          n.start(t + start);
          n.stop(t + start + dur + 0.1);
        };
        burst(0, 0.25, 'highpass', 2500, 1200, 1.2);
        burst(0, 4.5, 'lowpass', 1800, 40, 1.4);
        // 腹に響く低音
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(90, t);
        o.frequency.exponentialRampToValueAtTime(28, t + 1.5);
        const og = ctx.createGain();
        og.gain.setValueAtTime(1, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 2);
        o.connect(og).connect(this.sfxBus);
        o.start(t);
        o.stop(t + 2.1);
        // 落ちてくる破片の金属音
        for (let i = 0; i < 9; i++) burst(0.5 + Math.random() * 2.5, 0.15, 'bandpass', 1500 + Math.random() * 3000, 900, 0.25 + Math.random() * 0.2, 8);
        // 燃える音
        for (let i = 0; i < 30; i++) burst(1 + Math.random() * 6, 0.05, 'highpass', 3000, 2000, 0.05 + Math.random() * 0.08);
        break;
      }
    }
  }

  /** 「よーい、スタート！」などを読み上げる（対応していなければ何もしない） */
  say(text: string) {
    if (this.muted || typeof speechSynthesis === 'undefined') return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      u.rate = 1.15;
      u.volume = this.volumes.master;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch {
      /* 読み上げは無くてもよい */
    }
  }
}
