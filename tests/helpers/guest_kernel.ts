import { valueInteger } from '../../machine/ts/machine/cpu/value';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { FRAME_CONTROL_BYTES, PROTECTED_CALL_BYTES } from '../../machine/ts/machine/cpu/call_state';
import { THREAD_HEAP_BYTES, THREAD_STACK_SLOT_BYTES, ThreadLayout } from '../../machine/ts/machine/cpu/thread_record';
import { runCompletionClosure } from './cpu_test_harness';

/** The guest budget charges the Thread record and capacities, not allocator overhead. */
export function logicalThreadBytes(cpu: CPU, address = cpu.rootThread.address): number {
	const layout = new ThreadLayout();
	cpu.gc.threads.readLayout(address, layout);
	return THREAD_HEAP_BYTES + layout.capacity * THREAD_STACK_SLOT_BYTES
		+ layout.frames * FRAME_CONTROL_BYTES + layout.continuations * PROTECTED_CALL_BYTES;
}

/** Count successful heap reservations, including allocate-then-collect churn. */
export function profileWarmGuestKernel(cpu: CPU, kernel: number, iterations: number, budget = 10_000_000) {
	runCompletionClosure(cpu, kernel, [valueInteger(64)], budget);
	const heap = cpu.luaHeap;
	cpu.collectTrackedHeapBytes();
	// Collection can shrink the stack below this kernel's peak. Warm its
	// call depth again before attributing any reservation to steady-state work.
	runCompletionClosure(cpu, kernel, [valueInteger(64)], budget);
	const retainedBefore = heap.usedBytes();
	const stackCapacityBefore = cpu.activeThread.stackRegisters.capacity();
	const arena = cpu.heapAllocator, allocate = arena.allocate;
	let reservations = 0;
	let reservedBytes = 0;
	arena.allocate = function (bytes, owned) {
		const address = allocate.call(arena, bytes, owned);
		if (address !== 0) {
			++reservations;
			reservedBytes += arena.allocationBytes(address);
		}
		return address;
	};
	let cycles: number;
	try {
		cycles = runCompletionClosure(cpu, kernel, [valueInteger(iterations)], budget);
	} finally {
		arena.allocate = allocate;
	}
	return { iterations, cycles, reservations, reservedBytes, retainedBefore, retainedAfter: heap.usedBytes(),
		stackCapacityBefore, stackCapacityAfter: cpu.activeThread.stackRegisters.capacity() };
}
