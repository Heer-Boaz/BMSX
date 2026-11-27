import assert from 'node:assert/strict';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { type CompiledProgram } from '../../toolchain/ts/lua/compiler';
import { decodeBlua32InstructionAtPc, type DecodedInstruction } from '../../toolchain/ts/rompack/blua32_instruction_decode';

function immediateInteger(instruction: DecodedInstruction): number {
	switch (instruction.op) {
		case OpCode.K0: return 0;
		case OpCode.K1: return 1;
		case OpCode.KSMI: return instruction.sbx;
		default: assert.fail('array and hash hints in this fixture are Integer immediates');
	}
}

/** The zero-token constructor and its two hint slots. */
export const TABLE_CONSTRUCTOR_BINDING = /\bK0 r(\d+)\n(?:0x[0-9a-f]+: )?SVC r\1, 2\b/i;

export function tableConstructorHints(compiled: CompiledProgram, index: number): [array: number, hash: number][] {
	const { code, protos } = compiled.program;
	const { entryPC, codeLen } = protos[index];
	const constructors: [number, number][] = [];
	let token: DecodedInstruction | undefined, hash: DecodedInstruction | undefined, array: DecodedInstruction | undefined;
	for (let pc = entryPC; pc < entryPC + codeLen;) {
		const instruction = decodeBlua32InstructionAtPc(code, 0, pc);
		if (instruction.op === OpCode.SVC && instruction.b === 3 && token?.op === OpCode.K0 && token.a === instruction.a) {
			assert.ok(array && hash);
			assert.deepEqual([array.a, hash.a], [instruction.a + 1, instruction.a + 2]);
			constructors.push([immediateInteger(array), immediateInteger(hash)]);
		}
		pc = instruction.pc + INSTRUCTION_BYTES;
		array = hash;
		hash = token;
		token = instruction;
	}
	return constructors;
}
