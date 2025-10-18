import type { LuaToken } from './token';
import type { LuaChunk } from './ast';
import { LuaSyntaxKind } from './ast';

export class LuaParser {
	private readonly tokens: ReadonlyArray<LuaToken>;
	private readonly chunkName: string;

	constructor(tokens: ReadonlyArray<LuaToken>, chunkName: string) {
		this.tokens = tokens;
		this.chunkName = chunkName;
	}

	public parseChunk(): LuaChunk {
		let startLine = 1;
		let startColumn = 1;
		let endLine = 1;
		let endColumn = 1;

		if (this.tokens.length > 0) {
			const first = this.tokens[0];
			startLine = first.line;
			startColumn = first.column;
			const last = this.tokens[this.tokens.length - 1];
			endLine = last.line;
			endColumn = last.column;
		}

		return {
			kind: LuaSyntaxKind.Chunk,
			range: {
				chunkName: this.chunkName,
				start: { line: startLine, column: startColumn },
				end: { line: endLine, column: endColumn },
			},
			body: [],
		};
	}
}
