import * as THREE from 'three';

const ROOT = new URL('../assets/lunar-rocks/', import.meta.url);
const IDS = ['70017-8', '79115-0', '70175-0'];

async function loadGeometry(id, lod) {
  const response = await fetch(new URL(`${id}-${lod}.json`, ROOT));
  if (!response.ok) throw new Error(`Missing rock descriptor: ${id}`);
  const descriptor = await response.json();
  const payload = await fetch(new URL(descriptor.binary, ROOT));
  if (!payload.ok) throw new Error(`Missing rock geometry: ${id}`);
  const buffer = await payload.arrayBuffer();
  if (buffer.byteLength !== descriptor.byteLength) throw new Error(`Rock size mismatch: ${id}`);
  const geometry = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(descriptor.attributes)) {
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(buffer, a.byteOffset, a.count * a.itemSize), a.itemSize));
  }
  const index = descriptor.index;
  geometry.setIndex(new THREE.BufferAttribute(new Uint16Array(buffer, index.byteOffset, index.count), 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

export async function loadRockScans(touch = false) {
  const loader = new THREE.TextureLoader();
  return Promise.all(IDS.map(async (id) => {
    try {
      const albedo = await loader.loadAsync(new URL(`${id}-albedo.jpg`, ROOT).href);
      albedo.colorSpace = THREE.SRGBColorSpace;
      albedo.anisotropy = 8;
      const loadLod = async (lod) => {
        const [geometry, normal] = await Promise.all([
          loadGeometry(id, lod),
          loader.loadAsync(new URL(`${id}-${lod}-normal.png`, ROOT).href),
        ]);
        normal.colorSpace = THREE.NoColorSpace;
        normal.anisotropy = 8;
        return { geometry, albedo, normal };
      };
      const [low, high] = await Promise.all([loadLod('low'), touch ? Promise.resolve(null) : loadLod('high')]);
      return { id, low, high };
    } catch (error) {
      console.warn('[rock scans] Procedural fallback:', id, error.message);
      return null;
    }
  }));
}
