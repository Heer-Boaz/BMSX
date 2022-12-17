import { BaseView, paintSprite } from "./view";
import { SM } from "./soundmaster";
import { Input } from "./input";
import { RomLoadResult } from "./rompack";
import { MSX2ScreenWidth, MSX2ScreenHeight, TileSize } from "./msx";
import { mstate, mdef, sdef, sstate, setup_fsmdef_library, MachineDefinitions, id2mstate } from "./bfsm";
import { insavegame, onsave, Reviver, serializeObj } from "./gamereviver";

declare global {
	var game: Game;
	var model: BaseModel;
	var view: BaseView;
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

export class BFont {
	protected accessor font_res_map: Record<string, string>;
	get char_width(): number { return 8; }
	get char_height(): number { return 8; }

	constructor(_font_res_map: Record<string, string>) {
		this.font_res_map = _font_res_map;
	}

	public char_to_img(c: string): string {
		let letter: string;
		let _font_res_map = this.font_res_map;
		switch (c) {
			case '0':
				letter = _font_res_map.letter_0;
				break;
			case '1':
				letter = _font_res_map.letter_1;
				break;
			case '2':
				letter = _font_res_map.letter_2;
				break;
			case '3':
				letter = _font_res_map.letter_3;
				break;
			case '4':
				letter = _font_res_map.letter_4;
				break;
			case '5':
				letter = _font_res_map.letter_5;
				break;
			case '6':
				letter = _font_res_map.letter_6;
				break;
			case '7':
				letter = _font_res_map.letter_7;
				break;
			case '8':
				letter = _font_res_map.letter_8;
				break;
			case '9':
				letter = _font_res_map.letter_9;
				break;
			case 'a':
				letter = _font_res_map.letter_a;
				break;
			case 'b':
				letter = _font_res_map.letter_b;
				break;
			case 'c':
				letter = _font_res_map.letter_c;
				break;
			case 'd':
				letter = _font_res_map.letter_d;
				break;
			case 'e':
				letter = _font_res_map.letter_e;
				break;
			case 'f':
				letter = _font_res_map.letter_f;
				break;
			case 'g':
				letter = _font_res_map.letter_g;
				break;
			case 'h':
				letter = _font_res_map.letter_h;
				break;
			case 'i':
				letter = _font_res_map.letter_i;
				break;
			case 'j':
				letter = _font_res_map.letter_j;
				break;
			case 'k':
				letter = _font_res_map.letter_k;
				break;
			case 'l':
				letter = _font_res_map.letter_l;
				break;
			case 'm':
				letter = _font_res_map.letter_m;
				break;
			case 'n':
				letter = _font_res_map.letter_n;
				break;
			case 'o':
				letter = _font_res_map.letter_o;
				break;
			case 'p':
				letter = _font_res_map.letter_p;
				break;
			case 'q':
				letter = _font_res_map.letter_q;
				break;
			case 'r':
				letter = _font_res_map.letter_r;
				break;
			case 's':
				letter = _font_res_map.letter_s;
				break;
			case 't':
				letter = _font_res_map.letter_t;
				break;
			case 'u':
				letter = _font_res_map.letter_u;
				break;
			case 'v':
				letter = _font_res_map.letter_v;
				break;
			case 'w':
				letter = _font_res_map.letter_w;
				break;
			case 'x':
				letter = _font_res_map.letter_x;
				break;
			case 'y':
				letter = _font_res_map.letter_y;
				break;
			case 'z':
				letter = _font_res_map.letter_z;
				break;
			case 'A':
				letter = _font_res_map.letter_a;
				break;
			case 'B':
				letter = _font_res_map.letter_b;
				break;
			case 'C':
				letter = _font_res_map.letter_c;
				break;
			case 'D':
				letter = _font_res_map.letter_d;
				break;
			case 'E':
				letter = _font_res_map.letter_e;
				break;
			case 'F':
				letter = _font_res_map.letter_f;
				break;
			case 'G':
				letter = _font_res_map.letter_g;
				break;
			case 'H':
				letter = _font_res_map.letter_h;
				break;
			case 'I':
				letter = _font_res_map.letter_i;
				break;
			case 'J':
				letter = _font_res_map.letter_j;
				break;
			case 'K':
				letter = _font_res_map.letter_k;
				break;
			case 'L':
				letter = _font_res_map.letter_l;
				break;
			case 'M':
				letter = _font_res_map.letter_m;
				break;
			case 'N':
				letter = _font_res_map.letter_n;
				break;
			case 'O':
				letter = _font_res_map.letter_o;
				break;
			case 'P':
				letter = _font_res_map.letter_p;
				break;
			case 'Q':
				letter = _font_res_map.letter_q;
				break;
			case 'R':
				letter = _font_res_map.letter_r;
				break;
			case 'S':
				letter = _font_res_map.letter_s;
				break;
			case 'T':
				letter = _font_res_map.letter_t;
				break;
			case 'U':
				letter = _font_res_map.letter_u;
				break;
			case 'V':
				letter = _font_res_map.letter_v;
				break;
			case 'W':
				letter = _font_res_map.letter_w;
				break;
			case 'X':
				letter = _font_res_map.letter_x;
				break;
			case '¡':
				letter = _font_res_map.letter_ij;
				break;
			case 'Y':
				letter = _font_res_map.letter_y;
				break;
			case 'Z':
				letter = _font_res_map.letter_z;
				break;
			case ',':
				letter = _font_res_map.letter_comma;
				break;
			case '.':
				letter = _font_res_map.letter_dot;
				break;
			case '!':
				letter = _font_res_map.letter_exclamation;
				break;
			case '?':
				letter = _font_res_map.letter_question;
				break;
			case '\'':
				letter = _font_res_map.letter_apostroph;
				break;
			case ' ':
				letter = _font_res_map.letter_space;
				break;
			case ':':
				letter = _font_res_map.letter_colon;
				break;
			case '-':
				letter = _font_res_map.letter_streep;
				break;
			case '/':
				letter = _font_res_map.letter_slash;
				break;
			case '%':
				letter = _font_res_map.letter_percent;
				break;
			case '[':
				letter = _font_res_map.letter_speakstart;
				break;
			case ']':
				letter = _font_res_map.letter_speakend;
				break;
			default:
				letter = _font_res_map.letter_question;
				break;
		}
		return letter;
	}
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

export function divPoint(toDivide: Point, divide_by: number): Point {
	return <Point>{ x: toDivide.x / divide_by, y: toDivide.y / divide_by };
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

export type id2objectType = Record<string, GameObject>;
export type id2spaceType = Record<string, Space>;
export const id2obj = Symbol('id2object');
export const id2space = Symbol('id2space');

@insavegame
export class Space {
	public [id2obj]: id2objectType;
	public get<T extends GameObject>(id: string) { return <T>this[id2obj][id]; }
	public id: string;
	public objects: GameObject[];
	public ondispose?: () => void;

	@onsave
	public static tosaved(o: Space) {
		let result = new Space(o.id);
		Object.assign(result, o);
		result.objects = undefined;

		console.info(`Ik ga dit nu opslaan als Space: ${result.id}, ${result.objects}`);
		return result;
	}

	public constructor(_id: string) {
		this.id = _id;
		this.objects = [];
		this[id2obj] = {};
	}

	public sortObjectsByPriority(): void {
		this.objects = this.objects.sort((o1, o2) => (o2.z || 0) - (o1.z || 0));
	}

	public spawn(o: GameObject, pos?: Point, afterload?: boolean): void {
		this.objects.push(o);

		this.sortObjectsByPriority();

		this[id2obj][o.id] = o;
		!afterload && o.onspawn?.(pos);
	}

	public exile(o: GameObject): void {
		let index = this.objects.indexOf(o);
		if (index < 0) throw `GameObject ${o?.id ?? o} to remove from space '${this.id}' was not found, while calling [BaseModel.exile]!`;
		o.ondispose?.();

		if (index > -1) {
			delete this.objects[index];
			this.objects.splice(index, 1);
		}

		if (this[id2obj][o.id]) {
			this[id2obj][o.id] = undefined;
			delete this[id2obj][o.id];
		}
	}

	public clear(): void {
		this.objects.forEach(o => global.model.exile);
		this.objects.length = 0;
		delete this[id2obj];
		this[id2obj] = {};
	}
}
export type base_model_spaces = 'game_start' | 'default';

export abstract class BaseModel {
	public state: mstate;
	public [id2space]: id2spaceType;

	public get objects(): GameObject[] {
		return this.getSpace(this.currentSpaceid).objects;
	}

	public spaces: Space[]; // All spaces in the model
	protected currentSpaceid: string; // Current space. On model creation, a default space is created with id 'default'
	public get currentSpace(): Space { return this.getSpace(this.currentSpaceid); } // Current space. On model creation, a default space is created with id 'default'
	public setSpace(newSpaceId: string) { this.currentSpaceid = newSpaceId; }
	public paused: boolean;
	public startAfterLoad: boolean;

	public getFromCurrentSpace<T extends GameObject>(id: string) { return <T>this[id2space][this.currentSpaceid][id2obj][id]; }
	/**
	 * Gets the game object with the given id accross -all- spaces.
	 * @remarks If `id === 'model'`, returns the game model instead! (used for sstate to make game model as target for callbacks.
	 * @param {string} id - the id of the game object.
	 * @returns {GameObject | BaseModel} The game object with the given id or the game model itself (when id === 'model').
	 */
	public get<T extends GameObject>(id: string | 'model'): T {
		if (id == 'model') return global.model as any; // Dirty fix for scenario where model should return itself as target for the model state machine

		for (let i = 0; i < this.spaces.length; i++) {
			let space = this.spaces[i];
			let obj = this[id2space][space.id][id2obj][id];
			if (obj) return <T>obj;
		}
		return <T>undefined; // No object found
	}

	public getSpace<T extends Space>(id: string) { return <T>this[id2space][id]; }
	public exists(id: string): boolean {
		let foundObj = this.get(id);
		return foundObj ? true : false;
	}

	public static getMachinedef(machineid: string): mdef {
		return MachineDefinitions[machineid];
	}

	public static getMachineStatedef(machineid: string, stateid: string): sdef {
		return MachineDefinitions[machineid].states[stateid];
	}

	public abstract get gamewidth(): number;
	public abstract get gameheight(): number;

	/** **DO NOT CHANGE THIS CODE! PLEASE USE STATE DEFS TO HANDLE GAME STARTUP LOGIC!**
	 *
	 * _Trying to add logic here will most often result in runtime errors!_
	 * These runtime errors usually occur because the model was not created and initialized (with states),
	 * while creating new game objects that reference the model or the model states
	 */
	constructor() {
		this.spaces = [];
		this[id2space] = {};

		this.paused = false;

		this.addDefaultSpaces();
		BaseModel.setup_fsmdef_library();
	}

	private static setup_fsmdef_library() {
		setup_fsmdef_library();
	}

	private addDefaultSpaces() {
		this.addSpace('default' satisfies base_model_spaces);
		this.addSpace('game_start' satisfies base_model_spaces);
		this.setSpace('game_start' satisfies base_model_spaces);
	}

	/**
	 * Returns the constructor name of the specific derived class that extends this `BaseModel`.
	 * Required during game initialization where @see {@link init_model_state_machines} is called.
	 * @see {@link this.init_model_state_machines}
	 */
	public abstract get constructor_name(): string;

	/**
	* Init model after construction. Needed as the states have not been build at
	* the constructor's scope yet. So, this is a kind of `onspawn` for the model.
	*
	* Each derived model class should override @see {@link BaseModel.constructor_name} to get the proper constructor classname of that derived model class. We need the exact classname in order to map a state machine definition to an instance of an object.
	* @param {string} `derived_modelclass_constructor_name` - the constructor name of the derived modelclass (that derives from this BaseModel.
	*/
	public init_model_state_machines(derived_modelclass_constructor_name: string): this {
		this.state = mstate.create(derived_modelclass_constructor_name, 'model');
		this.state.to('game_start');

		return this;
	}

	/** Use this function for initializing spaces, global/static game objects, ...
	* Is automagically called from {@link Game} and expects the model to be created and its state machines populated.
	*
	* **Notes:**
	* 1. Use the state `game_start` to transition to the state in which the game will start after it started running and
	* not this function.**
	* 2. Game is not expected to be running yet.
	* @returns {this} `this` for chaining.
	 */
	public abstract do_one_time_game_init(): this;

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

	static default_input_handler_for_allow_open_gamemenu(s: sstate, ik: BaseModel) {
		if (Input.KC_F5) {
			ik.state.substate.gamemenu.to('open');
		}
	}

	static default_input_handler_for_allow_close_gamemenu(s: sstate, ik: BaseModel) {
		if (Input.KC_F5) {
			ik.state.substate.gamemenu.to('closed');
		}
	}

	static default_input_handler(s: sstate, ik: BaseModel) {
	}

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
		return serializeObj(savegame);
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
		this.spaces.forEach(s => s.get(o.id) && s.exile(o));
	}

	public exileFromCurrentSpace(o: GameObject): void {
		this.getSpace(this.currentSpaceid).exile(o);
	}

	public addSpace(s: Space | string): void {
		if (s instanceof Space) {
			this.spaces.push(s);
			this[id2space][s.id] = s;
		}
		else {
			let new_space = new Space(s);
			this.spaces.push(new_space);
			this[id2space][s] = new_space;
		}
	}

	public removeSpace(s: Space | string): void {
		let index: number;
		let id: string;
		let space: Space;

		if (s instanceof Space) {
			space = s;
			index = this.spaces.indexOf(s);
			id = s.id;
		}
		else {
			id = s;
			index = -1;
			let i = 0;
			for (i = 0; i < this.spaces.length; i++) {
				if (this.spaces[i].id === id) {
					index = i;
					space = this.spaces[i];
					break;
				}
			}
		}
		if (!space) throw `Space ${id ?? space.id} to remove from model was not found, while calling [BaseModel.removeSpace]!`;

		if (index > -1) {
			space.clear(); // Remove all objects from the space
			delete this.spaces[index];
			this.spaces.splice(index, 1);
		}

		if (this[id2space][id]) {
			this[id2space][id] = undefined;
			delete this[id2space][id];
		}
		space.ondispose?.();
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
	public model<T extends BaseModel>(): T { return <T>global.model; }
	public view<T extends BaseView>(): T { return <T>global.view; }


	constructor(_rom: RomLoadResult, _model: BaseModel, _view: BaseView, sndcontext: AudioContext, gainnode: GainNode) {
		global['game'] = this;
		this.rom = _rom;

		global['model'] = _model;
		global['view'] = _view;

		BaseView.images = _rom.images;
		global.view.init();
		SM.init(_rom['sndresources'], sndcontext, gainnode);
		Input.init();

		// Init the model to populate states (and do other init stuff) and
		// Init all the stuff that is game-specific. Placed here to reduce boilerplating
		global.model.init_model_state_machines(global.model.constructor_name).do_one_time_game_init();

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

type States = mstate & {
}

@insavegame
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
	public state: States;
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

	/**
	 * @param _id The id of the newly created object. If not given, defaults to generated id. @see {@link generateId}.
	 * @param _fsm_id The id of the state machine that will be created for this object. Defaults to `this.constructor.name`. If there is no state machine with the given (default) name, the state machine factory will ensure that an "empty" state machine is created. @see {@link mstate.create}.
	 */
	constructor(_id?: string, _fsm_id?: string) {
		this.id = _id ?? GameObject.generateId();
		this.hittable = true;
		this.state = mstate.create(_fsm_id ?? this.constructor.name, this.id);
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

	/**
	*  This method is used for debugging. Handling mouse events on game objects requires
	*  transforming the game coordinates to canvas coordinates and that requires scaling
	*  to be taken into account.
	*/
	public insideScaled(p: Point): Point {
		let o1 = this;

		let o1p = multiplyPoint(o1.pos, global.view.scale);
		let o1a: Area = null;
		if (o1.hitarea) {
			o1a = <Area>{ start: multiplyPoint(o1.hitarea.start, global.view.scale), end: multiplyPoint(o1.hitarea.end, global.view.scale) };
		}
		else if (o1.size) {
			o1a = <Area>{ start: newPoint(0, 0), end: multiplyPoint(o1.size, global.view.scale) };
		}
		else return undefined;

		if (o1p.x + o1a.end.x >= p.x && o1p.x + o1a.start.x <= p.x &&
			o1p.y + o1a.end.y >= p.y && o1p.y + o1a.start.y <= p.y) {
			let offsetToP = newPoint(p.x - o1p.x, p.y - o1p.y);
			return divPoint(offsetToP, global.view.scale);
		}
		return undefined;
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

@insavegame
export abstract class Sprite extends GameObject {
	public flippedH: boolean;
	public flippedV: boolean;
	public imgid: string;

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
