import { ROM_ASSET_SYMBOL_MODULE_PATH, ROM_ASSET_SYMBOL_SOURCE_PATH, SYSTEM_ASSET_SYMBOL_MODULE_PATH, SYSTEM_ASSET_SYMBOL_SOURCE_PATH } from '../../toolchain/ts/rompack/generated_modules';
import { createRuntimeSourceState } from '../../ide/runtime/sources';
import { TEST_SYSTEM_CONTEXT_ID, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createLoadedTestRuntimeSourceState } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildScenarioMediaFixture } from '../helpers/scenario_media';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { BIOS_FUNCTION_EXPORTS } from '../../toolchain/ts/rompack/system';

import { buildBlua32Media, layoutBlua32MediaInstallation } from '../../ide/runtime/lua_pipeline';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

for (const [system, first, second] of [[2, 0, 3], [1, 3, 0]] as const) {
	test(`source rebuild retains each image recipe: BIOS O${system}, cart0 O${first}, cart1 O${second}`, async t => {
		const root = await mkdtemp(join(tmpdir(), 'bmsx-image-recipe-'));
		openWorkspaceRecords(new MemoryWorkspaceFiles());
		t.after(async () => { closeWorkspaceRecords(); await rm(root, { recursive: true, force: true }); });
		const options = {
			systemOptLevel: system,
			systemSource: 'module<entry>\nreturn 1',
			systemModules: BIOS_FUNCTION_EXPORTS.map(exported => ({ path: exported.path, source: 'module<const>\nreturn function(value) return value end' })),
			cartSource: 'module<entry>\nlocal value = 2\nreturn value ^ 0.5',
		};
		const a = await buildScenarioMediaFixture(join(root, 'a'), [], { ...options, cartOptLevel: first });
		const b = await buildScenarioMediaFixture(join(root, 'b'), [], { ...options, cartOptLevel: second });
		const loaded = await loadRomToolingMedia(a.systemRom, [a.cartRom, b.cartRom]);
		const sources = createLoadedTestRuntimeSourceState(loaded.system, loaded.cartridgeSlots);
		for (const mode of ['boot', 'live'] as const) {
			const rebuilt = buildBlua32Media(sources, 0x00400000, { system: 'workspace', cartridgeSlots: ['workspace', 'workspace'] }, mode);
			assert.deepEqual([rebuilt.system!, ...rebuilt.cartridgeSlots].map(image => image!.linked.symbols.metadata.optLevel), [system, first, second]);
			const published = layoutBlua32MediaInstallation(sources, rebuilt);
			const reloaded = await loadRomToolingMedia(published.systemLayer!.bytes, [published.cartridgeLayers[0]!.bytes, published.cartridgeLayers[1]!.bytes]);
			const next = createLoadedTestRuntimeSourceState(reloaded.system, reloaded.cartridgeSlots).currentBlua32Media;
			assert.deepEqual([next.system!, ...next.cartridgeSlots].map(image => image!.symbols!.metadata.optLevel), [system, first, second]);
		}
	});
}

test('BIOS-only relinking consumes each installed generation when one context is installed twice', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-installed-generation-'));
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	t.after(async () => { await closeWorkspaceRecords(); await rm(root, { recursive: true, force: true }); });
	const system = { systemSource: 'module<entry>\nreturn 1', systemModules: [] };
	const sourceA = "module<entry>\nlocal dependency<const> = require('generation_a')\nreturn dependency";
	const sourceB = "module<entry>\nlocal dependency<const> = require('generation_b')\nreturn dependency";
	const a = await buildScenarioMediaFixture(join(root, 'a'), [], { ...system, cartSource: sourceA,
		cartModules: [{ path: 'generation_a', source: 'return 17' }] });
	const b = await buildScenarioMediaFixture(join(root, 'b'), [], { ...system, cartSource: sourceB,
		cartModules: [{ path: 'generation_b', source: 'return 29' }] });
	const loaded = await loadRomToolingMedia(a.systemRom, [a.cartRom, b.cartRom]);
	const seed = createLoadedTestRuntimeSourceState(loaded.system, [loaded.cartridgeSlots[0], null]);
	const sources = createRuntimeSourceState(loaded.system, loaded.cartridgeSlots, { catalog: seed.catalog,
		systemContextId: TEST_SYSTEM_CONTEXT_ID, cartridgeContextIds: [TEST_CARTRIDGE_CONTEXT_IDS[0], TEST_CARTRIDGE_CONTEXT_IDS[0]] });
	const context = sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]);
	assert.equal(context.luaSources.module2lua.generation_b, undefined, 'the authored namespace remains generation A, not a union of installed images');
	assert.equal(sources.currentBlua32Media.system!.symbols!.metadata.compiledModulePaths.includes(SYSTEM_ASSET_SYMBOL_MODULE_PATH), false);
	for (const image of sources.currentBlua32Media.cartridgeSlots) {
		assert.equal(image!.symbols!.metadata.compiledModulePaths.includes(ROM_ASSET_SYMBOL_MODULE_PATH), false);
		assert.equal(image!.sources.has(ROM_ASSET_SYMBOL_MODULE_PATH), false, 'source capture does not invent a compiler input absent from the installed manifest');
	}
	const rebuilt = buildBlua32Media(sources, 0x00400000, { system: 'workspace', cartridgeSlots: [null, null] }, 'boot');
	assert.equal(rebuilt.cartridgeSlots[0]!.sourceSelection, 'installed');
	assert.equal(rebuilt.cartridgeSlots[1]!.sourceSelection, 'installed');
	assert.equal(rebuilt.cartridgeSlots[0]!.sources.get('entry'), sourceA);
	assert.equal(rebuilt.cartridgeSlots[1]!.sources.get('entry'), sourceB);
	assert.equal(rebuilt.cartridgeSlots[1]!.sources.get('generation_b'), 'return 29');
	assert.equal(rebuilt.cartridgeSlots[1]!.sources.has('generation_a'), false);
	assert.equal(rebuilt.system!.linked.symbols.metadata.compiledModulePaths.includes(SYSTEM_ASSET_SYMBOL_MODULE_PATH), true);
	assert.equal(rebuilt.system!.diagnosticSources.get(SYSTEM_ASSET_SYMBOL_MODULE_PATH)!.displayPath, SYSTEM_ASSET_SYMBOL_SOURCE_PATH);
	for (const image of rebuilt.cartridgeSlots) {
		assert.equal(image!.linked.symbols.metadata.compiledModulePaths.includes(ROM_ASSET_SYMBOL_MODULE_PATH), true);
		assert.equal(image!.diagnosticSources.get(ROM_ASSET_SYMBOL_MODULE_PATH)!.displayPath, ROM_ASSET_SYMBOL_SOURCE_PATH);
	}
	assert.equal(sources.currentBlua32Media.cartridgeSlots[1]!.sources.has(ROM_ASSET_SYMBOL_MODULE_PATH), false, 'a candidate build does not rewrite prior installation provenance');
	assert.equal(context.luaSources.module2lua.generation_b, undefined, 'relinking does not admit installed-generation members into authored source');
});
