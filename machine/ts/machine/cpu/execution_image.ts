import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';
import { BASE_CYCLES, OPCODE_COUNT, OpCode } from '../../spec/blua32/opcode';
import type { MappedBusSignals } from '../memory/bus_signals';
import { MAPPED_PAGE_BYTE_SHIFT } from '../memory/mapped_page';

export const DECODED_PAGE_SHIFT = MAPPED_PAGE_BYTE_SHIFT - 2;
export const DECODED_PAGE_WORDS = 1 << DECODED_PAGE_SHIFT;
export const DECODED_REFRESH_DECODE = 1;
export const DECODED_REFRESH_FUSION = 2;

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
	sourceWords: Uint32Array;
	bodyWords: Uint32Array;
	tableCacheSlots: Int32Array;
	refreshState: Uint8Array;
	cacheable: boolean;
	writeWatches: Uint8Array | null;
	writeWatchIndex: number;
};

export type Blua32ExecutionImage = {
	executionDomainId: ExecutionDomainId;
	irqFunctionAddress: number;
	constTags: Uint8Array;
	constScalars: Float64Array;
	globalSlots: Uint32Array;
	systemGlobalSlots: Uint32Array;
	decodedPages: Map<number, DecodedInstructionPage>;
};

export type Blua32FunctionRecordLatch = {
	image: Blua32ExecutionImage;
	busSignals: MappedBusSignals;
	address: number;
	codeAddress: number;
	numParams: number;
	maxStack: number;
	flags: number;
	upvalueTableAddress: number;
	upvalueCount: number;
};

export function createDecodedInstructionPage(
	cacheable: boolean,
	writeWatches: Uint8Array | null,
	writeWatchIndex: number,
): DecodedInstructionPage {
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
		sourceWords: new Uint32Array(DECODED_PAGE_WORDS),
		bodyWords: new Uint32Array(DECODED_PAGE_WORDS),
		tableCacheSlots: new Int32Array(DECODED_PAGE_WORDS),
		refreshState: new Uint8Array(DECODED_PAGE_WORDS),
		cacheable,
		writeWatches,
		writeWatchIndex,
	};
	page.refreshState.fill(DECODED_REFRESH_DECODE);
	page.ops.fill(OpCode.WIDE);
	page.dispatchOps.fill(OpCode.WIDE);
	page.tableCacheSlots.fill(-1);
	return page;
}
