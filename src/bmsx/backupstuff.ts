// import { DrawImgFlags, BaseView } from "./view";
// import { SM } from "./soundmaster";
// import { Input } from "./input";
// import { RomLoadResult } from "./rompack";
// import { MSX2ScreenWidth, MSX2ScreenHeight, TileSize } from "./msx";
// import { Point, Area, moveArea, Size, Direction, mod } from "./common";
// import { BaseModelOld } from './basemodel_old';
// import { BaseControllerOld } from './basecontroller_old';
// import { parse, stringify } from 'Flatted';
// import assert = require("assert");

// declare global {
//     namespace NodeJS {
//         interface Global {
//             game: Game;
//             model: BaseModel | BaseModelOld;
//             controller: BaseControllerOld;
//             view: BaseView;
//         }
//     }
// }

// // export let game: Game;
// // export let model: BaseModel | BaseModelOld;
// // export let controller: BaseControllerOld;
// // export let view: BaseView;

// const fps: number = 50;
// const fpstime: number = 1000 / fps;

// //@insavegame
// export class GameOptions {
//     public static readonly INITIAL_SCALE: number = 1;
//     public static readonly INITIAL_FULLSCREEN: boolean = false;

//     public static Scale: number = GameOptions.INITIAL_SCALE;
//     public static Fullscreen: boolean = GameOptions.INITIAL_FULLSCREEN;
//     public static VolumePercentage: number = 50;
//     public static MusicVolumePercentage: number = 50;

//     public static get WindowWidth(): number {
//         return (MSX2ScreenWidth * GameOptions.Scale);
//     }

//     public static get WindowHeight(): number {
//         return (MSX2ScreenHeight * GameOptions.Scale);
//     }

//     public static get BufferWidth(): number {
//         return (MSX2ScreenWidth * GameOptions.Scale);
//     }

//     public static get BufferHeight(): number {
//         return (MSX2ScreenHeight * GameOptions.Scale);
//     }
// }

// export module Constants {
//     export const IMAGE_PATH: string = 'rom/Graphics/';
//     export const AUDIO_PATH: string = 'rom/';

//     export const SaveSlotCount: number = 6;
//     export const SaveSlotCheckpoint: number = -1;
//     export const SaveGamePath: string = "./Saves/sintervania.sa";
//     export const CheckpointGamePath: string = "./Saves/sintervania.chk";
//     export const OptionsPath: string = "./sintervania.ini";
// }

// export const enum BSTEventType {
//     None = 0,
//     Run = 1,
//     Enter = 2,
//     Exit = 3,
//     Next = 4,
//     End = 5,
// }

// export type str2bssd = { [key: string]: bssd; };
// export type str2bstd = { [key: string]: bstd; };
// export type str2cmstate = { [key: string]: cmstate; };
// export type str2mstate = { [key: string]: mstate; };
// export type str2sstate = { [key: string]: sstate; };
// export type bsfthandle = (state: sstate, type: BSTEventType) => void;

// const BST_MAX_HISTORY = 10;
// const DEFAULT_BST_ID = 'master';

// // export interface cmstate {
// //     class_name: string;
// //     machines: str2mstate;
// //     savedMachines: str2bstd;
// //     paused: boolean;
// // }

// // export interface mstate {
// //     class_name: string;
// //     machine_id: string;
// //     states: str2sstate;
// //     currentid: string; // Identifier of current state
// //     history: Array<string>; // History of previous states
// //     paused: boolean; // Iff paused, skip 'onrun'
// // }

// // export interface sstate {
// //     class_name: string;
// //     state_id: string;
// //     nudges2move: number; // Number of runs before tapehead moves to next statedata
// //     _tapehead: number;
// //     _nudges: number;
// // }

// @insavegame
// export class bssd {
//     public id: string;
//     public parent: bstd;

//     @onsave
//     public static onSave(me: bssd) {
//         let result = Object.assign(new bssd(undefined), me);

//         result.parent = undefined;

//         return result;
//     }

//     // @onrevive
//     // public static onLoad(loaded: bss, parent: bst): bss {
//     // let keys = Object.keys(loaded.savedStates);
//     // for (let key in keys) {
//     //     Object.assign(loaded.states[key], loaded.savedStates[key]);
//     // }
//     // Object.assign(parent.states[loaded.id], loaded);
//     // return undefined;
//     // }

//     public constructor(_id: string = 'none', _partialdef?: Partial<bssd>) {
//         this.id = _id;
//         this.nudges2move ??= 1;
//         if (_partialdef) Object.assign(this, _partialdef);
//     }

//     public get current(): any { return (this.tape && this.head < this.tape.length) ? this.tape[this.head] : undefined; };
//     public get atEnd(): boolean { return !this.tape || this.head === this.tape.length - 1; }
//     public get atStart(): boolean { return this.head === 0; }
//     public onrun: bsfthandle;
//     public onfinal: bsfthandle;
//     public onend: bsfthandle;
//     public onnext: bsfthandle;
//     public onenter: bsfthandle;
//     public onexit: bsfthandle;
//     public get internalstate() { return { statedata: this.tape, tapehead: this.head, nudges: this.nudges, nudges2move: this.nudges2move }; }

//     public tape: any[];

//     public nudges2move: number; // Number of runs before tapehead moves to next statedata
//     public setHead(machinestate: sstate): number {
//         return machinestate._tapehead;
//     }
//     public getHead(machinestate: sstate, v: number) {
//         machinestate._nudges = 0; // Always reset tapehead nudges after moving tapehead
//         // Check if the tape already was at the end
//         if (this.tape && (machinestate._tapehead >= this.tape.length - 1)) {
//             // If so, rewind and move to the first element of the tapehead
//             // But why? (Yes... Why?) Because we then can loop an animation,
//             // including the first and last element of the tape, without having
//             // to resort to any workarounds like duplicating the first entry
//             // of the tape or similar.
//             machinestate._tapehead = 0;
//         }
//         else {
//             // Else, move the tape ahead
//             machinestate._tapehead = v;
//         }
//         this.tapemove(machinestate); // Move the tape and trigger an event
//         // Check if the tape now is at the end
//         if (this.tape && (machinestate._tapehead >= this.tape.length - 1)) {
//             // If so, trigger the event for reaching the end of the tape
//             this.tapeend(machinestate);
//         }
//     }

//     public setHeadNoSideEffect(v: number) {
//         this._tapehead = v;
//     }

//     public setHeadNudgesNoSideEffect(v: number) {
//         this._nudges = v;
//     }

//     public getNudges(machinestate: sstate): number {
//         return this._nudges;
//     }
//     public setNudges(v: number) {
//         this._nudges = v;
//         if (v >= this.nudges2move) { ++this.head; }
//     }

//     // Helper function to set all handlers
//     public setAllHandlers(handler: bsfthandle): void {
//         this.onrun = handler;
//         this.onfinal = handler;
//         this.onend = handler;
//         this.onnext = handler;
//         this.onenter = handler;
//         this.onexit = handler;
//     }

//     protected tapemove(machinestate: sstate) {
//         this.onnext?.(machinestate, BSTEventType.Next);
//     }

//     protected tapeend(machinestate: sstate) {
//         this.onend?.(machinestate, BSTEventType.End);
//     }

//     public reset(machinestate: sstate): void {
//         machinestate._tapehead = 0;
//         machinestate._nudges = 0;
//     }
// }

// @insavegame
// export class bstd {
//     @onsave
//     public static onSave(me: bstd) {
//         let result = Object.assign(new bstd(undefined), me);

//         result.states = { ...me.states };
//         result.savedStates = { ...me.states };
//         let keys = Object.keys(result.states);
//         for (let key of keys) {
//             result.states[key] = undefined;
//             delete result.states[key];
//         }

//         return result;
//     }

//     // @onrevive
//     // public static onLoad(loaded: bst, parent: cbst): bst {
//     //     let keys = Object.keys(loaded.savedStates);
//     //     for (let key in keys) {
//     //         Object.assign(loaded.states[key], loaded.savedStates[key]);
//     //     }
//     //     return undefined;
//     //     // return obj_toJSON(loaded, this);
//     // }

//     public id: string;
//     public states: str2bssd; // Note that numbers will be automatically converted to strings!
//     public savedStates: str2bssd; // When serialized, place states here, so that they can be revived without overwriting function-properties
//     public getMachineDef(machinestate: mstate): bstd { return MachineDefinitions[machinestate.class_name][machinestate.machine_id]; }
//     public getCurrentDef(machinestate: mstate): bssd { return this.states[machinestate.currentid]; }
//     public getCurrentState(machinestate: mstate): sstate { return machinestate.states[machinestate.currentid]; }
//     public getDefAndState(machinestate: mstate): [ def: bssd, state: sstate ] {
//         return [ this.getCurrentDef(machinestate), this.getCurrentState(machinestate) ];
//     }

//     constructor(id?: string) {
//         this.id = id ?? DEFAULT_BST_ID;
//         this.states ??= {
//             // State 'none' is the start state that allows an object to transition to (including init
//             // stuff) on spawn or create.
//             none: new bssd('none', {}),
//         };
//     }

//     public create(id: string): bssd {
//         if (this.states[id]) throw new Error(`State ${id} already exists for state machine!`);
//         let result = new bssd(id);
//         this.states[id] = result;
//         result.parent = this;
//         return result;
//     }

//     public add(...states: bssd[]): void {
//         for (let state of states) {
//             if (!state.id) throw new Error(`State is missing an id, while attempting to add it to this bst!`);
//             if (this.states[state.id]) throw new Error(`State ${state.id} already exists for state machine!`);
//             this.states[state.id] = state;
//             state.parent = this;
//         }
//     }

//     public run(machinestate: mstate): void {
//         if (machinestate.paused) return;
//         let [ currentStateDef, currentState ] = this.getDefAndState(machinestate);
//         currentStateDef.onrun?.(currentState, BSTEventType.Run);
//     }

//     public to(machinestate: mstate, newstate: string): void {
//         let [currentStateDef, currentState] = this.getDefAndState(machinestate);
//         currentStateDef.onexit?.(currentState, BSTEventType.Exit);

//         // Store the previous state on the history stack
//         this.pushHistory(machinestate, machinestate.currentid);

//         // Switch the current state to the new state
//         machinestate.currentid = newstate;

//         [currentStateDef, currentState] = this.getDefAndState(machinestate);
//         if (!currentStateDef) throw new Error(`State "${newstate}" doesn't exist for this state machine!`);

//         currentStateDef.onenter?.(currentState, BSTEventType.Enter);
//     }

//     protected pushHistory(machinestate: mstate, toPush: string): void {
//         machinestate.history.push(toPush);
//         if (machinestate.history.length > BST_MAX_HISTORY)
//             machinestate.history.shift(); // Remove the first element in the history-array
//     }

//     public pop(machinestate: mstate): void {
//         if (machinestate.history.length <= 0) return;
//         let poppedStateId = machinestate.history.pop();
//         this.to(machinestate, poppedStateId);
//     }

//     public reset(machinestate: mstate): void {
//         machinestate.currentid = 'none';
//         machinestate.history = new Array();
//         machinestate.paused = false;
//     }

//     public append(_state: bssd, _id: string): void {
//         this.states[_id] = _state;
//     }

//     public remove(_id: string): void {
//         delete this.states[_id];
//     }
// }

// @insavegame
// export class cbstd {
//     public machines: str2bstd;
//     public savedMachines: str2bstd;
//     public paused: boolean;

//     @onsave
//     public static onSave(me: cbstd): any {
//         let result = Object.assign(new cbstd(), me);

//         result.machines = { ...me.machines };
//         result.savedMachines = { ...me.machines };
//         let keys = Object.keys(result.machines);
//         for (let key of keys) {
//             result.machines[key] = undefined;
//             delete result.machines[key];
//         }

//         return result;
//     }

//     constructor() {
//         this.machines = {};
//         this.paused ??= false;
//     }

//     public onloaded(): void {
//         if (!this.savedMachines) return;
//         let machineIds = Object.keys(this.savedMachines);
//         for (let machineId of machineIds) {
//             let currentMachine = this.machines[machineId];
//             let currentSavedMachine = this.savedMachines[machineId];

//             let bstKeys = Object.keys(currentMachine);
//             for (let bstKey of bstKeys) {
//                 switch (bstKey) {
//                     case 'states': break;
//                     case 'savedStates': break;
//                     default:
//                         currentMachine[bstKey] = currentSavedMachine[bstKey];
//                         break;
//                 }
//             }
//             let stateIds = Object.keys(currentMachine.states);
//             for (let stateId of stateIds) {
//                 let state = currentMachine.states[stateId];
//                 let savedState = currentSavedMachine.savedStates[stateId];

//                 Object.assign(state, savedState);
//                 delete this.savedMachines[machineId];
//             }
//         }
//     }

//     public getBst(machine_id: string): bstd {
//         return this.machines[machine_id];
//     }

//     public getCurrentId(machine_id: string = DEFAULT_BST_ID): string {
//         return this.machines[machine_id].currentid;
//     }

//     public addBst(machine_id: string): bstd {
//         let result = new bstd(machine_id);
//         this.machines[machine_id] = result;

//         return result;
//     }

//     public removeBst(machine_id: string): bstd {
//         let result = this.machines[machine_id];
//         delete this.machines[machine_id];
//         this.machines[machine_id] = undefined;
//         return result;
//     }

//     public createState(state_id: string, machine_id: string = DEFAULT_BST_ID): bssd {
//         return this.machines[machine_id].create(state_id);
//     }

//     public add(...states: bssd[]): void {
//         this.addTo(DEFAULT_BST_ID, ...states);
//     }

//     public addTo(machine_id: string = DEFAULT_BST_ID, ...states: bssd[]): void {
//         !this.machines[machine_id] && this.addBst(machine_id);
//         this.machines[machine_id].add(...states);
//     }

//     public run(): void {
//         if (this.paused) return;
//         for (const key of Object.keys(this.machines)) {
//             this.machines[key].run();
//         }
//     }

//     public setStart(_id: string, init = true, machine_id: string = DEFAULT_BST_ID): void {
//         this.machines[machine_id].setStart(_id, init);
//     }

//     public to(newstate: string, machine_id: string = DEFAULT_BST_ID): void {
//         this.machines[machine_id].to(newstate);
//     }

//     public pop(machine_id: string = DEFAULT_BST_ID): void {
//         this.machines[machine_id].pop();
//     }

//     public reset(machine_id: string = DEFAULT_BST_ID): void {
//         this.machines[machine_id].reset();
//     }

//     public append(_state: bssd, _id: string, machine_id: string = DEFAULT_BST_ID): void {
//         this.machines[machine_id].append(_state, _id);
//     }

//     public remove(_id: string, machine_id: string = DEFAULT_BST_ID): void {
//         this.machines[machine_id].remove(_id);
//     }
// }

// @insavegame
// export class Savegame {
//     modelprops: {};
//     objects: IGameObject[];
// }

// var MachineDefinitions: { [key: string]: cbstd; };
// export abstract class BaseModel {
//     public sm: cbstd;
//     public id2object: { [key: string]: IGameObject; };
//     public objects: IGameObject[];
//     public paused: boolean;
//     public startAfterLoad: boolean;

//     public abstract get gamewidth(): number;
//     public abstract get gameheight(): number;

//     public static serializeObj(obj: any) {
//         let cache = [];
//         return JSON.stringify(obj, function (key, value) {
//             if (Array.isArray(value)) return value;
//             let type = typeof value;
//             switch (type) {
//                 case 'object':
//                     if (cache.includes(value)) return undefined;
//                     cache.push(value);
//                     let typename = value.constructor?.name ?? value.prototype?.name;
//                     if (typename !== 'Object' && typename !== 'object') {
//                         value.typename = typename;
//                         if (value.prototype?.onsave) return value.prototype.onsave(value);
//                         if (value.constructor?.onsave) return value.constructor.onsave(value);
//                     }
//                     return value;
//                 case 'function':
//                     return undefined;
//                 default:
//                     return value;
//             }
//         });
//     }

//     constructor() {
//         this.sm = new cbstd();
//         this.objects = [];
//         this.id2object = {};

//         this.paused = false;

//         this.buildStates();
//     }

//     public run() {
//         this.sm.run();
//     }

//     protected buildStates() {
//         // Create default state for running the game
//         this.sm.add(new bssd('default', {
//             onrun: this.defaultrun,
//             start: true,
//         }));
//     }

//     public load(serialized: string): void {
//         this.clear();
//         let savegame = JSON.parse(serialized, Reviver) as Savegame;
//         Object.assign(this, savegame.modelprops);
//         this.onloaded();
//         savegame.objects.forEach(o => (o.onloaded?.(), this.spawn(o)));

//     }

//     public onloaded(): void {
//         this.buildStates();
//         this.sm.onloaded();
//     }

//     public save(): string {
//         global.game.paused = true;
//         let createSavegame = () => {
//             let keys = Object.keys(this);
//             let data = {};
//             for (let index = 0; index < keys.length; ++index) {
//                 let key = keys[index];
//                 if (key === 'objects' || key === 'id2object') continue;
//                 if (this[key] !== null && this[key] !== undefined) {
//                     data[key] = this[key];
//                 }
//             }
//             let result = new Savegame();
//             result.modelprops = data;
//             result.objects = this.objects;

//             return result;
//         };

//         let savegame = createSavegame();
//         global.game.paused = false;
//         return BaseModel.serializeObj(savegame);
//     }

//     public defaultrun(): void {
//         if (global.model.paused) {
//             return;
//         }
//         if (global.model.startAfterLoad) {
//             return;
//         }

//         let objects = global.model.objects;
//         // Let all game objects take a turn
//         objects.forEach(o => !o.disposeFlag && o.run());

//         // Remove all objects that are to be disposed
//         objects.filter(o => o.disposeFlag).forEach(o => global.model.exile(o));
//     }

//     // https://hackernoon.com/3-javascript-performance-mistakes-you-should-stop-doing-ebf84b9de951
//     public where_do(predicate: (value: IGameObject, index: number, array: IGameObject[], thisArg?: any) => unknown, callbackfn: (value: IGameObject, index: number, array: IGameObject[], thisArg?: any) => void): void {
//         let filteredList = this.objects.filter(predicate);
//         for (let i = 0; i < filteredList.length; i++) {
//             callbackfn(filteredList[i], i, filteredList, this);
//         }
//     }

//     public clear(): void {
//         this.objects.forEach(o => o.ondispose?.());
//         this.objects.length = 0;
//         delete this.id2object;
//         this.id2object = {};
//         this.paused = false;
//     }

//     public sortObjectsByPriority(): void {
//         this.objects.sort((o1, o2) => (o2.z || 0) - (o1.z || 0));
//     }

//     public spawn(o: IGameObject, pos?: Point, ignoreSpawnhandler?: boolean): void {
//         this.objects.push(o);

//         this.sortObjectsByPriority();

//         this.id2object[o.id] = o;
//         !ignoreSpawnhandler && o.onspawn?.(pos);
//     }

//     public exile(o: IGameObject): void {
//         let index = this.objects.indexOf(o);
//         if (index > -1) {
//             delete this.objects[index];
//             this.objects.splice(index, 1);
//         }

//         if (this.id2object[o.id])
//             this.id2object[o.id] = undefined;
//         o.ondispose?.();
//     }

//     public exists(id: string): boolean {
//         return this.id2object[id] !== undefined;
//     }

//     public bindStateToObject(_o: IGameObject) {
//         let o = _o as IGameObject & Function;
//         let classname = o.constructor ?? o.prototype?.name;
//         if (!classname) return;

//         let stateMachineForClass = MachineDefinitions[classname];
//         if (!stateMachineForClass) return;

//         o.state = <cmstate>{
//             machines: {},
//             paused: false,
//         };
//         Object.keys(stateMachineForClass.machines).forEach((machine_id: string) => {
//             o.state.machines[machine_id] = {
//                 states: {},
//                 currentid: stateMachineForClass.machines[machine_id].startstateid,
//                 paused: false,
//                 history: new Array<string>(BST_MAX_HISTORY),
//             };
//             Object.keys(stateMachineForClass.machines[machine_id].states).forEach((state_id: string) => {
//                 o.state.machines[machine_id].states[state_id] = {
//                     _tapehead: 0,
//                     nudges2move: stateMachineForClass.machines[machine_id].states[state_id].nudges2move,
//                 };
//             });
//         });
//     }

//     public runMachine(_o: IGameObject) {
//         let o = _o as IGameObject & Function;

//         let classname = o.constructor ?? o.prototype?.name;
//         if (!classname) return;

//         let stateMachineForClass = MachineDefinitions[classname];
//         if (!stateMachineForClass) return;

//         let machine_ids = Object.keys(_o.state.machines);
//         for (let i = 0; i < machine_ids.length; ++i) {
//             let machinestate = _o.state.machines[machine_ids[i]];
//             let machinedef = stateMachineForClass.machines[machine_ids[i]];
//             machinedef.run(machinestate);
//         }
//     }

//     public abstract collidesWithTile(o: IGameObject, dir: Direction): boolean;
//     public abstract isCollisionTile(x: number, y: number): boolean;
// }

// export class Game {
//     lastTick: number;
//     _turnCounter: number;
//     animationFrameRequestid: number;
//     public running: boolean;
//     public paused: boolean;
//     wasupdated: boolean;
//     public rom: RomLoadResult;

//     constructor(_rom: RomLoadResult, _model: BaseModel | BaseModelOld, _view: BaseView, _controller: BaseControllerOld | null, sndcontext: AudioContext, gainnode: GainNode) {
//         global['game'] = this;
//         this.rom = _rom;

//         // model = _model;
//         // view = _view;
//         // controller = _controller;

//         global['model'] = _model;
//         global['view'] = _view;
//         global['controller'] = _controller;

//         BaseView.images = _rom.images;
//         global.view.init();
//         SM.init(_rom['sndresources'], sndcontext, gainnode);
//         Input.init();

//         this.running = false;
//         this.paused = false;
//         this.wasupdated = true;
//     }

//     public get turnCounter(): number {
//         return this._turnCounter;
//     }

//     public start(): void {
//         window.addEventListener('resize', global.view.handleResize, false);
//         window.addEventListener('orientationchange', global.view.handleResize, false);
//         global.view.handleResize();

//         this.running = true;
//         this.lastTick = performance.now();
//         this.run(performance.now());
//     }

//     public update(elapsedMs: number): void {
//         BStopwatch.updateTimers(elapsedMs);
//         global.model.run(elapsedMs);
//     }

//     public run(tFrame?: number): void {
//         let game = global.game;
//         if (!game.running) return;

//         game.animationFrameRequestid = window.requestAnimationFrame(game.run);
//         let nextTick = game.lastTick + fpstime;
//         let numTicks = 0;

//         // If tFrame < nextTick then 0 ticks need to be updated (0 is default for numTicks).
//         // If tFrame = nextTick then 1 tick needs to be updated (and so forth).
//         // Note: As we mention in summary, you should keep track of how large numTicks is.
//         // If it is large, then either your game was asleep, or the machine cannot keep up.
//         if (tFrame > nextTick) {
//             let timeSinceTick = tFrame - game.lastTick;
//             numTicks = Math.floor(timeSinceTick / fpstime);
//         }

//         for (let i = 0; i < numTicks; i++) {
//             ++game._turnCounter;
//             game.lastTick = game.lastTick + fpstime; // Now lastTick is this tick.
//             Input.pollGamepadInput();
//             game.paused || game.update(game.lastTick);
//         }
//         global.view.drawgame();
//     }

//     public stop(): void {
//         global.game.running = false;
//         window.cancelAnimationFrame(this.animationFrameRequestid);
//         window.requestAnimationFrame(() => {
//             global.view.clear();
//             global.view.handleResize();
//             SM.stopEffect();
//             SM.stopMusic();
//         });
//     }
// }

// export interface IGameObject {
//     id: string | null;
//     disposeFlag: boolean;
//     sm: cbstd;
//     z?: number;
//     pos: Point;
//     size?: Size;
//     hitarea?: Area;
//     hittable?: boolean;
//     visible?: boolean;

//     hitbox_sx?: number;
//     hitbox_sy?: number;
//     hitbox_ex?: number;
//     hitbox_ey?: number;
//     wallhitbox_sx?: number;
//     wallhitbox_sy?: number;
//     wallhitbox_ex?: number;
//     wallhitbox_ey?: number;
//     isWall?: boolean;
//     disposeOnSwitchRoom?: boolean;
//     state: cmstate;

//     run(): void;
//     spawn?(spawningPos?: Point): void;
//     onspawn?: ((spawningPos?: Point) => void) | (() => void);
//     ondispose?: () => void;

//     paint?(offset?: Point): void;
//     postpaint?(offset?: Point): void; // Post-processing such as lighting effects or the characters of an ASCII-buffer in case of an ASCII-sprite
//     objectCollide?(o: IGameObject): boolean;
//     areaCollide?(a: Area): boolean;
//     collides?(o: IGameObject | Area): boolean;
//     collide?(src: IGameObject): void;
//     oncollide?: (src: IGameObject) => void;
//     onloaded?: () => void;
//     markForDisposure?: () => void;
// }

// // Shared function used for using as event handler for IGameObject/Sprite.OnLeavingScreen
// export function ProhibitLeavingScreenHandler(ik: IGameObject, d: Direction, old_x_or_y: number): void {
//     switch (d) {
//         case Direction.Left: case Direction.Right:
//             ik.pos.x = old_x_or_y;
//             break;
//         case Direction.Up: case Direction.Down:
//             ik.pos.y = old_x_or_y;
//             break;
//     }
// }

// Reviver.constructors = Reviver.constructors ?? {};
// Reviver.onRevives = Reviver.onRevives ?? {};
// Reviver.onSave = Reviver.onSave ?? {};

// @insavegame
// export abstract class Sprite implements IGameObject {
//     public id: string | null;
//     public pos: Point;
//     public size: Size;
//     protected _hitarea: Area;
//     public get hitarea() { return this._hitarea; }
//     public set hitarea(value: Area) { this._hitarea = value; }
//     public get wallHitarea(): Area { return this.hitarea; }
//     public visible: boolean;
//     public hittable: boolean;
//     public flippedH: boolean;
//     public flippedV: boolean;
//     public z: number;
//     public disposeFlag: boolean;
//     public imgid: number;

//     public get hitbox_sx(): number {
//         return this.pos.x + this.hitarea.start.x;
//     }

//     public get hitbox_sy(): number {
//         return this.pos.y + this.hitarea.start.y;
//     }

//     public get hitbox_ex(): number {
//         return this.pos.x + this.hitarea.end.x;
//     }

//     public get hitbox_ey(): number {
//         return this.pos.y + this.hitarea.end.y;
//     }

//     public get x_plus_width(): number {
//         return this.pos.x + this.size.x;
//     }

//     public get y_plus_height(): number {
//         return this.pos.y + this.size.y;
//     }

//     public get wallhitbox_sx(): number {
//         return this.pos.x + this.wallHitarea.start.x;
//     }

//     public get wallhitbox_sy(): number {
//         return this.pos.y + this.wallHitarea.start.y;
//     }

//     public get wallhitbox_ex(): number {
//         return this.pos.x + this.wallHitarea.end.x;
//     }

//     public get wallhitbox_ey(): number {
//         return this.pos.y + this.wallHitarea.end.y;
//     }

//     public disposeOnSwitchRoom?: boolean;
//     public oncollide?: (src: IGameObject) => void;
//     public onWallcollide?: (dir: Direction) => void;
//     public onLeaveScreen?: (ik: IGameObject, dir: Direction, old_x_or_y: number) => void;
//     public onLeavingScreen?: (ik: IGameObject, dir: Direction, old_x_or_y: number) => void;

//     private _direction: Direction;
//     public oldDirection: Direction;

//     public get direction(): Direction {
//         return this._direction;
//     }

//     public set direction(value: Direction) {
//         this.oldDirection = this._direction;
//         this._direction = value;
//     }

//     constructor() {
//         // this.state = <cmstate>{
//         //     machines: {},
//         //     paused: false,
//         // };
//         this.pos = { x: 0, y: 0 };
//         this.visible = true;
//         this.hittable = true;
//         this.flippedH = false;
//         this.flippedV = false;
//         this.z = 0;
//         this.disposeFlag = false;
//         this.disposeOnSwitchRoom = true;
//     }
//     state: cmstate;
//     sm: cbstd;
//     isWall?: boolean;
//     ondispose?: () => void;

//     /**
//     * Gebruik ik als event handler voor e.g. onLeaveScreen
//     */
//     markForDisposure(): void {
//         this.disposeFlag = true;
//     }

//     spawn(spawningPos: Point = null): Sprite {
//         global.model.spawn(this, spawningPos);
//         return this; // Voor chaining
//     }

//     onspawn(spawningPos?: Point): void {
//         if (spawningPos) {
//             [this.pos.x, this.pos.y] = [spawningPos.x, spawningPos.y];
//         }
//     }

//     onloaded(): void {
//         this.sm.onloaded();
//     }

//     run(): void {
//         this.sm.run();
//     }

//     paint(offset?: Point, colorize?: { r: boolean, g: boolean, b: boolean, a: boolean; }): void {
//         let options: number = this.flippedH ? DrawImgFlags.HFLIP : 0;
//         options |= (this.flippedV ? DrawImgFlags.VFLIP : 0);
//         let dx = offset?.x || 0;
//         let dy = offset?.y || 0;

//         if (colorize) {
//             global.view.drawColoredBitmap(this.imgid, this.pos.x + dx, this.pos.y + dy, options, colorize.r, colorize.g, colorize.b, colorize.a);
//         }
//         else {
//             global.view.drawImg(this.imgid, this.pos.x + dx, this.pos.y + dy, options);
//         }
//     }

//     postpaint(offset?: Point): void {
//     }

//     static objectCollide(o1: IGameObject, o2: IGameObject): boolean {
//         return o1.objectCollide(o2);
//     }

//     public collides(o: IGameObject | Area): boolean {
//         if ((o as IGameObject).id) return this.objectCollide(<IGameObject>o);
//         else return this.areaCollide(<Area>o);
//     }

//     public collide(src: IGameObject): void {
//         this.oncollide?.(src);
//     }

//     objectCollide(o: IGameObject): boolean {
//         return this.areaCollide(moveArea(o.hitarea, o.pos));
//     }

//     areaCollide(a: Area): boolean {
//         let o1 = this;
//         let o1p = o1.pos;
//         let o1a = o1.hitarea;

//         let o2a = a;

//         return o1p.x + o1a.end.x >= o2a.start.x && o1p.x + o1a.start.x <= o2a.end.x &&
//             o1p.y + o1a.end.y >= o2a.start.y && o1p.y + o1a.start.y <= o2a.end.y;
//     }

//     inside(p: Point): boolean {
//         let o1 = this;
//         let o1p = o1.pos;
//         let o1a = o1.hitarea;

//         return o1p.x + o1a.end.x >= p.x && o1p.x + o1a.start.x <= p.x &&
//             o1p.y + o1a.end.y >= p.y && o1p.y + o1a.start.y <= p.y;
//     }

//     public setx(newx: number) {
//         let oldx = this.pos.x;
//         this.pos.x = ~~newx;
//         if (newx < oldx) {
//             if (global.model.collidesWithTile(this, Direction.Left)) {
//                 this.onWallcollide?.(Direction.Up);
//                 newx += TileSize - mod(newx, TileSize);
//             }
//             this.pos.x = ~~newx;
//             if (newx + this.size.x < 0) { this.onLeaveScreen?.(this, Direction.Left, oldx); }
//             else if (newx < 0) { this.onLeavingScreen?.(this, Direction.Left, oldx); }
//         }
//         else if (newx > oldx) {
//             if (global.model.collidesWithTile(this, Direction.Right)) {
//                 this.onWallcollide?.(Direction.Right);
//                 newx -= newx % TileSize;
//             }
//             this.pos.x = ~~newx;
//             if (newx >= global.model.gamewidth) { this.onLeaveScreen?.(this, Direction.Right, oldx); }
//             else if (newx + this.size.x >= global.model.gamewidth) { this.onLeavingScreen?.(this, Direction.Right, oldx); }
//         }
//     }

//     public sety(newy: number) {
//         let oldy = this.pos.y;
//         this.pos.y = ~~newy;
//         if (newy < oldy) {
//             if (global.model.collidesWithTile(this, Direction.Up)) {
//                 this.onWallcollide?.(Direction.Up);
//                 newy += TileSize - mod(newy, TileSize);
//             }
//             this.pos.y = ~~newy;
//             if (newy + this.size.y < 0) { this.onLeaveScreen?.(this, Direction.Up, oldy); }
//             else if (newy < 0) { this.onLeavingScreen?.(this, Direction.Up, oldy); }
//         }
//         else if (newy > oldy) {
//             if (global.model.collidesWithTile(this, Direction.Down)) {
//                 this.onWallcollide?.(Direction.Down);
//                 newy -= newy % TileSize;
//             }
//             this.pos.y = ~~newy;
//             if (newy >= global.model.gameheight) { this.onLeaveScreen?.(this, Direction.Down, oldy); }
//             else if (newy + this.size.y >= global.model.gameheight) { this.onLeavingScreen?.(this, Direction.Down, oldy); }
//         }
//     }
// }

// // https://stackoverflow.com/questions/8111446/turning-json-strings-into-objects-with-methods
// // A generic "smart reviver" function.
// // Looks for object values with a `ctor` property and
// // a `data` property. If it finds them, and finds a matching
// // constructor that has a `fromJSON` property on it, it hands
// // off to that `fromJSON` fuunction, passing in the value.
// export function Reviver(key: any, value: any) {
//     // console.info(`reviver with key = '${key ?? '(null)'}'`);
//     if (value === null || value === undefined) return value;

//     if (Array.isArray(value)) {
//         return value;
//     }

//     if (typeof value === "object" &&
//         typeof value.typename === "string") {
//         let theConstructor = Reviver.constructors[value.typename];
//         assert(theConstructor, `No constructor known for object of type '${value.typename}'. Did you forget to add '@insavegame' to the class definition?`);
//         // console.info(`Reviving ${value.typename}`);
//         let result = Object.assign(new theConstructor(), value);
//         let onRevive = Reviver.onRevives[value.typename];
//         return onRevive ? onRevive(result, this) : result;
//     }
//     // ctor = Reviver.constructors[value.ctor] || ;
//     // if (typeof ctor === "function" && typeof ctor.prototype.fromJSON === "function") {
//     //     return ctor.prototype.fromJSON(value);
//     // }
//     return value;
// }

// // return value;
// // if (typeof value === "object" &&
// //     typeof value.ctor === "string" &&
// //     typeof value.data !== "undefined") {
// //     let ctor: any;
// //     ctor = Reviver.constructors[value.ctor] || window[value.ctor];
// //     if (typeof ctor === "function" && typeof ctor.prototype.fromJSON === "function") {
// //         return ctor.prototype.fromJSON(value);
// //     }
// //     return undefined;
// // }
// // return value;
// // }
// // Reviver.onPostLoad = Reviver.onPostLoad ?? {};

// // A generic "fromJSON" function for use with Reviver: Just calls the
// // constructor function with no arguments, then applies all of the
// // key/value pairs from the raw data to the instance. Only useful for
// // constructors that can be reasonably called without arguments!
// // `ctor`      The constructor to call
// // `data`      The data to apply
// // Returns:    The object
// function Generic_fromJSON(ctor: any, data: any) {
//     console.debug(`fromJSON ctor = '${ctor.name ?? '(undefined)'}'`);
//     let obj: any, name: any;

//     // obj = new ctor();
//     return Object.assign(new ctor(), data);
//     // for (name in data) {
//     //     obj[name] = data[name];
//     // }
//     // return obj;
// }

// // target: the class that the member is on.
// // name: the name of the member in the class.
// // descriptor: the member descriptor.This is essentially the object that would have been passed to Object.defineProperty.
// export function onsave(target: any, name: any, descriptor: any): any {
//     // target.prototype.toJSON = descriptor.value;
//     // Reviver.onSave ??= {};
//     // Reviver.onSave[target.name] = descriptor.value;
//     // target.prototype.toJSON = descriptor.value; // Set the toJSON for the case where @insavegame is not used
//     target.onsave = descriptor.value;
// }

// // target: the class that the member is on.
// // name: the name of the member in the class.
// // descriptor: the member descriptor.This is essentially the object that would have been passed to Object.defineProperty.
// export function onrevive(target: any, name: any, descriptor: any): any {
//     Reviver.onRevives ??= {};
//     Reviver.onRevives[target.name] = descriptor.value;
// }

// // target: the class that the member is on.
// // name: the name of the member in the class.
// // descriptor: the member descriptor.This is essentially the object that would have been passed to Object.defineProperty.
// // export function onpostload(target: any, name: any, descriptor: any): any {
// //     Reviver.onPostLoad ??= {};
// //     Reviver.onPostLoad[target.name] = descriptor.value;
// // }

// export function insavegame<TFunction extends Function>(target: any, toJSON?: () => any, fromJSON?: (value: any, value_data: any) => any): any {
//     Reviver.constructors ??= {};
//     Reviver.constructors[target.name] = target;

//     // let wrapper = Reviver.onSave[target.name];
//     // if (wrapper) {
//     //     target.prototype.toJSON = function () {
//     //         return obj_toJSON(target.name, wrapper(this));
//     //     };
//     // }
//     // else {
//     //     target.prototype.toJSON = function () {
//     //         return obj_toJSON(target.name, this);
//     //     };
//     //     // target.prototype.fromJSON = function (value: any) {
//     //     //     return Object.assign(new target(), value);
//     //     // };
//     // }

//     return target;
// }

// // let inSavestate = {};
// // // let inSavestate = new WeakMap();

// // export function insavegame(target: any, key: string) {
// //     if (!key) {
// //         let t = target as object;
// //         Object.keys
// //     }
// //     else {
// //         console.log("Target = " + target + " / Key = " + key);

// //         let map = inSavestate.get(target);

// //         if (!map) {
// //             map = [];
// //             inSavestate.set(target, map);
// //         }

// //         map.push(key);

// //         console.log(inSavestate);
// //     }
// // }

// //@insavegame
// export class BStopwatch {
//     public pauseDuringMenu: boolean = true;
//     public pauseAtFocusLoss: boolean = true;
//     public running: boolean = false;
//     public elapsedMilliseconds: number;
//     public elapsedFrames: number;
//     private static watchesThatHaveBeenStopped: BStopwatch[] = [];
//     private static watchesThatHaveBeenStoppedAtFocusLoss: BStopwatch[] = [];

//     /**
//      * This list is used to pause all running timers for when the game is paused, or the game loses focus, etc.
//      */
//     public static Watches: Array<BStopwatch> = [];

//     public static createWatch(): BStopwatch {
//         let result = new BStopwatch();
//         BStopwatch.Watches.push(result);
//         return result;
//     }

//     public static addWatch(watch: BStopwatch): void {
//         if (BStopwatch.Watches.indexOf(watch) > -1)
//             BStopwatch.Watches.push(watch);
//     }

//     public static removeWatch(watch: BStopwatch): void {
//         let index = BStopwatch.Watches.indexOf(watch);
//         if (index > -1) {
//             delete BStopwatch.Watches[index];
//             BStopwatch.Watches.splice(index, 1);
//         }
//     }

//     public static updateTimers(elapsedMs: number): void {
//         BStopwatch.Watches.forEach(s => { s.updateTime(elapsedMs); });
//     }

//     public static pauseAllRunningWatches(pauseCausedByMenu?: boolean): void {
//         BStopwatch.Watches.filter(s => !s.running).forEach(s => { s.running = false; });
//         //this.watchesThatHaveBeenStopped.Clear();
//         BStopwatch.Watches.forEach(w => {
//             if (w.running && (!pauseCausedByMenu || w.pauseDuringMenu)) {
//                 w.stop();
//                 BStopwatch.watchesThatHaveBeenStopped.push(w);
//             }
//         });
//     }

//     public static resumeAllPausedWatches(): void {
//         BStopwatch.watchesThatHaveBeenStopped.filter(s => !s.running).forEach(s => { s.running = false; });
//     }

//     private static pauseWatchesOnFocusLoss(): void {
//         BStopwatch.Watches.forEach(w => {
//             if (w.running && w.pauseAtFocusLoss) {
//                 w.stop();
//                 this.watchesThatHaveBeenStoppedAtFocusLoss.push(w);
//             }
//         });
//     }

//     private static resumeAllPausedWatchesOnFocus(): void {
//         this.watchesThatHaveBeenStoppedAtFocusLoss.forEach(w => w.start());
//         this.watchesThatHaveBeenStoppedAtFocusLoss.length = 0;
//     }

//     constructor() {
//         this.elapsedMilliseconds = 0;
//         this.elapsedFrames = 0;
//     }

//     public start(): void {
//         this.running = true;
//     }

//     public stop(): void {
//         this.running = false;
//     }

//     public restart(): void {
//         this.reset();
//         this.running = true;
//     }

//     public reset(): void {
//         this.elapsedMilliseconds = 0;
//         this.elapsedFrames = 0;
//     }

//     public updateTime(elapsedMs: number): void {
//         if (!this.running) return;
//         this.elapsedMilliseconds += elapsedMs;
//         ++this.elapsedFrames;
//     }
// }

// export interface anidata<A extends any | null | {}> {
//     delta: number;
//     data: A;
// }
