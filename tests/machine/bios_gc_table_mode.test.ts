import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { GC_MODE_META, GC_MODE_NODE } from '../../machine/ts/machine/cpu/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { ValueTag, hashCanonicalTableKey, valuePayload, valueString, valueTag } from '../../machine/ts/machine/cpu/value';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT, HeapServiceRemarkHeadField } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap, createTestHeapServiceCpu } from '../helpers/heap_service_system';

const path = 'kernel/gc_table_mode', probe = 'test/gc_table_mode', entrySource = 'halt_until_irq';
const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
const probeSource = `module<const>
local mode<const> = require('${path}')
local invoke<const> = function(control, meta, key, limit, result)
	local pending<const>, tag<const>, payload<const>, work<const> = mode.probe_table_mode(control, meta, key, limit)
	local output<const>: *u32 = ${RAM_BASE} + result
	output[0] = tag
	output[1] = payload
	output[2] = work
	return pending
end
return { invoke = invoke }
`;
const modules = [{ path, source }, { path: probe, source: probeSource }]
	.map(module => ({ ...module, chunk: parseLuaChunk(module.source, module.path) }));
const MODE_REMAINING = GC_MODE_NODE + 4;

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const { slotName } = object.sections.rodata.moduleExports.find(entry => entry.path === probe && entry.exportPathKey === 'invoke')!;
	const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[slotName]);
	assert.ok(index >= 0);
	const { valueSlots, frames } = deriveBlua32FixedStack(linked.image, [index]);
	assert.ok(valueSlots <= HEAP_SERVICE_VALUE_COUNT && frames <= HEAP_SERVICE_FRAME_COUNT, `pinned stack: ${valueSlots} values, ${frames} frames`);
	const { cpu, memory } = createTestHeapServiceCpu(linked), oracle = createTestHeapServiceCpu(linked).cpu;
	runGuestToHalt(cpu, 10_000);
	runGuestToHalt(oracle, 10_000);
	const management = cpu.heapAllocator.managementOffset(), control = management + HEAP_GC_CONTROL_OFFSET;
	const output = management + HEAP_SERVICE_THREAD_OFFSET - 12, floor = memory.ramBusEnd() - RAM_BASE;
	const modeKey = cpu.gc.diagnosticWord(HeapServiceRemarkHeadField.Mode);
	assert.equal(modeKey, oracle.gc.diagnosticWord(HeapServiceRemarkHeadField.Mode));
	function compare(label: string) {
		const actual = memory.ramData().subarray(floor, output), expected = oracle.memory.ramData().subarray(floor, output);
		if (Buffer.compare(actual, expected) === 0) return;
		const offset = actual.findIndex((byte, i) => byte !== expected[i]);
		assert.equal(actual[offset], expected[offset], `${label}: RAM 0x${(floor + offset).toString(16)}`);
	}
	function add(create: (target: typeof cpu) => number) {
		const address = create(cpu);
		assert.notEqual(address, 0);
		assert.equal(create(oracle), address);
		return address;
	}
	function word(address: number, value: number) {
		memory.writeRamRecordWord(address, value);
		oracle.memory.writeRamRecordWord(address, value);
	}
	function byte(address: number, value: number) {
		memory.writeRamRecordByte(address, value);
		oracle.memory.writeRamRecordByte(address, value);
	}
	function setMeta(table: number, address: number) {
		cpu.gc.tables.setMetatableAddress(table, address);
		oracle.gc.tables.setMetatableAddress(table, address);
	}
	function table(hash: number) {
		const address = add(target => target.createTable(0, hash));
		const words = cpu.gc.tables.hashAddress(address), tags = words + 8 * hash, links = tags + 2 * hash;
		const home = hashCanonicalTableKey(valueString(modeKey)) & (hash - 1);
		function node(slot: number, keyTag: ValueTag, keyWord: number, tag: ValueTag, payload: number, next: number) {
			word(words + 4 * slot, keyWord);
			byte(tags + slot, keyTag);
			word(words + 4 * (slot + hash), payload);
			byte(tags + slot + hash, tag);
			if (hash <= 128) byte(links + slot, next);
			else word(links + 4 * slot, next);
		}
		return { address, home, node };
	}
	function setCursor(meta: number, node: number, remaining: number) {
		word(control + GC_MODE_META, meta);
		word(control + GC_MODE_NODE, node);
		word(control + MODE_REMAINING, remaining);
	}
	function cursor() {
		return [memory.readRamRecordWord(control + GC_MODE_META),
			memory.readRamRecordWord(control + GC_MODE_NODE), memory.readRamRecordWord(control + MODE_REMAINING)];
	}
	function begin(receiver: number, limit: number) {
		const address = oracle.gc.tableRecordAddress(oracle.gc.tables.metatableAddress(receiver));
		const mode = oracle.gc['probeTableMode'](receiver, limit), pending = +(mode < 0);
		const { value, work } = oracle.gc['modeProbe'];
		const result = pending || !address ? [pending, ValueTag.Nil, 0, work] : [pending, valueTag(value), valuePayload(value), work];
		assert.ok(cpu.beginHeapService(linked.image.functions[index].address, [control, address, modeKey, limit, output]));
		return { result, mode };
	}
	function grant(cycles: number) {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		assert.ok(cpu.instructionBudgetRemaining < cycles);
		return cycles - cpu.instructionBudgetRemaining;
	}
	function finish(cycles = 64) {
		let elapsed = 0;
		for (let i = 0; i < 2048 && cpu.heapServiceActive(); ++i) elapsed += grant(cycles);
		assert.equal(cpu.heapServiceActive(), false);
		return { result: [cpu.heapServiceResult(), memory.readRamRecordWord(output),
			memory.readRamRecordWord(output + 4), memory.readRamRecordWord(output + 8)], elapsed };
	}
	function check(receiver: number, limit: number, mode: number, expected: number[]) {
		const native = begin(receiver, limit);
		assert.deepEqual(native, { mode, result: expected });
		assert.deepEqual(finish().result, expected);
		compare(`probe allowance ${limit}`);
	}
	return { cpu, modeKey, add, table, setMeta, setCursor, cursor, begin, grant, finish, compare, check };
}

for (const optLevel of [0, 3] as const) {
	test(`BLua own __mode probe resumes byte and word collision chains at O${optLevel}`, () => {
		const { modeKey, add, table, setMeta, cursor, check } = fixture(optLevel);
		const receiver = table(0).address;
		const value = add(target => target.stringPool.intern('vk'));
		const other = add(target => target.stringPool.intern('__mode_other'));
		for (const hash of [128, 256]) {
			const { address, home, node } = table(hash);
			setMeta(receiver, address);
			const next = (home + 1) & (hash - 1), last = (home + 2) & (hash - 1);
			node(home, ValueTag.Integer, modeKey, ValueTag.String, other, next);
			node(next, ValueTag.String, other, ValueTag.String, other, last);
			node(last, ValueTag.String, modeKey, ValueTag.String, value, -1);
			check(receiver, 0, -1, [1, ValueTag.Nil, 0, 0]);
			assert.deepEqual(cursor(), [address, home, hash]);
			check(receiver, 1, -1, [1, ValueTag.Nil, 0, 1]);
			assert.deepEqual(cursor(), [address, next, hash - 1]);
			check(receiver, 1, -1, [1, ValueTag.Nil, 0, 1]);
			assert.deepEqual(cursor(), [address, last, hash - 2]);
			check(receiver, 1, 3, [0, ValueTag.String, value, 1]);
			assert.deepEqual(cursor(), [0, 0, 0]);
		}
	});

	test(`BLua __mode probe preserves exact raw hits, signed stops and cursor exhaustion at O${optLevel}`, () => {
		const { modeKey, table, setMeta, setCursor, cursor, check } = fixture(optLevel);
		const receiver = table(0).address;
		for (const hash of [128, 256]) {
			const { address, home, node } = table(hash);
			const next = (home + 1) & (hash - 1);
			setMeta(receiver, address);
			node(home, ValueTag.String, modeKey, ValueTag.Nil, 0xf00df00d, next);
			node(next, ValueTag.String, modeKey, ValueTag.True, 0x80000000, -1);
			check(receiver, 15, 0, [0, ValueTag.Nil, 0xf00df00d, 1]);
			assert.deepEqual(cursor(), [0, 0, 0]);
			node(home, ValueTag.Integer, modeKey, ValueTag.True, 0, hash <= 128 ? -128 : -123456);
			check(receiver, 15, 0, [0, ValueTag.Nil, 0, 1]);
			node(home, ValueTag.Integer, modeKey, ValueTag.True, 0, home);
			setCursor(address, home, 0x80000000);
			check(receiver, 1, -1, [1, ValueTag.Nil, 0, 1]);
			assert.deepEqual(cursor(), [address, home, 0x7fffffff]);
			setCursor(address, home, 2);
			check(receiver, 15, 0, [0, ValueTag.Nil, 0, 2]);
			assert.deepEqual(cursor(), [0, 0, 0]);
		}
	});

	test(`BLua __mode probe discards old owner without inheriting its cursor at O${optLevel}`, () => {
		const { modeKey, table, setMeta, setCursor, cursor, check } = fixture(optLevel);
		const receiver = table(0).address;
		const previous = table(128), next = table(256);
		setCursor(previous.address, previous.home, 15);
		setMeta(receiver, next.address);
		next.node(next.home, ValueTag.String, modeKey, ValueTag.Float, 0x7ff000ad, -1);
		check(receiver, 1, 0, [0, ValueTag.Float, 0x7ff000ad, 1]);
		assert.deepEqual(cursor(), [0, 0, 0]);
		setCursor(previous.address, previous.home, 15);
		setMeta(receiver, table(0).address);
		check(receiver, 10, 0, [0, ValueTag.Nil, 0, 0]);
		assert.deepEqual(cursor(), [0, 0, 0]);
		setCursor(previous.address, previous.home, 15);
		setMeta(receiver, 0);
		check(receiver, 10, 0, [0, ValueTag.Nil, 0, 0]);
		assert.deepEqual(cursor(), [0, 0, 0]);
	});

	test(`BLua __mode probe restores between ordered cursor publications at O${optLevel}`, () => {
		const { cpu, modeKey, table, setMeta, setCursor, cursor, begin, grant, finish, compare, check } = fixture(optLevel);
		const receiver = table(0).address;
		const { address, home, node } = table(128);
		const next = (home + 1) & 127;
		setMeta(receiver, address);
		node(home, ValueTag.Integer, 33, ValueTag.True, 0, next);
		node(next, ValueTag.String, modeKey, ValueTag.Integer, 17, -1);
		setCursor(0, 0x33333333, 0x77777777);
		const native = begin(receiver, 1);
		for (let i = 0; i < 1024 && cursor()[0] === 0; ++i) grant(1);
		assert.equal(cpu.heapServiceActive(), true);
		assert.deepEqual(cursor(), [address, 0x33333333, 0x77777777]);
		const checkpoint = captureCpuCheckpoint(cpu);
		const finished = finish(1);
		assert.deepEqual(finished.result, native.result);
		assert.deepEqual(cursor(), [address, next, 127]);
		compare('ordered mode suspend');
		restoreCpuCheckpoint(cpu, checkpoint);
		assert.deepEqual(cursor(), [address, 0x33333333, 0x77777777]);
		assert.deepEqual(finish(1), finished);
		compare('replayed mode suspend');
		check(receiver, 1, 0, [0, ValueTag.Integer, 17, 1]);
		assert.deepEqual(cursor(), [0, 0, 0]);
	});
}
