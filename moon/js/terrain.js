/*
 * terrain.js — 月面装配：Hapke 材质、石块、网格 LOD 与重建调度。
 *
 * 这个文件原来什么都干：噪声、坑、山体、贴图、网格、材质、石块，一千多行。
 * 现在按职责拆开，这里只负责「把零件装成一个能走进去的场景」：
 *   高程 → height.js    坑场 → craters.js    山体 → massif.js
 *   噪声 → noise.js     月壤贴图 → regolith.js   网格 → terrain-mesh.js
 */

import * as THREE from 'three';
import { ConvexGeometry } from '../vendor/geometries/ConvexGeometry.js';
import { makeRegolithTextures } from './regolith.js';
import { buildSquare, buildDisc } from './terrain-mesh.js';
import { heightAt } from './height.js';
import { CRATER_DETAIL } from './craters.js';
import { fbm, hash2 } from './noise.js';

/* ---------------- 对外接口 ---------------- */

export function createTerrain({
  quality = 'high',
  sunDir = new THREE.Vector3(0, 0.24, -1),
  start = { x: 0, z: 0 },
} = {}) {
  const tex = makeRegolithTextures();
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
  const microK = (() => { const m = location.search.match(/micro=([\d.]+)/); return m ? parseFloat(m[1]) : 1.0; })();

  const COMMON_GLSL = `#include <common>
varying vec3 vWPos;
uniform vec3 uSunDir;
uniform float uHapkeNorm;
uniform float uHapkeW;
uniform float uHapkeH;
uniform float uGainMax;
uniform float uMicroK;

float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.11, 0.17, 0.13));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
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

/*
 * 微型撞击坑：半径 0.10–0.85 m。几何网格 0.75 m 一格，这个尺度根本进不去——
 * 上一版把它们塞进 heightAt，结果坑缘只有 0.3r 宽、不到一个网格边长，
 * 采样时被直接抹平，脚下那圈「密布的微型坑」在画面上等于不存在。
 * 现在改由法线承载：掠射光下坑壁的 N·L 差别就是它显形的原因，不需要几何。
 *
 * 剖面与 craters.js 的 PROFILE 同源：深 0.19r、缘高 0.06r、缘宽 0.22r。
 * 梯度解析求导（每坑 1 次求值），比在三个位置重采样高度场便宜三分之二。
 */
vec2 microCraterGrad(vec2 p, float cell, float seed, float rMin, float rMax, float cover) {
  vec2 acc = vec2(0.0);
  vec2 base = floor(p / cell);
  for (int i = -1; i <= 1; i++) {
    for (int j = -1; j <= 1; j++) {
      vec2 id = base + vec2(float(i), float(j));
      float a = hash21(id + seed);
      if (a > cover) continue;
      float b = hash21(id + seed + 37.1);
      float c = hash21(id + seed + 71.7);
      // a/cover 把「存活判定用的同一个随机数」重映射回 0–1，省一次 hash
      vec2 d = p - (id + vec2(a / cover, b)) * cell;
      float r0 = rMin + (rMax - rMin) * c * c;
      float r = length(d);
      if (r > r0 * 2.0) continue;      // 影响半径 2r，与几何坑的 reach 一致

      float q = r / r0;
      float dh = q < 1.0 ? 0.38 * q : 0.0;                    // -0.19(1-q²) 的导数
      float t = (q - 1.0) / 0.22;
      dh += 0.06 * (-2.0 * t / 0.22) * exp(-t * t);           // 坑缘
      if (q > 1.0) dh -= 0.06 * 0.35 / 1.1 * exp(-(q - 1.0) / 1.1);  // 溅射毯
      acc -= (d / max(r, 0.05)) * (dh / r0);   // 法线沿 -∇h：不减这一号，坑会变成包
    }
  }
  return acc;
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

    // 微型坑：两层。小的一层到 20 m 为止（再远一格不到一个像素，只会闪），
    // 大的一层撑到 85 m，接上 A 层几何坑（半径 1.8 m 起）。
    //
    // 注意这里不能像噪声层那样把梯度直接加到视图空间法线上。斜坡上几何法线
    // 本来就偏，加法会让坑沿坡面拉成椭圆。必须在世界空间沿切平面倾斜。
    if (dist < 85.0) {
      vec2 g = vec2(0.0);
      float fA = 1.0 - smoothstep(7.0, 20.0, dist);
      float fB = 1.0 - smoothstep(35.0, 90.0, dist);
      if (fA > 0.002) g += microCraterGrad(vWPos.xz, 1.30, 13.7, 0.08, 0.32, 0.58) * fA;
      if (fB > 0.002) g += microCraterGrad(vWPos.xz, 3.60, 57.3, 0.28, 0.95, 0.64) * fB;
      g *= uMicroK;
      vec3 Nw = normalize(inverseTransformDirection(normal, viewMatrix));
      vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), Nw) + vec3(1e-4, 0.0, 0.0));
      vec3 B = cross(Nw, T);
      Nw = normalize(Nw - T * g.x - B * g.y);
      normal = normalize((viewMatrix * vec4(Nw, 0.0)).xyz);
    }

    // 中景：只在网格粗到装不下 30 m 以下坡面时补一点。
    // 这一层原来是给「平坦地面」打掩护的，强度给到 2.6/1.5，把真实起伏都盖住了；
    // 现在几何本身有 15–38 m 的丘，假法线必须让位，只保留远处的微弱补充。
    if (dist > 8.0 && dist < 700.0) {
      float fade = smoothstep(20.0, 60.0, dist) * (1.0 - smoothstep(300.0, 700.0, dist));
      float e1 = 1.1, e2 = 0.28;
      float a0 = fbm2(vWPos * 0.034);
      float ax = fbm2((vWPos + vec3(e1, 0.0, 0.0)) * 0.034);
      float az = fbm2((vWPos + vec3(0.0, 0.0, e1)) * 0.034);
      float b0 = fbm2(vWPos * 0.115);
      float bx = fbm2((vWPos + vec3(e2, 0.0, 0.0)) * 0.115);
      float bz = fbm2((vWPos + vec3(0.0, 0.0, e2)) * 0.115);
      vec2 grad = (vec2(ax - a0, az - a0) * 1.1 + vec2(bx - b0, bz - b0) * 0.7) * fade;
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
      shader.uniforms.uMicroK = { value: microK };

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

  /*
   * 远盘一段 2.4–20 km、42 环。
   *
   * 试过把它拆成「2.4–6 km 96 环 + 6–20 km 26 环」，想让地平线附近多采到几个
   * C 层坑（半径 24–90 m，在 2.43 km 处本该是 4–14 px 的起伏）。实测没有用：
   * 逐列地平线高度的标准差从 1.64 px 变成 1.62 px，构建时间却多 110 ms。
   * 原因是本机位的地平线其实在 100 m 量级的近处地形脊上，根本轮不到远盘。
   * 所以远盘保持粗采样——它只是背景板，真正的轮廓由近场决定。
   */

  // LOD：小坑只在近场可见。360 m 外网格已经粗到装不下它们，采样了也是白花时间。
  // 远景接缝那一圈仍用 MID，和中景最后一圈逐点对齐，否则两片网格会裂开。
  const midDetail = (cx, cz) => (x, z) => (
    Math.hypot(x - cx, z - cz) < 360 ? CRATER_DETAIL.NEAR : CRATER_DETAIL.MID
  );
  const farDetail = (cx, cz) => (x, z) => (
    Math.hypot(x - cx, z - cz) < SEAM + 1 ? CRATER_DETAIL.MID : CRATER_DETAIL.FAR
  );

  const ground = new THREE.Mesh(buildSquare(240, groundSeg, start.x, start.z, 1 / 1.25), material);
  const mid = new THREE.Mesh(buildDisc(110, SEAM, 62, ringAng, start.x, start.z, 1 / 6, RING_Y, midDetail(start.x, start.z)), material);
  const far = new THREE.Mesh(buildDisc(SEAM, 20000, 42, ringAng, start.x, start.z, 1 / 6, RING_Y, farDetail(start.x, start.z)), material);

  ground.castShadow = true;
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

  /**
   * 撒一层石块：极坐标撒点 → 低频密度场筛选 → 幂律粒径。
   * 三级石块（大块 / 碎屑 / 脚下保底）只是数量、半径、粒径与种子不同，
   * 原来三份循环体各抄一遍，改一处漏两处。
   */
  function scatterRocks(cx, cz, { count, idBase = 0, radius, smin, smax, sink, seed, density = true }) {
    for (let placed = 0, tries = 0; placed < count && tries < count * 5; tries++) {
      const id = idBase + tries;
      const a = rnd(id, seed.angle) * TAU;
      const d = Math.sqrt(rnd(id, seed.dist)) * radius;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      if (density && rnd(id, seed.gate) > rockDensity(x, z)) continue;
      const s = powerSize(rnd(id, seed.size), smin, smax);
      pushRock(id, x, z, s, sink(s));
      placed++;
    }
  }

  function placeRocks(cx, cz) {
    for (let v = 0; v < ROCK_VARIANTS; v++) { slot[v] = 0; rockMeshes[v].count = 0; }

    // 一级：16–150 cm 的块，铺到 60 m（45 m 内都有影子，更远只剩几个像素）
    scatterRocks(cx, cz, {
      count: hi ? 1400 : 500, radius: 60, smin: 0.16, smax: 1.5,
      sink: (s) => Math.min(0.055, s * 0.09),
      seed: { angle: 21, dist: 22, gate: 23, size: 24 },
    });

    // 二级：3.5–16 cm 的碎屑，只铺 24 m；再远就交给贴图，否则一半是亚像素噪点
    scatterRocks(cx, cz, {
      count: hi ? 3500 : 1100, idBase: 100000, radius: 24, smin: 0.035, smax: 0.16,
      sink: (s) => s * 0.12,
      seed: { angle: 31, dist: 32, gate: 33, size: 34 },
    });

    // 近场保底：10 m 内按密度场随机撒的话，脚下有可能是一片空地，
    // 而照片里无论谁站在月面上，脚边总有几块碎屑。这一圈不走密度场。
    scatterRocks(cx, cz, {
      count: hi ? 70 : 28, idBase: 300000, radius: 10, smin: 0.045, smax: 0.30,
      sink: (s) => Math.min(0.02, s * 0.08), density: false,
      seed: { angle: 41, dist: 42, size: 44 },
    });

    for (let v = 0; v < ROCK_VARIANTS; v++) {
      const m = rockMeshes[v];
      m.count = slot[v];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  function recenterGround(cx, cz) {
    const g = buildSquare(240, groundSeg, cx, cz, 1 / 1.25);
    ground.geometry.dispose();
    ground.geometry = g;
    placeRocks(cx, cz);
  }

  /** 中景与远景一起重建：接缝上顶点必须成对，分开重建就会裂开 */
  function recenterRings(cx, cz) {
    const gm = buildDisc(110, SEAM, 62, ringAng, cx, cz, 1 / 6, RING_Y, midDetail(cx, cz));
    mid.geometry.dispose();
    mid.geometry = gm;
    const gf = buildDisc(SEAM, 20000, 42, ringAng, cx, cz, 1 / 6, RING_Y, farDetail(cx, cz));
    far.geometry.dispose();
    far.geometry = gf;
  }

  placeRocks(start.x, start.z);

  let lastGround = { x: start.x, z: start.z }, lastRings = { x: start.x, z: start.z };

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

