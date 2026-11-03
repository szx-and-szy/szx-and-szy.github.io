/*
 * height.js — 月面高程的总装配。
 *
 * 五层起伏 + 坑场 + 山体，全部按世界坐标求值，走到哪里都不会变。
 * 层的振幅与波长决定了地面的坡度谱：
 *
 *   波长    振幅     作用
 *   430 m   3.8 m    谷底大起伏
 *    68 m   1.4 m    缓坡
 *    38 m   0.44 m   丘状起伏（这一层是这一版新加的）
 *    15 m   0.20 m   小丘与凹地
 *     4 m   0.06 m   脚下碎起伏
 *
 * 38 m 与 15 m 两层的坡度约 4–5°，恰好落在掠射光能读出明暗的区间里。
 * 只加坑不加丘，地面在坑与坑之间仍然是一块平板——这是上一版「平面感」的来源之一。
 */

import { fbm } from './noise.js';
import { cratersAt, CRATER_DETAIL } from './craters.js';
import { massifH } from './massif.js';
import { elevationAt, hasElevation } from './elevation.js';

export function heightAt(x, z, detail = CRATER_DETAIL.NEAR) {
  let h = 0;

  const measured = hasElevation();
  h += measured ? elevationAt(x, z) : 3.8 * fbm(x / 430, z / 430, 4, 11);
  h += 1.4 * fbm(x / 68, z / 68, 3, 23);
  h += 0.44 * fbm(x / 38, z / 38, 2, 131);
  h += 0.20 * fbm(x / 15, z / 15, 2, 149);
  h += 0.06 * fbm(x / 4, z / 4, 2, 61);

  h += cratersAt(x, z, detail, !measured);
  if (!measured) h += massifH(x, z);

  return h;
}
