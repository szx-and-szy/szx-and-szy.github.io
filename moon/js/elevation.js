/* LOLA/SELENE SLDEM2015. East +x, south +z; metres relative to the landing site. */
const R = 1737400;
const DEG = Math.PI / 180;
let samples = null;
let meta = null;
let offsetX = 0, offsetZ = 0, originHeight = 0;
let horizonShadow = null;

export async function loadElevation(site, sunDirection) {
  try {
    const [description, binary] = await Promise.all([
      fetch(new URL('../assets/apollo17-dem.json', import.meta.url)),
      fetch(new URL('../assets/apollo17-dem.f32', import.meta.url)),
    ]);
    if (!description.ok || !binary.ok) throw new Error('DTM download failed');
    const metadata = await description.json();
    const buffer = await binary.arrayBuffer();
    if (buffer.byteLength !== metadata.width * metadata.height * 4) throw new Error('DTM size mismatch');
    const values = new Float32Array(buffer);
    for (const v of values) if (!Number.isFinite(v)) throw new Error('Non-finite DTM sample');
    const dx = (site.lon - metadata.center_longitude_east_deg) * DEG * R * Math.cos(metadata.center_latitude_deg * DEG);
    const dz = -(site.lat - metadata.center_latitude_deg) * DEG * R;
    if (Math.abs(dx) > 18000 || Math.abs(dz) > 18000) throw new Error('Site outside Apollo 17 DTM');
    meta = metadata;
    samples = values;
    offsetX = dx; offsetZ = dz;
    originHeight = sampleGrid(dx, dz);
    horizonShadow = sunDirection ? buildHorizonShadow(sunDirection) : null;
    return true;
  } catch (error) {
    samples = null;
    horizonShadow = null;
    console.warn('[elevation] Procedural fallback:', error.message);
    return false;
  }
}

const cubic = (a, b, c, d, t) => b + 0.5 * t * (c - a + t * (2 * a - 5 * b + 4 * c - d + t * (3 * (b - c) + d - a)));

function sampleGrid(x, z) {
  const u = Math.max(0, Math.min(meta.width - 1, (x - meta.first_sample_local_x_m) / meta.spacing_m));
  const v = Math.max(0, Math.min(meta.height - 1, (z - meta.first_sample_local_z_m) / meta.spacing_m));
  const ix = Math.floor(u), iz = Math.floor(v), fx = u - ix, fz = v - iz;
  const at = (i, j) => samples[Math.max(0, Math.min(meta.height - 1, j)) * meta.width + Math.max(0, Math.min(meta.width - 1, i))];
  const row = (j) => cubic(at(ix - 1, j), at(ix, j), at(ix + 1, j), at(ix + 2, j), fx);
  return cubic(row(iz - 1), row(iz), row(iz + 1), row(iz + 2), fz);
}

export function hasElevation() { return samples !== null; }
export function elevationAt(x, z) { return samples ? sampleGrid(x + offsetX, z + offsetZ) - originHeight : 0; }
export function elevationInfo() { return samples ? { ...meta, offsetX, offsetZ } : null; }
export function elevationShadow() { return horizonShadow; }

// Regional mountain shadows. The nearby WebGL shadow map handles rocks and metre-scale relief.
function buildHorizonShadow(sun) {
  const size = 257, extent = meta.extent_m, step = extent / (size - 1);
  const horizontal = Math.hypot(sun[0], sun[2]);
  const data = new Float32Array(size * size).fill(-Math.PI / 2);
  const sunAltitude = Math.asin(sun[1]);
  if (horizontal < 1e-5) return { data, size, extent, offsetX, offsetZ, sunAltitude };
  const ux = sun[0] / horizontal, uz = sun[2] / horizontal;
  // Bilinear samples suffice for visibility; cubic interpolation is reserved for the visible mesh.
  const sample = (x, z) => {
    const u = (x - meta.first_sample_local_x_m) / meta.spacing_m;
    const v = (z - meta.first_sample_local_z_m) / meta.spacing_m;
    const i = Math.min(meta.width - 2, Math.max(0, Math.floor(u)));
    const j = Math.min(meta.height - 2, Math.max(0, Math.floor(v)));
    const a = u - i, b = v - j, k = j * meta.width + i;
    return (samples[k] * (1 - a) + samples[k + 1] * a) * (1 - b)
      + (samples[k + meta.width] * (1 - a) + samples[k + meta.width + 1] * a) * b;
  };
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = -extent / 2 + i * step, z = -extent / 2 + j * step;
    const base = sample(x, z) - (x * x + z * z) / (2 * R);
    let highestSlope = -1000;
    for (let d = step; d < extent * 1.42; d += step) {
      const px = x + ux * d, pz = z + uz * d;
      if (Math.abs(px) > extent / 2 || Math.abs(pz) > extent / 2) break;
      const occluder = sample(px, pz) - (px * px + pz * pz) / (2 * R);
      highestSlope = Math.max(highestSlope, (occluder - base) / d);
    }
    data[j * size + i] = Math.atan(highestSlope);
  }
  return { data, size, extent, offsetX, offsetZ, sunAltitude };
}
