import { BMSX_RAM_BYTES, RAM_BASE } from '../../spec/bmsx/memory_map';

export let RAM_SIZE = BMSX_RAM_BYTES;
export let RAM_END = RAM_BASE + RAM_SIZE;

export function configureMemoryMap(ramBytes: number): void {
	RAM_SIZE = ramBytes;
	RAM_END = RAM_BASE + RAM_SIZE;
}
