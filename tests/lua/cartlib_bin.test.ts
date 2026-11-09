import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { encodeBinary } from '../../machine/ts/common/serializer/binencoder';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { asStringId, type StringValue } from '../../machine/ts/machine/cpu/value';
import { DYNAMIC_RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { buildRomMetadataSection } from '../../toolchain/ts/rompack/metadata_encode';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { materializeCpuCompletionValues, parseLuaChunk, runCompletionClosure } from './cpu_test_harness';

const address = DYNAMIC_RAM_BASE + 0x28000;

for (const optLevel of [0, 3] as const) test(`the cartlib BIN reader consumes production values and shared metadata at O${optLevel}`, () => {
	const entrySource = `require('bootstrap')
local bin<const> = require('cartlib/bin')
return function(addr) return bin.decode(addr, 'fixture') end,
function(addr)
 local names<const>, count<const> = bin.read_metadata_prop_names(addr)
 return bin.decode_with_props(addr + count, names, 'metadata'), count
end`;
	const modules = [
		{ path: 'bootstrap', source: "require('base')\ntable = require('table')\nstring = require('string/base')" },
		...['base', 'table', 'string/base', 'string/utf8', 'string/float/decode'].map(path => ({
			path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
		})),
		...['cartlib/memory', 'cartlib/bin'].map(path => ({ path, source: readFileSync(`${path}.lua`, 'utf8') })),
		{ path: 'tty/console', source: 'return { write = function() end, end_line = function() end }' },
	].map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
	const program = compileLuaChunkToProgram(parseLuaChunk(entrySource), modules,
		{ entrySource, programDomain: 'system', optLevel });
	const { cpu, memory } = createTestSystemCpu(linkTestSystemBlua32(program));
	cpu.installBootPrimitives();
	assert.equal(cpu.runUntilDepth(0, 1_000_000), RunResult.Halted);
	const [decode, decodeMetadata] = materializeCpuCompletionValues(cpu) as Closure[];
	const read = (bytes: Uint8Array) => {
		memory.writeBytes(address, bytes);
		runCompletionClosure(cpu, decode, [address]);
		return materializeCpuCompletionValues(cpu)[0];
	};
	// Both sides of each zigzag width, including the signed-word boundary.
	const integers = [0, 1, -1, 63, -64, 64, -65, 8191, -8192, 8192, -8193,
		1048575, -1048576, 1048576, -1048577, 134217727, -134217728,
		134217728, -134217729, 1073741823, -1073741824, 1073741824, -1073741825,
		0x7fffffff, -0x80000000];
	for (const value of integers) assert.equal(read(encodeBinary(value)), value);
	const sequence = read(encodeBinary(integers)) as Table;
	assert.equal(sequence.arrayLength, integers.length);
	for (const [index, value] of integers.entries()) assert.equal(sequence.getInteger(index + 1), value);
	for (const value of [null, false, true, 0.25, Math.PI, -0, Infinity, -Infinity, NaN]) {
		assert.deepEqual(read(encodeBinary(value)), value);
	}
	for (const value of ['', 'ASCII', '雪🙂', 'x'.repeat(128), '雪'.repeat(5500)]) {
		assert.equal(cpu.stringPool.toString(asStringId(read(encodeBinary(value)) as StringValue)), value);
	}
	for (const id of [0, 127, 128, 0x7fffffff, 0x80000000, 0xffffffff]) {
		assert.equal((read(encodeBinary({ r: id })) as Table).getStringKey(cpu.stringPool.intern('r')), id);
	}
	const binary = read(encodeBinary(new Uint8Array([0, 1, 127, 128, 255]))) as Table;
	assert.deepEqual([1, 2, 3, 4, 5].map(index => binary.getInteger(index)), [0, 1, 127, 128, 255]);
	const set = read(encodeBinary(new Set([3, 'set value', false]))) as Table;
	assert.equal(set.getInteger(1), 3);
	assert.equal(cpu.stringPool.toString(asStringId(set.getInteger(2) as StringValue)), 'set value');
	assert.equal(set.getInteger(3), false);
	const key = '雪'.repeat(60);
	const data = { [key]: { count: 0x7fffffff, nested: [true, 'name', { r: 128 }] }, tail: -0x80000000 };
	const section = buildRomMetadataSection([data]);
	const bytes = new Uint8Array(section.header.length + section.payloads[0].length);
	bytes.set(section.header);
	bytes.set(section.payloads[0], section.header.length);
	memory.writeBytes(address, bytes);
	runCompletionClosure(cpu, decodeMetadata, [address]);
	const [root, headerLength] = materializeCpuCompletionValues(cpu) as [Table, number];
	assert.equal(headerLength, section.header.length, 'the first payload starts immediately after the shared names');
	assert.equal(root.getStringKey(cpu.stringPool.intern('tail')), -0x80000000);
	const object = root.getStringKey(cpu.stringPool.intern(key)) as Table;
	assert.equal(object.getStringKey(cpu.stringPool.intern('count')), 0x7fffffff);
	const nested = object.getStringKey(cpu.stringPool.intern('nested')) as Table;
	assert.equal(nested.getInteger(1), true);
	assert.equal(cpu.stringPool.toString(asStringId(nested.getInteger(2) as StringValue)), 'name');
	assert.equal((nested.getInteger(3) as Table).getStringKey(cpu.stringPool.intern('r')), 128);
});
