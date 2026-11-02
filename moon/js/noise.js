/*
 * noise.js — 无分配开销的确定性噪声。
 *
 * 全部基于整数哈希，不依赖 Math.random，也不保存状态：
 * 同样的 (x, z, seed) 永远得到同一个值。地形网格每走 40 m 重建一次，
 * 靠的就是这一点——否则脚下的地面会在重建时变样。
 */

export function hash2(i, j, seed) {
  let n = (i | 0) * 374761393 + (j | 0) * 668265263 + (seed | 0) * 1274126177;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return (n >>> 0) / 4294967296;
}

export function smooth(t) { return t * t * (3 - 2 * t); }

export function valueNoise(x, z, seed) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const xf = x - xi, zf = z - zi;
  const u = smooth(xf), v = smooth(zf);
  const a = hash2(xi, zi, seed), b = hash2(xi + 1, zi, seed);
  const c = hash2(xi, zi + 1, seed), d = hash2(xi + 1, zi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** 有符号分形噪声，返回约 -1..1 */
export function fbm(x, z, octaves, seed) {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += (valueNoise(x * f, z * f, seed + o * 17) * 2 - 1) * amp;
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/**
 * 周期值噪声：格点索引按 period 取模，保证 x ∈ [0, period) 时首尾相接。
 * 普通 valueNoise 在贴图边缘会断，平铺就出现接缝。
 */
export function pnoise(x, y, period, seed) {
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
export function pfbm(u, v, base, oct, seed) {
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
export function worley(x, y, cells, seed) {
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
export function granule(u, v, cells, seed, cover) {
  worley(u * cells, v * cells, cells, seed);
  const r = cover * (0.45 + 0.55 * _W.id);
  if (_W.f1 >= r) return 0;
  const t = 1 - _W.f1 / r;
  return t * t * (3 - 2 * t);
}
