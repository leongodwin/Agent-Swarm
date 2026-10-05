import * as THREE from 'three';

// Three-step ramp gives the flat, cel-shaded cartoon look.
const ramp = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = THREE.NearestFilter;
ramp.magFilter = THREE.NearestFilter;
ramp.generateMipmaps = false;
ramp.needsUpdate = true;

const cache = new Map<string, THREE.Material>();

export function toon(color: string, opts: { emissive?: string; emissiveIntensity?: number; transparent?: boolean; opacity?: number } = {}) {
  const key = `${color}|${opts.emissive ?? ''}|${opts.emissiveIntensity ?? ''}|${opts.opacity ?? ''}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({
      color,
      gradientMap: ramp,
      emissive: opts.emissive ?? '#000000',
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      transparent: opts.transparent ?? (opts.opacity !== undefined && opts.opacity < 1),
      opacity: opts.opacity ?? 1,
    });
    cache.set(key, m);
  }
  return m;
}

/** A toon material that shows a texture (e.g. the beach ball's stripes), cached by key. */
export function toonMap(key: string, map: THREE.Texture) {
  const k = `map|${key}`;
  let m = cache.get(k);
  if (!m) {
    m = new THREE.MeshToonMaterial({ map, gradientMap: ramp });
    cache.set(k, m);
  }
  return m;
}

export function glow(color: string) {
  const key = `glow|${color}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, toneMapped: false });
    cache.set(key, m);
  }
  return m;
}

/** High-end architectural frosted glass with transmission & refractive blur */
export const glass = new THREE.MeshPhysicalMaterial({
  color: '#e0f2fe',
  transparent: true,
  opacity: 0.35,
  roughness: 0.18,
  metalness: 0.05,
  transmission: 0.75,
  ior: 1.48,
  thickness: 0.08,
  depthWrite: false,
  side: THREE.DoubleSide,
});

/** Polished architectural wood / laminate for modern surfaces */
export function pbrWood(color: string, roughness = 0.32) {
  const key = `pbrWood|${color}|${roughness}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness: 0.02,
    });
    cache.set(key, m);
  }
  return m;
}

/** Brushed aluminum & metal finishes for modern hardware */
export function brushedMetal(color = '#64748b', roughness = 0.28) {
  const key = `metal|${color}|${roughness}`;
  let m = cache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness: 0.82,
    });
    cache.set(key, m);
  }
  return m;
}

/** Lighten (amt > 0) or darken (amt < 0) a hex colour. */
export function shade(hex: string, amt: number) {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + amt)));
  return `#${c.getHexString()}`;
}

/** Blend two hex colours: t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number) {
  return `#${new THREE.Color(a).lerp(new THREE.Color(b), t).getHexString()}`;
}
