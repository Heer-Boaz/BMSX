import { SKYBOX_FACE_DEFAULT_SIZE } from '../rompack/rompack';

export const ADDRESS_BITS = 32;

export const SYSTEM_ROM_BASE = 0x00000000;
export const SYSTEM_ROM_SIZE = 0x01000000; // 16 MB

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
export const VDP_OAM_SLOT_COUNT = 5000;
export const VDP_OAM_ENTRY_WORDS = 18;
export const VDP_OAM_ENTRY_BYTES = VDP_OAM_ENTRY_WORDS * IO_WORD_SIZE;
export const VDP_OAM_BUFFER_SIZE = VDP_OAM_SLOT_COUNT * VDP_OAM_ENTRY_BYTES;
export const VDP_OAM_RAM_SIZE = VDP_OAM_BUFFER_SIZE * 2;
export const VDP_BGMAP_LAYER_COUNT = 2;
export const VDP_BGMAP_HEADER_WORDS = 11;
export const VDP_BGMAP_HEADER_BYTES = VDP_BGMAP_HEADER_WORDS * IO_WORD_SIZE;
export const VDP_BGMAP_ENTRY_WORDS = 7;
export const VDP_BGMAP_ENTRY_BYTES = VDP_BGMAP_ENTRY_WORDS * IO_WORD_SIZE;
export const VDP_BGMAP_TILE_CAPACITY = 4096;
export const VDP_BGMAP_LAYER_SIZE = VDP_BGMAP_HEADER_BYTES + VDP_BGMAP_TILE_CAPACITY * VDP_BGMAP_ENTRY_BYTES;
export const VDP_BGMAP_BUFFER_SIZE = VDP_BGMAP_LAYER_COUNT * VDP_BGMAP_LAYER_SIZE;
export const VDP_BGMAP_RAM_SIZE = VDP_BGMAP_BUFFER_SIZE * 2;
export const VDP_PAT_HEADER_WORDS = 2;
export const VDP_PAT_HEADER_BYTES = VDP_PAT_HEADER_WORDS * IO_WORD_SIZE;
export const VDP_PAT_ENTRY_WORDS = 17;
export const VDP_PAT_ENTRY_BYTES = VDP_PAT_ENTRY_WORDS * IO_WORD_SIZE;
export const VDP_PAT_CAPACITY = 16384;
export const VDP_PAT_BUFFER_SIZE = VDP_PAT_HEADER_BYTES + VDP_PAT_CAPACITY * VDP_PAT_ENTRY_BYTES;
export const VDP_PAT_RAM_SIZE = VDP_PAT_BUFFER_SIZE * 2;

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
export let VRAM_SYSTEM_ATLAS_SLOT_SIZE = DEFAULT_VRAM_ATLAS_SLOT_SIZE;
export let VRAM_STAGING_SIZE = DEFAULT_VRAM_STAGING_SIZE;

export let IO_BASE = RAM_BASE;
export let VDP_OAM_FRONT_BASE = IO_BASE + IO_REGION_SIZE;
export let VDP_OAM_BACK_BASE = VDP_OAM_FRONT_BASE + VDP_OAM_BUFFER_SIZE;
export let VDP_BGMAP_FRONT_BASE = VDP_OAM_BACK_BASE + VDP_OAM_BUFFER_SIZE;
export let VDP_BGMAP_BACK_BASE = VDP_BGMAP_FRONT_BASE + VDP_BGMAP_BUFFER_SIZE;
export let VDP_PAT_FRONT_BASE = VDP_BGMAP_BACK_BASE + VDP_BGMAP_BUFFER_SIZE;
export let VDP_PAT_BACK_BASE = VDP_PAT_FRONT_BASE + VDP_PAT_BUFFER_SIZE;
export let STRING_HANDLE_TABLE_BASE = VDP_PAT_BACK_BASE + VDP_PAT_BUFFER_SIZE;
export let STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
export let ASSET_RAM_BASE = STRING_HEAP_BASE + STRING_HEAP_SIZE;
export let ASSET_TABLE_BASE = ASSET_RAM_BASE;
export let ASSET_DATA_BASE = ASSET_TABLE_BASE + ASSET_TABLE_SIZE;
export let ASSET_RAM_SIZE = RAM_SIZE - (ASSET_RAM_BASE - RAM_BASE);
export let ASSET_DATA_END = ASSET_RAM_BASE + ASSET_RAM_SIZE;
export let VRAM_SECONDARY_ATLAS_BASE = 0;
export let VRAM_PRIMARY_ATLAS_BASE = 0;
export let VRAM_SYSTEM_ATLAS_BASE = 0;
export let VRAM_STAGING_BASE = 0;
export let VRAM_SKYBOX_BASE = 0;
export let VRAM_SKYBOX_FACE_BYTES = 0;
export let VRAM_SKYBOX_SIZE = 0;
export let VRAM_SKYBOX_POSX_BASE = 0;
export let VRAM_SKYBOX_NEGX_BASE = 0;
export let VRAM_SKYBOX_POSY_BASE = 0;
export let VRAM_SKYBOX_NEGY_BASE = 0;
export let VRAM_SKYBOX_POSZ_BASE = 0;
export let VRAM_SKYBOX_NEGZ_BASE = 0;
export let VRAM_SYSTEM_ATLAS_SIZE = 0;
export let VRAM_PRIMARY_ATLAS_SIZE = 0;
export let VRAM_SECONDARY_ATLAS_SIZE = 0;
export let ASSET_DATA_ALLOC_END = 0;
export let RAM_USED_END = RAM_BASE + RAM_SIZE;

export type MemoryMapSpecs = {
	ram_bytes?: number;
	string_handle_count?: number;
	string_heap_bytes?: number;
	asset_table_bytes?: number;
	asset_data_bytes?: number;
	atlas_slot_bytes?: number;
	system_atlas_slot_bytes?: number;
	staging_bytes?: number;
	skybox_face_size?: number;
	skybox_face_bytes?: number;
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

function resolveNonNegativeInteger(value: number, label: string): number {
	if (!Number.isFinite(value)) {
		throw new Error(`[MemoryMap] ${label} must be a finite number.`);
	}
	const resolved = Math.floor(value);
	if (resolved < 0) {
		throw new Error(`[MemoryMap] ${label} must be greater than or equal to 0.`);
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
	skyboxFaceBytes: number;
}): void {
	RAM_SIZE = config.ramBytes;
	STRING_HANDLE_COUNT = config.stringHandleCount;
	STRING_HANDLE_TABLE_SIZE = STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE;
	STRING_HEAP_SIZE = config.stringHeapBytes;
	ASSET_TABLE_SIZE = config.assetTableBytes;
	VRAM_ATLAS_SLOT_SIZE = config.atlasSlotBytes;
	VRAM_SYSTEM_ATLAS_SLOT_SIZE = config.engineAtlasSlotBytes;
	VRAM_STAGING_SIZE = config.stagingBytes;

	IO_BASE = RAM_BASE;
	VDP_OAM_FRONT_BASE = IO_BASE + IO_REGION_SIZE;
	VDP_OAM_BACK_BASE = VDP_OAM_FRONT_BASE + VDP_OAM_BUFFER_SIZE;
	VDP_BGMAP_FRONT_BASE = VDP_OAM_BACK_BASE + VDP_OAM_BUFFER_SIZE;
	VDP_BGMAP_BACK_BASE = VDP_BGMAP_FRONT_BASE + VDP_BGMAP_BUFFER_SIZE;
	VDP_PAT_FRONT_BASE = VDP_BGMAP_BACK_BASE + VDP_BGMAP_BUFFER_SIZE;
	VDP_PAT_BACK_BASE = VDP_PAT_FRONT_BASE + VDP_PAT_BUFFER_SIZE;
	STRING_HANDLE_TABLE_BASE = VDP_PAT_BACK_BASE + VDP_PAT_BUFFER_SIZE;
	STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
	ASSET_RAM_BASE = STRING_HEAP_BASE + STRING_HEAP_SIZE;
	ASSET_TABLE_BASE = ASSET_RAM_BASE;
	ASSET_DATA_BASE = ASSET_TABLE_BASE + ASSET_TABLE_SIZE;
	ASSET_DATA_END = ASSET_DATA_BASE + config.assetDataBytes;
	ASSET_RAM_SIZE = ASSET_DATA_END - ASSET_RAM_BASE;

	VRAM_STAGING_BASE = ASSET_DATA_END;
	VRAM_SKYBOX_FACE_BYTES = config.skyboxFaceBytes;
	VRAM_SKYBOX_SIZE = VRAM_SKYBOX_FACE_BYTES * 6;
	VRAM_SKYBOX_BASE = VRAM_STAGING_BASE + VRAM_STAGING_SIZE;
	VRAM_SKYBOX_POSX_BASE = VRAM_SKYBOX_BASE;
	VRAM_SKYBOX_NEGX_BASE = VRAM_SKYBOX_POSX_BASE + VRAM_SKYBOX_FACE_BYTES;
	VRAM_SKYBOX_POSY_BASE = VRAM_SKYBOX_NEGX_BASE + VRAM_SKYBOX_FACE_BYTES;
	VRAM_SKYBOX_NEGY_BASE = VRAM_SKYBOX_POSY_BASE + VRAM_SKYBOX_FACE_BYTES;
	VRAM_SKYBOX_POSZ_BASE = VRAM_SKYBOX_NEGY_BASE + VRAM_SKYBOX_FACE_BYTES;
	VRAM_SKYBOX_NEGZ_BASE = VRAM_SKYBOX_POSZ_BASE + VRAM_SKYBOX_FACE_BYTES;
	VRAM_SYSTEM_ATLAS_BASE = VRAM_SKYBOX_BASE + VRAM_SKYBOX_SIZE;
	VRAM_PRIMARY_ATLAS_BASE = VRAM_SYSTEM_ATLAS_BASE + VRAM_SYSTEM_ATLAS_SLOT_SIZE;
	VRAM_SECONDARY_ATLAS_BASE = VRAM_PRIMARY_ATLAS_BASE + VRAM_ATLAS_SLOT_SIZE;
	VRAM_SYSTEM_ATLAS_SIZE = VRAM_SYSTEM_ATLAS_SLOT_SIZE;
	VRAM_PRIMARY_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	VRAM_SECONDARY_ATLAS_SIZE = VRAM_ATLAS_SLOT_SIZE;
	ASSET_DATA_ALLOC_END = ASSET_DATA_END;
	RAM_USED_END = ASSET_DATA_END;
}

export function configureMemoryMap(specs?: MemoryMapSpecs): void {
	const stringHandleCount = resolvePositiveInteger(specs?.string_handle_count ?? DEFAULT_STRING_HANDLE_COUNT, 'string_handle_count');
	const stringHeapBytes = resolvePositiveInteger(specs?.string_heap_bytes ?? DEFAULT_STRING_HEAP_SIZE, 'string_heap_bytes');
	const assetTableBytes = resolvePositiveInteger(specs?.asset_table_bytes ?? DEFAULT_ASSET_TABLE_SIZE, 'asset_table_bytes');
	const atlasSlotBytes = resolvePositiveInteger(specs?.atlas_slot_bytes ?? DEFAULT_VRAM_ATLAS_SLOT_SIZE, 'atlas_slot_bytes');
	const engineAtlasSlotBytes = resolvePositiveInteger(specs?.system_atlas_slot_bytes ?? atlasSlotBytes, 'system_atlas_slot_bytes');
	const stagingBytes = resolvePositiveInteger(specs?.staging_bytes ?? DEFAULT_VRAM_STAGING_SIZE, 'staging_bytes');
	const skyboxFaceBytes = specs?.skybox_face_bytes !== undefined
		? resolvePositiveInteger(specs.skybox_face_bytes, 'skybox_face_bytes')
		: (() => {
			const skyboxFaceSize = resolvePositiveInteger(specs?.skybox_face_size ?? SKYBOX_FACE_DEFAULT_SIZE, 'skybox_face_size');
			return skyboxFaceSize * skyboxFaceSize * 4;
		})();
	const stringHandleTableBytes = stringHandleCount * STRING_HANDLE_ENTRY_SIZE;
	const defaultAssetDataBytes = DEFAULT_RAM_SIZE
		- (IO_REGION_SIZE + VDP_OAM_RAM_SIZE + stringHandleTableBytes + stringHeapBytes + assetTableBytes);
	const assetDataBytes = resolveNonNegativeInteger(specs?.asset_data_bytes ?? defaultAssetDataBytes, 'asset_data_bytes');
	const computedRamBytes = IO_REGION_SIZE
		+ stringHandleTableBytes
		+ stringHeapBytes
		+ assetTableBytes
		+ assetDataBytes;
	if (specs?.ram_bytes !== undefined) {
		const ramBytes = resolvePositiveInteger(specs.ram_bytes, 'ram_bytes');
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
			skyboxFaceBytes,
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
		skyboxFaceBytes,
	});
}

configureMemoryMap();
