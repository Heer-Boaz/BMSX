/** External model arguments are admitted once at the Studio tool boundary. */
export class StudioToolInputError extends Error {}

export function toolArguments(input: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw new StudioToolInputError('Tool arguments must be an object');
	const keys = Object.keys(input);
	if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) throw new StudioToolInputError('Tool arguments do not match the declared fields');
	return input as Record<string, unknown>;
}
