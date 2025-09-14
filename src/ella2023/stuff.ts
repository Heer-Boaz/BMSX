import { $, WorldObject, Msx1Colors, SpriteObject, State, StateMachineBlueprint, build_fsm, insavegame, new_area3d, new_vec3, type RevivableObjectArgs } from 'bmsx';
import { SpriteComponent } from 'bmsx/component/sprite_component';
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
			states: {
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

	constructor(opts?: RevivableObjectArgs) {
		super({ id: 'gameover', ...opts });
		this.imgid = BitmapId.gameover;
		this.getOrCreateCustomRenderer().addProducer(({ rc }) => {
			rc.submitRect({ kind: 'fill', area: new_area3d(0, 136, this.z + 1, 256, 192 - 8, this.z + 1), color: Msx1Colors[0] });
			const x = 8, y = 144;
			const textToWrite = 'je bent toch niet de strijder die ik nodig heb.\nik ben een beetje teleurgesteld in jouw ouders...';
			rc.submitGlyphs({ x, y, glyphs: textToWrite, wrapChars: 30 });
		});
	}
}

@insavegame
export class Hoera extends SpriteObject {
	@build_fsm()
	static bouw(): StateMachineBlueprint {

		return {
			states: {
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

	constructor(opts?: RevivableObjectArgs) {
		super({ id: 'hoera', ...opts });
		this.imgid = BitmapId.hoera;
		this.getOrCreateCustomRenderer().addProducer(({ rc }) => {
			rc.submitRect({ kind: 'fill', area: new_area3d(0, 152, this.z + 1, 256, 192, this.z + 1), color: Msx1Colors[0] });
			const x = 16, y = 160;
			const textToWrite = 'Dat heb je redelijk gedaan Elly!\nIk bedoel: Ei La!';
			rc.submitGlyphs({ x, y, glyphs: textToWrite, wrapChars: 30 });
		});
	}
}

@insavegame
export class TitleScreen extends SpriteObject {
	private static readonly SELECT_PLAYER_1_Y = 160 - 16;
	private static readonly SELECT_PLAYER_2_Y = 160;
	private cursorY: number;
	private selectedPlayers: number;
	private get cursorVisible() { return this._cursorSprite.enabled; }
	private set cursorVisible(visible: boolean) {
		if (this._cursorSprite) this._cursorSprite.enabled = !!visible;
	}

	private _cursorSprite!: SpriteComponent;

	@build_fsm()
	static bouw(): StateMachineBlueprint {
		return {
			states: {
				_default: {
					on: {
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
					states: {
						_players_1: {
							on: {
								$switch: '../players_2',
							},
							entering_state(this: TitleScreen, state: State) {
								this.cursorY = TitleScreen.SELECT_PLAYER_1_Y;
								this.selectedPlayers = 1;
								this.cursorVisible = true;
								state.parent.states.blink.reset();
								if (this._cursorSprite) this._cursorSprite.offset = new_vec3(80, this.cursorY, 1);
							},
						},
						players_2: {
							on: {
								$switch: '../players_1',
								$players_1: '../players_1', // For resetting the TitleScreen state.
							},
							entering_state(this: TitleScreen, state: State) {
								this.cursorY = TitleScreen.SELECT_PLAYER_2_Y;
								this.selectedPlayers = 2;
								this.cursorVisible = true;
								state.parent.states.blink.reset();
								if (this._cursorSprite) this._cursorSprite.offset = new_vec3(80, this.cursorY, 1);
							},
						},
						blink: {
							is_concurrent: true,
							ticks2advance_tape: 20,
							tape_data: [false, true],
							auto_rewind_tape_after_end: true,
							automatic_reset_mode: 'state', // So that when we re-enter the state, the tape is reset (default)
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
							states: {
								_default: {
									on: {
										$pause_blink: '../paused',
									},
									entering_state(state: State) {
										state.parent.data.pause_blink = false;
									},
								},
								paused: {
									on: {
										$resume_blink: '../default',
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

	constructor(opts?: RevivableObjectArgs) {
		super({ id: 'title', ...opts });
		this.imgid = BitmapId.title;
		// Cursor sprite component (secondary)
		this._cursorSprite = new SpriteComponent({ parentid: this.id, imgid: BitmapId.menu_arrow });
		this.addComponent(this._cursorSprite);
		this._cursorSprite.layer = 'ui';
	}
}

@insavegame
export class Gordijn extends WorldObject {
	private width: number;

	@build_fsm()
	static bouw(): StateMachineBlueprint {
		return {
			states: {
				_idle: {
					on: {
						its_curtains: '/its_curtains_for_you',
						reset: {
							do(this: Gordijn) {
								this.width = 0;
							},
						},
					},
				},
				its_curtains_for_you: {
					on: {
						$curtained: '/idle',
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

	constructor(opts?: RevivableObjectArgs) {
		super({ id: 'gordijn', ...opts });
		this.width = 0;
		this.getOrCreateCustomRenderer().addProducer(({ rc }) => {
			if (this.width === 0) return;
			rc.submitRect({ kind: 'fill', area: new_area3d(0, 0, this.z + 1, this.width, 192, this.z), color: Msx1Colors[0], layer: 'ui' });
		});
	}
}
