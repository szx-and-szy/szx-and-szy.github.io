/*
 * shaders.js — 纯数据：胶片颗粒/暗角 与 太阳眩光。
 * 只放 GLSL 与 uniform 声明，不含任何场景状态，便于单独对照。
 */

import * as THREE from 'three';

export const FilmShader = {
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

export const SUN_GLARE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uSunDir: { value: new THREE.Vector3(0, 0, -1) },
    uCamFwd: { value: new THREE.Vector3(0, 0, -1) },
    uCamRight: { value: new THREE.Vector3(1, 0, 0) },
    uCamUp: { value: new THREE.Vector3(0, 1, 0) },
    uTanHalf: { value: new THREE.Vector2(1, 1) },   // tan(fovX/2), tan(fovY/2)
    uGlare: { value: 0 },
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
    uniform vec3 uSunDir;
    uniform vec3 uCamFwd;
    uniform vec3 uCamRight;
    uniform vec3 uCamUp;
    uniform vec2 uTanHalf;
    uniform float uGlare;
    varying vec2 vUv;

    const float R2D = 57.2957795;

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);

      if (uGlare > 0.002) {
        // 每个像素还原成世界方向，再和太阳方向求夹角。
        // 之前是拿太阳的屏幕坐标算像素距离，问题是太阳一偏出画面，
        // 投影就发散（w→0），距离变成天文数字，眩光直接归零——
        // 于是"太阳在视野边缘"和"太阳不存在"是同一个结果。角度不会发散。
        vec2 ndc = vUv * 2.0 - 1.0;
        vec3 dir = normalize(uCamFwd
                           + uCamRight * (ndc.x * uTanHalf.x)
                           + uCamUp    * (ndc.y * uTanHalf.y));
        float th = acos(clamp(dot(dir, uSunDir), -1.0, 1.0)) * R2D;

        // 眼内散射 / 镜头雾光。Stiles–Holladay 是 1/θ²，那条尾巴掉得太快：
        // 45° 就只剩 3%，可人眼在 45° 依然觉得晃。这里用 1/θ^1.5 把尾巴拉长，
        // 让雾光一直铺到画面边缘，同时中心仍然迅速推白。
        float veil = 0.62 / (1.0 + pow(th / 11.0, 1.5));

        // 太阳本体的过曝核，只在几度以内，bloom 之外再补一层
        float core = 1.55 * exp(-th * 0.20);

        // 六叶光圈星芒。太阳正对天顶时 cross((0,1,0), 太阳) 退化成零向量，
        // normalize 会吐 NaN，整幅画面变黑——换一个参考轴就行。
        vec3 upRef = abs(uSunDir.y) > 0.999 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
        vec3 sRight = normalize(cross(upRef, uSunDir));
        vec3 sUp = cross(uSunDir, sRight);
        float ang = atan(dot(dir, sUp), dot(dir, sRight));
        float rays = pow(abs(cos(ang * 3.0 + 0.72)), 130.0) * exp(-th * 0.20) * 0.42;

        vec3 add = vec3(1.0, 0.963, 0.918) * (core + veil + rays) * uGlare;

        // 强光把附近压下去。范围只到 20° 左右，更远的对比损失交给上面那层雾光——
        // 雾光是"提黑"，压暗是"压亮"，两件事的方向不一样，不能混着做。
        float dim = 1.0 - 0.30 * uGlare * exp(-th * 0.05);
        c.rgb = c.rgb * dim + add;
      }

      gl_FragColor = c;
    }
  `,
};
