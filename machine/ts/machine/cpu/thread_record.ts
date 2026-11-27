import type { Memory } from '../memory/memory';
import type { HeapAllocator } from './heap_allocator';
import { FRAME_COMPLETION, FRAME_CONTROL_BYTES, FRAME_EXCEPTION, FRAME_WINDOW_MASK, PROTECTED_CALL_BYTES, FrameField, frameExecutionBank, frameCaptureCount } from './call_state';
import { MAIN_RAM_SIZE, RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
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

		const writing = id === BuiltinFunctionId.SetFrameRegister;
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
			if (operand >= frameCaptureCount(memory, closure)) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
			const cell = Closure.captureAddress(memory, closure, operand);
			out.push(Upvalue.load(memory, cell));
		}
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
	public resizeStackBacking(address: number, capacity: number): boolean {
		const memory = this.memory;
		const old = memory.readRamRecordWord(address + ThreadField.StackBlock);
		const previous = memory.readRamRecordWord(address + ThreadField.StackCapacity);
		const bytes = capacity * THREAD_STACK_SLOT_BYTES;
		const block = capacity > previous ? this.arena.resizeBacking(old, bytes) : old;
		if (block === 0) return false;
		const ram = memory.ramData(), offset = block & RAM_RECORD_WORD_MASK;
		const oldTags = offset + previous * 4, tags = offset + capacity * 4, kept = Math.min(previous, capacity);
		ram.copyWithin(tags, oldTags, oldTags + kept);
		if (capacity > previous) {
			ram.fill(0, oldTags, tags);
			ram.fill(0, tags + previous, offset + bytes);
		}
		memory.invalidateRamWrite(offset + kept * 4, bytes - kept * 4);
		if (capacity < previous) this.arena.shrinkBacking(old, bytes);
		memory.writeRamRecordPair(address + ThreadField.StackBlock, block, capacity);
		this.budget.resizeRecordCharge(previous * THREAD_STACK_SLOT_BYTES, bytes);
		return true;
	}
	public growControls(address: number, field: ThreadField.FrameBlock | ThreadField.ProtectedBlock, capacity: number, staged = 0): number {
		const memory = this.memory, ram = memory.ramData();
		const frames = field === ThreadField.FrameBlock;
		const stride = frames ? FRAME_CONTROL_BYTES : PROTECTED_CALL_BYTES;
		const capacityField = frames ? ThreadField.FrameCapacity : ThreadField.ProtectedCapacity;
		const depthField = frames ? ThreadField.FrameDepth : ThreadField.ProtectedDepth;
		const oldBlock = memory.readRamRecordWord(address + field);
		const bytes = capacity * stride;
		const block = staged || (oldBlock !== 0 ? this.arena.resizeBacking(oldBlock, bytes) : this.arena.allocate(bytes, true));
		if (block === 0) return 0;
		const offset = block & RAM_RECORD_WORD_MASK, old = oldBlock & RAM_RECORD_WORD_MASK;
		const oldCapacity = memory.readRamRecordWord(address + capacityField) & THREAD_CONTROL_COUNT_MASK;
		const occupied = (memory.readRamRecordWord(address + depthField) & THREAD_CONTROL_COUNT_MASK) * stride;
		if (staged !== 0) ram.copyWithin(offset, old, old + occupied);
		ram.fill(0, offset + occupied, offset + capacity * stride);
		const dirty = staged !== 0 ? 0 : occupied;
		memory.invalidateRamWrite(offset + dirty, bytes - dirty);
		memory.writeRamRecordWord(address + field, block);
		memory.writeRamRecordWord(address + capacityField, capacity);
		if (staged !== 0) this.arena.free(oldBlock);
		this.budget.resizeRecordCharge(oldCapacity * stride, bytes);
		return block;
	}
	private shrinkControls(address: number, field: ThreadField.FrameCapacity | ThreadField.ProtectedCapacity,
		block: number, capacity: number, depth: number, stride: number): number {
		if (capacity <= 4 || depth * 3 >= capacity) return 0;
		const next = capacity >>> 1, bytes = next * stride;
		const start = block & RAM_RECORD_WORD_MASK, spare = start + depth * stride;
		this.memory.ramData().fill(0, spare, start + bytes);
		this.memory.invalidateRamWrite(spare, bytes - depth * stride);
		this.arena.shrinkBacking(block, bytes);
		this.memory.writeRamRecordWord(address + field, next);
		this.budget.resizeRecordCharge(capacity * stride, bytes);
		return bytes;
	}
	public shrinkStack(address: number, layout: ThreadLayout): number {
		let retained = 0;
		if (layout.capacity > 16) {
			let used = layout.top;
			for (let index = 0; index < layout.depth && used * 3 < layout.capacity; ++index) {
				const frame = this.frameAddress(layout, index);
				used = Math.max(used, (this.memory.readRamRecordWord(frame + FrameField.StackBase) & FRAME_WINDOW_MASK)
					+ (this.memory.readRamRecordWord(frame + FrameField.StackCapacity) & FRAME_WINDOW_MASK));
			}
			if (used * 3 < layout.capacity) {
				const next = layout.capacity >>> 1, bytes = next * THREAD_STACK_SLOT_BYTES;
				this.resizeStackBacking(address, next);
				retained = bytes;
			}
		}
		retained += this.shrinkControls(address, ThreadField.FrameCapacity, layout.frameBlock, layout.frames, layout.depth, FRAME_CONTROL_BYTES);
		retained += this.shrinkControls(address, ThreadField.ProtectedCapacity, layout.protectedBlock, layout.continuations,
			layout.protectedDepth, PROTECTED_CALL_BYTES);
		return retained;
	}
}
