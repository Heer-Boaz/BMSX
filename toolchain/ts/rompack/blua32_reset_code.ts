import { writeLE32 } from '../../../machine/ts/common/endian';
import { BLUA32_FUNCTION_ALIGNMENT, BLUA32_FUNCTION_CODE, BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_IMAGE_MAPPED_CODE_FLAG } from '../../../machine/ts/spec/blua32/image_format';
import { CLOSURE_ADDRESS_REGISTER_FLAG, INSTRUCTION_BYTES } from '../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../machine/ts/spec/blua32/opcode';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT } from '../../../machine/ts/spec/bmsx/memory_map';
import { MAX_ABX_REGISTER_A } from '../lua/compiler/wide_integer';
import { deriveBlua32FixedStack } from './blua32_fixed_stack';
import { blua32FunctionIndexAtAddress, type Blua32ImageLayout } from './blua32_image';
import { decodeBlua32InstructionAtPc } from './blua32_instruction_decode';

export type Blua32CodeFunctionPlan = {
	readonly targets: ReadonlySet<number>;
	/** Text body word to linked Function slot, independently of final addresses. */
	readonly loads: ReadonlyMap<number, number>;
};

/** Only the bindings already proven to yield CodeFunction can become constants. */
export function planBlua32CodeFunctionLoads(image: Blua32ImageLayout): Blua32CodeFunctionPlan {
	const targets = new Set<number>();
	for (const [index, fn] of image.functions.entries()) {
		if ((fn.flags & BLUA32_FUNCTION_CODE) !== 0) targets.add(index);
	}
	const loads = new Map<number, number>();
	const first = image.header.textAddress, end = first + image.textBytes.length;
	for (let pc = first; targets.size !== 0 && pc < end;) {
		const instruction = decodeBlua32InstructionAtPc(image.textBytes, first, pc);
		pc = instruction.pc + INSTRUCTION_BYTES;
		if (instruction.op !== OpCode.CLOSURE || (instruction.c & CLOSURE_ADDRESS_REGISTER_FLAG) !== 0
			|| instruction.a > MAX_ABX_REGISTER_A) continue;
		const slot = blua32FunctionIndexAtAddress(image, instruction.bx * BLUA32_FUNCTION_ALIGNMENT);
		if (targets.has(slot)) loads.set((instruction.pc - first) / INSTRUCTION_BYTES, slot);
	}
	return { targets, loads };
}

export function bindBlua32CodeFunctions(image: Blua32ImageLayout, targets: Iterable<number>): void {
	for (const index of targets) {
		const target = image.functions[index];
		if (target.upvalues.length !== 0)
			throw new Error('An immutable System call target cannot have captures.');
		target.flags |= BLUA32_FUNCTION_CODE;
		writeLE32(image.bytes, target.address - image.address + BLUA32_FUNCTION_FLAGS_OFFSET, target.flags);
	}
}

// Called after immutable System code and operands are linked. The linker
// derives code-valued CLOSURE targets from the real reachable vector bodies,
// not from firmware module names.
export function linkBlua32ResetCode(
	image: Blua32ImageLayout, reset: number, irq: number, exception: number, detached: readonly (number | undefined)[],
): { valueSlots: number; frames: number } {
	if ((image.header.flags & BLUA32_IMAGE_MAPPED_CODE_FLAG) !== 0)
		throw new Error('A direct System vector must execute immutable System ROM.');
	const codeTargets = new Set<number>();
	const vectors = [reset, irq, exception];
	const boundary = { reset, exceptionVectors: new Set([irq, exception]), interruptible: true, codeTargets };
	let valueSlots = 0, frames = 0;
	// Ordinary execution can be interrupted by IRQ and then NMI. Reserve
	// complete disjoint contexts, even at the deepest ordinary boot call.
	for (const vector of vectors) {
		const size = deriveBlua32FixedStack(image, [vector], boundary);
		valueSlots += size.valueSlots;
		frames += size.frames;
	}
	if (frames > CPU_FIXED_FRAME_COUNT || valueSlots > CPU_FIXED_VALUE_COUNT)
		throw new Error(`Direct System vectors require ${frames} frames and ${valueSlots} Values, beyond the fixed CPU bank.`);
	// The authored supervisor IRQ is also a standalone entry after reset.
	codeTargets.add(irq);
	for (const vector of detached) {
		if (vector === undefined) continue;
		const size = deriveBlua32FixedStack(image, [vector], {
			exceptionVectors: new Set([vector]), interruptible: false, codeTargets,
		});
		if (size.frames > CPU_FIXED_FRAME_COUNT || size.valueSlots > CPU_FIXED_VALUE_COUNT)
			throw new Error(`Detached vector 0x${image.functions[vector].address.toString(16)} requires ${size.frames} frames and ${size.valueSlots} Values, beyond the fixed CPU bank.`);
		valueSlots = Math.max(valueSlots, size.valueSlots);
		frames = Math.max(frames, size.frames);
	}
	bindBlua32CodeFunctions(image, codeTargets);
	return { frames, valueSlots };
}
