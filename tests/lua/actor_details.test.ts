import assert from 'node:assert/strict';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { selectLuaProgramModules } from '../../toolchain/ts/lua/compiler/module_graph';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import type { LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { SuspendedGuestSession, type GuestInvalidationReason } from '../../ide/runtime/suspended_guest';
import { ActorDetails } from '../../ide/workbench/contrib/actor_lab/details';
import { inspectActorNode } from '../../ide/workbench/contrib/actor_lab/inspection';
import { ActorRuntimeTree, findRuntimeActor, runtimeWorld, type ActorNode } from '../../ide/workbench/contrib/actor_lab/runtime';
import { captureActorTarget, resolveActorTarget } from '../../ide/workbench/contrib/actor_lab/target';
import { BehaviorRuntimeProperties } from '../../ide/workbench/contrib/behavior_lens/runtime_properties';
import { parseLuaChunk, runCompletionClosure } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';

const WORLD = `local fsm<const> = require('cartlib/fsm/fsm_component')
local bt<const> = require('cartlib/behaviour_tree/bt_component')
local timelines<const> = require('cartlib/timeline/timeline_component')
local effects<const> = require('cartlib/actioneffects/actioneffect_component')
local state<const> = { id = 'shared', definition = { on = {} }, states = {}, state_ids = {}, data = { answer = 42 } }
local machine<const> = { localdef_id = 'main', definition = { on = {} }, states = { [1] = state, ['1'] = state }, state_ids = { 1, '1' }, current_id = 1 }
local fsm_component<const> = { id = 'fsm', enabled = true, _parent_component_index = 1, _started = true, _machines = { machine } }
local bt_component<const> = { id = 'bt', tree_id = 'tree', enabled = true, _parent_component_index = 2,
blackboard = { _layout = { keys = { 'answer', 'unset' }, initial_values = { 0 } }, _values = { 42 } } }
local timeline_component<const> = { id = 'timeline', enabled = true, _parent_component_index = 3,
_entries_by_id = { intro = { position_ms = 0, playing = true, program = { duration = 1000 } } } }
local effect_component<const> = { id = 'effects', enabled = true, _parent_component_index = 4,
effects = { pulse = { active_count = 1, definition = { cooldown_ms = 20 } } } }
local ordinary<const> = { id = 'ordinary', enabled = true, _parent_component_index = 5, value = 7 }
local actor<const> = { id = 1, definition_id = 'actor', active = true, x = 0, y = 0, z = 0,
data = { answer = 42, nested = { value = 7 } }, tags = {}, events = {},
_components = { fsm_component, bt_component, timeline_component, effect_component, ordinary },
_components_by_class = { [fsm] = { fsm_component }, [bt] = { bt_component }, [timelines] = { timeline_component }, [effects] = { effect_component } } }
local world<const> = { _objects = { actor }, gameplay_time_ms = 0 }
fsm_component.parent = actor; bt_component.parent = actor; timeline_component.parent = actor; effect_component.parent = actor
actor.world = world
function change_data() actor.data.answer = 43; actor.data.nested.value = 8 end
function grow_component() ordinary.extra = { value = 9 } end
function remove_numeric() machine.states[1] = nil; machine.state_ids = { '1' } end
return world`;

function fixture() {
	const entry = "return require('cartlib/world/world')";
	const modules = [{ path: 'cartlib/world/world', source: WORLD },
		...['cartlib/fsm/fsm_component', 'cartlib/behaviour_tree/bt_component', 'cartlib/timeline/timeline_component', 'cartlib/actioneffects/actioneffect_component']
			.map(path => ({ path, source: 'return {}' }))]
		.map(module => ({ ...module, chunk: parseLuaChunk(module.source, `${module.path}.lua`) }));
	const chunk = parseLuaChunk(entry, 'entry.lua');
	const compiled = compileLuaChunkToProgram(chunk, selectLuaProgramModules(chunk, modules, []), { entrySource: entry, programDomain: 'system', optLevel: 0 });
	const image = linkTestSystemBlua32(compiled), runtime = createTestRuntime(image.romBytes), cpu = runtime.machine.cpu;
	const registry: LuaSourceRegistry = { records: [], path2lua: {}, module2lua: {}, entrySourcePath: '', projectRootPath: '', can_boot_from_source: false, revision: 0 };
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports), cartridgeSlots: [null, null] };
	cpu.reset(); cpu.runUntilDepth(0, 100_000);
	const guest = new SuspendedGuestSession(runtime), tree = new ActorRuntimeTree(), details = new ActorDetails(sources, guest);
	const world = runtimeWorld(sources, guest, -1)!;
	const actorHashId = ((guest.readStringMember(world, '_objects') as Table).getInteger(1) as Table).hashId;
	const update = () => tree.update(sources, guest, -1, findRuntimeActor(sources, guest, -1, actorHashId));
	update();
	const target = captureActorTarget(-1, world.hashId, tree.roots, tree.roots[0], guest);
	const invalidate = (reason: GuestInvalidationReason = 'execution') => { tree.release(); guest.invalidate(reason); details.invalidate(reason); };
	const execute = (name: string) => { invalidate(); runCompletionClosure(cpu, guest.global(name) as Closure, []); update(); };
	return { cpu, runtime, sources, guest, tree, details, target, update, invalidate, execute };
}

test('actor inspection shares one retained property sink across every runtime node kind', t => {
	const f = fixture(); t.after(() => f.tree.dispose());
	const kinds = new Set<ActorNode['kind']>();
	const visit = (nodes: readonly ActorNode[]) => {
		for (const node of nodes) {
			kinds.add(node.kind);
			const properties = new BehaviorRuntimeProperties(f.sources, f.guest);
			properties.begin();
			const document = inspectActorNode(f.sources, f.guest, node, properties), rows = document.slice();
			assert.deepEqual(document, inspectActorNode(f.sources, f.guest, node));
			properties.begin();
			assert.strictEqual(inspectActorNode(f.sources, f.guest, node, properties), document);
			assert.equal(properties.changed, false);
			assert.ok(document.every((row, index) => row === rows[index]));
			visit(node.children);
		}
	};
	visit(f.tree.roots);
	assert.deepEqual([...kinds].sort(), ['actor', 'component', 'effect', 'machine', 'state', 'timeline', 'tree']);
});

test('actor details reads only dirty suspensions and retains warmed property rows and formatting', t => {
	const f = fixture(); t.after(() => f.tree.dispose());
	const document = f.details.refresh(f.tree.roots[0], f.target.path)!, rows = document.slice();
	let formatted = 0, reads = 0;
	const format = f.guest.formatStoredEntries.bind(f.guest), read = f.guest.readStringMember.bind(f.guest);
	t.mock.method(f.guest, 'formatStoredEntries', (value: Parameters<typeof format>[0]) => { formatted++; return format(value); });
	t.mock.method(f.guest, 'readStringMember', (...args: Parameters<typeof read>) => { reads++; return read(...args); });
	for (let frame = 0; frame < 1000; frame++) assert.equal(f.details.refresh(f.tree.roots[0], f.target.path), undefined);
	assert.equal(reads, 0);
	const before = [f.cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()];
	for (let frame = 0; frame < 1000; frame++) {
		f.invalidate(); f.update();
		assert.equal(f.details.refresh(f.tree.roots[0], f.target.path), undefined);
	}
	assert.equal(formatted, 0);
	assert.ok(reads > 1000);
	assert.ok(document.every((row, index) => row === rows[index]));
	assert.deepEqual([f.cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()], before);
	const previous = document.map(row => row.value);
	f.execute('change_data');
	assert.strictEqual(f.details.refresh(f.tree.roots[0], f.target.path), document);
	assert.equal(document.filter((row, index) => row.value !== previous[index]).length, 1);
	assert.equal(formatted, 1);
});

test('explicit selection changes refresh details without execution and mutable members remain authoritative', t => {
	const f = fixture(); t.after(() => f.tree.dispose());
	const document = f.details.refresh(f.tree.roots[0], f.target.path)!;
	const component = f.tree.roots[0].children.find(node => node.name === 'ordinary')!;
	const target = captureActorTarget(-1, f.target.worldHashId, f.tree.roots, component, f.guest);
	assert.strictEqual(f.details.refresh(component, target.path), document);
	assert.deepEqual(document, inspectActorNode(f.sources, f.guest, component));
	const length = document.length;
	f.execute('grow_component');
	assert.strictEqual(f.details.refresh(resolveActorTarget(f.tree.roots, target, f.guest), target.path), document);
	assert.equal(document.length, length + 1);
	assert.deepEqual(document, inspectActorNode(f.sources, f.guest, resolveActorTarget(f.tree.roots, target, f.guest)!));
});

test('details clears missing typed membership instead of borrowing an alias and reacquires history values', t => {
	const f = fixture(); t.after(() => f.tree.dispose());
	const state = f.tree.roots[0].children[0].children[0].children.find(node => node.key === 1)!;
	const target = captureActorTarget(-1, f.target.worldHashId, f.tree.roots, state, f.guest);
	const document = f.details.refresh(state, target.path)!, before = structuredClone(document), alive = f.cpu.captureRuntimeState();
	const originalValue = state.value;
	f.execute('remove_numeric');
	assert.equal(resolveActorTarget(f.tree.roots, target, f.guest), undefined);
	assert.strictEqual(f.details.refresh(undefined, target.path), document);
	assert.ok(document.every(property => property.warning));
	assert.equal(f.details.refresh(undefined, target.path), undefined);
	f.invalidate('history-restored'); f.cpu.restoreRuntimeState(alive); f.update();
	const restored = resolveActorTarget(f.tree.roots, target, f.guest)!;
	assert.notStrictEqual(restored.value, originalValue);
	assert.strictEqual(f.details.refresh(restored, target.path), document);
	assert.deepEqual(document, before);
	f.invalidate('heap-replaced');
	assert.strictEqual(f.details.refresh(undefined, undefined), document);
	assert.ok(document.every(property => property.source === undefined));
	assert.equal(f.details.refresh(undefined, undefined), undefined);
});

test('history and heap replacement invalidate warmed value presentations even when raw identities match', t => {
	const f = fixture(); t.after(() => f.tree.dispose());
	f.details.refresh(f.tree.roots[0], f.target.path);
	let formatted = 0;
	const format = f.guest.formatStoredEntries.bind(f.guest);
	t.mock.method(f.guest, 'formatStoredEntries', (value: Parameters<typeof format>[0]) => { formatted++; return format(value); });
	f.details.invalidate();
	assert.equal(f.details.refresh(f.tree.roots[0], f.target.path), undefined);
	assert.equal(formatted, 0);
	f.details.invalidate('history-restored');
	assert.equal(f.details.refresh(f.tree.roots[0], f.target.path), undefined);
	assert.equal(formatted, f.details.items.length);
	f.details.invalidate('heap-replaced');
	assert.equal(f.details.refresh(f.tree.roots[0], f.target.path), undefined);
	assert.equal(formatted, 2 * f.details.items.length);
});
