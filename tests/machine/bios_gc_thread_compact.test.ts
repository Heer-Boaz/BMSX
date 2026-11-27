import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { FRAME_CONTROL_BYTES, FrameField, PROTECTED_CALL_BYTES } from '../../machine/ts/machine/cpu/call_state';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ThreadField, ThreadLayout } from '../../machine/ts/machine/cpu/thread_record';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT } from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap, createTestHeapServiceCpu } from '../helpers/heap_service_system';

const PATH = 'kernel/gc_thread_compact';
const entrySource = 'halt_until_irq';
const modules = ['kernel/dlmalloc', PATH].map(path => {
	const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
	return { path, source, chunk: parseLuaChunk(source, path) };
});

interface Shape {
	readonly values: number;
	readonly frames: number;
	readonly protectedFrames: number;
	readonly top: number;
	readonly windows: readonly (readonly [base: number, extent: number])[];
	readonly protectedDepth: number;
}

function installThread(cpu: CPU, shape: Shape) {
	const { memory } = cpu, threads = cpu.gc.threads;
	const thread = cpu.createThread(0);
	assert.ok(threads.resizeStackBacking(thread, shape.values));
	const frames = threads.growControls(thread, ThreadField.FrameBlock, shape.frames);
	const protectedBlock = shape.protectedFrames === 0 ? 0
		: threads.growControls(thread, ThreadField.ProtectedBlock, shape.protectedFrames);
	assert.ok(frames);
	if (shape.protectedFrames !== 0) assert.ok(protectedBlock);
	const values = memory.readRamRecordWord(thread + ThreadField.StackBlock);
	for (let index = 0; index < shape.values; ++index) {
		memory.writeRamRecordWord(values + index * 4, 0x13570000 | index);
		memory.writeRamRecordByte(values + shape.values * 4 + index, 0x70 ^ index);
	}
	for (let offset = 0; offset < shape.frames * FRAME_CONTROL_BYTES; offset += 4)
		memory.writeRamRecordWord(frames + offset, 0x54a80000 | offset);
	for (let offset = 0; offset < shape.protectedFrames * PROTECTED_CALL_BYTES; offset += 4)
		memory.writeRamRecordWord(protectedBlock + offset, 0x62b90000 | offset);
	for (const [index, [base, extent]] of shape.windows.entries()) {
		memory.writeRamRecordWord(frames + index * FRAME_CONTROL_BYTES + FrameField.StackBase, base | 0x80000000);
		memory.writeRamRecordWord(frames + index * FRAME_CONTROL_BYTES + FrameField.StackCapacity, extent | 0x40000000);
	}
	memory.writeRamRecordWord(thread + ThreadField.StackTop, shape.top | 0xe0000000);
	memory.writeRamRecordWord(thread + ThreadField.FrameDepth, shape.windows.length | 0x80000000);
	memory.writeRamRecordWord(thread + ThreadField.ProtectedDepth, shape.protectedDepth | 0x40000000);
	return { thread, values, frames, protectedBlock };
}

for (const optLevel of [0, 3] as const) test(`BLua Thread shrink matches physical RAM and resumes in both planes at O${optLevel}`, () => {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), modules, { entrySource, optLevel, programDomain: 'system' });
	const object = encodeCompiledProgramObject(compiled), linked = linkTestSystemBlua32(compiled);
	const exported = object.sections.rodata.moduleExports.find(entry => entry.path === PATH && entry.exportPathKey === 'shrink_stack');
	assert.ok(exported);
	const entry = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
	assert.ok(entry >= 0);
	const { valueSlots, frames: stackFrames } = deriveBlua32FixedStack(linked.image, [entry]);
	assert.ok(valueSlots <= HEAP_SERVICE_VALUE_COUNT && stackFrames <= HEAP_SERVICE_FRAME_COUNT);
	const { cpu, memory } = createTestHeapServiceCpu(linked);
	const oracle = createTestHeapServiceCpu(linked).cpu;
	runGuestToHalt(cpu, 10_000);
	runGuestToHalt(oracle, 10_000);
	const first = memory.ramBusEnd() - RAM_BASE;
	const last = cpu.heapAllocator.managementOffset() + HEAP_SERVICE_THREAD_OFFSET;
	const actual = () => memory.ramData().subarray(first, last);
	const expected = () => oracle.memory.ramData().subarray(first, last);
	const compare = () => {
		const left = actual(), right = expected();
		if (Buffer.compare(left, right) === 0) return;
		const index = left.findIndex((byte, index) => byte !== right[index]);
		assert.equal(left[index], right[index], `physical RAM differs at 0x${(first + index).toString(16)}`);
	};
	const grant = (cycles: number) => {
		assert.equal(cpu.runUntilDepth(0, cycles), RunResult.Yielded);
		const spent = cycles - cpu.instructionBudgetRemaining;
		assert.ok(spent > 0);
		return spent;
	};
	const finish = () => {
		let spent = 0;
		for (let count = 0; count < 256 && cpu.heapServiceActive(); ++count) spent += grant(128);
		assert.equal(cpu.heapServiceActive(), false);
		return spent;
	};
	const observeRewrite = (changed: number, next: number, replacement: number) => {
		const stale = memory.readRamRecordWord(next);
		assert.notEqual(memory.readRamRecordWord(changed), replacement);
		for (let count = 0; count < 4096 && memory.readRamRecordWord(changed) !== replacement; ++count) grant(1);
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordWord(changed), replacement);
		assert.equal(memory.readRamRecordWord(next), stale, 'the following store has not retired');
		return captureCpuCheckpoint(cpu);
	};
	const cases = [
		{ shape: { values: 66, frames: 10, protectedFrames: 8, top: 3, windows: [[0, 4], [3, 6]], protectedDepth: 1 },
			retained: 33 * 5 + 5 * FRAME_CONTROL_BYTES + 4 * PROTECTED_CALL_BYTES,
			debit: 33 * 5 + 5 * FRAME_CONTROL_BYTES + 4 * PROTECTED_CALL_BYTES },
		// The second window, not StackTop, reaches exactly one third of the Value plane.
		{ shape: { values: 66, frames: 6, protectedFrames: 6, top: 1, windows: [[0, 1], [17, 5]], protectedDepth: 2 }, retained: 0, debit: 0 },
		{ shape: { values: 16, frames: 4, protectedFrames: 0, top: 0, windows: [], protectedDepth: 0 }, retained: 0, debit: 0 },
		{ shape: { values: 16, frames: 7, protectedFrames: 5, top: 9, windows: [[0, 9]], protectedDepth: 1 },
			retained: 3 * FRAME_CONTROL_BYTES + 2 * PROTECTED_CALL_BYTES, debit: 4 * FRAME_CONTROL_BYTES + 3 * PROTECTED_CALL_BYTES },
	] as const;
	for (const [index, { shape, retained, debit }] of cases.entries()) {
		const target = installThread(cpu, shape);
		assert.deepEqual(installThread(oracle, shape), target);
		compare();
		const before = cpu.luaHeap.usedBytes();
		const layout = new ThreadLayout();
		oracle.gc.threads.readLayout(target.thread, layout);
		assert.equal(oracle.gc.threads.shrinkStack(target.thread, layout), retained);
		assert.ok(cpu.beginHeapService(linked.image.functions[entry].address,
			[cpu.heapAllocator.allocatorStateOffset(), cpu.luaHeap.occupiedOffset, target.thread]));
		if (index === 0) {
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			const delivery = target.values + 33 * 4;
			const copied = memory.readRamRecordWord(target.values + 66 * 4);
			const tags = observeRewrite(delivery, delivery + 4, copied);
			assert.equal(memory.readRamRecordWord(target.thread + ThreadField.StackCapacity), 66);
			assert.equal(cpu.luaHeap.usedBytes(), before);
			const spare = target.frames + shape.windows.length * FRAME_CONTROL_BYTES;
			const controls = observeRewrite(spare, spare + 4, 0);
			const controlsRam = history.capture(memory, baseline);
			assert.equal(memory.readRamRecordWord(target.thread + ThreadField.StackCapacity), 33);
			assert.equal(memory.readRamRecordWord(target.thread + ThreadField.FrameCapacity), 10);
			const spent = finish();
			compare();
			const completedRam = history.capture(memory, controlsRam);
			history.restore(memory, completedRam, controlsRam);
			cpu.restoreRuntimeState(controls.cpu);
			assert.equal(memory.readRamRecordWord(spare), 0);
			assert.notEqual(memory.readRamRecordWord(spare + 4), 0);
			assert.equal(finish(), spent);
			compare();
			restoreCpuCheckpoint(cpu, tags);
			assert.ok(finish() > spent);
		} else finish();
		assert.equal(cpu.heapServiceResult(), retained);
		assert.equal(cpu.luaHeap.usedBytes(), before - debit);
		compare();
	}
});
