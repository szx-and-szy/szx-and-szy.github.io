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

export const FOV = 68;
export const BASE_EXPOSURE = 0.56;   // Hapke 比 Lambert 亮 2–4 倍，曝光重定标

export const SHADOW = {
  span: 30,
  mapHigh: 4096,
  mapLow: 2048,
  near: 250,
  far: 640,
  bias: -0.000015,
  normalBias: 0.0042,
};
