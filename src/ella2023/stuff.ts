import { $, DrawRectOptions, GameObject, Msx1Colors, SpriteObject, State, StateMachineBlueprint, build_fsm, insavegame, new_area3d, new_vec3 } from '../bmsx';
import { BitmapId } from './resourceids';

function wrapup(state: State) {
	$.stopMusic();
	$.world.sc.transition_to('titlescreen');
	state.reset(); // Make sure that the tick counter is reset.
}

@insavegame
export class GameOver extends SpriteObject {
	@build_fsm()
	static bouw(): StateMachineBlueprint {
		return {
			substates: {
				_default: {
					ticks2advance_tape: 500,
					process_input(this: TitleScreen, state: State) {
						const priorityActions = $.getPressedActions(1, { pressed: true, consumed: false, filter: ['punch', 'highkick', 'lowkick', 'block'] });

						// If no priority actions are pressed, do nothing.
						if (!priorityActions || priorityActions.length === 0) {
							return;
						}
						$.consumeActions(1, ...priorityActions);

						wrapup(state);
					},
					tape_end(this: GameOver, state: State) {
						wrapup(state);
					},
				}
			}
		}
	}

	override paint(): void {
		super.paint();
		const x = 8;
		const y = 144;

		const options: DrawRectOptions = { area: new_area3d(0, 136, this.z + 1, 256, 192 - 8, this.z + 1), color: Msx1Colors[0] };
		$.fillRectangle(options);
		const lines = ['je bent toch niet', 'de strijder die ik nodig heb.', 'ik ben een beetje', 'teleurgesteld in jouw ouders...'];

		$.drawText(x, y, lines);
	}

	constructor() {
		super('gameover');
		this.imgid = BitmapId.gameover;
	}
}

@insavegame
export class Hoera extends SpriteObject {
	@build_fsm()
	static bouw(): StateMachineBlueprint {

		return {
			substates: {
				_default: {
					ticks2advance_tape: 500,
					process_input(this: TitleScreen, state: State) {
						const priorityActions = $.input.getPlayerInput(1).getPressedActions({ pressed: true, consumed: false, filter: ['punch', 'highkick', 'lowkick', 'block'] });

						// If no priority actions are pressed, do nothing.
						if (!priorityActions || priorityActions.length === 0) {
							return;
						}
						$.input.getPlayerInput(1).consumeActions(...priorityActions);
						wrapup(state);
					},
					tape_end(this: Hoera, state: State) {
						wrapup(state);
					},
				}
			}
		}
	}

	override paint(): void {
		super.paint();
		const x = 16;
		const y = 160;

		const options: DrawRectOptions = { area: new_area3d(0, 152, this.z + 1, 256, 192, this.z + 1), color: Msx1Colors[0] };
		$.fillRectangle(options);
		const lines = ['dat heb je', 'redelijk gedaan Elly!', 'ik bedoel: Ei La!'];

		$.drawText(x, y, lines);
	}

	constructor() {
		super('hoera');
		this.imgid = BitmapId.hoera;
	}
}

@insavegame
export class TitleScreen extends SpriteObject {
	private static readonly SELECT_PLAYER_1_Y = 160 - 16;
	private static readonly SELECT_PLAYER_2_Y = 160;
	private cursorY: number;
	private selectedPlayers: number;
	private cursorVisible: boolean;

	@build_fsm()
	static bouw(): StateMachineBlueprint {
		return {
			substates: {
				_default: {
					event_handlers: {
						reset: {
							do(this: TitleScreen) {
								this.cursorY = TitleScreen.SELECT_PLAYER_1_Y;
								this.selectedPlayers = 1;
								this.cursorVisible = true;
								this.sc.dispatch_event('players_1', this);
								this.sc.dispatch_event('resume_blink', this);
							},
						},
					},
					process_input(this: TitleScreen) {
						const priorityActions = $.input.getPlayerInput(1).getPressedActions({ pressed: true, consumed: false, filter: ['up', 'down', 'punch', 'highkick', 'lowkick', 'block'] });

						// If no priority actions are pressed, do nothing.
						if (!priorityActions || priorityActions.length === 0) {
							return;
						}

						$.consumeActions(1, ...priorityActions);

						if (priorityActions.some(action => action.action === 'up' || action.action === 'down')) {
							this.sc.dispatch_event('switch', this);
							return;
						}

						// If a priority action is pressed, start the game.
						this.cursorVisible = true;
						this.sc.dispatch_event('pause_blink', this);
						$.emit('gamestart_selected', this, { numOfPlayers: this.selectedPlayers });
					},
					substates: {
						_players_1: {
							event_handlers: {
								$switch: 'players_2',
							},
							entering_state(this: TitleScreen, state: State) {
								this.cursorY = TitleScreen.SELECT_PLAYER_1_Y;
								this.selectedPlayers = 1;
								this.cursorVisible = true;
								state.parent.substates.blink.reset();
							},
						},
						players_2: {
							event_handlers: {
								$switch: 'players_1',
								$players_1: 'players_1', // For resetting the TitleScreen state.
							},
							entering_state(this: TitleScreen, state: State) {
								this.cursorY = TitleScreen.SELECT_PLAYER_2_Y;
								this.selectedPlayers = 2;
								this.cursorVisible = true;
								state.parent.substates.blink.reset();
							},
						},
						blink: {
							is_concurrent: true,
							ticks2advance_tape: 20,
							tape_data: [false, true],
							auto_rewind_tape_after_end: true,
							data: {
								pause_blink: false,
							},
							entering_state(this: TitleScreen) {
								this.cursorVisible = true;
							},
							tape_next(this: TitleScreen, state: State) {
								if (state.data.pause_blink) return;
								this.cursorVisible = state.current_tape_value;
							},
							substates: {
								_default: {
									event_handlers: {
										$pause_blink: 'paused',
									},
									entering_state(state: State) {
										state.parent.data.pause_blink = false;
									},
								},
								paused: {
									event_handlers: {
										$resume_blink: 'default',
									},
									entering_state(state: State) {
										state.parent.data.pause_blink = true;
									},
								}
							}
						}
					}
				}
			}
		}
	}

	override paint(): void {
		super.paint();
		if (this.cursorVisible) {
			$.drawImg({ imgid: BitmapId.menu_arrow, pos: new_vec3(80, this.cursorY, this.z + 1) });
		}

	}

	constructor() {
		super('title');
		this.imgid = BitmapId.title;
	}
}

@insavegame
export class Gordijn extends GameObject {
	private width: number;

	@build_fsm()
	static bouw(): StateMachineBlueprint {
		return {
			substates: {
				_idle: {
					event_handlers: {
						its_curtains: 'its_curtains_for_you',
						reset: {
							do(this: Gordijn) {
								this.width = 0;
							},
						},
					},
				},
				its_curtains_for_you: {
					event_handlers: {
						$curtained: 'idle',
					},
					ticks2advance_tape: 2,
					tape_data: [8],
					repetitions: 256 / 8,
					entering_state(this: Gordijn) {
						this.width = 0;
					},
					tape_next(this: Gordijn, state: State) {
						this.width += state.current_tape_value;
					},
					tape_end(this: Gordijn) {
						$.emit('curtained', this);
					},
				},
			}
		}
	}

	constructor() {
		super('gordijn');
		this.width = 0;
	}

	override paint(): void {
		if (this.width === 0) {
			return;
		}
		super.paint?.();
		const options: DrawRectOptions = { area: new_area3d(0, 0, this.z + 1, this.width, 192, this.z), color: Msx1Colors[0] };
		$.fillRectangle(options);
	}
}
