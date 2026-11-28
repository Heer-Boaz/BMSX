import { nativeHeapReference } from './native_heap/reference';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { LuaAllocationMode } from './native_heap/lua_heap';
import { TableHeader, TableRecords } from '../../machine/ts/machine/cpu/table';
import { valueNil } from '../../machine/ts/machine/cpu/value';

/** The independent native Table constructor; production reaches the BIOS. */
export function createReferenceTable(cpu: CPU, arraySize = 0, hashSize = 0): number {
	const { luaHeap, gc } = nativeHeapReference(cpu);
	const hashCapacity = TableRecords.hashCapacity(hashSize);
	const address = luaHeap.allocateRecord(TableRecords.HEADER_BYTES, true, 5 * arraySize,
		TableHeader.ArrayStorage, valueNil(), valueNil(), valueNil(), TableRecords.HEADER_CHARGE + TableRecords.allocationCharge(arraySize, hashCapacity),
		LuaAllocationMode.Direct, TableRecords.hashStorageBytes(hashCapacity), TableHeader.HashStorage);
	gc.tables.initialize(address, arraySize, hashCapacity);
	gc.publishObject(address);
	return address;
}

/** Reference measurement after collecting the supplied operands. */
export function collectReferenceHeapBytes(cpu: CPU, root0 = valueNil(), root1 = valueNil(), root2 = valueNil()): number {
	nativeHeapReference(cpu).gc.collect(root0, root1, root2);
	return cpu.luaHeap.usedBytes();
}
