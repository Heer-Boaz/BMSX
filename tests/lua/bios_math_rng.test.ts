import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';

function parseSource(source: string, path: string) {
	const lexer = new LuaLexer(source, path);
	const parser = new LuaParser(lexer.scanTokens(), path, splitText(source));
	return parser.parseChunk();
}

test('firmware math RNG state is initialized guest RAM owned by the math module', () => {
	const entrySource = 'return 0';
	const modules = [
		{ path: 'lua/math', file: 'bios/lua/math.lua' },
		{ path: 'lua/math/sincos', file: 'bios/lua/math/sincos.lua' },
	].map(module => {
		const source = readFileSync(module.file, 'utf8');
		return {
			path: module.path,
			chunk: parseSource(source, `${module.path}.lua`),
			source,
		};
	});
	const compiled = compileLuaChunkToProgram(parseSource(entrySource, 'entry.lua'), modules, { entrySource });
	const image = encodeCompiledProgramObject(compiled);
	assert.equal(compiled.moduleProtoMap.has('lua/math'), true);
	assert.deepEqual(Array.from(image.sections.data.bytes.slice(0, 4)), [0x78, 0x56, 0x34, 0x12]);
	assert.equal(image.sections.data.symbols.some(symbol => symbol.name === 'module:lua/math/data:rng_state'), true);
});
