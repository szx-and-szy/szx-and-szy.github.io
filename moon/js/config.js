/*
 * config.js — 站点、时刻与全局可调常数。
 * 改时间与地点只动 SITE；改手感动下面几个数。
 */

export const SITE = {
  name: '陶拉斯-利特罗谷',
  lat: 20.1908,
  lon: 30.7717,
  date: new Date(Date.UTC(1972, 11, 11, 19, 54, 57)), // 阿波罗 17 号着陆时刻
};

export const START = { x: -30, z: -30 };

export const EYE_HEIGHT = 1.7;
export const GRAVITY = 1.62;
// 阿波罗 17 号实测月面平均行走约 1.4 m/s，小跑可到 2.5–3 m/s
export const MOVE_SPEED = 2.6;
export const JUMP_SPEED = 1.9;   // 起跳速度 => 跳高约 1.1 m，滞空约 2.3 s

export const FOV = 52;
export const BASE_EXPOSURE = 6.6;    // 固定显示曝光；按同向阿波罗参考收敛亮度，不是相机EV

/*
 * 平行光跟着相机走，所以 near/far 是「相机到光源的距离 ± 地面起伏」。
 * 原来给 250–640：390 m 的深度范围平摊到阴影图的深度量化上，坑壁这种 40° 以上的
 * 斜面相邻 texel 的深度差能到 2 cm，远超偏置，self-shadow 就变成一圈圈平行条纹。
 * 收到 405–445 之后 texel 间的深度差降到毫米级，normalBias 只要抵这一个量。
 * 配合 PCFSoftShadowMap，坑内壁的条纹从「一眼可见」降到「1:1 下看不出来」。
 */
export const SHADOW = {
  span: 30,
  mapHigh: 4096,
  mapLow: 2048,
  near: 405,
  far: 445,
  bias: -0.00015,      // 归一化深度：×40 m ≈ 6 mm，与 390 m 深度范围下的 -1.5e-5 等效
  normalBias: 0.006,
  radius: 2.5,
};
