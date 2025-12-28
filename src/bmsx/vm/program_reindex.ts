import { OpCode, type Program, type Proto, type SourceRange } from './cpu';

const buildProtoIdIndex = (program: Program): Map<string, number> => {
	const map = new Map<string, number>();
	for (let index = 0; index < program.protoIds.length; index += 1) {
		map.set(program.protoIds[index], index);
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

const rewriteClosureIndices = (code: Uint32Array, indexMap: ReadonlyArray<number>): void => {
	for (let index = 0; index < code.length; index += 1) {
		const instr = code[index];
		const op = instr >>> 24;
		if (op !== OpCode.CLOSURE) {
			continue;
		}
		const a = (instr >>> 16) & 0xff;
		const bx = instr & 0xffff;
		const mapped = indexMap[bx];
		if (mapped === undefined) {
			throw new Error(`[ProgramReindex] Missing proto index mapping for ${bx}.`);
		}
		code[index] = ((op & 0xff) << 24) | (a << 16) | (mapped & 0xffff);
	}
};

const rebuildProgram = (
	program: Program,
	order: ReadonlyArray<string>,
	indexMap: ReadonlyArray<number>,
): Program => {
	const idToIndex = buildProtoIdIndex(program);
	let total = 0;
	const segments: Array<{ proto: Proto; code: Uint32Array; ranges: ReadonlyArray<SourceRange | null> }> = [];
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
		const ranges = program.debugRanges.slice(start, end);
		segments.push({ proto: cloneProto(proto), code, ranges });
		total += code.length;
	}

	const code = new Uint32Array(total);
	const debugRanges: Array<SourceRange | null> = new Array(total);
	let offset = 0;
	const protos: Proto[] = [];
	for (let index = 0; index < segments.length; index += 1) {
		const segment = segments[index];
		segment.proto.entryPC = offset;
		code.set(segment.code, offset);
		for (let rangeIndex = 0; rangeIndex < segment.ranges.length; rangeIndex += 1) {
			debugRanges[offset + rangeIndex] = segment.ranges[rangeIndex];
		}
		offset += segment.code.length;
		protos.push(segment.proto);
	}

	return {
		code,
		constPool: program.constPool,
		protos,
		debugRanges,
		protoIds: Array.from(order),
		stringPool: program.stringPool,
	};
};

export type ReindexedProgram = {
	program: Program;
	protoIdToIndex: Map<string, number>;
};

export const reindexProgram = (program: Program, desiredOrder: ReadonlyArray<string>): ReindexedProgram => {
	const incomingIds = program.protoIds;
	const incomingIdToIndex = buildProtoIdIndex(program);
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

	const rebuilt = rebuildProgram(program, finalOrder, indexMap);
	const protoIdToIndex = buildProtoIdIndex(rebuilt);
	return { program: rebuilt, protoIdToIndex };
};
