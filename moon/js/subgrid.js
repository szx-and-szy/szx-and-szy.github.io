import * as THREE from 'three';
import { SUBGRID_CONFIG, makeSquareTriangleSampler } from './subgrid-field.js';

// A statistical surface below the measured DEM resolution, not reconstructed
// Apollo crater locations. Generation stays off the animation thread.
export function createSubgrid({ ground, material, group, enabled, uvScale, onCommit }) {
  if (!enabled) return { mesh: null, status: { enabled: false, ready: false, error: null },
    setCoarse() {}, update() {}, replacesBaseAt() { return false; }, heightAt() { return NaN; } };
  const config = SUBGRID_CONFIG;
  const active = { value: 0 };
  const centerUniform = { value: new THREE.Vector2() };
  const status = { enabled: !!enabled, ready: false, requested: 0, accepted: 0,
    discarded: 0, error: null, buildMs: 0, commitMs: 0, center: null };
  let worker = null, inFlight = false, desired = null, generation = 0;
  let coarse = null, fineAt = null, lastAccepted = null;
  const n = config.segments + 1;
  const geometry = new THREE.BufferGeometry();
  const index = new Uint32Array(config.segments * config.segments * 6);
  for (let j = 0, k = 0; j < config.segments; j++) for (let i = 0; i < config.segments; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    index[k++] = a; index[k++] = c; index[k++] = b;
    index[k++] = b; index[k++] = c; index[k++] = d;
  }
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.setAttribute('aRegional', new THREE.BufferAttribute(new Float32Array(n * n).fill(-1), 1));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'Statistical metre-scale terrain';
  mesh.visible = false;
  mesh.castShadow = mesh.receiveShadow = true;
  group.add(mesh);

  if (enabled) {
    const before = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
    material.onBeforeCompile = function(shader, renderer) {
      before.call(this, shader, renderer);
      shader.uniforms.uSubgridActive = active;
      shader.uniforms.uSubgridCenter = centerUniform;
      shader.fragmentShader = shader.fragmentShader
        .replace('varying float vRegional;', 'varying float vRegional;\nuniform float uSubgridActive;\nuniform vec2 uSubgridCenter;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (uSubgridActive > 0.5 && vRegional >= -0.5 &&
      max(abs(vWPos.x-uSubgridCenter.x),abs(vWPos.z-uSubgridCenter.y)) < ${config.cutoutHalfM.toFixed(2)}) discard;`);
    };
    material.customProgramCacheKey = () => `${cacheKey.call(material)}|subgrid-v1`;
    material.needsUpdate = true;

    // The invisible coarse floor must also be absent from the shadow pass;
    // otherwise negative-height bowls would sit beneath an invisible caster.
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.onBeforeCompile = shader => {
      shader.uniforms.uSubgridActive = active;
      shader.uniforms.uSubgridCenter = centerUniform;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vSubgridXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSubgridXZ=(modelMatrix*vec4(transformed,1.0)).xz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vSubgridXZ;\nuniform float uSubgridActive;\nuniform vec2 uSubgridCenter;')
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (uSubgridActive > 0.5 &&
      max(abs(vSubgridXZ.x-uSubgridCenter.x),abs(vSubgridXZ.y-uSubgridCenter.y)) < ${config.cutoutHalfM.toFixed(2)}) discard;`);
    };
    depth.customProgramCacheKey = () => 'subgrid-depth-v1';
    ground.customDepthMaterial = depth;
    try {
      worker = new Worker(new URL('./subgrid-worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        inFlight = false;
        if (data.error) { fail(data.error); return; }
        const request = workerRequest;
        if (!request || data.id !== request.id || request.generation !== generation ||
            request.x !== desired?.x || request.z !== desired?.z) {
          status.discarded++; dispatch(); return;
        }
        const begin = performance.now();
        for (const [name, values, size] of [['position', data.positions, 3], ['normal', data.normals, 3],
          ['uv', data.uv, 2], ['color', data.colors, 3]]) {
          if (!values || values.length !== n * n * size || !values.every(Number.isFinite)) {
            fail('Invalid subgrid worker geometry'); return;
          }
          const attr = geometry.getAttribute(name);
          if (attr) { attr.array.set(values); attr.needsUpdate = true; }
          else geometry.setAttribute(name, new THREE.BufferAttribute(values, size).setUsage(THREE.DynamicDrawUsage));
        }
        geometry.computeBoundingSphere();
        fineAt = makeSquareTriangleSampler(geometry.getAttribute('position').array, n, request.x, request.z, config.tileSizeM);
        centerUniform.value.set(request.x, request.z);
        lastAccepted = { ...request };
        status.center = [request.x, request.z];
        status.ready = true; status.accepted++; status.buildMs = data.stats?.buildMs ?? 0;
        status.stats = data.stats;
        active.value = 1; mesh.visible = true;
        onCommit();
        status.commitMs = performance.now() - begin;
        dispatch();
      };
      worker.onerror = event => { event.preventDefault(); fail(event.message || 'Subgrid worker failed'); };
    } catch (error) { fail(error.message); }
  }

  let workerRequest = null;
  function fail(message) {
    status.error = String(message); status.ready = false; status.enabled = false;
    active.value = 0; mesh.visible = false; fineAt = null;
    worker?.terminate(); worker = null; inFlight = false;
    onCommit();
    console.warn('Metre-scale surface unavailable; using measured terrain:', message);
  }
  function dispatch() {
    if (!worker || inFlight || !coarse || !desired) return;
    if (lastAccepted?.x === desired.x && lastAccepted?.z === desired.z && lastAccepted?.generation === generation) return;
    const position = ground.geometry.getAttribute('position').array.slice();
    const color = ground.geometry.getAttribute('color').array.slice();
    workerRequest = { id: ++status.requested, generation, ...desired };
    inFlight = true;
    worker.postMessage({ id: workerRequest.id, coarsePosition: position, coarseColor: color,
      coarseCols: coarse.cols, coarseCenterX: coarse.x, coarseCenterZ: coarse.z,
      coarseSizeM: 240, centerX: desired.x, centerZ: desired.z, uvScale }, [position.buffer, color.buffer]);
  }
  return {
    mesh,
    get status() { return { ...status, inFlight, generation }; },
    setCoarse(x, z) {
      const p = ground.geometry.getAttribute('position');
      coarse = { x, z, cols: Math.sqrt(p.count) };
      generation++;
    },
    update(x, z) {
      desired = { x: Math.round(x / 8) * 8, z: Math.round(z / 8) * 8 };
      dispatch();
    },
    heightAt(x, z) {
      if (!fineAt || !lastAccepted || Math.max(Math.abs(x-lastAccepted.x), Math.abs(z-lastAccepted.z)) > config.halfM) return NaN;
      return fineAt(x, z);
    },
    replacesBaseAt(x, z) {
      return !!fineAt && Math.max(Math.abs(x-lastAccepted.x), Math.abs(z-lastAccepted.z)) < config.cutoutHalfM;
    },
  };
}
