import type { FunctionEntry, FunctionPrototype } from './closure';
import type { FrameExecutionTarget } from './call_state';
import { readLE32 } from '../../common/endian';
import { CART_ROM_BASE, CART_ROM_SIZE, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE } from '../../spec/bmsx/memory_map';
import { SYSTEM_EXECUTION_DOMAIN_ID, type ExecutionDomainId } from '../../spec/blua32/execution_domain';
import { BLUA32_FUNCTION_ALIGNMENT, BLUA32_FUNCTION_CODE_ADDRESS_OFFSET, BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET,
	BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_MAX_STACK_OFFSET, BLUA32_FUNCTION_NUM_PARAMS_OFFSET,
	BLUA32_FUNCTION_RECORD_SIZE, BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET, BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_FLAGS_OFFSET, BLUA32_IMAGE_MAPPED_CODE_FLAG,
	BLUA32_IMAGE_FUNCTION_COUNT_OFFSET, BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET,
	BLUA32_IMAGE_TEXT_ADDRESS_OFFSET, BLUA32_IMAGE_TEXT_BYTE_COUNT_OFFSET } from '../../spec/blua32/image_format';
import {
	BASE_CYCLES, OPCODE_COUNT, OPCODE_SCALAR_REGISTER_READS, OPCODE_WRITES_REGISTER_A,
	REGISTER_OPERAND_A, REGISTER_OPERAND_B, REGISTER_OPERAND_C, OpCode,
} from '../../spec/blua32/opcode';
import { cop0FieldImplemented } from '../../spec/blua32/cop0';
import { INSTRUCTION_BYTES, instructionBranchTarget, instructionBx, instructionLowB, instructionOpcode, ValueMoveKind } from '../../spec/blua32/instruction_format';
import type { Memory, MemoryByteView } from '../memory/memory';
import type { MappedBusSignals } from '../memory/bus_signals';
import { MAPPED_PAGE_BYTE_SHIFT, type MappedPageBinding } from '../memory/mapped_page';
import type { CompiledBlockPage } from './compiled_code_cache';
import type { CompiledCodeLookup } from './compiled_code_lookup';
import type { StringId } from './string_pool';

export const DECODED_PAGE_SHIFT = MAPPED_PAGE_BYTE_SHIFT - 2;
export const DECODED_PAGE_WORDS = 1 << DECODED_PAGE_SHIFT;
export const DECODED_REFRESH_DECODE = 1;
export const DECODED_REFRESH_FUSION = 2;
// A fused dispatch can inspect two instructions, each with one WIDE prefix.
export const DECODED_DEPENDENCY_PREDECESSOR_WORDS = 3;
export const COMPILED_VERSION_MAX_PAGES = 4;

// Straight-line scalar operations can keep the next PC local. Fixed field
// reads defer a non-resolved result to the loop to publish before handling it.
export const SCALAR_LOCAL_PC = new Uint8Array(OPCODE_COUNT);
for (const opcode of [
	OpCode.LOADK, OpCode.LOADKR, OpCode.LOADNIL, OpCode.KNIL, OpCode.KFALSE, OpCode.KTRUE,
	OpCode.K0, OpCode.K1, OpCode.KSMI, OpCode.NOT,
	OpCode.ADD, OpCode.SUB, OpCode.MUL, OpCode.DIV, OpCode.FLOORDIV, OpCode.MOD, OpCode.POW, OpCode.UNM,
	OpCode.BAND, OpCode.BOR, OpCode.BXOR, OpCode.BNOT, OpCode.SHL, OpCode.SHR,
	OpCode.GETFIELD, OpCode.SELF,
]) SCALAR_LOCAL_PC[opcode] = 1;

export const enum RomFunctionLane {
	FirstPc, EndPc, NumParams, MaxStack, Flags, UpvalueTable, UpvalueCount, Count,
}

export type Blua32RomFunctionDirectory = {
	readonly mappedCode: boolean;
	readonly tableAddress: number;
	readonly versions: Uint32Array;
	readonly textAddress: number;
	readonly textByteCount: number;
	readonly instructionHeads: Uint32Array;
	readonly codeOrder: Uint32Array;
};

export type ExecutionImageRelocation = {
	readonly frames: readonly (FrameExecutionTarget | null)[];
	readonly closures: ReadonlyMap<number, number>;
};

const EMPTY_ROM_LANES = new Uint32Array(0);

export function isRomInstructionHead(directory: Blua32RomFunctionDirectory, pc: number): boolean {
	const offset = pc - directory.textAddress;
	if (directory.mappedCode || offset < 0 || offset >= directory.textByteCount || (offset & (INSTRUCTION_BYTES - 1)) !== 0) return false;
	const word = offset >>> 2;
	return (directory.instructionHeads[word >>> 5] & (1 << (word & 31))) !== 0;
}

// Return the first lane of the owning function version.
export function findRomFunctionExtentAtPc(directory: Blua32RomFunctionDirectory, pc: number): number {
	const { codeOrder, versions } = directory;
	let first = 0, end = codeOrder.length;
	while (first < end) {
		const middle = (first + end) >>> 1;
		const version = codeOrder[middle];
		if (pc < versions[version + RomFunctionLane.FirstPc]) end = middle;
		else if (pc >= versions[version + RomFunctionLane.EndPc]) first = middle + 1;
		else return version;
	}
	return -1;
}

function verifyRomControlFlow(directory: Blua32RomFunctionDirectory, code: Uint8Array, codeOffset: number): void {
	const { instructionHeads, codeOrder, versions, textAddress } = directory;
	for (let i = 0; i < codeOrder.length; ++i) {
		const index = codeOrder[i], end = versions[index + RomFunctionLane.EndPc];
		for (let pc = versions[index + RomFunctionLane.FirstPc]; pc < end;) {
			const offset = pc - textAddress;
			const wide = instructionOpcode(readLE32(code, codeOffset + offset)) === OpCode.WIDE;
			if (wide && (pc + INSTRUCTION_BYTES >= end
				|| instructionOpcode(readLE32(code, codeOffset + offset + INSTRUCTION_BYTES)) === OpCode.WIDE))
				throw new Error('BLua32 function has an incomplete WIDE instruction.');
			const word = offset >>> 2;
			instructionHeads[word >>> 5] |= 1 << (word & 31);
			pc += (wide ? 2 : 1) * INSTRUCTION_BYTES;
		}
	}

	// Comparison outcomes and relative branches use the same encoded width as dispatch.
	for (let i = 0; i < codeOrder.length; ++i) {
		const index = codeOrder[i], first = versions[index + RomFunctionLane.FirstPc], end = versions[index + RomFunctionLane.EndPc];
		for (let pc = first; pc < end;) {
			const offset = codeOffset + pc - textAddress;
			const head = readLE32(code, offset);
			const wide = instructionOpcode(head) === OpCode.WIDE;
			const width = wide ? 2 : 1;
			const body = wide ? readLE32(code, offset + INSTRUCTION_BYTES) : head;
			const op = instructionOpcode(body);
			const next = pc + width * INSTRUCTION_BYTES;
			if (op === OpCode.JMP || op === OpCode.JMPIF || op === OpCode.JMPIFNOT) {
				const target = instructionBranchTarget(pc, width, instructionBx(body, wide ? instructionLowB(head) : 0));
				if (target < first || target >= end || !isRomInstructionHead(directory, target))
					throw new Error('BLua32 branch target is not an instruction in its function.');
			}
			if (op !== OpCode.JMP && op !== OpCode.RET && op !== OpCode.RFE && op <= OpCode.HALT) {
				if (next >= end) throw new Error('BLua32 function falls through the end of its TEXT extent.');
				if (op === OpCode.EQ || op === OpCode.LT || op === OpCode.LE || op === OpCode.ITERN) {
					const skippedWide = instructionOpcode(readLE32(code, codeOffset + next - textAddress)) === OpCode.WIDE;
					if (next + (skippedWide ? 2 : 1) * INSTRUCTION_BYTES >= end)
						throw new Error(op === OpCode.ITERN ? 'Invalid BLua32 program in ROM: ITERN skips past the end of its function.'
							: 'BLua32 comparison skips past the end of its function.');
				}
			}
			pc = next;
		}
	}
}

export function readRomFunctionDirectory(memory: Memory, domain: ExecutionDomainId, view: MemoryByteView): Blua32RomFunctionDirectory {
	const { bytes, byteOffset } = view;
	const mappedCode = (readLE32(bytes, byteOffset + BLUA32_IMAGE_FLAGS_OFFSET) & BLUA32_IMAGE_MAPPED_CODE_FLAG) !== 0;
	const count = readLE32(bytes, byteOffset + BLUA32_IMAGE_FUNCTION_COUNT_OFFSET);
	if (count === 0) {
		if (!mappedCode) throw new Error('A BLua32 function image has no function directory.');
		return { mappedCode, tableAddress: 0, versions: EMPTY_ROM_LANES, textAddress: 0, textByteCount: 0,
			instructionHeads: EMPTY_ROM_LANES, codeOrder: EMPTY_ROM_LANES };
	}
	const tableAddress = readLE32(bytes, byteOffset + BLUA32_IMAGE_FUNCTION_TABLE_ADDRESS_OFFSET);
	const textAddress = readLE32(bytes, byteOffset + BLUA32_IMAGE_TEXT_ADDRESS_OFFSET);
	const textByteCount = readLE32(bytes, byteOffset + BLUA32_IMAGE_TEXT_BYTE_COUNT_OFFSET);
	const system = domain === SYSTEM_EXECUTION_DOMAIN_ID;
	const base = system ? SYSTEM_ROM_BASE : CART_ROM_BASE;
	const extent = system ? SYSTEM_ROM_SIZE : CART_ROM_SIZE;
	const slot = system ? 0 : domain;
	if (((textAddress | textByteCount) & (INSTRUCTION_BYTES - 1)) !== 0 || textByteCount === 0
		|| textAddress < base || textByteCount > extent - (textAddress - base) || !memory.bindRomByteView(textAddress, textByteCount, slot, view))
		throw new Error("BLua32 published TEXT is not backed by the image's ROM.");
	const code = view.bytes, codeOffset = view.byteOffset;
	const recordBytes = count * BLUA32_FUNCTION_RECORD_SIZE;
	if ((tableAddress & (BLUA32_FUNCTION_ALIGNMENT - 1)) !== 0
		|| tableAddress < base || recordBytes > extent - (tableAddress - base)
		|| !memory.bindRomByteView(tableAddress, recordBytes, slot, view))
		throw new Error("BLua32 function directory is not backed by the image's ROM.");
	const versions = new Uint32Array(count * RomFunctionLane.Count);
	for (let index = 0, record = view.byteOffset; index < count; ++index, record += BLUA32_FUNCTION_RECORD_SIZE) {
		const firstPc = readLE32(view.bytes, record + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
		const size = readLE32(view.bytes, record + BLUA32_FUNCTION_CODE_BYTE_COUNT_OFFSET);
		if (firstPc < textAddress || size === 0 || size > textByteCount - (firstPc - textAddress)
			|| ((firstPc | size) & (INSTRUCTION_BYTES - 1)) !== 0)
			throw new Error('BLua32 published function has an invalid TEXT extent.');
		const lane = index * RomFunctionLane.Count;
		versions[lane + RomFunctionLane.FirstPc] = firstPc;
		versions[lane + RomFunctionLane.EndPc] = firstPc + size;
		versions[lane + RomFunctionLane.NumParams] = readLE32(view.bytes, record + BLUA32_FUNCTION_NUM_PARAMS_OFFSET);
		versions[lane + RomFunctionLane.MaxStack] = readLE32(view.bytes, record + BLUA32_FUNCTION_MAX_STACK_OFFSET);
		versions[lane + RomFunctionLane.Flags] = readLE32(view.bytes, record + BLUA32_FUNCTION_FLAGS_OFFSET);
		versions[lane + RomFunctionLane.UpvalueTable] = readLE32(view.bytes, record + BLUA32_FUNCTION_UPVALUE_TABLE_ADDRESS_OFFSET);
		versions[lane + RomFunctionLane.UpvalueCount] = readLE32(view.bytes, record + BLUA32_FUNCTION_UPVALUE_COUNT_OFFSET);
	}
	if (mappedCode) return { mappedCode, tableAddress, versions, textAddress, textByteCount,
		instructionHeads: EMPTY_ROM_LANES, codeOrder: EMPTY_ROM_LANES };

	// Keep the original record order. The sorted index names one record pair
	// per distinct extent and refers back to the same version storage.
	const order = new Uint32Array(count);
	for (let i = 0; i < count; ++i) order[i] = i * RomFunctionLane.Count;
	order.sort((a, b) => versions[a] - versions[b] || versions[a + RomFunctionLane.EndPc] - versions[b + RomFunctionLane.EndPc]);
	let length = 0, previousEnd = textAddress, previousStart = -1;
	for (let i = 0; i < count; ++i) {
		const index = order[i], first = versions[index + RomFunctionLane.FirstPc], end = versions[index + RomFunctionLane.EndPc];
		if (first === previousStart && end === previousEnd) continue;
		if (first < previousEnd) throw new Error('BLua32 function TEXT extents overlap.');
		order[length++] = index;
		previousStart = first;
		previousEnd = end;
	}
	const directory = { mappedCode, tableAddress, versions, textAddress, textByteCount,
		instructionHeads: new Uint32Array(((textByteCount >>> 2) + 31) >>> 5),
		codeOrder: order.subarray(0, length) };
	verifyRomControlFlow(directory, code, codeOffset);
	return directory;
}

export function romFunctionVersionLane(directory: Blua32RomFunctionDirectory, record: number): number {
	const offset = record - directory.tableAddress;
	if (offset < 0 || offset % BLUA32_FUNCTION_RECORD_SIZE !== 0) return -1;
	const lane = (offset / BLUA32_FUNCTION_RECORD_SIZE) * RomFunctionLane.Count;
	return lane < directory.versions.length ? lane : -1;
}

export function readPublishedEntry(versions: Uint32Array, lane: number, target: FunctionEntry): void {
	target.codeAddress = versions[lane + RomFunctionLane.FirstPc];
	target.numParams = versions[lane + RomFunctionLane.NumParams];
	target.maxStack = versions[lane + RomFunctionLane.MaxStack];
	target.flags = versions[lane + RomFunctionLane.Flags];
}

export function readPublishedPrototype(versions: Uint32Array, lane: number, target: FunctionPrototype): void {
	readPublishedEntry(versions, lane, target);
	target.upvalueTableAddress = versions[lane + RomFunctionLane.UpvalueTable];
	target.recordUpvalueCount = versions[lane + RomFunctionLane.UpvalueCount];
}

export function readRomEntry(bytes: Uint8Array, offset: number, target: FunctionEntry): void {
	target.codeAddress = readLE32(bytes, offset + BLUA32_FUNCTION_CODE_ADDRESS_OFFSET);
	target.numParams = readLE32(bytes, offset + BLUA32_FUNCTION_NUM_PARAMS_OFFSET);
	target.maxStack = readLE32(bytes, offset + BLUA32_FUNCTION_MAX_STACK_OFFSET);
	target.flags = readLE32(bytes, offset + BLUA32_FUNCTION_FLAGS_OFFSET);
}

const ROM_CALL_SLOTS = 64;
const UNDRIVEN_ENTRY: Readonly<FunctionEntry> = { codeAddress: 0, numParams: 0, maxStack: 0, flags: 0 };

export class RomCallBindings {
	private readonly slots = new Array<FunctionEntry & { address: number }>(ROM_CALL_SLOTS);

	public invalidate(): void {
		for (const entry of this.slots) if (entry !== undefined) entry.address = -1;
	}

	public bind(memory: Memory, image: Blua32ExecutionImage, address: number, view: MemoryByteView): Readonly<FunctionEntry> {
		const index = ((address / BLUA32_FUNCTION_RECORD_SIZE) >>> 0) % ROM_CALL_SLOTS;
		let entry = this.slots[index];
		if (entry?.address === address) return entry;
		const directory = image.romFunctions;
		if (directory.mappedCode && !memory.bindRomByteView(address, BLUA32_FUNCTION_RECORD_SIZE,
			image.executionDomainId === 1 ? 1 : 0, view)) return UNDRIVEN_ENTRY;
		if (entry === undefined) this.slots[index] = entry = { address, codeAddress: 0, numParams: 0, maxStack: 0, flags: 0 };
		entry.address = address;
		if (directory.mappedCode) readRomEntry(view.bytes, view.byteOffset, entry);
		else readPublishedEntry(directory.versions, romFunctionVersionLane(directory, address), entry);
		return entry;
	}
}

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
		case OpCode.BIOSCALL:
			return a + c + 1;
		case OpCode.ITERN:
			return Math.max(a + 3, b + c);
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

export type DecodedInstructionPage = MappedPageBinding & {
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
	operandByte: Uint8Array; // Word displacement or SETFIELD's additional hash slots.
	sourceWords: Uint32Array;
	bodyWords: Uint32Array;
	tableCacheSlots: Int32Array;
	refreshState: Uint8Array;
	compiledBlocks: CompiledBlockPage | null;
};

export type Blua32ExecutionImage = {
	executionDomainId: ExecutionDomainId;
	irqFunctionAddress: number;
	staticEnd: number;
	heapServiceFunctions: Uint32Array | null;
	constantBase: number;
	constTags: Uint8Array;
	constWords: Uint32Array;
	// Derived from the immutable pool, including during restore.
	readonly constantStringRoots: readonly StringId[];
	globalMapBase: number;
	globalNameCount: number;
	systemNameCount: number;
	romFunctions: Blua32RomFunctionDirectory;
	readonly romCallBindings: RomCallBindings;
	decodedPages: Map<number, DecodedInstructionPage>;
	compiledCodeLookup: CompiledCodeLookup | null;
};

export function admitsFunctionPc(directory: Blua32RomFunctionDirectory, record: number, pc: number): boolean {
	if (directory.mappedCode) return true;
	const lane = romFunctionVersionLane(directory, record);
	if (lane >= 0) return pc >= directory.versions[lane + RomFunctionLane.FirstPc]
		&& pc < directory.versions[lane + RomFunctionLane.EndPc] && isRomInstructionHead(directory, pc);
	return ((pc - SYSTEM_ROM_BASE) >>> 0) >= SYSTEM_ROM_SIZE && ((pc - CART_ROM_BASE) >>> 0) >= CART_ROM_SIZE;
}

export type Blua32FunctionRecordLatch = FunctionPrototype & {
	image: Blua32ExecutionImage;
	busSignals: MappedBusSignals;
	romBacked: boolean;
};

export function createDecodedInstructionPage(
	binding: MappedPageBinding,
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
		operandByte: new Uint8Array(DECODED_PAGE_WORDS),
		sourceWords: new Uint32Array(DECODED_PAGE_WORDS),
		bodyWords: new Uint32Array(DECODED_PAGE_WORDS),
		tableCacheSlots: signedPayload,
		refreshState: new Uint8Array(DECODED_PAGE_WORDS),
		...binding,
		compiledBlocks: null,
	};
	page.refreshState.fill(DECODED_REFRESH_DECODE);
	page.ops.fill(OpCode.WIDE);
	page.dispatchOps.fill(OpCode.WIDE);
	return page;
}
