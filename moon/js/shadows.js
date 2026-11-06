import * as THREE from 'three';
import { CSM } from '../vendor/csm/CSM.js';

let activeFactory = null;

// CSM lights represent one Sun. Stock r160 adds all of them on materials that
// have not opted into CSM (notably Earth), so keep only the first shared light.
function singleSunFallback(chunk, cascades) {
  const start = chunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct ) && !defined( USE_CSM )');
  if (start < 0) throw new Error('Unexpected r160 CSM shader layout');
  const head = chunk.slice(0, start);
  const tail = chunk.slice(start);
  return head + tail.replace(
    'for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {',
    `for ( int i = 0; i < NUM_DIR_LIGHTS; i ++ ) {\n#if ( UNROLLED_LOOP_INDEX == 0 ) || ( UNROLLED_LOOP_INDEX >= ${cascades} )`,
  ).replace('\n\t}\n\t#pragma unroll_loop_end', '\n#endif\n\t}\n\t#pragma unroll_loop_end');
}

/** Call setupMaterial after the material's Hapke hook has been installed. */
export function createLunarShadows({ scene, camera, renderer, sunDir, quality = 'high' }) {
  if (activeFactory) throw new Error('Only one lunar Sun shadow factory may be active');
  const high = quality === 'high';
  const distances = high ? [8, 30, 120] : [12, 70];
  const limit = Math.max(1, renderer.capabilities.maxTextureSize);
  const mapSizes = (high ? [8192, 4096, 2048] : [2048, 1024]).map(s => Math.min(s, limit));
  const maxFar = distances.at(-1);
  const direction = sunDir.clone().normalize().negate();
  const originalChunks = {
    lights_fragment_begin: THREE.ShaderChunk.lights_fragment_begin,
    lights_pars_begin: THREE.ShaderChunk.lights_pars_begin,
  };
  const csm = new CSM({
    camera, parent: scene, cascades: distances.length, maxFar, mode: 'custom',
    shadowMapSize: Math.max(...mapSizes), lightDirection: direction,
    lightIntensity: 5.2, lightNear: 0.1, lightFar: 400, lightMargin: 40,
    customSplitsCallback(count, near, far, breaks) {
      for (const distance of distances) breaks.push(Math.min(distance / far, 1));
    },
  });
  THREE.ShaderChunk.lights_fragment_begin = singleSunFallback(THREE.ShaderChunk.lights_fragment_begin, distances.length);
  csm.fade = true;
  csm.updateFrustums();

  const records = new Map();
  const lightRotation = new THREE.Matrix4();
  const inverseRotation = new THREE.Matrix4();
  const cameraToLight = new THREE.Matrix4();
  const point = new THREE.Vector3();
  const zero = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const projection = new THREE.Matrix4();
  let disposed = false;

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  csm.lights.forEach((light, i) => {
    light.name = `Lunar Sun cascade ${i + 1}`;
    light.color.set(0xfffcf7);
    light.shadow.mapSize.set(mapSizes[i], mapSizes[i]);
    light.shadow.radius = 1;
  });

  function updateBounds() {
    // r160 uses max(camera.far,maxFar) for fade padding; the scene's celestial
    // far plane is 300 km, while cascade depth and shader fades use 120 m.
    csm.frustums.forEach((frustum, i) => {
      const a = frustum.vertices.far[0];
      const diameter = Math.max(a.distanceTo(frustum.vertices.far[2]), a.distanceTo(frustum.vertices.near[2]));
      const margin = 0.25 * a.z * a.z / (Math.min(camera.far, maxFar) - camera.near);
      const half = (diameter + margin) / 2;
      const shadowCamera = csm.lights[i].shadow.camera;
      shadowCamera.left = shadowCamera.bottom = -half;
      shadowCamera.right = shadowCamera.top = half;
      shadowCamera.updateProjectionMatrix();
    });
    projection.copy(camera.projectionMatrix);
  }
  updateBounds();

  function setupMaterial(material) {
    if (Array.isArray(material)) { material.forEach(setupMaterial); return material; }
    if (records.has(material)) return material;
    const before = material.onBeforeCompile;
    const cache = material.customProgramCacheKey;
    const baseKey = cache === THREE.Material.prototype.customProgramCacheKey ? before.toString() : null;
    const defines = { ...material.defines };
    const shaders = new Set();
    csm.setupMaterial(material);
    const csmBefore = material.onBeforeCompile;
    material.onBeforeCompile = function (shader, renderContext) {
      before.call(this, shader, renderContext);
      csmBefore.call(this, shader, renderContext);
      shaders.add(shader);
    };
    material.customProgramCacheKey = function () {
      return `${baseKey ?? cache.call(this)}|lunar-csm-r160-${distances.length}`;
    };
    records.set(material, { before, cache, defines, shaders });
    material.needsUpdate = true;
    return material;
  }

  function update() {
    if (disposed) return;
    camera.updateMatrixWorld();
    if (!projection.equals(camera.projectionMatrix)) {
      csm.updateFrustums();
      updateBounds();
      for (const { shaders } of records.values()) for (const shader of shaders) {
        csm.getExtendedBreaks(shader.uniforms.CSM_cascades.value);
        shader.uniforms.cameraNear.value = camera.near;
        shader.uniforms.shadowFar.value = Math.min(camera.far, maxFar);
      }
    }
    csm.update();
    lightRotation.lookAt(zero, direction, up);
    inverseRotation.copy(lightRotation).invert();
    cameraToLight.multiplyMatrices(inverseRotation, camera.matrixWorld);
    csm.lights.forEach((light, i) => {
      const shadowCamera = light.shadow.camera;
      const texel = (shadowCamera.right - shadowCamera.left) / mapSizes[i];
      // The addon stabilizes every cascade against its common map size.
      // Quantize again to each actual map's coarser texel grid.
      point.copy(light.position).applyMatrix4(inverseRotation);
      point.x = Math.floor(point.x / texel + 1e-5) * texel;
      point.y = Math.floor(point.y / texel + 1e-5) * texel;
      light.position.copy(point.applyMatrix4(lightRotation));
      light.target.position.copy(light.position).add(direction);

      let minZ = Infinity, maxZ = -Infinity;
      const vertices = csm.frustums[i].vertices;
      for (const vertex of [...vertices.near, ...vertices.far]) {
        point.copy(vertex).applyMatrix4(cameraToLight);
        minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
      }
      shadowCamera.far = Math.max(20, maxZ - minZ + csm.lightMargin + 2);
      shadowCamera.updateProjectionMatrix();
      light.shadow.bias = -Math.max(0.0003, texel * 0.25) / (shadowCamera.far - shadowCamera.near);
      light.shadow.normalBias = Math.max(0.0005, texel * 0.15);
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    csm.remove();
    for (const light of csm.lights) {
      light.shadow.map?.dispose();
      light.shadow.mapPass?.dispose();
    }
    for (const [material, record] of records) {
      material.onBeforeCompile = record.before;
      material.customProgramCacheKey = record.cache;
      material.defines = record.defines;
      material.needsUpdate = true;
    }
    records.clear(); csm.shaders.clear();
    Object.assign(THREE.ShaderChunk, originalChunks);
    activeFactory = null;
  }

  const pixels = mapSizes.reduce((sum, size) => sum + size * size, 0);
  const api = {
    setupMaterial, update, dispose, lights: csm.lights,
    settings: { distances, mapSizes, estimatedMapMiB: [pixels * 6 / 2 ** 20, pixels * 8 / 2 ** 20] },
  };
  activeFactory = api;
  update();
  return api;
}
