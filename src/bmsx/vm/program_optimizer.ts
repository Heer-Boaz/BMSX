import { OpCode, type SourceRange, type Value } from './cpu';
import { isStringValue, stringValueToString } from './string_pool';

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

export type OptimizationContext = {
	constPool: ReadonlyArray<Value>;
	constIndex: (value: Value) => number;
};

type InstructionSet = {
	instructions: Instruction[];
	ranges: Array<SourceRange | null>;
};

type ConstValue = {
	value: Value;
	constIndex: number | null;
};

const RK_B = 1;
const RK_C = 2;

const isJump = (instruction: Instruction): boolean =>
	instruction.op === OpCode.JMP || instruction.op === OpCode.JMPIF || instruction.op === OpCode.JMPIFNOT;

const getJumpTarget = (instruction: Instruction): number => {
	if (instruction.target === null) {
		throw new Error('[ProgramOptimizer] Jump target is missing.');
	}
	return instruction.target;
};

const isTruthy = (value: Value): boolean => value !== null && value !== false;

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

const buildBasicBlocks = (instructions: Instruction[]): Array<{ start: number; end: number }> => {
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
	const blocks: Array<{ start: number; end: number }> = [];
	for (let i = 0; i < sorted.length; i += 1) {
		const start = sorted[i];
		const end = i + 1 < sorted.length ? sorted[i + 1] : count;
		if (start < end) {
			blocks.push({ start, end });
		}
	}
	return blocks;
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
	const keep = new Array<boolean>(count).fill(true);
	for (let i = 0; i < count; i += 1) {
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

	for (const block of blocks) {
		const constants = new Map<number, ConstValue>();
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
					if (result !== null) {
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
					if (result !== null) {
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
		current = simplifyCompareBool(current);
		current = removeNoOps(current);
		current = threadJumps(current);
		current = removeUnreachable(current);
		current = removeNoOps(current);
		current = foldConstants(current, context);
		current = removeNoOps(current);
		current = threadJumps(current);
		current = removeUnreachable(current);
		current = removeNoOps(current);
	}
	return current;
};
