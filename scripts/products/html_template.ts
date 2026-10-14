/** Substitutes authored build-time slots; callers escape values for their HTML context. */
export function applyTemplateValues(template: string, values: Readonly<Record<string, string>>): string {
	let result = template;
	for (const [key, value] of Object.entries(values)) {
		result = result.split(key).join(value);
	}
	return result;
}
