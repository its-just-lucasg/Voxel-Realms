# VoxelRealms: Fantasy Edition — Architecture & Progress Tracker

## Project Location & Dev Server
- **Directory:** `F:\Created Apps\voxel-game`
- **Tech Stack:** TypeScript + Three.js (WebGL) + Vite + Simplex Noise
- **Start Server on Windows (PowerShell):**
  ```powershell
  Set-Location -LiteralPath 'F:\Created Apps\voxel-game'
  npm run dev
  ```
- **URLs:** `http://localhost:5173` (PC Browser)

## Core Architecture (`src/`)
1. `src/blocks.ts` — Block IDs, properties (`solid`, `transparent`, `liquid`, `emissive`, `renderType`: `'cube' | 'cross' | 'torch' | 'campfire'`), 52 procedural atlas tiles (including connected bookshelf tiles `BOOKSHELF_1X2_L/R` and `BOOKSHELF_2X2_TL/TR/BL/BR`), and default hotbar.
2. `src/textures.ts` — 16x16 procedural pixel-art Texture Atlas (`8x7` grid) + Bump Map + Animated GLSL Water/Lava Shader + Swaying Foliage Wind Shader + Real-time animated fire texture (`paintAnimatedFireTile` updating `TileIndex.CAMPFIRE` at ~15 FPS with rising flame waves and sparks) + 3-mode connected Bookshelf textures + 3D Isometric UI Icon renderer.
3. `src/world.ts` — Refined Half-Scale micro-voxel world (`CHUNK_SIZE = 16`, `CHUNK_HEIGHT = 104`, `WATER_LEVEL = 32`) with multi-biome terrain & cave generator (Sakura Feywood, Ancient Oak & Ruins, Sunlit Birch Meadow, Crystal Frost Peaks, Amber Dunes, Crystal/Lava Caverns), towering 2x2 trees (13–15+ blocks tall with flared roots and ellipsoid canopies), 3x3 fast neighborhood chunk mesher with Smooth Voxel AO, 4-in-1 & wall-mounted Torches (`placeTorchWithNormal` & `torchMeta`), 2x2 footprint Cozy Campfires, 3-Mode Connected Scholar Bookshelves, 3x3x3 cluster mining (`breakClusterAt`), Dynamic Torch/Campfire PointLight pool, Flowing Water & Lava->Obsidian physics, Gravity Sand, and Powder Keg (Fantasy TNT) explosions.
4. `src/sky.ts` — GLSL Sky Dome (10-min Day / 7-min Night, realistic Lunar Maria & cratered Moon, spinning celestial pole stars, dual-channel Shooting Stars, Aurora Borealis, daytime cirrus wisps), Multi-puff 3D Cumulus Clouds, Optical Lens Flare, Underwater God Rays, and Dynamic Weather (Clear / Rain & Lightning / Snow).
5. `src/mobs.ts` — Fantasy Ecosystem: Meadow Sheep, Antlered Forest Stags, Tusked Boars, Floating Fey Wisps, and Night Shadow Wraiths / Skeletons.
6. `src/player.ts` — Refined Half-Scale RPG controller (`height = 3.1`, `eyeHeight = 2.8`, `width = 1.1`) with smooth 1-micro-block slope auto-step, First-Person & Third-Person (`V` key) 3D Fantasy Hero Avatar, AABB collision, Swimming, Flying (`F`), and Fantasy Arsenal (`Q` key: Block Hand, Runed Pickaxe, Knight's Broadsword, Arcane Firestaff).
7. `src/particles.ts` — Block break bursts, campfire smoke/embers, 3D magnetic dropped loot cubes (auto-collected into inventory), and Arcane Fireball projectiles.
8. `src/audio.ts` — Background Music player (`Above_the_Cloud_Line.mp3` with `/api/music-tracks` auto-discovery, 12–18s ambient pause between loops, and `N` key mute toggle) + Web Audio procedural sound synthesizer (footsteps, mining, placement, sheep baa, boar grunt, wraith hiss, sword slash, fireball cast, explosion, loot pickup chime).
9. `src/ui.ts` & `src/main.ts` — HUD, Hotbar, Block Palette (`E`), Creative / Survival Game Mode (`B` key & HUD toggle with live item count badges and Survival starter kit), Artisan Workbench Crafting UI (opened by interacting with a placed `CraftingTable`), Live Minimap (`M`), Multi-touch mobile controls, and main game loop.

## Latest Implemented Features
- **Refined Half-Scale Micro-Voxels:**
  - Compact half-scale hero proportions (`height = 3.1`, `eyeHeight = 2.8`, `width = 1.1`) paired with smooth 1-micro-block auto-stepping up slopes when grounded and a `14.0` block raycast reach.
  - World scaled to `CHUNK_HEIGHT = 104` and `WATER_LEVEL = 32`, featuring towering 2x2-trunk trees (13–15+ micro-blocks tall with root buttresses) and fast 3x3x3 cluster excavation when mining with the **Runed Pickaxe** (`breakClusterAt`).
- **4-in-1 & Wall-Mounted Torches with Moving Flames:**
  - Ground torches support stacking up to **4 quarter-sized torches inside a single voxel space** (`placeTorchWithNormal` & `torchMeta`) by right-clicking an existing ground torch or its target space.
  - Placing a torch on the side of a wall or tree trunk (`normalY === 0`) anchors a **tilted wall-mounted torch** (`tiltX` / `tiltZ`) against the surface.
  - Crowned with X-crossed animated flame planes (`emitAnimatedFlamePlanes`) driven by the real-time procedural fire tile (`paintAnimatedFireTile`) plus dynamic warm `PointLight` illumination.
- **2x2 Cozy Campfires:**
  - Renders across a **2x2 micro-voxel footprint** with 4 heavy 2-block crossed timber logs, a glowing magma/ember bed (`TileIndex.MAGMA`), and tall roaring animated X-crossed flame planes (`halfW = 0.62`, `flameH = 1.32`) centered at `(wx + 1.0, y, wz + 1.0)` with dynamic point lighting and rising smoke/ember particles.
- **3-Mode Connected Scholar Bookshelves:**
  - Neighbor-aware UV selection in `emitChunkGeometry` automatically connects adjacent `BlockId.Bookshelf` blocks across three visual modes:
    1. **Mode 1 (`1x1` Solo):** Full framed single bookshelf (`BOOKSHELF_SIDE`).
    2. **Mode 2 (`1x2` Horizontal Pair):** Side-by-side left/right halves (`BOOKSHELF_1X2_L`, `BOOKSHELF_1X2_R`) with an open inner seam.
    3. **Mode 3 (`2x2` Stacked Grand Library Wall):** 4 connected quadrants (`BOOKSHELF_2X2_TL`, `TR`, `BL`, `BR`) forming a continuous multi-row library wall with varied book spines and gold trim.
- **Creative / Survival Mode with Item Counts:**
  - Press **`B`** (or click the HUD mode button) to switch between **Creative Mode** (unlimited building & free crafting) and **Survival Mode** (finite item counts tracked per `BlockId` in `inventoryCounts`).
  - Includes a Survival starter kit (`1x Artisan Workbench`, `4x Flame Torches`, `4x Oak Logs`, `6x Oak Planks`), real-time count badges on Hotbar slots and Inventory items, block consumption on placement, and magnetic 3D loot drops that increment inventory counts and auto-slot into empty hotbar slots.
- **Artisan Workbench Crafting UI:**
  - Interacting (right-click) with a placed **Artisan Workbench (`BlockId.CraftingTable`)** opens the Crafting Modal (`#crafting-modal`), pooling wood across `OakLog`, `BirchLog`, `PineLog`, and `OakPlanks` (`getTotalWood` / `deductWood`) to craft:
    - **4x Flame Torches** (2 Wood)
    - **4x Oak Wood Planks** (1 Wood Log)
    - **1x Cozy 2x2 Campfire** (3 Wood)
    - **1x Scholar Bookshelf** (4 Wood)
    - **1x Artisan Workbench** (2 Wood)
- **Background Music (`Above_the_Cloud_Line.mp3`):**
  - Streams `/music/Above_the_Cloud_Line.mp3` (with auto-discovery via `/api/music-tracks`), starting on pointer lock / user interaction with a peaceful 12–18s ambient pause between loops and **`N`** key mute/unmute toggle.

