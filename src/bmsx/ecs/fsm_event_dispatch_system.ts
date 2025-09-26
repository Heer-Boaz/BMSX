import type { WorldObject } from '../core/object/worldobject';
import type { World } from '../core/world';
import { ECSystem, TickGroup } from './ecsystem';
import { GameplayCommandBuffer } from './gameplay_command_buffer';

/**
 * Drains queued FSM dispatch commands and delivers them during the ModeResolution phase.
 */
export class FsmEventDispatchSystem extends ECSystem {
	constructor(priority = 5) {
		super(TickGroup.ModeResolution, priority);
	}

	public override update(world: World): void {
		const events = GameplayCommandBuffer.instance.drainByKind('dispatchEvent');
		if (events.length === 0) return;

		for (let i = 0; i < events.length; i++) {
			const cmd = events[i]!;
			const target = world.getWorldObject<WorldObject>(cmd.target_id);
			if (!target) {
				throw new Error(`[FsmEventDispatchSystem] Event '${cmd.event}' targets unknown object '${cmd.target_id}'.`);
			}
			if (!target.sc) {
				throw new Error(`[FsmEventDispatchSystem] Target '${cmd.target_id}' has no state machine controller.`);
			}
			const emitterId = cmd.emitter_id ?? target.id;
			target.sc.dispatch_event(cmd.event, emitterId, cmd.payload);
		}
	}
}
