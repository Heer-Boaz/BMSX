export function unique_strings(values: readonly string[]): string[] {
	if (!values || values.length === 0) return [];
	return Array.from(new Set(values));
}
