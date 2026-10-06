/**
 * The arena as geometry: a floor, every block as one instance of a unit box, and a sky. The material gives every
 * surface the same panel texture at the same size (looked up by world position on the three axes), so a one-metre
 * crate and a long wall both look right without any texture coordinates.
 */
import * as THREE from 'three';
import { ARENA } from '../sim/config';
import type { Arena } from '../sim';
import { COLORS } from './palette';

/** A lit material with the panel texture mapped in world space, its bright marks glowing, and the lower metre darkened. */
export function createPanelMaterial(tile: THREE.Texture, tint: number): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color: tint });
  material.onBeforeCompile = (shader) => {
    shader.uniforms['tile'] = { value: tile };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vec4 wp = vec4( transformed, 1.0 );
        vec3 wn = normal;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
          wn = mat3( instanceMatrix ) * wn;
        #endif
        wp = modelMatrix * wp;
        vWorldPos = wp.xyz;
        vWorldNormal = normalize( mat3( modelMatrix ) * wn );`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tile;\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;')
      .replace(
        '#include <map_fragment>',
        `vec3 an = abs( normalize( vWorldNormal ) );
        an = pow( an, vec3( 8.0 ) );
        an /= ( an.x + an.y + an.z );
        vec3 tx = texture2D( tile, vWorldPos.zy * 0.5 ).rgb;
        vec3 ty = texture2D( tile, vWorldPos.xz * 0.5 ).rgb;
        vec3 tz = texture2D( tile, vWorldPos.xy * 0.5 ).rgb;
        vec3 texel = tx * an.x + ty * an.y + tz * an.z;
        // Darker toward the ground on the sides, like soot and ambient occlusion.
        float low = mix( 1.0, 0.7 + 0.3 * smoothstep( 0.0, 1.2, vWorldPos.y ), 1.0 - an.y );
        diffuseColor.rgb *= texel * low;
        // The bright marks glow.
        totalEmissiveRadiance += max( texel - vec3( 0.62 ), vec3( 0.0 ) ) * vec3( 1.8, 2.8, 3.2 ) * low;`,
      );
  };
  material.customProgramCacheKey = () => 'arena-panels';
  return material;
}

export interface ArenaMesh {
  group: THREE.Group;
  dispose(): void;
}

const tintFor = (h: number): number => (h >= 3 ? COLORS.wall : h > 1.05 ? COLORS.step : h > 0.55 ? COLORS.crate : COLORS.step);

export function buildArena(arena: Arena, tile: THREE.Texture): ArenaMesh {
  const group = new THREE.Group();
  const size = arena.size;

  const floorMaterial = createPanelMaterial(tile, COLORS.floor);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(size / 2, 0, size / 2);
  group.add(floor);

  const blockMaterial = createPanelMaterial(tile, 0xffffff);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const blocks = new THREE.InstancedMesh(geometry, blockMaterial, Math.max(1, arena.rects.length));
  const matrix = new THREE.Matrix4();
  const color = new THREE.Color();
  arena.rects.forEach((r, i) => {
    matrix.compose(new THREE.Vector3(r.x + r.w / 2, r.h / 2, r.z + r.d / 2), new THREE.Quaternion(), new THREE.Vector3(r.w, r.h, r.d));
    blocks.setMatrixAt(i, matrix);
    // The outer wall a little darker so the playing area reads as the lit part.
    const outer = r.x === 0 || r.z === 0 || r.x + r.w === size || r.z + r.d === size;
    color.setHex(tintFor(r.h)).multiplyScalar(outer && r.h >= ARENA.wall ? 0.7 : 1);
    blocks.setColorAt(i, color);
  });
  blocks.count = arena.rects.length;
  blocks.instanceMatrix.needsUpdate = true;
  if (blocks.instanceColor !== null) blocks.instanceColor.needsUpdate = true;
  blocks.frustumCulled = false;
  group.add(blocks);

  return {
    group,
    dispose() {
      floor.geometry.dispose();
      floorMaterial.dispose();
      geometry.dispose();
      blockMaterial.dispose();
      blocks.dispose();
    },
  };
}

/** A dome of colour from deep blue overhead to a hazy glow at the horizon. It follows the camera. */
export function makeSky(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(140, 24, 14);
  const position = geometry.attributes['position'];
  const colors: number[] = [];
  const top = new THREE.Color(COLORS.skyTop);
  const mid = new THREE.Color(COLORS.skyMid);
  const horizon = new THREE.Color(COLORS.skyHorizon);
  const c = new THREE.Color();
  for (let i = 0; i < (position?.count ?? 0); i++) {
    const y = (position?.getY(i) ?? 0) / 140;
    if (y > 0.25) c.copy(mid).lerp(top, Math.min(1, (y - 0.25) / 0.6));
    else c.copy(horizon).lerp(mid, Math.max(0, y + 0.1) / 0.35);
    colors.push(c.r, c.g, c.b);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  return sky;
}
