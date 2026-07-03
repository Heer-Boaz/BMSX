import assert from 'node:assert/strict';
import { test } from 'node:test';

import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { CPU, RunResult, type Value } from '../../machine/ts/machine/cpu/cpu';
import { RAM_BASE } from '../../machine/ts/machine/memory/map';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { compileLuaChunkToProgram } from '../../machine/ts/machine/program/compiler';

const BIN_ADDR = RAM_BASE + 0x21000;

// Pre-place packed little-endian words in ROM-mapped memory, then read them via
// the language's typed struct-array pointer ABI.
function runStructRead(packedWords: number[], snippet: string): Value[] {
	const lexer = new LuaLexer(snippet, 'bin_struct.lua');
	const parser = new LuaParser(lexer.scanTokens(), 'bin_struct.lua', splitText(snippet));
	const compiled = compileLuaChunkToProgram(parser.parseChunk(), [], { entrySource: snippet });
	const memory = new Memory({ systemRom: new Uint8Array(0), cartRom: new Uint8Array(0) });
	for (let index = 0; index < packedWords.length; index += 1) {
		memory.writeMappedU32LE(BIN_ADDR + index * 4, packedWords[index] >>> 0);
	}
	const cpu = new CPU(memory);
	cpu.setProgram(compiled.program, compiled.metadata, compiled.metadata);
	cpu.start(compiled.entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 1000000), RunResult.Halted);
	return Array.from(cpu.lastReturnValues);
}

test('a packed struct-array in ROM-mapped memory is read field-wise via a typed pointer (the .bin consumer pattern)', () => {
	// Three records of { id: word, flags: word } — stride 8 bytes.
	const result = runStructRead(
		[10, 256, 20, 512, 30, 768],
		`
struct tile
	id: word
	flags: word
end
local tiles<const>: *tile[3] = ${BIN_ADDR}
return tiles[0].id, tiles[0].flags, tiles[1].id, tiles[2].flags, sizeof(tile)
`,
	);
	assert.deepEqual(result, [10, 256, 20, 768, 8]);
});

test('struct records with array fields read packed rows at the right offsets', () => {
	// One record of { header: word, cells: word[3] } — stride 16 bytes.
	const result = runStructRead(
		[0x11, 100, 200, 300],
		`
struct row
	header: word
	cells: word[3]
end
local rows<const>: *row[1] = ${BIN_ADDR}
return rows[0].header, rows[0].cells[0], rows[0].cells[2], sizeof(row), offsetof(row.cells)
`,
	);
	assert.deepEqual(result, [0x11, 100, 300, 16, 4]);
});
