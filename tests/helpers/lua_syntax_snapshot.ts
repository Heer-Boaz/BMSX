import type { LuaChunk } from '../../toolchain/ts/lua/syntax/ast';
import type { LuaSyntaxSpan } from '../../toolchain/ts/lua/syntax/source_locations';

/** Independent syntax oracle: occurrence identity and query caches are not grammar. */
export function luaSyntaxSnapshot(chunk: LuaChunk): unknown {
	const locations = chunk.locations;
	return JSON.parse(JSON.stringify(chunk, function(key, value) {
		if (key === 'locations') return undefined;
		if (key === 'span') return locations.range(value as LuaSyntaxSpan);
		if (key === 'units') return (value as LuaSyntaxSpan['unit'][]).map(unit => locations.offset(unit, 0));
		if (key === 'startInclusive' || key === 'endExclusive') return locations.position(this.span.unit, value);
		if (key === 'separators') return (value as number[]).map(offset => locations.position(this.span.unit, offset));
		if (key === 'syntaxError' && value !== null) return { name: value.name, message: value.message,
			path: value.path, line: value.line, column: value.column };
		return value;
	}));
}
