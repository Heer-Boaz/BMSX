import type { Memory } from '../../../machine/ts/machine/memory/memory';
import { HEAP_PAGE_SIZE, RUNTIME_MANAGEMENT_SIZE } from '../../../machine/ts/spec/bmsx/memory_map';

export function stockHeapManagementOffset(memory: Memory): number {
	return (memory.ramByteCount() & ~(HEAP_PAGE_SIZE - 1)) - RUNTIME_MANAGEMENT_SIZE;
}
