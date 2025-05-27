import { ISpaceObject, Space } from "./basemodel";

/**
 * Interface for a reviver function used in JSON.parse to deserialize objects.
 */
interface IReviver {
    /**
     * The reviver function that will be called for each key-value pair in the parsed JSON object.
     * @param key - The key of the current key-value pair being processed.
     * @param value - The value of the current key-value pair being processed.
     * @returns The deserialized value for the current key-value pair.
     */
    (key: any, value: any): any;
    /**
     * A dictionary of constructors for each type that can be deserialized.
     */
    constructors: Record<string, new () => any>;
    /**
     * A dictionary of onLoad functions for each type that can be deserialized.
     */
    onLoads: Record<string, ((result: any) => any)[]>;
    /**
     * A function that removes any helper-properties that were added during serialization.
     * @param obj - The object to remove the helper-property from.
     */
    removeSerializerProps: (obj: { typename: string; }) => void;
    /**
     * A function that returns the constructor for a given type name.
     * @param typename - The name of the type to get the constructor for.
     * @returns The constructor for the given type name.
     */
    get_constructor_for_type: (typename: string) => new () => any;
    /**
     * Deserializes a string produced by serializeWithRefs, restoring object references.
     * @param str - The serialized string.
     * @returns The deserialized object with references restored.
     */
    deserializeWithRefs?: (str: string) => any;
    /**
     * Deserializes a binary buffer produced by serializeWithRefsBinary, restoring object references.
     * @param buf - The binary buffer.
     * @returns The deserialized object with references restored.
     */
    deserializeWithRefsBinary?: (buf: Uint8Array) => any;
}

/**
 * Interface for a serializer function used to serialize objects to a string.
 */
interface ISerializer {
    /**
     * The serializer function that will be called to serialize the input object to a string.
     * @param obj - The object to serialize.
     * @returns The serialized string representation of the input object.
     */
    (obj: any): string;
    /**
     * A dictionary of excluded properties for each type that can be serialized.
     */
    excludedProperties: Record<string, Record<string, boolean>>;

    /**
     * A set of object type names that should be completely excluded from serialization.
     */
    excludedObjectTypes: Set<string>;

    /**
     * Returns whether the given key-value pair should be excluded from serialization,
     * based on @see {@link excludedProperties} and value type (e.g. `function`).
     * @param key - The key of the current key-value pair being processed.
     * @param value - The value of the current key-value pair being processed.
     * @param cache - An array of objects that have already been serialized, used to handle circular references.
     * @returns Whether the current key-value pair should be excluded from serialization.
     */
    shouldExcludeFromSerialization: (key: any, value: any, cache: any[]) => boolean;

    /**
     * Serializes the given object to a plain object, recursively serializing its properties.
     * @param value - The object to serialize.
     * @param cache - An array of objects that have already been serialized, used to handle circular references.
     * @returns The serialized plain object representation of the input object.
     */
    serializeObject: (value: any, cache: any[]) => {};

    /**
     * Returns the typename of the given value, used to handle serialization of class instances.
     * @param value - The value to get the typename for.
     * @returns The typename of the given value.
     */
    get_typename: (value: any) => string;

    /**
     * Serializes the input object to a string using an object map to preserve references and handle circular/cross references.
     * @param obj - The object to serialize.
     * @returns The serialized string representation of the input object.
     */
    serializeWithRefs?: (obj: any) => string;

    /**
     * Serializes the input object to a binary format using an object map to preserve references and handle circular/cross references.
     * @param obj - The object to serialize.
     * @returns The serialized binary representation of the input object.
     */
    serializeWithRefsBinary?: (obj: any) => Uint8Array;
}

export type { IReviver, ISerializer };

/**
 * Serializes the input object to a string using JSON.stringify, excluding any properties that should not be serialized.
 * @param obj - The object to serialize.
 * @returns The serialized string representation of the input object.
 */
export const Serializer: ISerializer = (obj: any): string => {
    let cache = [];
    return JSON.stringify(obj, function (key, value) {
        if (Serializer.shouldExcludeFromSerialization(key, value, cache))
            return undefined;
        if (typeof value === 'object')
            return Serializer.serializeObject(value, cache);
        return value;
    });
};

/**
 * Returns the typename of the given value, used to handle serialization of class instances.
 * @param value - The value to get the typename for.
 * @returns The typename of the given value.
 */
Serializer.get_typename = (value: any): string => {
    return value?.constructor?.name ?? value?.prototype?.name;
};

/**
 * Initializes the `excludedProperties` property of the `Serializer` object if it is not already initialized.
 * This property is a dictionary of excluded properties for each type that can be serialized.
 */
Serializer.excludedProperties = Serializer.excludedProperties ?? {};

/**
 * A set of object type names that should be completely excluded from serialization.
 * If an object's type name is in this set, it will not be serialized at all.
 */
Serializer.excludedObjectTypes = Serializer.excludedObjectTypes ?? new Set<string>();

/**
 * Overrides the `shouldExcludeFromSerialization` method of the `Serializer` object to handle custom logic for excluding properties from serialization.
 * @param key - The key of the current key-value pair being processed.
 * @param value - The value of the current key-value pair being processed.
 * @param cache - An array of objects that have already been serialized, used to handle circular references.
 * @returns Whether the current key-value pair should be excluded from serialization.
 */
Serializer.shouldExcludeFromSerialization = (key: any, value: any, cache: any[]): boolean => {
    if (value === null || value === undefined) return true; // We don't serialize undefined stuff

    let typename = Serializer.get_typename(value);
    if (typename && key) {
        if (Serializer.excludedProperties[typename]?.[key])
            return true; // Exclude property from serialization
    }
    let type = typeof value;
    switch (type) {
        case 'function':
            return true; // We don't serialize functions
        case 'undefined':
            return true; // We don't serialize undefined stuff, but should already be handled
        case 'object':
            if (Array.isArray(value)) return false;
            if (typename !== 'Object' && typename !== 'object' && !Reviver.get_constructor_for_type(typename))
                return true; // Don't save objects whose classes are not included in the savegame!
            return cache.includes(value);
        default:
            return false;
    }
};

/**
 * Overrides the `serializeObject` method of the `Serializer` object to handle custom serialization logic for objects.
 * @param value - The object to serialize.
 * @param cache - An array of objects that have already been serialized, used to handle circular references.
 * @returns The serialized plain object representation of the input object.
 * @throws An error if there is no constructor known for an object of a certain type.
 */
Serializer.serializeObject = (value: any, cache: any[]): {} => {
    if (Array.isArray(value)) return value.filter(x => x !== null && x !== undefined);
    cache.push(value); // We already checked whether object should be excluded in Serializer.shouldExcludeFromSerialization

    let typename = Serializer.get_typename(value); // TODO: Twee keer bepalen :-(
    if (typename !== 'Object' && typename !== 'object') {
        // Check whether we have a constructor for the given object type
        let theConstructor = Reviver.get_constructor_for_type(typename);
        if (!theConstructor) throw Error(`No constructor known for object of type '${typename}'. Did you forget to add '@insavegame' to the class definition?`);

        value.typename = typename;
        if (value.prototype?.onsave) return value.prototype.onsave(value);
        if (value.constructor?.onsave) return value.constructor.onsave(value);
    }
    return value;
};

/**
 * Shared helper to build the { root, objects } structure for reference-tracking serialization.
 * Returns: { root, objects }
 */
function buildReferenceGraph(obj: any): { root: any, objects: Record<string, any> } {
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

// Refactored: Use shared helper for both JSON and binary
Serializer.serializeWithRefs = (obj: any): string => {
    const { root, objects } = buildReferenceGraph(obj);
    return JSON.stringify({ root, objects });
};

Serializer.serializeWithRefsBinary = (obj: any): Uint8Array => {
    const { root, objects } = buildReferenceGraph(obj);
    return encodeBinary({ root, objects });
};

/**
 * A function that is used to revive serialized objects. It is passed as the second argument to `JSON.parse`.
 * @param key - The key of the current property being parsed.
 * @param value - The value of the current property being parsed.
 * @returns The parsed value, with any serialized objects revived.
 * @throws An error if there is no constructor known for an object of a certain type.
 */
export const Reviver: IReviver = (_key: any, value: any) => {
    // A helper function that finds and executes any onLoad functions on the given value (if any) and returns the result of those functions (if any) or the original value if there were no onLoad functions.
    function findAndFireOnLoads(value: any) {
        // Collect all reviver functions in the prototype chain
        let reviverFunctions = [];
        let proto = value;

        while (proto) {
            // Add any reviver functions on the prototype to the list. If there are none, this will be an empty array.
            const revivers = Reviver.onLoads[proto.constructor.name];
            revivers && reviverFunctions.push(...revivers);
            // Move up the prototype chain to the next prototype in the chain (if any) and repeat the process until we reach the end of the prototype chain.
            proto = Object.getPrototypeOf(proto);
        }

        // Execute all reviver functions in descending order
        for (let i = reviverFunctions.length - 1; i >= 0; i--) {
            value = reviverFunctions[i].call(value) ?? value;
        }

        // Return the result of the reviver functions (if any) or the original value if there were no reviver functions.
        return value;
    }

    // If the value is null or undefined, return it as-is (no need to revive it)
    if (value === null || value === undefined) return value;

    // If the value is an array, filter out any null or undefined values and return the resulting array (no need to revive it)
    if (Array.isArray(value)) {
        // Remove any empty values
        return value.filter(x => x !== null && x !== undefined);
    }

    // If the value is an object, check whether it has a typename property. If so, we need to revive it. Otherwise, return it as-is (no need to revive it)
    if (typeof value === "object" && typeof value.typename === "string") {
        // Check whether we have a constructor for the given object type (typename) and throw an error if we don't have one (we can't revive the object if we don't have a constructor for it)
        const theConstructor = Reviver.get_constructor_for_type(value.typename);
        if (!theConstructor) throw Error(`No constructor known for object of type '${value.typename}'. Did you forget to add '@insavegame' to the class definition?`);
        // Create a new instance of the object using the constructor for the given typename and assign the properties of the serialized object to it (except for the typename property)
        let result = Object.assign(new theConstructor(), value);
        // Call any onLoad functions on the object (if any) and return the result of those functions (if any) or the original object if there were no onLoad functions.
        result = findAndFireOnLoads(result);
        // Remove the typename property from the object (it was only used for serialization)
        Reviver.removeSerializerProps(result);
        // Return the revived object (with any onLoad functions called)
        return result;
    }
    // If the value is an object, but it does not have a typename property, return it as-is (no need to revive it)
    return value;
}

/**
 * Deserializes a string produced by serializeWithRefs, restoring object references.
 * @param str - The serialized string.
 * @returns The deserialized object with references restored.
 */
Reviver.deserializeWithRefs = (str: string): any => {
    const { root, objects } = JSON.parse(str);
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
        // Call onLoad hooks
        if (typeof data.typename === 'string') {
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
    // Return the root object
    return (root && root.$ref) ? idToObject[root.$ref] : root;
};

/**
 * Deserializes a binary buffer produced by serializeWithRefsBinary, restoring object references.
 * @param buf - The serialized binary buffer.
 * @returns The deserialized object with references restored.
 */
Reviver.deserializeWithRefsBinary = (buf: Uint8Array): any => {
    const { root, objects } = decodeBinary(buf);
    const idToObject: Record<string, any> = {};
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
};

/**
 * Returns the constructor function for the given typename.
 * @param typename - The typename to get the constructor for.
 * @returns The constructor function for the given typename.
 */
Reviver.get_constructor_for_type = (typename: string): new () => any => {
    return Reviver.constructors[typename];
}

/**
 * A dictionary of constructors for each type that can be deserialized.
 */
Reviver.constructors = Reviver.constructors ?? {};

// Ensure Reviver.onLoad is not null or undefined. If it is, initialize it as an empty object.
Reviver.onLoads = Reviver.onLoads ?? {};

/**
 * Removes the helper-property that was added during serialization from the given object.
 * @param obj - The object to remove the helper-property from.
 * @returns void
 */
Reviver.removeSerializerProps = (obj: { typename: string; }): void => {
    // Remove the helper-property that was added during serialization
    obj.typename = undefined;
    delete obj.typename;
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
        // Write a variable-length unsigned integer
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

// --- Simple Binary Encode/Decode Helpers ---
// Supports: null, boolean, number, string, arrays, objects, $ref objects
// Not optimized for size, but robust and extensible
function encodeBinary(obj: any): Uint8Array {
    const w = new BinWriter();
    function write(val: any) {
        if (val === undefined) { w.u8(0); return; } // Treat undefined as null
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
            // $ref object
            if (Object.keys(val).length === 1 && val.$ref) {
                w.u8(6); w.str(val.$ref); return;
            }
            // General object
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

function decodeBinary(buf: Uint8Array): any {
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
            case 0: // null or undefined
                return null;
            case 1: // boolean true
                return true;
            case 2: // boolean false
                return false;
            case 3: { // number
                const v = dv.getFloat64(offset, true);
                offset += 8;
                return v;
            }
            case 4: // string
                return readString();
            case 5: { // array
                const len = readVarUint();
                const arr = [];
                for (let i = 0; i < len; ++i) arr.push(read());
                return arr;
            }
            case 6: { // $ref object
                const ref = readString();
                return { $ref: ref };
            }
            case 7: { // general object
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
        const obj = decodeBinary(buf);
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
