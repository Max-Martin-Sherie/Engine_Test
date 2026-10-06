/** Textures made in code: there are no image files in this game. */
import * as THREE from 'three';

function canvas(size: number): { c: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  if (g === null) throw new Error('No 2D canvas for a texture');
  return { c, g };
}

/** A tiny repeatable pseudo-random, so a texture is the same every run. */
function hash(x: number, y: number): number {
  let h = Math.imul(x + 1013, 0x27d4eb2d) ^ Math.imul(y + 7919, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/**
 * One panel of the arena's walls and floor: dark metal with seams and bright corner marks. The bright parts are drawn
 * far lighter than the rest so the material can make just them glow.
 */
export function makeTileTexture(): THREE.CanvasTexture {
  const size = 256;
  const { c, g } = canvas(size);
  g.fillStyle = '#56627f';
  g.fillRect(0, 0, size, size);
  // Brushed grain.
  for (let y = 0; y < size; y += 2) {
    for (let x = 0; x < size; x += 4) {
      const n = hash(x, y);
      g.fillStyle = `rgba(${n > 0.5 ? '255,255,255' : '0,0,0'},${0.025 + n * 0.03})`;
      g.fillRect(x, y, 4, 2);
    }
  }
  // Four panels, each with a seam and a highlight.
  for (const [px, py] of [[0, 0], [128, 0], [0, 128], [128, 128]] as const) {
    g.strokeStyle = '#1d2538';
    g.lineWidth = 5;
    g.strokeRect(px + 2.5, py + 2.5, 123, 123);
    g.strokeStyle = 'rgba(190,215,255,0.32)';
    g.lineWidth = 1;
    g.strokeRect(px + 6.5, py + 6.5, 115, 115);
    // Rivets.
    g.fillStyle = '#7886a6';
    for (const [rx, ry] of [[14, 14], [114, 14], [14, 114], [114, 114]] as const) {
      g.beginPath();
      g.arc(px + rx, py + ry, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
  // The glow: bright L-marks in two corners of the tile and a short bar on each panel.
  g.strokeStyle = '#7fe6ff';
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(22, 40);
  g.lineTo(22, 22);
  g.lineTo(40, 22);
  g.moveTo(size - 22, size - 40);
  g.lineTo(size - 22, size - 22);
  g.lineTo(size - 40, size - 22);
  g.moveTo(150, 64);
  g.lineTo(194, 64);
  g.moveTo(40, 192);
  g.lineTo(80, 192);
  g.stroke();
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** A soft round dot (for muzzle flashes, glows and bullet-hole marks). */
export function makeGlowTexture(): THREE.CanvasTexture {
  const size = 64;
  const { c, g } = canvas(size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** A scorch mark: a dark centre with a faint bright rim. */
export function makeDecalTexture(): THREE.CanvasTexture {
  const size = 64;
  const { c, g } = canvas(size);
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,0.95)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.8)');
  grad.addColorStop(0.62, 'rgba(255,170,90,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
