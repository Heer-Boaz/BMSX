import { type OptimizationLevel } from '../../toolchain/ts/lua/compiler/optimizer';
import assert from 'node:assert/strict';
import { INSTRUCTION_BYTES } from '../../machine/ts/spec/blua32/instruction_format';
import { readLE32 } from '../../machine/ts/common/endian';
import { BLUA32_FUNCTION_FLAGS_OFFSET, BLUA32_FUNCTION_RESIDENT } from '../../machine/ts/spec/blua32/image_format';
import { linkTestSystemBlua32, type TestBlua32Image } from './blua32';
import { readFileSync } from 'node:fs';
import { compileLuaChunkToProgram, type SystemCompileOptions } from '../../toolchain/ts/lua/compiler';
import type { ProgramModule } from '../../toolchain/ts/lua/compiler/passes/module_contract';
import { HEAP_SERVICE_MODULES } from '../../toolchain/ts/rompack/blua32_heap_service';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import type { LuaChunk } from '../../toolchain/ts/lua/syntax/ast';

const testBiosUtilityModules = ['math/sin', 'string/float/decode', 'gpu/system_vram_region', 'tty/layout'];
const testSystemAssets = {
	path: 'bmsx/system_assets',
	source: `module<const>
rodata texture: word[3] = { 0xa0000000, 0x02d002c0, 0x00fc0140 }
return { bin_gx_system_texture_addr = texture }`,
};

type FixtureModule = ProgramModule & { source: string };

let heapServiceTestModules: readonly FixtureModule[] | undefined;
let biosUtilityTestModules: readonly FixtureModule[] | undefined;

export function loadHeapServiceTestModules(): readonly FixtureModule[] {
	return heapServiceTestModules ??= HEAP_SERVICE_MODULES.map(path => {
		const source = readFileSync(`machine/bios/${path}.lua`, 'utf8');
		return { path, source, chunk: parseLuaChunk(source, path).chunk };
	});
}

/** The other published BIOS slots retain their actual functions in paired ROM fixtures. */
export function loadTestBiosUtilityModules(): readonly FixtureModule[] {
	return biosUtilityTestModules ??= testBiosUtilityModules
		.map(path => ({ path, source: readFileSync(`machine/bios/${path}.lua`, 'utf8') }))
		.concat(testSystemAssets)
		.map(({ path, source }) => ({ path, source, chunk: parseLuaChunk(source, path).chunk }));
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
		...loadTestBiosUtilityModules().filter(module => !bootModules.some(input => input.path === module.path)),
		...bootModules.map(({ path, source }) => ({ path, source, chunk: parseLuaChunk(source, path).chunk })),
	];
	return compileTestSystemWithHeap(parseLuaChunk(entrySource, entryPath).chunk, modules,
		{ entrySource, optLevel, programDomain: 'system', preloadModules: bootModules.map(({ path }) => path) });
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

/** Resolve the actual fixed root from fixture linker symbols, not a CPU roster. */
export function residentFunctionAddress(linked: Pick<TestBlua32Image, 'image' | 'symbols'>, module: string, member: string): number {
	const index = linked.symbols.metadata.functionIds.findIndex(id => id.startsWith(`module:${module}/`) && id.endsWith(`|constant|${member}`));
	assert.ok(index >= 0, `linked resident function ${module}:${member}`);
	const record = linked.image.functions[index];
	assert.notEqual(readLE32(linked.image.bytes, record.address - linked.image.address + BLUA32_FUNCTION_FLAGS_OFFSET) & BLUA32_FUNCTION_RESIDENT, 0);
	return record.address;
}
