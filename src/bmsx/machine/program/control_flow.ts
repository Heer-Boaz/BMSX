import { OpCode } from '../cpu/cpu';
import type { Instruction } from './optimizer';

export type Block = {
	start: number;
	end: number;
};

export const isJump = (instruction: Instruction): boolean =>
	instruction.op === OpCode.JMP
	|| instruction.op === OpCode.JMPIF
	|| instruction.op === OpCode.JMPIFNOT
	|| instruction.op === OpCode.BR_TRUE
	|| instruction.op === OpCode.BR_FALSE;

export const getJumpTarget = (instruction: Instruction): number => {
	if (instruction.target === null) {
		throw new Error('[ProgramOptimizer] Jump target is missing.');
	}
	return instruction.target;
};

export const buildBasicBlocks = (instructions: Instruction[]): Block[] => {
	const count = instructions.length;
	if (count === 0) {
		return [];
	}
	const leaders = new Set<number>();
	leaders.add(0);
	const addJumpLeader = (instruction: Instruction): void => {
		const target = instruction.target;
		if (target !== null && target < count) {
			leaders.add(target);
		}
	};
	for (let i = 0; i < count; i += 1) {
		const instruction = instructions[i];
		const next = i + 1;
		const nextNext = i + 2;
		switch (instruction.op) {
			case OpCode.JMP:
				addJumpLeader(instruction);
				if (next < count) {
					leaders.add(next);
				}
				break;
			case OpCode.JMPIF:
			case OpCode.JMPIFNOT:
			case OpCode.BR_TRUE:
			case OpCode.BR_FALSE:
				addJumpLeader(instruction);
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

export const buildBlockGraph = (instructions: Instruction[], blocks: Block[]): {
	blockForIndex: number[];
	predecessors: number[][];
	successors: number[][];
} => {
	const count = instructions.length;
	const blockCount = blocks.length;
	const blockForIndex = new Array<number>(count);
	for (let i = 0; i < blockCount; i += 1) {
		const block = blocks[i];
		for (let index = block.start; index < block.end; index += 1) {
			blockForIndex[index] = i;
		}
	}
	const successors: number[][] = new Array(blockCount);
	const predecessors: number[][] = new Array(blockCount);
	for (let i = 0; i < blockCount; i += 1) {
		successors[i] = [];
		predecessors[i] = [];
	}

	const addSuccessor = (blockIndex: number, targetIndex: number): void => {
		const list = successors[blockIndex];
		for (let i = 0; i < list.length; i += 1) {
			if (list[i] === targetIndex) {
				return;
			}
		}
		list.push(targetIndex);
	};
	const addIndexSuccessor = (blockIndex: number, instructionIndex: number): void => {
		if (instructionIndex < count) {
			addSuccessor(blockIndex, blockForIndex[instructionIndex]);
		}
	};

	for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
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
			case OpCode.JMP:
				addIndexSuccessor(blockIndex, getJumpTarget(instruction));
				break;
			case OpCode.JMPIF:
			case OpCode.JMPIFNOT:
			case OpCode.BR_TRUE:
			case OpCode.BR_FALSE:
				addIndexSuccessor(blockIndex, getJumpTarget(instruction));
				addIndexSuccessor(blockIndex, nextIndex);
				break;
			case OpCode.LOADBOOL:
				addIndexSuccessor(blockIndex, nextIndex);
				if (instruction.c !== 0) {
					addIndexSuccessor(blockIndex, nextNextIndex);
				}
				break;
			case OpCode.TEST:
			case OpCode.TESTSET:
			case OpCode.EQ:
			case OpCode.LT:
			case OpCode.LE:
				addIndexSuccessor(blockIndex, nextIndex);
				addIndexSuccessor(blockIndex, nextNextIndex);
				break;
			default:
				addIndexSuccessor(blockIndex, nextIndex);
				break;
		}
	}

	for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
		const nextBlocks = successors[blockIndex];
		for (let i = 0; i < nextBlocks.length; i += 1) {
			predecessors[nextBlocks[i]].push(blockIndex);
		}
	}

	return { blockForIndex, predecessors, successors };
};
