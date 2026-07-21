import {
	OpCode,
	StringValue,
	asStringId,
	valueIsString,
	type Program,
	type ProgramMetadata,
	type ProgramModuleExport,
	type ProgramModuleProto,
	type ProgramRuntimeSymbols,
	type Proto,
	type SourceRange,
	type Value,
} from '../../machine/cpu/cpu';
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
} from '../../machine/cpu/instruction_format';
import type {
	ProgramBssSymbol,
	ProgramConstReloc,
	ProgramConstValueReloc,
	ProgramDataSymbol,
	ProgramObjectImage,
	ProgramRodataSymbol,
	ProgramStorageSymbol,
} from '../../lua/compiler/program_object';
import type {
	EncodedValue,
	ProgramImage,
	ProgramStaticLayoutToken,
	ProgramSymbolsImage,
	ProgramVectorTable,
} from '../../machine/program/loader';
import { PROGRAM_STATIC_RAM_BASE, RAM_END } from '../../machine/memory/map';
import { writeLE32 } from '../../common/endian';
import { fmix32 } from '../../machine/common/hash';
import { hashAssetId } from '../tokens';
import { mapChangedProtoProgramCounters, prepareProgramSourceRevisions } from './program_revision';

export type LinkedProgramImage = {
	image: ProgramImage;
	metadata: ProgramSymbolsImage | null;
};

export type LinkedProgramRevision = {
	program: Program;
	metadata: ProgramMetadata;
	vectors: ProgramVectorTable;
	pcRelocations: Int32Array;
};

const linkCartConstPool = (
	systemConstPool: ReadonlyArray<EncodedValue>,
	cartConstPool: ReadonlyArray<EncodedValue>,
): { appended: EncodedValue[]; remap: number[] } => {
	const appended: EncodedValue[] = [];
	const constSlotByValue = new Map<EncodedValue, number>();
	for (let index = 0; index < systemConstPool.length; index += 1) {
		const value = systemConstPool[index];
		if (!constSlotByValue.has(value)) {
			constSlotByValue.set(value, index);
		}
	}
	const remap: number[] = new Array(cartConstPool.length);
	for (let index = 0; index < cartConstPool.length; index += 1) {
		const value = cartConstPool[index];
		const slot = constSlotByValue.get(value);
		if (slot !== undefined) {
			remap[index] = slot;
			continue;
		}
		const nextIndex = systemConstPool.length + appended.length;
		appended.push(value);
		constSlotByValue.set(value, nextIndex);
		remap[index] = nextIndex;
	}
	return { appended, remap };
};

const assertStaticRamFits = (baseAddress: number, byteCount: number): void => {
	if (baseAddress > RAM_END || byteCount > RAM_END - baseAddress) {
		throw new Error(`[ProgramLinker] static RAM range ${baseAddress}+${byteCount} exceeds RAM end ${RAM_END}.`);
	}
};

const mixStaticLayoutWord = (token: ProgramStaticLayoutToken, value: number): void => {
	const word = value >>> 0;
	token.lo = fmix32(token.lo ^ word);
	token.hi = fmix32(token.hi ^ word ^ token.lo);
};

const mixStaticLayoutSection = (
	token: ProgramStaticLayoutToken,
	section: number,
	baseAddress: number,
	byteCount: number,
	symbols: ReadonlyArray<ProgramStorageSymbol>,
): void => {
	mixStaticLayoutWord(token, section);
	mixStaticLayoutWord(token, baseAddress);
	mixStaticLayoutWord(token, byteCount);
	mixStaticLayoutWord(token, symbols.length);
	for (let index = 0; index < symbols.length; index += 1) {
		const symbol = symbols[index];
		const nameToken = hashAssetId(symbol.name);
		mixStaticLayoutWord(token, nameToken.lo);
		mixStaticLayoutWord(token, nameToken.hi);
		mixStaticLayoutWord(token, symbol.offset);
		mixStaticLayoutWord(token, symbol.byteCount);
		mixStaticLayoutWord(token, symbol.alignment);
	}
};

const buildStaticLayoutToken = (
	rodataBaseAddress: number,
	rodataByteCount: number,
	rodataSymbols: ReadonlyArray<ProgramRodataSymbol>,
	dataBaseAddress: number,
	dataByteCount: number,
	dataSymbols: ReadonlyArray<ProgramDataSymbol>,
	bssBaseAddress: number,
	bssByteCount: number,
	bssSymbols: ReadonlyArray<ProgramBssSymbol>,
): ProgramStaticLayoutToken => {
	const token = { lo: 0x84222325, hi: 0xcbf29ce4 };
	mixStaticLayoutSection(token, 1, rodataBaseAddress, rodataByteCount, rodataSymbols);
	mixStaticLayoutSection(token, 2, dataBaseAddress, dataByteCount, dataSymbols);
	mixStaticLayoutSection(token, 3, bssBaseAddress, bssByteCount, bssSymbols);
	return token;
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
	constPool: EncodedValue[],
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
		return constPool;
	}
	const out = constPool.slice();
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		out[reloc.constIndex] = resolveConstValueRelocation(reloc, dataSymbols, dataBaseAddress, dataLmaAddress, bssSymbols, bssBaseAddress, rodataSymbols, rodataBaseAddress);
	}
	return out;
};

const mergeNamedSlots = (
	systemNames: string[],
	cartNames: ReadonlyArray<string>,
): { names: string[]; cartRemap: number[] } => {
	let names = systemNames;
	const slotByName = new Map<string, number>();
	for (let index = 0; index < systemNames.length; index += 1) {
		const name = systemNames[index];
		if (!slotByName.has(name)) {
			slotByName.set(name, index);
		}
	}
	const cartRemap: number[] = new Array(cartNames.length);
	for (let index = 0; index < cartNames.length; index += 1) {
		const name = cartNames[index];
		const slot = slotByName.get(name);
		if (slot !== undefined) {
			cartRemap[index] = slot;
			continue;
		}
		const mergedIndex = names.length;
		if (names === systemNames) {
			names = systemNames.slice();
		}
		names.push(name);
		slotByName.set(name, mergedIndex);
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
	globalSlotByName: ReadonlyMap<string, number>,
	systemGlobalSlotByName: ReadonlyMap<string, number>,
): { op: OpCode.GETGL | OpCode.GETSYS; slot: number } => {
	const globalSlot = globalSlotByName.get(slotName);
	if (globalSlot !== undefined) {
		return { op: OpCode.GETGL, slot: globalSlot };
	}
	const systemSlot = systemGlobalSlotByName.get(slotName);
	if (systemSlot !== undefined) {
		return { op: OpCode.GETSYS, slot: systemSlot };
	}
	throw new Error(`[ProgramLinker] Unable to resolve module export slot '${slotName}' during linking.`);
};

const indexNames = (names: ReadonlyArray<string>): Map<string, number> => {
	const indexByName = new Map<string, number>();
	for (let index = 0; index < names.length; index += 1) {
		indexByName.set(names[index], index);
	}
	return indexByName;
};

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
	globalSlotByName: ReadonlyMap<string, number>,
	systemGlobalSlotByName: ReadonlyMap<string, number>,
	exportProtoIdBySlot: { readonly [slotName: string]: string },
	protoIndexById: ReadonlyMap<string, number>,
): { op: number; value: number } => {
	const protoId = exportProtoIdBySlot[slotName];
	if (protoId !== undefined) {
		const protoIndex = protoIndexById.get(protoId);
		if (protoIndex === undefined) {
			throw new Error(`[ProgramLinker] export_proto reloc cannot resolve proto '${protoId}' for slot '${slotName}'.`);
		}
		return { op: OpCode.CLOSURE, value: protoIndex };
	}
	const resolvedSlot = resolveLinkedExportSlot(slotName, globalSlotByName, systemGlobalSlotByName);
	return { op: resolvedSlot.op, value: resolvedSlot.slot };
};

const rewriteSymbolicConstRelocations = (
	code: Uint8Array,
	relocs: ReadonlyArray<ProgramConstReloc>,
	globalSlotByName: ReadonlyMap<string, number>,
	systemGlobalSlotByName: ReadonlyMap<string, number>,
	exportProtoIdBySlot: { readonly [slotName: string]: string },
	protoIndexById: ReadonlyMap<string, number>,
): void => {
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		if (reloc.kind !== 'module' && reloc.kind !== 'export_proto') {
			continue;
		}
		if (reloc.kind === 'module') {
			const resolvedSlot = resolveLinkedExportSlot(reloc.symbol, globalSlotByName, systemGlobalSlotByName);
			rewriteResolvedABx(code, reloc.wordIndex, resolvedSlot.op, resolvedSlot.slot);
			continue;
		}
		const target = resolveExportProtoRelocTarget(reloc.symbol, globalSlotByName, systemGlobalSlotByName, exportProtoIdBySlot, protoIndexById);
		rewriteResolvedABx(code, reloc.wordIndex, target.op, target.value);
	}
};

const rewriteConstRelocations = (
	code: Uint8Array,
	relocs: ReadonlyArray<ProgramConstReloc>,
	constRemap: ReadonlyArray<number>,
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

		const mappedIndex = constRemap[reloc.constIndex];
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

const rewriteClosureIndices = (
	code: Uint8Array,
	protoOffset: number,
	protoRemap: ReadonlyArray<number> | null,
): void => {
	if (protoOffset === 0 && protoRemap === null) {
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
		const nextBx = protoRemap === null ? bx + protoOffset : protoRemap[bx];
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


const mergeRuntimeSymbols = (
	system: ProgramRuntimeSymbols,
	cart: ProgramRuntimeSymbols,
	systemGlobalNames: string[],
	globalNames: string[],
): ProgramRuntimeSymbols => {
	const protoIds: string[] = new Array(system.protoIds.length + cart.protoIds.length);
	for (let index = 0; index < system.protoIds.length; index += 1) {
		protoIds[index] = system.protoIds[index];
	}
	for (let index = 0; index < cart.protoIds.length; index += 1) {
		protoIds[system.protoIds.length + index] = cart.protoIds[index];
	}
	const exportProtoIdBySlot: ProgramRuntimeSymbols['exportProtoIdBySlot'] = {};
	for (const slotName in system.exportProtoIdBySlot) {
		exportProtoIdBySlot[slotName] = system.exportProtoIdBySlot[slotName];
	}
	for (const slotName in cart.exportProtoIdBySlot) {
		exportProtoIdBySlot[slotName] = cart.exportProtoIdBySlot[slotName];
	}
	return {
		protoIds,
		systemGlobalNames,
		globalNames,
		exportProtoIdBySlot,
	};
};

const mergeMetadata = (
	system: ProgramMetadata | null,
	cart: ProgramMetadata | null,
	runtimeSymbols: ProgramRuntimeSymbols,
	cartTextBasePc: number,
	systemInstructionCount: number,
	cartInstructionCount: number,
): ProgramMetadata | null => {
	if (system === null) {
		return null;
	}
	const cartMetadata = cart!;
	const cartBaseWord = cartTextBasePc / INSTRUCTION_BYTES;
	const debugRanges: Array<SourceRange | null> = new Array(cartBaseWord + cartInstructionCount);
	for (let index = 0; index < systemInstructionCount; index += 1) {
		debugRanges[index] = system.debugRanges[index];
	}
	for (let index = systemInstructionCount; index < cartBaseWord; index += 1) {
		debugRanges[index] = null;
	}
	for (let index = 0; index < cartInstructionCount; index += 1) {
		debugRanges[cartBaseWord + index] = cartMetadata.debugRanges[index];
	}
	const resumePointsByProto = system.resumePointsByProto.concat(cartMetadata.resumePointsByProto);
	const localSlotsByProto = system.localSlotsByProto.concat(cartMetadata.localSlotsByProto);
	const upvalueNamesByProto = system.upvalueNamesByProto.concat(cartMetadata.upvalueNamesByProto);
	return {
		debugRanges,
		protoIds: runtimeSymbols.protoIds,
		resumePointsByProto,
		localSlotsByProto,
		upvalueNamesByProto,
		systemGlobalNames: runtimeSymbols.systemGlobalNames,
		globalNames: runtimeSymbols.globalNames,
		exportProtoIdBySlot: runtimeSymbols.exportProtoIdBySlot,
	};
};

const mergeProgramConstPool = (
	base: Program,
	fresh: ReadonlyArray<EncodedValue>,
): { appended: EncodedValue[]; freshRemap: number[] } => {
	const constSlotByValue = new Map<EncodedValue, number>();
	for (let index = 0; index < base.constPool.length; index += 1) {
		const value = base.constPool[index];
		const encoded = valueIsString(value)
			? base.constPoolStringPool.toString(asStringId(value))
			: value as EncodedValue;
		if (!constSlotByValue.has(encoded)) {
			constSlotByValue.set(encoded, index);
		}
	}
	const freshRemap: number[] = new Array(fresh.length);
	const appended: EncodedValue[] = [];
	for (let index = 0; index < fresh.length; index += 1) {
		const value = fresh[index];
		const slot = constSlotByValue.get(value);
		if (slot !== undefined) {
			freshRemap[index] = slot;
			continue;
		}
		const nextIndex = base.constPool.length + appended.length;
		appended.push(value);
		constSlotByValue.set(value, nextIndex);
		freshRemap[index] = nextIndex;
	}
	return { appended, freshRemap };
};

const protoMatchesRevision = (
	baseProgram: Program,
	baseProto: Proto,
	freshCode: Uint8Array,
	freshProto: Proto,
): boolean => {
	if (baseProto.codeLen !== freshProto.codeLen
		|| baseProto.numParams !== freshProto.numParams
		|| baseProto.isVararg !== freshProto.isVararg
		|| baseProto.maxStack !== freshProto.maxStack
		|| baseProto.staticClosure !== freshProto.staticClosure) {
		return false;
	}
	for (let offset = 0; offset < freshProto.codeLen; offset += 1) {
		if (baseProgram.code[baseProto.entryPC + offset] !== freshCode[freshProto.entryPC + offset]) {
			return false;
		}
	}
	return true;
};

const closureLayoutMatchesRevision = (
	baseProto: Proto,
	baseUpvalueNames: ReadonlyArray<string>,
	freshProto: Proto,
	freshUpvalueNames: ReadonlyArray<string>,
): boolean => {
	if (baseProto.upvalueDescs.length !== freshProto.upvalueDescs.length
		|| baseUpvalueNames.length !== freshUpvalueNames.length) {
		return false;
	}
	for (let index = 0; index < baseProto.upvalueDescs.length; index += 1) {
		const baseUpvalue = baseProto.upvalueDescs[index];
		const freshUpvalue = freshProto.upvalueDescs[index];
		if (baseUpvalue.inStack !== freshUpvalue.inStack
			|| baseUpvalue.index !== freshUpvalue.index
			|| baseUpvalueNames[index] !== freshUpvalueNames[index]) {
			return false;
		}
	}
	return true;
};

const mergeRevisionModuleProtos = (
	base: ProgramModuleProto[],
	fresh: ReadonlyArray<ProgramModuleProto>,
	protoRemap: ReadonlyArray<number>,
): ProgramModuleProto[] => {
	let merged = base;
	const slotByPath = new Map<string, number>();
	for (let index = 0; index < merged.length; index += 1) {
		slotByPath.set(merged[index].path, index);
	}
	for (let index = 0; index < fresh.length; index += 1) {
		const entry = fresh[index];
		const mergedEntry = { path: entry.path, protoIndex: protoRemap[entry.protoIndex] };
		const slot = slotByPath.get(entry.path);
		if (slot === undefined) {
			if (merged === base) {
				merged = base.slice();
			}
			slotByPath.set(entry.path, merged.length);
			merged.push(mergedEntry);
		} else if (merged[slot].protoIndex !== mergedEntry.protoIndex) {
			if (merged === base) {
				merged = base.slice();
			}
			merged[slot] = mergedEntry;
		}
	}
	return merged;
};

const mergeRevisionModuleExports = (
	base: ProgramModuleExport[],
	fresh: ReadonlyArray<ProgramModuleExport>,
): ProgramModuleExport[] => {
	let merged = base;
	const slotByExport = new Map<string, number>();
	for (let index = 0; index < merged.length; index += 1) {
		const entry = merged[index];
		slotByExport.set(`${entry.path}\0${entry.exportPathKey}`, index);
	}
	for (let index = 0; index < fresh.length; index += 1) {
		const entry = fresh[index];
		const key = `${entry.path}\0${entry.exportPathKey}`;
		const slot = slotByExport.get(key);
		if (slot === undefined) {
			if (merged === base) {
				merged = base.slice();
			}
			slotByExport.set(key, merged.length);
			merged.push(entry);
		} else if (merged[slot].slotName !== entry.slotName) {
			if (merged === base) {
				merged = base.slice();
			}
			merged[slot] = entry;
		}
	}
	return merged;
};

export function linkProgramRevision(
	baseProgram: Program,
	baseMetadata: ProgramMetadata,
	object: ProgramObjectImage,
	objectMetadata: ProgramMetadata,
	finalImage: ProgramImage,
	programAddress: number,
	previousSources: ReadonlyMap<string, string>,
	sources: ReadonlyMap<string, string>,
): LinkedProgramRevision {
	const text = object.sections.text;
	const rodata = object.sections.rodata;
	const data = object.sections.data;
	const bss = object.sections.bss;
	const rodataBaseAddress = programAddress;
	const dataLmaAddress = rodataBaseAddress + rodata.bytes.byteLength;
	const resolvedConstPool = resolveConstValueRelocations(
		rodata.constPool,
		object.link.constValueRelocs,
		data.symbols,
		finalImage.placement.dataBaseAddress,
		dataLmaAddress,
		bss.symbols,
		finalImage.placement.bssBaseAddress,
		rodata.symbols,
		rodataBaseAddress,
	);

	let protoIds = baseMetadata.protoIds;
	const protoIndexById = indexNames(protoIds);
	const protoRemap: number[] = new Array(object.link.symbols.protoIds.length);
	for (let index = 0; index < object.link.symbols.protoIds.length; index += 1) {
		const protoId = object.link.symbols.protoIds[index];
		const existing = protoIndexById.get(protoId);
		if (existing !== undefined) {
			if (!closureLayoutMatchesRevision(
				baseProgram.protos[existing],
				baseMetadata.upvalueNamesByProto[existing],
				text.protos[index],
				objectMetadata.upvalueNamesByProto[index],
			)) {
				throw new Error(`[ProgramLinker] Hot resume cannot change captured upvalues for proto '${protoId}'.`);
			}
			protoRemap[index] = existing;
			continue;
		}
		if (protoIds === baseMetadata.protoIds) {
			protoIds = baseMetadata.protoIds.slice();
		}
		const nextIndex = protoIds.length;
		protoIds.push(protoId);
		protoIndexById.set(protoId, nextIndex);
		protoRemap[index] = nextIndex;
	}
	const mergedConsts = mergeProgramConstPool(baseProgram, resolvedConstPool);
	const mergedSystemGlobals = mergeNamedSlots(baseMetadata.systemGlobalNames, object.link.symbols.systemGlobalNames);
	const mergedGlobals = mergeNamedSlots(baseMetadata.globalNames, object.link.symbols.globalNames);

	let exportProtoIdBySlot = baseMetadata.exportProtoIdBySlot;
	for (const slotName in object.link.symbols.exportProtoIdBySlot) {
		const protoId = object.link.symbols.exportProtoIdBySlot[slotName];
		if (exportProtoIdBySlot[slotName] === protoId) {
			continue;
		}
		if (exportProtoIdBySlot === baseMetadata.exportProtoIdBySlot) {
			exportProtoIdBySlot = { ...baseMetadata.exportProtoIdBySlot };
		}
		exportProtoIdBySlot[slotName] = protoId;
	}

	const relocatedCode = text.code.slice();
	rewriteClosureIndices(relocatedCode, 0, protoRemap);
	rewriteConstRelocations(relocatedCode, object.link.constRelocs, mergedConsts.freshRemap);
	rewriteNamedSlotRelocations(relocatedCode, object.link.constRelocs, mergedGlobals.cartRemap, mergedSystemGlobals.cartRemap);
	rewriteSymbolicConstRelocations(
		relocatedCode,
		object.link.constRelocs,
		indexNames(mergedGlobals.names),
		indexNames(mergedSystemGlobals.names),
		exportProtoIdBySlot,
		protoIndexById,
	);

	const changedProtos = new Uint8Array(text.protos.length);
	let appendedByteCount = 0;
	for (let index = 0; index < text.protos.length; index += 1) {
		const liveIndex = protoRemap[index];
		if (liveIndex >= baseProgram.protos.length
			|| !protoMatchesRevision(baseProgram, baseProgram.protos[liveIndex], relocatedCode, text.protos[index])) {
			changedProtos[index] = 1;
			appendedByteCount += text.protos[index].codeLen;
		}
	}
	const pcRelocations = new Int32Array(baseProgram.code.byteLength / INSTRUCTION_BYTES);
	for (let word = 0; word < pcRelocations.length; word += 1) {
		pcRelocations[word] = word * INSTRUCTION_BYTES;
	}
	const preparedSourceRevisions = prepareProgramSourceRevisions(previousSources, sources);

	const code = appendedByteCount === 0
		? baseProgram.code
		: new Uint8Array(baseProgram.code.byteLength + appendedByteCount);
	if (appendedByteCount !== 0) {
		code.set(baseProgram.code, 0);
	}
	const protos = appendedByteCount === 0 ? baseProgram.protos : baseProgram.protos.slice();
	if (appendedByteCount !== 0) {
		protos.length = protoIds.length;
	}
	const debugRanges: Array<SourceRange | null> = new Array(code.byteLength / INSTRUCTION_BYTES).fill(null);
	for (let index = 0; index < baseMetadata.debugRanges.length; index += 1) {
		debugRanges[index] = baseMetadata.debugRanges[index];
	}
	const localSlotsByProto = baseMetadata.localSlotsByProto.slice();
	localSlotsByProto.length = protoIds.length;
	const resumePointsByProto = baseMetadata.resumePointsByProto.slice();
	resumePointsByProto.length = protoIds.length;
	const upvalueNamesByProto = baseMetadata.upvalueNamesByProto.slice();
	upvalueNamesByProto.length = protoIds.length;
	let appendOffset = baseProgram.code.byteLength;
	for (let index = 0; index < text.protos.length; index += 1) {
		const freshProto = text.protos[index];
		const liveIndex = protoRemap[index];
		let entryPC: number;
		if (changedProtos[index] !== 0) {
			entryPC = appendOffset;
			code.set(
				relocatedCode.subarray(freshProto.entryPC, freshProto.entryPC + freshProto.codeLen),
				entryPC,
			);
			appendOffset += freshProto.codeLen;
			protos[liveIndex] = {
				entryPC,
				codeLen: freshProto.codeLen,
				numParams: freshProto.numParams,
				isVararg: freshProto.isVararg,
				maxStack: freshProto.maxStack,
				upvalueDescs: freshProto.upvalueDescs,
				staticClosure: freshProto.staticClosure,
			};
			if (liveIndex < baseProgram.protos.length) {
				mapChangedProtoProgramCounters(
					pcRelocations,
					baseProgram,
					baseMetadata,
					liveIndex,
					objectMetadata,
					index,
					entryPC,
					preparedSourceRevisions,
				);
			}
		} else {
			entryPC = protos[liveIndex].entryPC;
		}
		const sourceWord = freshProto.entryPC / INSTRUCTION_BYTES;
		const targetWord = entryPC / INSTRUCTION_BYTES;
		const wordCount = freshProto.codeLen / INSTRUCTION_BYTES;
		for (let word = 0; word < wordCount; word += 1) {
			debugRanges[targetWord + word] = objectMetadata.debugRanges[sourceWord + word];
		}
		resumePointsByProto[liveIndex] = objectMetadata.resumePointsByProto[index];
		localSlotsByProto[liveIndex] = objectMetadata.localSlotsByProto[index];
		upvalueNamesByProto[liveIndex] = objectMetadata.upvalueNamesByProto[index];
	}

	const moduleProtos = mergeRevisionModuleProtos(baseProgram.moduleProtos, rodata.moduleProtos, protoRemap);
	let moduleProtoMap = baseProgram.moduleProtoMap;
	if (moduleProtos !== baseProgram.moduleProtos) {
		moduleProtoMap = new Map<string, number>();
		for (let index = 0; index < moduleProtos.length; index += 1) {
			const entry = moduleProtos[index];
			moduleProtoMap.set(entry.path, entry.protoIndex);
		}
	}
	const moduleExports = mergeRevisionModuleExports(baseProgram.moduleExports, rodata.moduleExports);
	let constPool = baseProgram.constPool;
	if (mergedConsts.appended.length !== 0) {
		constPool = new Array<Value>(baseProgram.constPool.length + mergedConsts.appended.length);
		for (let index = 0; index < baseProgram.constPool.length; index += 1) {
			constPool[index] = baseProgram.constPool[index];
		}
		for (let index = 0; index < mergedConsts.appended.length; index += 1) {
			const value = mergedConsts.appended[index];
			constPool[baseProgram.constPool.length + index] = typeof value === 'string'
				? StringValue.get(baseProgram.constPoolStringPool.intern(value, false))
				: value;
		}
	}
	const metadata: ProgramMetadata = {
		debugRanges,
		protoIds,
		resumePointsByProto,
		localSlotsByProto,
		upvalueNamesByProto,
		systemGlobalNames: mergedSystemGlobals.names,
		globalNames: mergedGlobals.names,
		exportProtoIdBySlot,
	};
	const program = code === baseProgram.code
		&& constPool === baseProgram.constPool
		&& protos === baseProgram.protos
		&& moduleProtos === baseProgram.moduleProtos
		&& moduleExports === baseProgram.moduleExports
		? baseProgram
		: {
			code,
			constPool,
			protos,
			moduleProtos,
			moduleExports,
			moduleProtoMap,
			stringPool: baseProgram.stringPool,
			constPoolStringPool: baseProgram.constPoolStringPool,
		};
	return {
		program,
		metadata,
		pcRelocations,
		vectors: {
			resetProtoIndex: protoRemap[object.vectors.resetProtoIndex],
			sectionInitProtoIndex: protoRemap[object.vectors.sectionInitProtoIndex],
			irqProtoIndex: protoRemap[object.vectors.irqProtoIndex],
			exceptionProtoIndex: protoRemap[object.vectors.exceptionProtoIndex],
		},
	};
}

export function linkSystemProgramImage(
	object: ProgramObjectImage,
	metadata: ProgramSymbolsImage | null,
	programAddress: number,
): LinkedProgramImage {
	const text = object.sections.text;
	const rodata = object.sections.rodata;
	const data = object.sections.data;
	const bss = object.sections.bss;
	const dataBaseAddress = PROGRAM_STATIC_RAM_BASE;
	const bssBaseAddress = dataBaseAddress + data.bytes.byteLength;
	assertStaticRamFits(PROGRAM_STATIC_RAM_BASE, data.bytes.byteLength + bss.byteCount);
	const rodataAddress = programAddress;
	const dataLmaAddress = rodataAddress + rodata.bytes.byteLength;

	const constPool = resolveConstValueRelocations(
		rodata.constPool,
		object.link.constValueRelocs,
		data.symbols,
		dataBaseAddress,
		dataLmaAddress,
		bss.symbols,
		bssBaseAddress,
		rodata.symbols,
		rodataAddress,
	);
	const code = text.code.slice();
	rewriteSymbolicConstRelocations(
		code,
		object.link.constRelocs,
		indexNames(object.link.symbols.globalNames),
		indexNames(object.link.symbols.systemGlobalNames),
		object.link.symbols.exportProtoIdBySlot,
		indexNames(object.link.symbols.protoIds),
	);
	const rodataBytes = rodata.bytes;

	return {
		image: {
			placement: {
				textBasePc: 0,
				constBaseIndex: 0,
				protoBaseIndex: 0,
				dataBaseAddress,
				bssBaseAddress,
			},
			staticLayoutToken: buildStaticLayoutToken(
				rodataAddress,
				rodata.bytes.byteLength,
				rodata.symbols,
				dataBaseAddress,
				data.bytes.byteLength,
				data.symbols,
				bssBaseAddress,
				bss.byteCount,
				bss.symbols,
			),
			vectors: object.vectors,
			sections: {
				text: { code, protos: text.protos },
				rodata: {
					constPool,
					moduleProtos: rodata.moduleProtos,
					moduleExports: rodata.moduleExports,
					staticModulePaths: rodata.staticModulePaths,
					bytes: rodataBytes,
				},
				data: { bytes: data.bytes },
				bss: { byteCount: bss.byteCount },
			},
			symbols: object.link.symbols,
		},
		metadata,
	};
}

export function linkCartProgramImage(
	systemImage: ProgramImage,
	systemMetadata: ProgramSymbolsImage | null,
	object: ProgramObjectImage,
	cartMetadata: ProgramSymbolsImage | null,
	programAddress: number,
): LinkedProgramImage {
	const text = object.sections.text;
	const rodata = object.sections.rodata;
	const data = object.sections.data;
	const bss = object.sections.bss;
	const textBasePc = systemImage.sections.text.code.byteLength;
	const protoBaseIndex = systemImage.sections.text.protos.length;
	const constBaseIndex = systemImage.sections.rodata.constPool.length;
	const dataBaseAddress = systemImage.placement.bssBaseAddress + systemImage.sections.bss.byteCount;
	const bssBaseAddress = dataBaseAddress + data.bytes.byteLength;
	assertStaticRamFits(PROGRAM_STATIC_RAM_BASE, bssBaseAddress + bss.byteCount - PROGRAM_STATIC_RAM_BASE);
	const rodataAddress = programAddress;
	const dataLmaAddress = rodataAddress + rodata.bytes.byteLength;

	const resolvedCartConstPool = resolveConstValueRelocations(
		rodata.constPool,
		object.link.constValueRelocs,
		data.symbols,
		dataBaseAddress,
		dataLmaAddress,
		bss.symbols,
		bssBaseAddress,
		rodata.symbols,
		rodataAddress,
	);
	const cartConsts = linkCartConstPool(systemImage.sections.rodata.constPool, resolvedCartConstPool);
	const mergedSystemGlobals = mergeNamedSlots(systemImage.symbols.systemGlobalNames, object.link.symbols.systemGlobalNames);
	const mergedGlobals = mergeNamedSlots(systemImage.symbols.globalNames, object.link.symbols.globalNames);
	const runtimeSymbols = mergeRuntimeSymbols(systemImage.symbols, object.link.symbols, mergedSystemGlobals.names, mergedGlobals.names);
	const code = text.code.slice();
	rewriteClosureIndices(code, protoBaseIndex, null);
	rewriteConstRelocations(code, object.link.constRelocs, cartConsts.remap);
	rewriteNamedSlotRelocations(code, object.link.constRelocs, mergedGlobals.cartRemap, mergedSystemGlobals.cartRemap);
	rewriteSymbolicConstRelocations(
		code,
		object.link.constRelocs,
		indexNames(mergedGlobals.names),
		indexNames(mergedSystemGlobals.names),
		runtimeSymbols.exportProtoIdBySlot,
		indexNames(runtimeSymbols.protoIds),
	);

	const protos: Proto[] = new Array(text.protos.length);
	for (let index = 0; index < text.protos.length; index += 1) {
		const proto = text.protos[index];
		protos[index] = {
			entryPC: proto.entryPC + textBasePc,
			codeLen: proto.codeLen,
			numParams: proto.numParams,
			isVararg: proto.isVararg,
			maxStack: proto.maxStack,
			upvalueDescs: proto.upvalueDescs,
			staticClosure: proto.staticClosure,
		};
	}
	const moduleProtos: ProgramModuleProto[] = new Array(rodata.moduleProtos.length);
	for (let index = 0; index < rodata.moduleProtos.length; index += 1) {
		const entry = rodata.moduleProtos[index];
		moduleProtos[index] = { path: entry.path, protoIndex: entry.protoIndex + protoBaseIndex };
	}
	const rodataBytes = rodata.bytes.slice();
	for (let index = 0; index < object.link.rodataConstRelocs.length; index += 1) {
		const reloc = object.link.rodataConstRelocs[index];
		writeLE32(rodataBytes, reloc.byteOffset, cartConsts.remap[reloc.constIndex]);
	}
	const vectors = {
		resetProtoIndex: object.vectors.resetProtoIndex + protoBaseIndex,
		sectionInitProtoIndex: object.vectors.sectionInitProtoIndex + protoBaseIndex,
		irqProtoIndex: object.vectors.irqProtoIndex + protoBaseIndex,
		exceptionProtoIndex: object.vectors.exceptionProtoIndex + protoBaseIndex,
	};
	const metadata = mergeMetadata(
		systemMetadata,
		cartMetadata,
		runtimeSymbols,
		textBasePc,
		systemImage.sections.text.code.byteLength / INSTRUCTION_BYTES,
		text.code.byteLength / INSTRUCTION_BYTES,
	);

	return {
		image: {
			placement: {
				textBasePc,
				constBaseIndex,
				protoBaseIndex,
				dataBaseAddress,
				bssBaseAddress,
			},
			staticLayoutToken: buildStaticLayoutToken(
				rodataAddress,
				rodata.bytes.byteLength,
				rodata.symbols,
				dataBaseAddress,
				data.bytes.byteLength,
				data.symbols,
				bssBaseAddress,
				bss.byteCount,
				bss.symbols,
			),
			vectors,
			sections: {
				text: { code, protos },
				rodata: {
					constPool: cartConsts.appended,
					moduleProtos,
					moduleExports: rodata.moduleExports,
					staticModulePaths: rodata.staticModulePaths,
					bytes: rodataBytes,
				},
				data: { bytes: data.bytes },
				bss: { byteCount: bss.byteCount },
			},
			symbols: runtimeSymbols,
		},
		metadata,
	};
}
