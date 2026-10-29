import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import { captureInstalledLuaSources } from '../../ide/runtime/source_registry';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { Font } from '../../machine/ts/render/shared/bmsx_font';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { selectLuaProgramModules } from '../../toolchain/ts/lua/compiler/module_graph';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import type { LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { ActorRuntimeTree, findRuntimeActor, runtimeWorld } from '../../ide/workbench/contrib/actor_lab/runtime';
import { ActorStateGraph } from '../../ide/workbench/contrib/actor_lab/state_graph';
import { actorTargetsEqual, captureActorTarget } from '../../ide/workbench/contrib/actor_lab/target';
import { parseLuaChunk, runCompletionClosure } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';

const WORLD = `local fsm<const> = require('cartlib/fsm/fsm_component')
local leaf<const> = { definition = {}, states = {}, state_ids = {} }
local idle<const> = { definition = {}, states = { leaf = leaf }, state_ids = { 'leaf' }, current_id = 'leaf' }
local parallel<const> = { definition = { is_concurrent = true }, states = {}, state_ids = {} }
local machine<const> = { localdef_id = 'main', definition = {}, states = { idle = idle, parallel = parallel, alias = idle }, state_ids = { 'idle', 'parallel', 'alias' }, current_id = 'idle' }
local component<const> = { id = 'states', enabled = true, _parent_component_index = 1, _started = true, _machines = { machine }, _machines_by_id = { main = machine } }
local actor<const> = { id = 1, active = true, _components = { component }, _components_by_class = { [fsm] = { component } } }
component.parent = actor
function remove_machine() component._machines = {} component._machines_by_id.main = nil end
function remove_state() machine.state_ids = { 'parallel', 'alias' } end
function change_activity() machine.current_id = 'alias' end
return { _objects = { actor } }`;

function fixture(worldSource = WORLD) {
	const entry = "return require('cartlib/world/world')";
	const modules = [{ path: 'cartlib/world/world', source: worldSource }, { path: 'cartlib/fsm/fsm_component', source: 'return {}' }]
		.map(module => ({ ...module, chunk: parseLuaChunk(module.source, `${module.path}.lua`) }));
	const chunk = parseLuaChunk(entry, 'entry.lua');
	const compiled = compileLuaChunkToProgram(chunk, selectLuaProgramModules(chunk, modules, []), { entrySource: entry, programDomain: 'system', optLevel: 0 });
	const image = linkTestSystemBlua32(compiled), runtime = createTestRuntime(image.romBytes), cpu = runtime.machine.cpu;
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', projectRootPath: '', can_boot_from_source: false, revision: 0 };
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports, captureInstalledLuaSources(registry, image.symbols!.metadata.compiledModulePaths), TEST_SYSTEM_CONTEXT_ID), cartridgeSlots: [null, null] };
	cpu.reset(); cpu.runUntilDepth(0, 100_000);
	const guest = new SuspendedGuestSession(runtime), tree = new ActorRuntimeTree(), font = new Font({ variant: 'tiny' });
	const world = runtimeWorld(sources, guest, -1)!;
	const actors = guest.readStringMember(world, '_objects') as Table;
	const actorHashId = (actors.getInteger(1) as Table).hashId;
	tree.update(sources, guest, -1, findRuntimeActor(sources, guest, -1, actorHashId));
	const machine = tree.roots[0].children[0].children[0];
	const target = captureActorTarget(-1, world.hashId, tree.roots, machine, guest);
	const graph = new ActorStateGraph(target, font);
	const refresh = () => {
		tree.update(sources, guest, -1, findRuntimeActor(sources, guest, -1, actorHashId));
		graph.refresh(tree.roots, guest); graph.layout(font);
	};
	refresh(); graph.viewport.layout(0, 0, 100, 100);
	const snapshot = cpu.captureRuntimeState();
	const restore = () => { tree.release(); guest.invalidate('history-restored'); cpu.restoreRuntimeState(snapshot); refresh(); };
	const execute = (name: string) => { tree.release(); guest.invalidate(); runCompletionClosure(cpu, guest.global(name) as Closure, []); refresh(); };
	return { graph, target, tree, guest, font, refresh, restore, execute };
}

test('graph membership, selection and active reveal remain separate across concurrent paths and aliases', t => {
	const f = fixture(), graph = f.graph, model = graph.viewport.model;
	const idle = model.nodes.find(node => node.name === 'idle')!, leaf = idle.children[0];
	const parallel = model.nodes.find(node => node.name === 'parallel')!, alias = model.nodes.find(node => node.name === 'alias')!;
	assert.equal(idle.hashId, alias.hashId);
	assert.ok(graph.matchesTarget(f.target));
	assert.equal(graph.matchesTarget(alias.target), false);
	assert.equal(graph.selectTarget(alias.target), true);
	const selection = graph.viewport.selection;
	graph.viewport.setZoom(2);
	let reveals = 0;
	t.mock.method(graph.viewport, 'revealBounds', bounds => {
		reveals++;
		assert.deepEqual(bounds, { left: Math.min(leaf.bounds.left, parallel.bounds.left),
			top: parallel.bounds.top, right: Math.max(leaf.bounds.right, parallel.bounds.right),
			bottom: leaf.bounds.bottom });
	});
	graph.revealActive(f.target);
	assert.equal(reveals, 1);
	assert.equal(graph.viewport.selection, selection);
	assert.equal(graph.viewport.zoom, 2);
	graph.revealActive(alias.target);
	assert.equal(reveals, 1, 'inactive alias does not borrow activity from another membership');
	f.execute('change_activity');
	assert.equal(graph.viewport.model, model, 'activity does not rebuild geometry');
	assert.equal(graph.viewport.selection, selection);
	assert.equal(idle.active, false); assert.equal(alias.active, true);
});

test('a wide root does not hide an offscreen active endpoint when following with an inactive selection', () => {
	const f = fixture(WORLD.replace("localdef_id = 'main'", `localdef_id = '${'wide machine '.repeat(20)}'`)
		.replace('is_concurrent = true', 'is_concurrent = false'));
	const graph = f.graph, view = graph.viewport, nodes = view.model.nodes;
	view.setZoom(1);
	const inactive = nodes.find(node => node.name === 'alias')!, active = nodes.find(node => node.name === 'idle')!.children[0];
	graph.selectTarget(inactive.target);
	view.scrollX = nodes[0].bounds.left;
	view.scrollY = 0;
	assert.ok(active.bounds.left > view.visibleBounds.right, 'root overlaps the viewport but the active path endpoint is offscreen');
	graph.revealActive(f.target);
	const visible = view.visibleBounds;
	assert.ok(active.bounds.left >= visible.left && active.bounds.right <= visible.right);
	assert.ok(active.bounds.top >= visible.top && active.bounds.bottom <= visible.bottom);
	assert.equal(view.selection, inactive);
	assert.equal(view.zoom, 1);
});

test('parallel follow cannot settle in empty space between its active endpoints', () => {
	const f = fixture(), graph = f.graph, view = graph.viewport;
	view.setZoom(1);
	const idle = view.model.nodes.find(node => node.name === 'idle')!, leaf = idle.children[0];
	const parallel = view.model.nodes.find(node => node.name === 'parallel')!;
	const alias = view.model.nodes.find(node => node.name === 'alias')!;
	graph.selectTarget(alias.target);
	view.layout(0, 0, 12, 500);
	view.scrollX = leaf.bounds.right + 2; view.scrollY = 0;
	assert.ok(view.visibleBounds.left > leaf.bounds.right && view.visibleBounds.right < parallel.bounds.left);
	graph.revealActive(f.target);
	assert.ok(leaf.bounds.right > view.visibleBounds.left && leaf.bounds.left < view.visibleBounds.right);
	const scroll = [view.scrollX, view.scrollY];
	graph.revealActive(f.target);
	assert.deepEqual([view.scrollX, view.scrollY], scroll, 'a visible active endpoint stays anchored');
	assert.equal(view.selection, alias); assert.equal(view.zoom, 1);
});

test('a machine absent from a historical frame keeps its viewport and membership until that frame returns', () => {
	const f = fixture(), graph = f.graph, model = graph.viewport.model;
	graph.selectTarget(model.nodes[2].target);
	const selected = graph.selectedTarget!;
	graph.viewport.setZoom(2); graph.viewport.pan(13, 19);
	const scroll = [graph.viewport.scrollX, graph.viewport.scrollY];
	f.execute('remove_machine');
	assert.equal(graph.status, 'missing');
	assert.equal(graph.selectedTarget, undefined);
	assert.equal(graph.viewport.model, model);
	assert.ok(model.nodes.every(node => !node.active), 'absent physical state is not rendered as current activity');
	assert.ok(graph.matchesTarget(f.target));
	f.restore();
	assert.equal(graph.status, 'available');
	assert.equal(graph.viewport.model, model);
	assert.ok(actorTargetsEqual(graph.selectedTarget!, selected));
	assert.deepEqual([graph.viewport.scrollX, graph.viewport.scrollY], scroll);
	assert.equal(graph.viewport.zoom, 2);
	graph.retire('missing'); graph.layout(f.font); f.restore();
	assert.equal(graph.status, 'missing');
	assert.equal(graph.matchesTarget(f.target), false, 'a committed new live branch cannot resurrect retired membership');
	assert.equal(graph.viewport.model.nodes.length, 0);
});

test('an absent descendant restores its node or edge selection unless explicit input superseded it', () => {
	for (const kind of ['node', 'edge'] as const) for (const change of ['none', 'other', 'clear'] as const) {
		const f = fixture(), graph = f.graph, model = graph.viewport.model;
		const idle = model.nodes.find(node => node.name === 'idle')!;
		graph.viewport.selection = kind === 'node' ? idle : model.edges.find(edge => edge.child === idle)!;
		graph.rememberSelection();
		const selected = graph.selectedTarget!;
		f.execute('remove_state');
		assert.equal(graph.viewport.selection, null);
		let replacement = selected;
		if (change === 'other') {
			replacement = graph.viewport.model.nodes[1].target;
			assert.equal(graph.selectTarget(replacement), true);
		} else if (change === 'clear') graph.rememberSelection();
		f.restore();
		if (change === 'clear') assert.equal(graph.viewport.selection, null);
		else {
			assert.ok(actorTargetsEqual(graph.selectedTarget!, replacement));
			assert.equal(graph.viewport.selection!.kind, change === 'none' ? kind : 'node');
		}
	}
});

test('live activity-only refresh keeps admitted geometry and fit/manual camera ownership', () => {
	for (const mode of ['fit', 'manual'] as const) {
		const f = fixture(), viewport = f.graph.viewport, model = viewport.model;
		if (mode === 'manual') { viewport.setZoom(2); viewport.pan(13, 19); }
		const camera = viewport.captureViewState();
		f.execute('change_activity');
		assert.equal(viewport.model, model, 'activity is not a topology or font layout boundary');
		assert.deepEqual(viewport.captureViewState(), camera);
		assert.equal(viewport.cameraMode, mode);
		assert.equal(model.nodes.find(node => node.name === 'idle')!.active, false);
		assert.equal(model.nodes.find(node => node.name === 'alias')!.active, true);
	}
});
