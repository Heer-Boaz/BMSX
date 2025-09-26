import { GameplayCommandBuffer } from './gameplay_command_buffer';
import type { World } from '../core/world';
import { WorldObject } from '../core/object/worldobject';
import { ECSystem, TickGroup } from './ecsystem';

export class GameplayMovementSystem extends ECSystem {
	constructor(priority: number = 12) { super(TickGroup.Physics, priority); }

	update(world: World): void {
		const moveBy = GameplayCommandBuffer.instance.drainByKind('moveby2d');
		const moveTo = GameplayCommandBuffer.instance.drainByKind('moveto2d');
		if (moveBy.length === 0 && moveTo.length === 0) return;

		const ordered: Array<(typeof moveTo)[number] | (typeof moveBy)[number]> = [...moveTo, ...moveBy];
		ordered.sort((a, b) => (a.frame - b.frame) || (a.seq - b.seq));

		for (let i = 0; i < ordered.length; i++) {
			const command = ordered[i]!;
			const targetId = command.target_id;
			const obj = world.getWorldObject(targetId) as WorldObject | null;
			if (!obj) {
				throw new Error(`[GameplayMovementSystem] Movement command targets unknown object '${targetId}'.`);
			}
			if (obj.disposeFlag || obj.active === false) {
				throw new Error(`[GameplayMovementSystem] Movement command issued for inactive object '${targetId}'.`);
			}

			switch (command.kind) {
				case 'moveto2d': {
					if (command.delta.x) obj.pos.x = command.delta.x;
					if (command.delta.y) obj.pos.y = command.delta.y;
					if (command.delta.z) obj.pos.z = command.delta.z;
					break;
				}
				case 'moveby2d': {
					if (command.delta.x) obj.pos.x += command.delta.x;
					if (command.delta.y) obj.pos.y += command.delta.y;
					if (command.delta.z) obj.pos.z += command.delta.z;
					break;
				}
				default:
					throw new Error(`Unhandled command kind ${(command as { kind: string }).kind}`);
			}
		}
	}
}
