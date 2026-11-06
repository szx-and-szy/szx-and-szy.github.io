/*
 * terrain-mesh.js — 地形网格装配。
 *
 * 方格（近场）与环带（中景 / 远景）共用一套顶点管线，只有三处不同：
 * 顶点布局、UV 原点、三角形绕序。
 *
 * LOD：heightAt 的第三参数控制是否采样小尺度坑。
 * 近场方格全开；中景环带在 360 m 外丢掉 A 层；远景只在接缝那一圈保留 B 层，
 * 保证与中景的接缝顶点逐点一致（否则两片网格会裂开）。
 *
 * 曲率：heightAt 在固定站点切平面统一减去 r²/2R。月面是半径 1737.4 km 的球，
 * 眼高 1.7 m 时真实地平线只有 2.43 km。加这一项之后，2.4 km 之外的地面全部沉到
 * 视平线以下、被近处地面挡住，地平线由地形本身产生，而不再是 20 km 圆盘的硬边。
 */

import * as THREE from 'three';
import { heightAt } from './height.js';
import { CRATER_DETAIL } from './craters.js';
import { fbm } from './noise.js';
import { measuredReflectance } from './reflectance.js';
export { MOON_RADIUS, curveDrop } from './height.js';

/** 谷底偏暗（玄武岩质月壤），山体偏高地向亮灰（高地斜长岩质） */
export function vertexColorFor(h, x, z, out) {
  const t = Math.min(1, Math.max(0, (h + 60) / 900));
  // 大尺度反照率起伏：月面从来不是均匀一片灰
  const patch = 0.95 + 0.12 * fbm(x / 130, z / 130, 3, 71) + 0.05 * fbm(x / 26, z / 26, 2, 83);
  const v = (measuredReflectance() ? 0.52 : 0.52 + 0.10 * t) * patch;
  out[0] = v * 1.005;
  out[1] = v;
  out[2] = v * 0.995;
}

/**
 * vertexAt(i, j) 返回世界坐标 x/z 与 UV 的 u/v。
 * detailAt(x, z) 返回该点需要的坑场精度。
 * surfaceAt 可将近场外缘接到固定中景的实际三角面上。
 */
export function buildPatch({
  cols, rows, uvScale, yOffset = 0, flip = false, vertexAt,
  detailAt = () => CRATER_DETAIL.NEAR,
  surfaceAt = heightAt, geometry = null, regional = false,
}) {
  const count = cols * rows;
  const g = geometry ?? new THREE.BufferGeometry();
  const pos = g.getAttribute('position')?.array ?? new Float32Array(count * 3);
  const uv = g.getAttribute('uv')?.array ?? new Float32Array(count * 2);
  const col = g.getAttribute('color')?.array ?? new Float32Array(count * 3);
  const c = [0, 0, 0];

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const v = vertexAt(i, j);
      const h = surfaceAt(v.x, v.z, detailAt(v.x, v.z)) + yOffset;
      pos[k * 3] = v.x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = v.z;
      uv[k * 2] = v.u * uvScale;
      uv[k * 2 + 1] = v.v * uvScale;
      vertexColorFor(h, v.x, v.z, c);
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
    }
  }

  if (!g.index) {
    const idx = count > 65535 ? new Uint32Array((cols - 1) * (rows - 1) * 6) : new Uint16Array((cols - 1) * (rows - 1) * 6);
    let k = 0;
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = j * cols + i, b = a + 1, cc = a + cols, d = cc + 1;
        if (flip) { idx[k++] = a; idx[k++] = b; idx[k++] = cc; idx[k++] = b; idx[k++] = d; idx[k++] = cc; }
        else { idx[k++] = a; idx[k++] = cc; idx[k++] = b; idx[k++] = b; idx[k++] = cc; idx[k++] = d; }
      }
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setAttribute('aRegional', new THREE.BufferAttribute(new Float32Array(count).fill(regional ? 1 : 0), 1));
  }
  for (const [name, array, itemSize] of [['position', pos, 3], ['uv', uv, 2], ['color', col, 3]]) {
    if (!g.getAttribute(name)) g.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
    g.getAttribute(name).needsUpdate = true;
  }
  g.computeVertexNormals();
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export function buildSquare(size, seg, cx, cz, uvScale, detailAt, { edgeHeightAt = null, geometry = null } = {}) {
  const n = seg + 1;
  const step = size / seg;
  const x0 = cx - size / 2;
  const z0 = cz - size / 2;
  return buildPatch({
    cols: n, rows: n, uvScale, detailAt, geometry,
    surfaceAt: edgeHeightAt ? (x, z, detail) => {
      const h = heightAt(x, z, detail);
      const t = Math.max(0, Math.min(1, (Math.max(Math.abs(x - cx), Math.abs(z - cz)) - (size / 2 - 32)) / 32));
      if (t === 0) return h;
      const coarse = edgeHeightAt(x, z);
      return Number.isFinite(coarse) ? h + (coarse - h) * t * t * (3 - 2 * t) : h;
    } : heightAt,
    vertexAt: (i, j) => {
      const x = x0 + i * step;
      const z = z0 + j * step;
      // 方格用世界坐标做 UV：细节贴图跟着世界走，网格重建时不会滑动
      return { x, z, u: x, v: z };
    },
  });
}

/** 环带：半径按几何级数分布，近密远疏；UV 相对圆心，避免远处 UV 数值过大 */
export function buildDisc(r0, r1, nr, na, cx, cz, uvScale, yOffset, detailAt, radialMode = 'log') {
  const nAng = na + 1;
  return buildPatch({
    cols: nAng, rows: nr + 1, uvScale, yOffset, flip: true, detailAt, regional: true,
    vertexAt: (i, j) => {
      const r = radialMode === 'linear' ? r0 + (r1 - r0) * j / nr : r0 * Math.pow(r1 / r0, j / nr);
      const th = (i / na) * Math.PI * 2;
      const lx = Math.cos(th) * r;
      const lz = Math.sin(th) * r;
      return { x: cx + lx, z: cz + lz, u: cx + lx, v: cz + lz };
    },
  });
}

/** O(1) interpolation on the actual indexed polar triangles, not the DEM. */
export function discHeightSampler(geometry, { r0, r1, nr, na, cx, cz, radialMode = 'log' }) {
  const positions = geometry.getAttribute('position').array;
  const cols = na + 1, angleStep = Math.PI * 2 / na;
  const triangle = (ia, ib, ic, x, z) => {
    const a = ia * 3, b = ib * 3, c = ic * 3;
    const ax = positions[a], az = positions[a + 2];
    const bx = positions[b], bz = positions[b + 2];
    const cx = positions[c], cz = positions[c + 2];
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-14) return NaN;
    const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / den;
    const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / den;
    if (u < -1e-5 || v < -1e-5 || u + v > 1.00001) return NaN;
    return u * positions[a + 1] + v * positions[b + 1] + (1 - u - v) * positions[c + 1];
  };
  return (x, z) => {
    const dx = x - cx, dz = z - cz;
    let angle = Math.atan2(dz, dx); if (angle < 0) angle += Math.PI * 2;
    const sector = Math.min(na - 1, Math.floor(angle / angleStep));
    const radius = Math.hypot(dx, dz) * Math.cos(angle - (sector + 0.5) * angleStep) / Math.cos(angleStep / 2);
    const row = Math.max(0, Math.min(nr - 1, Math.floor((radialMode === 'linear' ? (radius - r0) / (r1 - r0) : Math.log(radius / r0) / Math.log(r1 / r0)) * nr)));
    if (radius < r0 - 1e-4 || radius > r1 + 1e-4) return NaN;
    const sample = (i, j) => {
      if (j < 0 || j >= nr) return NaN;
      i = (i + na) % na;
      const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
      const h = triangle(a, b, c, x, z);
      return Number.isFinite(h) ? h : triangle(b, d, c, x, z);
    };
    let h = sample(sector, row);
    if (Number.isFinite(h)) return h;
    // Float32 vertex rounding can move a point across a cell boundary.
    for (let j = row - 1; j <= row + 1; j++) for (let i = sector - 1; i <= sector + 1; i++) {
      h = sample(i, j); if (Number.isFinite(h)) return h;
    }
    return NaN;
  };
}
