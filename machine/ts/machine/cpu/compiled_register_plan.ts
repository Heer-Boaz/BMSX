import { OpCode, OPCODE_SCALAR_REGISTER_READS, OPCODE_WRITES_REGISTER_A,
	REGISTER_OPERAND_A, REGISTER_OPERAND_B, REGISTER_OPERAND_C } from '../../spec/blua32/opcode';
import { compiledBlockEndsBlock, type CompiledBlockSource } from './compiled_block';
import type { DecodedInstructionPage } from './execution_image';

/** Stable guest bindings for the region; the Boolean is a possible cached write. */
export function planRegionRegisters(page: DecodedInstructionPage, plans: readonly CompiledBlockSource[]): Map<number, boolean> {
	const reads = new Map<number, number>();
	for (const plan of plans) for (let word = plan.firstWord; word < plan.endWord; word += page.widths[word]) {
		const op = page.ops[word];
		if ((op === OpCode.STORE_MEM_WORDS || op === OpCode.STORE_MEM_WORDS_D) && page.c[word] === 0) continue;
		const flags = OPCODE_SCALAR_REGISTER_READS[op];
		if (flags & REGISTER_OPERAND_A) reads.set(page.a[word], (reads.get(page.a[word]) ?? 0) + 1);
		if ((flags & REGISTER_OPERAND_B) && page.b[word] >= 0) reads.set(page.b[word], (reads.get(page.b[word]) ?? 0) + 1);
		if ((flags & REGISTER_OPERAND_C) && page.c[word] >= 0) reads.set(page.c[word], (reads.get(page.c[word]) ?? 0) + 1);
	}
	const candidates: number[] = [];
	for (const [register, count] of reads) if (count > 1) candidates.push(register);
	candidates.sort((a, b) => reads.get(b)! - reads.get(a)! || a - b);
	candidates.length = Math.min(candidates.length, 6);
	const residents = new Map<number, boolean>();
	for (const register of candidates) {
		let written = false;
		for (const plan of plans) for (let word = plan.firstWord; word < plan.endWord; word += page.widths[word]) {
			const op = page.ops[word];
			written ||= OPCODE_WRITES_REGISTER_A[op] !== 0 && page.a[word] === register && !compiledBlockEndsBlock(op, page.b[word]);
			written ||= op === OpCode.SELF && page.a[word] + 1 === register;
		}
		residents.set(register, written);
	}
	return residents;
}
