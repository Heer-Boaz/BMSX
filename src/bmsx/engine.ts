import { DrawImgFlags, BaseView } from "./view";
import { SM } from "./soundmaster";
import { Input } from "./input";
import { RomLoadResult } from "./rompack";
import { MSX2ScreenWidth, MSX2ScreenHeight, TileSize } from "./msx";
import { Point, Area, moveArea, Size, Direction, mod } from "./common";
import { BaseModelOld } from './basemodel_old';
import { BaseControllerOld } from './basecontroller_old';
import { parse, stringify } from 'Flatted';

declare global {
    namespace NodeJS {
        interface Global {
            game: Game;
            model: BaseModel | BaseModelOld;
            controller: BaseControllerOld;
            view: BaseView;
        }
    }
}

// export let game: Game;
// export let model: BaseModel | BaseModelOld;
// export let controller: BaseControllerOld;
// export let view: BaseView;

const fps: number = 50;
const fpstime: number = 1000 / fps;

//@insavegame
export class GameOptions {
    public static readonly INITIAL_SCALE: number = 1;
    public static readonly INITIAL_FULLSCREEN: boolean = false;

    public static Scale: number = GameOptions.INITIAL_SCALE;
    public static Fullscreen: boolean = GameOptions.INITIAL_FULLSCREEN;
    public static VolumePercentage: number = 50;
    public static MusicVolumePercentage: number = 50;

    public static get WindowWidth(): number {
        return (MSX2ScreenWidth * GameOptions.Scale);
    }

    public static get WindowHeight(): number {
        return (MSX2ScreenHeight * GameOptions.Scale);
    }

    public static get BufferWidth(): number {
        return (MSX2ScreenWidth * GameOptions.Scale);
    }

    public static get BufferHeight(): number {
        return (MSX2ScreenHeight * GameOptions.Scale);
    }
}

export module Constants {
    export const IMAGE_PATH: string = 'rom/Graphics/';
    export const AUDIO_PATH: string = 'rom/';

    export const SaveSlotCount: number = 6;
    export const SaveSlotCheckpoint: number = -1;
    export const SaveGamePath: string = "./Saves/sintervania.sa";
    export const CheckpointGamePath: string = "./Saves/sintervania.chk";
    export const OptionsPath: string = "./sintervania.ini";
}

export const enum BSTEventType {
    None = 0,
    Run = 1,
    Enter = 2,
    Exit = 3,
    Next = 4,
    End = 5,
}

export type str2bss = { [key: string]: bss; };
export type bsfthandle = (state: bss, ik: any, type: BSTEventType) => void;
export type numstring = number | string;

@insavegame
export class bss {
    public id: numstring;
    public parent: bst;
    public ik: any;
    public start?: boolean; // Is this a start state?
    public init?: boolean; // Should this state be initiated when this is a start state?

    @onsave
    public static onSave(me: bss) {
        let result = Object.assign(new bss(undefined), me);

        result.ik = undefined;
        result.parent = undefined;

        return result;
    }

    // @onrevive
    // public static onLoad(loaded: bss, parent: bst): bss {
        // let keys = Object.keys(loaded.savedStates);
        // for (let key in keys) {
        //     Object.assign(loaded.states[key], loaded.savedStates[key]);
        // }
        // Object.assign(parent.states[loaded.id], loaded);
        // return undefined;
    // }

    public constructor(_id: numstring = 0, _partialdef?: Partial<bss>) {
        this.id = _id;
        this.nudges2move = 1;
        if (_partialdef) Object.assign(this, _partialdef);
        this.reset();
    }

    public get current(): any { return (this.tape && this.head < this.tape.length) ? this.tape[this.head] : undefined; };
    public get atEnd(): boolean { return !this.tape || this.head === this.tape.length - 1; }
    public get atStart(): boolean { return this.head === 0; }
    public onrun: bsfthandle;
    public onfinal: bsfthandle;
    public onend: bsfthandle;
    public onnext: bsfthandle;
    public onenter: bsfthandle;
    public onexit: bsfthandle;
    public get internalstate() { return { statedata: this.tape, tapehead: this.head, nudges: this.nudges, nudges2move: this.nudges2move }; }
    public getTarget<T>(): T { return this.ik; }

    public tape: any[];

    public nudges2move: number; // Number of runs before tapehead moves to next statedata
    protected _tapehead: number;
    public get head(): number {
        return this._tapehead;
    }
    public set head(v: number) {
        this._nudges = 0; // Always reset tapehead nudges after moving tapehead
        // Check if the tape already was at the end
        if (this.tape && (this._tapehead >= this.tape.length - 1)) {
            // If so, rewind and move to the first element of the tapehead
            // But why? (Yes... Why?) Because we then can loop an animation,
            // including the first and last element of the tape, without having
            // to resort to any workarounds like duplicating the first entry
            // of the tape or similar.
            this._tapehead = 0;
        }
        else {
            // Else, move the tape ahead
            this._tapehead = v;
        }
        this.tapemove(); // Move the tape and trigger an event
        // Check if the tape now is at the end
        if (this.tape && (this._tapehead >= this.tape.length - 1)) {
            // If so, trigger the event for reaching the end of the tape
            this.tapeend();
        }
    }

    public setHeadNoSideEffect(v: number) {
        this._tapehead = v;
    }

    public setHeadNudgesNoSideEffect(v: number) {
        this._nudges = v;
    }

    protected _nudges: number;
    public get nudges(): number {
        return this._nudges;
    }
    public set nudges(v: number) {
        this._nudges = v;
        if (v >= this.nudges2move) { ++this.head; }
    }

    // Helper function to set all handlers
    public setAllHandlers(handler: bsfthandle): void {
        this.onrun = handler;
        this.onfinal = handler;
        this.onend = handler;
        this.onnext = handler;
        this.onenter = handler;
        this.onexit = handler;
    }

    protected tapemove() {
        this.onnext?.(this, this.ik, BSTEventType.Next);
    }

    protected tapeend() {
        this.onend?.(this, this.ik, BSTEventType.End);
    }

    public reset(): void {
        this._tapehead = 0;
        this._nudges = 0;
    }
}
// bss.prototype.toJSON = function () {
//     let self = <bss><unknown>this;
//     self.parent = undefined;
//     self.ik = undefined;

//     return Generic_toJSON(bss.name, self);
// }

const BST_MAX_HISTORY = 10;
const DEFAULT_BST_ID = 'master';
@insavegame
export class bst {
    @onsave
    public static onSave(me: bst) {
        let result = Object.assign(new bst(undefined), me);

        result.ik = undefined;
        result.states = { ...me.states };
        result.savedStates = { ...me.states };
        let keys = Object.keys(result.states);
        for (let key of keys) {
            result.states[key] = undefined;
            delete result.states[key];
        }

        return result;
    }

    // @onrevive
    // public static onLoad(loaded: bst, parent: cbst): bst {
    //     let keys = Object.keys(loaded.savedStates);
    //     for (let key in keys) {
    //         Object.assign(loaded.states[key], loaded.savedStates[key]);
    //     }
    //     return undefined;
    //     // return obj_toJSON(loaded, this);
    // }

    public id: numstring;
    public ik: any;
    protected initstateid: numstring;

    public states: str2bss; // Note that numbers will be automatically converted to strings!
    public savedStates: str2bss; // When serialized, place states here, so that they can be revived without overwriting function-properties
    public currentid: numstring; // Identifier of current state
    // protected previousid: numstring; // Identifier of the previous state
    protected history: Array<numstring>; // History of previous states
    public paused: boolean;
    public get current(): bss { return this.states[this.currentid]; };
    // public get previous(): bss { return this.states[this.previousid]; };

    constructor(ik: object, id?: string) {
        this.id = id ?? DEFAULT_BST_ID;
        this.ik = ik;
        this.states = {};
        this.paused = false;
        this.initstateid = null;
        this.reset();
        console.info(`Ik (${id}) als BST ben geconstruct!`);
    }

    public setStart(_id: numstring, init = true): void {
        this.initstateid = _id;
        this.currentid = _id;
        if (init) this.current.onenter?.(this.current, this.ik, BSTEventType.Enter);
    }

    public create(id: numstring, ik: any): bss {
        if (this.states[id]) throw new Error(`State ${id} already exists for state machine!`);
        let result = new bss(id);
        this.states[id] = result;
        result.parent = this;
        result.ik ??= ik;
        // if (!this.initstateid) this.setStart(id_or_state); // If no start-state was defined, we assign this as a default start state
        return result;
    }

    public add(ik: any, ...states: bss[]): void {
        for (let state of states) {
            if (!state.id) throw new Error(`State is missing an id, while attempting to add it to this bst!`);
            if (this.states[state.id]) throw new Error(`State ${state.id} already exists for state machine!`);
            this.states[state.id] = state;
            state.parent = this;
            state.ik ??= ik;
            if (state.start) this.setStart(state.id, state.init ?? true); // If designated as a start state, assign it as the start state
        }
    }

    public run(): void {
        if (this.paused) return;
        this.current?.onrun?.(this.current, this.ik, BSTEventType.Run);
    }

    public to(newstate: numstring): void {
        this.current.onexit?.(this.current, this.ik, BSTEventType.Exit);
        this.pushHistory(this.currentid); // Store the previous state on the history stack
        this.currentid = newstate; // Switch the current state to the new state
        if (!this.current) throw new Error(`State "${newstate}" doesn't exist for this state machine!`);
        this.current.onenter?.(this.current, this.ik, BSTEventType.Enter);
    }

    protected pushHistory(toPush: numstring): void {
        this.history.push(toPush);
        if (this.history.length > BST_MAX_HISTORY)
            this.history.shift(); // Remove the first element in the history-array
    }

    public pop(): void {
        if (this.history.length <= 0) return;
        let poppedStateId = this.history.pop();
        this.to(poppedStateId);
    }

    public reset(): void {
        this.currentid = this.initstateid;
        this.history = new Array();
        this.paused = false;
    }

    public append(_state: bss, _id: numstring): void {
        this.states[_id] = _state;
    }

    public remove(_id: numstring): void {
        delete this.states[_id];
    }
}

export type numstr2bst = { [key: string]: bst; };
@insavegame
export class cbst {
    public machines: numstr2bst;
    public savedMachines: numstr2bst;
    public paused: boolean;

    @onsave
    public static onSave(me: cbst): any {
        let result = Object.assign(new cbst(), me);

        result.machines = { ...me.machines };
        result.savedMachines = { ...me.machines };
        let keys = Object.keys(result.machines);
        for (let key of keys) {
            result.machines[key] = undefined;
            delete result.machines[key];
        }

        return result;
    }

    constructor() {
        this.machines = {};
        this.savedMachines = undefined;
        this.paused = false;
        this.addBst(DEFAULT_BST_ID);
    }

    public onload(): void {
        let machineIds = Object.keys(this.savedMachines);
        for (let machineId of machineIds) {
            let currentMachine = this.machines[machineId];
            let currentSavedMachine = this.savedMachines[machineId];

            let bstKeys = Object.keys(currentMachine);
            for (let bstKey of bstKeys) {
                switch (bstKey) {
                    case 'ik': break
                    case 'states': break;
                    case 'savedStates': break;
                    default:
                        currentMachine[bstKey] = currentSavedMachine[bstKey];
                }
            }
            let stateIds = Object.keys(currentMachine.states);
            for (let stateId of stateIds) {
                let state = currentMachine.states[stateId];
                let savedState = currentSavedMachine.savedStates[stateId];

                Object.assign(state, savedState);
                delete this.savedMachines[machineId];
            }
        }
    }

    public getBst(machine_id: string): bst {
        return this.machines[machine_id];
    }

    public getCurrentId(machine_id: string = DEFAULT_BST_ID): numstring {
        return this.machines[machine_id].currentid;
    }

    public addBst(machine_id: string): bst {
        let result = new bst(this, machine_id);
        this.machines[machine_id] = result;

        return result;
    }

    public removeBst(machine_id: string): bst {
        let result = this.machines[machine_id];
        delete this.machines[machine_id];
        this.machines[machine_id] = undefined;
        return result;
    }

    public createState(state_id: numstring, machine_id: string = DEFAULT_BST_ID): bss {
        return this.machines[machine_id].create(state_id, this);
    }

    public add(...states: bss[]): void {
        this.addTo(DEFAULT_BST_ID, ...states);
    }

    public addTo(machine_id: string = DEFAULT_BST_ID, ...states: bss[]): void {
        this.machines[machine_id].add(this, ...states);
    }

    public run(): void {
        if (this.paused) return;
        for (const key of Object.keys(this.machines)) {
            this.machines[key].run();
        }
    }

    public setStart(_id: numstring, init = true, machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].setStart(_id, init);
    }

    public to(newstate: numstring, machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].to(newstate);
    }

    public pop(machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].pop();
    }

    public reset(machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].reset();
    }

    public append(_state: bss, _id: numstring, machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].append(_state, _id);
    }

    public remove(_id: numstring, machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].remove(_id);
    }
}

// @insavegame
export class Savegame {
    objects: IGameObject[];
    modelprops: {};
}

// @insavegame
export abstract class BaseModel extends cbst {
    public id2object: { [key: string]: IGameObject; };
    public objects: IGameObject[];
    public paused: boolean;
    public startAfterLoad: boolean;
    public abstract get gamewidth(): number;
    public abstract get gameheight(): number;

    public static serializeObj(obj: any) {
        let cache = [];
        return JSON.stringify(obj, function (key, value) {
            if (Array.isArray(value)) return value;
            let type = typeof value;
            switch (type) {
                case 'object':
                    if (cache.includes(value)) return undefined;
                    cache.push(value);
                    return value;
                case 'function':
                    return undefined;
                default:
                    return value;
            }
        });
    }

    constructor() {
        super();
        this.objects = [];
        this.id2object = {};

        this.paused = false;

        // Create default state for running the game
        this.add(new bss('default', {
            onrun: this.defaultrun,
            start: true,
        }));
        console.info('Ik ben gerevived!!');
    }

    public load(serialized: string): void {
        this.clear();
        let savegame = JSON.parse(serialized, Reviver) as Savegame;
        Object.assign(this, savegame.modelprops);
        savegame.objects.forEach(o => (o.onload?.(), this.spawn(o)));

    }

    public save(): string {
        global.game.paused = true;
        let createSavegame = () => {
            let keys = Object.keys(this);
            let data = {};
            for (let index = 0; index < keys.length; ++index) {
                let key = keys[index];
                if (key === 'objects' || key === 'id2object') continue;
                if (this[key] !== null && this[key] !== undefined) {
                    data[key] = this[key];
                }
            }
            let result = new Savegame();
            result.objects = this.objects;
            result.modelprops = data;

            return result;
        };

        let savegame = createSavegame();
        global.game.paused = false;
        return BaseModel.serializeObj(savegame);
    }

    public defaultrun(_, ik: BaseModel): void {
        if (ik.paused) {
            return;
        }
        if (ik.startAfterLoad) {
            return;
        }

        let objects = ik.objects;
        // Let all game objects take a turn
        objects.forEach(o => !o.disposeFlag && o.takeTurn());

        // Remove all objects that are to be disposed
        objects.filter(o => o.disposeFlag).forEach(o => ik.exile(o));
    }

    // https://hackernoon.com/3-javascript-performance-mistakes-you-should-stop-doing-ebf84b9de951
    public where_do(predicate: (value: IGameObject, index: number, array: IGameObject[], thisArg?: any) => unknown, callbackfn: (value: IGameObject, index: number, array: IGameObject[], thisArg?: any) => void): void {
        let filteredList = this.objects.filter(predicate);
        for (let i = 0; i < filteredList.length; i++) {
            callbackfn(filteredList[i], i, filteredList, this);
        }
    }

    public clear(): void {
        this.objects.forEach(o => o.ondispose?.());
        this.objects.length = 0;
        delete this.id2object;
        this.id2object = {};
        this.paused = false;
    }

    public sortObjectsByPriority(): void {
        this.objects.sort((o1, o2) => (o2.z || 0) - (o1.z || 0));
    }

    public spawn(o: IGameObject, pos?: Point, ignoreSpawnhandler?: boolean): void {
        this.objects.push(o);

        this.sortObjectsByPriority();

        this.id2object[o.id] = o;
        !ignoreSpawnhandler && o.onspawn?.(pos);
    }

    public exile(o: IGameObject): void {
        let index = this.objects.indexOf(o);
        if (index > -1) {
            delete this.objects[index];
            this.objects.splice(index, 1);
        }

        if (this.id2object[o.id])
            this.id2object[o.id] = undefined;
        o.ondispose?.();
    }

    public exists(id: string): boolean {
        return this.id2object[id] !== undefined;
    }

    public abstract collidesWithTile(o: IGameObject, dir: Direction): boolean;
    public abstract isCollisionTile(x: number, y: number): boolean;
}

export class Game {
    lastTick: number;
    _turnCounter: number;
    animationFrameRequestid: number;
    public running: boolean;
    public paused: boolean;
    wasupdated: boolean;
    public rom: RomLoadResult;

    constructor(_rom: RomLoadResult, _model: BaseModel | BaseModelOld, _view: BaseView, _controller: BaseControllerOld | null, sndcontext: AudioContext, gainnode: GainNode) {
        global['game'] = this;
        this.rom = _rom;

        // model = _model;
        // view = _view;
        // controller = _controller;

        global['model'] = _model;
        global['view'] = _view;
        global['controller'] = _controller;

        BaseView.images = _rom.images;
        global.view.init();
        SM.init(_rom['sndresources'], sndcontext, gainnode);
        Input.init();

        this.running = false;
        this.paused = false;
        this.wasupdated = true;
    }

    public get turnCounter(): number {
        return this._turnCounter;
    }

    public start(): void {
        window.addEventListener('resize', global.view.handleResize, false);
        window.addEventListener('orientationchange', global.view.handleResize, false);
        global.view.handleResize();

        this.running = true;
        this.lastTick = performance.now();
        this.run(performance.now());
    }

    public update(elapsedMs: number): void {
        BStopwatch.updateTimers(elapsedMs);
        global.model.run(elapsedMs);
    }

    public run(tFrame?: number): void {
        let game = global.game;
        if (!game.running) return;

        game.animationFrameRequestid = window.requestAnimationFrame(game.run);
        let nextTick = game.lastTick + fpstime;
        let numTicks = 0;

        // If tFrame < nextTick then 0 ticks need to be updated (0 is default for numTicks).
        // If tFrame = nextTick then 1 tick needs to be updated (and so forth).
        // Note: As we mention in summary, you should keep track of how large numTicks is.
        // If it is large, then either your game was asleep, or the machine cannot keep up.
        if (tFrame > nextTick) {
            let timeSinceTick = tFrame - game.lastTick;
            numTicks = Math.floor(timeSinceTick / fpstime);
        }

        for (let i = 0; i < numTicks; i++) {
            ++game._turnCounter;
            game.lastTick = game.lastTick + fpstime; // Now lastTick is this tick.
            Input.pollGamepadInput();
            game.paused || game.update(game.lastTick);
        }
        global.view.drawgame();
    }

    public stop(): void {
        global.game.running = false;
        window.cancelAnimationFrame(this.animationFrameRequestid);
        window.requestAnimationFrame(() => {
            global.view.clear();
            global.view.handleResize();
            SM.stopEffect();
            SM.stopMusic();
        });
    }
}

export interface IGameObject {
    id: string | null;
    disposeFlag: boolean;
    z?: number;
    pos: Point;
    size?: Size;
    hitarea?: Area;
    hittable?: boolean;
    visible?: boolean;

    hitbox_sx?: number;
    hitbox_sy?: number;
    hitbox_ex?: number;
    hitbox_ey?: number;
    wallhitbox_sx?: number;
    wallhitbox_sy?: number;
    wallhitbox_ex?: number;
    wallhitbox_ey?: number;
    isWall?: boolean;
    disposeOnSwitchRoom?: boolean;

    takeTurn(): void;
    spawn?(spawningPos?: Point): void;
    onspawn?: ((spawningPos?: Point) => void) | (() => void);
    ondispose?: () => void;

    paint?(offset?: Point): void;
    postpaint?(offset?: Point): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite
    objectCollide?(o: IGameObject): boolean;
    areaCollide?(a: Area): boolean;
    collides?(o: IGameObject | Area): boolean;
    collide?(src: IGameObject): void;
    oncollide?: (src: IGameObject) => void;
    onload?: () => void;
    markForDisposure?: () => void;
}

// Shared function used for using as event handler for IGameObject/Sprite.OnLeavingScreen
export function ProhibitLeavingScreenHandler(ik: IGameObject, d: Direction, old_x_or_y: number): void {
    switch (d) {
        case Direction.Left: case Direction.Right:
            ik.pos.x = old_x_or_y;
            break;
        case Direction.Up: case Direction.Down:
            ik.pos.y = old_x_or_y;
            break;
    }
}

//@insavegame
export abstract class Sprite extends cbst implements IGameObject {
    public id: string | null;
    public pos: Point;
    public size: Size;
    protected _hitarea: Area;
    public get hitarea() { return this._hitarea; }
    public set hitarea(value: Area) { this._hitarea = value; }
    public get wallHitarea(): Area { return this.hitarea; }
    public visible: boolean;
    public hittable: boolean;
    public flippedH: boolean;
    public flippedV: boolean;
    public z: number;
    public disposeFlag: boolean;
    public imgid: number;

    public get hitbox_sx(): number {
        return this.pos.x + this.hitarea.start.x;
    }

    public get hitbox_sy(): number {
        return this.pos.y + this.hitarea.start.y;
    }

    public get hitbox_ex(): number {
        return this.pos.x + this.hitarea.end.x;
    }

    public get hitbox_ey(): number {
        return this.pos.y + this.hitarea.end.y;
    }

    public get x_plus_width(): number {
        return this.pos.x + this.size.x;
    }

    public get y_plus_height(): number {
        return this.pos.y + this.size.y;
    }

    public get wallhitbox_sx(): number {
        return this.pos.x + this.wallHitarea.start.x;
    }

    public get wallhitbox_sy(): number {
        return this.pos.y + this.wallHitarea.start.y;
    }

    public get wallhitbox_ex(): number {
        return this.pos.x + this.wallHitarea.end.x;
    }

    public get wallhitbox_ey(): number {
        return this.pos.y + this.wallHitarea.end.y;
    }

    public disposeOnSwitchRoom?: boolean;
    public oncollide?: (src: IGameObject) => void;
    public onWallcollide?: (dir: Direction) => void;
    public onLeaveScreen?: (ik: IGameObject, dir: Direction, old_x_or_y: number) => void;
    public onLeavingScreen?: (ik: IGameObject, dir: Direction, old_x_or_y: number) => void;

    @onsave
    public static onSave(me: Sprite) {
        return super.onSave(me);
    }

    private _direction: Direction;
    public oldDirection: Direction;

    public get direction(): Direction {
        return this._direction;
    }

    public set direction(value: Direction) {
        this.oldDirection = this._direction;
        this._direction = value;
    }

    constructor() {
        super();
        this.pos = { x: 0, y: 0 };
        this.visible = true;
        this.hittable = true;
        this.flippedH = false;
        this.flippedV = false;
        this.z = 0;
        this.disposeFlag = false;
        this.disposeOnSwitchRoom = true;
    }

    /**
    * Gebruik ik als event handler voor e.g. onLeaveScreen
    */
    markForDisposure(): void {
        this.disposeFlag = true;
    }

    spawn(spawningPos: Point = null): Sprite {
        global.model.spawn(this, spawningPos);
        return this; // Voor chaining
    }

    onspawn(spawningPos?: Point): void {
        if (spawningPos) {
            [this.pos.x, this.pos.y] = [spawningPos.x, spawningPos.y];
        }
    }

    takeTurn(): void {
        this.run();
    }

    paint(offset?: Point, colorize?: { r: boolean, g: boolean, b: boolean, a: boolean; }): void {
        let options: number = this.flippedH ? DrawImgFlags.HFLIP : 0;
        options |= (this.flippedV ? DrawImgFlags.VFLIP : 0);
        let dx = offset?.x || 0;
        let dy = offset?.y || 0;

        if (colorize) {
            global.view.drawColoredBitmap(this.imgid, this.pos.x + dx, this.pos.y + dy, options, colorize.r, colorize.g, colorize.b, colorize.a);
        }
        else {
            global.view.drawImg(this.imgid, this.pos.x + dx, this.pos.y + dy, options);
        }
    }

    postpaint(offset?: Point): void {
    }

    static objectCollide(o1: IGameObject, o2: IGameObject): boolean {
        return o1.objectCollide(o2);
    }

    public collides(o: IGameObject | Area): boolean {
        if ((o as IGameObject).id) return this.objectCollide(<IGameObject>o);
        else return this.areaCollide(<Area>o);
    }

    public collide(src: IGameObject): void {
        this.oncollide?.(src);
    }

    objectCollide(o: IGameObject): boolean {
        return this.areaCollide(moveArea(o.hitarea, o.pos));
    }

    areaCollide(a: Area): boolean {
        let o1 = this;
        let o1p = o1.pos;
        let o1a = o1.hitarea;

        let o2a = a;

        return o1p.x + o1a.end.x >= o2a.start.x && o1p.x + o1a.start.x <= o2a.end.x &&
            o1p.y + o1a.end.y >= o2a.start.y && o1p.y + o1a.start.y <= o2a.end.y;
    }

    inside(p: Point): boolean {
        let o1 = this;
        let o1p = o1.pos;
        let o1a = o1.hitarea;

        return o1p.x + o1a.end.x >= p.x && o1p.x + o1a.start.x <= p.x &&
            o1p.y + o1a.end.y >= p.y && o1p.y + o1a.start.y <= p.y;
    }

    public setx(newx: number) {
        let oldx = this.pos.x;
        this.pos.x = ~~newx;
        if (newx < oldx) {
            if (global.model.collidesWithTile(this, Direction.Left)) {
                this.onWallcollide?.(Direction.Up);
                newx += TileSize - mod(newx, TileSize);
            }
            this.pos.x = ~~newx;
            if (newx + this.size.x < 0) { this.onLeaveScreen?.(this, Direction.Left, oldx); }
            else if (newx < 0) { this.onLeavingScreen?.(this, Direction.Left, oldx); }
        }
        else if (newx > oldx) {
            if (global.model.collidesWithTile(this, Direction.Right)) {
                this.onWallcollide?.(Direction.Right);
                newx -= newx % TileSize;
            }
            this.pos.x = ~~newx;
            if (newx >= global.model.gamewidth) { this.onLeaveScreen?.(this, Direction.Right, oldx); }
            else if (newx + this.size.x >= global.model.gamewidth) { this.onLeavingScreen?.(this, Direction.Right, oldx); }
        }
    }

    public sety(newy: number) {
        let oldy = this.pos.y;
        this.pos.y = ~~newy;
        if (newy < oldy) {
            if (global.model.collidesWithTile(this, Direction.Up)) {
                this.onWallcollide?.(Direction.Up);
                newy += TileSize - mod(newy, TileSize);
            }
            this.pos.y = ~~newy;
            if (newy + this.size.y < 0) { this.onLeaveScreen?.(this, Direction.Up, oldy); }
            else if (newy < 0) { this.onLeavingScreen?.(this, Direction.Up, oldy); }
        }
        else if (newy > oldy) {
            if (global.model.collidesWithTile(this, Direction.Down)) {
                this.onWallcollide?.(Direction.Down);
                newy -= newy % TileSize;
            }
            this.pos.y = ~~newy;
            if (newy >= global.model.gameheight) { this.onLeaveScreen?.(this, Direction.Down, oldy); }
            else if (newy + this.size.y >= global.model.gameheight) { this.onLeavingScreen?.(this, Direction.Down, oldy); }
        }
    }
}

// https://stackoverflow.com/questions/8111446/turning-json-strings-into-objects-with-methods
// A generic "smart reviver" function.
// Looks for object values with a `ctor` property and
// a `data` property. If it finds them, and finds a matching
// constructor that has a `fromJSON` property on it, it hands
// off to that `fromJSON` fuunction, passing in the value.
export function Reviver(key: any, value: any) {
    // console.info(`reviver with key = '${key ?? '(null)'}'`);
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value === "object" &&
        typeof value.typename === "string") {
        let theConstructor = Reviver.constructors[value.typename];
        console.info(`Reviving ${value.typename}`);
        let result = Object.assign(new theConstructor(), value);
        let onRevive = Reviver.onRevives[value.typename];
        return onRevive ? onRevive(result, this) : result;
    }
    // ctor = Reviver.constructors[value.ctor] || ;
    // if (typeof ctor === "function" && typeof ctor.prototype.fromJSON === "function") {
    //     return ctor.prototype.fromJSON(value);
    // }
    return value;
}

// return value;
// if (typeof value === "object" &&
//     typeof value.ctor === "string" &&
//     typeof value.data !== "undefined") {
//     let ctor: any;
//     ctor = Reviver.constructors[value.ctor] || window[value.ctor];
//     if (typeof ctor === "function" && typeof ctor.prototype.fromJSON === "function") {
//         return ctor.prototype.fromJSON(value);
//     }
//     return undefined;
// }
// return value;
// }
Reviver.constructors = Reviver.constructors ?? {};
Reviver.onRevives = Reviver.onRevives ?? {};
Reviver.onSave = Reviver.onSave ?? {};
// Reviver.onPostLoad = Reviver.onPostLoad ?? {};

function obj_toJSON(ctorName: any, obj: any) {
    obj.typename = ctorName;
    return obj;
}

// A generic "fromJSON" function for use with Reviver: Just calls the
// constructor function with no arguments, then applies all of the
// key/value pairs from the raw data to the instance. Only useful for
// constructors that can be reasonably called without arguments!
// `ctor`      The constructor to call
// `data`      The data to apply
// Returns:    The object
function Generic_fromJSON(ctor: any, data: any) {
    console.debug(`fromJSON ctor = '${ctor.name ?? '(undefined)'}'`);
    let obj: any, name: any;

    // obj = new ctor();
    return Object.assign(new ctor(), data);
    // for (name in data) {
    //     obj[name] = data[name];
    // }
    // return obj;
}

// target: the class that the member is on.
// name: the name of the member in the class.
// descriptor: the member descriptor.This is essentially the object that would have been passed to Object.defineProperty.
export function onsave(target: any, name: any, descriptor: any): any {
    // target.prototype.toJSON = descriptor.value;
    Reviver.onSave ??= {};
    Reviver.onSave[target.name] = descriptor.value;
}

// target: the class that the member is on.
// name: the name of the member in the class.
// descriptor: the member descriptor.This is essentially the object that would have been passed to Object.defineProperty.
export function onrevive(target: any, name: any, descriptor: any): any {
    Reviver.onRevives ??= {};
    Reviver.onRevives[target.name] = descriptor.value;
}

// target: the class that the member is on.
// name: the name of the member in the class.
// descriptor: the member descriptor.This is essentially the object that would have been passed to Object.defineProperty.
// export function onpostload(target: any, name: any, descriptor: any): any {
//     Reviver.onPostLoad ??= {};
//     Reviver.onPostLoad[target.name] = descriptor.value;
// }

export function insavegame<TFunction extends Function>(target: any, toJSON?: () => any, fromJSON?: (value: any, value_data: any) => any): any {
    Reviver.constructors ??= {};
    Reviver.constructors[target.name] = target;

    let wrapper = Reviver.onSave[target.name];
    if (wrapper) {
        target.prototype.toJSON = function () {
            return obj_toJSON(target.name, wrapper(this));
        };
    }
    else {
        target.prototype.toJSON = function () {
            return obj_toJSON(target.name, this);
        };
        // target.prototype.fromJSON = function (value: any) {
        //     return Object.assign(new target(), value);
        // };
    }

    return target;
}

// let inSavestate = {};
// // let inSavestate = new WeakMap();

// export function insavegame(target: any, key: string) {
//     if (!key) {
//         let t = target as object;
//         Object.keys
//     }
//     else {
//         console.log("Target = " + target + " / Key = " + key);

//         let map = inSavestate.get(target);

//         if (!map) {
//             map = [];
//             inSavestate.set(target, map);
//         }

//         map.push(key);

//         console.log(inSavestate);
//     }
// }

//@insavegame
export class BStopwatch {
    public pauseDuringMenu: boolean = true;
    public pauseAtFocusLoss: boolean = true;
    public running: boolean = false;
    public elapsedMilliseconds: number;
    public elapsedFrames: number;
    private static watchesThatHaveBeenStopped: BStopwatch[] = [];
    private static watchesThatHaveBeenStoppedAtFocusLoss: BStopwatch[] = [];

    /**
     * This list is used to pause all running timers for when the game is paused, or the game loses focus, etc.
     */
    public static Watches: Array<BStopwatch> = [];

    public static createWatch(): BStopwatch {
        let result = new BStopwatch();
        BStopwatch.Watches.push(result);
        return result;
    }

    public static addWatch(watch: BStopwatch): void {
        if (BStopwatch.Watches.indexOf(watch) > -1)
            BStopwatch.Watches.push(watch);
    }

    public static removeWatch(watch: BStopwatch): void {
        let index = BStopwatch.Watches.indexOf(watch);
        if (index > -1) {
            delete BStopwatch.Watches[index];
            BStopwatch.Watches.splice(index, 1);
        }
    }

    public static updateTimers(elapsedMs: number): void {
        BStopwatch.Watches.forEach(s => { s.updateTime(elapsedMs); });
    }

    public static pauseAllRunningWatches(pauseCausedByMenu?: boolean): void {
        BStopwatch.Watches.filter(s => !s.running).forEach(s => { s.running = false; });
        //this.watchesThatHaveBeenStopped.Clear();
        BStopwatch.Watches.forEach(w => {
            if (w.running && (!pauseCausedByMenu || w.pauseDuringMenu)) {
                w.stop();
                BStopwatch.watchesThatHaveBeenStopped.push(w);
            }
        });
    }

    public static resumeAllPausedWatches(): void {
        BStopwatch.watchesThatHaveBeenStopped.filter(s => !s.running).forEach(s => { s.running = false; });
    }

    private static pauseWatchesOnFocusLoss(): void {
        BStopwatch.Watches.forEach(w => {
            if (w.running && w.pauseAtFocusLoss) {
                w.stop();
                this.watchesThatHaveBeenStoppedAtFocusLoss.push(w);
            }
        });
    }

    private static resumeAllPausedWatchesOnFocus(): void {
        this.watchesThatHaveBeenStoppedAtFocusLoss.forEach(w => w.start());
        this.watchesThatHaveBeenStoppedAtFocusLoss.length = 0;
    }

    constructor() {
        this.elapsedMilliseconds = 0;
        this.elapsedFrames = 0;
    }

    public start(): void {
        this.running = true;
    }

    public stop(): void {
        this.running = false;
    }

    public restart(): void {
        this.reset();
        this.running = true;
    }

    public reset(): void {
        this.elapsedMilliseconds = 0;
        this.elapsedFrames = 0;
    }

    public updateTime(elapsedMs: number): void {
        if (!this.running) return;
        this.elapsedMilliseconds += elapsedMs;
        ++this.elapsedFrames;
    }
}

export interface anidata<A extends any | null | {}> {
    delta: number;
    data: A;
}
