/** What the shop needs to draw a knife: plain data, so this layer never touches the simulation. */
export interface SkinPreviewData {
  bladeColor: string;
  edgeColor: string;
  handleColor: string;
  accentColor: string;
  trailColor: string;
  glowColor: string;
  trailWidth: number;
  /** Blade outline in a 100 x 28 box, tip at x = 100. */
  outline: readonly (readonly [number, number])[];
}

const SVG = 'http://www.w3.org/2000/svg';

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** A knife with its glowing trail, as an inline SVG. */
export function skinPreview(skin: SkinPreviewData): SVGSVGElement {
  const svg = svgEl('svg', { viewBox: '0 0 180 60', class: 'skin-preview', 'aria-hidden': 'true', focusable: 'false' });

  // The trail: a slash coming in from the left, glow first.
  const slash = { x1: 6, y1: 48, x2: 120, y2: 24, 'stroke-linecap': 'round', fill: 'none' };
  svg.append(svgEl('line', { ...slash, stroke: skin.glowColor, 'stroke-opacity': 0.18, 'stroke-width': skin.trailWidth * 5 }));
  svg.append(svgEl('line', { ...slash, stroke: skin.glowColor, 'stroke-opacity': 0.4, 'stroke-width': skin.trailWidth * 2.4 }));
  svg.append(svgEl('line', { ...slash, stroke: skin.trailColor, 'stroke-width': skin.trailWidth }));

  // The knife, tip at the end of the slash, angled along it.
  const angle = (Math.atan2(24 - 48, 120 - 6) * 180) / Math.PI;
  const group = svgEl('g', { transform: `translate(120 24) rotate(${angle}) scale(0.85) translate(-100 -14)` });
  group.append(svgEl('rect', { x: -38, y: 6, width: 38, height: 16, rx: 3, fill: skin.handleColor }));
  group.append(svgEl('rect', { x: -10, y: 6, width: 7, height: 16, fill: skin.accentColor }));
  group.append(
    svgEl('polygon', {
      points: skin.outline.map(([x, y]) => `${x},${y}`).join(' '),
      fill: skin.bladeColor,
      stroke: skin.edgeColor,
      'stroke-width': 1.4,
      'stroke-linejoin': 'round',
    }),
  );
  group.append(svgEl('line', { x1: 4, y1: 23, x2: 88, y2: 23, stroke: skin.edgeColor, 'stroke-width': 1.6, 'stroke-opacity': 0.9 }));
  svg.append(group);
  return svg;
}
