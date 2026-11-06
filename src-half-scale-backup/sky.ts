import * as THREE from 'three';
import { BlockId, BLOCKS } from './blocks';

export class SkySystem {
  private scene: THREE.Scene;
  public sunLight: THREE.DirectionalLight;
  public hemiLight: THREE.HemisphereLight;
  public torchLight: THREE.PointLight;
  public fog: THREE.FogExp2;

  private skyMesh: THREE.Mesh;
  private skyMat: THREE.ShaderMaterial;
  private cloudsGroup: THREE.Group;

  private godRayMesh: THREE.Mesh;
  private godRayMat: THREE.ShaderMaterial;
  private rayIntensitySmooth = 0;

  // Dynamic Weather System (Clear / Mystic Rain / Alpine Snow)
  public weatherMode: 'clear' | 'rain' | 'snow' = 'clear';
  private weatherPoints: THREE.Points;
  private weatherGeo: THREE.BufferGeometry;
  private weatherMat: THREE.PointsMaterial;
  private lightningFlash = 0;

  public timeOfDay = 0.36;
  public autoCycle = true;
  public torchEnabled = false;
  private elapsedSeconds = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.fog = new THREE.FogExp2(0x8ec5fc, 0.0045);
    this.scene.fog = this.fog;

    this.hemiLight = new THREE.HemisphereLight(0xdff2ff, 0x4b5e3c, 0.78);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff6e5, 1.35);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 2;
    this.sunLight.shadow.camera.far = 170;
    const d = 52;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    this.torchLight = new THREE.PointLight(0xffaa44, 0, 18, 1.6);
    this.scene.add(this.torchLight);

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTopColor: { value: new THREE.Color(0x2563eb) },
        uHorizonColor: { value: new THREE.Color(0xbae6fd) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.2).normalize() },
        uSunColor: { value: new THREE.Color(0xfff3c4) },
        uNightAmount: { value: 0.0 },
        uStarAngle: { value: 0.0 },
        uTime: { value: 0.0 },
      },
      vertexShader: `
        varying vec3 vWorldDirection;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldDirection = normalize(position);
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec3 vWorldDirection;
        uniform vec3 uTopColor;
        uniform vec3 uHorizonColor;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uNightAmount;
        uniform float uStarAngle;
        uniform float uTime;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }

        // Rotate vector around a tilted celestial pole axis (like Polaris)
        vec3 rotateAroundAxis(vec3 v, vec3 axis, float angle) {
          float s = sin(angle);
          float c = cos(angle);
          return v * c + cross(axis, v) * s + axis * dot(axis, v) * (1.0 - c);
        }

        // Smooth 2D value noise for daytime high-altitude cirrus wisps
        float noise2D(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          float a = hash(vec3(i, 1.0));
          float b = hash(vec3(i + vec2(1.0, 0.0), 1.0));
          float c = hash(vec3(i + vec2(0.0, 1.0), 1.0));
          float d = hash(vec3(i + vec2(1.0, 1.0), 1.0));
          return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
        }

        void main() {
          vec3 dir = normalize(vWorldDirection);
          float h = clamp(dir.y, 0.0, 1.0);
          vec3 sky = mix(uHorizonColor, uTopColor, pow(h, 0.55));

          // Subtle daytime high-altitude cirrus wisps & atmospheric texture
          if (dir.y > 0.04 && uNightAmount < 0.85) {
            vec2 skyUv = dir.xz / (dir.y + 0.22);
            vec2 drift = vec2(uTime * 0.012, uTime * 0.006);
            float n1 = noise2D(skyUv * 2.2 + drift);
            float n2 = noise2D(skyUv * 4.8 - drift * 1.4) * 0.5;
            float n3 = noise2D(skyUv * 9.5 + drift * 2.1) * 0.25;
            float cirrus = smoothstep(0.72, 1.35, n1 + n2 + n3);
            float horizonFade = smoothstep(0.04, 0.28, dir.y);
            sky = mix(sky, vec3(0.96, 0.98, 1.0), cirrus * horizonFade * (1.0 - uNightAmount) * 0.28);
          }

          float sunDot = max(dot(dir, uSunDir), 0.0);
          sky += uSunColor * pow(sunDot, 16.0) * 0.35;
          sky += vec3(1.0, 0.98, 0.9) * smoothstep(0.9965, 0.9992, sunDot) * 1.4;

          // Realistic Moon with Lunar Maria ("Seas"), Highlands, Craters & Limb Darkening
          vec3 moonDir = -uSunDir;
          float moonDot = max(dot(dir, moonDir), 0.0);
          // Soft outer lunar atmospheric halo
          sky += vec3(0.45, 0.62, 0.92) * pow(moonDot, 28.0) * 0.22 * uNightAmount;

          float moonRadius = 0.068;
          vec3 moonRight = normalize(cross(vec3(0.0, 1.0, 0.0), moonDir));
          vec3 moonUp = cross(moonDir, moonRight);
          vec2 mUv = vec2(dot(dir - moonDir, moonRight), dot(dir - moonDir, moonUp)) / moonRadius;
          float mDistSq = dot(mUv, mUv);
          if (mDistSq < 1.0 && dot(dir, moonDir) > 0.0) {
            float mz = sqrt(1.0 - mDistSq);
            // Multi-scale lunar surface noise for Maria (dark basalt plains) & Highlands
            float maria = 0.0;
            // Mare Imbrium, Serenitatis, Tranquillitatis & Oceanus Procellarum regions
            maria += smoothstep(0.48, 0.12, length(mUv - vec2(-0.22, 0.18))) * 0.55;
            maria += smoothstep(0.42, 0.10, length(mUv - vec2(0.18, 0.14))) * 0.48;
            maria += smoothstep(0.38, 0.08, length(mUv - vec2(0.32, -0.08))) * 0.45;
            maria += smoothstep(0.45, 0.12, length(mUv - vec2(-0.35, -0.15))) * 0.42;
            float fineDetail = hash(floor(vec3(mUv * 18.0, 3.0))) * 0.18 + hash(floor(vec3(mUv * 36.0, 7.0))) * 0.1;
            maria = clamp(maria + fineDetail - 0.12, 0.0, 1.0);

            // Prominent impact craters (Tycho in south & Copernicus) with bright rims
            float tychoDist = length(mUv - vec2(-0.08, -0.48));
            float craterRim = smoothstep(0.14, 0.09, abs(tychoDist - 0.09)) * 0.28 + smoothstep(0.06, 0.0, tychoDist) * 0.35;
            float coperDist = length(mUv - vec2(-0.18, 0.04));
            craterRim += smoothstep(0.11, 0.06, abs(coperDist - 0.08)) * 0.22;

            vec3 highlandCol = vec3(0.92, 0.95, 1.0);
            vec3 mariaCol = vec3(0.46, 0.52, 0.62);
            vec3 lunarSurface = mix(highlandCol, mariaCol, maria) + vec3(craterRim);

            // Spherical 3D limb darkening + crisp edge anti-aliasing
            float limb = mix(0.62, 1.08, pow(mz, 0.45));
            float discEdge = smoothstep(1.0, 0.92, mDistSq);
            sky = mix(sky, lunarSurface * limb, discEdge * clamp(uNightAmount * 1.15, 0.15, 1.0));
          }

          if (uNightAmount > 0.05 && dir.y > 0.02) {
            vec3 poleAxis = normalize(vec3(0.22, 0.82, 0.53));
            vec3 starDir = rotateAroundAxis(dir, poleAxis, uStarAngle);

            // Smooth spherical star grid so stars glide without grid-edge flickering
            vec3 scaled = starDir * 95.0;
            vec3 starCell = floor(scaled);
            vec3 localPos = fract(scaled) - 0.5;
            float s = hash(starCell);
            if (s > 0.965) {
              vec3 jitter = (vec3(hash(starCell + 1.1), hash(starCell + 2.2), hash(starCell + 3.3)) - 0.5) * 0.45;
              float distToStar = length(localPos - jitter);
              float starCore = smoothstep(0.22, 0.03, distToStar);
              float twinkle = 0.78 + 0.22 * sin(uTime * (1.6 + fract(s * 97.0) * 2.5) + s * 60.0);
              float intensity = starCore * twinkle * uNightAmount * smoothstep(0.02, 0.16, dir.y);
              vec3 starTint = mix(vec3(0.84, 0.92, 1.0), vec3(1.0, 0.95, 0.84), fract(s * 43.0));
              sky += starTint * intensity * 1.45;
            }

            // Dual-channel Shooting Stars (Meteors) with bright visible head & tapering tail
            for (int m = 0; m < 2; m++) {
              float fm = float(m);
              float rate = 0.24 + fm * 0.07;
              float mTime = uTime * rate + fm * 13.7;
              float meteorWindow = floor(mTime);
              float meteorFrac = fract(mTime);
              if (meteorFrac < 0.34 && hash(vec3(meteorWindow, fm, 7.0)) > 0.18) {
                float t = meteorFrac / 0.34;
                float a1 = hash(vec3(meteorWindow, fm + 2.0, 3.0)) * 6.28318;
                float y1 = 0.28 + hash(vec3(meteorWindow, fm + 4.0, 5.0)) * 0.48;
                vec3 startDir = normalize(vec3(cos(a1), y1, sin(a1)));
                vec3 tangent = normalize(cross(startDir, vec3(0.25, 1.0, -0.3)));
                vec3 headDir = normalize(startDir + tangent * (t * 0.58));
                vec3 toPixel = dir - headDir;
                float along = dot(toPixel, -tangent);
                vec3 perpVec = toPixel - (-tangent) * along;
                float perpDist = length(perpVec);
                if (along >= -0.01 && along < 0.22 && perpDist < 0.014) {
                  float tailFade = clamp(1.0 - max(0.0, along) / 0.22, 0.0, 1.0) * sin(t * 3.14159);
                  float core = smoothstep(0.0055, 0.0, perpDist);
                  float glow = smoothstep(0.014, 0.0, perpDist) * 0.45;
                  float headBurst = smoothstep(0.018, 0.0, length(toPixel)) * sin(t * 3.14159) * 1.6;
                  sky += (vec3(0.92, 0.98, 1.0) * (core + headBurst) + vec3(0.45, 0.78, 1.0) * glow) * tailFade * uNightAmount * 2.6;
                }
              }
            }

            // Fantasy Aurora Borealis (Shimmering Emerald & Arcane Violet Ribbons in the night sky)
            if (dir.y > 0.12 && dir.y < 0.78) {
              vec2 aUv = dir.xz / (dir.y + 0.35);
              float wave = sin(aUv.x * 3.2 + uTime * 0.25 + sin(aUv.y * 2.5 - uTime * 0.18) * 1.6);
              float ribbon = smoothstep(0.55, 0.96, wave) * sin((dir.y - 0.12) / 0.66 * 3.14159);
              vec3 auroraCol = mix(vec3(0.15, 0.95, 0.65), vec3(0.65, 0.32, 0.98), sin(aUv.x * 1.8 + uTime * 0.15) * 0.5 + 0.5);
              sky += auroraCol * ribbon * uNightAmount * 0.26;
            }
          }
          gl_FragColor = vec4(sky, 1.0);
        }
      `,
    });

    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(280, 32, 20), this.skyMat);
    this.scene.add(this.skyMesh);

    this.cloudsGroup = new THREE.Group();
    const cloudTopMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    const cloudMidMat = new THREE.MeshLambertMaterial({ color: 0xeef6ff, transparent: true, opacity: 0.86 });
    const cloudBaseMat = new THREE.MeshLambertMaterial({ color: 0xd8e8f8, transparent: true, opacity: 0.82 });

    // Multi-layered, multi-puff 3D cumulus cloud clusters
    for (let i = 0; i < 24; i++) {
      const cluster = new THREE.Group();
      const baseW = 14 + (i * 5) % 14;
      const baseD = 10 + (i * 7) % 12;

      // Wide lower base
      const base = new THREE.Mesh(new THREE.BoxGeometry(baseW, 1.8, baseD), cloudBaseMat);
      cluster.add(base);

      // Billowy mid puffs
      const mid1 = new THREE.Mesh(new THREE.BoxGeometry(baseW * 0.78, 2.2, baseD * 0.82), cloudMidMat);
      mid1.position.set(-baseW * 0.08, 1.6, 0);
      const mid2 = new THREE.Mesh(new THREE.BoxGeometry(baseW * 0.62, 2.0, baseD * 0.7), cloudMidMat);
      mid2.position.set(baseW * 0.18, 1.4, baseD * 0.12);
      cluster.add(mid1, mid2);

      // Sunlit upper cumulus crown
      const crown = new THREE.Mesh(new THREE.BoxGeometry(baseW * 0.48, 2.0, baseD * 0.55), cloudTopMat);
      crown.position.set(-baseW * 0.04, 3.0, -baseD * 0.05);
      cluster.add(crown);

      cluster.position.set(((i * 37) % 260) - 130, 56 + (i % 3) * 3.5, ((i * 53) % 260) - 130);
      this.cloudsGroup.add(cluster);
    }
    this.scene.add(this.cloudsGroup);

    // Cinematic Optical Lens Flare & Smooth Underwater Glow (no radial spoke lines, no jumping 3D planes)
    this.godRayMat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSunScreenPos: { value: new THREE.Vector2(0.5, 0.5) },
        uRayIntensity: { value: 0.0 },
        uRayColor: { value: new THREE.Color(0xffe6a3) },
        uTime: { value: 0.0 },
        uUnderwater: { value: 0.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform vec2 uSunScreenPos;
        uniform float uRayIntensity;
        uniform vec3 uRayColor;
        uniform float uTime;
        uniform float uUnderwater;

        float flareDisc(vec2 uv, vec2 center, float radius, float softness) {
          vec2 d = (uv - center) * vec2(1.6, 1.0);
          return smoothstep(radius, radius * (1.0 - softness), length(d));
        }

        float flareRing(vec2 uv, vec2 center, float radius, float thickness) {
          vec2 d = (uv - center) * vec2(1.6, 1.0);
          float r = length(d);
          return smoothstep(thickness, 0.0, abs(r - radius));
        }

        void main() {
          if (uRayIntensity <= 0.004) discard;

          if (uUnderwater > 0.5) {
            // Seamless Underwater God Rays (angled volumetric sun shafts streaming down from surface)
            // Above-water lens flare is completely unaffected because this branch only runs underwater
            float tilt = (uSunScreenPos.x - 0.5) * 0.55;
            float rayCoord = vUv.x + (1.0 - vUv.y) * (0.28 + tilt);

            float beam1 = pow(sin(rayCoord * 11.0 + uTime * 0.65) * 0.5 + 0.5, 2.4);
            float beam2 = pow(cos(rayCoord * 19.0 - uTime * 0.48) * 0.5 + 0.5, 2.8) * 0.75;
            float beam3 = pow(sin(rayCoord * 29.0 + uTime * 0.85) * 0.5 + 0.5, 3.2) * 0.55;
            float shafts = (beam1 + beam2 + beam3) * 0.48;

            // Rays are brightest near the upper water surface and taper gently downward
            float depthFade = pow(clamp(vUv.y, 0.0, 1.0), 0.75) * smoothstep(0.0, 0.25, vUv.y);
            vec2 delta = (vUv - uSunScreenPos) * vec2(1.5, 1.0);
            float sunPool = exp(-length(delta) * 2.4) * 0.26;

            float alpha = (shafts * depthFade * 0.48 + sunPool) * uRayIntensity;
            vec3 uwCol = mix(vec3(0.28, 0.86, 1.0), vec3(0.75, 0.98, 1.0), shafts * 0.5);
            gl_FragColor = vec4(uwCol, clamp(alpha, 0.0, 0.52));
            return;
          }

          // Optical Lens Flare along the Sun -> Screen Center (0.5, 0.5) axis
          vec2 center = vec2(0.5, 0.5);
          vec2 axis = center - uSunScreenPos;
          vec2 dSun = (vUv - uSunScreenPos) * vec2(1.6, 1.0);
          float sunDist = length(dSun);

          // Soft solar bloom around the sun (zero radial lines)
          vec3 flare = uRayColor * exp(-sunDist * 4.2) * 0.38;

          // Optical aperture ghosts & bokeh rings along the lens axis
          vec2 g1 = uSunScreenPos + axis * 0.55;
          vec2 g2 = uSunScreenPos + axis * 1.15;
          vec2 g3 = uSunScreenPos + axis * 1.55;
          vec2 g4 = uSunScreenPos + axis * 1.95;
          vec2 g5 = uSunScreenPos - axis * 0.28;

          flare += vec3(1.0, 0.82, 0.55) * flareDisc(vUv, g1, 0.055, 0.65) * 0.18;
          flare += vec3(0.55, 0.88, 1.0) * flareRing(vUv, g2, 0.095, 0.018) * 0.22;
          flare += vec3(0.95, 0.65, 0.90) * flareDisc(vUv, g2, 0.085, 0.85) * 0.10;
          flare += vec3(0.65, 1.0, 0.82) * flareDisc(vUv, g3, 0.042, 0.55) * 0.20;
          flare += uRayColor * flareRing(vUv, g4, 0.14, 0.025) * 0.16;
          flare += vec3(1.0, 0.9, 0.7) * flareDisc(vUv, g5, 0.035, 0.6) * 0.16;

          float totalAlpha = clamp(length(flare) * uRayIntensity, 0.0, 0.58);
          gl_FragColor = vec4(flare * uRayIntensity, totalAlpha);
        }
      `,
    });
    this.godRayMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.godRayMat);
    this.godRayMesh.frustumCulled = false;
    this.godRayMesh.renderOrder = 999;
    this.scene.add(this.godRayMesh);

    // 3D Precipitation System (Rain & Snowfall around player)
    const dropCount = 900;
    const positions = new Float32Array(dropCount * 3);
    for (let i = 0; i < dropCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 44;
      positions[i * 3 + 1] = Math.random() * 28;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 44;
    }
    this.weatherGeo = new THREE.BufferGeometry();
    this.weatherGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.weatherMat = new THREE.PointsMaterial({
      color: 0x99ccff,
      size: 0.18,
      transparent: true,
      opacity: 0.75,
    });
    this.weatherPoints = new THREE.Points(this.weatherGeo, this.weatherMat);
    this.weatherPoints.visible = false;
    this.scene.add(this.weatherPoints);
  }

  public cycleWeather(): string {
    const order: ('clear' | 'rain' | 'snow')[] = ['clear', 'rain', 'snow'];
    this.weatherMode = order[(order.indexOf(this.weatherMode) + 1) % order.length];
    return this.weatherMode.toUpperCase();
  }

  public cyclePresetTime(): void {
    const presets = [0.26, 0.42, 0.73, 0.95];
    let closestIdx = 0;
    let minDiff = 999;
    presets.forEach((p, idx) => {
      const diff = Math.abs(this.timeOfDay - p);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });
    this.timeOfDay = presets[(closestIdx + 1) % presets.length];
  }

  public toggleTorch(): boolean {
    this.torchEnabled = !this.torchEnabled;
    this.torchLight.intensity = this.torchEnabled ? 2.4 : 0;
    return this.torchEnabled;
  }

  public getFormattedTime(): string {
    const hours24 = Math.floor(this.timeOfDay * 24) % 24;
    const mins = Math.floor((this.timeOfDay * 24 * 60) % 60);
    const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    const phase =
      hours24 >= 5 && hours24 < 8
        ? 'Dawn'
        : hours24 >= 8 && hours24 < 17
        ? 'Day'
        : hours24 >= 17 && hours24 < 20
        ? 'Sunset'
        : 'Night';
    return `${phase} (${pad(hours24)}:${pad(mins)})`;
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    isUnderwater: boolean,
    camera?: THREE.Camera,
    getBlock?: (x: number, y: number, z: number) => BlockId
  ): void {
    this.elapsedSeconds += dt;
    const preAngle = (this.timeOfDay - 0.25) * Math.PI * 2;
    const isDaytimeNow = Math.sin(preAngle) >= 0;

    if (this.autoCycle) {
      // Day (0.5 of cycle) = 10 mins (600s) -> 0.5 / 600 = 0.0008333/s
      // Night (0.5 of cycle) = 7 mins (420s) -> 0.5 / 420 = 0.0011905/s
      const rate = isDaytimeNow ? 0.5 / 600 : 0.5 / 420;
      this.timeOfDay = (this.timeOfDay + dt * rate) % 1.0;
    }

    const angle = (this.timeOfDay - 0.25) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.28).normalize();
    const sunHeight = sunDir.y;

    const dayFactor = THREE.MathUtils.clamp((sunHeight + 0.12) / 0.62, 0, 1);
    const sunsetFactor = THREE.MathUtils.clamp(1.0 - Math.abs(sunHeight) * 3.2, 0, 1);
    const nightFactor = 1.0 - dayFactor;

    const topDay = new THREE.Color(0x1d6ff2);
    const topSunset = new THREE.Color(0x3b2d6e);
    const topNight = new THREE.Color(0x02040a);

    const horDay = new THREE.Color(0x9bd4ff);
    const horSunset = new THREE.Color(0xf97316);
    const horNight = new THREE.Color(0x060a14);

    const topColor = topNight.clone().lerp(topDay, dayFactor).lerp(topSunset, sunsetFactor * 0.65);
    const horColor = horNight.clone().lerp(horDay, dayFactor).lerp(horSunset, sunsetFactor * 0.85);

    this.skyMat.uniforms.uTopColor.value.copy(topColor);
    this.skyMat.uniforms.uHorizonColor.value.copy(horColor);
    this.skyMat.uniforms.uSunDir.value.copy(sunDir);
    this.skyMat.uniforms.uNightAmount.value = nightFactor;
    // +7% star rotation speed (0.48 -> 0.514)
    this.skyMat.uniforms.uStarAngle.value = this.timeOfDay * Math.PI * 0.514;
    this.skyMat.uniforms.uTime.value = this.elapsedSeconds;

    this.skyMesh.position.copy(playerPos);

    const activeLightDir = sunHeight >= -0.05 ? sunDir : sunDir.clone().negate();
    this.sunLight.position.copy(playerPos).addScaledVector(activeLightDir, 75);
    this.sunLight.target.position.copy(playerPos);

    if (sunHeight >= -0.05) {
      this.sunLight.intensity = Math.max(0.095, dayFactor * 1.38);
      this.sunLight.color.setHSL(0.1 - sunsetFactor * 0.05, 0.7, 0.92);
    } else {
      // +0.04 subtle moonlight glow (0.055 -> 0.095) so you can barely see the ground without a light
      this.sunLight.intensity = 0.095;
      this.sunLight.color.setHex(0x7399d1);
    }

    this.hemiLight.intensity = 0.095 + dayFactor * 0.70;
    this.hemiLight.color.copy(horColor);
    this.hemiLight.groundColor.setHex(nightFactor > 0.5 ? 0x090f1d : 0x4b5e3c);

    this.torchLight.position.set(playerPos.x, playerPos.y + 1.2, playerPos.z);

    // Update Canopy God Rays & Underwater Light Shafts
    this.updateLightRays(dt, playerPos, sunDir, dayFactor, sunsetFactor, isUnderwater, camera, getBlock);

    // Animate 3D Rain / Snowfall Weather Particles
    if (this.weatherMode !== 'clear' && !isUnderwater) {
      this.weatherPoints.visible = true;
      this.weatherPoints.position.set(playerPos.x, playerPos.y - 4, playerPos.z);
      const isSnow = this.weatherMode === 'snow';
      this.weatherMat.color.setHex(isSnow ? 0xffffff : 0x7dd3fc);
      this.weatherMat.size = isSnow ? 0.24 : 0.16;

      const posAttr = this.weatherGeo.getAttribute('position') as THREE.BufferAttribute;
      const fallSpeed = isSnow ? 3.2 : 19.5;
      for (let i = 0; i < posAttr.count; i++) {
        let py = posAttr.getY(i) - fallSpeed * dt;
        let px = posAttr.getX(i) + (isSnow ? Math.sin(this.elapsedSeconds * 2 + i) * 0.8 * dt : 0);
        if (py < 0) {
          py = 28;
          px = (Math.random() - 0.5) * 44;
        }
        posAttr.setXY(i, px, py);
      }
      posAttr.needsUpdate = true;

      // Occasional dramatic lightning flash during rainstorms
      if (this.weatherMode === 'rain' && Math.random() < dt * 0.08) {
        this.lightningFlash = 1.0;
      }
      if (this.lightningFlash > 0) {
        this.sunLight.intensity += this.lightningFlash * 2.5;
        this.lightningFlash = Math.max(0, this.lightningFlash - dt * 5);
      }
    } else {
      this.weatherPoints.visible = false;
    }

    if (isUnderwater) {
      this.fog.color.setHex(0x0b487c);
      this.fog.density = 0.048;
    } else {
      this.fog.color.copy(horColor);
      this.fog.density = 0.0046;
    }

    for (const child of this.cloudsGroup.children) {
      child.position.x += dt * 1.1;
      if (child.position.x - playerPos.x > 140) child.position.x -= 280;
      if (child.position.x - playerPos.x < -140) child.position.x += 280;
      if (child.position.z - playerPos.z > 140) child.position.z -= 280;
      if (child.position.z - playerPos.z < -140) child.position.z += 280;
    }
  }

  private updateLightRays(
    dt: number,
    _playerPos: THREE.Vector3,
    sunDir: THREE.Vector3,
    dayFactor: number,
    sunsetFactor: number,
    isUnderwater: boolean,
    camera?: THREE.Camera,
    getBlock?: (x: number, y: number, z: number) => BlockId
  ): void {
    this.godRayMat.uniforms.uUnderwater.value = isUnderwater ? 1.0 : 0.0;

    let targetRayIntensity = 0;
    if (camera && getBlock && dayFactor > 0.08) {
      const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const lookDot = camForward.dot(sunDir);

      if (isUnderwater) {
        const sunWorldPos = camera.position.clone().addScaledVector(sunDir, 100);
        const projected = sunWorldPos.project(camera);
        this.godRayMat.uniforms.uSunScreenPos.value.set(
          projected.x * 0.5 + 0.5,
          projected.y * 0.5 + 0.5
        );
        targetRayIntensity = dayFactor * Math.max(0.35, THREE.MathUtils.smoothstep(lookDot, -0.2, 0.85));
      } else if (lookDot > 0.18) {
        const sunWorldPos = camera.position.clone().addScaledVector(sunDir, 100);
        const projected = sunWorldPos.project(camera);
        this.godRayMat.uniforms.uSunScreenPos.value.set(
          projected.x * 0.5 + 0.5,
          projected.y * 0.5 + 0.5
        );

        let hitLeaves = 0;
        let hitSolid = false;
        const eye = camera.position;
        for (let step = 1; step <= 20; step++) {
          const sx = Math.floor(eye.x + sunDir.x * step);
          const sy = Math.floor(eye.y + sunDir.y * step);
          const sz = Math.floor(eye.z + sunDir.z * step);
          const id = getBlock(sx, sy, sz);
          if (id === BlockId.OakLeaves || id === BlockId.BirchLeaves) {
            hitLeaves++;
          } else if (BLOCKS[id]?.solid && !BLOCKS[id]?.transparent) {
            hitSolid = true;
            break;
          }
        }

        if (!hitSolid) {
          // Filter softly if passing through tree leaves
          const canopyAttenuation = hitLeaves > 0 ? Math.max(0.35, 1.0 - hitLeaves * 0.15) : 1.0;
          const viewAlign = THREE.MathUtils.smoothstep(lookDot, 0.18, 0.92);
          targetRayIntensity = dayFactor * viewAlign * canopyAttenuation * 0.85;
        }
      }
    }

    this.rayIntensitySmooth = THREE.MathUtils.lerp(this.rayIntensitySmooth, targetRayIntensity, Math.min(1, dt * 6));
    this.godRayMat.uniforms.uRayIntensity.value = this.rayIntensitySmooth;
    this.godRayMat.uniforms.uTime.value = this.elapsedSeconds;

    const rayCol = new THREE.Color(0xfff1ba).lerp(new THREE.Color(0xff9d47), sunsetFactor * 0.75);
    this.godRayMat.uniforms.uRayColor.value.copy(rayCol);
  }
}
