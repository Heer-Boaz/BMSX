import { writeLE32 } from '../../../machine/ts/common/endian';
import { BLUA32_FUNCTION_CODE, BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_IMAGE_MAPPED_CODE_FLAG } from '../../../machine/ts/spec/blua32/image_format';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT } from '../../../machine/ts/spec/bmsx/memory_map';
import { deriveBlua32FixedStack } from './blua32_fixed_stack';
import type { Blua32ImageLayout } from './blua32_image';

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
