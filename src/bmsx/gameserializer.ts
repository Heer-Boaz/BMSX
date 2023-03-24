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

interface IReviver {
    (key: any, value: any): any;
    constructors: Record<string, new () => any>;
    onLoad: Record<string, (result: any) => any>;
    /**
     * Remove the helper-property that was added during serialization
     */
    removeSerializerProps: (obj: { typename: string; }) => void;
    get_constructor_for_type: (typename: string) => new () => any;
}

interface ISerializer {
    (obj: any): string;
    excludedProperties: class2propkey2bool;
    /**
     * Returns whether the given value should be excluded from serialization,
     * based on @see {@link excludedProperties} and value type (e.g. `function`).
     */
    shouldExcludeFromSerialization: (key: any, value: any, cache: any[]) => boolean;
    serializeObject: (value: any, cache: any[]) => {};
    get_typename: (value: any) => string;
}

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

Serializer.get_typename = (value: any): string => {
    return value?.constructor?.name ?? value?.prototype?.name;
};
Serializer.excludedProperties = Serializer.excludedProperties ?? {};
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

Reviver.get_constructor_for_type = (typename: string): new () => any => {
    return Reviver.constructors[typename];
};

Reviver.constructors = Reviver.constructors ?? {};
Reviver.onLoad = Reviver.onLoad ?? {};
Reviver.removeSerializerProps = (obj: { typename: string; }): void => {
    // Remove the helper-property that was added during serialization
    obj.typename = undefined;
    delete obj.typename;
};

// Reviver.onSave = Reviver.onSave ?? {};

// target: the class that the member is on.
// propertyKey: the name of the member in the class.
// descriptor: the member descriptor; This is essentially the object that would have been passed to Object.defineProperty.
export function onsave(target: Object & { onsave?: any; }, propertyKey: string | symbol, descriptor: PropertyDescriptor): any {
    target.onsave = descriptor.value;
}

export function exclude_save(target: Object, propertyKey: string, descriptor?: PropertyDescriptor): any {
    Serializer.excludedProperties[target.constructor.name] ??= {};
    Serializer.excludedProperties[target.constructor.name][propertyKey] = true;
}

// target: the class that the member is on.
// name: the name of the member in the class.
// descriptor: the member descriptor; This is essentially the object that would have been passed to Object.defineProperty.
export function onload(target: any, name: any, descriptor: PropertyDescriptor): any {
    Reviver.onLoad ??= {};
    Reviver.onLoad[target.name] = descriptor.value;
}

/**
 * **Note: Does not work with `accessor`'s!**
 */
export function insavegame(constructor: InstanceType<any>, toJSON?: () => any, fromJSON?: (value: any, value_data: any) => any): any {
    Reviver.constructors ??= {};
    Reviver.constructors[constructor.name] = constructor;
    return constructor;
}

@insavegame
export class Savegame {
    modelprops: {};
    allSpacesObjects: ISpaceObject[];
    spaces: Space[];
}

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

export function show_openfile_dialog(options: { multiple: boolean, accept: string, eventlistener: (this: HTMLInputElement, ev: Event) => any }) {
    setload = document.createElement('input');
    setload.type = 'file';
    setload.multiple = options.multiple;
    setload.accept = options.accept;
    setload.style.display = 'none';
    setload.click();

    setload.addEventListener('change', options.eventlistener);
}

export function show_load_savestate_dialog() {
    show_openfile_dialog({ multiple: false, accept: '.bmsx', eventlistener: load_savestate });
}

function are_any_files_selected_via_openfile_dialog(files: FileList) {
    return files && files.length !== 0;
}

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

function load_savestate(this: HTMLInputElement, ev: Event) {
    const file = get_first_selected_file_from_openfile_dialog(setload.files);
    if (file) {
        file.text().then(result => globalThis.model.load(result));
    }
    setload = undefined;
}
