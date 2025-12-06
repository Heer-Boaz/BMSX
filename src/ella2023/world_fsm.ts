import { $, World, build_fsm, new_vec3, State, StateMachineBlueprint, type EventPayload } from 'bmsx';
import { create_gameevent } from 'bmsx/core/game_event';
import { Eila } from './eila';
import { Fighter } from './fighter';
import { Hud } from './hud';
import { AudioId } from './resourceids';
import { Sinterklaas } from './sinterklaas';
import { YieArGameState } from './yieargamestate';
import { GameOver, Gordijn, Hoera, TitleScreen, RETURN_TO_TITLE_EVENT } from './stuff';

export class EilaModelFSM {
	@build_fsm('EilaModelFSM')
	public static bouw(): StateMachineBlueprint {
		return {
			states: {
				_game_start: {
					tick(this: World) {
						return '/titlescreen';
					}
				},
				game: {
					entering_state(this: World, _state: State, payload?: EventPayload & { numOfPlayers?: number }) {
						const es = $.get<YieArGameState>('yiear_state');
						if (es) es.numOfPlayers = payload?.numOfPlayers ?? 1;
						return '_ffwachten';
					},
					states: {
						_ffwachten: {
							entering_state(this: World, state: State) {
								$.playaudio(AudioId.start);
								$.emit('its_curtains', this);
								const data = state.data as { waitTicks?: number };
								data.waitTicks = 0;
							},
							on: {
								curtained: {
									lane: 'presentation',
									go() {
										return '../oefenen';
									},
								},
							},
							tick(this: World, state: State) {
								const data = state.data as { waitTicks?: number };
								data.waitTicks = (data.waitTicks ?? 0) + 1;
							},
						},
						oefenen: {
							entering_state(this: World) {
								this.set_space('default');
								this.clear();
								const es = $.get<YieArGameState>('yiear_state');
								es.room_mgr.loadRoom('room1');
								this.spawn(es.room_mgr.rooms[es.currentRoomId], new_vec3(0, 0, 0));
								this.spawn(new Eila(), new_vec3(256 - 60, 0, 11));
								this.spawn(new Hud(), new_vec3(0, 0, 100));
								$.playaudio(AudioId.trainen);
							},
							tick(this: World): string | void {
								const player = this.getWorldObject<Fighter>('player');
								if (player?.x < 16) {
									return '../ffwachten2';
								}
							},
						},
						ffwachten2: {
							entering_state(this: World, state: State) {
								this.set_space('niets');
								const data = state.data as { waitTicks?: number };
								data.waitTicks = 0;
							},
							tick(this: World, state: State) {
								const data = state.data as { waitTicks?: number };
								data.waitTicks = (data.waitTicks ?? 0) + 1;
								if (data.waitTicks >= 50) return '../knokken';
							},
						},
						knokken: {
							entering_state(this: World) {
								this.set_space('default');
								this.clear();
								const es = $.get<YieArGameState>('yiear_state');
								es.room_mgr.loadRoom('room2');
								this.spawn(es.room_mgr.rooms[es.currentRoomId], new_vec3(0, 0, 0));
								this.spawn(new Eila(), new_vec3(256 - 60, 0, 11));
								this.spawn(new Sinterklaas({ aied: ($.get<YieArGameState>('yiear_state')?.numOfPlayers ?? 1) === 1 }), new_vec3(60, 0, 10));
								this.spawn(new Hud(), new_vec3(0, 0, 100));
								$.playaudio(AudioId.knokken);
							},
						},
					},
				},
				gameover: {
					entering_state(this: World) {
						this.set_space('gameover');
						if (!this.getWorldObject('gameover')) {
							this.spawn(new GameOver(), new_vec3(0, 0, 0));
						}
						$.playaudio(AudioId.gameover);
						const splash = this.getFromCurrentSpace<GameOver>('gameover');
						const resetEvent = create_gameevent({ type: 'reset', emitter: this });
						splash.sc.dispatch_event(resetEvent);
					},
					on: {
						[RETURN_TO_TITLE_EVENT]: '/titlescreen',
						[`timeline.frame.${GameOver.TIMEOUT_TIMELINE_ID}`]: {
							scope: 'gameover',
							go() {
								return '/titlescreen';
							},
						},
					},
				},
				hoera: {
					entering_state(this: World) {
						this.set_space('hoera');
						if (!this.getWorldObject('hoera')) {
							this.spawn(new Hoera(), new_vec3(0, 0, 0));
						}
						$.playaudio(AudioId.gameover);
						const splash = this.getFromCurrentSpace<Hoera>('hoera');
						const resetEvent = create_gameevent({ type: 'reset', emitter: this });
						splash.sc.dispatch_event(resetEvent);
					},
					on: {
						[RETURN_TO_TITLE_EVENT]: '/titlescreen',
						[`timeline.frame.${Hoera.TIMEOUT_TIMELINE_ID}`]: {
							scope: 'hoera',
							go() {
								return '/titlescreen';
							},
						},
					},
				},
				titlescreen: {
					entering_state(this: World) {
						$.stopmusic();
						this.set_space('titlescreen');
						if (!this.getWorldObject('title')) {
							this.spawn(new TitleScreen(), new_vec3(0, 0, 0));
						}
						const title = this.getFromCurrentSpace('title');
						const titleEvent = create_gameevent({ type: 'reset', emitter: this });
						title.sc.dispatch_event(titleEvent);
						if (!this.getWorldObject('gordijn')) {
							this.spawn(new Gordijn(), new_vec3(0, 0, 100));
						}
						const curtain = this.getFromCurrentSpace('gordijn');
						const curtainEvent = create_gameevent({ type: 'reset', emitter: this });
						curtain.sc.dispatch_event(curtainEvent);
					},
					on: {
						gamestart_selected: '/game',
					},
				},
			}
		};
	}
}
