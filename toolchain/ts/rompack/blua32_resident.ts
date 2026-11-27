import { writeLE32 } from '../../../machine/ts/common/endian';
import { BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_RESIDENT } from '../../../machine/ts/spec/blua32/image_format';
import { CPU_FIXED_FRAME_COUNT, CPU_FIXED_VALUE_COUNT } from '../../../machine/ts/spec/bmsx/memory_map';
import { programModuleExportKey, SYSTEM_RESIDENT_EXPORTS } from '../lua/compiler/program';
import type { ProgramConstValueReloc } from '../lua/compiler/program_object';
import { deriveBlua32FixedStack } from './blua32_fixed_stack';
import { blua32FunctionIndexAtAddress, type Blua32ImageLayout } from './blua32_image';

export function linkBlua32ResidentFunctions(
	image: Blua32ImageLayout,
	functionAddressBySymbol: ReadonlyMap<string, number>,
	constValueRelocs: readonly ProgramConstValueReloc[],
	publicFixedRoots: readonly number[],
): void {
	const roots = new Set(publicFixedRoots);
	for (const { path, exportPathKey, numParams } of SYSTEM_RESIDENT_EXPORTS) {
		const address = functionAddressBySymbol.get(programModuleExportKey(path, exportPathKey));
		if (address === undefined) continue;
		const index = blua32FunctionIndexAtAddress(image, address);
		if (image.functions[index].numParams !== numParams)
			throw new Error(`Resident export '${path}:${exportPathKey}' must take ${numParams} arguments.`);
		roots.add(index);
	}
	if (roots.size === 0) return;

	const lateConstants = new Set<number>();
	for (const reloc of constValueRelocs) {
		if (reloc.kind === 'link_value') lateConstants.add(reloc.constIndex);
	}
	// Prove the linked call graph, not a list of BIOS implementation modules.
	const { valueSlots, frames } = deriveBlua32FixedStack(image, [...roots], {
		functions: new Set(image.functions.keys()),
		lateConstants,
		resultWindow: { roots, slots: 15 - 6 },
	});
	if (valueSlots > CPU_FIXED_VALUE_COUNT || frames > CPU_FIXED_FRAME_COUNT)
		throw new Error(`Resident functions require ${valueSlots} Value slots and ${frames} frames, beyond the fixed bank.`);

	for (const index of roots) {
		const target = image.functions[index];
		target.flags |= BLUA32_FUNCTION_RESIDENT;
		writeLE32(image.bytes, target.address - image.address + BLUA32_FUNCTION_FLAGS_OFFSET, target.flags);
	}
}
