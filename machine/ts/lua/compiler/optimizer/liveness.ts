import { OpCode, decodeCallArgCount } from '../../../spec/blua32/opcode';
import { buildBasicBlocks, buildBlockGraph, type Block } from '../control_flow';
import type { Instruction } from './index';
import { isRegisterOperand } from './instructions';

const RK_B = 1;
const RK_C = 2;

type RegisterVisitor<T> = (state: T, register: number) => void;

function visitRegister<T>(state: T, visitor: RegisterVisitor<T>, register: number): void {
	if (register >= 0) {
		visitor(state, register);
	}
}

function visitRegisterRange<T>(state: T, visitor: RegisterVisitor<T>, base: number, count: number): void {
	for (let offset = 0; offset < count; offset += 1) {
		visitRegister(state, visitor, base + offset);
	}
}

function visitInstructionUses<T>(
	instruction: Instruction,
	maxRegister: number,
	state: T,
	visitor: RegisterVisitor<T>,
): void {
	switch (instruction.op) {
		case OpCode.MOV:
		case OpCode.UNM:
		case OpCode.NOT:
		case OpCode.LEN:
		case OpCode.BNOT:
			visitRegister(state, visitor, instruction.b);
			break;
		case OpCode.SETSYS:
		case OpCode.SETGL:
		case OpCode.SETUP:
		case OpCode.JMPIF:
		case OpCode.JMPIFNOT:
		case OpCode.MTC0:
			visitRegister(state, visitor, instruction.a);
			break;
		case OpCode.LOADKR:
		case OpCode.LOAD_MEM_D:
			visitRegister(state, visitor, instruction.b);
			break;
		case OpCode.STORE_MEM_D:
			visitRegister(state, visitor, instruction.a);
			visitRegister(state, visitor, instruction.b);
			break;
		case OpCode.STORE_MEM_WORDS_D:
			visitRegisterRange(state, visitor, instruction.a, instruction.c);
			visitRegister(state, visitor, instruction.b);
			break;
		case OpCode.GETI:
		case OpCode.GETFIELD:
		case OpCode.SELF:
			visitRegister(state, visitor, instruction.b);
			break;
		case OpCode.GETT:
			visitRegister(state, visitor, instruction.b);
			if (isRegisterOperand(instruction, RK_C, instruction.c)) {
				visitRegister(state, visitor, instruction.c);
			}
			break;
		case OpCode.SETI:
		case OpCode.SETFIELD:
			visitRegister(state, visitor, instruction.a);
			if (isRegisterOperand(instruction, RK_C, instruction.c)) {
				visitRegister(state, visitor, instruction.c);
			}
			break;
		case OpCode.SETT:
			visitRegister(state, visitor, instruction.a);
			if (isRegisterOperand(instruction, RK_B, instruction.b)) {
				visitRegister(state, visitor, instruction.b);
			}
			if (isRegisterOperand(instruction, RK_C, instruction.c)) {
				visitRegister(state, visitor, instruction.c);
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
			if (isRegisterOperand(instruction, RK_B, instruction.b)) {
				visitRegister(state, visitor, instruction.b);
			}
			if (isRegisterOperand(instruction, RK_C, instruction.c)) {
				visitRegister(state, visitor, instruction.c);
			}
			break;
		case OpCode.CONCATN:
			visitRegisterRange(state, visitor, instruction.b, instruction.c);
			break;
		case OpCode.LOAD_MEM:
			visitRegister(state, visitor, instruction.b);
			break;
		case OpCode.STORE_MEM:
			visitRegister(state, visitor, instruction.a);
			visitRegister(state, visitor, instruction.b);
			break;
		case OpCode.STORE_MEM_WORDS:
			visitRegisterRange(state, visitor, instruction.a, instruction.c);
			visitRegister(state, visitor, instruction.b);
			break;
		case OpCode.CALL: {
			const count = decodeCallArgCount(instruction.b, maxRegister - instruction.a);
			visitRegisterRange(state, visitor, instruction.a, count + 1);
			break;
		}
		case OpCode.RET: {
			const count = instruction.b === 0 ? maxRegister - instruction.a + 1 : instruction.b;
			visitRegisterRange(state, visitor, instruction.a, count);
			break;
		}
		default:
			break;
	}
}

function visitInstructionDefs<T>(
	instruction: Instruction,
	maxRegister: number,
	state: T,
	visitor: RegisterVisitor<T>,
): void {
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
		case OpCode.LOADKR:
		case OpCode.GETSYS:
		case OpCode.GETGL:
		case OpCode.GETI:
		case OpCode.GETFIELD:
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
		case OpCode.LOAD_MEM_D:
		case OpCode.MFC0:
			visitRegister(state, visitor, instruction.a);
			break;
		case OpCode.SELF:
			visitRegisterRange(state, visitor, instruction.a, 2);
			break;
		case OpCode.LOADNIL:
			visitRegisterRange(state, visitor, instruction.a, instruction.b);
			break;
		case OpCode.VARARG: {
			const count = instruction.b === 0 ? maxRegister - instruction.a + 1 : instruction.b;
			visitRegisterRange(state, visitor, instruction.a, count);
			break;
		}
		case OpCode.CALL: {
			const count = instruction.c === 0 ? maxRegister - instruction.a + 1 : instruction.c;
			visitRegisterRange(state, visitor, instruction.a, count);
			break;
		}
		default:
			break;
	}
}

function appendRegister(registers: number[], register: number): void {
	registers.push(register);
}

export function collectInstructionUses(instruction: Instruction, maxRegister: number): number[] {
	const uses: number[] = [];
	visitInstructionUses(instruction, maxRegister, uses, appendRegister);
	return uses;
}

export function collectInstructionDefs(instruction: Instruction, maxRegister: number): number[] {
	const defs: number[] = [];
	visitInstructionDefs(instruction, maxRegister, defs, appendRegister);
	return defs;
}

type BlockUseState = {
	use: Uint8Array;
	def: Uint8Array;
};

function markBlockUse(state: BlockUseState, register: number): void {
	if (state.def[register] === 0) {
		state.use[register] = 1;
	}
}

function markBlockDef(state: BlockUseState, register: number): void {
	state.def[register] = 1;
}

function clearLiveRegister(live: Uint8Array, register: number): void {
	live[register] = 0;
}

function markLiveRegister(live: Uint8Array, register: number): void {
	live[register] = 1;
}

export function computeBlockLiveOut(
	instructions: Instruction[],
	blocks: Block[],
	successors: number[][],
	maxRegister: number,
): Uint8Array[] {
	if (blocks.length === 0) {
		return [];
	}
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
	}
	const blockState: BlockUseState = { use: blockUse[0], def: blockDef[0] };
	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const block = blocks[blockIndex];
		blockState.use = blockUse[blockIndex];
		blockState.def = blockDef[blockIndex];
		for (let index = block.start; index < block.end; index += 1) {
			visitInstructionUses(instructions[index], maxRegister, blockState, markBlockUse);
			visitInstructionDefs(instructions[index], maxRegister, blockState, markBlockDef);
		}
	}

	const nextOut = new Uint8Array(registerCount);
	let changed = true;
	while (changed) {
		changed = false;
		for (let blockIndex = blocks.length - 1; blockIndex >= 0; blockIndex -= 1) {
			const out = liveOut[blockIndex];
			nextOut.fill(0);
			const nextBlocks = successors[blockIndex];
			for (let successorIndex = 0; successorIndex < nextBlocks.length; successorIndex += 1) {
				const successorIn = liveIn[nextBlocks[successorIndex]];
				for (let register = 0; register < registerCount; register += 1) {
					if (successorIn[register] !== 0) {
						nextOut[register] = 1;
					}
				}
			}
			for (let register = 0; register < registerCount; register += 1) {
				if (out[register] !== nextOut[register]) {
					out[register] = nextOut[register];
					changed = true;
				}
			}
			const use = blockUse[blockIndex];
			const def = blockDef[blockIndex];
			const inSet = liveIn[blockIndex];
			for (let register = 0; register < registerCount; register += 1) {
				const nextIn = use[register] !== 0 || (out[register] !== 0 && def[register] === 0) ? 1 : 0;
				if (inSet[register] !== nextIn) {
					inSet[register] = nextIn;
					changed = true;
				}
			}
		}
	}
	return liveOut;
}

export function computeInstructionLiveInAt(
	instructions: Instruction[],
	maxRegister: number,
	instructionIndices: ReadonlyArray<number>,
): Uint8Array[] {
	if (instructionIndices.length === 0) {
		return [];
	}
	const blocks = buildBasicBlocks(instructions);
	const { successors } = buildBlockGraph(instructions, blocks);
	const blockLiveOut = computeBlockLiveOut(instructions, blocks, successors, maxRegister);
	const liveIn: Uint8Array[] = new Array(instructionIndices.length);
	let candidateStart = 0;
	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const block = blocks[blockIndex];
		let candidateEnd = candidateStart;
		while (candidateEnd < instructionIndices.length && instructionIndices[candidateEnd] < block.end) {
			candidateEnd += 1;
		}
		let candidateIndex = candidateEnd - 1;
		const live = blockLiveOut[blockIndex].slice();
		for (let index = block.end - 1; index >= block.start; index -= 1) {
			const instruction = instructions[index];
			visitInstructionDefs(instruction, maxRegister, live, clearLiveRegister);
			visitInstructionUses(instruction, maxRegister, live, markLiveRegister);
			if (candidateIndex >= candidateStart && instructionIndices[candidateIndex] === index) {
				liveIn[candidateIndex] = live.slice();
				candidateIndex -= 1;
			}
		}
		candidateStart = candidateEnd;
	}
	return liveIn;
}
