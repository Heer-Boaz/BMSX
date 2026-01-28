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
export const DEFAULT_RAM_SIZE = 0x08000000; // 128 MB

export const IO_WORD_SIZE = 4;
export const IO_REGION_SIZE = 0x00004000; // 16 KB

export const DEFAULT_STRING_HANDLE_COUNT = 0x40000; // 256k handles
export const STRING_HANDLE_ENTRY_SIZE = 16;
export const DEFAULT_STRING_HEAP_SIZE = 0x02000000; // 32 MB
export const DEFAULT_ASSET_TABLE_SIZE = 0x00100000; // 1 MB
export const DEFAULT_VRAM_ATLAS_SLOT_SIZE = 0x01000000; // 16 MB
export const DEFAULT_VRAM_STAGING_SIZE = 0x00400000; // 4 MB

export let RAM_SIZE = DEFAULT_RAM_SIZE;
export let STRING_HANDLE_COUNT = DEFAULT_STRING_HANDLE_COUNT;
export let STRING_HANDLE_TABLE_SIZE = STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE;
export let STRING_HEAP_SIZE = DEFAULT_STRING_HEAP_SIZE;
export let ASSET_TABLE_SIZE = DEFAULT_ASSET_TABLE_SIZE;
export let VRAM_ATLAS_SLOT_SIZE = DEFAULT_VRAM_ATLAS_SLOT_SIZE;
export let VRAM_ENGINE_ATLAS_SLOT_SIZE = DEFAULT_VRAM_ATLAS_SLOT_SIZE;
export let VRAM_STAGING_SIZE = DEFAULT_VRAM_STAGING_SIZE;

export let IO_BASE = RAM_BASE;
export let STRING_HANDLE_TABLE_BASE = IO_BASE + IO_REGION_SIZE;
export let STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
export let ASSET_RAM_BASE = STRING_HEAP_BASE + STRING_HEAP_SIZE;
export let ASSET_TABLE_BASE = ASSET_RAM_BASE;
export let ASSET_DATA_BASE = ASSET_TABLE_BASE + ASSET_TABLE_SIZE;
export let ASSET_RAM_SIZE = RAM_SIZE - (ASSET_RAM_BASE - RAM_BASE);
export let ASSET_DATA_END = ASSET_RAM_BASE + ASSET_RAM_SIZE;
export let VRAM_SECONDARY_ATLAS_BASE = 0;
export let VRAM_PRIMARY_ATLAS_BASE = 0;
export let VRAM_ENGINE_ATLAS_BASE = 0;
export let VRAM_STAGING_BASE = 0;
export let VRAM_ENGINE_ATLAS_SIZE = 0;
export let VRAM_PRIMARY_ATLAS_SIZE = 0;
export let VRAM_SECONDARY_ATLAS_SIZE = 0;
export let ASSET_DATA_ALLOC_END = 0;
export let RAM_USED_END = RAM_BASE + RAM_SIZE;

export type MemoryMapLimits = {
	ram_bytes?: number;
	string_handle_count?: number;
	string_heap_bytes?: number;
	asset_table_bytes?: number;
	asset_data_bytes?: number;
	atlas_slot_bytes?: number;
	engine_atlas_slot_bytes?: number;
	staging_bytes?: number;
};

function resolvePositiveInteger(value: number, label: string): number {
	if (!Number.isFinite(value)) {
		throw new Error(`[MemoryMap] ${label} must be a finite number.`);
	}
	const resolved = Math.floor(value);
	if (resolved <= 0) {
		throw new Error(`[MemoryMap] ${label} must be greater than 0.`);
	}
	return resolved;
}

function recomputeMemoryLayout(config: {
	ramBytes: number;
	stringHandleCount: number;
	stringHeapBytes: number;
	assetTableBytes: number;
	assetDataBytes: number;
	atlasSlotBytes: number;
	engineAtlasSlotBytes: number;
	stagingBytes: number;
}): void {
	RAM_SIZE = config.ramBytes;
	STRING_HANDLE_COUNT = config.stringHandleCount;
	STRING_HANDLE_TABLE_SIZE = STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE;
	STRING_HEAP_SIZE = config.stringHeapBytes;
	ASSET_TABLE_SIZE = config.assetTableBytes;
	VRAM_ATLAS_SLOT_SIZE = config.atlasSlotBytes;
	VRAM_ENGINE_ATLAS_SLOT_SIZE = config.engineAtlasSlotBytes;
	VRAM_STAGING_SIZE = config.stagingBytes;

	IO_BASE = RAM_BASE;
	STRING_HANDLE_TABLE_BASE = IO_BASE + IO_REGION_SIZE;
	STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
	ASSET_RAM_BASE = STRING_HEAP_BASE + STRING_HEAP_SIZE;
	ASSET_TABLE_BASE = ASSET_RAM_BASE;
	ASSET_DATA_BASE = ASSET_TABLE_BASE + ASSET_TABLE_SIZE;
	ASSET_DATA_END = ASSET_DATA_BASE + config.assetDataBytes + VRAM_STAGING_SIZE + (VRAM_ATLAS_SLOT_SIZE * 2) + VRAM_ENGINE_ATLAS_SLOT_SIZE;
	ASSET_RAM_SIZE = ASSET_DATA_END - ASSET_RAM_BASE;

	VRAM_SECONDARY_ATLAS_BASE = ASSET_DATA_END - VRAM_ATLAS_SLOT_SIZE;
	VRAM_PRIMARY_ATLAS_BASE = VRAM_SECONDARY_ATLAS_BASE - VRAM_ATLAS_SLOT_SIZE;
	VRAM_ENGINE_ATLAS_BASE = VRAM_PRIMARY_ATLAS_BASE - VRAM_ENGINE_ATLAS_SLOT_SIZE;
	VRAM_STAGING_BASE = VRAM_ENGINE_ATLAS_BASE - VRAM_STAGING_SIZE;
	VRAM_ENGINE_ATLAS_SIZE = VRAM_ENGINE_ATLAS_SLOT_SIZE;
	VRAM_PRIMARY_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	VRAM_SECONDARY_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	ASSET_DATA_ALLOC_END = VRAM_STAGING_BASE;
	if (ASSET_DATA_ALLOC_END < ASSET_DATA_BASE) {
		throw new Error(`[MemoryMap] VRAM layout exceeds asset RAM (${ASSET_DATA_ALLOC_END} < ${ASSET_DATA_BASE}).`);
	}
	RAM_USED_END = RAM_BASE + RAM_SIZE;
}

export function configureMemoryMap(limits?: MemoryMapLimits): void {
	const stringHandleCount = resolvePositiveInteger(limits?.string_handle_count ?? DEFAULT_STRING_HANDLE_COUNT, 'string_handle_count');
	const stringHeapBytes = resolvePositiveInteger(limits?.string_heap_bytes ?? DEFAULT_STRING_HEAP_SIZE, 'string_heap_bytes');
	const assetTableBytes = resolvePositiveInteger(limits?.asset_table_bytes ?? DEFAULT_ASSET_TABLE_SIZE, 'asset_table_bytes');
	const atlasSlotBytes = resolvePositiveInteger(limits?.atlas_slot_bytes ?? DEFAULT_VRAM_ATLAS_SLOT_SIZE, 'atlas_slot_bytes');
	const engineAtlasSlotBytes = resolvePositiveInteger(limits?.engine_atlas_slot_bytes ?? atlasSlotBytes, 'engine_atlas_slot_bytes');
	const stagingBytes = resolvePositiveInteger(limits?.staging_bytes ?? DEFAULT_VRAM_STAGING_SIZE, 'staging_bytes');
	const stringHandleTableBytes = stringHandleCount * STRING_HANDLE_ENTRY_SIZE;
	const defaultAssetDataBytes = DEFAULT_RAM_SIZE
		- (IO_REGION_SIZE + stringHandleTableBytes + stringHeapBytes + assetTableBytes + stagingBytes + (atlasSlotBytes * 2) + engineAtlasSlotBytes);
	const assetDataBytes = resolvePositiveInteger(limits?.asset_data_bytes ?? defaultAssetDataBytes, 'asset_data_bytes');
	const computedRamBytes = IO_REGION_SIZE
		+ stringHandleTableBytes
		+ stringHeapBytes
		+ assetTableBytes
		+ assetDataBytes
		+ stagingBytes
		+ (atlasSlotBytes * 2)
		+ engineAtlasSlotBytes;
	if (limits?.ram_bytes !== undefined) {
		const ramBytes = resolvePositiveInteger(limits.ram_bytes, 'ram_bytes');
		if (ramBytes !== computedRamBytes) {
			throw new Error(`[MemoryMap] ram_bytes mismatch (${ramBytes} != ${computedRamBytes}).`);
		}
		recomputeMemoryLayout({
			ramBytes,
			stringHandleCount,
			stringHeapBytes,
			assetTableBytes,
			assetDataBytes,
			atlasSlotBytes,
			engineAtlasSlotBytes,
			stagingBytes,
		});
		return;
	}
	recomputeMemoryLayout({
		ramBytes: computedRamBytes,
		stringHandleCount,
		stringHeapBytes,
		assetTableBytes,
		assetDataBytes,
		atlasSlotBytes,
		engineAtlasSlotBytes,
		stagingBytes,
	});
}

configureMemoryMap();
