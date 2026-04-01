import { OpCode, type SourceRange, type Value } from './cpu';
import { MAX_EXT_CONST, MAX_SIGNED_BX, MIN_SIGNED_BX } from './instruction_format';
import { isStringValue, stringValueToString } from './string_pool';
import type { Instruction, InstructionSet, OptimizationContext } from './program_optimizer';

type Block = {
	start: number;
	end: number;
};

type Phi = {
	reg: number;
	args: number[];
	dest: number;
};

type UseOperand = {
	field: 'a' | 'b' | 'c';
	reg: number;
	rkMaskBit: number | null;
	allowRk: boolean;
};

type UseSlot = UseOperand & {
	valueId: number;
};

type ValueDef = {
	kind: 'instr' | 'phi';
	index: number;
};

type ConstValue = {
	value: Value;
	constIndex: number;
};

type DefSlot = {
	reg: number;
	valueId: number;
};

const RK_B = 1;
const RK_C = 2;
const SCCP_UNDEF = 0;
const SCCP_CONST = 1;
const SCCP_OVERDEFINED = 2;

const isJump = (instruction: Instruction): boolean =>
	instruction.op === OpCode.JMP
	|| instruction.op === OpCode.JMPIF
	|| instruction.op === OpCode.JMPIFNOT
	|| instruction.op === OpCode.BR_TRUE
	|| instruction.op === OpCode.BR_FALSE;

const getImmediateConstValue = (instruction: Instruction, context: OptimizationContext): ConstValue | null => {
	switch (instruction.op) {
		case OpCode.KNIL:
			return { value: null, constIndex: context.constIndex(null) };
		case OpCode.KFALSE:
			return { value: false, constIndex: context.constIndex(false) };
		case OpCode.KTRUE:
			return { value: true, constIndex: context.constIndex(true) };
		case OpCode.K0:
			return { value: 0, constIndex: context.constIndex(0) };
		case OpCode.K1:
			return { value: 1, constIndex: context.constIndex(1) };
		case OpCode.KM1:
			return { value: -1, constIndex: context.constIndex(-1) };
		case OpCode.KSMI:
			return { value: instruction.b, constIndex: context.constIndex(instruction.b) };
		default:
			return null;
	}
};

const getJumpTarget = (instruction: Instruction): number => {
	if (instruction.target === null) {
		throw new Error('[ProgramOptimizer] Jump target is missing.');
	}
	return instruction.target;
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
			case OpCode.BR_TRUE:
			case OpCode.BR_FALSE:
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
			case OpCode.BR_TRUE:
			case OpCode.BR_FALSE: {
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

const computeMaxRegister = (instructions: Instruction[]): number => {
	let maxRegister = 0;
	const updateMax = (register: number): void => {
		if (register > maxRegister) {
			maxRegister = register;
		}
	};
	for (const instruction of instructions) {
		switch (instruction.op) {
			case OpCode.KNIL:
			case OpCode.KFALSE:
			case OpCode.KTRUE:
			case OpCode.K0:
			case OpCode.K1:
			case OpCode.KM1:
			case OpCode.KSMI:
			case OpCode.LOADK:
			case OpCode.LOADNIL:
			case OpCode.LOADBOOL:
			case OpCode.GETG:
			case OpCode.GETSYS:
			case OpCode.GETGL:
			case OpCode.NEWT:
			case OpCode.CLOSURE:
			case OpCode.GETUP:
				updateMax(instruction.a);
				break;
			case OpCode.SETG:
			case OpCode.SETSYS:
			case OpCode.SETGL:
			case OpCode.SETUP:
			case OpCode.TEST:
			case OpCode.JMPIF:
			case OpCode.JMPIFNOT:
			case OpCode.BR_TRUE:
			case OpCode.BR_FALSE:
			case OpCode.LOAD_MEM:
				updateMax(instruction.a);
				if (instruction.op === OpCode.LOAD_MEM) {
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
				updateMax(instruction.b);
				break;
			case OpCode.STORE_MEM_WORDS:
				updateMax(instruction.a);
				updateMax(instruction.a + Math.max(instruction.c - 1, 0));
				updateMax(instruction.b);
				break;
			default:
				break;
		}
	}
	return maxRegister;
};

const supportsRkB = (op: OpCode): boolean => {
	switch (op) {
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
		case OpCode.SETT:
		case OpCode.STORE_MEM_WORDS:
			return true;
		default:
			return false;
	}
};

const supportsRkC = (op: OpCode): boolean => {
	switch (op) {
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
		case OpCode.SETT:
			return true;
		default:
			return false;
	}
};

const isCommutative = (op: OpCode): boolean =>
	op === OpCode.ADD
		|| op === OpCode.MUL
		|| op === OpCode.BAND
		|| op === OpCode.BOR
		|| op === OpCode.BXOR
		|| op === OpCode.EQ;

const isValueNumberable = (op: OpCode): boolean => {
	switch (op) {
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
		case OpCode.UNM:
		case OpCode.BNOT:
		case OpCode.NOT:
		case OpCode.LEN:
			return true;
		default:
			return false;
	}
};

const isPureInstruction = (instruction: Instruction): boolean => {
	switch (instruction.op) {
		case OpCode.MOV:
		case OpCode.KNIL:
		case OpCode.KFALSE:
		case OpCode.KTRUE:
		case OpCode.K0:
		case OpCode.K1:
		case OpCode.KM1:
		case OpCode.KSMI:
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

const replaceWithMov = (instruction: Instruction, dst: number, src: number): void => {
	instruction.op = OpCode.MOV;
	instruction.a = dst;
	instruction.b = src;
	instruction.c = 0;
	instruction.format = 'ABC';
	instruction.rkMask = 0;
	instruction.target = null;
	instruction.callProtoIndex = null;
};

const replaceWithUnm = (instruction: Instruction, dst: number, src: number): void => {
	instruction.op = OpCode.UNM;
	instruction.a = dst;
	instruction.b = src;
	instruction.c = 0;
	instruction.format = 'ABC';
	instruction.rkMask = 0;
	instruction.target = null;
	instruction.callProtoIndex = null;
};

const replaceWithJump = (instruction: Instruction, target: number): void => {
	instruction.op = OpCode.JMP;
	instruction.a = 0;
	instruction.b = 0;
	instruction.c = 0;
	instruction.format = 'AsBx';
	instruction.rkMask = 0;
	instruction.target = target;
	instruction.callProtoIndex = null;
};

const replaceWithNop = (instruction: Instruction): void => {
	replaceWithMov(instruction, 0, 0);
};

const simplifyBranches = (
	instructions: Instruction[],
	instrUses: UseSlot[][],
	valueConst: Array<ConstValue | null>,
	valueCopy: Array<number | null>,
	context: OptimizationContext,
): void => {
	const count = instructions.length;
	const getSlot = (uses: UseSlot[] | undefined, field: 'a' | 'b' | 'c'): UseSlot | null => {
		if (!uses) {
			return null;
		}
		for (let i = 0; i < uses.length; i += 1) {
			if (uses[i].field === field) {
				return uses[i];
			}
		}
		return null;
	};
	const getRegisterConst = (slot: UseSlot | null): ConstValue | null => {
		if (!slot) {
			throw new Error('[ProgramOptimizer] Missing SSA register operand.');
		}
		return resolveConst(slot.valueId, valueConst, valueCopy);
	};
	for (let i = 0; i < count; i += 1) {
		const instruction = instructions[i];
		const uses = instrUses[i];
		switch (instruction.op) {
			case OpCode.JMPIF:
			case OpCode.JMPIFNOT: {
				const slot = getSlot(uses, 'a');
				const value = getRegisterConst(slot);
				if (!value) {
					break;
				}
				const truthy = isTruthy(value.value);
				const shouldJump = instruction.op === OpCode.JMPIF ? truthy : !truthy;
				if (shouldJump) {
					replaceWithJump(instruction, getJumpTarget(instruction));
				} else {
					replaceWithNop(instruction);
				}
				instrUses[i] = [];
				break;
			}
			case OpCode.BR_TRUE:
			case OpCode.BR_FALSE: {
				const slot = getSlot(uses, 'a');
				const value = getRegisterConst(slot);
				if (!value) {
					break;
				}
				const truthy = isTruthy(value.value);
				const shouldJump = instruction.op === OpCode.BR_TRUE ? truthy : !truthy;
				if (shouldJump) {
					replaceWithJump(instruction, getJumpTarget(instruction));
				} else {
					replaceWithNop(instruction);
				}
				instrUses[i] = [];
				break;
			}
			case OpCode.TEST: {
				const slot = getSlot(uses, 'a');
				const value = getRegisterConst(slot);
				if (!value) {
					break;
				}
				const expected = instruction.c !== 0;
				const shouldSkip = isTruthy(value.value) !== expected;
				if (shouldSkip) {
					replaceWithJump(instruction, Math.min(i + 2, count));
				} else {
					replaceWithNop(instruction);
				}
				instrUses[i] = [];
				break;
			}
			case OpCode.TESTSET: {
				const slot = getSlot(uses, 'b');
				const value = getRegisterConst(slot);
				if (!value) {
					break;
				}
				const expected = instruction.c !== 0;
				if (isTruthy(value.value) === expected) {
					replaceWithMov(instruction, instruction.a, instruction.b);
				} else {
					replaceWithJump(instruction, Math.min(i + 2, count));
					instrUses[i] = [];
				}
				break;
			}
			case OpCode.EQ:
			case OpCode.LT:
			case OpCode.LE: {
				const slotB = getSlot(uses, 'b');
				const slotC = getSlot(uses, 'c');
				const left = getOperandConst(instruction, 'b', slotB, context, valueConst, valueCopy);
				const right = getOperandConst(instruction, 'c', slotC, context, valueConst, valueCopy);
				if (!left || !right) {
					break;
				}
				const result = evaluateComparison(instruction.op, left.value, right.value);
				if (result === null) {
					break;
				}
				const expected = instruction.a !== 0;
				const shouldSkip = result !== expected;
				if (shouldSkip) {
					replaceWithJump(instruction, Math.min(i + 2, count));
				} else {
					replaceWithNop(instruction);
				}
				instrUses[i] = [];
				break;
			}
			default:
				break;
		}
	}
};

const replaceWithConst = (instruction: Instruction, target: number, value: Value, context: OptimizationContext): ConstValue => {
	instruction.target = null;
	instruction.rkMask = 0;
	instruction.callProtoIndex = null;
	if (value === null) {
		instruction.op = OpCode.KNIL;
		instruction.a = target;
		instruction.b = 0;
		instruction.c = 0;
		instruction.format = 'ABC';
		return { value, constIndex: context.constIndex(null) };
	}
	if (typeof value === 'boolean') {
		instruction.op = value ? OpCode.KTRUE : OpCode.KFALSE;
		instruction.a = target;
		instruction.b = 0;
		instruction.c = 0;
		instruction.format = 'ABC';
		return { value, constIndex: context.constIndex(value) };
	}
	if (typeof value === 'number' && Number.isInteger(value)) {
		if (value === 0) {
			instruction.op = OpCode.K0;
			instruction.a = target;
			instruction.b = 0;
			instruction.c = 0;
			instruction.format = 'ABC';
			return { value, constIndex: context.constIndex(value) };
		}
		if (value === 1) {
			instruction.op = OpCode.K1;
			instruction.a = target;
			instruction.b = 0;
			instruction.c = 0;
			instruction.format = 'ABC';
			return { value, constIndex: context.constIndex(value) };
		}
		if (value === -1) {
			instruction.op = OpCode.KM1;
			instruction.a = target;
			instruction.b = 0;
			instruction.c = 0;
			instruction.format = 'ABC';
			return { value, constIndex: context.constIndex(value) };
		}
		if (value >= MIN_SIGNED_BX && value <= MAX_SIGNED_BX) {
			instruction.op = OpCode.KSMI;
			instruction.a = target;
			instruction.b = value;
			instruction.c = 0;
			instruction.format = 'ABx';
			return { value, constIndex: context.constIndex(value) };
		}
	}
	const constIndex = context.constIndex(value);
	instruction.op = OpCode.LOADK;
	instruction.a = target;
	instruction.b = constIndex;
	instruction.c = 0;
	instruction.format = 'ABx';
	return { value, constIndex };
};

const evaluateUnary = (op: OpCode, value: Value): Value | null => {
	switch (op) {
		case OpCode.UNM:
			return -(value as number);
		case OpCode.BNOT:
			return ~(value as number);
		case OpCode.NOT:
			return value === null || value === false;
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

const isTruthy = (value: Value): boolean => value !== null && value !== false;

const isConstPoolValue = (value: Value): boolean =>
	value === null || typeof value === 'boolean' || typeof value === 'number' || isStringValue(value);

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

const getOperandConst = (
	instruction: Instruction,
	field: 'b' | 'c',
	slot: UseSlot | null,
	context: OptimizationContext,
	valueConst: Array<ConstValue | null>,
	valueCopy: Array<number | null>,
): ConstValue | null => {
	const rkMaskBit = field === 'b' ? RK_B : RK_C;
	const operand = field === 'b' ? instruction.b : instruction.c;
	if ((instruction.rkMask & rkMaskBit) !== 0 && operand < 0) {
		const constIndex = -1 - operand;
		return { value: context.constPool[constIndex], constIndex };
	}
	if (!slot) {
		if (operand >= 0) {
			throw new Error('[ProgramOptimizer] Missing SSA operand.');
		}
		return null;
	}
	return resolveConst(slot.valueId, valueConst, valueCopy);
};

const resolveConst = (
	valueId: number,
	valueConst: Array<ConstValue | null>,
	valueCopy: Array<number | null>,
): ConstValue | null => {
	let current = valueId;
	const visited = new Set<number>();
	while (true) {
		if (visited.has(current)) {
			return null;
		}
		visited.add(current);
		const constant = valueConst[current];
		if (constant) {
			return constant;
		}
		const copy = valueCopy[current];
		if (copy === null) {
			return null;
		}
		current = copy;
	}
};

const resolveCopyRoot = (valueId: number, valueCopy: Array<number | null>): number => {
	let current = valueId;
	const visited = new Set<number>();
	while (true) {
		const next = valueCopy[current];
		if (next === null) {
			return current;
		}
		if (visited.has(next)) {
			return current;
		}
		visited.add(next);
		current = next;
	}
};

const updateSccpValue = (
	valueId: number,
	kind: number,
	constVal: ConstValue | null,
	valueKind: Uint8Array,
	valueConst: Array<ConstValue | null>,
): boolean => {
	const prevKind = valueKind[valueId];
	const prevConst = valueConst[valueId];
	if (prevKind === kind) {
		if (kind !== SCCP_CONST) {
			return false;
		}
		if (prevConst && constVal && prevConst.constIndex === constVal.constIndex) {
			return false;
		}
	}
	valueKind[valueId] = kind;
	valueConst[valueId] = kind === SCCP_CONST ? constVal : null;
	return true;
};

const getSccpOperand = (
	instruction: Instruction,
	field: 'b' | 'c',
	slot: UseSlot | null,
	context: OptimizationContext,
	valueKind: Uint8Array,
	valueConst: Array<ConstValue | null>,
): { kind: number; constVal: ConstValue | null } => {
	const rkMaskBit = field === 'b' ? RK_B : RK_C;
	const operand = field === 'b' ? instruction.b : instruction.c;
	if ((instruction.rkMask & rkMaskBit) !== 0 && operand < 0) {
		const constIndex = -1 - operand;
		return { kind: SCCP_CONST, constVal: { value: context.constPool[constIndex], constIndex } };
	}
	if (!slot) {
		if (operand >= 0) {
			throw new Error('[ProgramOptimizer] Missing SSA operand.');
		}
		return { kind: SCCP_UNDEF, constVal: null };
	}
	const kind = valueKind[slot.valueId];
	if (kind === SCCP_CONST) {
		const constVal = valueConst[slot.valueId];
		if (!constVal) {
			throw new Error('[ProgramOptimizer] Missing SCCP constant.');
		}
		return { kind, constVal };
	}
	return { kind, constVal: null };
};

const evaluateSccpDef = (
	instruction: Instruction,
	uses: UseSlot[] | undefined,
	context: OptimizationContext,
	valueKind: Uint8Array,
	valueConst: Array<ConstValue | null>,
): { kind: number; constVal: ConstValue | null } => {
	const immediate = getImmediateConstValue(instruction, context);
	if (immediate) {
		return { kind: SCCP_CONST, constVal: immediate };
	}
	switch (instruction.op) {
		case OpCode.LOADK:
			return { kind: SCCP_CONST, constVal: { value: context.constPool[instruction.b], constIndex: instruction.b } };
		case OpCode.LOADBOOL:
			return {
				kind: SCCP_CONST,
				constVal: { value: instruction.b !== 0, constIndex: context.constIndex(instruction.b !== 0) },
			};
		case OpCode.LOADNIL:
			return { kind: SCCP_CONST, constVal: { value: null, constIndex: context.constIndex(null) } };
		case OpCode.MOV: {
			if (!uses || uses.length === 0) {
				throw new Error('[ProgramOptimizer] Missing MOV operand.');
			}
			const source = uses[0].valueId;
			const kind = valueKind[source];
			if (kind === SCCP_CONST) {
				const constVal = valueConst[source];
				if (!constVal) {
					throw new Error('[ProgramOptimizer] Missing SCCP constant.');
				}
				return { kind, constVal };
			}
			return { kind, constVal: null };
		}
		case OpCode.UNM:
		case OpCode.BNOT:
		case OpCode.NOT:
		case OpCode.LEN: {
			if (!uses || uses.length === 0) {
				throw new Error('[ProgramOptimizer] Missing unary operand.');
			}
			const operand = getSccpOperand(instruction, 'b', uses[0], context, valueKind, valueConst);
			if (operand.kind === SCCP_CONST && operand.constVal) {
				const result = evaluateUnary(instruction.op, operand.constVal.value);
				if (result !== null && isConstPoolValue(result)) {
					return { kind: SCCP_CONST, constVal: { value: result, constIndex: context.constIndex(result) } };
				}
				return { kind: SCCP_OVERDEFINED, constVal: null };
			}
			return { kind: operand.kind, constVal: null };
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
			const slots = uses ?? [];
			let slotB: UseSlot | null = null;
			let slotC: UseSlot | null = null;
			for (let i = 0; i < slots.length; i += 1) {
				if (slots[i].field === 'b') {
					slotB = slots[i];
				} else if (slots[i].field === 'c') {
					slotC = slots[i];
				}
			}
			const left = getSccpOperand(instruction, 'b', slotB, context, valueKind, valueConst);
			const right = getSccpOperand(instruction, 'c', slotC, context, valueKind, valueConst);
			if (left.kind === SCCP_OVERDEFINED || right.kind === SCCP_OVERDEFINED) {
				return { kind: SCCP_OVERDEFINED, constVal: null };
			}
			if (left.kind === SCCP_UNDEF || right.kind === SCCP_UNDEF) {
				return { kind: SCCP_UNDEF, constVal: null };
			}
			if (!left.constVal || !right.constVal) {
				throw new Error('[ProgramOptimizer] Missing SCCP constants.');
			}
			const result = evaluateBinary(instruction.op, left.constVal.value, right.constVal.value);
			if (result !== null && isConstPoolValue(result)) {
				return { kind: SCCP_CONST, constVal: { value: result, constIndex: context.constIndex(result) } };
			}
			return { kind: SCCP_OVERDEFINED, constVal: null };
		}
		default:
			return { kind: SCCP_OVERDEFINED, constVal: null };
	}
};

const runSccp = (
	instructions: Instruction[],
	blocks: Block[],
	blockForIndex: number[],
	predecessors: number[][],
	rpo: number[],
	instrUses: UseSlot[][],
	instrPrimaryDef: Array<number | null>,
	phiByBlock: Array<Map<number, Phi>>,
	valueDef: ValueDef[],
	valueCount: number,
	context: OptimizationContext,
): { reachable: Uint8Array; valueKind: Uint8Array; valueConst: Array<ConstValue | null> } => {
	const valueKind = new Uint8Array(valueCount);
	const valueConst: Array<ConstValue | null> = new Array(valueCount).fill(null);
	const reachable = new Uint8Array(blocks.length);
	reachable[0] = 1;

	for (let valueId = 0; valueId < valueDef.length; valueId += 1) {
		const def = valueDef[valueId];
		if (def.kind === 'instr' && def.index < 0) {
			valueKind[valueId] = SCCP_OVERDEFINED;
		}
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (let rpoIndex = 0; rpoIndex < rpo.length; rpoIndex += 1) {
			const blockIndex = rpo[rpoIndex];
			if (reachable[blockIndex] === 0) {
				continue;
			}
			const preds = predecessors[blockIndex];
			phiByBlock[blockIndex].forEach(phi => {
				let sawConst = false;
				let sawUndef = false;
				let sawOver = false;
				let constVal: ConstValue | null = null;
				for (let p = 0; p < preds.length; p += 1) {
					const pred = preds[p];
					if (reachable[pred] === 0) {
						continue;
					}
					const arg = phi.args[p];
					if (arg < 0) {
						sawUndef = true;
						continue;
					}
					const kind = valueKind[arg];
					if (kind === SCCP_OVERDEFINED) {
						sawOver = true;
						break;
					}
					if (kind === SCCP_UNDEF) {
						sawUndef = true;
						continue;
					}
					const argConst = valueConst[arg];
					if (!argConst) {
						throw new Error('[ProgramOptimizer] Missing SCCP constant.');
					}
					if (!sawConst) {
						sawConst = true;
						constVal = argConst;
					} else if (constVal && constVal.constIndex !== argConst.constIndex) {
						sawOver = true;
						break;
					}
				}
				let nextKind = SCCP_UNDEF;
				let nextConst: ConstValue | null = null;
				if (sawOver) {
					nextKind = SCCP_OVERDEFINED;
				} else if (sawConst && !sawUndef) {
					nextKind = SCCP_CONST;
					nextConst = constVal;
				} else if (sawConst && sawUndef) {
					nextKind = SCCP_UNDEF;
				} else {
					nextKind = SCCP_UNDEF;
				}
				if (phi.dest < 0) {
					throw new Error('[ProgramOptimizer] Missing SSA phi destination.');
				}
				if (updateSccpValue(phi.dest, nextKind, nextConst, valueKind, valueConst)) {
					changed = true;
				}
			});

			const block = blocks[blockIndex];
			for (let i = block.start; i < block.end; i += 1) {
				const defValue = instrPrimaryDef[i];
				if (defValue === null) {
					continue;
				}
				const { kind, constVal } = evaluateSccpDef(instructions[i], instrUses[i], context, valueKind, valueConst);
				if (updateSccpValue(defValue, kind, constVal, valueKind, valueConst)) {
					changed = true;
				}
			}

			const lastIndex = block.end - 1;
			if (lastIndex < 0 || lastIndex >= instructions.length) {
				continue;
			}
			const last = instructions[lastIndex];
			const nextIndex = lastIndex + 1;
			const nextNextIndex = lastIndex + 2;
			const nextBlock = nextIndex < instructions.length ? blockForIndex[nextIndex] : null;
			const nextNextBlock = nextNextIndex < instructions.length ? blockForIndex[nextNextIndex] : null;

			const markReachable = (target: number | null): void => {
				if (target === null) {
					return;
				}
				if (reachable[target] === 0) {
					reachable[target] = 1;
					changed = true;
				}
			};

			switch (last.op) {
				case OpCode.RET:
					break;
				case OpCode.JMP:
					markReachable(last.target !== null && last.target < instructions.length ? blockForIndex[last.target] : null);
					break;
				case OpCode.JMPIF:
				case OpCode.JMPIFNOT: {
					const uses = instrUses[lastIndex] ?? [];
					const slot = uses.find(entry => entry.field === 'a');
					if (!slot) {
						throw new Error('[ProgramOptimizer] Missing JMPIF operand.');
					}
					const kind = valueKind[slot.valueId];
					if (kind === SCCP_CONST) {
						const constVal = valueConst[slot.valueId];
						if (!constVal) {
							throw new Error('[ProgramOptimizer] Missing SCCP constant.');
						}
						const truthy = isTruthy(constVal.value);
						const takeJump = last.op === OpCode.JMPIF ? truthy : !truthy;
						if (takeJump) {
							markReachable(last.target !== null && last.target < instructions.length ? blockForIndex[last.target] : null);
						} else {
							markReachable(nextBlock);
						}
					} else {
						markReachable(nextBlock);
						markReachable(last.target !== null && last.target < instructions.length ? blockForIndex[last.target] : null);
					}
					break;
				}
				case OpCode.BR_TRUE:
				case OpCode.BR_FALSE: {
					const uses = instrUses[lastIndex] ?? [];
					const slot = uses.find(entry => entry.field === 'a');
					if (!slot) {
						throw new Error('[ProgramOptimizer] Missing BR operand.');
					}
					const kind = valueKind[slot.valueId];
					if (kind === SCCP_CONST) {
						const constVal = valueConst[slot.valueId];
						if (!constVal) {
							throw new Error('[ProgramOptimizer] Missing SCCP constant.');
						}
						const truthy = isTruthy(constVal.value);
						const takeJump = last.op === OpCode.BR_TRUE ? truthy : !truthy;
						if (takeJump) {
							markReachable(last.target !== null && last.target < instructions.length ? blockForIndex[last.target] : null);
						} else {
							markReachable(nextBlock);
						}
					} else {
						markReachable(nextBlock);
						markReachable(last.target !== null && last.target < instructions.length ? blockForIndex[last.target] : null);
					}
					break;
				}
				case OpCode.TEST: {
					const uses = instrUses[lastIndex] ?? [];
					const slot = uses.find(entry => entry.field === 'a');
					if (!slot) {
						throw new Error('[ProgramOptimizer] Missing TEST operand.');
					}
					const kind = valueKind[slot.valueId];
					if (kind === SCCP_CONST) {
						const constVal = valueConst[slot.valueId];
						if (!constVal) {
							throw new Error('[ProgramOptimizer] Missing SCCP constant.');
						}
						const expected = last.c !== 0;
						const shouldSkip = isTruthy(constVal.value) !== expected;
						if (shouldSkip) {
							markReachable(nextNextBlock);
						} else {
							markReachable(nextBlock);
						}
					} else {
						markReachable(nextBlock);
						markReachable(nextNextBlock);
					}
					break;
				}
				case OpCode.EQ:
				case OpCode.LT:
				case OpCode.LE: {
					const uses = instrUses[lastIndex] ?? [];
					let slotB: UseSlot | null = null;
					let slotC: UseSlot | null = null;
					for (let s = 0; s < uses.length; s += 1) {
						if (uses[s].field === 'b') {
							slotB = uses[s];
						} else if (uses[s].field === 'c') {
							slotC = uses[s];
						}
					}
					const left = getSccpOperand(last, 'b', slotB, context, valueKind, valueConst);
					const right = getSccpOperand(last, 'c', slotC, context, valueKind, valueConst);
					if (left.kind === SCCP_CONST && right.kind === SCCP_CONST && left.constVal && right.constVal) {
						const result = evaluateComparison(last.op, left.constVal.value, right.constVal.value);
						if (result !== null) {
							const expected = last.a !== 0;
							const shouldSkip = result !== expected;
							if (shouldSkip) {
								markReachable(nextNextBlock);
							} else {
								markReachable(nextBlock);
							}
							break;
						}
					}
					markReachable(nextBlock);
					markReachable(nextNextBlock);
					break;
				}
				case OpCode.LOADBOOL:
					if (last.c !== 0) {
						markReachable(nextNextBlock);
					} else {
						markReachable(nextBlock);
					}
					break;
				default:
					markReachable(nextBlock);
					break;
			}
		}
	}

	return { reachable, valueKind, valueConst };
};

const collectUsesForSsa = (instruction: Instruction): UseOperand[] => {
	const uses: UseOperand[] = [];
	const add = (field: 'a' | 'b' | 'c', reg: number, rkMaskBit: number | null, allowRk: boolean): void => {
		if (reg < 0) {
			return;
		}
		uses.push({ field, reg, rkMaskBit, allowRk });
	};
	switch (instruction.op) {
		case OpCode.MOV:
			add('b', instruction.b, null, false);
			break;
		case OpCode.GETT:
			add('b', instruction.b, null, false);
			add('c', instruction.c, RK_C, supportsRkC(instruction.op));
			break;
		case OpCode.SETT:
			add('a', instruction.a, null, false);
			add('b', instruction.b, RK_B, supportsRkB(instruction.op));
			add('c', instruction.c, RK_C, supportsRkC(instruction.op));
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
			add('b', instruction.b, RK_B, supportsRkB(instruction.op));
			add('c', instruction.c, RK_C, supportsRkC(instruction.op));
			break;
		case OpCode.UNM:
		case OpCode.NOT:
		case OpCode.LEN:
		case OpCode.BNOT:
			add('b', instruction.b, null, false);
			break;
		case OpCode.TEST:
		case OpCode.JMPIF:
		case OpCode.JMPIFNOT:
		case OpCode.BR_TRUE:
		case OpCode.BR_FALSE:
		case OpCode.SETG:
		case OpCode.SETSYS:
		case OpCode.SETGL:
		case OpCode.SETUP:
			add('a', instruction.a, null, false);
			break;
		case OpCode.TESTSET:
			add('b', instruction.b, null, false);
			break;
		case OpCode.LOAD_MEM:
			add('b', instruction.b, null, false);
			break;
		case OpCode.STORE_MEM:
			add('a', instruction.a, null, false);
			add('b', instruction.b, null, false);
			break;
		case OpCode.STORE_MEM_WORDS:
			for (let offset = 0; offset < instruction.c; offset += 1) {
				add('a', instruction.a + offset, null, false);
			}
			add('b', instruction.b, RK_B, true);
			break;
		default:
			break;
	}
	return uses;
};

const collectUsesForLiveness = (instruction: Instruction, maxRegister: number): number[] => {
	const uses: number[] = [];
	const add = (reg: number): void => {
		if (reg >= 0) {
			uses.push(reg);
		}
	};
	const addRange = (base: number, count: number): void => {
		for (let offset = 0; offset < count; offset += 1) {
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
		case OpCode.SETSYS:
		case OpCode.SETGL:
		case OpCode.SETUP:
		case OpCode.TEST:
		case OpCode.JMPIF:
		case OpCode.JMPIFNOT:
		case OpCode.BR_TRUE:
		case OpCode.BR_FALSE:
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
			add(instruction.b);
			break;
		case OpCode.STORE_MEM:
			add(instruction.a);
			add(instruction.b);
			break;
		case OpCode.STORE_MEM_WORDS:
			addRange(instruction.a, instruction.c);
			add(instruction.b);
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

const collectDefs = (instruction: Instruction, maxRegister: number): number[] => {
	const defs: number[] = [];
	const add = (reg: number): void => {
		if (reg >= 0) {
			defs.push(reg);
		}
	};
	const addRange = (base: number, count: number): void => {
		for (let offset = 0; offset < count; offset += 1) {
			add(base + offset);
		}
	};
	switch (instruction.op) {
		case OpCode.MOV:
		case OpCode.KNIL:
		case OpCode.KFALSE:
		case OpCode.KTRUE:
		case OpCode.K0:
		case OpCode.K1:
		case OpCode.KM1:
		case OpCode.KSMI:
		case OpCode.LOADK:
		case OpCode.LOADBOOL:
		case OpCode.GETG:
		case OpCode.GETSYS:
		case OpCode.GETGL:
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

const computeValueNumbers = (
	instructions: Instruction[],
	instrUses: UseSlot[][],
	phiByBlock: Array<Map<number, Phi>>,
	valueDef: ValueDef[],
	valueReg: number[],
	valueCopy: Array<number | null>,
	valueConst: Array<ConstValue | null>,
): number[] => {
	const valueNumber = new Array<number>(valueReg.length).fill(-1);
	const constVN = new Map<number, number>();
	const exprVN = new Map<string, number>();
	const phiVN = new Map<string, number>();
	const uniqueVN = new Array<number>(valueReg.length).fill(-1);
	let nextVN = 1;

	const getConstVN = (constIndex: number): number => {
		let vn = constVN.get(constIndex);
		if (vn === undefined) {
			vn = nextVN;
			nextVN += 1;
			constVN.set(constIndex, vn);
		}
		return vn;
	};

	const getExprVN = (key: string): number => {
		let vn = exprVN.get(key);
		if (vn === undefined) {
			vn = nextVN;
			nextVN += 1;
			exprVN.set(key, vn);
		}
		return vn;
	};

	const getPhiVN = (key: string): number => {
		let vn = phiVN.get(key);
		if (vn === undefined) {
			vn = nextVN;
			nextVN += 1;
			phiVN.set(key, vn);
		}
		return vn;
	};

	const getUniqueVN = (valueId: number): number => {
		let vn = uniqueVN[valueId];
		if (vn < 0) {
			vn = nextVN;
			nextVN += 1;
			uniqueVN[valueId] = vn;
		}
		return vn;
	};

	const getOperandVN = (instruction: Instruction, field: 'b' | 'c', slot: UseSlot | null): number => {
		const rkMaskBit = field === 'b' ? RK_B : RK_C;
		const operand = field === 'b' ? instruction.b : instruction.c;
		if ((instruction.rkMask & rkMaskBit) !== 0 && operand < 0) {
			return getConstVN(-1 - operand);
		}
		if (!slot) {
			return -1;
		}
		const root = resolveCopyRoot(slot.valueId, valueCopy);
		return valueNumber[root];
	};

	let updated = true;
	while (updated) {
		updated = false;
		for (let valueId = 0; valueId < valueReg.length; valueId += 1) {
			const def = valueDef[valueId];
			let next = -1;
			const constVal = valueConst[valueId];
			if (constVal) {
				next = getConstVN(constVal.constIndex);
			} else if (def.kind === 'phi') {
				const phi = phiByBlock[def.index].get(valueReg[valueId]);
				if (!phi) {
					throw new Error('[ProgramOptimizer] Missing SSA phi node.');
				}
				let allSame = true;
				let firstVN = -1;
				const argVN: number[] = [];
				for (let a = 0; a < phi.args.length; a += 1) {
					const arg = phi.args[a];
					if (arg < 0) {
						allSame = false;
						break;
					}
					const root = resolveCopyRoot(arg, valueCopy);
					const vn = valueNumber[root];
					if (vn < 0) {
						allSame = false;
						break;
					}
					argVN.push(vn);
					if (firstVN < 0) {
						firstVN = vn;
					} else if (firstVN !== vn) {
						allSame = false;
					}
				}
				if (allSame && firstVN >= 0) {
					next = firstVN;
				} else if (argVN.length === phi.args.length) {
					next = getPhiVN(`phi|${argVN.join(',')}`);
				}
			} else if (def.index >= 0) {
				const instruction = instructions[def.index];
				switch (instruction.op) {
					case OpCode.MOV: {
						const uses = instrUses[def.index] ?? [];
						if (uses.length === 0) {
							throw new Error('[ProgramOptimizer] Missing MOV operand.');
						}
						const root = resolveCopyRoot(uses[0].valueId, valueCopy);
						next = valueNumber[root];
						break;
					}
					case OpCode.UNM:
					case OpCode.BNOT:
					case OpCode.NOT:
					case OpCode.LEN: {
						const uses = instrUses[def.index] ?? [];
						if (uses.length === 0) {
							throw new Error('[ProgramOptimizer] Missing unary operand.');
						}
						const operandVN = getOperandVN(instruction, 'b', uses[0]);
						if (operandVN >= 0) {
							next = getExprVN(`${instruction.op}|${operandVN}`);
						}
						break;
					}
					default:
						if (isValueNumberable(instruction.op)) {
							const uses = instrUses[def.index] ?? [];
							let slotB: UseSlot | null = null;
							let slotC: UseSlot | null = null;
							for (let s = 0; s < uses.length; s += 1) {
								if (uses[s].field === 'b') {
									slotB = uses[s];
								} else if (uses[s].field === 'c') {
									slotC = uses[s];
								}
							}
							const left = getOperandVN(instruction, 'b', slotB);
							const right = getOperandVN(instruction, 'c', slotC);
							if (left >= 0 && right >= 0) {
								let leftKey = left;
								let rightKey = right;
								if (isCommutative(instruction.op) && leftKey > rightKey) {
									const temp = leftKey;
									leftKey = rightKey;
									rightKey = temp;
								}
								next = getExprVN(`${instruction.op}|${leftKey}|${rightKey}`);
							}
						} else if (instruction.op !== OpCode.WIDE) {
							next = getUniqueVN(valueId);
						}
						break;
				}
			}
			if (next >= 0 && valueNumber[valueId] !== next) {
				valueNumber[valueId] = next;
				updated = true;
			}
		}
	}

	return valueNumber;
};

const applyAvailableValueNumbering = (
	blocks: Block[],
	entryValuesByBlock: number[][],
	instrDefs: DefSlot[][],
	instrPrimaryDef: Array<number | null>,
	valueNumber: number[],
	valueCopy: Array<number | null>,
): void => {
	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const entryValues = entryValuesByBlock[blockIndex];
		if (!entryValues) {
			continue;
		}
		const currentValues = entryValues.slice();
		const vnValues = new Map<number, Set<number>>();
		const addValue = (vn: number, valueId: number): void => {
			if (vn < 0) {
				return;
			}
			let set = vnValues.get(vn);
			if (!set) {
				set = new Set<number>();
				vnValues.set(vn, set);
			}
			set.add(valueId);
		};
		const removeValue = (vn: number, valueId: number): void => {
			if (vn < 0) {
				return;
			}
			const set = vnValues.get(vn);
			if (!set) {
				return;
			}
			set.delete(valueId);
			if (set.size === 0) {
				vnValues.delete(vn);
			}
		};
		const getRepresentative = (vn: number): number | null => {
			const set = vnValues.get(vn);
			if (!set) {
				return null;
			}
			const iter = set.values().next();
			if (iter.done) {
				return null;
			}
			return iter.value;
		};

		for (let reg = 0; reg < currentValues.length; reg += 1) {
			const valueId = currentValues[reg];
			const vn = valueNumber[valueId];
			addValue(vn, valueId);
		}

		const block = blocks[blockIndex];
		for (let index = block.start; index < block.end; index += 1) {
			const defValue = instrPrimaryDef[index];
			if (defValue !== null) {
				const vn = valueNumber[defValue];
				if (vn >= 0) {
					const rep = getRepresentative(vn);
					if (rep !== null && rep !== defValue) {
						valueCopy[defValue] = rep;
					}
				}
			}
			const defs = instrDefs[index] ?? [];
			for (let d = 0; d < defs.length; d += 1) {
				const { reg, valueId } = defs[d];
				const oldValue = currentValues[reg];
				if (oldValue !== undefined) {
					const oldVn = valueNumber[oldValue];
					removeValue(oldVn, oldValue);
				}
				currentValues[reg] = valueId;
				const newVn = valueNumber[valueId];
				addValue(newVn, valueId);
			}
		}
	}
};

const simplifyAlgebraic = (instructions: Instruction[], context: OptimizationContext): void => {
	const getInlineConst = (instruction: Instruction, field: 'b' | 'c'): Value | null => {
		const rkMaskBit = field === 'b' ? RK_B : RK_C;
		const operand = field === 'b' ? instruction.b : instruction.c;
		if ((instruction.rkMask & rkMaskBit) !== 0 && operand < 0) {
			return context.constPool[-1 - operand];
		}
		return null;
	};

	const getRegisterOperand = (instruction: Instruction, field: 'b' | 'c'): number | null => {
		const rkMaskBit = field === 'b' ? RK_B : RK_C;
		const operand = field === 'b' ? instruction.b : instruction.c;
		if ((instruction.rkMask & rkMaskBit) !== 0 && operand < 0) {
			return null;
		}
		return operand;
	};

	for (let i = 0; i < instructions.length; i += 1) {
		const instruction = instructions[i];
		switch (instruction.op) {
			case OpCode.ADD: {
				const bConst = getInlineConst(instruction, 'b');
				const cConst = getInlineConst(instruction, 'c');
				if (bConst === 0) {
					if (cConst !== null) {
						replaceWithConst(instruction, instruction.a, cConst, context);
					} else {
						const reg = getRegisterOperand(instruction, 'c');
						if (reg !== null) {
							replaceWithMov(instruction, instruction.a, reg);
						}
					}
				} else if (cConst === 0) {
					if (bConst !== null) {
						replaceWithConst(instruction, instruction.a, bConst, context);
					} else {
						const reg = getRegisterOperand(instruction, 'b');
						if (reg !== null) {
							replaceWithMov(instruction, instruction.a, reg);
						}
					}
				}
				break;
			}
			case OpCode.SUB: {
				const bConst = getInlineConst(instruction, 'b');
				const cConst = getInlineConst(instruction, 'c');
				if (cConst === 0) {
					if (bConst !== null) {
						replaceWithConst(instruction, instruction.a, bConst, context);
					} else {
						const reg = getRegisterOperand(instruction, 'b');
						if (reg !== null) {
							replaceWithMov(instruction, instruction.a, reg);
						}
					}
				} else if (bConst === 0) {
					if (cConst !== null) {
						const result = evaluateBinary(OpCode.SUB, bConst, cConst);
						if (result !== null) {
							replaceWithConst(instruction, instruction.a, result, context);
						}
					} else {
						const reg = getRegisterOperand(instruction, 'c');
						if (reg !== null) {
							replaceWithUnm(instruction, instruction.a, reg);
						}
					}
				}
				break;
			}
			case OpCode.MUL: {
				const bConst = getInlineConst(instruction, 'b');
				const cConst = getInlineConst(instruction, 'c');
				if (bConst === 1) {
					if (cConst !== null) {
						replaceWithConst(instruction, instruction.a, cConst, context);
					} else {
						const reg = getRegisterOperand(instruction, 'c');
						if (reg !== null) {
							replaceWithMov(instruction, instruction.a, reg);
						}
					}
				} else if (cConst === 1) {
					if (bConst !== null) {
						replaceWithConst(instruction, instruction.a, bConst, context);
					} else {
						const reg = getRegisterOperand(instruction, 'b');
						if (reg !== null) {
							replaceWithMov(instruction, instruction.a, reg);
						}
					}
				}
				break;
			}
			case OpCode.DIV: {
				const cConst = getInlineConst(instruction, 'c');
				if (cConst === 1) {
					const bConst = getInlineConst(instruction, 'b');
					if (bConst !== null) {
						replaceWithConst(instruction, instruction.a, bConst, context);
					} else {
						const reg = getRegisterOperand(instruction, 'b');
						if (reg !== null) {
							replaceWithMov(instruction, instruction.a, reg);
						}
					}
				}
				break;
			}
			case OpCode.POW: {
				const cConst = getInlineConst(instruction, 'c');
				if (cConst === 1) {
					const bConst = getInlineConst(instruction, 'b');
					if (bConst !== null) {
						replaceWithConst(instruction, instruction.a, bConst, context);
					} else {
						const reg = getRegisterOperand(instruction, 'b');
						if (reg !== null) {
							replaceWithMov(instruction, instruction.a, reg);
						}
					}
				}
				break;
			}
			default:
				break;
		}
	}
};

const cloneInstruction = (instruction: Instruction): Instruction => ({
	op: instruction.op,
	a: instruction.a,
	b: instruction.b,
	c: instruction.c,
	format: instruction.format,
	rkMask: instruction.rkMask,
	target: instruction.target,
	callProtoIndex: instruction.callProtoIndex ?? null,
});

const isControlFlowInstruction = (instruction: Instruction): boolean => {
	if (instruction.op === OpCode.RET) {
		return true;
	}
	if (instruction.op === OpCode.LOADBOOL && instruction.c !== 0) {
		return true;
	}
	return instruction.op === OpCode.JMP
		|| instruction.op === OpCode.JMPIF
		|| instruction.op === OpCode.JMPIFNOT
		|| instruction.op === OpCode.BR_TRUE
		|| instruction.op === OpCode.BR_FALSE
		|| instruction.op === OpCode.TEST
		|| instruction.op === OpCode.TESTSET
		|| instruction.op === OpCode.EQ
		|| instruction.op === OpCode.LT
		|| instruction.op === OpCode.LE;
};

const isHoistableInstruction = (instruction: Instruction): boolean => {
	switch (instruction.op) {
		case OpCode.MOV:
		case OpCode.KNIL:
		case OpCode.KFALSE:
		case OpCode.KTRUE:
		case OpCode.K0:
		case OpCode.K1:
		case OpCode.KM1:
		case OpCode.KSMI:
		case OpCode.LOADK:
		case OpCode.LOADNIL:
		case OpCode.LOADBOOL:
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
			return instruction.op !== OpCode.LOADBOOL || instruction.c === 0;
		default:
			return false;
	}
};

const computeDominators = (
	blocks: Block[],
	predecessors: number[][],
	successors: number[][],
): { rpo: number[]; rpoIndex: number[]; idom: number[] } => {
	const rpo: number[] = [];
	const visited = new Array<boolean>(blocks.length).fill(false);
	const stack: Array<{ block: number; index: number }> = [{ block: 0, index: 0 }];
	while (stack.length > 0) {
		const frame = stack[stack.length - 1];
		if (!visited[frame.block]) {
			visited[frame.block] = true;
		}
		const succs = successors[frame.block];
		if (frame.index < succs.length) {
			const next = succs[frame.index];
			frame.index += 1;
			if (!visited[next]) {
				stack.push({ block: next, index: 0 });
			}
		} else {
			rpo.push(frame.block);
			stack.pop();
		}
	}
	for (let i = 0; i < blocks.length; i += 1) {
		if (!visited[i]) {
			rpo.push(i);
		}
	}
	rpo.reverse();
	const rpoIndex = new Array<number>(blocks.length);
	for (let i = 0; i < rpo.length; i += 1) {
		rpoIndex[rpo[i]] = i;
	}

	const idom = new Array<number>(blocks.length).fill(-1);
	idom[0] = 0;
	const intersect = (a: number, b: number): number => {
		let finger1 = a;
		let finger2 = b;
		while (finger1 !== finger2) {
			while (rpoIndex[finger1] > rpoIndex[finger2]) {
				finger1 = idom[finger1];
			}
			while (rpoIndex[finger2] > rpoIndex[finger1]) {
				finger2 = idom[finger2];
			}
		}
		return finger1;
	};

	let changed = true;
	while (changed) {
		changed = false;
		for (let i = 1; i < rpo.length; i += 1) {
			const blockIndex = rpo[i];
			const preds = predecessors[blockIndex];
			let newIdom = -1;
			for (let p = 0; p < preds.length; p += 1) {
				const pred = preds[p];
				if (idom[pred] !== -1) {
					newIdom = pred;
					break;
				}
			}
			if (newIdom === -1) {
				continue;
			}
			for (let p = 0; p < preds.length; p += 1) {
				const pred = preds[p];
				if (pred === newIdom || idom[pred] === -1) {
					continue;
				}
				newIdom = intersect(pred, newIdom);
			}
			if (idom[blockIndex] !== newIdom) {
				idom[blockIndex] = newIdom;
				changed = true;
			}
		}
	}

	return { rpo, rpoIndex, idom };
};

const computeLiveOut = (
	instructions: Instruction[],
	blocks: Block[],
	successors: number[][],
	maxRegister: number,
): Uint8Array[] => {
	const registerCount = maxRegister + 1;
	const blockUse: Uint8Array[] = new Array(blocks.length);
	const blockDef: Uint8Array[] = new Array(blocks.length);
	const liveIn: Uint8Array[] = new Array(blocks.length);
	const liveOut: Uint8Array[] = new Array(blocks.length);

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
			const uses = collectUsesForLiveness(instruction, maxRegister);
			for (let u = 0; u < uses.length; u += 1) {
				const reg = uses[u];
				if (def[reg] === 0) {
					use[reg] = 1;
				}
			}
			const defs = collectDefs(instruction, maxRegister);
			for (let d = 0; d < defs.length; d += 1) {
				def[defs[d]] = 1;
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

	return liveOut;
};

const applyLoopInvariantCodeMotion = (set: InstructionSet): InstructionSet => {
	const { instructions, ranges } = set;
	if (instructions.length === 0) {
		return set;
	}
	const maxRegister = computeMaxRegister(instructions);
	const blocks = buildBasicBlocks(instructions);
	if (blocks.length === 0) {
		return set;
	}
	const { predecessors, successors } = buildBlockGraph(instructions, blocks);
	const { idom } = computeDominators(blocks, predecessors, successors);
	const liveOut = computeLiveOut(instructions, blocks, successors, maxRegister);
	const pinnedTargets = new Set<number>();
	for (let i = 0; i < instructions.length; i += 1) {
		const instruction = instructions[i];
		if (isJump(instruction)) {
			const target = getJumpTarget(instruction);
			if (target >= 0 && target < instructions.length) {
				pinnedTargets.add(target);
			}
		}
		switch (instruction.op) {
			case OpCode.JMPIF:
			case OpCode.JMPIFNOT:
			case OpCode.BR_TRUE:
			case OpCode.BR_FALSE:
				if (i + 1 < instructions.length) {
					pinnedTargets.add(i + 1);
				}
				break;
			case OpCode.TEST:
			case OpCode.TESTSET:
			case OpCode.EQ:
			case OpCode.LT:
			case OpCode.LE:
				if (i + 1 < instructions.length) {
					pinnedTargets.add(i + 1);
				}
				if (i + 2 < instructions.length) {
					pinnedTargets.add(i + 2);
				}
				break;
			case OpCode.LOADBOOL:
				if (instruction.c !== 0 && i + 1 < instructions.length) {
					pinnedTargets.add(i + 1);
				}
				break;
			case OpCode.WIDE:
				if (i + 1 < instructions.length) {
					pinnedTargets.add(i + 1);
				}
				break;
			default:
				break;
		}
	}

	const dominates = (a: number, b: number): boolean => {
		if (a === b) {
			return true;
		}
		let current = b;
		while (current !== -1 && current !== idom[current]) {
			current = idom[current];
			if (current === a) {
				return true;
			}
		}
		return false;
	};

	const loopsByHeader = new Map<number, Set<number>>();
	for (let b = 0; b < blocks.length; b += 1) {
		const succs = successors[b];
		for (let s = 0; s < succs.length; s += 1) {
			const succ = succs[s];
			if (!dominates(succ, b)) {
				continue;
			}
			const loop = new Set<number>([succ, b]);
			const stack: number[] = [b];
			while (stack.length > 0) {
				const node = stack.pop()!;
				const preds = predecessors[node];
				for (let p = 0; p < preds.length; p += 1) {
					const pred = preds[p];
					if (!loop.has(pred)) {
						loop.add(pred);
						stack.push(pred);
					}
				}
			}
			const existing = loopsByHeader.get(succ);
			if (existing) {
				for (const node of loop) {
					existing.add(node);
				}
			} else {
				loopsByHeader.set(succ, loop);
			}
		}
	}

	const insertAt = new Map<number, Array<{ index: number; instruction: Instruction; range: SourceRange | null }>>();
	const remove = new Array<boolean>(instructions.length).fill(false);
	let movedAny = false;

	for (const [header, loopBlocks] of loopsByHeader.entries()) {
		const preds = predecessors[header].filter(pred => !loopBlocks.has(pred));
		if (preds.length !== 1) {
			continue;
		}
		const preheader = preds[0];
		if (successors[preheader].length !== 1 || successors[preheader][0] !== header) {
			continue;
		}

		const registerCount = maxRegister + 1;
		const defCount = new Array<number>(registerCount).fill(0);
		const useBlocksByReg: Array<Set<number>> = new Array(registerCount);
		for (let r = 0; r < registerCount; r += 1) {
			useBlocksByReg[r] = new Set<number>();
		}

		for (const blockIndex of loopBlocks) {
			const block = blocks[blockIndex];
			for (let i = block.start; i < block.end; i += 1) {
				const instruction = instructions[i];
				const defs = collectDefs(instruction, maxRegister);
				for (let d = 0; d < defs.length; d += 1) {
					defCount[defs[d]] += 1;
				}
				const uses = collectUsesForLiveness(instruction, maxRegister);
				for (let u = 0; u < uses.length; u += 1) {
					useBlocksByReg[uses[u]].add(blockIndex);
				}
			}
		}

		const loopLiveOut = new Set<number>();
		for (const blockIndex of loopBlocks) {
			const succs = successors[blockIndex];
			let hasExit = false;
			for (let s = 0; s < succs.length; s += 1) {
				if (!loopBlocks.has(succs[s])) {
					hasExit = true;
					break;
				}
			}
			if (!hasExit) {
				continue;
			}
			const out = liveOut[blockIndex];
			for (let r = 0; r < registerCount; r += 1) {
				if (out[r] !== 0) {
					loopLiveOut.add(r);
				}
			}
		}

		const preheaderBlock = blocks[preheader];
		const preheaderLastIndex = preheaderBlock.end - 1;
		const insertIndex = preheaderLastIndex >= 0 && isControlFlowInstruction(instructions[preheaderLastIndex])
			? preheaderLastIndex
			: preheaderBlock.end;

		const moved: number[] = [];
		for (const blockIndex of loopBlocks) {
			let dominatesAll = true;
			for (const other of loopBlocks) {
				if (!dominates(blockIndex, other)) {
					dominatesAll = false;
					break;
				}
			}
			if (!dominatesAll) {
				continue;
			}
			const block = blocks[blockIndex];
			for (let i = block.start; i < block.end; i += 1) {
				const instruction = instructions[i];
				if (!isHoistableInstruction(instruction)) {
					continue;
				}
				if (instruction.op === OpCode.WIDE || (i > 0 && instructions[i - 1].op === OpCode.WIDE)) {
					continue;
				}
				if (pinnedTargets.has(i)) {
					continue;
				}
				const defs = collectDefs(instruction, maxRegister);
				if (defs.length !== 1) {
					continue;
				}
				const dest = defs[0];
				if (defCount[dest] !== 1) {
					continue;
				}
				if (loopLiveOut.has(dest)) {
					continue;
				}
				const uses = collectUsesForLiveness(instruction, maxRegister);
				let invariant = true;
				for (let u = 0; u < uses.length; u += 1) {
					if (defCount[uses[u]] > 0) {
						invariant = false;
						break;
					}
				}
				if (!invariant) {
					continue;
				}
				const useBlocks = useBlocksByReg[dest];
				for (const useBlock of useBlocks.values()) {
					if (!dominates(blockIndex, useBlock)) {
						invariant = false;
						break;
					}
				}
				if (!invariant) {
					continue;
				}
				moved.push(i);
			}
		}

		if (moved.length === 0) {
			continue;
		}
		moved.sort((a, b) => a - b);
		let list = insertAt.get(insertIndex);
		if (!list) {
			list = [];
			insertAt.set(insertIndex, list);
		}
		for (let m = 0; m < moved.length; m += 1) {
			const index = moved[m];
			remove[index] = true;
			list.push({ index, instruction: instructions[index], range: ranges[index] });
		}
		movedAny = true;
	}

	if (!movedAny) {
		return set;
	}

	const count = instructions.length;
	const indexMap = new Array<number>(count).fill(-1);
	const nextInstructions: Instruction[] = [];
	const nextRanges: Array<SourceRange | null> = [];
	for (const inserts of insertAt.values()) {
		inserts.sort((a, b) => a.index - b.index);
	}

	for (let i = 0; i <= count; i += 1) {
		const inserts = insertAt.get(i);
		if (inserts) {
			for (let j = 0; j < inserts.length; j += 1) {
				nextInstructions.push(inserts[j].instruction);
				nextRanges.push(inserts[j].range);
			}
		}
		if (i === count) {
			continue;
		}
		if (remove[i]) {
			continue;
		}
		indexMap[i] = nextInstructions.length;
		nextInstructions.push(instructions[i]);
		nextRanges.push(ranges[i]);
	}

	for (let i = 0; i < nextInstructions.length; i += 1) {
		const instruction = nextInstructions[i];
		if (!isJump(instruction)) {
			continue;
		}
		const target = getJumpTarget(instruction);
		if (target === count) {
			instruction.target = nextInstructions.length;
			continue;
		}
		const mapped = indexMap[target];
		if (mapped < 0) {
			throw new Error(`[ProgramOptimizer] Jump target ${target} was removed.`);
		}
		instruction.target = mapped;
	}

	return { instructions: nextInstructions, ranges: nextRanges };
};

const unrollNumericForLoops = (set: InstructionSet, context: OptimizationContext): InstructionSet => {
	let current = set;
	let changed = true;
	const maxUnroll = 8;

	const isNumeric = (value: Value): value is number => typeof value === 'number';
	const isConstZero = (value: Value | null): boolean => value === 0;

	while (changed) {
		changed = false;
		const { instructions, ranges } = current;
		const count = instructions.length;
		const maxRegister = computeMaxRegister(instructions);
		for (let index = 0; index < count; index += 1) {
			const backJump = instructions[index];
			if (backJump.op !== OpCode.JMP || backJump.target === null || backJump.target >= index) {
				continue;
			}
			const loopStart = backJump.target;
			const incIndex = index - 1;
			if (incIndex <= loopStart + 6) {
				continue;
			}
			const lt0 = instructions[loopStart];
			const jumpToNeg = instructions[loopStart + 1];
			const ltPos = instructions[loopStart + 2];
			const jumpOutPos = instructions[loopStart + 3];
			const jumpToBody = instructions[loopStart + 4];
			const ltNeg = instructions[loopStart + 5];
			const jumpOutNeg = instructions[loopStart + 6];
			if (lt0.op !== OpCode.LT || lt0.a !== 0) {
				continue;
			}
			if (jumpToNeg.op !== OpCode.JMP || jumpToBody.op !== OpCode.JMP || jumpOutPos.op !== OpCode.JMP || jumpOutNeg.op !== OpCode.JMP) {
				continue;
			}
			if (ltPos.op !== OpCode.LT || ltNeg.op !== OpCode.LT || ltPos.a !== 1 || ltNeg.a !== 1) {
				continue;
			}
			if (jumpToNeg.target !== loopStart + 5) {
				continue;
			}
			const bodyStart = jumpToBody.target;
			if (bodyStart !== loopStart + 7) {
				continue;
			}
			if (jumpOutPos.target === null || jumpOutNeg.target === null || jumpOutPos.target !== jumpOutNeg.target) {
				continue;
			}
			const loopEnd = jumpOutPos.target;
			if (loopEnd !== index + 1) {
				continue;
			}
			const stepReg = lt0.c;
			if ((lt0.rkMask & RK_B) === 0 || lt0.b >= 0) {
				continue;
			}
			const zeroIndex = -1 - lt0.b;
			const zeroValue = context.constPool[zeroIndex];
			if (!isConstZero(zeroValue)) {
				continue;
			}
			if (ltPos.b < 0 || ltPos.c < 0 || ltNeg.b < 0 || ltNeg.c < 0) {
				continue;
			}
			const limitReg = ltPos.b;
			const indexReg = ltPos.c;
			if (ltNeg.b !== indexReg || ltNeg.c !== limitReg) {
				continue;
			}
			const incInstr = instructions[incIndex];
			if (incInstr.op !== OpCode.ADD || incInstr.a !== indexReg || incInstr.b !== indexReg || incInstr.c !== stepReg) {
				continue;
			}
			if (backJump.target !== loopStart) {
				continue;
			}
			const bodyEnd = incIndex - 1;
			if (bodyEnd < bodyStart) {
				continue;
			}
			let hasControlFlow = false;
			for (let i = bodyStart; i <= bodyEnd; i += 1) {
				if (isControlFlowInstruction(instructions[i])) {
					hasControlFlow = true;
					break;
				}
			}
			if (hasControlFlow) {
				continue;
			}
			let mutatesLoopRegs = false;
			for (let i = bodyStart; i <= bodyEnd; i += 1) {
				const defs = collectDefs(instructions[i], maxRegister);
				for (let d = 0; d < defs.length; d += 1) {
					const reg = defs[d];
					if (reg === indexReg || reg === limitReg || reg === stepReg) {
						mutatesLoopRegs = true;
						break;
					}
				}
				if (mutatesLoopRegs) {
					break;
				}
			}
			if (mutatesLoopRegs) {
				continue;
			}

			const findConstBefore = (reg: number): Value | null => {
				for (let i = loopStart - 1; i >= 0 && i >= loopStart - 16; i -= 1) {
					const instr = instructions[i];
					if (isControlFlowInstruction(instr)) {
						return null;
					}
					const defs = collectDefs(instr, maxRegister);
					for (let d = 0; d < defs.length; d += 1) {
						if (defs[d] !== reg) {
							continue;
						}
						if (instr.op === OpCode.LOADK) {
							return context.constPool[instr.b];
						}
						if (instr.op === OpCode.LOADBOOL) {
							return instr.b !== 0;
						}
						if (instr.op === OpCode.KNIL) {
							return null;
						}
						if (instr.op === OpCode.KFALSE) {
							return false;
						}
						if (instr.op === OpCode.KTRUE) {
							return true;
						}
						if (instr.op === OpCode.K0) {
							return 0;
						}
						if (instr.op === OpCode.K1) {
							return 1;
						}
						if (instr.op === OpCode.KM1) {
							return -1;
						}
						if (instr.op === OpCode.KSMI) {
							return instr.b;
						}
						if (instr.op === OpCode.LOADNIL) {
							return null;
						}
						return null;
					}
				}
				return null;
			};

			const startConst = findConstBefore(indexReg);
			const limitConst = findConstBefore(limitReg);
			const stepConst = findConstBefore(stepReg);
			if (!isNumeric(startConst) || !isNumeric(limitConst) || !isNumeric(stepConst)) {
				continue;
			}
			if (stepConst === 0) {
				continue;
			}
			let iterations = 0;
			if (stepConst > 0) {
				if (startConst > limitConst) {
					continue;
				}
				iterations = Math.floor((limitConst - startConst) / stepConst) + 1;
			} else {
				if (startConst < limitConst) {
					continue;
				}
				iterations = Math.floor((startConst - limitConst) / -stepConst) + 1;
			}
			if (!Number.isFinite(iterations) || iterations <= 0 || iterations > maxUnroll) {
				continue;
			}

			for (let i = 0; i < count; i += 1) {
				if (i >= loopStart && i < loopEnd) {
					continue;
				}
				const instr = instructions[i];
				if (!isJump(instr)) {
					continue;
				}
				const target = getJumpTarget(instr);
				if (target >= loopStart && target < loopEnd) {
					hasControlFlow = true;
					break;
				}
			}
			if (hasControlFlow) {
				continue;
			}

			const nextInstructions: Instruction[] = [];
			const nextRanges: Array<SourceRange | null> = [];
			const indexMap = new Array<number>(count).fill(-1);
			for (let i = 0; i < loopStart; i += 1) {
				indexMap[i] = nextInstructions.length;
				nextInstructions.push(instructions[i]);
				nextRanges.push(ranges[i]);
			}

			const bodyInstructions = instructions.slice(bodyStart, bodyEnd + 1);
			const bodyRanges = ranges.slice(bodyStart, bodyEnd + 1);
			const incRange = ranges[incIndex];
			for (let iter = 0; iter < iterations; iter += 1) {
				for (let i = 0; i < bodyInstructions.length; i += 1) {
					nextInstructions.push(cloneInstruction(bodyInstructions[i]));
					nextRanges.push(bodyRanges[i]);
				}
				nextInstructions.push(cloneInstruction(incInstr));
				nextRanges.push(incRange);
			}

			for (let i = loopEnd; i < count; i += 1) {
				indexMap[i] = nextInstructions.length;
				nextInstructions.push(instructions[i]);
				nextRanges.push(ranges[i]);
			}

			for (let i = 0; i < nextInstructions.length; i += 1) {
				const instr = nextInstructions[i];
				if (!isJump(instr)) {
					continue;
				}
				const target = getJumpTarget(instr);
				if (target === count) {
					instr.target = nextInstructions.length;
					continue;
				}
				const mapped = indexMap[target];
				if (mapped < 0) {
					throw new Error(`[ProgramOptimizer] Jump target ${target} was removed.`);
				}
				instr.target = mapped;
			}

			current = { instructions: nextInstructions, ranges: nextRanges };
			changed = true;
			break;
		}
	}

	return current;
};

const applyLoopOptimizations = (set: InstructionSet, context: OptimizationContext): InstructionSet => {
	let current = unrollNumericForLoops(set, context);
	current = applyLoopInvariantCodeMotion(current);
	return current;
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

const eliminateDeadStoresGlobal = (set: InstructionSet, context: OptimizationContext): InstructionSet => {
	const { instructions, ranges } = set;
	const count = instructions.length;
	if (count === 0) {
		return set;
	}
	const maxRegister = computeMaxRegister(instructions);
	const registerCount = maxRegister + 1;
	const blocks = buildBasicBlocks(instructions);
	const { successors } = buildBlockGraph(instructions, blocks);
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
				throw new Error(`[ProgramOptimizerSSA] Closure upvalue register out of range: r${desc.index}.`);
			}
			captured[desc.index] = 1;
		}
	}
	const blockUse: Uint8Array[] = new Array(blocks.length);
	const blockDef: Uint8Array[] = new Array(blocks.length);
	const liveIn: Uint8Array[] = new Array(blocks.length);
	const liveOut: Uint8Array[] = new Array(blocks.length);

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
			const uses = collectUsesForLiveness(instruction, maxRegister);
			for (let u = 0; u < uses.length; u += 1) {
				const reg = uses[u];
				if (def[reg] === 0) {
					use[reg] = 1;
				}
			}
			const defs = collectDefs(instruction, maxRegister);
			for (let d = 0; d < defs.length; d += 1) {
				def[defs[d]] = 1;
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
			const defs = collectDefs(instruction, maxRegister);
			let hasLive = false;
			for (let d = 0; d < defs.length; d += 1) {
				if (live[defs[d]] !== 0) {
					hasLive = true;
					break;
				}
			}
			let hasCaptured = false;
			for (let d = 0; d < defs.length; d += 1) {
				const reg = defs[d];
				if (captured[reg] !== 0) {
					hasCaptured = true;
					break;
				}
			}
			if (defs.length > 0 && isPureInstruction(instruction) && !hasLive && !hasCaptured) {
				keep[i] = false;
				removed += 1;
				continue;
			}
			for (let d = 0; d < defs.length; d += 1) {
				live[defs[d]] = 0;
			}
			const uses = collectUsesForLiveness(instruction, maxRegister);
			for (let u = 0; u < uses.length; u += 1) {
				live[uses[u]] = 1;
			}
		}
	}

	if (removed === 0) {
		return set;
	}
	return remapInstructions(instructions, ranges, keep, true);
};

export const applyGlobalOptimizations = (
	set: InstructionSet,
	context: OptimizationContext,
): InstructionSet => {
	const { instructions, ranges } = set;
	const count = instructions.length;
	if (count === 0) {
		return set;
	}
	const maxRegister = computeMaxRegister(instructions);
	const blocks = buildBasicBlocks(instructions);
	if (blocks.length === 0) {
		return set;
	}
	const { blockForIndex, predecessors, successors } = buildBlockGraph(instructions, blocks);

	const rpo: number[] = [];
	const visited = new Array<boolean>(blocks.length).fill(false);
	const stack: Array<{ block: number; index: number }> = [{ block: 0, index: 0 }];
	while (stack.length > 0) {
		const frame = stack[stack.length - 1];
		if (!visited[frame.block]) {
			visited[frame.block] = true;
		}
		const succs = successors[frame.block];
		if (frame.index < succs.length) {
			const next = succs[frame.index];
			frame.index += 1;
			if (!visited[next]) {
				stack.push({ block: next, index: 0 });
			}
		} else {
			rpo.push(frame.block);
			stack.pop();
		}
	}
	for (let i = 0; i < blocks.length; i += 1) {
		if (!visited[i]) {
			rpo.push(i);
		}
	}
	rpo.reverse();
	const rpoIndex = new Array<number>(blocks.length);
	for (let i = 0; i < rpo.length; i += 1) {
		rpoIndex[rpo[i]] = i;
	}

	const idom = new Array<number>(blocks.length).fill(-1);
	idom[0] = 0;
	const intersect = (a: number, b: number): number => {
		let finger1 = a;
		let finger2 = b;
		while (finger1 !== finger2) {
			while (rpoIndex[finger1] > rpoIndex[finger2]) {
				finger1 = idom[finger1];
			}
			while (rpoIndex[finger2] > rpoIndex[finger1]) {
				finger2 = idom[finger2];
			}
		}
		return finger1;
	};

	let changed = true;
	while (changed) {
		changed = false;
		for (let i = 1; i < rpo.length; i += 1) {
			const blockIndex = rpo[i];
			const preds = predecessors[blockIndex];
			let newIdom = -1;
			for (let p = 0; p < preds.length; p += 1) {
				const pred = preds[p];
				if (idom[pred] !== -1) {
					newIdom = pred;
					break;
				}
			}
			if (newIdom === -1) {
				continue;
			}
			for (let p = 0; p < preds.length; p += 1) {
				const pred = preds[p];
				if (pred === newIdom || idom[pred] === -1) {
					continue;
				}
				newIdom = intersect(pred, newIdom);
			}
			if (idom[blockIndex] !== newIdom) {
				idom[blockIndex] = newIdom;
				changed = true;
			}
		}
	}

	const domChildren: number[][] = new Array(blocks.length);
	for (let i = 0; i < blocks.length; i += 1) {
		domChildren[i] = [];
	}
	for (let i = 1; i < blocks.length; i += 1) {
		const parent = idom[i];
		if (parent >= 0 && parent !== i) {
			domChildren[parent].push(i);
		}
	}

	const dominanceFrontier: Array<Set<number>> = new Array(blocks.length);
	for (let i = 0; i < blocks.length; i += 1) {
		dominanceFrontier[i] = new Set<number>();
	}
	for (let b = 0; b < blocks.length; b += 1) {
		const preds = predecessors[b];
		if (preds.length < 2) {
			continue;
		}
		for (let p = 0; p < preds.length; p += 1) {
			let runner = preds[p];
			while (runner !== idom[b] && runner !== -1) {
				dominanceFrontier[runner].add(b);
				runner = idom[runner];
			}
		}
	}

	const defBlocksByReg: Array<Set<number>> = new Array(maxRegister + 1);
	for (let reg = 0; reg <= maxRegister; reg += 1) {
		defBlocksByReg[reg] = new Set<number>();
	}
	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const block = blocks[blockIndex];
		for (let i = block.start; i < block.end; i += 1) {
			const defs = collectDefs(instructions[i], maxRegister);
			for (let d = 0; d < defs.length; d += 1) {
				defBlocksByReg[defs[d]].add(blockIndex);
			}
		}
	}

	const phiByBlock: Array<Map<number, Phi>> = new Array(blocks.length);
	for (let i = 0; i < blocks.length; i += 1) {
		phiByBlock[i] = new Map<number, Phi>();
	}

	for (let reg = 0; reg <= maxRegister; reg += 1) {
		const defBlocks = Array.from(defBlocksByReg[reg]);
		if (defBlocks.length < 2) {
			continue;
		}
		const worklist = defBlocks.slice();
		const hasPhi = new Set<number>();
		while (worklist.length > 0) {
			const blockIndex = worklist.pop()!;
			const frontier = dominanceFrontier[blockIndex];
			for (const target of frontier) {
				if (hasPhi.has(target)) {
					continue;
				}
				hasPhi.add(target);
				const preds = predecessors[target];
				phiByBlock[target].set(reg, {
					reg,
					args: new Array(preds.length).fill(-1),
					dest: -1,
				});
				if (!defBlocksByReg[reg].has(target)) {
					worklist.push(target);
				}
			}
		}
	}

	const predIndexMap: Array<Map<number, number>> = new Array(blocks.length);
	for (let b = 0; b < blocks.length; b += 1) {
		const map = new Map<number, number>();
		const preds = predecessors[b];
		for (let p = 0; p < preds.length; p += 1) {
			map.set(preds[p], p);
		}
		predIndexMap[b] = map;
	}

	const valueReg: number[] = [];
	const valueDef: ValueDef[] = [];
	const instrUses: UseSlot[][] = new Array(instructions.length);
	const instrPrimaryDef: Array<number | null> = new Array(instructions.length).fill(null);
	const instrDefs: DefSlot[][] = new Array(instructions.length);
	const entryValuesByBlock: number[][] = new Array(blocks.length);

	const stacks: number[][] = new Array(maxRegister + 1);
	for (let reg = 0; reg <= maxRegister; reg += 1) {
		stacks[reg] = [];
		const valueId = valueReg.length;
		valueReg.push(reg);
		valueDef.push({ kind: 'instr', index: -1 });
		stacks[reg].push(valueId);
	}

	const pushValue = (reg: number, def: ValueDef): number => {
		const valueId = valueReg.length;
		valueReg.push(reg);
		valueDef.push(def);
		stacks[reg].push(valueId);
		return valueId;
	};

	const addUseSlot = (instructionIndex: number, slot: UseSlot): void => {
		if (!instrUses[instructionIndex]) {
			instrUses[instructionIndex] = [];
		}
		instrUses[instructionIndex].push(slot);
	};

	const renameBlock = (blockIndex: number): void => {
		const pushed: number[] = [];
		const phiMap = phiByBlock[blockIndex];
		phiMap.forEach((phi, reg) => {
			const valueId = pushValue(reg, { kind: 'phi', index: blockIndex });
			phi.dest = valueId;
			pushed.push(reg);
		});

		const entryValues: number[] = new Array(maxRegister + 1);
		for (let reg = 0; reg <= maxRegister; reg += 1) {
			const regStack = stacks[reg];
			entryValues[reg] = regStack[regStack.length - 1];
		}
		entryValuesByBlock[blockIndex] = entryValues;

		const block = blocks[blockIndex];
		for (let i = block.start; i < block.end; i += 1) {
			const instruction = instructions[i];
			const uses = collectUsesForSsa(instruction);
			for (let u = 0; u < uses.length; u += 1) {
				const operand = uses[u];
				const regStack = stacks[operand.reg];
				const valueId = regStack[regStack.length - 1];
				addUseSlot(i, { ...operand, valueId });
			}
			const defs = collectDefs(instruction, maxRegister);
			if (defs.length > 0) {
				const slots: DefSlot[] = [];
				for (let d = 0; d < defs.length; d += 1) {
					const reg = defs[d];
					const valueId = pushValue(reg, { kind: 'instr', index: i });
					if (defs.length === 1) {
						instrPrimaryDef[i] = valueId;
					}
					slots.push({ reg, valueId });
					pushed.push(reg);
				}
				instrDefs[i] = slots;
			} else {
				instrDefs[i] = [];
			}
		}

		const succs = successors[blockIndex];
		for (let s = 0; s < succs.length; s += 1) {
			const succ = succs[s];
			const predIndex = predIndexMap[succ].get(blockIndex);
			if (predIndex === undefined) {
				throw new Error('[ProgramOptimizer] Missing predecessor index.');
			}
			phiByBlock[succ].forEach((phi, reg) => {
				const regStack = stacks[reg];
				const valueId = regStack[regStack.length - 1];
				phi.args[predIndex] = valueId;
			});
		}

		const children = domChildren[blockIndex];
		for (let c = 0; c < children.length; c += 1) {
			renameBlock(children[c]);
		}

		for (let i = pushed.length - 1; i >= 0; i -= 1) {
			const reg = pushed[i];
			stacks[reg].pop();
		}
	};

	renameBlock(0);

	const enableSccp = true;
	const sccp = enableSccp
		? runSccp(
			instructions,
			blocks,
			blockForIndex,
			predecessors,
			rpo,
			instrUses,
			instrPrimaryDef,
			phiByBlock,
			valueDef,
			valueReg.length,
			context,
		)
		: {
			reachable: new Uint8Array(blocks.length).fill(1),
			valueConst: new Array<ConstValue | null>(valueReg.length).fill(null),
		};

	const valueConst: Array<ConstValue | null> = sccp.valueConst;
	const valueCopy: Array<number | null> = new Array(valueReg.length).fill(null);

	const propagateCopies = (): void => {
		let updated = true;
		while (updated) {
			updated = false;
			for (let valueId = 0; valueId < valueReg.length; valueId += 1) {
				const def = valueDef[valueId];
				let nextCopy: number | null = null;
				if (def.kind === 'phi') {
					if (sccp.reachable[def.index] === 0) {
						continue;
					}
					const phi = phiByBlock[def.index].get(valueReg[valueId]);
					if (!phi) {
						throw new Error('[ProgramOptimizer] Missing SSA phi node.');
					}
					let allSameCopy: number | null = null;
					let mismatch = false;
					for (let a = 0; a < phi.args.length; a += 1) {
						const pred = predecessors[def.index][a];
						if (sccp.reachable[pred] === 0) {
							continue;
						}
						const arg = phi.args[a];
						if (arg < 0) {
							mismatch = true;
							break;
						}
						const copyRoot = resolveCopyRoot(arg, valueCopy);
						if (allSameCopy === null) {
							allSameCopy = copyRoot;
						} else if (allSameCopy !== copyRoot) {
							allSameCopy = -1;
						}
					}
					if (!mismatch && allSameCopy !== null && allSameCopy >= 0) {
						nextCopy = allSameCopy;
					}
				} else if (def.index >= 0) {
					const instruction = instructions[def.index];
					switch (instruction.op) {
						case OpCode.MOV: {
							const slots = instrUses[def.index] ?? [];
							if (slots.length === 0) {
								throw new Error('[ProgramOptimizer] Missing MOV operand.');
							}
							const source = slots[0].valueId;
							nextCopy = source;
							break;
						}
						default:
							break;
					}
				}

				if (valueCopy[valueId] !== nextCopy) {
					valueCopy[valueId] = nextCopy;
					updated = true;
				}
			}
		}
	};

	propagateCopies();

	const exprMap = new Map<string, number>();
	const gvnVisit = (blockIndex: number): void => {
		const localAdded: string[] = [];
		const block = blocks[blockIndex];
		for (let i = block.start; i < block.end; i += 1) {
			const instruction = instructions[i];
			const defValue = instrPrimaryDef[i];
			if (defValue === null) {
				continue;
			}
			if (!isValueNumberable(instruction.op)) {
				continue;
			}
			const uses = instrUses[i] ?? [];
			let key = `${instruction.op}`;
			const operandKey = (field: 'b' | 'c', slot: UseSlot | null): string => {
				const constant = getOperandConst(instruction, field, slot, context, valueConst, valueCopy);
				if (constant) {
					return `c${constant.constIndex}`;
				}
				if (!slot) {
					const operand = field === 'b' ? instruction.b : instruction.c;
					return `v${operand}`;
				}
				return `v${resolveCopyRoot(slot.valueId, valueCopy)}`;
			};
			if (instruction.op === OpCode.UNM
				|| instruction.op === OpCode.BNOT
				|| instruction.op === OpCode.NOT
				|| instruction.op === OpCode.LEN) {
				if (uses.length === 0) {
					throw new Error('[ProgramOptimizer] Missing unary operand.');
				}
				key = `${key}|${operandKey('b', uses[0])}`;
			} else {
				if (uses.length < 2) {
					continue;
				}
				let slotB: UseSlot | null = null;
				let slotC: UseSlot | null = null;
				for (let s = 0; s < uses.length; s += 1) {
					if (uses[s].field === 'b') {
						slotB = uses[s];
					} else if (uses[s].field === 'c') {
						slotC = uses[s];
					}
				}
				let left = operandKey('b', slotB);
				let right = operandKey('c', slotC);
				if (isCommutative(instruction.op) && left > right) {
					const temp = left;
					left = right;
					right = temp;
				}
				key = `${key}|${left}|${right}`;
			}
			const existing = exprMap.get(key);
			if (existing !== undefined) {
				valueCopy[defValue] = existing;
			} else {
				exprMap.set(key, defValue);
				localAdded.push(key);
			}
		}

		const children = domChildren[blockIndex];
		for (let i = 0; i < children.length; i += 1) {
			gvnVisit(children[i]);
		}

		for (let i = 0; i < localAdded.length; i += 1) {
			exprMap.delete(localAdded[i]);
		}
	};

	gvnVisit(0);
	const enableAvailableValueNumbering = true;
	if (enableAvailableValueNumbering) {
		const valueNumbers = computeValueNumbers(
			instructions,
			instrUses,
			phiByBlock,
			valueDef,
			valueReg,
			valueCopy,
			valueConst,
		);
		applyAvailableValueNumbering(
			blocks,
			entryValuesByBlock,
			instrDefs,
			instrPrimaryDef,
			valueNumbers,
			valueCopy,
		);
		propagateCopies();
	}
	simplifyBranches(instructions, instrUses, valueConst, valueCopy, context);

	for (let i = 0; i < instructions.length; i += 1) {
		const instruction = instructions[i];
		const defValue = instrPrimaryDef[i];
		let replacedWithConst = false;
		if (defValue !== null && isValueNumberable(instruction.op)) {
			const constVal = resolveConst(defValue, valueConst, valueCopy);
			// CONCAT is currently the only value-numberable string-producing op in this pass.
			// If we add new string-producing opcodes, extend this exclusion so we don't
			// materialize stale or semantically wrong constants through LOADK.
			if (constVal && !(instruction.op === OpCode.CONCAT && isStringValue(constVal.value))) {
				replaceWithConst(instruction, instruction.a, constVal.value, context);
				instrUses[i] = [];
				replacedWithConst = true;
			}
		}
		if (replacedWithConst) {
			continue;
		}
		const uses = instrUses[i];
		if (!uses) {
			continue;
		}
		for (let u = 0; u < uses.length; u += 1) {
			const slot = uses[u];
			const constVal = resolveConst(slot.valueId, valueConst, valueCopy);
			// Keep RK replacement for non-string constants only.
			// If we add new string-producing opcodes, extend this exclusion too.
			// (Currently CONCAT is the only such op in this pass.)
			// When memwrite (STORE_MEM_WORDS) sources become string constants,
			// that would encode the constant literal directly instead of the register
			// and produces the wrong text.
			if (
				constVal
				&& slot.allowRk
				&& !isStringValue(constVal.value)
				&& constVal.constIndex <= MAX_EXT_CONST
				&& slot.rkMaskBit !== null
			) {
				if (slot.field === 'b') {
					instruction.b = -1 - constVal.constIndex;
				} else if (slot.field === 'c') {
					instruction.c = -1 - constVal.constIndex;
				} else {
					continue;
				}
				instruction.rkMask |= slot.rkMaskBit;
				continue;
			}
		}
	}

	simplifyAlgebraic(instructions, context);
	let current: InstructionSet = { instructions, ranges };
	const enableLoopOptimizations = true;
	if (enableLoopOptimizations) {
		current = applyLoopOptimizations(current, context);
	}
	current = eliminateDeadStoresGlobal(current, context);
	return current;
};
