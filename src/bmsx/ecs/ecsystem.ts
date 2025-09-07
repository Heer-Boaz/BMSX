import { PositionUpdateAxisComponent, ScreenBoundaryComponent, TileCollisionComponent } from "../component/collisioncomponents";
import { TransformComponent } from "../component/transformcomponent";
import type { World } from "../core/world";
import { EventEmitter } from "../core/eventemitter";
import { $ } from "../core/game";
import type { WorldObject } from "../core/object/worldobject";
import { MeshObject } from "../core/object/mesh";
import { mod } from "../core/utils";
import { PhysicsComponent } from "../physics/physicscomponent";
import { CollisionEvent, PhysicsWorld } from "../physics/physicsworld";
import { excludeclassfromsavegame } from '../serializer/gameserializer';
import { TileSize } from "../systems/msx";
import { Identifiable } from "bmsx/rompack/rompack";
import { Stateful } from "bmsx";
import { Service } from '../core/service';
import { Registry } from '../core/registry';

export enum TickGroup {
	PrePhysics = 10,
	Simulation = 20,
	PostPhysics = 30,
	PreRender = 40,
}

@excludeclassfromsavegame
export abstract class ECSystem {
	/**
	 * Group determines coarse scheduling; priority determines order within the group.
	 */
	readonly group: TickGroup;
	readonly priority: number;
	constructor(group: TickGroup, priority: number = 0) { this.group = group; this.priority = priority; }
	abstract update(model: World): void;
}

@excludeclassfromsavegame
export class ECSystemManager {
	private _systems: ECSystem[] = [];

	register(sys: ECSystem): void {
		this._systems.push(sys);
		this._systems.sort((a, b) => (a.group - b.group) || (a.priority - b.priority));
	}

	unregister(sys: ECSystem): void {
		const i = this._systems.indexOf(sys);
		if (i >= 0) this._systems.splice(i, 1);
	}

	clear(): void { this._systems.length = 0; }

	/** Runs systems up to and including the given TickGroup. */
	updateUntil(model: World, maxGroup: TickGroup): void {
		for (const s of this._systems) {
			if (s.group <= maxGroup) s.update(model);
		}
	}

	/** Runs systems from and including the given TickGroup. */
	updateFrom(model: World, minGroup: TickGroup): void {
		for (const s of this._systems) {
			if (s.group >= minGroup) s.update(model);
		}
	}

	update(model: World): void {
		for (const s of this._systems) s.update(model);
	}
}

/** Pre-update: call preprocessingUpdate for components tagged with given tag. */
export class PreTagSystem extends ECSystem {
	constructor(private tag: string, priority: number) { super(TickGroup.PrePhysics, priority); }
	update(model: World): void {
		const objs = model.activeObjects;
		for (let i = 0; i < objs.length; ++i) {
			const o = objs[i] as WorldObject;
			const comps = o?.components ? Object.values(o.components) : [];
			for (let j = 0; j < comps.length; ++j) {
				const c = comps[j];
				if (c?.enabled && c.hasPreprocessingTag?.(this.tag)) c.preprocessingUpdate();
			}
		}
	}
}

function isBehaviorTreeObject(o: WorldObject): o is WorldObject & {
	btreecontexts: Record<string, unknown>;
	tickTree: (id: string) => void;
	disposeFlag?: boolean;
} {
	const r = o as unknown as Record<string, unknown>;
	return r.btreecontexts !== undefined && typeof r.btreecontexts === 'object' && typeof r.tickTree === 'function';
}

function hasStateController(o: Stateful): o is Stateful {
	return o.sc?.tick !== undefined;
}

// Additional guards and helper types to avoid `` elsewhere in this file
function isScreenBoundaryComponent(c: unknown): c is ScreenBoundaryComponent & { oldPos?: { x: number; y: number } } {
	if (!c) return false;
	if (c instanceof ScreenBoundaryComponent) return true;
	const r = c as Record<string, unknown>;
	return typeof r['oldPos'] === 'object' || 'oldPos' in r;
}

function isTileCollisionComponent(c: unknown): c is TileCollisionComponent & { oldPos?: { x: number; y: number } } {
	if (!c) return false;
	if (c instanceof TileCollisionComponent) return true;
	const r = c as Record<string, unknown>;
	return typeof r['oldPos'] === 'object' || 'oldPos' in r;
}

function isPhysicsComponent(c: unknown): c is PhysicsComponent & {
	body?: { position: { x: number; y: number; z: number }; rotationQ?: { x: number; y: number; z: number; w: number } };
	writeBack?: boolean;
	parentid?: string;
	syncAxis?: { x?: boolean; y?: boolean; z?: boolean };
	preprocessingUpdate?: () => void;
} {
	if (!c) return false;
	if (c instanceof PhysicsComponent) return true;
	const r = c as Record<string, unknown>;
	return 'body' in r || 'writeBack' in r || 'syncAxis' in r;
}

function hasModelDimensions(m: World): m is World & { gamewidth: number; gameheight: number } {
	const r = m as unknown as Record<string, unknown>;
	return typeof r['gamewidth'] === 'number' && typeof r['gameheight'] === 'number';
}

function hasCollidesWithTile(m: World): m is World & { collidesWithTile?: (o: WorldObject, d: string) => boolean } {
	const r = m as unknown as Record<string, unknown>;
	return typeof r['collidesWithTile'] === 'function';
}

function hasGetWorldObject(m: World): m is World & { getWorldObject?: (id: string) => WorldObject | undefined } {
	const r = m as unknown as Record<string, unknown>;
	return typeof r['getWorldObject'] === 'function';
}

function hasRotationQ(o: unknown): o is { rotationQ: { x: number; y: number; z: number; w: number } } {
	if (!o) return false;
	const r = o as Record<string, unknown>;
	const q = r['rotationQ'];
	return q !== undefined && typeof (q as Record<string, unknown>).x === 'number' && typeof (q as Record<string, unknown>).w === 'number';
}

function hasScale(o: unknown): o is { scale: [number, number, number] | number[] } {
	if (!o) return false;
	const r = o as Record<string, unknown>;
	const s = r['scale'];
	return Array.isArray(s) && s.length >= 3 && typeof s[0] === 'number';
}

function hasMarkDirty(o: unknown): o is { markDirty: () => void } {
	if (!o) return false;
	const r = o as Record<string, unknown>;
	return typeof r['markDirty'] === 'function';
}

/** Updates all BehaviorTrees attached to objects. */
export class BehaviorTreeSystem extends ECSystem {
	constructor(priority: number) { super(TickGroup.Simulation, priority); }
	update(model: World): void {
		const objs = model.activeObjects;
		for (let i = 0; i < objs.length; ++i) {
			const o = objs[i] as WorldObject;
			if (!isBehaviorTreeObject(o)) continue;
			if (o.active === false) continue;
			if (o.tickEnabled === false) continue;
			const bts = o.btreecontexts;
			if (!bts) continue;
			for (const id in bts) {
				if (!o.disposeFlag) o.tickTree(id);
			}
		}
	}
}

/** Ticks each object's primary state machine controller. */
export class StateMachineSystem extends ECSystem {
	constructor(priority: number) { super(TickGroup.Simulation, priority); }
	update(model: World): void {
        // Tick all world objects' state machines (gated)
        const objs = model.activeObjects;
        for (let i = 0; i < objs.length; ++i) {
            const o = objs[i] as WorldObject & { active?: boolean; tickEnabled?: boolean };
            if (!hasStateController(o)) continue;
            if (o.disposeFlag) continue;
            if (o.active === false) continue;
            if (o.tickEnabled === false) continue;
            const sc = o.sc;
            if (!sc.tickEnabled) continue;
            sc.tick();
        }
		// Tick all service's state machines
		for (const ent of Registry.instance.getRegisteredEntities()) {
			if (ent instanceof Service) {
				if (ent.active && ent.tickEnabled && ent.sc && ent.sc.tickEnabled) {
					ent.sc.tick();
				}
			}
		}
	}
}

/** Post-update: call postprocessingUpdate for components tagged with given tag. */
export class PostTagSystem extends ECSystem {
	constructor(private tag: string, priority: number) { super(TickGroup.PostPhysics, priority); }
	update(model: World): void {
		const objs = model.activeObjects;
		for (let i = 0; i < objs.length; ++i) {
			const o = objs[i] as WorldObject;
			const comps = o?.components ? Object.values(o.components) : [];
			for (let j = 0; j < comps.length; ++j) {
				const c = comps[j];
				if (c?.enabled && c.hasPostprocessingTag?.(this.tag)) c.postprocessingUpdate({ params: [] });
			}
		}
	}
}

/**
 * PrePositionSystem captures old positions for all PositionUpdateAxisComponent
 * instances at the start of the frame.
 */
export class PrePositionSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.PrePhysics, priority); }
	update(model: World): void {
		const objs = model.activeObjects;
		for (let i = 0; i < objs.length; ++i) {
			const o = objs[i] as WorldObject;
			const comps = o?.components ? Object.values(o.components) : [];
			for (let j = 0; j < comps.length; ++j) {
				const c = comps[j];
				if (c instanceof PositionUpdateAxisComponent) c.preprocessingUpdate();
			}
		}
	}
}

/**
 * BoundarySystem runs boundary checks in a single batch and invokes the
 * existing component logic (postprocessingUpdate) to keep behavior consistent.
 */
export class BoundarySystem extends ECSystem {
	private prev = new WeakMap<WorldObject, { x: number; y: number }>();
	constructor(priority: number = 0) { super(TickGroup.PostPhysics, priority); }
	update(model: World): void {
		const objs = model.activeObjects;
		const width = hasModelDimensions(model) ? model.gamewidth : 0;
		const height = hasModelDimensions(model) ? model.gameheight : 0;
		for (let i = 0; i < objs.length; ++i) {
			const o = objs[i] as WorldObject & { onLeavingScreen?: Function; onLeaveScreen?: Function };
			const compCandidate = o?.getComponent?.(ScreenBoundaryComponent);
			if (!isScreenBoundaryComponent(compCandidate) || !compCandidate.enabled) continue;
			const prev = this.prev.get(o) || { x: o.pos.x, y: o.pos.y };
			const oldx = prev.x;
			const oldy = prev.y;
			const newx = o.pos.x;
			const newy = o.pos.y;
			// X-axis
			if (newx < oldx) {
				if (newx + o.size.x < 0) {
					const payload = { d: 'left' as const, old_x_or_y: oldx };
					EventEmitter.instance.emit('leaveScreen', o, payload);
				} else if (newx < 0) {
					const payload = { d: 'left' as const, old_x_or_y: oldx };
					EventEmitter.instance.emit('leavingScreen', o, payload);
				}
			} else if (newx > oldx) {
				if (newx >= width) {
					const payload = { d: 'right' as const, old_x_or_y: oldx };
					EventEmitter.instance.emit('leaveScreen', o, payload);
				} else if (newx + o.size.x >= width) {
					const payload = { d: 'right' as const, old_x_or_y: oldx };
					EventEmitter.instance.emit('leavingScreen', o, payload);
				}
			}
			// Y-axis
			if (newy < oldy) {
				if (newy + o.size.y < 0) {
					const payload = { d: 'up' as const, old_x_or_y: oldy };
					EventEmitter.instance.emit('leaveScreen', o, payload);
				} else if (newy < 0) {
					const payload = { d: 'up' as const, old_x_or_y: oldy };
					EventEmitter.instance.emit('leavingScreen', o, payload);
				}
			} else if (newy > oldy) {
				if (newy >= height) {
					const payload = { d: 'down' as const, old_x_or_y: oldy };
					EventEmitter.instance.emit('leaveScreen', o, payload);
				} else if (newy + o.size.y >= height) {
					const payload = { d: 'down' as const, old_x_or_y: oldy };
					EventEmitter.instance.emit('leavingScreen', o, payload);
				}
			}
			this.prev.set(o, { x: newx, y: newy });
		}
	}
}

/**
 * TileCollisionSystem resolves tile collisions using the component logic.
 */
export class TileCollisionSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.PostPhysics, priority); }
	update(model: World): void {
		const objs = model.activeObjects;
		for (let i = 0; i < objs.length; ++i) {
			const o = objs[i] as WorldObject & { onWallcollide?: (d: 'left' | 'right' | 'up' | 'down') => void };
			const compCandidate = o?.getComponent?.(TileCollisionComponent);
			if (!isTileCollisionComponent(compCandidate)) continue;
			const comp = compCandidate;
			if (!comp || !comp.enabled) continue;
			const oldx = comp.oldPos?.x ?? o.pos.x;
			const oldy = comp.oldPos?.y ?? o.pos.y;
			let newx = o.pos.x;
			let newy = o.pos.y;
			// X axis movement
			if (newx < oldx) {
				if (hasCollidesWithTile($.world) && $.world.collidesWithTile?.(o, 'left')) {
					EventEmitter.instance.emit('wallcollide', o, { d: 'left' as const });
					newx += TileSize - mod(newx, TileSize);
				}
				o.pos.x = ~~newx;
			} else if (newx > oldx) {
				if (hasCollidesWithTile($.world) && $.world.collidesWithTile?.(o, 'right')) {
					EventEmitter.instance.emit('wallcollide', o, { d: 'right' as const });
					newx -= newx % TileSize;
				}
				o.pos.x = ~~newx;
			}
			// Y axis movement
			if (newy < oldy) {
				if ($.world.collidesWithTile?.(o, 'up')) {
					EventEmitter.instance.emit('wallcollide', o, { d: 'up' as const });
					newy += TileSize - mod(newy, TileSize);
				}
				o.pos.y = ~~newy;
			} else if (newy > oldy) {
				if ($.world.collidesWithTile?.(o, 'down')) {
					EventEmitter.instance.emit('wallcollide', o, { d: 'down' as const });
					newy -= newy % TileSize;
				}
				o.pos.y = ~~newy;
			}
		}
	}
}

/**
 * PhysicsPreSystem: builds bodies on demand and syncs WorldObject -> PhysicsBody when writeBack=false.
 */
export class PhysicsPreSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.PrePhysics, priority); }
	update(model: World): void {
		const objs = model.activeObjects;
		for (let i = 0; i < objs.length; ++i) {
			const o = objs[i] as WorldObject;
			const compCandidate = o?.getComponent?.(PhysicsComponent);
			if (!isPhysicsComponent(compCandidate) || !compCandidate.enabled) continue;
			const comp = compCandidate;
			// Inline tryBuildBody and GO->body sync (subset) via public API
			// Ensure body exists
			if (!comp.body) {
				// Calling private dangles isn’t possible; ensure by reusing public behavior: constructing PhysicsComponent already tries build;
				// here we assume it might have failed earlier due to timing; rely on preprocessingUpdate behavior
				// We mirror minimal behavior using available fields
				// Fallback: call preprocessingUpdate to ensure body
				comp.preprocessingUpdate?.();
			} else {
				// If not writing back, push GO -> body
				if (!comp.writeBack) {
					const wo = hasGetWorldObject(model) ? model.getWorldObject?.(o.id) : undefined;
					// However, comp.parentid points to Go id; prefer that
					const owner = hasGetWorldObject(model) ? model.getWorldObject?.(comp.parentid ?? '') || wo : wo;
					if (owner) {
						let changed = false;
						if (comp.syncAxis?.x && comp.body.position.x !== (owner.x)) { comp.body.position.x = owner.x; changed = true; }
						if (comp.syncAxis?.y && comp.body.position.y !== (owner.y)) { comp.body.position.y = owner.y; changed = true; }
						if (comp.syncAxis?.z && comp.body.position.z !== (owner.z)) { comp.body.position.z = owner.z; changed = true; }
						if (changed) {
							// Mark dirty via PhysicsWorld
							const ensureFn = (PhysicsWorld as unknown as { ensure?: () => PhysicsWorld }).ensure;
							const world = ensureFn ? ensureFn() : undefined;
							world?.markBodyDirty(comp.body);
						}
					}
				}
			}
		}
	}
}

/**
 * PhysicsSyncBeforeStepSystem: same as PhysicsPreSystem but scheduled in Simulation
 * after abilities so GO -> body sync includes ability impulses before the physics step.
 */
export class PhysicsSyncBeforeStepSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.Simulation, priority); }
	update(model: World): void {
		const objs = model.activeObjects;
		for (let i = 0; i < objs.length; ++i) {
			const o = objs[i] as WorldObject;
			const compCandidate = o?.getComponent?.(PhysicsComponent);
			if (!isPhysicsComponent(compCandidate) || !compCandidate.enabled) continue;
			const comp = compCandidate;
			if (!comp.body) {
				comp.preprocessingUpdate?.();
			} else {
				if (!comp.writeBack) {
					const wo = hasGetWorldObject(model) ? model.getWorldObject?.(o.id) : undefined;
					const owner = hasGetWorldObject(model) ? model.getWorldObject?.(comp.parentid ?? '') || wo : wo;
					if (owner) {
						let changed = false;
						if (comp.syncAxis?.x && comp.body.position.x !== (owner.x)) { comp.body.position.x = owner.x; changed = true; }
						if (comp.syncAxis?.y && comp.body.position.y !== (owner.y)) { comp.body.position.y = owner.y; changed = true; }
						if (comp.syncAxis?.z && comp.body.position.z !== (owner.z)) { comp.body.position.z = owner.z; changed = true; }
						if (changed) {
							PhysicsWorld.ensure().markBodyDirty(comp.body);
						}
					}
				}
			}
		}
	}
}

/** PhysicsPostSystem: sync PhysicsBody -> WorldObject when writeBack=true. */
export class PhysicsPostSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.PostPhysics, priority); }
	update(model: World): void {
		const objs = model.activeObjects;
		for (let i = 0; i < objs.length; ++i) {
			const o = objs[i] as WorldObject;
			const compCandidate = o?.getComponent?.(PhysicsComponent);
			if (!isPhysicsComponent(compCandidate) || !compCandidate.enabled || !compCandidate.body) continue;
			const comp = compCandidate;
			if (!comp.writeBack) continue;
			const wo = hasGetWorldObject(model) ? model.getWorldObject?.(comp.parentid ?? '') || o : o;
			if (!wo) continue;
			if (comp.syncAxis?.x) wo.x_nonotify = comp.body.position.x;
			if (comp.syncAxis?.y) wo.y_nonotify = comp.body.position.y;
			if (comp.syncAxis?.z) wo.z_nonotify = comp.body.position.z;
			if (hasRotationQ(wo) && comp.body.rotationQ) {
				wo.rotationQ.x = comp.body.rotationQ.x;
				wo.rotationQ.y = comp.body.rotationQ.y;
				wo.rotationQ.z = comp.body.rotationQ.z;
				wo.rotationQ.w = comp.body.rotationQ.w;
			}
		}
	}
}

// New: sync GO -> body after tile/boundary corrections (honor syncAxis)
export class PhysicsSyncAfterWorldCollisionSystem extends ECSystem {
	constructor(p = 0) { super(TickGroup.PostPhysics, p); }
	update(model: World) {
		for (const o of model.activeObjects as WorldObject[]) {
			const pc = o.getComponent(PhysicsComponent);
			if (!pc?.enabled || !pc.body) continue;
			// Only when body is authoritative (writeBack=true), mirror GO correction into the body
			if (pc.writeBack) {
				const b = pc.body, sa = pc.syncAxis;
				if (sa.x) b.position.x = o.pos.x;
				if (sa.y) b.position.y = o.pos.y;
				if (sa.z && o.pos.z !== undefined) b.position.z = o.pos.z;
				PhysicsWorld.ensure().markBodyDirty(b);
			}
		}
	}
}

/** PhysicsCollisionEventSystem: translate PhysicsWorld collision events to engine events. */
export class PhysicsCollisionEventSystem extends ECSystem {
    constructor(p = 28) { super(TickGroup.PostPhysics, p); }
    update(world: World): void {
        const events: CollisionEvent[] = world.drainPhysicsEvents() ?? [];
        if (!events || events.length === 0) return;
        for (const evt of events) {
            const goA = (evt.a.userData && typeof evt.a.userData === 'string') ? $.world.getWorldObject(evt.a.userData) : (evt.a.userData as unknown);
            const goB = (evt.b.userData && typeof evt.b.userData === 'string') ? $.world.getWorldObject(evt.b.userData) : (evt.b.userData as unknown);
            if (!goA && !goB) continue;
            const payload = { type: evt.type, otherId: (goB as Identifiable).id ?? null, point: evt.point, normal: evt.normal };
            if (goA) EventEmitter.instance.emit('physicsCollision', goA as WorldObject, payload);
            if (goB) EventEmitter.instance.emit('physicsCollision', goB as WorldObject, { ...payload, otherId: (goA as Identifiable).id ?? null });
            // Also emit typed events if listeners prefer name-specific subscriptions
            const name = 'physicsCollision_' + evt.type;
            if (goA) EventEmitter.instance.emit(name, goA as WorldObject, payload);
            if (goB) EventEmitter.instance.emit(name, goB as WorldObject, { ...payload, otherId: (goA as Identifiable)?.id ?? null });
        }
    }
}

/** TransformSystem: update TransformComponent from WorldObject state (position/orientation/scale). */
export class TransformSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.PostPhysics, priority); }
	update(model: World): void {
		const objs = model.activeObjects;
		for (let i = 0; i < objs.length; ++i) {
			const o = objs[i] as WorldObject;
			const tcCandidate = o?.getComponent?.(TransformComponent);
			const tc = tcCandidate as TransformComponent | undefined;
			if (!tc || !tc.enabled) continue;
			const parent = tc.parent;
			if (parent?.pos) {
				tc.position[0] = parent.pos.x;
				tc.position[1] = parent.pos.y;
				tc.position[2] = parent.pos.z;
			}
			if (hasRotationQ(parent)) tc["orientationQ"] = parent.rotationQ;
			if (hasScale(parent)) {
				tc.scale[0] = parent.scale[0];
				tc.scale[1] = parent.scale[1];
				tc.scale[2] = parent.scale[2];
			}
			if (hasMarkDirty(tc)) tc.markDirty();
		}
	}
}

/** MeshAnimationSystem: steps GLTF-based mesh animations without calling WorldObject.run(). */
export class MeshAnimationSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.Simulation, priority); }
	update(model: World): void {
		const objs = model.activeObjects;
		const dtSec = $.deltaTime / 1000;
		for (let i = 0; i < objs.length; ++i) {
			const o = objs[i] as MeshObject;
			if (!o || typeof o.animateStep !== 'function') continue;
			o.animateStep(dtSec);
		}
	}
}
