import { World, build_fsm,insavegame,StateMachineBlueprint } from 'bmsx';

@insavegame
export class testrom_world_fsm extends World {
	@build_fsm()
	public static bouw(): StateMachineBlueprint {
		return {
			states: {
				'_game_start': {
					entering_state(this: testrom_world_fsm) {
					},
					tick(this: testrom_world_fsm) {
						return 'default';
					}
				},
				default: {
					entering_state(this: testrom_world_fsm) {
						return;
					},
				},
			},
		}
	};
}
