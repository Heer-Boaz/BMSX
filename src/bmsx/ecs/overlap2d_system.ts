import { ECSystem, TickGroup } from './ecsystem';
import type { World } from '../core/world';
import { EventEmitter } from '../core/eventemitter';
import { Collider2DComponent } from '../component/collisioncomponents';
import { $ } from '../core/game';
import { Collision2DSystem } from '../service/collision2d_service';

type OverlapEvent = 'overlapBegin' | 'overlapStay' | 'overlapEnd';
type Contact2D = { point?: { x: number; y: number }; normal?: { x: number; y: number }; depth?: number };

type PairKey = string;
function makePairKey(a: string, b: string): PairKey { return a < b ? `${a}|${b}` : `${b}|${a}`; }

/** Emits overlapBegin/overlapStay/overlapEnd events for ColliderComponents. */
export class Overlap2DSystem extends ECSystem {
	private prevPairs: Set<PairKey> = new Set();
	constructor(priority: number = 42) { super(TickGroup.Physics, priority); }
	update(world: World): void {
		const newPairs: Set<PairKey> = new Set();
		const colliderLookup = new Map<string, Collider2DComponent>();

		// Collect colliders that want events across active objects (current + UI overlay)
		const eventColliders: Collider2DComponent[] = [];
		for (const o of world.objects({ scope: 'active' })) {
			for (const c of o.getComponents(Collider2DComponent)) {
				if (!c.enabled) continue;
				colliderLookup.set(c.id, c);
				if (!c.generateOverlapEvents) continue;
				eventColliders.push(c);
			}
		}
		if (eventColliders.length === 0) { this.prevPairs.clear(); return; }

		for (const col of eventColliders) {
			const owner = col.parent;
			if (!owner) {
				throw new Error(`[Overlap2DSystem] Collider '${col.id}' is not attached to a parent.`);
			}
			const ownerSpace = world.getSpaceOfObject(owner.id);
			if (!ownerSpace) {
				throw new Error(`[Overlap2DSystem] Collider '${col.id}' with owner '${owner.id}' is not mapped to a space.`);
			}
			const oSpace = ownerSpace.id;
			const candidates = Collision2DSystem.queryAABB(world, col.worldArea);
			for (const otherCol of candidates) {
				if (otherCol === col) continue;
				const otherOwner = otherCol.parent;
				if (!otherOwner) {
					throw new Error(`[Overlap2DSystem] Collider '${otherCol.id}' returned without a parent.`);
				}
				colliderLookup.set(otherCol.id, otherCol);
				// Filter by layer/mask
				const aHitsB = (col.mask & otherCol.layer) !== 0;
				const bHitsA = (otherCol.mask & col.layer) !== 0;
				if (!aHitsB || !bHitsA) continue;
				// Filter by space scope
				const otherSpaceObj = world.getSpaceOfObject(otherOwner.id);
				if (!otherSpaceObj) {
					throw new Error(`[Overlap2DSystem] Collider '${otherCol.id}' with owner '${otherOwner.id}' is not mapped to a space.`);
				}
				const otherSpace = otherSpaceObj.id;
				if (!this.spaceMatch(col.spaceEvents, oSpace, otherSpace, world)) continue;
				if (otherCol.generateOverlapEvents && otherCol.id < col.id) continue;
				// Final narrow-phase test
				if (!Collision2DSystem.collides(col, otherCol)) continue;
				const key = makePairKey(col.id, otherCol.id);
				newPairs.add(key);
			}
		}

		// Compute differences
		const begins: PairKey[] = [];
		const stays: PairKey[] = [];
		const ends: PairKey[] = [];
		for (const k of newPairs) { if (this.prevPairs.has(k)) stays.push(k); else begins.push(k); }
		for (const k of this.prevPairs) { if (!newPairs.has(k)) ends.push(k); }

		// Emit events with basic contact info
		const emitPair = (eventName: OverlapEvent, colA: Collider2DComponent, colB: Collider2DComponent) => {
			const ownerA = colA.parent;
			const ownerB = colB.parent;
			if (!ownerA || !ownerB) {
				throw new Error('[Overlap2DSystem] Attempted to emit overlap event without collider parents.');
			}
			const emitA = colA.generateOverlapEvents;
			const emitB = colB.generateOverlapEvents;
			if (!emitA && !emitB) return;
			let contact: Contact2D | undefined;
			if (eventName !== 'overlapEnd') {
				const c = Collision2DSystem.getContact2D(colA, colB) as Contact2D | undefined;
				contact = c;
			}
			if (emitA) EventEmitter.instance.emit(eventName, ownerA, { otherId: ownerB.id, otherColliderId: colB.id, colliderId: colA.id, contact });
			if (emitB) {
				const flipped: Contact2D | undefined = contact?.normal ? { ...contact, normal: { x: -contact.normal.x, y: -contact.normal.y } } : contact;
				EventEmitter.instance.emit(eventName, ownerB, { otherId: ownerA.id, otherColliderId: colA.id, colliderId: colB.id, contact: flipped });
			}
		};
		const id2col = (id: string): Collider2DComponent => {
			const found = colliderLookup.get(id) ?? $.registry.get<Collider2DComponent>(id);
			if (!found) {
				throw new Error(`[Overlap2DSystem] Collider '${id}' could not be resolved.`);
			}
			return found;
		};

		for (const k of begins) {
			const [aId, bId] = k.split('|');
			const a = id2col(aId); const b = id2col(bId);
			emitPair('overlapBegin', a, b);
		}
		for (const k of stays) {
			const [aId, bId] = k.split('|');
			const a = id2col(aId); const b = id2col(bId);
			emitPair('overlapStay', a, b);
		}
		for (const k of ends) {
			const [aId, bId] = k.split('|');
			const a = id2col(aId); const b = id2col(bId);
			emitPair('overlapEnd', a, b);
		}

		this.prevPairs = newPairs;
	}

	private spaceMatch(scope: 'current' | 'ui' | 'both' | 'all', aSpace: string | null, bSpace: string | null, world: World): boolean {
		if (scope === 'all') return true;
		const uiId = 'ui';
		const current = world.activeSpaceId;
		switch (scope) {
			case 'current': return (bSpace === aSpace) && (bSpace === current);
			case 'ui': return (bSpace === uiId);
			case 'both': return (bSpace === aSpace && (bSpace === current)) || (bSpace === uiId);
			default:
				throw new Error(`[Overlap2DSystem] Unknown spaceEvents scope '${scope}'.`);
		}
	}
}
