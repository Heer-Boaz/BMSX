import {
	HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_FRAME_OFFSET, HEAP_SERVICE_NEWT_OFFSET, HEAP_SERVICE_NEWT_ASSIST_OFFSET, HEAP_SERVICE_RESULT_OFFSET,
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
	public readonly newTableAddress: number;
	public readonly newTableAssistAddress: number;

	public constructor(heap: GcHeap) {
		const memory = heap.memory;
		const management = RAM_BASE + heap.arena.managementOffset();
		const thread = management + HEAP_SERVICE_THREAD_OFFSET;
		this.resultAddress = management + HEAP_SERVICE_RESULT_OFFSET;
		this.newTableAddress = management + HEAP_SERVICE_NEWT_OFFSET;
		this.newTableAssistAddress = management + HEAP_SERVICE_NEWT_ASSIST_OFFSET;
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
