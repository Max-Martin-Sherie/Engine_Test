/**
 * Materials, and the fog of war. Fog is a small texture (one texel per map cell) that every material reads: a cell
 * that was never seen draws black, one seen before draws dim, one in sight draws normally. Doing it in the material
 * means rocks, buildings and units darken along with the ground, with no overlay plane to line up.
 */
import * as THREE from 'three';

/** How bright a cell looks: never seen, seen before, in sight. */
const BRIGHTNESS = [0, 0.62, 1] as const;

export interface FogMap {
  readonly texture: THREE.DataTexture;
  /** Sets what to show (the player's vision grid), or `null` to show everything. `snap` skips the fade. */
  set(vision: Uint8Array | null, snap?: boolean): void;
  /** Fades toward the target. */
  update(dt: number): void;
  /** How bright a cell is drawn right now, 0..1 (for tests). */
  valueAt(x: number, y: number): number;
}

export function createFogMap(size: number): FogMap {
  const cells = size * size;
  const target = new Float32Array(cells).fill(1);
  const current = new Float32Array(cells).fill(1);
  const across = new Float32Array(cells);
  const data = new Uint8Array(cells).fill(255);
  const texture = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  let dirty = false;

  /** What is drawn: `current` softened by a small blur, so the edge of what can be seen is not a staircase of cells. */
  function upload(): void {
    for (let y = 0; y < size; y++) {
      const row = y * size;
      for (let x = 0; x < size; x++) {
        const l = current[row + Math.max(0, x - 1)] ?? 1;
        const c = current[row + x] ?? 1;
        const r = current[row + Math.min(size - 1, x + 1)] ?? 1;
        across[row + x] = (l + 2 * c + r) * 0.25;
      }
    }
    for (let y = 0; y < size; y++) {
      const up = Math.max(0, y - 1) * size;
      const here = y * size;
      const down = Math.min(size - 1, y + 1) * size;
      for (let x = 0; x < size; x++) {
        data[here + x] = Math.round(((across[up + x] ?? 1) + 2 * (across[here + x] ?? 1) + (across[down + x] ?? 1)) * 0.25 * 255);
      }
    }
    texture.needsUpdate = true;
  }

  return {
    texture,
    set(vision, snap = false) {
      for (let i = 0; i < cells; i++) {
        const level = vision === null ? 2 : (vision[i] ?? 0);
        target[i] = BRIGHTNESS[level as 0 | 1 | 2] ?? 1;
        if (snap) current[i] = target[i] ?? 1;
      }
      if (snap) upload();
      dirty = true;
    },
    valueAt(x, y) {
      const cx = Math.min(size - 1, Math.max(0, Math.floor(x)));
      const cy = Math.min(size - 1, Math.max(0, Math.floor(y)));
      return (data[cy * size + cx] ?? 255) / 255;
    },

    update(dt) {
      if (!dirty) return;
      const k = 1 - Math.exp(-dt * 8);
      let moving = false;
      for (let i = 0; i < cells; i++) {
        const want = target[i] ?? 1;
        let now = current[i] ?? 1;
        if (now !== want) {
          now += (want - now) * k;
          if (Math.abs(want - now) < 0.004) now = want;
          else moving = true;
          current[i] = now;
        }
      }
      upload();
      if (!moving) dirty = false;
    },
  };
}

export interface Materials {
  /** Shaded, takes its colour from each instance. */
  lit: THREE.MeshLambertMaterial;
  /** Not shaded (lights, glass, crystals), colour per instance. */
  glow: THREE.MeshBasicMaterial;
  /** The ground. */
  ground: THREE.MeshLambertMaterial;
  /** Effects: additive and unshaded. They are only drawn where the player can see, so they skip the fog. */
  spark: THREE.MeshBasicMaterial;
  /** Flat shapes on the ground (selection rings, shadows). */
  flat: THREE.MeshBasicMaterial;
  shadow: THREE.MeshBasicMaterial;
}

/** Makes a material read the fog texture. All of them share one compiled program per kind. */
function withFog(material: THREE.Material, fog: THREE.Texture, mapSize: number): void {
  const uniforms = { fogMap: { value: fog }, mapSize: { value: mapSize } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms['fogMap'] = uniforms.fogMap;
    shader.uniforms['mapSize'] = uniforms.mapSize;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogUv;\nuniform float mapSize;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vec4 fogWorld = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          fogWorld = instanceMatrix * fogWorld;
        #endif
        fogWorld = modelMatrix * fogWorld;
        vFogUv = fogWorld.xz / mapSize;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFogUv;\nuniform sampler2D fogMap;')
      .replace('#include <opaque_fragment>', 'outgoingLight *= texture2D( fogMap, vFogUv ).r;\n#include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => 'nova-fog';
}

export function createMaterials(fog: THREE.Texture, mapSize: number, groundMap: THREE.Texture | null): Materials {
  const lit = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const glow = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const ground = new THREE.MeshLambertMaterial({ color: 0xffffff, map: groundMap });
  withFog(lit, fog, mapSize);
  withFog(glow, fog, mapSize);
  withFog(ground, fog, mapSize);

  const spark = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const flat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, opacity: 0.95 });
  const shadow = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.34, depthWrite: false });
  return { lit, glow, ground, spark, flat, shadow };
}
