import { Component, componenttags_postprocessing, componenttags_preprocessing } from '../component/basecomponent';
import { new_vec3 } from '../core/utils';
import type { Identifier } from '../rompack/rompack';
import { excludeclassfromsavegame } from '../serializer/gameserializer';
import { PhysicsBody } from './physicsbody';
import { PhysicsWorld } from './physicsworld';

/**
 * PhysicsDebugComponent
 * Attachable to a GameObject that has some kind of render / overlay capability. It registers
 * a gizmo drawer with the PhysicsWorld. The drawer collects simple line / circle primitives
 * into arrays exposed on the component so any HUD / debug rendering system can draw them.
 * (We avoid pulling in a hard dependency on a particular renderer here.)
 */
@excludeclassfromsavegame
@componenttags_preprocessing('physics_pre') // Preprocessing update to store the old position so that it can be used in the postprocessing update to place the object back to its old position if it collides with a wall or leaves the screen, etc.
@componenttags_postprocessing('physics_post') // Postprocessing update to check for, and handle, collisions or leaving the screen, etc.
export class PhysicsDebugComponent extends Component {
    world: PhysicsWorld;
    override get enabled() { return this._enabled; }
    override set enabled(v: boolean) { this._enabled = v; }

    // Output primitive buffers (cleared each frame)
    aabbLines: { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; }[] = [];
    sphereCircles: { cx: number; cy: number; cz: number; r: number; }[] = [];
    contactPoints: { x: number; y: number; z: number; nx: number; ny: number; nz: number; penetration: number; }[] = [];
    triggerAabbs: { x: number; y: number; z: number; hx: number; hy: number; hz: number; }[] = [];

    override preprocessingUpdate(): void {
        // read GameObject -> body before physics (if not sleeping and user wants authoritative GameObject)
        // For now we always treat body as authoritative; could add option later.
    }

    override postprocessingUpdate(): void {
        if (!this.enabled) return;
        this.aabbLines.length = 0;
        this.sphereCircles.length = 0;
        for (const b of this.world.getBodies()) this.drawBody(b);
        // contacts
        this.contactPoints.length = 0;
        for (const c of this.world.getContacts()) {
            this.contactPoints.push({ x: c.point.x, y: c.point.y, z: c.point.z, nx: c.normal.x, ny: c.normal.y, nz: c.normal.z, penetration: c.penetration });
        }
        // Append world axes primitive lines once (avoid duplicates by checking length or a flag)
        if (!this._axesAdded) {
            this.aabbLines.push(
                { x1: 0, y1: 0, z1: 0, x2: 5, y2: 0, z2: 0 }, // X
                { x1: 0, y1: 0, z1: 0, x2: 0, y2: 5, z2: 0 }, // Y
                { x1: 0, y1: 0, z1: 0, x2: 0, y2: 0, z2: 5 }  // Z
            );
            this._axesAdded = true;
        }
    }

    private _axesAdded = false;

    constructor(parentid: Identifier) {
        super(parentid);
        this.world = $.registry.get<PhysicsWorld>('physics_world');
        if (!this.world) throw new Error('PhysicsWorld not found for PhysicsDebugComponent');
        this.world.addGizmo(this.postprocessingUpdate);
    }

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
        if (this.world) this.world.removeGizmo(this.postprocessingUpdate);
    }
}
