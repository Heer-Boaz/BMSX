import {
	OBJECT_HANDLE_COUNT,
	OBJECT_HANDLE_ENTRY_SIZE,
	OBJECT_HANDLE_TABLE_BASE,
	GC_HEAP_BASE,
	GC_HEAP_SIZE,
} from './memory_map';
import { Memory } from './memory';

export const HEAP_OBJECT_HEADER_SIZE = 12;
export const STRING_OBJECT_HASH_LO_OFFSET = HEAP_OBJECT_HEADER_SIZE;
export const STRING_OBJECT_HASH_HI_OFFSET = STRING_OBJECT_HASH_LO_OFFSET + 4;
export const STRING_OBJECT_BYTE_LENGTH_OFFSET = STRING_OBJECT_HASH_HI_OFFSET + 4;
export const STRING_OBJECT_CODEPOINT_COUNT_OFFSET = STRING_OBJECT_BYTE_LENGTH_OFFSET + 4;
export const STRING_OBJECT_DATA_OFFSET = STRING_OBJECT_CODEPOINT_COUNT_OFFSET + 4;
export const STRING_OBJECT_HEADER_SIZE = STRING_OBJECT_DATA_OFFSET;
export const TABLE_OBJECT_METATABLE_ID_OFFSET = HEAP_OBJECT_HEADER_SIZE;
export const TABLE_OBJECT_ARRAY_STORE_ID_OFFSET = TABLE_OBJECT_METATABLE_ID_OFFSET + 4;
export const TABLE_OBJECT_HASH_STORE_ID_OFFSET = TABLE_OBJECT_ARRAY_STORE_ID_OFFSET + 4;
export const TABLE_OBJECT_ARRAY_LENGTH_OFFSET = TABLE_OBJECT_HASH_STORE_ID_OFFSET + 4;
export const TABLE_OBJECT_HEADER_SIZE = TABLE_OBJECT_ARRAY_LENGTH_OFFSET + 4;
export const ARRAY_STORE_OBJECT_CAPACITY_OFFSET = HEAP_OBJECT_HEADER_SIZE;
export const ARRAY_STORE_OBJECT_HEADER_SIZE = ARRAY_STORE_OBJECT_CAPACITY_OFFSET + 4;
export const ARRAY_STORE_OBJECT_DATA_OFFSET = ARRAY_STORE_OBJECT_HEADER_SIZE;
export const HASH_STORE_OBJECT_CAPACITY_OFFSET = HEAP_OBJECT_HEADER_SIZE;
export const HASH_STORE_OBJECT_FREE_OFFSET = HASH_STORE_OBJECT_CAPACITY_OFFSET + 4;
export const HASH_STORE_OBJECT_HEADER_SIZE = HASH_STORE_OBJECT_FREE_OFFSET + 4;
export const HASH_STORE_OBJECT_DATA_OFFSET = HASH_STORE_OBJECT_HEADER_SIZE;
export const CLOSURE_OBJECT_PROTO_INDEX_OFFSET = HEAP_OBJECT_HEADER_SIZE;
export const CLOSURE_OBJECT_UPVALUE_COUNT_OFFSET = CLOSURE_OBJECT_PROTO_INDEX_OFFSET + 4;
export const CLOSURE_OBJECT_UPVALUE_IDS_OFFSET = CLOSURE_OBJECT_UPVALUE_COUNT_OFFSET + 4;
export const CLOSURE_OBJECT_HEADER_SIZE = CLOSURE_OBJECT_UPVALUE_IDS_OFFSET;
export const NATIVE_OBJECT_METATABLE_ID_OFFSET = HEAP_OBJECT_HEADER_SIZE;
export const NATIVE_OBJECT_HEADER_SIZE = NATIVE_OBJECT_METATABLE_ID_OFFSET + 4;
export const UPVALUE_OBJECT_STATE_OFFSET = HEAP_OBJECT_HEADER_SIZE;
export const UPVALUE_OBJECT_FRAME_DEPTH_OFFSET = UPVALUE_OBJECT_STATE_OFFSET + 4;
export const UPVALUE_OBJECT_REGISTER_INDEX_OFFSET = UPVALUE_OBJECT_FRAME_DEPTH_OFFSET + 4;
export const UPVALUE_OBJECT_CLOSED_VALUE_OFFSET = UPVALUE_OBJECT_REGISTER_INDEX_OFFSET + 4;
export const UPVALUE_OBJECT_HEADER_SIZE = UPVALUE_OBJECT_CLOSED_VALUE_OFFSET + 12;
export const UPVALUE_OBJECT_STATE_CLOSED = 0;
export const UPVALUE_OBJECT_STATE_OPEN = 1;
export const TAGGED_VALUE_SLOT_TAG_OFFSET = 0;
export const TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET = TAGGED_VALUE_SLOT_TAG_OFFSET + 4;
export const TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET = TAGGED_VALUE_SLOT_PAYLOAD_LO_OFFSET + 4;
export const TAGGED_VALUE_SLOT_SIZE = TAGGED_VALUE_SLOT_PAYLOAD_HI_OFFSET + 4;
export const HASH_NODE_KEY_OFFSET = 0;
export const HASH_NODE_VALUE_OFFSET = HASH_NODE_KEY_OFFSET + TAGGED_VALUE_SLOT_SIZE;
export const HASH_NODE_NEXT_OFFSET = HASH_NODE_VALUE_OFFSET + TAGGED_VALUE_SLOT_SIZE;
export const HASH_NODE_SIZE = HASH_NODE_NEXT_OFFSET + 4;

export enum HeapObjectType {
	String = 1,
	Table = 2,
	ArrayStore = 3,
	HashStore = 4,
	Closure = 5,
	NativeFunction = 6,
	NativeObject = 7,
	Upvalue = 8,
}

export enum TaggedValueTag {
	Nil = 0,
	False = 1,
	True = 2,
	Number = 3,
	String = 4,
	Table = 5,
	Closure = 6,
	NativeFunction = 7,
	NativeObject = 8,
	Upvalue = 9,
}

export type ObjectHandleEntry = {
	addr: number;
	sizeBytes: number;
	type: number;
	flags: number;
	reserved: number;
};

export type ObjectAllocation = {
	id: number;
	addr: number;
	sizeBytes: number;
	type: number;
	flags: number;
};

export type ObjectHandleTableState = {
	nextHandle: number;
	heapUsedBytes: number;
	handleTableBytes: Uint8Array;
	heapBytes: Uint8Array;
};

class ObjectHeap {
	private cursor = GC_HEAP_BASE;

	public allocate(sizeBytes: number): number {
		const addr = this.cursor;
		const next = addr + sizeBytes;
		if (next > GC_HEAP_BASE + GC_HEAP_SIZE) {
			throw new Error(`[ObjectHeap] Out of heap memory (size=${sizeBytes}).`);
		}
		this.cursor = next;
		return addr;
	}

	public reset(): void {
		this.cursor = GC_HEAP_BASE;
	}

	public usedBytes(): number {
		return this.cursor - GC_HEAP_BASE;
	}

	public restore(usedBytes: number): void {
		this.cursor = GC_HEAP_BASE + usedBytes;
	}
}

export class ObjectHandleTable {
	private readonly heap: ObjectHeap;
	private nextHandle = 1;

	constructor(private readonly memory: Memory) {
		this.heap = new ObjectHeap();
	}

	public reserveHandles(minHandle: number): void {
		if (minHandle > OBJECT_HANDLE_COUNT) {
			throw new Error(`[ObjectHandleTable] Reserve exceeds handle capacity: ${minHandle}.`);
		}
		if (minHandle > this.nextHandle) {
			this.nextHandle = minHandle;
		}
	}

	public allocateObject(type: number, sizeBytes: number, flags: number = 0): ObjectAllocation {
		if (this.nextHandle >= OBJECT_HANDLE_COUNT) {
			throw new Error('[ObjectHandleTable] Out of object handles.');
		}
		const addr = this.heap.allocate(sizeBytes);
		this.writeHeapHeader(addr, type, flags, sizeBytes);
		const id = this.nextHandle;
		this.writeEntry(id, addr, sizeBytes, type, flags, 0);
		this.nextHandle += 1;
		return {
			id,
			addr,
			sizeBytes,
			type,
			flags,
		};
	}

	public writeU32(addr: number, value: number): void {
		this.memory.writeU32(addr, value);
	}

	public readU32(addr: number): number {
		return this.memory.readU32(addr);
	}

	public writeBytes(addr: number, bytes: Uint8Array): void {
		this.memory.writeBytes(addr, bytes);
	}

	public readBytes(addr: number, sizeBytes: number): Uint8Array {
		return this.memory.readBytes(addr, sizeBytes);
	}

	public writeEntry(id: number, addr: number, sizeBytes: number, type: number, flags: number, reserved: number): void {
		const entryAddr = OBJECT_HANDLE_TABLE_BASE + id * OBJECT_HANDLE_ENTRY_SIZE;
		this.memory.writeU32(entryAddr, addr);
		this.memory.writeU32(entryAddr + 4, sizeBytes);
		this.memory.writeU32(entryAddr + 8, type);
		this.memory.writeU32(entryAddr + 12, flags);
		this.memory.writeU32(entryAddr + 16, reserved);
	}

	public readEntry(id: number): ObjectHandleEntry {
		const entryAddr = OBJECT_HANDLE_TABLE_BASE + id * OBJECT_HANDLE_ENTRY_SIZE;
		return {
			addr: this.memory.readU32(entryAddr),
			sizeBytes: this.memory.readU32(entryAddr + 4),
			type: this.memory.readU32(entryAddr + 8),
			flags: this.memory.readU32(entryAddr + 12),
			reserved: this.memory.readU32(entryAddr + 16),
		};
	}

	public resetHeap(): void {
		this.heap.reset();
		this.nextHandle = 1;
	}

	public captureState(): ObjectHandleTableState {
		const nextHandle = this.nextHandle;
		const heapUsedBytes = this.heap.usedBytes();
		return {
			nextHandle,
			heapUsedBytes,
			handleTableBytes: this.memory.readBytes(OBJECT_HANDLE_TABLE_BASE, nextHandle * OBJECT_HANDLE_ENTRY_SIZE),
			heapBytes: this.memory.readBytes(GC_HEAP_BASE, heapUsedBytes),
		};
	}

	public restoreState(state: ObjectHandleTableState): void {
		this.memory.writeBytes(OBJECT_HANDLE_TABLE_BASE, state.handleTableBytes);
		this.memory.writeBytes(GC_HEAP_BASE, state.heapBytes);
		this.nextHandle = state.nextHandle;
		this.heap.restore(state.heapUsedBytes);
	}

	private writeHeapHeader(addr: number, type: number, flags: number, sizeBytes: number): void {
		this.memory.writeU32(addr, type);
		this.memory.writeU32(addr + 4, flags);
		this.memory.writeU32(addr + 8, sizeBytes);
	}
}
