import { heapAllocationBytes } from '../../machine/ts/machine/cpu/heap_allocator';
import { valueInteger } from '../../machine/ts/machine/cpu/value';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { runCompletionClosure } from './cpu_test_harness';

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
			reservedBytes += heapAllocationBytes(bytes);
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
