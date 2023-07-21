import { ISpaceObject, Space } from "./model";
type class2propkey2bool = Record<string, Record<string, boolean>>;

// Apologies for the confusion. I made a mistake in the previous response. The Structured Clone algorithm does not output an ArrayBuffer directly. It is used for cloning objects, including objects with circular references. To serialize and deserialize objects using the Structured Clone algorithm, you can use the structured-clone package in combination with MessagePack.

// First, install the required packages:

// bash
// Copy code
// npm install structured-clone msgpack5
// Now, update the serialization and deserialization functions to use the structured-clone package with MessagePack:

// typescript
// Copy code
// import { structuredClone } from "structured-clone";
// import * as msgpack from "msgpack5";

// function serialize(obj: any): Buffer {
//   const clonedObj = structuredClone(obj);
//   const serializer = msgpack();
//   return serializer.encode(clonedObj);
// }

// function deserialize(buffer: Buffer): any {
//   const deserializer = msgpack();
//   const clonedObj = deserializer.decode(buffer);
//   const obj = structuredClone(clonedObj);
//   return obj;
// }
// In this updated example, the serialize function clones the input object using the Structured Clone algorithm to handle circular references, and then encodes the cloned object into a Buffer using MessagePack. The deserialize function decodes the MessagePack Buffer into a cloned object and then uses the Structured Clone algorithm to reconstruct the original object, including circular references.

// This approach should offer better performance and handle circular references efficiently.

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
export const Reviver: IReviver = (key: any, value: any) => {
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
        // Remove any empty values
        return value.filter(x => x !== null && x !== undefined);
    }

    if (typeof value === "object" && typeof value.typename === "string") {
        let theConstructor = Reviver.get_constructor_for_type(value.typename);
        if (!theConstructor) throw `No constructor known for object of type '${value.typename}'. Did you forget to add '@insavegame' to the class definition?`;
        let result = Object.assign(new theConstructor(), value);
        let onload = Reviver.onLoad[value.typename];
        onload && (result = onload(result));
        Reviver.removeSerializerProps(result);
        return result;
    }
    return value;
};

/**
 * Returns the constructor function for the given typename.
 * @param typename - The typename to get the constructor for.
 * @returns The constructor function for the given typename.
 */
Reviver.get_constructor_for_type = (typename: string): new () => any => {
    return Reviver.constructors[typename];
};

Reviver.constructors = Reviver.constructors ?? {};
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
};

// Reviver.onSave = Reviver.onSave ?? {};

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
export function onsave(target: Object & { onsave?: any; }, propertyKey: string | symbol, descriptor: PropertyDescriptor): any {
    target.onsave = descriptor.value;
}

/**
 * Marks a property of a class as excluded from serialization.
 * @param target - The target object to mark the property on.
 * @param propertyKey - The name of the property to mark as excluded.
 * @param descriptor - The property descriptor for the property to mark as excluded.
 * @returns The modified property descriptor.
 */
export function exclude_save(target: Object, propertyKey: string, descriptor?: PropertyDescriptor): any {
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
export function onload(target: any, name: any, descriptor: PropertyDescriptor): any {
    Reviver.onLoad ??= {};
    Reviver.onLoad[target.name] = descriptor.value;
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
export function insavegame(constructor: InstanceType<any>, toJSON?: () => any, fromJSON?: (value: any, value_data: any) => any): any {
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

/**
 * Shows a download dialog for the current save state.
 * The save state is downloaded as a .bmsx file.
 * @returns void
 */
export function show_download_savestate_dialog() {
    const data = model.save();

    const a = document.createElement('a');
    a.href = URL.createObjectURL(
        new Blob([data], {
            type: "data:application/json"
        })
    );
    a.download = 'savestate.bmsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
}

let setload: HTMLInputElement = undefined;

/**
 * Shows a file open dialog with the specified options and attaches the provided event listener to the 'change' event of the input element.
 * @param options - An object containing the options for the file open dialog.
 * @param options.multiple - A boolean indicating whether multiple files can be selected.
 * @param options.accept - A string containing the file types that can be selected.
 * @param options.eventlistener - The event listener to attach to the 'change' event of the input element.
 * @returns void
 */
export function show_openfile_dialog(options: { multiple: boolean, accept: string, eventlistener: (this: HTMLInputElement, ev: Event) => any }) {
    setload = document.createElement('input');
    setload.type = 'file';
    setload.multiple = options.multiple;
    setload.accept = options.accept;
    setload.style.display = 'none';
    setload.click();

    setload.addEventListener('change', options.eventlistener);
}

/**
 * Shows a file open dialog with options to select a single .bmsx file and attaches the `load_savestate` event listener to the 'change' event of the input element.
 * @returns void
 */
export function show_load_savestate_dialog() {
    show_openfile_dialog({ multiple: false, accept: '.bmsx', eventlistener: load_savestate });
}

/**
 * Checks if any files are selected via the file open dialog.
 * @param files - The list of files selected via the file open dialog.
 * @returns A boolean indicating whether any files are selected.
 */
function are_any_files_selected_via_openfile_dialog(files: FileList) {
    return files && files.length !== 0;
}

/**
 * Returns the first selected file from a file list obtained from a file open dialog.
 * If no files are selected, returns undefined.
 * @param files - The list of files selected via the file open dialog.
 * @returns The first selected file, or undefined if no files are selected.
 */
function get_first_selected_file_from_openfile_dialog(files: FileList): File {
    if (!are_any_files_selected_via_openfile_dialog(files)) {
        // Do nothing
        console.info('Geen bestand geselecteerd!');
        return undefined;
    }
    else {
        return files[0];
    }
}

/**
 * Loads a save state from a selected file obtained from a file open dialog.
 * @param this - The HTMLInputElement that triggered the 'change' event.
 * @param ev - The 'change' event that was triggered.
 * @returns void
 */
function load_savestate(this: HTMLInputElement, ev: Event) {
    const file = get_first_selected_file_from_openfile_dialog(setload.files);
    if (file) {
        file.text().then(result => globalThis.model.load(result));
    }
    setload = undefined;
}
