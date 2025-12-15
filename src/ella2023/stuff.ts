import { $, WorldObject, Msx1Colors, SpriteObject, State, StateMachineBlueprint, build_fsm, insavegame, new_area3d, new_vec3, type RevivableObjectArgs } from 'bmsx';
import { SpriteComponent } from 'bmsx/component/sprite_component';
import type { GameEvent } from 'bmsx/core/game_event';
import type { TimelineEndEventPayload, TimelineFrameEventPayload } from 'bmsx/component/timeline_component';
import { BitmapId } from './resourceids';

const PRIMARY_PLAYER_INDEX = 1;
const NAVIGATION_ACTIONS = ['up', 'down'] as const;
const SKIP_ACTIONS = ['punch', 'highkick', 'lowkick', 'block'] as const;

export const RETURN_TO_TITLE_EVENT = 'titlescreen.return_requested';

function findTriggeredAction(filter: readonly string[]): string {
	const input = $.input.getPlayerInput(PRIMARY_PLAYER_INDEX);
	for (const action of filter) {
		if (input.checkActionTriggered(`${action}[j]`)) return action;
	}
	return null;
}

function emitReturnToTitle(emitter: SpriteObject): void {
	$.emit(RETURN_TO_TITLE_EVENT, emitter);
}

function trySkipToTitle(emitter: SpriteObject): void {
	if (!findTriggeredAction(SKIP_ACTIONS)) return;
	emitReturnToTitle(emitter);
}

@insavegame
export class GameOver extends SpriteObject {
	public static readonly TIMEOUT_TIMELINE_ID = 'gameover.timeout';

	@build_fsm()
	public static bouw(): StateMachineBlueprint {
		return {
			states: {
				_default: {
					timelines: {
						[GameOver.TIMEOUT_TIMELINE_ID]: {
							frames: [true],
							ticks_per_frame: 500,
							playback_mode: 'once',
						},
					},
					entering_state(this: GameOver) {
						this.restartTimeout();
					},
					on: {
						reset: {
							go(this: GameOver) {
								this.restartTimeout();
							},
						},
					},
					process_input(this: GameOver) {
						trySkipToTitle(this);
					},
				},
			},
		};
	}

	private restartTimeout(): void {
		this.play_timeline(GameOver.TIMEOUT_TIMELINE_ID, { rewind: true, snap_to_start: true });
	}

	constructor(opts?: RevivableObjectArgs) {
		super({ id: 'gameover', ...opts });
		this.imgid = BitmapId.gameover;
		this.getOrCreateCustomRenderer().add_producer(({ rc }) => {
			rc.submit_rect({
				kind: 'fill',
				area: new_area3d(0, 136, this.z + 1, 256, 184),
				color: Msx1Colors[0],
			});
			rc.submit_glyphs({
				x: 8,
				y: 144,
				wrap_chars: 30,
				glyphs: 'je bent toch niet de strijder die ik nodig heb.\nik ben een beetje teleurgesteld in jouw ouders...',
			});
		});
	}
}

@insavegame
export class Hoera extends SpriteObject {
	public static readonly TIMEOUT_TIMELINE_ID = 'hoera.timeout';

	@build_fsm()
	public static bouw(): StateMachineBlueprint {
		return {
			states: {
				_default: {
					timelines: {
						[Hoera.TIMEOUT_TIMELINE_ID]: {
							frames: [true],
							ticks_per_frame: 500,
							playback_mode: 'once',
						},
					},
					entering_state(this: Hoera) {
						this.restartTimeout();
					},
					on: {
						reset: {
							go(this: Hoera) {
								this.restartTimeout();
							},
						},
					},
					process_input(this: Hoera) {
						trySkipToTitle(this);
					},
				},
			},
		};
	}

	private restartTimeout(): void {
		this.play_timeline(Hoera.TIMEOUT_TIMELINE_ID, { rewind: true, snap_to_start: true });
	}

	constructor(opts?: RevivableObjectArgs) {
		super({ id: 'hoera', ...opts });
		this.imgid = BitmapId.hoera;
		this.getOrCreateCustomRenderer().add_producer(({ rc }) => {
			rc.submit_rect({
				kind: 'fill',
				area: new_area3d(0, 152, this.z + 1, 256, 192, this.z + 1),
				color: Msx1Colors[0],
			});
			rc.submit_glyphs({ x: 16, y: 160, wrap_chars: 30, glyphs: 'Dat heb je redelijk gedaan Elly!\nIk bedoel: Ei La!' });
		});
	}
}

@insavegame
export class TitleScreen extends SpriteObject {
	private static readonly SELECT_PLAYER_1_Y = 144;
	private static readonly SELECT_PLAYER_2_Y = 160;
	private static readonly CURSOR_X = 80;
	private static readonly BLINK_TIMELINE_ID = 'title-screen.blink';

	private selectedPlayers: 1 | 2 = 1;
	private cursorY = TitleScreen.SELECT_PLAYER_1_Y;
	private blinkPaused = false;
	private _cursorSprite!: SpriteComponent;

	private get cursorVisible(): boolean { return this._cursorSprite.enabled; }
	private set cursorVisible(visible: boolean) {
		this._cursorSprite.enabled = visible;
	}

	@build_fsm()
	public static bouw(): StateMachineBlueprint {
		return {
			states: {
				_default: {
					timelines: {
						[TitleScreen.BLINK_TIMELINE_ID]: {
							frames: [true, false],
							ticks_per_frame: 20,
							playback_mode: 'loop',
							autoplay: true,
						},
					},
					entering_state(this: TitleScreen) {
						this.resetMenu();
					},
					on: {
						reset: {
							go(this: TitleScreen) {
								this.resetMenu();
							},
						},
						[`timeline.frame.${TitleScreen.BLINK_TIMELINE_ID}`]: {
							scope: 'self',
							go(this: TitleScreen, _state: State, event: GameEvent<'timeline.frame', TimelineFrameEventPayload<boolean>>) {
								this.handleBlinkFrame(event.frame_value === true);
							},
						},
					},
					process_input(this: TitleScreen) {
						this.processMenuInput();
					},
				},
			},
		};
	}

	constructor(opts?: RevivableObjectArgs) {
		super({ id: 'title', ...opts });
		this.imgid = BitmapId.title;
		this._cursorSprite = new SpriteComponent({ parent_or_id: this, imgid: BitmapId.menu_arrow });
		this._cursorSprite.layer = 'ui';
		this._cursorSprite.collider_local_id = null;
		this.add_component(this._cursorSprite);
		this.cursorVisible = true;
		this.updateCursorPosition();
	}

	private resetMenu(): void {
		this.selectedPlayers = 1;
		this.cursorY = TitleScreen.SELECT_PLAYER_1_Y;
		this.updateCursorPosition();
		this.resumeBlink();
	}

	private processMenuInput(): void {
		const confirmAction = findTriggeredAction(SKIP_ACTIONS);
		if (confirmAction) {
			this.startGame();
			return;
		}

		const navigation = findTriggeredAction(NAVIGATION_ACTIONS);
		if (!navigation) return;
		const direction: -1 | 1 = navigation === 'up' ? -1 : 1;
		this.applySelectionChange(direction);
	}

	private applySelectionChange(direction: -1 | 1): void {
		const nextSelection: 1 | 2 = direction < 0 ? 1 : 2;
		this.setSelection(nextSelection);
	}

	private setSelection(target: 1 | 2): void {
		if (this.selectedPlayers === target) {
			this.resumeBlink();
			return;
		}
		this.selectedPlayers = target;
		this.cursorY = target === 1 ? TitleScreen.SELECT_PLAYER_1_Y : TitleScreen.SELECT_PLAYER_2_Y;
		this.updateCursorPosition();
		this.resumeBlink();
	}

	private updateCursorPosition(): void {
		this._cursorSprite.offset = new_vec3(TitleScreen.CURSOR_X, this.cursorY, 1);
	}

	private handleBlinkFrame(visible: boolean): void {
		if (this.blinkPaused) {
			this.cursorVisible = true;
			return;
		}
		this.cursorVisible = visible;
	}

	private resumeBlink(): void {
		this.blinkPaused = false;
		this.cursorVisible = true;
		this.restartBlinkTimeline();
	}

	private restartBlinkTimeline(): void {
		this.play_timeline(TitleScreen.BLINK_TIMELINE_ID, { rewind: true, snap_to_start: true });
	}

	private pauseBlink(): void {
		if (this.blinkPaused) return;
		this.blinkPaused = true;
		this.cursorVisible = true;
		this.stop_timeline(TitleScreen.BLINK_TIMELINE_ID);
	}

	private startGame(): void {
		this.pauseBlink();
		$.emit('gamestart_selected', this, { numOfPlayers: this.selectedPlayers });
	}
}

@insavegame
export class Gordijn extends WorldObject {
	private static readonly TIMELINE_ID = 'gordijn.close';
	private width = 0;

	@build_fsm()
	public static bouw(): StateMachineBlueprint {
		return {
			states: {
				_default: {
					initial: 'idle',
					states: {
						idle: {
							entering_state(this: Gordijn) {
								this.width = 0;
							},
							on: {
								its_curtains: '../closing',
								reset: {
									go(this: Gordijn) {
										this.width = 0;
									},
								},
							},
						},
						closing: {
							timelines: {
								[Gordijn.TIMELINE_ID]: {
									frames: [8],
									ticks_per_frame: 2,
									repetitions: 256 / 8,
									autoplay: false,
								},
							},
							entering_state(this: Gordijn) {
								this.width = 0;
								this.play_timeline(Gordijn.TIMELINE_ID, { rewind: true, snap_to_start: true });
							},
							on: {
								[`timeline.frame.${Gordijn.TIMELINE_ID}`]: {
									scope: 'self',
									go(this: Gordijn, _state: State, event: GameEvent<'timeline.frame', TimelineFrameEventPayload<number>>) {
										this.width += event.frame_value;
									},
								},
					[`timeline.end.${Gordijn.TIMELINE_ID}`]: {
									scope: 'self',
									go(this: Gordijn, _state: State, _event: GameEvent<'timeline.end', TimelineEndEventPayload>) {
										$.emit('curtained', this);
										return '../idle';
									},
								},
								reset: '../idle',
							},
						},
					},
				},
			},
		};
	}

	constructor(opts?: RevivableObjectArgs) {
		super({ id: 'gordijn', ...opts });
		this.getOrCreateCustomRenderer().add_producer(({ rc }) => {
			rc.submit_rect({
				kind: 'fill',
				area: new_area3d(0, 0, this.z + 1, this.width, 192, this.z),
				color: Msx1Colors[0],
				layer: 'ui',
			});
		});
	}
}
