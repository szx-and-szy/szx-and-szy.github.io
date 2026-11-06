import { SUBGRID_CONFIG as CONFIG, makeReliefField, makeSquareTriangleSampler, reliefWeight } from './subgrid-field.js';

const reliefAt = makeReliefField();

export function makeSubgridIndices() {
  const cols = CONFIG.segments + 1;
  const indices = new Uint32Array(CONFIG.segments * CONFIG.segments * 6);
  let k = 0;
  for (let j = 0; j < CONFIG.segments; j++) for (let i = 0; i < CONFIG.segments; i++) {
    const a = j * cols + i, b = a + 1, cc = a + cols, d = cc + 1;
    indices[k++] = a; indices[k++] = cc; indices[k++] = b;
    indices[k++] = b; indices[k++] = cc; indices[k++] = d;
  }
  return indices;
}
const indices = makeSubgridIndices();

export function buildSubgridMesh({
  id, coarsePosition, coarseColor, coarseCols, coarseCenterX, coarseCenterZ,
  coarseSizeM = 240, centerX, centerZ, uvScale,
}) {
  const started = performance.now();
  if (![coarseCenterX, coarseCenterZ, centerX, centerZ, uvScale].every(Number.isFinite)) throw new Error('Nonfinite subgrid layout');
  if (!(coarsePosition instanceof Float32Array) || !(coarseColor instanceof Float32Array)) throw new Error('Expected Float32 coarse buffers');
  const coarseAt = makeSquareTriangleSampler(coarsePosition, coarseCols, coarseCenterX, coarseCenterZ, coarseSizeM);
  const colorAt = [0, 1, 2].map(channel => makeSquareTriangleSampler(coarseColor, coarseCols, coarseCenterX, coarseCenterZ, coarseSizeM, channel));
  const cols = CONFIG.segments + 1, count = cols * cols, step = CONFIG.tileSizeM / CONFIG.segments;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2), colors = new Float32Array(count * 3);
  let residualMinM = Infinity, residualMaxM = -Infinity, residualSquares = 0, edgeMaxM = 0;
  for (let j = 0; j < cols; j++) for (let i = 0; i < cols; i++) {
    const k = j * cols + i, x = centerX - CONFIG.halfM + i * step, z = centerZ - CONFIG.halfM + j * step;
    const coarse = coarseAt(x, z), weight = reliefWeight(x, z, centerX, centerZ);
    const residual = weight > 0 ? reliefAt(x, z) * weight : 0;
    const h = coarse + residual;
    if (!Number.isFinite(h)) throw new Error('Fine terrain extends outside the coarse surface');
    positions[k * 3] = x; positions[k * 3 + 1] = h; positions[k * 3 + 2] = z;
    uv[k * 2] = x * uvScale; uv[k * 2 + 1] = z * uvScale;
    for (let channel = 0; channel < 3; channel++) {
      const color = colorAt[channel](x, z);
      if (!Number.isFinite(color)) throw new Error('Nonfinite coarse terrain color');
      colors[k * 3 + channel] = color;
    }
    residualMinM = Math.min(residualMinM, residual); residualMaxM = Math.max(residualMaxM, residual);
    residualSquares += residual * residual;
    if (i === 0 || i === CONFIG.segments || j === 0 || j === CONFIG.segments) edgeMaxM = Math.max(edgeMaxM, Math.abs(positions[k * 3 + 1] - coarse));
  }
  // Area-weighted vertex normals from the very same indexed triangles drawn by Three.
  for (let k = 0; k < indices.length; k += 3) {
    const a = indices[k] * 3, b = indices[k + 1] * 3, c = indices[k + 2] * 3;
    const abx = positions[b] - positions[a], aby = positions[b + 1] - positions[a + 1], abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a], acy = positions[c + 1] - positions[a + 1], acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
    for (const p of [a, b, c]) { normals[p] += nx; normals[p + 1] += ny; normals[p + 2] += nz; }
  }
  for (let k = 0; k < count; k++) {
    const p = k * 3, length = Math.hypot(normals[p], normals[p + 1], normals[p + 2]);
    if (!Number.isFinite(length) || length <= 0) throw new Error('Degenerate subgrid normal');
    normals[p] /= length; normals[p + 1] /= length; normals[p + 2] /= length;
  }
  return { id, positions, normals, uv, colors, centerX, centerZ,
    stats: { vertices: count, triangles: indices.length / 3, residualMinM, residualMaxM,
      residualRmsM: Math.sqrt(residualSquares / count), edgeMaxM, cacheSize: reliefAt.cacheSize,
      buildMs: performance.now() - started } };
}

if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  globalThis.onmessage = event => {
    const id = event.data?.id;
    try {
      const result = buildSubgridMesh(event.data);
      globalThis.postMessage(result, [result.positions.buffer, result.normals.buffer, result.uv.buffer, result.colors.buffer]);
    } catch (error) {
      globalThis.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
  };
}
