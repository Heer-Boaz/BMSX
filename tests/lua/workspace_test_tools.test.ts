import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { getEventListeners } from 'node:events';
import { WorkspaceTestTools } from '../../ide/workbench/services/assistant/test_tools';
import { StudioToolInputError } from '../../ide/workbench/services/assistant/tool_input';
import { ScenarioResultService, SCENARIO_RUN_RETAIN_COUNT, SCENARIO_RESULT_LOG_RETAIN_COUNT,
	SCENARIO_RESULT_CAPTURE_RETAIN_COUNT, SCENARIO_RESULT_FSM_TRANSITION_RETAIN_COUNT, SCENARIO_RESULT_ACTIONEFFECT_FACT_RETAIN_COUNT } from '../../ide/testing/scenario/result_service';
import { ScenarioTestCollection } from '../../ide/testing/scenario/test_collection';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext) {
	const source = "-- captured 🐉\r\nreturn { kind = 'unit', tests = { sample = function() assert(false) end } }\r\n";
	const collection = new ScenarioTestCollection(createScenarioTestSourceState([createScenarioTestSourceRecord('suite_assert.lua', 7, source)]));
	const module = collection.roots[0].children[0], item = module.children[0];
	const owner = new ScenarioResultService(), connection = new AbortController();
	const run = owner.beginRun(module.id, [{ test: item, source, sourceRevision: 7 }]);
	const tools = new WorkspaceTestTools(owner, connection.signal);
	t.after(() => { tools.dispose(); connection.abort(); });
	const catalog = tools.execute('studio_list_test_runs', {}); assert.ok(catalog.kind === 'test-runs');
	const read = tools.execute('studio_read_test_run', { run: catalog.data.runs[0].run }); assert.ok(read.kind === 'test-run');
	return { source, collection, module, owner, connection, run, tools, handle: catalog.data.runs[0].run, resultHandle: read.data.cases[0].result };
}

test('test evidence lists only prompt-admitted runs; no history is not a passing workspace', () => {
	const owner = new ScenarioResultService(), signal = new AbortController();
	const tools = new WorkspaceTestTools(owner, signal.signal);
	assert.deepEqual(tools.execute('studio_list_test_runs', {}), { kind: 'test-runs', data: { coverage: 'retained-studio-runs', revision: 0, runs: [] } });
	const module = new ScenarioTestCollection(createScenarioTestSourceState([createScenarioTestSourceRecord('suite_assert.lua', 1)])).roots[0].children[0];
	owner.beginRun(module.id, [{ test: module.children[0], source: module.source, sourceRevision: 1 }]);
	const current = tools.execute('studio_list_test_runs', {}); assert.ok(current.kind === 'test-runs');
	assert.deepEqual(current.data.runs, [], 'a later run is not silently adopted by an older prompt');
	signal.abort();
});

test('catalog and case summaries do not read source/output; explicit reads cache snapshots without frame work', t => {
	const f = fixture(t), result = f.run.items[0];
	let sourceReads = 0;
	Object.defineProperty(result, 'source', { get: () => { sourceReads++; return f.source; } });
	const first = f.tools.execute('studio_list_test_runs', {});
	for (let index = 0; index < 1000; index++) {
		assert.equal(f.tools.execute('studio_list_test_runs', {}).data, first.data);
		f.tools.execute('studio_read_test_run', { run: f.handle });
	}
	assert.equal(sourceReads, 0);
	const read = f.tools.execute('studio_read_test_result', { result: f.resultHandle }); assert.ok(read.kind === 'test-result');
	assert.equal(read.data.state, 'queued'); assert.equal(read.data.sourceCoverage, 'accepted-suite-only');
	for (let index = 0; index < 1000; index++) assert.equal(f.tools.execute('studio_read_test_result', { result: f.resultHandle }).data, read.data);
	assert.equal(sourceReads, 1);
	f.collection.updateSource(f.module, f.source.replace('false', 'true'), 7);
	assert.equal(read.data.source, f.source, 'matching current revision is not historical source provenance');
});

test('preparing, presentation and terminal reads preserve earlier snapshots and multiple phase failures', t => {
	const f = fixture(t), result = f.owner.startItem(f.run, 0, 20);
	f.owner.requestCapture(result, 21, 'pending image');
	const before = f.tools.execute('studio_read_test_result', { result: f.resultHandle }); assert.ok(before.kind === 'test-result');
	assert.equal(before.data.state, 'preparing'); assert.equal(before.data.captures.entries[0].presentedFrame, null);
	f.owner.markRunning(result); f.owner.recordPresentation(result, 42);
	f.owner.recordFailure(result, { message: 'body failed\nexact tail 🐉', phase: 'body' });
	f.owner.fail(result, 24, { message: 'teardown also failed', phase: 'teardown' }, null);
	f.owner.completeRun(f.run);
	const after = f.tools.execute('studio_read_test_result', { result: f.resultHandle }); assert.ok(after.kind === 'test-result');
	assert.equal(before.data.state, 'preparing'); assert.deepEqual(before.data.failures, []);
	assert.equal(before.data.captures.entries[0].presentedFrame, null);
	assert.equal(after.data.state, 'failed'); assert.equal(after.data.captures.entries[0].presentedFrame, 42);
	assert.deepEqual(after.data.failures.map(failure => failure.phase), ['body', 'teardown']);
	assert.equal(after.data.failures[0].message, 'body failed\nexact tail 🐉');
	const summary = f.tools.execute('studio_read_test_run', { run: f.handle }); assert.ok(summary.kind === 'test-run');
	assert.equal(summary.data.failedCount, 1); assert.equal(summary.data.state, 'failed');
});

test('retained output reports every omitted record and preserves raw trace words and ordered metadata', t => {
	const f = fixture(t), result = f.owner.startItem(f.run, 0, 0);
	for (let index = 0; index < SCENARIO_RESULT_LOG_RETAIN_COUNT + 4; index++) f.owner.appendLog(result, index, `log ${index}`);
	for (let index = 0; index < SCENARIO_RESULT_CAPTURE_RETAIN_COUNT + 2; index++) f.owner.requestCapture(result, index, `capture ${index}`);
	const fsm = f.owner.beginFsmTransitionTrace(result, 'instance', 'machine');
	for (let index = 0; index < SCENARIO_RESULT_FSM_TRANSITION_RETAIN_COUNT + 1; index++) f.owner.appendFsmTransition(fsm, index, 0xffffffff, index, 'lane', 'from', 'to', 'committed');
	const effects = f.owner.beginActionEffectTrace(result, 'owner', 'definition');
	for (let index = 0; index < SCENARIO_RESULT_ACTIONEFFECT_FACT_RETAIN_COUNT + 3; index++) f.owner.appendActionEffectTrigger(effects, index, 0x80000000, index, 'effect', 'accepted');
	const value = f.tools.execute('studio_read_test_result', { result: f.resultHandle }); assert.ok(value.kind === 'test-result');
	const data = JSON.parse(JSON.stringify(value.data));
	assert.deepEqual([data.logs.omitted, data.captures.omitted, data.fsmTransitionTrace.transitions.omitted, data.actionEffectTrace.facts.omitted], [4, 2, 1, 3]);
	assert.equal(data.logs.entries[0].text, 'log 4'); assert.equal(data.captures.entries[0].label, 'capture 2');
	assert.equal(data.fsmTransitionTrace.transitions.entries[0].producerTimeMillisecondsWord, 0xffffffff);
	assert.equal(data.actionEffectTrace.facts.entries[0].producerTimeMillisecondsWord, 0x80000000);
	assert.equal(data.captures.entries[0].presentedFrame, null);
	assert.equal(data.source, f.source);
});

test('foreign handles, eviction and connection retirement cannot reuse cached evidence', t => {
	const f = fixture(t), peer = new WorkspaceTestTools(f.owner, f.connection.signal); t.after(() => peer.dispose());
	assert.throws(() => peer.execute('studio_read_test_run', { run: f.handle }), /does not belong/);
	assert.throws(() => peer.execute('studio_read_test_result', { result: f.resultHandle }), /must be read/);
	f.tools.execute('studio_read_test_result', { result: f.resultHandle });
	f.owner.cancelRun(f.run);
	for (let index = 0; index < SCENARIO_RUN_RETAIN_COUNT; index++) {
		const run = f.owner.beginRun(f.module.id, [{ test: f.module.children[0], source: f.source, sourceRevision: 7 }]);
		f.owner.cancelRun(run);
	}
	assert.throws(() => f.tools.execute('studio_read_test_run', { run: f.handle }), /no longer retained/);
	assert.throws(() => f.tools.execute('studio_read_test_result', { result: f.resultHandle }), /no longer retained/);
	const catalog = f.tools.execute('studio_list_test_runs', {}); assert.ok(catalog.kind === 'test-runs'); assert.deepEqual(catalog.data.runs, []);
	f.connection.abort();
	assert.throws(() => f.tools.execute('studio_list_test_runs', {}), /disposed/);
	assert.equal(getEventListeners(f.connection.signal, 'abort').length, 0);
});

test('test tool admission accepts only its declared read arguments, never a run or filesystem capability', t => {
	const f = fixture(t);
	for (const input of [null, [], { run: f.handle }, { cwd: '/tmp' }, { start: true }]) assert.throws(() => f.tools.execute('studio_list_test_runs', input), StudioToolInputError);
	for (const input of [{}, { run: 1 }, { run: f.handle, rerun: true }]) assert.throws(() => f.tools.execute('studio_read_test_run', input), StudioToolInputError);
	for (const input of [{}, { result: false }, { result: f.resultHandle, source: '/etc/passwd' }]) assert.throws(() => f.tools.execute('studio_read_test_result', input), StudioToolInputError);
	assert.throws(() => f.tools.execute('studio_run_tests', {}), StudioToolInputError);
	assert.equal(f.owner.runs.length, 1); assert.equal(f.run.items[0].state, 'queued');
});
