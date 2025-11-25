import { normalizeDecoratedClassName } from '../utils/decorators';
import * as GameSerializer from './gameserializer';
import type { ConstructorWithSaveGame } from './gameserializer';
import { scheduleMicrotask } from '../platform/platform';

function queueRegistration(fn: () => void): void {
	scheduleMicrotask(fn);
}

function getSerializer() {
	const serializer = GameSerializer.Serializer;
	if (!serializer) {
		throw new Error('Serializer not initialized yet.');
	}
	return serializer;
}

function getReviver() {
	const reviver = GameSerializer.Reviver;
	if (!reviver) {
		throw new Error('Reviver not initialized yet.');
	}
	return reviver;
}

/**
 * Marks a static method as an `@onsave` hook.  The function must
 * return an object of extra props to merge into the serialized form.
 */

export function onsave(value: (...args: any[]) => any, context: ClassMethodDecoratorContext) {
	const method = value;
	const register = (ctor: any) => {
		if (!ctor || typeof ctor !== 'function') {
			throw new Error('[@onsave] Decorator used on a target without a constructor function.');
		}
		if (!ctor.name) {
			throw new Error('[@onsave] Decorated class must have a constructor name.');
		}
		const className = ctor.name;
		queueRegistration(() => {
			const serializer = getSerializer();
			serializer.onSaves[className] ??= [];
			if (!serializer.onSaves[className].includes(method)) {
				serializer.onSaves[className].push(method);
			}
		});
	};
	if (context.static) {
		context.addInitializer(function () { register(this); });
	} else {
		context.addInitializer(function () { register(this.constructor); });
	}
	// No method replacement
}
/**
 * Marks a property of a class as excluded from serialization.
 * @param target - The target object to mark the property on.
 * @param propertyKey - The name of the property to mark as excluded.
 * @param descriptor - The property descriptor for the property to mark as excluded.
 * @returns The modified property descriptor.
 */

export function excludepropfromsavegame(_value: undefined, context: ClassFieldDecoratorContext) {
	const prop = String(context.name);
	const register = (ctor: any) => {
		if (!ctor || typeof ctor !== 'function') {
			throw new Error('[@excludepropfromsavegame] Decorator used on a target without a constructor function.');
		}
		if (!ctor.name) {
			throw new Error('[@excludepropfromsavegame] Decorated class must have a constructor name.');
		}
		const type = normalizeDecoratedClassName(ctor.name);
		queueRegistration(() => {
			const serializer = getSerializer();
			const reviver = getReviver();
			serializer.excludedProperties[type] ??= {};
			serializer.excludedProperties[type][prop] = true;

			reviver.excludedProperties[type] ??= {};
			reviver.excludedProperties[type][prop] = true;
		});
	};
	if (context.static) {
		context.addInitializer(function () { register(this); });
	} else {
		context.addInitializer(function () { register(this.constructor); });
	}
}
/**
 * Sets the `onload` property of the target object to the provided function.
 * This function will be called during deserialization to allow the object to perform any custom deserialization logic.
 * @param target - The target object to set the `onload` property on.
 * @param name - The name of the property to set the `onload` property on.
 * @param descriptor - The property descriptor for the property to set the `onload` property on.
 * @returns The modified property descriptor.
 */

export function onload(value: (...args: any[]) => any, context: ClassMethodDecoratorContext) {
	const method = value;
	const register = (ctor: any) => {
		if (!ctor || typeof ctor !== 'function') {
			throw new Error('[@onload] Decorator used on a target without a constructor function.');
		}
		if (!ctor.name) {
			throw new Error('[@onload] Decorated class must have a constructor name.');
		}
		const type = normalizeDecoratedClassName(ctor.name);

		queueRegistration(() => {
			const reviver = getReviver();
			reviver.onLoads ??= {};
			reviver.onLoads[type] ??= [];
			if (!reviver.onLoads[type].includes(method)) {
				reviver.onLoads[type].push(method);
			}
		});
	};
	if (context.static) {
		context.addInitializer(function () { register(this); });
	} else {
		context.addInitializer(function () { register(this.constructor); });
	}
	// No method replacement
}
/**
 * Class-decorator overload of `@insavegame` used when no explicit type id is provided.
 *
 * When applied as `@insavegame` directly on a class, the decorator registers the class
 * in the savegame constructor registry (Reviver.constructors) under the class's
 * (normalized) name so instances can be serialized and deserialized.
 *
 * The decorator also marks the class as includable in savegames (internal flags
 * are adjusted accordingly).
 *
 * @param value - The class constructor being decorated.
 * @param context - The decorator context supplied by the TypeScript decorator transform.
 */
// Accept either:
// - abstract classes without a declared constructor, or
// - concrete classes whose constructor's first argument is an object type
//   that at least has `constructReason?: 'revived' | undefined`.

export type RevivableObjectArgs = { constructReason?: 'revive' | undefined; } & {};
// Utility types to discriminate constructor shapes
type IsAny<T> = 0 extends (1 & T) ? true : false;
type ParamsOf<C> = C extends abstract new (...args: infer P) => any ? P : never;
type FirstArg<C> = ParamsOf<C> extends [infer A, ...any[]] ? A : never;
type HasAtLeastOneParam<C> = ParamsOf<C> extends [any, ...any[]] ? true : false;
type IsZeroParams<C> = ParamsOf<C> extends [] ? true : false;
// "No declared constructor" heuristic: param list is widened any[] (not tuple [] or [..])
type HasNoDeclaredCtor<C> = HasAtLeastOneParam<C> extends true ? false : (IsZeroParams<C> extends true ? false : true);
// Concrete classes must declare a first argument matching RevivableObjectArgs (and not 'any')
type ConcreteAcceptable<C extends new (...args: any[]) => any> = HasAtLeastOneParam<C> extends true ? (IsAny<FirstArg<C>> extends true ? never : (FirstArg<C> extends RevivableObjectArgs ? C : never)) : never;
// Abstract classes are acceptable if they have no declared constructor,
// or if they declare one whose first parameter matches RevivableObjectArgs
type AbstractAcceptable<C extends abstract new (...args: any[]) => any> = HasNoDeclaredCtor<C> extends true ? C : (HasAtLeastOneParam<C> extends true ? (IsAny<FirstArg<C>> extends true ? never : (FirstArg<C> extends RevivableObjectArgs ? C : never)) : never);

export function insavegame<C extends new (...args: any[]) => any>(value: ConcreteAcceptable<C>, context: ClassDecoratorContext<C>): void;
export function insavegame<C extends abstract new (...args: any[]) => any>(value: AbstractAcceptable<C>, context: ClassDecoratorContext<C>): void;
/**
 * Overload: when supplied with a string typeId this returns a class decorator factory.
 *
 * Use `@insavegame('TypeId')` to register a class under an explicit savegame type identifier
 * which will be used for serialization and deserialization.
 *
 * @param typeId - Explicit type identifier to register the class under.
 * @returns A class decorator that registers the decorated class with the provided type id.
 */

export function insavegame(typeId: string): {
	<C extends new (...args: any[]) => any>(value: ConcreteAcceptable<C>, context: ClassDecoratorContext<C>): void;
	<C extends abstract new (...args: any[]) => any>(value: AbstractAcceptable<C>, context: ClassDecoratorContext<C>): void;
};
/**
 * Implementation for the `@insavegame` decorator. This function supports two usage patterns:
 *
 * 1. As a class decorator: `@insavegame` — the decorator will register the decorated class
 *    under its (possibly normalized) constructor name as a serializable type used by the
 *    save/load system.
 *
 * 2. As a decorator factory: `@insavegame('TypeId')` — returns a decorator that registers
 *    the decorated class under the explicit `TypeId` instead of the inferred constructor name.
 *
 * When a class is registered, the function ensures:
 * - The constructor is added to Reviver.constructors under the chosen key.
 * - The class is marked as includable for savegames (internal exclude flag set to false).
 * - The Serializer.classExcludeMap is updated to allow serialization of that type.
 *
 * Parameters:
 * - valueOrId: Either the class constructor (when used directly as a decorator) or a string
 *   type identifier (when used as a decorator factory).
 * - maybeContext: Provided by the decorator transform when the function is used directly as a decorator.
 *
 * Returns:
 * - When used as a decorator factory, returns a decorator function.
 * - Otherwise returns undefined.
 */
export function insavegame(valueOrId: any, maybeContext?: ClassDecoratorContext) {
function register(ctor: any, typeId?: string) {
	if (!ctor || typeof ctor !== 'function') {
		throw new Error('[@insavegame] Decorator received an invalid constructor.');
	}
	let key = typeId ?? ctor.name;
	if (!key) throw new Error('[@insavegame]: Failed to register class: no valid key found.');
	// If no explicit typeId was supplied and the inferred class name starts with underscore
	// (artifact of TS decorator transform emitting helper vars like _ClassName), strip it for the public key.
	if (!typeId) key = normalizeDecoratedClassName(key);

	queueRegistration(() => {
		const reviver = getReviver();
		const serializer = getSerializer();
		reviver.constructors ??= {};
		reviver.constructors[key] = ctor;
		(ctor as ConstructorWithSaveGame).__exclude_savegame__ = false;
		serializer.classExcludeMap.set(key, false);
	});
}
	if (typeof valueOrId === 'function' && maybeContext) {
		register(valueOrId);
		return undefined;
	}
	// Usage: @insavegame('TypeId') → returns the actual decorator
	if (typeof valueOrId === 'string' && !maybeContext) {
		const typeId = valueOrId as string;
		return function <T extends abstract new (...args: any[]) => any>(value: T, _context: ClassDecoratorContext<T>) {
			register(value, typeId);
		};
	}
	return undefined;
}
/**
 * A decorator function that marks a class as NOT serializable for the game's save system.
 * Objects of this type will be excluded from serialization.
 * @param constructor - The constructor function of the class to exclude.
 * @returns The original constructor function.
 */

export function excludeclassfromsavegame(value: any, _context: ClassDecoratorContext) {
	if (!value || typeof value !== 'function') {
		throw new Error('[@excludeclassfromsavegame] Decorator must target a class.');
	}
	(value as ConstructorWithSaveGame).__exclude_savegame__ = true;
	if (!(value as Function).name) {
		throw new Error('[@excludeclassfromsavegame] Target class must have a constructor name.');
	}
	const key = normalizeDecoratedClassName((value as Function).name);
	queueRegistration(() => {
		const serializer = getSerializer();
		serializer.classExcludeMap.set(key, true);
		serializer.excludedObjectTypes.add(key);
	});
}
