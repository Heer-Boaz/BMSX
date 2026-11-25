import type { Thread } from './thread';
import { CLOSURE_CAPTURE_WORDS, captureCount } from './closure';
import type { Blua32ExecutionImage, DecodedInstructionPage } from './execution_image';
import { ValueSlots } from './value_slots';

import { writeLE32 } from '../../common/endian';
import { MAIN_RAM_SIZE, RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import type { Memory } from '../memory/memory';
import type { GcHeap } from './gc_heap';
import { SYSTEM_EXECUTION_DOMAIN_ID, type ExecutionDomainId } from '../../spec/blua32/execution_domain';
import { decodeValueCount, encodeFixedValueCount } from '../../spec/blua32/opcode';

export const enum ProtectedCallKind {
	PCall,
	XPCallBody,
	XPCallHandler,
}

export const enum FrameField { Function = 0, CallSite = 4, OpenHead = 8, Protected = 12, Flags = 16, Pc = 20, VarargBase = 24, VarargCount = 28, ReturnBase = 32, ReturnCount = 36, Top = 40, Closure = 44, StackBase = 48, StackCapacity = 52 }
export type FrameExecutionTarget = { domain: ExecutionDomainId; functionAddress: number; pc: number };
export const FRAME_CONTROL_BYTES = 56;
export const FRAME_WINDOW_MASK = (MAIN_RAM_SIZE >>> 2) - 1;
export const CALL_RESULT_EXTEND_TOP = 0x80000000;
export const SINGLE_CALL_RESULT = CALL_RESULT_EXTEND_TOP | encodeFixedValueCount(1);
export const DISCARD_CALL_RESULT = CALL_RESULT_EXTEND_TOP | encodeFixedValueCount(0);
export function selectedCallResultCount(word: number, available: number): number {
	return decodeValueCount(word & ~CALL_RESULT_EXTEND_TOP, available);
}
export const FRAME_COMPLETION = 1;
export const FRAME_EXCEPTION = 2;
export const FRAME_NMI = 4;
const FRAME_BANK_CART = 1 << 3;
const FRAME_BANK_SECOND = 1 << 4;
const FRAME_BANK_MASK = FRAME_BANK_CART | FRAME_BANK_SECOND;
const FRAME_EXTEND_RESULT_TOP = 1 << 5;

export function frameExecutionBank(flags: number): ExecutionDomainId {
	return (flags & FRAME_BANK_CART) === 0 ? SYSTEM_EXECUTION_DOMAIN_ID : ((flags & FRAME_BANK_SECOND) >>> 4) as ExecutionDomainId;
}
function frameBankWord(domain: ExecutionDomainId): number {
	return domain === SYSTEM_EXECUTION_DOMAIN_ID ? 0 : FRAME_BANK_CART | (domain << 4);
}

export class CallFrame {
	public next: CallFrame | null = null;
	public readonly registers = new ValueSlots(0);
	public executionImage: Blua32ExecutionImage = null!;
	public decodedPage: DecodedInstructionPage | null = null;
	/** Host translation admission for the next PC, not checkpoint state. */
	public compilationEntry = true;
	public get stackBase(): number { return this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.StackBase) & FRAME_WINDOW_MASK; }
	public get stackCapacity(): number { return this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.StackCapacity) & FRAME_WINDOW_MASK; }
	public controlOffset = 0;

	public readonly controlMemory: Memory;
	public constructor(public readonly thread: Thread, public previous: CallFrame | null, heap: GcHeap) {
		this.controlMemory = heap.memory;
	}

	public get savedExecutionBank(): ExecutionDomainId {
		const flags = this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.Flags);
		return frameExecutionBank(flags);
	}
	public set savedExecutionBank(domain: ExecutionDomainId) {
		const bank = frameBankWord(domain);
		const address = this.controlOffset + FrameField.Flags;
		this.controlMemory.writeRamRecordWord(address, (this.controlMemory.readRamRecordWord(address) & ~FRAME_BANK_MASK) | bank);
	}

	public bindControl(offset: number): void { this.controlOffset = offset & RAM_RECORD_WORD_MASK; }
	public initializeControl(fn: number, pc: number, callSite: number, completion: boolean, domain: ExecutionDomainId,
		varargBase: number, varargCount: number, returnBase: number, returnCount: number, top: number, closureAddress: number, base: number, capacity: number): void {
		const memory = this.controlMemory, ram = memory.ramData(), offset = this.controlOffset;
		writeLE32(ram, (offset + FrameField.Function) & RAM_RECORD_WORD_MASK, fn);
		writeLE32(ram, (offset + FrameField.CallSite) & RAM_RECORD_WORD_MASK, callSite);
		writeLE32(ram, (offset + FrameField.OpenHead) & RAM_RECORD_WORD_MASK, 0);
		writeLE32(ram, (offset + FrameField.Protected) & RAM_RECORD_WORD_MASK, -1);
		const bank = frameBankWord(domain);
		const placement = (returnCount & CALL_RESULT_EXTEND_TOP) !== 0 ? FRAME_EXTEND_RESULT_TOP : 0;
		writeLE32(ram, (offset + FrameField.Flags) & RAM_RECORD_WORD_MASK, bank | placement | (completion ? FRAME_COMPLETION : 0));
		writeLE32(ram, (offset + FrameField.Pc) & RAM_RECORD_WORD_MASK, pc);
		writeLE32(ram, (offset + FrameField.VarargBase) & RAM_RECORD_WORD_MASK, varargBase);
		writeLE32(ram, (offset + FrameField.VarargCount) & RAM_RECORD_WORD_MASK, varargCount);
		writeLE32(ram, (offset + FrameField.ReturnBase) & RAM_RECORD_WORD_MASK, returnBase);
		writeLE32(ram, (offset + FrameField.ReturnCount) & RAM_RECORD_WORD_MASK, returnCount & ~CALL_RESULT_EXTEND_TOP);
		writeLE32(ram, (offset + FrameField.Top) & RAM_RECORD_WORD_MASK, top);
		writeLE32(ram, (offset + FrameField.Closure) & RAM_RECORD_WORD_MASK, closureAddress);
		writeLE32(ram, (offset + FrameField.StackBase) & RAM_RECORD_WORD_MASK, base);
		writeLE32(ram, (offset + FrameField.StackCapacity) & RAM_RECORD_WORD_MASK, capacity);
		this.registers.rebind(this.thread.stackRegisters, base, capacity);
		const first = Math.min(FRAME_CONTROL_BYTES, MAIN_RAM_SIZE - offset);
		memory.invalidateRamWrite(offset, first);
		if (first !== FRAME_CONTROL_BYTES) memory.invalidateRamWrite(0, FRAME_CONTROL_BYTES - first);
	}
	public growRegisterWindow(capacity: number): void {
		const memory = this.controlMemory, address = (this.controlOffset + FrameField.StackCapacity) & RAM_RECORD_WORD_MASK;
		writeLE32(memory.ramData(), address, (memory.readRamRecordWord(address) & ~FRAME_WINDOW_MASK) | capacity);
		const base = this.stackBase;
		this.registers.rebind(this.thread.stackRegisters, base, capacity);
		if (this === this.thread.currentFrame) this.thread.stackTop = base + capacity;
		memory.invalidateRamWrite(address, 4);
	}
	public get closureAddress(): number { return this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.Closure); }
	public set closureAddress(address: number) { this.controlMemory.writeRamRecordWord(this.controlOffset + FrameField.Closure, address); }
	public get closure(): number { return this.closureAddress; }
	public get captureCount(): number { return captureCount(this.controlMemory, this.closureAddress); }
	public captureAddress(index: number): number {
		return this.controlMemory.readRamRecordWord(this.closureAddress + CLOSURE_CAPTURE_WORDS + index * 4);
	}
	public get varargBase(): number { return this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.VarargBase) & FRAME_WINDOW_MASK; }
	public get varargCount(): number { return this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.VarargCount) & FRAME_WINDOW_MASK; }
	public get returnBase(): number { return this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.ReturnBase) & FRAME_WINDOW_MASK; }
	public get returnCount(): number {
		const count = this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.ReturnCount) & FRAME_WINDOW_MASK;
		const flags = this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.Flags);
		return (flags & FRAME_EXTEND_RESULT_TOP) !== 0 ? count | CALL_RESULT_EXTEND_TOP : count;
	}
	public setCallResultTop(end: number, word: number): void {
		if ((word & CALL_RESULT_EXTEND_TOP) === 0 || end > this.top) this.top = end;
	}
	public get top(): number { return this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.Top) & FRAME_WINDOW_MASK; }
	public set top(word: number) {
		const address = this.controlOffset + FrameField.Top;
		this.controlMemory.writeRamRecordWord(address, (this.controlMemory.readRamRecordWord(address) & ~FRAME_WINDOW_MASK) | word);
	}
	public get pc(): number { return this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.Pc); }
	public set pc(word: number) { this.controlMemory.writeRamRecordWord(this.controlOffset + FrameField.Pc, word); }
	public get functionAddress(): number { return this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.Function); }
	public set functionAddress(word: number) { this.controlMemory.writeRamRecordWord(this.controlOffset + FrameField.Function, word); }
	public get callSitePc(): number { return this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.CallSite); }
	public set callSitePc(word: number) { this.controlMemory.writeRamRecordWord(this.controlOffset + FrameField.CallSite, word); }
	public get openUpvalueHead(): number { return this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.OpenHead); }
	public set openUpvalueHead(word: number) { this.controlMemory.writeRamRecordWord(this.controlOffset + FrameField.OpenHead, word); }
	public get protectedContinuationIndex(): number { return this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.Protected) | 0; }
	public set protectedContinuationIndex(word: number) { this.controlMemory.writeRamRecordWord(this.controlOffset + FrameField.Protected, word); }
	public get returnToCompletionLatch(): boolean {
		return (this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.Flags) & FRAME_COMPLETION) !== 0;
	}
	public get isExceptionFrame(): boolean {
		return (this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.Flags) & FRAME_EXCEPTION) !== 0;
	}
	public get isNonMaskableExceptionFrame(): boolean {
		return (this.controlMemory.readRamRecordWord(this.controlOffset + FrameField.Flags) & FRAME_NMI) !== 0;
	}
	public enterException(nmi: boolean): void {
		const memory = this.controlMemory, address = this.controlOffset + FrameField.Flags;
		memory.writeRamRecordWord(address, memory.readRamRecordWord(address) | (FRAME_EXCEPTION | (nmi ? FRAME_NMI : 0)));
	}
}

export const enum ProtectedField { Flags = 0, Caller = 4, Base = 8, Wanted = 12, Handler = 16 }
export const PROTECTED_CALL_BYTES = 20;
export const PROTECTED_CALL_KIND_MASK = 0xff;
export const PROTECTED_CALL_PARENT = 1 << 8;
export const PROTECTED_CALL_HANDLER_BUILTIN = 1 << 9;
