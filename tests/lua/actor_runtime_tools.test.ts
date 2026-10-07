import assert from 'node:assert/strict';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { createBuiltinFunction, valueString, type Value } from '../../machine/ts/machine/cpu/value';
import { BuiltinFunctionId } from '../../machine/ts/spec/blua32/builtin';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { selectLuaProgramModules } from '../../toolchain/ts/lua/compiler/module_graph';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import type { LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { ActorLabInput } from '../../ide/workbench/contrib/actor_lab/editor_input';
import { ActorLabController } from '../../ide/workbench/contrib/actor_lab/controller';
import { captureActorDetailsSelection } from '../../ide/workbench/contrib/actor_lab/details';
import { ActorProjection, readActorChoices } from '../../ide/workbench/contrib/actor_lab/projection';
import { createActorMemberChoices } from '../../ide/workbench/contrib/actor_lab/member_choices';
import { ActorRuntimeInspection } from '../../ide/workbench/contrib/actor_lab/runtime_inspection';
import { captureActorTarget, resolveActorPath, resolveActorTarget } from '../../ide/workbench/contrib/actor_lab/target';
import { WorkspaceRuntimeTools } from '../../ide/workbench/services/assistant/runtime_tools';
import { decodeActorToolRequest } from '../../ide/workbench/services/assistant/actor_tool_protocol';
import { parseLuaChunk, runCompletionClosure } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';
import { createRuntimeInspectionFixture } from '../helpers/runtime_inspection';
import { ActorStateGraph } from '../../ide/workbench/contrib/actor_lab/state_graph';
import { ActorRuntimeTree, runtimeWorld } from '../../ide/workbench/contrib/actor_lab/runtime';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { Font } from '../../machine/ts/render/shared/bmsx_font';

/** Compiled guest representations, not JS table mocks. Actual cartlib construction is tested in the browser workflow. */
const WORLD_SOURCE = `local fsm<const> = require('cartlib/fsm/fsm_component')
local state<const> = { definition = { on = {} }, states = {}, state_ids = {}, data = { answer = 42 } }
local concurrent<const> = { definition = { on = {}, is_concurrent = true }, states = {}, state_ids = {} }
local machine<const> = { localdef_id = 'same', definition = { on = {} }, states = { idle = state, concurrent = concurrent }, state_ids = { 'idle', 'concurrent' }, current_id = 'idle' }
local component<const> = { id = 'states', enabled = true, _parent_component_index = 1, _started = true, _machines = { machine }, _machines_by_id = { same = machine } }
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

function fixture(entry = ENTRY, run = true, worldSource = WORLD_SOURCE) {
	const modules = [{ path: 'cartlib/world/world', source: worldSource }, { path: 'cartlib/fsm/fsm_component', source: 'return {}' },
		{ path: 'cartlib/timeline/timeline_component', source: 'return {}' }, { path: 'cartlib/actioneffects/actioneffect_component', source: 'return {}' }]
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

test('Actor Lab history restores the typed member and Details after choosing another actor without guest execution', t => {
	const f = fixture(); t.after(() => f.stop.dispose());
	const controller = new ActorLabController(f.sources, f.guest, f.runtime.machine.cpu, undefined!, undefined!, undefined!, f.actorExecution, f.rewind);
	const input = controller.resolveInput(); t.after(() => input.dispose());
	const choices = readActorChoices(f.sources, f.guest, -1), font = new Font({ variant: 'tiny' });
	input.domain = -1; input.actorHashId = choices[0].hashId; controller.refresh(input);
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state');
	input.rememberSelection(); input.detailsOpen = true;
	controller.refreshDetails(input);
	const selectedProperty = captureActorDetailsSelection(input.details!.items.find(item => item.identity !== undefined)!);
	input.detailsSelection = selectedProperty; input.detailsScroll = 37;
	input.split.resize(0.55); input.detailsSplit.resize(0.6);
	const saved = controller.captureSelection(input), heap = f.runtime.machine.cpu.luaHeap.usedBytes();
	input.actorHashId = choices[1].hashId; input.selectionPath = undefined; input.dirty = true; controller.refresh(input);
	const second = controller.captureSelection(input);
	assert.equal(saved.matches(second), false, 'equal displayed actor IDs do not substitute for physical typed membership');
	input.detailsSelection = undefined; input.detailsScroll = 0; input.detailsOpen = false;
	controller.restoreSelection(input, saved, font);
	assert.equal(input.actorHashId, choices[0].hashId);
	assert.deepEqual(input.selectionPath, saved.target!.path);
	assert.equal(controller.selected(input)!.kind, 'state');
	assert.equal(input.detailsOpen, true); assert.deepEqual(input.detailsSelection, selectedProperty); assert.equal(input.detailsScroll, 37);
	assert.equal(input.split.ratio, 0.55); assert.equal(input.detailsSplit.ratio, 0.6);
	assert.equal(f.runtime.machine.cpu.luaHeap.usedBytes(), heap);
	assert.equal(input.running, false);
	saved.dispose(); second.dispose();
});

test('Actor Lab pin action enablement uses retained membership without guest reads or identity capture churn', t => {
	const f = fixture(); t.after(() => f.stop.dispose());
	const controller = new ActorLabController(f.sources, f.guest, f.runtime.machine.cpu, undefined!, undefined!, undefined!, f.actorExecution, f.rewind);
	const input = controller.resolveInput(); t.after(() => input.dispose());
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId;
	controller.refresh(input); input.outline.selectionIndex = 0; input.rememberSelection(); controller.refreshDetails(input);
	const pinned = input.details!.items.find(item => item.label === 'id')!, unpinned = input.details!.items.find(item => item.label === 'active')!;
	controller.pinProperty(input, pinned); controller.refreshDetails(input);
	const pin = input.details!.watches.pins[0];
	const displayOnly = { ...unpinned, watchIdentity: undefined };
	const read = t.mock.method(f.guest, 'readStringMember'), globals = t.mock.method(f.guest, 'global'), systemGlobals = t.mock.method(f.guest, 'systemGlobal');
	const entries = t.mock.method(f.guest, 'visitTableEntries'), identities = t.mock.method(f.guest, 'identity');
	const before = [f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()];
	for (let frame = 0; frame < 1000; frame++) {
		assert.equal(controller.canPinProperty(input, displayOnly), false);
		assert.equal(controller.canUnpinProperty(input, displayOnly), false);
		assert.equal(controller.canPinProperty(input, pinned), false);
		assert.equal(controller.canUnpinProperty(input, pinned), true);
		assert.equal(controller.canPinProperty(input, unpinned), true);
		assert.equal(controller.canUnpinProperty(input, unpinned), false);
		assert.equal(controller.canPinProperty(input, pin.item), false);
		assert.equal(controller.canUnpinProperty(input, pin.item), true);
		assert.equal(controller.canRevealPinnedProperty(input, pin.item), true);
	}
	assert.equal(read.mock.callCount(), 0); assert.equal(globals.mock.callCount(), 0); assert.equal(systemGlobals.mock.callCount(), 0);
	assert.equal(entries.mock.callCount(), 0); assert.equal(identities.mock.callCount(), 0);
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()], before);
});

test('Actor Lab pin and reveal commands keep watch selection separate and return to the exact cross-actor member', t => {
	const f = fixture(); t.after(() => f.stop.dispose());
	const controller = new ActorLabController(f.sources, f.guest, f.runtime.machine.cpu, undefined!, undefined!, undefined!, f.actorExecution, f.rewind);
	const input = controller.resolveInput(); t.after(() => input.dispose());
	const choices = readActorChoices(f.sources, f.guest, -1);
	const before = [f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()];
	input.domain = -1; input.actorHashId = choices[0].hashId; controller.refresh(input);
	input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.name === 'idle'); input.rememberSelection();
	controller.refreshDetails(input);
	const property = input.details!.items.find(item => item.label === 'INSTANCE DATA')!;
	assert.equal(controller.canPinProperty(input, property), true);
	controller.pinProperty(input, property);
	const pin = input.details!.watches.pins[0];
	assert.deepEqual(input.detailsSelection, { kind: 'watch', id: pin.id });
	controller.refreshDetails(input);
	input.actorHashId = choices[1].hashId; input.selectionPath = undefined; input.dirty = true;
	controller.refresh(input); input.outline.selectionIndex = 0; input.rememberSelection(); controller.refreshDetails(input);
	assert.equal(controller.selected(input)!.hashId, choices[1].hashId);
	assert.equal(pin.available, true); assert.equal(controller.canRevealPinnedProperty(input, pin.item), true);
	input.running = true;
	controller.revealPinnedProperty(input, pin.item); controller.refreshDetails(input);
	assert.equal(input.running, false); assert.equal(input.presentation, 'outline'); assert.equal(input.actorHashId, choices[0].hashId);
	assert.strictEqual(controller.selected(input), resolveActorTarget(input.runtime.roots, pin.target, f.guest));
	assert.deepEqual(input.selectionPath, pin.target.path);
	assert.deepEqual(input.detailsSelection, { kind: 'property', identity: pin.property });
	const revealed = input.details!.items.find(item => item.watch === undefined && item.label === 'INSTANCE DATA')!;
	assert.equal(controller.canPinProperty(input, revealed), false); assert.equal(controller.canUnpinProperty(input, revealed), true);
	controller.unpinProperty(input, revealed); controller.refreshDetails(input);
	assert.equal(input.details!.watches.pins.length, 0); assert.equal(controller.canPinProperty(input, revealed), true);
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()], before);
});

test('Actor Lab navigation keeps graph edge identity and retires bookmarks at heap replacement or history resume', t => {
	for (const retirement of ['heap-replaced', 'history-resume'] as const) {
		const f = fixture(); t.after(() => f.stop.dispose());
		const controller = new ActorLabController(f.sources, f.guest, f.runtime.machine.cpu, undefined!, undefined!, undefined!, f.actorExecution, f.rewind);
		const input = controller.resolveInput(); t.after(() => input.dispose());
		const font = new Font({ variant: 'tiny' });
		input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId; controller.refresh(input);
		input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'state'); input.rememberSelection();
		controller.openStateGraph(input, font);
		const graph = input.stateGraph!, target = graph.selectedTarget!;
		graph.selectTarget(target, 'edge'); graph.viewport.layout(0, 0, 120, 100);
		graph.viewport.setZoom(2); graph.viewport.pan(15, 20);
		const saved = controller.captureSelection(input), scroll = [graph.viewport.scrollX, graph.viewport.scrollY];
		controller.openOutline(input);
		controller.restoreSelection(input, saved, font); saved.restoreViewport(input);
		assert.equal(input.stateGraph, graph, 'common Source and Back reuses the same graph and its layout');
		assert.equal(graph.viewport.selection!.kind, 'edge'); assert.deepEqual(graph.selectedTarget, target);
		assert.deepEqual([graph.viewport.scrollX, graph.viewport.scrollY], scroll); assert.equal(graph.viewport.zoom, 2);
		if (retirement === 'heap-replaced') f.guest.invalidate('heap-replaced'); else f.guest.willEndHistoryReview();
		controller.restoreSelection(input, saved, font);
		assert.equal(input.actorHashId, 0); assert.equal(controller.selected(input), undefined);
		assert.equal(input.stateGraph, undefined); assert.equal(input.follow.target, undefined);
		saved.dispose();
	}
});

test('Actor Lab navigation retains an absent member without selecting a different receiver', t => {
	for (const presentation of ['outline', 'graph'] as const) {
		const f = fixture(ENTRY.replace('return world', "function remove_state() probe._components[1]._machines[1].state_ids = { 'concurrent' } end\nreturn world"));
		t.after(() => f.stop.dispose());
		const controller = new ActorLabController(f.sources, f.guest, f.runtime.machine.cpu, undefined!, undefined!, undefined!, f.actorExecution, f.rewind);
		const input = controller.resolveInput(); t.after(() => input.dispose());
		const font = new Font({ variant: 'tiny' }), cpu = f.runtime.machine.cpu;
		input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId; controller.refresh(input);
		input.outline.selectionIndex = input.outline.rows.findIndex(row => row.element.node.name === 'idle'); input.rememberSelection();
		if (presentation === 'graph') controller.openStateGraph(input, font);
		const saved = controller.captureSelection(input), alive = cpu.captureRuntimeState();
		f.guest.invalidate(); runCompletionClosure(cpu, f.guest.global('remove_state') as Closure, []);
		controller.restoreSelection(input, saved, font);
		assert.equal(controller.selected(input), undefined);
		assert.deepEqual(presentation === 'outline' ? input.selectionPath : input.stateGraph!.selectionBookmark!.path, saved.target!.path);
		const absent = controller.captureSelection(input);
		assert.deepEqual(absent.target!.path, saved.target!.path, 'capturing an unavailable view keeps the requested typed membership');
		f.guest.invalidate('history-restored'); cpu.restoreRuntimeState(alive); controller.refresh(input); input.stateGraph?.layout(font);
		assert.equal(controller.selected(input)!.name, 'idle', 'the original historical member becomes actionable only after reacquisition');
		saved.dispose(); absent.dispose();
	}
});

test('FSM graph consumes actual activity and typed membership, retains geometry through restore, and retires renamed instances', t => {
	const f = fixture(ENTRY.replace('return world', `function move() probe._components[1]._machines_by_id.same.current_id = nil end
function disable() probe._components[1].enabled = false end
function rename_machine()
	local machines = probe._components[1]._machines_by_id
	machines.renamed = machines.same
	machines.renamed.localdef_id = 'renamed'
	machines.same = nil
end
return world`));
	t.after(() => f.stop.dispose());
	const input = new ActorLabInput(), choice = readActorChoices(f.sources, f.guest, -1)[0];
	input.domain = choice.domain; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest); projection.update();
	const machine = input.runtime.roots[0].children[0].children[0], font = new Font({ variant: 'tiny' });
	const target = captureActorTarget(-1, runtimeWorld(f.sources, f.guest, -1)!.hashId, input.runtime.roots, machine, f.guest);
	const graph = input.stateGraph = new ActorStateGraph(target, font);
	const cpu = f.runtime.machine.cpu, heap = cpu.luaHeap.usedBytes(), alive = cpu.captureRuntimeState();
	graph.refresh(input.runtime.roots, f.guest); graph.layout(font);
	const model = graph.viewport.model, nodes = model.nodes, active = nodes.map(node => node.active);
	assert.equal(nodes.length, 3); assert.equal(model.edges.length, 2);
	assert.ok(nodes.every(node => node.active), 'main and concurrent child follow their active ancestor');
	graph.viewport.selection = nodes[1]; graph.viewport.pan(25, 30);
	let measurements = 0;
	t.mock.method(font, 'measure', () => { measurements++; return 1; });
	graph.layout(font); assert.equal(measurements, 0);
	input.invalidate(); f.guest.invalidate();
	runCompletionClosure(cpu, f.guest.global('move') as Closure, []); projection.update(); graph.layout(font);
	assert.strictEqual(graph.viewport.model, model); assert.equal(measurements, 0);
	assert.strictEqual(graph.viewport.selection, nodes[1]);
	assert.equal(nodes.find(node => node.name === 'idle')!.active, false); assert.equal(nodes.find(node => node.name === 'concurrent')!.active, true);
	const scroll = [graph.viewport.scrollX, graph.viewport.scrollY];
	input.invalidate(); f.guest.invalidate();
	runCompletionClosure(cpu, f.guest.global('disable') as Closure, []); projection.update(); graph.layout(font);
	assert.ok(nodes.every(node => !node.active), 'disabled owner masks retained child selections');
	input.invalidate('history-restored'); cpu.restoreRuntimeState(alive); projection.update(); graph.layout(font);
	assert.deepEqual(nodes.map(node => node.active), active); assert.strictEqual(graph.viewport.model, model);
	assert.deepEqual([graph.viewport.scrollX, graph.viewport.scrollY], scroll);
	assert.equal(cpu.luaHeap.usedBytes(), heap, 'graph projection allocates no guest values');
	graph.viewport.selection = model.edges[0];
	graph.layout(new Font({ variant: 'msx' }));
	assert.equal(graph.viewport.selection!.kind, 'edge');
	assert.equal(resolveActorTarget(input.runtime.roots, graph.selectedTarget!, f.guest)!.hashId, nodes[1].hashId,
		'font relayout preserves the selected physical relationship');
	input.invalidate(); f.guest.invalidate();
	runCompletionClosure(cpu, f.guest.global('rename_machine') as Closure, []); projection.update(); graph.layout(font);
	assert.equal(graph.status, 'missing'); assert.equal(graph.selectedTarget, undefined);
	assert.equal(graph.viewport.model.nodes.length, 3, 'missing membership retains only display geometry');
	assert.ok(graph.viewport.model.nodes.every(node => !node.active), 'missing membership cannot retain live activity');
	input.invalidate('history-restored'); cpu.restoreRuntimeState(alive); projection.update(); graph.layout(font);
	assert.equal(graph.status, 'available', 'history restores the original typed membership');
	graph.retire('missing'); graph.layout(font);
	input.invalidate('history-restored'); cpu.restoreRuntimeState(alive); projection.update(); graph.layout(font);
	assert.equal(graph.status, 'missing', 'a retired live-branch membership needs an explicit new selection');
	input.dispose();
});

test('FSM graph selection distinguishes two memberships of the same physical state table', t => {
	const f = fixture(ENTRY.replace('return world', `local machine = probe._components[1]._machines_by_id.same
machine.states.alias = machine.states.idle
machine.state_ids[3] = 'alias'
return world`));
	t.after(() => f.stop.dispose());
	const input = new ActorLabInput(), choice = readActorChoices(f.sources, f.guest, -1)[0];
	input.domain = choice.domain; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest); projection.update();
	const machine = input.runtime.roots[0].children[0].children[0], font = new Font({ variant: 'tiny' });
	const target = captureActorTarget(-1, runtimeWorld(f.sources, f.guest, -1)!.hashId, input.runtime.roots, machine, f.guest);
	const graph = input.stateGraph = new ActorStateGraph(target, font);
	graph.refresh(input.runtime.roots, f.guest); graph.layout(font);
	const nodes = graph.viewport.model.nodes;
	const idle = nodes.find(node => node.name === 'idle')!, alias = nodes.find(node => node.name === 'alias')!;
	assert.equal(idle.hashId, alias.hashId);
	assert.equal(idle.active, true); assert.equal(alias.active, false);
	graph.viewport.selection = alias;
	const selected = graph.selectedTarget!;
	assert.strictEqual(resolveActorTarget(input.runtime.roots, selected, f.guest), machine.children.find(node => node.name === 'alias'));
	graph.layout(new Font({ variant: 'msx' }));
	assert.strictEqual(graph.selectedTarget, selected);
	input.dispose();
});

test('outline selection follows typed membership across graph return, topology changes and history gaps', t => {
	const f = fixture(ENTRY.replace('return world', `local machine = probe._components[1]._machines[1]
machine.states.alias = machine.states.idle
machine.state_ids[3] = 'alias'
function add_alias() machine.states.earlier = machine.states.idle; machine.state_ids[4] = 'earlier' end
function remove_idle() machine.states.idle = nil; machine.state_ids = { 'concurrent', 'alias' } end
return world`));
	t.after(() => f.stop.dispose());
	const input = new ActorLabInput(); t.after(() => input.dispose());
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId;
	const projection = new ActorProjection(input, f.sources, f.guest); projection.update();
	const machine = input.runtime.roots[0].children[0].children[0], cpu = f.runtime.machine.cpu;
	const target = captureActorTarget(-1, runtimeWorld(f.sources, f.guest, -1)!.hashId, input.runtime.roots, machine, f.guest);
	const graph = input.stateGraph = new ActorStateGraph(target, new Font({ variant: 'tiny' }));
	graph.refresh(input.runtime.roots, f.guest); graph.layout(new Font({ variant: 'tiny' }));
	graph.viewport.selection = graph.viewport.model.nodes.find(node => node.name === 'idle')!;
	const selected = resolveActorTarget(input.runtime.roots, graph.selectedTarget!, f.guest)!;
	assert.equal(machine.children.filter(node => node.hashId === selected.hashId).length, 2);
	projection.reveal(selected);
	const row = input.outline.rows[input.outline.selectionIndex];
	assert.strictEqual(row.element.node, selected, 'return from graph selects the actual membership, not its first table alias');
	input.invalidate(); runCompletionClosure(cpu, f.guest.global('add_alias') as Closure, []); projection.update();
	assert.strictEqual(input.outline.rows[input.outline.selectionIndex], row);
	const alive = cpu.captureRuntimeState();
	input.invalidate('history-restored'); runCompletionClosure(cpu, f.guest.global('remove_idle') as Closure, []); projection.update();
	assert.equal(input.outline.selectionIndex, -1, 'a surviving alias is not a replacement selection');
	assert.notEqual(input.selectionPath, undefined);
	input.invalidate('history-restored'); cpu.restoreRuntimeState(alive); projection.update();
	assert.equal(input.outline.rows[input.outline.selectionIndex].element.node.path, selected.path);
});

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
	const state = f.actors.read(rest.nodes.find(node => node.label === 'idle')!.reference), detailed = visits;
	assert.strictEqual(f.actors.read(state.reference).properties, state.properties);
	assert.equal(visits, detailed);
	const fields = f.stop.read(state.object.reference!, 0, 100).entries;
	const data = fields.find(entry => entry.key.display === 'data')!.value.reference!;
	assert.equal(f.stop.read(data, 0, 100).entries[0].value.display, '42', 'human property summaries do not replace expandable values');
});

test('operation identities preserve guest tags and typed membership without retaining borrowed nodes', t => {
	const f = fixture(); t.after(() => f.stop.dispose());
	const cpu = f.runtime.machine.cpu, guest = f.guest;
	const candidates: Value[] = [null, false, true, 1, valueString(cpu.stringPool.intern('1')),
		guest.global('probe'), guest.global('rename'), cpu.activeThread, createBuiltinFunction(BuiltinFunctionId.Type)];
	const heap = cpu.luaHeap.usedBytes(), identities = candidates.map(value => guest.identity(value));
	for (let i = 0; i < candidates.length; i++) for (let j = 0; j < candidates.length; j++) {
		assert.equal(guest.matchesIdentity(candidates[i], identities[j]), i === j);
	}
	const choices = readActorChoices(f.sources, guest, -1), input = new ActorLabInput();
	input.domain = -1; input.actorHashId = choices[0].hashId;
	const projection = new ActorProjection(input, f.sources, guest); projection.update();
	const selected = input.runtime.roots[0].children[0].children[0].children[0];
	const target = captureActorTarget(-1, 123, input.runtime.roots, selected, guest);
	const original = JSON.stringify(target);
	assert.equal(resolveActorTarget(input.runtime.roots, target, guest), selected);
	input.runtime.roots[0].children.reverse();
	assert.equal(resolveActorTarget(input.runtime.roots, target, guest), selected, 'membership is independent of sibling order');
	selected.key = 1;
	assert.equal(resolveActorTarget(input.runtime.roots, target, guest), undefined, 'another typed key cannot retarget a retained request');
	input.invalidate(); guest.invalidate();
	assert.equal(JSON.stringify(target), original, 'clearing borrowed nodes cannot alter the scalar operation target');
	projection.update();
	assert.equal(resolveActorTarget(input.runtime.roots, target, guest)!.hashId, selected.hashId);
	runCompletionClosure(cpu, guest.global('rename') as Closure, []);
	projection.update();
	assert.equal(resolveActorTarget(input.runtime.roots, target, guest), undefined, 'renamed membership must be selected again');
	assert.equal(cpu.luaHeap.usedBytes(), heap, 'identity capture and discovery allocate no guest values');
	input.dispose();
});

test('operation discovery is read-only and rejects absent actions, methods and executable arguments', t => {
	const f = fixture(); t.after(() => f.stop.dispose());
	const actor = f.actors.list(0, 1).actors![0].reference, nodes = f.actors.tree(actor, 0, 100).nodes;
	const root = nodes[0], state = nodes.find(node => node.kind === 'state')!;
	const before = [f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()];
	assert.equal(f.actors.operations(root.reference).actions[0].name, 'set_pos');
	assert.equal(f.actors.operations(state.reference).actions[0].name, 'transition_to');
	assert.equal(f.actors.invocation(root.reference, 'action', 'set_pos', '1, 2, 3').kind, 'action');
	assert.throws(() => f.actors.invocation(root.reference, 'action', 'transition_to', ''), /not available/);
	assert.throws(() => f.actors.invocation(root.reference, 'method', 'absent', ''), /not a stored/);
	assert.throws(() => f.actors.invocation(root.reference, 'action', 'set_pos', 'os.exit()'));
	assert.deepEqual([f.runtime.machine.scheduler.currentNowCycles(), f.runtime.machine.cpu.luaHeap.usedBytes()], before);
	f.guest.invalidate();
	assert.throws(() => f.actors.operations(root.reference), /expired/);
	assert.throws(() => f.actors.invocation(root.reference, 'action', 'set_pos', '1, 2, 3'), /expired/);
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

for (const reason of ['execution', 'history-restored', 'heap-replaced'] as const) test(`${reason} retires actor handles, typed roots and domain borrows together`, () => {
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

test('ordinary pane retains stable rows, refreshes changed labels, releases detached branches and clears identities after machine replacement', () => {
	const f = fixture(), choice = readActorChoices(f.sources, f.guest, f.stop.state.activeCartridge)[0], input = new ActorLabInput();
	input.domain = choice.domain; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest);
	projection.update();
	const rows = input.outline.rows.slice();
	assert.equal(projection.update(), false);
	assert.ok(rows.every((row, index) => row === input.outline.rows[index]));
	input.outline.roots[0].collapsed = true;
	input.invalidate(); f.guest.invalidate('execution');
	assert.ok(rows.every(row => row.element.node.value === null && row.element.node.key === null));
	runCompletionClosure(f.runtime.machine.cpu, f.guest.global('rename') as Closure, []);
	assert.equal(projection.update(), true);
	assert.equal(input.outline.roots[0].element.node.label, 'renamed');
	assert.strictEqual(input.outline.roots[0], rows[0]); assert.equal(input.outline.roots[0].collapsed, true);
	const removed = input.runtime.roots[0].children[1];
	input.invalidate(); f.guest.invalidate('execution');
	runCompletionClosure(f.runtime.machine.cpu, f.guest.global('remove') as Closure, []);
	projection.update();
	assert.equal(removed.value, null); assert.equal(removed.receiver, null);
	const root = input.runtime.roots[0];
	input.invalidate('heap-replaced');
	assert.equal(root.value, null); assert.equal(input.actorHashId, 0);
	assert.equal(input.runtime.roots.length, 0); assert.equal(input.outline.rows.length, 0);
	input.dispose(); f.stop.dispose();
});

test('hidden Actor Lab releases borrows once, without revisiting an already released retained tree', t => {
	const f = fixture(); t.after(() => f.stop.dispose());
	const choice = readActorChoices(f.sources, f.guest, -1)[0], input = new ActorLabInput();
	t.after(() => input.dispose());
	input.domain = choice.domain; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest);
	projection.update();
	const root = input.runtime.roots[0];
	let value = root.value, releases = 0;
	Object.defineProperty(root, 'value', { get: () => value, set: next => { value = next; if (next === null) releases++; } });
	input.invalidate();
	assert.equal(value, null);
	assert.equal(releases, 1);
	for (let update = 0; update < 1000; update++) input.invalidate();
	assert.equal(releases, 1);
	projection.update();
	assert.notEqual(value, null);
	input.invalidate();
	assert.equal(releases, 2, 'reacquisition owns a new borrow lifetime');
});

test('explicit Actor Lab navigation reveals a retained child through collapsed ancestors', t => {
	const f = fixture(); t.after(() => f.stop.dispose());
	const choice = readActorChoices(f.sources, f.guest, -1)[0], input = new ActorLabInput();
	input.domain = choice.domain; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest);
	projection.update();
	const root = input.outline.roots[0], selected = root.children[0].children[0].children[0];
	root.collapsed = true; root.children[0].collapsed = true;
	assert.equal(projection.update(), false, 'changing selection is independent of guest topology');
	assert.equal(projection.reveal(selected.element.node), true);
	assert.strictEqual(input.outline.rows[input.outline.selectionIndex], selected);
	assert.equal(root.collapsed, false); assert.equal(root.children[0].collapsed, false);
	assert.strictEqual(resolveActorPath(input.runtime.roots, input.selectionPath!, f.guest), selected.element.node);
	input.invalidate(); f.guest.invalidate('execution'); projection.update();
	assert.strictEqual(input.outline.rows[input.outline.selectionIndex], selected);
	input.dispose();
});

test('history selection borrows restored objects and retires unavailable bookmarks before branching', () => {
	const f = fixture(ENTRY.replace('return world', `function add()
	probe._components[3] = { id = 'late', enabled = true, _parent_component_index = 3 }
end
return world`), false), cpu = f.runtime.machine.cpu;
	const beforeBirth = cpu.captureRuntimeState();
	cpu.runUntilDepth(0, 100_000);
	const input = new ActorLabInput(), choice = readActorChoices(f.sources, f.guest, -1)[0];
	input.domain = choice.domain; input.actorHashId = choice.hashId;
	const projection = new ActorProjection(input, f.sources, f.guest);
	projection.update();
	input.outline.selectionIndex = 3; input.rememberSelection();
	const selected = input.outline.rows[3], original = selected.element.node.value;
	const alive = cpu.captureRuntimeState();
	input.invalidate('history-restored');
	assert.equal(selected.element.node.value, null);
	cpu.restoreRuntimeState(alive);
	projection.update();
	assert.strictEqual(input.outline.rows[input.outline.selectionIndex], selected);
	assert.notStrictEqual(selected.element.node.value, original);
	assert.equal(selected.element.node.value!.hashId, selected.element.node.hashId);
	input.invalidate();
	runCompletionClosure(cpu, f.guest.global('add') as Closure, []);
	projection.update();
	input.outline.selectionIndex = input.outline.rows.length - 1; input.rememberSelection();
	const futureHash = input.outline.rows[input.outline.selectionIndex].element.node.hashId;
	input.invalidate('history-restored');
	cpu.restoreRuntimeState(alive);
	projection.update();
	assert.equal(input.actorHashId, choice.hashId);
	assert.equal(input.outline.selectionIndex, -1, 'the actor survives, but its missing child has no replacement selection');
	projection.resumeHistory();
	input.invalidate();
	runCompletionClosure(cpu, f.guest.global('add') as Closure, []);
	projection.update();
	assert.equal(input.outline.rows.at(-1)!.element.node.hashId, futureHash, 'the new branch actually reuses the discarded allocation identity');
	assert.equal(input.outline.selectionIndex, -1);
	input.invalidate('history-restored');
	cpu.restoreRuntimeState(beforeBirth);
	projection.update();
	assert.equal(input.actorPresent, false);
	assert.equal(input.actorHashId, choice.hashId, 'history retains the pinned identity, not actionable stale data');
	projection.resumeHistory();
	assert.equal(input.actorHashId, 0);
	assert.equal(input.outline.rows.length, 0);
	cpu.runUntilDepth(0, 100_000);
	projection.update();
	assert.equal(input.outline.rows.length, 0, 'a later allocation cannot take over the missing selection');
	input.dispose(); f.stop.dispose();
});

test('conversation admission binds all actor handles to its own stop and prompt lifetime', async () => {
	const f = fixture(), lifetime = new AbortController();
	const tools = new WorkspaceRuntimeTools(f.inspection, f.frameNavigation, f.gameCapture, f.terminal, f.debuggerExecution, f.actorExecution, f.boots, f.hotResumes, f.events, lifetime.signal);
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

test('Find in Actor preserves and distinguishes same-value aliases under table and function keys', t => {
	const source = WORLD_SOURCE.replace('local fsm<const>', `local effects<const> = require('cartlib/actioneffects/actioneffect_component')
local fsm<const>`).replace('actor.self = actor', `actor.self = actor
local effect<const> = { active_count = 0 }
local first_key<const>, second_key<const> = {}, {}
local first_fn<const>, second_fn<const> = function() return 1 end, function() return 2 end
local component<const> = { id = 'effects', enabled = true, _parent_component_index = 3,
	effects = { [first_key] = effect, [second_key] = effect, [first_fn] = effect, [second_fn] = effect } }
actor._components[3] = component
actor._components_by_class[effects] = { component }`);
	const f = fixture(ENTRY, true, source); t.after(() => f.stop.dispose());
	const tree = new ActorRuntimeTree(); t.after(() => tree.dispose());
	tree.update(f.sources, f.guest, -1, f.guest.global('probe') as Table);
	const aliases = tree.roots[0].children[2].children;
	assert.equal(aliases.length, 4);
	assert.equal(new Set(aliases.map(node => node.hashId)).size, 1);
	const selected = aliases[1], provider = createActorMemberChoices(tree.roots, selected);
	const initial = provider.getPicks('');
	assert.equal(provider.items[initial.matches[initial.selectionIndex].itemIndex].node, selected);
	const choices = provider.items.filter(item => item.node.kind === 'effect');
	assert.deepEqual(choices.map(item => item.node), aliases);
	assert.equal(new Set(choices.map(item => item.description)).size, 4, 'aliases are distinguishable without prescribing presentation text');
	assert.equal(new Set(choices.map(item => item.detail)).size, 4, 'each membership has its own visible breadcrumb');
});

test('actor runtime retains source membership separately from stable human-facing order', t => {
	const source = WORLD_SOURCE.replace('local fsm<const>', `local timelines<const> = require('cartlib/timeline/timeline_component')
local effects<const> = require('cartlib/actioneffects/actioneffect_component')
local fsm<const>`).replace('actor.self = actor', `actor.self = actor
local other<const> = { localdef_id = 'alpha', definition = { on = {} }, states = {}, state_ids = {} }
machine.localdef_id = 'zulu'
component._machines = { machine, other }
component._machines_by_id = { zulu = machine, alpha = other }
local timeline<const> = { id = 'times', enabled = true, _parent_component_index = 3, _entries_by_id = {
	zulu = { playing = false }, alpha = { playing = true }, [1] = { playing = false }, ['1'] = { playing = false },
} }
local effect<const> = { id = 'effects', enabled = true, _parent_component_index = 4, effects = {
	zulu = { active_count = 0 }, alpha = { active_count = 1 },
} }
actor._components[3] = timeline
actor._components[4] = effect
actor._components_by_class[timelines] = { timeline }
actor._components_by_class[effects] = { effect }`);
	const entry = ENTRY.replace('return world', `function activity()
	probe._components[1]._machines[1].current_id = nil
	probe._components[3]._entries_by_id.zulu.playing = true
end
function reorder()
	local component = probe._components[1]
	component._machines[1], component._machines[2] = component._machines[2], component._machines[1]
	local machine = component._machines[2]
	machine.state_ids[1], machine.state_ids[2] = machine.state_ids[2], machine.state_ids[1]
end
function insert()
	probe._components[3]._entries_by_id.earlier = { playing = false }
end
function remove_timeline()
	probe._components[3]._entries_by_id.earlier = nil
end
function change_key_type()
	local entries = probe._components[3]._entries_by_id
	entries[1], entries['1'] = entries['1'], entries[1]
end
return world`);
	const f = fixture(entry, true, source); t.after(() => f.stop.dispose());
	const tree = new ActorRuntimeTree(); t.after(() => tree.dispose());
	const update = () => tree.update(f.sources, f.guest, -1, f.guest.global('probe') as Table);
	const call = (name: string) => {
		tree.release(); f.guest.invalidate();
		runCompletionClosure(f.runtime.machine.cpu, f.guest.global(name) as Closure, []);
		return update();
	};
	assert.equal(update(), true);
	const root = tree.roots[0], component = root.children[0], machine = component.children[0], timeline = root.children[2], effects = root.children[3];
	assert.deepEqual(component.children.map(node => node.name), ['zulu', 'alpha'], 'machine factories own machine order');
	assert.deepEqual(machine.children.map(node => node.name), ['concurrent', 'idle']);
	const ids = f.guest.readStringMember(machine.value, 'state_ids') as Table;
	assert.deepEqual([ids.getInteger(1), ids.getInteger(2)].map(value => f.guest.formatValue(value)), ['idle', 'concurrent'], 'display order does not rewrite runtime traversal');
	assert.deepEqual(timeline.children.map(node => node.name), ['1', '1', 'alpha', 'zulu']);
	assert.notDeepEqual(timeline.children[0].keyIdentity, timeline.children[1].keyIdentity, 'equal labels retain distinct guest keys');
	assert.deepEqual(effects.children.map(node => node.name), ['alpha', 'zulu']);
	const stateNodes = machine.children.slice(), timelineNodes = timeline.children.slice(), revisions = [tree.topologyRevision, tree.activityRevision];
	let sorts = 0;
	const originalSort = machine.children.sort, format = t.mock.method(f.guest, 'formatValue');
	Object.defineProperty(machine.children, 'sort', { configurable: true, value: (compare: Parameters<typeof originalSort>[0]) => {
		sorts++; return originalSort.call(machine.children, compare);
	} });
	t.after(() => Reflect.deleteProperty(machine.children, 'sort'));
	assert.equal(update(), false);
	assert.equal(call('activity'), false);
	assert.equal(tree.topologyRevision, revisions[0]); assert.equal(tree.activityRevision, revisions[1] + 1);
	assert.equal(sorts, 0); assert.equal(format.mock.callCount(), 0, 'activity-only refresh does not reformat keys');
	assert.equal(call('reorder'), true);
	assert.strictEqual(component.children[1], machine);
	assert.ok(stateNodes.every((node, index) => node === machine.children[index]), 'runtime ordering changes retain physical nodes');
	assert.equal(call('insert'), true);
	assert.deepEqual(timeline.children.map(node => node.name), ['1', '1', 'alpha', 'earlier', 'zulu']);
	assert.ok(timelineNodes.every(node => timeline.children.includes(node)), 'inserting a sibling cannot replace retained instances');
	const removed = timeline.children[3];
	assert.equal(call('remove_timeline'), true);
	assert.equal(removed.value, null); assert.equal(removed.key, null);
	assert.ok(timelineNodes.every((node, index) => node === timeline.children[index]));
	assert.equal(call('change_key_type'), true);
	assert.ok(!timeline.children.includes(timelineNodes[0]) && !timeline.children.includes(timelineNodes[1]), 'typed membership changes retire nodes even when labels match');
	assert.ok(timeline.children.includes(timelineNodes[2]) && timeline.children.includes(timelineNodes[3]));
});


test('active reveal expands all parallel paths without replacing inspection selection or rebuilding unchanged activity', t => {
	const f = fixture(ENTRY.replace('return world', `function move() probe._components[1]._machines[1].current_id = nil end
return world`));
	t.after(() => f.stop.dispose());
	const input = new ActorLabInput(); t.after(() => input.dispose());
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId;
	const projection = new ActorProjection(input, f.sources, f.guest);
	projection.update();
	const outline = input.outline;
	outline.updateLayout(0, 0, 160, 30, 10, 8);
	const machine = input.runtime.roots[0].children[0].children[0];
	const inspected = outline.rows.find(row => row.element.node.kind === 'component' && row.element.node.prefix === 'COMPONENT')!;
	outline.selectionIndex = outline.rows.indexOf(inspected);
	input.rememberSelection();
	const machineRow = outline.rows.find(row => row.element.node === machine)!;
	machineRow.collapsed = true;
	const target = captureActorTarget(-1, runtimeWorld(f.sources, f.guest, -1)!.hashId, input.runtime.roots, machine, f.guest);
	input.follow.start(target);
	projection.update();
	assert.equal(projection.revealActive(machine), true);
	outline.updateLayout(0, 0, 160, 30, 10, 8); projection.layout();
	assert.equal(machineRow.collapsed, false);
	assert.strictEqual(outline.rows[outline.selectionIndex], inspected);
	const active = outline.rows.filter(row => row.element.node.kind === 'state' && row.element.node.active);
	assert.equal(active.length, 2);
	assert.ok(active.every(row => outline.rows.indexOf(row) >= outline.scroll && outline.rows.indexOf(row) < outline.scroll + outline.layout.visibleRowCount));
	const rows = outline.rows.slice(); input.follow.pending = undefined;
	projection.update();
	assert.equal(input.follow.pending, undefined);
	assert.ok(rows.every((row, index) => row === outline.rows[index]));
	input.invalidate();
	runCompletionClosure(f.runtime.machine.cpu, f.guest.global('move') as Closure, []);
	assert.equal(projection.update(), false, 'activity alone does not rebuild topology');
	assert.strictEqual(input.follow.pending, target);
	assert.strictEqual(outline.rows[outline.selectionIndex], inspected);
	input.follow.stop(); projection.update();
	assert.equal(input.follow.target, undefined); assert.equal(input.follow.pending, undefined);
});

test('parallel tree follow reveals an active row rather than the inactive gap between them', t => {
	const f = fixture(ENTRY.replace('return world', `local machine = probe._components[1]._machines[1]
local first = machine.states.concurrent
local last = machine.states.idle
machine.states = { aaa = first, zzz = last }; machine.state_ids = { 'aaa', 'zzz' }; machine.current_id = 'zzz'
for i = 1, 20 do
	local key = 'middle_' .. i
	machine.states[key] = { definition = {}, states = {}, state_ids = {} }
	machine.state_ids[i + 2] = key
end
return world`));
	t.after(() => f.stop.dispose());
	const input = new ActorLabInput(); t.after(() => input.dispose());
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId;
	const projection = new ActorProjection(input, f.sources, f.guest); projection.update();
	const outline = input.outline;
	outline.updateLayout(0, 0, 160, 30, 10, 8); projection.layout();
	projection.reveal(input.runtime.roots[0]); projection.layout();
	outline.scroll = 8;
	const selected = outline.rows[outline.selectionIndex];
	assert.ok(outline.rows.slice(outline.scroll, outline.scroll + 3).every(row => !row.element.node.active));
	projection.revealActive(input.runtime.roots[0].children[0].children[0]); projection.layout();
	assert.ok(outline.rows.slice(outline.scroll, outline.scroll + 3).some(row => row.element.node.active));
	const scroll = outline.scroll;
	projection.revealActive(input.runtime.roots[0].children[0].children[0]); projection.layout();
	assert.equal(outline.scroll, scroll); assert.strictEqual(outline.rows[outline.selectionIndex], selected);
});

test('historical actor absence keeps collapse and follow bookmarks but heap replacement retires them', t => {
	const f = fixture(ENTRY, false), cpu = f.runtime.machine.cpu;
	t.after(() => f.stop.dispose());
	const beforeBirth = cpu.captureRuntimeState(); cpu.runUntilDepth(0, 100_000);
	const input = new ActorLabInput(); t.after(() => input.dispose());
	input.domain = -1; input.actorHashId = readActorChoices(f.sources, f.guest, -1)[0].hashId;
	const projection = new ActorProjection(input, f.sources, f.guest); projection.update();
	const machine = input.runtime.roots[0].children[0].children[0];
	const row = input.outline.rows.find(row => row.element.node === machine)!;
	row.collapsed = true;
	input.outline.selectionIndex = input.outline.rows.indexOf(row); input.rememberSelection();
	const target = captureActorTarget(-1, runtimeWorld(f.sources, f.guest, -1)!.hashId, input.runtime.roots, machine, f.guest);
	input.follow.start(target);
	const alive = cpu.captureRuntimeState();
	input.invalidate('history-restored'); cpu.restoreRuntimeState(beforeBirth); projection.update();
	assert.equal(input.actorPresent, false); assert.strictEqual(input.follow.target, target);
	assert.equal(row.element.node.value, null);
	input.invalidate('history-restored'); cpu.restoreRuntimeState(alive); projection.update();
	assert.equal(input.actorPresent, true); assert.equal(row.collapsed, true);
	assert.strictEqual(input.outline.rows[input.outline.selectionIndex], row);
	assert.strictEqual(input.follow.pending, target);
	input.invalidate('heap-replaced');
	assert.equal(input.follow.target, undefined); assert.equal(input.actorHashId, 0);
});
