import { ISpaceObject, Space } from "./model";

export function serializeObj(obj: any): string {
	let cache = [];
	return JSON.stringify(obj, function (key, value) {
		if (Array.isArray(value)) return value;
		let type = typeof value;
		switch (type) {
			case 'object':
				if (cache.includes(value)) return undefined;
				cache.push(value);
				let typename = value.constructor?.name ?? value.prototype?.name;
				if (typename !== 'Object' && typename !== 'object') {
					value.typename = typename;
					if (value.prototype?.onsave) return value.prototype.onsave(value);
					if (value.constructor?.onsave) return value.constructor.onsave(value);
				}
				return value;
			case 'function':
				return undefined;
			default:
				return value;
		}
	});
}

interface IReviver {
	(key: any, value: any): any;
	constructors: Record<string, new () => any>;
	onLoad: Record<string, (result: any) => any>;
}

// https://stackoverflow.com/questions/8111446/turning-json-strings-into-objects-with-methods
// A generic "smart reviver" function.
// Looks for object values with a `ctor` property and
// a `data` property. If it finds them, and finds a matching
// constructor that has a `fromJSON` property on it, it hands
// off to that `fromJSON` fuunction, passing in the value.
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
		return onload ? onload(result) : result;
	}
	return value;
}

Reviver.constructors = Reviver.constructors ?? {};
Reviver.onLoad = Reviver.onLoad ?? {};
// Reviver.onSave = Reviver.onSave ?? {};

// target: the class that the member is on.
// propertyKey: the name of the member in the class.
// descriptor: the member descriptor; This is essentially the object that would have been passed to Object.defineProperty.
export function onsave(target: any, propertyKey: any, descriptor: PropertyDescriptor): any {
	target.onsave = descriptor.value;
}

// target: the class that the member is on.
// name: the name of the member in the class.
// descriptor: the member descriptor; This is essentially the object that would have been passed to Object.defineProperty.
export function onload(target: any, name: any, descriptor: PropertyDescriptor): any {
	Reviver.onLoad ??= {};
	Reviver.onLoad[target.name] = descriptor.value;
}

// export function insavegame<TFunction extends Function>(target: any, toJSON?: () => any, fromJSON?: (value: any, value_data: any) => any): any {
// 	Reviver.constructors ??= {};
// 	Reviver.constructors[target.name] = target;
// 	return target;
// }
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
