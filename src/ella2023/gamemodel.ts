import { RoomMgr } from './roommgr';
import { Sinterklaas } from './sinterklaas';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { sstate, statedef_builder, machine_states } from '../bmsx/bfsm';
import { insavegame } from '../bmsx/gameserializer';
import { get_gamemodel, new_vec3 } from '../bmsx/bmsx';
import { GameObject } from '../bmsx/gameobject';
import { BaseModel } from '../bmsx/model';
import { Player } from './eila';
import type { Direction } from "../bmsx/bmsx";
import { Fighter } from './fighter';
import { subscribesToGlobalEvent } from '../bmsx/eventemitter';
import { Hud } from './hud';
import { Input, InputMap } from '../bmsx/input';
import { keyboardInputMapping1, gamepadInputMapping } from './inputmapping';
import { GameOver, Hoera, TitleScreen } from './stuff';
import { SM } from '../bmsx/soundmaster';
import { AudioId } from './resourceids';

@insavegame
export class gamemodel extends BaseModel {
    private _currentRoomId: string;
    public get currentRoomId(): string { return this._currentRoomId; }
    public set currentRoomId(room_id: string) { this._currentRoomId = room_id; }
    public room_mgr: RoomMgr;

    public static readonly SINT_START_HP = 100;
    public static readonly EILA_START_HP = 100;
    public static readonly VERTICAL_POSITION_FIGHTERS = 176;

    public theOtherFighter(fighterAskingForTheOther: Fighter): Fighter {
        if (fighterAskingForTheOther.id === 'player') return this.get('sinterklaas');
        else return this.get('player');
    }

    @subscribesToGlobalEvent('hit_animation_end')
    public handleHitAnimationEndEvent(event_name: string, emitter: Fighter): void {
        const model = get_gamemodel<gamemodel>();
        const otherFighter = model.theOtherFighter(emitter);
        if (otherFighter) {
            otherFighter.hideHitMarker();
            otherFighter.sc.to('hitanimation.geen_au');
        }

        if (emitter.hp <= 0) {
            emitter.hp = 0;
            SM.stopMusic();
            emitter.handleFighterStukEvent(event_name, emitter);
        }
    }

    @statedef_builder
    public static bouw(): machine_states {
        return {
            states: {
                _game_start: {
                    run(this: gamemodel) { // Don't use 'onenter', as the game has not been fully initialized yet before 'onenter' triggers!
                        this.sc.to('titlescreen');
                    }
                },
                default: {
                    enter(this: gamemodel, s: sstate) {
                        s.reset();
                        SM.play(AudioId.start);
                        this.setSpace('niets');
                    },
                    states: {
                        _ffwachten: {
                            ticks2move: 150,
                            end(this: gamemodel) {
                                this.sc.to('gamemodel.default.oefenen');
                            },
                        },
                        oefenen: {
                            enter(this: gamemodel) {
                                this.setSpace('default');
                                this.clear(); // Clear all game objects in the current space
                                this.room_mgr.loadRoom('room1');
                                this.spawn(this.room_mgr.rooms[this._currentRoomId], new_vec3(0, 0, 0));
                                this.spawn(new Player(), new_vec3(256 - 60, 0, 11));
                                this.spawn(new Hud(), new_vec3(0, 0, 100));
                                SM.play(AudioId.trainen);
                            },
                            run(this: gamemodel) {
                                const player = this.get('player');
                                if (player.x < 16) {
                                    this.sc.to('gamemodel.default.ffwachten2');
                                }
                            },
                        },
                        ffwachten2: {
                            ticks2move: 50,
                            enter(this: gamemodel) {
                                this.setSpace('niets');
                            },
                            end(this: gamemodel) {
                                this.sc.to('gamemodel.default.knokken');
                            },
                        },
                        knokken: {
                            enter(this: gamemodel) {
                                this.setSpace('default');
                                this.clear(); // Clear all game objects in the current space
                                this.room_mgr.loadRoom('room2');
                                this.spawn(this.room_mgr.rooms[this._currentRoomId], new_vec3(0, 0, 0));
                                this.spawn(new Player(), new_vec3(256 - 60, 0, 11));
                                this.spawn(new Sinterklaas(), new_vec3(60, 0, 10));
                                this.spawn(new Hud(), new_vec3(0, 0, 100));
                                SM.play(AudioId.knokken);
                            },
                        },
                    },
                    run: BaseModel.defaultrun,
                },
                gameover: {
                    enter(this: gamemodel) {
                        this.setSpace('gameover');
                        if (!this.get('gameover')) {
                            this.spawn(new GameOver(), new_vec3(0, 0, 0));
                        }
                        SM.play(AudioId.gameover);
                    },
                    run: BaseModel.defaultrun,
                },
                hoera: {
                    enter(this: gamemodel) {
                        this.setSpace('hoera');
                        if (!this.get('hoera')) {
                            this.spawn(new Hoera(), new_vec3(0, 0, 0));
                        }
                        SM.play(AudioId.gameover);
                    },
                    run: BaseModel.defaultrun,
                },
                titlescreen: {
                    enter(this: gamemodel) {
                        this.setSpace('titlescreen');
                        if (!this.get('title')) {
                            this.spawn(new TitleScreen(), new_vec3(0, 0, 0));
                        }
                    },
                    run: BaseModel.defaultrun,
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
        const _model = get_gamemodel<gamemodel>();
        _model.addSpace('gameover');
        _model.addSpace('hoera');
        _model.addSpace('titlescreen');
        _model.addSpace('niets');

        Input.getPlayerInput(1).setInputMap({
            keyboard: keyboardInputMapping1,
            gamepad: gamepadInputMapping,
        } as InputMap);
        Input.getPlayerInput(2).setInputMap({
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
