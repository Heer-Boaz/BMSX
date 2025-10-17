import { World, build_fsm, type StateMachineBlueprint } from 'bmsx';

export class BmsxConsoleWorldFsm {
	@build_fsm('world')
	public static define(): StateMachineBlueprint {
		return {
			initial: 'idle',
			states: {
				idle: {
					tick(this: World): void {
						// No-op; console worlds remain in the idle state.
					},
				},
			},
		};
	}
}
