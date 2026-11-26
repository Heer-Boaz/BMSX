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
export const HEAP_SERVICE_TABLE_MODULE_PATH = 'kernel/table_create';
export const HEAP_SERVICE_STRINGS_MODULE_PATH = 'kernel/gc_strings';
export const HEAP_SERVICE_OBJECTS_MODULE_PATH = 'kernel/gc_objects';
export const HEAP_SERVICE_TRACE_MODULE_PATH = 'kernel/gc_trace';
export const HEAP_SERVICE_WEAK_MODULE_PATH = 'kernel/gc_weak_quantum';
export const HEAP_SERVICE_REMARK_MODULE_PATH = 'kernel/gc_remark';
export const HEAP_SERVICE_MODULES = [
	HEAP_SERVICE_MODULE_PATH, 'kernel/dlmalloc_record', HEAP_SERVICE_STRINGS_MODULE_PATH,
	'kernel/gc_control', 'kernel/gc_thread_compact', HEAP_SERVICE_OBJECTS_MODULE_PATH, HEAP_SERVICE_TABLE_MODULE_PATH,
	'kernel/gc_mark', 'kernel/gc_capture_trace', 'kernel/gc_thread_trace', 'kernel/gc_table_head', 'kernel/gc_table_trace',
	'kernel/gc_table_mode', 'kernel/gc_weak_mode', 'kernel/string_record', HEAP_SERVICE_TRACE_MODULE_PATH,
	'kernel/gc_weak_table', HEAP_SERVICE_WEAK_MODULE_PATH, HEAP_SERVICE_REMARK_MODULE_PATH,
] as const;
const serviceModules: ReadonlySet<string> = new Set(HEAP_SERVICE_MODULES);

const entries: Record<Exclude<HeapServiceOperation, HeapServiceOperation.Count>, readonly [string, number, string?]> = {
	[HeapServiceOperation.Reset]: ['bmsx_dlmalloc_reset', 3],
	[HeapServiceOperation.SetFloor]: ['bmsx_dlmalloc_set_floor', 2],
	[HeapServiceOperation.Floor]: ['bmsx_dlmalloc_floor', 1],
	[HeapServiceOperation.Allocate]: ['bmsx_dlmalloc_allocate', 3],
	[HeapServiceOperation.Free]: ['bmsx_dlmalloc_free', 2],
	[HeapServiceOperation.ReserveBacking]: ['bmsx_dlmalloc_reserve_backing', 3],
	[HeapServiceOperation.ResizeBacking]: ['bmsx_dlmalloc_resize_backing', 3],
	[HeapServiceOperation.Shrink]: ['bmsx_dlmalloc_shrink', 3],
	[HeapServiceOperation.AllocationBytes]: ['bmsx_dlmalloc_allocation_bytes', 2],
	[HeapServiceOperation.OccupiedBytes]: ['bmsx_dlmalloc_occupied_bytes', 1],
	[HeapServiceOperation.IsObject]: ['bmsx_dlmalloc_is_object', 2],
	[HeapServiceOperation.CreateTable]: ['create_table', 8, HEAP_SERVICE_TABLE_MODULE_PATH],
	[HeapServiceOperation.StringSweep]: ['sweep_step', 5, HEAP_SERVICE_STRINGS_MODULE_PATH],
	[HeapServiceOperation.ObjectSweep]: ['sweep_objects', 8, HEAP_SERVICE_OBJECTS_MODULE_PATH],
	[HeapServiceOperation.Trace]: ['trace_quantum', 8, HEAP_SERVICE_TRACE_MODULE_PATH],
	[HeapServiceOperation.WeakClear]: ['clear_weak_step', 7, HEAP_SERVICE_WEAK_MODULE_PATH],
	[HeapServiceOperation.Remark]: ['remark_visits', 6, HEAP_SERVICE_REMARK_MODULE_PATH],
};

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
		if (!serviceModules.has(path)) continue;
		const address = functionAddressBySymbol.get(programModuleExportKey(path, exportPathKey));
		if (address !== undefined) localFunctions.add(blua32FunctionIndexAtAddress(image, address));
	}

	const roots: number[] = [];
	for (let op = 0; op < HeapServiceOperation.Count; ++op) {
		const [symbol, params, path = HEAP_SERVICE_MODULE_PATH] = entries[op];
		const address = functionAddressBySymbol.get(programModuleExportKey(path, symbol));
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
