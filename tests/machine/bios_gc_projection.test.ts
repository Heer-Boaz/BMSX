import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { valuePayload } from '../../machine/ts/machine/cpu/value';
import { MAPPED_BUS_DMA_MEMORY, MAPPED_BUS_MASTER_CPU, MAPPED_BUS_MASTER_DMA } from '../../machine/ts/machine/memory/bus_signals';
import {
	HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_GC_ARGUMENTS_OFFSET, HEAP_SERVICE_GC_PROJECTION_OFFSET, HEAP_SERVICE_ROOT_BANKS_OFFSET,
	HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_TRACE_QUANTUM_OFFSET, HEAP_SERVICE_VALUE_COUNT, HEAP_SERVICE_VALUE_OFFSET,
	HeapServiceGcArgumentField, HeapServiceProjection, HeapServiceTraceField,
} from '../../machine/ts/spec/bmsx/heap_service';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { deriveBlua32FixedStack } from '../../toolchain/ts/rompack/blua32_fixed_stack';
import { createTestSystemCpu, linkTestSystemBlua32 } from '../helpers/blua32';
import { captureCpuCheckpoint, restoreCpuCheckpoint, runGuestToHalt } from '../helpers/cpu_execution';
import { parseLuaChunk } from '../helpers/cpu_test_harness';
import { compileTestSystemWithHeap } from '../helpers/heap_service_system';

const path = 'test/gc_projection';
const entrySource = `local projection<const> = require('${path}')\nhalt_until_irq`;
const source = `module<const>
return {
	transfer = function(port, work_slot, replacement, acquire, release)
		local notify<const>: *word = port
		local notify_le<const>: *u32 = port
		local work<const>: *u32 = work_slot
		*notify = acquire
		local prior<const> = *work
		*work = replacement
		*notify_le = release
		return prior
	end,
	store_byte = function(port)
		local notify<const>: *u8 = port
		*notify = 0
	end,
}`;

function fixture(optLevel: 0 | 3) {
	const compiled = compileTestSystemWithHeap(parseLuaChunk(entrySource), [{ path, source, chunk: parseLuaChunk(source, path) }],
		{ entrySource, optLevel, programDomain: 'system' });
	const linked = linkTestSystemBlua32(compiled), object = encodeCompiledProgramObject(compiled);
	const entries = ['transfer', 'store_byte'].map(name => {
		const exported = object.sections.rodata.moduleExports.find(entry => entry.path === path && entry.exportPathKey === name);
		assert.ok(exported);
		const index = linked.symbols.metadata.functionIds.indexOf(object.link.symbols.exportProtoIdBySlot[exported.slotName]);
		assert.ok(index >= 0);
		const { valueSlots, frames } = deriveBlua32FixedStack(linked.image, [index]);
		assert.ok(valueSlots <= HEAP_SERVICE_VALUE_COUNT && frames <= HEAP_SERVICE_FRAME_COUNT);
		return linked.image.functions[index].address;
	});
	const { cpu, memory } = createTestSystemCpu(linked);
	runGuestToHalt(cpu, 10_000);
	const management = cpu.heapAllocator.managementOffset();
	return { cpu, memory, management, entries };
}

for (const optLevel of [0, 3] as const) {
	test(`Pinned projection publishes roots and transfers String work without a RAM store at O${optLevel}`, () => {
		const { cpu, memory, management, entries: [transfer] } = fixture(optLevel);
		const args = management + HEAP_SERVICE_GC_ARGUMENTS_OFFSET, roots = management + HEAP_SERVICE_ROOT_BANKS_OFFSET;
		const port = RAM_BASE + management + HEAP_SERVICE_GC_PROJECTION_OFFSET;
		const traceWork = management + HEAP_SERVICE_TRACE_QUANTUM_OFFSET + HeapServiceTraceField.PendingStringWork;
		const active = cpu.activeThread.address, occupied = cpu.heapAllocator.occupiedBytes();
		const pinned = management + HEAP_SERVICE_THREAD_OFFSET;
		assert.equal(memory.readRamRecordWord(pinned + ThreadField.StackBlock), RAM_BASE + management + HEAP_SERVICE_VALUE_OFFSET);
		assert.equal(memory.readRamRecordWord(pinned + ThreadField.StackCapacity), HEAP_SERVICE_VALUE_COUNT);

		cpu.stringPool.resumeMarkWork(9);
		memory.writeRamRecordWord(port, 0x12345678);
		for (const signals of [MAPPED_BUS_MASTER_CPU, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_MEMORY]) {
			const sequence = memory.readBusFaultSequence();
			memory.writeMappedBusU32LE(port, HeapServiceProjection.PublishRoots, signals);
			assert.notEqual(memory.readBusFaultSequence(), sequence);
			assert.equal(memory.readRamRecordWord(args + HeapServiceGcArgumentField.ActiveThread), 0);
		}

		assert.ok(cpu.beginHeapService(transfer, [port, RAM_BASE + traceWork, 17,
			HeapServiceProjection.PublishRoots, HeapServiceProjection.ReleaseStringWork]));
		for (let steps = 0; steps < 16 && memory.readRamRecordWord(args + HeapServiceGcArgumentField.ActiveThread) === 0; ++steps)
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordWord(traceWork), 9);
		assert.equal(memory.readRamRecordWord(roots + 4), active);
		assert.equal(memory.readRamRecordWord(args + HeapServiceGcArgumentField.ActiveThread), active);
		assert.equal(memory.readRamRecordWord(args + HeapServiceGcArgumentField.ModeKey), cpu.stringPool.intern('__mode'));
		assert.equal(memory.readRamRecordWord(args + HeapServiceGcArgumentField.NewIndexKey), valuePayload(cpu.gc.tables.newIndexKey));
		assert.equal(memory.readRamRecordWord(args + HeapServiceGcArgumentField.PendingTop), 0);
		assert.equal(memory.readRamRecordWord(pinned + ThreadField.FrameDepth), 1);
		assert.equal(cpu.stringPool.takeMarkWork(), 0);

		const borrowed = captureCpuCheckpoint(cpu);
		const finish = () => {
			assert.equal(cpu.runUntilDepth(0, 64), RunResult.Yielded);
			assert.equal(cpu.heapServiceActive(), false);
			assert.equal(cpu.heapServiceResult(), 9);
			assert.equal(memory.readRamRecordWord(port), 0x12345678);
			assert.equal(cpu.heapAllocator.occupiedBytes(), occupied);
			assert.equal(cpu.stringPool.takeMarkWork(), 17);
		};
		finish();
		restoreCpuCheckpoint(cpu, borrowed);
		finish();
	});
}

test('The heap projection selector rejects byte stores', () => {
	const { cpu, memory, management, entries: [, storeByte] } = fixture(0);
	const port = RAM_BASE + management + HEAP_SERVICE_GC_PROJECTION_OFFSET;
	memory.writeRamRecordWord(port, 0x12345678);
	assert.ok(cpu.beginHeapService(storeByte, [port]));
	assert.throws(() => cpu.runUntilDepth(0, 32), /Heap projection requires a word store/);
	assert.equal(memory.readRamRecordWord(port), 0x12345678);
});
