import { PositionUpdateAxisComponent, ScreenBoundaryComponent, TileCollisionComponent } from "../component/collisioncomponents";
import { TransformComponent } from "../component/transformcomponent";
import type { World } from "../core/world";
import { EventEmitter } from "../core/eventemitter";
import { $ } from "../core/game";
import type { WorldObject } from "../core/object/worldobject";
import { MeshObject } from "../core/object/mesh";
import { mod } from "../utils/utils";
import { PhysicsComponent } from "../physics/physicscomponent";
import { CollisionEvent, PhysicsWorld } from "../physics/physicsworld";
import { excludeclassfromsavegame } from '../serializer/gameserializer';
import { TileSize } from "../systems/msx";
import { Identifiable } from "bmsx/rompack/rompack";
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
	public __ecsId: string;
	constructor(group: TickGroup, priority: number = 0) { this.group = group; this.priority = priority; }
	abstract update(model: World): void;
}

@excludeclassfromsavegame
export class ECSystemManager {
    private _systems: ECSystem[] = [];
    // Per-frame timing stats captured during updateUntil/updateFrom
    private _stats: { id: string; name: string; group: TickGroup; priority: number; ms: number }[] = [];

    register(sys: ECSystem): void {
        this._systems.push(sys);
        this._systems.sort((a, b) => (a.group - b.group) || (a.priority - b.priority));
    }

	unregister(sys: ECSystem): void {
		const i = this._systems.indexOf(sys);
		if (i >= 0) this._systems.splice(i, 1);
	}

    clear(): void { this._systems.length = 0; }

    /** Reset per-frame stats. Call at the start of a world frame. */
    beginFrame(): void { this._stats.length = 0; }

    /** Return last captured per-system timing stats in update order. */
    getStats(): ReadonlyArray<{ id: string; name: string; group: TickGroup; priority: number; ms: number }> { return this._stats; }

    /** Runs systems up to and including the given TickGroup. */
    updateUntil(model: World, maxGroup: TickGroup): void {
        for (const s of this._systems) {
            if (s.group <= maxGroup) {
                const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                s.update(model);
                const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const id = s.__ecsId ?? s.constructor.name;
                this._stats.push({ id, name: s.constructor.name, group: s.group, priority: s.priority, ms: (t1 - t0) });
            }
        }
    }

    /** Runs systems from and including the given TickGroup. */
    updateFrom(model: World, minGroup: TickGroup): void {
        for (const s of this._systems) {
            if (s.group >= minGroup) {
                const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                s.update(model);
                const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const anyS = s;
                const id = anyS.__ecsId ?? s.constructor.name;
                this._stats.push({ id, name: s.constructor.name, group: s.group, priority: s.priority, ms: (t1 - t0) });
            }
        }
    }

    update(model: World): void {
        for (const s of this._systems) {
            const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            s.update(model);
            const t1 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const anyS = s;
            const id = anyS.__ecsId ?? s.constructor.name;
            this._stats.push({ id, name: s.constructor.name, group: s.group, priority: s.priority, ms: (t1 - t0) });
        }
    }
}

/** Pre-update: call preprocessingUpdate for components tagged with given tag. */
export class PreTagSystem extends ECSystem {
	constructor(private tag: string, priority: number) { super(TickGroup.PrePhysics, priority); }
	update(world: World): void {
		for (let o of world.objects({ scope: 'current'}) ) {
			for (let c of o.iterateComponents()) {
				if (c.enabled && c.hasPreprocessingTag(this.tag)) c.preprocessingUpdate();
			}
		}
	}
}

/** Post-update: call postprocessingUpdate for components tagged with given tag. */
export class PostTagSystem extends ECSystem {
	constructor(private tag: string, priority: number) { super(TickGroup.PostPhysics, priority); }
	update(world: World): void {
		for (let o of world.objects({ scope: 'current' })) {
			for (let c of o.iterateComponents()) {
				if (c.enabled && c.hasPostprocessingTag(this.tag)) c.postprocessingUpdate({ params: [] });
			}
		}
	}
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
	update(world: World): void {
		for (let o of world.objects({ scope: 'current'})) {
			if (o.active === false) continue;
			if (o.tickEnabled === false) continue;
			const bts = o.btreecontexts;
			if (!bts) continue;
			for (const id in bts) {
				o.tickTree(id);
			}
		}
	}
}

/** Ticks each object's primary state machine controller. */
export class StateMachineSystem extends ECSystem {
	constructor(priority: number) { super(TickGroup.Simulation, priority); }
	update(world: World): void {
		// Tick all world objects' state machines (gated)
		for (let o of world.objects({ scope: 'current' })) {
			if (o.active === false) continue;
			if (o.tickEnabled === false) continue;
			const sc = o.sc;
			if (!sc.tickEnabled) continue;
			sc.tick();
		}

		// Tick all service's state machines
		for (const ent of Registry.instance.getRegisteredEntities()) {
			if (ent instanceof Service) {
				if (ent.active && ent.tickEnabled) {
					ent.sc.tick();
				}
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
	update(world: World): void {
		const objs = world.objectsWithComponents(PositionUpdateAxisComponent, { scope: 'current' });
		// Preprocess all PositionUpdateAxisComponents
		for (const [_o, c] of objs) c.enabled && c.preprocessingUpdate();
	}
}

/**
 * BoundarySystem runs boundary checks in a single batch and invokes the
 * existing component logic (postprocessingUpdate) to keep behavior consistent.
 */
export class BoundarySystem extends ECSystem {
	private prev = new WeakMap<WorldObject, { x: number; y: number }>();
	constructor(priority: number = 0) { super(TickGroup.PostPhysics, priority); }
	update(world: World): void {
		const width = world.gamewidth;
		const height = world.gameheight;
		for (let [o, c] of world.objectsWithComponents(ScreenBoundaryComponent, { scope: 'current' })) {
			if (!c.enabled) continue;
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
	update(world: World): void {
		for (let [o, c] of world.objectsWithComponents(TileCollisionComponent, { scope: 'current' })) {
			if (!c.enabled) continue;
			const oldx = c.oldPos?.x ?? o.pos.x;
			const oldy = c.oldPos?.y ?? o.pos.y;
			let newx = o.pos.x;
			let newy = o.pos.y;
			// X axis movement
			if (newx < oldx) {
				if ($.world.collidesWithTile?.(o, 'left')) {
					EventEmitter.instance.emit('wallcollide', o, { d: 'left' as const });
					newx += TileSize - mod(newx, TileSize);
				}
				o.pos.x = ~~newx;
			} else if (newx > oldx) {
				if ($.world.collidesWithTile?.(o, 'right')) {
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
	update(world: World): void {
		for (let [o, c] of world.objectsWithComponents(PhysicsComponent, { scope: 'current' })) {
			if (!c.enabled) continue;
			// Inline tryBuildBody and WO->body sync (subset) via public API
			// Ensure body exists
			if (!c.body) {
				// Calling private dangles isn’t possible; ensure by reusing public behavior: constructing PhysicsComponent already tries build;
				// here we assume it might have failed earlier due to timing; rely on preprocessingUpdate behavior
				// We mirror minimal behavior using available fields
				// Fallback: call preprocessingUpdate to ensure body
				c.preprocessingUpdate?.();
			} else {
				// If not writing back, push WO -> body
				if (!c.writeBack) {
					// However, c.parentid points to WO id; prefer that
					const owner = c.parentid ? world.getWorldObject(c.parentid) : o;
					if (!owner) continue;
					let changed = false;
					if (c.syncAxis?.x && c.body.position.x !== (owner.x)) { c.body.position.x = owner.x; changed = true; }
					if (c.syncAxis?.y && c.body.position.y !== (owner.y)) { c.body.position.y = owner.y; changed = true; }
					if (c.syncAxis?.z && c.body.position.z !== (owner.z)) { c.body.position.z = owner.z; changed = true; }
					if (changed) {
						// Mark dirty via PhysicsWorld
						PhysicsWorld.ensure().markBodyDirty(c.body);
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
	update(world: World): void {
		for (let [o, c] of world.objectsWithComponents(PhysicsComponent, { scope: 'current' })) {
			if (!c.enabled) continue;
			if (!c.body) {
				c.preprocessingUpdate?.();
			} else {
				if (c.writeBack) continue;
				let changed = false;
				if (c.syncAxis?.x && c.body.position.x !== (o.x)) { c.body.position.x = o.x; changed = true; }
				if (c.syncAxis?.y && c.body.position.y !== (o.y)) { c.body.position.y = o.y; changed = true; }
				if (c.syncAxis?.z && c.body.position.z !== (o.z)) { c.body.position.z = o.z; changed = true; }
				if (changed) {
					PhysicsWorld.ensure().markBodyDirty(c.body);
				}
			}
		}
	}
}

/** PhysicsPostSystem: sync PhysicsBody -> WorldObject when writeBack=true. */
export class PhysicsPostSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.PostPhysics, priority); }
	update(world: World): void {
		for (let [o, c] of world.objectsWithComponents(PhysicsComponent, { scope: 'current' })) {
			if (!c.enabled) continue;
			if (!c.writeBack) continue;
			if (c.syncAxis?.x) o.x_nonotify = c.body.position.x;
			if (c.syncAxis?.y) o.y_nonotify = c.body.position.y;
			if (c.syncAxis?.z) o.z_nonotify = c.body.position.z;
			if (hasRotationQ(o) && c.body.rotationQ) {
				o.rotationQ.x = c.body.rotationQ.x;
				o.rotationQ.y = c.body.rotationQ.y;
				o.rotationQ.z = c.body.rotationQ.z;
				o.rotationQ.w = c.body.rotationQ.w;
			}
		}
	}
}

// New: sync GO -> body after tile/boundary corrections (honor syncAxis)
export class PhysicsSyncAfterWorldCollisionSystem extends ECSystem {
	constructor(p = 0) { super(TickGroup.PostPhysics, p); }
	update(world: World) {
		for (let [o, c] of world.objectsWithComponents(PhysicsComponent, { scope: 'current' })) {
			if (!c?.enabled || !c.body) continue;
			// Only when body is authoritative (writeBack=true), mirror GO correction into the body
			if (c.writeBack) {
				const b = c.body, sa = c.syncAxis;
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
			const goA = (evt.a.userData && typeof evt.a.userData === 'string') ? $.world.getWorldObject(evt.a.userData) : (evt.a.userData);
			const goB = (evt.b.userData && typeof evt.b.userData === 'string') ? $.world.getWorldObject(evt.b.userData) : (evt.b.userData);
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
	update(world: World): void {
		for (let [o, c] of world.objectsWithComponents(TransformComponent, { scope: 'current' })) {
			if (!c || !c.enabled) continue;
			if (o?.pos) {
				c.position[0] = o.pos.x;
				c.position[1] = o.pos.y;
				c.position[2] = o.pos.z;
			}
			if (hasRotationQ(o)) c["orientationQ"] = o.rotationQ;
			if (hasScale(o)) {
				c.scale[0] = o.scale[0];
				c.scale[1] = o.scale[1];
				c.scale[2] = o.scale[2];
			}
			if (hasMarkDirty(c)) c.markDirty();
		}
	}
}

/** MeshAnimationSystem: steps GLTF-based mesh animations without calling WorldObject.run(). */
export class MeshAnimationSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.Simulation, priority); }
	update(world: World): void {
		const dtSec = $.deltaTime / 1000;
		for (let o of world.objectsOfType(MeshObject, { scope: 'current' })) {
			o.animateStep(dtSec);
		}
	}
}
