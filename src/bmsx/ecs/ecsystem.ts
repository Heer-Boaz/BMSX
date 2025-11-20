import { PositionUpdateAxisComponent, ScreenBoundaryComponent, TileCollisionComponent } from "../component/collisioncomponents";
import { TransformComponent } from "../component/transformcomponent";
import type { World } from "../core/world";
import { $ } from "../core/game";
import type { WorldObject } from "../core/object/worldobject";
import { MeshComponent } from "../component/mesh_component";
import { mod } from '../utils/mod';
import { PhysicsComponent } from "../physics/physicscomponent";
import { CollisionEvent, PhysicsWorld } from "../physics/physicsworld";
import { excludeclassfromsavegame } from '../serializer/serializationhooks';
import { TileSize } from "../systems/msx";
import { Identifiable, type Oriented, type Scaled } from "../rompack/rompack";
import { Service } from '../core/service';
import { Registry } from '../core/registry';

export enum TickGroup {
	Input = 10,
	ActionEffect = 20,
	ModeResolution = 30,
	Physics = 40,
	Animation = 50,
	Presentation = 60,
	EventFlush = 70,
}

@excludeclassfromsavegame
export abstract class ECSystem {
	/**
	 * Group determines coarse scheduling; priority determines order within the group.
	 */
	readonly group: TickGroup;
	readonly priority: number;
	public __ecsId: string; // Optional identifier for debugging/stats (defaults to class name)
	public runsWhileGamePaused = false;
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
				const t0 = $.platform.clock.now();
				s.update(model);
				const t1 = $.platform.clock.now();
				const id = s.__ecsId ?? s.constructor.name;
				this._stats.push({ id, name: s.constructor.name, group: s.group, priority: s.priority, ms: (t1 - t0) });
			}
		}
	}

	/** Runs systems from and including the given TickGroup. */
	updateFrom(model: World, minGroup: TickGroup): void {
		for (const s of this._systems) {
			if (s.group >= minGroup) {
				const t0 = $.platform.clock.now();
				s.update(model);
				const t1 = $.platform.clock.now();
				const anyS = s;
				const id = anyS.__ecsId ?? s.constructor.name;
				this._stats.push({ id, name: s.constructor.name, group: s.group, priority: s.priority, ms: (t1 - t0) });
			}
		}
	}

	/** Runs systems that belong to the exact TickGroup (single phase). */
	updatePhase(model: World, group: TickGroup): void {
		// if ($.debug) {
		// 	const systems = this._systems.filter(s => s.group === group).map(s => s.__ecsId ?? s.constructor.name);
		// 	console.log('[ECS][phase:start]', { group, systems });
		// }
		for (const s of this._systems) {
			if (s.group === group) {
				const t0 = $.platform.clock.now();
				s.update(model);
				const t1 = $.platform.clock.now();
				const id = s.__ecsId ?? s.constructor.name;
				this._stats.push({ id, name: s.constructor.name, group: s.group, priority: s.priority, ms: (t1 - t0) });
				// if ($.debug) {
				// 	console.log('[ECS][phase:system]', { group, system: id, ms: (t1 - t0) });
				// }
			}
		}
		// if ($.debug) {
		// 	console.log('[ECS][phase:end]', { group });
		// }
	}

	/** Runs only systems explicitly flagged to run while the game is paused. */
	runPaused(model: World): void {
		this.beginFrame();
		for (const s of this._systems) {
			if (!s.runsWhileGamePaused) continue;
			const t0 = $.platform.clock.now();
			s.update(model);
			const t1 = $.platform.clock.now();
			const id = s.__ecsId ?? s.constructor.name;
			this._stats.push({ id, name: s.constructor.name, group: s.group, priority: s.priority, ms: (t1 - t0) });
		}
	}
}

/** Pre-update: call preprocessingUpdate for components tagged with given tag. */
export class PreTagSystem extends ECSystem {
	constructor(private tag: string, priority: number) { super(TickGroup.Input, priority); }
	update(world: World): void {
		for (let o of world.objects({ scope: 'active' })) {
			for (let c of o.iterate_components()) {
				if (!c.enabled || !c.hasPreprocessingTag(this.tag)) continue;
				c.preprocessingUpdate();
			}
		}
	}
}

/** Post-update: call postprocessingUpdate for components tagged with given tag. */
export class PostTagSystem extends ECSystem {
	constructor(private tag: string, priority: number) { super(TickGroup.Physics, priority); }
	update(world: World): void {
		for (let o of world.objects({ scope: 'active' })) {
			for (let c of o.iterate_components()) {
				if (!c.enabled || !c.hasPostprocessingTag(this.tag)) continue;
				c.postprocessingUpdate({ params: [] });
			}
		}
	}
}

/** Updates all BehaviorTrees attached to objects. */
export class BehaviorTreeSystem extends ECSystem {
	constructor(priority: number) { super(TickGroup.Input, priority); }
	update(world: World): void {
		for (let o of world.objects({ scope: 'active' })) {
			if (o.active === false) continue;
			if (o.tick_enabled === false) continue;
			const bts = o.btreecontexts;
			if (!bts) continue;
			for (const id in bts) {
				o.tick_tree(id);
			}
		}
	}
}

/** Ticks each object's primary state machine controller. */
export class StateMachineSystem extends ECSystem {
	constructor(priority: number) { super(TickGroup.ModeResolution, priority); }
	update(world: World): void {
		// Tick all world objects' state machines (gated)
		for (let o of world.objects({ scope: 'active' })) {
			if (o.active === false) continue;
			if (o.tick_enabled === false) continue;
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
	constructor(priority: number = 0) { super(TickGroup.Physics, priority); }
	update(world: World): void {
		const objs = world.objects_with_components(PositionUpdateAxisComponent, { scope: 'active' });
		// Preprocess all PositionUpdateAxisComponents
		for (const [, c] of objs) {
			if (!c.enabled) continue;
			c.preprocessingUpdate();
		}
	}
}

/**
 * BoundarySystem runs boundary checks in a single batch and invokes the
 * existing component logic (postprocessingUpdate) to keep behavior consistent.
 */
export class BoundarySystem extends ECSystem {
	private prev = new WeakMap<WorldObject, { x: number; y: number }>();
	constructor(priority: number = 0) { super(TickGroup.Physics, priority); }
	update(world: World): void {
		const width = world.gamewidth;
		const height = world.gameheight;
		for (let [o, c] of world.objects_with_components(ScreenBoundaryComponent, { scope: 'active' })) {
			if (!c.enabled) continue;
			const prev = this.prev.get(o) || { x: o.x, y: o.y };
			const oldx = prev.x;
			const oldy = prev.y;
			const newx = o.x;
			const newy = o.y;
			// X-axis
			if (newx < oldx) {
				if (newx + o.size.x < 0) {
					const payload = { d: 'left' as const, old_x_or_y: oldx };
					o.events.emit('screen.leave', payload);
				} else if (newx < 0) {
					const payload = { d: 'left' as const, old_x_or_y: oldx };
					o.events.emit('screen.leaving', payload);
				}
			} else if (newx > oldx) {
				if (newx >= width) {
					const payload = { d: 'right' as const, old_x_or_y: oldx };
					o.events.emit('screen.leave', payload);
				} else if (newx + o.size.x >= width) {
					const payload = { d: 'right' as const, old_x_or_y: oldx };
					o.events.emit('screen.leaving', payload);
				}
			}
			// Y-axis
			if (newy < oldy) {
				if (newy + o.size.y < 0) {
					const payload = { d: 'up' as const, old_x_or_y: oldy };
					o.events.emit('screen.leave', payload);
				} else if (newy < 0) {
					const payload = { d: 'up' as const, old_x_or_y: oldy };
					o.events.emit('screen.leaving', payload);
				}
			} else if (newy > oldy) {
				if (newy >= height) {
					const payload = { d: 'down' as const, old_x_or_y: oldy };
					o.events.emit('screen.leave', payload);
				} else if (newy + o.size.y >= height) {
					const payload = { d: 'down' as const, old_x_or_y: oldy };
					o.events.emit('screen.leaving', payload);
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
	constructor(priority: number = 0) { super(TickGroup.Physics, priority); }
	update(world: World): void {
		for (let [o, c] of world.objects_with_components(TileCollisionComponent, { scope: 'active' })) {
			if (!c.enabled) continue;
			const oldx = c.oldPos?.x ?? o.x;
			const oldy = c.oldPos?.y ?? o.y;
			let newx = o.x;
			let newy = o.y;
			// X axis movement
			if (newx < oldx) {
				if ($.world.collidesWithTile(o, 'left')) {
					o.events.emit('wallcollide', { d: 'left' as const });
					newx += TileSize - mod(newx, TileSize);
				}
				o.x = ~~newx;
			} else if (newx > oldx) {
				if ($.world.collidesWithTile(o, 'right')) {
					o.events.emit('wallcollide', { d: 'right' as const });
					newx -= newx % TileSize;
				}
				o.x = ~~newx;
			}
			// Y axis movement
			if (newy < oldy) {
				if ($.world.collidesWithTile(o, 'up')) {
					o.events.emit('wallcollide', { d: 'up' as const });
					newy += TileSize - mod(newy, TileSize);
				}
				o.y = ~~newy;
			} else if (newy > oldy) {
				if ($.world.collidesWithTile(o, 'down')) {
					o.events.emit('wallcollide', { d: 'down' as const });
					newy -= newy % TileSize;
				}
				o.y = ~~newy;
			}
		}
	}
}

/**
 * PhysicsPreSystem: builds bodies on demand and syncs WorldObject -> PhysicsBody when writeBack=false.
 */
export class PhysicsPreSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.Physics, priority); }
	update(world: World): void {
		for (let [, c] of world.objects_with_components(PhysicsComponent, { scope: 'active' })) {
			if (!c.enabled) continue;
			// Inline tryBuildBody and WO->body sync (subset) via public API
			// Ensure body exists
			if (!c.body) {
				// Calling private dangles isn’t possible; ensure by reusing public behavior: constructing PhysicsComponent already tries build;
				// here we assume it might have failed earlier due to timing; rely on preprocessingUpdate behavior
				// We mirror minimal behavior using available fields
				// Fallback: call preprocessingUpdate to ensure body
				c.preprocessingUpdate();
			} else {
				// If not writing back, push WO -> body
				if (!c.writeback) {
					const owner = c.parent;
					let changed = false;
					if (c.syncAxis.x && c.body.position.x !== owner.x) { c.body.position.x = owner.x; changed = true; }
					if (c.syncAxis.y && c.body.position.y !== owner.y) { c.body.position.y = owner.y; changed = true; }
					if (c.syncAxis.z && c.body.position.z !== owner.z) { c.body.position.z = owner.z; changed = true; }
					if (changed) {
						PhysicsWorld.ensure().markBodyDirty(c.body);
					}
				}
			}
		}
	}
}

/**
 * PhysicsSyncBeforeStepSystem: same as PhysicsPreSystem but scheduled in Simulation
 * after action effects so GO -> body sync includes effect impulses before the physics step.
 */
export class PhysicsSyncBeforeStepSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.Physics, priority); }
	update(world: World): void {
		for (let [o, c] of world.objects_with_components(PhysicsComponent, { scope: 'active' })) {
			if (!c.enabled) continue;
			if (!c.body) {
				c.preprocessingUpdate();
			} else {
				if (c.writeback) continue;
				let changed = false;
				if (c.syncAxis.x && c.body.position.x !== o.x) { c.body.position.x = o.x; changed = true; }
				if (c.syncAxis.y && c.body.position.y !== o.y) { c.body.position.y = o.y; changed = true; }
				if (c.syncAxis.z && c.body.position.z !== o.z) { c.body.position.z = o.z; changed = true; }
				if (changed) {
					PhysicsWorld.ensure().markBodyDirty(c.body);
				}
			}
		}
	}
}

export class PhysicsWorldStepSystem extends ECSystem {
	constructor(priority: number = 20) { super(TickGroup.Physics, priority); }
	update(world: World): void {
		world.stepPhysics($.deltatime);
	}
}

/** PhysicsPostSystem: sync PhysicsBody -> WorldObject when writeBack=true. */
export class PhysicsPostSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.Physics, priority); }
	update(world: World): void {
		for (let [o, c] of world.objects_with_components(PhysicsComponent, { scope: 'active' }) as Iterable<[WorldObject & Oriented, PhysicsComponent]>) {
			if (!c.enabled) continue;
			if (!c.writeback) continue;
			if (!c.body) {
				throw new Error(`[PhysicsPostSystem] Physics component '${c.id}' is missing its body while writeBack=true.`);
			}
			if (c.syncAxis.x) o.x_nonotify = c.body.position.x;
			if (c.syncAxis.y) o.y_nonotify = c.body.position.y;
			if (c.syncAxis.z) o.z_nonotify = c.body.position.z;
			if (c.body.rotationQ) {
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
	constructor(p = 0) { super(TickGroup.Physics, p); }
	update(world: World) {
		for (let [o, c] of world.objects_with_components(PhysicsComponent, { scope: 'active' })) {
			if (!c.enabled) continue;
			if (!c.body) {
				throw new Error(`[PhysicsSyncAfterWorldCollisionSystem] Physics component '${c.id}' is missing its body.`);
			}
			// Only when body is authoritative (writeBack=true), mirror GO correction into the body
			if (c.writeback) {
				const b = c.body;
				const sa = c.syncAxis;
				if (sa.x) b.position.x = o.x;
				if (sa.y) b.position.y = o.y;
				if (sa.z) b.position.z = o.z;
				PhysicsWorld.ensure().markBodyDirty(b);
			}
		}
	}
}

/** PhysicsCollisionEventSystem: translate PhysicsWorld collision events to engine events. */
export class PhysicsCollisionEventSystem extends ECSystem {
	constructor(p = 28) { super(TickGroup.Physics, p); }
	update(world: World): void {
		const events: CollisionEvent[] = world.drainPhysicsEvents() ?? [];
		if (!events || events.length === 0) return;
		for (const evt of events) {
			const goA = resolveCollisionObject(evt.a.userData, 'A', world);
			const goB = resolveCollisionObject(evt.b.userData, 'B', world);
			const goAId = (goA as Identifiable).id;
			const goBId = (goB as Identifiable).id;
			if (goAId == null || goBId == null) {
				throw new Error('[PhysicsCollisionEventSystem] Collision participants must be identifiable.');
			}
			const payloadToB = { type: evt.type, other_id: goBId, point: evt.point, normal: evt.normal };
			(goA as WorldObject).events.emit('physicsCollision', payloadToB);
			const payloadToA = { type: evt.type, other_id: goAId, point: evt.point, normal: evt.normal };
			(goB as WorldObject).events.emit('physicsCollision', payloadToA);
			// Also emit typed events if listeners prefer name-specific subscriptions
			const name = 'physicsCollision_' + evt.type;
			(goA as WorldObject).events.emit(name, payloadToB);
			(goB as WorldObject).events.emit(name, payloadToA);
		}
	}
}

function resolveCollisionObject(userdata: unknown, label: 'A' | 'B', world: World): WorldObject {
	if (userdata == null) {
		throw new Error(`[PhysicsCollisionEventSystem] Body ${label} is missing userData.`);
	}
	if (typeof userdata === 'string') {
		const obj = world.getWorldObject(userdata);
		if (!obj) {
			throw new Error(`[PhysicsCollisionEventSystem] Body ${label} references unknown object id '${userdata}'.`);
		}
		return obj;
	}
	if (typeof userdata === 'object' && 'id' in (userdata as Record<string, unknown>)) {
		return userdata as WorldObject;
	}
	throw new Error(`[PhysicsCollisionEventSystem] Unsupported userData on body ${label}.`);
}

/** TransformSystem: update TransformComponent from WorldObject state (position/orientation/scale). */
export class TransformSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.Physics, priority); }
	update(world: World): void {
		for (let [o, c] of world.objects_with_components(TransformComponent, { scope: 'active' }) as Iterable<[WorldObject & Oriented & Scaled, TransformComponent]>) {
			if (!c.enabled) continue;
			const pos = o.pos;
			if (!pos) {
				throw new Error(`[TransformSystem] WorldObject '${o.id}' does not expose a position vector.`);
			}
			c.position[0] = o.x;
			c.position[1] = o.y;
			c.position[2] = o.z;
			c.orientationQ = o.rotationQ;
			c.scale[0] = o.scale[0];
			c.scale[1] = o.scale[1];
			c.scale[2] = o.scale[2];
			c.markDirty();
		}
	}
}

/** MeshAnimationSystem: steps GLTF-based mesh animations without calling WorldObject.run(). */
export class MeshAnimationSystem extends ECSystem {
	constructor(priority: number = 0) { super(TickGroup.Animation, priority); }
	update(world: World): void {
		const dtSec = $.deltatime_seconds;
		for (const [, c] of world.objects_with_components(MeshComponent, { scope: 'active' })) {
			if (!c.enabled) continue;
			c.stepAnimation(dtSec);
		}
	}
}
