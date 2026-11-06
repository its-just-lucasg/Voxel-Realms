import * as THREE from 'three';
import { BlockId, BLOCKS } from './blocks';
import { TextureAtlas } from './textures';
import { VoxelWorld, WATER_LEVEL } from './world';
import { PlayerController } from './player';
import { SkySystem } from './sky';
import { raycastVoxel, RaycastHit } from './raycast';
import { ParticleSystem } from './particles';
import { SoundEngine } from './audio';
import { UIManager } from './ui';
import { MobManager } from './mobs';

class VoxelGame {
  private container = document.getElementById('game-container')!;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;

  private atlas: TextureAtlas;
  private sound: SoundEngine;
  private world: VoxelWorld;
  private sky: SkySystem;
  private player: PlayerController;
  private particles: ParticleSystem;
  private mobs: MobManager;
  private ui: UIManager;

  private highlightBox: THREE.LineSegments;
  private currentHit: RaycastHit | null = null;

  private lastTime = performance.now();
  private fpsSmooth = 60;
  private chunkUpdateTimer = 0;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 350);
    this.scene.add(this.camera);

    this.sound = new SoundEngine();
    this.atlas = new TextureAtlas();
    this.world = new VoxelWorld(this.scene, this.atlas);
    this.sky = new SkySystem(this.scene);
    this.particles = new ParticleSystem(this.scene);
    this.mobs = new MobManager(this.scene);

    this.player = new PlayerController(
      this.camera,
      (x, y, z) => this.world.getBlock(x, y, z),
      this.sound,
      this.atlas,
      this.scene
    );

    this.ui = new UIManager(this.atlas, this.sound, () => this.lockPointer());

    // 3D Wireframe Block Selector Outline
    const boxGeo = new THREE.BoxGeometry(1.006, 1.006, 1.006);
    const edges = new THREE.EdgesGeometry(boxGeo);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.85 });
    this.highlightBox = new THREE.LineSegments(edges, lineMat);
    this.highlightBox.visible = false;
    this.scene.add(this.highlightBox);

    this.spawnPlayerOnSurface();
    this.world.updateChunksAroundPlayer(this.player.position.x, this.player.position.z, 3);
    this.mobs.spawnInitialFlock(this.player.position.x, this.player.position.z, (wx, wz) =>
      this.world.getTerrainHeight(wx, wz)
    );

    this.setupEvents();
    requestAnimationFrame((t) => this.animate(t));
  }

  private spawnPlayerOnSurface(): void {
    const sx = 8;
    const sz = 8;
    const sy = Math.max(this.world.getTerrainHeight(sx, sz), WATER_LEVEL) + 2.5;
    this.player.position.set(sx + 0.5, sy, sz + 0.5);
    this.player.velocity.set(0, 0, 0);
  }

  private lockPointer(): void {
    this.ui.setPauseVisible(false);
    this.ui.toggleInventory(false);
    if (this.renderer.domElement.requestPointerLock) {
      this.renderer.domElement.requestPointerLock();
    }
  }

  private breakTargetedBlock(): void {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (this.player.weaponMode === 'staff') {
      this.player.triggerHandSwing();
      this.sound.playFireballCast();
      this.particles.castFireball(this.camera.position, forward);
      return;
    }
    if (this.player.weaponMode === 'sword') {
      this.player.triggerHandSwing();
      this.sound.playSwordSlash();
    }

    if (!this.currentHit) return;
    const { blockX, blockY, blockZ, blockId } = this.currentHit;
    if (blockId === BlockId.Bedrock) return;

    this.player.triggerHandSwing();
    if (blockId === BlockId.PowderKeg) {
      // Detonate Alchemist's Powder Keg (Fantasy TNT) with a round 6.2-radius crater!
      this.sound.playExplosion();
      this.particles.spawnBlockBurst(blockX, blockY, blockZ, BlockId.MagmaBlock, 55);
      this.world.detonateAt(blockX, blockY, blockZ, 6.2);
      return;
    }

    this.particles.spawnBlockBurst(blockX, blockY, blockZ, blockId, 20);
    this.particles.spawnLootDrop(blockX, blockY, blockZ, blockId);
    this.sound.playBlockBreak(BLOCKS[blockId]?.soundType || 'stone');

    if (this.player.weaponMode === 'pickaxe') {
      // Runed Pickaxe mines a 2x2x2 cluster per hit so digging is fast & effortless!
      this.world.breakClusterAt(blockX, blockY, blockZ);
    } else {
      this.world.setBlock(blockX, blockY, blockZ, BlockId.Air);
    }
  }

  private placeTargetedBlock(): void {
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    if (this.player.weaponMode === 'staff') {
      this.player.triggerHandSwing();
      this.sound.playFireballCast();
      this.particles.castFireball(this.camera.position, forward);
      return;
    }

    if (!this.currentHit) return;
    if (this.currentHit.blockId === BlockId.PowderKeg) {
      this.sound.playExplosion();
      this.particles.spawnBlockBurst(this.currentHit.blockX, this.currentHit.blockY, this.currentHit.blockZ, BlockId.MagmaBlock, 55);
      this.world.detonateAt(this.currentHit.blockX, this.currentHit.blockY, this.currentHit.blockZ, 6.2);
      return;
    }

    const tx = this.currentHit.blockX + this.currentHit.normalX;
    const ty = this.currentHit.blockY + this.currentHit.normalY;
    const tz = this.currentHit.blockZ + this.currentHit.normalZ;

    const selected = this.ui.getSelectedBlock();
    if (BLOCKS[selected].solid && this.player.intersectsPlayer(tx, ty, tz)) {
      return;
    }

    this.player.triggerHandSwing();
    this.sound.playBlockPlace(BLOCKS[selected]?.soundType || 'stone');
    this.world.setBlock(tx, ty, tz, selected);
  }

  private setupEvents(): void {
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.renderer.domElement;
      if (!locked && !this.ui.isInventoryOpen) {
        this.ui.setPauseVisible(true);
      } else if (locked) {
        this.ui.setPauseVisible(false);
      }
    });

    this.renderer.domElement.addEventListener('mousedown', (e) => {
      if (this.ui.isInventoryOpen || this.ui.isPauseOpen) return;
      if (document.pointerLockElement !== this.renderer.domElement) {
        this.lockPointer();
        return;
      }
      if (e.button === 0) {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        if (this.mobs.interactWithSheepAtRay(this.camera.position, forward, 5.5, this.sound, this.particles)) {
          this.player.triggerHandSwing();
        } else {
          this.breakTargetedBlock();
        }
      } else if (e.button === 2) {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        if (this.mobs.interactWithSheepAtRay(this.camera.position, forward, 5.5, this.sound, this.particles)) {
          this.player.triggerHandSwing();
        } else {
          this.placeTargetedBlock();
        }
      }
    });

    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('Digit')) {
        const num = parseInt(e.code.replace('Digit', ''), 10);
        if (num >= 1 && num <= 9) {
          this.ui.selectSlot(num - 1);
          this.player.setHeldBlockColor(this.ui.getSelectedBlock());
        }
      } else if (e.code === 'KeyE') {
        this.ui.toggleInventory();
        if (!this.ui.isInventoryOpen) this.lockPointer();
      } else if (e.code === 'KeyF') {
        this.player.toggleFly();
        this.sound.playUiClick();
      } else if (e.code === 'KeyT') {
        this.sky.cyclePresetTime();
        this.sound.playUiClick();
      } else if (e.code === 'KeyG') {
        this.sky.toggleTorch();
        this.sound.playUiClick();
      } else if (e.code === 'KeyQ') {
        const mode = this.player.cycleWeaponMode();
        const labels = {
          block: `Builder: ${BLOCKS[this.ui.getSelectedBlock()].name}`,
          pickaxe: 'Equipped: Runed Pickaxe',
          sword: "Equipped: Knight's Broadsword",
          staff: "Equipped: Mage's Arcane Firestaff",
        };
        this.ui.setBannerText(labels[mode]);
        this.sound.playUiClick();
      } else if (e.code === 'KeyV') {
        const tp = this.player.toggleThirdPerson();
        this.ui.setBannerText(tp ? 'Camera: 3rd-Person RPG Hero' : 'Camera: 1st-Person View');
        this.sound.playUiClick();
      } else if (e.code === 'KeyP') {
        const w = this.sky.cycleWeather();
        this.ui.setBannerText(`Weather: ${w}`);
        this.sound.playUiClick();
      } else if (e.code === 'KeyM') {
        this.ui.toggleMinimap();
        this.sound.playUiClick();
      } else if (e.code === 'Semicolon') {
        if (this.ui.isInventoryOpen || this.ui.isPauseOpen) return;
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        if (this.mobs.interactWithSheepAtRay(this.camera.position, forward, 5.5, this.sound, this.particles)) {
          this.player.triggerHandSwing();
        } else {
          this.placeTargetedBlock();
        }
      }
    });

    document.getElementById('btn-play')?.addEventListener('click', () => this.lockPointer());
    document.getElementById('btn-time-cycle')?.addEventListener('click', () => {
      this.sky.cyclePresetTime();
      this.sound.playUiClick();
    });
    document.getElementById('btn-new-world')?.addEventListener('click', () => {
      this.world.regenerateNewSeed();
      this.spawnPlayerOnSurface();
      this.world.updateChunksAroundPlayer(this.player.position.x, this.player.position.z, 3);
      this.mobs.spawnInitialFlock(this.player.position.x, this.player.position.z, (wx, wz) =>
        this.world.getTerrainHeight(wx, wz)
      );
      this.lockPointer();
    });
    document.getElementById('btn-reset-edits')?.addEventListener('click', () => {
      this.world.resetEdits();
      this.world.updateChunksAroundPlayer(this.player.position.x, this.player.position.z, 3);
      this.lockPointer();
    });
    document.getElementById('btn-toggle-touch')?.addEventListener('click', () => {
      document.getElementById('touch-controls')?.classList.toggle('hidden');
      this.ui.setPauseVisible(false);
    });

    this.setupTouchControls();
  }

  private setupTouchControls(): void {
    const touchRoot = document.getElementById('touch-controls');
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      touchRoot?.classList.remove('hidden');
    }

    const zone = document.getElementById('joystick-zone');
    const stick = document.getElementById('joystick-stick');
    let joyTouchId: number | null = null;
    let joyOrigin = { x: 0, y: 0 };

    zone?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const t = e.changedTouches[0];
      joyTouchId = t.identifier;
      joyOrigin = { x: t.clientX, y: t.clientY };
    });
    zone?.addEventListener('touchmove', (e) => {
      e.preventDefault();
      e.stopPropagation();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === joyTouchId) {
          const dx = THREE.MathUtils.clamp((t.clientX - joyOrigin.x) / 40, -1, 1);
          const dy = THREE.MathUtils.clamp((t.clientY - joyOrigin.y) / 40, -1, 1);
          this.player.touchMoveX = dx;
          this.player.touchMoveZ = -dy;
          if (stick) stick.style.transform = `translate(${dx * 28}px, ${dy * 28}px)`;
        }
      }
    });
    const endJoy = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joyTouchId) {
          joyTouchId = null;
          this.player.touchMoveX = 0;
          this.player.touchMoveZ = 0;
          if (stick) stick.style.transform = 'translate(0px, 0px)';
        }
      }
    };
    zone?.addEventListener('touchend', endJoy);
    zone?.addEventListener('touchcancel', endJoy);

    // Multi-touch swipe on canvas to look around (works simultaneously with left-thumb joystick)
    let lookTouchId: number | null = null;
    let lastLookX = 0;
    let lastLookY = 0;

    this.renderer.domElement.addEventListener('touchstart', (e) => {
      if (this.ui.isPauseOpen || this.ui.isInventoryOpen) return;
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (lookTouchId === null && t.identifier !== joyTouchId) {
          lookTouchId = t.identifier;
          lastLookX = t.clientX;
          lastLookY = t.clientY;
          break;
        }
      }
    });

    this.renderer.domElement.addEventListener('touchmove', (e) => {
      if (this.ui.isPauseOpen || this.ui.isInventoryOpen) return;
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier === lookTouchId) {
          const dx = t.clientX - lastLookX;
          const dy = t.clientY - lastLookY;
          lastLookX = t.clientX;
          lastLookY = t.clientY;
          this.player.rotateLook(dx, dy);
          break;
        }
      }
    });

    const endLook = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === lookTouchId) {
          lookTouchId = null;
        }
      }
    };
    this.renderer.domElement.addEventListener('touchend', endLook);
    this.renderer.domElement.addEventListener('touchcancel', endLook);

    document.getElementById('btn-touch-jump')?.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.player.touchJump = true;
    });
    document.getElementById('btn-touch-jump')?.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.player.touchJump = false;
    });
    document.getElementById('btn-touch-fly')?.addEventListener('click', () => this.player.toggleFly());
    document.getElementById('btn-touch-mine')?.addEventListener('click', () => {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      if (this.mobs.interactWithSheepAtRay(this.camera.position, forward, 5.5, this.sound, this.particles)) {
        this.player.triggerHandSwing();
      } else {
        this.breakTargetedBlock();
      }
    });
    document.getElementById('btn-touch-place')?.addEventListener('click', () => {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      if (this.mobs.interactWithSheepAtRay(this.camera.position, forward, 5.5, this.sound, this.particles)) {
        this.player.triggerHandSwing();
      } else {
        this.placeTargetedBlock();
      }
    });
    document.getElementById('btn-touch-inv')?.addEventListener('click', () => this.ui.toggleInventory());
  }

  private animate(now: number): void {
    requestAnimationFrame((t) => this.animate(t));

    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;
    if (dt > 0) {
      this.fpsSmooth = this.fpsSmooth * 0.92 + (1 / dt) * 0.08;
    }

    const controlsActive = !this.ui.isPauseOpen && !this.ui.isInventoryOpen;
    this.player.setHeldBlockColor(this.ui.getSelectedBlock());
    this.player.update(dt, controlsActive);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.currentHit = raycastVoxel(this.camera.position, forward, 12.5, (x, y, z) =>
      this.world.getBlock(x, y, z)
    );

    if (this.currentHit) {
      this.highlightBox.visible = true;
      if (this.player.weaponMode === 'pickaxe') {
        this.highlightBox.scale.setScalar(2.0);
        this.highlightBox.position.set(
          this.currentHit.blockX + 1.0,
          this.currentHit.blockY + 1.0,
          this.currentHit.blockZ + 1.0
        );
      } else {
        this.highlightBox.scale.setScalar(1.0);
        this.highlightBox.position.set(
          this.currentHit.blockX + 0.5,
          this.currentHit.blockY + 0.5,
          this.currentHit.blockZ + 0.5
        );
      }
    } else {
      this.highlightBox.visible = false;
    }

    this.chunkUpdateTimer += dt;
    if (this.chunkUpdateTimer > 0.2) {
      this.chunkUpdateTimer = 0;
      this.world.updateChunksAroundPlayer(this.player.position.x, this.player.position.z, 0);
    }
    this.world.stepStreaming(dt);
    this.world.stepWaterPhysics(dt);
    this.world.updateTorchLights(dt, this.player.position);
    this.atlas.updateWaterAnimation(dt);
    this.mobs.update(
      dt,
      this.player.position,
      (x, y, z) => this.world.getBlock(x, y, z),
      (wx, wz) => this.world.getTerrainHeight(wx, wz),
      this.sound,
      this.particles
    );

    this.particles.update(
      dt,
      this.player.position,
      (x, y, z) => this.world.getBlock(x, y, z),
      this.sound,
      (bx, by, bz) => {
        this.sound.playExplosion();
        this.particles.spawnBlockBurst(bx, by, bz, BlockId.MagmaBlock, 45);
        this.world.detonateAt(bx, by, bz, 5.2);
      }
    );
    this.sky.update(
      dt,
      this.player.position,
      this.player.isUnderwater,
      this.camera,
      (x, y, z) => this.world.getBlock(x, y, z)
    );

    if (this.chunkUpdateTimer === 0) {
      this.ui.updateMinimap(
        this.player.position.x,
        this.player.position.z,
        this.player.yaw,
        (wx, wz) => this.world.getTerrainHeight(wx, wz),
        this.mobs.sheepList
      );
    }

    const biome = this.world.getBiomeNameAt(this.player.position.x, this.player.position.z);
    this.ui.updateStats(
      this.fpsSmooth,
      this.player.position.x,
      this.player.position.y,
      this.player.position.z,
      biome,
      this.sky.getFormattedTime(),
      this.player.isFlying,
      this.player.isUnderwater
    );

    this.renderer.render(this.scene, this.camera);
  }
}

new VoxelGame();

