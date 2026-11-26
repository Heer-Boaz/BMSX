import { readFileSync } from 'node:fs';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { HEAP_SERVICE_MODULES } from '../../toolchain/ts/rompack/blua32_heap_service';
import { parseLuaChunk } from './cpu_test_harness';

export function compileHeapServiceSystem(entrySource: string, optLevel: 0 | 3,
	bootModules: readonly { path: string; source: string }[] = []) {
	const sources = HEAP_SERVICE_MODULES.map(path => ({
		path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8'),
	}));
	const modules = [...sources, ...bootModules].map(({ path, source }) => ({ path, source, chunk: parseLuaChunk(source, path) }));
	return compileLuaChunkToProgram(parseLuaChunk(entrySource), modules,
		{ entrySource, optLevel, programDomain: 'system', preloadModules: modules.map(({ path }) => path) });
}
