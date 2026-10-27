// 格納庫（乗り物・燃料・搭乗者・軌跡・モードの選択）と、音をつくるエディタ。
import { FUELS, MAX_PASSENGERS, MODES, PASSENGERS, VEHICLES, fuelsFor, vehicleById } from '../content/index';
import type { CustomPassenger, PassengerDef, SoundRecipe } from '../content/types';
import { validatePassenger } from '../content/validate';
import type { AudioEngine } from '../audio/sound';
import { loadCustomPassengers, randomId, saveCustomPassengers, sendElement, type Settings } from '../net/api';

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const EMOJIS = ['🐝', '🎹', '🎵', '🎺', '🐈', '🐸', '🔔', '🎐', '👻', '🐉', '🦜', '🐳', '🤖', '🎸', '🥁', '🎻', '🐓', '🦆', '🐶', '🐧', '🌸', '⚡', '🍙', '🛎️'];
const STEPS = 16;
const LEVELS = 13; // 0..12 半音、それより下は休符

export class Hangar {
  settings: Settings;
  custom: CustomPassenger[];
  private audio: AudioEngine;
  onChange: () => void = () => {};
  private editing: CustomPassenger | null = null;
  private steps: (number | null)[] = [];

  constructor(settings: Partial<Settings>, audio: AudioEngine) {
    this.audio = audio;
    this.custom = loadCustomPassengers().filter((p) => validatePassenger(p).length === 0);
    const v = vehicleById(settings.vehicle ?? VEHICLES[0].id);
    const allowedFuels = fuelsFor(v).map((f) => f.id);
    this.settings = {
      vehicle: v.id,
      fuel: settings.fuel && allowedFuels.includes(settings.fuel) ? settings.fuel : allowedFuels[0],
      passengers: (settings.passengers ?? ['bees']).filter((id) => this.allPassengers().some((p) => p.id === id)).slice(0, MAX_PASSENGERS),
      mode: MODES.some((m) => m.id === settings.mode) ? settings.mode! : MODES[0].id,
      trail: settings.trail ?? { mode: 'auto', color: '#ff4fa3', style: 'ribbon' },
      vehicleColor: settings.vehicleColor ?? null,
      volumes: settings.volumes ?? { master: 0.8, engine: 0.7, passengers: 0.9 },
    };
    this.bindStatic();
    this.render();
  }

  allPassengers(): PassengerDef[] {
    return [...PASSENGERS, ...(this.custom ?? [])];
  }

  private card(opts: { emoji: string; name: string; desc: string; selected: boolean; tag?: string; edit?: boolean }) {
    return `<span class="emoji">${esc(opts.emoji)}</span><span class="name">${esc(opts.name)}</span>${opts.tag ? `<span class="tag">${esc(opts.tag)}</span>` : ''}<span class="desc">${esc(opts.desc)}</span>${opts.edit ? '<span class="edit ghost">編集</span>' : ''}`;
  }

  render() {
    const s = this.settings;
    const vehicle = vehicleById(s.vehicle);
    const tagFor = { plane: '滑走路から', hover: 'その場で浮く', rocket: '打ち上げ', balloon: '風まかせ' } as const;
    this.renderCards('#pick-vehicle', VEHICLES, (v) => v.id === s.vehicle, (v) => ({ emoji: v.emoji, name: v.name, desc: v.description, tag: tagFor[v.model] }), (v) => {
      s.vehicle = v.id;
      const allowed = fuelsFor(v).map((f) => f.id);
      if (!allowed.includes(s.fuel)) s.fuel = allowed[0];
      s.vehicleColor = null;
    });
    this.renderCards('#pick-fuel', fuelsFor(vehicle), (f) => f.id === s.fuel, (f) => ({ emoji: f.emoji, name: f.name, desc: f.description }), (f) => (s.fuel = f.id));
    const passengers = this.allPassengers();
    this.renderCards(
      '#pick-passenger',
      passengers,
      (p) => s.passengers.includes(p.id),
      (p) => ({ emoji: p.emoji, name: p.name, desc: p.description, tag: 'custom' in p ? 'じぶん作' : undefined, edit: 'custom' in p }),
      (p, ev) => {
        if ('custom' in p && (ev.target as HTMLElement).classList.contains('edit')) {
          this.openEditor(p as CustomPassenger);
          return;
        }
        if (s.passengers.includes(p.id)) s.passengers = s.passengers.filter((x) => x !== p.id);
        else {
          s.passengers.push(p.id);
          if (s.passengers.length > MAX_PASSENGERS) s.passengers.shift();
          this.audio.previewRecipe(p.sound, 2.5);
        }
      },
    );
    this.renderCards('#pick-mode', MODES, (m) => m.id === s.mode, (m) => ({ emoji: m.emoji, name: m.name, desc: m.description }), (m) => (s.mode = m.id));
    $<HTMLInputElement>('#vehicle-color').value = s.vehicleColor ?? vehicle.color;
    document.querySelectorAll<HTMLInputElement>('input[name=trail-mode]').forEach((r) => (r.checked = r.value === s.trail.mode));
    document.querySelectorAll<HTMLInputElement>('input[name=trail-style]').forEach((r) => (r.checked = r.value === s.trail.style));
    $<HTMLInputElement>('#trail-color').value = s.trail.color;
    $<HTMLInputElement>('#vol-master').value = String(s.volumes.master);
    $<HTMLInputElement>('#vol-engine').value = String(s.volumes.engine);
    $<HTMLInputElement>('#vol-passengers').value = String(s.volumes.passengers);
    const fuel = FUELS.find((f) => f.id === s.fuel)!;
    const names = s.passengers.map((id) => passengers.find((p) => p.id === id)).filter(Boolean).map((p) => `${p!.emoji}${p!.name}`);
    $('#summary').textContent = `${vehicle.emoji}${vehicle.name} × ${fuel.emoji}${fuel.name}${names.length ? ' ＋ ' + names.join('・') : '（だれも乗せない）'}`;
    this.onChange();
  }

  private renderCards<T>(
    sel: string,
    list: T[],
    selected: (x: T) => boolean,
    view: (x: T) => { emoji: string; name: string; desc: string; tag?: string; edit?: boolean },
    pick: (x: T, ev: MouseEvent) => void,
  ) {
    const root = $(sel);
    root.innerHTML = '';
    for (const item of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'card' + (selected(item) ? ' selected' : '');
      b.innerHTML = this.card({ ...view(item), selected: selected(item) });
      b.addEventListener('click', (ev) => {
        this.audio.unlock();
        this.audio.sfx('click');
        pick(item, ev);
        this.render();
      });
      root.appendChild(b);
    }
  }

  private bindStatic() {
    const s = this.settings;
    $<HTMLInputElement>('#vehicle-color').addEventListener('input', (e) => {
      s.vehicleColor = (e.target as HTMLInputElement).value;
      this.onChange();
    });
    $('#vehicle-color-reset').addEventListener('click', () => {
      s.vehicleColor = null;
      this.render();
    });
    document.querySelectorAll<HTMLInputElement>('input[name=trail-mode]').forEach((r) =>
      r.addEventListener('change', () => {
        s.trail.mode = r.value as 'auto' | 'custom';
        this.onChange();
      }),
    );
    document.querySelectorAll<HTMLInputElement>('input[name=trail-style]').forEach((r) =>
      r.addEventListener('change', () => {
        s.trail.style = r.value as 'ribbon' | 'rainbow' | 'dots';
        this.onChange();
      }),
    );
    $<HTMLInputElement>('#trail-color').addEventListener('input', (e) => {
      s.trail.color = (e.target as HTMLInputElement).value;
      s.trail.mode = 'custom';
      this.render();
    });
    for (const k of ['master', 'engine', 'passengers'] as const) {
      $<HTMLInputElement>(`#vol-${k}`).addEventListener('input', (e) => {
        s.volumes[k] = Number((e.target as HTMLInputElement).value);
        this.audio.volumes = { ...s.volumes };
        this.audio.applyVolumes();
        this.onChange();
      });
    }
    $('#btn-new-passenger').addEventListener('click', () => this.openEditor(null));
    this.bindEditor();
  }

  // ---- 音をつくるエディタ ----

  private bindEditor() {
    const emoji = $<HTMLSelectElement>('#ed-emoji');
    emoji.innerHTML = EMOJIS.map((e) => `<option>${e}</option>`).join('');
    const preset = $<HTMLSelectElement>('#ed-preset');
    preset.innerHTML = PASSENGERS.map((p) => `<option value="${p.id}">${p.emoji} ${esc(p.name)}</option>`).join('');
    preset.addEventListener('change', () => this.loadPreset(PASSENGERS.find((p) => p.id === preset.value)!.sound));
    $('#ed-preview').addEventListener('click', () => this.audio.previewRecipe(this.readEditor().sound, 4));
    $('#ed-cancel').addEventListener('click', () => this.closeEditor());
    $('#ed-save').addEventListener('click', () => this.saveEditor());
    $('#ed-delete').addEventListener('click', () => {
      if (!this.editing) return;
      this.custom = this.custom.filter((p) => p.id !== this.editing!.id);
      this.settings.passengers = this.settings.passengers.filter((id) => id !== this.editing!.id);
      saveCustomPassengers(this.custom);
      this.closeEditor();
      this.render();
    });
    const grid = $('#ed-steps');
    grid.innerHTML = '';
    for (let i = 0; i < STEPS; i++) {
      const cell = document.createElement('div');
      cell.className = 'step';
      cell.innerHTML = '<div class="v"></div>';
      const set = (e: PointerEvent) => {
        const r = cell.getBoundingClientRect();
        const t = 1 - (e.clientY - r.top) / r.height;
        const lv = Math.round(t * LEVELS) - 1;
        this.steps[i] = lv < 0 ? null : Math.min(LEVELS - 1, lv);
        this.drawSteps();
      };
      cell.addEventListener('pointerdown', (e) => {
        cell.releasePointerCapture?.(e.pointerId);
        set(e);
      });
      cell.addEventListener('pointerenter', (e) => {
        if (e.buttons) set(e);
      });
      grid.appendChild(cell);
    }
  }

  private loadPreset(r: SoundRecipe) {
    $<HTMLSelectElement>('#ed-wave').value = r.wave;
    $<HTMLInputElement>('#ed-pitch').value = String(Math.round(12 * Math.log2(r.base / 440)));
    $<HTMLInputElement>('#ed-bpm').value = String(r.bpm);
    $<HTMLInputElement>('#ed-vibrato').value = String(r.vibratoDepth);
    $<HTMLInputElement>('#ed-voices').value = String(r.voices);
    $<HTMLInputElement>('#ed-follow').checked = (r.follow?.altitude ?? 0) > 0;
    const min = Math.min(...r.pattern.filter((p): p is number => p !== null), 0);
    this.steps = Array.from({ length: STEPS }, (_, i) => {
      const p = r.pattern[i % r.pattern.length];
      return p === null ? null : Math.max(0, Math.min(LEVELS - 1, p - min));
    });
    this.drawSteps();
  }

  private drawSteps() {
    document.querySelectorAll<HTMLElement>('#ed-steps .step').forEach((cell, i) => {
      const v = this.steps[i];
      cell.classList.toggle('rest', v === null);
      (cell.firstElementChild as HTMLElement).style.height = v === null ? '4px' : `${((v + 1) / LEVELS) * 100}%`;
    });
  }

  private openEditor(p: CustomPassenger | null) {
    this.editing = p;
    $('#editor').classList.remove('hidden');
    $('#ed-delete').classList.toggle('hidden', !p);
    $<HTMLInputElement>('#ed-name').value = p?.name ?? '';
    $<HTMLSelectElement>('#ed-emoji').value = p?.emoji ?? EMOJIS[8];
    $<HTMLInputElement>('#ed-color').value = p?.trailColor ?? '#ff4fa3';
    this.loadPreset(p?.sound ?? PASSENGERS[1].sound);
  }

  private closeEditor() {
    this.audio.stopPreview();
    $('#editor').classList.add('hidden');
    this.editing = null;
  }

  private readEditor(): CustomPassenger {
    const wave = $<HTMLSelectElement>('#ed-wave').value as SoundRecipe['wave'];
    const pitch = Number($<HTMLInputElement>('#ed-pitch').value);
    const voices = Number($<HTMLInputElement>('#ed-voices').value);
    const vib = Number($<HTMLInputElement>('#ed-vibrato').value);
    const pattern = this.steps.some((s) => s !== null) ? this.steps : [0];
    const sustained = pattern.length === 1;
    const sound: SoundRecipe = {
      wave,
      base: Math.round(440 * Math.pow(2, pitch / 12) * 100) / 100,
      pattern,
      bpm: Number($<HTMLInputElement>('#ed-bpm').value),
      gate: sustained ? 1 : 0.7,
      attack: 0.01,
      release: wave === 'noise' ? 0.2 : 0.12,
      filter: wave === 'sawtooth' || wave === 'square' ? 2400 : 6000,
      vibratoHz: vib > 0.5 ? 9 : 5.5,
      vibratoDepth: vib,
      voices,
      detune: voices > 1 ? 30 : 0,
      glide: 0.02,
      gain: 0.32,
      follow: $<HTMLInputElement>('#ed-follow').checked ? { altitude: 0.8 } : undefined,
    };
    const name = $<HTMLInputElement>('#ed-name').value.trim().slice(0, 20) || 'なぞの音';
    return {
      id: this.editing?.id ?? randomId('custom-').toLowerCase(),
      name,
      emoji: $<HTMLSelectElement>('#ed-emoji').value,
      description: 'あなたがつくった音',
      trailColor: $<HTMLInputElement>('#ed-color').value,
      sound,
      custom: true,
    };
  }

  private saveEditor() {
    const p = this.readEditor();
    const errors = validatePassenger(p);
    if (errors.length) {
      alert('保存できませんでした：\n' + errors.join('\n'));
      return;
    }
    const i = this.custom.findIndex((x) => x.id === p.id);
    if (i >= 0) this.custom[i] = p;
    else this.custom.push(p);
    saveCustomPassengers(this.custom);
    void sendElement(p);
    if (!this.settings.passengers.includes(p.id)) {
      this.settings.passengers.push(p.id);
      if (this.settings.passengers.length > MAX_PASSENGERS) this.settings.passengers.shift();
    }
    this.closeEditor();
    this.render();
  }
}
