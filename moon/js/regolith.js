/* Statistical lunar soil: quiet powder patches, embedded angular fragments and clumped aggregates.
 * Shapes are procedural, not a site-specific scan. All relief heights below are millimetres.
 */
import * as THREE from 'three';
import { hash2, pfbm, pnoise } from './noise.js';

export const REGOLITH_TILE_M = 4;

export function makeRegolithTextures(quality = 'high') {
  const size = quality === 'high' ? 2048 : 1024;
  const mmPerPixel = REGOLITH_TILE_M * 1000 / size;
  const height = new Float32Array(size * size);
  const tone = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size, k = y * size + x;
    // A continuous powder matrix; no evenly spaced circular pits.
    height[k] = 0.30 * pfbm(u, v, 32, 4, 911) + 0.09 * (hash2(x, y, 77) - 0.5);
    tone[k] = 0.50 + 0.018 * pfbm(u, v, 12, 3, 151);
  }
  const density = (u, v) => {
    const patch = pnoise(u * 5, v * 5, 5, 843);
    const t = Math.max(0, Math.min(1, (patch - 0.27) / 0.47));
    return 0.06 + 0.94 * t * t * (3 - 2 * t);
  };
  const stamp = (i, seed, radiusMin, radiusMax, amplitude, presence) => {
    const u = hash2(i, seed, 1), v = hash2(i, seed, 2);
    if (hash2(i, seed, 3) > presence * density(u, v)) return;
    const r = radiusMin + (radiusMax - radiusMin) * Math.pow(hash2(i, seed, 4), 2.0);
    const rx = r * (0.65 + 0.70 * hash2(i, seed, 5)), rz = r * (0.60 + 0.75 * hash2(i, seed, 6));
    const angle = hash2(i, seed, 7) * Math.PI * 2, ca = Math.cos(angle), sa = Math.sin(angle);
    const phase = hash2(i, seed, 8) * Math.PI * 2;
    const amp = r * amplitude * (0.6 + 0.7 * hash2(i, seed, 9));
    const reach = Math.ceil(Math.max(rx, rz) * 1.3 / mmPerPixel);
    const cx = u * size, cz = v * size;
    const tint = (hash2(i, seed, 10) - 0.5) * 0.036;
    for (let yy = Math.floor(cz) - reach; yy <= cz + reach; yy++) for (let xx = Math.floor(cx) - reach; xx <= cx + reach; xx++) {
      const dx = (xx - cx) * mmPerPixel, dz = (yy - cz) * mmPerPixel;
      const ax = (dx * ca + dz * sa) / rx, az = (-dx * sa + dz * ca) / rz;
      const a = Math.atan2(az, ax);
      const edge = 1 + 0.16 * Math.cos(3 * a + phase) + 0.09 * Math.cos(5 * a - phase);
      const q = Math.hypot(ax, az) / edge;
      if (q >= 1) continue;
      // Broad fracture planes and irregular rims instead of identical round bumps.
      const h = amp * Math.pow(1 - q * q, 1.35);
      const k = ((yy + size) % size) * size + ((xx + size) % size);
      height[k] += h;
      tone[k] += tint * (1 - q);
    }
  };
  for (let i = 0; i < 130000; i++) stamp(i, 733, 1.6, 4.8, 0.30, 0.95);
  for (let i = 0; i < 16000; i++) stamp(i, 301, 4.0, 13.0, 0.23, 0.85);
  for (let i = 0; i < 3800; i++) stamp(i, 401, 11.0, 38.0, 0.22, 0.78);

  const makeCanvas = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const c = makeCanvas(), ctx = c.getContext('2d'), image = ctx.createImageData(size, size);
  const nc = makeCanvas(), nctx = nc.getContext('2d'), normalImage = nctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  let sumSq = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = y * size + x, i = k * 4;
    const l = Math.max(0.40, Math.min(0.60, tone[k]));
    image.data[i] = l * 255 * 1.012;
    image.data[i + 1] = l * 255;
    image.data[i + 2] = l * 255 * 0.985;
    image.data[i + 3] = 255;
    const gx = (at(x + 1, y) - at(x - 1, y)) / (2 * mmPerPixel);
    const gz = (at(x, y + 1) - at(x, y - 1)) / (2 * mmPerPixel);
    sumSq += gx * gx + gz * gz;
    const length = Math.hypot(gx, gz, 1);
    normalImage.data[i] = (0.5 - gx / length * 0.5) * 255;
    normalImage.data[i + 1] = (0.5 - gz / length * 0.5) * 255;
    normalImage.data[i + 2] = (0.5 + 0.5 / length) * 255;
    normalImage.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0); nctx.putImageData(normalImage, 0, 0);
  console.log('[regolith] statistical relief RMS', (Math.atan(Math.sqrt(sumSq / height.length)) * 180 / Math.PI).toFixed(1) + 'deg');
  const albedo = new THREE.CanvasTexture(c), normal = new THREE.CanvasTexture(nc);
  for (const texture of [albedo, normal]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
  }
  albedo.colorSpace = THREE.SRGBColorSpace; normal.colorSpace = THREE.NoColorSpace;
  return { albedo, normal };
}
