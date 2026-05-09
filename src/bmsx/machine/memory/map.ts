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
export const MAX_RAM_SIZE = 0x08000000; // 128 MB address window
export const DEFAULT_RAM_SIZE = 0x00400000; // 4 MB

export const PROGRAM_ROM_BASE = 0x10000000;
export const PROGRAM_ROM_SIZE = 0x01000000; // 16 MB
export const IO_WORD_SIZE = 4;
export const CART_PROGRAM_START_OFFSET = 0x00080000;
export const CART_PROGRAM_START_ADDR = PROGRAM_ROM_BASE + CART_PROGRAM_START_OFFSET;
export const CART_PROGRAM_VECTOR_OFFSET = CART_PROGRAM_START_OFFSET - IO_WORD_SIZE;
export const CART_PROGRAM_VECTOR_ADDR = PROGRAM_ROM_BASE + CART_PROGRAM_VECTOR_OFFSET;

export const IO_REGION_SIZE = 0x00040000; // 256 KB

export const DEFAULT_GEO_SCRATCH_SIZE = 0x00080000; // 512 KB
export const DEFAULT_VRAM_IMAGE_SLOT_SIZE = 0x01000000; // 16 MB
export const DEFAULT_VRAM_STAGING_SIZE = 0x00400000; // 4 MB
export const DEFAULT_VRAM_FRAMEBUFFER_SIZE = 256 * 212 * 4;
export const VDP_CMD_ARG_COUNT = 19;
export const VDP_STREAM_CAPACITY_WORDS = 16384;
export const VDP_STREAM_BUFFER_SIZE = VDP_STREAM_CAPACITY_WORDS * IO_WORD_SIZE;
export const MIN_RAM_SIZE = IO_REGION_SIZE
	+ DEFAULT_GEO_SCRATCH_SIZE
	+ VDP_STREAM_BUFFER_SIZE;
export const BASE_RAM_USED_SIZE = DEFAULT_GEO_SCRATCH_SIZE
	+ VDP_STREAM_BUFFER_SIZE;
export const VRAM_BASE = PROGRAM_ROM_BASE + PROGRAM_ROM_SIZE;

export let RAM_SIZE = DEFAULT_RAM_SIZE;
export let VRAM_IMAGE_SLOT_SIZE = DEFAULT_VRAM_IMAGE_SLOT_SIZE;
export let VRAM_STAGING_SIZE = DEFAULT_VRAM_STAGING_SIZE;
export let VRAM_FRAMEBUFFER_SIZE = DEFAULT_VRAM_FRAMEBUFFER_SIZE;

export const IO_BASE = RAM_BASE;
export const GEO_SCRATCH_BASE = IO_BASE + IO_REGION_SIZE;
export const GEO_SCRATCH_SIZE = DEFAULT_GEO_SCRATCH_SIZE;
export const VDP_STREAM_BUFFER_BASE = GEO_SCRATCH_BASE + GEO_SCRATCH_SIZE;
export let VRAM_SECONDARY_SLOT_BASE = 0;
export let VRAM_PRIMARY_SLOT_BASE = 0;
export let VRAM_SYSTEM_SLOT_BASE = 0;
export let VRAM_STAGING_BASE = 0;
export let VRAM_FRAMEBUFFER_BASE = 0;
export let VRAM_SYSTEM_SLOT_SIZE = 0;
export let VRAM_PRIMARY_SLOT_SIZE = 0;
export let VRAM_SECONDARY_SLOT_SIZE = 0;
export let RAM_END = RAM_BASE + RAM_SIZE;

export type MemoryMapSpecs = {
	ram_bytes?: number;
	slot_bytes?: number;
	system_slot_bytes?: number;
	staging_bytes?: number;
	framebuffer_bytes?: number;
};

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

export function isVramMappedContiguousRange(addr: number, length: number): boolean {
	if (length <= 0) {
		return false;
	}
	const contained = (base: number, size: number): boolean => addr >= base && addr + length <= base + size;
	return contained(VRAM_STAGING_BASE, VRAM_STAGING_SIZE)
		|| contained(VRAM_SYSTEM_SLOT_BASE, VRAM_SYSTEM_SLOT_SIZE)
		|| contained(VRAM_PRIMARY_SLOT_BASE, VRAM_PRIMARY_SLOT_SIZE)
		|| contained(VRAM_SECONDARY_SLOT_BASE, VRAM_SECONDARY_SLOT_SIZE)
		|| contained(VRAM_FRAMEBUFFER_BASE, VRAM_FRAMEBUFFER_SIZE);
}

function recomputeMemoryLayout(config: {
	ramBytes: number;
	slotBytes: number;
	systemSlotBytes: number;
	stagingBytes: number;
	frameBufferBytes: number;
}): void {
	RAM_SIZE = config.ramBytes;
	VRAM_IMAGE_SLOT_SIZE = config.slotBytes;
	VRAM_SYSTEM_SLOT_SIZE = config.systemSlotBytes;
	VRAM_STAGING_SIZE = config.stagingBytes;
	VRAM_FRAMEBUFFER_SIZE = config.frameBufferBytes;

	RAM_END = RAM_BASE + RAM_SIZE;

	VRAM_STAGING_BASE = VRAM_BASE;
	VRAM_SYSTEM_SLOT_BASE = VRAM_STAGING_BASE + VRAM_STAGING_SIZE;
	VRAM_PRIMARY_SLOT_BASE = VRAM_SYSTEM_SLOT_BASE + config.systemSlotBytes;
	VRAM_SECONDARY_SLOT_BASE = VRAM_PRIMARY_SLOT_BASE + VRAM_IMAGE_SLOT_SIZE;
	VRAM_FRAMEBUFFER_BASE = VRAM_SECONDARY_SLOT_BASE + VRAM_IMAGE_SLOT_SIZE;
	VRAM_SYSTEM_SLOT_SIZE = config.systemSlotBytes;
	VRAM_PRIMARY_SLOT_SIZE = VRAM_IMAGE_SLOT_SIZE;
	VRAM_SECONDARY_SLOT_SIZE = VRAM_IMAGE_SLOT_SIZE;
}

export function configureMemoryMap(specs?: MemoryMapSpecs): void {
	const ramBytes = specs?.ram_bytes ?? DEFAULT_RAM_SIZE;
	const slotBytes = specs?.slot_bytes ?? DEFAULT_VRAM_IMAGE_SLOT_SIZE;
	const systemSlotBytes = specs?.system_slot_bytes ?? slotBytes;
	const stagingBytes = specs?.staging_bytes ?? DEFAULT_VRAM_STAGING_SIZE;
	const frameBufferBytes = specs?.framebuffer_bytes ?? DEFAULT_VRAM_FRAMEBUFFER_SIZE;
	recomputeMemoryLayout({
		ramBytes,
		slotBytes,
		systemSlotBytes,
		stagingBytes,
		frameBufferBytes,
	});
}

configureMemoryMap();
