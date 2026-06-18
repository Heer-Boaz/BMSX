import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { splitText } from '../../machine/ts/common/text_lines';
import { LuaLexer } from '../../machine/ts/lua/syntax/lexer';
import { LuaParser } from '../../machine/ts/lua/syntax/parser';
import { CPU, RunResult, asStringId, valueIsString, type Value } from '../../machine/ts/machine/cpu/cpu';
import { RAM_BASE } from '../../machine/ts/machine/memory/map';
import { Memory } from '../../machine/ts/machine/memory/memory';
import { compileLuaChunkToProgram } from '../../machine/ts/machine/program/compiler';

const DATA_ADDR = RAM_BASE + 0x20000;

// Compile the real bin.lua (minus its trailing module return) plus a driver that
// exercises bin.decode_path against a blob placed in memory, then run on the CPU
// and return the driver's results as plain JS values.
function runBinDriver(blob: Uint8Array, driverReturns: string): Array<number | string | boolean | null> {
	const binLuaSource = readFileSync('machine/firmware/system/bin.lua', 'utf8');
	const chunkSource = `${binLuaSource.replace(/\breturn bin\s*$/, '')}\nreturn ${driverReturns}\n`;
	const lexer = new LuaLexer(chunkSource, 'bin_driver.lua');
	const parser = new LuaParser(lexer.scanTokens(), 'bin_driver.lua', splitText(chunkSource));
	const compiled = compileLuaChunkToProgram(parser.parseChunk(), [], { entrySource: chunkSource });
	const memory = new Memory({ systemRom: new Uint8Array(0) });
	for (let index = 0; index < blob.length; index += 1) {
		memory.writeMappedU8(DATA_ADDR + index, blob[index]);
	}
	const cpu = new CPU(memory);
	cpu.setProgram(compiled.program, compiled.metadata);
	cpu.start(compiled.entryProtoIndex);
	assert.equal(cpu.runUntilDepth(0, 1000000), RunResult.Halted);
	return Array.from(cpu.lastReturnValues).map((value: Value) => {
		if (valueIsString(value)) {
			return cpu.stringPool.toString(asStringId(value));
		}
		return value as number | boolean | null;
	});
}

test('bin.decode_path reads nested object, array index, and string leaves without materializing the tree', () => {
	const blob = encodeBinary({
		screen: { width: 256, height: 212 },
		title: 'hi',
		meta: { name: 'level-1', tags: ['a', 'b'] },
	});
	const len = blob.length;
	const results = runBinDriver(
		blob,
		[
			`bin.decode_path(${DATA_ADDR}, ${len}, {'screen', 'width'})`,
			`bin.decode_path(${DATA_ADDR}, ${len}, {'screen', 'height'})`,
			`bin.decode_path(${DATA_ADDR}, ${len}, {'title'})`,
			`bin.decode_path(${DATA_ADDR}, ${len}, {'meta', 'name'})`,
			`bin.decode_path(${DATA_ADDR}, ${len}, {'meta', 'tags', 2})`,
		].join(', '),
	);
	assert.deepEqual(results, [256, 212, 'hi', 'level-1', 'b']);
});

test('bin.decode_path misses (absent key, out-of-range index, type mismatch, path past a leaf) return nil', () => {
	const blob = encodeBinary({ screen: { width: 256 }, list: [10, 20] });
	const len = blob.length;
	// Each driver expression yields a boolean so trailing-nil truncation cannot mask a result.
	const results = runBinDriver(
		blob,
		[
			`bin.decode_path(${DATA_ADDR}, ${len}, {'screen', 'missing'}) == nil`,
			`bin.decode_path(${DATA_ADDR}, ${len}, {'absent'}) == nil`,
			`bin.decode_path(${DATA_ADDR}, ${len}, {'list', 5}) == nil`,
			`bin.decode_path(${DATA_ADDR}, ${len}, {'list', 'name'}) == nil`,
			`bin.decode_path(${DATA_ADDR}, ${len}, {'screen', 'width', 'too_deep'}) == nil`,
		].join(', '),
	);
	assert.deepEqual(results, [true, true, true, true, true]);
});
