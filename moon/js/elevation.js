/* Measured Apollo17 elevation. East+x,south+z; one absolute lunar-radius datum. */
import { fetchAsset } from './assets.js';
const R = 1737400;
const DEG = Math.PI / 180;
const FINE_START = 1500;
const FINE_END = 1950;
const ASSETS = new URL('../assets/', import.meta.url);
let nearGrid = null;
let baseGrid = null;
let offsetX = 0, offsetZ = 0, originHeight = 0;
let horizonShadow = null;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cubic = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));
const smoothstep = (t) => { const u = clamp(t, 0, 1); return u * u * (3 - 2 * u); };

async function verifyHash(buffer, expected, label) {
  if (!expected || !globalThis.crypto?.subtle) return;
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  const actual = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('');
  if (actual !== expected) throw new Error(`${label}: SHA-256 mismatch`);
}

function validateMetadata(m) {
  const finite = ['spacing_m', 'extent_m', 'first_sample_local_x_m', 'first_sample_local_z_m', 'center_latitude_deg', 'center_longitude_east_deg'];
  if (!Number.isInteger(m.width) || !Number.isInteger(m.height) || m.width < 2 || m.height < 2 || finite.some((k) => !Number.isFinite(m[k])) || m.spacing_m <= 0) {
    throw new Error('Invalid elevation grid metadata');
  }
  if (Math.abs((m.width - 1) * m.spacing_m - m.extent_m) > 1e-5 || Math.abs((m.height - 1) * m.spacing_m - m.extent_m) > 1e-5) {
    throw new Error('Elevation extent/spacing mismatch');
  }
}

async function loadGrid(stem, { legacy = false, sourceMask = false } = {}) {
  const description = await fetch(new URL(`${stem}.json`, ASSETS));
  if (!description.ok) throw new Error(`${stem}: metadata download failed`);
  const metadata = await description.json();
  validateMetadata(metadata);
  const [buffer, maskBuffer] = await Promise.all([
    fetchAsset(metadata.runtime_payload ?? { file: `${stem}.f32` }, ASSETS),
    sourceMask ? fetchAsset(metadata.runtime_source_mask ?? { file: `${stem}-mask.u8` }, ASSETS) : null,
  ]);
  if (buffer.byteLength !== metadata.width * metadata.height * 4) throw new Error(`${stem}: grid byte count mismatch`);
  const expected = metadata.runtime_payload?.sha256
    ?? (legacy ? metadata.sha256?.['apollo17_sldem2015_40km_513_relative.f32'] : null);
  await verifyHash(buffer, expected, stem);
  const samples = new Float32Array(buffer);
  for (const value of samples) if (!Number.isFinite(value)) throw new Error(`${stem}: non-finite elevation sample`);
  let mask = null;
  if (sourceMask) {
    const bytes = maskBuffer;
    if (bytes.byteLength !== samples.length) throw new Error(`${stem}: source-mask byte count mismatch`);
    await verifyHash(bytes, metadata.runtime_source_mask?.sha256, `${stem} source mask`);
    mask = new Uint8Array(bytes);
    let valid = 0;
    for (const value of mask) {
      if (value !== 0 && value !== 255) throw new Error(`${stem}: invalid source-mask value`);
      if (value === 255) valid++;
    }
    if (valid !== metadata.valid_samples || Math.abs(valid / mask.length - metadata.valid_fraction) > 1e-12) {
      throw new Error(`${stem}: source coverage does not match provenance`);
    }
  }
  const absoluteOffset = legacy ? metadata.center_elevation_m : 0;
  if (!Number.isFinite(absoluteOffset)) throw new Error(`${stem}: invalid height datum`);
  return { metadata, samples, mask, absoluteOffset, stem };
}

export async function loadElevation(site, sunDirection) {
  nearGrid = baseGrid = null;
  horizonShadow = null;
  offsetX = offsetZ = originHeight = 0;
  try {
    const [near, far] = await Promise.allSettled([
      loadGrid('apollo17-nac-near'),
      loadGrid('apollo17-nac-far', { sourceMask: true }),
    ]);
    if (near.status === 'fulfilled') nearGrid = near.value;
    else console.warn('[elevation] Fine NAC unavailable:', near.reason.message);
    if (far.status === 'fulfilled') baseGrid = far.value;
    else {
      console.warn('[elevation] Regional NAC unavailable; loading SLDEM2015:', far.reason.message);
      baseGrid = await loadGrid('apollo17-dem', { legacy: true });
    }
    const m = baseGrid.metadata;
    if (nearGrid && (Math.abs(nearGrid.metadata.center_latitude_deg - m.center_latitude_deg) > 1e-10 || Math.abs(nearGrid.metadata.center_longitude_east_deg - m.center_longitude_east_deg) > 1e-10)) {
      throw new Error('Fine/regional elevation centers do not agree');
    }
    offsetX = (site.lon - m.center_longitude_east_deg) * DEG * R * Math.cos(m.center_latitude_deg * DEG);
    offsetZ = -(site.lat - m.center_latitude_deg) * DEG * R;
    if (Math.abs(offsetX) > m.extent_m / 2 - 2000 || Math.abs(offsetZ) > m.extent_m / 2 - 2000) throw new Error('Site outside Apollo17 regional elevation');
    // Blend ABSOLUTE elevations first. A single site origin avoids introducing
    // the8.8mm discrepancy between the two differently sampled center pixels.
    originHeight = sampleAbsolute(offsetX, offsetZ, true);
    horizonShadow = sunDirection ? buildHorizonShadow(sunDirection) : null;
    return true;
  } catch (error) {
    nearGrid = baseGrid = null;
    horizonShadow = null;
    console.warn('[elevation] Procedural fallback:', error.message);
    return false;
  }
}

function sampleGrid(grid, x, z, useCubic = true) {
  const { metadata: m, samples: a } = grid;
  const u = clamp((x - m.first_sample_local_x_m) / m.spacing_m, 0, m.width - 1);
  const v = clamp((z - m.first_sample_local_z_m) / m.spacing_m, 0, m.height - 1);
  const ix = Math.min(m.width - 2, Math.floor(u)), iz = Math.min(m.height - 2, Math.floor(v));
  const fx = u - ix, fz = v - iz, k = iz * m.width + ix;
  if (!useCubic) return ((a[k] * (1 - fx) + a[k + 1] * fx) * (1 - fz)
    + (a[k + m.width] * (1 - fx) + a[k + m.width + 1] * fx) * fz) + grid.absoluteOffset;
  const x0 = Math.max(0, ix - 1), x1 = ix, x2 = ix + 1, x3 = Math.min(m.width - 1, ix + 2);
  const j0 = Math.max(0, iz - 1) * m.width, j1 = iz * m.width, j2 = (iz + 1) * m.width, j3 = Math.min(m.height - 1, iz + 2) * m.width;
  return cubic(
    cubic(a[j0 + x0], a[j0 + x1], a[j0 + x2], a[j0 + x3], fx),
    cubic(a[j1 + x0], a[j1 + x1], a[j1 + x2], a[j1 + x3], fx),
    cubic(a[j2 + x0], a[j2 + x1], a[j2 + x2], a[j2 + x3], fx),
    cubic(a[j3 + x0], a[j3 + x1], a[j3 + x2], a[j3 + x3], fx), fz,
  ) + grid.absoluteOffset;
}

function fineWeight(x, z) {
  if (!nearGrid || Math.abs(x) >= FINE_END || Math.abs(z) >= FINE_END) return 0;
  if (Math.abs(x) <= FINE_START && Math.abs(z) <= FINE_START) return 1;
  // Product weights keep square-corner transitions C1 instead of a diagonal crease.
  return (1 - smoothstep((Math.abs(x) - FINE_START) / (FINE_END - FINE_START)))
    * (1 - smoothstep((Math.abs(z) - FINE_START) / (FINE_END - FINE_START)));
}

function sampleAbsolute(x, z, useCubic) {
  const weight = fineWeight(x, z);
  if (weight === 1) return sampleGrid(nearGrid, x, z, useCubic);
  const far = sampleGrid(baseGrid, x, z, useCubic);
  return weight === 0 ? far : far + (sampleGrid(nearGrid, x, z, useCubic) - far) * weight;
}

function sampleNacMask(grid, x, z) {
  if (!grid.mask) return grid.metadata.product === 'NAC_DTM_APOLLO17' ? 1 : 0;
  const m = grid.metadata;
  const u = clamp((x - m.first_sample_local_x_m) / m.spacing_m, 0, m.width - 1);
  const v = clamp((z - m.first_sample_local_z_m) / m.spacing_m, 0, m.height - 1);
  const i = Math.min(m.width - 2, Math.floor(u)), j = Math.min(m.height - 2, Math.floor(v));
  const a = u - i, b = v - j, k = j * m.width + i, mask = grid.mask;
  return ((mask[k] * (1 - a) + mask[k + 1] * a) * (1 - b)
    + (mask[k + m.width] * (1 - a) + mask[k + m.width + 1] * a) * b) / 255;
}

export function hasElevation() { return baseGrid !== null; }
export function elevationAt(x, z) { return baseGrid ? sampleAbsolute(x + offsetX, z + offsetZ, true) - originHeight : 0; }
export function measuredNearWeightAt(x, z) { return baseGrid ? fineWeight(x + offsetX, z + offsetZ) : 0; }
export function elevationDetailAt(x, z) {
  if (!baseGrid) return { nearWeight: 0, fineWeight: 0, nearSpacing_m: null, baseSpacing_m: null, nacMaskFraction: 0 };
  const gx = x + offsetX, gz = z + offsetZ, weight = fineWeight(gx, gz);
  return {
    nearWeight: weight, fineWeight: weight,
    nearSpacing_m: nearGrid?.metadata.spacing_m ?? null,
    baseSpacing_m: baseGrid.metadata.spacing_m,
    // Bilinear provenance-mask estimate; exact global source coverage is in metadata.
    nacMaskFraction: weight + (1 - weight) * sampleNacMask(baseGrid, gx, gz),
  };
}
export function elevationInfo() {
  if (!baseGrid) return null;
  return {
    ...baseGrid.metadata, offsetX, offsetZ, origin_elevation_m: originHeight,
    value_reference: 'absolute radial elevations blended first; one site origin subtracted at output',
    fine_blend_start_m: FINE_START, fine_blend_end_m: FINE_END,
    levels: { near: nearGrid?.metadata ?? null, regional: baseGrid.metadata },
  };
}
export function elevationShadow() { return horizonShadow; }

// Regional horizon angles. Bilinear best-available heights avoid Catmull-Rom
// overshoot in occluder tests; the mesh pass handles local metre-scale shadows.
function buildHorizonShadow(sun) {
  const length = Math.hypot(...sun);
  if (!Number.isFinite(length) || length < 1e-10) throw new Error('Invalid solar direction');
  const sx = sun[0] / length, sy = clamp(sun[1] / length, -1, 1), sz = sun[2] / length;
  const size = 257, extent = baseGrid.metadata.extent_m, step = extent / (size - 1);
  const horizontal = Math.hypot(sx, sz), sunAltitude = Math.asin(sy);
  const data = new Float32Array(size * size).fill(-Math.PI / 2);
  if (horizontal < 1e-5) return { data, size, extent, offsetX, offsetZ, sunAltitude };
  const ux = sx / horizontal, uz = sz / horizontal;
  const physicalHeight = (x, z) => sampleAbsolute(x, z, false)
    - ((x - offsetX) ** 2 + (z - offsetZ) ** 2) / (2 * R);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = -extent / 2 + i * step, z = -extent / 2 + j * step;
    const base = physicalHeight(x, z);
    let highestSlope = -Infinity;
    for (let d = step; d < extent * 1.42; d += step) {
      const px = x + ux * d, pz = z + uz * d;
      if (Math.abs(px) > extent / 2 || Math.abs(pz) > extent / 2) break;
      highestSlope = Math.max(highestSlope, (physicalHeight(px, pz) - base) / d);
    }
    data[j * size + i] = Math.atan(highestSlope);
  }
  return { data, size, extent, offsetX, offsetZ, sunAltitude };
}
