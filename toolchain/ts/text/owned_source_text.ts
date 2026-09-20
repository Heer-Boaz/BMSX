const SOURCE_TEXT_CHUNK_WIDTH = 1024;

/**
 * Lexical spellings may outlive their source generation. Slice detached, bounded
 * UTF-16 chunks instead of retaining a potentially file-sized backing string.
 * Only requested chunks are copied; a local relex never copies the whole input.
 * Forward scanning retains just the current chunk, not a file-sized cache.
 */
export class OwnedSourceText {
	private origin = -SOURCE_TEXT_CHUNK_WIDTH;
	private chunk = '';
	private readonly units: number[] = [];

	public constructor(private readonly source: string) {}

	public slice(start: number, end: number): string {
		let result = '';
		while (start < end) {
			const origin = start - start % SOURCE_TEXT_CHUNK_WIDTH;
			if (origin !== this.origin) {
				const limit = Math.min(origin + SOURCE_TEXT_CHUNK_WIDTH, this.source.length);
				this.units.length = limit - origin;
				for (let index = origin; index < limit; index++) this.units[index - origin] = this.source.charCodeAt(index);
				this.chunk = String.fromCharCode(...this.units);
				this.origin = origin;
			}
			const chunk = this.chunk;
			const limit = Math.min(origin + chunk.length, end);
			result += chunk.slice(start - origin, limit - origin);
			start = limit;
		}
		return result;
	}
}
