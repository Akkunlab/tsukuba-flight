import type { SceneryDef } from './types';

// 景色の要素。kind は world/scenery.ts のビルダー名。
export const SCENERY: SceneryDef[] = [
  { id: 'label-library', name: '中央図書館', kind: 'label', params: { x: -59, z: -347, y: 45, text: '中央図書館' } },
  { id: 'label-hall', name: '大学会館', kind: 'label', params: { x: -8, z: 61, y: 40, text: '大学会館' } },
  { id: 'label-hospital', name: '附属病院', kind: 'label', params: { x: -83, z: 1436, y: 75, text: '附属病院' } },
  { id: 'label-tdome', name: 'T-Dome', kind: 'label', params: { x: 321, z: 192, y: 40, text: 'T-Dome' } },
  { id: 'label-kasuga', name: '春日エリア', kind: 'label', params: { x: 400, z: 2200, y: 45, text: '春日エリア' } },
  { id: 'label-center', name: 'つくばセンター', kind: 'label', params: { x: 931, z: 2616, y: 60, text: 'つくばセンター' } },
  { id: 'label-gsi', name: '地図と測量の科学館', kind: 'label', params: { x: -1474, z: 225, y: 40, text: '地図と測量の科学館' } },
  { id: 'label-ichinoya', name: '一の矢', kind: 'label', params: { x: -380, z: -1420, y: 40, text: '一の矢学生宿舎' } },
  { id: 'label-tsukubasan', name: '筑波山', kind: 'label', params: { x: 420, z: -13250, y: 950, text: '筑波山', scale: 12 } },
  { id: 'windsock', name: '吹き流し', kind: 'windsock', params: { x: 100, z: -800 } },
  { id: 'clouds', name: '雲', kind: 'clouds', params: { count: 40, seed: 7 } },
];
