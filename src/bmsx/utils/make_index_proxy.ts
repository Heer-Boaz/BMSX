import type { Identifier } from '../rompack/rompack';

// Utility: wrap a Map so `mapLike['id']` resolves to `map.get('id')` and
// assignments delete/set through the same surface. Also exposes standard Map
// methods bound to the underlying map.
export function make_index_proxy<V>(backing: Map<Identifier, V>): any {
	return new Proxy(backing, {
		get(target, prop, receiver) {
			// Expose Map API (bound) for internal use
			if (prop === 'get') return (target.get).bind(target);
			if (prop === 'set') return (target.set).bind(target);
			if (prop === 'has') return (target.has).bind(target);
			if (prop === 'delete') return (target.delete).bind(target);
			if (prop === 'clear') return (target.clear).bind(target);
			if (prop === 'size') return (target.size);
			if (prop === Symbol.iterator) return (target[Symbol.iterator]).bind(target);
			if (prop === 'entries') return (target.entries).bind(target);
			if (prop === 'keys') return (target.keys).bind(target);
			if (prop === 'values') return (target.values).bind(target);
			if (prop === 'forEach') return (target.forEach).bind(target);
			// Map-like index access: proxy['id'] → map.get('id')
			if (typeof prop === 'string') return target.get(prop as Identifier);
			// Fallback to default behavior
			return Reflect.get(target, prop, receiver);
		},
		set(target, prop, value) {
			if (typeof prop === 'string') { target.set(prop as Identifier, value as V); return true; }
			// Use Reflect to safely handle symbol keys / non-string property keys
			Reflect.set(target, prop as PropertyKey, value);
			return true;
		},
		has(target, prop) {
			if (typeof prop === 'string') return target.has(prop as Identifier);
			// Use Reflect.has for non-string keys (symbols)
			return Reflect.has(target, prop);
		},
		deleteProperty(target, prop) {
			if (typeof prop === 'string') return target.delete(prop as Identifier);
			// Use Reflect.deleteProperty for symbol/non-string keys
			return Reflect.deleteProperty(target, prop);
		},
	});
}
