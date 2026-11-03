/** A rejected public operation, distinct from an ambiguous storage/transport failure. */
export class BuildRequestError extends Error {
	public constructor(public readonly status: number, message: string) { super(message); }
}

/** Another process owns the workspace's build store. */
export class BuildStoreLockedError extends Error {
	public constructor(public readonly database: string, cause: unknown) { super(`Build store is locked: ${database}`, { cause }); }
}
