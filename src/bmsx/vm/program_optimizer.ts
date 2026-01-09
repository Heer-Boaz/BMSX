import { OpCode, type SourceRange } from './cpu';

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

type InstructionSet = {
	instructions: Instruction[];
	ranges: Array<SourceRange | null>;
};

const isJump = (instruction: Instruction): boolean =>
	instruction.op === OpCode.JMP || instruction.op === OpCode.JMPIF || instruction.op === OpCode.JMPIFNOT;

const getJumpTarget = (instruction: Instruction): number => {
	if (instruction.target === null) {
		throw new Error('[ProgramOptimizer] Jump target is missing.');
	}
	return instruction.target;
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
			case OpCode.TESTSET: {
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

export const optimizeInstructions = (
	instructions: Instruction[],
	ranges: Array<SourceRange | null>,
	level: OptimizationLevel,
): InstructionSet => {
	if (level === 0) {
		return { instructions, ranges };
	}
	let current: InstructionSet = { instructions, ranges };
	current = removeNoOps(current);
	current = threadJumps(current);
	current = removeUnreachable(current);
	current = removeNoOps(current);
	return current;
};
