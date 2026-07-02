// start repeated-sequence-acceptable -- Program linker rewrites packed instruction fields directly to preserve bit-level clarity.
import { OpCode, type Program, type ProgramMetadata, type ProgramModuleExport, type ProgramModuleProto, type Proto, type SourceRange } from '../cpu/cpu';
import {
	BASE_BX_BITS,
	EXT_B_BITS,
	EXT_C_BITS,
	INSTRUCTION_BYTES,
	MAX_BX_BITS,
	MAX_EXT_BX,
	MAX_LOW_BX,
	MAX_OPERAND_BITS,
	readInstructionWord,
	writeInstruction,
	writeInstructionWord,
} from '../cpu/instruction_format';
import {
	CART_PROGRAM_VECTOR_PC,
	CART_PROGRAM_VECTOR_VALUE,
	resolveProgramLayout,
	SYSTEM_BASE_PC,
	CART_BASE_PC,
	type ProgramLayout,
} from './layout';
import type {
	EncodedValue,
	ProgramImage,
	ProgramConstReloc,
	ProgramConstValueReloc,
	ProgramBssSymbol,
	ProgramDataSymbol,
	ProgramRodataSymbol,
	ProgramSymbolsImage,
	ProgramVectorTable,
} from './loader';
import { inflateProgram } from './loader';
import { PROGRAM_STATIC_RAM_BASE, PROGRAM_ROM_BASE, PROGRAM_ROM_SIZE, RAM_END } from '../memory/map';

export type LinkedProgramImage = {
	programImage: ProgramImage;
	metadata: ProgramMetadata | null;
	systemVectors: ProgramVectorTable;
	cartVectors: ProgramVectorTable;
	systemDataBaseAddress: number;
	cartDataBaseAddress: number;
	systemBssBaseAddress: number;
	cartBssBaseAddress: number;
	systemStaticModulePaths: ReadonlyArray<string>;
	cartStaticModulePaths: ReadonlyArray<string>;
};

export type ProgramBootTarget = 'system' | 'cart';

export type LinkedBootProgramImage = {
	programImage: ProgramImage;
	metadata: ProgramMetadata | null;
	vectors: ProgramVectorTable;
	dataBaseAddress: number;
	bssBaseAddress: number;
	systemStaticModulePaths: ReadonlyArray<string>;
	cartVectors: ProgramVectorTable;
	cartDataBaseAddress: number;
	cartBssBaseAddress: number;
	cartStaticModulePaths: ReadonlyArray<string>;
};

const NUMBER_KEY_BUFFER = new ArrayBuffer(8);
const NUMBER_KEY_VIEW = new DataView(NUMBER_KEY_BUFFER);
const NAN_KEY = 'n:0x7ff8000000000000';

const makeNumberKey = (value: number): string => {
	if (Number.isNaN(value)) {
		return NAN_KEY;
	}
	NUMBER_KEY_VIEW.setFloat64(0, value, false);
	const hi = NUMBER_KEY_VIEW.getUint32(0, false).toString(16).padStart(8, '0');
	const lo = NUMBER_KEY_VIEW.getUint32(4, false).toString(16).padStart(8, '0');
	return `n:0x${hi}${lo}`;
};

const makeConstKey = (value: EncodedValue): string => {
	if (value === null) {
		return 'nil';
	}
	if (typeof value === 'boolean') {
		return value ? 'b:1' : 'b:0';
	}
	if (typeof value === 'number') {
		return makeNumberKey(value);
	}
	return `s:${value}`;
};

const mergeConstPools = (
	systemConstPool: ReadonlyArray<EncodedValue>,
	cartConstPool: ReadonlyArray<EncodedValue>,
): { constPool: EncodedValue[]; cartConstRemap: number[] } => {
	const constPool: EncodedValue[] = systemConstPool.slice();
	const constSlotByKey = new Map<string, number>();
	for (let index = 0; index < systemConstPool.length; index += 1) {
		const key = makeConstKey(systemConstPool[index]);
		if (!constSlotByKey.has(key)) {
			constSlotByKey.set(key, index + 1);
		}
	}
	const cartConstRemap: number[] = new Array(cartConstPool.length);
	for (let index = 0; index < cartConstPool.length; index += 1) {
		const value = cartConstPool[index];
		const key = makeConstKey(value);
		const slot = constSlotByKey.get(key);
		if (slot) {
			cartConstRemap[index] = slot - 1;
			continue;
		}
		const nextIndex = constPool.length;
		constPool.push(value);
		constSlotByKey.set(key, nextIndex + 1);
		cartConstRemap[index] = nextIndex;
	}
	return { constPool, cartConstRemap };
};

const assertStaticRamFits = (baseAddress: number, byteCount: number): void => {
	if (baseAddress > RAM_END || byteCount > RAM_END - baseAddress) {
		throw new Error(`[ProgramLinker] static RAM range ${baseAddress}+${byteCount} exceeds RAM end ${RAM_END}.`);
	}
};

const assertProgramRomFits = (byteCount: number): void => {
	if (byteCount > PROGRAM_ROM_SIZE) {
		throw new Error(`[ProgramLinker] program ROM range ${byteCount} exceeds ROM size ${PROGRAM_ROM_SIZE}.`);
	}
};

const resolveStorageSymbolAddress = (
	symbols: ReadonlyArray<ProgramBssSymbol | ProgramDataSymbol | ProgramRodataSymbol>,
	baseAddress: number,
	symbolName: string,
	addend: number,
	sectionName: '.bss' | '.data' | '.rodata',
): number => {
	for (let index = 0; index < symbols.length; index += 1) {
		const symbol = symbols[index];
		if (symbol.name === symbolName) {
			return baseAddress + symbol.offset + addend;
		}
	}
	throw new Error(`[ProgramLinker] Missing ${sectionName} symbol '${symbolName}'.`);
};

const resolveConstValueRelocation = (
	reloc: ProgramConstValueReloc,
	dataSymbols: ReadonlyArray<ProgramDataSymbol>,
	dataBaseAddress: number,
	dataLmaAddress: number,
	bssSymbols: ReadonlyArray<ProgramBssSymbol>,
	bssBaseAddress: number,
	rodataSymbols: ReadonlyArray<ProgramRodataSymbol>,
	rodataBaseAddress: number,
): number => {
	switch (reloc.kind) {
		case 'data_addr':
			return resolveStorageSymbolAddress(dataSymbols, dataBaseAddress, reloc.symbol, reloc.addend, '.data');
		case 'data_lma_addr':
			return resolveStorageSymbolAddress(dataSymbols, dataLmaAddress, reloc.symbol, reloc.addend, '.data');
		case 'bss_addr':
			return resolveStorageSymbolAddress(bssSymbols, bssBaseAddress, reloc.symbol, reloc.addend, '.bss');
		case 'rodata_addr':
			return resolveStorageSymbolAddress(rodataSymbols, rodataBaseAddress, reloc.symbol, reloc.addend, '.rodata');
	}
};

const resolveConstValueRelocations = (
	constPool: ReadonlyArray<EncodedValue>,
	relocs: ReadonlyArray<ProgramConstValueReloc>,
	dataSymbols: ReadonlyArray<ProgramDataSymbol>,
	dataBaseAddress: number,
	dataLmaAddress: number,
	bssSymbols: ReadonlyArray<ProgramBssSymbol>,
	bssBaseAddress: number,
	rodataSymbols: ReadonlyArray<ProgramRodataSymbol>,
	rodataBaseAddress: number,
): EncodedValue[] => {
	if (relocs.length === 0) {
		return constPool.slice();
	}
	const out = constPool.slice();
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		out[reloc.constIndex] = resolveConstValueRelocation(reloc, dataSymbols, dataBaseAddress, dataLmaAddress, bssSymbols, bssBaseAddress, rodataSymbols, rodataBaseAddress);
	}
	return out;
};

const mergeNamedSlots = (
	systemNames: ReadonlyArray<string>,
	cartNames: ReadonlyArray<string>,
): { names: string[]; cartRemap: number[] } => {
	const names: string[] = systemNames.slice();
	const slotByName = new Map<string, number>();
	for (let index = 0; index < systemNames.length; index += 1) {
		const name = systemNames[index];
		if (!slotByName.has(name)) {
			slotByName.set(name, index + 1);
		}
	}
	const cartRemap: number[] = new Array(cartNames.length);
	for (let index = 0; index < cartNames.length; index += 1) {
		const name = cartNames[index];
		const slot = slotByName.get(name);
		if (slot) {
			cartRemap[index] = slot - 1;
			continue;
		}
		const mergedIndex = names.length;
		names.push(name);
		slotByName.set(name, mergedIndex + 1);
		cartRemap[index] = mergedIndex;
	}
	return { names, cartRemap };
};

const encodeSignedRaw = (value: number, bits: number): number => {
	const mask = (1 << bits) - 1;
	return value & mask;
};

const fitsSignedRaw = (value: number, bits: number): boolean => {
	const min = -(1 << (bits - 1));
	const max = (1 << (bits - 1)) - 1;
	return value >= min && value <= max;
};

const writeBcRelocatedInstruction = (
	code: Uint8Array,
	wordIndex: number,
	op: number,
	aLow: number,
	bLow: number,
	cLow: number,
	ext: number,
	hasWide: boolean,
	wideA: number,
	wideB: number,
	wideC: number,
	relocOnB: boolean,
	raw: number,
	extBits: number,
): void => {
	const low = raw & 0x3f;
	const extPartMask = (1 << extBits) - 1;
	const extPart = (raw >> MAX_OPERAND_BITS) & extPartMask;
	const widePart = raw >> (MAX_OPERAND_BITS + extBits);
	const extA = (ext >>> 6) & 0x3;
	let extB = (ext >>> 3) & 0x7;
	let extC = ext & 0x7;
	if (relocOnB) {
		bLow = low;
		extB = extPart;
		if (hasWide) {
			wideB = widePart & 0x3f;
		}
	} else {
		cLow = low;
		extC = extPart;
		if (hasWide) {
			wideC = widePart & 0x3f;
		}
	}
	const relocatedExt = (extA << 6) | (extB << 3) | extC;
	if (hasWide) {
		writeInstruction(code, wordIndex - 1, OpCode.WIDE, wideA, wideB, wideC);
	}
	writeInstruction(code, wordIndex, op, aLow, bLow, cLow, relocatedExt);
};

const resolveLinkedExportSlot = (
	slotName: string,
	mergedGlobalNames: ReadonlyArray<string>,
	mergedSystemGlobalNames: ReadonlyArray<string>,
): { op: OpCode.GETGL | OpCode.GETSYS; slot: number } => {
	const globalSlot = mergedGlobalNames.indexOf(slotName);
	if (globalSlot >= 0) {
		return { op: OpCode.GETGL, slot: globalSlot };
	}
	const systemSlot = mergedSystemGlobalNames.indexOf(slotName);
	if (systemSlot >= 0) {
		return { op: OpCode.GETSYS, slot: systemSlot };
	}
	throw new Error(`[ProgramLinker] Unable to resolve module export slot '${slotName}' during linking.`);
};

const relocRequiresSymbolMetadata = (reloc: ProgramConstReloc): boolean =>
	reloc.kind === 'module' || reloc.kind === 'export_proto';

const cartRelocRequiresMetadata = (reloc: ProgramConstReloc): boolean =>
	relocRequiresSymbolMetadata(reloc) || reloc.kind === 'gl' || reloc.kind === 'sys';

const rewriteResolvedABx = (
	code: Uint8Array,
	wordIndex: number,
	targetOp: number,
	value: number,
): void => {
	const word = readInstructionWord(code, wordIndex);
	const hasWide = wordIndex > 0 && ((readInstructionWord(code, wordIndex - 1) >>> 18) & 0x3f) === OpCode.WIDE;
	const aLow = (word >>> 12) & 0x3f;
	const nextWide = value >> BASE_BX_BITS;
	if (!hasWide && nextWide !== 0) {
		throw new Error(`[ProgramLinker] Reloc at word ${wordIndex} requires WIDE prefix.`);
	}
	const nextExt = (value >> MAX_BX_BITS) & 0xff;
	const nextLow = value & MAX_LOW_BX;
	if (hasWide) {
		const wideWord = readInstructionWord(code, wordIndex - 1);
		const wideA = (wideWord >>> 12) & 0x3f;
		const wideC = wideWord & 0x3f;
		writeInstruction(code, wordIndex - 1, OpCode.WIDE, wideA, nextWide & 0x3f, wideC);
	}
	writeInstruction(code, wordIndex, targetOp, aLow, (nextLow >>> 6) & 0x3f, nextLow & 0x3f, nextExt);
};

const resolveExportProtoRelocTarget = (
	slotName: string,
	globalNames: ReadonlyArray<string>,
	systemGlobalNames: ReadonlyArray<string>,
	exportProtoIdBySlot: { readonly [slotName: string]: string },
	protoIds: ReadonlyArray<string>,
): { op: number; value: number } => {
	const protoId = exportProtoIdBySlot[slotName];
	if (protoId !== undefined) {
		const protoIndex = protoIds.indexOf(protoId);
		if (protoIndex < 0) {
			throw new Error(`[ProgramLinker] export_proto reloc cannot resolve proto '${protoId}' for slot '${slotName}'.`);
		}
		return { op: OpCode.CLOSURE, value: protoIndex };
	}
	const resolvedSlot = resolveLinkedExportSlot(slotName, globalNames, systemGlobalNames);
	return { op: resolvedSlot.op, value: resolvedSlot.slot };
};

type SymbolicRelocSymbols = {
	globalNames: ReadonlyArray<string>;
	systemGlobalNames: ReadonlyArray<string>;
	exportProtoIdBySlot: { readonly [slotName: string]: string };
	protoIds: ReadonlyArray<string>;
};

// Shared resolver for the two symbolic reloc kinds ('module', 'export_proto').
// The reloc record owns the symbolic export name; resolved relocs rewrite their
// referencing instruction to the final concrete operand (slot or proto index).
const applySymbolicRelocations = (
	code: Uint8Array,
	relocs: ReadonlyArray<ProgramConstReloc>,
	symbols: SymbolicRelocSymbols,
): void => {
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		if (reloc.kind !== 'module' && reloc.kind !== 'export_proto') {
			continue;
		}
		if (reloc.kind === 'module') {
			const resolvedSlot = resolveLinkedExportSlot(reloc.symbol, symbols.globalNames, symbols.systemGlobalNames);
			rewriteResolvedABx(code, reloc.wordIndex, resolvedSlot.op, resolvedSlot.slot);
			continue;
		}
		const target = resolveExportProtoRelocTarget(reloc.symbol, symbols.globalNames, symbols.systemGlobalNames, symbols.exportProtoIdBySlot, symbols.protoIds);
		rewriteResolvedABx(code, reloc.wordIndex, target.op, target.value);
	}
};

export const resolveRuntimeProgramRelocations = (
	program: Program,
	metadata: ProgramMetadata,
	relocs: ReadonlyArray<ProgramConstReloc>,
): void => {
	applySymbolicRelocations(
		program.code,
		relocs,
		metadata,
	);
};

export const resolveRuntimeProgramValueRelocations = (
	program: Program,
	relocs: ReadonlyArray<ProgramConstValueReloc>,
	dataSymbols: ReadonlyArray<ProgramDataSymbol>,
	dataByteCount: number,
	dataBaseAddress: number,
	bssSymbols: ReadonlyArray<ProgramBssSymbol>,
	bssByteCount: number,
	bssBaseAddress: number,
	rodataSymbols: ReadonlyArray<ProgramRodataSymbol>,
	rodataByteCount: number,
): void => {
	assertStaticRamFits(dataBaseAddress, dataByteCount);
	assertStaticRamFits(bssBaseAddress, bssByteCount);
	assertProgramRomFits(program.programRomTextByteLength + rodataByteCount + dataByteCount);
	const rodataBaseAddress = PROGRAM_ROM_BASE + program.programRomTextByteLength;
	const dataLmaAddress = rodataBaseAddress + rodataByteCount;
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		program.constPool[reloc.constIndex] = resolveConstValueRelocation(reloc, dataSymbols, dataBaseAddress, dataLmaAddress, bssSymbols, bssBaseAddress, rodataSymbols, rodataBaseAddress);
	}
};

export const inflateExecutableProgramImage = (
	programImage: ProgramImage,
	metadata: ProgramMetadata | null,
	dataBaseAddress: number = PROGRAM_STATIC_RAM_BASE,
	bssBaseAddress: number = dataBaseAddress + programImage.sections.data.bytes.byteLength,
): Program => {
	const textByteCount = programImage.sections.text.code.byteLength;
	const rodataByteCount = programImage.sections.rodata.bytes.byteLength;
	const dataByteCount = programImage.sections.data.bytes.byteLength;
	assertStaticRamFits(dataBaseAddress, dataByteCount + programImage.sections.bss.byteCount);
	assertProgramRomFits(textByteCount + rodataByteCount + dataByteCount);
	const rodataBaseAddress = PROGRAM_ROM_BASE + textByteCount;
	const dataLmaAddress = rodataBaseAddress + rodataByteCount;
	const program = inflateProgram({
		...programImage.sections,
		rodata: {
			...programImage.sections.rodata,
			constPool: resolveConstValueRelocations(
				programImage.sections.rodata.constPool,
				programImage.link.constValueRelocs,
				programImage.sections.data.symbols,
				dataBaseAddress,
				dataLmaAddress,
				programImage.sections.bss.symbols,
				bssBaseAddress,
				programImage.sections.rodata.symbols,
				rodataBaseAddress,
			),
		},
	});
	if (programImage.link.constRelocs.length !== 0) {
		if (metadata === null) {
			throw new Error('program image relocations require metadata.');
		}
		resolveRuntimeProgramRelocations(program, metadata, programImage.link.constRelocs);
	}
	return program;
};

const rewriteSymbolicConstRelocations = (
	code: Uint8Array,
	relocs: ReadonlyArray<ProgramConstReloc>,
	globalNames: ReadonlyArray<string>,
	systemGlobalNames: ReadonlyArray<string>,
	exportProtoIdBySlot: { readonly [slotName: string]: string },
	protoIds: ReadonlyArray<string>,
): void => {
	applySymbolicRelocations(
		code,
		relocs,
		{ globalNames, systemGlobalNames, exportProtoIdBySlot, protoIds },
	);
};

const rewriteConstPoolRelocations = (
	code: Uint8Array,
	relocs: ReadonlyArray<ProgramConstReloc>,
	cartConstRemap: ReadonlyArray<number>,
): void => {
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		switch (reloc.kind) {
			case 'module':
			case 'export_proto':
			case 'gl':
			case 'sys':
				continue;
		}
		const wordIndex = reloc.wordIndex;
		const word = readInstructionWord(code, wordIndex);
		const op = (word >>> 18) & 0x3f;
		const hasWide = wordIndex > 0 && ((readInstructionWord(code, wordIndex - 1) >>> 18) & 0x3f) === OpCode.WIDE;
		let wideA = 0;
		let wideB = 0;
		let wideC = 0;
		if (hasWide) {
			const wideWord = readInstructionWord(code, wordIndex - 1);
			wideA = (wideWord >>> 12) & 0x3f;
			wideB = (wideWord >>> 6) & 0x3f;
			wideC = wideWord & 0x3f;
		}
		const aLow = (word >>> 12) & 0x3f;
		let bLow = (word >>> 6) & 0x3f;
		let cLow = word & 0x3f;
		let ext = word >>> 24;

		const mappedIndex = cartConstRemap[reloc.constIndex];
		switch (reloc.kind) {
			case 'bx': {
				const nextWide = mappedIndex >> BASE_BX_BITS;
				if (!hasWide && nextWide !== 0) {
					throw new Error(`[ProgramLinker] Reloc at word ${wordIndex} requires WIDE prefix.`);
				}
				const nextExt = (mappedIndex >> MAX_BX_BITS) & 0xff;
				const nextLow = mappedIndex & MAX_LOW_BX;
				bLow = (nextLow >>> 6) & 0x3f;
				cLow = nextLow & 0x3f;
				ext = nextExt;
				if (hasWide) {
					wideB = nextWide & 0x3f;
					writeInstruction(code, wordIndex - 1, OpCode.WIDE, wideA, wideB, wideC);
				}
				writeInstruction(code, wordIndex, op, aLow, bLow, cLow, ext);
				continue;
			}
			case 'const_b':
			case 'const_c': {
				const relocOnB = reloc.kind === 'const_b';
				const extBits = relocOnB ? EXT_B_BITS : EXT_C_BITS;
				const baseBits = MAX_OPERAND_BITS + extBits;
				const maxBase = (1 << baseBits) - 1;
				if (!hasWide && mappedIndex > maxBase) {
					throw new Error(`[ProgramLinker] Reloc at word ${wordIndex} requires WIDE prefix.`);
				}
				const totalBits = baseBits + (hasWide ? MAX_OPERAND_BITS : 0);
				const maxValue = (1 << totalBits) - 1;
				if (mappedIndex > maxValue) {
					throw new Error(`[ProgramLinker] Reloc at word ${wordIndex} exceeds operand range.`);
				}
				writeBcRelocatedInstruction(code, wordIndex, op, aLow, bLow, cLow, ext, hasWide, wideA, wideB, wideC, relocOnB, mappedIndex, extBits);
				continue;
			}
		}

		const relocOnB = reloc.kind === 'rk_b';
		const rkValue = -mappedIndex - 1;
		const extBits = relocOnB ? EXT_B_BITS : EXT_C_BITS;
		const baseBits = MAX_OPERAND_BITS + extBits;
		if (!hasWide && !fitsSignedRaw(rkValue, baseBits)) {
			throw new Error(`[ProgramLinker] Reloc at word ${wordIndex} requires WIDE prefix.`);
		}
		const totalBits = baseBits + (hasWide ? MAX_OPERAND_BITS : 0);
		const raw = encodeSignedRaw(rkValue, totalBits);
		writeBcRelocatedInstruction(code, wordIndex, op, aLow, bLow, cLow, ext, hasWide, wideA, wideB, wideC, relocOnB, raw, extBits);
	}
};

const rewriteNamedSlotRelocations = (
	code: Uint8Array,
	relocs: ReadonlyArray<ProgramConstReloc>,
	cartGlobalRemap: ReadonlyArray<number>,
	cartSystemGlobalRemap: ReadonlyArray<number>,
): void => {
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		if (reloc.kind !== 'gl' && reloc.kind !== 'sys') {
			continue;
		}
		const word = readInstructionWord(code, reloc.wordIndex);
		const op = (word >>> 18) & 0x3f;
		const mappedIndex = reloc.kind === 'gl'
			? cartGlobalRemap[reloc.constIndex]
			: cartSystemGlobalRemap[reloc.constIndex];
		rewriteResolvedABx(code, reloc.wordIndex, op, mappedIndex);
	}
};

const rewriteClosureIndices = (code: Uint8Array, protoOffset: number): void => {
	if (protoOffset === 0) {
		return;
	}
	const instructionCount = code.length / INSTRUCTION_BYTES;
	let wideIndex = -1;
	let wideA = 0;
	let wideB = 0;
	let wideC = 0;
	for (let index = 0; index < instructionCount; index += 1) {
		const word = readInstructionWord(code, index);
		const ext = word >>> 24;
		const op = (word >>> 18) & 0x3f;
		if (op === OpCode.WIDE) {
			wideIndex = index;
			wideA = (word >>> 12) & 0x3f;
			wideB = (word >>> 6) & 0x3f;
			wideC = word & 0x3f;
			continue;
		}
		if (op !== OpCode.CLOSURE) {
			wideIndex = -1;
			wideA = 0;
			wideB = 0;
			wideC = 0;
			continue;
		}
		const aLow = (word >>> 12) & 0x3f;
		const bLow = (word >>> 6) & 0x3f;
		const cLow = word & 0x3f;
		const bxLow = (bLow << 6) | cLow;
		const bx = (wideB << BASE_BX_BITS) | (ext << MAX_BX_BITS) | bxLow;
		const nextBx = bx + protoOffset;
		if (nextBx > MAX_EXT_BX) {
			throw new Error(`[ProgramLinker] Proto index exceeds range: ${nextBx}.`);
		}
		const nextWide = nextBx >> BASE_BX_BITS;
		if (nextWide !== 0 && wideIndex < 0) {
			throw new Error(`[ProgramLinker] Proto index ${nextBx} requires WIDE prefix.`);
		}
		const nextExt = (nextBx >> MAX_BX_BITS) & 0xff;
		const nextLow = nextBx & MAX_LOW_BX;
		writeInstruction(code, index, op, aLow, (nextLow >>> 6) & 0x3f, nextLow & 0x3f, nextExt);
		if (wideIndex >= 0) {
			writeInstruction(code, wideIndex, OpCode.WIDE, wideA, nextWide & 0x3f, wideC);
		}
		wideIndex = -1;
		wideA = 0;
		wideB = 0;
		wideC = 0;
	}
};


const mergeMetadata = (
	system: ProgramMetadata | undefined,
	cart: ProgramMetadata | undefined,
	layout: ProgramLayout,
	systemInstructionCount: number,
	cartInstructionCount: number,
): ProgramMetadata | null => {
	if (!system && !cart) {
		return null;
	}
	if (!system || !cart) {
		throw new Error('[ProgramLinker] Linking requires both system and cart symbols when symbols are provided.');
	}
	if (system.debugRanges.length !== systemInstructionCount) {
		throw new Error('[ProgramLinker] System debug range length mismatch.');
	}
	if (cart.debugRanges.length !== cartInstructionCount) {
		throw new Error('[ProgramLinker] Cart debug range length mismatch.');
	}
	const mergedSystemGlobals = mergeNamedSlots(system.systemGlobalNames, cart.systemGlobalNames);
	const mergedGlobals = mergeNamedSlots(system.globalNames, cart.globalNames);
	const systemBaseWord = layout.systemBasePc / INSTRUCTION_BYTES;
	const cartBaseWord = layout.cartBasePc / INSTRUCTION_BYTES;
	const totalInstructionCount = Math.max(
		systemBaseWord + systemInstructionCount,
		cartBaseWord + cartInstructionCount,
	);
	const debugRanges: Array<SourceRange | null> = new Array(totalInstructionCount);
	debugRanges.fill(null);
	for (let index = 0; index < systemInstructionCount; index += 1) {
		debugRanges[systemBaseWord + index] = system.debugRanges[index];
	}
	for (let index = 0; index < cartInstructionCount; index += 1) {
		debugRanges[cartBaseWord + index] = cart.debugRanges[index];
	}
	const protoIds: string[] = new Array(system.protoIds.length + cart.protoIds.length);
	for (let index = 0; index < system.protoIds.length; index += 1) {
		protoIds[index] = system.protoIds[index];
	}
	for (let index = 0; index < cart.protoIds.length; index += 1) {
		protoIds[system.protoIds.length + index] = cart.protoIds[index];
	}
	const localSlotsByProto: Array<ProgramMetadata['localSlotsByProto'][number]> = new Array(system.localSlotsByProto.length + cart.localSlotsByProto.length);
	for (let index = 0; index < system.localSlotsByProto.length; index += 1) {
		localSlotsByProto[index] = system.localSlotsByProto[index];
	}
	for (let index = 0; index < cart.localSlotsByProto.length; index += 1) {
		localSlotsByProto[system.localSlotsByProto.length + index] = cart.localSlotsByProto[index];
	}
	const upvalueNamesByProto: Array<ProgramMetadata['upvalueNamesByProto'][number]> = new Array(system.upvalueNamesByProto.length + cart.upvalueNamesByProto.length);
	for (let index = 0; index < system.upvalueNamesByProto.length; index += 1) {
		upvalueNamesByProto[index] = system.upvalueNamesByProto[index];
	}
	for (let index = 0; index < cart.upvalueNamesByProto.length; index += 1) {
		upvalueNamesByProto[system.upvalueNamesByProto.length + index] = cart.upvalueNamesByProto[index];
	}
	const exportProtoIdBySlot: ProgramMetadata['exportProtoIdBySlot'] = {};
	for (const slotName in system.exportProtoIdBySlot) {
		exportProtoIdBySlot[slotName] = system.exportProtoIdBySlot[slotName];
	}
	for (const slotName in cart.exportProtoIdBySlot) {
		exportProtoIdBySlot[slotName] = cart.exportProtoIdBySlot[slotName];
	}
	return {
		debugRanges,
		protoIds,
		localSlotsByProto,
		upvalueNamesByProto,
		systemGlobalNames: mergedSystemGlobals.names,
		globalNames: mergedGlobals.names,
		exportProtoIdBySlot,
	};
};



/*
	Emulated-machine linking note

	- This codebase targets a emulated-machine ABI where certain system ROM modules are compile-time
		descriptors (recorded in the program image's static module path list) rather than runtime
		Lua tables.
	- The compiler enforces that these compile-time modules are not treated as runtime values and
		lowers/validates uses (for example rejecting `local m = require('bios')`). When the compiler
		cannot resolve an export it emits an explicit symbolic relocation on the instruction
		(the relocation record owns the export-slot name). The linker MUST resolve these records
		into the final relocated operand or concrete
		machine-level access; they are not intended to be left as runtime values.
	- The linker's responsibility is to combine system and cart images and remap proto/const/global
		indices to the final layout while preserving metadata. Functions such as `rewriteClosureIndices`
		`rewriteConstPoolRelocations`, and `rewriteNamedSlotRelocations` update indices/operands
		and must preserve encoding semantics when rewriting the linked buffer.

*/

export const linkProgramImages = (
	systemImage: ProgramImage,
	systemSymbols: ProgramSymbolsImage | null,
	cartImage: ProgramImage,
	cartSymbols: ProgramSymbolsImage | null,
	systemBasePc: number = SYSTEM_BASE_PC,
	cartBasePc: number = CART_BASE_PC,
): LinkedProgramImage => {
	const systemText = systemImage.sections.text;
	const cartText = cartImage.sections.text;
	const systemRodata = systemImage.sections.rodata;
	const cartRodata = cartImage.sections.rodata;
	const systemData = systemImage.sections.data;
	const cartData = cartImage.sections.data;
	const systemBss = systemImage.sections.bss;
	const cartBss = cartImage.sections.bss;
	const systemConstRelocs = systemImage.link.constRelocs;
	const cartConstRelocs = cartImage.link.constRelocs;
	const baseProtoCount = systemText.protos.length;
	const systemCodeBytes = systemText.code.length;
	const cartCodeBytes = cartText.code.length;
	const systemInstructionCount = systemCodeBytes / INSTRUCTION_BYTES;
	const cartInstructionCount = cartCodeBytes / INSTRUCTION_BYTES;
	const resolvedLayout = resolveProgramLayout(systemCodeBytes, systemBasePc, cartBasePc);
	const systemDataByteCount = systemData.bytes.byteLength;
	const cartDataByteCount = cartData.bytes.byteLength;
	const linkedDataByteCount = systemDataByteCount + cartDataByteCount;
	const linkedBssByteCount = systemBss.byteCount + cartBss.byteCount;
	const systemDataBase = PROGRAM_STATIC_RAM_BASE;
	const cartDataBase = systemDataBase + systemDataByteCount;
	const systemBssBase = PROGRAM_STATIC_RAM_BASE + linkedDataByteCount;
	const cartBssBase = systemBssBase + systemBss.byteCount;
	assertStaticRamFits(PROGRAM_STATIC_RAM_BASE, linkedDataByteCount + linkedBssByteCount);
	const totalBytes = Math.max(
		resolvedLayout.systemBasePc + systemCodeBytes,
		resolvedLayout.cartBasePc + cartCodeBytes,
	);
	const systemRodataByteCount = systemRodata.bytes.byteLength;
	const cartRodataByteCount = cartRodata.bytes.byteLength;
	const linkedRodataByteCount = systemRodataByteCount + cartRodataByteCount;
	assertProgramRomFits(totalBytes + linkedRodataByteCount + linkedDataByteCount);
	const systemRodataBase = PROGRAM_ROM_BASE + totalBytes;
	const cartRodataBase = systemRodataBase + systemRodataByteCount;
	const systemDataLma = cartRodataBase + cartRodataByteCount;
	const cartDataLma = systemDataLma + systemDataByteCount;
	const code = new Uint8Array(totalBytes);
	code.set(systemText.code, resolvedLayout.systemBasePc);
	code.set(cartText.code, resolvedLayout.cartBasePc);
	writeInstructionWord(code, CART_PROGRAM_VECTOR_PC / INSTRUCTION_BYTES, CART_PROGRAM_VECTOR_VALUE);
	const systemCode = code.subarray(resolvedLayout.systemBasePc, resolvedLayout.systemBasePc + systemCodeBytes);
	const cartCode = code.subarray(resolvedLayout.cartBasePc, resolvedLayout.cartBasePc + cartCodeBytes);
	rewriteClosureIndices(cartCode, baseProtoCount);
	const mergedConsts = mergeConstPools(
		resolveConstValueRelocations(
			systemRodata.constPool,
			systemImage.link.constValueRelocs,
			systemData.symbols,
			systemDataBase,
			systemDataLma,
			systemBss.symbols,
			systemBssBase,
			systemRodata.symbols,
			systemRodataBase,
		),
		resolveConstValueRelocations(
			cartRodata.constPool,
			cartImage.link.constValueRelocs,
			cartData.symbols,
			cartDataBase,
			cartDataLma,
			cartBss.symbols,
			cartBssBase,
			cartRodata.symbols,
			cartRodataBase,
		),
	);
	const systemMetadata = systemSymbols;
	const cartMetadata = cartSymbols;

	// Module/export relocations are symbolic object-code records. The linker resolves
	// them for every input image before the program becomes executable.
	let systemNeedsSymbols = false;
	for (let index = 0; index < systemConstRelocs.length; index += 1) {
		if (relocRequiresSymbolMetadata(systemConstRelocs[index])) {
			systemNeedsSymbols = true;
			break;
		}
	}
	let cartNeedsSymbols = false;
	let cartNeedsMetadata = false;
	for (let index = 0; index < cartConstRelocs.length; index += 1) {
		const reloc = cartConstRelocs[index];
		if (relocRequiresSymbolMetadata(reloc)) {
			cartNeedsSymbols = true;
		}
		if (cartRelocRequiresMetadata(reloc)) {
			cartNeedsMetadata = true;
		}
		if (cartNeedsSymbols && cartNeedsMetadata) {
			break;
		}
	}
	if ((systemNeedsSymbols || cartNeedsMetadata) && !systemMetadata) {
		throw new Error('[ProgramLinker] Missing system symbols metadata required to resolve relocations.');
	}
	if (cartNeedsMetadata && !cartMetadata) {
		throw new Error('[ProgramLinker] Missing cart symbols metadata required to resolve cart relocations.');
	}

	if (systemNeedsSymbols) {
		const symbols = systemMetadata as ProgramMetadata;
		rewriteSymbolicConstRelocations(
			systemCode,
			systemConstRelocs,
			symbols.globalNames,
			symbols.systemGlobalNames,
			symbols.exportProtoIdBySlot,
			symbols.protoIds,
		);
	}
	rewriteConstPoolRelocations(
		cartCode,
		cartConstRelocs,
		mergedConsts.cartConstRemap,
	);
	if (cartNeedsMetadata) {
		const systemRelocMetadata = systemMetadata as ProgramMetadata;
		const cartRelocMetadata = cartMetadata as ProgramMetadata;
		const mergedSystemGlobals = mergeNamedSlots(systemRelocMetadata.systemGlobalNames, cartRelocMetadata.systemGlobalNames);
		const mergedGlobals = mergeNamedSlots(systemRelocMetadata.globalNames, cartRelocMetadata.globalNames);
		rewriteNamedSlotRelocations(
			cartCode,
			cartConstRelocs,
			mergedGlobals.cartRemap,
			mergedSystemGlobals.cartRemap,
		);
		if (cartNeedsSymbols) {
			const mergedExportProtoIdBySlot: ProgramMetadata['exportProtoIdBySlot'] = {};
			for (const slotName in systemRelocMetadata.exportProtoIdBySlot) {
				mergedExportProtoIdBySlot[slotName] = systemRelocMetadata.exportProtoIdBySlot[slotName];
			}
			for (const slotName in cartRelocMetadata.exportProtoIdBySlot) {
				mergedExportProtoIdBySlot[slotName] = cartRelocMetadata.exportProtoIdBySlot[slotName];
			}
			const mergedProtoIds: string[] = new Array(systemRelocMetadata.protoIds.length + cartRelocMetadata.protoIds.length);
			for (let index = 0; index < systemRelocMetadata.protoIds.length; index += 1) {
				mergedProtoIds[index] = systemRelocMetadata.protoIds[index];
			}
			for (let index = 0; index < cartRelocMetadata.protoIds.length; index += 1) {
				mergedProtoIds[systemRelocMetadata.protoIds.length + index] = cartRelocMetadata.protoIds[index];
			}
			rewriteSymbolicConstRelocations(
				cartCode,
				cartConstRelocs,
				mergedGlobals.names,
				mergedSystemGlobals.names,
				mergedExportProtoIdBySlot,
				mergedProtoIds,
			);
		}
	}


	const systemProtos = systemText.protos;
	const cartProtos = cartText.protos;
	const protos: Proto[] = new Array(systemProtos.length + cartProtos.length);
	let protoIndex = 0;
	for (let index = 0; index < systemProtos.length; index += 1) {
		const proto = systemProtos[index];
		protos[protoIndex] = {
			entryPC: proto.entryPC + resolvedLayout.systemBasePc,
			codeLen: proto.codeLen,
			numParams: proto.numParams,
			isVararg: proto.isVararg,
			maxStack: proto.maxStack,
			upvalueDescs: proto.upvalueDescs,
			staticClosure: proto.staticClosure,
		};
		protoIndex += 1;
	}
	for (let index = 0; index < cartProtos.length; index += 1) {
		const proto = cartProtos[index];
		protos[protoIndex] = {
			entryPC: proto.entryPC + resolvedLayout.cartBasePc,
			codeLen: proto.codeLen,
			numParams: proto.numParams,
			isVararg: proto.isVararg,
			maxStack: proto.maxStack,
			upvalueDescs: proto.upvalueDescs,
			staticClosure: proto.staticClosure,
		};
		protoIndex += 1;
	}

	const moduleProtos: ProgramModuleProto[] = new Array(cartRodata.moduleProtos.length + systemRodata.moduleProtos.length);
	let moduleProtoIndex = 0;
	for (let index = 0; index < cartRodata.moduleProtos.length; index += 1) {
		const entry = cartRodata.moduleProtos[index];
		moduleProtos[moduleProtoIndex] = { path: entry.path, protoIndex: entry.protoIndex + baseProtoCount };
		moduleProtoIndex += 1;
	}
	for (let index = 0; index < systemRodata.moduleProtos.length; index += 1) {
		const entry = systemRodata.moduleProtos[index];
		moduleProtos[moduleProtoIndex] = { path: entry.path, protoIndex: entry.protoIndex };
		moduleProtoIndex += 1;
	}
	const moduleExports: ProgramModuleExport[] = new Array(systemRodata.moduleExports.length + cartRodata.moduleExports.length);
	for (let index = 0; index < systemRodata.moduleExports.length; index += 1) {
		moduleExports[index] = systemRodata.moduleExports[index];
	}
	for (let index = 0; index < cartRodata.moduleExports.length; index += 1) {
		moduleExports[systemRodata.moduleExports.length + index] = cartRodata.moduleExports[index];
	}
	const systemStaticModulePaths = systemRodata.staticModulePaths;
	const cartStaticModulePaths = cartRodata.staticModulePaths;
	const staticModulePaths: string[] = new Array(systemStaticModulePaths.length + cartStaticModulePaths.length);
	for (let index = 0; index < systemStaticModulePaths.length; index += 1) {
		staticModulePaths[index] = systemStaticModulePaths[index];
	}
	for (let index = 0; index < cartStaticModulePaths.length; index += 1) {
		staticModulePaths[systemStaticModulePaths.length + index] = cartStaticModulePaths[index];
	}
	const rodataBytes = new Uint8Array(linkedRodataByteCount);
	rodataBytes.set(systemRodata.bytes, 0);
	rodataBytes.set(cartRodata.bytes, systemRodataByteCount);
	const dataBytes = new Uint8Array(linkedDataByteCount);
	dataBytes.set(systemData.bytes, 0);
	dataBytes.set(cartData.bytes, systemDataByteCount);
	const rodataSymbols: ProgramRodataSymbol[] = new Array(systemRodata.symbols.length + cartRodata.symbols.length);
	for (let index = 0; index < systemRodata.symbols.length; index += 1) {
		rodataSymbols[index] = systemRodata.symbols[index];
	}
	for (let index = 0; index < cartRodata.symbols.length; index += 1) {
		const symbol = cartRodata.symbols[index];
		rodataSymbols[systemRodata.symbols.length + index] = {
			name: symbol.name,
			offset: symbol.offset + systemRodataByteCount,
			byteCount: symbol.byteCount,
			alignment: symbol.alignment,
		};
	}
	const dataSymbols: ProgramDataSymbol[] = new Array(systemData.symbols.length + cartData.symbols.length);
	for (let index = 0; index < systemData.symbols.length; index += 1) {
		dataSymbols[index] = systemData.symbols[index];
	}
	for (let index = 0; index < cartData.symbols.length; index += 1) {
		const symbol = cartData.symbols[index];
		dataSymbols[systemData.symbols.length + index] = {
			name: symbol.name,
			offset: symbol.offset + systemDataByteCount,
			byteCount: symbol.byteCount,
			alignment: symbol.alignment,
		};
	}
	const bssSymbols: ProgramBssSymbol[] = new Array(systemBss.symbols.length + cartBss.symbols.length);
	for (let index = 0; index < systemBss.symbols.length; index += 1) {
		bssSymbols[index] = systemBss.symbols[index];
	}
	for (let index = 0; index < cartBss.symbols.length; index += 1) {
		const symbol = cartBss.symbols[index];
		bssSymbols[systemBss.symbols.length + index] = {
			name: symbol.name,
			offset: symbol.offset + systemBss.byteCount,
			byteCount: symbol.byteCount,
			alignment: symbol.alignment,
		};
	}
	const systemVectors = systemImage.vectors;
	const cartVectors = {
		resetProtoIndex: cartImage.vectors.resetProtoIndex + baseProtoCount,
		sectionInitProtoIndex: cartImage.vectors.sectionInitProtoIndex + baseProtoCount,
		irqProtoIndex: cartImage.vectors.irqProtoIndex + baseProtoCount,
	};
	const metadata = mergeMetadata(
		systemMetadata,
		cartMetadata,
		resolvedLayout,
		systemInstructionCount,
		cartInstructionCount,
	);

	const linkedProgramImage: ProgramImage = {
		vectors: cartVectors,
		sections: {
			text: {
				code,
				protos,
			},
			rodata: {
				constPool: mergedConsts.constPool,
				moduleProtos,
				moduleExports,
				staticModulePaths,
				bytes: rodataBytes,
				symbols: rodataSymbols,
			},
			data: {
				bytes: dataBytes,
				symbols: dataSymbols,
			},
			bss: {
				byteCount: linkedBssByteCount,
				symbols: bssSymbols,
			},
		},
		link: { constRelocs: [], constValueRelocs: [] },
	};

	return {
		programImage: linkedProgramImage,
		metadata,
		systemVectors,
		cartVectors,
		systemDataBaseAddress: systemDataBase,
		cartDataBaseAddress: cartDataBase,
		systemBssBaseAddress: systemBssBase,
		cartBssBaseAddress: cartBssBase,
		systemStaticModulePaths,
		cartStaticModulePaths,
	};
};

export const linkBootProgramImages = (
	systemImage: ProgramImage,
	systemSymbols: ProgramSymbolsImage | null,
	cartImage: ProgramImage,
	cartSymbols: ProgramSymbolsImage | null,
	bootTarget: ProgramBootTarget,
	systemBasePc: number = SYSTEM_BASE_PC,
	cartBasePc: number = CART_BASE_PC,
): LinkedBootProgramImage => {
	const linked = linkProgramImages(systemImage, systemSymbols, cartImage, cartSymbols, systemBasePc, cartBasePc);
	let vectors = linked.systemVectors;
	let dataBaseAddress = linked.systemDataBaseAddress;
	let bssBaseAddress = linked.systemBssBaseAddress;
	if (bootTarget === 'cart') {
		vectors = linked.cartVectors;
		dataBaseAddress = linked.cartDataBaseAddress;
		bssBaseAddress = linked.cartBssBaseAddress;
	}
	return {
		programImage: linked.programImage,
		metadata: linked.metadata,
		vectors,
		dataBaseAddress,
		bssBaseAddress,
		systemStaticModulePaths: linked.systemStaticModulePaths,
		cartVectors: linked.cartVectors,
		cartDataBaseAddress: linked.cartDataBaseAddress,
		cartBssBaseAddress: linked.cartBssBaseAddress,
		cartStaticModulePaths: linked.cartStaticModulePaths,
	};
};
// end repeated-sequence-acceptable
