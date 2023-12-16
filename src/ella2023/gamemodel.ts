import { Room, RoomMgr } from './roommgr';
import { Sinterklaas } from './sinterklaas';
import { MSX1ScreenWidth, MSX1ScreenHeight } from '../bmsx/msx';
import { sstate, statedef_builder, machine_states } from '../bmsx/bfsm';
import { insavegame } from '../bmsx/gameserializer';
import { get_gamemodel, new_vec3 } from '../bmsx/bmsx';
import { GameObject } from '../bmsx/gameobject';
import { BaseModel } from '../bmsx/model';
import { Player } from './eila';
import type { Direction } from "../bmsx/bmsx";

@insavegame
export class gamemodel extends BaseModel {
    private _currentRoomId: string;
    public get currentRoomId(): string { return this._currentRoomId; }
    public set currentRoomId(room_id: string) { this._currentRoomId = room_id; }
    public room_mgr: RoomMgr;

    @statedef_builder
    public static bouw(): machine_states {
        return {
            states: {
                _game_start: {
                    run(this: gamemodel, s: sstate) { // Don't use 'onenter', as the game has not been fully initialized yet before 'onenter' triggers!
                        this.state.to('default');
                    }
                },
                default: {
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
        _model.room_mgr = new RoomMgr();
        _model.room_mgr.loadRoom('room2');
        _model.spawn(_model.room_mgr.rooms[_model._currentRoomId], new_vec3(0, 0, 0));
        _model.spawn(new Player(), new_vec3(100, 100, 10));
        _model.spawn(new Sinterklaas(), new_vec3(10, 95, 0));
        return this;
    }

    public get gamewidth(): number {
        return MSX1ScreenWidth;
    }

    public get gameheight(): number {
        return MSX1ScreenHeight;
    }

    public collidesWithTile(o: GameObject, dir: Direction): boolean {
        return false;
    }

    public isCollisionTile(x: number, y: number): boolean {
        return false;
    }
}
