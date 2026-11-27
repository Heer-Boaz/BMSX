import { ThreadField, ThreadStatus, ThreadLayout } from '../../../machine/ts/machine/cpu/thread_record';
export { ThreadField, ThreadStatus, ThreadLayout };
import { ThreadRecords as PhysicalThreadRecords } from '../../../machine/ts/machine/cpu/thread_record';
import type { Memory } from '../../../machine/ts/machine/memory/memory';
import type { HeapAllocator } from './heap_allocator';
import { FRAME_COMPLETION, FRAME_CONTROL_BYTES, FRAME_EXCEPTION, FRAME_WINDOW_MASK, FrameField, frameExecutionBank, frameCaptureCount } from '../../../machine/ts/machine/cpu/call_state';
import { MAIN_RAM_SIZE, RAM_RECORD_WORD_MASK } from '../../../machine/ts/spec/bmsx/memory_map';
import { ValueSlots } from '../../../machine/ts/machine/cpu/value_slots';
import { BuiltinFunctionId } from '../../../machine/ts/spec/blua32/builtin';
import { LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../../machine/ts/spec/blua32/cop0';
import type { BuiltinArgsView, BuiltinResults } from '../../../machine/ts/machine/cpu/builtin_values';
import type { LuaHeap } from './lua_heap';
import * as Closure from '../../../machine/ts/machine/cpu/closure';
import * as Upvalue from '../../../machine/ts/machine/cpu/upvalue';
import { LuaExecutionError } from '../../../machine/ts/machine/cpu/errors';
import { ValueTag, valueBool, valueInteger } from '../../../machine/ts/machine/cpu/value';
import { integerOperand } from '../../../machine/ts/machine/cpu/value_arithmetic';

import { GC_OBJECT_PREFIX } from '../../../machine/ts/machine/cpu/gc_object';
export const THREAD_HEAP_BYTES = 80;
export const THREAD_STACK_SLOT_BYTES = 5;
export const MAX_THREAD_VALUE_SLOTS = (MAIN_RAM_SIZE / THREAD_STACK_SLOT_BYTES) | 0;
export const THREAD_INITIAL_VALUES = 8;
export const THREAD_INITIAL_FRAMES = 2;
export const THREAD_RECORD_KIND = 4;
export const THREAD_CONTROL_COUNT_MASK = (1 << 18) - 1;
export function invokeThreadDiagnostic(memory: Memory, values: ValueSlots, id: BuiltinFunctionId, args: BuiltinArgsView, out: BuiltinResults): void {
	const { registers, base, length } = args;
	if (length === 0 || registers.getTag(base) !== ValueTag.Thread)
		throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const thread = registers.getPayload(base);
	const depth = memory.readRamRecordWord(thread + ThreadField.FrameDepth) & THREAD_CONTROL_COUNT_MASK;
	if (id === BuiltinFunctionId.FrameCount) {
		out.push(valueInteger(depth));
		return;
	}

	if (length < 2) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const index = integerOperand(registers.get(base + 1)) >>> 0;
	if (index >= depth) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
	const frameBlock = memory.readRamRecordWord(thread + ThreadField.FrameBlock) & RAM_RECORD_WORD_MASK;
	const frame = frameBlock + index * FRAME_CONTROL_BYTES;
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
		const block = memory.readRamRecordWord(thread + ThreadField.StackBlock) & RAM_RECORD_WORD_MASK;
		const slots = memory.readRamRecordWord(thread + ThreadField.StackCapacity);
		values.bindRam(memory, block, slots);
		if (writing) values.set(slot, registers.get(base + 3));
		else out.push(values.get(slot));
	} else {
		const closure = memory.readRamRecordWord(frame + FrameField.Closure);
		if (operand >= frameCaptureCount(memory, closure)) throw new LuaExecutionError(LUA_FAULT_REASON_INVALID_ARGUMENT);
		const cell = Closure.captureAddress(memory, closure, operand);
		out.push(Upvalue.load(memory, cell));
	}
}

/** Physical Thread stack/control datapaths. Host execution views do not own these words. */
export class ThreadRecords extends PhysicalThreadRecords {
	private readonly layout = new ThreadLayout();
	private readonly values = new ValueSlots(0);
	public constructor(memory: Memory, private readonly arena: HeapAllocator, private readonly budget: LuaHeap) { super(memory); }
	public allocationBytes(address: number): number {
		const layout = this.layout;
		this.readLayout(address, layout);
		return this.arena.allocationBytes(address - GC_OBJECT_PREFIX)
			+ this.arena.allocationBytes(layout.block) + this.arena.allocationBytes(layout.frameBlock);
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
		if (layout.frames > 4 && layout.depth * 3 < layout.frames) {
			const next = layout.frames >>> 1, bytes = next * FRAME_CONTROL_BYTES;
			const used = layout.depth * FRAME_CONTROL_BYTES;
			const spare = layout.frameOffset + used;
			this.memory.ramData().fill(0, spare, layout.frameOffset + bytes);
			this.memory.invalidateRamWrite(spare, bytes - used);
			this.arena.shrinkBacking(layout.frameBlock, bytes);
			this.memory.writeRamRecordWord(address + ThreadField.FrameCapacity, next);
			this.budget.resizeRecordCharge(layout.frames * FRAME_CONTROL_BYTES, bytes);
			retained += bytes;
		}
		return retained;
	}
}
