import { nativeHeapReference } from './native_heap/reference';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { FRAME_CONTROL_BYTES } from '../../machine/ts/machine/cpu/call_state';
import { THREAD_HEAP_BYTES, THREAD_STACK_SLOT_BYTES, ThreadLayout } from '../../machine/ts/machine/cpu/thread_record';
import { RAM_RECORD_WORD_MASK } from '../../machine/ts/spec/bmsx/memory_map';
import { runCompletionClosure } from './cpu_test_harness';
import { HEAP_LOGICAL_OCCUPIED_OFFSET } from './firmware_heap_layout';

/** The guest budget charges the Thread record and capacities, not allocator overhead. */
export function logicalThreadBytes(cpu: CPU, address = cpu.rootThread.address): number {
	const layout = new ThreadLayout();
	nativeHeapReference(cpu).gc.threads.readLayout(address, layout);
	return THREAD_HEAP_BYTES + layout.capacity * THREAD_STACK_SLOT_BYTES
		+ layout.frames * FRAME_CONTROL_BYTES;
}

/** Count positive guest heap charges, including allocations collected within the measurement. */
export function profileWarmGuestKernel(cpu: CPU, kernel: number, iterations: number, budget = 10_000_000) {
	runCompletionClosure(cpu, kernel, [valueInteger(64)], budget);
	const heap = nativeHeapReference(cpu).luaHeap;
	nativeHeapReference(cpu).gc.collect();
	// Collection can shrink the stack below this kernel's peak. Warm its
	// call depth again before attributing any reservation to steady-state work.
	runCompletionClosure(cpu, kernel, [valueInteger(64)], budget);
	const retainedBefore = heap.usedBytes();
	const stackCapacityBefore = cpu.activeThread.stackRegisters.capacity();
	const { memory } = cpu;
	const occupied = nativeHeapReference(cpu).heapAllocator.managementOffset() + HEAP_LOGICAL_OCCUPIED_OFFSET;
	const writeWord = memory.writeRamRecordWord;
	let reservations = 0;
	let reservedBytes = 0;
	memory.writeRamRecordWord = function (address, word) {
		if ((address & RAM_RECORD_WORD_MASK) === occupied) {
			const charge = word - memory.readRamRecordWord(occupied);
			if (charge > 0) {
				++reservations;
				reservedBytes += charge;
			}
		}
		writeWord.call(memory, address, word);
	};
	let cycles: number;
	try {
		cycles = runCompletionClosure(cpu, kernel, [valueInteger(iterations)], budget);
	} finally {
		memory.writeRamRecordWord = writeWord;
	}
	return { iterations, cycles, reservations, reservedBytes, retainedBefore, retainedAfter: heap.usedBytes(),
		stackCapacityBefore, stackCapacityAfter: cpu.activeThread.stackRegisters.capacity() };
}
