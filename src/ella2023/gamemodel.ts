import { $, BaseModel, build_fsm, Direction, GameObject, InputMap, insavegame, MSX1ScreenHeight, MSX1ScreenWidth, new_vec3, State, StateMachineBlueprint, subscribesToGlobalEvent } from '../bmsx';
import { Eila } from './eila';
import { Fighter } from './fighter';
import { Hud } from './hud';
import { gamepadInputMapping, keyboardInputMapping } from './inputmapping';
import { AudioId } from './resourceids';
import { RoomMgr } from './roommgr';
import { Sinterklaas } from './sinterklaas';
import { GameOver, Gordijn, Hoera, TitleScreen } from './stuff';

@insavegame
export class gamemodel extends BaseModel {
	private _currentRoomId: string;
	public get currentRoomId(): string { return this._currentRoomId; }
	public set currentRoomId(room_id: string) { this._currentRoomId = room_id; }
	public room_mgr: RoomMgr;
	public numOfPlayers: number;

	public static readonly SINT_START_HP = 100;
	public static readonly EILA_START_HP = 100;
	public static readonly VERTICAL_POSITION_FIGHTERS = 176;

	public theOtherFighter(fighterAskingForTheOther: Fighter): Fighter {
		if (fighterAskingForTheOther.id === 'player') return this.getGameObject('sinterklaas');
		else return this.getGameObject('player');
	}

	@subscribesToGlobalEvent('hit_animation_end')
	public handleHitAnimationEndEvent(_event_name: string, emitter: Fighter): void {
		const model = $.modelAs<gamemodel>();
		const otherFighter = model.theOtherFighter(emitter);
		if (otherFighter) {
			otherFighter.hideHitMarker();
			otherFighter.sc.transition_to('hitanimation.geen_au');
		}

		if (emitter.hp <= 0) {
			emitter.hp = 0;
			$.stopMusic();

			// Handle that fighter is down
			emitter.sc.dispatch_event('go_humiliated', emitter);
			if (otherFighter) {
				otherFighter.sc.dispatch_event('go_stoerheidsdans', otherFighter);
			}
		}
	}

	@subscribesToGlobalEvent('humiliated_animation_end')
	public handleHumiliationAnimationEndEvent(_event_name: string, _emitter: Fighter, { character }: { character: string }): void {
		const player = this.getGameObject<Fighter>('player');
		const sinterklaas = this.getGameObject<Fighter>('sinterklaas');

		// If both fighters are still alive, go back to idle state. Otherwise, go to gameover or hoera.
		const hp_player = player?.hp ?? 0;
		const hp_sinterklaas = sinterklaas?.hp ?? 0;

		if (hp_player > 0 && hp_sinterklaas > 0) {
			sinterklaas.sc.dispatch_event('go_idle', sinterklaas);
			player.sc.dispatch_event('go_idle', player);
			return;
		}

		// If one of the fighters is down, go to gameover or hoera.
		switch (character) { // who is the fighter that is down
			case 'eila':
				this.sc.transition_to('gameover'); // Game over for Eila
				break;
			case 'sinterklaas':
				this.sc.transition_to('hoera'); // Hoera for Eila (Sinterklaas is down)
				break;
		}
	}

	@build_fsm()
	public static bouw(): StateMachineBlueprint {
		return {
			substates: {
				_game_start: {
					tick(this: gamemodel) { // Don't use 'onenter', as the game has not been fully initialized yet before 'onenter' triggers!
						return 'titlescreen';
					}
				},
				game: {
					entering_state(this: gamemodel, _state: State, numOfPlayers: number) {
						this.numOfPlayers = numOfPlayers;
						return '#this.ffwachten';
					},
					substates: {
						_ffwachten: {
							ticks2advance_tape: 150,
							entering_state(this: gamemodel) {
								$.playAudio(AudioId.start);
								$.event_emitter.emit('its_curtains', this);
							},
							tape_end: () => 'oefenen',
						},
						oefenen: {
							entering_state(this: gamemodel) {
								this.setSpace('default');
								this.clear(); // Clear all game objects in the current space
								this.room_mgr.loadRoom('room1');
								this.spawn(this.room_mgr.rooms[this._currentRoomId], new_vec3(0, 0, 0));
								this.spawn(new Eila(), new_vec3(256 - 60, 0, 11));
								this.spawn(new Hud(), new_vec3(0, 0, 100));
								$.playAudio(AudioId.trainen);
							},
							tick(this: gamemodel): string | void {
								const player = this.getGameObject<Fighter>('player');
								if (player.x < 16) {
									return 'ffwachten2';
								}
							},
						},
						ffwachten2: {
							ticks2advance_tape: 50,
							entering_state(this: gamemodel) {
								this.setSpace('niets');
							},
							tape_end: () => 'knokken',
						},
						knokken: {
							entering_state(this: gamemodel) {
								this.setSpace('default');
								this.clear(); // Clear all game objects in the current space
								this.room_mgr.loadRoom('room2');
								this.spawn(this.room_mgr.rooms[this._currentRoomId], new_vec3(0, 0, 0));
								this.spawn(new Eila(), new_vec3(256 - 60, 0, 11));
								this.spawn(new Sinterklaas(this.numOfPlayers === 1), new_vec3(60, 0, 10));
								this.spawn(new Hud(), new_vec3(0, 0, 100));
								$.playAudio(AudioId.knokken);
							},
						},
					},
					tick: BaseModel.defaultrun,
				},
				gameover: {
					entering_state(this: gamemodel) {
						this.setSpace('gameover');
						if (!this.getGameObject('gameover')) {
							this.spawn(new GameOver(), new_vec3(0, 0, 0));
						}
						$.playAudio(AudioId.gameover);
					},
					tick: BaseModel.defaultrun,
				},
				hoera: {
					entering_state(this: gamemodel) {
						this.setSpace('hoera');
						if (!this.getGameObject('hoera')) {
							this.spawn(new Hoera(), new_vec3(0, 0, 0));
						}
						$.playAudio(AudioId.gameover);
					},
					tick: BaseModel.defaultrun,
				},
				titlescreen: {
					entering_state(this: gamemodel) {
						this.setSpace('titlescreen');
						if (!this.getGameObject('title')) {
							this.spawn(new TitleScreen(), new_vec3(0, 0, 0));
						}
						this.getFromCurrentSpace('title').sc.dispatch_event('reset', this);
						if (!this.getGameObject('gordijn')) {
							this.spawn(new Gordijn(), new_vec3(0, 0, 100));
						}
						this.getFromCurrentSpace('gordijn').sc.dispatch_event('reset', this);
					},
					tick: BaseModel.defaultrun,
					event_handlers: {
						gamestart_selected: 'game',
					},
				},
			}
		};
	}

	// DO NOT CHANGE THIS CODE! PLEASE USE STATE DEFS TO HANDLE GAME STARTUP LOGIC!
	// Trying to add logic here will most often result in runtime errors.
	// These runtime errors usually occur because the model was not created and initialized (with states),
	// while creating new game objects that reference the model or the model states
	constructor() {
		super();
	}

	public get constructor_name(): string {
		return this.constructor.name;
	}

	public override do_one_time_game_init(): this {
		const _model = $.modelAs<gamemodel>();
		_model.addSpace('gameover');
		_model.addSpace('hoera');
		_model.addSpace('titlescreen');
		_model.addSpace('niets');

		$.input.getPlayerInput(1).setInputMap({
			keyboard: keyboardInputMapping,
			gamepad: gamepadInputMapping,
		} as InputMap);
		$.input.getPlayerInput(2).setInputMap({
			keyboard: null,
			gamepad: gamepadInputMapping,
		} as InputMap);

		_model.room_mgr = new RoomMgr();
		return this;
	}

	public get gamewidth(): number {
		return MSX1ScreenWidth;
	}

	public get gameheight(): number {
		return MSX1ScreenHeight;
	}

	public collidesWithTile(_o: GameObject, _dir: Direction): boolean {
		return false;
	}

	public isCollisionTile(_x: number, _y: number): boolean {
		return false;
	}
}
