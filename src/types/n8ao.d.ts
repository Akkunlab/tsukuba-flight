// n8ao は型定義を同梱していないので、使う分だけ書く
declare module 'n8ao' {
  import type { Camera, Color, Scene } from 'three';
  import type { Pass } from 'postprocessing';
  export class N8AOPostPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: {
      aoRadius: number;
      distanceFalloff: number;
      intensity: number;
      color: Color;
      halfRes: boolean;
      gammaCorrection: boolean;
      aoSamples: number;
      denoiseSamples: number;
      denoiseRadius: number;
    };
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
  }
}
