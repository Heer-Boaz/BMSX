
export function deep_clone<T>(v: T): T {
	if (v === null || typeof v !== 'object') return v;
	if (Array.isArray(v)) return v.map(deep_clone) as T;
	return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, deep_clone(val)])) as T;
}
