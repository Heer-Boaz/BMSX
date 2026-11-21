import type { FunctionPrototype } from './closure';
import type { ExecutionDomainId } from '../../spec/blua32/execution_domain';
import {
	BASE_CYCLES, OPCODE_COUNT, OPCODE_SCALAR_REGISTER_READS, OPCODE_WRITES_REGISTER_A,
	REGISTER_OPERAND_A, REGISTER_OPERAND_B, REGISTER_OPERAND_C, OpCode,
} from '../../spec/blua32/opcode';
import { cop0FieldImplemented } from '../../spec/blua32/cop0';
import { ValueMoveKind } from '../../spec/blua32/instruction_format';
import type { MappedBusSignals } from '../memory/bus_signals';
import { MAPPED_PAGE_BYTE_SHIFT, type MappedPageWriteWatches } from '../memory/mapped_page';
import type { CompiledBlockPage } from './compiled_code_cache';
import type { CompiledCodeLookup } from './compiled_code_lookup';

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
	InvalidImageOperand = OPCODE_COUNT + 7,
}

export function decodedInstructionBaseCycles(page: DecodedInstructionPage, word: number): number {
	const op = page.ops[word];
	if (op === DecodedDispatchOp.InvalidImageOperand) return BASE_CYCLES[(page.bodyWords[word] >>> 18) & 0x3f];
	if (op === DecodedDispatchOp.ReservedMemory) return BASE_CYCLES[OpCode.LOAD_MEM];
	return BASE_CYCLES[op];
}

export function decodedDispatchOp(first: number, second: number): number {
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

/** End of the fixed register footprint, independent of the bound frame. */
export function fixedRegisterExtent(op: number, a: number, b: number, c: number): number {
	switch (op) {
		// The operation owns its dynamic window; a register-address CLOSURE
		// uses a Bx selector wider than the ordinary register fields.
		case OpCode.CALL: case OpCode.CLOSURE:
			return 0;
		case OpCode.STORE_MEM: case OpCode.STORE_MEM_D:
		case OpCode.STORE_MEM_WORDS: case OpCode.STORE_MEM_WORDS_D:
			// Source values are consumed only after the bus admits the write.
			return Math.max(0, b + 1);
		case OpCode.MOV:
			if (c > ValueMoveKind.FloatFromBits) return 0;
			break;
		case OpCode.MFC0:
			return cop0FieldImplemented(b) ? a + 1 : 0;
		case OpCode.LOADNIL:
			return b === 0 ? 0 : a + b;
		case OpCode.CONCATN:
			return c === 0 ? a + 1 : Math.max(a + 1, b + c);
	}
	const reads = OPCODE_SCALAR_REGISTER_READS[op];
	let end = (reads & REGISTER_OPERAND_A) !== 0 || OPCODE_WRITES_REGISTER_A[op] !== 0 ? a + 1 : 0;
	if ((reads & REGISTER_OPERAND_B) !== 0 && b >= 0) end = Math.max(end, b + 1);
	if ((reads & REGISTER_OPERAND_C) !== 0 && c >= 0) end = Math.max(end, c + 1);
	if (op === OpCode.SELF) end = Math.max(end, a + 2);
	return end;
}

export type DecodedInstructionPage = {
	widths: Uint8Array;
	ops: Uint8Array;
	dispatchOps: Uint8Array;
	dispatchCycles: Uint8Array;
	requiredSlots: Uint16Array;
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
	staticEnd: number;
	constantBase: number;
	constTags: Uint8Array;
	constWords: Uint32Array;
	globalMapBase: number;
	globalNameCount: number;
	systemNameCount: number;
	decodedPages: Map<number, DecodedInstructionPage>;
	compiledCodeLookup: CompiledCodeLookup | null;
};

export type Blua32FunctionRecordLatch = FunctionPrototype & {
	image: Blua32ExecutionImage;
	busSignals: MappedBusSignals;
	romBacked: boolean;
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
		requiredSlots: new Uint16Array(DECODED_PAGE_WORDS),
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
