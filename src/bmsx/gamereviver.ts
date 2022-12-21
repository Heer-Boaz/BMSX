import { ISpaceObject, Space } from "./model";

type class2propkey2bool = Record<string, Record<string, boolean>>;

interface IReviver {
	(key: any, value: any): any;
	constructors: Record<string, new () => any>;
	onLoad: Record<string, (result: any) => any>;
	/**
	 * Remove the helper-property that was added during serialization
	 */
	removeSerializerProps: (obj: { typename: string; }) => void;
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
}

Serializer.excludedProperties = Serializer.excludedProperties ?? {};
Serializer.shouldExcludeFromSerialization = (key: any, value: any, cache: any[]): boolean => {
	let typename = value?.constructor?.name ?? value?.prototype?.name;
	if (typename && key) {
		if (Serializer.excludedProperties[typename]?.[key])
			return true; // Exclude property from serialization
	}
	let type = typeof value;
	switch (type) {
		case 'function':
			return true; // We don't serialize functions
		case 'object':
			return cache.includes(value);
		default:
			return false;
	}
}

Serializer.serializeObject = (value: any, cache: any[]): {} => {
	if (Array.isArray(value)) return value;
	cache.push(value); // We already checked whether object should be excluded in Serializer.shouldExcludeFromSerialization

	let typename = value?.constructor?.name ?? value?.prototype?.name; // TODO: Twee keer bepalen :-(
	if (typename !== 'Object' && typename !== 'object') {
		value.typename = typename;
		if (value.prototype?.onsave) return value.prototype.onsave(value);
		if (value.constructor?.onsave) return value.constructor.onsave(value);
	}
	return value;
}

// https://stackoverflow.com/questions/8111446/turning-json-strings-into-objects-with-methods
// A generic "smart reviver" function.
// Looks for object values with a `ctor` property and
// a `data` property. If it finds them, and finds a matching
// constructor that has a `fromJSON` property on it, it hands
// off to that `fromJSON` function, passing in the value.
export const Reviver: IReviver = (key: any, value: any) => {
	if (value === null || value === undefined) return value;

	if (Array.isArray(value)) {
		return value;
	}

	if (typeof value === "object" &&
		typeof value.typename === "string") {
		let theConstructor = Reviver.constructors[value.typename];
		if (!theConstructor) throw `No constructor known for object of type '${value.typename}'. Did you forget to add '@insavegame' to the class definition?`;
		let result = Object.assign(new theConstructor(), value);
		let onload = Reviver.onLoad[value.typename];
		onload && (result = onload(result));
		Reviver.removeSerializerProps(result);
		return result;
	}
	return value;
}

Reviver.constructors = Reviver.constructors ?? {};
Reviver.onLoad = Reviver.onLoad ?? {};
Reviver.removeSerializerProps = (obj: { typename: string }): void => {
	// Remove the helper-property that was added during serialization
	obj.typename = undefined;
	delete obj.typename;
}

// Reviver.onSave = Reviver.onSave ?? {};

// target: the class that the member is on.
// propertyKey: the name of the member in the class.
// descriptor: the member descriptor; This is essentially the object that would have been passed to Object.defineProperty.
export function onsave(target: Object & { onsave?: any }, propertyKey: string | symbol, descriptor: PropertyDescriptor): any {
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
