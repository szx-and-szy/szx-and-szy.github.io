import * as THREE from 'three';
import { fetchAsset } from './assets.js';

const ROOT = new URL('../assets/lunar-rocks/', import.meta.url);
const IDS = ['70017-8', '79115-0', '70175-0'];

async function loadGeometry(id, lod) {
  const response = await fetch(new URL(`${id}-${lod}.json`, ROOT));
  if (!response.ok) throw new Error(`Missing rock descriptor: ${id}`);
  const descriptor = await response.json();
  let buffer;
  if (descriptor.runtime_payload) buffer = await checkedAsset(descriptor.runtime_payload);
  else {
    const payload = await fetch(new URL(descriptor.binary, ROOT));
    if (!payload.ok) throw new Error(`Missing rock geometry: ${id}`);
    buffer = await payload.arrayBuffer();
  }
  if (buffer.byteLength !== descriptor.byteLength) throw new Error(`Rock size mismatch: ${id}`);
  const geometry = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(descriptor.attributes)) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(buffer, a.byteOffset, a.count * a.itemSize), a.itemSize));
  }
  const index = descriptor.index;
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(buffer, index.byteOffset, index.count), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, descriptor };
}

async function checkedAsset(payload) {
  const bytes = await fetchAsset(payload, ROOT);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    v => v.toString(16).padStart(2, '0')).join('');
  if (hash !== payload.sha256) throw new Error('Rock payload hash mismatch');
  return bytes;
}

export async function loadRockScans(touch = false) {
  const loader = new THREE.TextureLoader();
  return Promise.all(IDS.map(async (id) => {
    try {
      const albedo = await loader.loadAsync(new URL(`${id}-albedo.jpg`, ROOT).href);
      albedo.colorSpace = THREE.SRGBColorSpace;
      albedo.anisotropy = 8;
      const loadLod = async (lod) => {
        const { geometry, descriptor } = await loadGeometry(id, lod);
        let normal;
        if (descriptor.normalTexture?.runtime_payload) {
          const bytes = await checkedAsset(descriptor.normalTexture.runtime_payload);
          const url = URL.createObjectURL(new Blob([bytes], { type: descriptor.normalTexture.mime_type }));
          try { normal = await loader.loadAsync(url); }
          finally { URL.revokeObjectURL(url); }
        } else normal = await loader.loadAsync(new URL(`${id}-${lod}-normal.png`, ROOT).href);
        normal.colorSpace = THREE.NoColorSpace;
        normal.anisotropy = 8;
        return { geometry, albedo, normal };
      };
      const [low, high, near] = await Promise.all([
        loadLod('low'), touch ? Promise.resolve(null) : loadLod('high'),
        touch ? Promise.resolve(null) : loadLod('near').catch(error => {
          console.warn('[rock scans] Near detail unavailable:', id, error.message);
          return null;
        }),
      ]);
      return { id, low, high, near };
    } catch (error) {
      console.warn('[rock scans] Procedural fallback:', id, error.message);
      return null;
    }
  }));
}
