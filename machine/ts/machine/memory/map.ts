import { RAM_BASE } from '../../spec/bmsx/memory_map';

export const DEFAULT_RAM_SIZE = 0x00400000; // 4 MB

export let RAM_SIZE = DEFAULT_RAM_SIZE;
export let RAM_END = RAM_BASE + RAM_SIZE;

export function configureMemoryMap(ramBytes: number): void {
	RAM_SIZE = ramBytes;
	RAM_END = RAM_BASE + RAM_SIZE;
}
