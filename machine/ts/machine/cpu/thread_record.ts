import type { Memory } from '../memory/memory';
import type { HeapAllocator } from './heap_allocator';
import { FRAME_COMPLETION, FRAME_CONTROL_BYTES, FRAME_EXCEPTION, FRAME_WINDOW_MASK, PROTECTED_CALL_BYTES, FrameField, frameExecutionBank } from './call_state';
import { MAIN_RAM_SIZE, RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import { writeLE32 } from '../../common/endian';
import { ValueSlots } from './value_slots';
import { BuiltinFunctionId } from '../../spec/blua32/builtin';
import { LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../spec/blua32/cop0';
import type { BuiltinArgsView, BuiltinResults } from './builtin_values';
import type { GcHeap } from './gc_heap';
import type { LuaHeap } from './lua_heap';
import * as Closure from './closure';
import * as Upvalue from './upvalue';
import { LuaExecutionError } from './errors';
import { ValueTag, valueBool, valueInteger } from './value';
import { integerOperand } from './value_arithmetic';

import { GC_OBJECT_PREFIX, GC_RECORD_LINK } from './gc_object';

// Main-RAM Thread header lanes also consumed by the raw capture datapath.
export const enum ThreadField {
	Header = 0, Gray = GC_RECORD_LINK, Status = 8, Resumer = 12, Entry = 16, StackTop = 20, StackBlock = 24, StackCapacity = 28,
	FrameCapacity = 32, ProtectedCapacity = 36, ErrorWord = 40, ErrorKind = 44, CallBase = 48, ReturnCount = 52,
	FrameDepth = 56, ProtectedDepth = 60, FrameBlock = 64, ProtectedBlock = 68,
}

export const enum ThreadStatus { New, Running, Normal, Suspended, Dead, Failed }
export const THREAD_HEAP_BYTES = 80;
export const THREAD_STACK_SLOT_BYTES = 5;
export const MAX_THREAD_VALUE_SLOTS = (MAIN_RAM_SIZE / THREAD_STACK_SLOT_BYTES) | 0;
export const THREAD_INITIAL_VALUES = 8;
export const THREAD_INITIAL_FRAMES = 2;
export const THREAD_RECORD_KIND = 4;
export const THREAD_CONTROL_COUNT_MASK = (1 << 18) - 1;
export class ThreadLayout {
	public block = 0;
	public offset = 0;
	public capacity = 0;
	public frames = 0;
	public continuations = 0;
	public depth = 0;
	public protectedDepth = 0;
	public top = 0;
	public frameBlock = 0;
	public frameOffset = 0;
	public protectedBlock = 0;
	public protectedOffset = 0;
}
/** Physical Thread stack/control datapaths. Host execution views do not own these words. */
export class ThreadRecords {
	private readonly layout = new ThreadLayout();
	private readonly values = new ValueSlots(0);
	public constructor(private readonly memory: Memory, private readonly arena: HeapAllocator, private readonly budget: LuaHeap) {}
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
	public initializeRecord(address: number, block: number, frameBlock: number, entry: number, white: number): void {
		const memory = this.memory, ram = memory.ramData(), offset = address & RAM_RECORD_WORD_MASK;
		const start = block & RAM_RECORD_WORD_MASK, control = frameBlock & RAM_RECORD_WORD_MASK;
		ram.fill(0, offset, offset + THREAD_HEAP_BYTES);
		writeLE32(ram, offset + ThreadField.Header, THREAD_RECORD_KIND | (white << 8));
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
		target.frameBlock = memory.readRamRecordWord(address + ThreadField.FrameBlock);
		target.frameOffset = target.frameBlock & RAM_RECORD_WORD_MASK;
		target.protectedBlock = memory.readRamRecordWord(address + ThreadField.ProtectedBlock);
		target.protectedOffset = target.protectedBlock & RAM_RECORD_WORD_MASK;
	}
	public frameAddress(layout: ThreadLayout, index: number): number {
		return layout.frameOffset + index * FRAME_CONTROL_BYTES;
	}
	public allocationBytes(address: number): number {
		const layout = this.layout;
		this.readLayout(address, layout);
		return this.arena.allocationBytes(address - GC_OBJECT_PREFIX)
			+ this.arena.allocationBytes(layout.block) + this.arena.allocationBytes(layout.frameBlock)
			+ (layout.protectedBlock !== 0 ? this.arena.allocationBytes(layout.protectedBlock) : 0);
	}
	public clearStackRange(layout: ThreadLayout, first: number, end: number): void {
		const count = end - first;
		if (layout.capacity > (MAIN_RAM_SIZE - layout.offset) / THREAD_STACK_SLOT_BYTES) {
			this.values.bindRam(this.memory, layout.offset, layout.capacity, false, true);
			this.values.clear(count, first);
			return;
		}
		const word = layout.offset + first * 4, tag = layout.offset + layout.capacity * 4 + first;
		this.memory.ramWords.fill(0, word >>> 2, (word + count * 4) >>> 2);
		this.memory.ramData().fill(0, tag, tag + count);
		this.memory.invalidateRamWrite(word, count * 4);
		this.memory.invalidateRamWrite(tag, count);
	}
	public replaceStack(address: number, block: number, capacity: number): void {
		// Sample the raw owner after allocation admission has completed.
		const memory = this.memory;
		const oldBlock = memory.readRamRecordWord(address + ThreadField.StackBlock);
		const oldCapacity = memory.readRamRecordWord(address + ThreadField.StackCapacity);
		const old = oldBlock & RAM_RECORD_WORD_MASK;
		const ram = memory.ramData(), start = block & RAM_RECORD_WORD_MASK;
		const kept = Math.min(oldCapacity, capacity), tags = start + capacity * 4;
		const oldTags = old + oldCapacity * 4;
		ram.copyWithin(start, old, old + kept * 4);
		ram.copyWithin(tags, oldTags, oldTags + kept);
		memory.ramWords.fill(0, (start >>> 2) + kept, (start >>> 2) + capacity);
		ram.fill(0, tags + kept, tags + capacity);
		memory.invalidateRamWrite(start, capacity * THREAD_STACK_SLOT_BYTES);
		memory.writeRamRecordPair(address + ThreadField.StackBlock, block, capacity);
		this.budget.replaceRecord(oldBlock, oldCapacity * THREAD_STACK_SLOT_BYTES, capacity * THREAD_STACK_SLOT_BYTES);
	}
	public replaceControls(address: number, field: ThreadField.FrameBlock | ThreadField.ProtectedBlock, block: number, capacity: number): void {
		const memory = this.memory, ram = memory.ramData(), offset = block & RAM_RECORD_WORD_MASK;
		const frames = field === ThreadField.FrameBlock;
		const stride = frames ? FRAME_CONTROL_BYTES : PROTECTED_CALL_BYTES;
		const capacityField = frames ? ThreadField.FrameCapacity : ThreadField.ProtectedCapacity;
		const depthField = frames ? ThreadField.FrameDepth : ThreadField.ProtectedDepth;
		const oldBlock = memory.readRamRecordWord(address + field);
		const old = oldBlock & RAM_RECORD_WORD_MASK;
		const oldCapacity = memory.readRamRecordWord(address + capacityField) & THREAD_CONTROL_COUNT_MASK;
		const occupied = (memory.readRamRecordWord(address + depthField) & THREAD_CONTROL_COUNT_MASK) * stride;
		ram.copyWithin(offset, old, old + occupied);
		ram.fill(0, offset + occupied, offset + capacity * stride);
		memory.invalidateRamWrite(offset, capacity * stride);
		memory.writeRamRecordWord(address + field, block);
		memory.writeRamRecordWord(address + capacityField, capacity);
		this.budget.replaceRecord(oldBlock, oldCapacity * stride, capacity * stride);
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
		let copied = 0;
		if (values !== layout.capacity) {
			const bytes = values * THREAD_STACK_SLOT_BYTES, block = this.arena.allocate(bytes, true);
			if (block !== 0) { this.replaceStack(address, block, values); copied += bytes; }
		}
		if (frames !== layout.frames) {
			const bytes = frames * FRAME_CONTROL_BYTES, block = this.arena.allocate(bytes, true);
			if (block !== 0) { this.replaceControls(address, ThreadField.FrameBlock, block, frames); copied += bytes; }
		}
		if (continuations !== layout.continuations) {
			const bytes = continuations * PROTECTED_CALL_BYTES, block = this.arena.allocate(bytes, true);
			if (block !== 0) { this.replaceControls(address, ThreadField.ProtectedBlock, block, continuations); copied += bytes; }
		}
		return copied;
	}
}
