
export function arrayify(value: unknown): unknown[] {
	if (Array.isArray(value)) {
		return value;
	}
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>);
		if (entries.every(([key]) => /^\d+$/.test(key))) {
			return entries
				.sort((a, b) => Number(a[0]) - Number(b[0]))
				.map(([, element]) => element);
		}
	}
	return value === undefined || value === null ? [] : [value];
}
