import { Component, type ComponentAttachOptions } from '../component/basecomponent';
import { $ } from '../core/game';
import { new_vec3 } from '../utils/utils';
import { excludeclassfromsavegame } from 'bmsx/serializer/serializationhooks';
import { PhysicsBody } from './physicsbody';
import { PhysicsWorld } from './physicsworld';

/**
 * PhysicsDebugComponent
 * Attachable to a WorldObject that has some kind of render / overlay capability. It registers
 * a gizmo drawer with the PhysicsWorld. The drawer collects simple line / circle primitives
 * into arrays exposed on the component so any HUD / debug rendering system can draw them.
 * (We avoid pulling in a hard dependency on a particular renderer here.)
 */
@excludeclassfromsavegame
export class PhysicsDebugComponent extends Component {
	static override get unique() { return true; }
	override get enabled() { return this._enabled; }
	override set enabled(v: boolean) { this._enabled = v; }

	// Output primitive buffers (cleared each frame)
	aabbLines: { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; }[] = [];
	sphereCircles: { cx: number; cy: number; cz: number; r: number; }[] = [];
	contactPoints: { x: number; y: number; z: number; nx: number; ny: number; nz: number; penetration: number; }[] = [];
	triggerAabbs: { x: number; y: number; z: number; hx: number; hy: number; hz: number; }[] = [];

	// Simple debug hits from exercising world.raycast & world.shapeCast
	testRaycastHit?: { x: number; y: number; z: number; dist: number };
	testShapeCastHit?: { x: number; y: number; z: number; dist: number; time: number };

	private _gizmoDrawer?: (world: PhysicsWorld) => void;

	override preprocessingUpdate(): void { this.ensureGizmoRegistration(); }
	override postprocessingUpdate(): void { /* gizmos populated in drawer at end of physics step */ }

	private ensureGizmoRegistration() {
		if (this._gizmoDrawer) return;
		const world = $.get<PhysicsWorld>('physics_world');
		if (!world) return; // try again later
		this._gizmoDrawer = (w) => this.collectGizmos(w);
		world.addGizmo(this._gizmoDrawer);
	}

	private collectGizmos(world: PhysicsWorld) {
		if (!this.enabled) return;
		// Clear output buffers
		this.aabbLines.length = 0;
		this.sphereCircles.length = 0;
		this.contactPoints.length = 0;
		this.triggerAabbs.length = 0;
		// Bodies
		for (const b of world.getBodies()) this.drawBody(b);
		// Contacts
		for (const c of world.getContacts()) {
			this.contactPoints.push({ x: c.point.x, y: c.point.y, z: c.point.z, nx: c.normal.x, ny: c.normal.y, nz: c.normal.z, penetration: c.penetration });
		}
		// Axes (once)
		if (!this._axesAdded) {
			this.aabbLines.push(
				{ x1: 0, y1: 0, z1: 0, x2: 5, y2: 0, z2: 0 },
				{ x1: 0, y1: 0, z1: 0, x2: 0, y2: 5, z2: 0 },
				{ x1: 0, y1: 0, z1: 0, x2: 0, y2: 0, z2: 5 }
			);
			this._axesAdded = true;
		}
		// Lightweight usage tests (one raycast + one shapeCast per frame) so API stays validated & referenced
		const rh = world.raycast(new_vec3(0, 0, 0), new_vec3(1, 0, 0), 100);
		if (rh) this.testRaycastHit = { x: rh.point.x, y: rh.point.y, z: rh.point.z, dist: rh.distance };
		const sh = world.shapeCast({ kind: 'sphere', radius: 1 }, new_vec3(-2, 0, 0), new_vec3(2, 0, 0));
		if (sh) this.testShapeCastHit = { x: sh.point.x, y: sh.point.y, z: sh.point.z, dist: sh.distance, time: sh.time };
	}

	private _axesAdded = false;

	constructor(opts: ComponentAttachOptions) { super(opts); }

	private drawBody(b: PhysicsBody) {
		if (b.shape.kind === 'aabb') {
			const h = b.shape.halfExtents;
			const x = b.position.x, y = b.position.y, z = b.position.z;
			if (b.isTrigger) {
				this.triggerAabbs.push({ x, y, z, hx: h.x, hy: h.y, hz: h.z });
			}
			// 12 edges of the AABB
			const corners = [
				new_vec3(x - h.x, y - h.y, z - h.z), new_vec3(x + h.x, y - h.y, z - h.z),
				new_vec3(x + h.x, y + h.y, z - h.z), new_vec3(x - h.x, y + h.y, z - h.z),
				new_vec3(x - h.x, y - h.y, z + h.z), new_vec3(x + h.x, y - h.y, z + h.z),
				new_vec3(x + h.x, y + h.y, z + h.z), new_vec3(x - h.x, y + h.y, z + h.z)
			];
			const idxPairs = [
				[0, 1], [1, 2], [2, 3], [3, 0], // bottom
				[4, 5], [5, 6], [6, 7], [7, 4], // top
				[0, 4], [1, 5], [2, 6], [3, 7]  // sides
			];
			for (const [a, bidx] of idxPairs) {
				const c1 = corners[a];
				const c2 = corners[bidx];
				this.aabbLines.push({ x1: c1.x, y1: c1.y, z1: c1.z, x2: c2.x, y2: c2.y, z2: c2.z });
			}
		} else if (b.shape.kind === 'sphere') {
			this.sphereCircles.push({ cx: b.position.x, cy: b.position.y, cz: b.position.z, r: b.shape.radius });
		}
	}

	override dispose(): void {
		super.dispose();
		const world = $.get<PhysicsWorld>('physics_world');
		if (world && this._gizmoDrawer) world.removeGizmo(this._gizmoDrawer);
		this._gizmoDrawer = undefined;
	}
}
