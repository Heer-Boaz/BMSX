import { ECSystem, TickGroup } from '../ecs/ecsystem';
import type { World } from '../core/world';
import type { WorldObject } from '../core/object/worldobject';
import { SpriteComponent } from '../component/sprite_component';
import { Collider2DComponent } from '../component/collisioncomponents';
import { $rompack } from '../core/game';
import type { Area, BoundingBoxPrecalc, HitPolygonsPrecalc } from '../rompack/rompack';

/**
 * Synchronizes ColliderComponent shapes from SpriteComponent metadata (imgid + flip).
 * Runs in PostPhysics by default to avoid interfering with physics builds in the same frame.
 */
export class SpriteColliderSyncSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.Physics, priority); }

	update(world: World): void {
		for (const [o, sprite] of world.objectsWithComponents(SpriteComponent, { scope: 'active' })) {
			const col = resolveColliderForSprite(o, sprite);
			if (!col) continue;
			const id = sprite.imgid;
			const flip_h = !!sprite.flip.flip_h;
			const flip_v = !!sprite.flip.flip_v;
			const token = `${id}|${flip_h ? 1 : 0}|${flip_v ? 1 : 0}`;
			if (col.syncToken === token) continue;
			if (id === 'none') {
				col.setLocalArea(null);
				col.setLocalPolygons(null);
				col.syncToken = token;
				continue;
			}

			const entry = $rompack.img[id];
			if (!entry) {
				throw new Error(`[SpriteColliderSyncSystem] Sprite asset '${id}' not found in rompack.`);
			}
			const imgmeta = entry['imgmeta'];
			if (!imgmeta) {
				throw new Error(`[SpriteColliderSyncSystem] Sprite asset '${id}' is missing metadata.`);
			}

			const box = imgmeta['boundingbox'] as BoundingBoxPrecalc | undefined;
			if (box) col.setLocalArea(selectBoundingBox(flip_h, flip_v, box));
			const polys = imgmeta['hitpolygons'] as HitPolygonsPrecalc | undefined;
			if (polys) col.setLocalPolygons(selectConcavePolygon(flip_h, flip_v, polys)); else col.setLocalPolygons(null);
			col.syncToken = token;
		}
	}
}

function resolveColliderForSprite(o: WorldObject, sprite: SpriteComponent): Collider2DComponent | undefined {
	const explicitLocalId = sprite.colliderLocalId;
	if (explicitLocalId === null) return undefined;
	if (explicitLocalId) {
		const bound = o.getComponentByLocalId(Collider2DComponent, explicitLocalId);
		if (bound) return bound;
		return undefined;
	}
	const primarySprite = o.getFirstComponent(SpriteComponent);
	if (sprite === primarySprite) {
		return o.getOrCreateCollider();
	}
	return undefined;
}

function selectBoundingBox(flip_h: boolean, flip_v: boolean, box: BoundingBoxPrecalc): Area {
	if (flip_h && flip_v) return box.fliphv;
	if (flip_h) return box.fliph;
	if (flip_v) return box.flipv;
	return box.original;
}

function selectConcavePolygon(flip_h: boolean, flip_v: boolean, polys: HitPolygonsPrecalc) {
	if (flip_h && flip_v) return polys.fliphv;
	if (flip_h) return polys.fliph;
	if (flip_v) return polys.flipv;
	return polys.original;
}
