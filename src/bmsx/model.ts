import { BehaviorTreeDefinition, BehaviorTreeDefinitions, BehaviorTreeID, setup_btdef_library, setup_bt_library } from "./behaviourtree";
import { statecontext, mdef, MachineDefinitions, sdef, setup_fsmdef_library, sstate } from "./bfsm";
import { Direction, vec2, vec3 } from "./bmsx";
import { GameObject } from "./gameobject";
import { insavegame, onsave, Reviver, Savegame, Serializer } from "./gameserializer";
import { Input } from "./input";

export interface ISpaceObject {
    spaceid: string;
    objects: GameObject[];
}

export type obj_id_type = string;
export type space_id_type = string;
export type id2objectType = Record<obj_id_type, GameObject>;
export type id2spaceType = Record<space_id_type, Space>;
export type obj_id2space_id_type = Record<obj_id_type, space_id_type>;
export const id2obj = Symbol('id2object');
export const spaceid_2_space = Symbol('id2space');
export const objid_2_objspaceid = Symbol('obj_id2obj_space_id');

@insavegame
/**
 * Represents a space in the game world, which contains a collection of game objects.
 */
export class Space {
    /**
     * A dictionary that maps object IDs to their corresponding GameObject instances.
     * @type {Record<obj_id_type, GameObject>}
     */
    public [id2obj]: id2objectType;
    /**
     * Returns the GameObject with the specified ID, or undefined if no such object exists in this space.
     * @template T - The type of the GameObject to return.
     * @param {string} id - The ID of the GameObject to retrieve.
     * @returns {T | undefined} The GameObject with the specified ID, or undefined if no such object exists in this space.
     */
    public get<T extends GameObject>(id: string): T | undefined {
        return <T>this[id2obj][id];
    }
    public id: string;
    public objects: GameObject[];
    /**
     * A function that is called when the Space object is disposed of.
     * @type {() => void}
     */
    public ondispose?: () => void;

    @onsave
    /**
     * Creates a new Space object that can be safely serialized for saving the game.
     * @param {Space} o - The Space object to be serialized.
     * @returns {Space} A new Space object that can be safely serialized for saving the game.
     */
    public static tosaved(o: Space): Space {
        const result = new Space(o.id);
        Object.assign(result, o);
        result.objects = undefined;
        delete result.objects;

        console.info(`Ik ga dit nu opslaan als Space: ${result.id}, ${result.objects}`);
        return result;
    }

    /**
     * Represents a space in the game world, which contains a collection of game objects.
     * @constructor
     * @param {string} _id - The unique identifier for the space.
     */
    public constructor(_id: string) {
        this.id = _id;
        this.objects = [];
        this[id2obj] = {};
    }

    /**
     * Sorts the objects in the space by their depth (z-coordinate).
     * Objects with a lower z-coordinate will be drawn first, and objects with a higher z-coordinate will be drawn on top of them.
     * @returns {void} Nothing
     */
    public sort_by_depth(): void {
        this.objects.sort((o1, o2) => o1.z - o2.z);
    }

    /**
     * Adds object to the game and triggers it's onspawn-event.
     * @param {GameObject} o  - GameObject to add
     * @param {vec2 | vec3} pos - Position to spawn object
     * @param {boolean} skip_onspawn_event - Disables triggering onspawn-event. Example uses include reviving the game (part of loading a saved game) and moving objects from one space to another.
     * @returns {void} Nothing
     */
    public spawn(o: GameObject, pos?: vec2 | vec3, skip_onspawn_event?: boolean): void {
        if (!o?.id) throw `Cannot spawn object '${o?.id ?? 'undefined'}' as it doesn't have a valid id!`;
        if (global.model[objid_2_objspaceid][o.id]) throw `Cannot spawn object '${o.id}' in space '${this.id}' as it already exists in space '${global.model[objid_2_objspaceid][o.id]}'!`;

        this.objects.push(o);

        this[id2obj][o.id] = o;
        global.model[objid_2_objspaceid][o.id] = this.id;
        !skip_onspawn_event && o.onspawn?.(pos);

        this.sort_by_depth(); // Sort after spawn-event, just to be sure
    }

    /**
     * Removes object from the game and triggers it's ondispose-event.
     * @param {GameObject} o  - GameObject to dispose
     * @param {boolean} skip_ondispose_event - Disables triggering ondispose-event. Example uses include moving objects from one space to another.
     * @returns {void} Nothing
     */
    public exile(o: GameObject, skip_ondispose_event: boolean = false): void {
        const index = this.objects.indexOf(o);
        if (index < 0) throw `GameObject ${o?.id ?? o} to remove from space '${this.id}' was not found, while calling [BaseModel.exile]!`;
        !skip_ondispose_event && o.ondispose?.();

        if (index > -1) {
            delete this.objects[index];
            this.objects.splice(index, 1);
        }

        if (this[id2obj][o.id]) {
            this[id2obj][o.id] = undefined;
            delete this[id2obj][o.id];
        }

        if (global.model[objid_2_objspaceid][o.id]) {
            global.model[objid_2_objspaceid][o.id] = undefined;
            delete global.model[objid_2_objspaceid][o.id];
        }
    }

    /**
     * Removes all objects from the current space and triggers their ondispose-event.
     * @returns {void} Nothing
     */
    public clear(): void {
        const temp_array = this.objects.slice();
        temp_array.forEach(o => this.exile(o));
    }
}

export type base_model_spaces = 'game_start' | 'default';

@insavegame
/**
 * The base model class for the game. Contains all the spaces and objects in the game world.
 * Provides methods to add, remove, and manipulate game objects and spaces.
 */
export abstract class BaseModel {
    /**
     * An array of keys to exclude from the serialized game state when saving the game.
     * These keys include references to objects and spaces that should not be saved.
     */
    public static readonly keys_to_exclude_from_save = ['objects', 'id2object', 'spaces', 'id2space', 'obj_id2obj_space_id'];
    public state: statecontext;
    /**
     * An object that maps space IDs to their corresponding Space objects.
     * @type {id2spaceType}
     */
    public [spaceid_2_space]: id2spaceType;
    /**
     * An object that maps object IDs to their corresponding space IDs.
     * @type {obj_id2space_id_type}
     */
    public [objid_2_objspaceid]: obj_id2space_id_type;

    /**
     * Gets all game objects in the current space.
     * @returns {GameObject[]} An array of all game objects in the current space.
     */
    public get objects(): GameObject[] {
        return this.currentSpace.objects;
    }

    public spaces: Space[]; // All spaces in the model
    protected currentSpaceid: string; // Current space. On model creation, a default space is created with id 'default'
    public get current_space_id(): string { return this.currentSpaceid; } // Current space id. On model creation, a default space is created with id 'default'
    public get currentSpace(): Space { return this.get_space(this.currentSpaceid); } // Current space. On model creation, a default space is created with id 'default'
    public setSpace(newSpaceId: string) { this.currentSpaceid = newSpaceId; }
    public get_space<T extends Space>(id: string) { return <T>this[spaceid_2_space][id]; }

    public paused: boolean;
    public startAfterLoad: boolean;

    /**
     * Gets the game object with the given id from the current space only.
     * @param {string} id - the id of the {@link GameObject}.
     * @returns {T} The game object with the given id from the current space only.
     */
    public getFromCurrentSpace<T extends GameObject>(id: string): T {
        return <T>this.currentSpace[id2obj][id];
    }

    /**
     * Gets the game object with the given id **across all spaces**.
     * If `id === 'model'`, returns the game model instead! (used for {@link sstate} to make game model as target for callbacks.
     * @param {string} id - the id of the {@link GameObject}.
     * @returns {GameObject | BaseModel} The game object with the given id or the game model itself (when `id === 'model'`).
     */
    public get<T extends GameObject>(id: string | 'model'): T {
        if (id == 'model') return global.model as any; // Dirty fix for scenario where model should return itself as target for the model state machine

        const space = this.get_space(this[objid_2_objspaceid][id]);
        if (!space) return <T>null;
        return space.get<T>(id);
    }

    /**
     * Returns true if an object exists **in any space** with the given object id.
     * @param {string} obj_id The id of the object that we want to know whether it exists.
     * @returns {boolean} Whether an object was found _in any space_ with the given object id.
     */
    public exists(obj_id: string): boolean {
        return this.get(obj_id) ? true : false;
    }

    /**
     * Returns the id of the space that contains the object with the given id.
     * @param {string} obj_id - The id of the object to search for.
     * @returns {string} The id of the space that contains the object with the given id.
     */
    public get_spaceid_that_has_obj(obj_id: string): string {
        return this[objid_2_objspaceid][obj_id];
    }

    /**
     * Returns true if the object with the given id is in the current space.
     * @param {string} obj_id - The id of the object to check.
     * @returns {boolean} Whether the object with the given id is in the current space.
     */
    public is_obj_in_current_space(obj_id: string): boolean {
        return this.get_spaceid_that_has_obj(obj_id) === this.currentSpaceid;
    }

    /**
     * Moves an object from one space to another. Object should exist in a space, otherwise error is thrown!
     * @param {string} obj_id - id of object to move.
     * @param {string} spaceid_to_move_obj_to - id of the new space of the object to move.
     * @returns {void} Nothing
     */
    public move_obj_to_space(obj_id: string, spaceid_to_move_obj_to: string): void {
        const obj = this.get(obj_id);
        if (!obj) throw `Cannot move unknown object '${obj_id}' to space '${spaceid_to_move_obj_to}'!`; // ? SHOULD THROW ERROR?
        const target_space = this.get_space(spaceid_to_move_obj_to);
        if (!target_space) throw `Cannot move object '${obj_id}' to unknown space '${spaceid_to_move_obj_to}'!`; // ? SHOULD THROW ERROR?
        const origin_space = this.get_space(this.get_spaceid_that_has_obj(obj_id));

        origin_space.exile(obj, true);
        target_space.spawn(obj, null, true);
    }

    /**
     * Returns the machine definition for the given machine id.
     * @param {string} machineid - The id of the machine to get the definition for.
     * @returns {mdef} The machine definition for the given machine id.
     */
    public static getMachinedef(machineid: string): mdef {
        return MachineDefinitions[machineid];
    }

    /**
     * Returns the state definition for the given machine and state id.
     * @param {string} machineid - The id of the machine to get the state definition for.
     * @param {string} stateid - The id of the state to get the definition for.
     * @returns {sdef} The state definition for the given machine and state id.
     */
    public static getMachineStatedef(machineid: string, stateid: string): sdef {
        return MachineDefinitions[machineid].states[stateid];
    }

    public static getBTdef(btid: BehaviorTreeID): BehaviorTreeDefinition {
        return BehaviorTreeDefinitions[btid];
    }

    public abstract get gamewidth(): number;
    public abstract get gameheight(): number;

    private static readonly MAX_ID_NUMBER = Number.MAX_SAFE_INTEGER; // Define a maximum number for wrapping
    protected idCounter = 0;

    public getNextIdNumber(): number {
        const nextNumber = this.idCounter;
        this.idCounter = this.idCounter >= BaseModel.MAX_ID_NUMBER ? 0 : this.idCounter + 1;
        return nextNumber;
    }

    /** **DO NOT CHANGE THIS CODE! PLEASE USE STATE DEFS TO HANDLE GAME STARTUP LOGIC!**
     *
     * _Trying to add logic here will most often result in runtime errors!_
     * These runtime errors usually occur because the model was not created and initialized (with states),
     * while creating new game objects that reference the model or the model states
     */
    constructor() {
        this.spaces = [];
        this[spaceid_2_space] = {};
        this[objid_2_objspaceid] = {};

        this.paused = false;

        BaseModel.setup_fsmdef_library();
        BaseModel.setup_bt_library();
    }

    /**
     * Initializes the spaces for the model. This method should only be executed when the model is not being revived.
     * Adds the 'default' and 'game_start' spaces to the model and sets the current space to 'game_start'.
     * @returns {BaseModel} The current instance of the BaseModel.
     */
    public init_spaces(): BaseModel { // Should only be executed when model is *not* revived
        this.addSpace('default' satisfies base_model_spaces);
        this.addSpace('game_start' satisfies base_model_spaces);
        this.setSpace('game_start' satisfies base_model_spaces);

        return this;
    }

    /**
     * Sets up the finite state machine definition library for the `BaseModel` class.
     * This method should only be called once during the initialization of the `BaseModel` class.
     * @returns {void} Nothing.
     */
    private static setup_fsmdef_library(): void {
        setup_fsmdef_library();
    }

    private static setup_bt_library(): void {
        setup_btdef_library();
        setup_bt_library();
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

    /**
     * Runs the current state of the model by calling the `run` method of the current state.
     * @returns {void} Nothing.
     */
    public run(): void {
        this.state.run();
    }

    /**
     * Runs the game loop by calling the `run` method of all game objects and removing objects that are marked for disposal.
     * If the game is paused or is set to start after loading, this function returns without doing anything.
     * @returns {void} Nothing
     */
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

    /**
     * The default input handler for allowing the game menu to be opened.
     * If the F5 key is pressed, the game menu substate is set to 'open'.
     * @param {BaseModel} this - The current instance of the BaseModel.
     * @param {sstate<BaseModel>} s - The current state of the BaseModel.
     * @returns {void} Nothing.
     */
    static default_input_handler_for_allow_open_gamemenu(this: BaseModel, s: sstate<BaseModel>): void {
        if (Input.KC_F5) {
            this.state.substate.gamemenu.to('open');
        }
    }

    /**
     * The default input handler for allowing the game menu to be closed.
     * If the F5 key is pressed, the game menu substate is set to 'closed'.
     * @param {BaseModel} this - The current instance of the BaseModel.
     * @param {sstate<BaseModel>} s - The current state of the BaseModel.
     * @returns {void} Nothing.
     */
    static default_input_handler_for_allow_close_gamemenu(this: BaseModel, s: sstate<BaseModel>): void {
        if (Input.KC_F5) {
            this.state.substate.gamemenu.to('closed');
        }
    }

    static default_input_handler(this: BaseModel, s: sstate<BaseModel>) {
    }

    /**
     * Loads a serialized game state and applies it to the current model instance.
     * Clears all spaces and removes all objects from the model instance before loading the new state.
     * @param {string} serialized - The serialized game state to load.
     * @returns {void} Nothing.
     */
    public load(serialized: string): void {
        this.clearAllSpaces();
        const temp_array = this.spaces.slice();
        temp_array.forEach(s => this.removeSpace(s));
        const savegame = JSON.parse(serialized, Reviver) as Savegame;
        Object.assign(this, savegame.modelprops);
        this.onloaded(savegame);
    }

    /**
     * Adds spaces and objects from a loaded savegame to the current model instance.
     * @param {Savegame} savegame - The savegame to load.
     * @returns {void} Nothing.
     */
    public onloaded(savegame: Savegame): void {
        savegame.spaces.forEach(space => this.addSpace(space));
        savegame.allSpacesObjects.forEach(space_and_objects => {
            const space = this[spaceid_2_space][space_and_objects.spaceid];
            const objects = space_and_objects.objects;
            objects.forEach(o => (o.onloaded?.(), space.spawn(o, null, true)));
        });
    }

    /**
     * Saves the current game state by creating a `Savegame` object and serializing it.
     * Pauses the game while creating the `Savegame` object to ensure consistency.
     * Excludes keys listed in `BaseModel.keys_to_exclude_from_save` from the saved data.
     * @returns {string} The serialized `Savegame` object.
     */
    public save(): string {
        global.game.paused = true;
        const createSavegame = () => {
            const keys = Object.keys(this);
            const data = {};
            for (let index = 0; index < keys.length; ++index) {
                const key = keys[index];
                if (BaseModel.keys_to_exclude_from_save.includes(key)) continue;
                if (this[key] !== null && this[key] !== undefined) {
                    data[key] = this[key];
                }
            }
            const result = new Savegame();
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

        const savegame = createSavegame();
        global.game.paused = false;
        return Serializer(savegame);
    }

    /**
     * Filters the game objects in the model instance using the provided predicate function and returns a new array containing the filtered objects.
     * @param {function} predicate - The function used to filter the game objects. It should take a game object as its first argument, and return a boolean indicating whether the object should be included in the filtered list.
     * @returns {GameObject[]} An array containing the filtered game objects.
     */
    public filter(predicate: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => unknown): GameObject[] {
        return this.objects.filter(predicate);
    }

    // https://hackernoon.com/3-javascript-performance-mistakes-you-should-stop-doing-ebf84b9de951
    /**
     * Filters the game objects in the model instance using the provided predicate function and calls the provided callback function on each filtered object.
     * @param {function} predicate - The function used to filter the game objects. It should take a game object as its first argument, and return a boolean indicating whether the object should be included in the filtered list.
     * @param {function} callbackfn - The function called on each filtered game object. It should take a game object as its first argument, and can optionally take the index of the object in the filtered list, the filtered list itself, and the model instance as additional arguments.
     * @returns {void} Nothing.
     */
    public filter_and_foreach(predicate: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => unknown, callbackfn: (value: GameObject, index: number, array: GameObject[], thisArg?: any) => void): void {
        for (let i = 0; i < this.objects.length; i++) {
            const obj = this.objects[i];
            if (predicate(obj, i, this.objects, this)) {
                callbackfn(obj, i, this.objects, this);
            }
        }
    }

    /**
     * Clears the current space in the model instance by calling the `clear` method on the current space.
     * @returns {void} Nothing.
     */
    public clear(): void {
        this.currentSpace.clear();
    }

    /**
     * Clears all spaces in the model instance by calling the `clear` method on each space.
     * @returns {void} Nothing.
     */
    public clearAllSpaces(): void {
        this.spaces.forEach(s => s.clear());
    }

    /**
     * Spawns a new game object in the current space.
     * @param {GameObject} o - The game object to spawn.
     * @param {vec2 | vec3} [pos] - The position to spawn the game object at. If not provided, the game object's default position will be used.
     * @param {boolean} [ignoreSpawnhandler=false] - Whether to ignore the game object's spawn handler. If not provided, the spawn handler will be executed.
     * @returns {void} Nothing.
     */
    public spawn(o: GameObject, pos?: vec2 | vec3, ignoreSpawnhandler?: boolean): void {
        this.currentSpace.spawn(o, pos, ignoreSpawnhandler);
    }

    /**
     * Exiles a game object from all spaces in the model instance.
     * @param {GameObject} o - The game object to exile.
     * @returns {void} Nothing.
     */
    public exile(o: GameObject): void {
        this.spaces.forEach(s => s.get(o.id) && s.exile(o));
    }

    /**
     * Exiles a game object from the current space in the model instance.
     * @param {GameObject} o - The game object to exile.
     * @returns {void} Nothing.
     */
    public exileFromCurrentSpace(o: GameObject): void {
        this.currentSpace.exile(o);
    }

    /**
     * Adds a new space to the model instance.
     * @param {Space | string} s - The space to add to the model instance. Can be a `Space` object or a string representing the ID of the new space.
     * @returns {void} Nothing.
     * @throws {string} Throws an error if a space with the same ID already exists in the model instance.
     */
    public addSpace(s: Space | string): void {
        const new_space: Space = (s instanceof Space ? s : new Space(s));
        if (this[spaceid_2_space][new_space.id]) throw `Cannot add duplicate Space '${new_space.id}' to model!`;

        this.spaces.push(new_space);
        this[spaceid_2_space][new_space.id] = new_space;
    }

    /**
     * Removes a space from the model instance.
     * @param {Space | string} s - The space to remove from the model instance. Can be a `Space` object or a string representing the ID of the space to remove.
     * @returns {void} Nothing.
     * @throws {string} Throws an error if the space to remove is not found in the model instance.
     */
    public removeSpace(s: Space | string): void {
        const space: Space = (s instanceof Space ? s : this.get_space(s));
        if (!space) throw `Space '${s}' to remove from model was not found, while calling [BaseModel.removeSpace]!`;

        const index = this.spaces.indexOf(space);
        const id = space.id;

        if (index > -1) {
            space.clear(); // Remove all objects from the space
            delete this.spaces[index];
            this.spaces.splice(index, 1);
        }

        if (this[spaceid_2_space][id]) {
            this[spaceid_2_space][id] = undefined;
            delete this[spaceid_2_space][id];
        }
        space.ondispose?.();
    }

    public abstract collidesWithTile(o: GameObject, dir: Direction): boolean;
    public abstract isCollisionTile(x: number, y: number): boolean;
}
