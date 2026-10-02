import assert from 'node:assert/strict';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { selectLuaProgramModules } from '../../toolchain/ts/lua/compiler/module_graph';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import type { LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { BehaviorRuntimeInspection } from '../../ide/workbench/contrib/behavior_lens/runtime_inspection';
import { readStateMachineInstances } from '../../ide/workbench/contrib/behavior_lens/state_machine_runtime';
import { parseLuaChunk, runCompletionClosure } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import type { HostRewind } from '../../hosts/common/rewind';
import { SuspendedValuePresentation } from '../../ide/runtime/value_presentation';

/** Real guest tables/type bucket. Browser validation separately executes actual cartlib constructors. */
function fixture() {
	const modules = [
		{ path: 'cartlib/fsm/fsm_component', source: 'return {}' },
		{ path: 'cartlib/registry', source: `local type<const> = require('cartlib/fsm/fsm_component')
return { _entries_by_key = { [type] = { items = {} } } }` },
	].map(module => ({ ...module, chunk: parseLuaChunk(module.source, `${module.path}.lua`) }));
	const source = `local registry<const> = require('cartlib/registry')
local type<const> = require('cartlib/fsm/fsm_component')
local state<const> = { id = 'root', current_id = 'a', states = {}, state_ids = {}, data = {
answer = 42, nested = { value = 7, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 }, [1] = 'numeric', ['1'] = 'string', [true] = 'boolean' },
definition = { def_id = 'root', on = {} } }
local component<const> = { id = 1, parent = { id = 2 }, enabled = true, _started = true,
_machines_by_id = { test = state } }
registry._entries_by_key[type].items[1] = component
function change() state.current_id = 'b' end
function change_data() state.data.answer = 43; state.data.nested.value = 8; state.data.nested[2] = 11 end
function trim_nested() state.data.nested[9] = nil; state.data.nested[10] = nil; state.data.nested.value = nil end
function grow_definition() state.definition.initial = 'a' end
return component`;
	const chunk = parseLuaChunk(source, 'entry.lua');
	const compiled = compileLuaChunkToProgram(chunk, selectLuaProgramModules(chunk, modules, []), { entrySource: source, programDomain: 'system', optLevel: 0 });
	const image = linkTestSystemBlua32(compiled), runtime = createTestRuntime(image.romBytes), cpu = runtime.machine.cpu;
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', projectRootPath: '', can_boot_from_source: false, revision: 0 };
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports), cartridgeSlots: [null, null] };
	cpu.reset();
	const beforeBirth = cpu.captureRuntimeState();
	cpu.runUntilDepth(0, 100_000);
	const guest = new SuspendedGuestSession(runtime);
	const rewind = { seeking: false, playing: false };
	const choice = readStateMachineInstances(sources, guest, -1).items[0];
	const inspection = new BehaviorRuntimeInspection(sources, guest, rewind as HostRewind, -1,
		{ kind: 'state_machine', componentHashId: choice.component.hashId, machineHashId: choice.machine.hashId, stateHashId: choice.machine.hashId });
	return { runtime, cpu, guest, sources, rewind, inspection, beforeBirth, choice };
}

test('visible behavior inspection refreshes only after invalidation and reacquires restored guest identities', t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	const before = structuredClone(f.inspection.refresh()), alive = f.cpu.captureRuntimeState();
	assert.equal(f.inspection.refresh(), undefined);
	f.guest.invalidate();
	runCompletionClosure(f.cpu, f.guest.global('change') as Closure, []);
	assert.notDeepEqual(f.inspection.refresh(), before);
	assert.equal(f.inspection.refresh(), undefined);
	f.cpu.restoreRuntimeState(alive); f.guest.invalidate('history-restored');
	assert.notStrictEqual(readStateMachineInstances(f.sources, f.guest, -1).items[0].machine, f.choice.machine);
	assert.deepEqual(f.inspection.refresh(), before);
	f.inspection.running = true; f.guest.invalidate('heap-replaced');
	assert.equal(f.inspection.running, false);
	assert.ok(f.inspection.refresh()![0].warning);
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

test('restored absence retires a visible bookmark before a branch reuses table ids, not during replay seeking', t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	f.inspection.refresh();
	f.cpu.restoreRuntimeState(f.beforeBirth); f.guest.invalidate('history-restored');
	f.rewind.seeking = true;
	assert.equal(f.inspection.refresh(), undefined);
	f.rewind.seeking = false;
	f.guest.willResumeHistory();
	f.guest.invalidate();
	f.cpu.runUntilDepth(0, 100_000);
	const newChoice = readStateMachineInstances(f.sources, f.guest, -1).items[0];
	assert.equal(newChoice.component.hashId, f.choice.component.hashId);
	assert.ok(f.inspection.refresh()![0].warning);
});
