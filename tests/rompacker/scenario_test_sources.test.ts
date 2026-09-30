import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildScenarioTestSourceAssets, collectScenarioTestSourceFiles } from '../../scripts/rompacker/scenario_test_sources';
import { prepareRomInputs } from '../../scripts/rompacker/build_inputs';
import { scenarioTestAssetId } from '../../toolchain/ts/rompack/scenario_test';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCartridgeIndex } from '../../toolchain/ts/rompack/loader';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { createRuntimeSourceState } from '../../ide/runtime/sources';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { createLuaResource } from '../../ide/workspace/workspace';
import { openWorkspaceRecords, closeWorkspaceRecords } from '../../ide/workspace/records';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { ScenarioRunService } from '../../ide/workbench/services/testing/scenario_runs';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { TestInput } from '../../ide/testing/input';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { setImmediate } from 'node:timers/promises';

const NEMESIS_SCENARIO_PATH = 'tests/carts/nemesis_s/nemesis_s_pause_assert.lua';

test('debug scenario discovery packages each authored assertion as one source-only Lua asset', async () => {
	const sourceFiles = collectScenarioTestSourceFiles('carts/nemesis_s');
	const inputs = await prepareRomInputs([], sourceFiles);
	const collected = { sourceFiles, assets: buildScenarioTestSourceAssets(sourceFiles.map(file => inputs.files.get(file)!)) };
	const sourceIndex = collected.assets.findIndex(
		asset => asset.source_path === NEMESIS_SCENARIO_PATH,
	);
	assert.notEqual(sourceIndex, -1);
	const asset = collected.assets[sourceIndex];
	assert.equal(collected.sourceFiles[sourceIndex].endsWith(NEMESIS_SCENARIO_PATH), true);
	assert.equal(asset.resid, scenarioTestAssetId(NEMESIS_SCENARIO_PATH));
	assert.equal(asset.type, 'lua');
	assert.equal(asset.normalized_source_path, NEMESIS_SCENARIO_PATH);
	assert.equal(asset.compiled_buffer, undefined);
	assert.match(Buffer.from(asset.buffer!).toString('utf8'), /input_pause_retains_simulation_and_music = function\(t\)/);
});

test('a debug cart with no packed tests can execute its first workspace-created suite; rebuild preserves source-only membership', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-first-scenario-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const resources = join(directory, 'res'), output = join(directory, 'output');
	await mkdir(resources);
	await writeFile(join(resources, 'manifest.rommanifest'), 'title: First scenario\nhardware:\n  - type: rom\n');
	await writeFile(join(directory, 'entry.lua'), 'module<entry>\nwhile true do halt_until_irq end');
	const compile = (debug: boolean) => {
		const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/rompacker/rompacker.ts',
			'--mode', 'rompack', '--skiptypecheck', '-romname', 'fresh', '-respath', resources, '--output-dir', output,
			'--store-dir', join(directory, 'store'), '-O0', ...(debug ? ['--debug'] : [])], { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stdout + result.stderr);
	};
	compile(true);
	const system = await readFile(join(output, 'system/bmsx-bios.debug.rom'));
	const cartridge = await readFile(join(output, 'fresh.debug.rom'));
	const index = await parseCartridgeIndex(cartridge);
	assert.equal(index.entries.some(entry => entry.source_path?.endsWith('_assert.lua')), false);
	assert.equal(index.entries.find(entry => entry.source_path === 'testlib/execution.lua')!.compiled_start, undefined);
	const media = await loadRomToolingMedia(system, [cartridge, null]);
	const sources = createRuntimeSourceState(media.system, media.cartridgeSlots);
	const authoring = new OffscreenMachine(system, [cartridge, null], PSX_MACHINE_SPEC, new TestInput());
	const models = new EditorTextModelService();
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	t.after(async () => { models.clear(); authoring.dispose(); await closeWorkspaceRecords(); });
	const source = "return { kind = 'unit', tests = { first = function() assert(2 + 2 == 4) end } }";
	await createLuaResource(new VirtualHeadlessClock(), sources, { domain: 0, relativePath: 'first_assert.lua', contents: source });
	const runs = new ScenarioRunService(models, sources, new RuntimeLuaTooling(sources, new SuspendedGuestSession(authoring.runtime)),
		new Map(), PSX_MACHINE_SPEC, (system, slots, model, input) => new OffscreenMachine(system, slots, model, input));
	t.after(() => runs.dispose());
	const run = runs.start(runs.collection.findModuleBySourcePath(0, 'first_assert.lua').id);
	for (let grant = 0; runs.active && grant < 10000; grant++) { runs.advance(); await setImmediate(); }
	assert.equal(run.state, 'passed', JSON.stringify(run.items[0].failures));
	assert.equal(authoring.runtime.machine.scheduler.currentNowCycles(), 0, 'the authoring machine did not execute');
	await writeFile(join(directory, 'first_assert.lua'), source);
	// res/ is also a resource-scan root: assertions there must not become gameplay code.
	await writeFile(join(resources, 'second_assert.lua'), source);
	for (const debug of [true, false]) {
		compile(debug);
		const rebuilt = await parseCartridgeIndex(await readFile(join(output, debug ? 'fresh.debug.rom' : 'fresh.rom')));
		for (const path of ['first_assert.lua', 'res/second_assert.lua']) {
			const suite = rebuilt.entries.find(entry => entry.source_path === path);
			if (debug) { assert.ok(suite, path); assert.equal(suite.resid, scenarioTestAssetId(path)); assert.equal(suite.compiled_start, undefined); }
			else assert.equal(suite, undefined, 'release media omits test sources');
		}
	}
});
