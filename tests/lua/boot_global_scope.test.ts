import { createPathModuleBindingsFixture } from '../helpers/lua_semantic_project';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';
import { CART_ROM_BASE } from '../../machine/ts/spec/bmsx/memory_map';
import { BMSX_ROM_HEADER_BLUA32_STARTUP_FUNCTION_ADDRESS_OFFSET } from '../../machine/ts/spec/bmsx/rom_header';
import { RunResult } from '../../machine/ts/machine/cpu/cpu';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { createEditorSemanticFrontend } from '../../ide/editor/contrib/intellisense/frontend';
import { createTestBlua32PairCpu, linkTestBlua32Pair } from '../helpers/blua32';
import { materializeCpuCompletionValues } from './cpu_test_harness';

for (const optLevel of [0, 3] as const) {
	test(`compiler accepts ambient boot globals only in the system domain at O${optLevel}`, () => {
		for (const primitive of LUA_BOOT_PRIMITIVES) {
			const source = `return ${primitive.name}`;
			const chunk = parseLuaChunk(source, 'capture.lua').chunk;
			const bios = compileLuaChunkToProgram(chunk, [], { entrySource: source, optLevel, programDomain: 'system' });
			assert.ok(bios.metadata.systemGlobalNames.includes(primitive.name));
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
		const bios = compileLuaChunkToProgram(parseLuaChunk(bootSource, 'boot.lua').chunk, [], {
			entrySource: bootSource, optLevel, programDomain: 'system',
		});
		const { cpu } = createTestBlua32PairCpu(linkTestBlua32Pair(bios, cart));
		cpu.installBootPrimitives();
		assert.equal(cpu.runUntilDepth(0, 10000), RunResult.Halted);
		assert.deepEqual(materializeCpuCompletionValues(cpu), [42]);
		for (const primitive of LUA_BOOT_PRIMITIVES) {
			assert.equal(cpu.getSystemGlobalByKey(cpu.stringPool.find(primitive.name)!), null);
		}
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
