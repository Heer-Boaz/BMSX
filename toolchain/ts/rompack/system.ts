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

export function assertSystemBlua32ImageFits(imageEndOffset: number): void {
	if (imageEndOffset > SYSTEM_BLUA32_IMAGE_LIMIT) {
		throw new Error(
			`System BLua32 image ends at ROM offset 0x${imageEndOffset.toString(16)}, `
			+ `beyond the program budget at 0x${SYSTEM_BLUA32_IMAGE_LIMIT.toString(16)}.`,
		);
	}
}
