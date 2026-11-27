import { valueInteger } from '../../machine/ts/machine/cpu/value';
import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LUA_BOOT_PRIMITIVES } from '../../toolchain/ts/lua/compiler/system_boot_symbols';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { compileLuaChunkToProgram, encodeCompiledProgramObject } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { createEditorSemanticFrontend } from '../../ide/editor/contrib/intellisense/frontend';
import { compileHeapServiceSystem } from '../helpers/heap_service_system';
import { createTestBlua32PairCpu, linkTestBlua32Pair } from '../helpers/blua32';
import { materializeCpuCompletionValues, runGuestToHalt } from '../helpers/cpu_test_harness';

for (const optLevel of [3] as const) {
	test(`compiler emits immutable builtin constants only in the system domain at O${optLevel}`, () => {
		for (const primitive of LUA_BOOT_PRIMITIVES) {
			const source = `return ${primitive.name}`;
			const chunk = parseLuaChunk(source, 'capture.lua').chunk;
			const bios = compileLuaChunkToProgram(chunk, [], { entrySource: source, optLevel, programDomain: 'system' });
			assert.equal(bios.metadata.systemGlobalNames.includes(primitive.name), false);
			assert.deepEqual(encodeCompiledProgramObject(bios).sections.rodata.constPool.filter(value =>
				value !== null && typeof value === 'object' && value.kind === 'builtin'), [{ kind: 'builtin', word: primitive.id }]);
			assert.throws(() => compileLuaChunkToProgram(chunk, [], { entrySource: source, optLevel, programDomain: 'cart' }));
			assert.throws(() => compileLuaChunkToProgram(chunk, [], { entrySource: source, optLevel }));
		}
	});

	test(`an authored boot-like cart global does not address the system bank at O${optLevel}`, () => {
		const source = '__bmsx_next = 42; return __bmsx_next';
		const cart = compileLuaChunkToProgram(parseLuaChunk(source, 'cart.lua').chunk, [], { entrySource: source, optLevel });
		assert.ok(cart.metadata.globalNames.includes('__bmsx_next'));
		assert.equal(cart.metadata.systemGlobalNames.includes('__bmsx_next'), false);
		const bootSource = `cop0.exec = mem[${CART_ROM_BASE + BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET}]`;
		const bios = compileHeapServiceSystem(bootSource, optLevel);
		const pair = linkTestBlua32Pair(bios, cart);
		const { cpu } = createTestBlua32PairCpu(pair);
		runGuestToHalt(cpu, 100000);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [valueInteger(42)]);
		for (const primitive of LUA_BOOT_PRIMITIVES)
			assert.equal(pair.systemImage.systemGlobalNames.includes(primitive.name), false);
	});
}

test('semantic frontend caching keeps the domain policy outside immutable syntax snapshots', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['capture.lua']));
	workspace.updateFile('capture.lua', 'return __bmsx_next');
	const snapshot = workspace.getSnapshot();
	const bios = createEditorSemanticFrontend(snapshot, 'system');
	const cart0 = createEditorSemanticFrontend(snapshot, 'cart');
	const cart1 = createEditorSemanticFrontend(snapshot, 'cart');
	assert.deepEqual(bios.getFile('capture.lua').diagnostics, []);
	assert.equal(cart0.getFile('capture.lua').diagnostics.length, 1);
	assert.equal(cart1.getFile('capture.lua').diagnostics.length, 1);
	for (let read = 0; read < 100; read++) {
		assert.equal(createEditorSemanticFrontend(snapshot, 'system'), bios);
		assert.equal(createEditorSemanticFrontend(snapshot, 'cart'), cart0);
		assert.equal(createEditorSemanticFrontend(snapshot, 'cart'), cart1);
	}
});
