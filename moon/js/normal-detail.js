import * as THREE from 'three';
import { fetchAsset } from './assets.js';

// Residual slopes from original NAC heights, beyond the 39 m geometry grid.
// No photograph brightness is interpreted as height.
let detail = null;

export async function loadNormalDetail(site, coarse = false) {
  try {
    const root = new URL('../assets/', import.meta.url);
    const header = await fetch(new URL('apollo17-nac-normal-detail.json', root));
    if (!header.ok) throw new Error('NAC slope metadata download failed');
    const metadata = await header.json();
    const buffer = await fetchAsset(metadata.runtime_payload ?? { file: 'apollo17-nac-normal-detail.webp', byte_length: metadata.bytes }, root);
    if (buffer.byteLength !== metadata.bytes || !(metadata.gradient_range > 0)
      || !(metadata.extent_m > 0) || metadata.width !== 4096 || metadata.height !== 4096) {
      throw new Error('Invalid NAC slope metadata');
    }
    if (globalThis.crypto?.subtle) {
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
        v => v.toString(16).padStart(2, '0')).join('');
      if (hash !== metadata.sha256) throw new Error('NAC slope hash mismatch');
    }
    const size = coarse ? 2048 : 4096;
    const bitmap = await createImageBitmap(new Blob([buffer], { type: 'image/webp' }), {
      colorSpaceConversion: 'none', premultiplyAlpha: 'none', imageOrientation: 'none',
      resizeWidth: size, resizeHeight: size, resizeQuality: 'high',
    });
    const texture = new THREE.Texture(bitmap);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    const rad = Math.PI / 180, radius = 1737400;
    detail = { texture, metadata, decodedSize: size,
      offsetX: (site.lon - metadata.center_longitude_east_deg) * rad * radius
        * Math.cos(metadata.center_latitude_deg * rad),
      offsetZ: -(site.lat - metadata.center_latitude_deg) * rad * radius };
    return true;
  } catch (error) {
    detail = null;
    console.warn('[normal-detail] Geometry-only fallback:', error.message);
    return false;
  }
}

export function measuredNormalDetail() { return detail; }
