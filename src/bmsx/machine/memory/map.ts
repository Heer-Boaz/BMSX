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

export const PROGRAM_ROM_BASE = 0x10000000;
export const PROGRAM_ROM_SIZE = 0x01000000; // 16 MB
export const IO_WORD_SIZE = 4;
export const CART_PROGRAM_START_OFFSET = 0x00080000;
export const CART_PROGRAM_START_ADDR = PROGRAM_ROM_BASE + CART_PROGRAM_START_OFFSET;
export const CART_PROGRAM_VECTOR_OFFSET = CART_PROGRAM_START_OFFSET - IO_WORD_SIZE;
export const CART_PROGRAM_VECTOR_ADDR = PROGRAM_ROM_BASE + CART_PROGRAM_VECTOR_OFFSET;

export const IO_REGION_SIZE = 0x00040000; // 256 KB

export const DEFAULT_STRING_HANDLE_COUNT = 0x40000; // 256k handles
export const STRING_HANDLE_ENTRY_SIZE = 16;
export const DEFAULT_STRING_HEAP_SIZE = 0x02000000; // 32 MB
export const DEFAULT_GEO_SCRATCH_SIZE = 0x00080000; // 512 KB
export const DEFAULT_VRAM_IMAGE_SLOT_SIZE = 0x01000000; // 16 MB
export const DEFAULT_VRAM_STAGING_SIZE = 0x00400000; // 4 MB
export const DEFAULT_VRAM_FRAMEBUFFER_SIZE = 256 * 212 * 4;
export const VDP_CMD_ARG_COUNT = 18;
export const VDP_STREAM_CAPACITY_WORDS = 16384;
export const VDP_STREAM_BUFFER_SIZE = VDP_STREAM_CAPACITY_WORDS * IO_WORD_SIZE;

export let RAM_SIZE = DEFAULT_RAM_SIZE;
export let STRING_HANDLE_COUNT = DEFAULT_STRING_HANDLE_COUNT;
export let STRING_HANDLE_TABLE_SIZE = STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE;
export let STRING_HEAP_SIZE = DEFAULT_STRING_HEAP_SIZE;
export let VRAM_IMAGE_SLOT_SIZE = DEFAULT_VRAM_IMAGE_SLOT_SIZE;
export let VRAM_STAGING_SIZE = DEFAULT_VRAM_STAGING_SIZE;
export let VRAM_FRAMEBUFFER_SIZE = DEFAULT_VRAM_FRAMEBUFFER_SIZE;

export let IO_BASE = RAM_BASE;
export let STRING_HANDLE_TABLE_BASE = IO_BASE + IO_REGION_SIZE;
export let STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
export let GEO_SCRATCH_BASE = 0;
export let GEO_SCRATCH_SIZE = DEFAULT_GEO_SCRATCH_SIZE;
export let VDP_STREAM_BUFFER_BASE = 0;
export let VRAM_SECONDARY_SLOT_BASE = 0;
export let VRAM_PRIMARY_SLOT_BASE = 0;
export let VRAM_SYSTEM_SLOT_BASE = 0;
export let VRAM_STAGING_BASE = 0;
export let VRAM_FRAMEBUFFER_BASE = 0;
export let VRAM_SYSTEM_SLOT_SIZE = 0;
export let VRAM_PRIMARY_SLOT_SIZE = 0;
export let VRAM_SECONDARY_SLOT_SIZE = 0;
export let RAM_USED_END = RAM_BASE + RAM_SIZE;

export type MemoryMapSpecs = {
	ram_bytes?: number;
	string_handle_count?: number;
	string_heap_bytes?: number;
	slot_bytes?: number;
	system_slot_bytes?: number;
	staging_bytes?: number;
	framebuffer_bytes?: number;
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

export function alignUp(value: number, alignment: number): number {
	const mask = alignment - 1;
	return (value + mask) & ~mask;
}

export function isVramMappedRange(addr: number, length: number): boolean {
	if (length <= 0) {
		return false;
	}
	const end = addr + length;
	const overlaps = (base: number, size: number): boolean => addr < base + size && end > base;
	return overlaps(VRAM_STAGING_BASE, VRAM_STAGING_SIZE)
		|| overlaps(VRAM_SYSTEM_SLOT_BASE, VRAM_SYSTEM_SLOT_SIZE)
		|| overlaps(VRAM_PRIMARY_SLOT_BASE, VRAM_PRIMARY_SLOT_SIZE)
		|| overlaps(VRAM_SECONDARY_SLOT_BASE, VRAM_SECONDARY_SLOT_SIZE)
		|| overlaps(VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE);
}

function recomputeMemoryLayout(config: {
	ramBytes: number;
	stringHandleCount: number;
	stringHeapBytes: number;
	slotBytes: number;
	systemSlotBytes: number;
	stagingBytes: number;
	frameBufferBytes: number;
}): void {
	RAM_SIZE = config.ramBytes;
	STRING_HANDLE_COUNT = config.stringHandleCount;
	STRING_HANDLE_TABLE_SIZE = STRING_HANDLE_COUNT * STRING_HANDLE_ENTRY_SIZE;
	STRING_HEAP_SIZE = config.stringHeapBytes;
	VRAM_IMAGE_SLOT_SIZE = config.slotBytes;
	VRAM_SYSTEM_SLOT_SIZE = config.systemSlotBytes;
	VRAM_STAGING_SIZE = config.stagingBytes;
	VRAM_FRAMEBUFFER_SIZE = config.frameBufferBytes;

	IO_BASE = RAM_BASE;
	STRING_HANDLE_TABLE_BASE = IO_BASE + IO_REGION_SIZE;
	STRING_HEAP_BASE = STRING_HANDLE_TABLE_BASE + STRING_HANDLE_TABLE_SIZE;
	GEO_SCRATCH_BASE = alignUp(STRING_HEAP_BASE + STRING_HEAP_SIZE, IO_WORD_SIZE);
	GEO_SCRATCH_SIZE = DEFAULT_GEO_SCRATCH_SIZE;
	VDP_STREAM_BUFFER_BASE = GEO_SCRATCH_BASE + GEO_SCRATCH_SIZE;

	VRAM_STAGING_BASE = VDP_STREAM_BUFFER_BASE + VDP_STREAM_BUFFER_SIZE;
	VRAM_SYSTEM_SLOT_BASE = VRAM_STAGING_BASE + VRAM_STAGING_SIZE;
	VRAM_PRIMARY_SLOT_BASE = VRAM_SYSTEM_SLOT_BASE + config.systemSlotBytes;
	VRAM_SECONDARY_SLOT_BASE = VRAM_PRIMARY_SLOT_BASE + VRAM_IMAGE_SLOT_SIZE;
	VRAM_FRAMEBUFFER_BASE = VRAM_SECONDARY_SLOT_BASE + VRAM_IMAGE_SLOT_SIZE;
	VRAM_SYSTEM_SLOT_SIZE = config.systemSlotBytes;
	VRAM_PRIMARY_SLOT_SIZE = VRAM_IMAGE_SLOT_SIZE;
	VRAM_SECONDARY_SLOT_SIZE = VRAM_IMAGE_SLOT_SIZE;
	RAM_USED_END = VDP_STREAM_BUFFER_BASE + VDP_STREAM_BUFFER_SIZE;
}

export function configureMemoryMap(specs?: MemoryMapSpecs): void {
	const ramBytes = specs?.ram_bytes === undefined
		? undefined
		: resolvePositiveInteger(specs.ram_bytes, 'ram_bytes');
	const stringHandleCount = resolvePositiveInteger(specs?.string_handle_count ?? DEFAULT_STRING_HANDLE_COUNT, 'string_handle_count');
	const stringHeapBytes = resolvePositiveInteger(specs?.string_heap_bytes ?? DEFAULT_STRING_HEAP_SIZE, 'string_heap_bytes');
	const slotBytes = resolvePositiveInteger(specs?.slot_bytes ?? DEFAULT_VRAM_IMAGE_SLOT_SIZE, 'slot_bytes');
	const systemSlotBytes = resolvePositiveInteger(specs?.system_slot_bytes ?? slotBytes, 'system_slot_bytes');
	const stagingBytes = resolvePositiveInteger(specs?.staging_bytes ?? DEFAULT_VRAM_STAGING_SIZE, 'staging_bytes');
	const frameBufferBytes = resolvePositiveInteger(specs?.framebuffer_bytes ?? DEFAULT_VRAM_FRAMEBUFFER_SIZE, 'framebuffer_bytes');
	const stringHandleTableBytes = stringHandleCount * STRING_HANDLE_ENTRY_SIZE;
	const runtimeRamBaseOffset = IO_REGION_SIZE
		+ stringHandleTableBytes
		+ stringHeapBytes;
	const runtimeRamBasePadding = alignUp(runtimeRamBaseOffset, IO_WORD_SIZE) - runtimeRamBaseOffset;
	const fixedRamBytes = runtimeRamBaseOffset
		+ runtimeRamBasePadding
		+ DEFAULT_GEO_SCRATCH_SIZE
		+ VDP_STREAM_BUFFER_SIZE;
	const computedRamBytes = fixedRamBytes;
	if (ramBytes !== undefined) {
		if (ramBytes < computedRamBytes) {
			throw new Error(`[MemoryMap] ram_bytes (${ramBytes}) must be at least ${computedRamBytes}.`);
		}
		recomputeMemoryLayout({
			ramBytes,
			stringHandleCount,
			stringHeapBytes,
			slotBytes,
			systemSlotBytes,
			stagingBytes,
			frameBufferBytes,
		});
		return;
	}
	recomputeMemoryLayout({
		ramBytes: computedRamBytes,
		stringHandleCount,
		stringHeapBytes,
		slotBytes,
		systemSlotBytes,
		stagingBytes,
		frameBufferBytes,
	});
}

configureMemoryMap();
