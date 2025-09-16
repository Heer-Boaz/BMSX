import { ECSystem, TickGroup } from './ecsystem';
import type { World } from 'bmsx/core/world';
import { Collision2DSystem } from '../service/collision2d_service';

/** Rebuilds the broad-phase collision index once per frame. */
export class Collision2DBroadphaseRebuildSystem extends ECSystem {
	constructor(priority: number = 40) { super(TickGroup.PostPhysics, priority); }
	update(world: World): void { Collision2DSystem.rebuildIndex(world); }
}
