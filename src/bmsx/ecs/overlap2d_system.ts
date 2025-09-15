import { ECSystem, TickGroup } from './ecsystem';
import type { World } from 'bmsx/core/world';
import { EventEmitter } from 'bmsx/core/eventemitter';
import { Collider2DComponent } from 'bmsx/component/collisioncomponents';
import type { WorldObject } from 'bmsx/core/object/worldobject';
import { Collision2DSystem } from '../service/collision2d_service';

type PairKey = string;
function makePairKey(a: string, b: string): PairKey { return a < b ? `${a}|${b}` : `${b}|${a}`; }

/** Emits overlapBegin/overlapStay/overlapEnd events for ColliderComponents. */
export class Overlap2DSystem extends ECSystem {
  private prevPairs: Set<PairKey> = new Set();
  constructor(priority: number = 42) { super(TickGroup.PostPhysics, priority); }
  update(world: World): void {
	const newPairs: Set<PairKey> = new Set();

	// Collect colliders that want events across active objects (current + UI overlay)
	const eventColliders: Array<[WorldObject, Collider2DComponent]> = [];
	for (const o of world.activeObjects) {
	  const c = o.getFirstComponent(Collider2DComponent);
	  if (!c?.enabled) continue;
	  if (!c.generateOverlapEvents) continue;
	  eventColliders.push([o, c]);
	}
	if (eventColliders.length === 0) { this.prevPairs.clear(); return; }

	for (const [o, col] of eventColliders) {
	  const candidates = Collision2DSystem.queryAABB(world, col.worldArea);
	  for (const other of candidates) {
		if (other === o) continue;
		const otherCol = other.getFirstComponent(Collider2DComponent);
		if (!otherCol || !otherCol.enabled) continue;
		// Filter by layer/mask
		const aHitsB = (col.mask & otherCol.layer) !== 0;
		const bHitsA = (otherCol.mask & col.layer) !== 0;
		if (!aHitsB || !bHitsA) continue;
		// Filter by space scope
		const oSpace = world.getSpaceOfObject(o.id)?.id;
		const otherSpace = world.getSpaceOfObject(other.id)?.id;
		if (!this.spaceMatch(col.spaceEvents, oSpace ?? null, otherSpace ?? null, world)) continue;
		// Final narrow-phase test
		if (!Collision2DSystem.collides(o, other)) continue;
		const key = makePairKey(o.id, other.id);
		newPairs.add(key);
	  }
	}

	// Compute differences
	const begins: PairKey[] = [];
	const stays: PairKey[] = [];
	const ends: PairKey[] = [];
	for (const k of newPairs) { if (this.prevPairs.has(k)) stays.push(k); else begins.push(k); }
	for (const k of this.prevPairs) { if (!newPairs.has(k)) ends.push(k); }

	// Emit events
	const emitPair = (eventName: 'overlapBegin' | 'overlapStay' | 'overlapEnd', a: WorldObject, b: WorldObject) => {
	  const ac = a.getFirstComponent(Collider2DComponent);
	  const bc = b.getFirstComponent(Collider2DComponent);
	  if (ac?.generateOverlapEvents) EventEmitter.instance.emit(eventName, a, { otherId: b.id });
	  if (bc?.generateOverlapEvents) EventEmitter.instance.emit(eventName, b, { otherId: a.id });
	};
	const id2obj = (id: string): WorldObject | null => world.getWorldObject(id);

	for (const k of begins) {
	  const [aId, bId] = k.split('|');
	  const a = id2obj(aId); const b = id2obj(bId);
	  if (a && b) emitPair('overlapBegin', a, b);
	}
	for (const k of stays) {
	  const [aId, bId] = k.split('|');
	  const a = id2obj(aId); const b = id2obj(bId);
	  if (a && b) emitPair('overlapStay', a, b);
	}
	for (const k of ends) {
	  const [aId, bId] = k.split('|');
	  const a = id2obj(aId); const b = id2obj(bId);
	  if (a && b) emitPair('overlapEnd', a, b);
	}

	this.prevPairs = newPairs;
  }

  private spaceMatch(scope: 'current'|'ui'|'both'|'all', aSpace: string|null, bSpace: string|null, world: World): boolean {
	if (scope === 'all') return true;
	const uiId = 'ui';
	const current = world.activeSpaceId;
	switch (scope) {
	  case 'current': return (bSpace === aSpace) && (bSpace === current);
	  case 'ui': return (bSpace === uiId);
	  case 'both': return (bSpace === aSpace && (bSpace === current)) || (bSpace === uiId);
	}
	return true;
  }
}
