import { type CPU, CpuRunKind } from '../../../machine/ts/machine/cpu/cpu';
import { HeapAllocator } from './heap_allocator';
import { LuaHeap } from './lua_heap';
import { GcHeap } from './gc_heap';
import { StringPool } from './string_pool';

class NativeHeapReference {
	public runKind = CpuRunKind.Idle;
	public readonly heapAllocator: HeapAllocator;
	public readonly luaHeap: LuaHeap;
	public readonly stringPool: StringPool;
	public readonly gc: GcHeap;

	public constructor(cpu: CPU) {
		const memory = cpu.memory;
		this.heapAllocator = new HeapAllocator(memory);
		this.luaHeap = new LuaHeap(cpu, this.heapAllocator);
		this.stringPool = new StringPool(this.luaHeap, memory, this.heapAllocator);
		this.gc = new GcHeap(cpu, this.luaHeap, memory, this.heapAllocator);
	}
}

const references = new WeakMap<CPU, NativeHeapReference>();

/** Give an explicit fixture access to the old algorithms on the same raw RAM. */
export function nativeHeapReference(cpu: CPU): NativeHeapReference {
	let reference = references.get(cpu);
	if (reference === undefined) {
		reference = new NativeHeapReference(cpu);
		references.set(cpu, reference);
	}
	return reference;
}
