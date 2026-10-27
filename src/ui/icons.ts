// 線画の SVG アイコン（絵文字は使わない）。24×24、線は currentColor。
// 要素（乗り物・燃料・搭乗者・モード）の icon はここのキーを指す。

const P: Record<string, string> = {
  // ---- 乗り物（横から見た形） ----
  prop: '<path d="M2 13h3l2-2h9l4 1.2c1 .3 1 1.6 0 1.8L16 15H7z"/><path d="M8 11 6.5 6.5h5L13 11"/><path d="M20.5 9.5v7"/><path d="M3 13 2 9.5h2l2.5 3.5"/><path d="M9 15l-.5 3M14 15l.5 3"/>',
  birdman: '<path d="M1 9.5c4-1.2 18-1.2 22 0"/><path d="M10 9.7 9.5 15h4l-.5-5.3"/><circle cx="11.5" cy="12.6" r="1"/><path d="M9.5 15 8 18h7l-1.5-3"/><path d="M15 16.5h4.5M19.5 14.5v4"/>',
  paper: '<path d="M2 12 22 6 9 14z"/><path d="M9 14l1 4 3-5"/><path d="M22 6 10 18"/>',
  drone: '<path d="M8 12h8l-1 2.5H9z"/><path d="M4 10h5M15 10h5"/><path d="M6.5 10v2M17.5 10v2"/><path d="M6.5 12l2 0M17.5 12l-2 0"/><path d="M10 14.5l-1 3M14 14.5l1 3"/><circle cx="12" cy="13.2" r=".8"/>',
  kotatsu: '<path d="M3 9h18v1.6H3z"/><path d="M4 10.6c1 3 1 5 .5 7.4h15c-.5-2.4-.5-4.4.5-7.4"/><circle cx="12" cy="7.3" r="1.7"/><path d="M12 5.6v-.8"/><path d="M5 20l1-2M19 20l-1-2M9 20l.4-2M15 20l-.4-2"/>',
  rocket: '<path d="M12 2c3 2.5 4 6 4 9.5V17H8v-5.5C8 8 9 4.5 12 2z"/><circle cx="12" cy="9" r="1.6"/><path d="M8 13l-3 4v1.5h3M16 13l3 4v1.5h-3"/><path d="M10 17l-.5 3M14 17l.5 3M12 17v4"/>',
  petbottle: '<path d="M10.5 2.5h3v2l1.5 2.5V19a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 19V7l1.5-2.5z"/><path d="M9 11h6M9 15h6"/><path d="M9 17l-3 3.5M15 17l3 3.5"/>',
  balloon: '<path d="M12 2.5c4.4 0 7 3 7 6.8 0 3.6-3.5 6.4-5.2 7.7h-3.6C8.5 15.7 5 12.9 5 9.3 5 5.5 7.6 2.5 12 2.5z"/><path d="M12 2.5c-2 1.8-2.8 4.4-2.8 6.8 0 3 1 5.6 1 7.7M12 2.5c2 1.8 2.8 4.4 2.8 6.8 0 3-1 5.6-1 7.7"/><path d="M10.2 17l.3 2.5h3l.3-2.5"/><path d="M10.5 19.5h3v2h-3z"/>',
  broom: '<path d="M3 6.5 14 15"/><path d="M14 15c1 2.5 3.5 4.5 7 5-1-3-2-5.5-4.5-7.8z"/><path d="M15.2 16.3 17.8 19M16.6 14.6l2.6 3"/><path d="M5 4.5l1 1M8.5 4.2v1.4M4 8.2h1.4"/>',
  // ---- 燃料 ----
  avgas: '<path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V20z"/><path d="M4 20h11"/><path d="M7 7h5v4H7z"/><path d="M14 9h2a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 3 0V8l-2.5-2.5"/>',
  tempura: '<path d="M5 15c4-1 9-5 12-10l2 1.5c-2 5-6 10-12 11.5z"/><path d="M8 13.5l1.5 2M11 11.5l1.6 1.8M13.8 9l1.6 1.6"/><path d="M16.5 5.5 19 3"/>',
  honey: '<path d="M6 9h12v9.5A2.5 2.5 0 0 1 15.5 21h-7A2.5 2.5 0 0 1 6 18.5z"/><path d="M7 6.5h10V9H7z"/><path d="M10 13.5l2-1.2 2 1.2v2.3l-2 1.2-2-1.2z"/>',
  natto: '<path d="M4 10h16l-1.5 9h-13z"/><path d="M4 10l2-3.5h12l2 3.5"/><path d="M8.5 12.5c1 2.5 2.5-1.5 3.5 1s2.5-1.5 3.5 1"/><path d="M12 6.5c.5-2 2-3 4-3.5"/>',
  coffee: '<path d="M5 9h11v6a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 11h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8.5 3.5c-1 1 1 2 0 3.5M12 3.5c-1 1 1 2 0 3.5"/>',
  water: '<path d="M12 3c3.5 4.5 6 7.5 6 10.5a6 6 0 0 1-12 0C6 10.5 8.5 7.5 12 3z"/><path d="M9.2 14a3 3 0 0 0 2.8 3"/>',
  soda: '<path d="M7 7h10l-1.3 13.5H8.3z"/><path d="M6 7h12"/><path d="M13 7l2-4h2.5"/><circle cx="11" cy="12" r=".9"/><circle cx="13" cy="15.5" r=".9"/><circle cx="10.5" cy="17.5" r=".7"/>',
  // ---- 搭乗者・音 ----
  bee: '<ellipse cx="12" cy="14" rx="5.5" ry="4"/><path d="M10 10.3v7.4M13.5 10.2v7.6"/><path d="M10.5 10.5C8 7 5 6.5 4.5 8.5S8 11 10.5 10.5zM13.5 10.5C16 7 19 6.5 19.5 8.5S16 11 13.5 10.5z"/><path d="M17.5 14h2"/>',
  synth: '<rect x="2.5" y="7" width="19" height="10" rx="1.2"/><path d="M6.5 7v6M10.5 7v6M14.5 7v6M18.5 7v6"/><path d="M2.5 13h19"/>',
  clarinet: '<path d="M12 2.5v13.5"/><path d="M10.5 3h3M10.8 5.5h2.4"/><path d="M12 16c-2.5 0-3.5 2.5-3.5 4.5h7c0-2-1-4.5-3.5-4.5z"/><circle cx="13.6" cy="8.5" r=".6"/><circle cx="13.6" cy="11" r=".6"/><circle cx="13.6" cy="13.5" r=".6"/>',
  trumpet: '<path d="M2.5 11v3"/><path d="M2.5 12.5h12l5-4v8l-5-4"/><path d="M7 12.5V9.5M9.5 12.5V9.5M12 12.5V9.5"/><path d="M6 12.5c0 3 6 3 6 0"/>',
  cat: '<path d="M5 19v-8.5L4 4l4.5 3.5h7L20 4l-1 6.5V19z"/><circle cx="9.3" cy="12" r=".9"/><circle cx="14.7" cy="12" r=".9"/><path d="M11 15h2l-1 1z"/><path d="M3 14h4M3 16.5l4-1M21 14h-4M21 16.5l-4-1"/>',
  frog: '<path d="M4 15c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5c0 2.5-3.5 4-8 4s-8-1.5-8-4z"/><circle cx="8" cy="7.5" r="2.2"/><circle cx="16" cy="7.5" r="2.2"/><path d="M8 15.5c2.5 1.5 5.5 1.5 8 0"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 18.5a2 2 0 0 0 4 0"/><path d="M12 3v2"/>',
  chime: '<path d="M7.5 9a4.5 4.5 0 0 1 9 0v3.5h-9z"/><path d="M12 4.5V3"/><path d="M12 12.5v3"/><path d="M10 15.5h4v5.5h-4z"/>',
  note: '<path d="M9 18V5.5l10-2.5v12.5"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/><path d="M9 9l10-2.5"/>',
  wave: '<path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0"/><path d="M2 12h1M21 12h1"/>',
  ghost: '<path d="M5.5 20.5V10a6.5 6.5 0 0 1 13 0v10.5l-2.2-1.6-2.1 1.6-2.2-1.6-2.1 1.6-2.2-1.6z"/><circle cx="9.5" cy="10.5" r="1"/><circle cx="14.5" cy="10.5" r="1"/>',
  bird: '<path d="M3 13c3-1 5-4 9-4 3 0 5 2 5.5 4l3.5 1-3.5 1c-1 2.5-3.5 4-7 4-3 0-5.5-1.5-7.5-6z"/><circle cx="14.5" cy="12" r=".7"/><path d="M8 13c1 2.5 3 3 5 2.5"/>',
  robot: '<rect x="5" y="8" width="14" height="11" rx="2"/><circle cx="9.5" cy="13" r="1.4"/><circle cx="14.5" cy="13" r="1.4"/><path d="M12 8V5"/><circle cx="12" cy="4" r="1"/><path d="M3 12v3M21 12v3M9.5 16.5h5"/>',
  drum: '<ellipse cx="12" cy="9" rx="8" ry="3"/><path d="M4 9v7c0 1.7 3.6 3 8 3s8-1.3 8-3V9"/><path d="M6 11.5l3 6.5M18 11.5l-3 6.5"/><path d="M8 3l3 5M16 3l-3 5"/>',
  star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5l-5.4 3 1.2-6-4.5-4.2 6.1-.7z"/>',
  heart: '<path d="M12 20s-7.5-4.5-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.5-7.5 10-7.5 10z"/>',
  // ---- モード ----
  free: '<path d="M3 17c4-1 6-6 9-6s4 3 9 2"/><path d="M14 6.5 21 4l-2.5 7"/><path d="M21 4l-8 8"/>',
  tour: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  target: '<path d="M12 3c3.2 0 5.5 2.4 5.5 5.6 0 3.4-3.2 6-4.6 7h-1.8c-1.4-1-4.6-3.6-4.6-7C6.5 5.4 8.8 3 12 3z"/><path d="M11.1 15.6l-.6 1.4h3l-.6-1.4"/><path d="M12 17c0 2-1.5 2.5-1.5 4"/><path d="M9.5 6.5a3 3 0 0 1 2-1.4"/>',
  wind: '<path d="M3 8h11a2.5 2.5 0 1 0-2.5-2.5"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
  // ---- 画面の部品 ----
  camera: '<path d="M3 7.5h12v9H3z"/><path d="M15 10.5l6-3v9l-6-3"/>',
  sound: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4.5v15L19.5 12z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/><path d="M10.5 9v6l4.5-3z"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  trophy: '<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.5a3 3 0 0 0 3 4M16.5 6h3a3 3 0 0 1-3 4"/><path d="M12 13.5V17M8.5 20h7l-1-3h-5z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19.5c0-3.5 2.7-5.5 6-5.5s6 2 6 5.5"/><circle cx="17" cy="9" r="2.4"/><path d="M16.5 14.2c2.6.2 4.5 2 4.5 4.8"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5z"/><path d="M3 12.5l9 5 9-5"/><path d="M3 16.5l9 5 9-5"/>',
  sliders: '<path d="M5 4v16M12 4v16M19 4v16"/><circle cx="5" cy="14" r="2" fill="currentColor"/><circle cx="12" cy="8" r="2" fill="currentColor"/><circle cx="19" cy="16" r="2" fill="currentColor"/>',
  palette: '<path d="M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.4-1.2-1.6-1.2-2.8 0-.9.7-1.5 1.6-1.5H17a4 4 0 0 0 4-4C21 6.5 17 3 12 3z"/><circle cx="7.5" cy="11" r="1.1"/><circle cx="10" cy="7" r="1.1"/><circle cx="14.5" cy="7" r="1.1"/>',
  // ---- 結果 ----
  landed: '<path d="M2 20h20"/><path d="M4 16.5h4l2-2h7l3 1c.8.3.8 1.2 0 1.5l-3 1H5z"/><path d="M14 9l3-3 3 3M17 6v6"/>',
  crashed: '<path d="M12 2.5l1.8 5 4.7-2.5-2 4.8 5 1.2-4.6 2.6 3 4.2-5-1-1 5-2-4.6-3.6 3.7.4-5.1-5.2.6 3.8-3.4L2.8 8.8l5 .2L7 4l3.6 3.6z"/>',
  fuel: '<path d="M5 20V5.5A1.5 1.5 0 0 1 6.5 4h6A1.5 1.5 0 0 1 14 5.5V20z"/><path d="M4 20h11"/><path d="M7 15l5-5"/><path d="M14 9h2a1.5 1.5 0 0 1 1.5 1.5V16a1.5 1.5 0 0 0 3 0V8l-2.5-2.5"/>',
  out: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5z"/>',
  timeout: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2.5"/><path d="M9.5 2.5h5M12 2.5v3"/>',
  quit: '<path d="M10 4H5v16h5"/><path d="M15 8l4 4-4 4M19 12H9"/>',
};

/** SVG 文字列。未定義のキーは丸を返す */
export function icon(name: string, cls = 'icon'): string {
  const body = P[name] ?? '<circle cx="12" cy="12" r="6"/>';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export const ICON_IDS = Object.keys(P);
/** ユーザーが自分の音につけられるアイコン */
export const CUSTOM_ICONS = ['note', 'wave', 'bee', 'bell', 'cat', 'frog', 'ghost', 'bird', 'robot', 'drum', 'star', 'heart', 'synth', 'trumpet'];
