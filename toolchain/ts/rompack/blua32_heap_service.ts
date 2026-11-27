import { BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_RESIDENT } from '../../../machine/ts/spec/blua32/image_format';
import { readLE32, writeLE32 } from '../../../machine/ts/common/endian';
import {
	HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET, HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET,
	HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET,
	HEAP_SERVICE_ENTRY_COUNT, HEAP_SERVICE_FRAME_COUNT, HEAP_SERVICE_VALUE_COUNT, HeapServiceOperation,
} from '../../../machine/ts/spec/bmsx/heap_service';
import { programModuleExportKey, SYSTEM_RESIDENT_EXPORTS, type ProgramModuleExport } from '../lua/compiler/program';
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
export const HEAP_SERVICE_ROOT_BANKS_MODULE_PATH = 'kernel/gc_root_banks';
export const HEAP_SERVICE_CLOSURE_MODULE_PATH = 'kernel/closure_create';
const TABLE_GROW_MODULE = 'kernel/table_grow';
const HEAP_SERVICE_TABLE_RESIZE_MODULE_PATH = 'kernel/table_resize';
const STOPPED_FINAL_MARK_MODULE = 'kernel/gc_stopped_final_mark';
const THREAD_FRAME_STORAGE_MODULE = 'kernel/thread_frame_storage';
const CAPTURED_CLOSURE_MODULE = 'kernel/allocate_captured_closure';
const ALLOCATE_RECORD_MODULE = 'kernel/allocate_record';
export const HEAP_SERVICE_MODULES = [
	ALLOCATE_RECORD_MODULE, ...new Set(SYSTEM_RESIDENT_EXPORTS.map(entry => entry.path)),
	HEAP_SERVICE_MODULE_PATH, 'kernel/dlmalloc_record', HEAP_SERVICE_STRINGS_MODULE_PATH,
	'kernel/gc_control', 'kernel/gc_thread_compact', 'kernel/thread_retire', HEAP_SERVICE_OBJECTS_MODULE_PATH, HEAP_SERVICE_TABLE_MODULE_PATH,
	'kernel/gc_mark', 'kernel/gc_operand_roots', 'kernel/gc_capture_trace', 'kernel/gc_thread_trace', 'kernel/gc_table_head', 'kernel/gc_table_trace',
	'kernel/gc_table_mode', 'kernel/gc_weak_mode', 'kernel/string_record', 'kernel/image_string_bindings', HEAP_SERVICE_TRACE_MODULE_PATH,
	'kernel/gc_weak_table', HEAP_SERVICE_WEAK_MODULE_PATH, HEAP_SERVICE_REMARK_MODULE_PATH, HEAP_SERVICE_ROOT_BANKS_MODULE_PATH,
	HEAP_SERVICE_CLOSURE_MODULE_PATH, 'kernel/table_reserve_growth', 'kernel/table_prepare_rebuild',
	'kernel/table_publish_growth', 'kernel/table_finish_resize', 'kernel/table_reinsert',
	'kernel/table_assignment', HEAP_SERVICE_TABLE_RESIZE_MODULE_PATH, TABLE_GROW_MODULE, 'kernel/table_plan', 'kernel/table_insert_existing',
	STOPPED_FINAL_MARK_MODULE,
	CAPTURED_CLOSURE_MODULE, 'kernel/closure_capture_create', 'kernel/gc_maintenance', 'kernel/gc_vblank', 'kernel/gc_step',
	'kernel/gc_mark_quantum', 'kernel/gc_atomic_quantum', 'kernel/gc_sweep_quantum', 'kernel/gc_epoch',
	'kernel/gc_runtime_layout', 'kernel/global_bank', 'kernel/gc_root_inputs', 'kernel/gc_pace', 'kernel/heap_admission', 'kernel/word_arithmetic',
	'kernel/allocate_string_slice', 'kernel/string_slice', 'kernel/string_char_bytes', 'kernel/number_bytes', 'kernel/boot_image_admission', 'kernel/gc_stopped_roots',
] as const;
const serviceModules: ReadonlySet<string> = new Set(HEAP_SERVICE_MODULES);

const entries: Record<Exclude<HeapServiceOperation, HeapServiceOperation.Count>, readonly [string, number, string?]> = {
	[HeapServiceOperation.AllocateRecord]: ['allocate_record', 6, ALLOCATE_RECORD_MODULE],
	[HeapServiceOperation.TableGrow]: ['grow_table', 4, TABLE_GROW_MODULE],
	[HeapServiceOperation.StoppedFinalMark]: ['stopped_final_mark', 2, STOPPED_FINAL_MARK_MODULE],
	[HeapServiceOperation.ReserveFrameSpace]: ['reserve_frame_space', 4, THREAD_FRAME_STORAGE_MODULE],
	[HeapServiceOperation.StoreClosedUpvalue]: ['store_closed_upvalue', 2, 'kernel/gc_barrier'],
	[HeapServiceOperation.CapturedClosure]: ['allocate_captured_closure', 6, CAPTURED_CLOSURE_MODULE],
};

/** Bind the CPU-only roster by exact module symbols after relocation. */
export function linkBlua32HeapService(
	image: Blua32ImageLayout,
	descriptorOffset: number,
	moduleExports: readonly ProgramModuleExport[],
	functionAddressBySymbol: ReadonlyMap<string, number>,
	constValueRelocs: readonly ProgramConstValueReloc[],
	publicFixedRoots: readonly number[],
): void {
	const residentRoots = new Set(publicFixedRoots);
	for (const { path, exportPathKey, numParams } of SYSTEM_RESIDENT_EXPORTS) {
		const address = functionAddressBySymbol.get(programModuleExportKey(path, exportPathKey));
		if (address === undefined) throw new Error(`Resident export '${path}:${exportPathKey}' is not a linked static function.`);
		const index = blua32FunctionIndexAtAddress(image, address);
		if (image.functions[index].numParams !== numParams)
			throw new Error(`Resident export '${path}:${exportPathKey}' must take ${numParams} arguments.`);
		residentRoots.add(index);
	}
	const localFunctions = new Set(residentRoots);
	for (const { path, exportPathKey } of moduleExports) {
		if (!serviceModules.has(path)) continue;
		const address = functionAddressBySymbol.get(programModuleExportKey(path, exportPathKey));
		if (address !== undefined) localFunctions.add(blua32FunctionIndexAtAddress(image, address));
	}

	const roots: number[] = [];
	for (let op = 0; op < HEAP_SERVICE_ENTRY_COUNT; ++op) {
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
	const { valueSlots, frames } = deriveBlua32FixedStack(image, [...roots, ...residentRoots], { functions: localFunctions, lateConstants });
	if (valueSlots > HEAP_SERVICE_VALUE_COUNT || frames > HEAP_SERVICE_FRAME_COUNT)
		throw new Error(`Heap service requires ${valueSlots} Value slots and ${frames} frames, beyond its fixed stack.`);

	const { bytes } = image;
	writeLE32(bytes, descriptorOffset + HEAP_SERVICE_DESCRIPTOR_VALUE_SLOTS_OFFSET, valueSlots);
	writeLE32(bytes, descriptorOffset + HEAP_SERVICE_DESCRIPTOR_FRAMES_OFFSET, frames);
	for (const index of residentRoots) {
		const offset = image.functions[index].address - image.address + BLUA32_FUNCTION_FLAGS_OFFSET;
		writeLE32(bytes, offset, readLE32(bytes, offset) | BLUA32_FUNCTION_RESIDENT);
	}
	for (let op = 0; op < roots.length; ++op)
		writeLE32(bytes, descriptorOffset + HEAP_SERVICE_DESCRIPTOR_FUNCTIONS_OFFSET + 4 * op, image.functions[roots[op]].address);
}
