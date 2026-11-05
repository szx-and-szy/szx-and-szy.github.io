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
    return 0.30 + 0.70 * t * t * (3 - 2 * t);
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
  for (let i = 0; i < 28000; i++) stamp(i, 301, 4.0, 13.0, 0.23, 0.85);
  for (let i = 0; i < 5200; i++) stamp(i, 401, 11.0, 38.0, 0.22, 0.78);

  // These sparse forms are statistical assumptions, not measured Apollo17 relief.
  // Signed, smoothly joined height gives the matrix between grains actual shallow
  // depressions and low clods; no dark crater shading is painted into albedo.
  const featureCounts = { shallowDepressions: 0, lowClods: 0 };
  const stampMatrix = (i, seed, rMin, rMax, hMin, hMax, sign, presence) => {
    const u = hash2(i, seed, 1), v = hash2(i, seed, 2);
    if (hash2(i, seed, 3) > presence * density(u, v)) return;
    const radius = rMin + (rMax - rMin) * Math.pow(hash2(i, seed, 4), 2);
    const rx = radius * (0.70 + 0.55 * hash2(i, seed, 5));
    const rz = radius * (0.60 + 0.65 * hash2(i, seed, 6));
    const angle = hash2(i, seed, 7) * Math.PI * 2, ca = Math.cos(angle), sa = Math.sin(angle);
    const phase = hash2(i, seed, 8) * Math.PI * 2;
    const amplitude = hMin + (hMax - hMin) * Math.pow(hash2(i, seed, 9), 2.2);
    const reach = Math.ceil(Math.max(rx, rz) * 1.30 / mmPerPixel);
    const cx = u * size, cz = v * size;
    for (let yy = Math.floor(cz) - reach; yy <= cz + reach; yy++) for (let xx = Math.floor(cx) - reach; xx <= cx + reach; xx++) {
      const dx = (xx - cx) * mmPerPixel, dz = (yy - cz) * mmPerPixel;
      const ax = (dx * ca + dz * sa) / rx, az = (-dx * sa + dz * ca) / rz;
      const a = Math.atan2(az, ax);
      const edge = 1 + 0.17 * Math.cos(3 * a + phase) + 0.08 * Math.sin(5 * a - phase);
      const q = Math.hypot(ax, az) / edge;
      if (q >= 1) continue;
      const profile = Math.pow(1 - q * q, sign < 0 ? 2 : 1.6);
      const k = ((yy + size) % size) * size + ((xx + size) % size);
      height[k] += sign * amplitude * profile;
    }
    featureCounts[sign < 0 ? 'shallowDepressions' : 'lowClods']++;
  };
  for (let i = 0; i < 64; i++) stampMatrix(i, 1103, 80, 380, 3, 25, -1, 0.78);
  for (let i = 0; i < 160; i++) stampMatrix(i, 1229, 30, 150, 3, 20, 1, 0.68);

  let heightMin = Infinity, heightMax = -Infinity, heightSum = 0, heightSumSq = 0;
  for (const h of height) {
    heightMin = Math.min(heightMin, h); heightMax = Math.max(heightMax, h);
    heightSum += h; heightSumSq += h * h;
  }
  const heightSpan = Math.max(1e-9, heightMax - heightMin);
  const makeCanvas = (width = size) => { const c = document.createElement('canvas'); c.width = c.height = width; return c; };
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

  // RG16 stores a normalized unsigned height, high byte first. Each mip is
  // averaged in Float32 height before encoding: automatic RG8 mip rounding can
  // lose a carry between the bytes and create false slopes on an otherwise flat patch.
  const reliefMips = [];
  let mipHeight = height, mipSize = size;
  do {
    const canvas = makeCanvas(mipSize), context = canvas.getContext('2d');
    const pixels = context.createImageData(mipSize, mipSize);
    for (let k = 0; k < mipHeight.length; k++) {
      const code = Math.max(0, Math.min(65535, Math.round((mipHeight[k] - heightMin) / heightSpan * 65535)));
      pixels.data[k * 4] = code >>> 8;
      pixels.data[k * 4 + 1] = code & 255;
      pixels.data[k * 4 + 2] = 0;
      pixels.data[k * 4 + 3] = 255;
    }
    context.putImageData(pixels, 0, 0); reliefMips.push(canvas);
    if (mipSize === 1) break;
    const nextSize = mipSize / 2, next = new Float32Array(nextSize * nextSize);
    for (let y = 0; y < nextSize; y++) for (let x = 0; x < nextSize; x++) {
      const k = y * 2 * mipSize + x * 2;
      next[y * nextSize + x] = (mipHeight[k] + mipHeight[k + 1] + mipHeight[k + mipSize] + mipHeight[k + mipSize + 1]) * 0.25;
    }
    mipHeight = next; mipSize = nextSize;
  } while (true);

  const albedo = new THREE.CanvasTexture(c), normal = new THREE.CanvasTexture(nc);
  const relief = new THREE.CanvasTexture(reliefMips[0]);
  relief.mipmaps = reliefMips;
  relief.generateMipmaps = false;
  relief.minFilter = THREE.LinearMipmapLinearFilter;
  relief.magFilter = THREE.LinearFilter;
  for (const texture of [albedo, normal, relief]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
  }
  albedo.colorSpace = THREE.SRGBColorSpace;
  normal.colorSpace = relief.colorSpace = THREE.NoColorSpace;
  const mean = heightSum / height.length;
  const stats = {
    provenance: 'Procedural statistical assumptions; not an Apollo17 height measurement',
    width: size, height: size, tileSizeM: REGOLITH_TILE_M,
    heightMinM: heightMin / 1000, heightMaxM: heightMax / 1000,
    heightMeanM: mean / 1000,
    heightRmsAboutMeanM: Math.sqrt(Math.max(0, heightSumSq / height.length - mean * mean)) / 1000,
    slopeRmsDeg: Math.atan(Math.sqrt(sumSq / height.length)) * 180 / Math.PI,
    slopeSampleSpacingM: mmPerPixel / 1000,
    featureCounts,
    assumedDepressionRadiusM: [0.08, 0.38], assumedDepressionDepthM: [0.003, 0.025],
    assumedClodRadiusM: [0.03, 0.15], assumedClodHeightM: [0.003, 0.020],
    reliefEncoding: 'RG16 high/low bytes; normalized=(r*65280+g*255)/65535; B0,A255',
    quantizationStepM: heightSpan / 65535 / 1000, mipLevels: reliefMips.length,
    mipPolicy: '2x2 Float32 height averages encoded per level with the same global height range',
  };
  console.log('[regolith] statistical relief', stats);
  return { albedo, normal, relief, heightRange: [heightMin / 1000, heightMax / 1000], texelSizeM: mmPerPixel / 1000, stats };
}
