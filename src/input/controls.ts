// 操作入力：キーボード・タッチ（仮想スティック＋スロットル）・ゲームパッドを 1 つの Input にまとめる。
import type { Input } from '../sim/physics';

export class Controls {
  stickX = 0;
  stickY = 0;
  throttle = 0;
  private keys = new Set<string>();
  private touchStick: { id: number; ox: number; oy: number; x: number; y: number } | null = null;
  private knob: HTMLElement;
  private base: HTMLElement;
  private throttleEl: HTMLElement;
  private throttleFill: HTMLElement;
  private throttleTouch: number | null = null;
  enabled = false;
  onAction: (a: 'camera' | 'pause' | 'mute') => void = () => {};

  constructor(root: HTMLElement) {
    this.base = root.querySelector('#stick-base')!;
    this.knob = root.querySelector('#stick-knob')!;
    this.throttleEl = root.querySelector('#throttle')!;
    this.throttleFill = root.querySelector('#throttle-fill')!;

    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, select')) return;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key) && this.enabled) e.preventDefault();
      this.keys.add(e.key.toLowerCase());
      if (!this.enabled || e.repeat) return;
      const k = e.key.toLowerCase();
      if (k === 'c') this.onAction('camera');
      if (k === 'p' || k === 'escape') this.onAction('pause');
      if (k === 'm') this.onAction('mute');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());

    const zone = root.querySelector<HTMLElement>('#stick-zone')!;
    zone.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.touchStick) return;
      zone.setPointerCapture(e.pointerId);
      this.touchStick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: e.clientX, y: e.clientY };
      this.base.style.display = 'block';
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.updateKnob();
    });
    zone.addEventListener('pointermove', (e) => {
      if (this.touchStick?.id !== e.pointerId) return;
      this.touchStick.x = e.clientX;
      this.touchStick.y = e.clientY;
      this.updateKnob();
    });
    const endStick = (e: PointerEvent) => {
      if (this.touchStick?.id !== e.pointerId) return;
      this.touchStick = null;
      this.base.style.display = 'none';
    };
    zone.addEventListener('pointerup', endStick);
    zone.addEventListener('pointercancel', endStick);

    const setThrottleFromY = (clientY: number) => {
      const r = this.throttleEl.getBoundingClientRect();
      this.throttle = Math.min(1, Math.max(0, 1 - (clientY - r.top) / r.height));
    };
    this.throttleEl.addEventListener('pointerdown', (e) => {
      this.throttleEl.setPointerCapture(e.pointerId);
      this.throttleTouch = e.pointerId;
      setThrottleFromY(e.clientY);
    });
    this.throttleEl.addEventListener('pointermove', (e) => {
      if (this.throttleTouch === e.pointerId) setThrottleFromY(e.clientY);
    });
    const endThrottle = () => (this.throttleTouch = null);
    this.throttleEl.addEventListener('pointerup', endThrottle);
    this.throttleEl.addEventListener('pointercancel', endThrottle);
  }

  private updateKnob() {
    const t = this.touchStick;
    if (!t) return;
    const max = 60;
    let dx = t.x - t.ox;
    let dy = t.y - t.oy;
    const len = Math.hypot(dx, dy);
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  /** dt 秒ぶん入力を更新して返す */
  read(dt: number): Input {
    const k = this.keys;
    let tx = 0;
    let ty = 0;
    if (k.has('arrowleft') || k.has('a')) tx -= 1;
    if (k.has('arrowright') || k.has('d')) tx += 1;
    if (k.has('arrowup')) ty += 1;
    if (k.has('arrowdown')) ty -= 1;
    if (k.has('w') || k.has('shift')) this.throttle = Math.min(1, this.throttle + dt * 0.6);
    if (k.has('s') || k.has('control')) this.throttle = Math.max(0, this.throttle - dt * 0.6);

    if (this.touchStick) {
      const t = this.touchStick;
      tx = clamp((t.x - t.ox) / 60);
      ty = clamp(-(t.y - t.oy) / 60);
    }

    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] ?? 0;
      const ay = p.axes[1] ?? 0;
      if (Math.abs(ax) > 0.12) tx = ax;
      if (Math.abs(ay) > 0.12) ty = -ay;
      const up = p.buttons[7]?.value ?? 0;
      const down = p.buttons[6]?.value ?? 0;
      this.throttle = Math.min(1, Math.max(0, this.throttle + (up - down) * dt * 0.8));
      break;
    }

    // キーボードはなめらかに倒れる・戻る
    const rate = this.touchStick ? 30 : 4;
    this.stickX += clamp(tx - this.stickX, -rate * dt, rate * dt);
    this.stickY += clamp(ty - this.stickY, -rate * dt, rate * dt);
    this.throttleFill.style.height = `${Math.round(this.throttle * 100)}%`;
    return { x: this.stickX, y: this.stickY, throttle: this.throttle };
  }

  reset(throttle: number) {
    this.stickX = 0;
    this.stickY = 0;
    this.throttle = throttle;
    this.touchStick = null;
    this.base.style.display = 'none';
  }
}

function clamp(v: number, a = -1, b = 1) {
  return Math.min(b, Math.max(a, v));
}
