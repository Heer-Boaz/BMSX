import { OpCode, type Program, type ProgramMetadata, type Proto, type SourceRange, type LocalSlotDebug } from './cpu';
import { EXT_BX_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_EXT_BX, MAX_LOW_BX, readInstructionWord, writeInstruction } from './instruction_format';

const buildProtoIdIndex = (metadata: ProgramMetadata): Map<string, number> => {
	const map = new Map<string, number>();
	for (let index = 0; index < metadata.protoIds.length; index += 1) {
		map.set(metadata.protoIds[index], index);
	}
	return map;
};

const cloneProto = (proto: Proto): Proto => {
	const upvalueDescs = [];
	for (let index = 0; index < proto.upvalueDescs.length; index += 1) {
		const desc = proto.upvalueDescs[index];
		upvalueDescs.push({ inStack: desc.inStack, index: desc.index });
	}
	return {
		entryPC: 0,
		codeLen: proto.codeLen,
		numParams: proto.numParams,
		isVararg: proto.isVararg,
		maxStack: proto.maxStack,
		upvalueDescs,
	};
};

const cloneSourceRange = (range: SourceRange): SourceRange => ({
	path: range.path,
	start: { line: range.start.line, column: range.start.column },
	end: { line: range.end.line, column: range.end.column },
});

const cloneLocalSlot = (slot: LocalSlotDebug): LocalSlotDebug => ({
	name: slot.name,
	register: slot.register,
	definition: cloneSourceRange(slot.definition),
	scope: cloneSourceRange(slot.scope),
});

const cloneLocalSlotsByProto = (
	metadata: ProgramMetadata,
	order: ReadonlyArray<string>,
	idToIndex: Map<string, number>,
): LocalSlotDebug[][] => {
	const source = metadata.localSlotsByProto;
	const out: LocalSlotDebug[][] = new Array(order.length);
	for (let index = 0; index < order.length; index += 1) {
		const protoId = order[index];
		const oldIndex = idToIndex.get(protoId);
		const slots = source && oldIndex !== undefined && source[oldIndex] ? source[oldIndex] : [];
		out[index] = slots.map(cloneLocalSlot);
	}
	return out;
};

const rewriteClosureIndices = (code: Uint8Array, indexMap: ReadonlyArray<number>): void => {
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
		if (op === OpCode.CLOSURE) {
			const a = (word >>> 12) & 0x3f;
			const bLow = (word >>> 6) & 0x3f;
			const cLow = word & 0x3f;
			const bxLow = (bLow << 6) | cLow;
			const bx = (wideB << (MAX_BX_BITS + EXT_BX_BITS)) | (ext << MAX_BX_BITS) | bxLow;
			const mapped = indexMap[bx];
			if (mapped === undefined) {
				throw new Error(`[ProgramReindex] Missing proto index mapping for ${bx}.`);
			}
			if (mapped > MAX_EXT_BX) {
				throw new Error(`[ProgramReindex] Closure proto index exceeds range: ${mapped}.`);
			}
			const nextWide = mapped >> (MAX_BX_BITS + EXT_BX_BITS);
			const nextExt = (mapped >> MAX_BX_BITS) & 0xff;
			const low = mapped & MAX_LOW_BX;
			if (nextWide !== 0 && wideIndex < 0) {
				throw new Error(`[ProgramReindex] Closure proto index ${mapped} requires WIDE prefix.`);
			}
			writeInstruction(code, index, op, a, (low >>> 6) & 0x3f, low & 0x3f, nextExt);
			if (wideIndex >= 0) {
				writeInstruction(code, wideIndex, OpCode.WIDE, wideA, nextWide & 0x3f, wideC);
			}
		}
		wideIndex = -1;
		wideA = 0;
		wideB = 0;
		wideC = 0;
	}
};

const rebuildProgram = (
	program: Program,
	metadata: ProgramMetadata,
	order: ReadonlyArray<string>,
	indexMap: ReadonlyArray<number>,
): { program: Program; metadata: ProgramMetadata } => {
	const idToIndex = buildProtoIdIndex(metadata);
	let totalBytes = 0;
	let totalWords = 0;
	const segments: Array<{ proto: Proto; code: Uint8Array; ranges: ReadonlyArray<SourceRange | null> }> = [];
	for (let index = 0; index < order.length; index += 1) {
		const id = order[index];
		const protoIndex = idToIndex.get(id);
		if (protoIndex === undefined) {
			throw new Error(`[ProgramReindex] Missing proto '${id}'.`);
		}
		const proto = program.protos[protoIndex];
		const start = proto.entryPC;
		const end = start + proto.codeLen;
		const code = program.code.slice(start, end);
		rewriteClosureIndices(code, indexMap);
		const startWord = Math.floor(start / INSTRUCTION_BYTES);
		const endWord = Math.floor(end / INSTRUCTION_BYTES);
		const ranges = metadata.debugRanges.slice(startWord, endWord);
		segments.push({ proto: cloneProto(proto), code, ranges });
		totalBytes += code.length;
		totalWords += ranges.length;
	}

	const code = new Uint8Array(totalBytes);
	const debugRanges: Array<SourceRange | null> = new Array(totalWords);
	let offsetBytes = 0;
	let offsetWords = 0;
	const protos: Proto[] = [];
	for (let index = 0; index < segments.length; index += 1) {
		const segment = segments[index];
		segment.proto.entryPC = offsetBytes;
		code.set(segment.code, offsetBytes);
		for (let rangeIndex = 0; rangeIndex < segment.ranges.length; rangeIndex += 1) {
			debugRanges[offsetWords + rangeIndex] = segment.ranges[rangeIndex];
		}
		offsetBytes += segment.code.length;
		offsetWords += segment.ranges.length;
		protos.push(segment.proto);
	}

	return {
		program: {
			code,
			constPool: program.constPool,
			protos,
			stringPool: program.stringPool,
			constPoolStringPool: program.constPoolStringPool,
		},
		metadata: {
			debugRanges,
			protoIds: Array.from(order),
			localSlotsByProto: cloneLocalSlotsByProto(metadata, order, idToIndex),
		},
	};
};

export type ReindexedProgram = {
	program: Program;
	metadata: ProgramMetadata;
	protoIdToIndex: Map<string, number>;
};

export const reindexProgram = (program: Program, metadata: ProgramMetadata, desiredOrder: ReadonlyArray<string>): ReindexedProgram => {
	const incomingIds = metadata.protoIds;
	const incomingIdToIndex = buildProtoIdIndex(metadata);
	const desiredSet = new Set<string>();
	const finalOrder: string[] = [];
	for (let index = 0; index < desiredOrder.length; index += 1) {
		const id = desiredOrder[index];
		if (!incomingIdToIndex.has(id)) {
			continue;
		}
		desiredSet.add(id);
		finalOrder.push(id);
	}
	for (let index = 0; index < incomingIds.length; index += 1) {
		const id = incomingIds[index];
		if (!desiredSet.has(id)) {
			finalOrder.push(id);
		}
	}

	const indexMap: number[] = [];
	for (let index = 0; index < finalOrder.length; index += 1) {
		const id = finalOrder[index];
		const oldIndex = incomingIdToIndex.get(id);
		indexMap[oldIndex] = index;
	}

	const rebuilt = rebuildProgram(program, metadata, finalOrder, indexMap);
	const protoIdToIndex = buildProtoIdIndex(rebuilt.metadata);
	return { program: rebuilt.program, metadata: rebuilt.metadata, protoIdToIndex };
};
