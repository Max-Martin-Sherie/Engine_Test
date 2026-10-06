/** Small line-art icons, as inline SVG (static strings, no files). All are 24 x 24 and take their colour from the text. */

const stroke = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const solid = 'fill="currentColor"';

const PATHS: Record<string, string> = {
  move: `<path ${solid} d="M5 3l14 8-6.200 1.800L10.500 19z"/>`,
  stop: `<rect ${solid} x="6" y="6" width="12" height="12" rx="2.500"/>`,
  hold: `<path ${solid} d="M12 2.500l7.500 3v5.500c0 5-3.200 8.500-7.500 10.500C7.700 19.500 4.500 16 4.500 11V5.500z"/>`,
  attack: `<g ${stroke}><circle cx="12" cy="12" r="6.500"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/></g>`,
  build: `<g ${stroke}><path d="M3 21h18"/><path d="M5 21V10l7-6 7 6v11"/><path d="M10 21v-6h4v6"/></g>`,
  cancel: `<g ${stroke}><path d="M6 6l12 12M18 6L6 18"/></g>`,
  rally: `<g ${stroke}><path d="M6 21V3"/><path d="M6 4h12l-3 4 3 4H6"/></g>`,
  back: `<g ${stroke}><path d="M15 5l-7 7 7 7"/></g>`,
  confirm: `<g ${stroke}><path d="M4 12.500l5 5L20 6.500"/></g>`,
  gather: `<g ${stroke}><path d="M12 3l6 6-6 12L6 9z"/><path d="M6 9h12"/></g>`,

  worker: `<g ${stroke}><rect x="6" y="10" width="12" height="8" rx="2"/><path d="M9 10V7a3 3 0 016 0v3"/><path d="M18 14h3M3 14h3"/></g>`,
  trooper: `<g ${stroke}><circle cx="11" cy="6.500" r="3.200"/><path d="M5 21v-5a6 6 0 0112 0v5"/><path d="M15 12.500l6-2"/></g>`,
  tank: `<g ${stroke}><rect x="3" y="14" width="18" height="5" rx="2.500"/><path d="M7 14v-3h8v3"/><path d="M15 12.500h6"/></g>`,
  skiff: `<g ${stroke}><path d="M12 3l2.500 8L22 17l-8-1-2 5-2-5-8 1 7.500-6z"/></g>`,

  hub: `<g ${stroke}><path d="M4 20h16"/><path d="M5 20v-6a7 7 0 0114 0v6"/><path d="M12 3v4"/></g>`,
  depot: `<g ${stroke}><rect x="4" y="8" width="16" height="12" rx="1.500"/><path d="M4 12h16M9 5h6"/></g>`,
  barracks: `<g ${stroke}><path d="M3 20h18"/><path d="M4 20V9l8-4 8 4v11"/><path d="M10 20v-6h4v6"/></g>`,
  refinery: `<g ${stroke}><rect x="5" y="9" width="9" height="11" rx="2"/><path d="M14 14h5v6"/><path d="M9.500 3c2 2-1.500 3-0 6"/></g>`,
  factory: `<g ${stroke}><path d="M3 20h18V9l-5 3V9l-5 3V9L3 12z"/><path d="M17 20V5h3v15"/></g>`,
  airfield: `<g ${stroke}><circle cx="12" cy="13" r="7"/><path d="M12 7v12M7 13h10"/></g>`,
  turret: `<g ${stroke}><path d="M5 20h14l-2-6H7z"/><rect x="8" y="8" width="8" height="6" rx="1.500"/><path d="M16 11h5"/></g>`,

  minerals: `<path ${solid} d="M12 2l6 7-6 13L6 9z" opacity=".95"/><path d="M6 9h12L12 2z" fill="#fff" opacity=".35"/>`,
  gas: `<path ${solid} d="M12 2c4 5 7 8 7 12a7 7 0 01-14 0c0-4 3-7 7-12z"/>`,
  supply: `<g ${stroke}><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0112 0"/><circle cx="17" cy="9" r="2.200"/><path d="M16 14a5 5 0 015 5"/></g>`,
  army: `<g ${stroke}><path d="M5 19L18 6M6 6l13 13"/><path d="M3 21l3-3M21 21l-3-3"/></g>`,
  geyser: `<path ${solid} d="M12 2c4 5 7 8 7 12a7 7 0 01-14 0c0-4 3-7 7-12z"/>`,
  idle: `<g ${stroke}><circle cx="12" cy="12" r="9"/><path d="M8 9h5l-5 6h5"/></g>`,
  pause: `<path ${solid} d="M7 4h3.500v16H7zM13.500 4H17v16h-3.500z"/>`,
  play: `<path ${solid} d="M7 4l13 8-13 8z"/>`,
  fast: `<path ${solid} d="M3 5l8 7-8 7zM12 5l8 7-8 7z"/>`,
  menu: `<g ${stroke}><path d="M4 7h16M4 12h16M4 17h16"/></g>`,
  clock: `<g ${stroke}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></g>`,
};

/** The SVG markup of an icon (an empty box if the name is unknown). */
export function icon(name: string, className = 'icon'): string {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${PATHS[name] ?? ''}</svg>`;
}
