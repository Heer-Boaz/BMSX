import type { LuaSourceRange } from '../../../toolchain/ts/lua/syntax/ast';
import type { LuaDefinitionLocation } from '../../../toolchain/ts/lua/semantic_contracts';

export function definitionLocationFromSourceRange(range: LuaSourceRange): LuaDefinitionLocation {
	return {
		path: range.path,
		range: {
			startLine: range.start.line,
			startColumn: range.start.column,
			endLine: range.end.line,
			endColumn: range.end.column,
		},
	};
}
