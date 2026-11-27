import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { HEAP_STRING_MARK_WORK_OFFSET } from '../../machine/ts/machine/cpu/heap_allocator';
import { MAPPED_BUS_DMA_MEMORY, MAPPED_BUS_MASTER_CPU, MAPPED_BUS_MASTER_DMA } from '../../machine/ts/machine/memory/bus_signals';
import {
	HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_GC_PROJECTION_OFFSET, HEAP_SERVICE_PENDING_TOP_OFFSET, HEAP_SERVICE_ROOT_BANKS_OFFSET,
	HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_TRACE_QUANTUM_OFFSET, HEAP_SERVICE_VALUE_COUNT, HEAP_SERVICE_VALUE_OFFSET,
	HeapServiceProjection, HeapServiceTraceField,
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
local roots<const> = require('kernel/gc_root_inputs')
return {
	transfer = function(management, work_slot, replacement)
		local work<const>: *u32 = work_slot
		roots.publish(management)
		local prior<const> = *work
		*work = replacement
		roots.release_string_work(management)
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
	test(`The BIOS transfers String mark credit through resumable RAM writes at O${optLevel}`, () => {
		const { cpu, memory, management, entries: [transfer] } = fixture(optLevel);
		const roots = management + HEAP_SERVICE_ROOT_BANKS_OFFSET, activeRoot = roots + 4;
		const port = RAM_BASE + management + HEAP_SERVICE_GC_PROJECTION_OFFSET;
		const traceWork = management + HEAP_SERVICE_TRACE_QUANTUM_OFFSET + HeapServiceTraceField.PendingStringWork;
		const markWork = management + HEAP_STRING_MARK_WORK_OFFSET;
		const active = cpu.activeThread.address, occupied = cpu.heapAllocator.occupiedBytes();
		const pinned = management + HEAP_SERVICE_THREAD_OFFSET;
		assert.equal(memory.readRamRecordWord(pinned + ThreadField.StackBlock), RAM_BASE + management + HEAP_SERVICE_VALUE_OFFSET);
		assert.equal(memory.readRamRecordWord(pinned + ThreadField.StackCapacity), HEAP_SERVICE_VALUE_COUNT);

		cpu.stringPool.resumeMarkWork(9);
		memory.writeRamRecordWord(traceWork, 4);
		memory.writeRamRecordWord(port, 0x12345678);
		for (const signals of [MAPPED_BUS_MASTER_CPU, MAPPED_BUS_MASTER_DMA | MAPPED_BUS_DMA_MEMORY]) {
			const sequence = memory.readBusFaultSequence();
			memory.writeMappedBusU32LE(port, HeapServiceProjection.PublishRoots, signals);
			assert.notEqual(memory.readBusFaultSequence(), sequence);
			assert.equal(memory.readRamRecordWord(activeRoot), 0);
		}

		assert.ok(cpu.beginHeapService(transfer, [management, RAM_BASE + traceWork, 17]));
		for (let steps = 0; steps < 128 && memory.readRamRecordWord(markWork) !== 0; ++steps)
			assert.equal(cpu.runUntilDepth(0, 1), RunResult.Yielded);
		assert.ok(cpu.heapServiceActive());
		assert.equal(memory.readRamRecordWord(markWork), 0);
		assert.equal(memory.readRamRecordWord(traceWork), 4, 'save between clearing the old word and publishing the borrowed credit');
		assert.equal(memory.readRamRecordWord(activeRoot), active);
		assert.equal(memory.readRamRecordWord(management + HEAP_SERVICE_PENDING_TOP_OFFSET), 0);

		const borrowed = captureCpuCheckpoint(cpu);
		const finish = () => {
			assert.equal(cpu.runUntilDepth(0, 256), RunResult.Yielded);
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
