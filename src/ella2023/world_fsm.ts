import { $, World, build_fsm, new_vec3, State, StateMachineBlueprint, type EventPayload } from 'bmsx';
import { createGameEvent } from 'bmsx/core/game_event';
import { Eila } from './eila';
import { Fighter } from './fighter';
import { Hud } from './hud';
import { AudioId } from './resourceids';
import { Sinterklaas } from './sinterklaas';
import { YieArGameState } from './yieargamestate';
import { GameOver, Gordijn, Hoera, TitleScreen } from './stuff';

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
							ticks2advance_tape: 150,
							entering_state(this: World) {
								$.playAudio(AudioId.start);
								$.emitPresentation('its_curtains', this);
							},
							tape_end: () => '../oefenen',
						},
						oefenen: {
							entering_state(this: World) {
								this.setSpace('default');
								this.clear();
								const es = $.get<YieArGameState>('yiear_state');
								es.room_mgr.loadRoom('room1');
								this.spawn(es.room_mgr.rooms[es.currentRoomId], new_vec3(0, 0, 0));
								this.spawn(new Eila(), new_vec3(256 - 60, 0, 11));
								this.spawn(new Hud(), new_vec3(0, 0, 100));
								$.playAudio(AudioId.trainen);
							},
							tick(this: World): string | void {
								const player = this.getWorldObject<Fighter>('player');
								if (player?.x < 16) {
									return '../ffwachten2';
								}
							},
						},
						ffwachten2: {
							ticks2advance_tape: 50,
							entering_state(this: World) {
								this.setSpace('niets');
							},
							tape_end: () => '../knokken',
						},
						knokken: {
							entering_state(this: World) {
								this.setSpace('default');
								this.clear();
								const es = $.get<YieArGameState>('yiear_state');
								es.room_mgr.loadRoom('room2');
								this.spawn(es.room_mgr.rooms[es.currentRoomId], new_vec3(0, 0, 0));
								this.spawn(new Eila(), new_vec3(256 - 60, 0, 11));
								this.spawn(new Sinterklaas({ aied: ($.get<YieArGameState>('yiear_state')?.numOfPlayers ?? 1) === 1 }), new_vec3(60, 0, 10));
								this.spawn(new Hud(), new_vec3(0, 0, 100));
								$.playAudio(AudioId.knokken);
							},
						},
					},
				},
				gameover: {
					entering_state(this: World) {
						this.setSpace('gameover');
						if (!this.getWorldObject('gameover')) {
							this.spawn(new GameOver(), new_vec3(0, 0, 0));
						}
						$.playAudio(AudioId.gameover);
					},
				},
				hoera: {
					entering_state(this: World) {
						this.setSpace('hoera');
						if (!this.getWorldObject('hoera')) {
							this.spawn(new Hoera(), new_vec3(0, 0, 0));
						}
						$.playAudio(AudioId.gameover);
					},
				},
				titlescreen: {
					entering_state(this: World) {
						this.setSpace('titlescreen');
						if (!this.getWorldObject('title')) {
							this.spawn(new TitleScreen(), new_vec3(0, 0, 0));
						}
						const title = this.getFromCurrentSpace('title');
						const titleEvent = createGameEvent({ type: 'reset', emitter: this });
						title.sc.dispatch_event(titleEvent);
						if (!this.getWorldObject('gordijn')) {
							this.spawn(new Gordijn(), new_vec3(0, 0, 100));
						}
						const curtain = this.getFromCurrentSpace('gordijn');
						const curtainEvent = createGameEvent({ type: 'reset', emitter: this });
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
