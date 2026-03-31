import { OpCode, type Proto, type SourceRange, type UpvalueDesc, type Value } from './cpu';
import { MAX_EXT_CONST } from './instruction_format';
import { isStringValue, stringValueToString } from './string_pool';
import { applyGlobalOptimizations } from './program_optimizer_ssa';

export type InstructionFormat = 'ABC' | 'ABx' | 'AsBx';

export type Instruction = {
	op: OpCode;
	a: number;
	b: number;
	c: number;
	format: InstructionFormat;
	rkMask: number;
	target: number | null;
};

export type OptimizationLevel = 0 | 1 | 2 | 3;

type OptimizationProtoMeta = Pick<Proto, 'numParams' | 'isVararg' | 'maxStack' | 'upvalueDescs'>;

export type OptimizationContext = {
	constPool: ReadonlyArray<Value>;
	constIndex: (value: Value) => number;
	getClosureUpvalues: (protoIndex: number) => ReadonlyArray<UpvalueDesc>;
	getProtoMeta: (protoIndex: number) => OptimizationProtoMeta;
	getProtoInstructionSet: (protoIndex: number) => InstructionSet | null;
};

export type InstructionSet = {
	instructions: Instruction[];
	ranges: Array<SourceRange | null>;
};

type Block = {
	start: number;
	end: number;
};

type ConstValue = {
	value: Value;
	constIndex: number | null;
};

const RK_B = 1;
const RK_C = 2;

const isJump = (instruction: Instruction): boolean =>
	instruction.op === OpCode.JMP || instruction.op === OpCode.JMPIF || instruction.op === OpCode.JMPIFNOT;

const isSkipInstruction = (instruction: Instruction): boolean => {
	if (instruction.op === OpCode.LOADBOOL) {
		return instruction.c !== 0;
	}
	return instruction.op === OpCode.TEST
		|| instruction.op === OpCode.TESTSET
		|| instruction.op === OpCode.EQ
		|| instruction.op === OpCode.LT
		|| instruction.op === OpCode.LE;
};

const getJumpTarget = (instruction: Instruction): number => {
	if (instruction.target === null) {
		throw new Error('[ProgramOptimizer] Jump target is missing.');
	}
	return instruction.target;
};

const isTruthy = (value: Value): boolean => value !== null && value !== false;

const isConstPoolValue = (value: Value): boolean =>
	value === null || typeof value === 'boolean' || typeof value === 'number' || isStringValue(value);

const replaceWithJump = (instruction: Instruction, target: number): void => {
	instruction.op = OpCode.JMP;
	instruction.a = 0;
	instruction.b = 0;
	instruction.c = 0;
	instruction.format = 'AsBx';
	instruction.rkMask = 0;
	instruction.target = target;
};

const replaceWithMov = (instruction: Instruction, dst: number, src: number): void => {
	instruction.op = OpCode.MOV;
	instruction.a = dst;
	instruction.b = src;
	instruction.c = 0;
	instruction.format = 'ABC';
	instruction.rkMask = 0;
	instruction.target = null;
};

const replaceWithConst = (instruction: Instruction, target: number, value: Value, context: OptimizationContext): ConstValue => {
	instruction.target = null;
	instruction.rkMask = 0;
	if (value === null) {
		instruction.op = OpCode.LOADNIL;
		instruction.a = target;
		instruction.b = 1;
		instruction.c = 0;
		instruction.format = 'ABC';
		return { value, constIndex: context.constIndex(null) };
	}
	if (typeof value === 'boolean') {
		instruction.op = OpCode.LOADBOOL;
		instruction.a = target;
		instruction.b = value ? 1 : 0;
		instruction.c = 0;
		instruction.format = 'ABC';
		return { value, constIndex: context.constIndex(value) };
	}
	const constIndex = context.constIndex(value);
	instruction.op = OpCode.LOADK;
	instruction.a = target;
	instruction.b = constIndex;
	instruction.c = 0;
	instruction.format = 'ABx';
	return { value, constIndex };
};

const getConstForOperand = (
	operand: number,
	useRk: boolean,
	constants: Map<number, ConstValue>,
	context: OptimizationContext,
): ConstValue | null => {
	if (useRk && operand < 0) {
		const constIndex = -1 - operand;
		return { value: context.constPool[constIndex], constIndex };
	}
	return constants.get(operand) ?? null;
};

const buildBasicBlocks = (instructions: Instruction[]): Block[] => {
	const count = instructions.length;
	if (count === 0) {
		return [];
	}
	const leaders = new Set<number>();
	leaders.add(0);
	for (let i = 0; i < count; i += 1) {
		const instruction = instructions[i];
		const next = i + 1;
		const nextNext = i + 2;
		switch (instruction.op) {
			case OpCode.JMP:
				if (instruction.target !== null && instruction.target < count) {
					leaders.add(instruction.target);
				}
				if (next < count) {
					leaders.add(next);
				}
				break;
			case OpCode.JMPIF:
			case OpCode.JMPIFNOT:
				if (instruction.target !== null && instruction.target < count) {
					leaders.add(instruction.target);
				}
				if (next < count) {
					leaders.add(next);
				}
				break;
			case OpCode.RET:
				if (next < count) {
					leaders.add(next);
				}
				break;
			case OpCode.LOADBOOL:
				if (next < count) {
					leaders.add(next);
				}
				if (instruction.c !== 0 && nextNext < count) {
					leaders.add(nextNext);
				}
				break;
			case OpCode.TEST:
			case OpCode.TESTSET:
			case OpCode.EQ:
			case OpCode.LT:
			case OpCode.LE:
				if (next < count) {
					leaders.add(next);
				}
				if (nextNext < count) {
					leaders.add(nextNext);
				}
				break;
			default:
				break;
		}
	}
	const sorted = Array.from(leaders).sort((a, b) => a - b);
	const blocks: Block[] = [];
	for (let i = 0; i < sorted.length; i += 1) {
		const start = sorted[i];
		const end = i + 1 < sorted.length ? sorted[i + 1] : count;
		if (start < end) {
			blocks.push({ start, end });
		}
	}
	return blocks;
};

const buildBlockGraph = (instructions: Instruction[], blocks: Block[]): {
	blockForIndex: number[];
	predecessors: number[][];
	successors: number[][];
} => {
	const count = instructions.length;
	const blockForIndex = new Array<number>(count);
	for (let i = 0; i < blocks.length; i += 1) {
		const block = blocks[i];
		for (let index = block.start; index < block.end; index += 1) {
			blockForIndex[index] = i;
		}
	}
	const successors: number[][] = new Array(blocks.length);
	const predecessors: number[][] = new Array(blocks.length);
	for (let i = 0; i < blocks.length; i += 1) {
		successors[i] = [];
		predecessors[i] = [];
	}

	const addSuccessor = (blockIndex: number, targetIndex: number | null): void => {
		if (targetIndex === null) {
			return;
		}
		const list = successors[blockIndex];
		for (let i = 0; i < list.length; i += 1) {
			if (list[i] === targetIndex) {
				return;
			}
		}
		list.push(targetIndex);
	};

	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const block = blocks[blockIndex];
		const lastIndex = block.end - 1;
		if (lastIndex < 0 || lastIndex >= count) {
			continue;
		}
		const instruction = instructions[lastIndex];
		const nextIndex = lastIndex + 1;
		const nextNextIndex = lastIndex + 2;
		switch (instruction.op) {
			case OpCode.RET:
				break;
			case OpCode.JMP: {
				const target = getJumpTarget(instruction);
				addSuccessor(blockIndex, target < count ? blockForIndex[target] : null);
				break;
			}
			case OpCode.JMPIF:
			case OpCode.JMPIFNOT: {
				const target = getJumpTarget(instruction);
				addSuccessor(blockIndex, target < count ? blockForIndex[target] : null);
				if (nextIndex < count) {
					addSuccessor(blockIndex, blockForIndex[nextIndex]);
				}
				break;
			}
			case OpCode.LOADBOOL: {
				if (nextIndex < count) {
					addSuccessor(blockIndex, blockForIndex[nextIndex]);
				}
				if (instruction.c !== 0 && nextNextIndex < count) {
					addSuccessor(blockIndex, blockForIndex[nextNextIndex]);
				}
				break;
			}
			case OpCode.TEST:
			case OpCode.TESTSET:
			case OpCode.EQ:
			case OpCode.LT:
			case OpCode.LE: {
				if (nextIndex < count) {
					addSuccessor(blockIndex, blockForIndex[nextIndex]);
				}
				if (nextNextIndex < count) {
					addSuccessor(blockIndex, blockForIndex[nextNextIndex]);
				}
				break;
			}
			default:
				if (nextIndex < count) {
					addSuccessor(blockIndex, blockForIndex[nextIndex]);
				}
				break;
		}
	}

	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const nextBlocks = successors[blockIndex];
		for (let i = 0; i < nextBlocks.length; i += 1) {
			predecessors[nextBlocks[i]].push(blockIndex);
		}
	}

	return { blockForIndex, predecessors, successors };
};

const remapInstructions = (
	instructions: Instruction[],
	ranges: Array<SourceRange | null>,
	keep: boolean[],
	forwardRemovedTargets: boolean,
): InstructionSet => {
	const count = instructions.length;
	const indexMap = new Array<number>(count);
	let newIndex = 0;
	for (let i = 0; i < count; i += 1) {
		if (keep[i]) {
			indexMap[i] = newIndex;
			newIndex += 1;
		} else {
			indexMap[i] = -1;
		}
	}
	const forwardMap = new Array<number>(count);
	let nextKept = newIndex;
	for (let i = count - 1; i >= 0; i -= 1) {
		if (keep[i]) {
			nextKept = indexMap[i];
		}
		forwardMap[i] = nextKept;
	}

	const nextInstructions: Instruction[] = new Array(newIndex);
	const nextRanges: Array<SourceRange | null> = new Array(newIndex);
	let writeIndex = 0;
	for (let i = 0; i < count; i += 1) {
		if (!keep[i]) {
			continue;
		}
		const instruction = instructions[i];
		if (isJump(instruction)) {
			const target = getJumpTarget(instruction);
			const mappedTarget = target === count
				? newIndex
				: (forwardRemovedTargets ? forwardMap[target] : indexMap[target]);
			if (mappedTarget < 0) {
				throw new Error(`[ProgramOptimizer] Jump target ${target} was removed.`);
			}
			instruction.target = mappedTarget;
		}
		nextInstructions[writeIndex] = instruction;
		nextRanges[writeIndex] = ranges[i];
		writeIndex += 1;
	}
	return { instructions: nextInstructions, ranges: nextRanges };
};

const removeNoOps = (set: InstructionSet): InstructionSet => {
	const { instructions, ranges } = set;
	const count = instructions.length;
	let removed = 0;
	const pinned = new Array<boolean>(count).fill(false);
	for (let i = 0; i + 1 < count; i += 1) {
		if (isSkipInstruction(instructions[i])) {
			pinned[i + 1] = true;
		}
	}
	const keep = new Array<boolean>(count).fill(true);
	for (let i = 0; i < count; i += 1) {
		if (pinned[i]) {
			continue;
		}
		const instruction = instructions[i];
		if (instruction.op === OpCode.MOV && instruction.a === instruction.b) {
			keep[i] = false;
			removed += 1;
			continue;
		}
		if (instruction.op === OpCode.JMP && getJumpTarget(instruction) === i + 1) {
			keep[i] = false;
			removed += 1;
		}
	}
	if (removed === 0) {
		return set;
	}
	return remapInstructions(instructions, ranges, keep, true);
};

const resolveJumpTarget = (target: number, instructions: Instruction[]): number => {
	let current = target;
	const visited = new Set<number>();
	while (current >= 0 && current < instructions.length) {
		if (visited.has(current)) {
			break;
		}
		visited.add(current);
		const instruction = instructions[current];
		if (instruction.op !== OpCode.JMP) {
			break;
		}
		const nextTarget = getJumpTarget(instruction);
		if (nextTarget === current) {
			break;
		}
		current = nextTarget;
	}
	return current;
};

const threadJumps = (set: InstructionSet): InstructionSet => {
	const { instructions } = set;
	for (let i = 0; i < instructions.length; i += 1) {
		const instruction = instructions[i];
		if (!isJump(instruction)) {
			continue;
		}
		const target = getJumpTarget(instruction);
		if (target >= instructions.length) {
			continue;
		}
		const resolved = resolveJumpTarget(target, instructions);
		if (resolved !== target) {
			instruction.target = resolved;
		}
	}
	return set;
};

const removeUnreachable = (set: InstructionSet): InstructionSet => {
	const { instructions, ranges } = set;
	const count = instructions.length;
	if (count === 0) {
		return set;
	}
	const reachable = new Array<boolean>(count).fill(false);
	const worklist: number[] = [0];
	while (worklist.length > 0) {
		const index = worklist.pop()!;
		if (index < 0 || index >= count || reachable[index]) {
			continue;
		}
		reachable[index] = true;
		const instruction = instructions[index];
		switch (instruction.op) {
			case OpCode.RET:
				break;
			case OpCode.JMP: {
				const target = getJumpTarget(instruction);
				if (target < count) {
					worklist.push(target);
				}
				break;
			}
			case OpCode.JMPIF:
			case OpCode.JMPIFNOT: {
				const target = getJumpTarget(instruction);
				if (target < count) {
					worklist.push(target);
				}
				if (index + 1 < count) {
					worklist.push(index + 1);
				}
				break;
			}
			case OpCode.LOADBOOL: {
				if (index + 1 < count) {
					worklist.push(index + 1);
				}
				if (instruction.c !== 0 && index + 2 < count) {
					worklist.push(index + 2);
				}
				break;
			}
			case OpCode.TEST:
			case OpCode.TESTSET:
			case OpCode.EQ:
			case OpCode.LT:
			case OpCode.LE: {
				if (index + 1 < count) {
					worklist.push(index + 1);
				}
				if (index + 2 < count) {
					worklist.push(index + 2);
				}
				break;
			}
			default:
				if (index + 1 < count) {
					worklist.push(index + 1);
				}
				break;
		}
	}
	let removed = 0;
	const keep = new Array<boolean>(count);
	for (let i = 0; i < count; i += 1) {
		keep[i] = reachable[i];
		if (!reachable[i]) {
			removed += 1;
		}
	}
	if (removed === 0) {
		return set;
	}
	return remapInstructions(instructions, ranges, keep, false);
};

const simplifyCompareBool = (set: InstructionSet): InstructionSet => {
	const { instructions, ranges } = set;
	const count = instructions.length;
	if (count < 4) {
		return set;
	}
	const inboundTargets = new Array<number>(count).fill(0);
	for (const instruction of instructions) {
		if (!isJump(instruction)) {
			continue;
		}
		const target = getJumpTarget(instruction);
		if (target < count) {
			inboundTargets[target] += 1;
		}
	}
	const keep = new Array<boolean>(count).fill(true);
	let removed = 0;
	for (let i = 0; i + 3 < count; i += 1) {
		const loadTrue = instructions[i];
		const compare = instructions[i + 1];
		const jump = instructions[i + 2];
		const loadFalse = instructions[i + 3];
		if (loadTrue.op !== OpCode.LOADBOOL || loadTrue.b !== 1 || loadTrue.c !== 0) {
			continue;
		}
		if (loadFalse.op !== OpCode.LOADBOOL || loadFalse.b !== 0 || loadFalse.c !== 0) {
			continue;
		}
		if (loadTrue.a !== loadFalse.a) {
			continue;
		}
		if (compare.op !== OpCode.EQ && compare.op !== OpCode.LT && compare.op !== OpCode.LE) {
			continue;
		}
		if (compare.a !== 1 || compare.format !== 'ABC') {
			continue;
		}
		if (jump.op !== OpCode.JMP || jump.format !== 'AsBx') {
			continue;
		}
		if (getJumpTarget(jump) !== i + 4) {
			continue;
		}
		if (inboundTargets[i + 2] > 0) {
			continue;
		}
		compare.a = 0;
		keep[i + 2] = false;
		removed += 1;
	}
	if (removed === 0) {
		return set;
	}
	return remapInstructions(instructions, ranges, keep, true);
};

const evaluateUnary = (op: OpCode, value: Value): Value | null => {
	switch (op) {
		case OpCode.UNM:
			return -(value as number);
		case OpCode.BNOT:
			return ~(value as number);
		case OpCode.NOT:
			return !isTruthy(value);
		case OpCode.LEN:
			if (isStringValue(value)) {
				return value.codepointCount;
			}
			return null;
		default:
			return null;
	}
};

const evaluateBinary = (op: OpCode, left: Value, right: Value): Value | null => {
	const leftNum = Number(left as number);
	const rightNum = Number(right as number);
	switch (op) {
		case OpCode.ADD:
			return leftNum + rightNum;
		case OpCode.SUB:
			return leftNum - rightNum;
		case OpCode.MUL:
			return leftNum * rightNum;
		case OpCode.DIV:
			return leftNum / rightNum;
		case OpCode.MOD:
			return leftNum % rightNum;
		case OpCode.FLOORDIV:
			return Math.floor(leftNum / rightNum);
		case OpCode.POW:
			return Math.pow(leftNum, rightNum);
		case OpCode.BAND:
			return leftNum & rightNum;
		case OpCode.BOR:
			return leftNum | rightNum;
		case OpCode.BXOR:
			return leftNum ^ rightNum;
		case OpCode.SHL:
			return leftNum << (rightNum & 31);
		case OpCode.SHR:
			return leftNum >> (rightNum & 31);
		default:
			return null;
	}
};

const evaluateComparison = (op: OpCode, left: Value, right: Value): boolean | null => {
	switch (op) {
		case OpCode.EQ:
			return left === right;
		case OpCode.LT:
			if (isStringValue(left) && isStringValue(right)) {
				return stringValueToString(left) < stringValueToString(right);
			}
			return (left as number) < (right as number);
		case OpCode.LE:
			if (isStringValue(left) && isStringValue(right)) {
				return stringValueToString(left) <= stringValueToString(right);
			}
			return (left as number) <= (right as number);
		default:
			return null;
	}
};

const clearConstRange = (constants: Map<number, ConstValue>, start: number, countValue: number | null): void => {
	if (countValue === null) {
		for (const reg of Array.from(constants.keys())) {
			if (reg >= start) {
				constants.delete(reg);
			}
		}
		return;
	}
	for (let offset = 0; offset < countValue; offset += 1) {
		constants.delete(start + offset);
	}
};

const equalConstMaps = (left: Map<number, ConstValue>, right: Map<number, ConstValue>): boolean => {
	if (left.size !== right.size) {
		return false;
	}
	for (const [reg, value] of left) {
		const other = right.get(reg);
		if (!other || other.constIndex !== value.constIndex) {
			return false;
		}
	}
	return true;
};

const intersectConstMaps = (maps: Map<number, ConstValue>[]): Map<number, ConstValue> => {
	if (maps.length === 0) {
		return new Map<number, ConstValue>();
	}
	const [first, ...rest] = maps;
	const result = new Map<number, ConstValue>();
	for (const [reg, value] of first) {
		let same = true;
		for (let i = 0; i < rest.length; i += 1) {
			const other = rest[i].get(reg);
			if (!other || other.constIndex !== value.constIndex) {
				same = false;
				break;
			}
		}
		if (same) {
			result.set(reg, value);
		}
	}
	return result;
};

const computeBlockConstantIn = (
	instructions: Instruction[],
	context: OptimizationContext,
): Array<Map<number, ConstValue>> => {
	const blocks = buildBasicBlocks(instructions);
	const { predecessors } = buildBlockGraph(instructions, blocks);
	const blockCount = blocks.length;
	const inMaps: Array<Map<number, ConstValue>> = new Array(blockCount);
	const outMaps: Array<Map<number, ConstValue>> = new Array(blockCount);
	for (let i = 0; i < blockCount; i += 1) {
		inMaps[i] = new Map();
		outMaps[i] = new Map();
	}
	const nilConst: ConstValue = { value: null, constIndex: context.constIndex(null) };
	const trueConst: ConstValue = { value: true, constIndex: context.constIndex(true) };
	const falseConst: ConstValue = { value: false, constIndex: context.constIndex(false) };

	let changed = true;
	while (changed) {
		changed = false;
		for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
			const preds = predecessors[blockIndex];
			const nextIn = preds.length === 0
				? new Map<number, ConstValue>()
				: intersectConstMaps(preds.map(pred => outMaps[pred]));
			if (!equalConstMaps(nextIn, inMaps[blockIndex])) {
				inMaps[blockIndex] = nextIn;
				changed = true;
			}
			const constants = new Map(inMaps[blockIndex]);
			const block = blocks[blockIndex];
			for (let i = block.start; i < block.end; i += 1) {
				const instruction = instructions[i];
				switch (instruction.op) {
					case OpCode.MOV: {
						const source = constants.get(instruction.b);
						if (source) {
							constants.set(instruction.a, source);
						} else {
							constants.delete(instruction.a);
						}
						break;
					}
					case OpCode.LOADK: {
						const index = instruction.b;
						constants.set(instruction.a, { value: context.constPool[index], constIndex: index });
						break;
					}
					case OpCode.LOADBOOL: {
						constants.set(instruction.a, instruction.b !== 0 ? trueConst : falseConst);
						break;
					}
					case OpCode.LOADNIL: {
						for (let offset = 0; offset < instruction.b; offset += 1) {
							constants.set(instruction.a + offset, nilConst);
						}
						break;
					}
					case OpCode.UNM:
					case OpCode.BNOT:
					case OpCode.NOT:
					case OpCode.LEN: {
						const operand = constants.get(instruction.b);
						if (operand) {
							const result = evaluateUnary(instruction.op, operand.value);
							if (result !== null && isConstPoolValue(result)) {
								constants.set(instruction.a, { value: result, constIndex: context.constIndex(result) });
								break;
							}
						}
						constants.delete(instruction.a);
						break;
					}
					case OpCode.ADD:
					case OpCode.SUB:
					case OpCode.MUL:
					case OpCode.DIV:
					case OpCode.MOD:
					case OpCode.FLOORDIV:
					case OpCode.POW:
					case OpCode.BAND:
					case OpCode.BOR:
					case OpCode.BXOR:
					case OpCode.SHL:
					case OpCode.SHR: {
						const left = getConstForOperand(instruction.b, (instruction.rkMask & RK_B) !== 0, constants, context);
						const right = getConstForOperand(instruction.c, (instruction.rkMask & RK_C) !== 0, constants, context);
						if (left && right) {
							const result = evaluateBinary(instruction.op, left.value, right.value);
							if (result !== null && isConstPoolValue(result)) {
								constants.set(instruction.a, { value: result, constIndex: context.constIndex(result) });
								break;
							}
						}
						constants.delete(instruction.a);
						break;
					}
				case OpCode.GETG:
				case OpCode.GETT:
				case OpCode.NEWT:
				case OpCode.CONCAT:
				case OpCode.CONCATN:
				case OpCode.CLOSURE:
				case OpCode.GETUP:
				case OpCode.LOAD_MEM:
					constants.delete(instruction.a);
					break;
					case OpCode.VARARG: {
						const countValue = instruction.b === 0 ? null : instruction.b;
						clearConstRange(constants, instruction.a, countValue);
						break;
					}
					case OpCode.CALL: {
						const countValue = instruction.c === 0 ? null : instruction.c;
						clearConstRange(constants, instruction.a, countValue);
						break;
					}
					case OpCode.TESTSET:
						constants.delete(instruction.a);
						break;
					default:
						break;
				}
			}
			if (!equalConstMaps(constants, outMaps[blockIndex])) {
				outMaps[blockIndex] = constants;
				changed = true;
			}
		}
	}
	return inMaps;
};

const foldConstants = (set: InstructionSet, context: OptimizationContext): InstructionSet => {
	const { instructions, ranges } = set;
	const count = instructions.length;
	if (count === 0) {
		return set;
	}
	const keep = new Array<boolean>(count).fill(true);
	let removed = 0;
	const blocks = buildBasicBlocks(instructions);
	const nilConst: ConstValue = { value: null, constIndex: context.constIndex(null) };
	const trueConst: ConstValue = { value: true, constIndex: context.constIndex(true) };
	const falseConst: ConstValue = { value: false, constIndex: context.constIndex(false) };
	const blockConstIn = computeBlockConstantIn(instructions, context);

	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const block = blocks[blockIndex];
		const constants = new Map(blockConstIn[blockIndex]);
		for (let i = block.start; i < block.end; i += 1) {
			const instruction = instructions[i];

			if (instruction.op === OpCode.JMPIF || instruction.op === OpCode.JMPIFNOT) {
				const value = constants.get(instruction.a);
				if (value) {
					const truthy = isTruthy(value.value);
					const shouldJump = instruction.op === OpCode.JMPIF ? truthy : !truthy;
					if (shouldJump) {
						replaceWithJump(instruction, getJumpTarget(instruction));
					} else {
						keep[i] = false;
						removed += 1;
						continue;
					}
				}
			}

			if (instruction.op === OpCode.TEST) {
				const value = constants.get(instruction.a);
				if (value) {
					const expected = instruction.c !== 0;
					const shouldSkip = isTruthy(value.value) !== expected;
					if (shouldSkip) {
						replaceWithJump(instruction, Math.min(i + 2, count));
					} else {
						keep[i] = false;
						removed += 1;
						continue;
					}
				}
			}

			if (instruction.op === OpCode.TESTSET) {
				const value = constants.get(instruction.b);
				if (value) {
					const expected = instruction.c !== 0;
					if (isTruthy(value.value) === expected) {
						replaceWithMov(instruction, instruction.a, instruction.b);
					} else {
						replaceWithJump(instruction, Math.min(i + 2, count));
					}
				}
			}

			if (instruction.op === OpCode.EQ || instruction.op === OpCode.LT || instruction.op === OpCode.LE) {
				const left = getConstForOperand(instruction.b, (instruction.rkMask & RK_B) !== 0, constants, context);
				const right = getConstForOperand(instruction.c, (instruction.rkMask & RK_C) !== 0, constants, context);
				if (left && right) {
					const result = evaluateComparison(instruction.op, left.value, right.value);
					if (result !== null) {
						const expected = instruction.a !== 0;
						const shouldSkip = result !== expected;
						if (shouldSkip) {
							replaceWithJump(instruction, Math.min(i + 2, count));
						} else {
							keep[i] = false;
							removed += 1;
							continue;
						}
					}
				}
			}

			if (instruction.op === OpCode.UNM || instruction.op === OpCode.BNOT || instruction.op === OpCode.NOT || instruction.op === OpCode.LEN) {
				const operand = constants.get(instruction.b);
				if (operand) {
					const result = evaluateUnary(instruction.op, operand.value);
					if (result !== null && isConstPoolValue(result)) {
						const folded = replaceWithConst(instruction, instruction.a, result, context);
						constants.set(instruction.a, folded);
						continue;
					}
				}
			}

			if (
				instruction.op === OpCode.ADD
				|| instruction.op === OpCode.SUB
				|| instruction.op === OpCode.MUL
				|| instruction.op === OpCode.DIV
				|| instruction.op === OpCode.MOD
				|| instruction.op === OpCode.FLOORDIV
				|| instruction.op === OpCode.POW
				|| instruction.op === OpCode.BAND
				|| instruction.op === OpCode.BOR
				|| instruction.op === OpCode.BXOR
				|| instruction.op === OpCode.SHL
				|| instruction.op === OpCode.SHR
			) {
				const left = getConstForOperand(instruction.b, (instruction.rkMask & RK_B) !== 0, constants, context);
				const right = getConstForOperand(instruction.c, (instruction.rkMask & RK_C) !== 0, constants, context);
				if (left && right) {
					const result = evaluateBinary(instruction.op, left.value, right.value);
					if (result !== null && isConstPoolValue(result)) {
						const folded = replaceWithConst(instruction, instruction.a, result, context);
						constants.set(instruction.a, folded);
						continue;
					}
				}
			}

			switch (instruction.op) {
				case OpCode.MOV: {
					const source = constants.get(instruction.b);
					if (source) {
						constants.set(instruction.a, source);
					} else {
						constants.delete(instruction.a);
					}
					break;
				}
				case OpCode.LOADK: {
					const index = instruction.b;
					constants.set(instruction.a, { value: context.constPool[index], constIndex: index });
					break;
				}
				case OpCode.LOADBOOL: {
					constants.set(instruction.a, instruction.b !== 0 ? trueConst : falseConst);
					break;
				}
				case OpCode.LOADNIL: {
					for (let offset = 0; offset < instruction.b; offset += 1) {
						constants.set(instruction.a + offset, nilConst);
					}
					break;
				}
				case OpCode.VARARG: {
					const countValue = instruction.b === 0 ? null : instruction.b;
					clearConstRange(constants, instruction.a, countValue);
					break;
				}
				case OpCode.CALL: {
					const countValue = instruction.c === 0 ? null : instruction.c;
					clearConstRange(constants, instruction.a, countValue);
					break;
				}
				case OpCode.TESTSET:
				case OpCode.GETG:
				case OpCode.GETT:
				case OpCode.NEWT:
				case OpCode.CONCAT:
				case OpCode.CONCATN:
				case OpCode.CLOSURE:
				case OpCode.GETUP:
				case OpCode.LOAD_MEM:
				case OpCode.UNM:
				case OpCode.NOT:
				case OpCode.LEN:
				case OpCode.BNOT:
				case OpCode.ADD:
				case OpCode.SUB:
				case OpCode.MUL:
				case OpCode.DIV:
				case OpCode.MOD:
				case OpCode.FLOORDIV:
				case OpCode.POW:
				case OpCode.BAND:
				case OpCode.BOR:
				case OpCode.BXOR:
				case OpCode.SHL:
				case OpCode.SHR:
					constants.delete(instruction.a);
					break;
				default:
					break;
			}
		}
	}

	if (removed === 0) {
		return set;
	}
	return remapInstructions(instructions, ranges, keep, true);
};

const resolveCopy = (register: number, copies: Map<number, number>): number => {
	let current = register;
	const visited = new Set<number>();
	while (true) {
		const next = copies.get(current);
		if (next === undefined) {
			return current;
		}
		if (visited.has(next)) {
			return current;
		}
		visited.add(next);
		current = next;
	}
};

const propagateValues = (set: InstructionSet, context: OptimizationContext): InstructionSet => {
	const { instructions } = set;
	const count = instructions.length;
	if (count === 0) {
		return set;
	}
	const blocks = buildBasicBlocks(instructions);
	const blockConstIn = computeBlockConstantIn(instructions, context);
	const nilConst: ConstValue = { value: null, constIndex: context.constIndex(null) };
	const trueConst: ConstValue = { value: true, constIndex: context.constIndex(true) };
	const falseConst: ConstValue = { value: false, constIndex: context.constIndex(false) };
	let changed = false;

	const invalidateCopiesUsing = (copies: Map<number, number>, register: number): void => {
		let updated = true;
		while (updated) {
			updated = false;
			for (const [dst, src] of copies) {
				if (src === register) {
					copies.delete(dst);
					updated = true;
					continue;
				}
				if (resolveCopy(src, copies) === register) {
					copies.delete(dst);
					updated = true;
				}
			}
		}
	};

	const killRegister = (constants: Map<number, ConstValue>, copies: Map<number, number>, register: number): void => {
		constants.delete(register);
		copies.delete(register);
		invalidateCopiesUsing(copies, register);
	};

	const setConst = (constants: Map<number, ConstValue>, copies: Map<number, number>, register: number, value: ConstValue): void => {
		killRegister(constants, copies, register);
		constants.set(register, value);
	};

	const setCopy = (constants: Map<number, ConstValue>, copies: Map<number, number>, register: number, source: number): void => {
		killRegister(constants, copies, register);
		copies.set(register, source);
	};

	const rewriteRegisterOperand = (operand: number, copies: Map<number, number>): number => resolveCopy(operand, copies);

	const rewriteRkOperand = (
		instruction: Instruction,
		operand: number,
		maskBit: number,
		constants: Map<number, ConstValue>,
		copies: Map<number, number>,
	): number => {
		if ((instruction.rkMask & maskBit) === 0) {
			return rewriteRegisterOperand(operand, copies);
		}
		if (operand < 0) {
			return operand;
		}
		const constant = constants.get(operand);
		if (
			constant
			&& constant.constIndex !== null
			&& constant.constIndex <= MAX_EXT_CONST
			// Keep RK replacement for non-string constants only.
			// While the string-producing path in this pass is currently limited (notably CONCAT),
			// don't emit RK string constants for STORE_MEM_WORDS; those must stay register-based.
			&& !(instruction.op === OpCode.STORE_MEM_WORDS && isStringValue(constant.value))
		) {
			return -1 - constant.constIndex;
		}
		return rewriteRegisterOperand(operand, copies);
	};

	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const block = blocks[blockIndex];
		const constants = new Map(blockConstIn[blockIndex]);
		const copies = new Map<number, number>();

		for (let i = block.start; i < block.end; i += 1) {
			const instruction = instructions[i];

			switch (instruction.op) {
				case OpCode.MOV: {
					const resolved = rewriteRegisterOperand(instruction.b, copies);
					if (resolved !== instruction.b) {
						instruction.b = resolved;
						changed = true;
					}
					const constant = constants.get(instruction.b);
					if (constant && isConstPoolValue(constant.value) && !isStringValue(constant.value)) {
						replaceWithConst(instruction, instruction.a, constant.value, context);
						changed = true;
					}
					break;
				}
				case OpCode.GETT: {
					const nextB = rewriteRegisterOperand(instruction.b, copies);
					if (nextB !== instruction.b) {
						instruction.b = nextB;
						changed = true;
					}
					const nextC = rewriteRkOperand(instruction, instruction.c, RK_C, constants, copies);
					if (nextC !== instruction.c) {
						instruction.c = nextC;
						changed = true;
					}
					break;
				}
				case OpCode.SETT: {
					const nextA = rewriteRegisterOperand(instruction.a, copies);
					if (nextA !== instruction.a) {
						instruction.a = nextA;
						changed = true;
					}
					const nextB = rewriteRkOperand(instruction, instruction.b, RK_B, constants, copies);
					if (nextB !== instruction.b) {
						instruction.b = nextB;
						changed = true;
					}
					const nextC = rewriteRkOperand(instruction, instruction.c, RK_C, constants, copies);
					if (nextC !== instruction.c) {
						instruction.c = nextC;
						changed = true;
					}
					break;
				}
				case OpCode.ADD:
				case OpCode.SUB:
				case OpCode.MUL:
				case OpCode.DIV:
				case OpCode.MOD:
				case OpCode.FLOORDIV:
				case OpCode.POW:
				case OpCode.BAND:
				case OpCode.BOR:
				case OpCode.BXOR:
				case OpCode.SHL:
				case OpCode.SHR:
				case OpCode.CONCAT:
				case OpCode.EQ:
				case OpCode.LT:
				case OpCode.LE: {
					const nextB = rewriteRkOperand(instruction, instruction.b, RK_B, constants, copies);
					if (nextB !== instruction.b) {
						instruction.b = nextB;
						changed = true;
					}
					const nextC = rewriteRkOperand(instruction, instruction.c, RK_C, constants, copies);
					if (nextC !== instruction.c) {
						instruction.c = nextC;
						changed = true;
					}
					break;
				}
				case OpCode.UNM:
				case OpCode.NOT:
				case OpCode.LEN:
				case OpCode.BNOT: {
					const nextB = rewriteRegisterOperand(instruction.b, copies);
					if (nextB !== instruction.b) {
						instruction.b = nextB;
						changed = true;
					}
					break;
				}
				case OpCode.TEST:
				case OpCode.JMPIF:
				case OpCode.JMPIFNOT: {
					const nextA = rewriteRegisterOperand(instruction.a, copies);
					if (nextA !== instruction.a) {
						instruction.a = nextA;
						changed = true;
					}
					break;
				}
				case OpCode.TESTSET: {
					const nextB = rewriteRegisterOperand(instruction.b, copies);
					if (nextB !== instruction.b) {
						instruction.b = nextB;
						changed = true;
					}
					break;
				}
				case OpCode.SETG:
				case OpCode.SETUP:
				case OpCode.STORE_MEM: {
					const nextA = rewriteRegisterOperand(instruction.a, copies);
					if (nextA !== instruction.a) {
						instruction.a = nextA;
						changed = true;
					}
					if (instruction.op === OpCode.STORE_MEM) {
						const nextB = rewriteRkOperand(instruction, instruction.b, RK_B, constants, copies);
						if (nextB !== instruction.b) {
							instruction.b = nextB;
							changed = true;
						}
					}
					break;
				}
				case OpCode.STORE_MEM_WORDS: {
					const nextB = rewriteRkOperand(instruction, instruction.b, RK_B, constants, copies);
					if (nextB !== instruction.b) {
						instruction.b = nextB;
						changed = true;
					}
					break;
				}
				case OpCode.LOAD_MEM: {
					const nextB = rewriteRkOperand(instruction, instruction.b, RK_B, constants, copies);
					if (nextB !== instruction.b) {
						instruction.b = nextB;
						changed = true;
					}
					break;
				}
				default:
					break;
			}

			switch (instruction.op) {
				case OpCode.MOV: {
					const constant = constants.get(instruction.b);
					if (constant) {
						setConst(constants, copies, instruction.a, constant);
					} else {
						const resolved = resolveCopy(instruction.b, copies);
						setCopy(constants, copies, instruction.a, resolved);
					}
					break;
				}
				case OpCode.LOADK: {
					const index = instruction.b;
					setConst(constants, copies, instruction.a, { value: context.constPool[index], constIndex: index });
					break;
				}
				case OpCode.LOADBOOL: {
					setConst(constants, copies, instruction.a, instruction.b !== 0 ? trueConst : falseConst);
					break;
				}
				case OpCode.LOADNIL: {
					for (let offset = 0; offset < instruction.b; offset += 1) {
						setConst(constants, copies, instruction.a + offset, nilConst);
					}
					break;
				}
				case OpCode.UNM:
				case OpCode.BNOT:
				case OpCode.NOT:
				case OpCode.LEN: {
					const operand = constants.get(instruction.b);
					if (operand) {
						const result = evaluateUnary(instruction.op, operand.value);
						if (result !== null) {
							setConst(constants, copies, instruction.a, { value: result, constIndex: context.constIndex(result) });
							break;
						}
					}
					killRegister(constants, copies, instruction.a);
					break;
				}
				case OpCode.ADD:
				case OpCode.SUB:
				case OpCode.MUL:
				case OpCode.DIV:
				case OpCode.MOD:
				case OpCode.FLOORDIV:
				case OpCode.POW:
				case OpCode.BAND:
				case OpCode.BOR:
				case OpCode.BXOR:
				case OpCode.SHL:
				case OpCode.SHR: {
					const left = getConstForOperand(instruction.b, (instruction.rkMask & RK_B) !== 0, constants, context);
					const right = getConstForOperand(instruction.c, (instruction.rkMask & RK_C) !== 0, constants, context);
					if (left && right) {
						const result = evaluateBinary(instruction.op, left.value, right.value);
						if (result !== null) {
							setConst(constants, copies, instruction.a, { value: result, constIndex: context.constIndex(result) });
							break;
						}
					}
					killRegister(constants, copies, instruction.a);
					break;
				}
				case OpCode.GETG:
				case OpCode.GETT:
				case OpCode.NEWT:
				case OpCode.CONCAT:
				case OpCode.CONCATN:
				case OpCode.CLOSURE:
				case OpCode.GETUP:
				case OpCode.LOAD_MEM:
					killRegister(constants, copies, instruction.a);
					break;
				case OpCode.VARARG: {
					const countValue = instruction.b === 0 ? null : instruction.b;
					if (countValue === null) {
						clearConstRange(constants, instruction.a, null);
						const toDelete: number[] = [];
						for (const [dst, src] of copies) {
							const resolved = resolveCopy(src, copies);
							if (dst >= instruction.a || resolved >= instruction.a) {
								toDelete.push(dst);
							}
						}
						for (let i = 0; i < toDelete.length; i += 1) {
							copies.delete(toDelete[i]);
						}
						break;
					}
					for (let offset = 0; offset < countValue; offset += 1) {
						killRegister(constants, copies, instruction.a + offset);
					}
					break;
				}
				case OpCode.CALL: {
					const countValue = instruction.c === 0 ? null : instruction.c;
					if (countValue === null) {
						clearConstRange(constants, instruction.a, null);
						const toDelete: number[] = [];
						for (const [dst, src] of copies) {
							const resolved = resolveCopy(src, copies);
							if (dst >= instruction.a || resolved >= instruction.a) {
								toDelete.push(dst);
							}
						}
						for (let i = 0; i < toDelete.length; i += 1) {
							copies.delete(toDelete[i]);
						}
						break;
					}
					for (let offset = 0; offset < countValue; offset += 1) {
						killRegister(constants, copies, instruction.a + offset);
					}
					break;
				}
				case OpCode.TESTSET:
					killRegister(constants, copies, instruction.a);
					break;
				default:
					break;
			}
		}
	}

	return changed ? set : set;
};

const computeMaxRegister = (instructions: Instruction[]): number => {
	let maxRegister = 0;
	const updateMax = (register: number): void => {
		if (register > maxRegister) {
			maxRegister = register;
		}
	};
	for (const instruction of instructions) {
		switch (instruction.op) {
			case OpCode.LOADK:
			case OpCode.LOADNIL:
			case OpCode.LOADBOOL:
			case OpCode.GETG:
			case OpCode.NEWT:
			case OpCode.CLOSURE:
			case OpCode.GETUP:
				updateMax(instruction.a);
				break;
			case OpCode.SETG:
			case OpCode.SETUP:
			case OpCode.TEST:
			case OpCode.JMPIF:
			case OpCode.JMPIFNOT:
			case OpCode.LOAD_MEM:
				updateMax(instruction.a);
				if (instruction.op === OpCode.LOAD_MEM && ((instruction.rkMask & RK_B) === 0 || instruction.b >= 0)) {
					updateMax(instruction.b);
				}
				break;
			case OpCode.STORE_MEM_WORDS:
				updateMax(instruction.a);
				updateMax(instruction.a + Math.max(instruction.c - 1, 0));
				if ((instruction.rkMask & RK_B) === 0 || instruction.b >= 0) {
					updateMax(instruction.b);
				}
				break;
			case OpCode.MOV:
			case OpCode.UNM:
			case OpCode.NOT:
			case OpCode.LEN:
			case OpCode.BNOT:
				updateMax(instruction.a);
				updateMax(instruction.b);
				break;
			case OpCode.ADD:
			case OpCode.SUB:
			case OpCode.MUL:
			case OpCode.DIV:
			case OpCode.MOD:
			case OpCode.FLOORDIV:
			case OpCode.POW:
			case OpCode.BAND:
			case OpCode.BOR:
			case OpCode.BXOR:
			case OpCode.SHL:
			case OpCode.SHR:
			case OpCode.CONCAT:
			case OpCode.EQ:
			case OpCode.LT:
			case OpCode.LE:
			case OpCode.GETT:
			case OpCode.SETT: {
				updateMax(instruction.a);
				if (instruction.b >= 0) {
					updateMax(instruction.b);
				}
				if (instruction.c >= 0) {
					updateMax(instruction.c);
				}
				break;
			}
			case OpCode.CONCATN: {
				updateMax(instruction.a);
				updateMax(instruction.b);
				updateMax(instruction.b + Math.max(instruction.c - 1, 0));
				break;
			}
			case OpCode.TESTSET:
				updateMax(instruction.a);
				updateMax(instruction.b);
				break;
			case OpCode.VARARG:
				updateMax(instruction.a);
				updateMax(instruction.a + Math.max(instruction.b - 1, 0));
				break;
			case OpCode.CALL:
			case OpCode.RET: {
				updateMax(instruction.a);
				if (instruction.b > 0) {
					updateMax(instruction.a + instruction.b - 1);
				}
				if (instruction.op === OpCode.CALL && instruction.c > 0) {
					updateMax(instruction.a + instruction.c - 1);
				}
				break;
			}
			case OpCode.STORE_MEM:
				updateMax(instruction.a);
				if ((instruction.rkMask & RK_B) === 0 || instruction.b >= 0) {
					updateMax(instruction.b);
				}
				break;
			default:
				break;
		}
	}
	return maxRegister;
};

const isPureInstruction = (instruction: Instruction): boolean => {
	switch (instruction.op) {
		case OpCode.MOV:
		case OpCode.LOADK:
		case OpCode.LOADNIL:
		case OpCode.NEWT:
		case OpCode.ADD:
		case OpCode.SUB:
		case OpCode.MUL:
		case OpCode.DIV:
		case OpCode.MOD:
		case OpCode.FLOORDIV:
		case OpCode.POW:
		case OpCode.BAND:
		case OpCode.BOR:
		case OpCode.BXOR:
		case OpCode.SHL:
		case OpCode.SHR:
		case OpCode.CONCAT:
		case OpCode.CONCATN:
		case OpCode.UNM:
		case OpCode.NOT:
		case OpCode.BNOT:
		case OpCode.CLOSURE:
		case OpCode.GETUP:
		case OpCode.VARARG:
			return true;
		case OpCode.LOADBOOL:
			return instruction.c === 0;
		default:
			return false;
	}
};

const eliminateDeadStores = (set: InstructionSet, context: OptimizationContext): InstructionSet => {
	const { instructions, ranges } = set;
	const count = instructions.length;
	if (count === 0) {
		return set;
	}
	const maxRegister = computeMaxRegister(instructions);
	const blocks = buildBasicBlocks(instructions);
	const registerCount = maxRegister + 1;
	const { successors } = buildBlockGraph(instructions, blocks);
	const pinned = new Array<boolean>(count).fill(false);
	for (let i = 0; i + 1 < count; i += 1) {
		if (isSkipInstruction(instructions[i])) {
			pinned[i + 1] = true;
		}
	}
	const captured = new Uint8Array(registerCount);
	for (let i = 0; i < count; i += 1) {
		const instruction = instructions[i];
		if (instruction.op !== OpCode.CLOSURE) {
			continue;
		}
		const upvalues = context.getClosureUpvalues(instruction.b);
		for (let u = 0; u < upvalues.length; u += 1) {
			const desc = upvalues[u];
			if (!desc.inStack) {
				continue;
			}
			if (desc.index >= registerCount) {
				throw new Error(`[ProgramOptimizer] Closure upvalue register out of range: r${desc.index}.`);
			}
			captured[desc.index] = 1;
		}
	}
	const blockUse: Uint8Array[] = new Array(blocks.length);
	const blockDef: Uint8Array[] = new Array(blocks.length);
	const liveIn: Uint8Array[] = new Array(blocks.length);
	const liveOut: Uint8Array[] = new Array(blocks.length);

	const collectUsesForLiveness = (instruction: Instruction): number[] => {
		const uses: number[] = [];
		const add = (reg: number): void => {
			if (reg >= 0) {
				uses.push(reg);
			}
		};
		const addRange = (base: number, countValue: number): void => {
			for (let offset = 0; offset < countValue; offset += 1) {
				add(base + offset);
			}
		};
		switch (instruction.op) {
			case OpCode.MOV:
			case OpCode.UNM:
			case OpCode.NOT:
			case OpCode.LEN:
			case OpCode.BNOT:
				add(instruction.b);
				break;
			case OpCode.SETG:
			case OpCode.SETUP:
			case OpCode.TEST:
			case OpCode.JMPIF:
			case OpCode.JMPIFNOT:
				add(instruction.a);
				break;
			case OpCode.TESTSET:
				add(instruction.b);
				break;
			case OpCode.GETT:
				add(instruction.b);
				if ((instruction.rkMask & RK_C) === 0 || instruction.c >= 0) {
					add(instruction.c);
				}
				break;
			case OpCode.SETT:
				add(instruction.a);
				if ((instruction.rkMask & RK_B) === 0 || instruction.b >= 0) {
					add(instruction.b);
				}
				if ((instruction.rkMask & RK_C) === 0 || instruction.c >= 0) {
					add(instruction.c);
				}
				break;
			case OpCode.ADD:
			case OpCode.SUB:
			case OpCode.MUL:
			case OpCode.DIV:
			case OpCode.MOD:
			case OpCode.FLOORDIV:
			case OpCode.POW:
			case OpCode.BAND:
			case OpCode.BOR:
			case OpCode.BXOR:
			case OpCode.SHL:
			case OpCode.SHR:
			case OpCode.CONCAT:
			case OpCode.EQ:
			case OpCode.LT:
			case OpCode.LE:
				if ((instruction.rkMask & RK_B) === 0 || instruction.b >= 0) {
					add(instruction.b);
				}
				if ((instruction.rkMask & RK_C) === 0 || instruction.c >= 0) {
					add(instruction.c);
				}
				break;
			case OpCode.CONCATN:
				addRange(instruction.b, instruction.c);
				break;
			case OpCode.LOAD_MEM:
				if ((instruction.rkMask & RK_B) === 0 || instruction.b >= 0) {
					add(instruction.b);
				}
				break;
			case OpCode.STORE_MEM:
				add(instruction.a);
				if ((instruction.rkMask & RK_B) === 0 || instruction.b >= 0) {
					add(instruction.b);
				}
				break;
			case OpCode.STORE_MEM_WORDS:
				addRange(instruction.a, instruction.c);
				if ((instruction.rkMask & RK_B) === 0 || instruction.b >= 0) {
					add(instruction.b);
				}
				break;
			case OpCode.CALL: {
				const countValue = instruction.b === 0 ? maxRegister - instruction.a : instruction.b;
				addRange(instruction.a, countValue + 1);
				break;
			}
			case OpCode.RET: {
				const countValue = instruction.b === 0 ? maxRegister - instruction.a + 1 : instruction.b;
				addRange(instruction.a, countValue);
				break;
			}
			default:
				break;
		}
		return uses;
	};

	const collectDefs = (instruction: Instruction): number[] => {
		const defs: number[] = [];
		const add = (reg: number): void => {
			if (reg >= 0) {
				defs.push(reg);
			}
		};
		const addRange = (base: number, countValue: number): void => {
			for (let offset = 0; offset < countValue; offset += 1) {
				add(base + offset);
			}
		};
		switch (instruction.op) {
			case OpCode.MOV:
			case OpCode.LOADK:
			case OpCode.LOADBOOL:
			case OpCode.GETG:
			case OpCode.GETT:
			case OpCode.NEWT:
			case OpCode.ADD:
			case OpCode.SUB:
			case OpCode.MUL:
			case OpCode.DIV:
			case OpCode.MOD:
			case OpCode.FLOORDIV:
			case OpCode.POW:
			case OpCode.BAND:
			case OpCode.BOR:
			case OpCode.BXOR:
			case OpCode.SHL:
			case OpCode.SHR:
			case OpCode.CONCAT:
			case OpCode.CONCATN:
			case OpCode.UNM:
			case OpCode.NOT:
			case OpCode.LEN:
			case OpCode.BNOT:
			case OpCode.CLOSURE:
			case OpCode.GETUP:
			case OpCode.LOAD_MEM:
				add(instruction.a);
				break;
			case OpCode.TESTSET:
				add(instruction.a);
				break;
			case OpCode.LOADNIL:
				addRange(instruction.a, instruction.b);
				break;
			case OpCode.VARARG: {
				const countValue = instruction.b === 0 ? maxRegister - instruction.a + 1 : instruction.b;
				addRange(instruction.a, countValue);
				break;
			}
			case OpCode.CALL: {
				const countValue = instruction.c === 0 ? maxRegister - instruction.a + 1 : instruction.c;
				addRange(instruction.a, countValue);
				break;
			}
			default:
				break;
		}
		return defs;
	};

	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		blockUse[blockIndex] = new Uint8Array(registerCount);
		blockDef[blockIndex] = new Uint8Array(registerCount);
		liveIn[blockIndex] = new Uint8Array(registerCount);
		liveOut[blockIndex] = new Uint8Array(registerCount);

		const block = blocks[blockIndex];
		const use = blockUse[blockIndex];
		const def = blockDef[blockIndex];
		for (let i = block.start; i < block.end; i += 1) {
			const instruction = instructions[i];
			const uses = collectUsesForLiveness(instruction);
			for (let u = 0; u < uses.length; u += 1) {
				const reg = uses[u];
				if (reg < registerCount && def[reg] === 0) {
					use[reg] = 1;
				}
			}
			const defs = collectDefs(instruction);
			for (let d = 0; d < defs.length; d += 1) {
				const reg = defs[d];
				if (reg < registerCount) {
					def[reg] = 1;
				}
			}
		}
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
			const out = liveOut[blockIndex];
			const nextOut = new Uint8Array(registerCount);
			const succs = successors[blockIndex];
			for (let s = 0; s < succs.length; s += 1) {
				const succIn = liveIn[succs[s]];
				for (let r = 0; r < registerCount; r += 1) {
					if (succIn[r] !== 0) {
						nextOut[r] = 1;
					}
				}
			}
			for (let r = 0; r < registerCount; r += 1) {
				if (out[r] !== nextOut[r]) {
					out[r] = nextOut[r];
					changed = true;
				}
			}
			const use = blockUse[blockIndex];
			const def = blockDef[blockIndex];
			const inSet = liveIn[blockIndex];
			for (let r = 0; r < registerCount; r += 1) {
				const nextIn = use[r] !== 0 || (out[r] !== 0 && def[r] === 0) ? 1 : 0;
				if (inSet[r] !== nextIn) {
					inSet[r] = nextIn;
					changed = true;
				}
			}
		}
	}

	const keep = new Array<boolean>(count).fill(true);
	let removed = 0;
	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const block = blocks[blockIndex];
		const live = liveOut[blockIndex].slice();
		for (let i = block.end - 1; i >= block.start; i -= 1) {
			const instruction = instructions[i];
			const defs = collectDefs(instruction);
			let hasLive = false;
			for (let d = 0; d < defs.length; d += 1) {
				const reg = defs[d];
				if (reg < registerCount && live[reg] !== 0) {
					hasLive = true;
					break;
				}
			}
			let hasCaptured = false;
			for (let d = 0; d < defs.length; d += 1) {
				const reg = defs[d];
				if (reg < registerCount && captured[reg] !== 0) {
					hasCaptured = true;
					break;
				}
			}
			if (!pinned[i] && defs.length > 0 && isPureInstruction(instruction) && !hasLive && !hasCaptured) {
				keep[i] = false;
				removed += 1;
				continue;
			}
			for (let d = 0; d < defs.length; d += 1) {
				const reg = defs[d];
				if (reg < registerCount) {
					live[reg] = 0;
				}
			}
			const uses = collectUsesForLiveness(instruction);
			for (let u = 0; u < uses.length; u += 1) {
				const reg = uses[u];
				if (reg < registerCount) {
					live[reg] = 1;
				}
			}
		}
	}

	if (removed === 0) {
		return set;
	}
	return remapInstructions(instructions, ranges, keep, true);
};

const reorderSegments = (set: InstructionSet): InstructionSet => {
	const { instructions, ranges } = set;
	const count = instructions.length;
	if (count === 0) {
		return set;
	}
	for (let i = 0; i < count; i += 1) {
		if (isSkipInstruction(instructions[i])) {
			// Skip-next semantics depend on adjacency; reordering blocks would break them.
			return set;
		}
	}
	const blocks = buildBasicBlocks(instructions);
	if (blocks.length === 0) {
		return set;
	}
	const { blockForIndex } = buildBlockGraph(instructions, blocks);
	const skipped = new Array<boolean>(count).fill(false);
	for (let i = 0; i < count; i += 1) {
		if (isSkipInstruction(instructions[i]) && i + 1 < count) {
			skipped[i + 1] = true;
		}
	}

	type Segment = {
		blocks: number[];
		jumpTarget: number | null;
	};

	const segments: Segment[] = [];
	let current: Segment | null = null;
	for (let i = 0; i < blocks.length; i += 1) {
		if (!current) {
			current = { blocks: [], jumpTarget: null };
		}
		current.blocks.push(i);
		const block = blocks[i];
		const lastIndex = block.end - 1;
		const last = instructions[lastIndex];
		const terminates = last.op === OpCode.JMP || last.op === OpCode.RET;
		if (terminates) {
			segments.push(current);
			current = null;
		}
	}
	if (current) {
		segments.push(current);
	}

	const segmentOfBlock = new Array<number>(blocks.length);
	for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
		const segment = segments[segIndex];
		for (let i = 0; i < segment.blocks.length; i += 1) {
			segmentOfBlock[segment.blocks[i]] = segIndex;
		}
	}

	for (let segIndex = 0; segIndex < segments.length; segIndex += 1) {
		const segment = segments[segIndex];
		const lastBlockIndex = segment.blocks[segment.blocks.length - 1];
		const lastBlock = blocks[lastBlockIndex];
		const lastIndex = lastBlock.end - 1;
		const last = instructions[lastIndex];
		if (last.op !== OpCode.JMP || skipped[lastIndex]) {
			continue;
		}
		const target = getJumpTarget(last);
		if (target < 0 || target >= count) {
			continue;
		}
		const targetBlock = blockForIndex[target];
		segment.jumpTarget = segmentOfBlock[targetBlock];
	}

	const visited = new Array<boolean>(segments.length).fill(false);
	const order: number[] = [];
	const appendTrace = (start: number): void => {
		let currentIndex = start;
		while (!visited[currentIndex]) {
			visited[currentIndex] = true;
			order.push(currentIndex);
			const next = segments[currentIndex].jumpTarget;
			if (next === null || visited[next]) {
				break;
			}
			currentIndex = next;
		}
	};

	if (segments.length > 0) {
		appendTrace(segmentOfBlock[0]);
		for (let i = 0; i < segments.length; i += 1) {
			if (!visited[i]) {
				appendTrace(i);
			}
		}
	}

	let unchanged = true;
	for (let i = 0; i < order.length; i += 1) {
		if (order[i] !== i) {
			unchanged = false;
			break;
		}
	}
	if (unchanged) {
		return set;
	}

	const indexMap = new Array<number>(count);
	let newIndex = 0;
	const nextInstructions: Instruction[] = new Array(count);
	const nextRanges: Array<SourceRange | null> = new Array(count);
	for (let orderIndex = 0; orderIndex < order.length; orderIndex += 1) {
		const segment = segments[order[orderIndex]];
		for (let i = 0; i < segment.blocks.length; i += 1) {
			const block = blocks[segment.blocks[i]];
			for (let index = block.start; index < block.end; index += 1) {
				indexMap[index] = newIndex;
				nextInstructions[newIndex] = instructions[index];
				nextRanges[newIndex] = ranges[index];
				newIndex += 1;
			}
		}
	}

	for (let i = 0; i < nextInstructions.length; i += 1) {
		const instruction = nextInstructions[i];
		if (!isJump(instruction)) {
			continue;
		}
		const target = getJumpTarget(instruction);
		if (target === count) {
			instruction.target = newIndex;
			continue;
		}
		instruction.target = indexMap[target];
	}

	return { instructions: nextInstructions, ranges: nextRanges };
};

type InlineCallee = {
	meta: OptimizationProtoMeta;
	set: InstructionSet;
};

const MAX_INLINE_CALLEE_INSTRUCTIONS = 48;
const MAX_INLINE_GROWTH = 256;
const MAX_INLINE_CALLS_PER_FUNCTION = 64;

const cloneInstruction = (instruction: Instruction): Instruction => ({
	op: instruction.op,
	a: instruction.a,
	b: instruction.b,
	c: instruction.c,
	format: instruction.format,
	rkMask: instruction.rkMask,
	target: instruction.target,
});

const hasDynamicTopUsage = (instructions: Instruction[]): boolean => {
	for (let i = 0; i < instructions.length; i += 1) {
		const instruction = instructions[i];
		if (instruction.op === OpCode.CALL && (instruction.b === 0 || instruction.c === 0)) {
			return true;
		}
		if (instruction.op === OpCode.RET && instruction.b === 0) {
			return true;
		}
	}
	return false;
};

const equalClosureMaps = (left: Map<number, number>, right: Map<number, number>): boolean => {
	if (left.size !== right.size) {
		return false;
	}
	for (const [reg, protoIndex] of left) {
		if (right.get(reg) !== protoIndex) {
			return false;
		}
	}
	return true;
};

const intersectClosureMaps = (maps: Array<Map<number, number>>): Map<number, number> => {
	if (maps.length === 0) {
		return new Map<number, number>();
	}
	const [first, ...rest] = maps;
	const result = new Map<number, number>();
	for (const [reg, protoIndex] of first) {
		let same = true;
		for (let i = 0; i < rest.length; i += 1) {
			if (rest[i].get(reg) !== protoIndex) {
				same = false;
				break;
			}
		}
		if (same) {
			result.set(reg, protoIndex);
		}
	}
	return result;
};

const clearClosureRange = (closures: Map<number, number>, start: number, countValue: number | null): void => {
	if (countValue === null) {
		for (const reg of Array.from(closures.keys())) {
			if (reg >= start) {
				closures.delete(reg);
			}
		}
		return;
	}
	for (let offset = 0; offset < countValue; offset += 1) {
		closures.delete(start + offset);
	}
};

const computeCapturedRegistersForInlining = (instructions: Instruction[], context: OptimizationContext): number[] => {
	if (instructions.length === 0) {
		return [];
	}
	const maxRegister = computeMaxRegister(instructions);
	const registerCount = maxRegister + 1;
	const captured = new Uint8Array(registerCount);
	for (let i = 0; i < instructions.length; i += 1) {
		const instruction = instructions[i];
		if (instruction.op !== OpCode.CLOSURE) {
			continue;
		}
		const upvalues = context.getClosureUpvalues(instruction.b);
		for (let u = 0; u < upvalues.length; u += 1) {
			const desc = upvalues[u];
			if (!desc.inStack) {
				continue;
			}
			if (desc.index >= registerCount) {
				throw new Error(`[ProgramOptimizer] Closure upvalue register out of range: r${desc.index}.`);
			}
			captured[desc.index] = 1;
		}
	}
	const capturedRegisters: number[] = [];
	for (let reg = 0; reg < registerCount; reg += 1) {
		if (captured[reg] !== 0) {
			capturedRegisters.push(reg);
		}
	}
	return capturedRegisters;
};

const applyClosureTransferForInlining = (
	closures: Map<number, number>,
	instruction: Instruction,
	capturedRegisters: ReadonlyArray<number>,
): void => {
	switch (instruction.op) {
		case OpCode.MOV: {
			const source = closures.get(instruction.b);
			if (source !== undefined) {
				closures.set(instruction.a, source);
			} else {
				closures.delete(instruction.a);
			}
			return;
		}
		case OpCode.CLOSURE:
			closures.set(instruction.a, instruction.b);
			return;
		case OpCode.LOADNIL:
			clearClosureRange(closures, instruction.a, instruction.b);
			return;
		case OpCode.VARARG: {
			const countValue = instruction.b === 0 ? null : instruction.b;
			clearClosureRange(closures, instruction.a, countValue);
			return;
		}
		case OpCode.CALL: {
			const countValue = instruction.c === 0 ? null : instruction.c;
			clearClosureRange(closures, instruction.a, countValue);
			for (let i = 0; i < capturedRegisters.length; i += 1) {
				closures.delete(capturedRegisters[i]);
			}
			return;
		}
		case OpCode.LOADK:
		case OpCode.LOADBOOL:
		case OpCode.GETG:
		case OpCode.GETT:
		case OpCode.NEWT:
		case OpCode.ADD:
		case OpCode.SUB:
		case OpCode.MUL:
		case OpCode.DIV:
		case OpCode.MOD:
		case OpCode.FLOORDIV:
		case OpCode.POW:
		case OpCode.BAND:
		case OpCode.BOR:
		case OpCode.BXOR:
		case OpCode.SHL:
		case OpCode.SHR:
		case OpCode.CONCAT:
		case OpCode.CONCATN:
		case OpCode.UNM:
		case OpCode.NOT:
		case OpCode.LEN:
		case OpCode.BNOT:
		case OpCode.GETUP:
		case OpCode.LOAD_MEM:
		case OpCode.TESTSET:
			closures.delete(instruction.a);
			return;
		default:
			return;
	}
};

const computeClosureInForInlining = (
	instructions: Instruction[],
	context: OptimizationContext,
): {
	blocks: Block[];
	inMaps: Array<Map<number, number>>;
	capturedRegisters: number[];
} => {
	const blocks = buildBasicBlocks(instructions);
	const { predecessors } = buildBlockGraph(instructions, blocks);
	const blockCount = blocks.length;
	const inMaps: Array<Map<number, number>> = new Array(blockCount);
	const outMaps: Array<Map<number, number>> = new Array(blockCount);
	const capturedRegisters = computeCapturedRegistersForInlining(instructions, context);
	for (let i = 0; i < blockCount; i += 1) {
		inMaps[i] = new Map<number, number>();
		outMaps[i] = new Map<number, number>();
	}
	let changed = true;
	while (changed) {
		changed = false;
		for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
			const preds = predecessors[blockIndex];
			const nextIn = preds.length === 0
				? new Map<number, number>()
				: intersectClosureMaps(preds.map(pred => outMaps[pred]));
			if (!equalClosureMaps(nextIn, inMaps[blockIndex])) {
				inMaps[blockIndex] = nextIn;
				changed = true;
			}
			const closures = new Map(inMaps[blockIndex]);
			const block = blocks[blockIndex];
			for (let i = block.start; i < block.end; i += 1) {
				applyClosureTransferForInlining(closures, instructions[i], capturedRegisters);
			}
			if (!equalClosureMaps(closures, outMaps[blockIndex])) {
				outMaps[blockIndex] = closures;
				changed = true;
			}
		}
	}
	return { blocks, inMaps, capturedRegisters };
};

const buildInlineExpansion = (
	callInstruction: Instruction,
	callRange: SourceRange | null,
	callee: InlineCallee,
): InstructionSet | null => {
	const argCount = callInstruction.b;
	const resultCount = callInstruction.c;
	const callBase = callInstruction.a;
	const { instructions, ranges } = callee.set;
	const calleeCount = instructions.length;
	const mapRegister = (register: number): number => callBase + register;
	const remapRkOperand = (operand: number): number => (operand >= 0 ? mapRegister(operand) : operand);
	const generatedInstructions: Instruction[] = [];
	const generatedRanges: Array<SourceRange | null> = [];
	const oldToNewStart = new Array<number>(calleeCount);
	const pendingCalleeJumps: Array<{ localIndex: number; target: number }> = [];
	const pendingExitJumps: number[] = [];

	const copiedParams = Math.min(argCount, callee.meta.numParams);
	for (let index = 0; index < copiedParams; index += 1) {
		generatedInstructions.push({
			op: OpCode.MOV,
			a: mapRegister(index),
			b: callBase + 1 + index,
			c: 0,
			format: 'ABC',
			rkMask: 0,
			target: null,
		});
		generatedRanges.push(callRange);
	}

	if (callee.meta.numParams > argCount) {
		generatedInstructions.push({
			op: OpCode.LOADNIL,
			a: mapRegister(argCount),
			b: callee.meta.numParams - argCount,
			c: 0,
			format: 'ABC',
			rkMask: 0,
			target: null,
		});
		generatedRanges.push(callRange);
	}

	for (let i = 0; i < calleeCount; i += 1) {
		oldToNewStart[i] = generatedInstructions.length;
		const instruction = instructions[i];
		const range = ranges[i] ?? callRange;
		if (instruction.op === OpCode.RET) {
			const copied = Math.min(instruction.b, resultCount);
			const retBase = mapRegister(instruction.a);
			for (let offset = 0; offset < copied; offset += 1) {
				generatedInstructions.push({
					op: OpCode.MOV,
					a: callBase + offset,
					b: retBase + offset,
					c: 0,
					format: 'ABC',
					rkMask: 0,
					target: null,
				});
				generatedRanges.push(range);
			}
			if (resultCount > copied) {
				generatedInstructions.push({
					op: OpCode.LOADNIL,
					a: callBase + copied,
					b: resultCount - copied,
					c: 0,
					format: 'ABC',
					rkMask: 0,
					target: null,
				});
				generatedRanges.push(range);
			}
			const jumpIndex = generatedInstructions.length;
			generatedInstructions.push({
				op: OpCode.JMP,
				a: 0,
				b: 0,
				c: 0,
				format: 'AsBx',
				rkMask: 0,
				target: null,
			});
			generatedRanges.push(range);
			pendingExitJumps.push(jumpIndex);
			continue;
		}

		const mapped = cloneInstruction(instruction);
		switch (mapped.op) {
			case OpCode.MOV:
			case OpCode.UNM:
			case OpCode.NOT:
			case OpCode.LEN:
			case OpCode.BNOT:
				mapped.a = mapRegister(mapped.a);
				mapped.b = mapRegister(mapped.b);
				break;
			case OpCode.LOADK:
			case OpCode.LOADBOOL:
			case OpCode.GETG:
			case OpCode.NEWT:
				mapped.a = mapRegister(mapped.a);
				break;
			case OpCode.LOADNIL:
				mapped.a = mapRegister(mapped.a);
				break;
			case OpCode.GETT:
				mapped.a = mapRegister(mapped.a);
				mapped.b = mapRegister(mapped.b);
				mapped.c = remapRkOperand(mapped.c);
				break;
			case OpCode.SETT:
				mapped.a = mapRegister(mapped.a);
				mapped.b = remapRkOperand(mapped.b);
				mapped.c = remapRkOperand(mapped.c);
				break;
			case OpCode.ADD:
			case OpCode.SUB:
			case OpCode.MUL:
			case OpCode.DIV:
			case OpCode.MOD:
			case OpCode.FLOORDIV:
			case OpCode.POW:
			case OpCode.BAND:
			case OpCode.BOR:
			case OpCode.BXOR:
			case OpCode.SHL:
			case OpCode.SHR:
			case OpCode.CONCAT:
				mapped.a = mapRegister(mapped.a);
				mapped.b = remapRkOperand(mapped.b);
				mapped.c = remapRkOperand(mapped.c);
				break;
			case OpCode.EQ:
			case OpCode.LT:
			case OpCode.LE:
				mapped.b = remapRkOperand(mapped.b);
				mapped.c = remapRkOperand(mapped.c);
				break;
			case OpCode.CONCATN:
				mapped.a = mapRegister(mapped.a);
				mapped.b = mapRegister(mapped.b);
				break;
			case OpCode.TEST:
			case OpCode.JMPIF:
			case OpCode.JMPIFNOT:
				mapped.a = mapRegister(mapped.a);
				break;
			case OpCode.TESTSET:
				mapped.a = mapRegister(mapped.a);
				mapped.b = mapRegister(mapped.b);
				break;
			case OpCode.SETG:
				mapped.a = mapRegister(mapped.a);
				break;
			case OpCode.JMP:
				break;
			case OpCode.GETUP: {
				const desc = callee.meta.upvalueDescs[mapped.b];
				if (!desc) {
					throw new Error('[ProgramOptimizer] Missing callee upvalue descriptor.');
				}
				if (desc.inStack) {
					mapped.op = OpCode.MOV;
					mapped.a = mapRegister(mapped.a);
					mapped.b = desc.index;
					mapped.c = 0;
					mapped.format = 'ABC';
					mapped.rkMask = 0;
					mapped.target = null;
					break;
				}
				mapped.a = mapRegister(mapped.a);
				mapped.b = desc.index;
				break;
			}
			case OpCode.SETUP: {
				const desc = callee.meta.upvalueDescs[mapped.b];
				if (!desc) {
					throw new Error('[ProgramOptimizer] Missing callee upvalue descriptor.');
				}
				if (desc.inStack) {
					const source = mapRegister(mapped.a);
					mapped.op = OpCode.MOV;
					mapped.a = desc.index;
					mapped.b = source;
					mapped.c = 0;
					mapped.format = 'ABC';
					mapped.rkMask = 0;
					mapped.target = null;
					break;
				}
				mapped.a = mapRegister(mapped.a);
				mapped.b = desc.index;
				break;
			}
			case OpCode.VARARG:
			case OpCode.CLOSURE:
			case OpCode.RET:
				return null;
			case OpCode.CALL:
				mapped.a = mapRegister(mapped.a);
				break;
			case OpCode.LOAD_MEM:
				mapped.a = mapRegister(mapped.a);
				mapped.b = remapRkOperand(mapped.b);
				break;
			case OpCode.STORE_MEM:
				mapped.a = mapRegister(mapped.a);
				mapped.b = remapRkOperand(mapped.b);
				break;
			case OpCode.STORE_MEM_WORDS:
				mapped.a = mapRegister(mapped.a);
				mapped.b = remapRkOperand(mapped.b);
				break;
			default:
				break;
		}
		if (isJump(mapped)) {
			pendingCalleeJumps.push({ localIndex: generatedInstructions.length, target: getJumpTarget(instruction) });
		}
		generatedInstructions.push(mapped);
		generatedRanges.push(range);
	}

	const exitIndex = generatedInstructions.length;
	for (let i = 0; i < pendingExitJumps.length; i += 1) {
		generatedInstructions[pendingExitJumps[i]].target = exitIndex;
	}
	for (let i = 0; i < pendingCalleeJumps.length; i += 1) {
		const pending = pendingCalleeJumps[i];
		if (pending.target < 0 || pending.target > calleeCount) {
			throw new Error(`[ProgramOptimizer] Invalid inlined jump target ${pending.target}.`);
		}
		const mappedTarget = pending.target === calleeCount ? exitIndex : oldToNewStart[pending.target];
		generatedInstructions[pending.localIndex].target = mappedTarget;
	}

	return {
		instructions: generatedInstructions,
		ranges: generatedRanges,
	};
};

const inlineCallAtIndex = (
	set: InstructionSet,
	callIndex: number,
	expansion: InstructionSet,
): InstructionSet => {
	const { instructions, ranges } = set;
	const count = instructions.length;
	const expansionCount = expansion.instructions.length;
	const nextCount = count - 1 + expansionCount;
	const nextInstructions: Instruction[] = new Array(nextCount);
	const nextRanges: Array<SourceRange | null> = new Array(nextCount);
	const origin = new Array<number>(nextCount).fill(-1);
	const indexMap = new Array<number>(count + 1);
	let writeIndex = 0;
	for (let i = 0; i < count; i += 1) {
		if (i === callIndex) {
			indexMap[i] = writeIndex;
			const localStart = writeIndex;
			for (let j = 0; j < expansionCount; j += 1) {
				const instruction = cloneInstruction(expansion.instructions[j]);
				if (isJump(instruction)) {
					instruction.target = localStart + getJumpTarget(instruction);
				}
				nextInstructions[writeIndex] = instruction;
				nextRanges[writeIndex] = expansion.ranges[j];
				writeIndex += 1;
			}
			continue;
		}
		indexMap[i] = writeIndex;
		nextInstructions[writeIndex] = instructions[i];
		nextRanges[writeIndex] = ranges[i];
		origin[writeIndex] = i;
		writeIndex += 1;
	}
	indexMap[count] = nextCount;

	for (let i = 0; i < nextCount; i += 1) {
		const sourceIndex = origin[i];
		if (sourceIndex < 0) {
			continue;
		}
		const instruction = nextInstructions[i];
		if (!isJump(instruction)) {
			continue;
		}
		const oldTarget = getJumpTarget(instructions[sourceIndex]);
		instruction.target = oldTarget === count ? nextCount : indexMap[oldTarget];
	}

	return { instructions: nextInstructions, ranges: nextRanges };
};

const inlineFunctionCalls = (
	set: InstructionSet,
	context: OptimizationContext,
): InstructionSet => {
	if (set.instructions.length === 0 || hasDynamicTopUsage(set.instructions)) {
		return set;
	}
	const initialCount = set.instructions.length;
	const maxCount = initialCount + MAX_INLINE_GROWTH;
	const calleeCache = new Map<number, InlineCallee | null>();
	const getInlineCallee = (protoIndex: number): InlineCallee | null => {
		const cached = calleeCache.get(protoIndex);
		if (cached !== undefined) {
			return cached;
		}
		const instructionSet = context.getProtoInstructionSet(protoIndex);
		if (!instructionSet) {
			calleeCache.set(protoIndex, null);
			return null;
		}
		const meta = context.getProtoMeta(protoIndex);
		if (meta.isVararg || instructionSet.instructions.length === 0 || instructionSet.instructions.length > MAX_INLINE_CALLEE_INSTRUCTIONS) {
			calleeCache.set(protoIndex, null);
			return null;
		}
		if (hasDynamicTopUsage(instructionSet.instructions)) {
			calleeCache.set(protoIndex, null);
			return null;
		}
		let hasReturn = false;
		for (let i = 0; i < instructionSet.instructions.length; i += 1) {
			const instruction = instructionSet.instructions[i];
			if (instruction.op === OpCode.RET) {
				if (instruction.b === 0) {
					calleeCache.set(protoIndex, null);
					return null;
				}
				hasReturn = true;
				continue;
			}
			if (instruction.op === OpCode.CLOSURE || instruction.op === OpCode.VARARG) {
				calleeCache.set(protoIndex, null);
				return null;
			}
			if (instruction.op === OpCode.CALL && (instruction.b === 0 || instruction.c === 0)) {
				calleeCache.set(protoIndex, null);
				return null;
			}
		}
		if (!hasReturn) {
			calleeCache.set(protoIndex, null);
			return null;
		}
		const callee: InlineCallee = { meta, set: instructionSet };
		calleeCache.set(protoIndex, callee);
		return callee;
	};

	let current = set;
	let inlinedCalls = 0;
	while (inlinedCalls < MAX_INLINE_CALLS_PER_FUNCTION && current.instructions.length < maxCount) {
		const { instructions, ranges } = current;
		const analysis = computeClosureInForInlining(instructions, context);
		let inlined = false;
		for (let blockIndex = 0; blockIndex < analysis.blocks.length; blockIndex += 1) {
			const block = analysis.blocks[blockIndex];
			const closures = new Map(analysis.inMaps[blockIndex]);
			for (let index = block.start; index < block.end; index += 1) {
				const instruction = instructions[index];
				if (instruction.op === OpCode.CALL && instruction.b > 0 && instruction.c > 0) {
					const protoIndex = closures.get(instruction.a);
					if (protoIndex !== undefined) {
						const callee = getInlineCallee(protoIndex);
						if (callee && instruction.b <= callee.meta.numParams && callee.meta.maxStack <= Math.max(instruction.b + 1, instruction.c)) {
							const expansion = buildInlineExpansion(instruction, ranges[index], callee);
							if (expansion) {
								const nextCount = instructions.length - 1 + expansion.instructions.length;
								if (nextCount <= maxCount) {
									current = inlineCallAtIndex(current, index, expansion);
									inlinedCalls += 1;
									inlined = true;
									break;
								}
							}
						}
					}
				}
				applyClosureTransferForInlining(closures, instruction, analysis.capturedRegisters);
			}
			if (inlined) {
				break;
			}
		}
		if (!inlined) {
			break;
		}
	}
	return current;
};

const runMidLevelOptimizations = (
	set: InstructionSet,
	context: OptimizationContext,
): InstructionSet => {
	let current = simplifyCompareBool(set);
	current = propagateValues(current, context);
	current = eliminateDeadStores(current, context);
	current = removeNoOps(current);
	current = threadJumps(current);
	current = removeUnreachable(current);
	current = removeNoOps(current);
	current = foldConstants(current, context);
	current = propagateValues(current, context);
	current = eliminateDeadStores(current, context);
	current = removeNoOps(current);
	current = threadJumps(current);
	current = removeUnreachable(current);
	current = removeNoOps(current);
	current = reorderSegments(current);
	current = removeNoOps(current);
	current = threadJumps(current);
	current = removeUnreachable(current);
	current = removeNoOps(current);
	return current;
};

export const optimizeInstructions = (
	instructions: Instruction[],
	ranges: Array<SourceRange | null>,
	level: OptimizationLevel,
	context?: OptimizationContext,
): InstructionSet => {
	if (level === 0) {
		return { instructions, ranges };
	}
	let current: InstructionSet = { instructions, ranges };
	current = removeNoOps(current);
	current = threadJumps(current);
	current = removeUnreachable(current);
	current = removeNoOps(current);
	if (level >= 2) {
		if (!context) {
			throw new Error('[ProgramOptimizer] Optimization context is required for level 2+.');
		}
		current = runMidLevelOptimizations(current, context);
	}
	if (level >= 3) {
		if (!context) {
			throw new Error('[ProgramOptimizer] Optimization context is required for level 3.');
		}
		current = inlineFunctionCalls(current, context);
		current = removeNoOps(current);
		current = threadJumps(current);
		current = removeUnreachable(current);
		current = removeNoOps(current);
		current = applyGlobalOptimizations(current, context);
		current = removeNoOps(current);
		current = threadJumps(current);
		current = removeUnreachable(current);
		current = removeNoOps(current);
		current = runMidLevelOptimizations(current, context);
	}
	return current;
};
