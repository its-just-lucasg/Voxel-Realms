import * as THREE from 'three';
import { BlockId, BLOCKS } from './blocks';
import { ATLAS_COLS, ATLAS_ROWS, TextureAtlas } from './textures';
import { SoundEngine } from './audio';

export type WeaponMode = 'block' | 'pickaxe' | 'sword' | 'staff';

export class PlayerController {
  public camera: THREE.PerspectiveCamera;
  public position = new THREE.Vector3(8, 36, 8);
  public velocity = new THREE.Vector3();
  public yaw = 0;
  public pitch = -0.15;

  public readonly width = 0.62;
  public readonly height = 1.75;
  public readonly eyeHeight = 1.58;

  public isGrounded = false;
  public isFlying = false;
  public isUnderwater = false;
  public isInWater = false;
  public isThirdPerson = false;
  public weaponMode: WeaponMode = 'block';

  private keys = new Set<string>();
  public touchMoveX = 0;
  public touchMoveZ = 0;
  public touchJump = false;

  private stepTimer = 0;
  private bobTimer = 0;
  private swingProgress = 0;
  private isSwinging = false;

  private handGroup: THREE.Group;
  private handMesh: THREE.Mesh;
  private pickaxeGroup = new THREE.Group();
  private swordGroup = new THREE.Group();
  private staffGroup = new THREE.Group();
  private handGeo: THREE.BoxGeometry;
  private handMat: THREE.MeshBasicMaterial;
  private currentHeldBlock: BlockId = BlockId.Air;

  public avatarGroup = new THREE.Group();
  private avatarHead = new THREE.Group();
  private avatarLegL!: THREE.Mesh;
  private avatarLegR!: THREE.Mesh;
  private avatarArmL!: THREE.Mesh;
  private avatarArmR!: THREE.Mesh;

  private getBlock: (x: number, y: number, z: number) => BlockId;
  private sound: SoundEngine;

  constructor(
    camera: THREE.PerspectiveCamera,
    getBlock: (x: number, y: number, z: number) => BlockId,
    sound: SoundEngine,
    atlas: TextureAtlas,
    scene?: THREE.Scene
  ) {
    this.camera = camera;
    this.getBlock = getBlock;
    this.sound = sound;

    this.handGroup = new THREE.Group();
    this.handGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);

    const faceShades = [0.76, 0.80, 1.0, 0.55, 0.88, 0.84];
    const colors: number[] = [];
    for (let f = 0; f < 6; f++) {
      const s = faceShades[f];
      for (let v = 0; v < 4; v++) {
        colors.push(s, s, s);
      }
    }
    this.handGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    this.handMat = new THREE.MeshBasicMaterial({
      map: atlas.texture,
      vertexColors: true,
      transparent: true,
      alphaTest: 0.45,
    });

    this.handMesh = new THREE.Mesh(this.handGeo, this.handMat);
    this.handGroup.add(this.handMesh);

    this.buildWeaponModels();
    this.buildHeroAvatar();
    if (scene) scene.add(this.avatarGroup);

    this.handGroup.position.set(0.42, -0.34, -0.58);
    this.handGroup.rotation.set(0.25, -0.65, 0.1);
    this.camera.add(this.handGroup);

    this.setHeldBlockColor(BlockId.Grass);
    this.setupInput();
  }

  private buildWeaponModels(): void {
    const woodMat = new THREE.MeshBasicMaterial({ color: 0x8f6739 });
    const goldMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const steelMat = new THREE.MeshBasicMaterial({ color: 0xcbd5e1 });
    const crystalMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    const fireOrbMat = new THREE.MeshBasicMaterial({ color: 0xff7722 });

    const pickShaft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.52, 0.06), woodMat);
    const pickHead = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.08, 0.08), steelMat);
    pickHead.position.set(0, 0.22, 0);
    const pickRune = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.1), crystalMat);
    pickRune.position.set(0, 0.22, 0);
    this.pickaxeGroup.add(pickShaft, pickHead, pickRune);
    this.pickaxeGroup.visible = false;
    this.handGroup.add(this.pickaxeGroup);

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.06), woodMat);
    grip.position.set(0, -0.18, 0);
    const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.05, 0.08), goldMat);
    guard.position.set(0, -0.08, 0);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.52, 0.04), steelMat);
    blade.position.set(0, 0.2, 0);
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.44, 0.05), crystalMat);
    core.position.set(0, 0.19, 0);
    this.swordGroup.add(grip, guard, blade, core);
    this.swordGroup.visible = false;
    this.handGroup.add(this.swordGroup);

    const staffPole = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.62, 0.06), woodMat);
    const crown = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.16), goldMat);
    crown.position.set(0, 0.26, 0);
    const orb = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), fireOrbMat);
    orb.position.set(0, 0.39, 0);
    this.staffGroup.add(staffPole, crown, orb);
    this.staffGroup.visible = false;
    this.handGroup.add(this.staffGroup);
  }

  private buildHeroAvatar(): void {
    const tunicMat = new THREE.MeshLambertMaterial({ color: 0x2563eb });
    const armorMat = new THREE.MeshLambertMaterial({ color: 0xfacc15 });
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xe3cab0 });
    const bootMat = new THREE.MeshLambertMaterial({ color: 0x4b3621 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.68, 0.28), tunicMat);
    torso.position.set(0, 0.98, 0);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.3), armorMat);
    belt.position.set(0, 0.72, 0);

    const headMesh = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.44, 0.44), skinMat);
    const hairMesh = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.46), bootMat);
    hairMesh.position.set(0, 0.18, 0);
    this.avatarHead.add(headMesh, hairMesh);
    this.avatarHead.position.set(0, 1.54, 0);

    this.avatarLegL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.64, 0.24), bootMat);
    this.avatarLegL.position.set(0.13, 0.32, 0);
    this.avatarLegR = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.64, 0.24), bootMat);
    this.avatarLegR.position.set(-0.13, 0.32, 0);

    this.avatarArmL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), tunicMat);
    this.avatarArmL.position.set(0.36, 0.98, 0);
    this.avatarArmR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.22), tunicMat);
    this.avatarArmR.position.set(-0.36, 0.98, 0);

    this.avatarGroup.add(torso, belt, this.avatarHead, this.avatarLegL, this.avatarLegR, this.avatarArmL, this.avatarArmR);
    this.avatarGroup.visible = false;
  }

  public cycleWeaponMode(): WeaponMode {
    const order: WeaponMode[] = ['block', 'pickaxe', 'sword', 'staff'];
    this.weaponMode = order[(order.indexOf(this.weaponMode) + 1) % order.length];
    this.handMesh.visible = this.weaponMode === 'block';
    this.pickaxeGroup.visible = this.weaponMode === 'pickaxe';
    this.swordGroup.visible = this.weaponMode === 'sword';
    this.staffGroup.visible = this.weaponMode === 'staff';
    return this.weaponMode;
  }

  public toggleThirdPerson(): boolean {
    this.isThirdPerson = !this.isThirdPerson;
    this.avatarGroup.visible = this.isThirdPerson;
    this.handGroup.visible = !this.isThirdPerson;
    return this.isThirdPerson;
  }

  public setHeldBlockColor(blockId: BlockId): void {
    if (this.currentHeldBlock === blockId) return;
    this.currentHeldBlock = blockId;

    const def = BLOCKS[blockId];
    if (!def) return;

    const [topTile, bottomTile, sideTile] = def.textures;
    // BoxGeometry face order: +x (side), -x (side), +y (top), -y (bottom), +z (side), -z (side)
    const faceTiles = [sideTile, sideTile, topTile, bottomTile, sideTile, sideTile];
    const uvAttr = this.handGeo.getAttribute('uv') as THREE.BufferAttribute;
    const pad = 0.002;

    for (let f = 0; f < 6; f++) {
      const tile = faceTiles[f];
      const u0 = (tile % ATLAS_COLS) / ATLAS_COLS + pad;
      const u1 = ((tile % ATLAS_COLS) + 1) / ATLAS_COLS - pad;
      const v1 = 1 - Math.floor(tile / ATLAS_COLS) / ATLAS_ROWS - pad;
      const v0 = 1 - (Math.floor(tile / ATLAS_COLS) + 1) / ATLAS_ROWS + pad;

      const base = f * 4;
      uvAttr.setXY(base + 0, u0, v1);
      uvAttr.setXY(base + 1, u1, v1);
      uvAttr.setXY(base + 2, u0, v0);
      uvAttr.setXY(base + 3, u1, v0);
    }
    uvAttr.needsUpdate = true;
    this.handMat.opacity = blockId === BlockId.Water ? 0.82 : 1.0;
  }

  public triggerHandSwing(): void {
    this.isSwinging = true;
    this.swingProgress = 0;
  }

  public toggleFly(): boolean {
    this.isFlying = !this.isFlying;
    this.velocity.y = 0;
    return this.isFlying;
  }

  private setupInput(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });
    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        const sens = 0.0021;
        this.yaw -= e.movementX * sens;
        this.pitch = THREE.MathUtils.clamp(
          this.pitch - e.movementY * sens,
          -Math.PI / 2 + 0.02,
          Math.PI / 2 - 0.02
        );
      }
    });
  }

  public rotateLook(dx: number, dy: number): void {
    this.yaw -= dx * 0.004;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.004, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  }

  public intersectsPlayer(bx: number, by: number, bz: number): boolean {
    const hw = this.width / 2;
    return (
      this.position.x + hw > bx &&
      this.position.x - hw < bx + 1 &&
      this.position.y + this.height > by &&
      this.position.y < by + 1 &&
      this.position.z + hw > bz &&
      this.position.z - hw < bz + 1
    );
  }

  public update(dt: number, controlsActive: boolean): void {
    const clampedDt = Math.min(dt, 0.05);
    const eyeBlock = this.getBlock(
      Math.floor(this.position.x),
      Math.floor(this.position.y + this.eyeHeight),
      Math.floor(this.position.z)
    );
    const feetBlock = this.getBlock(
      Math.floor(this.position.x),
      Math.floor(this.position.y + 0.3),
      Math.floor(this.position.z)
    );
    this.isUnderwater = eyeBlock === BlockId.Water;
    this.isInWater = this.isUnderwater || feetBlock === BlockId.Water;

    let forwardInput = 0;
    let rightInput = 0;
    if (controlsActive) {
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) forwardInput += 1;
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) forwardInput -= 1;
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) rightInput += 1;
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) rightInput -= 1;
      forwardInput += this.touchMoveZ;
      rightInput += this.touchMoveX;
    }

    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const moveDir = new THREE.Vector3()
      .addScaledVector(forward, forwardInput)
      .addScaledVector(right, rightInput);
    if (moveDir.lengthSq() > 1) moveDir.normalize();

    const sprinting = controlsActive && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
    const baseSpeed = this.isFlying ? (sprinting ? 18.0 : 10.5) : this.isInWater ? 3.8 : sprinting ? 7.4 : 4.8;
    this.velocity.x = moveDir.x * baseSpeed;
    this.velocity.z = moveDir.z * baseSpeed;

    const wantJump = controlsActive && (this.keys.has('Space') || this.touchJump);
    const wantDown = controlsActive && (this.keys.has('KeyC') || this.keys.has('ControlLeft'));

    if (this.isFlying) {
      this.velocity.y = (wantJump ? 1 : 0) * 8.5 - (wantDown ? 1 : 0) * 8.5;
    } else if (this.isInWater) {
      this.velocity.y = Math.max(this.velocity.y - 7.5 * clampedDt, -3.2);
      if (wantJump) this.velocity.y = 4.2;
    } else {
      this.velocity.y = Math.max(this.velocity.y - 24.5 * clampedDt, -38);
      if (wantJump && this.isGrounded) {
        this.velocity.y = 8.4;
        this.isGrounded = false;
      }
    }

    this.moveWithCollision(clampedDt);
    this.updateCameraAndHand(clampedDt);
  }

  private updateCameraAndHand(clampedDt: number): void {
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (horizSpeed > 0.5 && (this.isGrounded || this.isInWater) && !this.isFlying) {
      this.bobTimer += clampedDt * horizSpeed * 1.9;
      this.stepTimer += clampedDt * horizSpeed;
      if (this.stepTimer > 2.1) {
        this.stepTimer = 0;
        const groundId = this.getBlock(
          Math.floor(this.position.x),
          Math.floor(this.position.y - 0.2),
          Math.floor(this.position.z)
        );
        const sType = this.isInWater ? 'water' : BLOCKS[groundId]?.soundType || 'grass';
        this.sound.playFootstep(sType);
      }
    } else {
      this.bobTimer = 0;
    }

    const bobOffset = Math.sin(this.bobTimer) * 0.045;
    const euler = new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(euler);

    if (this.isThirdPerson) {
      const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.camera.position.set(
        this.position.x - camForward.x * 3.6,
        this.position.y + this.eyeHeight + 0.45 - camForward.y * 3.6,
        this.position.z - camForward.z * 3.6
      );
      this.avatarGroup.position.copy(this.position);
      this.avatarGroup.rotation.y = this.yaw;
      this.avatarHead.rotation.x = this.pitch;
      const limbSwing = Math.sin(this.bobTimer * 1.4) * 0.6;
      this.avatarLegL.rotation.x = limbSwing;
      this.avatarLegR.rotation.x = -limbSwing;
      this.avatarArmL.rotation.x = -limbSwing;
      this.avatarArmR.rotation.x = limbSwing;
    } else {
      this.camera.position.set(
        this.position.x,
        this.position.y + this.eyeHeight + bobOffset,
        this.position.z
      );
    }

    if (this.isSwinging) {
      this.swingProgress += clampedDt * 6.5;
      if (this.swingProgress >= 1) {
        this.isSwinging = false;
        this.swingProgress = 0;
      }
    }
    const swingAngle = Math.sin(this.swingProgress * Math.PI);
    this.handGroup.position.set(
      0.42 - swingAngle * 0.12,
      -0.34 - bobOffset * 0.6 + swingAngle * 0.08,
      -0.58 - swingAngle * 0.16
    );
    this.handGroup.rotation.set(0.25 - swingAngle * 0.85, -0.65 + swingAngle * 0.35, 0.1);
  }

  private moveWithCollision(dt: number): void {
    this.position.x += this.velocity.x * dt;
    this.resolveAxis('x');

    this.position.y += this.velocity.y * dt;
    this.isGrounded = false;
    this.resolveAxis('y');

    this.position.z += this.velocity.z * dt;
    this.resolveAxis('z');
  }

  private resolveAxis(axis: 'x' | 'y' | 'z'): void {
    const hw = this.width / 2;
    const minX = Math.floor(this.position.x - hw);
    const maxX = Math.floor(this.position.x + hw - 0.0001);
    const minY = Math.floor(this.position.y);
    const maxY = Math.floor(this.position.y + this.height - 0.0001);
    const minZ = Math.floor(this.position.z - hw);
    const maxZ = Math.floor(this.position.z + hw - 0.0001);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const id = this.getBlock(x, y, z);
          if (BLOCKS[id]?.solid) {
            if (axis === 'x') {
              if (this.velocity.x > 0) this.position.x = x - hw;
              else if (this.velocity.x < 0) this.position.x = x + 1 + hw;
              this.velocity.x = 0;
            } else if (axis === 'y') {
              if (this.velocity.y > 0) {
                this.position.y = y - this.height;
              } else if (this.velocity.y < 0) {
                this.position.y = y + 1;
                this.isGrounded = true;
              }
              this.velocity.y = 0;
            } else if (axis === 'z') {
              if (this.velocity.z > 0) this.position.z = z - hw;
              else if (this.velocity.z < 0) this.position.z = z + 1 + hw;
              this.velocity.z = 0;
            }
            return;
          }
        }
      }
    }
  }
}
