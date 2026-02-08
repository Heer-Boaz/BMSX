import { OpCode, type ProgramMetadata, type Proto, type SourceRange } from './cpu';
import {
	EXT_BX_BITS,
	EXT_B_BITS,
	EXT_C_BITS,
	INSTRUCTION_BYTES,
	MAX_BX_BITS,
	MAX_EXT_BX,
	MAX_LOW_BX,
	MAX_OPERAND_BITS,
	readInstructionWord,
	writeInstruction,
} from './instruction_format';
import { resolveProgramLayout, type ProgramLayout } from './program_layout';
import type {
	EncodedProgram,
	EncodedValue,
	ProgramAsset,
	ProgramConstReloc,
	ProgramSymbolsAsset,
} from './program_asset';

type LinkedProgramAsset = {
	programAsset: ProgramAsset;
	metadata: ProgramMetadata | null;
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

const encodeSignedRaw = (value: number, bits: number): number => {
	const mask = (1 << bits) - 1;
	return value & mask;
};

const rewriteConstRelocations = (
	code: Uint8Array,
	relocs: ReadonlyArray<ProgramConstReloc>,
	cartConstRemap: ReadonlyArray<number>,
): void => {
	for (let index = 0; index < relocs.length; index += 1) {
		const reloc = relocs[index];
		const mappedConstIndex = cartConstRemap[reloc.constIndex];
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

		if (reloc.kind === 'bx') {
			const nextWide = mappedConstIndex >> (MAX_BX_BITS + EXT_BX_BITS);
			const nextExt = (mappedConstIndex >> MAX_BX_BITS) & 0xff;
			const nextLow = mappedConstIndex & MAX_LOW_BX;
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

		const relocOnB = reloc.kind === 'rk_b';
		const rkValue = -mappedConstIndex - 1;
		const extBits = relocOnB ? EXT_B_BITS : EXT_C_BITS;
		const totalBits = MAX_OPERAND_BITS + extBits + (hasWide ? MAX_OPERAND_BITS : 0);
		const raw = encodeSignedRaw(rkValue, totalBits);
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
		const bx = (wideB << (MAX_BX_BITS + EXT_BX_BITS)) | (ext << MAX_BX_BITS) | bxLow;
		const nextBx = bx + protoOffset;
		if (nextBx > MAX_EXT_BX) {
			throw new Error(`[ProgramLinker] Proto index exceeds range: ${nextBx}.`);
		}
		const nextWide = nextBx >> (MAX_BX_BITS + EXT_BX_BITS);
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

const mergeMetadata = (
	engine: ProgramMetadata | null,
	cart: ProgramMetadata | null,
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
	return {
		debugRanges,
		protoIds: engine.protoIds.concat(cart.protoIds),
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
	rewriteConstRelocations(cartCode, cartAsset.link.constRelocs, mergedConsts.cartConstRemap);

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
	const entryProtoIndex = cartAsset.entryProtoIndex + baseProtoCount;
	const metadata = mergeMetadata(
		engineSymbols ? engineSymbols.metadata : null,
		cartSymbols ? cartSymbols.metadata : null,
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
			link: { constRelocs: [] },
		},
		metadata,
	};
};
