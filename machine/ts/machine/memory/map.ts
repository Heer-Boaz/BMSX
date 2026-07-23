export const ADDRESS_BITS = 32;

export const SYSTEM_ROM_BASE = 0x00000000;
export const SYSTEM_ROM_SIZE = 0x01000000; // 16 MB

export const RAM_BASE = 0x08000000;
export const MAX_RAM_SIZE = 0x08000000; // 128 MB address window
export const DEFAULT_RAM_SIZE = 0x00400000; // 4 MB

export const CART_ROM_BASE = RAM_BASE + MAX_RAM_SIZE;
export const CART_ROM_SIZE = 0x20000000; // 512 MB address window
export const CART_ROM_END = CART_ROM_BASE + CART_ROM_SIZE;
export const CART_ROM_MAGIC_OFFSET = 0x00000000;
export const CART_ROM_MAGIC_ADDR = CART_ROM_BASE + CART_ROM_MAGIC_OFFSET;

export const CART_RAM_BASE = CART_ROM_END;
export const CART_RAM_SIZE = 0x00f00000; // 15 MB
export const CART_RAM_END = CART_RAM_BASE + CART_RAM_SIZE;
export const CART_MMIO_BASE = CART_RAM_BASE + CART_RAM_SIZE;
export const CART_MMIO_SIZE = 0x00100000; // 1 MB
export const CART_MMIO_END = CART_MMIO_BASE + CART_MMIO_SIZE;
export const CART_BUS_END = CART_MMIO_END;

export const IO_WORD_SIZE = 4;

export const IO_REGION_SIZE = 0x00040000; // 256 KB

export const DEFAULT_GEO_SCRATCH_SIZE = 0x00080000; // 512 KB
export const MIN_RAM_SIZE = IO_REGION_SIZE
	+ DEFAULT_GEO_SCRATCH_SIZE;
export const BASE_RAM_USED_SIZE = DEFAULT_GEO_SCRATCH_SIZE;
export const PROGRAM_STATIC_RAM_BASE = RAM_BASE + MIN_RAM_SIZE;

export let RAM_SIZE = DEFAULT_RAM_SIZE;

export const IO_BASE = RAM_BASE;
export const GEO_SCRATCH_BASE = IO_BASE + IO_REGION_SIZE;
export const GEO_SCRATCH_SIZE = DEFAULT_GEO_SCRATCH_SIZE;
export let RAM_END = RAM_BASE + RAM_SIZE;

export function configureMemoryMap(ramBytes: number): void {
	RAM_SIZE = ramBytes;
	RAM_END = RAM_BASE + RAM_SIZE;
}

configureMemoryMap(DEFAULT_RAM_SIZE);
