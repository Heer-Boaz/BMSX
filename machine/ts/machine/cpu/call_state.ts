import type { Thread } from './thread';
import type { Closure } from './closure';
import type { Blua32ExecutionImage, DecodedInstructionPage } from './execution_image';
import { ValueSlots } from './value_slots';
import { MAPPED_BUS_MASTER_CPU, type MappedBusSignals } from '../memory/bus_signals';

import { writeLE32 } from '../../common/endian';
import { MAIN_RAM_SIZE, RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import type { Memory } from '../memory/memory';

export const enum ProtectedCallKind {
	PCall,
	XPCallBody,
	XPCallHandler,
}

export const enum FrameField { Function = 0, CallSite = 4, OpenHead = 8, Protected = 12, Flags = 16 }
export const FRAME_CONTROL_BYTES = 20;
const FRAME_COMPLETION = 1;
const FRAME_EXCEPTION = 2;
const FRAME_NMI = 4;

export class CallFrame {
	public next: CallFrame | null = null;
	public readonly registers = new ValueSlots(0);
	public executionImage: Blua32ExecutionImage = null!;
	public decodedPage: DecodedInstructionPage | null = null;
	public decodedPageAddress = 0;
	public decodedPageBusSignals: MappedBusSignals = MAPPED_BUS_MASTER_CPU;
	/** Host translation admission for the next PC, not checkpoint state. */
	public compilationEntry = true;
	public pc = 0;
	public varargBase = 0;
	public varargCount = 0;
	public stackBase = 0;
	public stackCapacity = 0;
	public closure: Closure = null!;
	public returnBase = 0;
	public returnCount = 0;
	public top = 0;
	public controlOffset = 0;

	public constructor(public readonly thread: Thread, public previous: CallFrame | null, public readonly controlMemory: Memory) {}

	public bindControl(offset: number): void { this.controlOffset = offset & RAM_RECORD_WORD_MASK; }
	public initializeControl(fn: number, callSite: number, completion: boolean): void {
		const memory = this.controlMemory, ram = memory.ramData(), offset = this.controlOffset;
		writeLE32(ram, (offset + FrameField.Function) & RAM_RECORD_WORD_MASK, fn);
		writeLE32(ram, (offset + FrameField.CallSite) & RAM_RECORD_WORD_MASK, callSite);
		writeLE32(ram, (offset + FrameField.OpenHead) & RAM_RECORD_WORD_MASK, 0);
		writeLE32(ram, (offset + FrameField.Protected) & RAM_RECORD_WORD_MASK, -1);
		writeLE32(ram, (offset + FrameField.Flags) & RAM_RECORD_WORD_MASK, completion ? FRAME_COMPLETION : 0);
		const first = Math.min(FRAME_CONTROL_BYTES, MAIN_RAM_SIZE - offset);
		memory.invalidateRamWrite(offset, first);
		if (first !== FRAME_CONTROL_BYTES) memory.invalidateRamWrite(0, FRAME_CONTROL_BYTES - first);
	}
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
