/*
 * First-person Taurus-Littrow reconstruction: directional sunlight, weak indirect light,
 * no atmospheric scattering, fixed photographic exposure and camera-relative celestial bodies.
 * Terrain and regional reflectance parameters retain their measurement provenance.
 */

import * as THREE from 'three';
import { computeScene } from './ephemeris.js';
import { createTerrain } from './terrain.js';
import { EffectComposer } from '../vendor/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../vendor/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from '../vendor/shaders/FXAAShader.js';
import { OutputPass } from '../vendor/postprocessing/OutputPass.js';
import { SITE, START, EYE_HEIGHT, GRAVITY, MOVE_SPEED, JUMP_SPEED, FOV, BASE_EXPOSURE } from './config.js';
import { FilmShader, SUN_GLARE_SHADER } from './shaders.js';
import { loadElevation, elevationInfo } from './elevation.js';
import { loadRockScans } from './rock-scans.js';
import { loadReflectance, measuredReflectance } from './reflectance.js';
import { createLunarShadows } from './shadows.js';
import { loadNormalDetail, measuredNormalDetail } from './normal-detail.js';

const $ = (id) => document.getElementById(id);


const astro = computeScene(SITE.date, SITE);
const [, rockScans] = await Promise.all([
  loadElevation(SITE, astro.sun.world),
  loadRockScans(matchMedia('(pointer: coarse)').matches),
  loadReflectance(SITE),
  loadNormalDetail(SITE, matchMedia('(pointer: coarse)').matches),
]);


/* ---------------- 渲染器 ---------------- */

const canvas = $('view');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  logarithmicDepthBuffer: true,
  powerPreference: 'high-performance',
});
// 超采样：比 FXAA 更能压锯齿和贴图闪烁，代价是像素量线性上升
const SS = (() => {
  const q = parseFloat(new URLSearchParams(location.search).get('ss') || '');
  if (q > 0) return q;
  return matchMedia('(pointer: coarse)').matches ? 1.0 : 1.4;
})();
renderer.setPixelRatio(Math.min(devicePixelRatio * SS, 2.6));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
// 近场采用窄核阴影；区域阴影另按太阳的有限角直径计算过渡。
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = BASE_EXPOSURE;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(FOV, innerWidth / innerHeight, 0.1, 300000);
camera.rotation.order = 'YXZ';
scene.add(camera);

const urlParams = new URLSearchParams(location.search);
const postDisabled = urlParams.get('post') === '0';
const isTouch = matchMedia('(pointer: coarse)').matches;
const quality = isTouch ? 'low' : 'high';

/* ---------------- 光 ---------------- */

const sunDir = new THREE.Vector3(...astro.sun.world).normalize();
const earthDir = new THREE.Vector3(...astro.earth.world).normalize();

const lunarShadows = createLunarShadows({ scene, camera, renderer, sunDir, quality });

// 极弱的间接光近似；按白昼摄影曝光，背光面仍接近黑色。
const earthShine = new THREE.HemisphereLight(0xb0bdcf, 0x4b4946, 0.004);
scene.add(earthShine);

/* ---------------- 地形 ---------------- */

const terrain = createTerrain({ quality, sunDir, start: START, rockScans, sunAngularRadius: THREE.MathUtils.degToRad(astro.sun.angDiamDeg) / 2 });
scene.add(terrain.group);
terrain.group.traverse(o => { if (o.material) lunarShadows.setupMaterial(o.material); });

/* ---------------- 天体 ---------------- */

const SKY_RADIUS = 100000;

// 太阳：角直径 0.53°，按距离换算实际半径
const sunAngRad = THREE.MathUtils.degToRad(astro.sun.angDiamDeg) / 2;
// HDR 太阳盘和局部光学溢出用于摄影观感；不是绝对辐亮度校准。
const sunDisc = new THREE.Mesh(
  new THREE.SphereGeometry(1, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
sunDisc.material.color.setRGB(3.2, 3.06, 2.86);
sunDisc.scale.setScalar(SKY_RADIUS * Math.tan(sunAngRad));
sunDisc.position.copy(sunDir).multiplyScalar(SKY_RADIUS);
scene.add(sunDisc);

// 太阳辉光（胶片过曝感）
let sunSprite;
{
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d').createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.08, 'rgba(255,253,245,0.95)');
  g.addColorStop(0.3, 'rgba(255,248,232,0.42)');
  g.addColorStop(0.62, 'rgba(255,242,220,0.12)');
  g.addColorStop(1, 'rgba(255,240,215,0)');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    transparent: true, opacity: 0.95,
  }));
  sunSprite.scale.setScalar(SKY_RADIUS * 0.024);
  sunSprite.position.copy(sunDir).multiplyScalar(SKY_RADIUS * 0.999);
  scene.add(sunSprite);
}

// 地球
const earthGroup = new THREE.Group();
earthGroup.position.copy(earthDir).multiplyScalar(SKY_RADIUS);
scene.add(earthGroup);

const earthRadius = SKY_RADIUS * Math.tan(THREE.MathUtils.degToRad(astro.earth.angDiamDeg) / 2);
const earthTex = new THREE.TextureLoader().load('./assets/earth_albedo.jpg');
earthTex.colorSpace = THREE.SRGBColorSpace;
earthTex.anisotropy = 4;

const earthMesh = new THREE.Mesh(
  new THREE.SphereGeometry(1, 64, 48),
  new THREE.MeshStandardMaterial({ map: earthTex, color: 0xffffff, roughness: 1, metalness: 0 })
);
earthMesh.scale.setScalar(earthRadius);
earthGroup.add(earthMesh);

// 地球自转轴倾角 + 朝向（只做视觉，不参与相位计算）
earthMesh.rotation.z = THREE.MathUtils.degToRad(23.44);

// 白昼曝光下不绘制恒星，保留无大气天空的纯黑。

/* ---------------- 后处理 ---------------- */

/**
 * 真实照片之所以不像渲染，很大一部分来自镜头与感光元件：
 * 边缘色散、暗角、胶片颗粒、以及亮部的光学溢出。
 * 这一层用 three.js 官方后处理链做，不手搓噪声。
 */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// 只有太阳级别的亮度才触发溢出，月壤本身不发光
// 半分辨率足够：bloom 本身就是低频模糊，全分辨率只是白白多跑几遍全屏 pass
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(innerWidth * 0.5, innerHeight * 0.5),
  0.62,  // strength
  0.72,  // radius
  0.90   // threshold：只让太阳/高光溢出
);
if (quality === 'high' && !postDisabled) composer.addPass(bloomPass);

const fxaaPass = new ShaderPass(FXAAShader);
function syncFxaa() {
  const pr = renderer.getPixelRatio();
  fxaaPass.material.uniforms['resolution'].value.set(1 / (innerWidth * pr), 1 / (innerHeight * pr));
}
syncFxaa();
composer.addPass(fxaaPass);

// 胶片颗粒 + 暗角：模拟 Apollo 所用的 70 mm 胶片与广角镜
const filmPass = new ShaderPass(FilmShader);

// 把线性场景转为显示空间。后续仅叠加镜头散射和低强度胶片颗粒。
composer.addPass(new OutputPass());

// 太阳附近的局部镜头散射。固定曝光，不按观察方向改变整幅画面亮度。
const sunGlarePass = new ShaderPass(SUN_GLARE_SHADER);
composer.addPass(sunGlarePass);
// 颗粒在显示空间处理，且强度随信号消失，保持未曝光天空的黑位。
composer.addPass(filmPass);

const _camDir = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();

/** 把相机视场写进眩光 uniform：像素 → 世界方向需要 tan(半视场角) */
function updateGlareFrame() {
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5);
  sunGlarePass.material.uniforms.uTanHalf.value.set(t * camera.aspect, t);
}

/**
 * 每帧更新太阳的眩光强度与曝光收缩。
 *
 * 这里不再用"太阳离视轴多远"当开关，而是算真实的角距离：
 * 人眼和镜头都不会因为太阳偏出中心就停止被晃。之前用 smoothstep(facing, .80, .97)
 * 一刀切，等于太阳只要偏到 37° 以外就完全无视——可 16:9 下水平半视场角有 50°，
 * 于是屏幕最边上那一圈看得见太阳、却一点眩光都没有，正好是用户说的"用视线边缘看"。
 */
let sunVis = 0;   // 0 = 太阳在视野外或背后，1 = 正对太阳

/**
 * 角度衰减：th 从 lo 到 hi 单调递减，lo 处为 1，hi 处为 0。
 * 不能直接写 smoothstep(th, 78, 55)——three 的实现里 x <= min 一律返回 0，
 * 反向区间会被整体判成 0，那样太阳摆正中间反而一点眩光都没有。
 */
function falloff(th, lo, hi) {
  return 1 - THREE.MathUtils.smoothstep(th, lo, hi);
}

function updateSunGlare() {
  _camDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
  _camRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
  _camUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  const facing = _camDir.dot(sunDir);

  // 背后彻底关掉本体：sprite 的包围球有 3.4° 半径，贴视野边缘时会被视锥判为
  // 相交而继续绘制，投影翻转后就是一片来路不明的光斑
  const front = facing > -0.05;
  sunSprite.visible = front;
  sunDisc.visible = front;

  const u = sunGlarePass.material.uniforms;
  if (postDisabled || !front) { u.uGlare.value = 0; sunVis = 0; return; }

  const th = Math.acos(Math.min(1, Math.max(-1, facing))) * 57.2957795;

  u.uSunDir.value.copy(sunDir);
  u.uCamFwd.value.copy(_camDir);
  u.uCamRight.value.copy(_camRight);
  u.uCamUp.value.copy(_camUp);

  // 雾光开关：太阳在画面里 → 1，出了画面 4° 就基本收干净。
  // 阈值跟着实际视场算（对角半视场），换窗口比例不会失效——
  // 写死 55° 的话，窄窗口下太阳已经出画了却还在边缘留一团光。
  const tanX = u.uTanHalf.value.x, tanY = u.uTanHalf.value.y;
  const thDiag = Math.atan(Math.hypot(tanX, tanY)) * 57.2957795;
  u.uGlare.value = falloff(th, thDiag - 4, thDiag + 5);

  sunVis = u.uGlare.value;
}

updateGlareFrame();

/* ---------------- 控制与物理 ---------------- */

const state = {
  feet: terrain.heightAt(START.x, START.z),
  vel: 0,
  yaw: THREE.MathUtils.degToRad(88),   // 开场会被 faceIntro 覆盖，此值仅作初值
  pitch: THREE.MathUtils.degToRad(6),
  onGround: true,
  bob: 0,
  keys: new Set(),
  touchMove: { x: 0, y: 0, active: false },
};

camera.position.set(START.x, state.feet + EYE_HEIGHT, START.z);

const pitchLimit = Math.PI / 2 - 0.02;

function applyLook() {
  camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ');
}

addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { document.exitPointerLock(); state.keys.clear(); return; }
  if (e.code === 'KeyH') { document.body.classList.toggle('clean'); return; }
  if (e.code === 'KeyE') { faceEarth(); return; }
  if (e.code === 'KeyQ') { faceSun(); return; }
  state.keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
});

addEventListener('keyup', (e) => state.keys.delete(e.code));
addEventListener('blur', () => { state.keys.clear(); state.touchMove.active = false; });

let locked = false;
canvas.addEventListener('click', () => {
  if (!isTouch && document.pointerLockElement !== canvas) canvas.requestPointerLock();
});

document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
});

document.addEventListener('mousemove', (e) => {
  if (!locked) return;
  const s = 0.0022;
  state.yaw -= e.movementX * s;
  state.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, state.pitch - e.movementY * s));
  applyLook();
});

function faceSun() {
  // 太阳与地球相隔约 154°，不可能同框，只能按键切换
  state.yaw = Math.atan2(-sunDir.x, -sunDir.z);
  state.pitch = Math.asin(THREE.MathUtils.clamp(sunDir.y, -1, 1));
  applyLook();
}

function faceEarth() {
  // 朝向地球，但视线压低一档，让地平线留在画面下缘（正对 48.5° 会满屏黑天）
  state.yaw = Math.atan2(-earthDir.x, -earthDir.z);
  state.pitch = Math.max(0.12, THREE.MathUtils.degToRad(astro.earth.altDeg - 17));
  applyLook();
}

/** 北向侧光开场，保留地面、碎石与北山体的层次。 */
function faceIntro() {
  state.yaw = THREE.MathUtils.degToRad(0);
  state.pitch = THREE.MathUtils.degToRad(-5);
  applyLook();
}

// 调试/联调钩子：便于无头浏览器定点截图，不影响正常交互
window.__moon = {
  astro,
  get elevation() { return elevationInfo(); },
  get reflectance() { return measuredReflectance()?.metadata ?? null; },
  get normalDetail() { const d = measuredNormalDetail(); return d ? { metadata: d.metadata, decodedSize: d.decodedSize } : null; },
  get shadowSettings() { return lunarShadows.settings; },
  camera,
  renderer,
  state,
  look(yawDeg, pitchDeg) {
    state.yaw = THREE.MathUtils.degToRad(yawDeg);
    state.pitch = THREE.MathUtils.degToRad(pitchDeg);
    applyLook();
  },
  setFov(f) {
    camera.fov = f;
    camera.updateProjectionMatrix();
    updateGlareFrame();
  },
  // 观感标定用：直接读当前眩光强度与曝光，免得靠截图猜
  get glare() { return sunGlarePass.material.uniforms.uGlare.value; },
  get sunVis() { return sunVis; },
  get exposure() { return renderer.toneMappingExposure; },
  faceSun,
  faceIntro,
  terrain,                 // 网格与实例缓冲，供截图对账用
  heightAt: terrain.heightAt,
  earthDir: earthDir.toArray(),
  sunDir: sunDir.toArray(),
};

/* 触屏：左半屏虚拟摇杆，右半屏拖拽看向 */
if (isTouch) {
  const touchState = { look: null, move: null };
  const joy = $('joystick');
  const knob = $('knob');

  canvas.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) {
      if (t.clientX < innerWidth * 0.45 && !touchState.move) {
        touchState.move = { id: t.identifier, ox: t.clientX, oy: t.clientY };
        joy.style.left = t.clientX + 'px';
        joy.style.top = t.clientY + 'px';
        joy.classList.add('on');
        knob.style.transform = 'translate(0px, 0px)';
      } else if (!touchState.look) {
        touchState.look = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (touchState.move && t.identifier === touchState.move.id) {
        let dx = t.clientX - touchState.move.ox;
        let dy = t.clientY - touchState.move.oy;
        const max = 52;
        const d = Math.hypot(dx, dy);
        if (d > max) { dx *= max / d; dy *= max / d; }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        state.touchMove.x = dx / max;
        state.touchMove.y = dy / max;
        state.touchMove.active = true;
      } else if (touchState.look && t.identifier === touchState.look.id) {
        const s = 0.0045;
        state.yaw -= (t.clientX - touchState.look.x) * s;
        state.pitch = Math.max(-pitchLimit, Math.min(pitchLimit, state.pitch - (t.clientY - touchState.look.y) * s));
        touchState.look.x = t.clientX;
        touchState.look.y = t.clientY;
        applyLook();
      }
    }
    if (e.cancelable) e.preventDefault();
  }, { passive: false });

  const endTouch = (e) => {
    for (const t of e.changedTouches) {
      if (touchState.move && t.identifier === touchState.move.id) {
        touchState.move = null;
        state.touchMove.x = state.touchMove.y = 0;
        state.touchMove.active = false;
        joy.classList.remove('on');
      }
      if (touchState.look && t.identifier === touchState.look.id) touchState.look = null;
    }
  };
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);

  $('jumpBtn').addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (state.onGround) { state.vel = JUMP_SPEED; state.onGround = false; }
  }, { passive: false });
}

/* ---------------- 主循环 ---------------- */

const clock = new THREE.Clock();
let perfFrames = 0;
let perfStart = 0;
let perfChecked = false;

function animate() {
  const dt = Math.min(clock.getDelta(), 0.05);

  // 输入
  let fwd = 0, side = 0;
  if (state.keys.has('KeyW') || state.keys.has('ArrowUp')) fwd += 1;
  if (state.keys.has('KeyS') || state.keys.has('ArrowDown')) fwd -= 1;
  if (state.keys.has('KeyA') || state.keys.has('ArrowLeft')) side -= 1;
  if (state.keys.has('KeyD') || state.keys.has('ArrowRight')) side += 1;

  if (state.touchMove.active) {
    fwd -= state.touchMove.y;
    side += state.touchMove.x;
  }

  const moving = fwd !== 0 || side !== 0;
  const speed = MOVE_SPEED;
  const len = Math.hypot(fwd, side) || 1;
  const vf = (fwd / len) * speed;
  const vs = (side / len) * speed;

  const sinY = Math.sin(state.yaw), cosY = Math.cos(state.yaw);
  const dx = (-sinY * vf + cosY * vs) * dt;
  const dz = (-cosY * vf - sinY * vs) * dt;

  camera.position.x += dx;
  camera.position.z += dz;

  // Collision reads the mesh that will be rendered in this frame.
  terrain.update(camera.position.x, camera.position.z);

  // 垂直：跳跃与落地
  if (state.keys.has('Space') && state.onGround) {
    state.vel = JUMP_SPEED;
    state.onGround = false;
  }

  const groundY = terrain.heightAt(camera.position.x, camera.position.z);
  if (state.onGround) {
    state.feet = groundY;
    state.vel = 0;
  } else {
    state.vel -= GRAVITY * dt;
    state.feet += state.vel * dt;
    if (state.feet <= groundY) {
      state.feet = groundY;
      state.vel = 0;
      state.onGround = true;
    }
  }

  // 行走时的轻微起伏
  let bobOffset = 0;
  if (moving && state.onGround) {
    state.bob += dt * 7.5;
    bobOffset = Math.sin(state.bob) * 0.018;
  }
  // Visual bob must not become accumulated physical height or trigger a fall.
  camera.position.y = state.feet + EYE_HEIGHT + bobOffset;

  // Cascades keep the near shadow grid precise while covering the walking view.
  lunarShadows.update();
  // 天体方向与视直径不应随着步行产生近景视差；放在全部地形之后。
  sunDisc.position.copy(camera.position).addScaledVector(sunDir, SKY_RADIUS);
  sunSprite.position.copy(camera.position).addScaledVector(sunDir, SKY_RADIUS * 0.999);
  earthGroup.position.copy(camera.position).addScaledVector(earthDir, SKY_RADIUS);

  updateSunGlare();
  renderer.toneMappingExposure = BASE_EXPOSURE;

  filmPass.material.uniforms.uTime.value = clock.elapsedTime;

  if (postDisabled) {
    renderer.render(scene, camera);
  } else {
    // 开跑 4 秒后量一次帧率，太慢就先把最贵的 bloom 关掉（FXAA 与颗粒保留）
    if (!perfChecked) {
      perfFrames++;
      if (!perfStart) perfStart = performance.now();
      const elapsed = (performance.now() - perfStart) / 1000;
      if (elapsed > 4) {
        perfChecked = true;
        if (perfFrames / elapsed < 26 && bloomPass.enabled) bloomPass.enabled = false;
      }
    }
    composer.render();
  }

  requestAnimationFrame(animate);
}

/* ---------------- 启动 ---------------- */

function fillStaticHud() {
  $('siteName').textContent = SITE.name;
  $('siteCoord').textContent = `${SITE.lat.toFixed(4)}°N  ${SITE.lon.toFixed(4)}°E`;
  $('siteTime').textContent = '1972-12-11 19:54:57 UTC';


  // 开场卡片上的同一组数值（两处显示，便于核对）
  $('fSunAlt').textContent = `${astro.sun.altDeg.toFixed(2)}°`;
  $('fEarthAlt').textContent = `${astro.earth.altDeg.toFixed(2)}°`;
  $('fEarthDiam').textContent = `${astro.earth.angDiamDeg.toFixed(3)}°`;
  $('fEarthIllum').textContent = `${(astro.earth.illum * 100).toFixed(1)}%`;
  $('fEarthDist').textContent = `${Math.round(astro.distanceKm).toLocaleString()} km`;
  $('fHorizon').textContent = `${astro.horizonKm.toFixed(2)} km`;
}

applyLook();
fillStaticHud();
faceIntro();
animate();

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  if (bloomPass.resolution) bloomPass.resolution.set(innerWidth * 0.5, innerHeight * 0.5);
  updateGlareFrame();
  syncFxaa();
});

$('enterBtn')?.addEventListener('click', () => {
  $('intro').classList.add('gone');
  setTimeout(() => $('intro').remove(), 600);
  if (!isTouch) canvas.requestPointerLock();
  faceIntro();
});
