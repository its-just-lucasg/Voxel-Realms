import * as THREE from 'three';
import { BLOCKS, BlockId } from './blocks';
import { SoundEngine } from './audio';

interface BurstParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
  maxAge: number;
  rises?: boolean;
}

interface LootDrop {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  blockId: BlockId;
  age: number;
}

export interface FireballProjectile {
  mesh: THREE.Mesh;
  light: THREE.PointLight;
  velocity: THREE.Vector3;
  age: number;
}

export class ParticleSystem {
  private scene: THREE.Scene;
  private particles: BurstParticle[] = [];
  private lootDrops: LootDrop[] = [];
  public fireballs: FireballProjectile[] = [];

  private unitGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  private lootGeo = new THREE.BoxGeometry(0.26, 0.26, 0.26);
  private fireballGeo = new THREE.SphereGeometry(0.22, 10, 10);

  constructor(scene: THREE.Scene) {
    this.scene = scene;
  }

  public spawnBlockBurst(wx: number, wy: number, wz: number, blockId: BlockId, count = 20): void {
    const def = BLOCKS[blockId];
    if (!def || blockId === BlockId.Air) return;

    const baseColor = new THREE.Color(def.particleColor);
    for (let i = 0; i < count; i++) {
      const shade = 0.78 + Math.random() * 0.4;
      const color = baseColor.clone().multiplyScalar(shade);
      const mat = new THREE.MeshLambertMaterial({ color });
      const mesh = new THREE.Mesh(this.unitGeo, mat);

      mesh.position.set(
        wx + 0.2 + Math.random() * 0.6,
        wy + 0.2 + Math.random() * 0.6,
        wz + 0.2 + Math.random() * 0.6
      );
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);

      const velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 4.2,
        1.5 + Math.random() * 3.5,
        (Math.random() - 0.5) * 4.2
      );

      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity,
        age: 0,
        maxAge: 0.45 + Math.random() * 0.35,
      });
    }
  }

  public spawnLootDrop(wx: number, wy: number, wz: number, blockId: BlockId): void {
    const def = BLOCKS[blockId];
    if (!def || blockId === BlockId.Air) return;
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(def.particleColor),
      emissive: new THREE.Color(def.particleColor).multiplyScalar(0.25),
    });
    const mesh = new THREE.Mesh(this.lootGeo, mat);
    mesh.position.set(wx + 0.5, wy + 0.45, wz + 0.5);
    this.scene.add(mesh);
    this.lootDrops.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 1.6, 3.2, (Math.random() - 0.5) * 1.6),
      blockId,
      age: 0,
    });
  }

  public spawnCampfireSmoke(wx: number, wy: number, wz: number): void {
    const isEmber = Math.random() < 0.38;
    const mat = new THREE.MeshBasicMaterial({
      color: isEmber ? 0xff9922 : 0x64748b,
      transparent: true,
      opacity: isEmber ? 0.95 : 0.55,
    });
    const mesh = new THREE.Mesh(this.unitGeo, mat);
    mesh.position.set(wx + (Math.random() - 0.5) * 0.35, wy + 0.2, wz + (Math.random() - 0.5) * 0.35);
    this.scene.add(mesh);
    this.particles.push({
      mesh,
      velocity: new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 0.9, (Math.random() - 0.5) * 0.4),
      age: 0,
      maxAge: isEmber ? 0.9 : 1.8,
      rises: true,
    });
  }

  public castFireball(origin: THREE.Vector3, direction: THREE.Vector3): void {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffaa22 });
    const mesh = new THREE.Mesh(this.fireballGeo, mat);
    mesh.position.copy(origin).addScaledVector(direction, 0.8);
    const light = new THREE.PointLight(0xff6611, 3.2, 16, 1.4);
    light.position.copy(mesh.position);
    this.scene.add(mesh, light);
    this.fireballs.push({
      mesh,
      light,
      velocity: direction.clone().normalize().multiplyScalar(22),
      age: 0,
    });
  }

  public update(
    dt: number,
    playerPos?: THREE.Vector3,
    getBlock?: (x: number, y: number, z: number) => BlockId,
    sound?: SoundEngine,
    onFireballImpact?: (wx: number, wy: number, wz: number) => void
  ): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age >= p.maxAge) {
        this.scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.particles.splice(i, 1);
        continue;
      }

      if (!p.rises) {
        p.velocity.y -= 13.5 * dt;
      }
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.x += 4 * dt;
      p.mesh.rotation.y += 5 * dt;

      const scale = p.rises ? 0.6 + (p.age / p.maxAge) * 0.9 : Math.max(0.05, 1 - p.age / p.maxAge);
      p.mesh.scale.setScalar(scale);
    }

    for (let i = this.lootDrops.length - 1; i >= 0; i--) {
      const drop = this.lootDrops[i];
      drop.age += dt;
      if (drop.age > 35) {
        this.scene.remove(drop.mesh);
        (drop.mesh.material as THREE.Material).dispose();
        this.lootDrops.splice(i, 1);
        continue;
      }

      drop.mesh.rotation.y += 2.6 * dt;
      if (getBlock) {
        drop.velocity.y = Math.max(drop.velocity.y - 16 * dt, -12);
        drop.mesh.position.addScaledVector(drop.velocity, dt);
        const by = Math.floor(drop.mesh.position.y - 0.15);
        if (BLOCKS[getBlock(Math.floor(drop.mesh.position.x), by, Math.floor(drop.mesh.position.z))]?.solid) {
          drop.mesh.position.y = by + 1.18 + Math.sin(drop.age * 4) * 0.06;
          drop.velocity.set(0, 0, 0);
        }
      }

      if (playerPos && drop.age > 0.35) {
        const target = new THREE.Vector3(playerPos.x, playerPos.y + 0.9, playerPos.z);
        const dist = drop.mesh.position.distanceTo(target);
        if (dist < 3.2) {
          drop.mesh.position.lerp(target, Math.min(1, dt * 11));
          if (dist < 0.65) {
            sound?.playPickupChime();
            this.scene.remove(drop.mesh);
            (drop.mesh.material as THREE.Material).dispose();
            this.lootDrops.splice(i, 1);
          }
        }
      }
    }

    for (let i = this.fireballs.length - 1; i >= 0; i--) {
      const fb = this.fireballs[i];
      fb.age += dt;
      fb.mesh.position.addScaledVector(fb.velocity, dt);
      fb.light.position.copy(fb.mesh.position);

      if (Math.random() < 0.7) {
        this.spawnCampfireSmoke(fb.mesh.position.x, fb.mesh.position.y - 0.1, fb.mesh.position.z);
      }

      const bx = Math.floor(fb.mesh.position.x);
      const by = Math.floor(fb.mesh.position.y);
      const bz = Math.floor(fb.mesh.position.z);
      const hitBlock = getBlock ? getBlock(bx, by, bz) : BlockId.Air;

      if (fb.age > 3.5 || (hitBlock !== BlockId.Air && BLOCKS[hitBlock]?.solid)) {
        if (onFireballImpact && hitBlock !== BlockId.Air) {
          onFireballImpact(bx, by, bz);
        }
        this.scene.remove(fb.mesh, fb.light);
        (fb.mesh.material as THREE.Material).dispose();
        this.fireballs.splice(i, 1);
      }
    }
  }
}
