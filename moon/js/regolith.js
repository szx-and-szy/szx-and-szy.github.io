/*
 * regolith.js — 程序化月壤贴图（反照率 + 法线）。
 *
 * 高度场用物理单位（毫米）生成，法线直接由 dh/dx 得出，斜率就是真实坡度。
 * 依据：Helfenstein & Shepard (1999) 用 Apollo 近距立体相机反演月壤坡面，
 * RMS 坡度 15–29° @ 0.85 mm、6–24° @ 8.5 mm；LRO Diviner 结论一致。
 * 所以这层不能做成「平滑粉尘」，那是被宇航员脚印压平之后的状态。
 */

import * as THREE from 'three';
import { hash2, pfbm, granule } from './noise.js';

export const REGOLITH_TILE_M = 1.25;

export function makeRegolithTextures() {
  /*
   * 粒径分布不是「细尘 + 稀疏颗粒」：80 wt% < 250 μm，但 20 wt% 粗于 1 mm、
   * 10 wt% 粗于 2 mm——粗碎屑是连续长尾，不是零星点缀。
   */
  const size = 1024;
  const MM_PER_PX = (REGOLITH_TILE_M * 1000) / size;   // 1.22 mm/px

  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);

  const H = new Float32Array(size * size);   // 高度，单位 mm
  const L = new Float32Array(size * size);   // 反照率 0..1

  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const k = y * size + x;

      // 1) 尘埃基底：亚毫米级起伏
      let h = 0.26 * pfbm(u, v, 16, 4, 911);

      // 2) 微陨石撞击的「雨点坑」，直径约 6 mm
      h -= 0.38 * granule(u, v, 210, 1201, 0.55);

      // 3) 碎屑：1–8 mm（占重量约 25%）
      const frag1 = granule(u, v, 150, 733, 0.46);
      const frag2 = granule(u, v, 70, 301, 0.44);
      h += 0.55 * frag1 + 1.15 * frag2;

      // 4) 土块 / 团块：1–5 cm（clods，说明月壤有弱黏聚性）
      const clod = granule(u, v, 24, 401, 0.40);
      h += 2.60 * clod;

      // 5) 逐颗粒噪声（真实颗粒是棱角状的，不是光滑曲面）
      h += 0.20 * (hash2(x, y, 77) - 0.5);

      H[k] = h;

      // 反照率：细尘中灰，碎屑与团块略亮也略暗，整体 ±10%
      const lum = 0.50
        + 0.055 * pfbm(u, v, 16, 4, 911)
        + 0.075 * frag1
        + 0.095 * frag2
        + 0.060 * clod
        + 0.045 * (hash2((x * 0.06) | 0, (y * 0.06) | 0, 5) - 0.5);
      L[k] = lum;
    }
  }

  for (let k = 0; k < size * size; k++) {
    const l = L[k];
    const i = k * 4;
    img.data[i] = Math.max(0, Math.min(255, l * 255 * 1.012));
    img.data[i + 1] = Math.max(0, Math.min(255, l * 255 * 1.0));
    img.data[i + 2] = Math.max(0, Math.min(255, l * 255 * 0.985));
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  const albedo = new THREE.CanvasTexture(c);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.anisotropy = 8;

  const nc = document.createElement('canvas');
  nc.width = nc.height = size;
  const nctx = nc.getContext('2d');
  const nimg = nctx.createImageData(size, size);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  const inv = 1 / (2 * MM_PER_PX);
  let sumSq = 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 斜率直接用毫米除以毫米，得到的就是物理坡度
      const gx = (at(x + 1, y) - at(x - 1, y)) * inv;
      const gy = (at(x, y + 1) - at(x, y - 1)) * inv;
      sumSq += gx * gx + gy * gy;
      const nx = -gx, ny = -gy, nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * size + x) * 4;
      nimg.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  console.log('[regolith] RMS 坡度', (Math.atan(Math.sqrt(sumSq / (size * size))) * 180 / Math.PI).toFixed(1) + '°');

  const normal = new THREE.CanvasTexture(nc);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
  normal.anisotropy = 8;
  normal.colorSpace = THREE.NoColorSpace;

  return { albedo, normal };
}
