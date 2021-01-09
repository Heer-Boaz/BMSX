import { DrawImgFlags, BaseView } from "./view";
import { SM } from "./soundmaster";
import { Input } from "./input";
import { RomLoadResult } from "./rompack";
import { MSX2ScreenWidth, MSX2ScreenHeight, TileSize } from "./msx";
import { Point, Area, moveArea, Size, Direction, mod } from "./common";
import { BaseModelOld } from './basemodel_old';
import { BaseControllerOld } from './basecontroller_old';
import assert = require("assert");

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

export type str2bssd = { [key: string]: bssd; };
export type str2bstd = { [key: string]: bstd; };
export type str2cmstate = { [key: string]: cmstate; };
export type str2mstate = { [key: string]: mstate; };
export type str2sstate = { [key: string]: sstate; };
export type bsfthandle = (state: sstate, me: any, type: BSTEventType) => void;
export type Tape = any[];

const BST_MAX_HISTORY = 10;
export const DEFAULT_BST_ID = 'master';
export const NONE_STATE_ID = 'none';

@insavegame
export class cmstate {
    id: string;
    machines: str2mstate;
    savedMachines: str2bstd;
    paused: boolean;
    targetid: string; // This concurrent state machine reflects the (partial) state of the game object with id [targetid]

    public get cmachinedef(): cbstd {
        return MachineDefinitions[this.id];
    }

    public getMachinedef(machineid: string): bstd {
        return MachineDefinitions[this.id].machines[machineid];
    }

    constructor(cm_id: string, target_id: string) {
        this.id = cm_id;
        this.targetid = target_id;
        this.machines = {};
        this.paused ??= false;
    }

    public getCurrentId(machine_id: string = DEFAULT_BST_ID): string {
        return this.machines[machine_id].currentid;
    }

    public run(): void {
        if (this.paused) return;
        for (const key of Object.keys(this.machines)) {
            this.machines[key].run();
        }
    }

    public to(newstate: string, machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].to(newstate);
    }

    public pop(machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].pop();
    }

    public reset(machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].reset();
    }

    public populateMachines(): void {
        let cdef = this.cmachinedef;
        if (!cdef) {
            // A class is not required to have a defined cmachine.
            // Thus, we create a default machine that automatically has a generated
            // 'none'-state associated with it
            this.machines[DEFAULT_BST_ID] = new mstate(DEFAULT_BST_ID, this.id, this.targetid);
            return;
        }

        for (let mdef_id in cdef.machines) {
            this.machines[mdef_id] = new mstate(mdef_id, this.id, this.targetid);
            this.machines[mdef_id].populateStates();
        }
    }
}

@insavegame
export class mstate {
    id: string;
    cmachineid: string;
    states: str2sstate;
    currentid: string; // Identifier of current state
    history: Array<string>; // History of previous states
    paused: boolean; // Iff paused, skip 'onrun'
    targetid: string; // This state machine reflects the (partial) state of the game object with id [targetid]

    public get target(): GameObject { return global.model.get(this.targetid); }
    public get current(): sstate { return this.states[this.currentid]; };

    public get machinedef(): bstd {
        return MachineDefinitions[this.cmachineid]?.machines[this.id];
    }

    public get currentStatedef(): bssd {
        return MachineDefinitions[this.cmachineid]?.machines[this.id].states[this.currentid];
    }

    constructor(_id: string, _cmachineid: string, _targetid: string) {
        this.id = _id ?? DEFAULT_BST_ID;
        this.cmachineid = _cmachineid;
        this.targetid =_targetid;
        this.states ??= {};
        this.paused ??= false;

        // Note: when parameters are undefined, this constructor was invoked without parameters. This happens when it is revived. In that situation, don't init this object
        _id && _cmachineid && this.reset();
    }

    public run(): void {
        if (this.paused) return;
        // [this.currentStatedef] can be undefined if we are in the 'none' state
        this.currentStatedef?.onrun?.(this.current, this.target, BSTEventType.Run);
    }

    public to(newstate: string): void {
        let stateDef = this.currentStatedef;
        // stateDef can be undefined if we are in the 'none' state
        stateDef?.onexit?.(this.current, this.target, BSTEventType.Exit);
        stateDef && this.pushHistory(this.currentid); // Store the previous state on the history stack, if it is other than 'none'

        this.currentid = newstate; // Switch the current state to the new state
        if (!this.current) throw new Error(`State "${newstate}" doesn't exist for this state machine!`);

        stateDef = this.currentStatedef;
        // stateDef can be undefined if we are in the 'none' state
        stateDef?.onenter?.(this.current, this.target, BSTEventType.Enter);
    }

    protected pushHistory(toPush: string): void {
        this.history.push(toPush);
        if (this.history.length > BST_MAX_HISTORY)
            this.history.shift(); // Remove the first element in the history-array
    }

    public reset(): void {
        this.currentid = NONE_STATE_ID;
        this.history = new Array();
        this.paused = false;
    }

    public pop(): void {
        if (this.history.length <= 0) return;
        let poppedStateId = this.history.pop();
        this.to(poppedStateId);
    }

    public populateStates(): void {
        let mdef = this.machinedef;

        for (let sdef_id in mdef.states) {
            this.add(new sstate(sdef_id, this.id, this.cmachineid, this.targetid));
        }
    }

    private add(...states: sstate[]): void {
        for (let state of states) {
            if (!state.id) throw new Error(`State is missing an id, while attempting to add it to this mstate!`);
            if (this.states[state.id]) throw new Error(`State ${state.id} already exists for state machine!`);
            this.states[state.id] = state;
            state.cmachineid = this.cmachineid;
            state.machineid = this.id;
        }
    }
}

@insavegame
export class sstate {
    id: string;
    machineid: string;
    cmachineid: string;
    targetid: string; // This state reflects the (partial) state of the game object with id [targetid]
    nudges2move: number; // Number of runs before tapehead moves to next statedata

    public get statedef(): bssd { return MachineDefinitions[this.cmachineid]?.machines[this.machineid].states[this.id]; }
    public get tape(): Tape { return this.statedef.tape; }
    public get current(): any { return (this.tape && this.head < this.tape.length) ? this.tape[this.head] : undefined; };
    public get atEnd(): boolean { return !this.tape || this.head >= this.tape.length - 1; }
    public get atStart(): boolean { return this.head === 0; }
    public get internalstate() { return { statedata: this.tape, tapehead: this.head, nudges: this.nudges, nudges2move: this.nudges2move }; }
    public get target(): GameObject { return global.model.get(this.targetid); }
    // https://github.com/microsoft/TypeScript/issues/35986
    public targetAs<T extends GameObject>(): T { return <T>global.model.get(this.targetid); }

    public constructor(_id: string, _machineid: string, _cmachineid: string, _targetid: string) {
        this.id = _id;
        this.machineid = _machineid;
        this.cmachineid = _cmachineid;
        this.targetid = _targetid;

        // Note: when parameters are undefined, this constructor was invoked without parameters. This happens when it is revived. In that situation, don't init this object
        _id && _machineid && _cmachineid && this.reset();
    }

    protected _tapehead: number;
    public get head(): number {
        return this._tapehead;
    }
    public set head(v: number) {
        this._nudges = 0; // Always reset tapehead nudges after moving tapehead
        // Check if the tape already was at the end
        if (this.atEnd) {
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

    protected tapemove() {
        this.statedef.onnext?.(this, this.target, BSTEventType.Next);
    }

    protected tapeend() {
        this.statedef.onend?.(this, this.target, BSTEventType.End);
    }

    public reset(): void {
        this._tapehead = 0;
        this._nudges = 0;
        this.nudges2move = this.statedef.nudges2move;
    }
}

export class bssd {
    public id: string;
    public parent: bstd;
    public tape: Tape;
    public nudges2move: number; // Number of runs before tapehead moves to next statedata

    public constructor(_id: string = '_', _partialdef?: Partial<bssd>) {
        this.id = _id;
        this.nudges2move ??= 1;
        _partialdef && Object.assign(this, _partialdef);
    }

    public onrun: bsfthandle;
    public onfinal: bsfthandle;
    public onend: bsfthandle;
    public onnext: bsfthandle;
    public onenter: bsfthandle;
    public onexit: bsfthandle;

    // Helper function to set all handlers
    public setAllHandlers(handler: bsfthandle): void {
        this.onrun = handler;
        this.onfinal = handler;
        this.onend = handler;
        this.onnext = handler;
        this.onenter = handler;
        this.onexit = handler;
    }
}

export class bstd {
    public id: string;
    public states: str2bssd;
    public getStateDef(s_id: string): bssd { return this.states[s_id]; }

    constructor(id?: string, _partialdef?: Partial<bstd>) {
        this.id = id ?? DEFAULT_BST_ID;
        this.states ??= {};
        _partialdef && Object.assign(this, _partialdef);
    }

    public create(id: string): bssd {
        if (this.states[id]) throw new Error(`State ${id} already exists for state machine!`);
        let result = new bssd(id);
        this.states[id] = result;
        result.parent = this;
        return result;
    }

    public add(...states: bssd[]): void {
        for (let state of states) {
            if (!state.id) throw new Error(`State is missing an id, while attempting to add it to this bst!`);
            if (this.states[state.id]) throw new Error(`State ${state.id} already exists for state machine!`);
            this.states[state.id] = state;
            state.parent = this;
        }
    }

    public append(_state: bssd, _id: string): void {
        this.states[_id] = _state;
    }

    public remove(_id: string): void {
        delete this.states[_id];
    }
}

export class cbstd {
    public id: string;
    public machines: str2bstd;
    public savedMachines: str2bstd;

    constructor(id: string, _partialdef?: Partial<cbstd>) {
        this.id = id;
        this.machines = {};
        _partialdef && Object.assign(this, _partialdef);
        assert(this.id, `${this.constructor.name}.id should be defined!`);
    }

    public getBst(machine_id: string): bstd {
        return this.machines[machine_id];
    }

    public addBst(machine_id?: string): bstd {
        let m_id = machine_id ?? DEFAULT_BST_ID;
        let result = new bstd(m_id);
        this.machines[m_id] = result;

        return result;
    }

    public removeBst(machine_id: string): bstd {
        let result = this.machines[machine_id];
        delete this.machines[machine_id];
        this.machines[machine_id] = undefined;
        return result;
    }

    public createState(state_id: string, machine_id: string = DEFAULT_BST_ID): bssd {
        return this.machines[machine_id].create(state_id);
    }

    public add(...states: bssd[]): void {
        this.addTo(DEFAULT_BST_ID, ...states);
    }

    public addTo(machine_id: string = DEFAULT_BST_ID, ...states: bssd[]): void {
        !this.machines[machine_id] && this.addBst(machine_id);
        this.machines[machine_id].add(...states);
    }

    public appendBst(machine_def: bstd): void {
        this.machines[machine_def.id] = machine_def;
    }

    public appendState(_state: bssd, _id: string, machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].append(_state, _id);
    }

    public removeState(state_id: string, machine_id: string = DEFAULT_BST_ID): void {
        this.machines[machine_id].remove(state_id);
    }
}

@insavegame
export class Savegame {
    modelprops: {};
    objects: GameObject[];
}

var MachineDefinitions: { [key: string]: cbstd; };
var MachineDefinitionBuilders: { [key: string]: (classname: string) => cbstd; };
export type id2objectType = { [key: string]: GameObject; };
const id2obj = Symbol('id2object');
export abstract class BaseModel {
    public state: cmstate;
    protected [id2obj]: id2objectType;
    public get<T extends GameObject>(id: string) { return <T>this[id2obj][id]; }
    public exists(id: string): boolean {
        return this[id2obj][id] !== undefined;
    }

    public static getCMachinedef(cmachineid: string): cbstd {
        return MachineDefinitions[cmachineid];
    }

    public static getMachinedef(cmachineid: string, machineid: string): bstd {
        return MachineDefinitions[cmachineid]?.machines[machineid];
    }

    public static getMachineStatedef(cmachineid: string, machineid: string, stateid: string): bssd {
        return MachineDefinitions[cmachineid]?.machines[machineid].states[stateid];
    }

    public objects: GameObject[];
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
                    let typename = value.constructor?.name ?? value.prototype?.name;
                    if (typename !== 'Object' && typename !== 'object') {
                        value.typename = typename;
                        if (value.prototype?.onsave) return value.prototype.onsave(value);
                        if (value.constructor?.onsave) return value.constructor.onsave(value);
                    }
                    return value;
                case 'function':
                    return undefined;
                default:
                    return value;
            }
        });
    }

    constructor() {
        this.objects = [];
        this[id2obj] = {};

        this.paused = false;

        BaseModel.buildStates();
    }

    private static buildStates() {
        MachineDefinitions = {};
        for (let classname in MachineDefinitionBuilders) {
            let machineBuilded = MachineDefinitionBuilders[classname](classname);
            machineBuilded && (MachineDefinitions[classname] = MachineDefinitionBuilders[classname](classname)); // A clas might choose not to create a new machine
        }
    }

    // Init model after construction. Needed as the states have not been build at
    // the constructor's scope yet. So, this is a kind of onspawn(...) for the model
    // Returns [this] for chaining
    public abstract init(): this;

    public run() {
        this.state.run();
    }

    // @statedef_builder
    // public static buildBaseStates(classname: string): cbstd {
    //     let result = new cbstd(classname);

    //     // Create default state for running the game
    //     result.add(new bssd('default', {
    //         onrun: BaseModel.defaultrun,
    //     }));

    //     return result;
    // }

    public static defaultrun = (): void => {
        if (global.model.paused) {
            return;
        }
        if (global.model.startAfterLoad) {
            return;
        }

        let objects = global.model.objects;
        // Let all game objects take a turn
        objects.forEach(o => !o.disposeFlag && o.run());

        // Remove all objects that are to be disposed
        objects.filter(o => o.disposeFlag).forEach(o => global.model.exile(o));
    };

    public load(serialized: string): void {
        this.clear();
        let savegame = JSON.parse(serialized, Reviver) as Savegame;
        Object.assign(this, savegame.modelprops);
        this.onloaded();
        savegame.objects.forEach(o => (o.onloaded?.(), this.spawn(o, undefined, true)));

    }

    public onloaded(): void {
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
            result.modelprops = data;
            result.objects = this.objects;

            return result;
        };

        let savegame = createSavegame();
        global.game.paused = false;
        return BaseModel.serializeObj(savegame);
    }

    // https://hackernoon.com/3-javascript-performance-mistakes-you-should-stop-doing-ebf84b9de951
    public where_do(predicate: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => unknown, callbackfn: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => void): void {
        let filteredList = this.objects.filter(predicate);
        for (let i = 0; i < filteredList.length; i++) {
            callbackfn(filteredList[i], i, filteredList, this);
        }
    }

    public clear(): void {
        this.objects.forEach(o => o.ondispose?.());
        this.objects.length = 0;
        delete this[id2obj];
        this[id2obj] = {};
        this.paused = false;
    }

    public sortObjectsByPriority(): void {
        this.objects.sort((o1, o2) => (o2.z || 0) - (o1.z || 0));
    }

    public spawn(o: GameObject, pos?: Point, ignoreSpawnhandler?: boolean): void {
        this.objects.push(o);

        this.sortObjectsByPriority();

        this[id2obj][o.id] = o;
        !ignoreSpawnhandler && o.onspawn?.(pos);
    }

    public exile(o: GameObject): void {
        let index = this.objects.indexOf(o);
        if (index > -1) {
            delete this.objects[index];
            this.objects.splice(index, 1);
        }

        if (this[id2obj][o.id])
            this[id2obj][o.id] = undefined;
        o.ondispose?.();
    }

    public abstract collidesWithTile(o: GameObject, dir: Direction): boolean;
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
        global.model.init(); // Init the model to populate states (and do other init stuff)

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

export class GameObject {
    // For converting this GameObject to a string ('id')
    public [Symbol.toPrimitive]() {
        return this.id;
    }

    public id: string;
    public disposeFlag: boolean;
    public z?: number;
    public pos?: Point;
    public size?: Size;

    public get wallHitarea(): Area { return this.hitarea; }
    public state: cmstate;
    public isWall?: boolean;

    protected _hitarea?: Area;
    public get hitarea() { return this._hitarea; }
    public set hitarea(value: Area) { this._hitarea = value; }

    public hittable?: boolean;
    public visible?: boolean;

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

    public spawn?(spawningPos?: Point): void;
    public onspawn?(spawningPos?: Point): void;
    public ondispose?: () => void;

    public paint?(offset?: Point): void;
    public postpaint?(offset?: Point): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite
    public onloaded?: () => void;

    /**
    * Gebruik ik als event handler voor e.g. onLeaveScreen
    */
    public markForDisposure(): void {
        this.disposeFlag = true;
    }

    public oncollide?: (src: GameObject) => void;
    public onWallcollide?: (dir: Direction) => void;
    public onLeaveScreen?: (ik: GameObject, dir: Direction, old_x_or_y: number) => void;
    public onLeavingScreen?: (ik: GameObject, dir: Direction, old_x_or_y: number) => void;

    private _direction: Direction;
    public oldDirection: Direction;

    public get direction(): Direction {
        return this._direction;
    }

    public set direction(value: Direction) {
        this.oldDirection = this._direction;
        this._direction = value;
    }

    // https://gist.github.com/6174/6062387
    private static readonly GENERATED_ID_LENGTH = 10;
    private static generateId(): string {
        const chars = [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
        let result = undefined;
        do {
            result = [...Array(GameObject.GENERATED_ID_LENGTH)].map(() => chars[Math.random() * chars.length | 0]).join('');
        } while (global.model.exists(result)); // Make sure that the randomly generated string is unique!
        return result;
    }

    constructor(_id?: string) {
        this.id = _id ?? GameObject.generateId();
        this.state = new cmstate(this.constructor.name, this.id);
        this.state.populateMachines();
    }

    static objectCollide(o1: GameObject, o2: GameObject): boolean {
        return o1.objectCollide(o2);
    }

    public collides(o: GameObject | Area): boolean {
        if ((o as GameObject).id) return this.objectCollide(<GameObject>o);
        else return this.areaCollide(<Area>o);
    }

    public collide(src: GameObject): void {
        this.oncollide?.(src);
    }

    public objectCollide(o: GameObject): boolean {
        return this.areaCollide(moveArea(o.hitarea, o.pos));
    }

    public areaCollide(a: Area): boolean {
        let o1 = this;
        let o1p = o1.pos;
        let o1a = o1.hitarea;

        let o2a = a;

        return o1p.x + o1a.end.x >= o2a.start.x && o1p.x + o1a.start.x <= o2a.end.x &&
            o1p.y + o1a.end.y >= o2a.start.y && o1p.y + o1a.start.y <= o2a.end.y;
    }

    public inside(p: Point): boolean {
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

    public run(): void {
        this.state.run();
    }
}

// Shared function used for using as event handler for IGameObject/Sprite.OnLeavingScreen
export function leavingScreenHandler_prohibit(ik: GameObject, d: Direction, old_x_or_y: number): void {
    switch (d) {
        case Direction.Left: case Direction.Right:
            ik.pos.x = old_x_or_y;
            break;
        case Direction.Up: case Direction.Down:
            ik.pos.y = old_x_or_y;
            break;
    }
}

Reviver.constructors = Reviver.constructors ?? {};
Reviver.onRevives = Reviver.onRevives ?? {};
Reviver.onSave = Reviver.onSave ?? {};

@insavegame
export abstract class Sprite extends GameObject {
    public flippedH: boolean;
    public flippedV: boolean;
    public z: number;
    public imgid: number;

    constructor(id?: string) {
        super(id);
        this.pos = { x: 0, y: 0 };
        this.visible = true;
        this.hittable = true;
        this.flippedH = false;
        this.flippedV = false;
        this.z = 0;
        this.disposeFlag = false;
        this.disposeOnSwitchRoom = true;
    }

    onspawn(spawningPos?: Point): void {
        if (spawningPos) {
            [this.pos.x, this.pos.y] = [spawningPos.x, spawningPos.y];
        }
    };

    spawn(spawningPos: Point = null): this {
        global.model.spawn(this, spawningPos);
        return this; // Voor chaining
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

}

// https://stackoverflow.com/questions/8111446/turning-json-strings-into-objects-with-methods
// A generic "smart reviver" function.
// Looks for object values with a `ctor` property and
// a `data` property. If it finds them, and finds a matching
// constructor that has a `fromJSON` property on it, it hands
// off to that `fromJSON` fuunction, passing in the value.
export function Reviver(key: any, value: any) {
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value === "object" &&
        typeof value.typename === "string") {
        let theConstructor = Reviver.constructors[value.typename];
        assert(theConstructor, `No constructor known for object of type '${value.typename}'. Did you forget to add '@insavegame' to the class definition?`);
        let result = Object.assign(new theConstructor(), value);
        let onRevive = Reviver.onRevives[value.typename];
        return onRevive ? onRevive(result, this) : result;
    }
    return value;
}

// target: the class that the member is on.
// name: the name of the member in the class.
// descriptor: the member descriptor.This is essentially the object that would have been passed to Object.defineProperty.
export function onsave(target: any, name: any, descriptor: any): any {
    target.onsave = descriptor.value;
}

// target: the class that the member is on.
// name: the name of the member in the class.
// descriptor: the member descriptor.This is essentially the object that would have been passed to Object.defineProperty.
export function statedef_builder(target: any, name: any, descriptor: any): any {
    MachineDefinitionBuilders ??= {};
    MachineDefinitionBuilders[target.name] = descriptor.value;
}

// target: the class that the member is on.
// name: the name of the member in the class.
// descriptor: the member descriptor.This is essentially the object that would have been passed to Object.defineProperty.
export function onrevive(target: any, name: any, descriptor: any): any {
    Reviver.onRevives ??= {};
    Reviver.onRevives[target.name] = descriptor.value;
}

export function insavegame<TFunction extends Function>(target: any, toJSON?: () => any, fromJSON?: (value: any, value_data: any) => any): any {
    Reviver.constructors ??= {};
    Reviver.constructors[target.name] = target;
    return target;
}

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
