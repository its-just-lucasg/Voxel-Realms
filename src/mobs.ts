import * as THREE from 'three';
import { BlockId, BLOCKS } from './blocks';
import { WATER_LEVEL } from './world';
import { SoundEngine } from './audio';
import { ParticleSystem } from './particles';

type SheepState = 'idle' | 'wander' | 'graze' | 'flee';

function makePixelTexture(
  w: number,
  h: number,
  painter: (x: number, y: number) => string
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      ctx.fillStyle = painter(x, y);
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export type CreatureSpecies = 'sheep' | 'stag' | 'boar' | 'wraith';

export class SheepEntity {
  public group = new THREE.Group();
  public position = new THREE.Vector3();
  public velocity = new THREE.Vector3();
  public yaw = 0;
  public targetYaw = 0;
  public species: CreatureSpecies;
  public hp = 3;

  private headPivot = new THREE.Group();
  private legFL = new THREE.Group();
  private legFR = new THREE.Group();
  private legBL = new THREE.Group();
  private legBR = new THREE.Group();

  public state: SheepState = 'idle';
  public stateTimer = 2;
  private walkPhase = 0;
  private isGrounded = false;
  private isClimbing = false;
  private turnCooldown = 0;
  private baaTimer = 8 + Math.random() * 14;
  public woolColorHex: string;

  constructor(
    x: number,
    y: number,
    z: number,
    woolMat: THREE.MeshLambertMaterial,
    skinMat: THREE.MeshLambertMaterial,
    faceMaterials: THREE.MeshLambertMaterial[],
    hoofMat: THREE.MeshLambertMaterial,
    woolColorHex: string,
    species: CreatureSpecies = 'sheep'
  ) {
    this.position.set(x, y, z);
    this.yaw = Math.random() * Math.PI * 2;
    this.targetYaw = this.yaw;
    this.woolColorHex = woolColorHex;
    this.species = species;

    // Fluffy Body (or Stag/Boar/Wraith torso)
    const bodyGeo = new THREE.BoxGeometry(0.86, 0.72, 1.18);
    const bodyMesh = new THREE.Mesh(bodyGeo, woolMat);
    bodyMesh.position.set(0, 0.78, 0);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    this.group.add(bodyMesh);

    // Head Pivot at neck (front of body)
    this.headPivot.position.set(0, species === 'stag' ? 1.18 : 0.96, 0.56);

    // Head Base (with pixel-art face on the +Z front side)
    const headGeo = new THREE.BoxGeometry(0.46, 0.46, 0.52);
    const headMesh = new THREE.Mesh(headGeo, faceMaterials);
    headMesh.position.set(0, 0.04, 0.22);
    headMesh.castShadow = true;
    this.headPivot.add(headMesh);

    if (species === 'stag') {
      // Majestic 3D Branching Golden-Ivory Antlers
      const antlerMat = new THREE.MeshLambertMaterial({ color: 0xf5e8c7 });
      const beamL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.08), antlerMat);
      beamL.position.set(0.18, 0.46, 0.16);
      beamL.rotation.z = -0.25;
      const beamR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.52, 0.08), antlerMat);
      beamR.position.set(-0.18, 0.46, 0.16);
      beamR.rotation.z = 0.25;
      const tineL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.06), antlerMat);
      tineL.position.set(0.28, 0.52, 0.28);
      tineL.rotation.x = 0.45;
      const tineR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 0.06), antlerMat);
      tineR.position.set(-0.28, 0.52, 0.28);
      tineR.rotation.x = 0.45;
      this.headPivot.add(beamL, beamR, tineL, tineR);
    } else if (species === 'boar') {
      // Curved White Ivory Boar Tusks
      const tuskMat = new THREE.MeshLambertMaterial({ color: 0xfffbeb });
      const tuskL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), tuskMat);
      tuskL.position.set(0.24, -0.04, 0.44);
      tuskL.rotation.x = -0.35;
      const tuskR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), tuskMat);
      tuskR.position.set(-0.24, -0.04, 0.44);
      tuskR.rotation.x = -0.35;
      this.headPivot.add(tuskL, tuskR);
    } else if (species === 'wraith') {
      // Glowing Cyan/Violet Spectral Eyes on Dark Hood
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
      const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), eyeMat);
      eyeL.position.set(0.12, 0.08, 0.49);
      const eyeR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.05), eyeMat);
      eyeR.position.set(-0.12, 0.08, 0.49);
      this.headPivot.add(eyeL, eyeR);
    } else {
      // Fluffy Wool Hood/Cap on top and back of sheep head
      const capGeo = new THREE.BoxGeometry(0.54, 0.26, 0.44);
      const capMesh = new THREE.Mesh(capGeo, woolMat);
      capMesh.position.set(0, 0.18, 0.14);
      capMesh.castShadow = true;
      this.headPivot.add(capMesh);
    }

    // Cute side ears
    const earGeo = new THREE.BoxGeometry(0.14, 0.1, 0.12);
    const earL = new THREE.Mesh(earGeo, skinMat);
    earL.position.set(0.28, 0.08, 0.18);
    const earR = new THREE.Mesh(earGeo, skinMat);
    earR.position.set(-0.28, 0.08, 0.18);
    this.headPivot.add(earL, earR);

    this.group.add(this.headPivot);

    // 4 Articulated Legs (wool cuff + beige leg + dark hoof)
    const buildLeg = (lx: number, lz: number): THREE.Group => {
      const pivot = new THREE.Group();
      pivot.position.set(lx, 0.52, lz);

      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.26), woolMat);
      cuff.position.set(0, -0.08, 0);
      cuff.castShadow = true;

      const shank = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.34, 0.2), skinMat);
      shank.position.set(0, -0.28, 0);
      shank.castShadow = true;

      const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.09, 0.21), hoofMat);
      hoof.position.set(0, -0.47, 0);

      pivot.add(cuff, shank, hoof);
      this.group.add(pivot);
      return pivot;
    };

    this.legFL = buildLeg(0.24, 0.38);
    this.legFR = buildLeg(-0.24, 0.38);
    this.legBL = buildLeg(0.24, -0.38);
    this.legBR = buildLeg(-0.24, -0.38);

    // Scale creatures 1.8x relative to micro-blocks
    this.group.scale.setScalar(1.8);
    this.group.position.copy(this.position);
  }

  public startle(awayFrom: THREE.Vector3, sound: SoundEngine, particles: ParticleSystem): void {
    this.state = 'flee';
    this.stateTimer = 2.6;
    this.targetYaw = Math.atan2(this.position.x - awayFrom.x, this.position.z - awayFrom.z) + (Math.random() - 0.5) * 0.6;
    if (this.isGrounded) {
      this.velocity.y = 6.2;
      this.isGrounded = false;
    }
    sound.playSheepBaa(1.0);
    particles.spawnBlockBurst(this.position.x - 0.3, this.position.y + 0.6, this.position.z - 0.3, BlockId.Snow, 10);
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    getBlock: (x: number, y: number, z: number) => BlockId,
    sound: SoundEngine,
    particles: ParticleSystem
  ): void {
    const clampedDt = Math.min(dt, 0.05);
    this.stateTimer -= clampedDt;
    this.baaTimer -= clampedDt;
    if (this.turnCooldown > 0) this.turnCooldown -= clampedDt;

    const distToPlayer = this.position.distanceTo(playerPos);
    if (this.baaTimer <= 0) {
      this.baaTimer = 12 + Math.random() * 20;
      if (distToPlayer < 24) {
        const vol = Math.max(0.15, 1 - distToPlayer / 24);
        if (this.species === 'boar') sound.playBoarGrunt();
        else if (this.species === 'wraith') sound.playWraithHiss();
        else sound.playSheepBaa(vol);
      }
    }

    if (this.stateTimer <= 0) {
      const r = Math.random();
      const underId = getBlock(
        Math.floor(this.position.x),
        Math.floor(this.position.y - 0.2),
        Math.floor(this.position.z)
      );
      if (r < 0.28 && (underId === BlockId.Grass || underId === BlockId.SnowGrass)) {
        this.state = 'graze';
        this.stateTimer = 3.0 + Math.random() * 2.0;
      } else if (r < 0.78) {
        this.state = 'wander';
        // Walk in calm, long straight lines (6 to 11 seconds) with gentle heading adjustments
        this.stateTimer = 6.0 + Math.random() * 5.0;
        this.targetYaw = this.yaw + (Math.random() - 0.5) * 0.85;
      } else {
        this.state = 'idle';
        this.stateTimer = 2.5 + Math.random() * 3.0;
      }
    }

    let angleDiff = this.targetYaw - this.yaw;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    this.yaw += angleDiff * Math.min(1, clampedDt * 3.0);

    // Calm, unhurried walking speed in micro-voxel units
    const moveSpeed = this.state === 'flee' ? 4.0 : this.state === 'wander' ? 1.8 : 0;
    const dirX = Math.sin(this.yaw);
    const dirZ = Math.cos(this.yaw);
    this.velocity.x = dirX * moveSpeed;
    this.velocity.z = dirZ * moveSpeed;
    this.velocity.y = Math.max(this.velocity.y - 38 * clampedDt, -48);

    // Look ahead along travel path for 1- or 2-micro-block steps, walls, or water
    if (moveSpeed > 0) {
      const probeX = Math.floor(this.position.x + dirX * 1.25);
      const probeZ = Math.floor(this.position.z + dirZ * 1.25);
      const baseFootY = this.isClimbing ? Math.floor(this.position.y - 0.6) : Math.floor(this.position.y + 0.05);

      const blockAtFeet = getBlock(probeX, baseFootY, probeZ);
      const blockOneUp = getBlock(probeX, baseFootY + 1, probeZ);
      const blockTwoUp = getBlock(probeX, baseFootY + 2, probeZ);
      const blockThreeUp = getBlock(probeX, baseFootY + 3, probeZ);
      const blockBelowAhead = getBlock(probeX, baseFootY - 1, probeZ);

      if (blockAtFeet === BlockId.Water || blockBelowAhead === BlockId.Water) {
        if (this.turnCooldown <= 0) {
          this.targetYaw = this.yaw + Math.PI * (0.75 + Math.random() * 0.35);
          this.turnCooldown = 1.6;
        }
        this.velocity.x = 0;
        this.velocity.z = 0;
      } else if (BLOCKS[blockAtFeet]?.solid) {
        const canStepOne = !BLOCKS[blockOneUp]?.solid && !BLOCKS[blockTwoUp]?.solid;
        const canStepTwo = !BLOCKS[blockTwoUp]?.solid && !BLOCKS[blockThreeUp]?.solid;
        if (canStepOne && this.isGrounded) {
          this.position.y = baseFootY + 1.02;
        } else if (canStepTwo && this.isGrounded) {
          this.velocity.y = 11.5;
          this.isGrounded = false;
          this.isClimbing = true;
        } else if (!canStepOne && !canStepTwo) {
          if (this.turnCooldown <= 0) {
            this.targetYaw = this.yaw + Math.PI * (0.65 + Math.random() * 0.4);
            this.turnCooldown = 1.5;
          }
          this.velocity.x = 0;
          this.velocity.z = 0;
        }
      }
    }

    // Check horizontal passability at chest height
    const clearanceY = Math.floor(this.position.y + (this.isClimbing || !this.isGrounded ? 1.2 : 0.65));
    const nextX = this.position.x + this.velocity.x * clampedDt;
    const nextZ = this.position.z + this.velocity.z * clampedDt;

    if (!BLOCKS[getBlock(Math.floor(nextX + dirX * 0.28), clearanceY, Math.floor(this.position.z))]?.solid) {
      this.position.x = nextX;
    }
    if (!BLOCKS[getBlock(Math.floor(this.position.x), clearanceY, Math.floor(nextZ + dirZ * 0.28))]?.solid) {
      this.position.z = nextZ;
    }

    this.position.y += this.velocity.y * clampedDt;
    const groundY = Math.floor(this.position.y);
    const groundBlock = getBlock(Math.floor(this.position.x), groundY, Math.floor(this.position.z));
    if (BLOCKS[groundBlock]?.solid && this.velocity.y <= 0) {
      this.position.y = groundY + 1;
      this.velocity.y = 0;
      this.isGrounded = true;
      this.isClimbing = false;
    } else {
      this.isGrounded = false;
    }

    if (moveSpeed > 0.1) {
      this.walkPhase += clampedDt * moveSpeed * 4.5;
      const swing = Math.sin(this.walkPhase) * 0.62;
      this.legFL.rotation.x = swing;
      this.legBR.rotation.x = swing;
      this.legFR.rotation.x = -swing;
      this.legBL.rotation.x = -swing;
    } else {
      this.legFL.rotation.x *= 0.85;
      this.legFR.rotation.x *= 0.85;
      this.legBL.rotation.x *= 0.85;
      this.legBR.rotation.x *= 0.85;
    }

    if (this.state === 'graze') {
      this.headPivot.position.y = THREE.MathUtils.lerp(this.headPivot.position.y, 0.56, clampedDt * 8);
      this.headPivot.rotation.x = 0.65 + Math.sin(performance.now() * 0.025) * 0.12;
      this.headPivot.rotation.y = 0;
      if (Math.random() < clampedDt * 1.6) {
        particles.spawnBlockBurst(
          this.position.x + Math.sin(this.yaw) * 0.6,
          this.position.y - 0.1,
          this.position.z + Math.cos(this.yaw) * 0.6,
          BlockId.Grass,
          4
        );
      }
    } else {
      this.headPivot.position.y = THREE.MathUtils.lerp(this.headPivot.position.y, 0.96, clampedDt * 8);
      this.headPivot.rotation.x = THREE.MathUtils.lerp(this.headPivot.rotation.x, 0.05, clampedDt * 6);
      if (this.state === 'idle' && distToPlayer < 8) {
        const toPlayerYaw = Math.atan2(playerPos.x - this.position.x, playerPos.z - this.position.z) - this.yaw;
        this.headPivot.rotation.y = THREE.MathUtils.lerp(
          this.headPivot.rotation.y,
          THREE.MathUtils.clamp(toPlayerYaw, -0.55, 0.55),
          clampedDt * 5
        );
      } else {
        this.headPivot.rotation.y = THREE.MathUtils.lerp(this.headPivot.rotation.y, 0, clampedDt * 5);
      }
    }

    this.group.position.copy(this.position);
    this.group.rotation.y = this.yaw;
  }
}

export class MobManager {
  private scene: THREE.Scene;
  public sheepList: SheepEntity[] = [];
  private wispGroup = new THREE.Group();
  private woolMaterials: { mat: THREE.MeshLambertMaterial; hex: string }[] = [];
  private stagMat: THREE.MeshLambertMaterial;
  private boarMat: THREE.MeshLambertMaterial;
  private wraithMat: THREE.MeshLambertMaterial;
  private skinMat: THREE.MeshLambertMaterial;
  private hoofMat: THREE.MeshLambertMaterial;
  private faceMaterials: THREE.MeshLambertMaterial[];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.scene.add(this.wispGroup);

    // 16x16 Pixel-Art Wool Variants (Cream White, Silver Gray, Warm Brown, Rare Blush Pink)
    const woolPalettes = [
      { base: ['#f5f3eb', '#ebe7dc', '#ded9cc', '#ffffff'], hex: '#f5f3eb' },
      { base: ['#d4d7dc', '#c3c7ce', '#b2b7bf', '#e2e5ea'], hex: '#d4d7dc' },
      { base: ['#7a583b', '#6b4c32', '#876344', '#5c4029'], hex: '#7a583b' },
      { base: ['#f5bac6', '#eba8b6', '#de96a5', '#ffd1db'], hex: '#f5bac6' },
    ];

    for (const p of woolPalettes) {
      const tex = makePixelTexture(16, 16, (x, y) => {
        const idx = ((x >> 1) * 3 + (y >> 1) * 5 + (x ^ y)) % p.base.length;
        return p.base[idx];
      });
      this.woolMaterials.push({
        mat: new THREE.MeshLambertMaterial({ map: tex }),
        hex: p.hex,
      });
    }

    this.stagMat = new THREE.MeshLambertMaterial({ color: 0x9c6234 });
    this.boarMat = new THREE.MeshLambertMaterial({ color: 0x4f3928 });
    this.wraithMat = new THREE.MeshLambertMaterial({ color: 0x1e1b2e });

    const skinTex = makePixelTexture(8, 8, (x, y) => ((x + y) % 3 === 0 ? '#d8bea2' : '#e3cab0'));
    this.skinMat = new THREE.MeshLambertMaterial({ map: skinTex });
    this.hoofMat = new THREE.MeshLambertMaterial({ color: 0x3b2f26 });

    // 8x8 Cute Pixel-Art Face Texture
    const faceFrontTex = makePixelTexture(8, 8, (x, y) => {
      if (y === 3 && (x === 1 || x === 6)) return '#1f242d';
      if (y === 3 && (x === 2 || x === 5)) return '#ffffff';
      if ((y === 5 || y === 6) && x >= 3 && x <= 4) return y === 5 ? '#f29bb0' : '#d97e94';
      return (x + y) % 2 === 0 ? '#e3cab0' : '#d8bea2';
    });
    const faceFrontMat = new THREE.MeshLambertMaterial({ map: faceFrontTex });
    this.faceMaterials = [
      this.skinMat,
      this.skinMat,
      this.skinMat,
      this.skinMat,
      faceFrontMat,
      this.skinMat,
    ];
  }

  public spawnInitialFlock(
    centerX: number,
    centerZ: number,
    getTerrainHeight: (wx: number, wz: number) => number
  ): void {
    this.clearAll();
    const targetCount = 18;
    let attempts = 0;

    while (this.sheepList.length < targetCount && attempts < 120) {
      attempts++;
      const angle = Math.random() * Math.PI * 2;
      const dist = 6 + Math.random() * 34;
      const wx = Math.floor(centerX + Math.cos(angle) * dist);
      const wz = Math.floor(centerZ + Math.sin(angle) * dist);
      const wy = getTerrainHeight(wx, wz);

      if (wy > WATER_LEVEL + 1 && wy < 46) {
        const spRoll = Math.random();
        let species: CreatureSpecies = 'sheep';
        let bodyMat = this.woolMaterials[0].mat;
        let hex = '#f5f3eb';

        if (spRoll < 0.52) {
          species = 'sheep';
          const wc = this.woolMaterials[Math.floor(Math.random() * this.woolMaterials.length)];
          bodyMat = wc.mat;
          hex = wc.hex;
        } else if (spRoll < 0.74) {
          species = 'stag';
          bodyMat = this.stagMat;
          hex = '#9c6234';
        } else if (spRoll < 0.90) {
          species = 'boar';
          bodyMat = this.boarMat;
          hex = '#4f3928';
        } else {
          species = 'wraith';
          bodyMat = this.wraithMat;
          hex = '#38bdf8';
        }

        const creature = new SheepEntity(
          wx + 0.5,
          wy + 1,
          wz + 0.5,
          bodyMat,
          species === 'wraith' ? this.wraithMat : this.skinMat,
          species === 'wraith' ? [this.wraithMat, this.wraithMat, this.wraithMat, this.wraithMat, this.wraithMat, this.wraithMat] : this.faceMaterials,
          this.hoofMat,
          hex,
          species
        );
        this.scene.add(creature.group);
        this.sheepList.push(creature);
      }
    }

    // Spawn 16 Floating Fey Wisps (Magical Fireflies)
    const wispGeo = new THREE.BoxGeometry(0.18, 0.18, 0.18);
    const wispColors = [0x38bdf8, 0xa855f7, 0xfacc15];
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: wispColors[i % wispColors.length] });
      const wisp = new THREE.Mesh(wispGeo, mat);
      const wx = centerX + (Math.random() - 0.5) * 44;
      const wz = centerZ + (Math.random() - 0.5) * 44;
      const wy = Math.max(getTerrainHeight(Math.floor(wx), Math.floor(wz)), WATER_LEVEL) + 2 + Math.random() * 4;
      wisp.position.set(wx, wy, wz);
      this.wispGroup.add(wisp);
    }
  }

  public interactWithSheepAtRay(
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    maxDist: number,
    sound: SoundEngine,
    particles: ParticleSystem
  ): boolean {
    const dir = direction.clone().normalize();
    for (const sheep of this.sheepList) {
      const center = new THREE.Vector3(sheep.position.x, sheep.position.y + 0.75, sheep.position.z);
      const toSheep = center.clone().sub(origin);
      const proj = toSheep.dot(dir);
      if (proj > 0 && proj <= maxDist) {
        const closest = origin.clone().addScaledVector(dir, proj);
        if (closest.distanceTo(center) < 0.85) {
          sheep.startle(origin, sound, particles);
          return true;
        }
      }
    }
    return false;
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    getBlock: (x: number, y: number, z: number) => BlockId,
    getTerrainHeight: (wx: number, wz: number) => number,
    sound: SoundEngine,
    particles: ParticleSystem
  ): void {
    for (const sheep of this.sheepList) {
      if (sheep.position.distanceTo(playerPos) > 68) {
        const angle = Math.random() * Math.PI * 2;
        const dist = 16 + Math.random() * 24;
        const nx = Math.floor(playerPos.x + Math.cos(angle) * dist);
        const nz = Math.floor(playerPos.z + Math.sin(angle) * dist);
        const ny = getTerrainHeight(nx, nz);
        if (ny > WATER_LEVEL + 1) {
          sheep.position.set(nx + 0.5, ny + 1, nz + 0.5);
          sheep.velocity.set(0, 0, 0);
        }
      }
      sheep.update(dt, playerPos, getBlock, sound, particles);
    }

    // Gently float & bob Fey Wisps around the player
    const now = performance.now() * 0.0015;
    this.wispGroup.children.forEach((w, idx) => {
      w.position.x += Math.sin(now + idx * 1.7) * dt * 0.9;
      w.position.y += Math.cos(now * 1.4 + idx) * dt * 0.5;
      w.position.z += Math.cos(now + idx * 2.3) * dt * 0.9;
      if (w.position.distanceTo(playerPos) > 42) {
        w.position.x = playerPos.x + (Math.random() - 0.5) * 32;
        w.position.z = playerPos.z + (Math.random() - 0.5) * 32;
        w.position.y = playerPos.y + 1.5 + Math.random() * 4;
      }
    });
  }

  public clearAll(): void {
    for (const sheep of this.sheepList) {
      this.scene.remove(sheep.group);
    }
    this.sheepList = [];
    this.wispGroup.clear();
  }
}
