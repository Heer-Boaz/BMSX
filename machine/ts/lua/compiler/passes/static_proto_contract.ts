import { OpCode, getOpcodeName } from '../../../machine/cpu/opcode_info';
import { valueIsString, type Value } from '../../../machine/cpu/cpu';
import type { Instruction, InstructionSet } from '../optimizer';

export const staticLaneForbiddenOpcodeReason = (op: OpCode): string | null => {
	switch (op) {
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

const instructionLoadKReason = (instruction: Instruction, constPool: ReadonlyArray<Value>): string | null => {
	if (instruction.op !== OpCode.LOADK) {
		return null;
	}
	if (instruction.symbolicReloc?.kind === 'module') {
		return 'runtime module slot';
	}
	if (instruction.symbolicReloc !== undefined) {
		return null;
	}
	return valueIsString(constPool[instruction.b]) ? 'Lua string constant' : null;
};

export const assertStaticFunctionInstructionSet = (
	modulePath: string,
	symbolHandle: string,
	instructionSet: InstructionSet,
	constPool: ReadonlyArray<Value>,
): void => {
	const instructions = instructionSet.instructions;
	for (let index = 0; index < instructions.length; index += 1) {
		const instruction = instructions[index];
		const reason = staticLaneForbiddenOpcodeReason(instruction.op) ?? instructionLoadKReason(instruction, constPool);
		if (reason !== null) {
			throw new Error(`[Compiler] Module function export '${modulePath}:${symbolHandle}' emits forbidden static opcode ${getOpcodeName(instruction.op)} (${reason}). Const-module function exports and static-compatible bare-function modules must compile to scalar/static code using numeric and boolean constants, parameters, function-local words, static calls, branches, and memory loads/stores only.`);
		}
	}
};
