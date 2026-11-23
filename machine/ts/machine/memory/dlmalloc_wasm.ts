import { MAIN_RAM_SIZE } from '../../spec/bmsx/memory_map';
import { DLMALLOC_WASM_BASE64 } from './dlmalloc_wasm.generated';

export { DLMALLOC_WASM_PAGE_COUNT } from './dlmalloc_wasm.generated';

// The shared allocator ABI takes physical RAM offsets, never guest addresses.
export interface DlmallocArena {
	reset(floor: number, limit: number): void;
	setFloor(floor: number): number;
	allocate(bytes: number, object: number): number;
	free(offset: number): void;
	shrink(offset: number, bytes: number): void;
	allocationBytes(offset: number): number;
	floor(): number;
	occupiedBytes(): number;
	isObject(offset: number): number;
}

interface DlmallocModuleExports extends DlmallocArena {
	bind(state: number, watchGroups: number): void;
}

let compiledModule: WebAssembly.Module | undefined;

export function bindDlmalloc(memory: WebAssembly.Memory, state: number): DlmallocArena {
	compiledModule ??= new WebAssembly.Module(Uint8Array.from(atob(DLMALLOC_WASM_BASE64), byte => byte.charCodeAt(0)));
	const arena = new WebAssembly.Instance(compiledModule, { env: { memory } }).exports as unknown as DlmallocModuleExports;
	arena.bind(state, MAIN_RAM_SIZE);
	return arena;
}
