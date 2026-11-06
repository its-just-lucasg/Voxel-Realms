import * as THREE from 'three';
import { BlockId, BLOCKS } from './blocks';

export interface RaycastHit {
  blockX: number;
  blockY: number;
  blockZ: number;
  normalX: number;
  normalY: number;
  normalZ: number;
  blockId: BlockId;
  distance: number;
}

/**
 * Fast Amanatides & Woo 3D DDA Voxel Raycaster
 */
export function raycastVoxel(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  maxDistance: number,
  getBlock: (x: number, y: number, z: number) => BlockId
): RaycastHit | null {
  const dir = direction.clone().normalize();

  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : dir.x < 0 ? -1 : 0;
  const stepY = dir.y > 0 ? 1 : dir.y < 0 ? -1 : 0;
  const stepZ = dir.z > 0 ? 1 : dir.z < 0 ? -1 : 0;

  const tDeltaX = stepX !== 0 ? Math.abs(1 / dir.x) : Infinity;
  const tDeltaY = stepY !== 0 ? Math.abs(1 / dir.y) : Infinity;
  const tDeltaZ = stepZ !== 0 ? Math.abs(1 / dir.z) : Infinity;

  let tMaxX = stepX > 0 ? (x + 1 - origin.x) * tDeltaX : stepX < 0 ? (origin.x - x) * tDeltaX : Infinity;
  let tMaxY = stepY > 0 ? (y + 1 - origin.y) * tDeltaY : stepY < 0 ? (origin.y - y) * tDeltaY : Infinity;
  let tMaxZ = stepZ > 0 ? (z + 1 - origin.z) * tDeltaZ : stepZ < 0 ? (origin.z - z) * tDeltaZ : Infinity;

  let normalX = 0;
  let normalY = 0;
  let normalZ = 0;
  let dist = 0;

  for (let i = 0; i < 128; i++) {
    const id = getBlock(x, y, z);
    if (id !== BlockId.Air && !BLOCKS[id].liquid) {
      return {
        blockX: x,
        blockY: y,
        blockZ: z,
        normalX,
        normalY,
        normalZ,
        blockId: id,
        distance: dist,
      };
    }

    if (tMaxX < tMaxY) {
      if (tMaxX < tMaxZ) {
        dist = tMaxX;
        if (dist > maxDistance) break;
        x += stepX;
        tMaxX += tDeltaX;
        normalX = -stepX;
        normalY = 0;
        normalZ = 0;
      } else {
        dist = tMaxZ;
        if (dist > maxDistance) break;
        z += stepZ;
        tMaxZ += tDeltaZ;
        normalX = 0;
        normalY = 0;
        normalZ = -stepZ;
      }
    } else {
      if (tMaxY < tMaxZ) {
        dist = tMaxY;
        if (dist > maxDistance) break;
        y += stepY;
        tMaxY += tDeltaY;
        normalX = 0;
        normalY = -stepY;
        normalZ = 0;
      } else {
        dist = tMaxZ;
        if (dist > maxDistance) break;
        z += stepZ;
        tMaxZ += tDeltaZ;
        normalX = 0;
        normalY = 0;
        normalZ = -stepZ;
      }
    }
  }

  return null;
}
