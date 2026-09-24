import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { buildScenarioMediaFixture, SCENARIO_FIXTURE_TEST_SOURCE_PATH } from '../helpers/scenario_media';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { createRuntimeSourceState, enterCartridgeSources } from '../../ide/runtime/sources';
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
import { TestTargetInspectionModel } from '../../ide/workbench/contrib/scenario_lab/target_inspection_model';
import { decodeTestToolRequest } from '../../ide/workbench/services/assistant/test_tool_protocol';

for (const slot of [0, 1] as const) test(`socket ${slot}: post-mortem tools read the failed phase threads, accepted sources and after-cleanup heap`, async t => {
	const directory = await mkdtemp(join(tmpdir(), 'bmsx-test-inspection-'));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const source = `local shared = { answer = 10 }
shared.self = shared
local function fail(value, ...)
 local same = { amount = value }
 error('body failed')
 return shared, same
end
return { kind = 'unit',
 teardown = function(t)
  local same = { amount = 22 }
  shared.answer = 99
  test_global = shared
  error('cleanup failed')
  return same
 end,
 tests = { fails = function() return fail(11) end },
}`;
	const media = await buildScenarioMediaFixture(directory, [{ path: SCENARIO_FIXTURE_TEST_SOURCE_PATH, source }], {
		systemSource: "module<entry>\nrequire('base')\ncoroutine = require('coroutine')\ncop0.exec = mem[0x10000028]",
		systemModules: [
			{ path: 'base', source: 'local raise<const> = __bmsx_error\nassert = function(value, message) if not value then raise(message) end return value end\nerror = function(message) raise(message) end\nsetmetatable = __bmsx_setmetatable' },
			{ path: 'coroutine', source: await readFile('machine/bios/coroutine.lua', 'utf8') },
		], cartSource: 'module<entry>\nwhile true do halt_until_irq end',
	});
	const loaded = await loadRomToolingMedia(media.systemRom, [media.cartRom, media.cartRom]);
	const sources = createRuntimeSourceState(loaded.system, loaded.cartridgeSlots), models = new EditorTextModelService();
	enterCartridgeSources(sources, slot); sources.realtimeCompileOptLevel = 0;
	const authoring = new OffscreenMachine(media.systemRom, [media.cartRom, media.cartRom], PSX_MACHINE_SPEC, new TestInput());
	const initial = captureRuntimeMachineState(authoring.runtime), installed = sources.currentBlua32Media;
	const service = new ScenarioRunService(models, sources, new RuntimeLuaTooling(sources, new SuspendedGuestSession(authoring.runtime)),
		new MemoryStorage(), new Map(), PSX_MACHINE_SPEC, (bios, carts, model, input) => new OffscreenMachine(bios, carts, model, input));
	const connection = new AbortController(), tools = new WorkspaceTestTools(service, connection.signal);
	t.after(() => { tools.dispose(); service.dispose(); models.clear(); authoring.dispose(); });
	async function finish() {
		for (let grant = 0; service.active && grant < 10000; grant++) { service.advance(); await setImmediate(); }
		assert.equal(service.active, false);
	}
	const document = models.retain(sources.luaResources.find(resource => resource.domain === slot && resource.path === SCENARIO_FIXTURE_TEST_SOURCE_PATH)!, 'lua', source);
	const discovered = await tools.execute('studio_list_tests', {}); assert.ok(discovered.kind === 'tests');
	const scope = discovered.data.roots[0].modules[0].scope;
	const admission = await tools.execute('studio_start_test_run', { scope }); assert.ok(admission.kind === 'test-run');
	assert.throws(() => tools.execute('studio_inspect_test_target', { result: admission.data.cases[0].result }), /retained failed test target/);
	document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: source.replace('10', '500') }]);
	await finish();
	const run = await tools.execute('studio_wait_test_run', { run: admission.data.run }); assert.ok(run.kind === 'test-run');
	assert.equal(run.data.state, 'failed');
	const result = service.results.runs[0].items[0];
	assert.deepEqual(result.failures.map(f => f.phase), ['body', 'teardown']);
	const attached = await tools.execute('studio_inspect_test_target', { result: run.data.cases[0].result }); assert.ok(attached.kind === 'test-inspection');
	assert.equal(attached.data.heap, 'retained-at-case-end'); assert.equal(attached.data.canResume, false);
	assert.equal(attached.data.failures.length, 2);
	const runtime = service.session!.failedExecution!.target.runtime, before = captureRuntimeMachineState(runtime);
	const sameTables: string[] = [];
	for (const failure of attached.data.failures) {
		assert.equal(failure.origin, 'failed-thread');
		const stack = await tools.execute('studio_read_test_stack', { failure: failure.reference, start: 0, count: 100 }); assert.ok(stack.kind === 'test-stack');
		const frames = stack.data.frames.filter(frame => frame.kind === 'source' && frame.resource.domain === slot);
		assert.ok(frames.length > 0); assert.ok(frames.every(frame => frame.domain === 0));
		const bios = stack.data.frames.find(frame => frame.domain === -1)!;
		const biosSource = await tools.execute('studio_read_test_frame_source', { frame: bios.reference }); assert.ok(biosSource.kind === 'test-frame-source');
		assert.equal(biosSource.data.status, 'available'); assert.match(biosSource.data.text!, /raise\(message\)/);
		let foundSame = false;
		for (const frame of frames) {
			const compiled = await tools.execute('studio_read_test_frame_source', { frame: frame.reference }); assert.ok(compiled.kind === 'test-frame-source');
			assert.equal(compiled.data.text, source);
			const scopes = await tools.execute('studio_read_test_frame_scopes', { frame: frame.reference }); assert.ok(scopes.kind === 'test-frame-scopes');
			for (const scope of scopes.data.scopes) {
				if (scope.reference === undefined) continue;
				const values = await tools.execute('studio_read_test_values', { reference: scope.reference, start: 0, count: 100 }); assert.ok(values.kind === 'test-values');
				for (const entry of values.data.entries) {
					if (entry.key.display !== 'same' && entry.key.display !== 'shared') continue;
					assert.equal(entry.value.kind, 'table');
					const table = await tools.execute('studio_read_test_values', { reference: entry.value.reference, start: 0, count: 100 }); assert.ok(table.kind === 'test-values');
					if (entry.key.display === 'same') {
						foundSame = true; sameTables.push(entry.value.reference!);
						assert.equal(table.data.entries.find(e => e.key.display === 'amount')!.value.display, failure.phase === 'body' ? '11' : '22');
					} else {
						assert.equal(table.data.entries.find(e => e.key.display === 'answer')!.value.display, '99', 'teardown mutates shared heap, not immutable fault state');
						assert.equal(table.data.entries.find(e => e.key.display === 'self')!.value.reference, entry.value.reference);
					}
				}
			}
		}
		assert.ok(foundSame, `inspect ${failure.phase} own locals, not CPU's active root`);
	}
	assert.equal(new Set(sameTables).size, 2);
	const globals = attached.data.globals.find(scope => scope.domain === 0)!;
	assert.equal(globals.sourceDomain, slot);
	const globalValues = await tools.execute('studio_read_test_values', { reference: globals.reference, start: 0, count: globals.count }); assert.ok(globalValues.kind === 'test-values');
	assert.equal(globalValues.data.entries.find(e => e.key.display === 'test_global')!.value.kind, 'table');
	assert.deepEqual(captureRuntimeMachineState(runtime), before, 'inspection never executes, allocates guest objects, or changes CPU/media');

	const ordinary = service.inspect(result), model = new TestTargetInspectionModel(ordinary);
	const root = model.tree.roots[0]; assert.equal(root.expandable, true); assert.equal(root.children.length, 0);
	root.collapsed = false; model.resolve(root); assert.ok(root.children.length > 0);
	const uiFrame = root.children.find(node => node.element.frame !== undefined)!;
	uiFrame.collapsed = false; model.resolve(uiFrame); assert.equal(uiFrame.children.length, 2);
	const scopeNode = uiFrame.children.find(node => node.expandable)!;
	scopeNode.collapsed = false; model.resolve(scopeNode); assert.ok(scopeNode.children.length > 0);
	const replaced = await tools.execute('studio_inspect_test_target', { result: run.data.cases[0].result }); assert.ok(replaced.kind === 'test-inspection');
	assert.equal(replaced.data.target, attached.data.target); assert.notEqual(replaced.data.inspection, attached.data.inspection);
	assert.throws(() => tools.execute('studio_read_test_stack', { failure: attached.data.failures[0].reference, start: 0, count: 1 }), /does not belong/);
	assert.throws(() => tools.execute('studio_read_test_values', { reference: sameTables[0], start: 0, count: 1 }), /does not belong/);
	tools.dispose(); assert.equal(ordinary.available, true, 'prompt retirement does not release the UI borrow or physical target');
	const newTools = new WorkspaceTestTools(service, new AbortController().signal);
	assert.throws(() => newTools.execute('studio_read_test_stack', { failure: attached.data.failures[0].reference, start: 0, count: 1 }), /Open a retained/);
	newTools.dispose();
	let disposals = 0;
	ordinary.onDidDispose(() => { disposals++; assert.equal(ordinary.available, false); });
	const next = service.start(service.collection.roots[0].id);
	assert.equal(disposals, 1); ordinary.dispose(); assert.equal(disposals, 1, 'retirement is immediate and emitted once');
	assert.equal(ordinary.available, false); assert.throws(() => ordinary.readStack(attached.data.failures[0].reference!, 0, 1), /expired/);
	assert.equal(service.canInspect(result), false); assert.throws(() => service.inspect(result), /no longer/);
	assert.equal(result.source, source, 'historical accepted evidence remains independent of target disposal');
	service.cancel(next); await service.wait(next);
	const closedSource = `local execution<const> = require('testlib/execution')
return { kind = 'unit', teardown = function() execution.cancel('body') end,
 tests = { closed = function() error('closed by cleanup') end } }`;
	document.pushEditOperations([{ offset: 0, deleteLength: document.buffer.length, text: closedSource }]);
	const closedRun = service.start(service.collection.roots[0].id); await finish();
	const closed = service.inspect(closedRun.items[0]);
	assert.equal(closed.state.failures[0].status, 'thread-closed', 'a guest-closed activation is historical evidence, not a live stack');
	assert.equal(closed.state.failures[0].reference, undefined);
	closed.dispose();
	assert.deepEqual(captureRuntimeMachineState(authoring.runtime), initial); assert.equal(sources.currentBlua32Media, installed);
});

test('test inspection protocol admits only declared external handles and page coordinates', () => {
	for (const name of ['studio_read_test_values', 'studio_read_test_stack']) {
		const field = name.endsWith('stack') ? 'failure' : 'reference';
		for (const count of [0, -1, 1.5, '2']) assert.throws(() => decodeTestToolRequest(name, { [field]: 'x', start: 0, count }));
		assert.throws(() => decodeTestToolRequest(name, { [field]: 'x', start: 0, count: 1, target: 'authoring' }), /declared/);
	}
	assert.throws(() => decodeTestToolRequest('studio_inspect_test_target', { result: 5 }));
	assert.throws(() => decodeTestToolRequest('studio_read_test_frame_source', { frame: 'x', path: '/etc/passwd' }), /declared/);
});
