import { textToByteString } from '../../machine/ts/common/byte_string';
import { valuePayload as tableAddressPayload } from '../../machine/ts/machine/cpu/value';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import * as v from '../../machine/ts/machine/cpu/value';
import { CpuExecutionBackend } from '../../machine/ts/machine/cpu/compiled_block';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { buildRomMetadataSection } from '../../toolchain/ts/rompack/metadata_encode';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure, runGuestToHalt } from '../helpers/cpu_test_harness';

for (const optLevel of [3] as const) for (const backend of [CpuExecutionBackend.Interpreter]) test(`the cartlib BIN reader consumes production values and shared metadata at O${optLevel} (${backend})`, () => {
	const entrySource = `bss fixture_bytes: u8[0x5000]
require('bootstrap')
local bin<const> = require('cartlib/bin')
return function(addr) return bin.decode(addr, 'fixture') end,
function(addr)
 local names<const>, count<const> = bin.read_metadata_prop_names(addr)
 return bin.decode_with_props(addr + count, names, 'metadata'), count
end, fixture_bytes`;
	const modules = [
		{ path: 'bootstrap', source: "require('base')\ntable = require('table')\nstring = require('string/base')" },
		...['base', 'number/parse', 'number/decimal', 'table', 'string/base', 'string/float/decode'].map(path => ({
			path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
		})),
		...['cartlib/memory', 'cartlib/bin'].map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') })),
		{ path: 'tty/console', source: 'return { write = function() end, end_line = function() end }' },
	].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
	const program = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules,
		{ entrySource, programDomain: 'system', optLevel });
	const { cpu, memory } = createTestSystemCpu(linkTestSystemBlua32(program), backend);
	cpu.installBootPrimitives();
	runGuestToHalt(cpu, 1_000_000);
	const [decodeValue, decodeMetadataValue, buffer] = materializeCpuCompletionValues(cpu);
	const decode = v.asClosure(decodeValue, cpu.gc), decodeMetadata = v.asClosure(decodeMetadataValue, cpu.gc);
	const address = v.valuePayload(buffer);
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
	const sequence = v.valuePayload(read(encodeBinary(integers)));
	assert.equal(cpu.gc.tables.length(sequence), integers.length);
	for (const [index, value] of integers.entries()) assert.equal(cpu.gc.tables.getInteger(sequence, index + 1), v.valueInteger(value));
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
	const binary = v.valuePayload(read(encodeBinary(new Uint8Array([0, 1, 127, 128, 255]))));
	assert.deepEqual([1, 2, 3, 4, 5].map(index => cpu.gc.tables.getInteger(binary, index)), [0, 1, 127, 128, 255].map(v.valueInteger));
	const set = v.valuePayload(read(encodeBinary(new Set([3, 'set value', false]))));
	assert.equal(cpu.gc.tables.getInteger(set, 1), v.valueInteger(3));
	assert.equal(cpu.stringPool.toString(v.asStringId(cpu.gc.tables.getInteger(set, 2))), 'set value');
	assert.equal(cpu.gc.tables.getInteger(set, 3), v.valueBool(false));
	const mixedRoot = v.valuePayload(read(encodeBinary({
		values: [0, -1, 63, -64, 64, -65, false, 3, null, -4, [5, 8192, -6], 7,
			'雪🙂', -8, { value: 9 }, 10, 0.25, -11, 0x7fffffff, -0x80000000, 12],
		after: 77,
	})));
	const mixed = v.valuePayload(cpu.gc.tables.getStringKey(mixedRoot, cpu.stringPool.intern('values')));
	for (const [index, value] of [[1, 0], [2, -1], [3, 63], [4, -64], [5, 64], [6, -65],
		[8, 3], [10, -4], [12, 7], [14, -8], [16, 10], [18, -11], [19, 0x7fffffff],
		[20, -0x80000000], [21, 12]] as const) {
		assert.equal(cpu.gc.tables.getInteger(mixed, index), v.valueInteger(value));
	}
	assert.equal(cpu.gc.tables.getInteger(mixed, 7), v.valueBool(false));
	assert.equal(cpu.gc.tables.getInteger(mixed, 9), v.valueNil());
	assert.equal(cpu.gc.tables.getInteger(mixed, 17), v.valueFloat(0.25));
	assert.deepEqual([1, 2, 3].map(index => cpu.gc.tables.getInteger(v.valuePayload(cpu.gc.tables.getInteger(mixed, 11)), index)), [5, 8192, -6].map(v.valueInteger));
	assert.equal(cpu.stringPool.toString(v.asStringId(cpu.gc.tables.getInteger(mixed, 13))), '雪🙂');
	assert.equal(cpu.gc.tables.getStringKey(v.valuePayload(cpu.gc.tables.getInteger(mixed, 15)), cpu.stringPool.intern('value')), v.valueInteger(9));
	assert.equal(cpu.gc.tables.getStringKey(mixedRoot, cpu.stringPool.intern('after')), v.valueInteger(77),
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
	const root = v.valuePayload(rootValue);
	assert.equal(headerLength, v.valueInteger(section.header.length), 'the first payload starts immediately after the shared names');
	assert.equal(cpu.gc.tables.getStringKey(root, cpu.stringPool.intern('tail')), v.valueInteger(-0x80000000));
	const object = v.valuePayload(cpu.gc.tables.getStringKey(root, cpu.stringPool.intern(textToByteString(key))));
	assert.equal(cpu.gc.tables.getStringKey(object, cpu.stringPool.intern('count')), v.valueInteger(0x7fffffff));
	const nested = v.valuePayload(cpu.gc.tables.getStringKey(object, cpu.stringPool.intern('nested')));
	assert.equal(cpu.gc.tables.getInteger(nested, 1), v.valueBool(true));
	assert.equal(cpu.stringPool.toString(v.asStringId(cpu.gc.tables.getInteger(nested, 2))), 'name');
	assert.equal(cpu.gc.tables.getStringKey(v.valuePayload(cpu.gc.tables.getInteger(nested, 3)), cpu.stringPool.intern('r')), v.valueInteger(128));
});
