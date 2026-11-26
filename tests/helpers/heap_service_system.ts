import { type OptimizationLevel } from '../../toolchain/ts/lua/compiler/optimizer';
import assert from 'node:assert/strict';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { linkTestSystemBlua32 } from './blua32';
import { readFileSync } from 'node:fs';
import { compileLuaChunkToProgram, type SystemCompileOptions } from '../../toolchain/ts/lua/compiler';
import type { ProgramModule } from '../../toolchain/ts/lua/compiler/passes/module_contract';
import { HEAP_SERVICE_MODULES } from '../../toolchain/ts/rompack/blua32_heap_service';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import type { LuaChunk } from '../../toolchain/ts/lua/syntax/ast';

let heapServiceTestModules: readonly ProgramModule[] | undefined;

export function loadHeapServiceTestModules(): readonly ProgramModule[] {
	return heapServiceTestModules ??= HEAP_SERVICE_MODULES.map(path => {
		const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
		return { path, source, chunk: parseLuaChunk(source, path).chunk };
	});
}

/** Compile an executable fixture with the System BIOS operation roster. */
export function compileTestSystemWithHeap(chunk: LuaChunk, modules: readonly ProgramModule[],
	options: SystemCompileOptions) {
	const fixturePaths = new Set(modules.map(module => module.path));
	const firmware = loadHeapServiceTestModules().filter(module => !fixturePaths.has(module.path));
	return compileLuaChunkToProgram(chunk, [...firmware, ...modules], {
		...options, preloadModules: [...HEAP_SERVICE_MODULES, ...(options.preloadModules ?? [])],
	});
}

export function compileHeapServiceSystem(entrySource: string, optLevel: OptimizationLevel,
	bootModules: readonly { path: string; source: string }[] = [], entryPath = 'test.lua') {
	const modules = [
		...loadHeapServiceTestModules(),
		...bootModules.map(({ path, source }) => ({ path, source, chunk: parseLuaChunk(source, path).chunk })),
	];
	return compileLuaChunkToProgram(parseLuaChunk(entrySource, entryPath).chunk, modules,
		{ entrySource, optLevel, programDomain: 'system', preloadModules: modules.map(({ path }) => path) });
}

/** A hand-assembled entry in the same verified ROM as the real firmware. */
export function linkHeapServiceEntry(text: Uint8Array, maxStack: number, isVararg = false) {
	const compiled = compileHeapServiceSystem('halt_until_irq\n'.repeat(text.byteLength / INSTRUCTION_BYTES - 1), 0);
	const entry = compiled.program.protos[compiled.entryProtoIndex];
	assert.equal(entry.codeLen, text.byteLength);
	compiled.program.code.set(text, entry.entryPC);
	entry.maxStack = maxStack;
	entry.isVararg = isVararg;
	return linkTestSystemBlua32(compiled);
}
