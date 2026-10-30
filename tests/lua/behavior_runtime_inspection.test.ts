import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import { captureInstalledLuaSources } from '../../ide/runtime/source_registry';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { selectLuaProgramModules } from '../../toolchain/ts/lua/compiler/module_graph';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import type { LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { RuntimeTransport } from '../../ide/runtime/transport';
import { BehaviorRuntimeInspection } from '../../ide/workbench/contrib/behavior_lens/runtime_inspection';
import { readStateMachineInstances } from '../../ide/workbench/contrib/behavior_lens/state_machine_runtime';
import { parseLuaChunk, runCompletionClosure } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import type { HostRewind } from '../../hosts/common/rewind';
import { SuspendedValuePresentation } from '../../ide/runtime/value_presentation';
import { applyRuntimeSaveState, captureRuntimeSaveState, RuntimeRestoreOrigin } from '../../machine/ts/machine/runtime/save_state';
import { HistoryMode } from '../../machine/ts/machine/runtime/history/history';

/** Real guest tables/type bucket. Browser validation separately executes actual cartlib constructors. */
function fixture(historical = false) {
	const modules = [
		{ path: 'cartlib/fsm/fsm_component', source: 'return {}' },
		{ path: 'cartlib/registry', source: `local type<const> = require('cartlib/fsm/fsm_component')
return { _entries_by_key = { [type] = { items = {} } } }` },
	].map(module => ({ ...module, chunk: parseLuaChunk(module.source, `${module.path}.lua`) }));
	const source = `local registry<const> = require('cartlib/registry')
local type<const> = require('cartlib/fsm/fsm_component')
local state<const> = { id = 'root', localdef_id = 'test', current_id = 'a', states = {}, state_ids = {}, data = {
answer = 42, nested = { value = 7, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 }, [1] = 'numeric', ['1'] = 'string', [true] = 'boolean' },
definition = { def_id = 'root', on = {} } }
local component<const> = { id = 1, owner = { id = 2 }, enabled = true, _started = true,
_machines = { state }, _machines_by_id = { test = state } }
registry._entries_by_key[type].items[1] = component
function change() state.current_id = 'b' end
function change_data() state.data.answer = 43; state.data.nested.value = 8; state.data.nested[2] = 11 end
function trim_nested() state.data.nested[9] = nil; state.data.nested[10] = nil; state.data.nested.value = nil end
function grow_definition() state.definition.initial = 'a' end
function remove_component() registry._entries_by_key[type].items[1] = nil end
function restore_component() registry._entries_by_key[type].items[1] = component end
return component`;
	const chunk = parseLuaChunk(source, 'entry.lua');
	const compiled = compileLuaChunkToProgram(chunk, selectLuaProgramModules(chunk, modules, []), { entrySource: source, programDomain: 'system', optLevel: 0 });
	const image = linkTestSystemBlua32(compiled), runtime = createTestRuntime(image.romBytes), cpu = runtime.machine.cpu;
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', projectRootPath: '', can_boot_from_source: false, revision: 0 };
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports, captureInstalledLuaSources(registry, image.symbols!.metadata.compiledModulePaths), TEST_SYSTEM_CONTEXT_ID), cartridgeSlots: [null, null] };
	cpu.reset();
	const beforeBirth = cpu.captureRuntimeState();
	cpu.runUntilDepth(0, 100_000);
	const guest = new SuspendedGuestSession(runtime);
	runtime.history.onWillEndReview = () => guest.willEndHistoryReview();
	runtime.onStateRestored = origin => guest.invalidate(origin === RuntimeRestoreOrigin.HistorySeek ? 'history-restored' : 'heap-replaced');
	runtime.onStateReset = () => guest.invalidate('heap-replaced');
	const rewind = { active: historical, seeking: false, playing: false };
	const choice = readStateMachineInstances(sources, guest, -1).items[0];
	const transport = new RuntimeTransport(runtime, null!, rewind as HostRewind, null!, () => true);
	const inspection = new BehaviorRuntimeInspection(sources, guest, rewind as HostRewind, -1, sources.currentBlua32Media.system!,
		{ kind: 'state_machine', componentHashId: choice.component.hashId, machineHashId: choice.machine.hashId, stateHashId: choice.machine.hashId }, transport);
	return { runtime, cpu, guest, sources, rewind, inspection, transport, beforeBirth, choice };
}

test('visible behavior inspection compares completed observations, not paused refreshes, and reacquires history values', t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	const document = f.inspection.refresh()!, before = document.map(row => row.value), alive = f.cpu.captureRuntimeState();
	const current = document.find(row => row.value === 'a')!;
	assert.ok(document.every(row => row.valueChanged === false));
	let reads = 0;
	const read = f.guest.readStringMember.bind(f.guest), visit = f.guest.visitTableEntries.bind(f.guest);
	t.mock.method(f.guest, 'readStringMember', (...args: Parameters<typeof read>) => { reads++; return read(...args); });
	t.mock.method(f.guest, 'visitTableEntries', (...args: Parameters<typeof visit>) => { reads++; return visit(...args); });
	for (let paint = 0; paint < 1000; paint++) assert.equal(f.inspection.refresh(), undefined);
	assert.equal(reads, 0);
	f.guest.invalidate();
	runCompletionClosure(f.cpu, f.guest.global('change') as Closure, []);
	assert.strictEqual(f.inspection.refresh(), document);
	assert.equal(current.value, 'b'); assert.equal(current.valueChanged, true);
	assert.ok(document.every(row => row.valueChanged === (row === current)));
	const observedReads = reads;
	assert.ok(observedReads > 0);
	for (let paint = 0; paint < 1000; paint++) assert.equal(f.inspection.refresh(), undefined);
	assert.equal(reads, observedReads); assert.equal(current.valueChanged, true);
	f.guest.invalidate();
	assert.strictEqual(f.inspection.refresh(), document);
	assert.equal(current.value, 'b'); assert.ok(document.every(row => row.valueChanged === false));
	assert.ok(reads > observedReads);
	f.cpu.restoreRuntimeState(alive); f.guest.invalidate('history-restored');
	assert.notStrictEqual(readStateMachineInstances(f.sources, f.guest, -1).items[0].machine, f.choice.machine);
	assert.strictEqual(f.inspection.refresh(), document);
	assert.deepEqual(document.map(row => row.value), before);
	assert.equal(current.valueChanged, true, 'restoring a previous value is a change from the last completed observation');
	assert.ok(document.every(row => row.valueChanged === (row === current)));
	f.inspection.interaction.running = true; f.guest.invalidate('heap-replaced');
	assert.equal(f.inspection.interaction.running, false);
	const retired = f.inspection.refresh()!;
	assert.ok(retired.every(row => row.warning && row.valueChanged === false));
	const retiredReads = reads;
	f.guest.invalidate();
	assert.equal(f.inspection.refresh(), undefined);
	assert.equal(reads, retiredReads, 'a retired inspection does not reacquire guest members');
});

test('live readback retains rows and skips warmed formatting while still reading authoritative mutable state', t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	const document = f.inspection.refresh()!, rows = document.slice();
	let formatted = 0, reads = 0;
	const format = f.guest.formatStoredEntries.bind(f.guest), read = f.guest.readStringMember.bind(f.guest);
	t.mock.method(f.guest, 'formatStoredEntries', (value: Parameters<typeof format>[0]) => { formatted++; return format(value); });
	t.mock.method(f.guest, 'readStringMember', (...args: Parameters<typeof read>) => { reads++; return read(...args); });
	const before = [f.cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()];
	for (let update = 0; update < 1000; update++) {
		f.guest.invalidate();
		assert.equal(f.inspection.refresh(), undefined);
	}
	assert.equal(formatted, 0);
	assert.ok(reads > 1000);
	assert.ok(document.every((row, index) => row === rows[index]));
	assert.deepEqual([f.cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()], before);
	const previous = document.map(row => row.value);
	f.guest.invalidate(); runCompletionClosure(f.cpu, f.guest.global('change_data') as Closure, []);
	assert.strictEqual(f.inspection.refresh(), document);
	assert.equal(document.filter((row, index) => row.value !== previous[index]).length, 1);
	assert.equal(formatted, 1, 'changed table text is reformatted, unchanged fields are not');
	const count = document.length;
	f.guest.invalidate(); runCompletionClosure(f.cpu, f.guest.global('grow_definition') as Closure, []);
	assert.strictEqual(f.inspection.refresh(), document);
	assert.equal(document.length, count + 1, 'mutable definitions are not assumed to have immutable topology');
});

test('retained value presentation compares mutable entries, preserves preview semantics and reacquires restored string ids', t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	const retained = new SuspendedValuePresentation(f.guest), alive = f.cpu.captureRuntimeState();
	let data = f.guest.readStringMember(f.choice.machine, 'data');
	const original = retained.update(data);
	assert.equal(original, f.guest.formatStoredEntries(data));
	f.guest.invalidate(); runCompletionClosure(f.cpu, f.guest.global('change_data') as Closure, []);
	assert.notEqual(retained.update(data), original);
	assert.equal(retained.update(data), f.guest.formatStoredEntries(data));
	const expanded = retained.update(data);
	f.guest.invalidate(); runCompletionClosure(f.cpu, f.guest.global('trim_nested') as Closure, []);
	assert.notEqual(retained.update(data), expanded);
	assert.equal(retained.update(data), f.guest.formatStoredEntries(data));
	f.cpu.restoreRuntimeState(alive); f.guest.invalidate('history-restored'); retained.invalidate();
	data = f.guest.readStringMember(readStateMachineInstances(f.sources, f.guest, -1).items[0].machine, 'data');
	assert.equal(retained.update(data), original);
});

test('an inspector opened during history review retains absent membership through forward replay', t => {
	const f = fixture(true); t.after(() => f.inspection.dispose());
	const document = f.inspection.refresh()!, before = document.map(row => row.value);
	f.guest.invalidate(); runCompletionClosure(f.cpu, f.guest.global('remove_component') as Closure, []);
	assert.strictEqual(f.inspection.refresh(), document);
	assert.ok(document.every(row => row.warning && row.valueChanged === false));
	f.guest.invalidate(); runCompletionClosure(f.cpu, f.guest.global('restore_component') as Closure, []);
	assert.strictEqual(f.inspection.refresh(), document);
	assert.deepEqual(document.map(row => row.value), before);
	assert.ok(document.every(row => row.valueChanged === false));
});

test('historical absence preserves a behavior bookmark across replay and repeated retained-frame navigation', t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	const document = f.inspection.refresh()!, before = document.map(row => row.value), alive = f.cpu.captureRuntimeState();
	for (let visit = 0; visit < 2; visit++) {
		f.cpu.restoreRuntimeState(f.beforeBirth); f.guest.invalidate('history-restored');
		f.rewind.seeking = true;
		assert.equal(f.inspection.refresh(), undefined);
		f.rewind.seeking = false;
		assert.strictEqual(f.inspection.refresh(), document);
		assert.ok(document.every(row => row.warning && row.valueChanged === false));
		f.guest.invalidate();
		assert.equal(f.inspection.refresh(), undefined, 'replay execution does not admit a live branch');
		f.cpu.restoreRuntimeState(alive); f.guest.invalidate('history-restored');
		const restored = readStateMachineInstances(f.sources, f.guest, -1).items[0];
		assert.equal(restored.component.hashId, f.choice.component.hashId);
		assert.equal(restored.machine.hashId, f.choice.machine.hashId);
		assert.notStrictEqual(restored.machine, f.choice.machine);
		assert.strictEqual(f.inspection.refresh(), document);
		assert.deepEqual(document.map(row => row.value), before);
		assert.ok(document.every(row => row.valueChanged === false), 'unavailable membership ends the previous comparison baseline');
	}
});

for (const observed of [false, true]) test(`live admission retires ${observed ? 'observed' : 'hidden'} historical absence before reused table ids`, t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	const document = f.inspection.refresh()!;
	f.cpu.restoreRuntimeState(f.beforeBirth); f.guest.invalidate('history-restored');
	f.rewind.seeking = true;
	assert.equal(f.inspection.refresh(), undefined);
	f.rewind.seeking = false;
	if (observed) assert.ok(f.inspection.refresh()!.every(row => row.warning && row.valueChanged === false));
	f.inspection.interaction.running = true;
	f.guest.willEndHistoryReview();
	assert.equal(f.inspection.interaction.running, false);
	assert.strictEqual(f.inspection.refresh(), document, 'admission publishes retirement before another execution invalidation');
	assert.ok(document.every(row => row.warning && row.valueChanged === false));
	f.guest.invalidate();
	f.cpu.runUntilDepth(0, 100_000);
	const newChoice = readStateMachineInstances(f.sources, f.guest, -1).items[0];
	assert.equal(newChoice.component.hashId, f.choice.component.hashId);
	assert.equal(newChoice.machine.hashId, f.choice.machine.hashId);
	assert.equal(f.inspection.refresh(), undefined, 'new allocation identities cannot reactivate the retired selection');
});

test('live admission keeps a restored behavior instance and later live removal retires it', t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	const document = f.inspection.refresh()!, before = document.map(row => row.value), alive = f.cpu.captureRuntimeState();
	f.cpu.restoreRuntimeState(f.beforeBirth); f.guest.invalidate('history-restored');
	f.inspection.refresh();
	f.cpu.restoreRuntimeState(alive); f.guest.invalidate('history-restored');
	f.inspection.interaction.running = true;
	f.guest.willEndHistoryReview();
	assert.equal(f.inspection.interaction.running, true, 'admission resolves current membership even before the pane observes it');
	assert.strictEqual(f.inspection.refresh(), document);
	assert.deepEqual(document.map(row => row.value), before);
	f.guest.invalidate(); runCompletionClosure(f.cpu, f.guest.global('remove_component') as Closure, []);
	assert.equal(readStateMachineInstances(f.sources, f.guest, -1).items.length, 0);
	assert.strictEqual(f.inspection.refresh(), document);
	assert.equal(f.inspection.interaction.running, false);
	assert.ok(document.every(row => row.warning && row.valueChanged === false));
	f.guest.invalidate(); runCompletionClosure(f.cpu, f.guest.global('restore_component') as Closure, []);
	assert.equal(readStateMachineInstances(f.sources, f.guest, -1).items[0].component.hashId, f.choice.component.hashId);
	let reads = 0;
	const read = f.guest.readStringMember.bind(f.guest);
	t.mock.method(f.guest, 'readStringMember', (...args: Parameters<typeof read>) => { reads++; return read(...args); });
	assert.equal(f.inspection.refresh(), undefined);
	assert.equal(reads, 0, 'a retired live instance does not silently reattach');
});

test('a live guest call ending review retires subsequently missing membership', t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	const document = f.inspection.refresh()!;
	const history = f.runtime.history;
	history.start({ checkpointCapacity: 2, inputCapacity: 8, checkpointIntervalCycles: 1000000 });
	history.captureCheckpoint();
	history.beginSeek(history.latestCycles);
	assert.equal(history.mode, HistoryMode.Reviewing);
	f.inspection.interaction.running = true;
	f.guest.callClosure(f.guest.global('remove_component'));
	assert.equal(history.mode, HistoryMode.Disabled);
	assert.strictEqual(f.inspection.refresh(), document);
	assert.equal(f.inspection.interaction.running, false);
	assert.ok(document.every(row => row.warning && row.description.includes('SELECT A RUNTIME INSTANCE AGAIN')));
	f.guest.callClosure(f.guest.global('restore_component'));
	assert.equal(f.inspection.refresh(), undefined, 'ending recording must not leave the inspector in historical mode');
});

for (const observed of [false, true]) test(`discarding review retires ${observed ? 'observed' : 'hidden'} missing identities before reuse`, t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	const document = f.inspection.refresh()!;
	const history = f.runtime.history;
	f.cpu.restoreRuntimeState(f.beforeBirth);
	history.start({ checkpointCapacity: 2, inputCapacity: 8, checkpointIntervalCycles: 1000000 });
	history.captureCheckpoint();
	f.cpu.runUntilDepth(0, 100_000);
	history.beginSeek(history.earliestCycles);
	if (observed) assert.ok(f.inspection.refresh()!.every(row => row.warning));
	f.inspection.interaction.running = true;
	history.stop();
	assert.equal(f.inspection.interaction.running, false, 'discard reconciles before another guest allocation');
	f.guest.invalidate(); f.cpu.runUntilDepth(0, 100_000);
	const replacement = readStateMachineInstances(f.sources, f.guest, -1).items[0];
	assert.equal(replacement.component.hashId, f.choice.component.hashId);
	assert.equal(replacement.machine.hashId, f.choice.machine.hashId);
	assert.strictEqual(f.inspection.refresh(), document);
	assert.ok(document.every(row => row.warning && row.description.includes('SELECT A RUNTIME INSTANCE AGAIN')));
});

for (const operation of ['reset', 'load'] as const) test(`${operation} ending review still retires the replaced guest heap`, t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	f.inspection.refresh();
	const replacement = captureRuntimeSaveState(f.runtime);
	const history = f.runtime.history;
	history.start({ checkpointCapacity: 2, inputCapacity: 8, checkpointIntervalCycles: 1000000 });
	history.captureCheckpoint();
	history.beginSeek(history.latestCycles);
	if (operation === 'reset') f.runtime.rebootSystem();
	else applyRuntimeSaveState(f.runtime, replacement);
	const document = f.inspection.refresh()!;
	assert.ok(document.every(row => row.warning && row.value === 'THE GUEST HEAP WAS REPLACED.'));
});

test('heap replacement remains terminal across historical navigation and live admission', t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	f.inspection.refresh();
	const alive = f.cpu.captureRuntimeState();
	f.guest.invalidate('heap-replaced');
	const document = f.inspection.refresh()!, retired = document.map(row => row.value);
	f.cpu.restoreRuntimeState(alive); f.guest.invalidate('history-restored');
	f.guest.willEndHistoryReview();
	assert.equal(f.inspection.refresh(), undefined);
	assert.deepEqual(document.map(row => row.value), retired, 'history admission does not replace the retirement reason');
});


test('behavior inspection owns its physical target before readback and retires only its own attachment', t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	assert.equal(f.inspection.interaction.transport, f.transport);
	assert.equal(f.inspection.interaction.running, false);
	const observations: Array<[RuntimeTransport | null, boolean]> = [];
	t.after(f.inspection.interaction.onDidChange(() => observations.push([f.inspection.interaction.transport, f.inspection.interaction.running])));
	f.inspection.interaction.running = true;
	f.guest.invalidate('heap-replaced');
	assert.deepEqual(observations, [[f.transport, true], [f.transport, false]]);
	assert.equal(f.inspection.interaction.transport, f.transport, 'a lost instance does not select a different physical target');
	f.inspection.dispose();
	assert.deepEqual(observations.at(-1), [null, false]);
});
