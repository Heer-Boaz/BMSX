import type { LuaChunk, LuaSourceRange, LuaStatement } from '../../lua/lua_ast';

export type LuaInstruction = {
	readonly kind: 'statement';
	readonly statement: LuaStatement;
	readonly range: LuaSourceRange;
};

export class VmRam {
	private statementBlocks = new WeakMap<ReadonlyArray<LuaStatement>, ReadonlyArray<LuaInstruction>>();

	public loadChunk(chunk: LuaChunk): ReadonlyArray<LuaInstruction> {
		return this.loadStatements(chunk.body);
	}

	public loadStatements(statements: ReadonlyArray<LuaStatement>): ReadonlyArray<LuaInstruction> {
		let instructions = this.statementBlocks.get(statements);
		if (!instructions) {
			const built: LuaInstruction[] = [];
			for (let index = 0; index < statements.length; index += 1) {
				const statement = statements[index];
				built.push({
					kind: 'statement',
					statement,
					range: statement.range,
				});
			}
			instructions = built;
			this.statementBlocks.set(statements, instructions);
		}
		return instructions;
	}

	public reset(): void {
		this.statementBlocks = new WeakMap<ReadonlyArray<LuaStatement>, ReadonlyArray<LuaInstruction>>();
	}
}
