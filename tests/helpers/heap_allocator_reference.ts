import { bindReferenceDlmalloc } from './native_heap/dlmalloc_wasm';
import type { HeapAllocator } from '../../machine/ts/machine/cpu/heap_allocator';
import type { Memory } from '../../machine/ts/machine/memory/memory';
import { RAM_BASE, RUNTIME_MANAGEMENT_SIZE } from '../../machine/ts/spec/bmsx/memory_map';

// Frozen native startup oracle. Production System firmware owns initialization.
export function resetAllocatorReference(memory: Memory, allocator: HeapAllocator, floorAddress: number): void {
	const management = allocator.managementOffset();
	memory.ramData().fill(0, management, management + RUNTIME_MANAGEMENT_SIZE);
	memory.invalidateRamWrite(management, RUNTIME_MANAGEMENT_SIZE);
	const floor = allocator.floorOffset(floorAddress);
	bindReferenceDlmalloc(memory, allocator.allocatorStateOffset()).reset(floor, management);
	memory.setRamBusEnd(RAM_BASE + floor);
}
