import { deep_clone } from './deep_clone';

function computeSignature(value: unknown, seen: WeakSet<object>): string {
	if (value === null) {
		return 'null';
	}
	const type = typeof value;
	if (type === 'number' || type === 'boolean' || type === 'string') {
		return JSON.stringify(value);
	}
	if (type === 'undefined') {
		return '"__undefined__"';
	}
	if (type === 'function') {
		const fn = value as (...args: unknown[]) => unknown;
		const name = fn.name && fn.name.length > 0 ? fn.name : 'anonymous';
		return JSON.stringify(`__fn__:${name}`);
	}
	if (type === 'object') {
		const objectValue = value as Record<string, unknown>;
		if (seen.has(objectValue)) {
			return '"__cycle__"';
		}
		seen.add(objectValue);
		if (Array.isArray(objectValue)) {
			const entries = objectValue.map(entry => computeSignature(entry, seen));
			return '[' + entries.join(',') + ']';
		}
		const keys = Object.keys(objectValue).sort();
		const parts: string[] = [];
		for (const key of keys) {
			parts.push(JSON.stringify(key) + ':' + computeSignature(objectValue[key], seen));
		}
		return '{' + parts.join(',') + '}';
	}
	return JSON.stringify(value);
}

export function computeBlueprintSignature(value: unknown): string {
	return computeSignature(value, new WeakSet<object>());
}

export function cloneBlueprint<T>(value: T): T {
	return deep_clone(value);
}
