import { OpCode, type ProgramMetadata, type Proto, type SourceRange } from './cpu';
import { INSTRUCTION_BYTES, MAX_EXT_BX, MAX_LOW_BX, readInstructionWord, writeInstruction } from './instruction_format';
import { resolveProgramLayout, type ProgramLayout } from './program_layout';
import type { EncodedProgram, VmProgramAsset, VmProgramSymbolsAsset } from './vm_program_asset';

type LinkedProgramAsset = {
	programAsset: VmProgramAsset;
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
		const bx = (wideB << 12) | (bLow << 6) | cLow;
		const nextBx = bx + protoOffset;
		if (nextBx > MAX_EXT_BX) {
			throw new Error(`[ProgramLinker] Proto index exceeds range: ${nextBx}.`);
		}
		const high = nextBx >> 12;
		if (high !== 0 && wideIndex < 0) {
			throw new Error(`[ProgramLinker] Proto index ${nextBx} requires WIDE prefix.`);
		}
		const low = nextBx & MAX_LOW_BX;
		writeInstruction(code, index, op, aLow, (low >>> 6) & 0x3f, low & 0x3f);
		if (wideIndex >= 0) {
			writeInstruction(code, wideIndex, OpCode.WIDE, wideA, high, wideC);
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
	const totalInstructionCount = Math.max(
		layout.engineBasePc + engineInstructionCount,
		layout.cartBasePc + cartInstructionCount,
	);
	const debugRanges: Array<SourceRange | null> = new Array(totalInstructionCount);
	debugRanges.fill(null);
	for (let index = 0; index < engineInstructionCount; index += 1) {
		debugRanges[layout.engineBasePc + index] = engine.debugRanges[index];
	}
	for (let index = 0; index < cartInstructionCount; index += 1) {
		debugRanges[layout.cartBasePc + index] = cart.debugRanges[index];
	}
	return {
		debugRanges,
		protoIds: engine.protoIds.concat(cart.protoIds),
	};
};

export const linkProgramAssets = (
	engineAsset: VmProgramAsset,
	engineSymbols: VmProgramSymbolsAsset | null,
	cartAsset: VmProgramAsset,
	cartSymbols: VmProgramSymbolsAsset | null,
	layout?: Partial<ProgramLayout>,
): LinkedProgramAsset => {
	const baseConstCount = assertConstPoolPrefix(engineAsset.program, cartAsset.program);
	const baseProtoCount = engineAsset.program.protos.length;
	const engineInstructionCount = engineAsset.program.code.length / INSTRUCTION_BYTES;
	const cartInstructionCount = cartAsset.program.code.length / INSTRUCTION_BYTES;
	const resolvedLayout = resolveProgramLayout(engineInstructionCount, layout);
	const cartCode = cartAsset.program.code.slice();
	rewriteClosureIndices(cartCode, baseProtoCount);

	const constPool = engineAsset.program.constPool.concat(cartAsset.program.constPool.slice(baseConstCount));
	const protos = engineAsset.program.protos.map(proto => cloneProto(proto, resolvedLayout.engineBasePc))
		.concat(cartAsset.program.protos.map(proto => cloneProto(proto, resolvedLayout.cartBasePc)));

	const totalInstructionCount = Math.max(
		resolvedLayout.engineBasePc + engineInstructionCount,
		resolvedLayout.cartBasePc + cartInstructionCount,
	);
	const code = new Uint8Array(totalInstructionCount * INSTRUCTION_BYTES);
	code.set(engineAsset.program.code, resolvedLayout.engineBasePc * INSTRUCTION_BYTES);
	code.set(cartCode, resolvedLayout.cartBasePc * INSTRUCTION_BYTES);

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
