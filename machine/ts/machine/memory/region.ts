import { CART_ROM_BASE, CART_ROM_SIZE, IO_BASE, IO_REGION_SIZE, PROGRAM_ROM_BASE, PROGRAM_ROM_SIZE, RAM_BASE, RAM_END, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE } from './map';

export const MEMORY_REGION_RAM = 0;
export const MEMORY_REGION_SYSTEM_ROM = 1;
export const MEMORY_REGION_CART_ROM = 2;
export const MEMORY_REGION_PROGRAM_ROM = 3;
export const MEMORY_REGION_OTHER = 4;

export type MemoryRegionKind =
	| typeof MEMORY_REGION_RAM
	| typeof MEMORY_REGION_SYSTEM_ROM
	| typeof MEMORY_REGION_CART_ROM
	| typeof MEMORY_REGION_PROGRAM_ROM
	| typeof MEMORY_REGION_OTHER;

function inRange(addr: number, base: number, size: number): boolean {
	return addr >= base && addr - base < size;
}

export function classifyMemoryRegion(addr: number): MemoryRegionKind {
	if (addr >= RAM_BASE && addr < RAM_END) {
		// The IO register window (mapped DMA/GX/APU/etc. ports) is carved out
		// of the RAM address window; those addresses are intercepted by
		// device logic before reaching the RAM array and have no DRAM row
		// behavior, so they must not classify as Ram.
		if (inRange(addr, IO_BASE, IO_REGION_SIZE)) {
			return MEMORY_REGION_OTHER;
		}
		return MEMORY_REGION_RAM;
	}
	if (inRange(addr, SYSTEM_ROM_BASE, SYSTEM_ROM_SIZE)) {
		return MEMORY_REGION_SYSTEM_ROM;
	}
	if (inRange(addr, CART_ROM_BASE, CART_ROM_SIZE)) {
		return MEMORY_REGION_CART_ROM;
	}
	if (inRange(addr, PROGRAM_ROM_BASE, PROGRAM_ROM_SIZE)) {
		return MEMORY_REGION_PROGRAM_ROM;
	}
	return MEMORY_REGION_OTHER;
}
