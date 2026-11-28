import { nativeHeapReference } from './native_heap/reference';
import { writeLE32 } from '../../machine/ts/common/endian';
import { FRAME_CONTROL_BYTES } from '../../machine/ts/machine/cpu/call_state';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { gcPacedPhase } from './native_heap/gc_heap';
import { GC_OBJECT_PREFIX } from '../../machine/ts/machine/cpu/gc_object';
import { LuaAllocationRecovery } from './native_heap/lua_heap';
import type { Thread } from '../../machine/ts/machine/cpu/thread';
import { THREAD_CONTROL_COUNT_MASK, THREAD_HEAP_BYTES, THREAD_INITIAL_FRAMES, THREAD_INITIAL_VALUES, THREAD_RECORD_KIND, THREAD_STACK_SLOT_BYTES, ThreadField } from '../../machine/ts/machine/cpu/thread_record';
import { valueClosure, valueNil, type Value } from '../../machine/ts/machine/cpu/value';
import { RAM_RECORD_WORD_MASK } from '../../machine/ts/spec/bmsx/memory_map';

export function resizeThreadStackReference(cpu: CPU, thread: Thread, capacity: number): void {
	const previous = thread.stackRegisters.capacity();
	if (capacity === previous) return;
	if (capacity < previous) nativeHeapReference(cpu).gc.threads.resizeStackBacking(thread.address, capacity);
	else reserveThreadStorageReference(cpu, thread.address, capacity, 0, valueNil());
	thread.bindStack();
}

export function reserveThreadFrameReference(cpu: CPU, thread: Thread, values: number): void {
	const current = thread.frameBackingBytes / FRAME_CONTROL_BYTES;
	const wanted = thread.frameDepth + 2;
	let frames = Math.max(THREAD_INITIAL_FRAMES, current);
	while (frames < wanted) frames *= 2;
	const valueChange = values === thread.stackRegisters.capacity() ? 0 : values;
	const frameChange = frames === current ? 0 : frames;
	if (valueChange === 0 && frameChange === 0) return;
	reserveThreadStorageReference(cpu, thread.address, valueChange, frameChange, valueNil());
	thread.bindStack();
}

function growFrameBacking(cpu: CPU, address: number, capacity: number, staged = 0): number {
	const { memory } = cpu, { heapAllocator: arena, luaHeap: budget } = nativeHeapReference(cpu), ram = memory.ramData();
	const oldBlock = memory.readRamRecordWord(address + ThreadField.FrameBlock);
	const bytes = capacity * FRAME_CONTROL_BYTES;
	const block = staged || (oldBlock !== 0 ? arena.resizeBacking(oldBlock, bytes) : arena.allocate(bytes, true));
	if (block === 0) return 0;
	const offset = block & RAM_RECORD_WORD_MASK, old = oldBlock & RAM_RECORD_WORD_MASK;
	const oldCapacity = memory.readRamRecordWord(address + ThreadField.FrameCapacity) & THREAD_CONTROL_COUNT_MASK;
	const occupied = (memory.readRamRecordWord(address + ThreadField.FrameDepth) & THREAD_CONTROL_COUNT_MASK) * FRAME_CONTROL_BYTES;
	if (staged !== 0) ram.copyWithin(offset, old, old + occupied);
	ram.fill(0, offset + occupied, offset + bytes);
	const dirty = staged !== 0 ? 0 : occupied;
	memory.invalidateRamWrite(offset + dirty, bytes - dirty);
	memory.writeRamRecordWord(address + ThreadField.FrameBlock, block);
	memory.writeRamRecordWord(address + ThreadField.FrameCapacity, capacity);
	if (staged !== 0) arena.free(oldBlock);
	budget.resizeRecordCharge(oldCapacity * FRAME_CONTROL_BYTES, bytes);
	return block;
}

/** A call can need both storage lanes. Acquire them before changing either raw descriptor. */
export function reserveThreadStorageReference(cpu: CPU, address: number, valueCapacity: number, frameCapacity: number, root: Value): void {
	const valueBytes = valueCapacity * THREAD_STACK_SLOT_BYTES;
	const frameBytes = frameCapacity * FRAME_CONTROL_BYTES;
	const { memory } = cpu, { luaHeap: budget, gc, heapAllocator: arena } = nativeHeapReference(cpu);
	const previousValues = valueCapacity !== 0 ? memory.readRamRecordWord(address + ThreadField.StackCapacity) * THREAD_STACK_SLOT_BYTES : 0;
	const previousFrames = frameCapacity !== 0
		? (memory.readRamRecordWord(address + ThreadField.FrameCapacity) & THREAD_CONTROL_COUNT_MASK) * FRAME_CONTROL_BYTES : 0;
	if (valueBytes === 0 && frameBytes !== 0) {
		let recovery = budget.admit(frameBytes - previousFrames, root, valueNil(), valueNil(), address);
		if (gcPacedPhase(gc.phase())) gc.assistBeforeReservation(frameBytes, root, valueNil(), valueNil(), address);
		while (growFrameBacking(cpu, address, frameCapacity) === 0)
			recovery = gc.recoverAllocation(recovery, root, valueNil(), valueNil(), address);
		return;
	}
	const requested = valueBytes + frameBytes, previous = previousValues + previousFrames;
	let recovery = requested > previous
		? budget.admit(requested - previous, root, valueNil(), valueNil(), address)
		: LuaAllocationRecovery.CurrentOrFresh;
	if (gcPacedPhase(gc.phase())) gc.assistBeforeReservation(requested, root, valueNil(), valueNil(), address);
	for (;;) {
		const frames = frameBytes === 0 ? 0 : arena.allocate(frameBytes, true);
		if (frameBytes === 0 || frames !== 0) {
			const threads = gc.threads;
			if (valueBytes === 0 || threads.resizeStackBacking(address, valueCapacity)) {
				if (frames !== 0) growFrameBacking(cpu, address, frameCapacity, frames);
				return;
			}
			if (frames !== 0) arena.free(frames);
		}
		recovery = gc.recoverAllocation(recovery, root, valueNil(), valueNil(), address);
	}
}

// Frozen native Thread constructor from 2d84747d2, for independent RAM and recovery comparison only.
function initializeThread(cpu: CPU, address: number, block: number, frameBlock: number, entry: number): void {
	const memory = cpu.memory, ram = memory.ramData(), offset = address & RAM_RECORD_WORD_MASK;
	const start = block & RAM_RECORD_WORD_MASK, control = frameBlock & RAM_RECORD_WORD_MASK;
	ram.fill(0, offset, offset + THREAD_HEAP_BYTES);
	writeLE32(ram, offset + ThreadField.Header, THREAD_RECORD_KIND | (cpu.gc.white() << 8));
	writeLE32(ram, offset + ThreadField.Entry, entry);
	writeLE32(ram, offset + ThreadField.StackBlock, block);
	writeLE32(ram, offset + ThreadField.FrameBlock, frameBlock);
	writeLE32(ram, offset + ThreadField.StackCapacity, THREAD_INITIAL_VALUES);
	writeLE32(ram, offset + ThreadField.FrameCapacity, THREAD_INITIAL_FRAMES);
	ram.fill(0, control, control + THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES);
	memory.invalidateRamWrite(control, THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES);
	memory.invalidateRamWrite(offset, THREAD_HEAP_BYTES);
	memory.ramWords.fill(0, start >>> 2, (start >>> 2) + THREAD_INITIAL_VALUES);
	ram.fill(0, start + THREAD_INITIAL_VALUES * 4, start + THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES);
	memory.invalidateRamWrite(start, THREAD_INITIAL_VALUES * 4);
	memory.invalidateRamWrite(start + THREAD_INITIAL_VALUES * 4, THREAD_INITIAL_VALUES);
}

export function allocateThreadRecordReference(cpu: CPU, entry: number): number {
	const { luaHeap: budget, heapAllocator: arena, gc } = nativeHeapReference(cpu);
	const valueBytes = THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES;
	const frameBytes = THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES;
	const charged = THREAD_HEAP_BYTES + valueBytes + frameBytes;
	const root = entry === 0 ? valueNil() : valueClosure(entry);
	let recovery = budget.admit(charged, root);
	if (gcPacedPhase(gc.phase())) gc.assistBeforeReservation(charged + GC_OBJECT_PREFIX, root);
	for (;;) {
		const base = arena.allocate(THREAD_HEAP_BYTES + GC_OBJECT_PREFIX, false);
		if (base !== 0) {
			const values = arena.allocate(valueBytes, true);
			if (values !== 0) {
				const frames = arena.allocate(frameBytes, true);
				if (frames !== 0) {
					const address = base + GC_OBJECT_PREFIX;
					initializeThread(cpu, address, values, frames, entry);
					gc.publishObject(address);
					budget.resizeRecordCharge(0, charged);
					return address;
				}
				arena.free(values);
			}
			arena.free(base);
		}
		recovery = gc.recoverAllocation(recovery, root);
	}
}
