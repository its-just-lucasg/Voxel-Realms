import { BlockId, BLOCKS, DEFAULT_HOTBAR, PLACEABLE_BLOCKS } from './blocks';
import { TextureAtlas } from './textures';
import { SoundEngine } from './audio';

export class UIManager {
  public hotbar: BlockId[] = [...DEFAULT_HOTBAR];
  public activeSlot = 0;
  public isInventoryOpen = false;
  public isPauseOpen = true;

  private hotbarEl = document.getElementById('hotbar')!;
  private blockLabelEl = document.getElementById('selected-block-label')!;
  private invModalEl = document.getElementById('inventory-modal')!;
  private invGridEl = document.getElementById('inventory-grid')!;
  private startModalEl = document.getElementById('start-modal')!;
  private underwaterEl = document.getElementById('underwater-overlay')!;

  private statFpsEl = document.getElementById('stat-fps')!;
  private statPosEl = document.getElementById('stat-pos')!;
  private statBiomeEl = document.getElementById('stat-biome')!;
  private statTimeEl = document.getElementById('stat-time')!;
  private statModeEl = document.getElementById('stat-mode')!;
  private minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
  public minimapVisible = true;

  private atlas: TextureAtlas;
  private sound: SoundEngine;
  private onLockRequest: () => void;

  constructor(atlas: TextureAtlas, sound: SoundEngine, onLockRequest: () => void) {
    this.atlas = atlas;
    this.sound = sound;
    this.onLockRequest = onLockRequest;

    this.renderHotbar();
    this.renderInventory();
    this.setupListeners();
  }

  public getSelectedBlock(): BlockId {
    return this.hotbar[this.activeSlot] ?? BlockId.Grass;
  }

  public selectSlot(index: number): void {
    this.activeSlot = ((index % this.hotbar.length) + this.hotbar.length) % this.hotbar.length;
    this.renderHotbar();
    const block = BLOCKS[this.getSelectedBlock()];
    this.blockLabelEl.textContent = block.name;
    this.sound.playUiClick();
  }

  public renderHotbar(): void {
    this.hotbarEl.innerHTML = '';
    this.hotbar.forEach((blockId, idx) => {
      const slot = document.createElement('div');
      slot.className = `hotbar-slot ${idx === this.activeSlot ? 'active' : ''}`;
      slot.innerHTML = `
        <span class="slot-key">${idx + 1}</span>
        <img src="${this.atlas.getBlockIconDataUrl(blockId)}" alt="${BLOCKS[blockId].name}" />
      `;
      slot.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.selectSlot(idx);
      });
      this.hotbarEl.appendChild(slot);
    });
    this.blockLabelEl.textContent = BLOCKS[this.getSelectedBlock()].name;
  }

  private renderInventory(): void {
    this.invGridEl.innerHTML = '';
    for (const block of PLACEABLE_BLOCKS) {
      const item = document.createElement('div');
      item.className = 'inv-item';
      item.innerHTML = `
        <img src="${this.atlas.getBlockIconDataUrl(block.id)}" alt="${block.name}" />
        <span>${block.name}</span>
      `;
      item.addEventListener('click', () => {
        this.hotbar[this.activeSlot] = block.id;
        this.renderHotbar();
        this.toggleInventory(false);
        this.onLockRequest();
      });
      this.invGridEl.appendChild(item);
    }
  }

  public toggleInventory(force?: boolean): void {
    this.isInventoryOpen = force !== undefined ? force : !this.isInventoryOpen;
    this.invModalEl.classList.toggle('hidden', !this.isInventoryOpen);
    this.sound.playUiClick();
    if (this.isInventoryOpen && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  public setPauseVisible(visible: boolean): void {
    this.isPauseOpen = visible;
    this.startModalEl.classList.toggle('hidden', !visible);
  }

  public updateStats(
    fps: number,
    x: number,
    y: number,
    z: number,
    biome: string,
    timeStr: string,
    flying: boolean,
    underwater: boolean
  ): void {
    this.statFpsEl.textContent = `${Math.round(fps)}`;
    this.statPosEl.textContent = `${Math.floor(x)}, ${Math.floor(y)}, ${Math.floor(z)}`;
    this.statBiomeEl.textContent = biome;
    this.statTimeEl.textContent = timeStr;
    this.statModeEl.textContent = flying ? 'FLYING' : 'WALKING';
    this.statModeEl.className = flying ? 'badge-fly' : 'badge-walk';
    this.underwaterEl.classList.toggle('hidden', !underwater);
  }

  public setBannerText(text: string): void {
    this.blockLabelEl.textContent = text;
  }

  public toggleMinimap(): void {
    this.minimapVisible = !this.minimapVisible;
    this.minimapCanvas?.classList.toggle('hidden', !this.minimapVisible);
  }

  public updateMinimap(
    px: number,
    pz: number,
    yaw: number,
    getHeight: (wx: number, wz: number) => number,
    creatures: { position: { x: number; z: number }; species: string }[]
  ): void {
    if (!this.minimapCanvas || !this.minimapVisible) return;
    const ctx = this.minimapCanvas.getContext('2d');
    if (!ctx) return;

    const size = 96;
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, size, size);

    const step = 3;
    for (let sy = 0; sy < size; sy += step) {
      for (let sx = 0; sx < size; sx += step) {
        const wx = Math.floor(px + (sx - size / 2) * 1.2);
        const wz = Math.floor(pz + (sy - size / 2) * 1.2);
        const h = getHeight(wx, wz);
        ctx.fillStyle =
          h <= 22 ? '#1d6ff2' : h <= 24 ? '#e6d49c' : h >= 42 ? '#eef6fc' : h >= 34 ? '#3d7025' : '#569c2e';
        ctx.fillRect(sx, sy, step, step);
      }
    }

    // Draw creatures & shadow wraiths
    for (const c of creatures) {
      const mx = size / 2 + (c.position.x - px) / 1.2;
      const my = size / 2 + (c.position.z - pz) / 1.2;
      if (mx >= 2 && mx < size - 2 && my >= 2 && my < size - 2) {
        ctx.fillStyle = c.species === 'wraith' ? '#ef4444' : c.species === 'stag' ? '#facc15' : '#ffffff';
        ctx.fillRect(mx - 1.5, my - 1.5, 3, 3);
      }
    }

    // Draw player arrow in center
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-yaw);
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(0, -5);
    ctx.lineTo(4, 4);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private setupListeners(): void {
    window.addEventListener('wheel', (e) => {
      if (this.isInventoryOpen || this.isPauseOpen) return;
      this.selectSlot(this.activeSlot + (e.deltaY > 0 ? 1 : -1));
    });
  }
}
