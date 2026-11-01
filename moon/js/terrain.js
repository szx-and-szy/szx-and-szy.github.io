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
  const depth = r0 * 0.22;          // 深径比约 0.19（月面新鲜小坑偏深）
  const rimH = r0 * 0.055;

  let h = 0;
  if (r < 1) h += -depth * (1 - r * r);
  h += rimH * Math.exp(-Math.pow((r - 1) / 0.3, 2));
  if (r > 1) h += rimH * 0.35 * Math.exp(-(r - 1) / 1.1);
  return h;
}

const MID_CELL = 900; // m，负责 25–180 m 的中尺度环坑，填充中景
const midCache = new Map();

function midCellCraters(cx, cz) {
  const key = 'm' + cx + ',' + cz;
  let list = midCache.get(key);
  if (list) return list;

  list = [];
  if (hash2(cx, cz, 311) < 0.62) {
    const n = hash2(cx, cz, 313) < 0.26 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const rx = hash2(cx, cz, 317 + k * 11);
      const rz = hash2(cx, cz, 331 + k * 11);
      const rr = hash2(cx, cz, 347 + k * 11);
      const radius = 25 + 155 * Math.pow(rr, 2.0);
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
    const rough = 1 + 0.35 * fbm(x / 900, z / 900, 3, m.seed);
    h += m.amp * g * rough;
  }
  // 谷底向西北开口通马雷，压低远处
  return h;
}

/* ---------------- 总高程 ---------------- */

export function heightAt(x, z) {
  let h = 0;

  // 谷底缓起伏：振幅约 ±7 m，对应坡度中位数 2–3°
  h += 7.5 * fbm(x / 430, z / 430, 4, 11);
  h += 1.4 * fbm(x / 68, z / 68, 3, 23);
  h += 0.55 * fbm(x / 11, z / 11, 3, 37);
  h += 0.18 * fbm(x / 4, z / 4, 2, 61);

  h += cratersAt(x, z);
  h += massifH(x, z);

  return h;
}

/* ---------------- 贴图 ---------------- */

function makeTextures() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);

  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 平铺友好的噪声：用周期化坐标
      const n = fbm(x / 32, y / 32, 4, 91) * 0.6 + valueNoise(x / 4, y / 4, 133) * 0.4;
      height[y * size + x] = n;
      const v = 118 + n * 46;             // 月壤灰度 ~0.12 反照率，视觉上压在中灰
      const i = (y * size + x) * 4;
      img.data[i] = v * 1.02;
      img.data[i + 1] = v;
      img.data[i + 2] = v * 0.97;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const albedo = new THREE.CanvasTexture(c);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;

  // 法线贴图：由高度场差分得到
  const nc = document.createElement('canvas');
  nc.width = nc.height = size;
  const nctx = nc.getContext('2d');
  const nimg = nctx.createImageData(size, size);
  const strength = 2.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = height[y * size + ((x + size - 1) % size)];
      const r = height[y * size + ((x + 1) % size)];
      const u = height[((y + size - 1) % size) * size + x];
      const d = height[((y + 1) % size) * size + x];
      const nx = (l - r) * strength;
      const ny = (u - d) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const i = (y * size + x) * 4;
      nimg.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      nimg.data[i + 3] = 255;
    }
  }
  nctx.putImageData(nimg, 0, 0);
  const normal = new THREE.CanvasTexture(nc);
  normal.wrapS = normal.wrapT = THREE.RepeatWrapping;

  return { albedo, normal };
}

/* ---------------- 网格 ---------------- */

function vertexColorFor(h, x, z, out) {
  // 谷底偏暗（玄武岩质月壤），山体偏高地向亮灰（高地斜长岩质）
  const t = Math.min(1, Math.max(0, (h + 60) / 900));
  // 大尺度反照率起伏：月面从来不是均匀一片灰
  const patch = 0.95 + 0.12 * fbm(x / 130, z / 130, 3, 71) + 0.05 * fbm(x / 26, z / 26, 2, 83);
  const v = (0.62 + 0.26 * t) * patch;
  out[0] = v * 1.02;
  out[1] = v;
  out[2] = v * 0.96;
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
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

/* ---------------- 对外接口 ---------------- */

export function createTerrain({ quality = 'high' } = {}) {
  const tex = makeTextures();
  const material = new THREE.MeshStandardMaterial({
    map: tex.albedo,
    normalMap: tex.normal,
    normalScale: new THREE.Vector2(0.2, 0.2),
    vertexColors: true,
    roughness: 0.97,
    metalness: 0.0,
  });

  const hi = quality === 'high';
  const groundSeg = hi ? 192 : 96;
  const midAng = hi ? 200 : 120;
  const farAng = hi ? 160 : 96;

  const ground = new THREE.Mesh(buildSquare(240, groundSeg, 0, 0, 1 / 4.0), material);
  const mid = new THREE.Mesh(buildDisc(110, 2400, 44, midAng, 0, 0, 1 / 40, -0.35), material);
  const far = new THREE.Mesh(buildDisc(2300, 20000, 26, farAng, 0, 0, 1 / 300, -1.0), material);

  ground.receiveShadow = true;
  mid.receiveShadow = true;
  far.receiveShadow = false;

  const group = new THREE.Group();
  group.add(ground, mid, far);

  /* 石块：用实例化网格，只铺在近场 */
  const rockGeo = new THREE.IcosahedronGeometry(0.5, 2);
  {
    const p = rockGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const s = 0.7 + 0.6 * hash2(i, 0, 977);
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * 0.72, p.getZ(i) * s);
    }
    rockGeo.computeVertexNormals();
  }
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x55534f, roughness: 0.97, metalness: 0.0,
  });
  const rockCount = hi ? 460 : 200;
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  group.add(rocks);

  // 细砾石：近场 30 m 内的高密度小石子，替代贴图重复感
  const gravelGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const gravelMat = new THREE.MeshStandardMaterial({
    color: 0x4b4944, roughness: 1.0, metalness: 0.0,
  });
  const gravelCount = hi ? 900 : 350;
  const gravel = new THREE.InstancedMesh(gravelGeo, gravelMat, gravelCount);
  gravel.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  gravel.frustumCulled = false;
  group.add(gravel);

  const dummy = new THREE.Object3D();

  function placeRocks(cx, cz) {
    for (let i = 0; i < rockCount; i++) {
      const a = hash2(i, 1, 4211) * Math.PI * 2;
      const d = Math.sqrt(hash2(i, 2, 4211)) * 120;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const s = 0.12 + 1.0 * Math.pow(hash2(i, 3, 4211), 3);
      dummy.position.set(x, heightAt(x, z) + s * 0.35, z);
      dummy.rotation.set(hash2(i, 4, 771) * 3.14, hash2(i, 5, 771) * 6.28, hash2(i, 6, 771) * 3.14);
      dummy.scale.set(s * 1.3, s * 0.8, s * 1.1);
      dummy.updateMatrix();
      rocks.setMatrixAt(i, dummy.matrix);
    }
    rocks.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < gravelCount; i++) {
      const a = hash2(i, 11, 9137) * Math.PI * 2;
      const d = Math.sqrt(hash2(i, 12, 9137)) * 30;
      const x = cx + Math.cos(a) * d;
      const z = cz + Math.sin(a) * d;
      const s = 0.03 + 0.07 * Math.pow(hash2(i, 13, 9137), 2);
      dummy.position.set(x, heightAt(x, z) + s * 0.1, z);
      dummy.rotation.set(hash2(i, 14, 913) * 3.14, hash2(i, 15, 913) * 6.28, hash2(i, 16, 913) * 3.14);
      dummy.scale.set(s * 1.3, s * 0.45, s * 1.1);
      dummy.updateMatrix();
      gravel.setMatrixAt(i, dummy.matrix);
    }
    gravel.instanceMatrix.needsUpdate = true;
  }

  const state = { cx: 0, cz: 0 };

  function recenterGround(cx, cz) {
    const g = buildSquare(240, groundSeg, cx, cz, 1 / 4.0);
    ground.geometry.dispose();
    ground.geometry = g;
    placeRocks(cx, cz);
    state.cx = cx; state.cz = cz;
  }

  function recenterMid(cx, cz) {
    const g = buildDisc(110, 2400, 44, midAng, cx, cz, 1 / 40, -0.35);
    mid.geometry.dispose();
    mid.geometry = g;
  }

  function recenterFar(cx, cz) {
    const g = buildDisc(2300, 20000, 26, farAng, cx, cz, 1 / 300, -1.0);
    far.geometry.dispose();
    far.geometry = g;
  }

  placeRocks(0, 0);

  let lastGround = { x: 0, z: 0 }, lastMid = { x: 0, z: 0 }, lastFar = { x: 0, z: 0 };

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
      if (force || Math.hypot(px - lastMid.x, pz - lastMid.z) > 70) {
        recenterMid(px, pz);
        lastMid = { x: px, z: pz };
      }
      if (force || Math.hypot(px - lastFar.x, pz - lastFar.z) > 900) {
        recenterFar(px, pz);
        lastFar = { x: px, z: pz };
      }
    },
  };
}
