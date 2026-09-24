import assert from 'node:assert/strict';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { selectLuaProgramModules } from '../../toolchain/ts/lua/compiler/module_graph';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import type { LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { ActorLabInput } from '../../ide/workbench/contrib/actor_lab/editor_input';
import { ActorProjection, readActorChoices } from '../../ide/workbench/contrib/actor_lab/projection';
import { ActorRuntimeInspection } from '../../ide/workbench/contrib/actor_lab/runtime_inspection';
import { WorkspaceRuntimeTools } from '../../ide/workbench/services/assistant/runtime_tools';
import { decodeActorToolRequest } from '../../ide/workbench/services/assistant/actor_tool_protocol';
import { parseLuaChunk, runCompletionClosure } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';

/** Compiled guest representations, not JS table mocks. Actual cartlib construction is tested in the browser workflow. */
const WORLD_SOURCE = `local fsm<const> = require('cartlib/fsm/fsm_component')
local state<const> = { definition = { on = {} }, states = {}, state_ids = {}, data = { answer = 42 } }
local concurrent<const> = { definition = { on = {}, is_concurrent = true }, states = {}, state_ids = {} }
local machine<const> = { definition = { on = {} }, states = { idle = state, concurrent = concurrent }, state_ids = { 'idle', 'concurrent' }, current_id = 'idle' }
local component<const> = { id = 'states', enabled = true, _parent_component_index = 1, _started = true, _machines_by_id = { same = machine } }
local impostor<const> = { id = 'FSM states', enabled = true, _parent_component_index = 2, _machines_by_id = {} }
local actor<const> = { id = 1, definition_id = 'same', active = true, _components = { component, impostor }, _components_by_class = { [fsm] = { component } } }
local second<const> = { id = '1', definition_id = 'same', active = false, _components = {}, _components_by_class = {} }
component.parent = actor
actor.self = actor
return { _objects = { actor, second } }`;
const ENTRY = `local world<const> = require('cartlib/world/world')
probe = world._objects[1]
function rename() probe.id = 'renamed' end
function remove() probe._components[2] = nil end
return world`;

function fixture(entry = ENTRY, run = true) {
	const modules = [{ path: 'cartlib/world/world', source: WORLD_SOURCE }, { path: 'cartlib/fsm/fsm_component', source: 'return {}' }]
		.map(module => ({ ...module, chunk: parseLuaChunk(module.source, `${module.path}.lua`) }));
	const chunk = parseLuaChunk(entry, 'entry.lua');
	const compiled = compileLuaChunkToProgram(chunk, selectLuaProgramModules(chunk, modules, []), { entrySource: entry, programDomain: 'system', optLevel: 0 });
	const image = linkTestSystemBlua32(compiled), runtime = createTestRuntime(image.romBytes);
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', projectRootPath: '', can_boot_from_source: false, revision: 0 };
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports), cartridgeSlots: [null, null] };
	runtime.machine.cpu.reset();
	if (run) runtime.machine.cpu.runUntilDepth(0, 100_000);
	const f = createRuntimeInspectionFixture(runtime, sources);
	f.inspection.pause();
	const inspection = f.inspection.open(), actors = inspection.lifetime.add(new ActorRuntimeInspection(inspection));
	return { ...f, stop: inspection, actors };
}

test('World pages retain typed identities; Actor Lab and tool trees consume real class indices, not names', t => {
	const f = fixture(); t.after(() => f.stop.dispose());
	const before = [f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()];
	const first = f.actors.list(0, 1), second = f.actors.list(1, 1);
	assert.equal(first.status, 'available'); assert.equal(first.total, 2);
	assert.equal(first.actors![0].id.kind, 'number'); assert.equal(second.actors![0].id.kind, 'string');
	assert.notEqual(first.actors![0].reference, second.actors![0].reference);
	assert.deepEqual(f.actors.list(5, 1).actors, []);
	const scope = f.stop.scopes[0];
	const probe = f.stop.read(scope.reference!, 0, scope.count!).entries.find(entry => entry.key.display === 'probe')!.value;
	assert.equal(probe.reference, first.actors![0].object.reference, 'domain roots share aliases with globals');
	assert.equal(f.stop.read(probe.reference!, 0, 100).entries.find(entry => entry.key.display === 'self')!.value.reference, probe.reference);
	const tree = f.actors.tree(first.actors![0].reference, 0, 100);
	assert.deepEqual(tree.nodes.map(node => node.kind), ['actor', 'component', 'machine', 'state', 'state', 'component']);
	assert.equal(tree.nodes.at(-1)!.children, 0, 'a class-shaped/named table is still a generic component');
	assert.equal(tree.nodes.find(node => node.label === 'concurrent')!.activity.value, true);
	const choices = readActorChoices(f.sources, f.guest, f.stop.state.activeCartridge), input = new ActorLabInput();
	input.domain = choices[0].domain; input.actorHashId = choices[0].hashId;
	const projection = new ActorProjection(input, f.sources, f.guest);
	assert.equal(projection.update(), true);
	assert.deepEqual(input.outline.rows.map(row => row.element.node.kind), tree.nodes.map(node => node.kind));
	assert.deepEqual(input.outline.rows.map(row => f.stop.values.describe(row.element.node.value).reference), tree.nodes.map(node => node.object.reference));
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()], before);
	input.dispose();
});

test('tree paging and repeated detail reads do not repeat semantic traversal or formatting', t => {
	const f = fixture(); t.after(() => f.stop.dispose());
	const actor = f.actors.list(0, 1).actors![0].reference;
	let visits = 0;
	const original = f.guest.visitTableEntries.bind(f.guest);
	t.mock.method(f.guest, 'visitTableEntries', (...args: Parameters<typeof original>) => { visits++; return original(...args); });
	const first = f.actors.tree(actor, 0, 3), visited = visits, rest = f.actors.tree(actor, 3, 10);
	assert.equal(visits, visited); assert.equal(first.total, first.nodes.length + rest.nodes.length);
	assert.equal(first.nodes[2].parent, first.nodes[1].reference);
	const state = f.actors.read(rest.nodes.find(node => node.kind === 'state')!.reference), detailed = visits;
	assert.strictEqual(f.actors.read(state.reference).properties, state.properties);
	assert.equal(visits, detailed);
	const fields = f.stop.read(state.object.reference!, 0, 100).entries;
	const data = fields.find(entry => entry.key.display === 'data')!.value.reference!;
	assert.equal(f.stop.read(data, 0, 100).entries[0].value.display, '42', 'human property summaries do not replace expandable values');
});

test('unloaded, uninitialized and actually empty World are distinct observations', () => {
	for (const [entry, run, status] of [['return 0', true, 'not_loaded'], [ENTRY, false, 'uninitialized'],
		[`${ENTRY.replace('return world', 'world._objects = {} return world')}`, true, 'available']] as const) {
		const f = fixture(entry, run), result = f.actors.list(0, 10);
		assert.equal(result.status, status);
		if (status === 'available') { assert.equal(result.total, 0); assert.deepEqual(result.actors, []); }
		else assert.equal(result.total, undefined);
		f.stop.dispose();
	}
});

for (const reason of ['execution', 'heap-replaced'] as const) test(`${reason} retires actor handles, typed roots and domain borrows together`, () => {
	const f = fixture(), actor = f.actors.list(0, 1).actors![0], node = f.actors.tree(actor.reference, 0, 1).nodes[0];
	f.guest.invalidate(reason);
	assert.throws(() => f.actors.list(0, 1), /expired/);
	assert.throws(() => f.actors.tree(actor.reference, 0, 1), /expired/);
	assert.throws(() => f.actors.read(node.reference), /expired/);
	assert.throws(() => f.stop.read(actor.object.reference!, 0, 1), /expired/);
	const next = f.inspection.open(), actors = next.lifetime.add(new ActorRuntimeInspection(next));
	assert.throws(() => actors.tree(actor.reference, 0, 1), /does not belong/);
	assert.throws(() => actors.read(node.reference), /does not belong/);
	next.dispose();
});

test('ordinary pane retains stable rows, refreshes changed labels, releases detached branches and clears identities after restore', () => {
	const f = fixture(), choice = readActorChoices(f.sources, f.guest, f.stop.state.activeCartridge)[0], input = new ActorLabInput();
	input.domain = choice.domain; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest);
	projection.update();
	const rows = input.outline.rows.slice();
	assert.equal(projection.update(), false);
	assert.ok(rows.every((row, index) => row === input.outline.rows[index]));
	input.outline.roots[0].collapsed = true;
	input.invalidate(false); f.guest.invalidate('execution');
	assert.ok(rows.every(row => row.element.node.value === null && row.element.node.key === null));
	runCompletionClosure(f.runtime.machine.cpu, f.guest.global('rename') as Closure, []);
	assert.equal(projection.update(), true);
	assert.equal(input.outline.roots[0].element.node.label, 'renamed');
	assert.strictEqual(input.outline.roots[0], rows[0]); assert.equal(input.outline.roots[0].collapsed, true);
	const removed = input.runtime.roots[0].children[1];
	input.invalidate(false); f.guest.invalidate('execution');
	runCompletionClosure(f.runtime.machine.cpu, f.guest.global('remove') as Closure, []);
	projection.update();
	assert.equal(removed.value, null); assert.equal(removed.receiver, null);
	const root = input.runtime.roots[0];
	input.invalidate(true);
	assert.equal(root.value, null); assert.equal(input.actorHashId, 0);
	assert.equal(input.runtime.roots.length, 0); assert.equal(input.outline.rows.length, 0);
	input.dispose(); f.stop.dispose();
});

test('conversation admission binds all actor handles to its own stop and prompt lifetime', async () => {
	const f = fixture(), lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.terminal, f.debuggerExecution, lifetime.signal);
	assert.throws(() => tools.execute('studio_list_actors', { inspection: 'foreign', start: 0, count: 1 }), /current suspended/);
	const opened = await tools.execute('studio_inspect_runtime', { target: f.inspection.target });
	assert.ok('inspection' in opened.data);
	const result = await tools.execute('studio_list_actors', { inspection: opened.data.inspection, start: 0, count: 1 });
	assert.ok('actors' in result.data && result.data.actors);
	const actor = result.data.actors[0].reference;
	await tools.execute('studio_inspect_runtime', { target: f.inspection.target });
	assert.throws(() => tools.execute('studio_read_actor_tree', { actor, start: 0, count: 1 }), /does not belong/);
	lifetime.abort();
	assert.throws(() => tools.execute('studio_read_actor_tree', { actor, start: 0, count: 1 }), /disposed/);
	assert.equal(f.execution.userPaused, true);
	for (const count of [0, -1, 1.5, '1']) assert.throws(() => decodeActorToolRequest('studio_list_actors', { inspection: 'x', start: 0, count }));
	assert.throws(() => decodeActorToolRequest('studio_read_actor_node', { node: 'x', target: 'foreign' }), /declared fields/);
	f.stop.dispose();
});

test('physical target domain, not delayed source activity, selects World after restore', () => {
	const f = fixture();
	f.sources.activeCartridgeSlot = 0;
	assert.equal(f.stop.state.activeCartridge, -1);
	assert.equal(f.actors.list(0, 10).total, 2);
	assert.equal(readActorChoices(f.sources, f.guest, f.runtime.machine.cpu.activeCartridgeSlot()).length, 2);
	assert.equal(f.sources.activeCartridgeSlot, 0, 'inspection does not repair or mutate unrelated source activity');
	f.stop.dispose();
});

test('activity predicates consume guest truthiness, including zero and empty string, without Boolean-only normalization', () => {
	const f = fixture(ENTRY.replace('return world', `probe.active = 0
probe._components[1].enabled = ''
probe._components[1]._machines_by_id.same.states.concurrent.definition.is_concurrent = 0
return world`));
	const actor = f.actors.list(0, 1).actors![0], tree = f.actors.tree(actor.reference, 0, 100);
	assert.equal(actor.active, true); assert.equal(tree.nodes[1].activity.value, true);
	assert.equal(tree.nodes.find(node => node.label === 'concurrent')!.activity.value, true);
	const actorFields = f.stop.read(actor.object.reference!, 0, 100).entries;
	assert.deepEqual(actorFields.find(entry => entry.key.display === 'active')!.value, { kind: 'number', display: '0' });
	f.stop.dispose();
});
