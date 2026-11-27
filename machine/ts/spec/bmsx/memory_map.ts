export const ADDRESS_BITS = 32;

export const SYSTEM_ROM_BASE = 0x00000000;
export const SYSTEM_ROM_SIZE = 0x01000000; // 16 MB

export const RAM_BASE = 0x08000000;
export const MAIN_RAM_SIZE = 0x00400000;
// The CPU record port decodes only the installed RAM's aligned word address.
export const RAM_RECORD_WORD_MASK = MAIN_RAM_SIZE - 4;
export const MAX_RAM_SIZE = 0x08000000; // 128 MB address window

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

// The language heap extends from the active image's page-rounded static end to
// the runtime management area at the top of installed RAM.
export const HEAP_PAGE_SIZE = 0x00001000; // 4 KB
export const RUNTIME_MANAGEMENT_SIZE = 0x00004000; // 16 KB
export const MIN_RAM_SIZE = IO_REGION_SIZE;
export const DYNAMIC_RAM_BASE = RAM_BASE + MIN_RAM_SIZE;

// Fixed CPU stack backing is not driven by the ordinary data or fetch bus.
export const CPU_FIXED_FRAME_OFFSET = 0x880;
export const CPU_FIXED_VALUE_OFFSET = 0x1000;
export const CPU_FIXED_FRAME_COUNT = 24;
export const CPU_FIXED_VALUE_COUNT = 384;
export const CPU_FIXED_STACK_BASE = RAM_BASE + MAIN_RAM_SIZE - RUNTIME_MANAGEMENT_SIZE;
export const CPU_FIXED_FRAME_ADDRESS = CPU_FIXED_STACK_BASE + CPU_FIXED_FRAME_OFFSET;
export const CPU_FIXED_VALUE_ADDRESS = CPU_FIXED_STACK_BASE + CPU_FIXED_VALUE_OFFSET;
export const CPU_FIXED_VALUE_END = CPU_FIXED_VALUE_ADDRESS + CPU_FIXED_VALUE_COUNT * 5;
export const CPU_RESET_BANK_ADDRESS = 0x083fd880;
export const CPU_RESET_BANK_END = CPU_RESET_BANK_ADDRESS + 0x50;

export const IO_BASE = RAM_BASE;
