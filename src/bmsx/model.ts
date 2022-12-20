import { statecontext, mdef, MachineDefinitions, sdef, setup_fsmdef_library, sstate } from "./bfsm";
import { Direction, Point } from "./bmsx";
import { GameObject } from "./gameobject";
import { insavegame, onsave, Reviver, Savegame, Serializer } from "./gamereviver";
import { Input } from "./input";

export interface ISpaceObject {
	spaceid: string;
	objects: GameObject[];
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
	public state: statecontext;
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
		this.state = statecontext.create(derived_modelclass_constructor_name, 'model');
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

	static default_input_handler_for_allow_open_gamemenu(this: BaseModel, s: sstate<BaseModel>) {
		if (Input.KC_F5) {
			this.state.substate.gamemenu.to('open');
		}
	}

	static default_input_handler_for_allow_close_gamemenu(this: BaseModel, s: sstate<BaseModel>) {
		if (Input.KC_F5) {
			this.state.substate.gamemenu.to('closed');
		}
	}

	static default_input_handler(this: BaseModel, s: sstate<BaseModel>) {
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
		return Serializer(savegame);
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
