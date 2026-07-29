import type { LuaChunk } from './syntax/ast';

export type LuaEntryModuleCandidate = {
	chunk: LuaChunk;
};

export function resolveLuaEntryModuleIndex(
	modules: ReadonlyArray<LuaEntryModuleCandidate>,
): number {
	let entryIndex = -1;
	for (let index = 0; index < modules.length; index += 1) {
		if (!modules[index].chunk.entryModule) {
			continue;
		}
		if (entryIndex >= 0) {
			throw new Error(
				`BLua program has multiple module<entry> roots: '${modules[entryIndex].chunk.range.path}' and '${modules[index].chunk.range.path}'.`,
			);
		}
		entryIndex = index;
	}
	if (entryIndex < 0) {
		throw new Error('BLua program has no module<entry> root.');
	}
	return entryIndex;
}
