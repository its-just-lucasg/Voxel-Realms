import * as THREE from 'three';
import { createNoise2D, createNoise3D } from 'simplex-noise';
import { BlockId, BLOCKS } from './blocks';
import { ATLAS_COLS, ATLAS_ROWS, TextureAtlas } from './textures';

export const CHUNK_SIZE = 16;
export const CHUNK_HEIGHT = 96;
export const WATER_LEVEL = 30;

interface FaceDef {
  dir: [number, number, number];
  corners: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ];
  uvs: [[number, number], [number, number], [number, number], [number, number]];
  texSlot: 0 | 1 | 2;
  shade: number;
}

const FACES: FaceDef[] = [
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]], texSlot: 0, shade: 1.0 },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]], texSlot: 1, shade: 0.58 },
  { dir: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]], texSlot: 2, shade: 0.88 },
  { dir: [0, 0, -1], corners: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]], texSlot: 2, shade: 0.82 },
  { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]], texSlot: 2, shade: 0.75 },
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]], texSlot: 2, shade: 0.79 },
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ChunkMeshEntry {
  opaque?: THREE.Mesh;
  water?: THREE.Mesh;
  animY: number; // Smooth rise-in animation offset (0 when settled)
}

export class VoxelWorld {
  private scene: THREE.Scene;
  private atlas: TextureAtlas;
  private chunks = new Map<string, Uint8Array>();
  private chunkMeshes = new Map<string, ChunkMeshEntry>();
  private edits = new Map<string, BlockId>();
  private buildQueue: { cx: number; cz: number; key: string; distSq: number }[] = [];
  private queuedKeys = new Set<string>();

  private noise2D!: ReturnType<typeof createNoise2D>;
  private tempNoise2D!: ReturnType<typeof createNoise2D>;
  private forestNoise2D!: ReturnType<typeof createNoise2D>;
  private caveNoise3D!: ReturnType<typeof createNoise3D>;
  public seed = 1337;
  public renderDistance = 8; // 8 chunks radius = 17x17 chunks (272x272 blocks!)

  private torchPositions = new Map<string, THREE.Vector3>();
  private torchLightPool: THREE.PointLight[] = [];
  private torchFlickerTime = 0;

  // Flowing water cellular automata state
  private activeWaterSet = new Set<string>();
  private waterLevels = new Map<string, number>(); // 7 = source/lake, 6..1 = flowing spread
  private waterStepTimer = 0;

  constructor(scene: THREE.Scene, atlas: TextureAtlas) {
    this.scene = scene;
    this.atlas = atlas;

    // Create pool of real dynamic PointLights for placed torches (same warm light as personal lantern)
    for (let i = 0; i < 12; i++) {
      const light = new THREE.PointLight(0xffaa44, 0, 18, 1.6);
      this.scene.add(light);
      this.torchLightPool.push(light);
    }

    this.loadSavedState();
    this.initNoise(this.seed);
  }

  private initNoise(seed: number): void {
    this.seed = seed;
    this.noise2D = createNoise2D(mulberry32(seed));
    this.tempNoise2D = createNoise2D(mulberry32(seed + 99991));
    this.forestNoise2D = createNoise2D(mulberry32(seed + 177771));
    this.caveNoise3D = createNoise3D(mulberry32(seed + 314159));
  }

  private chunkKey(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  private blockKey(x: number, y: number, z: number): string {
    return `${x},${y},${z}`;
  }

  private localIndex(lx: number, y: number, lz: number): number {
    return y * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx;
  }

  public getBiomeNameAt(wx: number, wz: number): string {
    const temp = this.tempNoise2D(wx * 0.0025, wz * 0.0025);
    const forest = this.forestNoise2D(wx * 0.0045, wz * 0.0045);
    const height = this.getTerrainHeight(wx, wz);
    if (height <= WATER_LEVEL + 2) return 'Azure Lagoon & Shore';
    if (height >= 58 || temp < -0.38) return 'Crystal Frost Peaks';
    if (temp > 0.42) return 'Sunscorched Amber Dunes';
    if (forest > 0.22 && temp > 0.12) return 'Enchanted Sakura Feywood';
    if (forest > 0.14) {
      return temp > -0.05 ? 'Ancient Oak & Ruin Woodland' : 'Sunlit Birch Forest';
    }
    return 'Emerald Wildflower Meadow';
  }

  public getTerrainHeight(wx: number, wz: number): number {
    // Smoother micro-voxel frequencies so rolling hills step gradually
    const n1 = this.noise2D(wx * 0.0055, wz * 0.0055);
    const n2 = this.noise2D(wx * 0.016, wz * 0.016) * 0.38;
    const n3 = this.noise2D(wx * 0.042, wz * 0.042) * 0.12;
    const continental = this.noise2D(wx * 0.0022, wz * 0.0022);

    let mountainBoost = 0;
    if (continental > 0.22) {
      mountainBoost = Math.pow(continental - 0.22, 1.45) * 38;
    }

    const raw = 35 + (n1 + n2 + n3) * 16 + mountainBoost;
    return Math.max(6, Math.min(CHUNK_HEIGHT - 16, Math.floor(raw)));
  }

  private generateChunkData(cx: number, cz: number): Uint8Array {
    const data = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = startX + lx;
        const wz = startZ + lz;
        const surfY = this.getTerrainHeight(wx, wz);
        const temp = this.tempNoise2D(wx * 0.0045, wz * 0.0045);

        for (let y = 0; y <= Math.max(surfY, WATER_LEVEL); y++) {
          let block = BlockId.Air;
          if (y === 0) {
            block = BlockId.Bedrock;
          } else if (y > surfY) {
            if (y <= WATER_LEVEL) block = BlockId.Water;
          } else {
            const caveVal = this.caveNoise3D(wx * 0.055, y * 0.065, wz * 0.055);
            if (y > 2 && y < surfY - 3 && caveVal > 0.62) {
              // Deep Lava & Glowing Mushroom Caverns
              if (y <= 8) block = BlockId.Lava;
              else block = BlockId.Air;
            } else if (y === surfY) {
              if (surfY <= WATER_LEVEL + 1) block = BlockId.Sand;
              else if (surfY >= 41 || temp < -0.38) block = surfY >= 47 ? BlockId.Snow : BlockId.SnowGrass;
              else if (temp > 0.42) block = BlockId.Sand;
              else block = BlockId.Grass;
            } else if (y >= surfY - 3) {
              block = surfY <= WATER_LEVEL + 1 || temp > 0.42 ? BlockId.Sandstone : BlockId.Dirt;
            } else {
              const oreNoise = this.caveNoise3D(wx * 0.16, y * 0.16, wz * 0.16);
              if (y < 16 && oreNoise > 0.78) block = BlockId.AetherCrystal;
              else if (y < 14 && oreNoise > 0.74) block = BlockId.DiamondOre;
              else if (y < 24 && oreNoise > 0.71) block = BlockId.GoldOre;
              else if (oreNoise > 0.68) block = BlockId.CoalOre;
              else block = BlockId.Stone;
            }
          }
          if (block !== BlockId.Air) {
            data[this.localIndex(lx, y, lz)] = block;
          }
        }
      }
    }

    // Decorate with Sculpted Round Micro-Voxel Trees, Bushes, Cacti, Ruins & Flora
    for (let lx = 2; lx < CHUNK_SIZE - 2; lx++) {
      for (let lz = 2; lz < CHUNK_SIZE - 2; lz++) {
        const wx = startX + lx;
        const wz = startZ + lz;
        const surfY = this.getTerrainHeight(wx, wz);
        const temp = this.tempNoise2D(wx * 0.0025, wz * 0.0025);
        const forest = this.forestNoise2D(wx * 0.0045, wz * 0.0045);
        const h1 = Math.abs(Math.sin(wx * 12.9898 + wz * 78.233 + this.seed) * 43758.5453) % 1;
        const h2 = Math.abs(Math.sin(wx * 39.346 + wz * 11.135 + this.seed * 2) * 23421.631) % 1;

        if (surfY > WATER_LEVEL + 2 && temp > 0.42) {
          if (h1 > 0.988 && lx >= 4 && lx < CHUNK_SIZE - 4) {
            for (let cy = 1; cy <= 6; cy++) {
              if (surfY + cy < CHUNK_HEIGHT - 1) data[this.localIndex(lx, surfY + cy, lz)] = BlockId.Cactus;
            }
            // Side cactus arms!
            if (surfY + 4 < CHUNK_HEIGHT - 1) {
              data[this.localIndex(lx + 1, surfY + 3, lz)] = BlockId.Cactus;
              data[this.localIndex(lx + 1, surfY + 4, lz)] = BlockId.Cactus;
              data[this.localIndex(lx - 1, surfY + 4, lz)] = BlockId.Cactus;
              data[this.localIndex(lx - 1, surfY + 5, lz)] = BlockId.Cactus;
            }
          }
          continue;
        }

        if (surfY >= 58 || temp < -0.38) {
          if (surfY > WATER_LEVEL + 3 && lx >= 4 && lx < CHUNK_SIZE - 4 && lz >= 4 && lz < CHUNK_SIZE - 4 && h1 > 0.976) {
            this.placePineTreeInChunk(data, lx, surfY + 1, lz);
          }
          continue;
        }

        if (surfY > WATER_LEVEL + 2 && surfY < 58) {
          const isSakura = forest > 0.22 && temp > 0.12;
          const isBirch = !isSakura && temp < -0.05;
          const treeThreshold = forest > 0.32 ? 0.958 : forest > 0.14 ? 0.974 : 0.996;

          if (lx === 8 && lz === 8 && forest > 0.18 && h2 > 0.92) {
            this.placeAncientRuinInChunk(data, lx, surfY + 1, lz);
          } else if (lx >= 4 && lx < CHUNK_SIZE - 4 && lz >= 4 && lz < CHUNK_SIZE - 4 && h1 > treeThreshold) {
            this.placeTreeInChunk(data, lx, surfY + 1, lz, isBirch, isSakura);
          } else if (forest > 0.05 && h1 > 0.918 && h1 <= 0.926) {
            this.placeBushInChunk(data, lx, surfY + 1, lz, isBirch, isSakura);
          } else if (data[this.localIndex(lx, surfY + 1, lz)] === BlockId.Air) {
            const grassChance = forest > 0.14 ? 0.16 : 0.22;
            if (h2 < grassChance) {
              data[this.localIndex(lx, surfY + 1, lz)] =
                (isSakura || forest > 0.28) && h1 > 0.88
                  ? BlockId.GlowMushroom
                  : h1 > 0.74
                  ? BlockId.WildflowerBush
                  : BlockId.TallGrass;
            }
          }
        }
      }
    }

    if (this.edits.size > 0) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        for (let lz = 0; lz < CHUNK_SIZE; lz++) {
          const wx = startX + lx;
          const wz = startZ + lz;
          for (let y = 0; y < CHUNK_HEIGHT; y++) {
            const editKey = this.blockKey(wx, y, wz);
            const edited = this.edits.get(editKey);
            if (edited !== undefined) {
              data[this.localIndex(lx, y, lz)] = edited;
            }
          }
        }
      }
    }

    return data;
  }

  private placeBushInChunk(data: Uint8Array, lx: number, baseY: number, lz: number, isBirch: boolean, isSakura = false): void {
    const leafBlock = isSakura ? BlockId.SakuraLeaves : isBirch ? BlockId.BirchLeaves : BlockId.OakLeaves;
    if (baseY >= CHUNK_HEIGHT - 4) return;
    // Rounded 3D dome shrub
    for (let dy = 0; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (dx * dx + dy * 1.8 + dz * dz <= 3.6) {
            const nx = lx + dx, nz = lz + dz;
            if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE) {
              const idx = this.localIndex(nx, baseY + dy, nz);
              if (data[idx] === BlockId.Air) data[idx] = leafBlock;
            }
          }
        }
      }
    }
  }

  private placePineTreeInChunk(data: Uint8Array, lx: number, baseY: number, lz: number): void {
    const height = 12;
    for (let y = baseY; y < baseY + height && y < CHUNK_HEIGHT - 2; y++) {
      data[this.localIndex(lx, y, lz)] = BlockId.PineLog;
    }
    // Smooth tapering circular pine cone layers
    for (let layer = 0; layer < 9; layer++) {
      const y = baseY + 3 + layer;
      if (y >= CHUNK_HEIGHT - 1) break;
      const r = Math.max(0.6, (1 - layer / 9) * 3.4 + (layer % 2 === 0 ? 0.4 : -0.2));
      const rCeil = Math.ceil(r);
      for (let dx = -rCeil; dx <= rCeil; dx++) {
        for (let dz = -rCeil; dz <= rCeil; dz++) {
          if (dx * dx + dz * dz <= r * r) {
            const nx = lx + dx, nz = lz + dz;
            if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE) {
              const idx = this.localIndex(nx, y, nz);
              if (data[idx] === BlockId.Air) data[idx] = BlockId.PineLeaves;
            }
          }
        }
      }
    }
  }

  private placeAncientRuinInChunk(data: Uint8Array, lx: number, baseY: number, lz: number): void {
    if (baseY >= CHUNK_HEIGHT - 9) return;
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        data[this.localIndex(lx + dx, baseY - 1, lz + dz)] =
          (dx + dz) % 2 === 0 ? BlockId.MossyCobble : BlockId.Cobblestone;
      }
    }
    const corners = [[-3, -3], [3, -3], [-3, 3], [3, 3]];
    for (const [cx, cz] of corners) {
      const h = 5 + ((cx * cz + 4) % 3);
      for (let py = 0; py < h; py++) {
        data[this.localIndex(lx + cx, baseY + py, lz + cz)] =
          py === h - 1 ? BlockId.RuneStone : BlockId.MossyCobble;
      }
    }
    data[this.localIndex(lx, baseY, lz)] = BlockId.RuneStone;
    data[this.localIndex(lx, baseY + 1, lz)] = BlockId.RuneStone;
    data[this.localIndex(lx, baseY + 2, lz)] = BlockId.AetherCrystal;
  }

  private placeTreeInChunk(data: Uint8Array, lx: number, baseY: number, lz: number, isBirch: boolean, isSakura = false): void {
    const trunkBlock = isBirch ? BlockId.BirchLog : BlockId.OakLog;
    const leafBlock = isSakura ? BlockId.SakuraLeaves : isBirch ? BlockId.BirchLeaves : BlockId.OakLeaves;
    const height = isBirch ? 10 : 9;

    // Sculpted trunk + root flares at base
    for (let y = baseY; y < baseY + height && y < CHUNK_HEIGHT - 3; y++) {
      data[this.localIndex(lx, y, lz)] = trunkBlock;
    }
    const roots = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [rx, rz] of roots) {
      if (baseY < CHUNK_HEIGHT - 2) {
        data[this.localIndex(lx + rx, baseY, lz + rz)] = trunkBlock;
      }
      // Upper branches inside the crown
      const by = baseY + height - 2;
      if (by < CHUNK_HEIGHT - 2) {
        data[this.localIndex(lx + rx, by, lz + rz)] = trunkBlock;
      }
    }

    // True 3D Round Ellipsoid Leaf Canopy (rx = 3.6, ry = 2.8, rz = 3.6)
    const centerY = baseY + height - 1;
    const rx = 3.6, ry = 2.8, rz = 3.6;
    for (let dy = -3; dy <= 3; dy++) {
      const y = centerY + dy;
      if (y < 1 || y >= CHUNK_HEIGHT - 1) continue;
      for (let dx = -4; dx <= 4; dx++) {
        for (let dz = -4; dz <= 4; dz++) {
          const normDist = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rz * rz);
          if (normDist <= 1.0) {
            const nx = lx + dx;
            const nz = lz + dz;
            if (nx >= 0 && nx < CHUNK_SIZE && nz >= 0 && nz < CHUNK_SIZE) {
              const idx = this.localIndex(nx, y, nz);
              if (data[idx] === BlockId.Air) data[idx] = leafBlock;
            }
          }
        }
      }
    }
  }

  private ensureChunk(cx: number, cz: number): Uint8Array {
    const key = this.chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = this.generateChunkData(cx, cz);
      this.chunks.set(key, chunk);
    }
    return chunk;
  }

  public getBlock(wx: number, wy: number, wz: number): BlockId {
    if (wy < 0 || wy >= CHUNK_HEIGHT) return BlockId.Air;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    const chunk = this.ensureChunk(cx, cz);
    return chunk[this.localIndex(lx, wy, lz)] as BlockId;
  }

  public setBlock(wx: number, wy: number, wz: number, blockId: BlockId): void {
    if (wy <= 0 || wy >= CHUNK_HEIGHT) return;
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;

    const chunk = this.ensureChunk(cx, cz);
    chunk[this.localIndex(lx, wy, lz)] = blockId;
    const bKey = this.blockKey(wx, wy, wz);
    this.edits.set(bKey, blockId);
    if (blockId === BlockId.Torch || blockId === BlockId.Campfire) {
      this.torchPositions.set(bKey, new THREE.Vector3(wx + 0.5, wy + 0.65, wz + 0.5));
    } else {
      this.torchPositions.delete(bKey);
    }
    if (blockId === BlockId.Water) {
      this.waterLevels.set(bKey, 7);
    } else {
      this.waterLevels.delete(bKey);
    }

    // Wake up water physics at modified voxel and its 6 neighbors
    this.enqueueWaterNeighborhood(wx, wy, wz);
    this.saveState();

    this.rebuildChunkMesh(cx, cz, false);
    if (lx === 0) this.rebuildChunkMesh(cx - 1, cz, false);
    if (lx === CHUNK_SIZE - 1) this.rebuildChunkMesh(cx + 1, cz, false);
    if (lz === 0) this.rebuildChunkMesh(cx, cz - 1, false);
    if (lz === CHUNK_SIZE - 1) this.rebuildChunkMesh(cx, cz + 1, false);
  }

  public rebuildChunkMesh(cx: number, cz: number, animateRise = false): void {
    const key = this.chunkKey(cx, cz);
    const existing = this.chunkMeshes.get(key);
    if (existing) {
      if (existing.opaque) {
        this.scene.remove(existing.opaque);
        existing.opaque.geometry.dispose();
      }
      if (existing.water) {
        this.scene.remove(existing.water);
        existing.water.geometry.dispose();
      }
    }

    const grid: Uint8Array[] = [
      this.ensureChunk(cx - 1, cz - 1),
      this.ensureChunk(cx, cz - 1),
      this.ensureChunk(cx + 1, cz - 1),
      this.ensureChunk(cx - 1, cz),
      this.ensureChunk(cx, cz),
      this.ensureChunk(cx + 1, cz),
      this.ensureChunk(cx - 1, cz + 1),
      this.ensureChunk(cx, cz + 1),
      this.ensureChunk(cx + 1, cz + 1),
    ];

    const getLocalBlock = (lx: number, y: number, lz: number): BlockId => {
      if (y < 0 || y >= CHUNK_HEIGHT) return BlockId.Air;
      const gx = lx < 0 ? 0 : lx >= CHUNK_SIZE ? 2 : 1;
      const gz = lz < 0 ? 0 : lz >= CHUNK_SIZE ? 2 : 1;
      const clx = lx < 0 ? lx + CHUNK_SIZE : lx >= CHUNK_SIZE ? lx - CHUNK_SIZE : lx;
      const clz = lz < 0 ? lz + CHUNK_SIZE : lz >= CHUNK_SIZE ? lz - CHUNK_SIZE : lz;
      return grid[gz * 3 + gx][y * CHUNK_SIZE * CHUNK_SIZE + clz * CHUNK_SIZE + clx] as BlockId;
    };

    const isSolidLocal = (lx: number, y: number, lz: number): boolean =>
      BLOCKS[getLocalBlock(lx, y, lz)]?.solid ?? false;

    const computeFastAO = (
      lx: number,
      y: number,
      lz: number,
      dir: [number, number, number],
      corner: [number, number, number]
    ): number => {
      const nx = lx + dir[0], ny = y + dir[1], nz = lz + dir[2];
      const sx = corner[0] === 1 ? 1 : -1;
      const sy = corner[1] === 1 ? 1 : -1;
      const sz = corner[2] === 1 ? 1 : -1;

      let s1 = false, s2 = false, c = false;
      if (dir[1] !== 0) {
        s1 = isSolidLocal(nx + sx, ny, nz);
        s2 = isSolidLocal(nx, ny, nz + sz);
        c = isSolidLocal(nx + sx, ny, nz + sz);
      } else if (dir[0] !== 0) {
        s1 = isSolidLocal(nx, ny + sy, nz);
        s2 = isSolidLocal(nx, ny, nz + sz);
        c = isSolidLocal(nx, ny + sy, nz + sz);
      } else {
        s1 = isSolidLocal(nx + sx, ny, nz);
        s2 = isSolidLocal(nx, ny + sy, nz);
        c = isSolidLocal(nx + sx, ny + sy, nz);
      }
      const occ = s1 && s2 ? 3 : (s1 ? 1 : 0) + (s2 ? 1 : 0) + (c ? 1 : 0);
      return [1.0, 0.83, 0.66, 0.50][occ];
    };

    this.emitChunkGeometry(cx, cz, key, grid[4], getLocalBlock, computeFastAO, animateRise);
  }

  private emitChunkGeometry(
    cx: number,
    cz: number,
    key: string,
    centerChunk: Uint8Array,
    getLocalBlock: (lx: number, y: number, lz: number) => BlockId,
    computeFastAO: (lx: number, y: number, lz: number, dir: [number, number, number], corner: [number, number, number]) => number,
    animateRise: boolean
  ): void {
    const posO: number[] = [], normO: number[] = [], uvO: number[] = [], colO: number[] = [], idxO: number[] = [];
    const posW: number[] = [], normW: number[] = [], uvW: number[] = [], colW: number[] = [], idxW: number[] = [];

    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;
    const pad = 0.002;

    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = startX + lx;
        const wz = startZ + lz;
        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const id = centerChunk[y * CHUNK_SIZE * CHUNK_SIZE + lz * CHUNK_SIZE + lx] as BlockId;
          if (id === BlockId.Air) continue;
          const def = BLOCKS[id];

          // Handle X-crossed foliage (Tall Grass & Wildflower Bushes)
          if (def.renderType === 'cross') {
            const tile = def.textures[0];
            const u0 = (tile % ATLAS_COLS) / ATLAS_COLS + pad;
            const u1 = ((tile % ATLAS_COLS) + 1) / ATLAS_COLS - pad;
            const v1 = 1 - Math.floor(tile / ATLAS_COLS) / ATLAS_ROWS - pad;
            const v0 = 1 - (Math.floor(tile / ATLAS_COLS) + 1) / ATLAS_ROWS + pad;
            const ao = computeFastAO(lx, y, lz, [0, 1, 0], [0, 0, 0]);
            const light = Math.max(0.75, 0.92 * ao);

            const emitQuad = (x1: number, z1: number, x2: number, z2: number) => {
              const baseV = posO.length / 3;
              posO.push(
                wx + x1, y, wz + z1,
                wx + x2, y, wz + z2,
                wx + x2, y + 0.92, wz + z2,
                wx + x1, y + 0.92, wz + z1
              );
              for (let k = 0; k < 4; k++) {
                normO.push(0, 1, 0);
                colO.push(light, light, light);
              }
              uvO.push(u0, v0, u1, v0, u1, v1, u0, v1);
              idxO.push(baseV, baseV + 1, baseV + 2, baseV, baseV + 2, baseV + 3);
            };
            emitQuad(0.14, 0.14, 0.86, 0.86);
            emitQuad(0.14, 0.86, 0.86, 0.14);
            continue;
          }

          // Helper to emit a solid 3D rectangular prism for Torches & Campfire logs
          const emitSolidBox = (
            bx0: number,
            by0: number,
            bz0: number,
            bx1: number,
            by1: number,
            bz1: number,
            sideTile: number,
            topTile: number,
            brightness: number
          ) => {
            const su0 = (sideTile % ATLAS_COLS) / ATLAS_COLS + pad;
            const su1 = ((sideTile % ATLAS_COLS) + 1) / ATLAS_COLS - pad;
            const sv1 = 1 - Math.floor(sideTile / ATLAS_COLS) / ATLAS_ROWS - pad;
            const sv0 = 1 - (Math.floor(sideTile / ATLAS_COLS) + 1) / ATLAS_ROWS + pad;

            const tu0 = (topTile % ATLAS_COLS) / ATLAS_COLS + pad;
            const tu1 = ((topTile % ATLAS_COLS) + 1) / ATLAS_COLS - pad;
            const tv1 = 1 - Math.floor(topTile / ATLAS_COLS) / ATLAS_ROWS - pad;
            const tv0 = 1 - (Math.floor(topTile / ATLAS_COLS) + 1) / ATLAS_ROWS + pad;

            const pushFace = (
              verts: [number, number, number][],
              nx: number,
              ny: number,
              nz: number,
              uA: number,
              uB: number,
              vA: number,
              vB: number,
              sh: number
            ) => {
              const baseV = posO.length / 3;
              for (const [vx, vy, vz] of verts) {
                posO.push(wx + vx, y + vy, wz + vz);
                normO.push(nx, ny, nz);
                const cVal = Math.min(1.0, brightness * sh);
                colO.push(cVal, cVal, cVal);
              }
              uvO.push(uA, vA, uB, vA, uB, vB, uA, vB);
              idxO.push(baseV, baseV + 1, baseV + 2, baseV, baseV + 2, baseV + 3);
            };

            // Top (+Y)
            pushFace([[bx0, by1, bz1], [bx1, by1, bz1], [bx1, by1, bz0], [bx0, by1, bz0]], 0, 1, 0, tu0, tu1, tv0, tv1, 1.0);
            // Front (+Z)
            pushFace([[bx0, by0, bz1], [bx1, by0, bz1], [bx1, by1, bz1], [bx0, by1, bz1]], 0, 0, 1, su0, su1, sv0, sv1, 0.92);
            // Back (-Z)
            pushFace([[bx1, by0, bz0], [bx0, by0, bz0], [bx0, by1, bz0], [bx1, by1, bz0]], 0, 0, -1, su0, su1, sv0, sv1, 0.86);
            // Right (+X)
            pushFace([[bx1, by0, bz1], [bx1, by0, bz0], [bx1, by1, bz0], [bx1, by1, bz1]], 1, 0, 0, su0, su1, sv0, sv1, 0.82);
            // Left (-X)
            pushFace([[bx0, by0, bz0], [bx0, by0, bz1], [bx0, by1, bz1], [bx0, by1, bz0]], -1, 0, 0, su0, su1, sv0, sv1, 0.84);
          };

          // Handle Solid 3D Minecraft-Style Flame Torch Post (filled-in rectangular prism, not an X)
          if (def.renderType === 'torch') {
            const bKey = this.blockKey(wx, y, wz);
            this.torchPositions.set(bKey, new THREE.Vector3(wx + 0.5, y + 0.65, wz + 0.5));
            const tile = def.textures[0];
            emitSolidBox(0.43, 0.0, 0.43, 0.57, 0.64, 0.57, tile, 21, 1.0);
            continue;
          }

          // Handle 3D Cozy Campfire (4 crisscrossed oak logs + glowing ember bed + roaring central flames)
          if (def.renderType === 'campfire') {
            const bKey = this.blockKey(wx, y, wz);
            this.torchPositions.set(bKey, new THREE.Vector3(wx + 0.5, y + 0.65, wz + 0.5));
            // Glowing ember bed
            emitSolidBox(0.22, 0.0, 0.22, 0.78, 0.10, 0.78, 28, 28, 1.0);
            // Lower pair of logs (along X)
            emitSolidBox(0.08, 0.0, 0.16, 0.92, 0.19, 0.34, 9, 10, 0.85);
            emitSolidBox(0.08, 0.0, 0.66, 0.92, 0.19, 0.84, 9, 10, 0.85);
            // Upper crossed pair of logs (along Z)
            emitSolidBox(0.16, 0.14, 0.08, 0.34, 0.33, 0.92, 9, 10, 0.9);
            emitSolidBox(0.66, 0.14, 0.08, 0.84, 0.33, 0.92, 9, 10, 0.9);

            // Roaring inner flame planes
            const fTile = def.textures[0];
            const u0 = (fTile % ATLAS_COLS) / ATLAS_COLS + pad;
            const u1 = ((fTile % ATLAS_COLS) + 1) / ATLAS_COLS - pad;
            const v1 = 1 - Math.floor(fTile / ATLAS_COLS) / ATLAS_ROWS - pad;
            const v0 = 1 - (Math.floor(fTile / ATLAS_COLS) + 1) / ATLAS_ROWS + pad;
            const emitFlame = (x1: number, z1: number, x2: number, z2: number) => {
              const baseV = posO.length / 3;
              posO.push(
                wx + x1, y + 0.1, wz + z1,
                wx + x2, y + 0.1, wz + z2,
                wx + x2, y + 0.85, wz + z2,
                wx + x1, y + 0.85, wz + z1
              );
              for (let k = 0; k < 4; k++) {
                normO.push(0, 1, 0);
                colO.push(1.0, 0.98, 0.9);
              }
              uvO.push(u0, v0, u1, v0, u1, v1, u0, v1);
              idxO.push(baseV, baseV + 1, baseV + 2, baseV, baseV + 2, baseV + 3);
            };
            emitFlame(0.22, 0.22, 0.78, 0.78);
            emitFlame(0.22, 0.78, 0.78, 0.22);
            continue;
          }

          const isWater = def.liquid;

          for (const face of FACES) {
            const neighborId = getLocalBlock(lx + face.dir[0], y + face.dir[1], lz + face.dir[2]);
            const neighborDef = BLOCKS[neighborId];

            if (isWater) {
              if (neighborId === BlockId.Water || (neighborDef.solid && !neighborDef.transparent)) continue;
              if (face.dir[1] < 0) continue;
            } else {
              if (neighborId !== BlockId.Air && !neighborDef.transparent) continue;
              if (id === BlockId.Glass && neighborId === BlockId.Glass) continue;
            }

            const pos = isWater ? posW : posO;
            const norm = isWater ? normW : normO;
            const uv = isWater ? uvW : uvO;
            const col = isWater ? colW : colO;
            const idx = isWater ? idxW : idxO;

            const baseVertex = pos.length / 3;
            const tile = def.textures[face.texSlot];
            const u0 = (tile % ATLAS_COLS) / ATLAS_COLS + pad;
            const u1 = ((tile % ATLAS_COLS) + 1) / ATLAS_COLS - pad;
            const v1 = 1 - Math.floor(tile / ATLAS_COLS) / ATLAS_ROWS - pad;
            const v0 = 1 - (Math.floor(tile / ATLAS_COLS) + 1) / ATLAS_ROWS + pad;

            for (let c = 0; c < 4; c++) {
              const corner = face.corners[c];
              const yOffset = isWater && corner[1] === 1 ? -0.12 : 0;
              pos.push(wx + corner[0], y + corner[1] + yOffset, wz + corner[2]);
              norm.push(face.dir[0], face.dir[1], face.dir[2]);

              const rawU = face.uvs[c][0];
              const rawV = face.uvs[c][1];
              uv.push(rawU === 0 ? u0 : u1, rawV === 0 ? v0 : v1);

              const ao = isWater ? 0.96 : computeFastAO(lx, y, lz, face.dir, corner);
              const light = Math.min(1.0, Math.max(def.emissive, face.shade * ao));
              if (id === BlockId.Lava) {
                col.push(1.0, 0.35, 0.1);
              } else {
                col.push(light, light, light);
              }
            }

            idx.push(baseVertex, baseVertex + 1, baseVertex + 2, baseVertex, baseVertex + 2, baseVertex + 3);
          }
        }
      }
    }

    const startAnimY = animateRise ? -12 : 0;
    const result: ChunkMeshEntry = { animY: startAnimY };

    if (posO.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(posO, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normO, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvO, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colO, 3));
      geo.setIndex(idxO);
      const mesh = new THREE.Mesh(geo, this.atlas.opaqueMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.y = startAnimY;
      this.scene.add(mesh);
      result.opaque = mesh;
    }

    if (posW.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(posW, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(normW, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvW, 2));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colW, 3));
      geo.setIndex(idxW);
      const mesh = new THREE.Mesh(geo, this.atlas.waterMaterial);
      mesh.receiveShadow = true;
      mesh.position.y = startAnimY;
      this.scene.add(mesh);
      result.water = mesh;
    }

    this.chunkMeshes.set(key, result);
  }

  /**
   * Queues missing chunks around the player sorted nearest-first.
   * If `immediateRadius > 0`, builds the innermost chunks immediately (e.g. on initial spawn)
   * and streams the rest smoothly across frames.
   */
  public updateChunksAroundPlayer(px: number, pz: number, immediateRadius = 0): void {
    const centerCx = Math.floor(px / CHUNK_SIZE);
    const centerCz = Math.floor(pz / CHUNK_SIZE);
    const r = this.renderDistance;

    const needed = new Set<string>();
    const newlyQueued: { cx: number; cz: number; key: string; distSq: number }[] = [];

    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        const distSq = dx * dx + dz * dz;
        if (distSq > (r + 0.5) * (r + 0.5)) continue;
        const cx = centerCx + dx;
        const cz = centerCz + dz;
        const key = this.chunkKey(cx, cz);
        needed.add(key);

        if (!this.chunkMeshes.has(key)) {
          if (distSq <= immediateRadius * immediateRadius) {
            this.rebuildChunkMesh(cx, cz, false);
            this.queuedKeys.delete(key);
          } else if (!this.queuedKeys.has(key)) {
            this.queuedKeys.add(key);
            newlyQueued.push({ cx, cz, key, distSq });
          }
        }
      }
    }

    if (newlyQueued.length > 0) {
      this.buildQueue.push(...newlyQueued);
      // Update distances relative to current player chunk & sort nearest-first
      for (const item of this.buildQueue) {
        const dcx = item.cx - centerCx;
        const dcz = item.cz - centerCz;
        item.distSq = dcx * dcx + dcz * dcz;
      }
      this.buildQueue.sort((a, b) => a.distSq - b.distSq);
    }

    // Unload chunks well beyond render distance (hysteresis of +2 chunks prevents thrashing)
    const unloadRadiusSq = (r + 2.5) * (r + 2.5);
    for (const [key, meshes] of this.chunkMeshes.entries()) {
      if (!needed.has(key)) {
        const [scx, scz] = key.split(',').map(Number);
        const dSq = (scx - centerCx) ** 2 + (scz - centerCz) ** 2;
        if (dSq > unloadRadiusSq) {
          if (meshes.opaque) {
            this.scene.remove(meshes.opaque);
            meshes.opaque.geometry.dispose();
          }
          if (meshes.water) {
            this.scene.remove(meshes.water);
            meshes.water.geometry.dispose();
          }
          this.chunkMeshes.delete(key);
        }
      }
    }
  }

  /**
   * Called every frame: builds 1-2 queued chunks within a ~3.5ms budget
   * and smoothly animates newly loaded distant chunks rising into place.
   */
  public stepStreaming(dt: number): void {
    const start = performance.now();
    let builtCount = 0;

    while (this.buildQueue.length > 0 && builtCount < 2) {
      const next = this.buildQueue.shift()!;
      this.queuedKeys.delete(next.key);
      if (!this.chunkMeshes.has(next.key)) {
        // Animate rise only for chunks further than 2 chunks away
        this.rebuildChunkMesh(next.cx, next.cz, next.distSq > 4);
        builtCount++;
        if (performance.now() - start > 3.5) break;
      }
    }

    // Smoothly ease in newly streamed chunks
    const riseSpeed = 38 * dt;
    for (const entry of this.chunkMeshes.values()) {
      if (entry.animY < 0) {
        entry.animY = Math.min(0, entry.animY + riseSpeed);
        if (entry.opaque) entry.opaque.position.y = entry.animY;
        if (entry.water) entry.water.position.y = entry.animY;
      }
    }
  }

  /**
   * Assigns pooled real PointLights to the placed Torches nearest the player,
   * producing the exact same warm dynamic illumination as the personal lantern.
   */
  public updateTorchLights(dt: number, playerPos: THREE.Vector3): void {
    this.torchFlickerTime += dt;
    if (this.torchPositions.size === 0) {
      for (const l of this.torchLightPool) l.intensity = 0;
      return;
    }

    const sorted = Array.from(this.torchPositions.values()).sort(
      (a, b) => a.distanceToSquared(playerPos) - b.distanceToSquared(playerPos)
    );

    for (let i = 0; i < this.torchLightPool.length; i++) {
      const light = this.torchLightPool[i];
      const pos = sorted[i];
      if (pos && pos.distanceToSquared(playerPos) < 65 * 65) {
        light.position.copy(pos);
        // Lively, responsive firelight flicker for torches & campfires
        const flicker =
          2.25 +
          Math.sin(this.torchFlickerTime * 7.2 + i * 1.7) * 0.22 +
          Math.sin(this.torchFlickerTime * 12.8 + i * 3.1) * 0.12 +
          Math.cos(this.torchFlickerTime * 19.5 + i * 0.9) * 0.06;
        light.intensity = flicker;
      } else {
        light.intensity = 0;
      }
    }
  }

  private enqueueWaterNeighborhood(wx: number, wy: number, wz: number): void {
    const offsets = [
      [0, 0, 0],
      [1, 0, 0],
      [-1, 0, 0],
      [0, 0, 1],
      [0, 0, -1],
      [0, 1, 0],
      [0, -1, 0],
    ];
    for (const [dx, dy, dz] of offsets) {
      const ny = wy + dy;
      if (ny > 0 && ny < CHUNK_HEIGHT) {
        this.activeWaterSet.add(this.blockKey(wx + dx, ny, wz + dz));
      }
    }
  }

  /**
   * Simulates downward gravity waterfalls & horizontal water spreading every 0.14s
   * whenever blocks next to or underneath water are broken or water is placed.
   */
  public stepWaterPhysics(dt: number): void {
    if (this.activeWaterSet.size === 0) return;
    this.waterStepTimer += dt;
    if (this.waterStepTimer < 0.14) return;
    this.waterStepTimer = 0;

    const currentBatch = Array.from(this.activeWaterSet).slice(0, 140);
    for (const k of currentBatch) this.activeWaterSet.delete(k);

    const dirtyChunks = new Set<string>();
    const canWaterReplace = (id: BlockId) =>
      id === BlockId.Air || id === BlockId.TallGrass || id === BlockId.WildflowerBush;

    const placeFlowingWater = (tx: number, ty: number, tz: number, level: number) => {
      if (ty <= 0 || ty >= CHUNK_HEIGHT) return;
      const cx = Math.floor(tx / CHUNK_SIZE);
      const cz = Math.floor(tz / CHUNK_SIZE);
      const lx = tx - cx * CHUNK_SIZE;
      const lz = tz - cz * CHUNK_SIZE;
      const chunk = this.ensureChunk(cx, cz);
      chunk[this.localIndex(lx, ty, lz)] = BlockId.Water;

      const tKey = this.blockKey(tx, ty, tz);
      this.waterLevels.set(tKey, level);
      this.edits.set(tKey, BlockId.Water);

      dirtyChunks.add(this.chunkKey(cx, cz));
      if (lx === 0) dirtyChunks.add(this.chunkKey(cx - 1, cz));
      if (lx === CHUNK_SIZE - 1) dirtyChunks.add(this.chunkKey(cx + 1, cz));
      if (lz === 0) dirtyChunks.add(this.chunkKey(cx, cz - 1));
      if (lz === CHUNK_SIZE - 1) dirtyChunks.add(this.chunkKey(cx, cz + 1));

      this.enqueueWaterNeighborhood(tx, ty, tz);
    };

    for (const key of currentBatch) {
      const [wx, wy, wz] = key.split(',').map(Number);
      const id = this.getBlock(wx, wy, wz);

      // Gravity-affected Sand: if block directly underneath is open, drop the Sand block down
      if (id === BlockId.Sand && wy > 1 && canWaterReplace(this.getBlock(wx, wy - 1, wz))) {
        const cx = Math.floor(wx / CHUNK_SIZE);
        const cz = Math.floor(wz / CHUNK_SIZE);
        const lx = wx - cx * CHUNK_SIZE;
        const lz = wz - cz * CHUNK_SIZE;
        const chunk = this.ensureChunk(cx, cz);
        chunk[this.localIndex(lx, wy, lz)] = BlockId.Air;
        chunk[this.localIndex(lx, wy - 1, lz)] = BlockId.Sand;
        this.edits.set(this.blockKey(wx, wy, wz), BlockId.Air);
        this.edits.set(this.blockKey(wx, wy - 1, wz), BlockId.Sand);
        dirtyChunks.add(this.chunkKey(cx, cz));
        this.enqueueWaterNeighborhood(wx, wy, wz);
        this.enqueueWaterNeighborhood(wx, wy - 1, wz);
        continue;
      }

      // Water + Lava interaction -> turns Lava into Void Obsidian!
      if (id === BlockId.Water || id === BlockId.Lava) {
        const adj = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0]];
        for (const [dx, dy, dz] of adj) {
          const nId = this.getBlock(wx + dx, wy + dy, wz + dz);
          if ((id === BlockId.Water && nId === BlockId.Lava) || (id === BlockId.Lava && nId === BlockId.Water)) {
            const ox = id === BlockId.Lava ? wx : wx + dx;
            const oy = id === BlockId.Lava ? wy : wy + dy;
            const oz = id === BlockId.Lava ? wz : wz + dz;
            const cx = Math.floor(ox / CHUNK_SIZE), cz = Math.floor(oz / CHUNK_SIZE);
            const lx = ox - cx * CHUNK_SIZE, lz = oz - cz * CHUNK_SIZE;
            this.ensureChunk(cx, cz)[this.localIndex(lx, oy, lz)] = BlockId.Obsidian;
            this.edits.set(this.blockKey(ox, oy, oz), BlockId.Obsidian);
            dirtyChunks.add(this.chunkKey(cx, cz));
          }
        }
      }

      if (id === BlockId.Water) {
        const bKey = this.blockKey(wx, wy, wz);
        const level = this.waterLevels.get(bKey) ?? (wy <= WATER_LEVEL ? 7 : 5);

        // 1. Gravity: Flow straight down if the block underneath is open
        if (wy > 1) {
          const belowId = this.getBlock(wx, wy - 1, wz);
          if (canWaterReplace(belowId)) {
            placeFlowingWater(wx, wy - 1, wz, 7);
            continue;
          }
        }

        // 2. Horizontal spread: Spread sideways if level > 1 and supported below (or at lake level)
        const belowSolid = BLOCKS[this.getBlock(wx, wy - 1, wz)]?.solid ?? false;
        if (level > 1 && (belowSolid || wy <= WATER_LEVEL)) {
          const nextLevel = wy <= WATER_LEVEL ? 7 : level - 1;
          const horiz = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ];
          for (const [dx, dz] of horiz) {
            const nx = wx + dx;
            const nz = wz + dz;
            if (canWaterReplace(this.getBlock(nx, wy, nz))) {
              placeFlowingWater(nx, wy, nz, nextLevel);
            }
          }
        }
      } else if (canWaterReplace(id)) {
        // An open air pocket: check if water directly above or adjacent can flow into it
        if (wy + 1 < CHUNK_HEIGHT && this.getBlock(wx, wy + 1, wz) === BlockId.Water) {
          placeFlowingWater(wx, wy, wz, 7);
          continue;
        }
        const horiz = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const [dx, dz] of horiz) {
          const nx = wx + dx;
          const nz = wz + dz;
          if (this.getBlock(nx, wy, nz) === BlockId.Water) {
            const nKey = this.blockKey(nx, wy, nz);
            const nLevel = this.waterLevels.get(nKey) ?? (wy <= WATER_LEVEL ? 7 : 5);
            const nBelowSolid = BLOCKS[this.getBlock(nx, wy - 1, nz)]?.solid ?? false;
            if (nLevel > 1 && (nBelowSolid || wy <= WATER_LEVEL)) {
              placeFlowingWater(wx, wy, wz, wy <= WATER_LEVEL ? 7 : nLevel - 1);
              break;
            }
          }
        }
      }
    }

    if (dirtyChunks.size > 0) {
      for (const cKey of dirtyChunks) {
        const [cx, cz] = cKey.split(',').map(Number);
        this.rebuildChunkMesh(cx, cz, false);
      }
      this.saveState();
    }
  }

  /**
   * Breaks a 2x2x2 cluster of micro-blocks at once (used by the Runed Pickaxe so digging is fast & effortless!)
   */
  public breakClusterAt(wx: number, wy: number, wz: number): void {
    const dirtyChunks = new Set<string>();
    for (let dx = 0; dx <= 1; dx++) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dz = 0; dz <= 1; dz++) {
          const bx = wx + dx, by = wy + dy, bz = wz + dz;
          if (by <= 1 || by >= CHUNK_HEIGHT) continue;
          const cur = this.getBlock(bx, by, bz);
          if (cur === BlockId.Air || cur === BlockId.Bedrock) continue;

          const cx = Math.floor(bx / CHUNK_SIZE), cz = Math.floor(bz / CHUNK_SIZE);
          const lx = bx - cx * CHUNK_SIZE, lz = bz - cz * CHUNK_SIZE;
          this.ensureChunk(cx, cz)[this.localIndex(lx, by, lz)] = BlockId.Air;
          const bKey = this.blockKey(bx, by, bz);
          this.edits.set(bKey, BlockId.Air);
          this.torchPositions.delete(bKey);

          dirtyChunks.add(this.chunkKey(cx, cz));
          if (lx === 0) dirtyChunks.add(this.chunkKey(cx - 1, cz));
          if (lx === CHUNK_SIZE - 1) dirtyChunks.add(this.chunkKey(cx + 1, cz));
          if (lz === 0) dirtyChunks.add(this.chunkKey(cx, cz - 1));
          if (lz === CHUNK_SIZE - 1) dirtyChunks.add(this.chunkKey(cx, cz + 1));
          this.enqueueWaterNeighborhood(bx, by, bz);
        }
      }
    }
    for (const cKey of dirtyChunks) {
      const [cx, cz] = cKey.split(',').map(Number);
      this.rebuildChunkMesh(cx, cz, false);
    }
    this.saveState();
  }

  /**
   * Carves an explosive crater around (wx, wy, wz) for Alchemist's Powder Kegs (TNT) & Arcane Fireballs
   */
  public detonateAt(wx: number, wy: number, wz: number, radius = 6.2): void {
    const dirtyChunks = new Set<string>();
    const rCeil = Math.ceil(radius);

    for (let dx = -rCeil; dx <= rCeil; dx++) {
      for (let dy = -rCeil; dy <= rCeil; dy++) {
        for (let dz = -rCeil; dz <= rCeil; dz++) {
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          const bx = wx + dx;
          const by = wy + dy;
          const bz = wz + dz;
          if (by <= 1 || by >= CHUNK_HEIGHT) continue;
          const cur = this.getBlock(bx, by, bz);
          if (cur === BlockId.Air || cur === BlockId.Bedrock || cur === BlockId.Obsidian) continue;

          const cx = Math.floor(bx / CHUNK_SIZE);
          const cz = Math.floor(bz / CHUNK_SIZE);
          const lx = bx - cx * CHUNK_SIZE;
          const lz = bz - cz * CHUNK_SIZE;
          this.ensureChunk(cx, cz)[this.localIndex(lx, by, lz)] = BlockId.Air;
          const bKey = this.blockKey(bx, by, bz);
          this.edits.set(bKey, BlockId.Air);
          this.torchPositions.delete(bKey);

          dirtyChunks.add(this.chunkKey(cx, cz));
          if (lx === 0) dirtyChunks.add(this.chunkKey(cx - 1, cz));
          if (lx === CHUNK_SIZE - 1) dirtyChunks.add(this.chunkKey(cx + 1, cz));
          if (lz === 0) dirtyChunks.add(this.chunkKey(cx, cz - 1));
          if (lz === CHUNK_SIZE - 1) dirtyChunks.add(this.chunkKey(cx, cz + 1));
          this.enqueueWaterNeighborhood(bx, by, bz);
        }
      }
    }

    for (const cKey of dirtyChunks) {
      const [cx, cz] = cKey.split(',').map(Number);
      this.rebuildChunkMesh(cx, cz, false);
    }
    this.saveState();
  }

  public regenerateNewSeed(): void {
    this.clearAllMeshes();
    this.chunks.clear();
    this.edits.clear();
    this.initNoise(Math.floor(Math.random() * 900000) + 1000);
    this.saveState();
  }

  public resetEdits(): void {
    this.clearAllMeshes();
    this.chunks.clear();
    this.edits.clear();
    this.saveState();
  }

  private clearAllMeshes(): void {
    this.buildQueue = [];
    this.queuedKeys.clear();
    this.activeWaterSet.clear();
    this.waterLevels.clear();
    this.torchPositions.clear();
    for (const l of this.torchLightPool) l.intensity = 0;
    for (const meshes of this.chunkMeshes.values()) {
      if (meshes.opaque) {
        this.scene.remove(meshes.opaque);
        meshes.opaque.geometry.dispose();
      }
      if (meshes.water) {
        this.scene.remove(meshes.water);
        meshes.water.geometry.dispose();
      }
    }
    this.chunkMeshes.clear();
  }

  private saveState(): void {
    try {
      const payload = {
        seed: this.seed,
        edits: Array.from(this.edits.entries()),
      };
      localStorage.setItem('voxelrealms_save_v1', JSON.stringify(payload));
    } catch {
      // Ignore storage quota issues
    }
  }

  private loadSavedState(): void {
    try {
      const raw = localStorage.getItem('voxelrealms_save_v1');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (typeof parsed.seed === 'number') this.seed = parsed.seed;
      if (Array.isArray(parsed.edits)) {
        this.edits = new Map<string, BlockId>(parsed.edits);
      }
    } catch {
      // Ignore corrupted state
    }
  }
}
