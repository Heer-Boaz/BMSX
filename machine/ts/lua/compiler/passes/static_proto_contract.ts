import { OpCode } from '../../../spec/blua32/opcode';
import { OPCODE_NAMES } from '../../../rompack/tooling/opcode_metadata';
import type { Instruction, InstructionSet } from '../optimizer';
import type { ProgramConstant } from '../program';

export const staticLaneForbiddenOpcodeReason = (op: OpCode): string | null => {
	switch (op) {
		// LOADKR only materializes an already-interned program constant selected
		// by immutable typed .rodata; it performs no table or string allocation.
		case OpCode.LOADKR:
			return null;
		case OpCode.GETSYS:
		case OpCode.SETSYS:
		case OpCode.GETGL:
		case OpCode.SETGL:
			return 'runtime global slot';
		case OpCode.NEWT:
			return 'table allocation';
		case OpCode.GETT:
		case OpCode.SETT:
		case OpCode.GETI:
		case OpCode.SETI:
		case OpCode.GETFIELD:
		case OpCode.SETFIELD:
		case OpCode.SELF:
			return 'table dispatch';
		case OpCode.LEN:
			return 'Lua object length';
		case OpCode.CLOSURE:
			return 'runtime closure allocation';
		case OpCode.VARARG:
			return 'vararg dispatch';
		case OpCode.CONCAT:
		case OpCode.CONCATN:
			return 'dynamic string concatenation';
		default:
			return null;
	}
};

const instructionLoadKReason = (instruction: Instruction, constPool: ReadonlyArray<ProgramConstant>): string | null => {
	if (instruction.op !== OpCode.LOADK) {
		return null;
	}
	if (instruction.symbolicReloc?.kind === 'module') {
		return 'runtime module slot';
	}
	if (instruction.symbolicReloc !== undefined) {
		return null;
	}
	return typeof constPool[instruction.b] === 'string' ? 'Lua string constant' : null;
};

export const assertStaticFunctionInstructionSet = (
	modulePath: string,
	symbolHandle: string,
	instructionSet: InstructionSet,
	constPool: ReadonlyArray<ProgramConstant>,
): void => {
	const instructions = instructionSet.instructions;
	for (let index = 0; index < instructions.length; index += 1) {
		const instruction = instructions[index];
		const reason = staticLaneForbiddenOpcodeReason(instruction.op) ?? instructionLoadKReason(instruction, constPool);
		if (reason !== null) {
			throw new Error(`Module function export '${modulePath}:${symbolHandle}' emits forbidden static opcode ${OPCODE_NAMES[instruction.op]} (${reason}). Const-module function exports and static-compatible bare-function modules must compile to scalar/static code using numeric and boolean constants, parameters, function-local words, static calls, branches, and memory loads/stores only.`);
		}
	}
};
