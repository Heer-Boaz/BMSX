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
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { createRuntimeSourceState } from '../../ide/runtime/sources';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { installBlua32Media, prepareBlua32MediaBoot } from '../../ide/runtime/lua_pipeline';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { buildScenarioMediaFixture } from '../helpers/scenario_media';

test('program entry selection is prepared without mutation, survives admission, and stays local to its socket', async t => {
	const root = await mkdtemp(join(tmpdir(), 'bmsx-program-entry-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const fixture = await buildScenarioMediaFixture(root, []);
	const media = await loadRomToolingMedia(fixture.systemRom, [fixture.cartRom, fixture.cartRom]);
	const sources = createRuntimeSourceState(media.system, media.cartridgeSlots);
	const input = new Input(new VirtualHeadlessClock(), new HeadlessInputHub(), -1);
	t.after(() => input.dispose());
	const runtime = initializeMachineRuntime(fixture.systemRom, [fixture.cartRom, fixture.cartRom], PSX_MACHINE_SPEC, input);
	const tooling = new RuntimeLuaTooling(sources, new SuspendedGuestSession(runtime));
	for (const domain of [0, 1] as const) {
		const cartridge = sources.cartridgeSlots[domain]!;
		const other = sources.cartridgeSlots[1 - domain]!;
		const otherRom = other.rom;
		const registry = cartridge.luaSources;
		registerLuaSourceRecord(registry, {
			resid: 'actor', type: 'lua', source_path: 'experiments/actor.lua',
			normalized_source_path: 'carts/example/experiments/actor.lua', module_path: 'experiments/actor',
			src: 'local function init<init>() end\ninit()\nreturn 42', base_src: '', base_update_timestamp: 0, update_timestamp: 0,
			generated: false, program_module: true,
		});
		const originalRom = cartridge.rom;
		const prepared = prepareBlua32MediaBoot(sources, tooling, runtime, false,
			{ domain, sourcePath: 'experiments/actor.lua' });
		assert.equal(cartridge.rom, originalRom, 'preparation does not install');
		assert.equal(registry.entrySourcePath, 'entry.lua');
		assert.equal(prepared.installation!.rebuilt.cartridgeSlots[domain]!.entrySourcePath, 'experiments/actor.lua');
		assert.equal(prepared.installation!.cartridgeLayers[1 - domain], null);
		installBlua32Media(sources, runtime, prepared.installation!);
		assert.equal(registry.entrySourcePath, 'experiments/actor.lua');
		assert.equal(other.rom, otherRom);

		const reloaded = await loadRomToolingMedia(fixture.systemRom,
			[sources.cartridgeSlots[0]!.rom.bytes, sources.cartridgeSlots[1]!.rom.bytes]);
		const reloadedRegistry = createRuntimeSourceState(reloaded.system, reloaded.cartridgeSlots)
			.cartridgeSlots[domain]!.luaSources;
		assert.equal(reloadedRegistry.entrySourcePath, 'experiments/actor.lua');
		assert.equal(reloadedRegistry.path2lua['experiments/actor.lua'].src, registry.path2lua['experiments/actor.lua'].src);
		assert.equal(reloadedRegistry.path2lua['experiments/actor.lua'].program_module, true);
		assert.equal(registry.path2lua['entry.lua'].src.startsWith('module<entry>'), true);

		sources.cartridgeBlua32MediaDirty[domain] = true;
		const rebuild = prepareBlua32MediaBoot(sources, tooling, runtime, true);
		assert.equal(rebuild.installation!.rebuilt.cartridgeSlots[domain]!.entrySourcePath, 'experiments/actor.lua');
		const installedRom = cartridge.rom;
		registry.path2lua['experiments/actor.lua'].src = '@';
		assert.throws(() => prepareBlua32MediaBoot(sources, tooling, runtime, true));
		assert.equal(cartridge.rom, installedRom);
		assert.equal(registry.entrySourcePath, 'experiments/actor.lua');
		registry.path2lua['experiments/actor.lua'].src = 'return 43';
		const project = prepareBlua32MediaBoot(sources, tooling, runtime, true, { domain });
		installBlua32Media(sources, runtime, project.installation!);
		assert.equal(registry.entrySourcePath, 'entry.lua');
	}
});
