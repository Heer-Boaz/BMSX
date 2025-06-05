import { ISpaceObject, Space } from "./basemodel";
import { decodeBinary, encodeBinary } from "./binencoder";
import { Registry } from "./registry";
import { SM } from "./soundmaster";

// Decorators onload/onsave are defined locally in this file

/**
 * Serializes the input object to a string using JSON.stringify, excluding any properties that should not be serialized.
 * @param obj - The object to serialize.
 * @returns The serialized string representation of the input object.
 */
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
    // ← add a place to collect all @onsave hooks by class name
    static onSaves: Record<string, ((v: any) => Record<string, any>)[]> = {};

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
    static get_typename(value: any): string {
        return value?.constructor?.name ?? value?.prototype?.name;
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
        const stack: Array<{ value: any; parent: any; key: string | number | undefined; plain?: any; typename?: string; theConstructor?: any }> = [];
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
            if (Serializer.excludedObjectTypes.has(typename)) {
                // Skip completely: do not include this property in serialized output
                continue;
            }
            const theConstructor = Reviver.get_constructor_for_type(typename);
            // Only add typename if needed
            const plain: any = (typename !== 'Object' && typename !== 'object' && theConstructor)
                ? { typename }
                : {};
            // Use { r: id } for references
            if (parent && key !== undefined) parent[key] = { r: id };
            else rootRef = { r: id };
            // Only enumerate own properties
            const keys = Object.keys(value);
            for (let i = keys.length - 1; i >= 0; --i) {
                const k = keys[i];
                // Inline exclusion logic for performance
                const v = value[k];
                if (v === null || v === undefined) continue;
                if (k) {
                    const ownerType = typename;
                    if (Serializer.excludedProperties[ownerType]?.[k]) {
                        continue;
                    }
                }
                const vType = typeof v;
                switch (vType) {
                    case 'function':
                    case 'undefined':
                        continue;
                    case 'object':
                        if (Array.isArray(v)) break;
                        const valType = Serializer.get_typename(v);
                        if (valType !== 'Object' && valType !== 'object' && !Reviver.get_constructor_for_type(valType)) {
                            continue;
                        }
                        // Avoid cycles
                        if (objectMap.has(v)) break;
                        break;
                }
                stack.push({ value: v, parent: plain, key: k });
            }
            // Run @onsave hooks
            const saves = Serializer.onSaves[typename];
            if (saves) {
                for (const fn of saves) {
                    const extras = fn(value) || {};
                    for (const k of Object.keys(extras)) {
                        plain[k] = extras[k];
                    }
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
    static onLoads: Record<string, ((result: any) => any)[]> = {};

    static removeSerializerProps(obj: { typename: string; }): void {
        obj.typename = undefined;
        delete obj.typename;
    }
    static get_constructor_for_type(typename: string): new () => any {
        return Reviver.constructors[typename];
    }

    static deserialize(input: string | Uint8Array, options: { isBinary?: boolean } = { isBinary: true }) {
        const { root, objects } = options.isBinary ? decodeBinary(input as Uint8Array) : JSON.parse(input as string);
        const idToObject: Record<number, any> = {};
        if (!objects || Object.keys(objects).length === 0 || !root) {
            console.error('Gamestate to deserialize is invalid!');
            return null;
        }
        // First pass: create all objects (empty shells)
        for (const id of Object.keys(objects)) {
            const data = objects[id];
            if (typeof data === 'object' && typeof data.typename === 'string' && data.typename !== 'Object' && data.typename !== 'object') {
                const ctor = Reviver.get_constructor_for_type(data.typename);
                if (!ctor) {
                    console.error(`No constructor known for object of type '${data.typename}'. Did you forget to add '@insavegame' to the class definition?`);
                    idToObject[id] = null; // Mark as null to avoid further processing
                    continue;
                }
                else idToObject[id] = new ctor();
            } else {
                idToObject[id] = Array.isArray(data) ? [] : {};
            }
        }
        // Second pass: assign properties
        for (const id of Object.keys(objects)) {
            const data = objects[id];
            const target = idToObject[id];
            for (const key of Object.keys(data)) {
                if (key === 'typename') continue;
                const val = data[key];
                if (Array.isArray(val)) {
                    // If every element is a { r: ... }, resolve all
                    if (val.every(v => v && typeof v === 'object' && 'r' in v)) {
                        target[key] = val.map(v => idToObject[v.r]);
                    } else {
                        // For nested arrays (e.g. hitpolygon: vec2[][]), resolve recursively
                        target[key] = val.map(v => {
                            if (Array.isArray(v)) {
                                return v.map(w => (w && typeof w === 'object' && 'r' in w) ? idToObject[w.r] : w);
                            } else if (v && typeof v === 'object' && 'r' in v) {
                                return idToObject[v.r];
                            } else {
                                return v;
                            }
                        });
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
            const obj = idToObject[id];
            let proto = Object.getPrototypeOf(obj);
            let reviverFunctions = [];
            while (proto && proto.constructor && proto.constructor.name !== 'Object') {
                const revivers = Reviver.onLoads[proto.constructor.name];
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

/**
 * Marks a static method as an `@onsave` hook.  The function must
 * return an object of extra props to merge into the serialized form.
 */
export function onsave(
    target: any,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor
): any {
    const className = target.constructor.name;
    Serializer.onSaves[className] ??= [];
    Serializer.onSaves[className].push(descriptor.value);
    return descriptor;
}

/**
 * Marks a property of a class as excluded from serialization.
 * @param target - The target object to mark the property on.
 * @param propertyKey - The name of the property to mark as excluded.
 * @param descriptor - The property descriptor for the property to mark as excluded.
 * @returns The modified property descriptor.
 */
export function excludepropfromsavegame(target: Object, propertyKey: string, _descriptor?: PropertyDescriptor): any {
    Serializer.excludedProperties[target.constructor.name] ??= {};
    Serializer.excludedProperties[target.constructor.name][propertyKey] = true;
}

/**
 * Sets the `onload` property of the target object to the provided function.
 * This function will be called during deserialization to allow the object to perform any custom deserialization logic.
 * @param target - The target object to set the `onload` property on.
 * @param name - The name of the property to set the `onload` property on.
 * @param descriptor - The property descriptor for the property to set the `onload` property on.
 * @returns The modified property descriptor.
 */
export function onload(target: any, _name: any, descriptor: PropertyDescriptor): any {
    Reviver.onLoads ??= {};
    Reviver.onLoads[target.constructor.name] ??= [];
    Reviver.onLoads[target.constructor.name].push(descriptor.value);
}

/**
 * A decorator function that registers a class as a serializable object for use with the game's save system.
 * * Note: Does not work with `accessor`'s!*
 * @param constructor - The constructor function of the class to register.
 * @param toJSON - An optional function that converts the object to a JSON-serializable format.
 * @param fromJSON - An optional function that converts a JSON-serialized object back into an instance of the class.
 * @returns The original constructor function.
 */
export function insavegame(constructor: InstanceType<any>, _toJSON?: () => any, _fromJSON?: (value: any, value_data: any) => any): any {
    Reviver.constructors ??= {};
    Reviver.constructors[constructor.name] = constructor;
    return constructor;
}

/**
 * A decorator function that marks a class as NOT serializable for the game's save system.
 * Objects of this type will be excluded from serialization.
 * @param constructor - The constructor function of the class to exclude.
 * @returns The original constructor function.
 */
export function excludeclassfromsavegame(constructor: InstanceType<any>): any {
    Serializer.excludedObjectTypes ??= new Set<string>();
    Serializer.excludedObjectTypes.add(constructor.name);
    return constructor;
}

type SoundMasterState = {
    sfxTrackId?: string;
    sfxOffset?: number;
    musicTrackId?: string;
    musicOffset?: number;
};

@insavegame
/**
 * Represents a savegame object that contains all the necessary data to save and load the game state.
 */
export class Savegame {
    modelprops: {};
    allSpacesObjects: ISpaceObject[];
    spaces: Space[];
    SMState: SoundMasterState;

    @onsave
    saveSoundState(o: Savegame) {
        // Capture current sound master playback state
        const SMState = {
            sfxTrackId: SM.currentTrackByType('sfx'),
            sfxOffset: SM.currentTimeByType('sfx'),
            musicTrackId: SM.currentTrackByType('music'),
            musicOffset: SM.currentTimeByType('music')
        };

        return { SMState };
    }

    @onload
    restoreSoundState() {
        // Restore sound master playback state
        SM.stopEffect(); // Stop any currently playing sound effect
        SM.stopMusic(); // Stop any currently playing music
        if (this.SMState) {
            if (this.SMState.sfxTrackId) {
                SM.play(this.SMState.sfxTrackId, this.SMState.sfxOffset);
            }
            if (this.SMState.musicTrackId) {
                SM.play(this.SMState.musicTrackId, this.SMState.musicOffset);
            }
        }
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

export class BinaryCompressor {
    static readonly WINDOW_SIZE = 2048; // Size of the LZ77 window
    static readonly MIN_MATCH = 4; // Minimum match length
    static readonly MAX_MATCH = 255; // Maximum match length
    static readonly MAX_RUN = 255; // Maximum run length
    static readonly RLE_THRESHOLD = 4; // RLE threshold
    static COMPRESS_SCRATCH = new Uint8Array(9000); // initial size, will grow as needed

    static compressBinary(input: Uint8Array): Uint8Array {
        // Grow the scratch buffer if needed
        if (this.COMPRESS_SCRATCH.length < input.length * 2) {
            this.COMPRESS_SCRATCH = new Uint8Array(input.length * 2);
        }
        let rp = 0; // read pointer for input
        let wp = 0; // write pointer for output (COMPRESS_SCRATCH)

        while (rp < input.length) {
            /* ---- RLE -------------------------------------------------------- */
            let run = 1;
            while (rp + run < input.length &&
                input[rp + run] === input[rp] &&
                run < this.MAX_RUN) run++;

            if (run >= this.RLE_THRESHOLD) {
                this.COMPRESS_SCRATCH[wp++] = 0xFF;
                this.COMPRESS_SCRATCH[wp++] = run;
                this.COMPRESS_SCRATCH[wp++] = input[rp];
                rp += run;
                continue;
            }

            /* ---- LZ77 ------------------------------------------------------- */
            let bestLen = 0, bestOff = 0;
            const winStart = Math.max(0, rp - this.WINDOW_SIZE);

            for (let w = winStart; w < rp; ++w) {
                let ml = 0;
                while (ml < this.MAX_MATCH &&
                    rp + ml < input.length &&
                    input[w + ml] === input[rp + ml]) ml++;

                if (ml >= this.MIN_MATCH && ml > bestLen) {
                    bestLen = ml;
                    bestOff = rp - w;
                    if (ml === this.MAX_MATCH) break;   // meer kan toch niet
                }
            }

            if (bestLen >= this.MIN_MATCH) {
                if (bestOff > 0xFFFF) {
                    throw new Error("Offset too large for LZ77 compression");
                }
                // LZ77 match gevonden, schrijf het weg
                this.COMPRESS_SCRATCH[wp++] = 0xFE; // LZ77 tag
                this.COMPRESS_SCRATCH[wp++] = bestOff & 0xFF; // offset low byte
                this.COMPRESS_SCRATCH[wp++] = bestOff >> 8; // offset high byte
                this.COMPRESS_SCRATCH[wp++] = bestLen - this.MIN_MATCH; // length - MIN_MATCH
                rp += bestLen;
                continue;
            }

            /* ---- literal / escape ------------------------------------------ */
            const byte = input[rp++];
            if (byte >= 0xFD) {                    // escapen: FD, FE, FF
                // Escape special bytes
                this.COMPRESS_SCRATCH[wp++] = 0xFD; // escape tag
                this.COMPRESS_SCRATCH[wp++] = byte;
            } else {
                // Normale byte, schrijf direct weg
                this.COMPRESS_SCRATCH[wp++] = byte;
            }
        }
        return new Uint8Array(this.COMPRESS_SCRATCH.slice(0, wp));
    }

    static decompressBinary(input: Uint8Array): Uint8Array {
        const out: number[] = [];
        let pos = 0;

        while (pos < input.length) {
            const tag = input[pos++];

            if (tag === 0xFF) {                         // RLE
                const run = input[pos++];
                const val = input[pos++];
                for (let i = 0; i < run; ++i) out.push(val);

            } else if (tag === 0xFE) {                  // LZ77
                const off = input[pos++] | (input[pos++] << 8);
                const len = input[pos++] + this.MIN_MATCH;
                const start = out.length - off;
                for (let i = 0; i < len; ++i) out.push(out[start + i]);

            } else if (tag === 0xFD) {                  // escaped literal
                out.push(input[pos++]);

            } else {                                    // gewone literal
                out.push(tag);
            }
        }
        return new Uint8Array(out);
    }

}
