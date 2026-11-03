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
import { elevationShadow } from './elevation.js';

/* ---------------- 对外接口 ---------------- */

export function createTerrain({
  quality = 'high',
  sunDir = new THREE.Vector3(0, 0.24, -1),
  sunAngularRadius = 0.0047,
  rockScans = [],
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

  // Site tile (20.5N, 30.5E), LROC WAC 566 nm, USGS ISIS calibration cube.
  // Sato et al. 2014, doi:10.1002/2013JE004580. The regional average is not a local rock measurement.
  const HAPKE_W = 0.19069648;
  const HAPKE_H = 0.07088306;
  const HAPKE_B = 0.26402950;
  const HAPKE_C = 0.07014839;
  const HAPKE_BS0 = 2.18679166;
  const hapkeNorm = (() => {
    const b = HAPKE_B, c = HAPKE_C;
    const P0 = (1 + c) / 2 * (1 - b * b) / Math.pow(1 - b, 3)
      + (1 - c) / 2 * (1 - b * b) / Math.pow(1 + b, 3);
    const chi = 0.7898593816657619;
    const root = Math.sqrt(1 - HAPKE_W), r0 = (1 - root) / (1 + root);
    const H1 = 1 / (1 - HAPKE_W * chi * (r0 + 0.5 * (1 - 2 * r0 * chi) * Math.log(1 + 1 / chi)));
    return HAPKE_W / 8 * ((1 + HAPKE_BS0) * P0 + H1 * H1 - 1);
  })();

  const sunU = { value: sunDir.clone().normalize() };
  const normU = { value: hapkeNorm };
  const regionalShadow = elevationShadow();
  const shadowTexture = new THREE.DataTexture(
    Uint16Array.from(regionalShadow?.data ?? [-Math.PI / 2], (v) => THREE.DataUtils.toHalfFloat(v)),
    regionalShadow?.size ?? 1, regionalShadow?.size ?? 1, THREE.RedFormat, THREE.HalfFloatType,
  );
  shadowTexture.minFilter = shadowTexture.magFilter = THREE.LinearFilter;
  shadowTexture.needsUpdate = true;
  const shadowOffset = new THREE.Vector2(regionalShadow?.offsetX ?? 0, regionalShadow?.offsetZ ?? 0);

  const detailOn = new URLSearchParams(location.search).get('detail') !== '0';
  const microK = (() => { const m = location.search.match(/micro=([\d.]+)/); return m ? parseFloat(m[1]) : 1.0; })();

  const COMMON_GLSL = `#include <common>
varying vec3 vWPos;
uniform vec3 uSunDir;
uniform float uHapkeNorm;
uniform float uHapkeW;
uniform float uHapkeH;
uniform float uHgB;
uniform float uHgC;
uniform float uBs0;
uniform float uMicroK;
uniform sampler2D uRegionalShadow;
uniform vec2 uRegionalOffset;
uniform float uRegionalExtent;
uniform float uSolarAltitude;
uniform float uSolarRadius;

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
  float b = uHgB, c = uHgC, cg = cos(g);
  return 0.5 * (1.0 + c) * (1.0 - b * b) / pow(1.0 - 2.0 * b * cg + b * b, 1.5)
       + 0.5 * (1.0 - c) * (1.0 - b * b) / pow(1.0 + 2.0 * b * cg + b * b, 1.5);
}

float hapkeB(float g) {
  return uBs0 / (1.0 + tan(0.5 * g) / uHapkeH);
}

// USGS HapkeLROC.cpp roughness equations; measured Taurus-Littrow theta=23.65660095deg.
// Returns (effective incidence cosine, effective emission cosine, S / original mu0).
// Valid for mu0>0, mu>=0. cosg=dot(sun direction, direction toward viewer).
vec3 hapkeRoughTerms(float mu0, float mu, float cosg) {
  const float HAPKE_PI = 3.141592653589793;
  const float tanTheta = 0.4380661963662265;
  const float cotTheta = 2.282760021875764;
  const float chi = 0.7898593816657619;
  mu0 = clamp(mu0, 0.0, 1.0);
  mu = clamp(mu, 0.0, 1.0);
  float si = sqrt(max(0.0, 1.0 - mu0 * mu0));
  float se = sqrt(max(0.0, 1.0 - mu * mu));
  float zi = cotTheta * mu0 / max(si, 1e-7);
  float ze = cotTheta * mu / max(se, 1e-7);
  float E1i = exp(-2.0 * zi / HAPKE_PI), E2i = exp(-zi * zi / HAPKE_PI);
  float E1e = exp(-2.0 * ze / HAPKE_PI), E2e = exp(-ze * ze / HAPKE_PI);
  float etai = chi * (mu0 + si * tanTheta * E2i / (2.0 - E1i));
  float etae = chi * (mu + se * tanTheta * E2e / (2.0 - E1e));
  float cp = si * se > 1e-7 ? clamp((cosg - mu0 * mu) / (si * se), -1.0, 1.0) : 1.0;
  float psiPI = acos(cp) / HAPKE_PI;
  float s2 = 0.5 * (1.0 - cp);
  float f = exp(-2.0 * sqrt((1.0 - cp) / max(1.0 + cp, 1e-7)));
  float mu0e, mue, q;
  if (mu0 >= mu) {
    float den = max(1e-7, 2.0 - E1e - psiPI * E1i);
    mu0e = chi * (mu0 + si * tanTheta * (cp * E2e + s2 * E2i) / den);
    mue = chi * (mu + se * tanTheta * (E2e - s2 * E2i) / den);
    q = mu0 / max(etai, 1e-7);
  } else {
    float den = max(1e-7, 2.0 - E1i - psiPI * E1e);
    mu0e = chi * (mu0 + si * tanTheta * (E2i - s2 * E2e) / den);
    mue = chi * (mu + se * tanTheta * (cp * E2i + s2 * E2e) / den);
    q = mu / max(etae, 1e-7);
  }
  mu0e = max(0.0, mu0e); mue = max(0.0, mue);
  float SoMu0 = mue * chi / max(1e-12, etai * etae * (1.0 - f + f * chi * q));
  return vec3(mu0e, mue, SoMu0);
}

// The official logarithmic Chandrasekhar H approximation. muEff is nonnegative.
float hapkeH2012(float muEff, float w) {
  if (muEff < 1e-7) return 1.0;
  float root = sqrt(1.0 - w);
  float r0 = (1.0 - root) / (1.0 + root);
  return 1.0 / (1.0 - w * muEff *
    (r0 + 0.5 * (1.0 - 2.0 * r0 * muEff) * log(1.0 + 1.0 / muEff)));
}


// 法线承载网格以下的浅碗与退化坑缘，不替代真实几何轮廓。
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

      // 松散月壤中的小坑大多已退化：连续浅碗、低且破碎的坑缘。
      float q = r / r0;
      float age = 0.20 + 0.65 * hash21(id + seed + 93.2);
      float dh = q < 1.0 ? 0.30 * age * q * (1.0 - q * q) : 0.0;
      float t = (q - 0.93) / 0.34;
      float rimBreak = 0.45 + 0.55 * (0.5 + 0.5 * cos(atan(d.y, d.x) * 3.0 + a * 6.2831853));
      dh += 0.008 * age * rimBreak * (-2.0 * t / 0.34) * exp(-t * t);
      acc += (d / max(r, 1e-5)) * dh;
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
      if (fA > 0.002) g += microCraterGrad(vWPos.xz, 1.30, 13.7, 0.08, 0.32, 0.38) * fA;
      if (fB > 0.002) g += microCraterGrad(vWPos.xz, 3.60, 57.3, 0.28, 0.95, 0.24) * fB;
      g *= uMicroK;
      vec3 Nw = normalize(inverseTransformDirection(normal, viewMatrix));
      // g 是世界 x/z 梯度；投影到切平面，避免随坡面方向旋转或翻转坑壁。
      vec3 gradW = vec3(g.x, 0.0, g.y);
      gradW -= Nw * dot(Nw, gradW);
      Nw = normalize(Nw - gradW);
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

    // Sub-DEM relief is statistical, not measured topography. Filter it before it becomes subpixel.
    if (dist > 350.0) {
      float footprint = max(length(dFdx(vWPos)), length(dFdy(vWPos)));
      float filterK = 1.0 - smoothstep(5.0, 18.0, footprint);
      float e = 1.5;
      float h = fbm2(vWPos * 0.026);
      vec2 g = vec2(fbm2((vWPos + vec3(e, 0.0, 0.0)) * 0.026) - h,
                    fbm2((vWPos + vec3(0.0, 0.0, e)) * 0.026) - h) * (1.4 / e) * filterK;
      vec3 nw = normalize(inverseTransformDirection(normal, viewMatrix));
      vec3 grad = vec3(g.x, 0.0, g.y);
      grad -= nw * dot(nw, grad);
      normal = normalize((viewMatrix * vec4(normalize(nw - grad), 0.0)).xyz);
    }

  }
`;

  /**
   * 石块表面：真实碎块不是一坨均匀的灰浆。它是麻点 + 明暗斑 + 少量冲击熔融的暗色玻璃点。
   * 用世界坐标噪声而不是贴图，因为每块石头尺寸差 40 倍，贴图一缩放就露馅。
   */
  const ROCK_MAP_GLSL = `#include <map_fragment>
  {
    // 连续的矿物色调，不随三角形边界跳变。
    float d = length(vWPos - cameraPosition);
    float nearK = 1.0 - smoothstep(16.0, 46.0, d);
    // 矿物斑块只做两个低频尺度：28 cm 与 9 cm。
    // 频率一高就变成「盐和胡椒」，看起来像发霉的面包——真实碎块的大部分表面
    // 是干净的解理面，深浅变化是成片的矿物料，不是满屏麻点。
    float n1 = fbm3(vWPos * 3.1 + 11.3);
    float n2 = fbm3(vWPos * 8.7 + 3.7);
    float k = 0.90 + 0.20 * (n1 * 0.5 + n2 * 0.5);
    k *= mix(1.0, 0.97 + 0.06 * vFaceTint, nearK);
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
    float mu0 = max(dot(Nw, uSunDir), 1e-7);
    float mu = max(dot(Nw, Vw), 1e-7);
    float cosg = clamp(dot(uSunDir, Vw), -1.0, 1.0);
    float g = acos(cosg);
    vec3 rough = hapkeRoughTerms(mu0, mu, cosg);
    float multiple = hapkeH2012(rough.x, uHapkeW) * hapkeH2012(rough.y, uHapkeW) - 1.0;
    float phase = (1.0 + hapkeB(g)) * hapkeP(g);
    float piBRDF = uHapkeW * 0.25 * rough.x / max(rough.x + rough.y, 1e-7)
      * (phase + multiple) * rough.z;
    // Three already supplied the irradiance cosine and local shadow visibility.
    float gain = max(0.0, piBRDF / uHapkeNorm);

    vec2 shadeUv = (vWPos.xz + uRegionalOffset) / uRegionalExtent + 0.5;
    float horizonAngle = texture2D(uRegionalShadow, shadeUv).r;
    float regionalVisibility = smoothstep(-uSolarRadius, uSolarRadius, uSolarAltitude - horizonAngle);
    reflectedLight.directDiffuse *= gain * regionalVisibility;
    reflectedLight.directSpecular = vec3(0.0);
    reflectedLight.indirectSpecular = vec3(0.0);
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
  function applyHapke(mat, withDetail) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDir = sunU;
      shader.uniforms.uHapkeNorm = normU;
      shader.uniforms.uHapkeW = { value: HAPKE_W };
      shader.uniforms.uHapkeH = { value: HAPKE_H };
      shader.uniforms.uHgB = { value: HAPKE_B };
      shader.uniforms.uHgC = { value: HAPKE_C };
      shader.uniforms.uBs0 = { value: HAPKE_BS0 };
      shader.uniforms.uMicroK = { value: microK };
      shader.uniforms.uRegionalShadow = { value: shadowTexture };
      shader.uniforms.uRegionalOffset = { value: shadowOffset };
      // Endpoint DEM samples correspond to texel centres, not texture edges.
      shader.uniforms.uRegionalExtent = { value: regionalShadow ? regionalShadow.extent * regionalShadow.size / (regionalShadow.size - 1) : 40000 };
      shader.uniforms.uSolarAltitude = { value: regionalShadow?.sunAltitude ?? Math.asin(sunDir.y) };
      shader.uniforms.uSolarRadius = { value: sunAngularRadius };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
                 '#include <common>\nvarying vec3 vWPos;\n' +
                 (withDetail ? '' : 'attribute float aTint;\nvarying float vFaceTint;'))
        .replace('#include <begin_vertex>',
                 '#include <begin_vertex>\n' +
                 '  vec4 hapkeWorldPosition = vec4(transformed, 1.0);\n' +
                 '  #ifdef USE_INSTANCING\n' +
                 '    hapkeWorldPosition = instanceMatrix * hapkeWorldPosition;\n' +
                 '  #endif\n' +
                 '  vWPos = (modelMatrix * hapkeWorldPosition).xyz;' +
                 (withDetail ? '' : '\n  vFaceTint = aTint;'));

      let f = shader.fragmentShader.replace('#include <common>', COMMON_GLSL);
      if (withDetail && detailOn) {
        f = f.replace('#include <map_fragment>', MAP_GLSL)
             .replace('#include <normal_fragment_maps>', NORMAL_GLSL);
      } else if (!withDetail && !mat.userData.scanned) {
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
      (withDetail ? (detailOn ? 'regolith-hapke-detail' : 'regolith-hapke') : mat.userData.scanned ? 'nasa-rock-hapke' : 'rock-hapke');
    return mat;
  }

  applyHapke(material, true);

  const hi = quality === 'high';
  const groundSeg = hi ? 320 : 140;
  // 中景与远景共用同一圈角度分段与同一接缝半径：
  // 接缝上两圈顶点逐一对齐，网格才是水密的。之前 mid 到 2400、far 从 2300 起，
  // 中间 100 m 重叠，粗网格的弦高误差会把远景点从近景里顶出来 => 一片白色薄板。
  const ringAng = hi ? 512 : 256;
  const SEAM = 2400;
  const RING_Y = -0.30;   // 整体压低于方格地面，避免 110–120 m 的环带 z-fighting

  // 远盘加密以承载测绘山体；与中景共享角度采样和接缝半径。

  // LOD：小坑只在近场可见。360 m 外网格已经粗到装不下它们，采样了也是白花时间。
  // 远景接缝那一圈仍用 MID，和中景最后一圈逐点对齐，否则两片网格会裂开。
  const midDetail = (cx, cz) => (x, z) => (
    Math.hypot(x - cx, z - cz) < 360 ? CRATER_DETAIL.NEAR : CRATER_DETAIL.MID
  );
  const farDetail = (cx, cz) => (x, z) => (
    Math.hypot(x - cx, z - cz) < SEAM + 1 ? CRATER_DETAIL.MID : CRATER_DETAIL.FAR
  );

  const ground = new THREE.Mesh(buildSquare(240, groundSeg, start.x, start.z, 1 / 1.25), material);
  const mid = new THREE.Mesh(buildDisc(110, SEAM, hi ? 96 : 62, ringAng, start.x, start.z, 1 / 1.25, RING_Y, midDetail(start.x, start.z)), material);
  const far = new THREE.Mesh(buildDisc(SEAM, 20000, hi ? 160 : 80, ringAng, start.x, start.z, 1 / 1.25, RING_Y, farDetail(start.x, start.z)), material);

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
   * 凸包保留断裂形成的宽面，窄倒角与角点法线模拟轻微磨蚀，避免骰子状锐边。
   */
  const TAU = Math.PI * 2;
  const rnd = (a, b) => hash2(a | 0, b | 0, 9331);

  function makeRockGeometry(seed) {
    // 少量宽断口加细倒角，实例化后仍能控制三角形数量。
    const n = 16 + Math.floor(rnd(seed, 1) * 8);
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
    minY = Math.min(...pts.map((p) => p.y));
    maxY = Math.max(...pts.map((p) => p.y));
    const flat = minY + (maxY - minY) * 0.12;
    for (const p of pts) if (p.y < flat) p.y = minY;
    // 至少三个支点构成接触面，倒角后也不会只剩一根悬空尖角。
    for (const p of [...pts].sort((a, b) => a.y - b.y).slice(0, 3)) p.y = minY;

    const hull = new ConvexGeometry(pts);
    const g = bevelRock(hull, 0.06 + 0.035 * rnd(seed, 7));
    hull.dispose();

    /*
     * 色调按局部位置连续变化，避免把凸包的每个三角形涂成不同颜色。
     */
    const vCount = g.attributes.position.count;
    const tints = new Float32Array(vCount);
    for (let i = 0; i < vCount; i++) {
      const p = g.attributes.position;
      tints[i] = 0.5 + 0.32 * fbm(p.getX(i) * 5 + seed, p.getZ(i) * 5 + p.getY(i) * 3, 2, seed);
    }
    g.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));

    // 平移到「底面 y = 0」，摆放时 position.y 直接等于地面高度，不用再猜偏移量
    const pos = g.attributes.position;
    let baseY = Infinity;
    for (let i = 0; i < pos.count; i++) baseY = Math.min(baseY, pos.getY(i));
    for (let i = 0; i < pos.count; i++) pos.setY(i, pos.getY(i) - baseY);
    pos.needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }

  /** 保留宽阔断口，仅在棱角留一条窄磨蚀带；主面仍使用平面法线。 */
  function bevelRock(hull, wear) {
    const positions = [], normals = [];
    const corners = new Map(), edges = new Map();
    const src = hull.attributes.position;
    const cross = new THREE.Vector3(), edge = new THREE.Vector3(), mean = new THREE.Vector3();
    const keyFor = (p) => [p.x, p.y, p.z].map((v) => Math.round(v * 1e6)).join(',');
    const emit = (a, b, c, na, nb, nc) => {
      cross.subVectors(b, a).cross(edge.subVectors(c, a));
      if (cross.lengthSq() < 1e-14) return;
      mean.copy(na).add(nb).add(nc);
      if (cross.dot(mean) < 0) { [b, c] = [c, b]; [nb, nc] = [nc, nb]; }
      for (const p of [a, b, c]) positions.push(p.x, p.y, p.z);
      for (const n of [na, nb, nc]) normals.push(n.x, n.y, n.z);
    };
    for (let i = 0; i < src.count; i += 3) {
      const p = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(src, i + j));
      const center = p[0].clone().add(p[1]).add(p[2]).multiplyScalar(1 / 3);
      const normal = new THREE.Vector3().subVectors(p[1], p[0])
        .cross(new THREE.Vector3().subVectors(p[2], p[0])).normalize();
      const inset = p.map((v) => v.clone().lerp(center, wear));
      const keys = p.map(keyFor);
      emit(...inset, normal, normal, normal);
      for (let j = 0; j < 3; j++) {
        if (!corners.has(keys[j])) corners.set(keys[j], []);
        corners.get(keys[j]).push({ p: inset[j], n: normal });
        const k = (j + 1) % 3;
        const ordered = keys[j] < keys[k];
        const id = ordered ? keys[j] + '|' + keys[k] : keys[k] + '|' + keys[j];
        if (!edges.has(id)) edges.set(id, []);
        edges.get(id).push({ a: inset[ordered ? j : k], b: inset[ordered ? k : j], n: normal });
      }
    }
    for (const faces of edges.values()) {
      if (faces.length !== 2) continue;
      const [a, b] = faces;
      emit(a.a, a.b, b.b, a.n, a.n, b.n);
      emit(a.a, b.b, b.a, a.n, b.n, b.n);
    }
    for (const points of corners.values()) {
      const center = new THREE.Vector3(), normal = new THREE.Vector3();
      for (const item of points) { center.add(item.p); normal.add(item.n); }
      center.multiplyScalar(1 / points.length);
      normal.normalize();
      const ref = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
      const u = new THREE.Vector3().crossVectors(ref, normal).normalize();
      const v = new THREE.Vector3().crossVectors(normal, u);
      const angle = (item) => { const d = item.p.clone().sub(center); return Math.atan2(d.dot(v), d.dot(u)); };
      points.sort((a, b) => angle(a) - angle(b));
      for (let i = 0; i < points.length; i++) {
        const a = points[i], b = points[(i + 1) % points.length];
        emit(center, a.p, b.p, normal, a.n, b.n);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    return g;
  }

  const ROCK_VARIANTS = 8;
  const ROCK_CAP = 1600;   // 留出局部高密度区域的余量，避免重建时按容量丢掉近处石块
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.94, metalness: 0.0,
  });
  // 与地面同一套 Hapke：否则石块比月壤暗 3 倍，怎么看都是一团黑剪影
  applyHapke(rockMat, false);

  const rockMeshes = [];
  for (let v = 0; v < ROCK_VARIANTS; v++) {
    const m = new THREE.InstancedMesh(makeRockGeometry(1103 + v * 97), rockMat, ROCK_CAP);
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    rockMeshes.push(m);
    group.add(m);
  }
  const scannedSlots = rockScans.map((sample) => {
    if (!sample) return null;
    const make = (lod) => {
      if (!lod) return null;
      const mat = new THREE.MeshStandardMaterial({ map: lod.albedo, normalMap: lod.normal, roughness: 1, metalness: 0 });
      mat.userData.scanned = true;
      applyHapke(mat, false);
      const mesh = new THREE.InstancedMesh(lod.geometry, mat, ROCK_CAP);
      mesh.name = `NASA ${sample.id}`;
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const index = rockMeshes.length;
      rockMeshes.push(mesh);
      group.add(mesh);
      return index;
    };
    return { low: make(sample.low), high: make(sample.high) };
  });

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  const slot = new Array(rockMeshes.length).fill(0);
  let rocksCenter = { ...start };

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
    const type = rnd(i, 141) < 0.05 ? 2 : rnd(i, 142) < 0.6 ? 0 : 1;
    const scanned = s >= 0.14 ? scannedSlots[type] : null;
    const nearby = Math.hypot(x - rocksCenter.x, z - rocksCenter.z) < 20;
    const scanSlot = scanned ? (nearby && scanned.high !== null ? scanned.high : scanned.low) : null;
    const v = scanSlot ?? i % ROCK_VARIANTS;
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
    if (scanSlot !== null) tmpColor.setScalar(0.90 + 0.20 * rnd(i, 65));
    else tmpColor.setRGB(0.13 * gain, 0.128 * gain, 0.125 * gain);
    m.setColorAt(k, tmpColor);
  }

  /** 世界网格与哈希固定每颗石头的位置、尺寸和朝向，重建只改变外围可见范围。 */
  function scatterRocks(cx, cz, { count, idBase = 0, radius, smin, smax, sink, seed, density = true }) {
    const candidates = 4;
    const cell = Math.sqrt(Math.PI * radius * radius * candidates * (density ? 0.60 : 1) / count);
    const radius2 = radius * radius;
    for (let iz = Math.floor((cz - radius) / cell); iz <= Math.floor((cz + radius) / cell); iz++) {
      for (let ix = Math.floor((cx - radius) / cell); ix <= Math.floor((cx + radius) / cell); ix++) {
        for (let k = 0; k < candidates; k++) {
          const salt = idBase + k * 97;
          const x = (ix + hash2(ix, iz, seed.angle + salt)) * cell;
          const z = (iz + hash2(ix, iz, seed.dist + salt)) * cell;
          if ((x - cx) ** 2 + (z - cz) ** 2 > radius2) continue;
          if (density && hash2(ix, iz, seed.gate + salt) > rockDensity(x, z)) continue;
          const id = Math.floor(hash2(ix, iz, seed.size + salt + 7411) * 4294967296);
          const s = powerSize(hash2(ix, iz, seed.size + salt), smin, smax);
          pushRock(id, x, z, s, sink(s));
        }
      }
    }
  }

  function placeRocks(cx, cz) {
    rocksCenter = { x: cx, z: cz };
    for (let v = 0; v < rockMeshes.length; v++) { slot[v] = 0; rockMeshes[v].count = 0; }

    // 外围留出重建余量：玩家走动时，新增石块只出现在远处。
    scatterRocks(cx, cz, {
      count: hi ? 1900 : 650, radius: 70, smin: 0.16, smax: 1.5,
      sink: (s) => Math.min(0.055, s * 0.09),
      seed: { angle: 21, dist: 22, gate: 23, size: 24 },
    });

    // 二级：3.5–16 cm 的碎屑，只铺 24 m；再远就交给贴图，否则一半是亚像素噪点
    scatterRocks(cx, cz, {
      count: hi ? 4700 : 1500, idBase: 100000, radius: 28, smin: 0.035, smax: 0.16,
      sink: (s) => s * 0.12,
      seed: { angle: 31, dist: 32, gate: 33, size: 34 },
    });

    for (let v = 0; v < rockMeshes.length; v++) {
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
  }

  /** 中景与远景一起重建：接缝上顶点必须成对，分开重建就会裂开 */
  function recenterRings(cx, cz) {
    const gm = buildDisc(110, SEAM, hi ? 96 : 62, ringAng, cx, cz, 1 / 1.25, RING_Y, midDetail(cx, cz));
    mid.geometry.dispose();
    mid.geometry = gm;
    const gf = buildDisc(SEAM, 20000, hi ? 160 : 80, ringAng, cx, cz, 1 / 1.25, RING_Y, farDetail(cx, cz));
    far.geometry.dispose();
    far.geometry = gf;
  }

  placeRocks(start.x, start.z);

  let lastGround = { x: start.x, z: start.z }, lastRings = { x: start.x, z: start.z };
  let lastRocks = { x: start.x, z: start.z };

  return {
    group,
    materials: material,
    heightAt,
    /** 每帧调用：按距离分档重建网格，保证脚下始终是高精度 */
    update(px, pz, force = false) {
      if (force || Math.hypot(px - lastRocks.x, pz - lastRocks.z) > 6) {
        placeRocks(px, pz);
        lastRocks = { x: px, z: pz };
      }
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

