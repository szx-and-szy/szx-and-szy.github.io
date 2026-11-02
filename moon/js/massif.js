/*
 * massif.js — 谷地四周的山体。
 *
 * 用旋转各向异性高斯近似，数值取自阿波罗 17 号轨道照片与地形图：
 * 南 Massif 距着陆点约 7.2 km、高出谷底约 2.3 km；北 Massif 约 4.6 km、2.2 km。
 * 这是近似，不是 LRO 高程栅格；山脊的具体走向对不上真实地形。
 */

import { fbm } from './noise.js';

const MASSIFS = [
  { x: 4200, z: -5600, sx: 2700, sz: 2100, amp: 2300, rot: -0.55, seed: 101 },
  { x: -500, z: 4400, sx: 2200, sz: 1700, amp: 2200, rot: 0.25, seed: 211 },
  // 东侧 East Massif：推远抬高比，使山脊仰角低于太阳高度
  { x: 10200, z: 1600, sx: 3400, sz: 4200, amp: 1420, rot: 0.9, seed: 307 },
  { x: 3600, z: 4300, sx: 2500, sz: 2000, amp: 950, rot: -0.3, seed: 401 },
  { x: -6800, z: 2600, sx: 3000, sz: 2400, amp: 700, rot: 0.1, seed: 503 }, // 西侧远山
];

export function massifH(x, z) {
  let h = 0;
  for (const m of MASSIFS) {
    const dx = x - m.x, dz = z - m.z;
    const c = Math.cos(m.rot), s = Math.sin(m.rot);
    const u = (dx * c + dz * s) / m.sx;
    const v = (-dx * s + dz * c) / m.sz;
    const g = Math.exp(-(u * u + v * v));
    if (g < 0.004) continue;
    // 两层扰动：900 m 定山形，260 m 给沟壑与破碎感（只有一层时山体像光滑沙丘）
    const rough = 1 + 0.35 * fbm(x / 900, z / 900, 3, m.seed)
                  + 0.13 * fbm(x / 260, z / 260, 3, m.seed + 7);
    h += m.amp * g * rough;
  }
  return h;
}
