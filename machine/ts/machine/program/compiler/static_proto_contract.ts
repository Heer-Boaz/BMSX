import { OpCode, getOpcodeName } from '../../cpu/opcode_info';
import type { InstructionSet } from '../optimizer';

const staticLaneForbiddenOpcodeReason = (op: OpCode): string | null => {
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
		const reason = staticLaneForbiddenOpcodeReason(instructions[index].op);
		if (reason !== null) {
			throw new Error(`[Compiler] Module function export '${modulePath}:${symbolHandle}' emits forbidden static opcode ${getOpcodeName(instructions[index].op)} (${reason}). Const-module function exports and static-compatible bare-function modules must compile to scalar/static code using constants, parameters, function-local words, globals, calls, branches, and memory loads/stores only.`);
		}
	}
};
