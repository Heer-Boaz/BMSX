import type { Memory } from '../memory/memory';
import { FRAME_COMPLETION, FRAME_CONTROL_BYTES, FRAME_EXCEPTION, FRAME_WINDOW_MASK, FrameField, frameExecutionBank, frameCaptureCount } from './call_state';
import { RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import { ValueSlots } from './value_slots';
import { BuiltinFunctionId } from '../../spec/blua32/builtin';
import { LUA_FAULT_REASON_INVALID_ARGUMENT } from '../../spec/blua32/cop0';
import type { BuiltinArgsView, BuiltinResults } from './builtin_values';
import * as Closure from './closure';
import * as Upvalue from './upvalue';
import { LuaExecutionError } from './errors';
import { ValueTag, valueBool, valueInteger } from './value';
import { integerOperand } from './value_arithmetic';

// Main-RAM Thread header lanes also consumed by the raw capture datapath.
export const enum ThreadField {
	Header = 0, Status = 8, Resumer = 12, Entry = 16, StackTop = 20, StackBlock = 24, StackCapacity = 28,
	FrameCapacity = 32, ErrorWord = 40, ErrorKind = 44, CallBase = 48, ReturnCount = 52,
	FrameDepth = 56, FrameBlock = 64,
}

export const enum ThreadStatus { New, Running, Normal, Suspended, Dead, Failed }
export const THREAD_HEAP_BYTES = 80;
export const THREAD_INITIAL_VALUES = 8;
export const THREAD_INITIAL_FRAMES = 2;
export const THREAD_RECORD_KIND = 4;
export const THREAD_CONTROL_COUNT_MASK = (1 << 18) - 1;
export class ThreadLayout {
	public block = 0;
	public offset = 0;
	public capacity = 0;
	public frames = 0;
	public depth = 0;
	public top = 0;
	public frameBlock = 0;
	public frameOffset = 0;
}
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
export class ThreadRecords {
	public constructor(protected readonly memory: Memory) {}
	public readLayout(address: number, target: ThreadLayout): void {
		const memory = this.memory;
		target.block = memory.readRamRecordWord(address + ThreadField.StackBlock);
		target.offset = target.block & RAM_RECORD_WORD_MASK;
		target.capacity = memory.readRamRecordWord(address + ThreadField.StackCapacity);
		target.frames = memory.readRamRecordWord(address + ThreadField.FrameCapacity) & THREAD_CONTROL_COUNT_MASK;
		target.depth = memory.readRamRecordWord(address + ThreadField.FrameDepth) & THREAD_CONTROL_COUNT_MASK;
		target.top = memory.readRamRecordWord(address + ThreadField.StackTop) & FRAME_WINDOW_MASK;
		target.frameBlock = memory.readRamRecordWord(address + ThreadField.FrameBlock);
		target.frameOffset = target.frameBlock & RAM_RECORD_WORD_MASK;
	}
	public frameAddress(layout: ThreadLayout, index: number): number {
		return layout.frameOffset + index * FRAME_CONTROL_BYTES;
	}
}
