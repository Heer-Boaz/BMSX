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

/** Real guest tables/type bucket. Browser validation separately executes actual cartlib constructors. */
function fixture() {
	const modules = [
		{ path: 'cartlib/fsm/fsm_component', source: 'return {}' },
		{ path: 'cartlib/registry', source: `local type<const> = require('cartlib/fsm/fsm_component')
return { _entries_by_key = { [type] = { items = {} } } }` },
	].map(module => ({ ...module, chunk: parseLuaChunk(module.source, `${module.path}.lua`) }));
	const source = `local registry<const> = require('cartlib/registry')
local type<const> = require('cartlib/fsm/fsm_component')
local state<const> = { id = 'root', current_id = 'a', states = {}, state_ids = {}, data = {},
definition = { def_id = 'root', on = {} } }
local component<const> = { id = 1, parent = { id = 2 }, enabled = true, _started = true,
_machines_by_id = { test = state } }
registry._entries_by_key[type].items[1] = component
function change() state.current_id = 'b' end
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
	return { cpu, guest, sources, rewind, inspection, beforeBirth, choice };
}

test('visible behavior inspection refreshes only after invalidation and reacquires restored guest identities', t => {
	const f = fixture(); t.after(() => f.inspection.dispose());
	const before = f.inspection.refresh(), alive = f.cpu.captureRuntimeState();
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
