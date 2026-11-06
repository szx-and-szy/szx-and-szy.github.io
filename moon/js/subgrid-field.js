/*
 * Statistical unresolved metre-scale relief, not measured Apollo 17 crater sites.
 * This augments the measured terrain only inside the fine moving mesh.
 */
export const SUBGRID_CONFIG = Object.freeze({
  cellM: 3.4, presence: 0.8, radiusMinM: 0.4, radiusMaxM: 1.5,
  reachInRadii: 1.6, maxAxisStretch: 1 / 0.94,
  tileSizeM: 64, segments: 256, halfM: 32, blendInnerHalfM: 24,
  cutoutHalfM: 31.75, recenterStepM: 8, maxCachedCells: 2048,
});
export const CONFIG = SUBGRID_CONFIG;

export function smoothstep(lo, hi, x) {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

function random(ix, iz, salt) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iz | 0, 668265263) ^ Math.imul(salt, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function featureAtCell(ix, iz) {
  if (random(ix, iz, 1801) >= CONFIG.presence) return null;
  const radius = CONFIG.radiusMinM + (CONFIG.radiusMaxM - CONFIG.radiusMinM) * random(ix, iz, 1811) ** 2;
  const freshness = random(ix, iz, 1823) ** 2;
  const angle = random(ix, iz, 1831) * Math.PI * 2;
  return {
    ix, iz, x: (ix + random(ix, iz, 1847)) * CONFIG.cellM,
    z: (iz + random(ix, iz, 1859)) * CONFIG.cellM,
    radius, depth: radius * 0.12 * (0.2 + 0.8 * freshness),
    axis: 0.94 + 0.12 * random(ix, iz, 1861),
    cos: Math.cos(angle), sin: Math.sin(angle),
    rimFraction: 0.08 + 0.12 * freshness,
    rimWidth: 0.22 + 0.18 * (1 - freshness),
    phase: random(ix, iz, 1871) * Math.PI * 2,
  };
}

export function featureHeight(x, z, feature) {
  const dx = x - feature.x, dz = z - feature.z;
  const localX = (dx * feature.cos + dz * feature.sin) / (feature.radius * feature.axis);
  const localZ = (-dx * feature.sin + dz * feature.cos) * feature.axis / feature.radius;
  const q = Math.hypot(localX, localZ);
  if (q >= CONFIG.reachInRadii) return 0;
  const angle = Math.atan2(localZ, localX);
  const bowl = q < 1 ? -feature.depth * (1 - q * q) ** 2.2 : 0;
  const broken = 0.70 + 0.20 * Math.cos(3 * angle + feature.phase) + 0.10 * Math.sin(5 * angle - feature.phase);
  const rim = feature.depth * feature.rimFraction * broken
    * Math.exp(-(((q - 1) / feature.rimWidth) ** 2)) * smoothstep(0.15, 0.50, q);
  return (bowl + rim) * (1 - smoothstep(1.3, CONFIG.reachInRadii, q));
}

export function makeReliefField({ maxCachedCells = CONFIG.maxCachedCells } = {}) {
  if (!Number.isInteger(maxCachedCells) || maxCachedCells < 9) throw new Error('Invalid subgrid cache size');
  const cache = new Map();
  const get = (ix, iz) => {
    const key = `${ix},${iz}`;
    if (cache.has(key)) return cache.get(key);
    const feature = featureAtCell(ix, iz);
    if (cache.size >= maxCachedCells) cache.delete(cache.keys().next().value);
    cache.set(key, feature);
    return feature;
  };
  function reliefAt(x, z) {
    const ix = Math.floor(x / CONFIG.cellM), iz = Math.floor(z / CONFIG.cellM);
    let result = 0;
    // Maximum elliptical support <2.56m <3.4m: the surrounding nine cells suffice.
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const feature = get(ix + i, iz + j);
      if (feature) result += featureHeight(x, z, feature);
    }
    return result;
  }
  Object.defineProperty(reliefAt, 'cacheSize', { get: () => cache.size });
  return reliefAt;
}

// Interpolate the indexed faces (a,cc,b) and (b,cc,d), not a bilinear surface.
// A color channel may be sampled with component=0/1/2 using the same weights.
export function makeSquareTriangleSampler(array, cols, centerX, centerZ, sizeM, component = 1) {
  if (!Number.isInteger(cols) || cols < 2 || array.length !== cols * cols * 3
      || !Number.isFinite(sizeM) || sizeM <= 0 || !Number.isInteger(component) || component < 0 || component > 2) {
    throw new Error('Invalid square terrain samples');
  }
  const segments = cols - 1, step = sizeM / segments;
  const firstX = centerX - sizeM / 2, firstZ = centerZ - sizeM / 2;
  return (x, z) => {
    let gx = (x - firstX) / step, gz = (z - firstZ) / step;
    // Tolerate only arithmetic roundoff at the boundary, never extrapolate outside.
    if (gx < -1e-7 || gz < -1e-7 || gx > segments + 1e-7 || gz > segments + 1e-7) return NaN;
    gx = Math.max(0, Math.min(segments, gx)); gz = Math.max(0, Math.min(segments, gz));
    const ix = Math.min(segments - 1, Math.floor(gx)), iz = Math.min(segments - 1, Math.floor(gz));
    // Re-form the world cell origin before division. Subtracting floor(gx) from
    // a large grid coordinate introduces center-dependent roundoff on recenter.
    const tx = Math.max(0, Math.min(1, (x - (firstX + ix * step)) / step));
    const tz = Math.max(0, Math.min(1, (z - (firstZ + iz * step)) / step));
    const a = (iz * cols + ix) * 3 + component, b = a + 3, cc = a + cols * 3, d = cc + 3;
    if (tx + tz <= 1) return array[a] * (1 - tx - tz) + array[cc] * tz + array[b] * tx;
    return array[b] * (1 - tz) + array[cc] * (1 - tx) + array[d] * (tx + tz - 1);
  };
}

export function reliefWeight(x, z, centerX, centerZ) {
  return 1 - smoothstep(CONFIG.blendInnerHalfM, CONFIG.halfM,
    Math.max(Math.abs(x - centerX), Math.abs(z - centerZ)));
}
