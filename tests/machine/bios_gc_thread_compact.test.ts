import { nativeHeapReference } from '../helpers/native_heap/reference';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRAME_CONTROL_BYTES, FrameField } from '../../machine/ts/machine/cpu/call_state';
import { type CPU, RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ThreadField, ThreadLayout } from '../../machine/ts/machine/cpu/thread_record';
import { RamHistory } from '../../machine/ts/machine/runtime/history/ram_history';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT, RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { GC_WORKSPACE_END } from '../helpers/firmware_heap_layout';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { bootManagedTestSystem, linkManagedTestSystem } from '../helpers/managed_system';
import { allocateThreadRecordReference } from '../helpers/thread_allocation_reference';

const PATH = 'kernel/gc_thread_compact';
const threadPadding = [[36, 0x91020001], [60, 0x91020002], [68, 0x91020003]] as const;

interface Shape {
	readonly values: number;
	readonly frames: number;
	readonly top: number;
	readonly windows: readonly (readonly [base: number, extent: number])[];
}

function installThread(cpu: CPU, shape: Shape) {
	const { memory } = cpu, threads = nativeHeapReference(cpu).gc.threads;
	const thread = allocateThreadRecordReference(cpu, 0);
	assert.ok(threads.resizeStackBacking(thread, shape.values));
	const frames = threads.growFrameBacking(thread, shape.frames);
	assert.ok(frames);
	const values = memory.readRamRecordWord(thread + ThreadField.StackBlock);
	for (let index = 0; index < shape.values; ++index) {
		memory.writeRamRecordWord(values + index * 4, 0x13570000 | index);
		memory.writeRamRecordByte(values + shape.values * 4 + index, 0x70 ^ index);
	}
	for (let offset = 0; offset < shape.frames * FRAME_CONTROL_BYTES; offset += 4)
		memory.writeRamRecordWord(frames + offset, 0x54a80000 | offset);
	for (const [index, [base, extent]] of shape.windows.entries()) {
		memory.writeRamRecordWord(frames + index * FRAME_CONTROL_BYTES + FrameField.StackBase, base | 0x80000000);
		memory.writeRamRecordWord(frames + index * FRAME_CONTROL_BYTES + FrameField.StackCapacity, extent | 0x40000000);
	}
	memory.writeRamRecordWord(thread + ThreadField.StackTop, shape.top | 0xe0000000);
	memory.writeRamRecordWord(thread + ThreadField.FrameDepth, shape.windows.length | 0x80000000);
	for (const [offset, word] of threadPadding) memory.writeRamRecordWord(thread + offset, word);
	return { thread, values, frames };
}

for (const optLevel of [0, 3] as const) test(`BLua Thread shrink matches physical RAM and resumes in both planes at O${optLevel}`, () => {
	const linked = linkManagedTestSystem('halt_until_irq', optLevel);
	const { object } = linked;
	const exported = object.sections.rodata.moduleExports.find(entry => entry.path === PATH && entry.exportPathKey === 'shrink_stack');
	assert.ok(exported);
	const entry = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
	assert.ok(entry >= 0);
	const { valueSlots, frames: stackFrames } = deriveBlua32FixedStack(linked.layout, [entry]);
	assert.ok(valueSlots <= CPU_FIXED_VALUE_COUNT && stackFrames <= CPU_FIXED_FRAME_COUNT);
	const { cpu, memory } = bootManagedTestSystem(linked);
	const oracle = bootManagedTestSystem(linked).cpu;
	runGuestToHalt(cpu, 1_000_000);
	runGuestToHalt(oracle, 1_000_000);
	const first = memory.ramBusEnd() - RAM_BASE;
	const last = nativeHeapReference(cpu).heapAllocator.managementOffset() + GC_WORKSPACE_END;
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
		{ shape: { values: 66, frames: 10, top: 3, windows: [[0, 4], [3, 6]] },
			retained: 33 * 5 + 5 * FRAME_CONTROL_BYTES,
			debit: 33 * 5 + 5 * FRAME_CONTROL_BYTES },
		// The second window, not StackTop, reaches exactly one third of the Value plane.
		{ shape: { values: 66, frames: 6, top: 1, windows: [[0, 1], [17, 5]] }, retained: 0, debit: 0 },
		{ shape: { values: 16, frames: 4, top: 0, windows: [] }, retained: 0, debit: 0 },
		{ shape: { values: 16, frames: 7, top: 9, windows: [[0, 9]] },
			retained: 3 * FRAME_CONTROL_BYTES, debit: 4 * FRAME_CONTROL_BYTES },
	] as const;
	for (const [index, { shape, retained, debit }] of cases.entries()) {
		const target = installThread(cpu, shape);
		assert.deepEqual(installThread(oracle, shape), target);
		compare();
		const before = nativeHeapReference(cpu).luaHeap.usedBytes();
		const layout = new ThreadLayout();
		nativeHeapReference(oracle).gc.threads.readLayout(target.thread, layout);
		assert.equal(nativeHeapReference(oracle).gc.threads.shrinkStack(target.thread, layout), retained);
		assert.ok(cpu.beginHeapService(linked.layout.functions[entry].address,
			[nativeHeapReference(cpu).heapAllocator.allocatorStateOffset(), nativeHeapReference(cpu).luaHeap.occupiedOffset, target.thread]));
		if (index === 0) {
			const history = new RamHistory();
			history.start(memory);
			const baseline = history.capture(memory, null);
			const delivery = target.values + 33 * 4;
			const copied = memory.readRamRecordWord(target.values + 66 * 4);
			const tags = observeRewrite(delivery, delivery + 4, copied);
			assert.equal(memory.readRamRecordWord(target.thread + ThreadField.StackCapacity), 66);
			assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), before);
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
		assert.equal(nativeHeapReference(cpu).luaHeap.usedBytes(), before - debit);
		for (const [offset, word] of threadPadding) assert.equal(memory.readRamRecordWord(target.thread + offset), word);
		for (let frame = 0; frame < shape.windows.length; ++frame) {
			const offset = frame * FRAME_CONTROL_BYTES + 12;
			assert.equal(memory.readRamRecordWord(target.frames + offset), 0x54a80000 | offset);
		}
		compare();
	}
});
