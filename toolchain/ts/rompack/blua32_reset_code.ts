import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import { BLUA32_FUNCTION_CODE, BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_RESIDENT, BLUA32_IMAGE_MAPPED_CODE_FLAG } from '../../../machine/ts/spec/blua32/image_format';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT } from '../../../machine/ts/spec/bmsx/memory_map';
import { deriveBlua32FixedStack } from './blua32_fixed_stack';
import type { Blua32ImageLayout } from './blua32_image';

// Called after immutable System code and operands are linked. The linker
// derives code-valued CLOSURE targets from the real reachable vector bodies,
// not from firmware module names or the legacy fixed-service descriptor.
export function linkBlua32ResetCode(
	image: Blua32ImageLayout, reset: number, irq: number, exception: number,
): { valueSlots: number; frames: number } {
	if ((image.header.flags & BLUA32_IMAGE_MAPPED_CODE_FLAG) !== 0)
		throw new Error('A direct System vector must execute immutable System ROM.');
	const codeTargets = new Set<number>();
	const vectors = [reset, irq, exception];
	const boundary = {
		functions: new Set(image.functions.keys()),
		lateConstants: new Set<number>(),
		ordinaryReset: { reset, irq, exception, codeTargets },
	};
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
	for (const index of codeTargets) {
		const offset = image.functions[index].address - image.address + BLUA32_FUNCTION_FLAGS_OFFSET;
		const flags = readLE32(image.bytes, offset);
		if ((flags & BLUA32_FUNCTION_RESIDENT) !== 0)
			throw new Error('A direct System vector cannot call a legacy resident activation.');
		writeLE32(image.bytes, offset, flags | BLUA32_FUNCTION_CODE);
	}
	return { frames, valueSlots };
}
