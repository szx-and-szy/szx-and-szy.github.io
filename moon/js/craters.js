/*
 * craters.js — 坑场。
 *
 * 上一版的坑是三层彼此独立的「胞里撒点」：近景 2–20 m、中景 10–55 m、
 * 微型 0.3–2.4 m。问题不在参数，而在密度：近景坑平均间距 130 m、平均直径 14 m，
 * 等于九个直径才碰到一个坑，坑缘永远不会互相咬合。结果就是「平整地面上凿了几个洞」。
 *
 * 这一版把三层改成连续的幂律分布，覆盖半径 1.8–90 m，层与层之间有 1 m 重叠：
 *
 *   层    半径      胞宽    每胞坑数   平均间距 / 平均直径
 *   A     1.8–7 m   18 m    2–6        约 1.3
 *   B     6–25 m    64 m    1–3        约 1.8
 *   C     24–90 m   220 m   1–3        约 1.6
 *
 * 胞宽按「≥ 2.4 × 最大半径」取，保证 3×3 邻域就能覆盖所有可能影响本点的坑。
 * 间距压到 1–2 个直径之后，坑缘相接、溅射毯叠加，地面才是「被撞击改造过的」，
 * 而不是「没被动过的平面」。
 *
 * 每个坑再乘一个 0.5–1.0 的退化系数：真实月面同时存在新鲜坑与磨平的老坑，
 * 统一深度会让整片地面像刚被轰击过。
 */

import { hash2 } from './noise.js';

/** 坑的剖面参数。调形貌只动这一处 */
const PROFILE = {
  depth: 0.19,       // 深径比（新鲜小坑）
  rim: 0.06,         // 坑缘高度 / 半径
  rimWidth: 0.22,    // 坑缘高斯宽度 / 半径
  ejecta: 0.35,      // 溅射毯高度 / 坑缘高度
  ejectaDecay: 1.1,  // 溅射毯衰减长度 / 半径
  reach: 2.4,        // 影响半径 / 半径，超出即返回 0
};

/** 采样精度：近场带小坑，中景只带 B/C，远景只带 C */
export const CRATER_DETAIL = { FAR: 0, MID: 1, NEAR: 2 };

const BANDS = [
  { cell: 18, min: 2, max: 6, rMin: 1.8, rMax: 7, pow: 2.0,
    seed: { probe: 4111, x: 4127, z: 4139, r: 4153, deg: 4159, step: 23 } },
  { cell: 64, min: 1, max: 3, rMin: 6, rMax: 25, pow: 1.8,
    seed: { probe: 4211, x: 4217, z: 4229, r: 4241, deg: 4253, step: 29 } },
  { cell: 220, min: 1, max: 3, rMin: 24, rMax: 90, pow: 1.6,
    seed: { probe: 4311, x: 4327, z: 4339, r: 4349, deg: 4357, step: 31 } },
];

/** 把「半径 + 退化系数」折算成逐坑常量，避免每次采样重复乘法与除法 */
function crater(x, z, r, deg) {
  return {
    x, z, r,
    invR: 1 / r,
    depth: r * PROFILE.depth * deg,
    rim: r * PROFILE.rim * deg,
    reach2: (r * PROFILE.reach) ** 2,
  };
}

function makeBand({ cell, min, max, rMin, rMax, pow, seed }) {
  const cache = new Map();
  // 缓存跟着玩家走，不设上限会一直长。满了整体清空：地形是确定性的，
  // 重建同一格得到的结果完全一样，代价只是一次重新生成。
  const CACHE_LIMIT = 20000;

  return function band(cx, cz) {
    const key = cx + ',' + cz;
    const hit = cache.get(key);
    if (hit) return hit;

    const n = min + Math.floor(hash2(cx, cz, seed.probe) * (max - min + 1));
    const list = [];
    for (let k = 0; k < n; k++) {
      const s = k * seed.step;
      const r = rMin + (rMax - rMin) * Math.pow(hash2(cx, cz, seed.r + s), pow);
      // 0.5–1.0：老坑被月壤填平，坑缘也磨圆
      const deg = 0.5 + 0.5 * hash2(cx, cz, seed.deg + s);
      list.push(crater(
        cx * cell + hash2(cx, cz, seed.x + s) * cell,
        cz * cell + hash2(cx, cz, seed.z + s) * cell,
        r, deg,
      ));
    }
    if (cache.size >= CACHE_LIMIT) cache.clear();
    cache.set(key, list);
    return list;
  };
}

const bands = BANDS.map(makeBand).map((at, i) => ({ cell: BANDS[i].cell, at }));

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
].map((c) => ({ ...crater(c.x, c.z, c.r, 1), name: c.name }));

function craterHeight(dx, dz, c) {
  const q = dx * dx + dz * dz;
  if (q > c.reach2) return 0;

  const r = Math.sqrt(q) * c.invR;
  let h = 0;
  if (r < 1) h -= c.depth * (1 - r * r);

  const t = (r - 1) / PROFILE.rimWidth;
  h += c.rim * Math.exp(-t * t);
  if (r > 1) h += c.rim * PROFILE.ejecta * Math.exp(-(r - 1) / PROFILE.ejectaDecay);
  return h;
}

/** 3×3 邻域：胞宽已按 2.4 倍最大半径取，邻胞的坑不会漏 */
function sumBand(band, x, z) {
  const ci = Math.floor(x / band.cell);
  const cj = Math.floor(z / band.cell);
  let h = 0;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      for (const c of band.at(ci + i, cj + j)) {
        h += craterHeight(x - c.x, z - c.z, c);
      }
    }
  }
  return h;
}

export function cratersAt(x, z, detail = CRATER_DETAIL.NEAR) {
  let h = 0;
  if (detail >= CRATER_DETAIL.NEAR) h += sumBand(bands[0], x, z);
  if (detail >= CRATER_DETAIL.MID) h += sumBand(bands[1], x, z);
  h += sumBand(bands[2], x, z);

  for (const c of NAMED_CRATERS) {
    h += craterHeight(x - c.x, z - c.z, c);
  }
  return h;
}
