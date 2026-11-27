import assert from 'node:assert/strict';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { BiosFunction, BIOS_FUNCTION_SLOTS } from '../../machine/ts/spec/bmsx/bios';
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

/** The exact System function symbol printed by the linked disassembler. */
export const TABLE_CONSTRUCTOR_BINDING = /\bCLOSURE r\d+, function@[0-9a-f]+ \(module:kernel\/bios_create_table\/[^)]*\|create_table\)/;

/** Read the call's actual Integer argument producers in a bounded fixture Proto. */
export function tableConstructorHints(compiled: CompiledProgram, index: number): [array: number, hash: number][] {
	const { code, protos } = compiled.program;
	const { entryPC, codeLen } = protos[index];
	const constructors: [number, number][] = [];
	const binding = BIOS_FUNCTION_SLOTS[BiosFunction.CreateTable];
	const symbols = compiled.domain === 'system'
		? compiled.constRelocs.filter(reloc => reloc.kind === 'export_proto'
			&& reloc.path === binding.path && reloc.exportPathKey === binding.exportPathKey)
		: compiled.biosFunctionConstRelocs.filter(reloc => reloc.importIndex === BiosFunction.CreateTable);
	const sites = new Set(symbols.map(reloc => reloc.wordIndex * INSTRUCTION_BYTES));
	let callee: DecodedInstruction | undefined, hash: DecodedInstruction | undefined, array: DecodedInstruction | undefined;
	for (let pc = entryPC; pc < entryPC + codeLen;) {
		const instruction = decodeBlua32InstructionAtPc(code, 0, pc);
		if (callee && sites.has(callee.pc)) {
			assert.equal(callee.op, OpCode.CLOSURE);
			assert.deepEqual([instruction.op, instruction.a, instruction.b, instruction.c], [OpCode.CALL, callee.a, 3, 2]);
			assert.ok(array && hash);
			assert.deepEqual([array.a, hash.a], [instruction.a + 1, instruction.a + 2]);
			constructors.push([immediateInteger(array), immediateInteger(hash)]);
		}
		pc = instruction.pc + INSTRUCTION_BYTES;
		array = hash;
		hash = callee;
		callee = instruction;
	}
	return constructors;
}
