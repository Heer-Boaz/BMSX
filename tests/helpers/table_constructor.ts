import assert from 'node:assert/strict';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { BiosCall } from '../../machine/ts/spec/bmsx/bios';
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

/** Read the call's actual Integer argument producers in a bounded fixture Proto. */
export function tableConstructorHints(compiled: CompiledProgram, index: number): [array: number, hash: number][] {
	const { code, protos } = compiled.program;
	const { entryPC, codeLen } = protos[index];
	const constructors: [number, number][] = [];
	let prior: DecodedInstruction | undefined, priorPrior: DecodedInstruction | undefined;
	for (let pc = entryPC; pc < entryPC + codeLen;) {
		const instruction = decodeBlua32InstructionAtPc(code, 0, pc);
		if (instruction.op === OpCode.BIOSCALL && instruction.b === BiosCall.CreateTable) {
			assert.equal(instruction.c, 2);
			assert.ok(priorPrior && prior);
			assert.deepEqual([priorPrior.a, prior.a], [instruction.a + 1, instruction.a + 2]);
			constructors.push([immediateInteger(priorPrior), immediateInteger(prior)]);
		}
		pc = instruction.pc + INSTRUCTION_BYTES;
		priorPrior = prior;
		prior = instruction;
	}
	return constructors;
}
