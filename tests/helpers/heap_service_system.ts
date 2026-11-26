import { readFileSync } from 'node:fs';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { HEAP_SERVICE_MODULES } from '../../toolchain/ts/rompack/blua32_heap_service';
import { parseLuaChunk } from './cpu_test_harness';

export function compileHeapServiceSystem(entrySource: string, optLevel: 0 | 3) {
	const modules = HEAP_SERVICE_MODULES.map(path => {
		const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
		return { path, source, chunk: parseLuaChunk(source, path) };
	});
	return compileLuaChunkToProgram(parseLuaChunk(entrySource), modules,
		{ entrySource, optLevel, programDomain: 'system', preloadModules: HEAP_SERVICE_MODULES });
}
