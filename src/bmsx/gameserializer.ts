import { ISpaceObject, Space } from "./model";

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
    onLoad: Record<string, (result: any) => any>;
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
}

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
        if (!theConstructor) throw `No constructor known for object of type '${typename}'. Did you forget to add '@insavegame' to the class definition?`;

        value.typename = typename;
        if (value.prototype?.onsave) return value.prototype.onsave(value);
        if (value.constructor?.onsave) return value.constructor.onsave(value);
    }
    return value;
};

// https://stackoverflow.com/questions/8111446/turning-json-strings-into-objects-with-methods
// A generic "smart reviver" function.
// Looks for object values with a `ctor` property and
// a `data` property. If it finds them, and finds a matching
// constructor that has a `fromJSON` property on it, it hands
// off to that `fromJSON` function, passing in the value.
/**
 * A function that is used to revive serialized objects. It is passed as the second argument to `JSON.parse`.
 * @param key - The key of the current property being parsed.
 * @param value - The value of the current property being parsed.
 * @returns The parsed value, with any serialized objects revived.
 * @throws An error if there is no constructor known for an object of a certain type.
 */
export const Reviver: IReviver = (_key: any, value: any) => {
    function findAndFireOnLoads(value: any) {
        // Collect all reviver functions in the prototype chain
        let reviverFunctions = [];
        let proto = value;

        while (proto) {
            const reviver = Reviver.onLoad[proto.constructor.name];
            if (reviver) {
                reviverFunctions.push(reviver);
            }
            proto = Object.getPrototypeOf(proto);
        }

        // Execute all reviver functions in descending order
        for (let i = reviverFunctions.length - 1; i >= 0; i--) {
            value = reviverFunctions[i].call(value) ?? value;
        }

        return value;
    }

    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
        // Remove any empty values
        return value.filter(x => x !== null && x !== undefined);
    }

    if (typeof value === "object" && typeof value.typename === "string") {
        let theConstructor = Reviver.get_constructor_for_type(value.typename);
        if (!theConstructor) throw `No constructor known for object of type '${value.typename}'. Did you forget to add '@insavegame' to the class definition?`;
        let result = Object.assign(new theConstructor(), value);
        result = findAndFireOnLoads(result);
        Reviver.removeSerializerProps(result);
        return result;
    }
    return value;
}

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
Reviver.onLoad = Reviver.onLoad ?? {};
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

// target: the class that the member is on.
// name: the name of the member in the class.
// descriptor: the member descriptor; This is essentially the object that would have been passed to Object.defineProperty.
/**
 * Sets the `onload` property of the target object to the provided function.
 * This function will be called during deserialization to allow the object to perform any custom deserialization logic.
 * @param target - The target object to set the `onload` property on.
 * @param name - The name of the property to set the `onload` property on.
 * @param descriptor - The property descriptor for the property to set the `onload` property on.
 * @returns The modified property descriptor.
 */
export function onload(target: any, _name: any, descriptor: PropertyDescriptor): any {
    Reviver.onLoad ??= {};
    Reviver.onLoad[target.constructor.name] = descriptor.value;
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

@insavegame
/**
 * Represents a savegame object that contains all the necessary data to save and load the game state.
 */
export class Savegame {
    modelprops: {};
    allSpacesObjects: ISpaceObject[];
    spaces: Space[];
}
