import assert from 'node:assert/strict';
import test from 'node:test';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { compileLuaChunkToProgram } from '../../toolchain/ts/lua/compiler';
import { selectLuaProgramModules } from '../../toolchain/ts/lua/compiler/module_graph';
import { createBlua32SystemSourceImage } from '../../ide/runtime/sources';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { SuspendedGuestSession, type GuestInvalidationReason } from '../../ide/runtime/suspended_guest';
import { ActorDetails, actorDetailsPropertiesEqual, actorDetailsPropertyMatchesSelection, captureActorDetailsSelection } from '../../ide/workbench/contrib/actor_lab/details';
import { inspectActorNode } from '../../ide/workbench/contrib/actor_lab/inspection';
import { ActorRuntimeTree, findRuntimeActor, runtimeWorld, type ActorNode } from '../../ide/workbench/contrib/actor_lab/runtime';
import { captureActorTarget, resolveActorTarget } from '../../ide/workbench/contrib/actor_lab/target';
import { BehaviorRuntimeProperties, runtimePropertyIdentitiesEqual } from '../../ide/workbench/contrib/behavior_lens/runtime_properties';
import { parseLuaChunk, runCompletionClosure } from './cpu_test_harness';
import { linkTestSystemBlua32 } from '../helpers/blua32';
import { createTestRuntime, createTestSystemImageRuntimeSourceState } from '../helpers/runtime_sources';

const WORLD = `local fsm<const> = require('cartlib/fsm/fsm_component')
local bt<const> = require('cartlib/behaviour_tree/bt_component')
local timelines<const> = require('cartlib/timeline/timeline_component')
local effects<const> = require('cartlib/actioneffects/actioneffect_component')
local state<const> = { id = 'shared', definition = { on = {}, input_patterns = { 'first' }, input_transitions = { 'transition' } }, states = {}, state_ids = {}, data = { answer = 42 } }
local machine<const> = { localdef_id = 'main', definition = { on = {} }, states = { [1] = state, ['1'] = state }, state_ids = { 1, '1' }, current_id = 1 }
local fsm_component<const> = { id = 'fsm', enabled = true, _parent_component_index = 1, _started = true, _machines = { machine } }
local bt_component<const> = { id = 'bt', tree_id = 'tree', enabled = true, _parent_component_index = 2,
blackboard = { _layout = { keys = { 'answer', 'unset' }, initial_values = { 0 } }, _values = { 42 } } }
local timeline_component<const> = { id = 'timeline', enabled = true, _parent_component_index = 3,
_entries_by_id = { intro = { position_ms = 0, playing = true, program = { duration = 1000 } } } }
local effect_component<const> = { id = 'effects', enabled = true, _parent_component_index = 4,
effects = { pulse = { active_count = 1, definition = { cooldown_ms = 20 } } } }
local ordinary<const> = { id = 'ordinary', enabled = true, _parent_component_index = 5, value = 7, [1] = 'numeric', ['1'] = 'string', callback = function() return 1 end }
local actor<const> = { id = 1, definition_id = 'actor', active = true, x = 0, y = 0, z = 0,
data = { answer = 42, nested = { value = 7 } }, tags = {}, events = {},
_components = { fsm_component, bt_component, timeline_component, effect_component, ordinary },
_components_by_class = { [fsm] = { fsm_component }, [bt] = { bt_component }, [timelines] = { timeline_component }, [effects] = { effect_component } } }
local other<const> = { id = 2, definition_id = 'other', active = true, x = 20, y = 30, z = 40,
data = {}, tags = {}, events = {}, _components = {}, _components_by_class = {} }
local world<const> = { _objects = { actor, other }, gameplay_time_ms = 0 }
fsm_component.parent = actor; bt_component.parent = actor; timeline_component.parent = actor; effect_component.parent = actor
actor.world = world
function change_data() actor.data.answer = 43; actor.data.nested.value = 8 end
function grow_component() ordinary.extra = { value = 9 } end
function remove_numeric() machine.states[1] = nil; machine.state_ids = { '1' } end
function change_positions() actor.x = actor.x + 1; actor.y = actor.y + 2; other.x = other.x + 3 end
function change_keys() ordinary[1] = 'numeric changed'; ordinary['1'] = 'string changed' end
function remove_numeric_field() ordinary[1] = nil end
function remove_actor() world._objects = { other } end
function add_future_field() ordinary['future' .. actor.x] = 91 end
function replace_callback() ordinary.callback = 99 end
function change_input_pattern() state.definition.input_patterns[1] = 'second' end
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
	for (const module of modules) registerLuaSourceRecord(registry, {
		resid: module.path, type: 'lua', src: module.source, base_src: module.source, base_update_timestamp: 0,
		source_path: `${module.path}.lua`, normalized_source_path: `${module.path}.lua`, module_path: module.path,
		update_timestamp: 0, generated: false, program_module: true,
	});
	const sources = createTestSystemImageRuntimeSourceState(image.romBytes, registry);
	sources.currentBlua32Media = { system: createBlua32SystemSourceImage(image.image, image.symbols, image.biosImports), cartridgeSlots: [null, null] };
	cpu.reset(); const beforeBirth = cpu.captureRuntimeState(); cpu.runUntilDepth(0, 100_000);
	const guest = new SuspendedGuestSession(runtime), tree = new ActorRuntimeTree(), details = new ActorDetails(sources, guest);
	const world = runtimeWorld(sources, guest, -1)!;
	const objects = guest.readStringMember(world, '_objects') as Table;
	const actorHashId = (objects.getInteger(1) as Table).hashId, otherHashId = (objects.getInteger(2) as Table).hashId;
	const update = (hashId = actorHashId) => tree.update(sources, guest, -1, findRuntimeActor(sources, guest, -1, hashId));
	update();
	const target = captureActorTarget(-1, world.hashId, tree.roots, tree.roots[0], guest);
	const invalidate = (reason: GuestInvalidationReason = 'execution') => { tree.release(); guest.invalidate(reason); details.invalidate(reason); };
	const execute = (name: string) => { invalidate(); runCompletionClosure(cpu, guest.global(name) as Closure, []); update(); };
	return { cpu, runtime, sources, guest, tree, details, target, update, invalidate, execute, beforeBirth, actorHashId, otherHashId };
}

test('actor inspection shares one retained property sink across every runtime node kind', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
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
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	const document = f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false)!, rows = document.slice();
	let formatted = 0, reads = 0;
	const format = f.guest.formatStoredEntries.bind(f.guest), read = f.guest.readStringMember.bind(f.guest);
	t.mock.method(f.guest, 'formatStoredEntries', (value: Parameters<typeof format>[0]) => { formatted++; return format(value); });
	t.mock.method(f.guest, 'readStringMember', (...args: Parameters<typeof read>) => { reads++; return read(...args); });
	for (let frame = 0; frame < 1000; frame++) assert.equal(f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false), undefined);
	assert.equal(reads, 0);
	const before = [f.cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()];
	for (let frame = 0; frame < 1000; frame++) {
		f.invalidate(); f.update();
		assert.equal(f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false), undefined);
	}
	assert.equal(formatted, 0);
	assert.ok(reads > 1000);
	assert.ok(document.every((row, index) => row === rows[index]));
	assert.deepEqual([f.cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()], before);
	const previous = document.map(row => row.value);
	f.execute('change_data');
	assert.strictEqual(f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false), document);
	assert.equal(document.filter((row, index) => row.value !== previous[index]).length, 1);
	assert.equal(formatted, 1);
});

test('explicit selection changes refresh details without execution and mutable members remain authoritative', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	const document = f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false)!;
	const component = f.tree.roots[0].children.find(node => node.name === 'ordinary')!;
	const target = captureActorTarget(-1, f.target.worldHashId, f.tree.roots, component, f.guest);
	assert.strictEqual(f.details.refresh(component, target.path, f.tree, -1, false), document);
	assert.deepEqual(document, inspectActorNode(f.sources, f.guest, component));
	const length = document.length;
	f.execute('grow_component');
	assert.strictEqual(f.details.refresh(resolveActorTarget(f.tree.roots, target, f.guest), target.path, f.tree, -1, false), document);
	assert.equal(document.length, length + 1);
	assert.deepEqual(document, inspectActorNode(f.sources, f.guest, resolveActorTarget(f.tree.roots, target, f.guest)!));
});

test('details clears missing typed membership instead of borrowing an alias and reacquires history values', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	const state = f.tree.roots[0].children[0].children[0].children.find(node => node.key === 1)!;
	const target = captureActorTarget(-1, f.target.worldHashId, f.tree.roots, state, f.guest);
	const document = f.details.refresh(state, target.path, f.tree, -1, false)!, before = structuredClone(document), alive = f.cpu.captureRuntimeState();
	const originalValue = state.value;
	f.execute('remove_numeric');
	assert.equal(resolveActorTarget(f.tree.roots, target, f.guest), undefined);
	assert.strictEqual(f.details.refresh(undefined, target.path, f.tree, -1, false), document);
	assert.ok(document.every(property => property.warning));
	assert.equal(f.details.refresh(undefined, target.path, f.tree, -1, false), undefined);
	f.invalidate('history-restored'); f.cpu.restoreRuntimeState(alive); f.update();
	const restored = resolveActorTarget(f.tree.roots, target, f.guest)!;
	assert.notStrictEqual(restored.value, originalValue);
	assert.strictEqual(f.details.refresh(restored, target.path, f.tree, -1, false), document);
	assert.deepEqual(document, before);
	f.invalidate('heap-replaced');
	assert.strictEqual(f.details.refresh(undefined, undefined, f.tree, -1, false), document);
	assert.ok(document.every(property => property.source === undefined));
	assert.equal(f.details.refresh(undefined, undefined, f.tree, -1, false), undefined);
});

test('history and heap replacement invalidate warmed value presentations even when raw identities match', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	let formatted = 0;
	const format = f.guest.formatStoredEntries.bind(f.guest);
	t.mock.method(f.guest, 'formatStoredEntries', (value: Parameters<typeof format>[0]) => { formatted++; return format(value); });
	f.details.invalidate();
	assert.equal(f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false), undefined);
	assert.equal(formatted, 0);
	f.details.invalidate('history-restored');
	assert.equal(f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false), undefined);
	assert.equal(formatted, f.details.items.length);
	f.details.invalidate('heap-replaced');
	assert.equal(f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false), undefined);
	assert.equal(formatted, 2 * f.details.items.length);
});

test('pins retain independent row identities and filter a shared projection of another selected node', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	const x = f.details.items.find(item => item.label === 'x')!, y = f.details.items.find(item => item.label === 'y')!;
	const xPin = f.details.watches.add(f.target, 'actor', x), yPin = f.details.watches.add(f.target, 'actor', y);
	assert.notStrictEqual(xPin.item, x);
	assert.equal(actorDetailsPropertiesEqual(xPin.item, x), false);
	assert.equal(actorDetailsPropertyMatchesSelection(xPin.item, captureActorDetailsSelection(xPin.item)), true);
	assert.equal(actorDetailsPropertyMatchesSelection(x, captureActorDetailsSelection(xPin.item)), false);
	assert.strictEqual(f.details.watches.find(f.target, x.identity!), xPin);
	const component = f.tree.roots[0].children.find(node => node.name === 'ordinary')!;
	const componentTarget = captureActorTarget(-1, f.target.worldHashId, f.tree.roots, component, f.guest);
	const actorData = f.guest.readStringMember(f.tree.roots[0].value, 'data');
	let unpinnedFormats = 0;
	const format = f.guest.formatStoredEntries.bind(f.guest);
	t.mock.method(f.guest, 'formatStoredEntries', (value: Parameters<typeof format>[0]) => {
		if (value === actorData) unpinnedFormats++;
		return format(value);
	});
	f.details.refresh(component, componentTarget.path, f.tree, -1, false);
	assert.equal(unpinnedFormats, 0, 'a watched node does not format its unpinned data table');
	assert.deepEqual(f.details.items.slice(0, 2), [xPin.item, yPin.item]);
	const read = f.guest.readStringMember.bind(f.guest);
	let xReads = 0, yReads = 0;
	t.mock.method(f.guest, 'readStringMember', (...args: Parameters<typeof read>) => {
		if (args[0] === f.tree.roots[0].value && args[1] === 'x') xReads++;
		if (args[0] === f.tree.roots[0].value && args[1] === 'y') yReads++;
		return read(...args);
	});
	f.execute('change_positions');
	f.details.refresh(resolveActorTarget(f.tree.roots, componentTarget, f.guest), componentTarget.path, f.tree, -1, false);
	assert.equal(xPin.item.value, '1'); assert.equal(yPin.item.value, '2');
	assert.equal(xReads, 1); assert.equal(yReads, 1, 'two same-node pins share one property projection');
	f.details.watches.remove(xPin);
	f.details.refresh(resolveActorTarget(f.tree.roots, componentTarget, f.guest), componentTarget.path, f.tree, -1, false);
	assert.equal(f.details.watches.find(f.target, x.identity!), undefined);
	assert.strictEqual(f.details.items[0], yPin.item);
});

test('watch readback is idle while dirty but unrefreshed, clean reads do no work, and warmed reads do not execute the guest', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	f.details.watches.add(f.target, 'actor', f.details.items.find(item => item.label === 'x')!);
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	let reads = 0, formats = 0;
	const read = f.guest.readStringMember.bind(f.guest), format = f.guest.formatStoredEntries.bind(f.guest);
	t.mock.method(f.guest, 'readStringMember', (...args: Parameters<typeof read>) => { reads++; return read(...args); });
	t.mock.method(f.guest, 'formatStoredEntries', (value: Parameters<typeof format>[0]) => { formats++; return format(value); });
	const before = [f.cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()];
	for (let frame = 0; frame < 1000; frame++) assert.equal(f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false), undefined);
	assert.equal(reads, 0); assert.equal(formats, 0);
	f.invalidate();
	assert.equal(reads, 0, 'invalidation does not enumerate or format a hidden document');
	for (let frame = 0; frame < 100; frame++) {
		f.update();
		assert.equal(f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false), undefined);
		f.invalidate();
	}
	assert.ok(reads > 0); assert.equal(formats, 0);
	assert.deepEqual([f.cpu.luaHeap.usedBytes(), f.runtime.machine.scheduler.currentNowCycles()], before);
});

test('cross-actor pins keep their actor membership and reconcile one tree per watched actor, not per pin', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	const xPin = f.details.watches.add(f.target, 'actor', f.details.items.find(item => item.label === 'x')!);
	const yPin = f.details.watches.add(f.target, 'actor', f.details.items.find(item => item.label === 'y')!);
	f.update(f.otherHashId);
	const otherTarget = captureActorTarget(-1, f.target.worldHashId, f.tree.roots, f.tree.roots[0], f.guest);
	f.details.refresh(f.tree.roots[0], otherTarget.path, f.tree, -1, false);
	assert.equal(xPin.item.value, '0'); assert.equal(yPin.item.value, '0');
	assert.equal(f.details.items.find(item => item.watch === undefined && item.label === 'x')!.value, '20');
	f.execute('change_positions'); f.update(f.otherHashId);
	const update = ActorRuntimeTree.prototype.update;
	let watchedUpdates = 0;
	t.mock.method(ActorRuntimeTree.prototype, 'update', function (this: ActorRuntimeTree, ...args: Parameters<typeof update>) {
		if (args[3]?.hashId === f.actorHashId) watchedUpdates++;
		return update.apply(this, args);
	});
	f.details.refresh(f.tree.roots[0], otherTarget.path, f.tree, -1, false);
	assert.equal(watchedUpdates, 1);
	assert.equal(xPin.item.value, '1'); assert.equal(yPin.item.value, '2');
	assert.equal(f.details.items.find(item => item.watch === undefined && item.label === 'x')!.value, '23');
	assert.equal(f.details.refresh(f.tree.roots[0], otherTarget.path, f.tree, -1, false), undefined);
	assert.equal(watchedUpdates, 1);
});

test('cross-actor pinned tables reread mutable entries and format only after their contents change', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	const pin = f.details.watches.add(f.target, 'actor', f.details.items.find(item => item.label === 'data')!);
	f.update(f.otherHashId);
	const otherTarget = captureActorTarget(-1, f.target.worldHashId, f.tree.roots, f.tree.roots[0], f.guest);
	f.details.refresh(f.tree.roots[0], otherTarget.path, f.tree, -1, false);
	const original = pin.item.value;
	let formats = 0;
	const format = f.guest.formatStoredEntries.bind(f.guest);
	t.mock.method(f.guest, 'formatStoredEntries', (value: Parameters<typeof format>[0]) => { formats++; return format(value); });
	f.invalidate(); f.update(f.otherHashId);
	assert.equal(f.details.refresh(f.tree.roots[0], otherTarget.path, f.tree, -1, false), undefined);
	assert.equal(formats, 0);
	f.execute('change_data'); f.update(f.otherHashId);
	f.details.refresh(f.tree.roots[0], otherTarget.path, f.tree, -1, false);
	assert.notEqual(pin.item.value, original);
	assert.equal(formats, 1);
	const actor = findRuntimeActor(f.sources, f.guest, -1, f.actorHashId)!;
	assert.equal(pin.item.value, format(f.guest.readStringMember(actor, 'data')));
});

test('pinned property identities distinguish numeric and string keys with identical display labels', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	const component = f.tree.roots[0].children.find(node => node.name === 'ordinary')!;
	const target = captureActorTarget(-1, f.target.worldHashId, f.tree.roots, component, f.guest);
	f.details.refresh(component, target.path, f.tree, -1, false);
	const numeric = f.details.items.find(item => item.value === 'numeric')!, string = f.details.items.find(item => item.value === 'string')!;
	assert.equal(numeric.label, string.label);
	assert.equal(runtimePropertyIdentitiesEqual(numeric.identity!, string.identity!), false);
	assert.equal(actorDetailsPropertiesEqual(numeric, string), false);
	const numericPin = f.details.watches.add(target, 'ordinary', numeric), stringPin = f.details.watches.add(target, 'ordinary', string);
	f.execute('change_keys');
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	assert.equal(numericPin.item.value, 'numeric changed'); assert.equal(stringPin.item.value, 'string changed');
	f.execute('remove_numeric_field');
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	assert.equal(numericPin.available, false); assert.equal(numericPin.item.source, undefined);
	assert.equal(stringPin.available, true); assert.equal(stringPin.item.value, 'string changed');
});

test('typed node pins survive history absence and recover without borrowing a same-table alias', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	const state = f.tree.roots[0].children[0].children[0].children.find(node => node.key === 1)!;
	const target = captureActorTarget(-1, f.target.worldHashId, f.tree.roots, state, f.guest);
	f.details.refresh(state, target.path, f.tree, -1, false);
	const pin = f.details.watches.add(target, 'state', f.details.items.find(item => item.label === 'INSTANCE DATA')!);
	const original = pin.item.value, alive = f.cpu.captureRuntimeState();
	f.execute('remove_numeric'); const missing = f.cpu.captureRuntimeState();
	f.invalidate('history-restored'); f.cpu.restoreRuntimeState(missing); f.update();
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, true);
	assert.equal(pin.available, false); assert.equal(pin.retired, false);
	assert.ok(f.tree.roots[0].children[0].children[0].children.some(node => node.hashId === target.path[target.path.length - 1].hashId));
	f.invalidate('history-restored'); f.cpu.restoreRuntimeState(alive); f.update();
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, true);
	assert.equal(pin.available, true); assert.equal(pin.item.value, original);
});

test('live actor removal retires its watches and later invalidations do not read retired memberships', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	const pin = f.details.watches.add(f.target, 'actor', f.details.items.find(item => item.label === 'x')!);
	f.execute('remove_actor');
	f.details.refresh(undefined, f.target.path, f.tree, -1, false);
	assert.equal(pin.retired, true); assert.equal(pin.available, false);
	let reads = 0;
	const read = f.guest.readStringMember.bind(f.guest);
	t.mock.method(f.guest, 'readStringMember', (...args: Parameters<typeof read>) => { reads++; return read(...args); });
	for (let frame = 0; frame < 100; frame++) {
		f.invalidate();
		assert.equal(f.details.refresh(undefined, f.target.path, f.tree, -1, false), undefined);
	}
	assert.equal(reads, 0);
});

test('live branch admission retires an absent actor before discarded-future allocation ids are reused', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	const pin = f.details.watches.add(f.target, 'actor', f.details.items.find(item => item.label === 'x')!);
	f.invalidate('history-restored'); f.cpu.restoreRuntimeState(f.beforeBirth); f.update();
	f.details.refresh(undefined, f.target.path, f.tree, -1, true);
	assert.equal(pin.available, false); assert.equal(pin.retired, false);
	f.details.watches.resumeHistory(f.tree, -1);
	assert.equal(pin.retired, true);
	f.invalidate(); f.cpu.runUntilDepth(0, 100_000); f.update();
	assert.equal(f.tree.roots[0].hashId, f.target.actorHashId);
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	assert.equal(pin.available, false);
	assert.equal(f.details.watches.find(f.target, pin.property), undefined);
});

test('live branch admission also retires absent dynamic property memberships on a surviving node', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	const beforeField = f.cpu.captureRuntimeState();
	f.execute('add_future_field');
	const component = f.tree.roots[0].children.find(node => node.name === 'ordinary')!;
	const target = captureActorTarget(-1, f.target.worldHashId, f.tree.roots, component, f.guest);
	f.details.refresh(component, target.path, f.tree, -1, false);
	const pin = f.details.watches.add(target, 'ordinary', f.details.items.find(item => item.value === '91')!);
	f.invalidate('history-restored'); f.cpu.restoreRuntimeState(beforeField); f.update();
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, true);
	assert.equal(pin.available, false); assert.equal(pin.retired, false);
	f.details.watches.resumeHistory(f.tree, -1);
	assert.equal(pin.retired, true);
	f.execute('add_future_field');
	const restored = resolveActorTarget(f.tree.roots, target, f.guest)!;
	f.details.refresh(restored, target.path, f.tree, -1, false);
	const reused = f.details.items.find(item => item.watch === undefined && item.value === '91')!;
	assert.equal(runtimePropertyIdentitiesEqual(reused.identity!, pin.property), true, 'the guest reused the discarded-future string id');
	assert.equal(pin.available, false);
	const repinned = f.details.watches.add(target, 'ordinary', reused);
	f.details.watches.remove(pin);
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	assert.strictEqual(f.details.watches.find(target, reused.identity!), repinned);
	assert.equal(repinned.available, true); assert.equal(repinned.item.value, '91');
});

test('heap replacement retires pins, clears loaded source actions, and keeps each watch independently removable', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	const component = f.tree.roots[0].children.find(node => node.name === 'ordinary')!;
	const target = captureActorTarget(-1, f.target.worldHashId, f.tree.roots, component, f.guest);
	f.details.refresh(component, target.path, f.tree, -1, false);
	const pin = f.details.watches.add(target, 'ordinary', f.details.items.find(item => item.label === 'callback')!);
	assert.ok(pin.item.source !== undefined);
	f.invalidate('heap-replaced'); f.tree.dispose();
	f.details.refresh(undefined, undefined, f.tree, -1, false);
	assert.equal(pin.retired, true); assert.equal(pin.available, false); assert.equal(pin.item.source, undefined);
	assert.strictEqual(f.details.items[0], pin.item);
	f.details.watches.remove(pin);
	f.details.refresh(undefined, undefined, f.tree, -1, false);
	assert.equal(f.details.items.some(item => item.watch !== undefined), false);
});

test('pinned callbacks reuse current loaded source mappings and clear them when their value stops being a closure', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	const component = f.tree.roots[0].children.find(node => node.name === 'ordinary')!;
	const target = captureActorTarget(-1, f.target.worldHashId, f.tree.roots, component, f.guest);
	f.details.refresh(component, target.path, f.tree, -1, false);
	const pin = f.details.watches.add(target, 'ordinary', f.details.items.find(item => item.label === 'callback')!);
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	const source = pin.item.source;
	assert.ok(source !== undefined); assert.equal(source.resource.domain, -1);
	for (let frame = 0; frame < 100; frame++) {
		f.invalidate(); f.update(); f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
		assert.strictEqual(pin.item.source, source);
	}
	f.execute('replace_callback');
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	assert.equal(pin.available, true); assert.equal(pin.item.source, undefined); assert.equal(pin.item.value, '99');
});

test('watch labels update independently of a stable indexed runtime property identity', t => {
	const f = fixture(); t.after(() => { f.details.dispose(); f.tree.dispose(); });
	const state = f.tree.roots[0].children[0].children[0].children.find(node => node.key === 1)!;
	const target = captureActorTarget(-1, f.target.worldHashId, f.tree.roots, state, f.guest);
	f.details.refresh(state, target.path, f.tree, -1, false);
	const property = f.details.items.find(item => item.identity?.section === 'input')!;
	const pin = f.details.watches.add(target, 'state', property), label = pin.item.label, value = pin.item.value;
	f.execute('change_input_pattern');
	f.details.refresh(f.tree.roots[0], f.target.path, f.tree, -1, false);
	assert.notEqual(pin.item.label, label); assert.equal(pin.item.value, value);
	assert.strictEqual(f.details.watches.find(target, property.identity!), pin);
});
