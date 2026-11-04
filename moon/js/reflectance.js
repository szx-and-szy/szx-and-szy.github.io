// Spatial brightness from the photometrically normalized 566 nm WAC mosaic.
// This is a relative material modulation, not a single-scattering-albedo measurement.
let field = null;
export async function loadReflectance(site) {
  try {
    const root = new URL('../assets/', import.meta.url);
    const [header, payload] = await Promise.all([
      fetch(new URL('apollo17-wac-reflectance.json', root)),
      fetch(new URL('apollo17-wac-reflectance.f32', root)),
    ]);
    if (!header.ok || !payload.ok) throw new Error('Reflectance download failed');
    const metadata = await header.json(), buffer = await payload.arrayBuffer();
    if (buffer.byteLength !== metadata.width * metadata.height * 4) throw new Error('Reflectance size mismatch');
    if (globalThis.crypto?.subtle) {
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)), v => v.toString(16).padStart(2, '0')).join('');
      if (digest !== metadata.runtime_payload.sha256) throw new Error('Reflectance hash mismatch');
    }
    const data = new Float32Array(buffer), reference = metadata.reference_if;
    if (!(reference > 0)) throw new Error('Invalid reflectance reference');
    for (let i = 0; i < data.length; i++) {
      if (!Number.isFinite(data[i]) || data[i] <= 0 || data[i] > 1) throw new Error('Invalid reflectance sample');
      data[i] /= reference;
    }
    const rad = Math.PI / 180, radius = 1737400;
    field = { data, metadata,
      offsetX: (site.lon - metadata.center_longitude_east_deg) * rad * radius * Math.cos(metadata.center_latitude_deg * rad),
      offsetZ: -(site.lat - metadata.center_latitude_deg) * rad * radius };
    return true;
  } catch (error) {
    field = null;
    console.warn('[reflectance] Statistical fallback:', error.message);
    return false;
  }
}
export function measuredReflectance() { return field; }
