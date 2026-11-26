import { writeLE32 } from '../../../machine/ts/common/endian';
import {
	HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET, HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET,
	HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET, HEAP_SERVICE_DESCRIPTOR_VERSION, HEAP_SERVICE_DESCRIPTOR_VERSION_OFFSET,
	HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_VALUE_COUNT, HeapServiceOperation,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { programModuleExportKey, type ProgramModuleExport } from '../lua/compiler/program';
import type { ProgramConstValueReloc } from '../lua/compiler/program_object';
import { deriveBlua32FixedStack } from './blua32_fixed_stack';
import { blua32FunctionIndexAtAddress, type Blua32ImageLayout } from './blua32_image';

export const HEAP_SERVICE_MODULE_PATH = 'kernel/dlmalloc';

const entries = {
	[HeapServiceOperation.Reset]: ['reset', 3],
	[HeapServiceOperation.SetFloor]: ['set_floor', 2],
	[HeapServiceOperation.Floor]: ['floor', 1],
	[HeapServiceOperation.Allocate]: ['allocate', 3],
	[HeapServiceOperation.Free]: ['free', 2],
	[HeapServiceOperation.ReserveBacking]: ['reserve_backing', 3],
	[HeapServiceOperation.ResizeBacking]: ['resize_backing', 3],
	[HeapServiceOperation.Shrink]: ['shrink', 3],
	[HeapServiceOperation.AllocationBytes]: ['allocation_bytes', 2],
	[HeapServiceOperation.OccupiedBytes]: ['occupied_bytes', 1],
	[HeapServiceOperation.IsObject]: ['is_object', 2],
} as const satisfies Record<Exclude<HeapServiceOperation, HeapServiceOperation.Count>, readonly [string, number]>;

/** Bind the CPU-only roster by exact module symbols after relocation. */
export function linkBlua32HeapService(
	image: Blua32ImageLayout,
	descriptorOffset: number,
	moduleExports: readonly ProgramModuleExport[],
	functionAddressBySymbol: ReadonlyMap<string, number>,
	constValueRelocs: readonly ProgramConstValueReloc[],
): void {
	const localFunctions = new Set<number>();
	for (const { path, exportPathKey } of moduleExports) {
		if (path !== HEAP_SERVICE_MODULE_PATH) continue;
		const address = functionAddressBySymbol.get(programModuleExportKey(path, exportPathKey));
		if (address !== undefined) localFunctions.add(blua32FunctionIndexAtAddress(image, address));
	}

	const roots: number[] = [];
	for (let op = 0; op < HeapServiceOperation.Count; ++op) {
		const [name, params] = entries[op];
		const symbol = `bmsx_dlmalloc_${name}`;
		const address = functionAddressBySymbol.get(programModuleExportKey(HEAP_SERVICE_MODULE_PATH, symbol));
		if (address === undefined) throw new Error(`Heap service entry '${symbol}' is not a linked static function.`);
		const index = blua32FunctionIndexAtAddress(image, address);
		if (image.functions[index].numParams !== params)
			throw new Error(`Heap service entry '${symbol}' must take ${params} arguments.`);
		roots.push(index);
	}
	const lateConstants = new Set<number>();
	for (const reloc of constValueRelocs) {
		if (reloc.kind === 'link_value') lateConstants.add(reloc.constIndex);
	}
	const { valueSlots, frames } = deriveBlua32FixedStack(image, roots, { functions: localFunctions, lateConstants });
	if (valueSlots > HEAP_SERVICE_VALUE_COUNT || frames > HEAP_SERVICE_FRAME_COUNT)
		throw new Error(`Heap service requires ${valueSlots} Value slots and ${frames} frames, beyond its fixed stack.`);

	const { bytes } = image;
	writeLE32(bytes, descriptorOffset + HEAP_SERVICE_DESCRIPTOR_VERSION_OFFSET, HEAP_SERVICE_DESCRIPTOR_VERSION);
	writeLE32(bytes, descriptorOffset + HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET, valueSlots);
	writeLE32(bytes, descriptorOffset + HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET, frames);
	for (let op = 0; op < roots.length; ++op)
		writeLE32(bytes, descriptorOffset + HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET + 4 * op, image.functions[roots[op]].address);
}
