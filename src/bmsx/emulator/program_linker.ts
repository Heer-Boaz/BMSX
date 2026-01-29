import { OpCode, type ProgramMetadata, type Proto, type SourceRange } from './cpu';
import { EXT_BX_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_EXT_BX, MAX_LOW_BX, readInstructionWord, writeInstruction } from './instruction_format';
import { resolveProgramLayout, type ProgramLayout } from './program_layout';
import type { EncodedProgram, ProgramAsset, ProgramSymbolsAsset } from './program_asset';

type LinkedProgramAsset = {
	programAsset: ProgramAsset;
	metadata: ProgramMetadata | null;
};

const assertConstPoolPrefix = (engine: EncodedProgram, cart: EncodedProgram): number => {
	const engineCount = engine.constPool.length;
	if (cart.constPool.length < engineCount) {
		throw new Error('[ProgramLinker] Cart const pool does not include engine prefix.');
	}
	for (let index = 0; index < engineCount; index += 1) {
		const baseValue = engine.constPool[index];
		const cartValue = cart.constPool[index];
		if (!Object.is(baseValue, cartValue)) {
			throw new Error(`[ProgramLinker] Cart const pool differs at index ${index}.`);
		}
	}
	return engineCount;
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
	const baseConstCount = assertConstPoolPrefix(engineAsset.program, cartAsset.program);
	const baseProtoCount = engineAsset.program.protos.length;
	const engineCodeBytes = engineAsset.program.code.length;
	const cartCodeBytes = cartAsset.program.code.length;
	const engineInstructionCount = engineCodeBytes / INSTRUCTION_BYTES;
	const cartInstructionCount = cartCodeBytes / INSTRUCTION_BYTES;
	const resolvedLayout = resolveProgramLayout(engineCodeBytes, layout);
	const cartCode = cartAsset.program.code.slice();
	rewriteClosureIndices(cartCode, baseProtoCount);

	const constPool = engineAsset.program.constPool.concat(cartAsset.program.constPool.slice(baseConstCount));
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
		constPool,
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
		},
		metadata,
	};
};
