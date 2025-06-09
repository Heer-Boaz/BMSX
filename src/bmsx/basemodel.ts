import { BehaviorTreeDefinition, BehaviorTreeDefinitions, BehaviorTreeID, setup_bt_library, setup_btdef_library } from "./behaviourtree";
import { BinaryCompressor } from "./bincompressor";
import { Vector } from "./bmsx";
import { State, StateDefinition, StateMachineController } from "./fsm";
import { StateDefinitions, setupFSMlibrary } from "./fsmlibrary";
import { Stateful } from "./fsmtypes";
import type { Identifier, Registerable, RegisterablePersistent } from "./game";
import { Direction } from "./game";
import { GameObject } from "./gameobject";
import { Reviver, Savegame, Serializer, excludepropfromsavegame, insavegame } from "./gameserializer";
import { Input } from "./input";
import { Registry } from "./registry";

export interface SpaceObject {
    spaceid: Identifier;
    objects: GameObject[];
}

export type id2objectType = Record<Identifier, GameObject>;
export type id2spaceType = Record<Identifier, Space>;
export type obj_id2space_id_type = Record<Identifier, Identifier>;
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
     * @type {Record<Identifier, GameObject>}
     */
    public [id2obj]: id2objectType;

    /**
     * Returns the GameObject with the specified ID, or undefined if no such object exists in this space.
     * @template T - The type of the GameObject to return.
     * @param {Identifier} id - The ID of the GameObject to retrieve.
     * @returns {T | undefined} The GameObject with the specified ID, or undefined if no such object exists in this space.
     */
    public get<T extends GameObject>(id: Identifier): T | undefined {
        return <T>this[id2obj][id];

    }

    public id: Identifier;

    @excludepropfromsavegame
    public objects: GameObject[];

    /**
     * A function that is called when the Space object is disposed of.
     * @type {() => void}
     */
    public ondispose?: () => void;

    // @onsave
    // /**
    //  * Creates a new Space object that can be safely serialized for saving the game.
    //  * @param {Space} o - The Space object to be serialized.
    //  * @returns {Space} A new Space object that can be safely serialized for saving the game.
    //  */
    // public static tosaved(o: Space): Space {
    //     const result = new Space(o.id);
    //     Object.assign(result, o);
    //     result.objects = undefined;
    //     delete result.objects;
    //     return result;
    // }

    /**
     * Represents a space in the game world, which contains a collection of game objects.
     * @constructor
     * @param {Identifier} id - The unique identifier for the space.
     */
    public constructor(id: Identifier) {
        this.id = id;
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
     * @param {Vector} pos - Position to spawn object
     * @param {boolean} skip_onspawn_event - Disables triggering onspawn-event.
     * Example uses include reviving the game (part of loading a saved game) and moving objects from one space to another.
     * @returns {void} Nothing
     */
    public spawn(o: GameObject, pos?: Vector, skip_onspawn_event?: boolean): void {
        if (!o?.id) throw new Error(`Cannot spawn object '${o?.id ?? 'undefined'}' as it doesn't have a valid id!`);
        if ($.model[objid_2_objspaceid][o.id]) throw new Error(`Cannot spawn object '${o.id}' in space '${this.id}' as it already exists in space '${$.model[objid_2_objspaceid][o.id]}'!`);

        this.objects.push(o); // Add the object to the space

        this[id2obj][o.id] = o; // Register the object in the `id2object`-object, so we can retrieve the object by id
        $.model[objid_2_objspaceid][o.id] = this.id; // Register the object in the `obj_id2obj_space_id`-object, so we can retrieve the space id for the object id
        !skip_onspawn_event && o.onspawn?.(pos); // Trigger onspawn event after adding the object to the space. `onspawn` subscribes the object to events and starts the object's state machine

        this.sort_by_depth(); // Sort after spawn-event, just to be sure
    }

    /**
     * Removes object from the game and triggers it's ondispose-event.
     * @param {GameObject} o  - GameObject to dispose
     * @param {boolean} skip_ondispose_event - Disables triggering ondispose-event.
     * Example uses include moving objects from one space to another.
     * @returns {void} Nothing
     */
    public exile(o: GameObject, skip_ondispose_event: boolean = false): void {
        const index = this.objects.indexOf(o);
        if (index < 0) throw new Error(`GameObject ${o?.id ?? o} to remove from space '${this.id}' was not found, while calling [BaseModel.exile]!`);
        !skip_ondispose_event && o.dispose?.(); // Trigger ondispose event before removing the object from the space. `ondispose` unsubscribes the object from events and removes it from the registry

        if (index > -1) {
            delete this.objects[index];
            this.objects.splice(index, 1);
        }

        if (this[id2obj][o.id]) {
            this[id2obj][o.id] = undefined;
            delete this[id2obj][o.id];
        }

        if ($.model[objid_2_objspaceid][o.id]) {
            $.model[objid_2_objspaceid][o.id] = undefined;
            delete $.model[objid_2_objspaceid][o.id];
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
export abstract class BaseModel implements Stateful, RegisterablePersistent {
    get registrypersistent(): true {
        return true;
    }

    /**
     * Retrieves an entity from the registry based on its identifier.
     * @param id The identifier of the entity to retrieve.
     * @returns The retrieved entity if found, otherwise null.
     */
    public get<T extends Registerable = any>(id: Identifier): T | null {
        return $.registry.get(id);
    }

    public get id(): Identifier { return 'model'; } // Required for IStateful and IIdentifiable

    on(event_name: string, handler: Function, emitter_id: Identifier): void {
        $.event_emitter.on(event_name, handler, this, emitter_id);
    }

    /**
     * An array of keys to exclude from the serialized game state when saving the game.
     * These keys include references to objects and spaces that should not be saved.
     */
    public static readonly keys_to_exclude_from_save = ['objects', 'id2object', 'spaces', 'id2space', 'obj_id2obj_space_id', 'registry'];

    /**
     * The controller for the state machine.
     */
    public sc: StateMachineController;

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
    protected currentSpaceid: Identifier; // Current space. On model creation, a default space is created with id 'default'
    public get current_space_id(): Identifier { return this.currentSpaceid; } // Current space id. On model creation, a default space is created with id 'default'
    public get currentSpace(): Space { return this.get_space(this.currentSpaceid); } // Current space. On model creation, a default space is created with id 'default'
    public setSpace(newSpaceId: Identifier) { this.currentSpaceid = newSpaceId; }
    public get_space<T extends Space>(id: Identifier) { return <T>this[spaceid_2_space][id]; }

    public paused: boolean;
    public startAfterLoad: boolean;

    /**
     * Gets the game object with the given id from the current space only.
     * @param {Identifier} id - the id of the {@link GameObject}.
     * @returns {T} The game object with the given id from the current space only.
     */
    public getFromCurrentSpace<T extends GameObject>(id: Identifier): T {
        return <T>this.currentSpace[id2obj][id];
    }

    /**
     * Gets the game object with the given id across all spaces.
     * If `id === 'model'`, returns the game model instead! This is used for {@link State} to make game model as target for callbacks.
     * @param {Identifier} id - the id of the {@link GameObject}.
     * @returns {T | null} The object with the given id or the game model itself (when `id === 'model'`), or null if the object is not found.
     */
    public getGameObject<T extends GameObject = GameObject>(id: Identifier): T | null {
        // Get the space that contains the object with the given id
        const space = this.get_space(this[objid_2_objspaceid][id]);

        // Return the object from the space and if the space is not found, or the object is not found in the space, return null
        return space?.get<T>(id) ?? null;
    }

    /**
     * Returns true if an object exists **in any space** with the given object id.
     * @param {Identifier} obj_id The id of the object that we want to know whether it exists.
     * @returns {boolean} Whether an object was found _in any space_ with the given object id.
     */
    public exists(obj_id: Identifier): boolean {
        return this.getGameObject(obj_id) ? true : false;
    }

    /**
     * Returns the id of the space that contains the object with the given id.
     * @param {Identifier} obj_id - The id of the object to search for.
     * @returns {Identifier} The id of the space that contains the object with the given id.
     */
    public get_spaceid_that_has_obj(obj_id: Identifier): Identifier {
        return this[objid_2_objspaceid][obj_id];
    }

    /**
     * Returns true if the object with the given id is in the current space.
     * @param {Identifier} obj_id - The id of the object to check.
     * @returns {boolean} Whether the object with the given id is in the current space.
     */
    public is_obj_in_current_space(obj_id: Identifier): boolean {
        return this.get_spaceid_that_has_obj(obj_id) === this.currentSpaceid;
    }

    /**
     * Moves an object from one space to another. Object should exist in a space, otherwise error is thrown!
     * @param {Identifier} obj_id - id of object to move.
     * @param {Identifier} spaceid_to_move_obj_to - id of the new space of the object to move.
     * @returns {void} Nothing
     */
    public move_obj_to_space(obj_id: Identifier, spaceid_to_move_obj_to: Identifier): void {
        const obj = this.getGameObject<GameObject>(obj_id);
        if (!obj) throw Error(`Cannot move unknown object '${obj_id}' to space '${spaceid_to_move_obj_to}'!`); // ? SHOULD THROW ERROR?
        const target_space = this.get_space(spaceid_to_move_obj_to);
        if (!target_space) throw Error(`Cannot move object '${obj_id}' to unknown space '${spaceid_to_move_obj_to}'!`); // ? SHOULD THROW ERROR?
        const origin_space = this.get_space(this.get_spaceid_that_has_obj(obj_id));

        origin_space.exile(obj, true);
        target_space.spawn(obj, null, true);
    }

    /**
     * Moves the object with the specified ID to the current space.
     *
     * @param obj_id - The identifier of the object to be moved.
     */
    public move_obj_to_current_space(obj_id: Identifier): void {
        this.move_obj_to_space(obj_id, this.currentSpaceid);
    }

    /**
     * Returns the machine definition for the given machine id.
     * @param {Identifier} machineid - The id of the machine to get the definition for.
     * @returns {mdef} The machine definition for the given machine id.
     */
    public static getMachinedef(machineid: Identifier): StateDefinition {
        return StateDefinitions[machineid];
    }

    /**
     * Returns the state definition for the given machine and state id.
     * @param {Identifier} machineid - The id of the machine to get the state definition for.
     * @param {Identifier} stateid - The id of the state to get the definition for.
     * @returns {StateDefinition} The state definition for the given machine and state id.
     */
    public static getMachineStatedef(machineid: Identifier): StateDefinition {
        return StateDefinitions[machineid];
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
        Registry.instance.register(this);
        this.spaces = [];
        this[spaceid_2_space] = {};
        this[objid_2_objspaceid] = {};

        this.paused = false;
    }

    public init_on_boot(): void {
        BaseModel.setup_fsmdef_library();
        BaseModel.setup_bt_library();
        this.init_event_subscriptions().init_spaces().init_model_state_machines($.model.constructor_name).do_one_time_game_init();
    }

    public dispose(): void {
        // Clear all spaces and objects
        this.clearAllSpaces();
        // Dispose the state machine controller and deregister all state machines
        this.sc.dispose();
        // Unsubscribe from all events
        $.event_emitter.removeSubscriber(this);
        $.registry.deregister(this);
    }

    public init_event_subscriptions(): BaseModel {
        $.event_emitter.initClassBoundEventSubscriptions(this);
        return this; // Return the current instance of the BaseModel for chaining
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

        return this; // Return the current instance of the BaseModel for chaining
    }

    /**
     * Sets up the finite state machine definition library for the `BaseModel` class.
     * This method should only be called once during the initialization of the `BaseModel` class.
     * @returns {void} Nothing.
     */
    private static setup_fsmdef_library(): void {
        setupFSMlibrary();
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
        this.sc = new StateMachineController();
        this.sc.add_statemachine(derived_modelclass_constructor_name, this.id);
        this.sc.start(); // Start the state machine controller (this will start all state machines that are added to the controller) and transition to the default state of the model, and subscribe to all events that are defined in the state machine definitions

        return this; // Return the current instance of the BaseModel for chaining
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
    public run(_deltaTime: number): void {
        this.sc.run();
    }

    /**
     * Runs the game loop by calling the `run` method of all game objects and removing objects that are marked for disposal.
     * If the game is paused or is set to start after loading, this function returns without doing anything.
     * @returns {void} Nothing
     */
    public static defaultrun = (): void => {
        if ($.model.paused) {
            return;
        }
        if ($.model.startAfterLoad) {
            return;
        }

        let objects = $.model.objects; // Get all objects in the current space
        // Let all game objects take a turn
        objects.forEach(o => !o.disposeFlag && o.run && o.run());

        // Remove all objects that are to be disposed
        objects.filter(o => o.disposeFlag).forEach(o => $.model.exile(o));
    };

    /**
     * The default input handler for allowing the game menu to be opened.
     * If the F5 key is pressed, the game menu substate is set to 'open'.
     * @param {BaseModel} this - The current instance of the BaseModel.
     * @param {State<BaseModel>} s - The current state of the BaseModel.
     * @returns {void} Nothing.
     */
    static default_input_handler_for_allow_open_gamemenu(this: BaseModel): void {
        if (Input.KC_F5) {
            this.sc.machines.gamemenu.to('open');
        }
    }

    /**
     * The default input handler for allowing the game menu to be closed.
     * If the F5 key is pressed, the game menu substate is set to 'closed'.
     * @param {BaseModel} this - The current instance of the BaseModel.
     * @param {State<BaseModel>} s - The current state of the BaseModel.
     * @returns {void} Nothing.
     */
    static default_input_handler_for_allow_close_gamemenu(this: BaseModel): void {
        if (Input.KC_F5) {
            this.sc.machines.gamemenu.to('closed');
        }
    }

    static default_input_handler(this: BaseModel) {
    }

    /**
     * Loads a serialized game state and applies it to the current model instance.
     * Clears all spaces and removes all objects from the model instance before loading the new state.
     * @param {string} serialized - The serialized game state to load.
     * @returns {void} Nothing.
     */
    public load(serialized: Uint8Array, compressed: boolean = true): void {
        this.clearAllSpaces(); // Clear all spaces and objects before loading the new state (otherwise, objects from the previous state will still be present)
        $.event_emitter.dispose(); // Dispose the event emitter before loading the new state (otherwise, event handlers from the previous state will still be present)

        const temp_array = this.spaces.slice(); // Create a copy of the spaces array to prevent the spaces from being cleared when clearing the model instance
        temp_array.forEach(s => this.removeSpace(s)); // Remove all spaces from the model instance before loading the new state (otherwise, spaces from the previous state will still be present)

        let serializedState: Uint8Array;
        if (compressed) {
            serializedState = BinaryCompressor.decompressBinary(serialized); // Decompress the serialized state
        } else {
            serializedState = serialized; // Use the serialized state as is
        }

        $.registry.clear(); // Clear the registry before loading the new state (otherwise, registered objects from the previous state will still be present). Note that this will not clear the model instance itself, as the model instance has the property `registrypersistent: true` and will not be cleared. The same applies to Input, View, and other persistent objects.
        const savegame = Reviver.deserialize(serializedState) as Savegame;
        Object.assign(this, savegame.modelprops);

        const persistentEntities = $.registry.getPersistentEntities();
        persistentEntities.forEach(entity => {
            $.event_emitter.initClassBoundEventSubscriptions(entity); // Reinitialize event subscriptions for persistent entities, including the model instance itself
        });

        savegame.spaces.forEach(space => this.addSpace(space));
        savegame.allSpacesObjects.forEach(space_and_objects => {
            const space = this[spaceid_2_space][space_and_objects.spaceid];
            const objects = space_and_objects.objects;
            objects.forEach(o => space.spawn(o, null, true));
        });

    }

    /**
     * Saves the current game state by creating a `Savegame` object and serializing it.
     * Pauses the game while creating the `Savegame` object to ensure consistency.
     * Excludes keys listed in `BaseModel.keys_to_exclude_from_save` from the saved data.
     * @returns {string} The serialized `Savegame` object.
     */
    public save(compress: boolean = true): Uint8Array {
        const createSavegame = () => {
            const keys = Object.keys(this);
            const data = {};
            for (let index = 0; index < keys.length; ++index) {
                const key = keys[index];
                if (BaseModel.keys_to_exclude_from_save.includes(key) || Serializer.excludedProperties['Basemodel']?.[key]) continue;
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
        const serializedState = Serializer.serialize(savegame) as Uint8Array; // Serialize the savegame to a binary format
        let returnedState: Uint8Array;
        if (compress) {
            returnedState = BinaryCompressor.compressBinary(serializedState); // Compress the serialized state if requested
        } else {
            returnedState = serializedState; // Use the serialized state as is if compression is not requested
        }

        // console.debug(`Serialized savegame size: ${serializedState.length} bytes`);
        // console.debug(`Compressed savegame size: ${compressedState.length} bytes, ratio: ${Math.round((compressedState.length / serializedState.length) * 100)}%`);
        return returnedState;
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
     * @param {Vector} [pos] - The position to spawn the game object at. If not provided, the game object's default position will be used.
     * @param {boolean} [ignoreSpawnhandler=false] - Whether to ignore the game object's spawn handler. If not provided, the spawn handler will be executed.
     * @returns {void} Nothing.
     */
    public spawn(o: GameObject, pos?: Vector, ignoreSpawnhandler?: boolean): void {
        if (!o?.id) throw new Error(`Cannot spawn object '${o?.id ?? 'undefined'}' as it doesn't have a valid id.`);
        this.currentSpace.spawn(o, pos, ignoreSpawnhandler);
    }

    /**
     * Exiles a game object from all spaces in the model instance.
     * @param {GameObject} o - The game object to exile.
     * @returns {void} Nothing.
     */
    public exile(o: GameObject): void {
        this.spaces.forEach(s => s.get(o.id) && s.exile(o)); // Exile the object from all spaces that contain it
        // Note that we don't need to dispose / deregister the object, as that is done in the `ondispose` method of the `GameObject` class
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
     * @param {Space | Identifier} s - The space to add to the model instance. Can be a `Space` object or a string representing the ID of the new space.
     * @returns {void} Nothing.
     * @throws {Error} Throws an error if a space with the same ID already exists in the model instance.
     */
    public addSpace(s: Space | Identifier): void {
        const new_space: Space = (s instanceof Space ? s : new Space(s));
        if (this[spaceid_2_space][new_space.id]) throw Error(`Cannot add duplicate Space '${new_space.id}' to model!`);

        this.spaces.push(new_space);
        this[spaceid_2_space][new_space.id] = new_space;
    }

    /**
     * Removes a space from the model instance.
     * @param {Space | Identifier} s - The space to remove from the model instance. Can be a `Space` object or a string representing the ID of the space to remove.
     * @returns {void} Nothing.
     * @throws {Error} Throws an error if the space to remove is not found in the model instance.
     */
    public removeSpace(s: Space | Identifier): void {
        const space: Space = (s instanceof Space ? s : this.get_space(s));
        if (!space) throw Error(`Space '${s}' to remove from model was not found, while calling [BaseModel.removeSpace]!`);

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
