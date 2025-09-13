import { insavegame, type RevivableObjectArgs } from 'bmsx/serializer/serializationhooks';
import { computeAABB } from './collisionshape';
import { PhysicsBody } from './physicsbody';

export interface BroadphasePair { a: PhysicsBody; b: PhysicsBody; }

// Simple 1D sweep & prune along X (can extend to multi axis later)
@insavegame
export class BroadphaseSAP {
	private axis: { body: PhysicsBody; min: number; max: number; minY: number; maxY: number; minZ: number; maxZ: number }[] = [];
	private dirty = new Set<PhysicsBody>();
	yzPruneThreshold = 64; // enable extra axis pruning when many bodies

	constructor(_opts?: RevivableObjectArgs) {
	}

	addBody(b: PhysicsBody) {
		const aabb = computeAABB(b.shape, b.position);
		this.axis.push({ body: b, min: aabb.min.x, max: aabb.max.x, minY: aabb.min.y, maxY: aabb.max.y, minZ: aabb.min.z, maxZ: aabb.max.z });
		this.dirty.add(b);
	}

	removeBody(b: PhysicsBody) {
		const idx = this.axis.findIndex(e => e.body === b);
		if (idx >= 0) this.axis.splice(idx, 1);
		this.dirty.delete(b);
	}

	markDirty(b: PhysicsBody) { this.dirty.add(b); }

	// Re-sorts only dirty entries using localized insertion
	update() {
		if (!this.dirty.size) return;
		for (const entry of this.axis) {
			if (!this.dirty.has(entry.body)) continue;
			const aabb = computeAABB(entry.body.shape, entry.body.position);
			entry.min = aabb.min.x; entry.max = aabb.max.x;
			entry.minY = aabb.min.y; entry.maxY = aabb.max.y; entry.minZ = aabb.min.z; entry.maxZ = aabb.max.z;
			// localized insertion sort step for this entry
			let i = this.axis.indexOf(entry);
			// move left
			while (i > 0 && this.axis[i - 1].min > entry.min) {
				this.axis[i] = this.axis[i - 1];
				this.axis[i - 1] = entry; --i;
			}
			// move right
			while (i < this.axis.length - 1 && this.axis[i + 1].min < entry.min) {
				this.axis[i] = this.axis[i + 1];
				this.axis[i + 1] = entry; ++i;
			}
		}
		this.dirty.clear();
	}

	rebuild(bodies: PhysicsBody[]) { // Fallback full rebuild (used first frame)
		this.axis.length = 0;
		for (const b of bodies) this.addBody(b);
		this.update();
	}

	computePairs(out: BroadphasePair[]) {
		out.length = 0;
		const list = this.axis;
		const doYZ = list.length >= this.yzPruneThreshold;
		for (let i = 0; i < list.length; ++i) {
			const a = list[i];
			for (let j = i + 1; j < list.length; ++j) {
				const b = list[j];
				if (b.min > a.max) break; // early out
				if (doYZ) {
					if (a.maxY < b.minY || b.maxY < a.minY) continue;
					if (a.maxZ < b.minZ || b.maxZ < a.minZ) continue;
				}
				out.push({ a: a.body, b: b.body });
			}
		}
	}
}
