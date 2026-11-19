import { textToByteString } from '../../machine/ts/common/byte_string';
import { valuePayload as tableAddressPayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import * as v from '../../machine/ts/machine/cpu/value';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { buildRomMetadataSection } from '../../toolchain/ts/rompack/metadata_encode';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure } from './cpu_test_harness';

const address = DYNAMIC_RAM_BASE + 0x28000;

for (const optLevel of [0, 3] as const) for (const backend of [CpuExecutionBackend.Interpreter, CpuExecutionBackend.JavaScript]) test(`the cartlib BIN reader consumes production values and shared metadata at O${optLevel} (${backend})`, () => {
	const entrySource = `require('bootstrap')
local bin<const> = require('cartlib/bin')
return function(addr) return bin.decode(addr, 'fixture') end,
function(addr)
 local names<const>, count<const> = bin.read_metadata_prop_names(addr)
 return bin.decode_with_props(addr + count, names, 'metadata'), count
end`;
	const modules = [
		{ path: 'bootstrap', source: "require('base')\ntable = require('table')\nstring = require('string/base')" },
		...['base', 'number/parse', 'number/decimal', 'table', 'string/base', 'string/mapped', 'string/float/decode'].map(path => ({
			path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
		})),
		...['cartlib/memory', 'cartlib/bin'].map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') })),
		{ path: 'tty/console', source: 'return { write = function() end, end_line = function() end }' },
	].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
	const program = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules,
		{ entrySource, programDomain: 'system', optLevel });
	const { cpu, memory } = createTestSystemCpu(linkTestSystemBlua32(program), backend);
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 1_000_000), RunResult.Halted);
	const [decode, decodeMetadata] = materializeCpuCompletionValues(cpu).map(value => v.asClosure(value, cpu.gc));
	const read = (bytes: Uint8Array) => {
		memory.writeBytes(address, bytes);
		runCompletionClosure(cpu, decode, [v.valueInteger(address)]);
		return materializeCpuCompletionValues(cpu)[0];
	};
	// Both sides of each zigzag width, including the signed-word boundary.
	const integers = [0, 1, -1, 63, -64, 64, -65, 8191, -8192, 8192, -8193,
		1048575, -1048576, 1048576, -1048577, 134217727, -134217728,
		134217728, -134217729, 1073741823, -1073741824, 1073741824, -1073741825,
		0x7fffffff, -0x80000000];
	for (const value of integers) assert.equal(read(encodeBinary(value)), v.valueInteger(value));
	const sequence = v.asTable(read(encodeBinary(integers)), cpu.gc);
	assert.equal(sequence.records.length(sequence.address), integers.length);
	for (const [index, value] of integers.entries()) assert.equal(sequence.records.getInteger(sequence.address, index + 1), v.valueInteger(value));
	for (const [value, expected] of [[null, v.valueNil()], [false, v.valueBool(false)], [true, v.valueBool(true)],
		[0.25, v.valueFloat(0.25)], [Math.PI, v.valueFloat(Math.PI)], [-0, v.valueFloatBits(0x80000000)],
		[Infinity, v.valueFloatBits(0x7f800000)], [-Infinity, v.valueFloatBits(0xff800000)], [NaN, v.valueFloatBits(0x7fc00000)]] as const) {
		assert.equal(read(encodeBinary(value)), expected);
	}
	for (const value of ['', 'ASCII', '雪🙂', 'x'.repeat(128), '雪'.repeat(5500)]) {
		assert.equal(cpu.stringPool.toString(v.asStringId(read(encodeBinary(value)))), value);
	}
	for (const id of [0, 127, 128, 0x7fffffff, 0x80000000, 0xffffffff]) {
		assert.equal(cpu.gc.tables.getStringKey(tableAddressPayload(read(encodeBinary({ r: id }))), cpu.stringPool.intern('r')), v.valueInteger(id));
	}
	const binary = v.asTable(read(encodeBinary(new Uint8Array([0, 1, 127, 128, 255]))), cpu.gc);
	assert.deepEqual([1, 2, 3, 4, 5].map(index => binary.records.getInteger(binary.address, index)), [0, 1, 127, 128, 255].map(v.valueInteger));
	const set = v.asTable(read(encodeBinary(new Set([3, 'set value', false]))), cpu.gc);
	assert.equal(set.records.getInteger(set.address, 1), v.valueInteger(3));
	assert.equal(cpu.stringPool.toString(v.asStringId(set.records.getInteger(set.address, 2))), 'set value');
	assert.equal(set.records.getInteger(set.address, 3), v.valueBool(false));
	const mixedRoot = v.asTable(read(encodeBinary({
		values: [0, -1, 63, -64, 64, -65, false, 3, null, -4, [5, 8192, -6], 7,
			'雪🙂', -8, { value: 9 }, 10, 0.25, -11, 0x7fffffff, -0x80000000, 12],
		after: 77,
	})), cpu.gc);
	const mixed = v.asTable(mixedRoot.records.getStringKey(mixedRoot.address, cpu.stringPool.intern('values')), cpu.gc);
	for (const [index, value] of [[1, 0], [2, -1], [3, 63], [4, -64], [5, 64], [6, -65],
		[8, 3], [10, -4], [12, 7], [14, -8], [16, 10], [18, -11], [19, 0x7fffffff],
		[20, -0x80000000], [21, 12]] as const) {
		assert.equal(mixed.records.getInteger(mixed.address, index), v.valueInteger(value));
	}
	assert.equal(mixed.records.getInteger(mixed.address, 7), v.valueBool(false));
	assert.equal(mixed.records.getInteger(mixed.address, 9), v.valueNil());
	assert.equal(mixed.records.getInteger(mixed.address, 17), v.valueFloat(0.25));
	assert.deepEqual([1, 2, 3].map(index => cpu.gc.tables.getInteger(v.valuePayload(mixed.records.getInteger(mixed.address, 11)), index)), [5, 8192, -6].map(v.valueInteger));
	assert.equal(cpu.stringPool.toString(v.asStringId(mixed.records.getInteger(mixed.address, 13))), '雪🙂');
	assert.equal(cpu.gc.tables.getStringKey(v.valuePayload(mixed.records.getInteger(mixed.address, 15)), cpu.stringPool.intern('value')), v.valueInteger(9));
	assert.equal(mixedRoot.records.getStringKey(mixedRoot.address, cpu.stringPool.intern('after')), v.valueInteger(77),
		'batched scalar runs publish the cursor before a following object field');
	const key = '雪'.repeat(60);
	const data = { [key]: { count: 0x7fffffff, nested: [true, 'name', { r: 128 }] }, tail: -0x80000000 };
	const section = buildRomMetadataSection([data]);
	const bytes = new Uint8Array(section.header.length + section.payloads[0].length);
	bytes.set(section.header);
	bytes.set(section.payloads[0], section.header.length);
	memory.writeBytes(address, bytes);
	runCompletionClosure(cpu, decodeMetadata, [v.valueInteger(address)]);
	const [rootValue, headerLength] = materializeCpuCompletionValues(cpu);
	const root = v.asTable(rootValue, cpu.gc);
	assert.equal(headerLength, v.valueInteger(section.header.length), 'the first payload starts immediately after the shared names');
	assert.equal(root.records.getStringKey(root.address, cpu.stringPool.intern('tail')), v.valueInteger(-0x80000000));
	const object = v.asTable(root.records.getStringKey(root.address, cpu.stringPool.intern(textToByteString(key))), cpu.gc);
	assert.equal(object.records.getStringKey(object.address, cpu.stringPool.intern('count')), v.valueInteger(0x7fffffff));
	const nested = v.asTable(object.records.getStringKey(object.address, cpu.stringPool.intern('nested')), cpu.gc);
	assert.equal(nested.records.getInteger(nested.address, 1), v.valueBool(true));
	assert.equal(cpu.stringPool.toString(v.asStringId(nested.records.getInteger(nested.address, 2))), 'name');
	assert.equal(cpu.gc.tables.getStringKey(v.valuePayload(nested.records.getInteger(nested.address, 3)), cpu.stringPool.intern('r')), v.valueInteger(128));
});
