import * as THREE from 'three';
import { BlockId, BLOCKS, TileIndex } from './blocks';

export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 7;
export const TILE_SIZE = 16;

type RGB = [number, number, number];

function hex(c: string): RGB {
  const v = parseInt(c.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function lerpRgb(a: RGB, b: RGB, t: number): RGB {
  const c = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * c),
    Math.round(a[1] + (b[1] - a[1]) * c),
    Math.round(a[2] + (b[2] - a[2]) * c),
  ];
}

function scaleRgb(rgb: RGB, s: number): RGB {
  return [
    Math.max(0, Math.min(255, Math.round(rgb[0] * s))),
    Math.max(0, Math.min(255, Math.round(rgb[1] * s))),
    Math.max(0, Math.min(255, Math.round(rgb[2] * s))),
  ];
}

/**
 * Seamless tileable 2D value noise on a 16x16 grid for smooth organic shading
 */
function hash16(x: number, y: number, seed: number): number {
  const wx = ((x % 16) + 16) % 16;
  const wy = ((y % 16) + 16) % 16;
  let n = Math.imul(wx * 374761393 + wy * 668265263 + seed * 1442695041, 1274126177);
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smoothNoise16(x: number, y: number, scale: number, seed: number): number {
  const sx = x / scale;
  const sy = y / scale;
  const x0 = Math.floor(sx);
  const y0 = Math.floor(sy);
  const fx = sx - x0;
  const fy = sy - y0;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const n00 = hash16(x0, y0, seed);
  const n10 = hash16(x0 + 1, y0, seed);
  const n01 = hash16(x0, y0 + 1, seed);
  const n11 = hash16(x0 + 1, y0 + 1, seed);

  const nx0 = n00 + (n10 - n00) * ux;
  const nx1 = n01 + (n11 - n01) * ux;
  return nx0 + (nx1 - nx0) * uy;
}

export class TextureAtlas {
  public canvas: HTMLCanvasElement;
  public bumpCanvas: HTMLCanvasElement;
  public texture: THREE.CanvasTexture;
  public bumpTexture: THREE.CanvasTexture;
  public opaqueMaterial: THREE.MeshLambertMaterial;
  public waterMaterial: THREE.MeshPhongMaterial;
  public waterTimeUniform = { value: 0 };
  private fireFrameTimer = 0;
  private fireFrameStep = 0;
  private iconCache = new Map<BlockId, string>();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_COLS * TILE_SIZE;
    this.canvas.height = ATLAS_ROWS * TILE_SIZE;

    this.bumpCanvas = document.createElement('canvas');
    this.bumpCanvas.width = this.canvas.width;
    this.bumpCanvas.height = this.canvas.height;

    this.paintAllTiles();

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.needsUpdate = true;

    this.bumpTexture = new THREE.CanvasTexture(this.bumpCanvas);
    this.bumpTexture.magFilter = THREE.NearestFilter;
    this.bumpTexture.minFilter = THREE.NearestFilter;
    this.bumpTexture.generateMipmaps = false;
    this.bumpTexture.needsUpdate = true;

    this.opaqueMaterial = new THREE.MeshLambertMaterial({
      map: this.texture,
      bumpMap: this.bumpTexture,
      bumpScale: 0.025,
      alphaTest: 0.45,
      side: THREE.DoubleSide,
      shadowSide: THREE.FrontSide,
      vertexColors: true,
    });

    // Subtle wind-sway vertex shader for Tree Leaves, Tall Grass & Wildflowers
    this.opaqueMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waterTimeUniform;
      shader.vertexShader =
        `
        uniform float uTime;
        ` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
          #include <begin_vertex>
          vec4 wPos = modelMatrix * vec4(transformed, 1.0);
          // Detect foliage tiles by UV or upper vertices of crossed plants
          float sway = sin(wPos.x * 0.9 + wPos.z * 0.7 + uTime * 2.1) * 0.032;
          if (uv.y < 0.52 && fract(transformed.y) > 0.05) {
            transformed.x += sway;
            transformed.z += sway * 0.7;
          }
          `
        );
    };

    this.waterMaterial = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      opacity: 0.84,
      shininess: 120,
      specular: new THREE.Color(0xd8f3ff),
      depthWrite: false,
    });

    // Inject real-time animated Water & Molten Lava shader into waterMaterial
    this.waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.waterTimeUniform;
      shader.vertexShader =
        `
        uniform float uTime;
        varying vec3 vWaterWorldPos;
        varying vec3 vLiquidTint;
        ` +
        shader.vertexShader.replace(
          '#include <begin_vertex>',
          `
          #include <begin_vertex>
          vec4 wPos = modelMatrix * vec4(transformed, 1.0);
          float wave = sin(wPos.x * 1.15 + uTime * 2.1) * 0.042 + cos(wPos.z * 1.35 - uTime * 1.75) * 0.038;
          transformed.y += wave;
          vWaterWorldPos = wPos.xyz;
          vLiquidTint = color;
          `
        );

      shader.fragmentShader =
        `
        uniform float uTime;
        varying vec3 vWaterWorldPos;
        varying vec3 vLiquidTint;
        ` +
        shader.fragmentShader.replace(
          '#include <map_fragment>',
          `
          vec2 p1 = vWaterWorldPos.xz * 0.55 + vec2(uTime * 0.18, uTime * 0.12);
          vec2 p2 = vWaterWorldPos.xz * 0.72 - vec2(uTime * 0.14, -uTime * 0.21);
          float w1 = sin(p1.x * 3.2 + cos(p1.y * 2.8)) * 0.5 + 0.5;
          float w2 = cos(p2.y * 3.5 + sin(p2.x * 3.1)) * 0.5 + 0.5;
          float ripple = (w1 + w2) * 0.5;
          float caustic = smoothstep(0.68, 0.92, ripple);

          // Check if vertex color marks Molten Dragon Lava (red > 0.95 && blue < 0.4)
          if (vLiquidTint.r > 0.95 && vLiquidTint.b < 0.4) {
            vec3 crustCol = vec3(0.55, 0.12, 0.02);
            vec3 magmaCol = vec3(1.0, 0.42, 0.04);
            vec3 coreCol = vec3(1.0, 0.92, 0.35);
            vec3 lavaCol = mix(crustCol, magmaCol, ripple);
            lavaCol = mix(lavaCol, coreCol, caustic * 0.75);
            diffuseColor.rgb = lavaCol * 1.35;
          } else {
            vec3 deepWater = vec3(0.06, 0.36, 0.68);
            vec3 shallowWater = vec3(0.14, 0.58, 0.88);
            vec3 foamHighlight = vec3(0.68, 0.92, 1.0);
            vec3 waterCol = mix(deepWater, shallowWater, ripple);
            waterCol = mix(waterCol, foamHighlight, caustic * 0.52);
            diffuseColor.rgb = waterCol;
          }
          `
        );
    };
  }

  public updateWaterAnimation(dt: number): void {
    this.waterTimeUniform.value += dt;
    this.fireFrameTimer += dt;
    if (this.fireFrameTimer >= 0.065) {
      this.fireFrameTimer = 0;
      this.fireFrameStep++;
      this.paintAnimatedFireTile(this.fireFrameStep);
      this.texture.needsUpdate = true;
    }
  }

  private paintAnimatedFireTile(step: number): void {
    const ctx = this.canvas.getContext('2d')!;
    const T = TileIndex;
    const phase = step * 0.65;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const centerDist = Math.abs(x - 7.5);
        // Rising flame wave (y - phase scrolls upward as y decreases toward 0)
        const wave1 = Math.sin(x * 0.95 + y * 0.55 + phase) * 1.65;
        const wave2 = Math.cos(x * 1.4 - y * 0.7 + phase * 1.4) * 1.1;
        const maxWidth = (y / 16) * 7.6 + 1.2 + (wave1 + wave2) * 0.48;

        // Occasional rising spark detached near the top
        const isSpark = y >= 1 && y <= 4 && Math.abs(x - (7.5 + Math.sin(phase + y) * 2.5)) < 1.1 && (step + y) % 3 === 0;
        if (isSpark) {
          this.put(ctx, T.CAMPFIRE, x, y, hex('#ffee77'), 1);
        } else if (centerDist > maxWidth || y < 1) {
          this.put(ctx, T.CAMPFIRE, x, y, [0, 0, 0], 0);
        } else if (centerDist < maxWidth * 0.38 && y > 6) {
          this.put(ctx, T.CAMPFIRE, x, y, hex('#fffef2'), 1);
        } else if (centerDist < maxWidth * 0.68) {
          this.put(ctx, T.CAMPFIRE, x, y, (x + y + step) % 2 === 0 ? hex('#ffdf4d') : hex('#ffbb24'), 1);
        } else {
          this.put(ctx, T.CAMPFIRE, x, y, (y + step) % 3 === 0 ? hex('#ff7b19') : hex('#eb480e'), 1);
        }
      }
    }
  }

  private put(ctx: CanvasRenderingContext2D, tile: number, x: number, y: number, rgb: RGB, a = 1): void {
    const tx = (tile % ATLAS_COLS) * TILE_SIZE + ((x + TILE_SIZE) % TILE_SIZE);
    const ty = Math.floor(tile / ATLAS_COLS) * TILE_SIZE + ((y + TILE_SIZE) % TILE_SIZE);
    if (a <= 0.01) {
      ctx.clearRect(tx, ty, 1, 1);
    } else {
      ctx.fillStyle = a < 1 ? `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})` : `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      ctx.fillRect(tx, ty, 1, 1);
    }
    const bCtx = this.bumpCanvas.getContext('2d')!;
    const lum = Math.max(0, Math.min(255, Math.round(rgb[0] * 0.3 + rgb[1] * 0.59 + rgb[2] * 0.11)));
    bCtx.fillStyle = `rgb(${lum},${lum},${lum})`;
    bCtx.fillRect(tx, ty, 1, 1);
  }

  private paintAllTiles(): void {
    const ctx = this.canvas.getContext('2d')!;
    const T = TileIndex;

    // 0: Lush Grass Top — slightly darker, rich meadow green with sculpted blade tufts
    const gDark = hex('#458222');
    const gMid = hex('#569c2e');
    const gBright = hex('#6ab53d');
    const gTip = hex('#7ecc4c');
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const s = smoothNoise16(x, y, 2.5, 11);
        let col = lerpRgb(gDark, gBright, s);
        const tuft = hash16(x, y, 19);
        if (tuft > 0.84) col = gTip;
        else if (hash16(x, y - 1, 19) > 0.84) col = lerpRgb(gMid, gTip, 0.5);
        else if (hash16(x, y + 1, 19) > 0.84) col = gDark;
        this.put(ctx, T.GRASS_TOP, x, y, col);
      }
    }

    // Shared Dirt Pixel helper so Dirt Block and Grass/Snow Block sides match 100% pixel-for-pixel
    const dDark = hex('#805838');
    const dMid = hex('#996b45');
    const dLight = hex('#b38056');
    const dPebble = hex('#c7966b');
    const getDirtPixel = (x: number, y: number): RGB => {
      const s = smoothNoise16(x, y, 2.2, 23);
      let col = lerpRgb(dDark, dLight, s);
      const p = hash16(x >> 1, y >> 1, 29);
      if (p > 0.82) {
        col = y % 2 === 0 ? dPebble : dDark;
      } else if (p < 0.14) {
        col = dMid;
      }
      return col;
    };

    // 2: Rich Dirt
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        this.put(ctx, T.DIRT, x, y, getDirtPixel(x, y));
      }
    }

    // 1: Grass Side — exact same dirt texture with overhanging turf roots
    const overhang = [4, 5, 6, 4, 3, 4, 6, 7, 5, 4, 3, 5, 6, 4, 3, 4];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const h = overhang[x];
        if (y < h) {
          const s = smoothNoise16(x, y, 2.2, 11);
          let col = lerpRgb(gMid, gBright, s);
          if (y === 0) col = lerpRgb(col, gTip, 0.45);
          if (y === h - 1) col = gDark;
          this.put(ctx, T.GRASS_SIDE, x, y, col);
        } else if (y === h) {
          this.put(ctx, T.GRASS_SIDE, x, y, scaleRgb(getDirtPixel(x, y), 0.72));
        } else {
          this.put(ctx, T.GRASS_SIDE, x, y, getDirtPixel(x, y));
        }
      }
    }

    // 3: Mountain Stone — lighter silver-limestone granite with top-lit shelves
    const stDark = hex('#7d8591');
    const stLight = hex('#b4bcc9');
    const stCrevice = hex('#646b75');
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const waveY = y + Math.round(Math.sin(x * 0.45) * 0.8);
        const s = smoothNoise16(x, waveY, 2.4, 37);
        let col = lerpRgb(stDark, stLight, s);
        const shelf = (waveY % 5 === 0 && hash16(x >> 1, y, 41) > 0.35);
        if (shelf) col = stCrevice;
        else if ((waveY - 1) % 5 === 0 && hash16(x >> 1, y - 1, 41) > 0.35) col = stLight;
        this.put(ctx, T.STONE, x, y, col);
      }
    }

    // 4: Cobblestone — lighter rounded river stones with top-left highlight & mortar
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const row = y >> 2;
        const sx = (x + (row % 2) * 2) % 4;
        const sy = y % 4;
        const stoneId = hash16((x + (row % 2) * 2) >> 2, row, 53);
        const baseRgb = lerpRgb(hex('#878f9c'), hex('#a8b1bf'), stoneId);

        let col = baseRgb;
        if (sx === 3 || sy === 3) {
          col = (sx === 3 && sy === 3) ? hex('#4e535c') : hex('#626873');
        } else if (sx === 0 || sy === 0) {
          col = scaleRgb(baseRgb, sx === 0 && sy === 0 ? 1.18 : 1.1);
        } else if (sx === 2 && sy === 2) {
          col = scaleRgb(baseRgb, 0.92);
        }
        this.put(ctx, T.COBBLESTONE, x, y, col);
      }
    }

    // 5, 6, 7: Golden Sand & Carved Sandstone
    const sDark = hex('#d4c085');
    const sMid = hex('#e6d49c');
    const sBright = hex('#f5e7b8');
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const wave = Math.sin((x * 0.45) + (y * 0.85) + Math.sin(x * 0.4) * 1.2);
        const col = wave > 0.45 ? sBright : wave > -0.35 ? sMid : sDark;
        this.put(ctx, T.SAND, x, y, col);

        let ssCol = lerpRgb(sDark, sBright, smoothNoise16(x, y, 2.5, 61));
        if (y === 0 || y === 5 || y === 11) ssCol = hex('#bfa96b');
        else if (y === 1 || y === 6 || y === 12) ssCol = hex('#faf0c8');
        this.put(ctx, T.SANDSTONE_SIDE, x, y, ssCol);
        this.put(ctx, T.SANDSTONE_TOP, x, y, lerpRgb(sMid, sBright, smoothNoise16(x, y, 2.2, 67)));
      }
    }

    // 8: Crystal Water — bright tropical azure with smooth shimmering caustics
    const wDeep = hex('#1e82db');
    const wMid = hex('#329cf0');
    const wCaustic = hex('#78d2ff');
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const shimmer = Math.sin(x * 0.55 + y * 0.4) + Math.cos(x * 0.35 - y * 0.65);
        const col = shimmer > 1.15 ? wCaustic : shimmer > 0.0 ? wMid : wDeep;
        this.put(ctx, T.WATER, x, y, col, 0.82);
      }
    }

    // 9, 10, 11: Oak Log Side, Top & Honey Oak Planks
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const ridgePhase = (x + Math.floor(Math.sin(y * 0.4) * 1.2) + 16) % 4;
        const barkBase = ridgePhase === 0 ? hex('#45311c') : ridgePhase === 1 ? hex('#7d5b36') : ridgePhase === 2 ? hex('#6b4d2d') : hex('#573e23');
        this.put(ctx, T.OAK_LOG_SIDE, x, y, scaleRgb(barkBase, 0.94 + hash16(x, y >> 1, 71) * 0.12));

        const dist = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        const topCol = dist > 6 ? hex('#573e23') : dist > 5 ? hex('#7d5b36') : Math.floor(dist) % 2 === 0 ? hex('#c99e67') : hex('#b08652');
        this.put(ctx, T.OAK_LOG_TOP, x, y, topCol);

        const row = y >> 2;
        const py = y % 4;
        const jointX = (x + row * 7) % 16;
        const grain = smoothNoise16(x, y * 2, 3.0, 79);
        let plankCol = lerpRgb(hex('#ab7e49'), hex('#cfa068'), grain);
        if (py === 3 || jointX === 0) plankCol = hex('#75532d');
        else if (py === 0) plankCol = scaleRgb(plankCol, 1.12);
        else if ((jointX === 2 || jointX === 14) && py === 1) plankCol = hex('#825d34');
        this.put(ctx, T.OAK_PLANKS, x, y, plankCol);
      }
    }

    // 12: Oak Leaves — realistic Minecraft-style overlapping leaves with see-through gaps (alpha=0)
    // 16x16 organic leaf mask where '0' is an empty see-through gap, '1' is deep twig/shadow, '2' is mid leaf, '3' is sunlit leaf tip
    const leafPattern = [
      '2331023321023320',
      '3321123211233210',
      '2210012102332102',
      '1100233211221023',
      '0233322100110233',
      '2332211002321232',
      '3321100233321121',
      '2110023322110012',
      '1002332110023212',
      '0233221002333210',
      '2332110233221102',
      '3221023321100233',
      '2110233210023321',
      '1023322102332210',
      '0232211023321102',
      '2321001232210023',
    ];
    const oakLeafCols: Record<string, RGB> = {
      '1': hex('#2d6e1e'),
      '2': hex('#469e32'),
      '3': hex('#68c74c'),
    };
    const birchLeafCols: Record<string, RGB> = {
      '1': hex('#4e8226'),
      '2': hex('#6fb038'),
      '3': hex('#95db53'),
    };
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const ch = leafPattern[y][x];
        if (ch === '0') {
          this.put(ctx, T.OAK_LEAVES, x, y, [0, 0, 0], 0);
        } else {
          this.put(ctx, T.OAK_LEAVES, x, y, oakLeafCols[ch], 1);
        }
      }
    }

    // 13, 14, 15: Birch Log & Golden Birch Leaves (with see-through gaps)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const isLenticel = (y % 5 === 2 && ((x + y * 3) % 8 < 3));
        const shade = 0.95 + smoothNoise16(x, y, 3.0, 89) * 0.1;
        const bCol = isLenticel ? hex('#4a453f') : scaleRgb(hex('#f2efe8'), shade);
        this.put(ctx, T.BIRCH_LOG_SIDE, x, y, bCol);

        const dist = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        this.put(ctx, T.BIRCH_LOG_TOP, x, y, dist > 6 ? hex('#e8e4da') : Math.floor(dist) % 2 === 0 ? hex('#dec695') : hex('#c9b07e'));

        const ch = leafPattern[(y + 5) % 16][(x + 7) % 16];
        if (ch === '0') {
          this.put(ctx, T.BIRCH_LEAVES, x, y, [0, 0, 0], 0);
        } else {
          this.put(ctx, T.BIRCH_LEAVES, x, y, birchLeafCols[ch], 1);
        }
      }
    }

    // 16 & 17: Snow Top & Snowy Grass Side
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const s = smoothNoise16(x, y, 2.8, 97);
        const snowCol = lerpRgb(hex('#e1effa'), hex('#ffffff'), s);
        this.put(ctx, T.SNOW_TOP, x, y, snowCol);

        const h = overhang[x];
        if (y < h) this.put(ctx, T.SNOW_SIDE, x, y, snowCol);
        else if (y === h) this.put(ctx, T.SNOW_SIDE, x, y, hex('#bdd6eb'));
        else this.put(ctx, T.SNOW_SIDE, x, y, getDirtPixel(x, y));
      }
    }

    // 18, 19, 20: Coal, Gold, Diamond Ores — stratified granite embedded with faceted 3D crystals
    const gemSpots: [number, number, number][] = [
      // [x, y, role: 0=shadow, 1=mid, 2=specular highlight]
      [3, 3, 2], [4, 3, 1], [3, 4, 1], [4, 4, 0],
      [10, 4, 2], [11, 4, 1], [10, 5, 1], [11, 5, 0],
      [5, 9, 2], [6, 9, 1], [5, 10, 1], [6, 10, 0],
      [11, 11, 2], [12, 11, 1], [11, 12, 1], [12, 12, 0],
    ];
    const paintOre = (tile: number, darkHex: string, midHex: string, hiHex: string) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const waveY = y + Math.round(Math.sin(x * 0.45) * 0.8);
          const s = smoothNoise16(x, waveY, 2.4, 37);
          this.put(ctx, tile, x, y, lerpRgb(stDark, stLight, s));
        }
      }
      const palette = [hex(darkHex), hex(midHex), hex(hiHex)];
      for (const [gx, gy, role] of gemSpots) {
        this.put(ctx, tile, gx, gy, palette[role]);
      }
    };
    paintOre(T.COAL_ORE, '#1c1f24', '#31363f', '#525a66');
    paintOre(T.GOLD_ORE, '#c98812', '#f7be2b', '#fff59e');
    paintOre(T.DIAMOND_ORE, '#159eb5', '#3be6f7', '#c4ffff');

    // 21: Sunstone Lantern — ornate bronze/oak frame with radial warm glow
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const outer = x === 0 || x === 15 || y === 0 || y === 15;
        const inner = x === 1 || x === 14 || y === 1 || y === 14;
        const dist = Math.hypot(x - 7.5, y - 7.5);
        let col = lerpRgb(hex('#fffce0'), hex('#f5b027'), Math.min(1, dist / 8));
        if (outer) col = hex('#4a341e');
        else if (inner) col = hex('#785532');
        this.put(ctx, T.GLOWSTONE, x, y, col);
      }
    }

    // 22: Clay Masonry Brick — warm kiln-fired terracotta bricks with top highlight & cream mortar
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const row = y >> 2;
        const bx = (x + (row % 2) * 4) % 8;
        const by = y % 4;
        if (by === 3 || bx === 7) {
          this.put(ctx, T.BRICK, x, y, hex('#cfc8bc'));
        } else {
          const brickVar = hash16((x + (row % 2) * 4) >> 3, row, 109);
          let bCol = lerpRgb(hex('#a84634'), hex('#c45b47'), brickVar);
          if (by === 0) bCol = scaleRgb(bCol, 1.12);
          if (by === 2) bCol = scaleRgb(bCol, 0.92);
          this.put(ctx, T.BRICK, x, y, bCol);
        }
      }
    }

    // 23: Crystal Glass — beveled sky-blue frame with subtle diagonal reflection
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const frameOuter = x === 0 || x === 15 || y === 0 || y === 15;
        const glint = (x + y === 5 || x + y === 6 || x + y === 12) && x > 1 && x < 14 && y > 1 && y < 14;
        if (frameOuter) this.put(ctx, T.GLASS, x, y, hex('#dff6ff'), 0.9);
        else if (glint) this.put(ctx, T.GLASS, x, y, hex('#ffffff'), 0.85);
        else this.put(ctx, T.GLASS, x, y, hex('#b8ebff'), 0.14);
      }
    }

    // 24: Scholar Bookshelf Side — oak shelves with gilded book spines
    const bookCols = [hex('#b83932'), hex('#2d6db5'), hex('#378f4b'), hex('#cc982b'), hex('#7a41a6')];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (y < 2 || y > 13 || y === 7 || y === 8 || x === 0 || x === 15) {
          this.put(ctx, T.BOOKSHELF_SIDE, x, y, y === 1 || y === 9 ? hex('#75532d') : hex('#ba8f5a'));
        } else {
          const bIdx = ((x - 1) >> 1) + (y > 8 ? 3 : 0);
          const spineCol = bookCols[bIdx % bookCols.length];
          const isBand = y === 4 || y === 11;
          this.put(ctx, T.BOOKSHELF_SIDE, x, y, (x - 1) % 2 === 0 ? (isBand ? hex('#f2d16b') : spineCol) : scaleRgb(spineCol, 0.82));
        }
      }
    }

    // 25 & 26: Artisan Workbench Top & Side
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const border = x < 2 || x > 13 || y < 2 || y > 13;
        const grid = x % 4 === 0 || y % 4 === 0;
        this.put(ctx, T.CRAFT_TOP, x, y, border ? hex('#6e4e2c') : grid ? hex('#8a643b') : hex('#c49660'));
        this.put(ctx, T.CRAFT_SIDE, x, y, y < 4 ? hex('#75532d') : x % 4 === 0 ? hex('#825d34') : hex('#ba8f5a'));
      }
    }

    // 27: Mossy Ruin Stone — rounded cobblestone overgrown with lush moss
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const row = y >> 2;
        const sx = (x + (row % 2) * 2) % 4;
        const sy = y % 4;
        const moss = smoothNoise16(x, y, 2.5, 127) > 0.52;
        if (moss) {
          this.put(ctx, T.MOSSY_COBBLE, x, y, (sx === 3 || sy === 3) ? hex('#3b7322') : hex('#5cab38'));
        } else {
          this.put(ctx, T.MOSSY_COBBLE, x, y, (sx === 3 || sy === 3) ? hex('#4c5159') : hex('#858d99'));
        }
      }
    }

    // 28 & 29: Volcanic Magma & Deep Bedrock
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const s = smoothNoise16(x, y, 2.2, 131);
        const magmaCol = s > 0.62 ? hex('#ffba3b') : s > 0.45 ? hex('#eb5e1a') : lerpRgb(hex('#331f1d'), hex('#522d27'), s * 2);
        this.put(ctx, T.MAGMA, x, y, magmaCol);

        const b = smoothNoise16(x, y, 2.0, 139);
        this.put(ctx, T.BEDROCK, x, y, lerpRgb(hex('#22252b'), hex('#484e59'), b));
      }
    }

    // 30: Solid Filled-In Torch Texture (mapped onto all 4 sides of the 3D Torch Box)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (y <= 1) {
          this.put(ctx, T.TORCH, x, y, hex('#fffef0'), 1);
        } else if (y <= 3) {
          this.put(ctx, T.TORCH, x, y, (x + y) % 2 === 0 ? hex('#ffdf59') : hex('#ffaa22'), 1);
        } else if (y === 4) {
          this.put(ctx, T.TORCH, x, y, hex('#ff6a14'), 1);
        } else if (y === 5) {
          this.put(ctx, T.TORCH, x, y, hex('#3d2917'), 1);
        } else {
          const edge = x <= 2 || x >= 13;
          const highlight = x >= 5 && x <= 8;
          const woodCol = edge ? hex('#6b4b28') : highlight ? hex('#ab7e49') : hex('#8f6739');
          this.put(ctx, T.TORCH, x, y, woodCol, 1);
        }
      }
    }

    // 31: Meadow Tall Grass (16x16 cutout swaying grass blades)
    const grassBlades = [
      '0000000000000000',
      '0003000000030000',
      '0003000300320000',
      '0032000300320030',
      '0032003203210320',
      '0321003203210320',
      '0321032102213210',
      '0221332122113210',
      '0211322122112110',
      '3211221121122100',
      '2211211221121100',
      '2112211211121130',
      '1112111211111320',
      '1112111111113210',
      '1111111111112110',
      '1111111111111110',
    ];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const c = grassBlades[y][x];
        if (c === '0') this.put(ctx, T.TALL_GRASS, x, y, [0, 0, 0], 0);
        else if (c === '1') this.put(ctx, T.TALL_GRASS, x, y, gDark, 1);
        else if (c === '2') this.put(ctx, T.TALL_GRASS, x, y, gMid, 1);
        else this.put(ctx, T.TALL_GRASS, x, y, gBright, 1);
      }
    }

    // 32: Wildflower Bush (lush green bush blades + golden/crimson/sky blossoms)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const c = grassBlades[y][x];
        const isGoldFlower = (x >= 2 && x <= 4 && y >= 2 && y <= 4 && (x === 3 || y === 3));
        const isRedFlower = (x >= 9 && x <= 11 && y >= 3 && y <= 5 && (x === 10 || y === 4));
        const isBlueFlower = (x >= 6 && x <= 8 && y >= 5 && y <= 7 && (x === 7 || y === 6));
        if (isGoldFlower) {
          this.put(ctx, T.WILDFLOWER_BUSH, x, y, x === 3 && y === 3 ? hex('#fff7a8') : hex('#f5b82e'), 1);
        } else if (isRedFlower) {
          this.put(ctx, T.WILDFLOWER_BUSH, x, y, x === 10 && y === 4 ? hex('#ffd966') : hex('#eb463b'), 1);
        } else if (isBlueFlower) {
          this.put(ctx, T.WILDFLOWER_BUSH, x, y, x === 7 && y === 6 ? hex('#ffffff') : hex('#4da6ff'), 1);
        } else if (c === '0') {
          this.put(ctx, T.WILDFLOWER_BUSH, x, y, [0, 0, 0], 0);
        } else if (c === '1') {
          this.put(ctx, T.WILDFLOWER_BUSH, x, y, gDark, 1);
        } else if (c === '2') {
          this.put(ctx, T.WILDFLOWER_BUSH, x, y, gMid, 1);
        } else {
          this.put(ctx, T.WILDFLOWER_BUSH, x, y, gBright, 1);
        }
      }
    }

    // 33: Campfire Flame Texture (roaring tongues of fire for the campfire core)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const centerDist = Math.abs(x - 7.5);
        const tongue = Math.sin(x * 1.1 + y * 0.5) * 1.6;
        const maxWidth = (y / 16) * 7.5 + 1.5 + tongue * 0.5;
        if (centerDist > maxWidth || y < 2) {
          this.put(ctx, T.CAMPFIRE, x, y, [0, 0, 0], 0);
        } else if (centerDist < maxWidth * 0.38 && y > 7) {
          this.put(ctx, T.CAMPFIRE, x, y, hex('#fffce6'), 1);
        } else if (centerDist < maxWidth * 0.68) {
          this.put(ctx, T.CAMPFIRE, x, y, hex('#ffcf40'), 1);
        } else {
          this.put(ctx, T.CAMPFIRE, x, y, hex('#ff6214'), 1);
        }
      }
    }

    // 34: Sakura Fey Blossom Leaves (with see-through gaps)
    const sakuraCols: Record<string, RGB> = {
      '1': hex('#b83b7d'),
      '2': hex('#ed64a6'),
      '3': hex('#fbcfe8'),
    };
    // 36: Frostpine Needles (with see-through gaps)
    const pineCols: Record<string, RGB> = {
      '1': hex('#1b4332'),
      '2': hex('#2d6a4f'),
      '3': hex('#52b788'),
    };
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const ch = leafPattern[(y + 3) % 16][(x + 3) % 16];
        if (ch === '0') {
          this.put(ctx, T.SAKURA_LEAVES, x, y, [0, 0, 0], 0);
          this.put(ctx, T.PINE_LEAVES, x, y, [0, 0, 0], 0);
        } else {
          this.put(ctx, T.SAKURA_LEAVES, x, y, sakuraCols[ch], 1);
          this.put(ctx, T.PINE_LEAVES, x, y, pineCols[ch], 1);
        }

        // 35: Silverpine Timber Bark
        const pr = (x + Math.floor(Math.sin(y * 0.5))) % 4;
        const pBark = pr === 0 ? hex('#2b1d12') : pr === 1 ? hex('#4a3525') : hex('#3b291c');
        this.put(ctx, T.PINE_LOG_SIDE, x, y, pBark);

        // 37 & 38: Desert Saguaro Cactus Side & Top
        const rib = x % 4 === 0;
        const spine = (x % 4 === 2 && y % 5 === 2);
        this.put(ctx, T.CACTUS_SIDE, x, y, spine ? hex('#f5ecc6') : rib ? hex('#2b6e2e') : hex('#449e48'));
        const cd = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        this.put(ctx, T.CACTUS_TOP, x, y, cd > 6 ? hex('#2b6e2e') : cd < 2 ? hex('#80cf6b') : hex('#449e48'));

        // 39: Molten Dragon Lava
        const lv = Math.sin(x * 0.5 + y * 0.4) * 0.5 + 0.5;
        this.put(ctx, T.LAVA, x, y, lv > 0.7 ? hex('#ffea59') : lv > 0.35 ? hex('#ff6a14') : hex('#9e2508'));

        // 40: Void Obsidian
        const ob = smoothNoise16(x, y, 2.2, 151);
        const glint = (x + y * 2) % 11 === 0;
        this.put(ctx, T.OBSIDIAN, x, y, glint ? hex('#6b3fa0') : lerpRgb(hex('#140c24'), hex('#321d4f'), ob));

        // 41: Arcane Aether Crystal
        const facet = Math.abs(x - 7.5) + Math.abs(y - 7.5);
        const aeCol = facet < 4 ? hex('#e9d5ff') : (x ^ y) % 3 === 0 ? hex('#38bdf8') : hex('#a855f7');
        this.put(ctx, T.AETHER_CRYSTAL, x, y, aeCol);

        // 43 & 44: Alchemist's Powder Keg (Fantasy TNT)
        const band = y < 2 || y > 13;
        const redLabel = y >= 6 && y <= 9;
        this.put(
          ctx,
          T.POWDER_KEG_SIDE,
          x,
          y,
          band ? hex('#475569') : redLabel ? ((x + y) % 2 === 0 ? hex('#ef4444') : hex('#dc2626')) : x % 4 === 0 ? hex('#6b4b28') : hex('#8f6739')
        );
        this.put(ctx, T.POWDER_KEG_TOP, x, y, (x >= 6 && x <= 9 && y >= 6 && y <= 9) ? hex('#f8fafc') : hex('#b91c1c'));

        // 45: Ancient Runestone (Stone carved with glowing cyan runes)
        const isRune =
          (x >= 4 && x <= 11 && (y === 4 || y === 8 || y === 11)) ||
          (y >= 4 && y <= 11 && (x === 5 || x === 10));
        const stS = smoothNoise16(x, y, 2.4, 37);
        this.put(ctx, T.RUNE_STONE, x, y, isRune ? hex('#38bdf8') : lerpRgb(stDark, stLight, stS));
      }
    }

    // 42: Luminous Fey Shroom (Cutout glowing cyan-violet mushroom cluster)
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const cap1 = y >= 4 && y <= 8 && Math.abs(x - 5) <= (8 - y + 1);
        const stem1 = y > 8 && y <= 15 && Math.abs(x - 5) <= 1;
        const cap2 = y >= 7 && y <= 10 && Math.abs(x - 11) <= (10 - y + 1);
        const stem2 = y > 10 && y <= 15 && Math.abs(x - 11) <= 1;
        if (cap1 || cap2) {
          const spot = (x + y) % 3 === 0;
          this.put(ctx, T.GLOW_MUSHROOM, x, y, spot ? hex('#a5f3fc') : hex('#06b6d4'), 1);
        } else if (stem1 || stem2) {
          this.put(ctx, T.GLOW_MUSHROOM, x, y, hex('#cbd5e1'), 1);
        } else {
          this.put(ctx, T.GLOW_MUSHROOM, x, y, [0, 0, 0], 0);
        }
      }
    }

    // 46..51: Scholar Bookshelf Connected Textures (Mode 2: 1x2 Horizontal Pair, Mode 3: 2x2 Stacked Grand Library)
    const shelfWood = hex('#ba8f5a');
    const shelfShadow = hex('#75532d');
    const backWood = hex('#3d2917');
    const palette2 = [hex('#c93b32'), hex('#2970b8'), hex('#329452'), hex('#d9a129'), hex('#8542b5'), hex('#1f9e8e')];

    const paintShelfVariant = (
      tile: number,
      openLeft: boolean,
      openRight: boolean,
      variantSeed: number
    ) => {
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const isTopBottom = y < 2 || y > 13 || y === 7 || y === 8;
          const isLeftFrame = !openLeft && x === 0;
          const isRightFrame = !openRight && x === 15;
          if (isTopBottom || isLeftFrame || isRightFrame) {
            this.put(ctx, tile, x, y, y === 1 || y === 9 ? shelfShadow : shelfWood);
            continue;
          }

          const upperRow = y < 7;
          // In variant 1 (1x2 Right) or 2x2 TR: place a glowing cyan potion flask or golden astrolabe curio!
          if (variantSeed === 2 && upperRow && x >= 9 && x <= 12) {
            const isFlask = y >= 4 && (x === 10 || x === 11);
            const isNeck = y === 3 && x === 10;
            this.put(ctx, tile, x, y, isFlask ? hex('#38bdf8') : isNeck ? hex('#e2e8f0') : backWood);
            continue;
          }
          if (variantSeed === 4 && !upperRow && x >= 4 && x <= 8) {
            // Stacked parchment scrolls in 2x2 library
            const isScroll = (x + y) % 2 === 0 && y >= 10;
            this.put(ctx, tile, x, y, isScroll ? hex('#f5ebd0') : backWood);
            continue;
          }

          // Varied book heights & leaning books
          const slot = Math.floor((x + variantSeed * 3) / 2);
          const bookTop = 2 + ((slot * 7 + variantSeed) % 2);
          const localY = upperRow ? y : y - 7;
          if (localY < bookTop) {
            this.put(ctx, tile, x, y, backWood);
          } else {
            const bCol = palette2[(slot + (upperRow ? 0 : 3) + variantSeed) % palette2.length];
            const isSpineEdge = x % 2 === 0;
            const isGoldTrim = localY === bookTop + 1 || localY === 5;
            this.put(
              ctx,
              tile,
              x,
              y,
              isSpineEdge ? (isGoldTrim ? hex('#facc15') : bCol) : scaleRgb(bCol, 0.8)
            );
          }
        }
      }
    };

    // Mode 2: 1x2 Side-by-Side Horizontal Pair (open inner seam!)
    paintShelfVariant(T.BOOKSHELF_1X2_L, false, true, 1);
    paintShelfVariant(T.BOOKSHELF_1X2_R, true, false, 2);

    // Mode 3: 2x2 Stacked Grand Library Wall (4 distinct quadrants!)
    paintShelfVariant(T.BOOKSHELF_2X2_TL, false, true, 3);
    paintShelfVariant(T.BOOKSHELF_2X2_TR, true, false, 4);
    paintShelfVariant(T.BOOKSHELF_2X2_BL, false, true, 5);
    paintShelfVariant(T.BOOKSHELF_2X2_BR, true, false, 6);
  }

  public getBlockIconDataUrl(blockId: BlockId): string {
    if (this.iconCache.has(blockId)) return this.iconCache.get(blockId)!;
    const def = BLOCKS[blockId];
    const [topTile, , sideTile] = def.textures;

    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 48;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;

    if (def.renderType === 'torch') {
      const sx = (sideTile % ATLAS_COLS) * TILE_SIZE;
      const sy = Math.floor(sideTile / ATLAS_COLS) * TILE_SIZE;
      ctx.drawImage(this.canvas, sx, sy, TILE_SIZE, TILE_SIZE, 19, 6, 10, 36);
      const url = c.toDataURL();
      this.iconCache.set(blockId, url);
      return url;
    }

    if (def.renderType === 'campfire') {
      // Draw crossed logs + roaring flame icon
      ctx.fillStyle = '#6b4b28';
      ctx.fillRect(8, 32, 32, 7);
      ctx.fillStyle = '#8f6739';
      ctx.fillRect(10, 27, 28, 6);
      const sx = (sideTile % ATLAS_COLS) * TILE_SIZE;
      const sy = Math.floor(sideTile / ATLAS_COLS) * TILE_SIZE;
      ctx.drawImage(this.canvas, sx, sy, TILE_SIZE, TILE_SIZE, 10, 4, 28, 28);
      const url = c.toDataURL();
      this.iconCache.set(blockId, url);
      return url;
    }

    if (def.renderType === 'cross') {
      const sx = (sideTile % ATLAS_COLS) * TILE_SIZE;
      const sy = Math.floor(sideTile / ATLAS_COLS) * TILE_SIZE;
      ctx.drawImage(this.canvas, sx, sy, TILE_SIZE, TILE_SIZE, 6, 6, 36, 36);
      const url = c.toDataURL();
      this.iconCache.set(blockId, url);
      return url;
    }

    const drawTileFace = (tile: number, transform: [number, number, number, number, number, number], brightness: number) => {
      const temp = document.createElement('canvas');
      temp.width = TILE_SIZE;
      temp.height = TILE_SIZE;
      const tCtx = temp.getContext('2d')!;
      const sx = (tile % ATLAS_COLS) * TILE_SIZE;
      const sy = Math.floor(tile / ATLAS_COLS) * TILE_SIZE;
      tCtx.drawImage(this.canvas, sx, sy, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
      if (brightness < 1) {
        tCtx.fillStyle = `rgba(0,0,0,${1 - brightness})`;
        tCtx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
      }
      ctx.save();
      ctx.setTransform(...transform);
      ctx.drawImage(temp, 0, 0);
      ctx.restore();
    };

    drawTileFace(topTile, [1.15, 0.58, -1.15, 0.58, 24, 4], 1.0);
    drawTileFace(sideTile, [1.15, 0.58, 0, 1.35, 5.6, 13.3], 0.88);
    drawTileFace(sideTile, [1.15, -0.58, 0, 1.35, 24, 22.6], 0.74);

    const url = c.toDataURL();
    this.iconCache.set(blockId, url);
    return url;
  }
}
