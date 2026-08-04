import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';
import { BASE_CYCLES, OPCODE_COUNT, OpCode } from '../../spec/blua32/opcode';
import type { Closure } from './closure';
import type { Table } from './table';
import { ValueTag } from './value';

export type TableLoadInlineCache = {
	table: Table | null;
	version: number;
	valueTag: ValueTag;
	valueScalar: number;
	valueReference: Table | Closure | null;
};

export const DECODED_PAGE_SHIFT = 8;
export const DECODED_PAGE_WORDS = 1 << DECODED_PAGE_SHIFT;
export const DECODED_PAGE_MASK = DECODED_PAGE_WORDS - 1;

export const enum DecodedDispatchOp {
	FusedShlBxor = OPCODE_COUNT,
	FusedAddShl = OPCODE_COUNT + 1,
	FusedShrBxor = OPCODE_COUNT + 2,
}

export const DECODED_DISPATCH_OP_COUNT = OPCODE_COUNT + 3;

export const DECODED_DISPATCH_BASE_CYCLES = new Uint8Array(DECODED_DISPATCH_OP_COUNT);
DECODED_DISPATCH_BASE_CYCLES.set(BASE_CYCLES);
DECODED_DISPATCH_BASE_CYCLES[DecodedDispatchOp.FusedShlBxor] = BASE_CYCLES[OpCode.SHL];
DECODED_DISPATCH_BASE_CYCLES[DecodedDispatchOp.FusedAddShl] = BASE_CYCLES[OpCode.ADD];
DECODED_DISPATCH_BASE_CYCLES[DecodedDispatchOp.FusedShrBxor] = BASE_CYCLES[OpCode.SHR];

export function decodedDispatchOp(first: OpCode, second: OpCode): number {
	switch (first) {
		case OpCode.SHL:
			return second === OpCode.BXOR ? DecodedDispatchOp.FusedShlBxor : first;
		case OpCode.ADD:
			return second === OpCode.SHL ? DecodedDispatchOp.FusedAddShl : first;
		case OpCode.SHR:
			return second === OpCode.BXOR ? DecodedDispatchOp.FusedShrBxor : first;
		default:
			return first;
	}
}

export type DecodedInstructionPage = {
	widths: Uint8Array;
	ops: Uint8Array;
	dispatchOps: Uint8Array;
	a: Uint16Array;
	b: Uint16Array;
	c: Uint16Array;
	bx: Uint32Array;
	sbx: Int32Array;
	rkB: Int32Array;
	rkC: Int32Array;
	disp: Uint8Array;
	words: Uint32Array;
	tableCacheIndexes: Uint32Array;
};

export type Blua32ExecutionImage = {
	executionDomainId: ExecutionDomainId;
	irqFunctionAddress: number;
	functionTableAddress: number;
	functionCount: number;
	textAddress: number;
	textByteCount: number;
	constTags: Uint8Array;
	constScalars: Float64Array;
	globalSlots: Uint32Array;
	systemGlobalSlots: Uint32Array;
	decodedPages: DecodedInstructionPage[];
	decodedWordCount: number;
	tableLoadCaches: TableLoadInlineCache[];
};

export type Blua32FunctionRecordLatch = {
	image: Blua32ExecutionImage;
	address: number;
	codeAddress: number;
	codeByteCount: number;
	numParams: number;
	maxStack: number;
	flags: number;
	upvalueTableAddress: number;
	upvalueCount: number;
};

export function createDecodedInstructionPage(): DecodedInstructionPage {
	const page: DecodedInstructionPage = {
		widths: new Uint8Array(DECODED_PAGE_WORDS),
		ops: new Uint8Array(DECODED_PAGE_WORDS),
		dispatchOps: new Uint8Array(DECODED_PAGE_WORDS),
		a: new Uint16Array(DECODED_PAGE_WORDS),
		b: new Uint16Array(DECODED_PAGE_WORDS),
		c: new Uint16Array(DECODED_PAGE_WORDS),
		bx: new Uint32Array(DECODED_PAGE_WORDS),
		sbx: new Int32Array(DECODED_PAGE_WORDS),
		rkB: new Int32Array(DECODED_PAGE_WORDS),
		rkC: new Int32Array(DECODED_PAGE_WORDS),
		disp: new Uint8Array(DECODED_PAGE_WORDS),
		words: new Uint32Array(DECODED_PAGE_WORDS),
		tableCacheIndexes: new Uint32Array(DECODED_PAGE_WORDS),
	};
	page.widths.fill(1);
	page.ops.fill(OpCode.WIDE);
	page.dispatchOps.fill(OpCode.WIDE);
	return page;
}
