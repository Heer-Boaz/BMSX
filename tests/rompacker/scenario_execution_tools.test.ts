import { COROUTINE_FIRMWARE_MODULES } from '../helpers/firmware_modules';
import assert from 'node:assert/strict';
import test from 'node:test';
import { getEventListeners } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { buildScenarioMediaFixture, SCENARIO_FIXTURE_TEST_SOURCE_PATH } from '../helpers/scenario_media';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { createRuntimeSourceState } from '../../ide/runtime/sources';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { ScenarioRunService } from '../../ide/workbench/services/testing/scenario_runs';
import { WorkspaceTestTools } from '../../ide/workbench/services/assistant/test_tools';
import { MemoryStorage } from '../../ide/workspace/memory_storage';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { TestInput } from '../../ide/testing/input';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';
import { captureRuntimeMachineState } from '../../machine/ts/machine/runtime/machine_state';

test('tool execution uses actual isolated cases, source admission, terminal waits and run-specific cancellation', async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-test-tools-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const source = `local helper<const> = require('testlib/fixture')
return { kind = 'integration',
 teardown = function(t) t:log('cleanup begins'); t:wait_ticks(2); t:log('cleanup ends') end,
 tests = {
  passes = function(t) t:log('original'); t:wait_ticks(2) end,
  fails = function() error('recorded failure') end,
  waits = function(t) t:log('body entered'); t:wait_ticks(2990) end,
 }
}`;
	const media = await buildScenarioMediaFixture(directory, [{ path: SCENARIO_FIXTURE_TEST_SOURCE_PATH, source }], {
		systemSource: "module<entry>\nrequire('base')\ncoroutine = require('coroutine')\ncop0.exec = mem[0x10000028]",
		systemModules: [
			{ path: 'base', source: 'local raise<const> = __bmsx_error\nassert = function(value, message) if not value then raise(message) end return value end\nerror = raise\nsetmetatable = __bmsx_setmetatable' },
			...COROUTINE_FIRMWARE_MODULES,
		], cartSource: 'module<entry>\nwhile true do halt_until_irq end',
	});
	const loaded = await loadRomToolingMedia(media.systemRom, [media.cartRom, null]);
	const sources = createRuntimeSourceState(loaded.system, loaded.cartridgeSlots), models = new EditorTextModelService();
	const authoring = new OffscreenMachine(media.systemRom, [media.cartRom, null], PSX_MACHINE_SPEC, new TestInput());
	const initial = captureRuntimeMachineState(authoring.runtime), installed = sources.currentBlua32Media;
	const targets: OffscreenMachine<TestInput>[] = [];
	const service = new ScenarioRunService(models, sources, new RuntimeLuaTooling(sources, new SuspendedGuestSession(authoring.runtime)),
		new MemoryStorage(), new Map(), PSX_MACHINE_SPEC, (bios, carts, model, input) => {
			const target = new OffscreenMachine(bios, carts, model, input); targets.push(target); return target;
		});
	const connection = new AbortController(), tools = new WorkspaceTestTools(service, connection.signal);
	t.after(() => { tools.dispose(); service.dispose(); models.clear(); authoring.dispose(); });
	async function advanceUntil(predicate: () => boolean) {
		for (let grant = 0; !predicate() && grant < 10000; grant++) { service.advance(); await setImmediate(); }
		assert.ok(predicate(), 'bounded host driver must reach the requested boundary');
	}
	const document = models.retain(sources.luaResources.find(resource => resource.path === SCENARIO_FIXTURE_TEST_SOURCE_PATH)!, 'lua', source);
	const discovery = await tools.execute('studio_list_tests', {}); assert.ok(discovery.kind === 'tests');
	const module = discovery.data.roots[0].modules[0];
	const passScope = module.cases.find(item => item.name === 'passes')!.scope, waitScope = module.cases.find(item => item.name === 'waits')!.scope;
	const acceptedSource = source.replace("'original'", "'accepted after discovery'");
	document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: acceptedSource }]);
	const acceptedVersion = document.version;
	const admission = tools.execute('studio_start_test_run', { scope: passScope });
	document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: source.replace("'original'", "'later typing'") }]);
	const started = await admission; assert.ok(started.kind === 'test-run');
	assert.equal(started.data.state, 'running'); assert.equal(started.data.canCancel, true);
	assert.equal(started.data.cases[0].sourceRevision, acceptedVersion);
	const record = service.results.liveRun!;
	assert.throws(() => tools.execute('studio_start_test_run', { scope: passScope }), /already active/);
	let settled = false;
	const waiting = Promise.resolve(tools.execute('studio_wait_test_run', { run: started.data.run })).then(result => { settled = true; return result; });
	for (let prepare = 0; service.session?.execution == null && prepare < 10000; prepare++) await setImmediate();
	assert.equal(settled, false, 'a prepared target is not a completed case');
	await advanceUntil(() => !service.active);
	const passed = await waiting; assert.ok(passed.kind === 'test-run');
	assert.equal(passed.data.state, 'passed'); assert.equal(passed.data.canCancel, false);
	const evidence = await tools.execute('studio_read_test_result', { result: passed.data.cases[0].result }); assert.ok(evidence.kind === 'test-result');
	assert.equal(evidence.data.source, acceptedSource);
	assert.deepEqual(evidence.data.logs.entries.map(log => log.text), ['accepted after discovery', 'cleanup begins', 'cleanup ends']);
	assert.equal(started.data.state, 'running', 'old admission snapshots are immutable observations');
	assert.deepEqual(captureRuntimeMachineState(authoring.runtime), initial); assert.equal(sources.currentBlua32Media, installed);

	const pending = await tools.execute('studio_start_test_run', { scope: waitScope }); assert.ok(pending.kind === 'test-run');
	const active = service.results.liveRun!;
	await advanceUntil(() => active.items[0].logs.length > 0);
	service.advance(); service.advance(); // Complete the log callback and enter the long ordinary tick wait.
	assert.equal(service.cancel(record), false, 'an old run identity cannot cancel the new one');
	const aborted = new AbortController();
	const abortedWait = service.wait(active, aborted.signal);
	assert.equal(getEventListeners(aborted.signal, 'abort').length, 1);
	const rejection = assert.rejects(abortedWait, /observer left/); aborted.abort(new Error('observer left')); await rejection;
	assert.equal(getEventListeners(aborted.signal, 'abort').length, 0);
	assert.equal(active.state, 'running', 'aborting a wait does not cancel its run');
	const request = new AbortController();
	const requestWait = assert.rejects(Promise.resolve(tools.execute('studio_wait_test_run', { run: pending.data.run }, request.signal)), /request cancelled/);
	request.abort(new Error('request cancelled')); await requestWait;
	assert.equal(active.state, 'running', 'cancelling one tool wait leaves prompt-owned execution intact');
	const peer = new WorkspaceTestTools(service, connection.signal);
	const peerRuns = await peer.execute('studio_list_test_runs', {}); assert.ok(peerRuns.kind === 'test-runs');
	assert.equal(peerRuns.data.runs[0].canCancel, false);
	assert.throws(() => peer.execute('studio_cancel_test_run', { run: peerRuns.data.runs[0].run }), /only runs it started/);
	const peerWait = assert.rejects(Promise.resolve(peer.execute('studio_wait_test_run', { run: peerRuns.data.runs[0].run })), /abort/i);
	peer.dispose(); await peerWait; assert.equal(active.state, 'running');
	const completedSignal = new AbortController(), completed = service.wait(active, completedSignal.signal);
	const cancelled = tools.execute('studio_cancel_test_run', { run: pending.data.run });
	const repeated = tools.execute('studio_cancel_test_run', { run: pending.data.run });
	assert.equal(active.state, 'running', 'cancellation waits for bounded teardown');
	await advanceUntil(() => !service.active);
	const cancelledResult = await cancelled; assert.ok(cancelledResult.kind === 'test-run');
	assert.equal((await repeated).data, cancelledResult.data);
	assert.equal(cancelledResult.data.state, 'cancelled'); assert.equal(cancelledResult.data.cancelledCount, 1);
	assert.equal(await completed, active); assert.equal(getEventListeners(completedSignal.signal, 'abort').length, 0);
	assert.equal(active.items[0].logs.at(active.items[0].logs.length - 1).text, 'cleanup ends');
	assert.deepEqual(active.items[0].failures, []);

	const manual = service.start(service.collection.roots[0].children[0].children.find(item => item.caseName === 'waits')!.id);
	const lateCancel = await tools.execute('studio_cancel_test_run', { run: pending.data.run }); assert.ok(lateCancel.kind === 'test-run');
	assert.equal(lateCancel.data.state, 'cancelled');
	tools.dispose(); assert.equal(manual.state, 'running', 'disposing old prompt authority cannot cancel a newer manual run');
	service.cancel(manual); await service.wait(manual);
	const detached = new WorkspaceTestTools(service, connection.signal);
	const fresh = await detached.execute('studio_list_tests', {}); assert.ok(fresh.kind === 'tests');
	const next = await detached.execute('studio_start_test_run', { scope: fresh.data.roots[0].modules[0].cases.find(item => item.name === 'waits')!.scope });
	assert.ok(next.kind === 'test-run'); const own = service.results.liveRun!;
	await advanceUntil(() => own.items[0].logs.length > 0); service.advance(); service.advance();
	const detachedWait = assert.rejects(Promise.resolve(detached.execute('studio_wait_test_run', { run: next.data.run })), /abort/i);
	connection.abort(); await detachedWait;
	await advanceUntil(() => !service.active);
	assert.equal(own.state, 'cancelled'); assert.equal(own.items[0].logs.at(own.items[0].logs.length - 1).text, 'cleanup ends');

	const helper = sources.luaResources.find(resource => resource.path === 'testlib/fixture.lua')!;
	models.retain(helper, 'lua', 'end end -- invalid dependency, valid test declaration');
	const beforeFailure = targets.length;
	const failed = service.start(service.collection.roots[0].id);
	await service.wait(failed);
	assert.equal(failed.state, 'failed'); assert.equal(failed.items[0].failures[0].phase, 'prepare');
	assert.equal(failed.skippedCount, 2); assert.equal(targets.length, beforeFailure);
	assert.equal(new Set(targets.map(target => target.runtime)).size, targets.length);
	assert.ok(targets.every(target => target.runtime !== authoring.runtime && target.input !== authoring.input));
	assert.deepEqual(captureRuntimeMachineState(authoring.runtime), initial); assert.equal(sources.currentBlua32Media, installed);
});
