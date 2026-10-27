// 飛行のリプレイ。記録したフレームを補間して再生し、カメラを切り替えながら見せる。
import * as THREE from 'three';
import type { ReplayFrame } from '../sim/flight';

export interface ReplayPose {
  t: number;
  pos: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  throttle: number;
}

export type ReplayCamera = 'chase' | 'side' | 'tower' | 'top';

export class ReplayPlayer {
  frames: ReplayFrame[] = [];
  t = 0;
  playing = false;
  crashed = false;
  /** カメラを自動で切り替えるか（false なら camera を固定） */
  auto = true;
  camera: ReplayCamera = 'chase';
  private camTimer = 0;
  private towerPos = new THREE.Vector3();
  private readonly pose: ReplayPose = { t: 0, pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, throttle: 0 };

  get duration() {
    return this.frames.length ? this.frames[this.frames.length - 1][0] - this.frames[0][0] : 0;
  }

  start(frames: ReplayFrame[], crashed: boolean) {
    this.frames = frames;
    this.crashed = crashed;
    this.t = frames.length ? frames[0][0] : 0;
    this.playing = frames.length > 1;
    this.camTimer = 0;
    this.camera = 'chase';
  }

  stop() {
    this.playing = false;
  }

  /** 再生の速さ。長い飛行は早送りし、墜落直前はスローにする */
  private speed(): number {
    const end = this.frames[this.frames.length - 1][0];
    const left = end - this.t;
    if (this.crashed && left < 4) return 0.35;
    const d = this.duration;
    return d > 120 ? 6 : d > 40 ? 3 : 1.5;
  }

  update(dt: number): ReplayPose | null {
    if (!this.playing || this.frames.length < 2) return null;
    this.t += dt * this.speed();
    const end = this.frames[this.frames.length - 1][0];
    if (this.t > end + 1.5) {
      this.t = this.frames[0][0];
      this.camTimer = 0;
    }
    this.camTimer += dt;
    if (this.auto && this.camTimer > 4.5) {
      this.camTimer = 0;
      const order: ReplayCamera[] = ['chase', 'side', 'tower', 'chase', 'top'];
      this.camera = order[(order.indexOf(this.camera) + 1) % order.length];
      this.towerPos.set(0, 0, 0);
    }
    return this.sample(Math.min(this.t, end));
  }

  sample(t: number): ReplayPose {
    const f = this.frames;
    let lo = 0;
    let hi = f.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (f[mid][0] <= t) lo = mid;
      else hi = mid;
    }
    const a = f[lo];
    const b = f[hi];
    const k = b[0] > a[0] ? Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0]))) : 0;
    const lerp = (i: number) => a[i] + (b[i] - a[i]) * k;
    const angle = (i: number) => {
      let d = b[i] - a[i];
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return a[i] + d * k;
    };
    const p = this.pose;
    p.t = t;
    p.pos.set(lerp(1), lerp(2), lerp(3));
    p.yaw = angle(4);
    p.pitch = lerp(5);
    p.roll = lerp(6);
    p.throttle = lerp(7);
    return p;
  }

  place(cam: THREE.PerspectiveCamera, pose: ReplayPose, radius: number, ground: (x: number, z: number) => number) {
    const r = Math.max(radius, 1.5);
    const fx = Math.sin(pose.yaw);
    const fz = -Math.cos(pose.yaw);
    const p = pose.pos;
    switch (this.camera) {
      case 'chase':
        cam.position.set(p.x - fx * (r * 5 + 12), p.y + r * 1.6 + 4, p.z - fz * (r * 5 + 12));
        break;
      case 'side':
        cam.position.set(p.x + fz * (r * 6 + 14), p.y + r, p.z - fx * (r * 6 + 14));
        break;
      case 'tower':
        // 少し先の地上から見上げる（中継カメラ風）
        if (this.towerPos.lengthSq() === 0) {
          const ahead = r * 30 + 120;
          const tx = p.x + fx * ahead + fz * 60;
          const tz = p.z + fz * ahead - fx * 60;
          this.towerPos.set(tx, ground(tx, tz) + 12, tz);
        }
        cam.position.copy(this.towerPos);
        break;
      case 'top':
        cam.position.set(p.x + 1, p.y + r * 40 + 160, p.z + 60);
        break;
    }
    const minY = ground(cam.position.x, cam.position.z) + 2;
    if (cam.position.y < minY) cam.position.y = minY;
    cam.lookAt(p.x, p.y + r * 0.4, p.z);
  }
}
