// start repeated-sequence-acceptable -- Program linker rewrites packed instruction fields directly to preserve bit-level clarity.
import { OpCode, type ProgramMetadata, type Proto, type SourceRange, type LocalSlotDebug } from '../cpu/cpu';
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
} from '../cpu/instruction_format';
import { resolveProgramLayout, type ProgramLayout } from './layout';
import type {
	EncodedProgram,
	EncodedValue,
	ProgramAsset,
	ProgramConstReloc,
	ProgramSymbolsAsset,
} from './asset';
import { cloneSourceRange } from './source_range';

type LinkedProgramAsset = {
	programAsset: ProgramAsset;
	metadata: ProgramMetadata | null;
};

const NUMBER_KEY_BUFFER = new ArrayBuffer(8);
const NUMBER_KEY_VIEW = new DataView(NUMBER_KEY_BUFFER);
const NAN_KEY = 'n:0x7ff8000000000000';
const EMPTY_SLOT_NAMES: ReadonlyArray<string> = [];

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
	engineConstPool: ReadonlyArray<EncodedValue>,
	cartConstPool: ReadonlyArray<EncodedValue>,
): { constPool: EncodedValue[]; cartConstRemap: number[] } => {
	const constPool: EncodedValue[] = engineConstPool.slice();
	const keyToIndex = new Map<string, number>();
	for (let index = 0; index < engineConstPool.length; index += 1) {
		const key = makeConstKey(engineConstPool[index]);
		if (!keyToIndex.has(key)) {
			keyToIndex.set(key, index);
		}
	}
	const cartConstRemap: number[] = new Array(cartConstPool.length);
	for (let index = 0; index < cartConstPool.length; index += 1) {
		const value = cartConstPool[index];
		const key = makeConstKey(value);
		const existing = keyToIndex.get(key);
		if (existing !== undefined) {
			cartConstRemap[index] = existing;
			continue;
		}
		const nextIndex = constPool.length;
		constPool.push(value);
		keyToIndex.set(key, nextIndex);
		cartConstRemap[index] = nextIndex;
	}
	return { constPool, cartConstRemap };
};

const mergeNamedSlots = (
	engineNames: ReadonlyArray<string>,
	cartNames: ReadonlyArray<string>,
): { names: string[]; cartRemap: number[] } => {
	const names: string[] = engineNames.slice();
	const nameToIndex = new Map<string, number>();
	for (let index = 0; index < engineNames.length; index += 1) {
		const name = engineNames[index];
		if (!nameToIndex.has(name)) {
			nameToIndex.set(name, index);
		}
	}
	const cartRemap: number[] = new Array(cartNames.length);
	for (let index = 0; index < cartNames.length; index += 1) {
		const name = cartNames[index];
		const existing = nameToIndex.get(name);
		if (existing !== undefined) {
			cartRemap[index] = existing;
			continue;
		}
		const mergedIndex = names.length;
		names.push(name);
		nameToIndex.set(name, mergedIndex);
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

const rewriteConstRelocations = (
	code: Uint8Array,
	relocs: ReadonlyArray<ProgramConstReloc>,
	cartConstRemap: ReadonlyArray<number>,
	cartGlobalRemap: ReadonlyArray<number>,
	cartSystemGlobalRemap: ReadonlyArray<number>,
): void => {
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
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

		const mappedIndex = reloc.kind === 'gl'
			? cartGlobalRemap[reloc.constIndex]
			: reloc.kind === 'sys'
				? cartSystemGlobalRemap[reloc.constIndex]
				: cartConstRemap[reloc.constIndex];
		switch (reloc.kind) {
			case 'bx':
			case 'gl':
			case 'sys': {
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
			const low = mappedIndex & 0x3f;
			const extPartMask = (1 << extBits) - 1;
			const extPart = (mappedIndex >> MAX_OPERAND_BITS) & extPartMask;
			const widePart = mappedIndex >> baseBits;

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
			ext = (extA << 6) | (extB << 3) | extC;
			if (hasWide) {
				writeInstruction(code, wordIndex - 1, OpCode.WIDE, wideA, wideB, wideC);
			}
			writeInstruction(code, wordIndex, op, aLow, bLow, cLow, ext);
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
		const low = raw & 0x3f;
		const extPartMask = (1 << extBits) - 1;
		const extPart = (raw >> MAX_OPERAND_BITS) & extPartMask;
		const widePart = raw >> baseBits;

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
		ext = (extA << 6) | (extB << 3) | extC;
		if (hasWide) {
			writeInstruction(code, wordIndex - 1, OpCode.WIDE, wideA, wideB, wideC);
		}
		writeInstruction(code, wordIndex, op, aLow, bLow, cLow, ext);
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

const cloneProto = (proto: Proto, entryOffset: number): Proto => {
	const upvalueDescs = new Array(proto.upvalueDescs.length);
	for (let index = 0; index < proto.upvalueDescs.length; index += 1) {
		const desc = proto.upvalueDescs[index];
		upvalueDescs[index] = { inStack: desc.inStack, index: desc.index };
	}
	return {
		entryPC: proto.entryPC + entryOffset,
		codeLen: proto.codeLen,
		numParams: proto.numParams,
		isVararg: proto.isVararg,
		maxStack: proto.maxStack,
		upvalueDescs,
	};
};

const cloneLocalSlot = (slot: LocalSlotDebug): LocalSlotDebug => ({
	name: slot.name,
	register: slot.register,
	definition: cloneSourceRange(slot.definition),
	scope: cloneSourceRange(slot.scope),
});

const cloneLocalSlotsByProto = (
	metadata: ProgramMetadata,
	protoCount: number,
): LocalSlotDebug[][] => {
	const source = metadata.localSlotsByProto;
	const out: LocalSlotDebug[][] = new Array(protoCount);
	for (let index = 0; index < protoCount; index += 1) {
		const slots = source && source[index] ? source[index] : [];
		out[index] = slots.map(cloneLocalSlot);
	}
	return out;
};

const cloneUpvalueNamesByProto = (
	metadata: ProgramMetadata,
	protoCount: number,
): string[][] => {
	const source = metadata.upvalueNamesByProto;
	const out: string[][] = new Array(protoCount);
	for (let index = 0; index < protoCount; index += 1) {
		const names = source && source[index] ? source[index] : [];
		out[index] = Array.from(names);
	}
	return out;
};

const mergeMetadata = (
	engine: ProgramMetadata | undefined,
	cart: ProgramMetadata | undefined,
	layout: ProgramLayout,
	engineInstructionCount: number,
	cartInstructionCount: number,
): ProgramMetadata | null => {
	if (!engine && !cart) {
		return null;
	}
	if (!engine || !cart) {
		throw new Error('[ProgramLinker] Linking requires both engine and cart symbols when symbols are provided.');
	}
	if (engine.debugRanges.length !== engineInstructionCount) {
		throw new Error('[ProgramLinker] Engine debug range length mismatch.');
	}
	if (cart.debugRanges.length !== cartInstructionCount) {
		throw new Error('[ProgramLinker] Cart debug range length mismatch.');
	}
	const mergedSystemGlobals = mergeNamedSlots(engine.systemGlobalNames, cart.systemGlobalNames);
	const mergedGlobals = mergeNamedSlots(engine.globalNames, cart.globalNames);
	const engineBaseWord = layout.engineBasePc / INSTRUCTION_BYTES;
	const cartBaseWord = layout.cartBasePc / INSTRUCTION_BYTES;
	const totalInstructionCount = Math.max(
		engineBaseWord + engineInstructionCount,
		cartBaseWord + cartInstructionCount,
	);
	const debugRanges: Array<SourceRange | null> = new Array(totalInstructionCount);
	debugRanges.fill(null);
	for (let index = 0; index < engineInstructionCount; index += 1) {
		debugRanges[engineBaseWord + index] = engine.debugRanges[index];
	}
	for (let index = 0; index < cartInstructionCount; index += 1) {
		debugRanges[cartBaseWord + index] = cart.debugRanges[index];
	}
	const localSlotsByProto = cloneLocalSlotsByProto(engine, engine.protoIds.length)
		.concat(cloneLocalSlotsByProto(cart, cart.protoIds.length));
	return {
		debugRanges,
		protoIds: engine.protoIds.concat(cart.protoIds),
		localSlotsByProto,
		upvalueNamesByProto: cloneUpvalueNamesByProto(engine, engine.protoIds.length)
			.concat(cloneUpvalueNamesByProto(cart, cart.protoIds.length)),
		systemGlobalNames: mergedSystemGlobals.names,
		globalNames: mergedGlobals.names,
	};
};

export const linkProgramAssets = (
	engineAsset: ProgramAsset,
	engineSymbols: ProgramSymbolsAsset | null,
	cartAsset: ProgramAsset,
	cartSymbols: ProgramSymbolsAsset | null,
	layout?: Partial<ProgramLayout>,
): LinkedProgramAsset => {
	const baseProtoCount = engineAsset.program.protos.length;
	const engineCodeBytes = engineAsset.program.code.length;
	const cartCodeBytes = cartAsset.program.code.length;
	const engineInstructionCount = engineCodeBytes / INSTRUCTION_BYTES;
	const cartInstructionCount = cartCodeBytes / INSTRUCTION_BYTES;
	const resolvedLayout = resolveProgramLayout(engineCodeBytes, layout);
	const cartCode = cartAsset.program.code.slice();
	rewriteClosureIndices(cartCode, baseProtoCount);
	const mergedConsts = mergeConstPools(engineAsset.program.constPool, cartAsset.program.constPool);
	const engineMetadata = engineSymbols?.metadata;
	const cartMetadata = cartSymbols?.metadata;
	const mergedSystemGlobals = mergeNamedSlots(engineMetadata?.systemGlobalNames ?? EMPTY_SLOT_NAMES, cartMetadata?.systemGlobalNames ?? EMPTY_SLOT_NAMES);
	const mergedGlobals = mergeNamedSlots(engineMetadata?.globalNames ?? EMPTY_SLOT_NAMES, cartMetadata?.globalNames ?? EMPTY_SLOT_NAMES);
	rewriteConstRelocations(
		cartCode,
		cartAsset.link.constRelocs,
		mergedConsts.cartConstRemap,
		mergedGlobals.cartRemap,
		mergedSystemGlobals.cartRemap,
	);

	const protos = engineAsset.program.protos.map(proto => cloneProto(proto, resolvedLayout.engineBasePc))
		.concat(cartAsset.program.protos.map(proto => cloneProto(proto, resolvedLayout.cartBasePc)));

	const totalBytes = Math.max(
		resolvedLayout.engineBasePc + engineCodeBytes,
		resolvedLayout.cartBasePc + cartCodeBytes,
	);
	const code = new Uint8Array(totalBytes);
	code.set(engineAsset.program.code, resolvedLayout.engineBasePc);
	code.set(cartCode, resolvedLayout.cartBasePc);

	const program: EncodedProgram = {
		code,
		constPool: mergedConsts.constPool,
		protos,
	};

	const moduleProtos: Array<{ path: string; protoIndex: number }> = [];
	for (const entry of cartAsset.moduleProtos) {
		moduleProtos.push({ path: entry.path, protoIndex: entry.protoIndex + baseProtoCount });
	}
	for (const entry of engineAsset.moduleProtos) {
		moduleProtos.push({ path: entry.path, protoIndex: entry.protoIndex });
	}
	const moduleAliases = cartAsset.moduleAliases.concat(engineAsset.moduleAliases);
	const staticModulePaths = engineAsset.staticModulePaths.concat(cartAsset.staticModulePaths);
	const entryProtoIndex = cartAsset.entryProtoIndex + baseProtoCount;
	const metadata = mergeMetadata(
		engineMetadata,
		cartMetadata,
		resolvedLayout,
		engineInstructionCount,
		cartInstructionCount,
	);

	return {
		programAsset: {
			entryProtoIndex,
			program,
			moduleProtos,
			moduleAliases,
			staticModulePaths,
			link: { constRelocs: [] },
		},
		metadata,
	};
};
// end repeated-sequence-acceptable
