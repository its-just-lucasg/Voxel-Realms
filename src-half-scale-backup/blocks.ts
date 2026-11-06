export enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Cobblestone = 4,
  Sand = 5,
  Sandstone = 6,
  Water = 7,
  OakLog = 8,
  OakPlanks = 9,
  OakLeaves = 10,
  BirchLog = 11,
  BirchLeaves = 12,
  SnowGrass = 13,
  Snow = 14,
  CoalOre = 15,
  GoldOre = 16,
  DiamondOre = 17,
  Glowstone = 18,
  Brick = 19,
  Glass = 20,
  Bookshelf = 21,
  CraftingTable = 22,
  MossyCobble = 23,
  MagmaBlock = 24,
  Bedrock = 25,
  Torch = 26,
  TallGrass = 27,
  WildflowerBush = 28,
  Campfire = 29,
  SakuraLeaves = 30,
  PineLog = 31,
  PineLeaves = 32,
  Cactus = 33,
  Lava = 34,
  Obsidian = 35,
  AetherCrystal = 36,
  GlowMushroom = 37,
  PowderKeg = 38,
  RuneStone = 39,
}

export type SoundCategory = 'grass' | 'stone' | 'wood' | 'sand' | 'glass' | 'water';
export type BlockRenderType = 'cube' | 'cross' | 'torch' | 'campfire';

export interface BlockDefinition {
  id: BlockId;
  name: string;
  solid: boolean;
  transparent: boolean;
  liquid: boolean;
  emissive: number;
  renderType: BlockRenderType;
  /** Atlas tile indices for [top, bottom, side] */
  textures: [number, number, number];
  particleColor: string;
  soundType: SoundCategory;
  placeable: boolean;
}

export const TileIndex = {
  GRASS_TOP: 0,
  GRASS_SIDE: 1,
  DIRT: 2,
  STONE: 3,
  COBBLESTONE: 4,
  SAND: 5,
  SANDSTONE_SIDE: 6,
  SANDSTONE_TOP: 7,
  WATER: 8,
  OAK_LOG_SIDE: 9,
  OAK_LOG_TOP: 10,
  OAK_PLANKS: 11,
  OAK_LEAVES: 12,
  BIRCH_LOG_SIDE: 13,
  BIRCH_LOG_TOP: 14,
  BIRCH_LEAVES: 15,
  SNOW_TOP: 16,
  SNOW_SIDE: 17,
  COAL_ORE: 18,
  GOLD_ORE: 19,
  DIAMOND_ORE: 20,
  GLOWSTONE: 21,
  BRICK: 22,
  GLASS: 23,
  BOOKSHELF_SIDE: 24,
  CRAFT_TOP: 25,
  CRAFT_SIDE: 26,
  MOSSY_COBBLE: 27,
  MAGMA: 28,
  BEDROCK: 29,
  TORCH: 30,
  TALL_GRASS: 31,
  WILDFLOWER_BUSH: 32,
  CAMPFIRE: 33,
  SAKURA_LEAVES: 34,
  PINE_LOG_SIDE: 35,
  PINE_LEAVES: 36,
  CACTUS_SIDE: 37,
  CACTUS_TOP: 38,
  LAVA: 39,
  OBSIDIAN: 40,
  AETHER_CRYSTAL: 41,
  GLOW_MUSHROOM: 42,
  POWDER_KEG_SIDE: 43,
  POWDER_KEG_TOP: 44,
  RUNE_STONE: 45,
} as const;

const def = (
  id: BlockId,
  name: string,
  textures: [number, number, number],
  particleColor: string,
  soundType: SoundCategory,
  opts: Partial<Pick<BlockDefinition, 'solid' | 'transparent' | 'liquid' | 'emissive' | 'placeable' | 'renderType'>> = {}
): BlockDefinition => ({
  id,
  name,
  textures,
  particleColor,
  soundType,
  solid: opts.solid ?? true,
  transparent: opts.transparent ?? false,
  liquid: opts.liquid ?? false,
  emissive: opts.emissive ?? 0,
  renderType: opts.renderType ?? 'cube',
  placeable: opts.placeable ?? true,
});

const T = TileIndex;

export const BLOCKS: Record<BlockId, BlockDefinition> = {
  [BlockId.Air]: def(BlockId.Air, 'Air', [0, 0, 0], '#ffffff', 'grass', { solid: false, transparent: true, placeable: false }),
  [BlockId.Grass]: def(BlockId.Grass, 'Lush Grass Block', [T.GRASS_TOP, T.DIRT, T.GRASS_SIDE], '#4d9e34', 'grass'),
  [BlockId.Dirt]: def(BlockId.Dirt, 'Rich Dirt', [T.DIRT, T.DIRT, T.DIRT], '#79553a', 'grass'),
  [BlockId.Stone]: def(BlockId.Stone, 'Mountain Stone', [T.STONE, T.STONE, T.STONE], '#7d8287', 'stone'),
  [BlockId.Cobblestone]: def(BlockId.Cobblestone, 'Cobblestone', [T.COBBLESTONE, T.COBBLESTONE, T.COBBLESTONE], '#696d72', 'stone'),
  [BlockId.Sand]: def(BlockId.Sand, 'Golden Sand', [T.SAND, T.SAND, T.SAND], '#dfd199', 'sand'),
  [BlockId.Sandstone]: def(BlockId.Sandstone, 'Carved Sandstone', [T.SANDSTONE_TOP, T.SANDSTONE_TOP, T.SANDSTONE_SIDE], '#d5c485', 'stone'),
  [BlockId.Water]: def(BlockId.Water, 'Crystal Water', [T.WATER, T.WATER, T.WATER], '#2589e8', 'water', { solid: false, transparent: true, liquid: true, emissive: 0.08 }),
  [BlockId.OakLog]: def(BlockId.OakLog, 'Oak Timber', [T.OAK_LOG_TOP, T.OAK_LOG_TOP, T.OAK_LOG_SIDE], '#6b5132', 'wood'),
  [BlockId.OakPlanks]: def(BlockId.OakPlanks, 'Oak Wood Planks', [T.OAK_PLANKS, T.OAK_PLANKS, T.OAK_PLANKS], '#a6824e', 'wood'),
  [BlockId.OakLeaves]: def(BlockId.OakLeaves, 'Oak Foliage', [T.OAK_LEAVES, T.OAK_LEAVES, T.OAK_LEAVES], '#4ea836', 'grass', { transparent: true }),
  [BlockId.BirchLog]: def(BlockId.BirchLog, 'Birch Timber', [T.BIRCH_LOG_TOP, T.BIRCH_LOG_TOP, T.BIRCH_LOG_SIDE], '#e8e4dc', 'wood'),
  [BlockId.BirchLeaves]: def(BlockId.BirchLeaves, 'Golden Birch Foliage', [T.BIRCH_LEAVES, T.BIRCH_LEAVES, T.BIRCH_LEAVES], '#7ec441', 'grass', { transparent: true }),
  [BlockId.SnowGrass]: def(BlockId.SnowGrass, 'Snowy Grass', [T.SNOW_TOP, T.DIRT, T.SNOW_SIDE], '#eef6fa', 'sand'),
  [BlockId.Snow]: def(BlockId.Snow, 'Alpine Snow Block', [T.SNOW_TOP, T.SNOW_TOP, T.SNOW_TOP], '#f5fbff', 'sand', { emissive: 0.05 }),
  [BlockId.CoalOre]: def(BlockId.CoalOre, 'Coal Ore', [T.COAL_ORE, T.COAL_ORE, T.COAL_ORE], '#373a40', 'stone'),
  [BlockId.GoldOre]: def(BlockId.GoldOre, 'Gold Ore', [T.GOLD_ORE, T.GOLD_ORE, T.GOLD_ORE], '#f5c542', 'stone', { emissive: 0.15 }),
  [BlockId.DiamondOre]: def(BlockId.DiamondOre, 'Radiant Diamond Ore', [T.DIAMOND_ORE, T.DIAMOND_ORE, T.DIAMOND_ORE], '#48e5f5', 'stone', { emissive: 0.35 }),
  [BlockId.Glowstone]: def(BlockId.Glowstone, 'Sunstone Lantern', [T.GLOWSTONE, T.GLOWSTONE, T.GLOWSTONE], '#ffdd6b', 'glass', { emissive: 0.95 }),
  [BlockId.Brick]: def(BlockId.Brick, 'Clay Masonry Brick', [T.BRICK, T.BRICK, T.BRICK], '#a84a3b', 'stone'),
  [BlockId.Glass]: def(BlockId.Glass, 'Crystal Glass', [T.GLASS, T.GLASS, T.GLASS], '#d4f4ff', 'glass', { transparent: true, emissive: 0.1 }),
  [BlockId.Bookshelf]: def(BlockId.Bookshelf, 'Scholar Bookshelf', [T.OAK_PLANKS, T.OAK_PLANKS, T.BOOKSHELF_SIDE], '#8d683b', 'wood'),
  [BlockId.CraftingTable]: def(BlockId.CraftingTable, 'Artisan Workbench', [T.CRAFT_TOP, T.OAK_PLANKS, T.CRAFT_SIDE], '#9c6e44', 'wood'),
  [BlockId.MossyCobble]: def(BlockId.MossyCobble, 'Mossy Ruin Stone', [T.MOSSY_COBBLE, T.MOSSY_COBBLE, T.MOSSY_COBBLE], '#587844', 'stone'),
  [BlockId.MagmaBlock]: def(BlockId.MagmaBlock, 'Volcanic Magma Block', [T.MAGMA, T.MAGMA, T.MAGMA], '#ff661a', 'stone', { emissive: 0.85 }),
  [BlockId.Bedrock]: def(BlockId.Bedrock, 'Deep Bedrock', [T.BEDROCK, T.BEDROCK, T.BEDROCK], '#26282e', 'stone', { placeable: false }),
  [BlockId.Torch]: def(BlockId.Torch, 'Flame Torch', [T.TORCH, T.TORCH, T.TORCH], '#ffaa33', 'wood', {
    solid: false,
    transparent: true,
    emissive: 1.0,
    renderType: 'torch',
  }),
  [BlockId.TallGrass]: def(BlockId.TallGrass, 'Meadow Tall Grass', [T.TALL_GRASS, T.TALL_GRASS, T.TALL_GRASS], '#68bd42', 'grass', {
    solid: false,
    transparent: true,
    renderType: 'cross',
  }),
  [BlockId.WildflowerBush]: def(BlockId.WildflowerBush, 'Wildflower Bush', [T.WILDFLOWER_BUSH, T.WILDFLOWER_BUSH, T.WILDFLOWER_BUSH], '#e8b938', 'grass', {
    solid: false,
    transparent: true,
    renderType: 'cross',
  }),
  [BlockId.Campfire]: def(BlockId.Campfire, 'Cozy Campfire', [T.CAMPFIRE, T.OAK_LOG_SIDE, T.CAMPFIRE], '#ff7722', 'wood', {
    solid: true,
    transparent: true,
    emissive: 1.0,
    renderType: 'campfire',
  }),
  [BlockId.SakuraLeaves]: def(BlockId.SakuraLeaves, 'Sakura Fey Blossom', [T.SAKURA_LEAVES, T.SAKURA_LEAVES, T.SAKURA_LEAVES], '#f472b6', 'grass', {
    transparent: true,
    emissive: 0.12,
  }),
  [BlockId.PineLog]: def(BlockId.PineLog, 'Silverpine Timber', [T.OAK_LOG_TOP, T.OAK_LOG_TOP, T.PINE_LOG_SIDE], '#4a3525', 'wood'),
  [BlockId.PineLeaves]: def(BlockId.PineLeaves, 'Frostpine Needles', [T.PINE_LEAVES, T.PINE_LEAVES, T.PINE_LEAVES], '#2d6a4f', 'grass', {
    transparent: true,
  }),
  [BlockId.Cactus]: def(BlockId.Cactus, 'Desert Saguaro Cactus', [T.CACTUS_TOP, T.CACTUS_TOP, T.CACTUS_SIDE], '#409142', 'grass'),
  [BlockId.Lava]: def(BlockId.Lava, 'Molten Dragon Lava', [T.LAVA, T.LAVA, T.LAVA], '#ff5500', 'water', {
    solid: false,
    transparent: true,
    liquid: true,
    emissive: 1.0,
  }),
  [BlockId.Obsidian]: def(BlockId.Obsidian, 'Void Obsidian', [T.OBSIDIAN, T.OBSIDIAN, T.OBSIDIAN], '#3b1d5e', 'stone'),
  [BlockId.AetherCrystal]: def(BlockId.AetherCrystal, 'Arcane Aether Crystal', [T.AETHER_CRYSTAL, T.AETHER_CRYSTAL, T.AETHER_CRYSTAL], '#a855f7', 'glass', {
    emissive: 0.95,
  }),
  [BlockId.GlowMushroom]: def(BlockId.GlowMushroom, 'Luminous Fey Shroom', [T.GLOW_MUSHROOM, T.GLOW_MUSHROOM, T.GLOW_MUSHROOM], '#2dd4bf', 'grass', {
    solid: false,
    transparent: true,
    emissive: 0.92,
    renderType: 'cross',
  }),
  [BlockId.PowderKeg]: def(BlockId.PowderKeg, "Alchemist's Powder Keg (TNT)", [T.POWDER_KEG_TOP, T.POWDER_KEG_TOP, T.POWDER_KEG_SIDE], '#ef4444', 'wood', {
    emissive: 0.25,
  }),
  [BlockId.RuneStone]: def(BlockId.RuneStone, 'Ancient Runestone', [T.STONE, T.STONE, T.RUNE_STONE], '#38bdf8', 'stone', {
    emissive: 0.78,
  }),
};

export const DEFAULT_HOTBAR: BlockId[] = [
  BlockId.Grass,
  BlockId.Cobblestone,
  BlockId.OakPlanks,
  BlockId.RuneStone,
  BlockId.Torch,
  BlockId.Campfire,
  BlockId.AetherCrystal,
  BlockId.PowderKeg,
  BlockId.Water,
];

export const PLACEABLE_BLOCKS: BlockDefinition[] = Object.values(BLOCKS).filter((b) => b.placeable);
