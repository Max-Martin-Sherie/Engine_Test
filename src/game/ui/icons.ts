/** Small icons, as inline SVG (static strings, no files). Controls are 24 x 24; guns are 32 x 16. Colour comes from the text. */

const stroke = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const solid = 'fill="currentColor"';

const PATHS: Record<string, string> = {
  fire: `<g ${stroke}><circle cx="12" cy="12" r="6.500"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></g><circle ${solid} cx="12" cy="12" r="1.800"/>`,
  jump: `<g ${stroke}><path d="M6 14l6-6 6 6"/><path d="M6 20l6-6 6 6"/></g>`,
  reload: `<g ${stroke}><path d="M20 12a8 8 0 11-2.400-5.700"/><path d="M20 4v5h-5"/></g>`,
  aim: `<g ${stroke}><circle cx="12" cy="12" r="7.500"/><path d="M12 2v6M12 16v6M2 12h6M16 12h6"/></g>`,
  swap: `<g ${stroke}><path d="M4 8h15"/><path d="M15 4l4 4-4 4"/><path d="M20 16H5"/><path d="M9 12l-4 4 4 4"/></g>`,
  pause: `<path ${solid} d="M7 4h3.500v16H7zM13.500 4H17v16h-3.500z"/>`,
  board: `<g ${stroke}><path d="M5 6h14M5 12h14M5 18h9"/></g>`,
  back: `<g ${stroke}><path d="M15 5l-7 7 7 7"/></g>`,
  rotate: '<rect x="8" y="3" width="8" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M19 8a7 7 0 010 8M20.500 14.500L19 16.500l-2-1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  health: `<path ${solid} d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>`,
  armor: `<path ${solid} d="M12 2.500l8 3v6c0 5.200-3.400 8.800-8 10.500-4.600-1.700-8-5.300-8-10.500v-6z"/>`,
  skull: `<g ${stroke}><path d="M5 11a7 7 0 0114 0v4l-2 1v3h-3v-2h-4v2H7v-3l-2-1z"/><circle cx="9.500" cy="11.500" r="1.200" fill="currentColor"/><circle cx="14.500" cy="11.500" r="1.200" fill="currentColor"/></g>`,

  pistol: `<path ${solid} d="M3 4h20v5h-8v3l-2 4H8l1-7H3z"/>`,
  rifle: `<path ${solid} d="M1 7h14l2-2h9l2 2h3v3h-3v1h-6v3h-3v-3h-6l-1 4H8l1-4H4l-3-1z"/>`,
  shotgun: `<path ${solid} d="M1 7h27v3H20l-2 3h-8l1-3H1zM21 5h6v2h-6z"/>`,
  rail: `<path ${solid} d="M1 6h28v6H1zM6 12h4l1 4H8zM22 3h6v3h-6z"/>`,
  rocket: `<path ${solid} d="M2 4h19v8H2zM21 5l7 3-7 3zM7 12h5l-1 4H8z"/>`,
};

/** The SVG markup of an icon (an empty box if the name is unknown). */
export function icon(name: string, className = 'icon'): string {
  const wide = name === 'pistol' || name === 'rifle' || name === 'shotgun' || name === 'rail' || name === 'rocket';
  return `<svg class="${className}" viewBox="${wide ? '0 0 32 16' : '0 0 24 24'}" aria-hidden="true" focusable="false">${PATHS[name] ?? ''}</svg>`;
}
