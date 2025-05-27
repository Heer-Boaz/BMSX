import { ISpaceObject, Space } from "./basemodel";

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
            return Serializer.encodeBinary({ root, objects });
        } else {
            return JSON.stringify({ root, objects });
        }
    }

    static excludedProperties: Record<string, Record<string, boolean>> = {};
    static excludedObjectTypes: Set<string> = new Set<string>();
    static get_typename(value: any): string {
        return value?.constructor?.name ?? value?.prototype?.name;
    }
    static shouldExcludeFromSerialization(key: any, value: any, cache: any[]): boolean {
        if (value === null || value === undefined) return true;
        let typename = Serializer.get_typename(value);
        if (typename && key) {
            if (Serializer.excludedProperties[typename]?.[key])
                return true;
        }
        let type = typeof value;
        switch (type) {
            case 'function':
                return true;
            case 'undefined':
                return true;
            case 'object':
                if (Array.isArray(value)) return false;
                if (typename !== 'Object' && typename !== 'object' && !Reviver.get_constructor_for_type(typename))
                    return true;
                return cache.includes(value);
            default:
                return false;
        }
    }
    /**
     * Serializes an object for game state saving, handling arrays, custom types, and caching.
     *
     * - If the value is an array, returns a filtered array excluding `null` and `undefined` elements.
     * - For non-array objects, determines the type name and attempts to retrieve a registered constructor.
     * - Throws an error if no constructor is found for a custom type.
     * - Invokes custom `onsave` hooks if defined on the object's prototype or constructor.
     * - Adds the object to the serialization cache to handle circular references.
     *
     * @param value - The value to serialize, which can be an object or array.
     * @param cache - An array used to track already serialized objects to prevent circular references.
     * @returns The serialized representation of the input value.
     * @throws Error if a custom type is encountered without a known constructor.
     */
    private static serializeObject(value: any, cache: any[]): {} {
        if (Array.isArray(value)) return value.filter(x => x !== null && x !== undefined);
        cache.push(value);
        let typename = Serializer.get_typename(value);
        if (typename !== 'Object' && typename !== 'object') {
            let theConstructor = Reviver.get_constructor_for_type(typename);
            if (!theConstructor) throw Error(`No constructor known for object of type '${typename}'. Did you forget to add '@insavegame' to the class definition?`);
            value.typename = typename;
            if (value.prototype?.onsave) return value.prototype.onsave(value);
            if (value.constructor?.onsave) return value.constructor.onsave(value);
        }
        return value;
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
    private static buildReferenceGraph(obj: any): { root: any, objects: Record<string, any> } {
        const objectMap = new Map<any, string>();
        const objects: Record<string, any> = {};
        let idCounter = 1;
        function getIdForObject(o: any): string {
            if (objectMap.has(o)) return objectMap.get(o)!;
            const id = `#${idCounter++}`;
            objectMap.set(o, id);
            return id;
        }
        function serializeObjectWithRefs(value: any): any {
            if (value === null || value === undefined) return value;
            if (typeof value !== 'object') return value;
            if (Array.isArray(value)) {
                return value.map(serializeObjectWithRefs).filter(v => v !== undefined);
            }
            if (objectMap.has(value)) {
                return { $ref: objectMap.get(value) };
            }
            const id = getIdForObject(value);
            let typename = Serializer.get_typename(value);
            if (Serializer.excludedObjectTypes.has(typename)) return undefined;
            let theConstructor = Reviver.get_constructor_for_type(typename);
            let plain: any = {};
            if (typename !== 'Object' && typename !== 'object') {
                if (!theConstructor) throw Error(`No constructor known for object of type '${typename}'. Did you forget to add '@insavegame' to the class definition?`);
                else plain.typename = typename;
            }
            for (let key of Object.keys(value)) {
                if (Serializer.shouldExcludeFromSerialization(key, value[key], [])) continue;
                const serializedValue = serializeObjectWithRefs(value[key]);
                if (serializedValue !== undefined) plain[key] = serializedValue;
            }
            if (value.constructor?.onsave) {
                plain = value.constructor.onsave(value) || plain;
                plain.typename = typename;
            }
            objects[id] = plain;
            return { $ref: id };
        }
        const root = serializeObjectWithRefs(obj);
        return { root, objects };
    }

    /**
     * Serializes a JavaScript object into a compact binary format.
     *
     * The encoding supports the following types:
     * - `undefined` and `null` (encoded as 0)
     * - `boolean` (encoded as 1 for `true`, 2 for `false`)
     * - `number` (encoded as 3, followed by 64-bit float)
     * - `string` (encoded as 4, followed by UTF-8 string)
     * - `Array` (encoded as 5, followed by length and recursively encoded elements)
     * - Object references with a single `$ref` property (encoded as 6, followed by reference string)
     * - Generic objects (encoded as 7, followed by key-value pairs)
     *
     * @param obj - The object to serialize.
     * @returns A `Uint8Array` containing the binary representation of the object.
     * @throws {Error} If an unsupported type is encountered during serialization.
     */
    static encodeBinary(obj: any): Uint8Array {
        const w = new BinWriter();
        function write(val: any) {
            if (val === undefined) { w.u8(0); return; }
            if (val === null) { w.u8(0); return; }
            if (typeof val === 'boolean') { w.u8(val ? 1 : 2); return; }
            if (typeof val === 'number') { w.u8(3); w.f64(val); return; }
            if (typeof val === 'string') { w.u8(4); w.str(val); return; }
            if (Array.isArray(val)) {
                w.u8(5); w.varuint(val.length);
                for (const v of val) write(v);
                return;
            }
            if (typeof val === 'object') {
                if (Object.keys(val).length === 1 && val.$ref) {
                    w.u8(6); w.str(val.$ref); return;
                }
                w.u8(7);
                const keys = Object.keys(val);
                w.varuint(keys.length);
                for (const k of keys) {
                    w.str(k);
                    write(val[k]);
                }
                return;
            }
            throw new Error('Unsupported type in encodeBinary');
        }
        write(obj);
        return w.finish();
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
    static decodeBinary(buf: Uint8Array): any {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        let offset = 0;
        function readUint8() { return dv.getUint8(offset++); }
        function readVarUint(): number {
            let val = 0, shift = 0, b;
            do {
                b = buf[offset++];
                val |= (b & 0x7F) << shift;
                shift += 7;
            } while (b & 0x80);
            return val;
        }
        function readString() {
            const len = readVarUint();
            const arr = buf.subarray(offset, offset + len);
            offset += len;
            return new TextDecoder().decode(arr);
        }
        function read(): any {
            const tag = readUint8();
            switch (tag) {
                case 0: return null;
                case 1: return true;
                case 2: return false;
                case 3: {
                    const v = dv.getFloat64(offset, true);
                    offset += 8;
                    return v;
                }
                case 4: return readString();
                case 5: {
                    const len = readVarUint();
                    const arr = [];
                    for (let i = 0; i < len; ++i) arr.push(read());
                    return arr;
                }
                case 6: {
                    const ref = readString();
                    return { $ref: ref };
                }
                case 7: {
                    const len = readVarUint();
                    const obj: any = {};
                    for (let i = 0; i < len; ++i) {
                        const k = readString();
                        obj[k] = read();
                    }
                    return obj;
                }
                default:
                    throw new Error('Unknown tag in decodeBinary: ' + tag);
            }
        }
        return read();
    }

    static deserialize(input: string | Uint8Array, options: { isBinary?: boolean } = { isBinary: true }): any {
        const { root, objects } = options.isBinary ? Reviver.decodeBinary(input as Uint8Array) : JSON.parse(input as string);
        const idToObject: Record<string, any> = {};
        // First pass: create all objects (empty shells)
        for (const id of Object.keys(objects)) {
            const data = objects[id];
            if (typeof data === 'object' && typeof data.typename === 'string' && data.typename !== 'Object' && data.typename !== 'object') {
                const ctor = Reviver.get_constructor_for_type(data.typename);
                if (!ctor) throw Error(`No constructor known for object of type '${data.typename}'. Did you forget to add '@insavegame' to the class definition?`);
                idToObject[id] = new ctor();
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
                if (val && typeof val === 'object' && '$ref' in val) {
                    target[key] = idToObject[val.$ref];
                } else if (Array.isArray(val)) {
                    target[key] = val.map(v => (v && typeof v === 'object' && '$ref' in v) ? idToObject[v.$ref] : v);
                } else {
                    target[key] = val;
                }
            }
            if (typeof data.typename === 'string' && data.typename !== 'Object' && data.typename !== 'object') {
                let result = target;
                let proto = target;
                let reviverFunctions = [];
                while (proto) {
                    const revivers = Reviver.onLoads[proto.constructor.name];
                    revivers && reviverFunctions.push(...revivers);
                    proto = Object.getPrototypeOf(proto);
                }
                for (let i = reviverFunctions.length - 1; i >= 0; i--) {
                    result = reviverFunctions[i].call(result) ?? result;
                }
                Reviver.removeSerializerProps(result);
                idToObject[id] = result;
            }
        }
        return (root && root.$ref) ? idToObject[root.$ref] : root;
    }
}

// target: the class that the member is on.
// propertyKey: the name of the member in the class.
// descriptor: the member descriptor; This is essentially the object that would have been passed to Object.defineProperty.
/**
 * Sets the `onsave` property of the target object to the provided function.
 * This function will be called during serialization to allow the object to perform any custom serialization logic.
 * @param target - The target object to set the `onsave` property on.
 * @param propertyKey - The name of the property to set the `onsave` property on.
 * @param descriptor - The property descriptor for the property to set the `onsave` property on.
 * @returns The modified property descriptor.
 */
export function onsave(target: Object & { onsave?: any; }, _propertyKey: string | symbol, descriptor: PropertyDescriptor): any {
    target.onsave = descriptor.value;
}

/**
 * Marks a property of a class as excluded from serialization.
 * @param target - The target object to mark the property on.
 * @param propertyKey - The name of the property to mark as excluded.
 * @param descriptor - The property descriptor for the property to mark as excluded.
 * @returns The modified property descriptor.
 */
export function exclude_save(target: Object, propertyKey: string, _descriptor?: PropertyDescriptor): any {
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
 * **Note: Does not work with `accessor`'s!**
 */
/**
 * A decorator function that registers a class as a serializable object for use with the game's save system.
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
export function not_insavegame(constructor: InstanceType<any>): any {
    Serializer.excludedObjectTypes ??= new Set<string>();
    Serializer.excludedObjectTypes.add(constructor.name);
    return constructor;
}

@insavegame
/**
 * Represents a savegame object that contains all the necessary data to save and load the game state.
 */
export class Savegame {
    modelprops: {};
    allSpacesObjects: ISpaceObject[];
    spaces: Space[];
}

/**
 * Decodes a binary snapshot and returns a pretty-printed JSON string for debugging.
 * @param buf - The binary buffer produced by serializeWithRefsBinary.
 * @returns A human-readable JSON string.
 */
export function debugPrintBinarySnapshot(buf: Uint8Array): string {
    try {
        const obj = Reviver.decodeBinary(buf);
        return JSON.stringify(obj, null, 2);
    } catch (e) {
        return `Failed to decode binary snapshot: ${e}`;
    }
}

// ---------- parameters (gedeeld) ----------
const WINDOW_SIZE = 2048;
const MIN_MATCH = 4;
const MAX_MATCH = 255;      // wordt als (len-MIN_MATCH) opgeslagen
const MAX_RUN = 255;      // 1-byte RLE-veld
const RLE_THRESHOLD = 4; // RLE wordt alleen gebruikt voor runs van 4 of meer bytes


// ---------- compressor ----------
let COMPRESS_SCRATCH = new Uint8Array(9000); // initial size, will grow as needed
export function compressBinary(input: Uint8Array): Uint8Array {
    // Grow the scratch buffer if needed
    if (COMPRESS_SCRATCH.length < input.length * 2) {
        COMPRESS_SCRATCH = new Uint8Array(input.length * 2);
    }
    let rp = 0; // read pointer for input
    let wp = 0; // write pointer for output (COMPRESS_SCRATCH)

    while (rp < input.length) {
        /* ---- RLE -------------------------------------------------------- */
        let run = 1;
        while (rp + run < input.length &&
            input[rp + run] === input[rp] &&
            run < MAX_RUN) run++;

        if (run >= RLE_THRESHOLD) {
            COMPRESS_SCRATCH[wp++] = 0xFF;
            COMPRESS_SCRATCH[wp++] = run;
            COMPRESS_SCRATCH[wp++] = input[rp];
            rp += run;
            continue;
        }

        /* ---- LZ77 ------------------------------------------------------- */
        let bestLen = 0, bestOff = 0;
        const winStart = Math.max(0, rp - WINDOW_SIZE);

        for (let w = winStart; w < rp; ++w) {
            let ml = 0;
            while (ml < MAX_MATCH &&
                rp + ml < input.length &&
                input[w + ml] === input[rp + ml]) ml++;

            if (ml >= MIN_MATCH && ml > bestLen) {
                bestLen = ml;
                bestOff = rp - w;
                if (ml === MAX_MATCH) break;   // meer kan toch niet
            }
        }

        if (bestLen >= MIN_MATCH) {
            if (bestOff > 0xFFFF) {
                throw new Error("Offset too large for LZ77 compression");
            }
            // LZ77 match gevonden, schrijf het weg
            COMPRESS_SCRATCH[wp++] = 0xFE; // LZ77 tag
            COMPRESS_SCRATCH[wp++] = bestOff & 0xFF; // offset low byte
            COMPRESS_SCRATCH[wp++] = bestOff >> 8; // offset high byte
            COMPRESS_SCRATCH[wp++] = bestLen - MIN_MATCH; // length - MIN_MATCH
            rp += bestLen;
            continue;
        }

        /* ---- literal / escape ------------------------------------------ */
        const byte = input[rp++];
        if (byte >= 0xFD) {                    // escapen: FD, FE, FF
            // Escape special bytes
            COMPRESS_SCRATCH[wp++] = 0xFD; // escape tag
            COMPRESS_SCRATCH[wp++] = byte;
        } else {
            // Normale byte, schrijf direct weg
            COMPRESS_SCRATCH[wp++] = byte;
        }
    }
    return new Uint8Array(COMPRESS_SCRATCH.slice(0, wp));
}

/* ---------- decompressor ---------------------------------------------- */
export function decompressBinary(input: Uint8Array): Uint8Array {
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
            const len = input[pos++] + MIN_MATCH;
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

class BinWriter {
    buf = new Uint8Array(64 * 1024);
    pos = 0;
    ensure(n: number) {
        if (this.pos + n > this.buf.length)
            this.buf = Uint8Array.from([...this.buf, ...new Uint8Array(this.buf.length)]);
    }
    u8(v: number) { this.ensure(1); this.buf[this.pos++] = v; }
    f64(v: number) { this.ensure(8); new DataView(this.buf.buffer).setFloat64(this.pos, v, true); this.pos += 8; }
    varuint(v: number) {
        do {
            let b = v & 0x7F;
            v >>>= 7;
            if (v !== 0) b |= 0x80;
            this.u8(b);
        } while (v !== 0);
    }
    str(s: string) {
        const enc = new TextEncoder();
        const bytes = enc.encode(s);
        this.varuint(bytes.length);
        this.ensure(bytes.length);
        this.buf.set(bytes, this.pos);
        this.pos += bytes.length;
    }
    finish() { return this.buf.subarray(0, this.pos); }
}
