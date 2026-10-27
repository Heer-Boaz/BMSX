import { createLoadedTestRuntimeSourceState } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { initializeMachineRuntime } from '../../hosts/common/machine_runtime';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { HeadlessInputHub } from '../../hosts/node/headless/input';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';

import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { createRuntimeSourceState } from '../../ide/runtime/sources';
import { installBlua32Media, prepareBlua32MediaBoot } from '../../ide/runtime/lua_pipeline';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { readBlua32CompiledSource } from '../../toolchain/ts/rompack/blua32_sources';
import { buildScenarioMediaFixture } from '../helpers/scenario_media';

test('program entry selection is prepared without mutation, survives admission, and stays local to its socket', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-program-entry-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const fixture = await buildScenarioMediaFixture(root, []);
	const media = await loadRomToolingMedia(fixture.systemRom, [fixture.cartRom, fixture.cartRom]);
	const sources = createLoadedTestRuntimeSourceState(media.system, media.cartridgeSlots);
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	t.after(() => input.dispose());
	const runtime = initializeMachineRuntime(fixture.systemRom, [fixture.cartRom, fixture.cartRom], PSX_MACHINE_SPEC, input);

	for (const domain of [0, 1] as const) {
		const cartridge = sources.cartridgeSlots[domain]!;
		const other = sources.cartridgeSlots[1 - domain]!;
		const otherRom = other.rom;
		const otherImage = sources.currentBlua32Media.cartridgeSlots[1 - domain];
		const registry = sources.catalog.getContext(cartridge.contextId).luaSources;
		registerLuaSourceRecord(registry, {
			resid: 'actor', type: 'lua', source_path: 'experiments/actor.lua',
			normalized_source_path: 'carts/example/experiments/actor.lua', module_path: 'experiments/actor',
			src: 'local function init<init>() end\ninit()\nreturn 42', base_src: '', base_update_timestamp: 0, update_timestamp: 0,
			generated: false, sourceKind: 'project', program_module: true,
		});
		const originalRom = cartridge.rom;
		const prepared = prepareBlua32MediaBoot(sources, runtime, false,
			{ domain, sourcePath: 'experiments/actor.lua' });
		assert.equal(cartridge.rom, originalRom, 'preparation does not install');
		assert.equal(registry.entrySourcePath, 'entry.lua');
		assert.equal(prepared!.rebuilt.cartridgeSlots[domain]!.entrySourcePath, 'experiments/actor.lua');
		assert.equal(prepared!.cartridgeLayers[1 - domain], null);
		installBlua32Media(sources, runtime, prepared!);
		assert.equal(registry.entrySourcePath, 'entry.lua', 'installing an entry selection does not change source-context build configuration');
		assert.equal(other.rom, otherRom);
		assert.equal(sources.currentBlua32Media.cartridgeSlots[1 - domain], otherImage);
		assert.equal(sources.currentBlua32Media.cartridgeSlots[domain]!.symbols!.metadata.compiledModulePaths[0], 'experiments/actor');

		const reloaded = await loadRomToolingMedia(fixture.systemRom,
			[sources.cartridgeSlots[0]!.rom.bytes, sources.cartridgeSlots[1]!.rom.bytes]);
		const reattached = createRuntimeSourceState(reloaded.system, reloaded.cartridgeSlots, {
			catalog: sources.catalog, systemContextId: sources.systemContextId,
			cartridgeContextIds: [sources.cartridgeSlots[0]!.contextId, sources.cartridgeSlots[1]!.contextId],
		});
		assert.equal(reattached.catalog.getContext(cartridge.contextId).luaSources, registry,
			'loading the selected physical generation retains the admitted authoring context');
		assert.equal(registry.entrySourcePath, 'entry.lua');
		const reloadedImage = reattached.currentBlua32Media.cartridgeSlots[domain]!;
		assert.equal(reloadedImage.symbols!.metadata.compiledModulePaths[0], 'experiments/actor');
		assert.equal(readBlua32CompiledSource(reloadedImage.sources.get('experiments/actor')!), registry.path2lua['experiments/actor.lua'].src);
		assert.equal(registry.path2lua['entry.lua'].src.startsWith('module<entry>'), true);

		sources.cartridgeBlua32MediaDirty[domain] = true;
		const rebuild = prepareBlua32MediaBoot(sources, runtime, true);
		assert.equal(rebuild!.rebuilt.cartridgeSlots[domain]!.entrySourcePath, 'entry.lua',
			'a later workspace build uses the declared context entry, not the previous one-shot Run');
		assert.equal(sources.currentBlua32Media.cartridgeSlots[domain]!.symbols!.metadata.compiledModulePaths[0], 'experiments/actor',
			'preparing a default-entry build does not replace the selected installed generation');
		const installedRom = cartridge.rom;
		registry.path2lua['experiments/actor.lua'].src = '@';
		assert.throws(() => prepareBlua32MediaBoot(sources, runtime, true));
		assert.equal(cartridge.rom, installedRom);
		assert.equal(registry.entrySourcePath, 'entry.lua', 'installing an entry selection does not change source-context build configuration');
		registry.path2lua['experiments/actor.lua'].src = 'return 43';
		const project = prepareBlua32MediaBoot(sources, runtime, true, { domain });
		installBlua32Media(sources, runtime, project!);
		assert.equal(registry.entrySourcePath, 'entry.lua');
		assert.equal(sources.currentBlua32Media.cartridgeSlots[domain]!.symbols!.metadata.compiledModulePaths[0], 'entry');
	}
});
