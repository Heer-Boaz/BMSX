import { $, World, build_fsm, new_vec3, State, StateMachineBlueprint } from '../bmsx';
import { Eila } from './eila';
import { Fighter } from './fighter';
import { Hud } from './hud';
import { AudioId } from './resourceids';
import { Sinterklaas } from './sinterklaas';
import { EilaGameState } from './state';
import { GameOver, Gordijn, Hoera, TitleScreen } from './stuff';

export class EilaModelFSM {
    @build_fsm('model')
    public static bouw(): StateMachineBlueprint {
        return {
            substates: {
                _game_start: {
                    tick(this: World) {
                        return 'titlescreen';
                    }
                },
                game: {
                    entering_state(this: World, _state: State, { numOfPlayers }: { numOfPlayers: number }) {
                        const es = this.get<EilaGameState>('eila_state');
                        if (es) es.numOfPlayers = numOfPlayers;
                        return '#this.ffwachten';
                    },
                    substates: {
                        _ffwachten: {
                            ticks2advance_tape: 150,
                            entering_state(this: World) {
                                $.playAudio(AudioId.start);
                                $.event_emitter.emit('its_curtains', this);
                            },
                            tape_end: () => 'oefenen',
                        },
                        oefenen: {
                            entering_state(this: World) {
                                this.setSpace('default');
                                this.clear();
                                const es = this.get<EilaGameState>('eila_state');
                                es.room_mgr.loadRoom('room1');
                                this.spawn(es.room_mgr.rooms[es.currentRoomId], new_vec3(0, 0, 0));
                                this.spawn(new Eila(), new_vec3(256 - 60, 0, 11));
                                this.spawn(new Hud(), new_vec3(0, 0, 100));
                                $.playAudio(AudioId.trainen);
                            },
                            tick(this: World): string | void {
                                const player = this.getGameObject<Fighter>('player');
                                if (player?.x < 16) {
                                    return 'ffwachten2';
                                }
                            },
                        },
                        ffwachten2: {
                            ticks2advance_tape: 50,
                            entering_state(this: World) {
                                this.setSpace('niets');
                            },
                            tape_end: () => 'knokken',
                        },
                        knokken: {
                            entering_state(this: World) {
                                this.setSpace('default');
                                this.clear();
                                const es = this.get<EilaGameState>('eila_state');
                                es.room_mgr.loadRoom('room2');
                                this.spawn(es.room_mgr.rooms[es.currentRoomId], new_vec3(0, 0, 0));
                                this.spawn(new Eila(), new_vec3(256 - 60, 0, 11));
                                this.spawn(new Sinterklaas((this.get<EilaGameState>('eila_state')?.numOfPlayers ?? 1) === 1), new_vec3(60, 0, 10));
                                this.spawn(new Hud(), new_vec3(0, 0, 100));
                                $.playAudio(AudioId.knokken);
                            },
                        },
                    },
                },
                gameover: {
                    entering_state(this: World) {
                        this.setSpace('gameover');
                        if (!this.getGameObject('gameover')) {
                            this.spawn(new GameOver(), new_vec3(0, 0, 0));
                        }
                        $.playAudio(AudioId.gameover);
                    },
                },
                hoera: {
                    entering_state(this: World) {
                        this.setSpace('hoera');
                        if (!this.getGameObject('hoera')) {
                            this.spawn(new Hoera(), new_vec3(0, 0, 0));
                        }
                        $.playAudio(AudioId.gameover);
                    },
                },
                titlescreen: {
                    entering_state(this: World) {
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
                    event_handlers: {
                        gamestart_selected: 'game',
                    },
                },
            }
        };
    }
}
