import { Registry } from '../core/registry';
import { ECSystem, TickGroup } from './ecsystem';
import { GameplayCommandBuffer } from './gameplay_command_buffer';

/**
 * Drains queued FSM dispatch commands and delivers them during the ModeResolution phase.
 */
export class FsmEventDispatchSystem extends ECSystem {
	constructor(priority = 5) {
		super(TickGroup.ModeResolution, priority);
	}

	public override update(): void {
		const events = GameplayCommandBuffer.instance.drainByKind('dispatchEvent');

		for (const cmd of events) {
			const target = Registry.instance.get(cmd.target_id); // Allow global objects to be targets too, like services.
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
