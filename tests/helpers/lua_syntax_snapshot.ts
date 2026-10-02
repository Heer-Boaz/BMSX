import { LuaStatementSequence } from '../../toolchain/ts/lua/syntax/statement_sequence';
import type { LuaChunk, LuaTableConstructorExpression, LuaTableField } from '../../toolchain/ts/lua/syntax/ast';
import type { LuaSyntaxSpan } from '../../toolchain/ts/lua/syntax/source_locations';

/** Independent syntax oracle: occurrence identity and query caches are not grammar. */
export function luaSyntaxSnapshot(chunk: LuaChunk): unknown {
	const locations = chunk.locations;
	return JSON.parse(JSON.stringify(chunk, function(key, value) {
		if (value instanceof LuaStatementSequence) return Array.from(value);
		if (key === 'locations') return undefined;
		if (key === 'tokens') return Array.from(chunk.tokens, token => {
			const { unit, start, end, ...data } = token;
			return { ...data, span: { unit, start, end } };
		});
		if (key === 'span') return locations.range(value as LuaSyntaxSpan);
		if (key === 'units') return (value as LuaSyntaxSpan['unit'][]).map(unit => locations.offset(unit, 0));
		if (key === 'startInclusive' || key === 'endExclusive') return locations.position(this.span.unit, value);
		if (key === 'separators') return (value as number[]).map(offset => locations.position(this.span.unit, offset));
		if (key === 'syntaxError' && value !== null) return { name: value.name, message: value.message,
			path: value.path, line: value.line, column: value.column };
		return value;
	}));
}

const sourceKeys = new Set(['span', 'locations', 'offset', 'skippedSyntax', 'range', 'startInclusive', 'endExclusive',
	'line', 'column', 'source', 'tokens', 'syntaxError', 'separators']);

/** Table-edit oracle: compare grammar independently of source positions and storage identity. */
export function serializeLuaGrammar(chunk: LuaChunk, tableFields?: ReadonlyMap<LuaTableConstructorExpression, readonly LuaTableField[]>): string {
	return JSON.stringify(chunk, (key, value) => {
		if (value instanceof LuaStatementSequence) return Array.from(value);
		if (sourceKeys.has(key)) return undefined;
		const fields = tableFields?.get(value);
		return fields === undefined ? value : { ...value, fields };
	});
}
