import { IO_CART_SELECT, IO_CART_STATUS } from '../../machine/ts/spec/bmsx/io';
import { createScenarioTestSourceRecord } from '../helpers/scenario_sources';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { buildScenarioMediaFixture, SCENARIO_FIXTURE_TEST_SOURCE_PATH } from '../helpers/scenario_media';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { createRuntimeSourceState, enterCartridgeSources } from '../../ide/runtime/sources';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { EditorTextModelService, editorTextModelService } from '../../ide/editor/model/model_service';
import { ScenarioRunService } from '../../ide/workbench/services/testing/scenario_runs';
import { MemoryStorage } from '../../ide/workspace/memory_storage';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { TestInput } from '../../ide/testing/input';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { captureRuntimeMachineState } from '../../machine/ts/machine/runtime/machine_state';
import { workspaceDirtyRecords } from '../../ide/workbench/workspace/state';
import { buildWorkspaceDirtyEntryPath } from '../../ide/workspace/files';

test('Studio runs fresh targets and current sources without touching the authoring machine, sources or debugger', async t => {
	t.after(() => { workspaceDirtyRecords.clear(); editorTextModelService.clear(); });
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-isolation-'));
	try {
		const source = `local fixture = require('testlib/fixture')
return { kind = 'unit', tests = {
 first = function() assert(fixture == 'edited helper'); isolated = 9 end,
 second = function() assert(isolated == nil); error('retained failure') end,
 third = function() assert(isolated == nil) end,
} }`;
		const fixture = await buildScenarioMediaFixture(directory, [{ path: SCENARIO_FIXTURE_TEST_SOURCE_PATH, source }], {
			systemSource: `module<entry>\nrequire('base')\ncoroutine = require('coroutine')\ncop0.exec = mem[0x10000028]`,
			systemModules: [
				{ path: 'base', source: `local raise<const> = __bmsx_error\nassert = function(value, message) if not value then raise(message) end return value end\nerror = raise\nsetmetatable = __bmsx_setmetatable` },
				{ path: 'coroutine', source: await readFile('machine/bios/coroutine.lua', 'utf8') },
			],
			cartSource: `module<entry>\nerror('do not run the game for unit cases')`,
		});
		const media = await loadRomToolingMedia(fixture.systemRom, [fixture.cartRom, null]);
		const sources = createRuntimeSourceState(media.system, media.cartridgeSlots);
		const authoring = new OffscreenMachine(fixture.systemRom, [fixture.cartRom, null], PSX_MACHINE_SPEC, new TestInput());
		const tooling = new RuntimeLuaTooling(sources, new SuspendedGuestSession(authoring.runtime));
		const targets: OffscreenMachine<TestInput>[] = [];
		const disposed = new Set<OffscreenMachine<TestInput>>();
		let constructionFailure: Error | undefined;
		const models = new EditorTextModelService();
		const runs = new ScenarioRunService(models, sources, tooling, new MemoryStorage(), new Map(), PSX_MACHINE_SPEC,
			(systemRom, cartridges, model, input) => {
				if (constructionFailure) throw constructionFailure;
				const target = new OffscreenMachine(systemRom, cartridges, model, input);
				assert.notEqual(input, authoring.input);
				const dispose = target.dispose.bind(target);
				target.dispose = () => { assert.equal(disposed.has(target), false); disposed.add(target); dispose(); };
				targets.push(target);
				return target;
			});
		const collection = runs.collection;
		const module = collection.findModuleBySourcePath(0, SCENARIO_FIXTURE_TEST_SOURCE_PATH);
		// A saved source-only helper does not dirty the gameplay image. Test compilation
		// still consumes it, independently of unsaved editor models.
		const helper = sources.cartridgeSlots[0]!.luaSources.module2lua['testlib/fixture'];
		helper.src = helper.base_src = `return 'edited helper'`;
		workspaceDirtyRecords.set(buildWorkspaceDirtyEntryPath(sources.cartridgeSlots[0]!.projectRootPath, 0, helper.source_path),
			{ contents: 'return "foreign helper"', updatedAt: helper.update_timestamp + 1 });
		const suite = models.retain(sources.luaResources.find(resource => resource.path === SCENARIO_FIXTURE_TEST_SOURCE_PATH)!, 'lua', source);
		suite.pushEditOperations([{ offset: source.indexOf('first ='), deleteLength: 5, text: 'captured' }]);
		const capturedVersion = suite.version;
		const capturedSource = suite.buffer.getText();
		editorTextModelService.retain(suite.resource, 'lua', 'end end -- foreign document');
		const helperModel = models.retain(sources.luaResources.find(resource => resource.path === helper.source_path)!, 'lua', helper.src);
		const originalState = captureRuntimeMachineState(authoring.runtime);
		const originalMedia = sources.currentBlua32Media;
		const originalSource = sources.cartridgeSlots[0]!.luaSources.module2lua['testlib/fixture'].src;
		const accepted = runs.start(module.id);
		let completed = false;
		const completion = runs.wait(accepted).then(run => { completed = true; return run; });
		suite.pushEditOperations([{ offset: 0, deleteLength: suite.buffer.length, text: 'end end -- later typing' }]);
		helperModel.pushEditOperations([{ offset: 0, deleteLength: helperModel.buffer.length, text: 'return "later helper"' }]);
		for (let preparation = 0; runs.active && runs.session?.execution == null && preparation < 10000; preparation++) await setImmediate();
		assert.equal(completed, false, 'preparation is not test completion');
		for (let grants = 0; runs.active && grants < 10000; grants += 1) {
			runs.advance();
			await setImmediate();
		}
		assert.equal(runs.active, false);
		assert.equal(await completion, accepted);
		assert.equal(completed, true);
		assert.deepEqual(runs.results.runs[0].items.map(item => item.state), ['passed', 'failed', 'passed']);
		assert.equal(runs.results.runs[0].items[0].test.caseName, 'captured');
		assert.equal(runs.results.runs[0].items[0].sourceRevision, capturedVersion);
		const recorded = runs.results.runs[0].items[0];
		assert.equal(recorded.source, capturedSource);
		suite.undo(); helperModel.undo();
		assert.equal(targets.length, 3, 'product construction runs once per case');
		assert.equal(new Set(targets.map(target => target.input)).size, 3, 'each case supplies its own input');
		assert.deepEqual([...disposed], [targets[0], targets[2]], 'only the failed machine remains retained');
		assert.equal(runs.session!.failedExecution!.result.test.caseName, 'second');
		assert.notEqual(runs.session!.failedExecution!.target.runtime, authoring.runtime);
		assert.deepEqual(captureRuntimeMachineState(authoring.runtime), originalState);
		assert.equal(sources.currentBlua32Media, originalMedia);
		assert.equal(sources.cartridgeSlots[0]!.luaSources.module2lua['testlib/fixture'].src, originalSource);
		assert.equal(sources.cartridgeBlua32MediaDirty[0], false);
		const addedSource = "local helper = require('testlib/fixture')\nreturn { kind = 'unit', tests = { added = function() assert(helper == 'edited helper') end } }";
		const added = createScenarioTestSourceRecord('tests/carts/example/new_assert.lua', 99, addedSource);
		registerLuaSourceRecord(sources.cartridgeSlots[0]!.luaSources, added);
		sources.cartridgeBlua32MediaDirty[0] = true; // The workspace admission owner marks this build input.
		collection.refresh();
		const addedModule = collection.findModuleBySourcePath(0, added.source_path);
		runs.start(addedModule.id);
		assert.equal(disposed.has(targets[1]), true, 'a new run releases the previous failed machine');
		for (let grant = 0; runs.active && grant < 10000; grant++) { runs.advance(); await setImmediate(); }
		assert.equal(runs.active, false);
		assert.equal(runs.results.runs[0].state, 'passed', JSON.stringify(runs.results.runs[0].items[0].failures));
		assert.deepEqual(captureRuntimeMachineState(authoring.runtime), originalState);
		assert.equal(sources.currentBlua32Media, originalMedia);
		assert.equal(added.src, addedSource);
		constructionFailure = new Error('offscreen machine could not be constructed');
		await runs.wait(runs.start(addedModule.id));
		assert.equal(runs.active, false);
		assert.equal(runs.results.runs[0].items[0].failures[0].phase, 'prepare');
		assert.equal(runs.results.runs[0].items[0].failures[0].message, constructionFailure.message);
		assert.deepEqual(captureRuntimeMachineState(authoring.runtime), originalState);
		constructionFailure = undefined;
		const targetCount = targets.length;
		const restoring = runs.start(addedModule.id);
		models.clear(); // Autosave restoration replaces models without replacing the workbench.
		await runs.wait(restoring);
		await setImmediate();
		assert.equal(runs.results.runs[0].state, 'cancelled');
		assert.equal(runs.active, false); assert.equal(runs.session, null);
		assert.equal(targets.length, targetCount, 'retired preparation cannot construct a target');
		runs.start(addedModule.id);
		for (let grant = 0; runs.active && grant < 10000; grant++) { runs.advance(); await setImmediate(); }
		assert.equal(runs.results.runs[0].state, 'passed', 'rehydrated workspace can run again');
		const shuttingDown = runs.start(addedModule.id);
		runs.dispose();
		await runs.wait(shuttingDown);
		await setImmediate();
		assert.equal(runs.results.runs[0].state, 'cancelled');
		assert.equal(targets.length, targetCount + 1, 'shutdown cannot publish a pending target');
		assert.throws(() => runs.start(addedModule.id), /closed/);
		models.clear(); editorTextModelService.clear();
		assert.equal(recorded.source, capturedSource, 'target and document disposal cannot rewrite recorded suite evidence');
		assert.equal(disposed.size, targets.length);
		authoring.dispose();
	} finally { await rm(directory, { recursive: true, force: true }); }
});

test('both authoring domains retain companion ROM data and source identity; runner errors stop the run', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-test-slots-'));
	try {
		const source = `return { kind = 'integration', tests = {
 companion = function(t)
  t:wait_ticks(1)
  assert(mem[${IO_CART_STATUS}] & 3 == 3)
  mem[${IO_CART_SELECT}] = 1
  assert(mem[0x10000000] ~= 0)
  mem[${IO_CART_SELECT}] = 0
 end,
 location = function() error('source identity') end,
 after = function() end,
} }`;
		const fixture = await buildScenarioMediaFixture(directory, [{ path: SCENARIO_FIXTURE_TEST_SOURCE_PATH, source }], {
			systemSource: `module<entry>\nrequire('base')\ncoroutine = require('coroutine')\ncop0.exec = mem[0x10000028]`,
			systemModules: [
				{ path: 'base', source: `local raise<const> = __bmsx_error\nassert = function(value, message) if not value then raise(message) end return value end\nerror = raise\nsetmetatable = __bmsx_setmetatable` },
				{ path: 'coroutine', source: await readFile('machine/bios/coroutine.lua', 'utf8') },
			], cartSource: `module<entry>\nwhile true do halt_until_irq end`,
		});
		const media = await loadRomToolingMedia(fixture.systemRom, [fixture.cartRom, fixture.cartRom]);
		const sources = createRuntimeSourceState(media.system, media.cartridgeSlots);
		const authoring = new OffscreenMachine(fixture.systemRom, [fixture.cartRom, null], PSX_MACHINE_SPEC, new TestInput());
		const tooling = new RuntimeLuaTooling(sources, new SuspendedGuestSession(authoring.runtime));
		const models = new EditorTextModelService();
		const runs = new ScenarioRunService(models, sources, tooling, new MemoryStorage(), new Map(), PSX_MACHINE_SPEC,
			(systemRom, cartridges, model, input) => new OffscreenMachine(systemRom, cartridges, model, input));
		const collection = runs.collection;
		for (const slot of [0, 1] as const) {
			enterCartridgeSources(sources, slot);
			assert.equal(collection.refresh(), slot === 1, 'owner change matters even at equal registry revision');
			assert.equal(collection.roots[0].domain, slot);
			assert.equal(collection.refresh(), false);
			const module = collection.findModuleBySourcePath(slot, SCENARIO_FIXTURE_TEST_SOURCE_PATH);
			runs.start(module.id);
			for (let grant = 0; runs.active && grant < 10000; grant++) { runs.advance(); await setImmediate(); }
			assert.equal(runs.active, false);
			assert.deepEqual(runs.results.runs[0].items.map(item => item.state), ['passed', 'failed', 'passed']);
			assert.equal(runs.results.runs[0].items[1].failures[0].location!.resource.domain, slot);
			assert.equal(runs.results.runs[0].items[1].failures[0].location!.resource.path, SCENARIO_FIXTURE_TEST_SOURCE_PATH);
			runs.start(module.id);
			for (let preparation = 0; runs.active && runs.session?.execution == null && preparation < 10000; preparation++) await setImmediate();
			runs.session!.execution!.advance = () => { throw new Error('infrastructure failure'); };
			runs.advance();
			assert.equal(runs.active, false);
			assert.deepEqual(runs.results.runs[0].items.map(item => item.state), ['failed', 'skipped', 'skipped']);
			assert.equal(runs.results.runs[0].items[0].failures[0].phase, 'runner');
		}
		runs.dispose(); models.clear(); editorTextModelService.clear(); authoring.dispose();
	} finally { await rm(directory, { recursive: true, force: true }); }
});
