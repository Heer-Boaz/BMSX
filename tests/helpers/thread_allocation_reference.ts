import { writeLE32 } from '../../machine/ts/common/endian';
import { FRAME_CONTROL_BYTES } from '../../machine/ts/machine/cpu/call_state';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { gcPacedPhase } from '../../machine/ts/machine/cpu/gc_heap';
import { GC_OBJECT_PREFIX } from '../../machine/ts/machine/cpu/gc_object';
import { THREAD_HEAP_BYTES, THREAD_INITIAL_FRAMES, THREAD_INITIAL_VALUES, THREAD_RECORD_KIND, THREAD_STACK_SLOT_BYTES, ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { valueClosure, valueNil } from '../../machine/ts/machine/cpu/value';
import { RAM_RECORD_WORD_MASK } from '../../machine/ts/spec/bmsx/memory_map';

// Frozen native Thread constructor from 2d84747d2, for independent RAM and recovery comparison only.
function initializeThread(cpu: CPU, address: number, block: number, frameBlock: number, entry: number): void {
	const memory = cpu.memory, ram = memory.ramData(), offset = address & RAM_RECORD_WORD_MASK;
	const start = block & RAM_RECORD_WORD_MASK, control = frameBlock & RAM_RECORD_WORD_MASK;
	ram.fill(0, offset, offset + THREAD_HEAP_BYTES);
	writeLE32(ram, offset + ThreadField.Header, THREAD_RECORD_KIND | (cpu.gc.white() << 8));
	writeLE32(ram, offset + ThreadField.Entry, entry);
	writeLE32(ram, offset + ThreadField.StackBlock, block);
	writeLE32(ram, offset + ThreadField.FrameBlock, frameBlock);
	writeLE32(ram, offset + ThreadField.StackCapacity, THREAD_INITIAL_VALUES);
	writeLE32(ram, offset + ThreadField.FrameCapacity, THREAD_INITIAL_FRAMES);
	ram.fill(0, control, control + THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES);
	memory.invalidateRamWrite(control, THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES);
	memory.invalidateRamWrite(offset, THREAD_HEAP_BYTES);
	memory.ramWords.fill(0, start >>> 2, (start >>> 2) + THREAD_INITIAL_VALUES);
	ram.fill(0, start + THREAD_INITIAL_VALUES * 4, start + THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES);
	memory.invalidateRamWrite(start, THREAD_INITIAL_VALUES * 4);
	memory.invalidateRamWrite(start + THREAD_INITIAL_VALUES * 4, THREAD_INITIAL_VALUES);
}

export function allocateThreadRecordReference(cpu: CPU, entry: number): number {
	const { luaHeap: budget, heapAllocator: arena, gc } = cpu;
	const valueBytes = THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES;
	const frameBytes = THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES;
	const charged = THREAD_HEAP_BYTES + valueBytes + frameBytes;
	const root = entry === 0 ? valueNil() : valueClosure(entry);
	let recovery = budget.admit(charged, root);
	if (gcPacedPhase(gc.phase())) gc.assistBeforeReservation(charged + GC_OBJECT_PREFIX, root);
	for (;;) {
		const base = arena.allocate(THREAD_HEAP_BYTES + GC_OBJECT_PREFIX, false);
		if (base !== 0) {
			const values = arena.allocate(valueBytes, true);
			if (values !== 0) {
				const frames = arena.allocate(frameBytes, true);
				if (frames !== 0) {
					const address = base + GC_OBJECT_PREFIX;
					initializeThread(cpu, address, values, frames, entry);
					gc.publishObject(address);
					budget.resizeRecordCharge(0, charged);
					return address;
				}
				arena.free(values);
			}
			arena.free(base);
		}
		recovery = gc.recoverAllocation(recovery, root);
	}
}
