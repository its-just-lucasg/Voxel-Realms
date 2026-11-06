import { BlockId, BLOCKS, DEFAULT_HOTBAR, PLACEABLE_BLOCKS } from './blocks';
import { TextureAtlas } from './textures';
import { SoundEngine } from './audio';

export class UIManager {
  public hotbar: BlockId[] = [...DEFAULT_HOTBAR];
  public activeSlot = 0;
  public isInventoryOpen = false;
  public isCraftingOpen = false;
  public isPauseOpen = true;
  public gameMode: 'creative' | 'survival' = 'creative';
  public inventoryCounts = new Map<BlockId, number>();

  private hotbarEl = document.getElementById('hotbar')!;
  private blockLabelEl = document.getElementById('selected-block-label')!;
  private invModalEl = document.getElementById('inventory-modal')!;
  private invGridEl = document.getElementById('inventory-grid')!;
  private craftingModalEl = document.getElementById('crafting-modal')!;
  private craftingWoodEl = document.getElementById('crafting-wood-status')!;
  private craftingListEl = document.getElementById('crafting-recipes-list')!;
  private startModalEl = document.getElementById('start-modal')!;
  private underwaterEl = document.getElementById('underwater-overlay')!;

  private statFpsEl = document.getElementById('stat-fps')!;
  private statPosEl = document.getElementById('stat-pos')!;
  private statBiomeEl = document.getElementById('stat-biome')!;
  private statTimeEl = document.getElementById('stat-time')!;
  private statModeEl = document.getElementById('stat-mode')!;
  private statGameModeEl = document.getElementById('stat-gamemode')!;
  private minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement | null;
  public minimapVisible = true;

  private atlas: TextureAtlas;
  private sound: SoundEngine;
  private onLockRequest: () => void;

  constructor(atlas: TextureAtlas, sound: SoundEngine, onLockRequest: () => void) {
    this.atlas = atlas;
    this.sound = sound;
    this.onLockRequest = onLockRequest;

    // Starter kit for Survival Mode so players can place an Artisan Workbench or craft right away
    this.inventoryCounts.set(BlockId.CraftingTable, 1);
    this.inventoryCounts.set(BlockId.Torch, 4);
    this.inventoryCounts.set(BlockId.OakLog, 4);
    this.inventoryCounts.set(BlockId.OakPlanks, 6);

    this.renderHotbar();
    this.renderInventory();
    this.setupListeners();
  }

  public getCount(blockId: BlockId): number {
    return this.inventoryCounts.get(blockId) ?? 0;
  }

  public addBlockToInventory(blockId: BlockId, amount = 1): void {
    const prev = this.getCount(blockId);
    this.inventoryCounts.set(blockId, prev + amount);
    // If not in hotbar yet and there is a slot with 0 count in Survival, auto-slot it
    if (this.gameMode === 'survival' && !this.hotbar.includes(blockId)) {
      const emptyIdx = this.hotbar.findIndex((b) => this.getCount(b) === 0);
      if (emptyIdx !== -1) this.hotbar[emptyIdx] = blockId;
    }
    this.renderHotbar();
    if (this.isInventoryOpen) this.renderInventory();
    if (this.isCraftingOpen) this.renderCraftingRecipes();
  }

  public canPlaceBlock(blockId: BlockId): boolean {
    if (this.gameMode === 'creative') return true;
    return this.getCount(blockId) > 0;
  }

  public consumeBlock(blockId: BlockId): boolean {
    if (this.gameMode === 'creative') return true;
    const cur = this.getCount(blockId);
    if (cur <= 0) return false;
    this.inventoryCounts.set(blockId, cur - 1);
    this.renderHotbar();
    return true;
  }

  public toggleGameMode(): 'creative' | 'survival' {
    this.gameMode = this.gameMode === 'creative' ? 'survival' : 'creative';
    if (this.statGameModeEl) {
      this.statGameModeEl.textContent = this.gameMode.toUpperCase();
      this.statGameModeEl.className = this.gameMode === 'survival' ? 'badge-walk' : 'badge-fly';
    }
    this.renderHotbar();
    this.renderInventory();
    this.sound.playUiClick();
    return this.gameMode;
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
      const count = this.getCount(blockId);
      const countBadge =
        this.gameMode === 'survival'
          ? `<span style="position:absolute;bottom:2px;right:4px;font-size:10px;font-weight:800;color:${count > 0 ? '#f8fafc' : '#ef4444'};">${count}</span>`
          : '';
      slot.className = `hotbar-slot ${idx === this.activeSlot ? 'active' : ''}`;
      slot.innerHTML = `
        <span class="slot-key">${idx + 1}</span>
        <img src="${this.atlas.getBlockIconDataUrl(blockId)}" alt="${BLOCKS[blockId].name}" style="opacity:${this.gameMode === 'survival' && count === 0 ? 0.35 : 1};" />
        ${countBadge}
      `;
      slot.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        this.selectSlot(idx);
      });
      this.hotbarEl.appendChild(slot);
    });
    this.blockLabelEl.textContent = BLOCKS[this.getSelectedBlock()].name;
  }

  public renderInventory(): void {
    this.invGridEl.innerHTML = '';
    for (const block of PLACEABLE_BLOCKS) {
      const count = this.getCount(block.id);
      const item = document.createElement('div');
      item.className = 'inv-item';
      const countLabel = this.gameMode === 'survival' ? ` (${count})` : '';
      item.innerHTML = `
        <img src="${this.atlas.getBlockIconDataUrl(block.id)}" alt="${block.name}" style="opacity:${this.gameMode === 'survival' && count === 0 ? 0.4 : 1};" />
        <span>${block.name}${countLabel}</span>
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

  private getTotalWood(): number {
    return (
      this.getCount(BlockId.OakLog) +
      this.getCount(BlockId.BirchLog) +
      this.getCount(BlockId.PineLog) +
      this.getCount(BlockId.OakPlanks)
    );
  }

  private deductWood(amount: number): boolean {
    if (this.gameMode === 'creative') return true;
    if (this.getTotalWood() < amount) return false;
    let rem = amount;
    const woodTypes = [BlockId.OakPlanks, BlockId.OakLog, BlockId.BirchLog, BlockId.PineLog];
    for (const wt of woodTypes) {
      const c = this.getCount(wt);
      const take = Math.min(c, rem);
      if (take > 0) {
        this.inventoryCounts.set(wt, c - take);
        rem -= take;
      }
      if (rem <= 0) break;
    }
    return true;
  }

  public toggleCrafting(force?: boolean): void {
    this.isCraftingOpen = force !== undefined ? force : !this.isCraftingOpen;
    this.craftingModalEl?.classList.toggle('hidden', !this.isCraftingOpen);
    this.sound.playUiClick();
    if (this.isCraftingOpen) {
      this.renderCraftingRecipes();
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }

  public renderCraftingRecipes(): void {
    if (!this.craftingListEl || !this.craftingWoodEl) return;
    const totalWood = this.getTotalWood();
    this.craftingWoodEl.textContent =
      this.gameMode === 'creative'
        ? 'Creative Mode: Free Unlimited Crafting'
        : `Available Wood (Logs & Planks): ${totalWood}`;

    const recipes: { outId: BlockId; outQty: number; woodCost: number; desc: string }[] = [
      { outId: BlockId.Torch, outQty: 4, woodCost: 2, desc: 'Craft 4x Flame Torches (Costs 2 Wood)' },
      { outId: BlockId.OakPlanks, outQty: 4, woodCost: 1, desc: 'Craft 4x Oak Wood Planks (Costs 1 Wood Log)' },
      { outId: BlockId.Campfire, outQty: 1, woodCost: 3, desc: 'Craft 1x Cozy 2x2 Campfire (Costs 3 Wood)' },
      { outId: BlockId.Bookshelf, outQty: 1, woodCost: 4, desc: 'Craft 1x Scholar Bookshelf (Costs 4 Wood)' },
      { outId: BlockId.CraftingTable, outQty: 1, woodCost: 2, desc: 'Craft 1x Artisan Workbench (Costs 2 Wood)' },
    ];

    this.craftingListEl.innerHTML = '';
    for (const r of recipes) {
      const canAfford = this.gameMode === 'creative' || totalWood >= r.woodCost;
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;align-items:center;justify-content:space-between;background:rgba(30,41,59,0.82);padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.14);';
      row.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;">
          <img src="${this.atlas.getBlockIconDataUrl(r.outId)}" style="width:36px;height:36px;image-rendering:pixelated;" />
          <div>
            <div style="font-weight:700;font-size:14px;color:#f8fafc;">${r.desc}</div>
            <div style="font-size:12px;color:#94a3b8;">You have: ${this.getCount(r.outId)}</div>
          </div>
        </div>
        <button class="btn-primary" style="padding:8px 16px;font-size:13px;opacity:${canAfford ? 1 : 0.4};cursor:${canAfford ? 'pointer' : 'not-allowed'};">Craft</button>
      `;
      row.querySelector('button')?.addEventListener('click', () => {
        if (this.deductWood(r.woodCost)) {
          this.addBlockToInventory(r.outId, r.outQty);
          this.sound.playPickupChime();
          this.renderCraftingRecipes();
        }
      });
      this.craftingListEl.appendChild(row);
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
