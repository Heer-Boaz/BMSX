export const ADDRESS_BITS = 32;

export const ENGINE_ROM_BASE = 0x00000000;
export const ENGINE_ROM_SIZE = 0x01000000; // 16 MB

export const CART_ROM_BASE = 0x01000000;
export const CART_ROM_SIZE = 0x05000000; // 80 MB
export const CART_ROM_MAGIC_OFFSET = 0x00000000;
export const CART_ROM_MAGIC_ADDR = CART_ROM_BASE + CART_ROM_MAGIC_OFFSET;

export const OVERLAY_ROM_BASE = 0x06000000;
export const OVERLAY_ROM_SIZE = 0x02000000; // 32 MB

export const RAM_BASE = 0x08000000;
export const RAM_SIZE = 0x08000000; // 128 MB

export const IO_WORD_SIZE = 4;
export const IO_REGION_SIZE = 0x00004000; // 16 KB

export const STRING_HANDLE_COUNT = 0x40000; // 256k handles
export const STRING_HANDLE_ENTRY_SIZE = 16;
export const STRING_HANDLE_TABLE_SIZE = STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE;
export const ENGINE_STRING_HANDLE_LIMIT = 0x8000; // 32k reserved for engine/system

export const STRING_HEAP_SIZE = 0x02000000; // 32 MB

export const IO_BASE = RAM_BASE;
export const STRING_HANDLE_TABLE_BASE = IO_BASE + IO_REGION_SIZE;
export const STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
export const ASSET_RAM_BASE = STRING_HEAP_BASE + STRING_HEAP_SIZE;
export const ASSET_RAM_SIZE = RAM_SIZE - (ASSET_RAM_BASE - RAM_BASE);
export const ASSET_TABLE_BASE = ASSET_RAM_BASE;
export const ASSET_TABLE_SIZE = 0x00100000; // 1 MB
export const ASSET_DATA_BASE = ASSET_TABLE_BASE + ASSET_TABLE_SIZE;
export const ASSET_DATA_END = ASSET_RAM_BASE + ASSET_RAM_SIZE;
const DEFAULT_VRAM_ATLAS_SLOT_SIZE = 0x01000000; // 16 MB
const DEFAULT_VRAM_STAGING_SIZE = 0x00400000; // 4 MB

export let VRAM_ATLAS_SLOT_SIZE = DEFAULT_VRAM_ATLAS_SLOT_SIZE;
export let VRAM_STAGING_SIZE = DEFAULT_VRAM_STAGING_SIZE;
export let VRAM_SECONDARY_ATLAS_BASE = 0;
export let VRAM_PRIMARY_ATLAS_BASE = 0;
export let VRAM_ENGINE_ATLAS_BASE = 0;
export let VRAM_STAGING_BASE = 0;
export let VRAM_ENGINE_ATLAS_SIZE = 0;
export let VRAM_PRIMARY_ATLAS_SIZE = 0;
export let VRAM_SECONDARY_ATLAS_SIZE = 0;
export let ASSET_DATA_ALLOC_END = 0;

function recomputeVramLayout(): void {
	VRAM_SECONDARY_ATLAS_BASE = ASSET_DATA_END - VRAM_ATLAS_SLOT_SIZE;
	VRAM_PRIMARY_ATLAS_BASE = VRAM_SECONDARY_ATLAS_BASE - VRAM_ATLAS_SLOT_SIZE;
	VRAM_ENGINE_ATLAS_BASE = VRAM_PRIMARY_ATLAS_BASE - VRAM_ATLAS_SLOT_SIZE;
	VRAM_STAGING_BASE = VRAM_ENGINE_ATLAS_BASE - VRAM_STAGING_SIZE;
	VRAM_ENGINE_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	VRAM_PRIMARY_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	VRAM_SECONDARY_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	ASSET_DATA_ALLOC_END = VRAM_STAGING_BASE;
	if (ASSET_DATA_ALLOC_END < ASSET_DATA_BASE) {
		throw new Error(`[MemoryMap] VRAM layout exceeds asset RAM (${ASSET_DATA_ALLOC_END} < ${ASSET_DATA_BASE}).`);
	}
}

export function configureMemoryMap(limits?: { atlas_slot_bytes?: number; staging_bytes?: number; }): void {
	if (limits && limits.atlas_slot_bytes !== undefined) {
		if (!Number.isFinite(limits.atlas_slot_bytes)) {
			throw new Error('[MemoryMap] atlas_slot_bytes must be a finite number.');
		}
		const value = Math.floor(limits.atlas_slot_bytes);
		if (value <= 0) {
			throw new Error('[MemoryMap] atlas_slot_bytes must be greater than 0.');
		}
		VRAM_ATLAS_SLOT_SIZE = value;
	} else {
		VRAM_ATLAS_SLOT_SIZE = DEFAULT_VRAM_ATLAS_SLOT_SIZE;
	}
	if (limits && limits.staging_bytes !== undefined) {
		if (!Number.isFinite(limits.staging_bytes)) {
			throw new Error('[MemoryMap] staging_bytes must be a finite number.');
		}
		const value = Math.floor(limits.staging_bytes);
		if (value <= 0) {
			throw new Error('[MemoryMap] staging_bytes must be greater than 0.');
		}
		VRAM_STAGING_SIZE = value;
	} else {
		VRAM_STAGING_SIZE = DEFAULT_VRAM_STAGING_SIZE;
	}
	recomputeVramLayout();
}

recomputeVramLayout();
export const RAM_USED_END = RAM_BASE + RAM_SIZE;
