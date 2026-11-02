/*
 * terrain.js — 陶拉斯-利特罗谷的程序化月面
 *
 * 真实数据 / 近似数据的边界，写在最前面，避免后面说不清：
 *  真实：站点经纬度、谷底地形统计特征（坡度中位数 <5°、谷底比山体低约 2 km）、
 *        主要山体的方位与高差（南 Massif 约 +2.3 km、北 Massif 约 +2.2 km）、
 *        月壤反照率量级（0.11–0.14）、无大气导致的绝对硬阴影
 *  近似：地形是程序化生成的，不是 LRO 高程栅格；环坑的位置与直径取自阿波罗 17 号
 *        地质图上的已知环坑（Camelot / Shorty / Van Serg / Sherlock 等），但中心点
 *        做了约 100 m 量级的取整。若要完全写实，需要接入 LRO NAC DEM，本文件不加载。
 */

import * as THREE from 'three';
import { ConvexGeometry } from '../vendor/geometries/ConvexGeometry.js';

/* ---------------- 噪声 ---------------- */

function hash2(i, j, seed) {
  let n = (i | 0) * 374761393 + (j | 0) * 668265263 + (seed | 0) * 1274126177;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967296;
}

function smooth(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = smooth(xf), v = smooth(zf);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** 有符号分形噪声，返回约 -1..1 */
function fbm(x, z, octaves, seed) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise(x * f, z * f, seed + o * 17) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/* ---------------- 环坑 ---------------- */

const CRATER_CELL = 160; // m
const craterCache = new Map();

function cellCraters(cx, cz) {
  const key = cx + ',' + cz;
  let list = craterCache.get(key);
  if (list) return list;

  list = [];
  const n = hash2(cx, cz, 7) < 0.55 ? 2 : 1;
  for (let k = 0; k < n; k++) {
    const rx = hash2(cx, cz, 31 + k * 7);
    const rz = hash2(cx, cz, 53 + k * 7);
    const rr = hash2(cx, cz, 71 + k * 7);
    // 半径 2–20 m，偏向小的
    const radius = 2 + 18 * Math.pow(rr, 2.6);
    list.push({
      x: cx * CRATER_CELL + rx * CRATER_CELL,
      z: cz * CRATER_CELL + rz * CRATER_CELL,
      r: radius,
    });
  }
  craterCache.set(key, list);
  return list;
}

/** 几个有名字的真实环坑（阿波罗 17 号地质图，位置取整到 100 m） */
const NAMED_CRATERS = [
  { name: 'Camelot', x: -200, z: 1500, r: 305 },
  { name: 'Shorty', x: 1900, z: 100, r: 55 },
  { name: 'Van Serg', x: 2600, z: 500, r: 45 },
  { name: 'Sherlock', x: 1800, z: 1500, r: 90 },
  { name: 'Cochise', x: 900, z: -900, r: 200 },
  { name: 'Steno', x: -4000, z: 2000, r: 100 },
  { name: 'Henry', x: 700, z: 600, r: 50 },
  { name: 'Shakespeare', x: 1200, z: 2400, r: 200 },
  { name: 'Brontë', x: -1500, z: -2200, r: 150 },
];

function craterProfile(dx, dz, r0) {
  const r = Math.hypot(dx, dz) / r0;
  if (r > 2.4) return 0;
  const depth = r0 * 0.19;          // 深径比约 0.19（月面新鲜小坑偏深）
  const rimH = r0 * 0.055;

  let h = 0;
  if (r < 1) h += -depth * (1 - r * r);
  h += rimH * Math.exp(-Math.pow((r - 1) / 0.3, 2));
  if (r > 1) h += rimH * 0.35 * Math.exp(-(r - 1) / 1.1);
  return h;
}

const MID_CELL = 350; // m，负责 10–55 m 的中尺度环坑，填充中景
const midCache = new Map();

function midCellCraters(cx, cz) {
  const key = 'm' + cx + ',' + cz;
  let list = midCache.get(key);
  if (list) return list;

  list = [];
  if (hash2(cx, cz, 311) < 0.92) {
    const n = 2;
    for (let k = 0; k < n; k++) {
      const rx = hash2(cx, cz, 317 + k * 11);
      const rz = hash2(cx, cz, 331 + k * 11);
      const rr = hash2(cx, cz, 347 + k * 11);
      const radius = 10 + 45 * Math.pow(rr, 1.8);
      list.push({
        x: cx * MID_CELL + rx * MID_CELL,
        z: cz * MID_CELL + rz * MID_CELL,
        r: radius,
      });
    }
  }
  midCache.set(key, list);
  return list;
}

function cratersAt(x, z) {
  let h = 0;
  const cx = Math.floor(x / CRATER_CELL);
  const cz = Math.floor(z / CRATER_CELL);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const c of cellCraters(cx + i, cz + j)) {
        h += craterProfile(x - c.x, z - c.z, c.r);
      }
    }
  }

  const mx = Math.floor(x / MID_CELL), mz = Math.floor(z / MID_CELL);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const c of midCellCraters(mx + i, mz + j)) {
        h += craterProfile(x - c.x, z - c.z, c.r);
      }
    }
  }
  for (const c of NAMED_CRATERS) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < c.r * 2.4) h += craterProfile(x - c.x, z - c.z, c.r);
  }
  return h;
}

/* ---------------- 山体 ---------------- */

/**
 * 各山体用旋转各向异性高斯近似。数值取自阿波罗 17 号轨道照片与地形图：
 * 南 Massif 距着陆点约 7.2 km、高出谷底约 2.3 km；北 Massif 约 4.6 km、2.2 km。
 */
const MASSIFS = [
  { x: 4200, z: -5600, sx: 2700, sz: 2100, amp: 2300, rot: -0.55, seed: 101 },
  { x: -500, z: 4400, sx: 2200, sz: 1700, amp: 2200, rot: 0.25, seed: 211 },
  { x: 10200, z: 1600, sx: 3400, sz: 4200, amp: 1420, rot: 0.9, seed: 307 }, // 东侧 East Massif：推远抬高比，使山脊仰角低于太阳高度
  { x: 3600, z: 4300, sx: 2500, sz: 2000, amp: 950, rot: -0.3, seed: 401 },
  { x: -6800, z: 2600, sx: 3000, sz: 2400, amp: 700, rot: 0.1, seed: 503 }, // 西侧远山
];

function massifH(x, z) {
  let h = 0;
  for (const m of MASSIFS) {
    const dx = x - m.x, dz = z - m.z;
    const c = Math.cos(m.rot), s = Math.sin(m.rot);
    const u = (dx * c + dz * s) / m.sx;
    const v = (-dx * s + dz * c) / m.sz;
    const g = Math.exp(-(u * u + v * v));
    if (g < 0.004) continue;
    // 两层扰动：900 m 定山形，260 m 给沟壑与破碎感（原来只有一层，山体像光滑沙丘）
    // 两层扰动：900 m 定山形，260 m 给沟壑与破碎感（原来只有一层，山体像光滑沙丘）
    const rough = 1 + 0.35 * fbm(x / 900, z / 900, 3, m.seed)
                  + 0.13 * fbm(x / 260, z / 260, 3, m.seed + 7);
    h += m.amp * g * rough;
  }
  // 谷底向西北开口通马雷，压低远处
  return h;
}

/* ---------------- 总高程 ---------------- */

export function heightAt(x, z) {
  let h = 0;

  // 谷底缓起伏：振幅约 ±7 m，对应坡度中位数 2–3°
  h += 3.8 * fbm(x / 430, z / 430, 4, 11);
  h += 1.4 * fbm(x / 68, z / 68, 3, 23);
  h += 0.22 * fbm(x / 11, z / 11, 3, 37);
  h += 0.06 * fbm(x / 4, z / 4, 2, 61);

  h += cratersAt(x, z);

  // 微型坑：半径远小于胞宽，只看所在胞
  for (const c of fineCellCraters(Math.floor(x / FINE_CELL), Math.floor(z / FINE_CELL))) {
    h += craterProfile(x - c.x, z - c.z, c.r) * 0.75;
  }

  h += massifH(x, z);

  return h;
}

/* ---------------- 贴图 ---------------- */

/**
 * 周期值噪声：格点索引按 period 取模，保证 x ∈ [0, period) 时首尾相接。
 * 普通 valueNoise 在贴图边缘会断，平铺就出现接缝。
 */
function pnoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = smooth(xf), v = smooth(yf);
  const w = (i) => ((i % period) + period) % period;
  const x0 = w(xi), x1 = w(xi + 1), y0 = w(yi), y1 = w(yi + 1);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** 周期分形噪声，(u,v) ∈ [0,1)，返回约 -1..1 */
function pfbm(u, v, base, oct, seed) {
  let sum = 0, amp = 1, norm = 0, per = base;
  for (let o = 0; o < oct; o++) {
    sum += (pnoise(u * per, v * per, per, seed + o * 17) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    per *= 2;
  }
  return sum / norm;
}

/**
 * Worley 元胞噪声。月壤的表面不是连续起伏的云，而是一颗颗离散的颗粒和土块，
 * fbm 做不出这种东西。每个胞放一个特征点，取到最近点的距离做圆润凸起，
 * 半径按胞随机 => 大小不一的颗粒；胞索引取模 => 可无缝平铺。
 */
const _W = { f1: 0, id: 0 };
function worley(x, y, cells, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const wc = (i) => ((i % cells) + cells) % cells;
  let f1 = 9, id = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const wx = wc(cx), wy = wc(cy);
      const px = cx + hash2(wx, wy, seed);
      const py = cy + hash2(wx, wy, seed + 91);
      const ddx = x - px, ddy = y - py;
      const d = Math.sqrt(ddx * ddx + ddy * ddy);
      if (d < f1) { f1 = d; id = hash2(wx, wy, seed + 173); }
    }
  }
  _W.f1 = f1; _W.id = id;
}

/** 单层颗粒高度：0 = 基质平面，1 = 颗粒顶 */
function granule(u, v, cells, seed, cover) {
  worley(u * cells, v * cells, cells, seed);
  const r = cover * (0.45 + 0.55 * _W.id);
  if (_W.f1 >= r) return 0;
  const t = 1 - _W.f1 / r;
  return t * t * (3 - 2 * t);
}


function makeTextures() {
  /*
   * 高度场用**物理单位（毫米）**生成，法线直接由 dh/dx 得出（斜率 = 真实坡度）。
   * 这样法线强度就不是「调出来好看」的，而是可以对上实测值：
   *
   *  Helfenstein & Shepard (1999) 用 Apollo 近距立体相机（ALSCC）反演月壤坡面：
   *    RMS 坡度 15–29° @ 0.85 mm 尺度，6–24° @ 8.5 mm 尺度
   *  LRO Diviner 的结论一致：未扰动月壤在毫米–厘米尺度是 "visibly rough, hummocky"，
   *  有大量 clods / clumps；宇航员脚印把表面压平到毫米级，反向印证了这一点。
   *
   * 所以这层不能做成「平滑粉尘」，那是被脚印压过之后的状态。
   * 粒径分布也不是「细尘 + 稀疏颗粒」：80 wt% < 250 μm，但 20 wt% 粗于 1 mm、
   * 10 wt% 粗于 2 mm——粗碎屑是连续长尾，不是零星点缀。
   */
  const size = 1024;
  const TILE_M = 1.25;
  const MM_PER_PX = (TILE_M * 1000) / size;   // 1.22 mm/px

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
      let lum = 0.50
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
    img.data[i] = Math.max(0, Math.min(255, l * 255 * 1.035));
    img.data[i + 1] = Math.max(0, Math.min(255, l * 255 * 1.0));
    img.data[i + 2] = Math.max(0, Math.min(255, l * 255 * 0.945));
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

/* ---------------- 近场微型坑 ----------------
 *
 * 真实月面在 0.3–3 m 这个尺度上密度很高（撞击 gardening 的产物），
 * 而上一层最小只有 2–20 m 的坑，脚下基本是平的。
 * 半径远小于胞宽，所以只查所在的那一个胞，不必像大坑那样查 3×3。
 */

const FINE_CELL = 14; // m
const fineCache = new Map();

function fineCellCraters(cx, cz) {
  const key = 'f' + cx + ',' + cz;
  let list = fineCache.get(key);
  if (list) return list;
  list = [];
  for (let k = 0; k < 2; k++) {
    const rx = hash2(cx, cz, 601 + k * 13);
    const rz = hash2(cx, cz, 617 + k * 13);
    const rr = hash2(cx, cz, 631 + k * 13);
    list.push({
      x: cx * FINE_CELL + rx * FINE_CELL,
      z: cz * FINE_CELL + rz * FINE_CELL,
      r: 0.30 + 2.10 * Math.pow(rr, 1.5),
    });
  }
  fineCache.set(key, list);
  return list;
}

/* ---------------- 网格 ---------------- */

function vertexColorFor(h, x, z, out) {
  // 谷底偏暗（玄武岩质月壤），山体偏高地向亮灰（高地斜长岩质）
  const t = Math.min(1, Math.max(0, (h + 60) / 900));
  // 大尺度反照率起伏：月面从来不是均匀一片灰
  const patch = 0.95 + 0.12 * fbm(x / 130, z / 130, 3, 71) + 0.05 * fbm(x / 26, z / 26, 2, 83);
  const v = (0.52 + 0.10 * t) * patch;
  out[0] = v * 1.02;
  out[1] = v;
  out[2] = v * 0.96;
}


/** 坡度压暗：法线越偏垂直处越接近裸露基岩，反照率低一档 */
function applySlopeShade(g) {
  const n = g.attributes.normal, c = g.attributes.color;
  for (let i = 0; i < n.count; i++) {
    const ny = Math.abs(n.getY(i));
    const k = 1 - 0.52 * Math.pow(1 - ny, 0.75);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k * 0.97);
  }
  c.needsUpdate = true;
}

function buildSquare(size, seg, cx, cz, uvScale) {
  const n = seg + 1;
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  const col = new Float32Array(n * n * 3);
  const step = size / seg;
  const c = [0, 0, 0];

  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const x = cx - size / 2 + i * step;
      const z = cz - size / 2 + j * step;
      const h = heightAt(x, z);
      pos[k * 3] = x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = z;
      uv[k * 2] = x * uvScale;
      uv[k * 2 + 1] = z * uvScale;
      vertexColorFor(h, x, z, c);
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
    }
  }

  const idx = [];
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * n + i, b = a + 1, cIdx = a + n, d = cIdx + 1;
      idx.push(a, cIdx, b, b, cIdx, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  applySlopeShade(g);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

function buildDisc(r0, r1, nr, na, cx, cz, uvScale, yOffset) {
  const nAng = na + 1;
  const count = (nr + 1) * nAng;
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const col = new Float32Array(count * 3);
  const c = [0, 0, 0];

  for (let j = 0; j <= nr; j++) {
    const t = j / nr;
    const r = r0 * Math.pow(r1 / r0, t);
    for (let i = 0; i <= na; i++) {
      const k = j * nAng + i;
      const th = (i / na) * Math.PI * 2;
      const x = Math.cos(th) * r;
      const z = Math.sin(th) * r;
      const h = heightAt(cx + x, cz + z) + yOffset;
      pos[k * 3] = cx + x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = cz + z;
      uv[k * 2] = x * uvScale;
      uv[k * 2 + 1] = z * uvScale;
      vertexColorFor(h, x, z, c);
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
    }
  }

  const idx = [];
  for (let j = 0; j < nr; j++) {
    for (let i = 0; i < na; i++) {
      const a = j * nAng + i, b = a + 1, cIdx = a + nAng, d = cIdx + 1;
      // 环状网格的绕序与方格相反，否则法线朝下、整片地形不发亮
      idx.push(a, b, cIdx, b, d, cIdx);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  applySlopeShade(g);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/* ---------------- 对外接口 ---------------- */

export function createTerrain({ quality = 'high', sunDir = new THREE.Vector3(0, 0.24, -1) } = {}) {
  const tex = makeTextures();
  const material = new THREE.MeshStandardMaterial({
    map: tex.albedo,
    normalMap: tex.normal,
    normalScale: new THREE.Vector2(1.0, 1.0),
    vertexColors: true,
    roughness: 0.98,
    metalness: 0.0,
  });

  /*
   * 月壤不是朗伯体。这是这一版最关键的改动。
   *
   * 阿波罗照片里月面有个反直觉的特点：斜视远处的地面反而更亮，正对镜头的地面偏暗。
   * 用 Lambert 永远做不出来——Lambert 只和入射角有关，和你从哪个角度看无关。
   * 真实的月壤是强后向散射介质，NASA JPL 的月面巡视器仿真、ESA 的月壤材质项目
   * 都改用 Hapke 模型（1981 形式）：
   *
   *   f_r = w/(4π) · 1/(μ0+μ) · { [1+B(g)]·P(g) + H(μ0)H(μ) − 1 }
   *
   *   μ0 = cos(入射角)   μ = cos(出射角)   g = 相位角
   *   H(μ) = (1+2μ)/(1+2γμ),  γ = √(1−w)        Chandrasekhar 函数，管多次散射
   *   P(g) = (4π/5)[ (sin g + (π−g)cos g)/π + (1−cos g)²/10 ]   单粒子相函数
   *   B(g) = B0[1 − (tan|g|/2h)(3−e^{−h/tan|g|})(1−e^{−h/tan|g|})]   冲效应（相干后向散射）
   *
   * 1/(μ0+μ) 就是 Lommel-Seeliger 项，它让掠射方向变亮，正是照片里地平线一带发白的原因。
   * 这一步不做，再怎么加贴图细节都像涂了漆的石膏。
   */
  const HAPKE_W = 0.32;   // 月壤单次散射反照率（Hapke 2012 综述取值）
  const HAPKE_H = 0.06;   // 冲效应角宽参数，月壤典型值
  const hapkeNorm = (() => {
    const P0 = (4 * Math.PI / 5);
    const gam = Math.sqrt(1 - HAPKE_W);
    const H1 = 3 / (1 + 2 * gam);
    return Math.PI * (HAPKE_W / (4 * Math.PI)) / 2 * (2 * P0 + H1 * H1 - 1);
  })();

  const sunU = { value: sunDir.clone().normalize() };
  const normU = { value: hapkeNorm };

  const detailOn = !/detail=0/.test(location.search);

  const COMMON_GLSL = `#include <common>
varying vec3 vWPos;
uniform vec3 uSunDir;
uniform float uHapkeNorm;
uniform float uHapkeW;
uniform float uHapkeH;
uniform float uGainMax;

float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i + vec3(0.0, 0.0, 0.0)), hash31(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash31(i + vec3(0.0, 1.0, 0.0)), hash31(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0.0, 0.0, 1.0)), hash31(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash31(i + vec3(0.0, 1.0, 1.0)), hash31(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

// 三层就够，逐像素 hash 是实打实的成本
float fbm3(vec3 p) {
  return vnoise3(p) * 0.5 + vnoise3(p * 2.03) * 0.25 + vnoise3(p * 4.07) * 0.125;
}

float fbm2(vec3 p) {
  return vnoise3(p) * 0.66 + vnoise3(p * 2.11) * 0.34;
}

float hapkeP(float g) {
  float s = sin(g), c = cos(g);
  float t = (s + (3.14159265 - g) * c) / 3.14159265;
  return (4.0 * 3.14159265 / 5.0) * (t + (1.0 - c) * (1.0 - c) / 10.0);
}

float hapkeB(float g) {
  if (g > 1.5707963) return 0.0;
  float tg = tan(g);
  if (tg < 1e-3) return 1.0;
  float x = uHapkeH / tg;
  return 1.0 - (tg / (2.0 * uHapkeH)) * (3.0 - exp(-x)) * (1.0 - exp(-x));
}

float hapkeHc(float mu) {
  float gam = sqrt(max(1.0 - uHapkeW, 0.0));
  return (1.0 + 2.0 * mu) / (1.0 + 2.0 * gam * mu);
}

float hapkeRefl(float mu0, float mu, float g) {
  float v = (1.0 + hapkeB(g)) * hapkeP(g) + hapkeHc(mu0) * hapkeHc(mu) - 1.0;
  return 3.14159265 * (uHapkeW / (4.0 * 3.14159265)) / max(mu0 + mu, 1e-3) * v;
}
`;
  const MAP_GLSL = `#include <map_fragment>
  {
    float dist = length(vWPos - cameraPosition);
    // 大尺度斑驳：月面从来不是均匀一块灰，这一层同时把 1.25 m 贴图的周期打散
    float macro = fbm3(vWPos * vec3(0.052, 0.085, 0.052));
    diffuseColor.rgb *= 0.93 + 0.14 * macro;

    // 800 m 尺度的大块明暗：远山全靠它才有层次，否则是一整片同色
    float macroFar = vnoise3(vWPos * 0.0013) * 0.6 + vnoise3(vWPos * 0.0034) * 0.4;
    diffuseColor.rgb *= 0.80 + 0.40 * macroFar;

    if (dist < 80.0) {
      // 近场细砂：3 cm 与 1.4 cm 两层，只有走到跟前才起作用
      float f = vnoise3(vWPos * 33.0) * 0.62 + vnoise3(vWPos * 74.0) * 0.38;
      diffuseColor.rgb *= mix(1.0, 0.965 + 0.06 * f, 1.0 - smoothstep(26.0, 80.0, dist));
    }
  }
`;

  const NORMAL_GLSL = `#include <normal_fragment_maps>
  {
    float dist = length(vWPos - cameraPosition);

    // 近景：1–5 cm 的细砂起伏，只在 25 m 内
    if (dist < 25.0) {
      float fade = 1.0 - smoothstep(6.0, 25.0, dist);
      float e = 0.012;
      float h0 = fbm3(vWPos * 26.0);
      float hx = fbm3((vWPos + vec3(e, 0.0, 0.0)) * 26.0);
      float hz = fbm3((vWPos + vec3(0.0, 0.0, e)) * 26.0);
      vec2 grad = vec2(hx - h0, hz - h0) * 0.35 * fade;
      normal = normalize(normal + (viewMatrix * vec4(grad.x, 0.0, grad.y, 0.0)).xyz);
    }

    // 中景：30 m 与 9 m 两个尺度的起伏。
    // 网格在这里已经是十几米一个四边形，几何上做不出这么细的坡面，
    // 只能靠法线补——否则整片远地面被 Hapke 的掠射增益推成一个亮度，看着像沙丘。
    if (dist > 8.0 && dist < 700.0) {
      float fade = smoothstep(8.0, 34.0, dist) * (1.0 - smoothstep(320.0, 700.0, dist));
      float e1 = 1.1, e2 = 0.28;
      float a0 = fbm2(vWPos * 0.034);
      float ax = fbm2((vWPos + vec3(e1, 0.0, 0.0)) * 0.034);
      float az = fbm2((vWPos + vec3(0.0, 0.0, e1)) * 0.034);
      float b0 = fbm2(vWPos * 0.115);
      float bx = fbm2((vWPos + vec3(e2, 0.0, 0.0)) * 0.115);
      float bz = fbm2((vWPos + vec3(0.0, 0.0, e2)) * 0.115);
      vec2 grad = (vec2(ax - a0, az - a0) * 2.6 + vec2(bx - b0, bz - b0) * 1.5) * fade;
      normal = normalize(normal + (viewMatrix * vec4(grad.x, 0.0, grad.y, 0.0)).xyz);
    }
  }
`;

  /**
   * 石块表面：真实碎块不是一坨均匀的灰浆。它是麻点 + 明暗斑 + 少量冲击熔融的暗色玻璃点。
   * 用世界坐标噪声而不是贴图，因为每块石头尺寸差 40 倍，贴图一缩放就露馅。
   */
  const ROCK_MAP_GLSL = `#include <map_fragment>
  {
    // 逐面色调（由几何的 aTint 传入）
    float d = length(vWPos - cameraPosition);
    float nearK = 1.0 - smoothstep(16.0, 46.0, d);
    // 矿物斑块只做两个低频尺度：28 cm 与 9 cm。
    // 频率一高就变成「盐和胡椒」，看起来像发霉的面包——真实碎块的大部分表面
    // 是干净的解理面，深浅变化是成片的矿物料，不是满屏麻点。
    float n1 = fbm3(vWPos * 3.1 + 11.3);
    float n2 = fbm3(vWPos * 8.7 + 3.7);
    float k = 0.90 + 0.20 * (n1 * 0.5 + n2 * 0.5);
    // 每个解理面自己的色调，权重在近处才拿出来（远处面数不到一个像素会闪）
    k *= mix(1.0, 0.84 + 0.34 * vFaceTint, nearK);
    diffuseColor.rgb *= mix(1.0, k, nearK);
  }
`;

  /**
   * 石块表面的凹凸：只调反照率会像喷了一层灰，必须让法线也跟着起伏，
   * 掠射光一擦，颗粒才有实体的高光与阴影。
   */
  const ROCK_NORMAL_GLSL = `#include <normal_fragment_maps>
  {
    float d = length(vWPos - cameraPosition);
    float fade = 1.0 - smoothstep(14.0, 46.0, d);
    if (fade > 0.002) {
      float e = 0.006;
      float h0 = fbm3(vWPos * 26.0);
      float hx = fbm3((vWPos + vec3(e, 0.0, 0.0)) * 26.0);
      float hz = fbm3((vWPos + vec3(0.0, 0.0, e)) * 26.0);
      float h2 = fbm3(vWPos * 7.5);
      float hx2 = fbm3((vWPos + vec3(0.010, 0.0, 0.0)) * 7.5);
      float hz2 = fbm3((vWPos + vec3(0.0, 0.0, 0.010)) * 7.5);
      // 强度压到很低：每个三角形本来就是硬边，再加法线扰动会在面上留下
      // 一块块方格状的明暗，看起来像编织纹。石块的粗糙感交给轮廓与棱线。
      vec2 grad = (vec2(hx - h0, hz - h0) * 0.16 + vec2(hx2 - h2, hz2 - h2) * 0.30) * fade;
      normal = normalize(normal + (viewMatrix * vec4(grad.x, 0.0, grad.y, 0.0)).xyz);
    }
  }
`;

  const HAPKE_GLSL = `
  {
    vec3 Nw = inverseTransformDirection(normal, viewMatrix);
    vec3 Vw = normalize(cameraPosition - vWPos);
    float mu0 = max(dot(Nw, uSunDir), 1e-3);
    float mu  = max(dot(Nw, Vw), 0.16);   // 粗糙度补偿：掠射时有效出射角不为 0
    float g   = acos(clamp(dot(uSunDir, Vw), -1.0, 1.0));
    float R   = hapkeRefl(mu0, mu, g);
    // 与 Lambert 的比值。晨昏线附近 μ0→0 时会爆，但真正的爆点是钳位本身：
    // 一旦大面积触到上限，法线再怎么变亮度都是同一个常数，地面立刻变成白纸。
    // 所以上限放得很宽，靠 μ 的下限控制掠射增益，让整个亮度区间都保留响应。
    float gain = clamp(R / (uHapkeNorm * mu0), 0.0, uGainMax);

    // 远距离回退到朗伯：10 km 外的山体一个四边形 500 m，几何上根本载不住粗糙度，
    // 再按 Hapke 的掠射增益算，亮面就会一路顶到饱和，变成一张白剪纸。
    float dist2 = length(vWPos - cameraPosition);
    gain = mix(gain, 1.0, smoothstep(700.0, 4200.0, dist2));

    reflectedLight.directDiffuse *= gain;
  }
  vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;`;

  /**
   * 把 Hapke 反射率注入任意 MeshStandardMaterial。
   *
   * 石块必须和地面用同一套模型。地面按 Hapke 算出来比 Lambert 亮 2–4 倍，
   * 石块若还用 Lambert，亮面只有地面的三分之一亮度，整块石头就成了一团纯黑剪影——
   * 而阿波罗照片里石块的受光面与月壤亮度相当（浅色角砾岩甚至更亮）。
   * 这一条不修，石头再怎么改形状也还是「贴纸」。
   */
  function applyHapke(mat, withDetail, gainMax = 14.0) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDir = sunU;
      shader.uniforms.uHapkeNorm = normU;
      shader.uniforms.uHapkeW = { value: HAPKE_W };
      shader.uniforms.uHapkeH = { value: HAPKE_H };
      // 石块的面比月壤陡得多，掠射时 1/(μ0+μ) 会把亮面顶到过曝。
      // 地形用 14（保留掠射增益），石块单独压到 4.2。
      shader.uniforms.uGainMax = { value: gainMax };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
                 '#include <common>\nvarying vec3 vWPos;\n' +
                 (withDetail ? '' : 'attribute float aTint;\nvarying float vFaceTint;'))
        .replace('#include <begin_vertex>',
                 '#include <begin_vertex>\n  vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;' +
                 (withDetail ? '' : '\n  vFaceTint = aTint;'));

      let f = shader.fragmentShader.replace('#include <common>', COMMON_GLSL);
      if (withDetail) {
        f = f.replace('#include <map_fragment>', MAP_GLSL)
             .replace('#include <normal_fragment_maps>', NORMAL_GLSL);
      } else {
        // 逐面法线色调的 varying 只在石块 program 里声明
        f = f.replace('varying vec3 vWPos;', 'varying vec3 vWPos;\nvarying float vFaceTint;');
        f = f.replace('#include <map_fragment>', ROCK_MAP_GLSL)
             .replace('#include <normal_fragment_maps>', ROCK_NORMAL_GLSL);
      }
      f = f.replace(
        'vec3 totalDiffuse = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;',
        HAPKE_GLSL);
      shader.fragmentShader = f;
    };
    mat.customProgramCacheKey = () =>
      (withDetail ? (detailOn ? 'regolith-hapke-detail' : 'regolith-hapke') : 'rock-hapke');
    return mat;
  }

  applyHapke(material, true);

  const hi = quality === 'high';
  const groundSeg = hi ? 320 : 140;
  // 中景与远景共用同一圈角度分段与同一接缝半径：
  // 接缝上两圈顶点逐一对齐，网格才是水密的。之前 mid 到 2400、far 从 2300 起，
  // 中间 100 m 重叠，粗网格的弦高误差会把远景点从近景里顶出来 => 一片白色薄板。
  const ringAng = hi ? 256 : 140;
  const SEAM = 2400;
  const RING_Y = -0.30;   // 整体压低于方格地面，避免 110–120 m 的环带 z-fighting

  const ground = new THREE.Mesh(buildSquare(240, groundSeg, 0, 0, 1 / 1.25), material);
  const mid = new THREE.Mesh(buildDisc(110, SEAM, 62, ringAng, 0, 0, 1 / 6, RING_Y), material);
  const far = new THREE.Mesh(buildDisc(SEAM, 20000, 42, ringAng, 0, 0, 1 / 6, RING_Y), material);

  ground.receiveShadow = true;
  mid.receiveShadow = true;
  far.receiveShadow = false;

  const group = new THREE.Group();
  group.add(ground, mid, far);

  /* ---------------- 石块 ----------------
   *
   * 阿波罗照片里的月面碎块不是鹅卵石。它们是撞击破碎产生的角砾：
   * 有平坦的解理面、锐利的棱线，三轴比例不均匀（多数偏扁平），
   * 尺寸分布是连续幂律——几厘米的碎屑成片，几十厘米的块零星散布。
   *
   * 球体加正弦扰动永远做不出这个。球面处处曲率同号，怎么扰都是一颗土豆。
   * 这里改用凸包：随机球面点取 ConvexGeometry，面天然是平面、棱天然是锐角；
   * 输出是非索引几何且带面法线，硬边不会被平滑掉，正是石块该有的样子。
   */
  const TAU = Math.PI * 2;
  const rnd = (a, b) => hash2(a | 0, b | 0, 9331);

  function makeRockGeometry(seed) {
    // 16–25 个顶点 => 28–48 个面。11 个顶点做出来只有三四个大三角面，
    // 近看是「三角板」而不是石头；真实碎块的可见面大约在 20–40 之间。
    const n = 18 + Math.floor(rnd(seed, 1) * 11);
    const tiers = 3 + Math.floor(rnd(seed, 2) * 2);   // 3–4 档半径，制造长短不一的棱
    const tierR = [];
    for (let t = 0; t < tiers; t++) tierR.push(0.72 + 0.28 * rnd(seed, 10 + t));

    const pts = [];
    for (let i = 0; i < n; i++) {
      const u = rnd(seed, 100 + i * 4) * 2 - 1;
      const th = rnd(seed, 101 + i * 4) * TAU;
      const rxy = Math.sqrt(Math.max(0, 1 - u * u));
      const rad = 0.5 * tierR[Math.floor(rnd(seed, 102 + i * 4) * tiers)];
      pts.push(new THREE.Vector3(
        Math.cos(th) * rxy * rad,
        u * rad,
        Math.sin(th) * rxy * rad,
      ));
    }

    // 三轴各向异性：宽 > 厚。照片里的碎块大多是扁平的板状/楔状，不是圆球
    const sx = 0.86 + 0.38 * rnd(seed, 3);
    const sy = 0.56 + 0.26 * rnd(seed, 4);
    const sz = 0.86 + 0.38 * rnd(seed, 5);
    let minY = Infinity, maxY = -Infinity;
    for (const p of pts) {
      p.x *= sx; p.y *= sy; p.z *= sz;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    /*
     * 解理面切割：随机取 2–3 个平面，把凸出去的顶点压回平面上。
     * 这一步决定「像石头」还是「像骰子」——真实碎块是沿着矿物解理面断开的，
     * 每个碎块都有两三个又大又平的面，其余是不规则的小面。
     * 只做径向扰动做不出平面，只会得到一颗更歪的土豆。
     */
    const cuts = 2 + Math.floor(rnd(seed, 6) * 2);
    const nv = new THREE.Vector3();
    for (let c = 0; c < cuts; c++) {
      const cu = rnd(seed, 60 + c * 3) * 2 - 1;
      const ct = rnd(seed, 61 + c * 3) * TAU;
      const cr = Math.sqrt(Math.max(0, 1 - cu * cu));
      nv.set(Math.cos(ct) * cr, cu, Math.sin(ct) * cr);
      const off = 0.5 * (0.50 + 0.34 * rnd(seed, 62 + c * 3));
      for (const p of pts) {
        const t = p.dot(nv) - off;
        if (t > 0) p.addScaledVector(nv, -t);
      }
    }

    // 底部压平：把最低一层顶点压到同一高度，凸包就会给出一个平底。
    // 这条直接决定「影子会不会和石头分开」——底面不平的石头只靠一两个尖点着地，
    // 本身就在视觉上飘着，影子当然贴不住。
    const flat = minY + (maxY - minY) * 0.12;
    for (const p of pts) if (p.y < flat) p.y = minY;

    const g = new ConvexGeometry(pts);

    /*
     * 逐面随机色调。真实月面碎块是多晶角砾岩，每个解理面的矿物组成不同，
     * 反照率能差出 20–30%。同一块石头上一律同一个灰，才会显得像塑料模型。
     * ConvexGeometry 输出非索引几何（每 3 个顶点一个面），正好按三角形写值。
     */
    const vCount = g.attributes.position.count;
    const tints = new Float32Array(vCount);
    for (let t = 0; t < vCount / 3; t++) {
      const v = rnd(seed, 900 + t);
      tints[t * 3] = tints[t * 3 + 1] = tints[t * 3 + 2] = v;
    }
    g.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));

    // 平移到「底面 y = 0」，摆放时 position.y 直接等于地面高度，不用再猜偏移量
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) - minY);
    pos.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  const ROCK_VARIANTS = 8;
  const ROCK_CAP = 900;   // 每个变体的实例容量
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.94, metalness: 0.0,
  });
  // 与地面同一套 Hapke：否则石块比月壤暗 3 倍，怎么看都是一团黑剪影
  applyHapke(rockMat, false, 4.2);

  const rockMeshes = [];
  for (let v = 0; v < ROCK_VARIANTS; v++) {
    const m = new THREE.InstancedMesh(makeRockGeometry(1103 + v * 97), rockMat, ROCK_CAP);
    m.castShadow = true;
    // 不接收阴影：84 m 的阴影图对 10 cm 的碎块仍然太粗，自阴影会把它压成黑块。
    // 石块自己的明暗交给 Hapke 直射光——照片里就是一面亮、一面全黑。
    m.receiveShadow = false;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    rockMeshes.push(m);
    group.add(m);
  }

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  const slot = new Array(ROCK_VARIANTS).fill(0);

  /** 低频噪声决定石块成簇还是稀疏。月面碎石从来不是均匀撒开的，坑缘和山麓才密集 */
  function rockDensity(x, z) {
    const big = fbm(x / 27, z / 27, 3, 811);
    const fine = fbm(x / 6.5, z / 6.5, 2, 823);
    return Math.min(1, 0.16 + 1.30 * Math.abs(big) + 0.50 * Math.abs(fine));
  }

  /** 幂律粒径采样：N(>D) ∝ D^-2.1，与月面岩石计数一致（小碎屑远多于大块） */
  function powerSize(u, smin, smax) {
    const k = 2.1;
    const umax = 1 - Math.pow(smin / smax, k);
    return smin * Math.pow(1 - u * umax, -1 / k);
  }

  function pushRock(i, x, z, s, sink) {
    const v = i % ROCK_VARIANTS;
    const m = rockMeshes[v];
    if (slot[v] >= ROCK_CAP) return;
    const k = slot[v]++;
    dummy.position.set(x, heightAt(x, z) - sink, z);
    // 只绕 Y 自由旋转，倾角压到 ±4°：倾角一大，压平的底面就翘起来，影子又脱开
    dummy.rotation.set(
      (rnd(i, 61) - 0.5) * 0.14,
      rnd(i, 62) * TAU,
      (rnd(i, 63) - 0.5) * 0.14,
    );
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    m.setMatrixAt(k, dummy.matrix);

    // 反照率分档：多数中灰，约 14% 是浅色角砾岩（照片里那些发白的大块），少量偏暗
    const t = rnd(i, 64);
    const gain = t < 0.14 ? 1.55 : (t < 0.30 ? 0.62 : 0.92 + 0.20 * rnd(i, 65));
    tmpColor.setRGB(0.205 * gain, 0.198 * gain, 0.185 * gain);
    m.setColorAt(k, tmpColor);
  }

  function placeRocks(cx, cz) {
    for (let v = 0; v < ROCK_VARIANTS; v++) { slot[v] = 0; rockMeshes[v].count = 0; }

    // 一级：16–150 cm 的块，铺到 60 m（45 m 内都有影子，更远只剩几个像素）
    const N1 = hi ? 1400 : 500;
    for (let placed = 0, tries = 0; placed < N1 && tries < N1 * 5; tries++) {
      const a = rnd(tries, 21) * TAU;
      const d = Math.sqrt(rnd(tries, 22)) * 60;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (rnd(tries, 23) > rockDensity(x, z)) continue;
      const s = powerSize(rnd(tries, 24), 0.16, 1.5);
      pushRock(tries, x, z, s, Math.min(0.055, s * 0.09));
      placed++;
    }

    // 二级：3.5–16 cm 的碎屑，只铺 24 m；再远就交给贴图，否则一半是亚像素噪点
    const N2 = hi ? 3500 : 1100;
    for (let placed = 0, tries = 0; placed < N2 && tries < N2 * 5; tries++) {
      const id = 100000 + tries;
      const a = rnd(id, 31) * TAU;
      const d = Math.sqrt(rnd(id, 32)) * 24;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (rnd(id, 33) > rockDensity(x, z)) continue;
      const s = powerSize(rnd(id, 34), 0.035, 0.16);
      pushRock(id, x, z, s, s * 0.12);
      placed++;
    }

    // 近场保底：10 m 内按密度场随机撒的话，脚下有可能是一片空地，
    // 而照片里无论谁站在月面上，脚边总有几块碎屑。这一圈不走密度场。
    const N3 = hi ? 70 : 28;
    for (let i = 0; i < N3; i++) {
      const id = 300000 + i;
      const a = rnd(id, 41) * TAU;
      const d = Math.sqrt(rnd(id, 42)) * 10;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const s = powerSize(rnd(id, 44), 0.045, 0.30);
      pushRock(id, x, z, s, Math.min(0.02, s * 0.08));
    }

    for (let v = 0; v < ROCK_VARIANTS; v++) {
      const m = rockMeshes[v];
      m.count = slot[v];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  const state = { cx: 0, cz: 0 };

  function recenterGround(cx, cz) {
    const g = buildSquare(240, groundSeg, cx, cz, 1 / 1.25);
    ground.geometry.dispose();
    ground.geometry = g;
    placeRocks(cx, cz);
    state.cx = cx; state.cz = cz;
  }

  /** 中景与远景一起重建：接缝上顶点必须成对，分开重建就会裂开 */
  function recenterRings(cx, cz) {
    const gm = buildDisc(110, SEAM, 62, ringAng, cx, cz, 1 / 6, RING_Y);
    mid.geometry.dispose();
    mid.geometry = gm;
    const gf = buildDisc(SEAM, 20000, 42, ringAng, cx, cz, 1 / 6, RING_Y);
    far.geometry.dispose();
    far.geometry = gf;
  }

  placeRocks(0, 0);

  let lastGround = { x: 0, z: 0 }, lastRings = { x: 0, z: 0 };

  return {
    group,
    materials: material,
    heightAt,
    /** 每帧调用：按距离分档重建网格，保证脚下始终是高精度 */
    update(px, pz, force = false) {
      if (force || Math.hypot(px - lastGround.x, pz - lastGround.z) > 40) {
        recenterGround(px, pz);
        lastGround = { x: px, z: pz };
      }
      if (force || Math.hypot(px - lastRings.x, pz - lastRings.z) > 70) {
        recenterRings(px, pz);
        lastRings = { x: px, z: pz };
      }
    },
  };
}
