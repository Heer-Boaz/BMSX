import type { LuaChunk } from './syntax/ast';

export type LuaEntryModuleCandidate = {
	chunk: LuaChunk;
};

export function resolveLuaEntryModuleIndex(
	modules: ReadonlyArray<LuaEntryModuleCandidate>,
	entryModulePath?: string,
): number {
	if (entryModulePath !== undefined) {
		const index = modules.findIndex(module => module.chunk.locations.path === entryModulePath);
		if (index < 0) throw new Error(`BLua entry module '${entryModulePath}' is not in the program.`);
		return index;
	}
	let entryIndex = -1;
	for (let index = 0; index < modules.length; index += 1) {
		if (!modules[index].chunk.entryModule) {
			continue;
		}
		if (entryIndex >= 0) {
			throw new Error(
				`BLua program has multiple module<entry> roots: '${modules[entryIndex].chunk.locations.path}' and '${modules[index].chunk.locations.path}'.`,
			);
		}
		entryIndex = index;
	}
	if (entryIndex < 0) {
		throw new Error('BLua program has no module<entry> root.');
	}
	return entryIndex;
}
