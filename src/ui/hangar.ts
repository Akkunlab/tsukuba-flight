// 格納庫（ミッション・機体・燃料・搭乗者・軌跡・設定の選択）と、音をつくるエディタ。
import { FUELS, MAX_PASSENGERS, MODES, PASSENGERS, VEHICLES, fuelById, fuelsFor, modeById, vehicleById } from '../content/index';
import type { CustomPassenger, FuelDef, ModeDef, PassengerDef, SoundRecipe, VehicleDef } from '../content/types';
import { validatePassenger } from '../content/validate';
import { TANK } from '../sim/physics';
import type { AudioEngine } from '../audio/sound';
import { loadBest, loadCustomPassengers, randomId, saveCustomPassengers, sendElement, type Settings } from '../net/api';
import { CUSTOM_ICONS, icon } from './icons';

const $ = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const STEPS = 16;
const LEVELS = 13; // 0..12 半音、それより下は休符

type Tab = 'mission' | 'vehicle' | 'fuel' | 'passenger' | 'trail' | 'settings';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'mission', label: 'ミッション', icon: 'map' },
  { id: 'vehicle', label: '機体', icon: 'prop' },
  { id: 'fuel', label: '燃料', icon: 'avgas' },
  { id: 'passenger', label: '搭乗者', icon: 'note' },
  { id: 'trail', label: '軌跡', icon: 'palette' },
  { id: 'settings', label: '設定', icon: 'sliders' },
];

const MODEL_LABEL = { plane: '滑走路から離陸', hover: 'その場で浮く', rocket: '垂直に打ち上げ', balloon: '風まかせ' } as const;

/** 巡航（スロットル 6 割）で飛べるおよその時間 [秒] */
export function endurance(v: VehicleDef, f: FuelDef): number {
  return (TANK * f.capacity) / (v.fuelUse * (0.15 + 0.85 * 0.6));
}

function minutes(s: number) {
  return s >= 60 ? `約 ${Math.round(s / 60)} 分` : `約 ${Math.round(s)} 秒`;
}

function meter(label: string, ratio: number, value: string) {
  const w = Math.round(Math.max(0.04, Math.min(1, ratio)) * 100);
  return `<span class="lbl">${label}</span><span class="meter"><i style="width:${w}%"></i></span><span class="val">${value}</span>`;
}

export class Hangar {
  settings: Settings;
  custom: CustomPassenger[];
  private audio: AudioEngine;
  onChange: () => void = () => {};
  private tab: Tab = 'mission';
  private editing: CustomPassenger | null = null;
  private steps: (number | null)[] = [];
  private editIcon = 'note';

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
    $('#btn-back-title').innerHTML = icon('back');
    $('#btn-new-passenger').addEventListener('click', () => this.openEditor(null));
    this.bindEditor();
    this.render();
  }

  allPassengers(): PassengerDef[] {
    return [...PASSENGERS, ...(this.custom ?? [])];
  }

  render() {
    this.renderTabs();
    const list = $('#hg-items');
    const detail = $('#hg-detail');
    $('#btn-new-passenger').classList.toggle('hidden', this.tab !== 'passenger');
    switch (this.tab) {
      case 'mission':
        this.renderList(list, MODES, (m) => m.id === this.settings.mode, (m) => ({ icon: m.icon, name: m.name, sub: m.objective }), (m) => (this.settings.mode = m.id));
        detail.innerHTML = this.missionDetail(modeById(this.settings.mode));
        break;
      case 'vehicle':
        this.renderList(list, VEHICLES, (v) => v.id === this.settings.vehicle, (v) => ({ icon: v.icon, name: v.name, sub: MODEL_LABEL[v.model] }), (v) => {
          this.settings.vehicle = v.id;
          const allowed = fuelsFor(v).map((f) => f.id);
          if (!allowed.includes(this.settings.fuel)) this.settings.fuel = allowed[0];
          this.settings.vehicleColor = null;
        });
        detail.innerHTML = this.vehicleDetail(vehicleById(this.settings.vehicle));
        this.bindVehicleDetail();
        break;
      case 'fuel': {
        const v = vehicleById(this.settings.vehicle);
        this.renderList(list, fuelsFor(v), (f) => f.id === this.settings.fuel, (f) => ({ icon: f.icon, name: f.name, sub: minutes(endurance(v, f)) }), (f) => (this.settings.fuel = f.id));
        detail.innerHTML = this.fuelDetail(fuelById(this.settings.fuel), v);
        break;
      }
      case 'passenger': {
        const s = this.settings;
        this.renderList(
          list,
          this.allPassengers(),
          (p) => s.passengers.includes(p.id),
          (p) => ({ icon: p.icon, name: p.name, sub: 'custom' in p ? 'じぶん作 ・ 選ぶと編集' : p.description, check: true }),
          (p) => {
            if ('custom' in p && s.passengers.includes(p.id)) {
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
        detail.innerHTML = this.passengerDetail();
        break;
      }
      case 'trail':
        list.innerHTML = '';
        detail.innerHTML = this.trailDetail();
        this.bindTrailDetail();
        break;
      case 'settings':
        list.innerHTML = '';
        detail.innerHTML = this.settingsDetail();
        this.bindSettingsDetail();
        break;
    }
    this.renderLoadout();
    this.onChange();
  }

  private renderTabs() {
    const nav = $('#hg-tabs');
    nav.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = t.id === this.tab ? 'active' : '';
      b.innerHTML = `${icon(t.icon)}<span>${t.label}</span>`;
      b.addEventListener('click', () => {
        this.audio.unlock();
        this.audio.sfx('click');
        this.tab = t.id;
        this.render();
      });
      nav.appendChild(b);
    }
  }

  private renderList<T>(root: HTMLElement, list: T[], selected: (x: T) => boolean, view: (x: T) => { icon: string; name: string; sub: string; check?: boolean }, pick: (x: T) => void) {
    root.innerHTML = '';
    for (const item of list) {
      const v = view(item);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item' + (selected(item) ? ' selected' : '');
      b.innerHTML = `${icon(v.icon)}<span><span class="nm">${esc(v.name)}</span><span class="sub">${esc(v.sub)}</span></span>${v.check ? '<span class="chk"></span>' : ''}`;
      b.addEventListener('click', () => {
        this.audio.unlock();
        this.audio.sfx('click');
        pick(item);
        this.render();
      });
      root.appendChild(b);
    }
  }

  private missionDetail(m: ModeDef): string {
    const best = loadBest()[m.id];
    const rules: [string, string][] = [
      ['制限時間', m.timeLimit > 0 ? `${Math.floor(m.timeLimit / 60)} 分` : 'なし'],
      ['風', m.wind >= 6 ? `強い（${m.wind} m/s）` : m.wind >= 2 ? `ややあり（${m.wind} m/s）` : `穏やか（${m.wind} m/s）`],
    ];
    if (m.checkpoints.length) rules.push(['リング', `${m.checkpoints.length} 個（順番にくぐる）`]);
    if (m.targets) rules.push(['風船', `${m.targets.count} 個（体当たりで割る）`]);
    rules.push(['得点', this.scoreRule(m)]);
    if (best) rules.push(['自己ベスト', `${best.toLocaleString()} 点`]);
    const route = m.checkpoints.length ? `<div class="subhead">ルート</div><ol class="rules">${m.checkpoints.map((c) => `<li><span>${esc(c.name)}</span><span class="mono">${c.alt} m</span></li>`).join('')}</ol>` : '';
    return `<div class="detail panel">
      <div class="k">MISSION BRIEFING</div>
      <h3>${icon(m.icon)}${esc(m.name)}</h3>
      <div class="brief"><div class="k">OBJECTIVE</div><div class="obj">${esc(m.objective)}</div></div>
      <p>${esc(m.description)}</p>
      <ul class="rules">${rules.map(([k, v]) => `<li><span>${k}</span><span>${esc(v)}</span></li>`).join('')}</ul>
      ${route}
      <p class="subhead">建物・森・地面にぶつかる、燃料が切れる、エリアの外に出ると終わり。最後に着陸できるとボーナス。</p>
    </div>`;
  }

  private scoreRule(m: ModeDef): string {
    const parts = ['距離'];
    if (m.checkpoints.length) parts.push('リング 1 個 500 点');
    if (m.targets) parts.push('風船 1 個 300 点');
    parts.push('着陸 1500 点');
    return parts.join(' ＋ ');
  }

  private vehicleDetail(v: VehicleDef): string {
    const f = fuelById(this.settings.fuel);
    const climb = v.model === 'rocket' ? v.accel / 1.5 : v.model === 'plane' ? v.climbRate : v.climbRate * 1.3;
    return `<div class="detail panel">
      <div class="k">AIRCRAFT</div>
      <h3>${icon(v.icon)}${esc(v.name)}</h3>
      <p>${esc(v.description)}</p>
      <div class="spec">
        ${meter('最高速度', v.maxSpeed / 160, `${Math.round(v.maxSpeed * 3.6)}`)}
        ${meter('機動性', v.turnRate / 2.2, `${v.turnRate.toFixed(1)}`)}
        ${meter('上昇力', climb / 15, `${Math.round(climb)}`)}
        ${meter('航続時間', endurance(v, f) / 900, minutes(endurance(v, f)).replace('約 ', ''))}
      </div>
      <ul class="rules">
        <li><span>出発</span><span>${v.start === 'runway' ? '滑走路' : '発射台'}</span></li>
        <li><span>飛び方</span><span>${MODEL_LABEL[v.model]}</span></li>
        ${v.model === 'plane' ? `<li><span>離陸速度</span><span class="mono">${Math.round(v.takeoffSpeed * 3.6)} km/h</span></li>` : ''}
        <li><span>大きさ</span><span class="mono">${(v.radius * 2).toFixed(1)} m</span></li>
      </ul>
      <div class="row-inline">機体の色 <input type="color" id="vehicle-color" value="${this.settings.vehicleColor ?? v.color}" /> <button id="vehicle-color-reset" class="ghost small">元に戻す</button></div>
    </div>`;
  }

  private bindVehicleDetail() {
    $<HTMLInputElement>('#vehicle-color').addEventListener('input', (e) => {
      this.settings.vehicleColor = (e.target as HTMLInputElement).value;
      this.onChange();
    });
    $('#vehicle-color-reset').addEventListener('click', () => {
      this.settings.vehicleColor = null;
      this.render();
    });
  }

  private fuelDetail(f: FuelDef, v: VehicleDef): string {
    return `<div class="detail panel">
      <div class="k">FUEL</div>
      <h3>${icon(f.icon)}${esc(f.name)}</h3>
      <p>${esc(f.description)}</p>
      <div class="spec">
        ${meter('容量', f.capacity / 2, `×${f.capacity}`)}
        ${meter('出力', f.power / 1.5, `×${f.power}`)}
        ${meter(`${esc(v.name)}で`, endurance(v, f) / 900, minutes(endurance(v, f)).replace('約 ', ''))}
      </div>
      <div class="row-inline">軌跡の色（おまかせのとき） <span style="display:inline-block;width:40px;height:10px;background:${f.trailColor}"></span></div>
    </div>`;
  }

  private passengerDetail(): string {
    const s = this.settings;
    const ps = s.passengers.map((id) => this.allPassengers().find((p) => p.id === id)).filter(Boolean) as PassengerDef[];
    return `<div class="detail panel">
      <div class="k">PASSENGERS ${ps.length}/${MAX_PASSENGERS}</div>
      <h3>${icon('note')}一緒に乗せる</h3>
      <p>乗せた搭乗者は、飛んでいる間ずっと音を鳴らす。高く飛ぶと音程が上がり、速く飛ぶとテンポが上がるものもある。音の大きさで軌跡の太さが変わる。</p>
      <ul class="rules">${ps.length ? ps.map((p) => `<li><span>${esc(p.name)}</span><span>${esc('custom' in p ? 'じぶん作' : '')}</span></li>`).join('') : '<li><span>だれも乗せない</span><span></span></li>'}</ul>
      <p class="subhead">「自分で音をつくる」から、音色とメロディを決めた搭乗者をつくれる（いまは自分だけが使える）。</p>
    </div>`;
  }

  private trailDetail(): string {
    const t = this.settings.trail;
    return `<div class="detail panel">
      <div class="k">TRAIL</div>
      <h3>${icon('palette')}軌跡</h3>
      <div class="subhead">色</div>
      <div class="opts" id="trail-mode">
        <button data-v="auto" class="${t.mode === 'auto' ? 'on' : ''}">おまかせ（燃料と音で変わる）</button>
        <button data-v="custom" class="${t.mode === 'custom' ? 'on' : ''}">自分で選ぶ</button>
        <input type="color" id="trail-color" value="${t.color}" />
      </div>
      <div class="subhead">形</div>
      <div class="opts" id="trail-style">
        <button data-v="ribbon" class="${t.style === 'ribbon' ? 'on' : ''}">リボン</button>
        <button data-v="rainbow" class="${t.style === 'rainbow' ? 'on' : ''}">虹</button>
        <button data-v="dots" class="${t.style === 'dots' ? 'on' : ''}">点線</button>
      </div>
    </div>`;
  }

  private bindTrailDetail() {
    const t = this.settings.trail;
    document.querySelectorAll<HTMLButtonElement>('#trail-mode button').forEach((b) =>
      b.addEventListener('click', () => {
        t.mode = b.dataset.v as 'auto' | 'custom';
        this.render();
      }),
    );
    document.querySelectorAll<HTMLButtonElement>('#trail-style button').forEach((b) =>
      b.addEventListener('click', () => {
        t.style = b.dataset.v as 'ribbon' | 'rainbow' | 'dots';
        this.render();
      }),
    );
    $<HTMLInputElement>('#trail-color').addEventListener('input', (e) => {
      t.color = (e.target as HTMLInputElement).value;
      t.mode = 'custom';
      document.querySelectorAll<HTMLButtonElement>('#trail-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === 'custom'));
      this.onChange();
    });
  }

  private settingsDetail(): string {
    const v = this.settings.volumes;
    return `<div class="detail panel">
      <div class="k">SETTINGS</div>
      <h3>${icon('sliders')}音量</h3>
      <div class="vol">全体 <input type="range" id="vol-master" min="0" max="1" step="0.05" value="${v.master}" /></div>
      <div class="vol">エンジン <input type="range" id="vol-engine" min="0" max="1" step="0.05" value="${v.engine}" /></div>
      <div class="vol">搭乗者 <input type="range" id="vol-passengers" min="0" max="1" step="0.05" value="${v.passengers}" /></div>
      <div class="subhead">操作</div>
      <ul class="rules">
        <li><span>パソコン</span><span>矢印キー 操縦 ／ W・S スロットル ／ C カメラ</span></li>
        <li><span>スマホ</span><span>左でスティック ／ 右のバーでスロットル</span></li>
        <li><span>ゲームパッド</span><span>左スティック ／ トリガー</span></li>
      </ul>
      <p class="subhead">地形・航空写真: 国土地理院 ／ 建物・森: © OpenStreetMap contributors ／ 滑走路は架空です</p>
    </div>`;
  }

  private bindSettingsDetail() {
    for (const k of ['master', 'engine', 'passengers'] as const) {
      $<HTMLInputElement>(`#vol-${k}`).addEventListener('input', (e) => {
        this.settings.volumes[k] = Number((e.target as HTMLInputElement).value);
        this.audio.volumes = { ...this.settings.volumes };
        this.audio.applyVolumes();
        this.onChange();
      });
    }
  }

  private renderLoadout() {
    const s = this.settings;
    const m = modeById(s.mode);
    const v = vehicleById(s.vehicle);
    const f = FUELS.find((x) => x.id === s.fuel)!;
    const ps = s.passengers.map((id) => this.allPassengers().find((p) => p.id === id)).filter(Boolean) as PassengerDef[];
    const slot = (k: string, ic: string, text: string) => `<div class="slot">${icon(ic)}<div class="t"><span class="k">${k}</span><span>${esc(text)}</span></div></div>`;
    $('#summary').innerHTML =
      slot('MISSION', m.icon, m.name) +
      slot('AIRCRAFT', v.icon, v.name) +
      slot('FUEL', f.icon, f.name) +
      slot('PAX', ps[0]?.icon ?? 'note', ps.length ? ps.map((p) => p.name).join('・') : 'なし');
  }

  // ---- 音をつくるエディタ ----

  private bindEditor() {
    const grid = $('#ed-icon');
    grid.innerHTML = '';
    for (const id of CUSTOM_ICONS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.v = id;
      b.innerHTML = icon(id);
      b.addEventListener('click', () => {
        this.editIcon = id;
        this.drawIconPicker();
      });
      grid.appendChild(b);
    }
    const preset = $<HTMLSelectElement>('#ed-preset');
    preset.innerHTML = PASSENGERS.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
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
    const steps = $('#ed-steps');
    steps.innerHTML = '';
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
      steps.appendChild(cell);
    }
  }

  private drawIconPicker() {
    document.querySelectorAll<HTMLButtonElement>('#ed-icon button').forEach((b) => b.classList.toggle('on', b.dataset.v === this.editIcon));
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
      (cell.firstElementChild as HTMLElement).style.height = v === null ? '3px' : `${((v + 1) / LEVELS) * 100}%`;
    });
  }

  private openEditor(p: CustomPassenger | null) {
    this.editing = p;
    $('#editor').classList.remove('hidden');
    $('#ed-delete').classList.toggle('hidden', !p);
    $<HTMLInputElement>('#ed-name').value = p?.name ?? '';
    this.editIcon = p?.icon ?? 'ghost';
    this.drawIconPicker();
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
      icon: this.editIcon,
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
