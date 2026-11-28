import { OpCode, OPCODE_RK_OPERANDS } from '../../../../machine/ts/spec/blua32/opcode';
import type { Instruction } from './optimizer';

/** Physical instructions emitted after Lua register allocation. */
export function controlInstruction(origin: Instruction, op: OpCode, a: number, b: number, c = 0): Instruction {
	return {
		op, a, b, c, target: null, format: op === OpCode.KSMI ? 'ABx' : op === OpCode.JMP ? 'AsBx' : 'ABC',
		rkMask: OPCODE_RK_OPERANDS[op], inlineCallSites: origin.inlineCallSites,
	};
}
