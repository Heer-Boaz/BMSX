import { $, WorldObject, Msx1Colors, SpriteObject, State, StateMachineBlueprint, build_fsm, insavegame, new_area3d, new_vec3, type RevivableObjectArgs } from 'bmsx';
import { SpriteComponent } from 'bmsx/component/sprite_component';
import { BitmapId } from './resourceids';
import { createGameEvent, type GameEvent } from 'bmsx/core/game_event';
import type { TimelineEndEventPayload, TimelineFrameEventPayload } from 'bmsx/component/timeline_component';

function wrapup(state: State) {
	$.stopmusic();
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
					data: {
						elapsed: 0,
					},
					process_input(this: TitleScreen, state: State) {
						const priorityActions = $.getPressedActions(1, { pressed: true, consumed: false, filter: ['punch', 'highkick', 'lowkick', 'block'] });

						// If no priority actions are pressed, do nothing.
						if (!priorityActions || priorityActions.length === 0) {
							return;
						}
						$.consumeActions(1, ...priorityActions);

						wrapup(state);
					},
					tick(this: GameOver, state: State) {
						state.data.elapsed = (state.data.elapsed ?? 0) + 1;
						if (state.data.elapsed >= 500) {
							wrapup(state);
						}
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
					data: {
						elapsed: 0,
					},
					process_input(this: TitleScreen, state: State) {
						const priorityActions = $.input.getPlayerInput(1).getPressedActions({ pressed: true, consumed: false, filter: ['punch', 'highkick', 'lowkick', 'block'] });

						// If no priority actions are pressed, do nothing.
						if (!priorityActions || priorityActions.length === 0) {
							return;
						}
						$.input.getPlayerInput(1).consumeActions(...priorityActions);
						wrapup(state);
					},
					tick(this: Hoera, state: State) {
						state.data.elapsed = (state.data.elapsed ?? 0) + 1;
						if (state.data.elapsed >= 500) {
							wrapup(state);
						}
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
	private static readonly BLINK_TIMELINE_ID = 'title-screen.blink';
	private cursorY: number;
	private selectedPlayers: number;
	private get cursorVisible() { return this._cursorSprite.enabled; }
	private set cursorVisible(visible: boolean) {
		this._cursorSprite.enabled = !!visible;
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
								const playersEvent = createGameEvent({ type: 'players_1', emitter: this });
								this.sc.dispatch_event(playersEvent);
								const resumeEvent = createGameEvent({ type: 'resume_blink', emitter: this });
								this.sc.dispatch_event(resumeEvent);
							},
						},
					},
					process_input(this: TitleScreen) {
						const priorityActions = $.input.getPlayerInput(1).getPressedActions({ pressed: true, consumed: false, filter: ['up', 'down', 'punch', 'highkick', 'lowkick', 'block'] });
						console.log('[TitleScreen] process_input', {
							actions: priorityActions?.map(action => ({ action: action.action, pressed: action.pressed, consumed: action.consumed })),
						});

						// If no priority actions are pressed, do nothing.
						if (!priorityActions || priorityActions.length === 0) {
							return;
						}

						$.consumeActions(1, ...priorityActions);

						if (priorityActions.some(action => action.action === 'up' || action.action === 'down')) {
							const switchEvent = createGameEvent({ type: 'switch', emitter: this });
							this.sc.dispatch_event(switchEvent);
							return;
						}

						// If a priority action is pressed, start the game.
						this.cursorVisible = true;
						const pauseEvent = createGameEvent({ type: 'pause_blink', emitter: this });
						this.sc.dispatch_event(pauseEvent);
						$.emit_presentation('gamestart_selected', this, { numOfPlayers: this.selectedPlayers });
					},
					states: {
						_players_1: {
							on: {
								$switch: '../players_2',
							},
							entering_state(this: TitleScreen, state: State) {
								this.cursorY = TitleScreen.SELECT_PLAYER_1_Y;
								this.selectedPlayers = 1;
								console.log('[TitleScreen] entering players_1');
								this.cursorVisible = true;
								state.parent.states.blink.reset();
								this._cursorSprite.offset = new_vec3(80, this.cursorY, 1);
							},
						},
						players_2: {
							on: {
								$switch: '../_players_1',
								$players_1: '../_players_1', // For resetting the TitleScreen state.
							},
							entering_state(this: TitleScreen, state: State) {
								this.cursorY = TitleScreen.SELECT_PLAYER_2_Y;
								this.selectedPlayers = 2;
								console.log('[TitleScreen] entering players_2');
								this.cursorVisible = true;
								state.parent.states.blink.reset();
								this._cursorSprite.offset = new_vec3(80, this.cursorY, 1);
							},
						},
						blink: {
							is_concurrent: true,
							data: {
								pause_blink: false,
							},
							entering_state(this: TitleScreen) {
								this.cursorVisible = true;
								this.play_timeline(TitleScreen.BLINK_TIMELINE_ID, { rewind: true, snapToStart: true });
							},
							on: {
								[`timeline.frame:${TitleScreen.BLINK_TIMELINE_ID}`]: {
									scope: 'self',
									do(this: TitleScreen, state: State, event: GameEvent<'timeline.frame', TimelineFrameEventPayload<boolean>>) {
										console.log('[TitleScreen] blink timeline frame', { value: event.frame_value, pause: state.data.pause_blink });
										if (state.data.pause_blink) return;
										this.cursorVisible = event.frame_value;
									},
								},
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
										$resume_blink: '../_default',
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
		this.add_component(this._cursorSprite);
		this._cursorSprite.layer = 'ui';
		this._cursorSprite.colliderLocalId = null;
		this.define_timeline({
			id: TitleScreen.BLINK_TIMELINE_ID,
			frames: [false, true],
			playbackMode: 'loop',
			ticksPerFrame: 20,
		});
	}
}

@insavegame
export class Gordijn extends WorldObject {
	private width: number;
	private static readonly TIMELINE_ID = 'gordijn.close';

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
						$curtained: '/_idle',
						[`timeline.frame:${Gordijn.TIMELINE_ID}`]: {
							scope: 'self',
							do(this: Gordijn, _state: State, event: GameEvent<'timeline.frame', TimelineFrameEventPayload<number>>) {
								this.width += event.frame_value;
							},
						},
						[`timeline.end:${Gordijn.TIMELINE_ID}`]: {
							scope: 'self',
							do(this: Gordijn, _state: State, _event: GameEvent<'timeline.end', TimelineEndEventPayload>) {
								$.emit_presentation('curtained', this);
							},
						},
					},
					entering_state(this: Gordijn) {
						this.width = 0;
						this.play_timeline(Gordijn.TIMELINE_ID, { rewind: true, snapToStart: true });
					},
				},
			}
		}
	}

	constructor(opts?: RevivableObjectArgs) {
		super({ id: 'gordijn', ...opts });
		this.define_timeline({
			id: Gordijn.TIMELINE_ID,
			frames: [8],
			ticksPerFrame: 2,
			repetitions: 256 / 8,
		});
		this.width = 0;
		this.getOrCreateCustomRenderer().addProducer(({ rc }) => {
			rc.submitRect({ kind: 'fill', area: new_area3d(0, 0, this.z + 1, this.width, 192, this.z), color: Msx1Colors[0], layer: 'ui' });
		});
	}
}
