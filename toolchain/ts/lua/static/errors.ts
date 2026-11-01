import type { LuaSyntaxSpan } from '../syntax/source_locations';

/** An authored static expression or type cannot supply the requested layout. */
export class StaticSourceError extends Error {
	public constructor(message: string, public readonly file: string, public readonly span: LuaSyntaxSpan) {
		super(message);
		this.name = 'StaticSourceError';
	}
}
