import type { Memory } from '../memory/memory';
import type { HeapAllocator } from './heap_allocator';
import { heapAllocationBytes } from './heap_allocator';
import { FRAME_COMPLETION, FRAME_CONTROL_BYTES, FRAME_EXCEPTION, FRAME_WINDOW_MASK, PROTECTED_CALL_BYTES, FrameField, frameExecutionBank } from './call_state';
import { MAIN_RAM_SIZE, RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import { writeLE32 } from '../../common/endian';
import { ValueSlots } from './value_slots';
import { BuiltinFunctionId } from '../../spec/blua32/builtin';
import { LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../spec/blua32/cop0';
import type { BuiltinArgsView, BuiltinResults } from './builtin_values';
import type { GcHeap } from './gc_heap';
import * as Closure from './closure';
import * as Upvalue from './upvalue';
import { LuaExecutionError } from './errors';
import { ValueTag, valueBool, valueInteger } from './value';
import { integerOperand } from './value_arithmetic';

import { GC_RECORD_LINK } from './gc_object';

// Main-RAM Thread header lanes also consumed by the raw capture datapath.
export const enum ThreadField {
	Header = 0, Gray = GC_RECORD_LINK, Status = 8, Resumer = 12, Entry = 16, StackTop = 20, StackBlock = 24, StackCapacity = 28,
	FrameCapacity = 32, ProtectedCapacity = 36, ErrorWord = 40, ErrorKind = 44, CallBase = 48, ReturnCount = 52,
	FrameDepth = 56, ProtectedDepth = 60,
}

export const enum ThreadStatus { New, Running, Normal, Suspended, Dead, Failed }
export const THREAD_HEAP_BYTES = 64;
export const THREAD_STACK_SLOT_BYTES = 5;
export const THREAD_INITIAL_VALUES = 8;
export const THREAD_INITIAL_FRAMES = 2;
export const THREAD_INITIAL_BACKING_BYTES = THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES + THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES;
export const THREAD_RECORD_KIND = 4;
export const THREAD_CONTROL_COUNT_MASK = (1 << 18) - 1;
export function controlOffset(values: number): number { return (values * THREAD_STACK_SLOT_BYTES + 3) & ~3; }
export function backingBytes(values: number, frames: number, continuations: number): number {
	return controlOffset(values) + frames * FRAME_CONTROL_BYTES + continuations * PROTECTED_CALL_BYTES;
}
export class ThreadLayout {
	public block = 0;
	public offset = 0;
	public capacity = 0;
	public frames = 0;
	public continuations = 0;
	public depth = 0;
	public protectedDepth = 0;
	public top = 0;
	public frameOffset = 0;
	public bytes = 0;
}
function copyStackControl(ram: Uint8Array, destination: number, source: number, bytes: number): void {
	if (bytes === 0) return;
	source &= RAM_RECORD_WORD_MASK;
	const first = Math.min(bytes, MAIN_RAM_SIZE - source);
	ram.copyWithin(destination, source, source + first);
	if (first !== bytes) ram.copyWithin(destination + first, 0, bytes - first);
}
/** Physical Thread stack/control datapaths. Host execution views do not own these words. */
export class ThreadRecords {
	private readonly layout = new ThreadLayout();
	private readonly values = new ValueSlots(0);
	public constructor(private readonly memory: Memory, private readonly arena: HeapAllocator) {}
	public invokeDiagnostic(heap: GcHeap, id: BuiltinFunctionId, args: BuiltinArgsView, out: BuiltinResults): void {
		const { registers, base, length } = args, memory = this.memory;
		if (length === 0 || registers.getTag(base) !== ValueTag.Thread)
			throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const thread = registers.getThread(base, heap);
		const depth = memory.readRamRecordWord(thread + ThreadField.FrameDepth) & THREAD_CONTROL_COUNT_MASK;
		if (id === BuiltinFunctionId.FrameCount) {
			out.push(valueInteger(depth));
			return;
		}

		if (length < 2) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const index = integerOperand(registers.get(base + 1)) >>> 0;
		if (index >= depth) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const layout = this.layout;
		this.readLayout(thread, layout);
		const frame = this.frameAddress(layout, index);
		if (id === BuiltinFunctionId.FrameHeader) {
			const flags = memory.readRamRecordWord(frame + FrameField.Flags);
			out.push(valueInteger(memory.readRamRecordWord(frame + FrameField.Function)));
			out.push(valueInteger(memory.readRamRecordWord(frame + FrameField.Pc)));
			out.push(valueInteger(memory.readRamRecordWord(frame + FrameField.CallSite)));
			out.push(valueBool((flags & FRAME_COMPLETION) !== 0));
			out.push(valueInteger(frameExecutionBank(flags) >>> 0));
			out.push(valueBool((flags & FRAME_EXCEPTION) !== 0));
			return;
		}

		const writing = id === BuiltinFunctionId.SetFrameRegister || id === BuiltinFunctionId.SetFrameUpvalue;
		if (length < (writing ? 4 : 3)) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const operand = integerOperand(registers.get(base + 2)) >>> 0;
		if (id === BuiltinFunctionId.GetFrameRegister || id === BuiltinFunctionId.SetFrameRegister) {
			const capacity = memory.readRamRecordWord(frame + FrameField.StackCapacity) & FRAME_WINDOW_MASK;
			if (operand >= capacity) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			const slot = (memory.readRamRecordWord(frame + FrameField.StackBase) & FRAME_WINDOW_MASK) + operand;
			this.values.bindRam(memory, layout.offset, layout.capacity);
			if (writing) this.values.set(slot, registers.get(base + 3));
			else out.push(this.values.get(slot));
		} else {
			const closure = memory.readRamRecordWord(frame + FrameField.Closure);
			if (operand >= Closure.captureCount(memory, closure)) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			const cell = Closure.captureAddress(memory, closure, operand);
			if (writing) Upvalue.store(heap, cell, registers.getTag(base + 3), registers.getPayload(base + 3));
			else out.push(Upvalue.load(memory, cell));
		}
	}
	public initializeRecord(address: number, entry: number, white: number): void {
		const memory = this.memory, ram = memory.ramData(), offset = address & RAM_RECORD_WORD_MASK;
		const block = memory.readRamRecordWord(address + ThreadField.StackBlock), start = block & RAM_RECORD_WORD_MASK;
		ram.fill(0, offset, offset + THREAD_HEAP_BYTES);
		writeLE32(ram, offset + ThreadField.Header, THREAD_RECORD_KIND | (white << 8));
		writeLE32(ram, offset + ThreadField.Entry, entry);
		writeLE32(ram, offset + ThreadField.StackBlock, block);
		writeLE32(ram, offset + ThreadField.StackCapacity, THREAD_INITIAL_VALUES);
		writeLE32(ram, offset + ThreadField.FrameCapacity, THREAD_INITIAL_FRAMES);
		const control = start + controlOffset(THREAD_INITIAL_VALUES);
		ram.fill(0, control, control + THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES);
		memory.invalidateRamWrite(control, THREAD_INITIAL_FRAMES * FRAME_CONTROL_BYTES);
		memory.invalidateRamWrite(offset, THREAD_HEAP_BYTES);
		memory.ramWords.fill(0, start >>> 2, (start >>> 2) + THREAD_INITIAL_VALUES);
		ram.fill(0, start + THREAD_INITIAL_VALUES * 4, start + THREAD_INITIAL_VALUES * THREAD_STACK_SLOT_BYTES);
		memory.invalidateRamWrite(start, THREAD_INITIAL_VALUES * 4);
		memory.invalidateRamWrite(start + THREAD_INITIAL_VALUES * 4, THREAD_INITIAL_VALUES);
	}
	public readLayout(address: number, target: ThreadLayout): void {
		const memory = this.memory;
		target.block = memory.readRamRecordWord(address + ThreadField.StackBlock);
		target.offset = target.block & RAM_RECORD_WORD_MASK;
		target.capacity = memory.readRamRecordWord(address + ThreadField.StackCapacity);
		target.frames = memory.readRamRecordWord(address + ThreadField.FrameCapacity) & THREAD_CONTROL_COUNT_MASK;
		target.continuations = memory.readRamRecordWord(address + ThreadField.ProtectedCapacity) & THREAD_CONTROL_COUNT_MASK;
		target.depth = memory.readRamRecordWord(address + ThreadField.FrameDepth) & THREAD_CONTROL_COUNT_MASK;
		target.protectedDepth = memory.readRamRecordWord(address + ThreadField.ProtectedDepth) & THREAD_CONTROL_COUNT_MASK;
		target.top = memory.readRamRecordWord(address + ThreadField.StackTop) & FRAME_WINDOW_MASK;
		target.frameOffset = controlOffset(target.capacity);
		target.bytes = backingBytes(target.capacity, target.frames, target.continuations);
	}
	public frameAddress(layout: ThreadLayout, index: number): number {
		return layout.offset + layout.frameOffset + index * FRAME_CONTROL_BYTES;
	}
	public backingByteLength(address: number): number {
		this.readLayout(address, this.layout);
		return this.layout.bytes;
	}
	public allocationBytes(address: number): number { return THREAD_HEAP_BYTES + heapAllocationBytes(this.backingByteLength(address)); }
	public clearUnused(layout: ThreadLayout, liveTop: number): void {
		const count = layout.capacity - liveTop;
		if (count <= 0) return;
		if (layout.capacity > (MAIN_RAM_SIZE - layout.offset) / THREAD_STACK_SLOT_BYTES) {
			this.values.bindRam(this.memory, layout.offset, layout.capacity, false, true);
			this.values.clear(count, liveTop);
			return;
		}
		const word = layout.offset + liveTop * 4, tag = layout.offset + layout.capacity * 4 + liveTop;
		this.memory.ramWords.fill(0, word >>> 2, (word + count * 4) >>> 2);
		this.memory.ramData().fill(0, tag, tag + count);
		this.memory.invalidateRamWrite(word, count * 4);
		this.memory.invalidateRamWrite(tag, count);
	}
	public replaceStack(address: number, block: number, capacity: number, frames: number, continuations: number): void {
		// Admission can collect and relocate aliased geometry. Sample after it returns.
		const old = this.layout;
		this.readLayout(address, old);
		const memory = this.memory, ram = memory.ramData(), start = block & RAM_RECORD_WORD_MASK;
		const kept = Math.min(old.capacity, capacity), tags = start + capacity * 4;
		for (let index = 0; index < kept; ++index) {
			writeLE32(ram, start + index * 4, memory.readRamRecordWord(old.offset + index * 4));
			ram[tags + index] = memory.readRamRecordByte(old.offset + old.capacity * 4 + index);
		}
		memory.ramWords.fill(0, (start >>> 2) + kept, (start >>> 2) + capacity);
		ram.fill(0, tags + kept, tags + capacity);
		memory.invalidateRamWrite(start, capacity * THREAD_STACK_SLOT_BYTES);
		const records = start + controlOffset(capacity), protectedRecords = records + frames * FRAME_CONTROL_BYTES;
		const frameBytes = Math.min(old.depth, old.frames, frames) * FRAME_CONTROL_BYTES;
		const occupied = Math.min(old.protectedDepth, old.continuations, continuations) * PROTECTED_CALL_BYTES;
		copyStackControl(ram, records, this.frameAddress(old, 0), frameBytes);
		copyStackControl(ram, protectedRecords, this.frameAddress(old, old.frames), occupied);
		ram.fill(0, start + capacity * THREAD_STACK_SLOT_BYTES, records);
		ram.fill(0, records + frameBytes, protectedRecords);
		ram.fill(0, protectedRecords + occupied, start + backingBytes(capacity, frames, continuations));
		memory.invalidateRamWrite(start + capacity * THREAD_STACK_SLOT_BYTES, backingBytes(capacity, frames, continuations) - capacity * THREAD_STACK_SLOT_BYTES);
		const descriptor = (address + ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
		writeLE32(ram, descriptor, block); writeLE32(ram, descriptor + 4, capacity);
		writeLE32(ram, descriptor + 8, frames); writeLE32(ram, descriptor + 12, continuations);
		memory.invalidateRamWrite(descriptor, 16);
		this.arena.free(old.block);
	}
	public shrinkStack(address: number, layout: ThreadLayout): number {
		let used = layout.top;
		for (let index = 0; index < layout.depth; ++index) {
			const frame = this.frameAddress(layout, index);
			used = Math.max(used, (this.memory.readRamRecordWord(frame + FrameField.StackBase) & FRAME_WINDOW_MASK)
				+ (this.memory.readRamRecordWord(frame + FrameField.StackCapacity) & FRAME_WINDOW_MASK));
		}
		const continuations = layout.continuations > 4 && layout.protectedDepth * 3 < layout.continuations ? layout.continuations >>> 1 : layout.continuations;
		const values = layout.capacity > 16 && used * 3 < layout.capacity ? layout.capacity >>> 1 : layout.capacity;
		const frames = layout.frames > 4 && layout.depth * 3 < layout.frames ? layout.frames >>> 1 : layout.frames;
		if (values === layout.capacity && continuations === layout.continuations && frames === layout.frames) return 0;
		const bytes = backingBytes(values, frames, continuations), block = this.arena.allocate(bytes, true);
		if (block === 0) return 0;
		this.replaceStack(address, block, values, frames, continuations);
		return bytes;
	}
}
