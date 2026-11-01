/*
 * app.js — 月面第一人称漫游主程序
 *
 * 渲染原则（都按真空 + 真实光照来）：
 *  - 场景只有一盏方向光（太阳），无环境光、无补光 => 背光面纯黑，和照片一致
 *  - 天空纯黑，无雾、无大气散射
 *  - 地球用真实纹理 + 同一盏太阳光照明，因此相位是算出来的，不是画上去的
 *  - 重力 1.62 m/s²，眼高 1.7 m，走速 1.6 m/s（阿波罗月面行走实测量级）
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

const $ = (id) => document.getElementById(id);

/* ---------------- 站点与时刻 ---------------- */

const SITE = {
  name: '陶拉斯-利特罗谷',
  lat: 20.1908,
  lon: 30.7717,
  date: new Date(Date.UTC(1972, 11, 11, 19, 54, 57)), // 阿波罗 17 号着陆时刻
};

const EYE_HEIGHT = 1.7;
const GRAVITY = 1.62;
// 统一为快走速度（阿波罗 17 号实测月面平均行走约 1.4 m/s，小跑可到 2.5–3 m/s）
const MOVE_SPEED = 2.6;
const JUMP_SPEED = 1.9; // 起跳速度 => 跳高约 1.1 m，滞空约 2.3 s

const astro = computeScene(SITE.date, SITE);

/* ---------------- 渲染器 ---------------- */

const canvas = $('view');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  logarithmicDepthBuffer: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.84;  // 对齐阿波罗照片的曝光：月壤应落在中灰
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 30000);
camera.rotation.order = 'YXZ';
scene.add(camera);

const urlParams = new URLSearchParams(location.search);
const postDisabled = urlParams.get('post') === '0';
const isTouch = matchMedia('(pointer: coarse)').matches;
const quality = isTouch ? 'low' : 'high';

/* ---------------- 光 ---------------- */

const sunDir = new THREE.Vector3(...astro.sun.world).normalize();
const earthDir = new THREE.Vector3(...astro.earth.world).normalize();

const sunLight = new THREE.DirectionalLight(0xfff6ea, 5.2);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(isTouch ? 1024 : 2048, isTouch ? 1024 : 2048);
const shadowSpan = 90;
sunLight.shadow.camera.left = -shadowSpan;
sunLight.shadow.camera.right = shadowSpan;
sunLight.shadow.camera.top = shadowSpan;
sunLight.shadow.camera.bottom = -shadowSpan;
sunLight.shadow.camera.near = 1;
sunLight.shadow.camera.far = 900;
sunLight.shadow.bias = -0.0006;
sunLight.shadow.normalBias = 0.035;
scene.add(sunLight);
scene.add(sunLight.target);

// 地球反照光：满地球时月面背光侧照度约 0.02–0.05 lux 量级，
// 加一层极弱冷色环境光，让背对太阳的地面保留轮廓而不是纯黑（阿波罗宇航员目视亦如此）
const earthShine = new THREE.HemisphereLight(0x2f3b57, 0x17140f, 0.26);
scene.add(earthShine);

/* ---------------- 地形 ---------------- */

const terrain = createTerrain({ quality });
scene.add(terrain.group);

/* ---------------- 天体 ---------------- */

const SKY_RADIUS = 11000;

// 太阳：角直径 0.53°，按距离换算实际半径
const sunAngRad = THREE.MathUtils.degToRad(astro.sun.angDiamDeg) / 2;
const sunDisc = new THREE.Mesh(
  new THREE.SphereGeometry(1, 24, 16),
  new THREE.MeshBasicMaterial({ color: 0xffffff })
);
sunDisc.scale.setScalar(SKY_RADIUS * Math.tan(sunAngRad));
sunDisc.position.copy(sunDir).multiplyScalar(SKY_RADIUS);
scene.add(sunDisc);

// 太阳辉光（胶片过曝感）
{
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d').createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1.0)');
  g.addColorStop(0.08, 'rgba(255,253,245,0.92)');
  g.addColorStop(0.3, 'rgba(255,248,232,0.30)');
  g.addColorStop(0.62, 'rgba(255,242,220,0.07)');
  g.addColorStop(1, 'rgba(255,240,215,0)');
  const ctx = c.getContext('2d');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true,
    transparent: true, opacity: 0.9,
  }));
  sprite.scale.setScalar(SKY_RADIUS * 0.085);
  sprite.position.copy(sunDir).multiplyScalar(SKY_RADIUS * 0.999);
  scene.add(sprite);
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
  new THREE.MeshStandardMaterial({ map: earthTex, color: 0xffffff, roughness: 0.62, metalness: 0, emissive: 0x2b405f, emissiveIntensity: 0.75 })
);
earthMesh.scale.setScalar(earthRadius);
earthGroup.add(earthMesh);

// 地球自转轴倾角 + 朝向（只做视觉，不参与相位计算）
earthMesh.rotation.z = THREE.MathUtils.degToRad(23.44);

// 星空：月球白昼看不见星（阿波罗照片天空纯黑），只留近乎不可见的一层，避免和太阳混淆
{
  const N = 2600;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1;
    const th = Math.random() * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    pos[i * 3] = Math.cos(th) * r * 20000;
    pos[i * 3 + 1] = u * 20000;
    pos[i * 3 + 2] = Math.sin(th) * r * 20000;
    const b = 0.35 + Math.pow(Math.random(), 3) * 0.65;
    col[i * 3] = b; col[i * 3 + 1] = b * 0.98; col[i * 3 + 2] = b * 0.94;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 1.6, sizeAttenuation: false, vertexColors: true,
    transparent: true, opacity: 0.035, depthWrite: false, depthTest: true,
  }));
  scene.add(stars);
}

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
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.022 },
    uVignette: { value: 0.20 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453123);
    }

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      // 暗角：真实镜头边缘衰减，月球照片同样存在
      vec2 d = vUv - 0.5;
      float vig = 1.0 - uVignette * dot(d, d) * 1.75;
      c.rgb *= clamp(vig, 0.0, 1.0);

      // 胶片颗粒：暗部更明显（高感光底片的特性）
      float lum = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      float g = hash(vUv * vec2(1280.0, 800.0) + fract(uTime) * 91.7) - 0.5;
      c.rgb += g * uGrain * (1.0 - lum * 0.55);

      gl_FragColor = c;
    }
  `,
};
const filmPass = new ShaderPass(FilmShader);
composer.addPass(filmPass);

// 必须是最后一个 pass：EffectComposer 的 render target 保持线性空间，
// 色调映射与 sRGB 转换只在直接渲染到屏幕时自动发生，中间层不会
composer.addPass(new OutputPass());

/* ---------------- 控制与物理 ---------------- */

const state = {
  feet: terrain.heightAt(0, 0),
  vel: 0,
  yaw: THREE.MathUtils.degToRad(88),   // 开场会被 faceIntro 覆盖，此值仅作初值
  pitch: THREE.MathUtils.degToRad(6),
  onGround: true,
  bob: 0,
  keys: new Set(),
  touchMove: { x: 0, y: 0, active: false },
};

camera.position.set(0, state.feet + EYE_HEIGHT, 0);

const pitchLimit = Math.PI / 2 - 0.02;

function applyLook() {
  camera.rotation.set(state.pitch, state.yaw, 0, 'YXZ');
}

addEventListener('keydown', (e) => {
  if (e.code === 'KeyE') { faceEarth(); return; }
  if (e.code === 'KeyQ') { faceSun(); return; }
  state.keys.add(e.code);
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
});

addEventListener('keyup', (e) => state.keys.delete(e.code));

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

/** 开场：侧光方位，太阳与谷地同时入画（正对地球会背光，地面全黑） */
function faceIntro() {
  state.yaw = THREE.MathUtils.degToRad(-60);
  state.pitch = THREE.MathUtils.degToRad(8);
  applyLook();
}

// 调试/联调钩子：便于无头浏览器定点截图，不影响正常交互
window.__moon = {
  astro,
  camera,
  state,
  look(yawDeg, pitchDeg) {
    state.yaw = THREE.MathUtils.degToRad(yawDeg);
    state.pitch = THREE.MathUtils.degToRad(pitchDeg);
    applyLook();
  },
  setFov(f) {
    camera.fov = f;
    camera.updateProjectionMatrix();
  },
  faceSun,
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

  // 垂直：跳跃与落地
  if (state.keys.has('Space') && state.onGround) {
    state.vel = JUMP_SPEED;
    state.onGround = false;
  }

  state.vel -= GRAVITY * dt;
  camera.position.y += state.vel * dt;

  const groundY = terrain.heightAt(camera.position.x, camera.position.z) + EYE_HEIGHT;
  if (camera.position.y <= groundY) {
    camera.position.y = groundY;
    state.vel = 0;
    state.onGround = true;
  } else {
    state.onGround = false;
  }

  // 行走时的轻微起伏
  if (moving && state.onGround) {
    state.bob += dt * 7.5;
    camera.position.y += Math.sin(state.bob) * 0.018;
  }

  // 地形分档重建
  terrain.update(camera.position.x, camera.position.z);

  // 太阳光跟随（阴影相机跟着人走）
  sunLight.position.copy(camera.position).addScaledVector(sunDir, 420);
  sunLight.target.position.copy(camera.position);

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
  syncFxaa();
});

$('enterBtn')?.addEventListener('click', () => {
  $('intro').classList.add('gone');
  setTimeout(() => $('intro').remove(), 600);
  if (!isTouch) canvas.requestPointerLock();
  faceIntro();
});
