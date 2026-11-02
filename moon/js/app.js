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
// 超采样：比 FXAA 更能压锯齿和贴图闪烁，代价是像素量线性上升
const SS = (() => {
  const q = parseFloat(new URLSearchParams(location.search).get('ss') || '');
  if (q > 0) return q;
  return matchMedia('(pointer: coarse)').matches ? 1.0 : 1.4;
})();
renderer.setPixelRatio(Math.min(devicePixelRatio * SS, 2.6));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
// 月面是绝对硬阴影（无大气散射），PCFSoft 的宽核会把 20 cm 碎块的影子糊成一摊。
// PCFShadowMap 的 3×3 采样在 2.2 cm texel 下边缘约 4 cm，接近照片的锐度。
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const BASE_EXPOSURE = 0.56;  // Hapke 比 Lambert 亮 2–4 倍，曝光重定标
renderer.toneMappingExposure = BASE_EXPOSURE;
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

/*
 * 阴影精度必须按「低太阳角」标定，这是之前影子脱离石块的根因。
 *
 * shadow map 的 texel 是垂直于光线方向的尺寸，投到地面上要除以 sin(太阳高度)：
 * 太阳只有 13.85° 时，沿地面方向被拉伸 1/sin(13.85°) ≈ 4.2 倍。
 * 旧配置 180 m / 2048 = 8.8 cm 的 texel，落到地面上就是 37 cm 的有效分辨率，
 * 20–50 cm 的石块根本留不住自己的影子；为了压掉阴影 acne 又把 normalBias 加到 3.5 cm，
 * 而 normalBias 造成的偏移动量约为 bias/tan(太阳高度)，于是影子被整体推开十几厘米，
 * 石头和影子之间就出现那道缝。
 *
 * 现在：范围收到 ±45 m、贴图 4096，texel 2.2 cm（地面约 9 cm），normalBias 降到 6 mm，
 * 偏移量约 2.4 cm，缝隙落到石块自身轮廓以内。范围外没有影子——但那个距离上的石块
 * 只有几个像素，看不出来；近处 45 m 的锐利才是照片的观感来源。
 */
const shadowSpan = 30;
const shadowMap = Math.min(isTouch ? 2048 : 4096, renderer.capabilities.maxTextureSize);
sunLight.shadow.mapSize.set(shadowMap, shadowMap);
sunLight.shadow.camera.left = -shadowSpan;
sunLight.shadow.camera.right = shadowSpan;
sunLight.shadow.camera.top = shadowSpan;
sunLight.shadow.camera.bottom = -shadowSpan;
// 光源挂在 420 m 外，深度范围只留 250–640，深度精度全给这一段
sunLight.shadow.camera.near = 250;
sunLight.shadow.camera.far = 640;
sunLight.shadow.bias = -0.000015;
sunLight.shadow.normalBias = 0.0042;
sunLight.shadow.camera.updateProjectionMatrix();
scene.add(sunLight);
scene.add(sunLight.target);

// 地球反照光：满地球时月面背光侧照度约 0.02–0.05 lux 量级，
// 加一层极弱冷色环境光，让背对太阳的地面保留轮廓而不是纯黑（阿波罗宇航员目视亦如此）
const earthShine = new THREE.HemisphereLight(0x2f3b57, 0x17140f, 0.16);
scene.add(earthShine);

/* ---------------- 地形 ---------------- */

const terrain = createTerrain({ quality, sunDir });
scene.add(terrain.group);

/* ---------------- 天体 ---------------- */

const SKY_RADIUS = 11000;

// 太阳：角直径 0.53°，按距离换算实际半径
const sunAngRad = THREE.MathUtils.degToRad(astro.sun.angDiamDeg) / 2;
/*
 * 太阳的亮度必须给到 HDR 量级（线性值 3 以上），不能只给 1.0。
 * 月面上太阳的照度约 1.3×10⁵ lux，比月面本身亮 6 个数量级；
 * 给 1.0 的话过曝刚好卡在白色，既不会有强溢光，也就不可能"刺眼"。
 * 3.2 经过 ACES 仍然是白，但 bloom 是在 tone mapping 之前取样的，会明显溢出。
 */
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
  sunSprite.scale.setScalar(SKY_RADIUS * 0.095);
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

/*
 * 太阳眩光（放在 OutputPass 之后，直接在显示空间叠加）。
 *
 * 月球上没有大气，太阳是一个 0.53° 的锐利白盘——但那不代表"能舒服地看"。
 * 真实情况是照度 1.3×10⁵ lux，直视会瞬间致盲，人眼会立刻收缩瞳孔、流泪，
 * 视野里只剩一片白和被烧出来的残影。
 *
 * 这里做两件事：太阳附近叠加强过曝（核心 + 光晕 + 光圈叶片的六道星芒），
 * 同时把周围画面压暗——"亮处更亮、暗处更暗"才是刺眼的来源，
 * 只加白只会变成一个更大的白点，反而更不刺眼。
 */
const SUN_GLARE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
    uGlare: { value: 0 },
    uAspect: { value: 1 },
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
    uniform vec2 uSunUV;
    uniform float uGlare;
    uniform float uAspect;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      if (uGlare > 0.002) {
        vec2 p = (vUv - uSunUV) * vec2(uAspect, 1.0);
        float d = length(p);

        float core = exp(-d * 9.0) * 1.22;          // 太阳本体附近彻底过曝
        float halo = exp(-d * 3.0) * 0.28;           // 中层雾光，范围要收得住
        float ang = atan(p.y, p.x);
        // 六道光圈叶片，细而短；真实镜头是细线，不是粗光柱
        float rays = pow(abs(cos(ang * 3.0 + 0.72)), 130.0) * exp(-d * 7.0) * 0.36;
        vec3 add = vec3(1.0, 0.963, 0.918) * (core + halo + rays) * uGlare;

        // 瞳孔收缩：直视太阳时周围明显变暗，暗处变暗才是"刺眼"的来源。
        // 只加白不压暗，只会让整个画面更亮，反而不刺眼。
        float dim = 1.0 - 0.22 * uGlare * exp(-d * 1.6);
        c.rgb = c.rgb * dim + add;
      }

      gl_FragColor = c;
    }
  `,
};
const sunGlarePass = new ShaderPass(SUN_GLARE_SHADER);
composer.addPass(sunGlarePass);

const _camDir = new THREE.Vector3();
const _sunNDC = new THREE.Vector3();

/**
 * 每帧更新太阳的眩光强度与屏幕位置。
 * 同时把"背后"的太阳本体彻底关掉——sprite 的包围球有 3.4° 的半径，
 * 贴在视野边缘时会被视锥判为相交而继续绘制，投影翻转后就是一片莫名其妙的光斑。
 */
let sunVis = 0;   // 0 = 太阳在视野外或背后，1 = 正对太阳

function updateSunGlare() {
  _camDir.set(0, 0, -1).applyQuaternion(camera.quaternion);
  const facing = _camDir.dot(sunDir);
  const front = facing > -0.02;
  sunSprite.visible = front;
  sunDisc.visible = front;

  const u = sunGlarePass.material.uniforms;
  if (postDisabled || !front) { u.uGlare.value = 0; sunVis = 0; return; }

  // 只有真的把视线转到太阳上才触发。太阳在视野边上（开场视角离轴约 32°，
  // facing≈0.85）时不该压暗，否则玩家会觉得画面莫名其妙地发灰。
  const vis = THREE.MathUtils.smoothstep(facing, 0.80, 0.97);
  if (vis <= 0.002) { u.uGlare.value = 0; sunVis = 0; return; }

  camera.updateMatrixWorld();
  _sunNDC.copy(sunDir).multiplyScalar(SKY_RADIUS).project(camera);
  u.uSunUV.value.set(_sunNDC.x * 0.5 + 0.5, _sunNDC.y * 0.5 + 0.5);
  u.uGlare.value = vis;
  sunVis = vis;
}

sunGlarePass.material.uniforms.uAspect.value = innerWidth / innerHeight;

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

  updateSunGlare();
  // 直视太阳时的"收曝光"：这是刺眼的核心，不是靠屏幕叠加白光。
  // 真实相机/人眼对 1.3×10⁵ lux 会立刻把曝光拉下去，除了太阳，整个画面都沉下去。
  renderer.toneMappingExposure = BASE_EXPOSURE * (1 - 0.60 * sunVis);

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
  sunGlarePass.material.uniforms.uAspect.value = innerWidth / innerHeight;
  syncFxaa();
});

$('enterBtn')?.addEventListener('click', () => {
  $('intro').classList.add('gone');
  setTimeout(() => $('intro').remove(), 600);
  if (!isTouch) canvas.requestPointerLock();
  faceIntro();
});
