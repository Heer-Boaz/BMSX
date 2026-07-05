import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { compileLuaChunkToProgram, encodeCompiledProgramImage } from '../../machine/ts/lua/compiler';

function parseSource(source: string, path: string) {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

test('bios math RNG state is initialized guest RAM owned by the math module', () => {
	const entrySource = 'return 0';
	const modules = [
		{ path: 'bios/math', file: 'machine/firmware/bios/math.lua' },
		{ path: 'bios/common/numeric', file: 'machine/firmware/bios/common/numeric.lua' },
		{ path: 'bios/util/sincos_turn32', file: 'machine/firmware/bios/util/sincos_turn32.lua' },
	].map(module => {
		const source = readFileSync(module.file, 'utf8');
		return {
			path: module.path,
			chunk: parseSource(source, `${module.path}.lua`),
			source,
		};
	});
	const compiled = compileLuaChunkToProgram(parseSource(entrySource, 'entry.lua'), modules, { entrySource });
	const image = encodeCompiledProgramImage(compiled);
	assert.equal(compiled.moduleProtoMap.has('bios/math'), true);
	assert.deepEqual(Array.from(image.sections.data.bytes.slice(0, 4)), [0x78, 0x56, 0x34, 0x12]);
	assert.equal(image.sections.data.symbols.some(symbol => symbol.name === 'module:bios/math/data:rng_state'), true);
});
