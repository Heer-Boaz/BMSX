/**
 * File summary:
 * - Serializer: builds a reference-preserving representation of an object graph (root + objects),
 *   supports JSON or binary encoding, honors exclusion rules and @onsave hooks.
 * - Reviver: reconstructs instances from serialized graphs, resolves references, runs @onload hooks,
 *   and uses a constructor registry populated via @insavegame.
 * - Decorators: @insavegame, @onsave, @onload, @excludepropfromsavegame, excludeclassfromsavegame.
 * - Savegame: a concrete class that demonstrates usage (captures view & sound state).
 *
 * Purpose: centralize save/load (serialization/deserialization) logic for game state with support
 * for custom class registration, reference cycles, typed arrays and binary snapshots.
 */

import { type ModulationParams } from "../audio/soundmaster";
import { Space } from '../core/space';
import { $ } from '../core/game';
import type { BmsxVMState } from '../vm/types';
import { Registry } from "../core/registry";
import { GameView } from '../render/gameview';
import { decodeBinary, encodeBinary } from "./binencoder";
import { Bindable, Identifier } from "../rompack/rompack";
import { insavegame, type RevivableObjectArgs, onsave, onload } from './serializationhooks';
import { typedarray_to_numberarray } from '../utils/typedarray_to_numberarray';
import { SkyboxImageIds } from '../render/shared/render_types';

// Decorators onload/onsave are defined locally in this file
export type ConstructorWithSaveGame<T = Bindable> = (new (...args: any[]) => T) & { __exclude_savegame__?: boolean };

function hasExcludeFlag(ctor: unknown): ctor is { __exclude_savegame__?: boolean } {
	return !!ctor && typeof ctor === 'function' && '__exclude_savegame__' in (ctor) && (ctor as ConstructorWithSaveGame).__exclude_savegame__ === true;
}

/**
 * Provides serialization utilities for objects, supporting both reference-tracking and non-reference-tracking modes,
 * as well as optional binary serialization.
 *
 * The `Serializer` class allows objects to be serialized to JSON strings or binary formats, with support for handling
 * object references, custom exclusion rules, and type metadata. It is designed to work with custom class types and
 * supports extensibility via static properties and helper methods.
 *
 * @remarks
 * - Reference-tracking mode enables correct serialization of object graphs with cycles or shared references.
 * - Binary serialization is only supported when reference tracking is enabled.
 * - Exclusion rules can be customized via `excludedProperties` and `excludedObjectTypes`.
 * - Custom serialization logic can be provided via static `onsave` methods on constructors.
 *
 * @example
 * ```typescript
 * const obj = { foo: "bar" };
 * const json = Serializer.serialize(obj, { refs: false, binary: false });
 * const binary = Serializer.serialize(obj, { refs: true, binary: true });
 * ```
 */
export class Serializer {
	// A place to collect all @onsave hooks by class name
	static onSaves: Record<string, ((...args: any[]) => any)[]> = {};

	/**
	 * Main parameterized serialization entry point.
	 *
	 * @param obj - The object to serialize.
	 * @param options - Serialization options.
	 * @param options.binary - If true, serializes to a binary format. Defaults to true.
	 * @returns The serialized representation of the object, either as a JSON string or a Uint8Array for binary serialization.
	 */
	static serialize(obj: any, options: { binary?: boolean } = { binary: true }): string | Uint8Array {
		return Serializer.serializeAnyWithRefs(obj, options);
	}

	/**
	 * Serializes an object with reference tracking, supporting both JSON and binary formats.
	 *
	 * This method constructs a reference graph from the input object to handle circular references
	 * and shared objects. It then serializes the graph either as a JSON string or as a binary
	 * `Uint8Array`, depending on the provided options.
	 *
	 * @param obj - The object to serialize, which may contain circular references.
	 * @param opts - Optional serialization options.
	 * @param opts.binary - If `true`, serializes to a binary format (`Uint8Array`); otherwise, serializes to a JSON string.
	 * @returns The serialized representation of the object, either as a JSON string or a `Uint8Array`.
	 */
	private static serializeAnyWithRefs(obj: any, opts: { binary?: boolean } = {}): string | Uint8Array {
		const { root, objects } = Serializer.buildReferenceGraph(obj);
		if (opts.binary) {
			return encodeBinary({ root, objects });
		} else {
			return JSON.stringify({ root, objects });
		}
	}

	static excludedProperties: Record<string, Record<string, boolean>> = {};
	static excludedObjectTypes: Set<string> = new Set<string>();
	static propertyIncludeExcludeMap: Map<string, Map<string, boolean>> = new Map<string, Map<string, boolean>>();
	static classExcludeMap: Map<string, boolean> = new Map<string, boolean>();
	static get_typename(value: any): string {
		if (!value) return '';
		if (typeof value === 'function') {
			return (value as Function).name;
		}
		if (typeof value === 'object') {
			const raw = (value as { constructor?: { name?: string } })?.constructor?.name ?? 'Object';
			return raw;
		}
		return typeof value;
	}

	static createInclusionCacheKey(obj: unknown): string {
		if (typeof obj === 'function') return (obj as Function).name;
		const name = (obj as { constructor?: { name?: string } })?.constructor?.name;
		return name;
	}

	// Ensure this method walks the prototype/constructor chain so abstract/base-class annotations are honored.
	static shouldClassBeExcludedFromSaveGame(obj: unknown): boolean {
		const cacheKey = Serializer.createInclusionCacheKey(obj);

		const map = Serializer.classExcludeMap;
		if (cacheKey && map.has(cacheKey)) return map.get(cacheKey)! === true;

		// 1) Walk constructor chain (class-level decorators / flags live here)
		let ctor: any = (typeof obj === 'function') ? obj : (obj as { constructor?: any })?.constructor;
		while (ctor && ctor !== Object) {
			if (hasExcludeFlag(ctor)) { if (cacheKey) map.set(cacheKey, true); return true; }
			if (Serializer.excludedObjectTypes?.has?.(ctor.name)) { if (cacheKey) map.set(cacheKey, true); return true; }
			ctor = Object.getPrototypeOf(ctor);
		}
		// 2) Defensively walk prototype chain of an instance
		let proto: any = (typeof obj === 'function') ? (obj as Function).prototype : Object.getPrototypeOf(obj as object);
		while (proto && proto.constructor && proto.constructor !== Object) {
			const pctor = proto.constructor;
			if (hasExcludeFlag(pctor)) { if (cacheKey) map.set(cacheKey, true); return true; }
			if (Serializer.excludedObjectTypes?.has?.(pctor.name)) { if (cacheKey) map.set(cacheKey, true); return true; }
			proto = Object.getPrototypeOf(proto);
		}
		if (cacheKey) map.set(cacheKey, false);
		return false;
	}

	static shouldPropertyBeExcludedFromSaveGame(value: Record<string, unknown>, key: string): boolean {
		const className = Serializer.get_typename(value);
		const map = Serializer.propertyIncludeExcludeMap;
		let typeMap = map.get(className);
		if (typeMap && typeMap.has(key)) return typeMap.get(key)! === true;
		if (!typeMap) {
			typeMap = new Map<string, boolean>();
			map.set(className, typeMap);
		}
		// Walk prototype chain of the instance
		let proto: any = Object.getPrototypeOf(value as object);
		while (proto && proto.constructor && proto.constructor.name !== 'Object') {
			const tname = Serializer.get_typename(proto.constructor);
			if (Serializer.excludedProperties[tname]?.[key] === true) { typeMap.set(key, true); return true; }
			proto = Object.getPrototypeOf(proto);
		}
		// Check whether the type of the property itself should be excluded
		const propertyValue = value[key];
		if (propertyValue && typeof propertyValue === 'object') {
			const ctorCandidate = propertyValue.constructor;
			if (ctorCandidate && typeof ctorCandidate === 'function') {
				if (Serializer.shouldClassBeExcludedFromSaveGame(ctorCandidate)) { typeMap.set(key, true); return true; }
			}
		}
		typeMap.set(key, false);
		return false;
	}

	/**
	 * Builds a reference graph for the given object, serializing it into a structure that preserves object references.
	 *
	 * This method traverses the input object, assigning unique IDs to each encountered object and replacing references
	 * with `$ref` objects to handle circular references and shared instances. It also serializes arrays and handles
	 * custom type information using `Serializer` and `Reviver` utilities.
	 *
	 * @param obj - The root object to serialize and build the reference graph from.
	 * @returns An object containing:
	 *   - `root`: The serialized root object, with references replaced by `$ref` objects.
	 *   - `objects`: A mapping from unique object IDs to their serialized representations.
	 *
	 * @throws Error if a non-plain object is encountered without a known constructor (missing `@insavegame`).
	 */
	private static buildReferenceGraph(obj: any): { root: any, objects: Record<number, any> } {
		const objectMap = new Map<any, number>();
		const objects: Record<number, any> = {};
		let idCounter = 1;
		function getIdForObject(o: any): number {
			if (objectMap.has(o)) return objectMap.get(o)!;
			const id = idCounter++;
			objectMap.set(o, id);
			return id;
		}

		// Iterative stack-based traversal
		const stack: Array<{ value: any; parent: any; key: string | number; plain?: any; typename?: string; theConstructor?: any }> = [];
		let rootRef: any = undefined;
		stack.push({ value: obj, parent: null, key: undefined });
		while (stack.length > 0) {
			const frame = stack.pop()!;
			const { value, parent, key } = frame;
			if (value === null || value === undefined) {
				if (parent && key !== undefined) parent[key] = value;
				else rootRef = value;
				continue;
			}
			const typeoff = typeof value;
			if (typeoff !== 'object') {
				if (parent && key !== undefined) parent[key] = value;
				else rootRef = value;
				continue;
			}
			if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
				const id = getIdForObject(value);
				const typename = Serializer.get_typename(value);
				const taPlain: { typename: string; data: number[]; isTypedArray: true } = { typename, data: typedarray_to_numberarray(value), isTypedArray: true };
				if (parent && key !== undefined) parent[key] = { r: id };
				else rootRef = { r: id };
				objects[id] = taPlain;
				continue;
			}
			if (Array.isArray(value)) {
				const arr = value.length > 0 ? new Array(value.length) : [];
				if (parent && key !== undefined) parent[key] = arr;
				else rootRef = arr;
				for (let i = value.length - 1; i >= 0; --i) {
					stack.push({ value: value[i], parent: arr, key: i });
				}
				continue;
			}
			if (objectMap.has(value)) {
				// Use { r: id } instead of { $ref: id }
				const ref = { r: objectMap.get(value) };
				if (parent && key !== undefined) parent[key] = ref;
				else rootRef = ref;
				continue;
			}
			const id = getIdForObject(value);
			const typename = Serializer.get_typename(value);
			if (Serializer.shouldClassBeExcludedFromSaveGame(value)) {
				// Skip completely: do not include this property in serialized output
				// console.log(`Class '${typename}' is excluded from serialization.`);
				continue;
			}
			// Only add typename if needed
			const knownConstructorForType = Reviver.get_constructor_for_type(typename);
			const isPlainObject = (typename === 'Object' || typename === 'object');
			const hasConstructor = (!isPlainObject && knownConstructorForType);
			if (!isPlainObject && !knownConstructorForType && !Serializer.shouldClassBeExcludedFromSaveGame(value)) {
				console.warn(`[Serializer] Object of type '${typename}' encountered without a known constructor. Did you forget to add '@insavegame' to the class definition?`);
				// Add the typename to the excluded properties to prevent serialization again after raising the error
				const key = Serializer.createInclusionCacheKey(value.constructor as ConstructorWithSaveGame<any>);
				Serializer.classExcludeMap.set(key, true); // Exclude from serialization
				(value.constructor as ConstructorWithSaveGame).__exclude_savegame__ = true;
				continue;
			}
			// Create a plain object for serialization
			// If we have a known constructor, we can use the typename
			// Otherwise, we just use an empty object
			const plain: Record<string, unknown> = hasConstructor ? { typename } : {};
			// Use { r: id } for references
			if (parent && key !== undefined) parent[key] = { r: id };
			else rootRef = { r: id };
			// Only enumerate own properties
			const keys = Object.keys(value);
			for (let i = keys.length - 1; i >= 0; --i) {
				const k = keys[i];
				// Inline exclusion logic for performance
				const v = (value as Record<string, unknown>)[k];
				if (v === null || v === undefined) continue;
				if (k && Serializer.shouldPropertyBeExcludedFromSaveGame(value, k)) {
					// console.debug(`Property '${k}' of type '${typename}' is excluded from serialization.`);
					continue;
				}
				const vType = typeof v;
				switch (vType) {
					case 'function':
					case 'undefined':
						continue;
					case 'object':
						if (Array.isArray(v)) break;
						const valType = Serializer.get_typename(v);
						switch (valType.toLowerCase()) {
							case 'object':
								// We can handle plain objects without a known constructor without having to invoke the constructor
								break;
							case 'float32array':
							case 'float64array':
							case 'sharedarraybuffer':
							case 'dataview':
							case 'arraybuffer':
								// We can handle typed arrays and array buffers without a known constructor
								break;
							case 'webgltexture':
								continue; // Skip WebGL textures
							case 'set':
								// We can handle Sets without a known constructor
								break;
							default:
								if (!Reviver.get_constructor_for_type(valType)) {
									console.warn(`[Serializer] Property '${typename}.${k}' cannot be serialized, because object of type '${valType}' isn't a known constructor. Did you forget to add '@insavegame' to the class definition?`);
									const key = Serializer.createInclusionCacheKey(v.constructor as ConstructorWithSaveGame<any>);
									Serializer.classExcludeMap.set(key, true); // Exclude from serialization
									(v.constructor as ConstructorWithSaveGame).__exclude_savegame__ = true;
									continue;
								}
								break;
						}
						// Avoid cycles
						if (objectMap.has(v)) break;
						break;
				}
				stack.push({ value: v, parent: plain, key: k });
			}
			// Run @onsave hooks
			// Collect @onsave hooks from the prototype chain (like Reviver.onLoads)
			let proto = Object.getPrototypeOf(value);
			const saveFunctions: ((...args: any[]) => any)[] = [];
			while (proto && proto.constructor && proto.constructor.name !== 'Object') {
				const cname = Serializer.get_typename(proto.constructor);
				const s = Serializer.onSaves[cname];
				s && saveFunctions.push(...s);
				proto = Object.getPrototypeOf(proto);
			}
			// Call in reverse order so base-class hooks run first (same approach as Reviver)
			for (let i = saveFunctions.length - 1; i >= 0; i--) {
				let res;
				const fn = saveFunctions[i];
				if (fn.length === 1) {
					// static-style: call with constructor as `this`, pass object as arg
					res = fn.call(value.constructor, value);
				} else {
					// instance-style: call with object as `this`
					res = fn.call(value);
				}
				const extras = res || {};
				for (const k of Object.keys(extras)) {
					plain[k] = extras[k];
				}
			}
			objects[id] = plain;
		}
		return { root: rootRef, objects };
	}
}

/**
 * The `Reviver` class provides static methods and registries for deserializing objects with type information,
 * supporting both JSON and custom binary formats, and handling object references and post-deserialization hooks.
 *
 * ## Features
 * - Maintains registries for constructors (`constructors`) and post-load callbacks (`onLoads`) by type name.
 * - Supports deserialization from JSON strings and custom binary formats, including reference resolution.
 * - Handles custom object instantiation based on a `typename` property.
 * - Invokes registered `onLoad` hooks after object creation for additional initialization.
 * - Removes serialization-specific properties after deserialization.
 *
 * ## Usage
 * 1. Register constructors for types using `Reviver.constructors`.
 * 2. Optionally register post-load hooks in `Reviver.onLoads`.
 * 3. Use `deserializeWithRefs` or `deserializeWithRefsBinary` to deserialize data.
 *
 * @example
 * // Register a class for deserialization
 * Reviver.constructors["MyClass"] = MyClass;
 *
 * // Deserialize JSON with references
 * const obj = Reviver.deserializeWithRefs(jsonString);
 *
 * // Deserialize binary data
 * const obj = Reviver.deserializeWithRefsBinary(binaryData);
 */
export class Reviver {
	static constructors: Record<string, new () => any> = {};
	static onLoads: Record<string, ((...args: any[]) => any)[]> = {};
	static excludedProperties: Record<string, Record<string, boolean>> = {};

	static removeSerializerProps(obj: { typename: string; }): void {
		obj.typename = undefined;
		delete obj.typename;
	}
	static get_constructor_for_type(typename: string): new () => any {
		return Reviver.constructors[typename] ?? Reviver.constructors[typename];
	}

	static deserialize(input: string | Uint8Array, options: { isBinary?: boolean } = { isBinary: true }) {
		const { root, objects } = options.isBinary ? decodeBinary(input as Uint8Array) : JSON.parse(input as string);
		const idToObject: Record<string, any> = {};
		if (!objects || Object.keys(objects).length === 0 || !root) {
			console.error('[Reviver] Gamestate to deserialize is invalid!');
			return null;
		}
		// First pass: create all objects (empty shells)
		for (const id of Object.keys(objects)) {
			const data = objects[id];
			if (data === undefined) {
				throw new Error(`[Reviver] Missing object payload for id '${id}'.`);
			}
			if (typeof data === 'object' && 'isTypedArray' in data && (data as { isTypedArray: unknown }).isTypedArray) {
				const ctorUnknown = (globalThis as Record<string, unknown>)[(data as { typename: string }).typename];
				if (typeof ctorUnknown === "function") {
					const C = ctorUnknown as new (data: number[]) => unknown;
					idToObject[id] = new C((data as { data: number[] }).data);
				} else {
					idToObject[id] = (data as { data: number[] }).data;
				}
				continue;
			}
			if (typeof data === 'object' && typeof data.typename === 'string' && data.typename !== 'Object' && data.typename !== 'object') {
				const ctor = Reviver.get_constructor_for_type(data.typename) as (new (opts: RevivableObjectArgs) => any);
				if (!ctor) {
					console.error(`[Reviver] No constructor known for object of type '${data.typename}'. Did you forget to add '@insavegame' to the class definition?`);
					// Add the typename to the excluded properties to prevent deserialization again after raising the error
					Reviver.excludedProperties[data.typename] ??= {};
					Reviver.excludedProperties[data.typename].id = true;
					idToObject[id] = null; // Mark as null to avoid further processing
					continue;
				}
				else idToObject[id] = new ctor({ constructReason: 'revive' });
			} else {
				idToObject[id] = Array.isArray(data) ? [] : {};
			}
		}
		// Second pass: assign properties
		for (const id of Object.keys(objects)) {
			const data = objects[id];
			if (data === undefined) {
				throw new Error(`[Reviver] Missing object payload for id '${id}' during assignment phase.`);
			}
			if (typeof data === 'object' && 'isTypedArray' in data && (data as { isTypedArray: unknown }).isTypedArray) continue;
			const target = idToObject[id];
			if (target === null || target === undefined) continue; // guard: geen assignment naar null/undefined
			for (const key of Object.keys(data)) {
				if (key === 'typename') continue;
				if (typeof (data as { typename?: string }).typename === 'string') {
					const typeName = (data as { typename: string }).typename;
					const excluded = Reviver.excludedProperties[typeName];
					if (excluded && excluded[key]) continue;
				}
				const val = data[key];
				if (Array.isArray(val)) {
					// If every element is a { r: ... }, resolve all and drop nulls
					if (val.every(v => v && typeof v === 'object' && 'r' in v)) {
						target[key] = val
							.map(v => idToObject[v.r])
							.filter(v => v !== null && v !== undefined);
					} else {
						// For nested arrays (e.g. hitpolygon: vec2[][]), resolve recursively and drop nulls at each level
						target[key] = val.map(v => {
							if (Array.isArray(v)) {
								return v
									.map(w => (w && typeof w === 'object' && 'r' in w) ? idToObject[w.r] : w)
									.filter(w => w !== null && w !== undefined);
							} else if (v && typeof v === 'object' && 'r' in v) {
								return idToObject[v.r];
							} else {
								return v;
							}
						}).filter(v => v !== null && v !== undefined);
					}
				} else if (val && typeof val === 'object' && 'r' in val) {
					target[key] = idToObject[val.r];
				} else {
					target[key] = val;
				}
			}
			if (typeof data.typename === 'string' && data.typename !== 'Object' && data.typename !== 'object') {
				Reviver.removeSerializerProps(target);
				idToObject[id] = target; // Update the object in the map
				// If the object has an `id` property, register it in the global registry
				if (target.id && !target.registrypersistent) { // Only register if not persistent
					Registry.instance.register(target);
				}
			}
		}
		// --- Third pass: call all registered @onload methods if present ---
		for (const id of Object.keys(idToObject)) {
			const original = objects[id];
			if (original === undefined) {
				throw new Error(`[Reviver] Missing source payload for id '${id}' while invoking onload hooks.`);
			}
			if (typeof original === 'object' && 'isTypedArray' in original && (original as { isTypedArray: unknown }).isTypedArray) continue;
			const obj = idToObject[id];
			if (obj === null || obj === undefined) continue; // skip unknown or filtered types
			let proto = Object.getPrototypeOf(obj);
			let reviverFunctions = [];
			while (proto && proto.constructor && proto.constructor.name !== 'Object') {
				const cname = Serializer.get_typename(proto.constructor);
				const revivers = Reviver.onLoads[cname];
				revivers && reviverFunctions.push(...revivers);
				proto = Object.getPrototypeOf(proto);
			}
			for (let i = reviverFunctions.length - 1; i >= 0; i--) {
				// Detect static method: if the function's 'length' is 1, assume it's static and expects the object as argument
				if (reviverFunctions[i].length === 1) {
					// Static: call with the revived object as argument, and 'this' as the constructor
					reviverFunctions[i].call(obj.constructor, obj);
				} else {
					// Instance: call with the object as 'this'
					reviverFunctions[i].call(obj);
				}
			}
		}
		// Return root object (resolve { r: id })
		return (root && root.r !== undefined) ? idToObject[root.r] : root;
	}
}

type VoiceState = { id: string; offset: number; params: ModulationParams; priority: number };
type VoiceQueueItem = { id: string; params: ModulationParams; priority: number; cooldownMs?: number; actorId?: Identifier };
type SoundMasterState = {
	sfxVoices: VoiceState[];
	uiVoices: VoiceState[];
	musicVoices: VoiceState[];
	sfxQueue?: VoiceQueueItem[];
	uiQueue?: VoiceQueueItem[];
};

type ViewState = {
	dynamicAtlasIndex: number;
	activeCameraId: string;
	skyboxFaceIds: SkyboxImageIds;
};

@insavegame
/**
 * Represents a savegame object that contains all the necessary data to save and load the game state.
 */
export class Savegame {
	modelprops: {};
	servicesState?: Record<string, unknown>;
	spaces: Space[];
	SMState: SoundMasterState;
	viewState: ViewState;
	timestamp: number;
	bmsxVMState?: BmsxVMState;

	constructor(_opts?: RevivableObjectArgs) {
		this.timestamp = $.platform.clock.dateNow();
	}

	@onsave
	saveViewState() {
		// Capture current view state
		const view = $.view as GameView;
		const viewState: ViewState = {
			dynamicAtlasIndex: view.dynamicAtlas,
			activeCameraId: $.world.activeCameraId ,
			skyboxFaceIds: view.skyboxFaceIds,
		};
		return { viewState };
	}

	@onload
	restoreViewState() {
		const view = $.view as GameView;
		// Restore view state
		if (this.viewState) {
			if (this.viewState.dynamicAtlasIndex !== undefined) {
				view.dynamicAtlas = this.viewState.dynamicAtlasIndex;
			}
			$.world.activeCameraId = this.viewState.activeCameraId;
			if (this.viewState.skyboxFaceIds) {
				view.setSkybox(this.viewState.skyboxFaceIds);
			}
		}
	}

	@onsave
	saveSoundState() {
		// Capture full sound master playback state (multi-voice aware)
		const SMState: SoundMasterState = {
			sfxVoices: $.sndmaster.snapshotVoices('sfx'),
			uiVoices: $.sndmaster.snapshotVoices('ui'),
			musicVoices: $.sndmaster.snapshotVoices('music'),
		};

		// Capture queues via AudioEventManager and convert to VoiceQueueItem shape
		const qs = $.aem.getQueues();
		SMState.sfxQueue = qs.sfx.map(q => ({
			id: q.audioId,
			params: (q.modulationParams ?? (q.modulationPreset !== undefined ? ($.rompack.data[q.modulationPreset] as ModulationParams) : {} as ModulationParams)),
			priority: q.priority ?? 0,
			cooldownMs: q.cooldownMs,
			actorId: q.payloadActorId,
		}));
		SMState.uiQueue = qs.ui.map(q => ({
			id: q.audioId,
			params: (q.modulationParams ?? (q.modulationPreset !== undefined ? ($.rompack.data[q.modulationPreset] as ModulationParams) : {} as ModulationParams)),
			priority: q.priority ?? 0,
			cooldownMs: q.cooldownMs,
			actorId: q.payloadActorId,
		}));

		return { SMState };
	}

	@onload
	restoreSoundState() {
		// Restore multi-voice sound master state
		$.sndmaster.stopEffect();
		$.sndmaster.stopUI();
		$.sndmaster.stopMusic();
		const SMState = this.SMState;
		if (!SMState) return;
		for (const v of (SMState.musicVoices || [])) {
			const params: ModulationParams = { ...v.params, offset: v.offset };
			void $.sndmaster.play(v.id, { params, priority: v.priority });
		}
		for (const v of (SMState.sfxVoices || [])) {
			const params: ModulationParams = { ...v.params, offset: v.offset };
			void $.sndmaster.play(v.id, { params, priority: v.priority });
		}
		for (const v of (SMState.uiVoices || [])) {
			const params: ModulationParams = { ...v.params, offset: v.offset };
			void $.sndmaster.play(v.id, { params, priority: v.priority });
		}
		const aem = $.aem;
		const sfx = (SMState.sfxQueue || []).map(q => ({ audioId: q.id, modulationParams: q.params, priority: q.priority, cooldownMs: q.cooldownMs, payloadActorId: q.actorId }));
		const ui = (SMState.uiQueue || []).map(q => ({ audioId: q.id, modulationParams: q.params, priority: q.priority, cooldownMs: q.cooldownMs, payloadActorId: q.actorId }));
		aem.restoreQueues({ sfx, ui });
	}
}

/**
 * Decodes a binary snapshot and returns a pretty-printed JSON string for debugging.
 * @param buf - The binary buffer produced by serializeWithRefsBinary.
 * @returns A human-readable JSON string.
 */
export function debugPrintBinarySnapshot(buf: Uint8Array): string {
	try {
		const obj = decodeBinary(buf);
		return JSON.stringify(obj, null, 2);
	} catch (e) {
		return `Failed to decode binary snapshot: ${e}`;
	}
}
