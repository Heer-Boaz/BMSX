import { OpCode, getOpcodeName } from '../../cpu/opcode_info';
import type { InstructionSet } from '../optimizer';

const staticFunctionForbiddenOpcodeReason = (op: OpCode): string | null => {
	switch (op) {
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

export const assertStaticFunctionInstructionSet = (
	modulePath: string,
	symbolHandle: string,
	instructionSet: InstructionSet,
): void => {
	const instructions = instructionSet.instructions;
	for (let index = 0; index < instructions.length; index += 1) {
		const reason = staticFunctionForbiddenOpcodeReason(instructions[index].op);
		if (reason !== null) {
			throw new Error(`[Compiler] Const module '${modulePath}' function export '${symbolHandle}' emits forbidden static opcode ${getOpcodeName(instructions[index].op)} (${reason}). Static function exports must stay in the systems lane: constants, parameters, function-local words, globals, calls, branches, and memory loads/stores only.`);
		}
	}
};
