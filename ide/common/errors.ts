/** Errors cross host I/O and authoring boundaries as unknown, not as guest values. */
export function extractErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
