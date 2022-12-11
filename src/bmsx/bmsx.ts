import { BaseView, paintSprite } from "./view";
import { SM } from "./soundmaster";
import { Input } from "./input";
import { RomLoadResult } from "./rompack";
import { MSX2ScreenWidth, MSX2ScreenHeight, TileSize } from "./msx";
import assert = require("assert");

declare global {
	namespace NodeJS {
		interface Global {
			game: Game;
			model: BaseModel;
			view: BaseView;
		}
	}
}

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

export enum Direction {
	None = 0,
	Up = 1,
	Right = 2,
	Down = 3,
	Left = 4,
}
export interface Point {
	x: number;
	y: number;
}

export type Size = Point;

export interface Area {
	start: Point;
	end: Point;
}

export function mod(n: number, p: number): number {
	let r = n % p;
	return r < 0 ? r + p : r;
}

export function moveArea(a: Area, p: Point): Area {
	return <Area>{
		start: <Point>{ x: a.start.x + p.x, y: a.start.y + p.y },
		end: <Point>{ x: a.end.x + p.x, y: a.end.y + p.y },
	};
}

export function addPoints(a: Point, b: Point): Point {
	return <Point>{ x: a.x + b.x, y: a.y + b.y };
}

/// http://stackoverflow.com/questions/4959975/generate-random-value-between-two-numbers-in-javascript
export function randomInt(min: number, max: number) {
	return Math.floor(Math.random() * (max - min + 1) + min);
}

export function newPoint(x: number, y: number): Point {
	return <Point>{ x: x, y: y };
}

export function copyPoint(toCopy: Point): Point {
	return <Point>{ x: toCopy.x, y: toCopy.y };
}

export function multiplyPoint(toMult: Point, factor: number): Point {
	return <Point>{ x: toMult.x * factor, y: toMult.y * factor };
}

export function newArea(sx: number, sy: number, ex: number, ey: number): Area {
	return <Area>{ start: { x: sx, y: sy }, end: { x: ex, y: ey } };
}

export function newSize(x: number, y: number): Size {
	return <Size>{ x: x, y: y };
}

/// Alternative implementation for Point.Set()
export function setPoint(p: Point, new_x: number, new_y: number) {
	p.x = new_x;
	p.y = new_y;
}

/// Alternative implementation for Size.Set()
export function setSize(s: Size, new_x: number, new_y: number) {
	s.x = new_x;
	s.y = new_y;
}

export function area2size(a: Area) {
	return <Size>{ x: a.end.x - a.start.x, y: a.end.y - a.start.y };
}

export function addToScreen(element: HTMLElement): void {
	let gamescreen = document.getElementById('gamescreen');
	gamescreen.appendChild(element);
}

export function removeFromScreen(element: HTMLElement): void {
	let gamescreen = document.getElementById('gamescreen');
	gamescreen.removeChild(element);
}

export function createDivSprite(img?: HTMLImageElement, imgsrc?: string | null, classnames?: string[] | null): HTMLDivElement {
	let result = document.createElement('div');
	if (classnames) {
		classnames.forEach(x => {
			result.classList.add(x);
		});
	}

	let rimg = document.createElement('img');
	if (imgsrc) rimg.src = imgsrc;
	else if (img) rimg.src = img.src;
	else throw ('Cannot create sprite without an image or image source!');

	result.appendChild(rimg);

	return result;
}

export function GetDeltaFromSourceToTarget(source: Point, target: Point): Point {
	let delta = <Point>{ x: 0, y: 0 };

	if (Math.abs(target.x - source.x - 0) < 0.01) {
		delta.x = 0;
		delta.y = (target.y - source.y) > 0 ? 1 : -1;
	}
	else if (Math.abs(target.y - source.y - 0) < 0.01) {
		delta.x = (target.x - source.x) > 0 ? 1 : -1;
		delta.y = 0;
	}
	else if (Math.abs((target.x - source.x)) > Math.abs((target.y - source.y))) {
		delta.x = (target.x - source.x) > 0 ? 1 : -1;
		delta.y = (target.y - source.y) / (Math.abs(target.x - source.x));
	}
	else {
		delta.x = (target.x - source.x) / (Math.abs(target.y - source.y));
		delta.y = (target.y - source.y) > 0 ? 1 : -1;
	}

	return delta;
}

export function LineLength(p1: Point, p2: Point): number {
	return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)) - 1;
}

// https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API/Using_the_Web_Storage_API
export function isStorageAvailable(type: string): boolean {
	try {
		// var storage: any = window[type],
		//     x = '__storage_test__';
		// storage.setItem(x, x);
		// storage.removeItem(x);
		return true;
	}
	catch (e) {
		return e instanceof DOMException && (
			// everything except Firefox
			e.code === 22 ||
			// Firefox
			e.code === 1014 ||
			// test name field too, because code might not be present
			// everything except Firefox
			e.name === 'QuotaExceededError' ||
			// Firefox
			e.name === 'NS_ERROR_DOM_QUOTA_REACHED') &&
			// acknowledge QuotaExceededError only if there's something already stored
			true;// storage.length !== 0;
	}
}

export function isLocalStorageAvailable(): boolean {
	return isStorageAvailable('localStorage');
}

export function isSessionStorageAvailable(): boolean {
	return isStorageAvailable('sessionStorage');
}

export function getLookAtDirection(subjectpos: Point, targetpos: Point): Direction {
	let delta: Point = <Point>{ x: subjectpos.x - targetpos.x, y: subjectpos.x - targetpos.y };
	if (Math.abs(delta.x) >= Math.abs(delta.y)) {
		if (delta.x < 0)
			return Direction.Right;
		else return Direction.Left;
	}
	else {
		if (delta.y < 0)
			return Direction.Down;
		else return Direction.Up;
	}
}

export function getOppositeDirection(dir: Direction): Direction {
	switch (dir) {
		case Direction.Up:
			return Direction.Down;
		case Direction.Right:
			return Direction.Left;
		case Direction.Down:
			return Direction.Up;
		case Direction.Left:
			return Direction.Right;
		default:
			return Direction.None;
	}
}

export const enum BSTEventType {
	None = 0,
	Run = 1,
	Enter = 2,
	Exit = 3,
	Next = 4,
	End = 5,
}

export type str2bssd = { [key: string]: sdef; };
export type str2bstd = { [key: string]: mdef; };
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

	public get cmachinedef(): cmdef {
		return MachineDefinitions[this.id];
	}

	public getMachinedef(machineid: string): mdef {
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

	public getCurrentState(machine_id: string = DEFAULT_BST_ID): sstate {
		return this.machines[machine_id].states[this.getCurrentId(machine_id)];
	}

	public getState(state_id: string, machine_id: string = DEFAULT_BST_ID): sstate {
		return this.machines[machine_id].states[state_id];
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

	public get machinedef(): mdef {
		return MachineDefinitions[this.cmachineid]?.machines[this.id];
	}

	public get currentStatedef(): sdef {
		return MachineDefinitions[this.cmachineid]?.machines[this.id].states[this.currentid];
	}

	constructor(_id: string, _cmachineid: string, _targetid: string) {
		this.id = _id ?? DEFAULT_BST_ID;
		this.cmachineid = _cmachineid;
		this.targetid = _targetid;
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

	public get statedef(): sdef { return MachineDefinitions[this.cmachineid]?.machines[this.machineid].states[this.id]; }
	public get tape(): Tape { return this.statedef.tape; }
	public get current(): any { return (this.tape && this.head < this.tape.length) ? this.tape[this.head] : undefined; };
	public get atEnd(): boolean { return !this.tape || this.head >= this.tape.length - 1; } // Note that beyond end also returns true if there is no tape!
	protected get beyondEnd(): boolean { return !this.tape || this.head >= this.tape.length; } // Note that beyond end also returns true if there is no tape!
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
		this._tapehead = v; // Move the tape to new position

		// Check if the tapehead is going out of bounds (or there is no tape at all)
		if (!this.tape) {
			this._tapehead = 0;

			// Trigger the event for moving the tape, after having set the tapehead to the correct position
			this.tapemove();

			// Trigger the event for reaching the end of the tape
			this.tapeend();
		}
		// Check if the tape now is at the end
		else if (this.beyondEnd) {
			// Check whether we automagically rewind the tape
			if (this.statedef.auto_rewind_tape_after_end) {
				// If so, rewind and move to the first element of the tapehead
				// But why? (Yes... Why?) Because we then can loop an animation,
				// including the first and last element of the tape, without having
				// to resort to any workarounds like duplicating the first entry
				// of the tape or similar.
				this._tapehead = 0;
			}
			else {
				// Set the tapehead to the end of the tape (or 0 if there is no tape)
				this._tapehead = this.tape.length - 1;
			}
			// Trigger the event for moving the tape, after having set the tapehead to the correct position
			this.tapemove();

			// Trigger the event for reaching the end of the tape
			this.tapeend();
		}
		else {
			// Trigger the event for moving the tape. This is executed when no tapehead correction was required
			this.tapemove();
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

export class sdef {
	public id: string;
	public parent: mdef;
	public tape: Tape;
	public nudges2move: number; // Number of runs before tapehead moves to next statedata
	public auto_rewind_tape_after_end: boolean = true; // Automagically set the tapehead to index 0 when tapehead would go out of bound. Otherwise, will remain at end

	public constructor(_id: string = '_', _partialdef?: Partial<sdef>) {
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

export class mdef {
	public id: string;
	public states: str2bssd;
	public getStateDef(s_id: string): sdef { return this.states[s_id]; }

	constructor(id?: string, _partialdef?: Partial<mdef>) {
		this.id = id ?? DEFAULT_BST_ID;
		this.states ??= {};
		_partialdef && Object.assign(this, _partialdef);
	}

	public create(id: string): sdef {
		if (this.states[id]) throw new Error(`State ${id} already exists for state machine!`);
		let result = new sdef(id);
		this.states[id] = result;
		result.parent = this;
		return result;
	}

	public add(...states: sdef[]): void {
		for (let state of states) {
			if (!state.id) throw new Error(`State is missing an id, while attempting to add it to this bst!`);
			if (this.states[state.id]) throw new Error(`State ${state.id} already exists for state machine!`);
			this.states[state.id] = state;
			state.parent = this;
		}
	}

	public append(_state: sdef, _id: string): void {
		this.states[_id] = _state;
	}

	public remove(_id: string): void {
		delete this.states[_id];
	}
}

export class cmdef {
	public id: string;
	public machines: str2bstd;
	public savedMachines: str2bstd;

	constructor(id: string, _partialdef?: Partial<cmdef>) {
		this.id = id;
		this.machines = {};
		_partialdef && Object.assign(this, _partialdef);
		assert(this.id, `${this.constructor.name}.id should be defined!`);
	}

	public getBst(machine_id: string): mdef {
		return this.machines[machine_id];
	}

	public addBst(machine_id?: string): mdef {
		let m_id = machine_id ?? DEFAULT_BST_ID;
		let result = new mdef(m_id);
		this.machines[m_id] = result;

		return result;
	}

	public removeBst(machine_id: string): mdef {
		let result = this.machines[machine_id];
		delete this.machines[machine_id];
		this.machines[machine_id] = undefined;
		return result;
	}

	public createState(state_id: string, machine_id: string = DEFAULT_BST_ID): sdef {
		return this.machines[machine_id].create(state_id);
	}

	public add(...states: sdef[]): void {
		this.addTo(DEFAULT_BST_ID, ...states);
	}

	public addTo(machine_id: string = DEFAULT_BST_ID, ...states: sdef[]): void {
		!this.machines[machine_id] && this.addBst(machine_id);
		this.machines[machine_id].add(...states);
	}

	public appendBst(machine_def: mdef): void {
		this.machines[machine_def.id] = machine_def;
	}

	public appendState(_state: sdef, _id: string, machine_id: string = DEFAULT_BST_ID): void {
		this.machines[machine_id].append(_state, _id);
	}

	public removeState(state_id: string, machine_id: string = DEFAULT_BST_ID): void {
		this.machines[machine_id].remove(state_id);
	}
}

interface ISpaceObject {
	spaceid: string;
	objects: GameObject[];
}
@insavegame
export class Savegame {
	modelprops: {};
	allSpacesObjects: ISpaceObject[];
	spaces: Space[];
}

export type id2objectType = { [key: string]: GameObject; };
export type id2spaceType = { [key: string]: Space; };
const id2obj = Symbol('id2object');
const id2space = Symbol('id2space');

@insavegame
export class Space {
	protected [id2obj]: id2objectType;
	public get<T extends GameObject>(id: string) { return <T>this[id2obj][id]; }
	public id: string;
	public objects: GameObject[];
	public ondispose?: () => void;

	@onsave
	public static tosaved(o: Space) {
		let result = new Space(o.id);
		Object.assign(result, o);
		result.objects = undefined;

		console.log(`Ik ga dit nu opslaan als Space: ${result.id}, ${result.objects}`);
		return result;
	}

	public constructor(_id: string) {
		this.id = _id;
		this.objects = [];
		this[id2obj] = {};
	}

	public sortObjectsByPriority(): void {
		this.objects.sort((o1, o2) => (o2.z || 0) - (o1.z || 0));
	}

	public spawn(o: GameObject, pos?: Point, afterload?: boolean): void {
		this.objects.push(o);

		this.sortObjectsByPriority();

		this[id2obj][o.id] = o;
		this[id2obj][o.id] = o;
		!afterload && o.onspawn?.(pos);
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

	public clear(): void {
		this.objects.forEach(o => global.model.exile);
		this.objects.length = 0;
		delete this[id2obj];
		this[id2obj] = {};
	}
}

export var MachineDefinitions: { [key: string]: cmdef; };
var MachineDefinitionBuilders: { [key: string]: (classname: string) => cmdef; };
export abstract class BaseModel {
	public state: cmstate;
	// protected [id2obj]: id2objectType;
	protected [id2space]: id2spaceType;

	// public objects: GameObject[]; // All objects in the model
	public get objects(): GameObject[] {
		return this.getSpace(this.currentSpaceid).objects;
	}
	// protected allSpacesObjects: GameObject[];

	public spaces: Space[]; // All spaces in the model
	protected currentSpaceid: string; // Current space. On model creation, a default space is created with id 'default'
	public get currentSpace(): Space { return this.getSpace(this.currentSpaceid); } // Current space. On model creation, a default space is created with id 'default'
	public setSpace(newSpaceId: string) { this.currentSpaceid = newSpaceId; }
	public paused: boolean;
	public startAfterLoad: boolean;

	// public get<T extends GameObject>(id: string) { return <T>this[id2obj][id]; }
	public get<T extends GameObject>(id: string) { return <T>this[id2space][this.currentSpaceid][id2obj][id]; }
	public getSpace<T extends Space>(id: string) { return <T>this[id2space][id]; }
	public exists(id: string): boolean {
		let foundObj = this.get(id);
		return foundObj ? true : false;
	}

	public static getCMachinedef(cmachineid: string): cmdef {
		return MachineDefinitions[cmachineid];
	}

	public static getMachinedef(cmachineid: string, machineid: string): mdef {
		return MachineDefinitions[cmachineid]?.machines[machineid];
	}

	public static getMachineStatedef(cmachineid: string, machineid: string, stateid: string): sdef {
		return MachineDefinitions[cmachineid]?.machines[machineid].states[stateid];
	}
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
		// this.allSpacesObjects = [];
		// this[id2obj] = {};
		this.spaces = [];
		this[id2space] = {};

		this.paused = false;

		BaseModel.buildStates();
		this.addDefaultSpace();
	}

	private static buildStates() {
		MachineDefinitions = {};
		for (let classname in MachineDefinitionBuilders) {
			let machineBuilded = MachineDefinitionBuilders[classname](classname);
			machineBuilded && (MachineDefinitions[classname] = MachineDefinitionBuilders[classname](classname)); // A clas might choose not to create a new machine
		}
	}

	private addDefaultSpace() {
		let defaultSpace: Space = new Space('default');
		this.addSpace(defaultSpace);
		this.currentSpaceid = defaultSpace.id;
	}

	// Init model after construction. Needed as the states have not been build at
	// the constructor's scope yet. So, this is a kind of onspawn(...) for the model
	// Returns [this] for chaining
	public abstract init(): this;

	public run() {
		this.state.run();
	}

	public static defaultrun = (): void => {
		if (global.model.paused) {
			return;
		}
		if (global.model.startAfterLoad) {
			return;
		}

		let objects = global.model.objects;
		// Let all game objects take a turn
		objects.forEach(o => !o.disposeFlag && o.run && o.run());

		// Remove all objects that are to be disposed
		objects.filter(o => o.disposeFlag).forEach(o => global.model.exile(o));
	};

	public load(serialized: string): void {
		this.clear();
		let savegame = JSON.parse(serialized, Reviver) as Savegame;
		Object.assign(this, savegame.modelprops);
		this.onloaded();
		// savegame.spaces.forEach(space => this.addSpace(space));
		savegame.allSpacesObjects.forEach(space_and_objects => {
			let space = this[id2space][space_and_objects.spaceid];
			let objects = space_and_objects.objects;
			objects.forEach(o => (o.onloaded?.(), space.spawn(o, undefined, true)));
		});
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
				if (key === 'objects' || key === 'id2object' || key === 'spaces' || key === 'id2space') continue;
				if (this[key] !== null && this[key] !== undefined) {
					data[key] = this[key];
				}
			}
			let result = new Savegame();
			result.modelprops = data;
			result.spaces = this.spaces;
			result.allSpacesObjects = [];
			for (let space of this.spaces) {
				result.allSpacesObjects.push({
					spaceid: space.id,
					objects: [...(space.objects)]
				});
			}

			return result;
		};

		let savegame = createSavegame();
		global.game.paused = false;
		return BaseModel.serializeObj(savegame);
	}

	public filter(predicate: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => unknown): GameObject[] {
		return this.objects.filter(predicate);
	}

	// https://hackernoon.com/3-javascript-performance-mistakes-you-should-stop-doing-ebf84b9de951
	public filter_and_foreach(predicate: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => unknown, callbackfn: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => void): void {
		for (let i = 0; i < this.objects.length; i++) {
			let obj = this.objects[i];
			if (predicate(obj, i, this.objects, this)) {
				callbackfn(obj, i, this.objects, this);
			}
		}
	}

	public clear(): void {
		this.getSpace(this.currentSpaceid).clear();
	}

	public clearAllSpaces(): void {
		this.spaces.forEach(s => s.clear());

		// this.allSpacesObjects.forEach(o => o.ondispose?.());
		// this.allSpacesObjects.length = 0;
		delete this[id2obj];
		this[id2obj] = {};
		this.paused = false;
	}

	public spawn(o: GameObject, pos?: Point, ignoreSpawnhandler?: boolean): void {
		this.getSpace(this.currentSpaceid).spawn(o, pos, ignoreSpawnhandler);
	}

	public exile(o: GameObject): void {
		this.getSpace(this.currentSpaceid).exile(o);
	}

	public addSpace(s: Space): void {
		this.spaces.push(s);
		this[id2space][s.id] = s;
	}

	public removeSpace(s: Space): void {
		let index = this.spaces.indexOf(s);
		if (index > -1) {
			s.clear(); // Remove all objects from the space
			delete this.spaces[index];
			this.spaces.splice(index, 1);
		}

		if (this[id2space][s.id])
			this[id2space][s.id] = undefined;
		s.ondispose?.();
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
	public debug_runSingleFrameAndPause: boolean;

	constructor(_rom: RomLoadResult, _model: BaseModel, _view: BaseView, sndcontext: AudioContext, gainnode: GainNode) {
		global['game'] = this;
		this.rom = _rom;

		global['model'] = _model;
		global['view'] = _view;

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

	public update(): void {
		global.model.run();
		if (global.game.debug_runSingleFrameAndPause) {
			global.game.debug_runSingleFrameAndPause = false;
			global.game.paused = true;
		}
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
			if (game.paused) continue;
			Input.pollGamepadInput();
			game.update();
			// game.update(game.lastTick);
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

	public hittable: boolean;
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

	public paint?: (offset?: Point) => void;
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
		} while (global.model?.exists(result)); // Make sure that the randomly generated string is unique!
		// (Note that the model can be undefined. This can happen when an id is genereated for an object that is spawned as part of the model constructor)
		return result;
	}

	constructor(_id?: string) {
		this.id = _id ?? GameObject.generateId();
		this.hittable = true;
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
		if (!this.hittable) return false;

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
		if (o1.hitarea) {
			let o1a = o1.hitarea;
			return o1p.x + o1a.end.x >= p.x && o1p.x + o1a.start.x <= p.x &&
				o1p.y + o1a.end.y >= p.y && o1p.y + o1a.start.y <= p.y;
		}
		if (o1.size) {
			let o1a = o1.size;
			return o1p.x + o1a.x >= p.x && o1p.x <= p.x &&
				o1p.y + o1a.y >= p.y && o1p.y <= p.y;
		}
		return false;
	}

	/*
	*  This method is used for debugging. Handling mouse events on game objects requires
	*  transforming the game coordinates to canvas coordinates and that requires scaling
	*  to be taken into account.
	*/
	public insideScaled(p: Point): boolean {
		let o1 = this;

		let o1p = multiplyPoint(o1.pos, global.view.scale);
		let o1a: Area = null;
		if (o1.hitarea) {
			o1a = <Area>{ start: multiplyPoint(o1.hitarea.start, global.view.scale), end: multiplyPoint(o1.hitarea.end, global.view.scale) };
		}
		else if (o1.size) {
			o1a = <Area>{ start: newPoint(0, 0), end: multiplyPoint(o1.size, global.view.scale) };
		}
		else return false;

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

	override onspawn(spawningPos?: Point): void {
		if (spawningPos) {
			[this.pos.x, this.pos.y] = [spawningPos.x, spawningPos.y];
		}
	}

	override spawn(spawningPos: Point = null): this {
		global.model.spawn(this, spawningPos);
		return this; // Voor chaining
	}

	override paint = paintSprite;
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
