export function deep_equal(a: any, b: any): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (a && b && typeof a === 'object') {
		if (Array.isArray(a) !== Array.isArray(b)) return false;
		if (Array.isArray(a)) {
			if (a.length !== b.length) return false;
			for (let i = 0; i < a.length; i++) if (!deep_equal(a[i], b[i])) return false;
			return true;
		}
		const ak = Object.keys(a), bk = Object.keys(b);
		if (ak.length !== bk.length) return false;
		for (const k of ak) if (!deep_equal(a[k], b[k])) return false;
		return true;
	}
	return false;
}
