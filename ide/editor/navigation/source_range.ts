import type { LuaSourceRange } from '../../../toolchain/ts/lua/syntax/ast';
import type { LuaDefinitionLocation } from '../../../toolchain/ts/lua/semantic_contracts';
import type { SearchMatch } from '../../common/models';

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

export function searchMatchFromSourceRange(range: LuaSourceRange): SearchMatch {
	return {
		row: range.start.line - 1,
		start: range.start.column - 1,
		end: range.end.column,
	};
}
