/*
 * terrain-mesh.js — 地形网格装配。
 *
 * 方格（近场）与环带（中景 / 远景）共用一套顶点管线，只有三处不同：
 * 顶点布局、UV 原点、三角形绕序。
 *
 * LOD：heightAt 的第三参数控制是否采样小尺度坑。
 * 近场方格全开；中景环带在 360 m 外丢掉 A 层；远景只在接缝那一圈保留 B 层，
 * 保证与中景的接缝顶点逐点一致（否则两片网格会裂开）。
 */

import * as THREE from 'three';
import { heightAt } from './height.js';
import { CRATER_DETAIL } from './craters.js';
import { fbm } from './noise.js';

/** 谷底偏暗（玄武岩质月壤），山体偏高地向亮灰（高地斜长岩质） */
export function vertexColorFor(h, x, z, out) {
  const t = Math.min(1, Math.max(0, (h + 60) / 900));
  // 大尺度反照率起伏：月面从来不是均匀一片灰
  const patch = 0.95 + 0.12 * fbm(x / 130, z / 130, 3, 71) + 0.05 * fbm(x / 26, z / 26, 2, 83);
  const v = (0.52 + 0.10 * t) * patch;
  out[0] = v * 1.02;
  out[1] = v;
  out[2] = v * 0.96;
}

/** 坡度压暗：法线越偏垂直处越接近裸露基岩，反照率低一档 */
function applySlopeShade(g) {
  const n = g.attributes.normal, c = g.attributes.color;
  for (let i = 0; i < n.count; i++) {
    const ny = Math.abs(n.getY(i));
    const k = 1 - 0.52 * Math.pow(1 - ny, 0.75);
    c.setXYZ(i, c.getX(i) * k, c.getY(i) * k, c.getZ(i) * k * 0.97);
  }
  c.needsUpdate = true;
}

/**
 * vertexAt(i, j) 返回世界坐标 x/z 与 UV 的 u/v。
 * detailAt(x, z) 返回该点需要的坑场精度。
 */
export function buildPatch({
  cols, rows, uvScale, yOffset = 0, flip = false, vertexAt,
  detailAt = () => CRATER_DETAIL.NEAR,
}) {
  const count = cols * rows;
  const pos = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const col = new Float32Array(count * 3);
  const c = [0, 0, 0];

  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i;
      const v = vertexAt(i, j);
      const h = heightAt(v.x, v.z, detailAt(v.x, v.z)) + yOffset;
      pos[k * 3] = v.x;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = v.z;
      uv[k * 2] = v.u * uvScale;
      uv[k * 2 + 1] = v.v * uvScale;
      vertexColorFor(h, v.x, v.z, c);
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
    }
  }

  const idx = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, cc = a + cols, d = cc + 1;
      // 环状网格的绕序与方格相反，否则法线朝下、整片地形不发亮
      if (flip) idx.push(a, b, cc, b, d, cc);
      else idx.push(a, cc, b, b, cc, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  applySlopeShade(g);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

export function buildSquare(size, seg, cx, cz, uvScale, detailAt) {
  const n = seg + 1;
  const step = size / seg;
  const x0 = cx - size / 2;
  const z0 = cz - size / 2;
  return buildPatch({
    cols: n, rows: n, uvScale, detailAt,
    vertexAt: (i, j) => {
      const x = x0 + i * step;
      const z = z0 + j * step;
      // 方格用世界坐标做 UV：细节贴图跟着世界走，网格重建时不会滑动
      return { x, z, u: x, v: z };
    },
  });
}

/** 环带：半径按几何级数分布，近密远疏；UV 相对圆心，避免远处 UV 数值过大 */
export function buildDisc(r0, r1, nr, na, cx, cz, uvScale, yOffset, detailAt) {
  const nAng = na + 1;
  return buildPatch({
    cols: nAng, rows: nr + 1, uvScale, yOffset, flip: true, detailAt,
    vertexAt: (i, j) => {
      const r = r0 * Math.pow(r1 / r0, j / nr);
      const th = (i / na) * Math.PI * 2;
      const lx = Math.cos(th) * r;
      const lz = Math.sin(th) * r;
      return { x: cx + lx, z: cz + lz, u: lx, v: lz };
    },
  });
}
