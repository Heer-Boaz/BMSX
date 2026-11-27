import type { Blua32BiosFunctionExport } from './blua32_bios_imports';
import type { Blua32PreparedEntry, Blua32StaticExport } from './blua32_image_builder';
import type { ManagedEntry } from '../lua/compiler';
import { BIOS_FUNCTION_SLOTS } from '../../../machine/ts/spec/bmsx/bios';

export const SYSTEM_ROM_NAME = 'bmsx-bios';

export const SYSTEM_BLUA32_IMAGE_OFFSET = 0x00000100;
/** Build-time program budget, not a file offset at which assets must begin. */
export const SYSTEM_BLUA32_IMAGE_LIMIT = 0x00400000;
/** Bounded growth headroom keeps system RODATA stable during Hot Resume. */
export const SYSTEM_BLUA32_FUNCTION_TABLE_ALIGNMENT = 0x00004000;

export const BIOS_FUNCTION_EXPORTS: ReadonlyArray<Blua32BiosFunctionExport> =
	BIOS_FUNCTION_SLOTS;

// The firmware creates this initial frame before its regular startup.
export const BIOS_PREPARED_ENTRY: Blua32PreparedEntry = {
	path: 'kernel/managed_reset', exportPathKey: 'enter', valueSlots: 8,
};

export const BIOS_USER_IRQ_ENTRY: Blua32StaticExport = {
	path: 'kernel/vblank_irq', exportPathKey: 'user_irq',
};

export const BIOS_EXCEPTION_BRIDGE: Blua32StaticExport = {
	path: 'kernel/exception_bridge', exportPathKey: 'enter',
};

export const BIOS_MANAGED_ENTRIES: readonly ManagedEntry[] = [
	{ symbol: 'protected_call', path: 'kernel/protected_call', callable: true },
	{ symbol: 'protected_xcall', path: 'kernel/protected_xcall', callable: true },
	{ symbol: 'protected_body', path: 'kernel/protected_body', callable: true },
	{ symbol: 'protected_failure', path: 'kernel/protected_failure' },
	{ symbol: 'protected_handler', path: 'kernel/protected_handler' },
	{ symbol: 'coroutine_resume', path: 'kernel/coroutine_resume' },
	{ symbol: 'coroutine_yield', path: 'kernel/coroutine_yield' },
	{ symbol: 'coroutine_yieldable', path: 'kernel/coroutine_yieldable', callable: true },
	{ symbol: 'coroutine_entry', path: 'kernel/coroutine_entry' },
];

export const SYSTEM_KERNEL_MODULES = [
	'kernel/heap_control_ids', 'kernel/heap_control_call', 'kernel/gc_collect_step', 'kernel/gc_full',
	'kernel/heap_floor', 'kernel/system_image_bind', 'kernel/thread_frame_storage',
	'kernel/bios_create_table', 'kernel/allocate_record',
	'kernel/bios_table_ids', 'kernel/bios_table_call', 'kernel/bios_copy_table', 'kernel/gc_barrier',
	'kernel/table_grow', 'kernel/set_global', 'kernel/set_global_entry', 'kernel/set_metatable', 'kernel/string_control_call', 'kernel/byte_string_input',
	'kernel/coroutine_control_ids', 'kernel/coroutine_control', 'kernel/coroutine_close',
	'kernel/thread_create', 'kernel/frame_upvalue',
	'kernel/dlmalloc', 'kernel/dlmalloc_record', 'kernel/gc_strings',
	'kernel/gc_control', 'kernel/gc_thread_compact', 'kernel/thread_retire', 'kernel/gc_objects', 'kernel/table_create',
	'kernel/gc_mark', 'kernel/gc_operand_roots', 'kernel/gc_capture_trace', 'kernel/gc_thread_trace', 'kernel/gc_table_head', 'kernel/gc_table_trace',
	'kernel/gc_table_mode', 'kernel/gc_weak_mode', 'kernel/string_record', 'kernel/image_string_bindings', 'kernel/gc_trace',
	'kernel/gc_weak_table', 'kernel/gc_weak_quantum', 'kernel/gc_remark', 'kernel/gc_root_banks',
	'kernel/closure_create', 'kernel/canonical_closure_index', 'kernel/table_reserve_growth', 'kernel/table_prepare_rebuild',
	'kernel/table_publish_growth', 'kernel/table_finish_resize', 'kernel/table_reinsert',
	'kernel/table_assignment', 'kernel/table_resize', 'kernel/table_plan', 'kernel/table_insert_existing',
	'kernel/allocate_captured_closure', 'kernel/closure_capture_create', 'kernel/gc_maintenance', 'kernel/gc_vblank', 'kernel/gc_step',
	'kernel/gc_mark_quantum', 'kernel/gc_atomic_quantum', 'kernel/gc_sweep_quantum', 'kernel/gc_epoch',
	'kernel/gc_runtime_layout', 'kernel/global_bank', 'kernel/gc_root_inputs', 'kernel/gc_pace', 'kernel/heap_admission', 'kernel/word_arithmetic', 'kernel/value_type',
	'kernel/allocate_string_slice', 'kernel/string_slice', 'kernel/string_char_bytes', 'kernel/number_bytes', 'kernel/boot_image_admission', 'kernel/gc_stopped_roots',
] as const;

export function assertSystemBlua32ImageFits(imageEndOffset: number): void {
	if (imageEndOffset > SYSTEM_BLUA32_IMAGE_LIMIT) {
		throw new Error(
			`System BLua32 image ends at ROM offset 0x${imageEndOffset.toString(16)}, `
			+ `beyond the program budget at 0x${SYSTEM_BLUA32_IMAGE_LIMIT.toString(16)}.`,
		);
	}
}
