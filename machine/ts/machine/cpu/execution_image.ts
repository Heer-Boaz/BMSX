import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';
import { BASE_CYCLES, OPCODE_COUNT, OpCode } from '../../spec/blua32/opcode';
import type { MappedBusSignals } from '../memory/bus_signals';
import { MAPPED_PAGE_BYTE_SHIFT, type MappedPageWriteWatches } from '../memory/mapped_page';
import type { CompiledBlockPage } from './compiled_block';

export const DECODED_PAGE_SHIFT = MAPPED_PAGE_BYTE_SHIFT - 2;
export const DECODED_PAGE_WORDS = 1 << DECODED_PAGE_SHIFT;
export const DECODED_REFRESH_DECODE = 1;
export const DECODED_REFRESH_FUSION = 2;
// A fused dispatch can inspect two instructions, each with one WIDE prefix.
export const DECODED_DEPENDENCY_PREDECESSOR_WORDS = 3;

export const enum DecodedDispatchOp {
	FusedShlBxor = OPCODE_COUNT,
	FusedAddShl = OPCODE_COUNT + 1,
	FusedShrBxor = OPCODE_COUNT + 2,
	Observe = OPCODE_COUNT + 3,
	ReservedMemory = OPCODE_COUNT + 4,
	CompiledWarm = OPCODE_COUNT + 5,
	Compiled = OPCODE_COUNT + 6,
}

export const DECODED_DISPATCH_OP_COUNT = OPCODE_COUNT + 7;

export const DECODED_DISPATCH_BASE_CYCLES = new Uint8Array(DECODED_DISPATCH_OP_COUNT);
DECODED_DISPATCH_BASE_CYCLES.set(BASE_CYCLES);
DECODED_DISPATCH_BASE_CYCLES[DecodedDispatchOp.FusedShlBxor] = BASE_CYCLES[OpCode.SHL];
DECODED_DISPATCH_BASE_CYCLES[DecodedDispatchOp.FusedAddShl] = BASE_CYCLES[OpCode.ADD];
DECODED_DISPATCH_BASE_CYCLES[DecodedDispatchOp.FusedShrBxor] = BASE_CYCLES[OpCode.SHR];
DECODED_DISPATCH_BASE_CYCLES[DecodedDispatchOp.ReservedMemory] = BASE_CYCLES[OpCode.LOAD_MEM];

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

export function decodedDispatchCanFuse(op: number): boolean {
	return op === OpCode.SHL || op === OpCode.ADD || op === OpCode.SHR;
}

export type DecodedInstructionPage = {
	widths: Uint8Array;
	ops: Uint8Array;
	dispatchOps: Uint8Array;
	dispatchCycles: Uint8Array;
	a: Uint16Array;
	// The opcode chooses unsigned raw fields or signed RK selectors at decode.
	b: Int16Array;
	c: Int16Array;
	bx: Uint32Array;
	sbx: Int32Array;
	disp: Uint8Array;
	sourceWords: Uint32Array;
	bodyWords: Uint32Array;
	tableCacheSlots: Int32Array;
	refreshState: Uint8Array;
	cacheable: boolean;
	writeWatches: MappedPageWriteWatches | null;
	writeWatchIndex: number;
	compiledBlocks: CompiledBlockPage | null;
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
	cacheableRead: boolean;
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
	writeWatches: MappedPageWriteWatches | null,
	writeWatchIndex: number,
): DecodedInstructionPage {
	// Bx, KSMI's signed immediate and a field instruction's mutable cache slot
	// are alternative payloads; no opcode consumes more than one.
	const bx = new Uint32Array(DECODED_PAGE_WORDS);
	const signedPayload = new Int32Array(bx.buffer);
	const page: DecodedInstructionPage = {
		widths: new Uint8Array(DECODED_PAGE_WORDS),
		ops: new Uint8Array(DECODED_PAGE_WORDS),
		dispatchOps: new Uint8Array(DECODED_PAGE_WORDS),
		dispatchCycles: new Uint8Array(DECODED_PAGE_WORDS),
		a: new Uint16Array(DECODED_PAGE_WORDS),
		b: new Int16Array(DECODED_PAGE_WORDS),
		c: new Int16Array(DECODED_PAGE_WORDS),
		bx,
		sbx: signedPayload,
		disp: new Uint8Array(DECODED_PAGE_WORDS),
		sourceWords: new Uint32Array(DECODED_PAGE_WORDS),
		bodyWords: new Uint32Array(DECODED_PAGE_WORDS),
		tableCacheSlots: signedPayload,
		refreshState: new Uint8Array(DECODED_PAGE_WORDS),
		cacheable,
		writeWatches,
		writeWatchIndex,
		compiledBlocks: null,
	};
	page.refreshState.fill(DECODED_REFRESH_DECODE);
	page.ops.fill(OpCode.WIDE);
	page.dispatchOps.fill(OpCode.WIDE);
	return page;
}
