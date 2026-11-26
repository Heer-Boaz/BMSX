import {
	HEAP_SERVICE_BIOS_CALL_OFFSET, HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_GC_PROJECTION_OFFSET, HEAP_SERVICE_IRQ_FORWARD_OFFSET,
	HEAP_SERVICE_RECORD_OFFSET, HEAP_SERVICE_RECORD_CONTROL_OFFSET, HEAP_SERVICE_RESULT_OFFSET,
	HEAP_SERVICE_TABLE_GROWTH_OFFSET, HEAP_SERVICE_TABLE_GROWTH_RESULT_OFFSET,
	HEAP_SERVICE_TABLE_RESIZE_CONTEXT_OFFSET,
	HEAP_SERVICE_THREAD_OFFSET, HEAP_SERVICE_VALUE_COUNT, HEAP_SERVICE_VALUE_OFFSET,
} from '../../spec/bmsx/heap_service';
import { RAM_BASE } from '../../spec/bmsx/memory_map';
import type { GcHeap } from './gc_heap';
import { Thread } from './thread';
import { ThreadField } from './thread_record';

/** Pinned activation backing, outside the allocator and its GC object list. */
export class HeapService {
	public readonly thread: Thread;
	public readonly resultAddress: number;
	public readonly projectionAddress: number;
	public readonly biosCallAddress: number;
	public readonly irqForwardAddress: number;
	public readonly recordAddress: number;
	public readonly recordControlAddress: number;
	public readonly tableGrowthAddress: number;
	public readonly tableGrowthResultAddress: number;
	public readonly tableResizeContextAddress: number;

	public constructor(heap: GcHeap) {
		const memory = heap.memory;
		const management = RAM_BASE + heap.arena.managementOffset();
		const thread = management + HEAP_SERVICE_THREAD_OFFSET;
		this.resultAddress = management + HEAP_SERVICE_RESULT_OFFSET;
		this.projectionAddress = management + HEAP_SERVICE_GC_PROJECTION_OFFSET;
		this.biosCallAddress = management + HEAP_SERVICE_BIOS_CALL_OFFSET;
		this.irqForwardAddress = management + HEAP_SERVICE_IRQ_FORWARD_OFFSET;
		this.recordAddress = management + HEAP_SERVICE_RECORD_OFFSET;
		this.recordControlAddress = management + HEAP_SERVICE_RECORD_CONTROL_OFFSET;
		this.tableGrowthAddress = management + HEAP_SERVICE_TABLE_GROWTH_OFFSET;
		this.tableGrowthResultAddress = management + HEAP_SERVICE_TABLE_GROWTH_RESULT_OFFSET;
		this.tableResizeContextAddress = management + HEAP_SERVICE_TABLE_RESIZE_CONTEXT_OFFSET;
		this.thread = new Thread(heap);
		memory.writeRamRecordWord(thread + ThreadField.StackBlock, management + HEAP_SERVICE_VALUE_OFFSET);
		memory.writeRamRecordWord(thread + ThreadField.StackCapacity, HEAP_SERVICE_VALUE_COUNT);
		memory.writeRamRecordWord(thread + ThreadField.FrameBlock, management + HEAP_SERVICE_FRAME_OFFSET);
		memory.writeRamRecordWord(thread + ThreadField.FrameCapacity, HEAP_SERVICE_FRAME_COUNT);
		this.thread.bindAddress(thread);
		this.thread.bindStack();
		this.thread.reserveFrameViews(HEAP_SERVICE_FRAME_COUNT);
	}
}
