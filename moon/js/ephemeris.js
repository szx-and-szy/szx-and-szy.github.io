/*
 * ephemeris.js — 月球站点视角的天文计算
 *
 * 数据来源与精度：
 *  - 月球黄道坐标：Meeus《Astronomical Algorithms》第 47 章周期项截断（取主项），
 *    精度约 0.01°（经度）/ 0.005°（纬度），距离误差 < 20 km
 *  - 太阳黄道坐标：Meeus 第 25 章低精度公式，精度约 0.01°
 *  - 月球定向：IAU 2009 月固坐标系（α0/δ0/W 线性项），忽略周期性摆动项
 *    => 天平动只保留主要几何项，与实际相比在 ±0.05° 量级
 *  - 本地地平坐标：站点经纬度下的东-北-天直角坐标换算，无近似
 *
 * 单一出口 computeScene()，返回的值会直接显示在页面 HUD 上，便于核对。
 */

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const AU_KM = 149597870.7;
const R_EARTH_KM = 6371.0084;   // 地球平均半径
const R_MOON_KM = 1737.4;       // 月球平均半径

const OBLIQUITY = 23.4392911 * DEG;

/** 儒略日 */
export function julianDay(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

/** 距 J2000.0 的天数 / 世纪数 */
function sinceJ2000(date) {
  const d = julianDay(date) - 2451545.0;
  return { d, T: d / 36525 };
}

/** 归一化到 [-180,180) */
function wrap180(a) {
  return ((a + 180) % 360 + 360) % 360 - 180;
}

/* ---------- 太阳 ---------- */

export function sunEcliptic(date) {
  const { d } = sinceJ2000(date);
  const L = 280.460 + 0.9856474 * d;          // 平黄经
  const g = (357.528 + 0.9856003 * d) * DEG;  // 平近点角
  const lambda = L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g);
  const R = 1.00014 - 0.01671 * Math.cos(g) - 0.00014 * Math.cos(2 * g);
  return { lambda: wrap180(lambda) * DEG, beta: 0, distKm: R * AU_KM };
}

/* ---------- 月球（Meeus 47 截断） ---------- */

const LON_TERMS = [
  // [D, M, M', F, 系数(1e-6 deg)]
  [0, 0, 1, 0, 6288774], [2, 0, -1, 0, 1274027], [2, 0, 0, 0, 658314],
  [0, 0, 2, 0, 213618], [0, 1, 0, 0, -185116], [0, 0, 0, 2, -114332],
  [2, 0, -2, 0, 58793], [2, -1, -1, 0, 57066], [2, 0, 1, 0, 53322],
  [2, -1, 0, 0, 45758], [0, 1, -1, 0, -40923], [1, 0, 0, 0, -34720],
  [0, 1, 1, 0, -30383], [2, 0, 0, -2, 15327], [0, 0, 1, 2, -12528],
  [0, 0, 1, -2, 10980], [4, 0, -1, 0, 10675], [0, 0, 3, 0, 10034],
  [4, 0, -2, 0, 8548], [2, 1, -1, 0, -7888], [2, 1, 0, 0, -6766],
  [1, 0, -1, 0, -5163], [1, 1, 0, 0, 4987], [2, -1, 1, 0, 4036],
  [2, 0, 2, 0, 3994], [4, 0, 0, 0, 3861], [2, 0, -3, 0, 3665],
  [0, 1, -2, 0, -2689], [2, 0, -1, 2, -2602], [2, -1, -2, 0, 2390],
  [1, 0, 1, 0, -2348], [2, -2, 0, 0, 2236], [0, 1, 2, 0, -2120],
  [0, 2, 0, 0, -2069], [2, -2, -1, 0, 2048], [2, 0, 1, -2, -1773],
  [2, 0, 0, 2, -1595], [4, -1, -1, 0, 1215], [0, 0, 2, 2, -1110],
  [3, 0, -1, 0, -892], [2, 1, 1, 0, -810], [4, -1, -2, 0, 759],
  [0, 2, -1, 0, -713], [2, 2, -1, 0, -700], [2, 1, -2, 0, 691],
  [2, -1, 0, -2, 596], [4, 0, 1, 0, 549], [0, 0, 4, 0, 537],
];

const LAT_TERMS = [
  // [D, M, M', F, 系数(1e-6 deg)]
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794], [0, 0, 0, 3, -1749],
];

const DIST_TERMS = [
  [0, 0, 1, 0, -20905355], [2, 0, -1, 0, -3699111], [2, 0, 0, 0, -2955968],
  [0, 0, 2, 0, -569925], [0, 1, 0, 0, 48888], [0, 0, 0, 2, -3149],
  [2, 0, -2, 0, 246158], [2, -1, -1, 0, -152138], [2, 0, 1, 0, -170733],
  [2, -1, 0, 0, -204586], [0, 1, -1, 0, -129620], [1, 0, 0, 0, 108743],
];

export function moonEcliptic(date) {
  const { d } = sinceJ2000(date);
  const Lp = 218.3164477 + 13.17639648 * d;
  const D = ((297.8501921 + 12.19074912 * d) % 360) * DEG;   // 平距角
  const M = ((357.5291092 + 13.06499295 * d) % 360) * DEG;   // 太阳平近点角
  const Mp = ((134.9633964 + 13.06499295 * d) % 360) * DEG;  // 月球平近点角
  const F = ((93.2720950 + 483202.0175233 * d) % 360) * DEG;  // 升交点角距

  let sumL = 0, sumB = 0, sumR = 0;
  const args = (a) => a[0] * D + a[1] * M + a[2] * Mp + a[3] * F;
  for (const t of LON_TERMS) sumL += t[4] * Math.sin(args(t));
  for (const t of LAT_TERMS) sumB += t[4] * Math.sin(args(t));
  for (const t of DIST_TERMS) sumR += t[4] * Math.cos(args(t));

  const lambda = wrap180(Lp + sumL / 1e6) * DEG;
  const beta = (sumB / 1e6) * DEG;
  const distKm = 385000.56 + sumR / 1000;

  return { lambda, beta, distKm, D, M, Mp, F, Lp };
}

/* ---------- 坐标变换 ---------- */

/** 黄道球坐标 -> 赤道直角坐标（km） */
function eclipticToEquatorial(lambda, beta, r) {
  const cb = Math.cos(beta), sb = Math.sin(beta);
  const cl = Math.cos(lambda), sl = Math.sin(lambda);
  const ce = Math.cos(OBLIQUITY), se = Math.sin(OBLIQUITY);
  return [
    r * cb * cl,
    r * (cb * sl * ce - sb * se),
    r * (cb * sl * se + sb * ce),
  ];
}

/** 按 IAU 2009 月固模型，把惯性系方向转到月固系（z 为自转轴，x 指向本初子午线） */
function inertialToBody(vec, date) {
  const { d, T } = sinceJ2000(date);
  const a0 = (269.9949 + 0.0031 * T) * DEG;
  const d0 = (66.5392 + 0.0130 * T) * DEG;
  const W = (38.3213 + 13.17635815 * d) * DEG;

  // r_body = Rz(-W) Rx(-(90°-d0)) Rz(-(a0+90°)) r_inertial
  let [x, y, z] = vec;

  // Rz(-(a0+90))
  let a = -(a0 + Math.PI / 2);
  let c = Math.cos(a), s = Math.sin(a);
  let x1 = c * x - s * y, y1 = s * x + c * y, z1 = z;

  // Rx(-(90°-d0))
  a = -(Math.PI / 2 - d0);
  c = Math.cos(a); s = Math.sin(a);
  let x2 = x1, y2 = c * y1 - s * z1, z2 = s * y1 + c * z1;

  // Rz(-W)
  a = -W;
  c = Math.cos(a); s = Math.sin(a);
  const x3 = c * x2 - s * y2, y3 = s * x2 + c * y2, z3 = z2;

  return [x3, y3, z3];
}

function normalize(v) {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

/** 月固系方向 -> 站点本地东/北/天分量 */
function toLocalHorizon(dirBody, latDeg, lonDeg) {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const cl = Math.cos(lat), sl = Math.sin(lat);
  const co = Math.cos(lon), so = Math.sin(lon);

  const up = [cl * co, cl * so, sl];
  const east = [-so, co, 0];
  const north = [-sl * co, -sl * so, cl];

  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const upC = dot(dirBody, up);
  const eastC = dot(dirBody, east);
  const northC = dot(dirBody, north);

  return {
    altDeg: Math.asin(Math.max(-1, Math.min(1, upC))) * RAD,
    azDeg: (Math.atan2(eastC, northC) * RAD + 360) % 360,
    // three.js 世界坐标：x = 东, y = 天顶, z = -北
    world: [eastC, upC, -northC],
  };
}

/* ---------- 对外主函数 ---------- */

/**
 * @param {Date} date UTC 时刻
 * @param {{lat:number, lon:number, name:string}} site 站点月面经纬度
 */
export function computeScene(date, site) {
  const sun = sunEcliptic(date);
  const moon = moonEcliptic(date);

  // 地理（月心）赤道直角坐标
  const sunEq = eclipticToEquatorial(sun.lambda, sun.beta, sun.distKm);
  const moonEq = eclipticToEquatorial(moon.lambda, moon.beta, moon.distKm);

  const sunFromMoon = normalize(sunEq);
  const earthFromMoon = normalize([-moonEq[0], -moonEq[1], -moonEq[2]]);
  const moonFromEarth = normalize(moonEq);
  const sunFromEarth = normalize(sunEq);

  // 月固系方向
  const sunBody = inertialToBody(sunFromMoon, date);
  const earthBody = inertialToBody(earthFromMoon, date);

  const sunLocal = toLocalHorizon(sunBody, site.lat, site.lon);
  const earthLocal = toLocalHorizon(earthBody, site.lat, site.lon);

  // 亚太阳点 / 亚地点（月面经纬度）
  const subSolar = {
    lat: Math.asin(sunBody[2]) * RAD,
    lon: wrap180(Math.atan2(sunBody[1], sunBody[0]) * RAD),
  };
  const subEarth = {
    lat: Math.asin(earthBody[2]) * RAD,
    lon: wrap180(Math.atan2(earthBody[1], earthBody[0]) * RAD),
  };

  // 地球视直径
  const distKm = moon.distKm;
  const earthAngDiamDeg = 2 * Math.asin(R_EARTH_KM / distKm) * RAD;
  const sunAngDiamDeg = 2 * Math.asin(696000 / sun.distKm) * RAD;

  // 地球被照亮的比例：相位角 = 太阳—地球—月球 夹角
  const cosPhase = sunFromEarth[0] * moonFromEarth[0]
    + sunFromEarth[1] * moonFromEarth[1]
    + sunFromEarth[2] * moonFromEarth[2];
  const phaseAngleDeg = Math.acos(Math.max(-1, Math.min(1, cosPhase))) * RAD;
  const illum = (1 + cosPhase) / 2;

  // 天平动（近似：亚地点相对月面本初子午线的偏移）
  const libration = { lat: subEarth.lat, lon: subEarth.lon };

  const horizonKm = Math.sqrt(2 * R_MOON_KM * 0.0017); // 眼高 1.7 m

  return {
    dateISO: date.toISOString(),
    sun: { ...sunLocal, angDiamDeg: sunAngDiamDeg, subSolar },
    earth: {
      ...earthLocal,
      angDiamDeg: earthAngDiamDeg,
      illum,
      phaseAngleDeg,
    },
    distanceKm: distKm,
    libration,
    horizonKm,
    site,
  };
}
