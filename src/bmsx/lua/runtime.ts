import type { LuaChunk } from './ast';
import { LuaEnvironment } from './environment';
import { LuaLexer } from './lexer';
import { LuaParser } from './parser';

export class LuaInterpreter {
	private readonly globals: LuaEnvironment;

	constructor(globals: LuaEnvironment | null) {
		if (globals === null) {
			this.globals = LuaEnvironment.createRoot();
		}
		else {
			this.globals = globals;
		}
	}

	public execute(source: string, chunkName: string): void {
		const lexer = new LuaLexer(source, chunkName);
		const tokens = lexer.scanTokens();
		const parser = new LuaParser(tokens, chunkName);
		const chunk = parser.parseChunk();
		this.executeChunk(chunk);
	}

	public getGlobalEnvironment(): LuaEnvironment {
		return this.globals;
	}

	protected executeChunk(chunk: LuaChunk): void {
		throw new Error(`[LuaInterpreter] Execution not implemented for chunk '${chunk.range.chunkName}'.`);
	}
}

export function createLuaInterpreter(): LuaInterpreter {
	return new LuaInterpreter(null);
}
