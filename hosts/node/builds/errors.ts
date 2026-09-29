/** A rejected public operation, distinct from an ambiguous storage/transport failure. */
export class BuildRequestError extends Error {
	public constructor(public readonly status: number, message: string) { super(message); }
}
