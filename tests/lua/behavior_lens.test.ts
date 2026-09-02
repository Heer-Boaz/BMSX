import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import type { BehaviorSourceNode } from '../../ide/workbench/contrib/behavior_lens/model';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';

function buildDocument(path: string, source: string) {
	return buildBehaviorSourceDocument(
		{ domain: 0, path },
		buildLuaFileSemanticData(source, path),
	);
}

function flatten(nodes: readonly BehaviorSourceNode[]): BehaviorSourceNode[] {
	const result: BehaviorSourceNode[] = [];
	const pending = nodes.slice();
	while (pending.length > 0) {
		const node = pending.pop()!;
		result.push(node);
		for (let index = node.children.length - 1; index >= 0; index -= 1) {
			pending.push(node.children[index]);
		}
	}
	return result;
}

test('behavior lens gives reused Moon behavior-tree initializers distinct view occurrences', () => {
	const path = 'carts/nemesis_s/enemies/moon_tree.lua';
	const document = buildDocument(path, readFileSync(path, 'utf8'));
	assert.equal(document.definitions.length, 1);
	assert.equal(document.definitions[0].behaviorKind, 'behavior_tree');

	const nodes = flatten(document.definitions);
	const flyAttackOccurrences = nodes.filter(node => node.detail.startsWith('fly_attack'));
	assert.equal(flyAttackOccurrences.length, 2);
	assert.equal(flyAttackOccurrences[0].authoredRange.start.line, 14);
	assert.equal(flyAttackOccurrences[1].authoredRange.start.line, 14);
	assert.deepEqual(
		flyAttackOccurrences.map(node => node.referenceRange!.start.line).sort((left, right) => left - right),
		[149, 182],
	);
	assert.notEqual(flyAttackOccurrences[0].rowKey, flyAttackOccurrences[1].rowKey);
	const deathRayOccurrences = nodes.filter(node => node.detail.startsWith('death_ray_attack'));
	assert.equal(deathRayOccurrences.length, 3);
	assert.equal(new Set(deathRayOccurrences.map(node => node.rowKey)).size, 3);
	assert.ok(deathRayOccurrences.every(node => node.authoredRange.start.line === 105));
	assert.ok(nodes.some(node => node.kind === 'service' && node.label === 'services.spawn_mini_moon'));
	assert.ok(nodes.some(node => node.kind === 'decorator' && node.label === "'loop'"));
	assert.ok(nodes.some(node => node.label === 'choices (2)'));
});

test('behavior lens finds const state-machine topology authored inside a closure', () => {
	const source = [
		"local fsm_library<const> = require('cartlib/fsm/library')",
		'local define<const> = function()',
		'\tlocal blueprint<const> = {',
		"\t\tinitial = 'idle',",
		'\t\tstates = {',
		'\t\t\tidle = {',
		"\t\t\t\ton = { start = { go = '/active' } },",
		"\t\t\t\tinput_event_handlers = { { pattern = 'a[jp]', go = '/active' } },",
		'\t\t\t},',
		'\t\t\tactive = {',
		'\t\t\t\tinitial = \'walk\',',
		'\t\t\t\tstates = { walk = {}, run = {} },',
		'\t\t\t},',
		'\t\t\toverlay = { is_concurrent = true },',
		'\t\t},',
		'\t}',
		"\tfsm_library.register('hero', blueprint)",
		'end',
		'return define',
	].join('\n');
	const document = buildDocument('nested_fsm.lua', source);
	assert.equal(document.definitions.length, 1);
	assert.equal(document.definitions[0].behaviorKind, 'state_machine');
	assert.equal(document.definitions[0].authoredRange.start.line, 3);
	assert.equal(document.definitions[0].referenceRange!.start.line, 17);

	const nodes = flatten(document.definitions);
	assert.ok(nodes.some(node => node.kind === 'state' && node.label === 'idle' && node.detail === 'initial'));
	assert.ok(nodes.some(node => node.kind === 'state' && node.label === 'overlay' && node.detail === 'concurrent'));
	assert.ok(nodes.some(node => node.kind === 'state' && node.label === 'walk' && node.detail === 'initial'));
	assert.ok(nodes.some(node => node.kind === 'event' && node.label === 'start' && node.detail === "go='/active'"));
	assert.ok(nodes.some(node => node.kind === 'event' && node.label === "'a[jp]'" && node.detail === "go='/active'"));
});

test('behavior lens recognizes a function-local cartlib module alias', () => {
	const source = [
		'local register<const> = function()',
		"\tlocal trees<const> = require('cartlib/behaviour_tree/library')",
		"\ttrees.register('guard', { root = { type = 'task', task = tasks.guard } })",
		'end',
		'return register',
	].join('\n');
	const document = buildDocument('function_local_tree.lua', source);
	assert.equal(document.definitions.length, 1);
	assert.equal(document.definitions[0].label, "BT 'guard'");
	assert.equal(document.definitions[0].children[0].label, 'task');
});

test('behavior lens accepts only immutable module bindings and dot-call registration ABI', () => {
	const mutable = buildDocument('mutable_alias.lua', [
		"local trees = require('cartlib/behaviour_tree/library')",
		"trees.register('mutable', { root = { type = 'task' } })",
	].join('\n'));
	assert.deepEqual(mutable.definitions, []);

	const colon = buildDocument('colon_registration.lua', [
		"local trees<const> = require('cartlib/behaviour_tree/library')",
		"trees:register('wrong-abi', { root = { type = 'task' } })",
	].join('\n'));
	assert.deepEqual(colon.definitions, []);
});

test('behavior lens exposes the authored ActionEffect gates and execution fields', () => {
	const path = 'carts/pietious/player/actioneffects.lua';
	const document = buildDocument(path, readFileSync(path, 'utf8'));
	assert.deepEqual(document.definitions.map(node => node.label), [
		"EFFECT 'pepernoot'",
		"EFFECT 'spyglass'",
		"EFFECT 'halo'",
	]);
	const nodes = flatten(document.definitions);
	assert.ok(nodes.some(node => node.label === 'can_trigger = <function>'));
	assert.ok(nodes.some(node => node.label === 'handler = <function>'));
	assert.equal(nodes.filter(node => node.label === 'blocked_tags (1)').length, 3);
});

test('behavior lens keeps computed definitions dynamic and ignores shadowed module aliases', () => {
	const source = [
		"local bt<const> = require('cartlib/behaviour_tree/library')",
		'local build<const> = function() return { root = { type = \'task\' } } end',
		'local shadowed<const> = function(bt)',
		"\tbt.register('not-a-registration', { root = { type = 'task' } })",
		'end',
		"bt.register('dynamic', build())",
		'return shadowed',
	].join('\n');
	const document = buildDocument('dynamic_tree.lua', source);
	assert.equal(document.definitions.length, 1);
	assert.equal(document.definitions[0].label, "BT 'dynamic'");
	assert.equal(document.definitions[0].resolution, 'unresolved');
	assert.equal(document.definitions[0].children[0].kind, 'dynamic');
});

test('behavior lens marks computed table keys as incomplete authored topology', () => {
	const source = [
		"local bt<const> = require('cartlib/behaviour_tree/library')",
		"bt.register('mixed', {",
		"\troot = {",
		"\t\ttype = 'sequence',",
		'\t\tchildren = {',
		"\t\t\t{ type = 'task' },",
		"\t\t\t[slot] = { type = 'task' },",
		'\t\t},',
		"\t\t[field] = 'override',",
		'\t},',
		'})',
	].join('\n');
	const document = buildDocument('computed_keys.lua', source);
	const definition = document.definitions[0];
	assert.equal(definition.resolution, 'partial');
	const root = definition.children[0];
	assert.equal(root.resolution, 'partial');
	const children = root.children.find(node => node.label.startsWith('children'))!;
	assert.equal(children.label, 'children (2 authored)');
	assert.equal(children.resolution, 'partial');
	assert.ok(children.children.some(node => node.kind === 'dynamic' && node.label === '[slot]'));
});

test('behavior lens leaves ordinary Lua empty and retains an incomplete registration', () => {
	const ordinary = buildDocument('ordinary.lua', 'local value = 1\nreturn value');
	assert.deepEqual(ordinary.definitions, []);

	const incomplete = buildDocument('incomplete.lua', [
		"local bt<const> = require('cartlib/behaviour_tree/library')",
		"bt.register('broken', ",
	].join('\n'));
	assert.equal(incomplete.definitions.length, 1);
	assert.equal(incomplete.definitions[0].label, "BT 'broken'");
	assert.equal(incomplete.definitions[0].resolution, 'unresolved');
	assert.equal(incomplete.definitions[0].detail, 'registration has no definition argument');
});

test('behavior source row identities survive unrelated line insertion and cannot collide through authored names', () => {
	const source = [
		"local fsm<const> = require('cartlib/fsm/library')",
		"fsm.register('same', { states = {",
		'\ta = { states = { b = {} } },',
		'\t[\'a/states/b\'] = {},',
		'} })',
		"fsm.register('same', { states = { idle = {} } })",
	].join('\n');
	const before = flatten(buildDocument('stable.lua', source).definitions);
	const after = flatten(buildDocument('stable.lua', `-- unrelated\n${source}`).definitions);
	assert.deepEqual(after.map(node => node.rowKey), before.map(node => node.rowKey));
	assert.equal(new Set(before.map(node => node.rowKey)).size, before.length);
});

test('behavior source row identities use semantic field keys rather than sibling order', () => {
	const before = flatten(buildDocument('stable_fields.lua', [
		"local bt<const> = require('cartlib/behaviour_tree/library')",
		"bt.register('stable', {",
		"\tblackboard = { health = 3 },",
		"\troot = { type = 'task', task = tasks.idle },",
		'})',
	].join('\n')).definitions);
	const after = flatten(buildDocument('stable_fields.lua', [
		"local bt<const> = require('cartlib/behaviour_tree/library')",
		"bt.register('stable', {",
		"\tblackboard = { speed = 2, health = 3 },",
		"\troot = { type = 'task', task = tasks.idle },",
		'})',
	].join('\n')).definitions);
	const beforeHealth = before.find(node => node.label === 'health = 3')!;
	const afterHealth = after.find(node => node.label === 'health = 3')!;
	const beforeRoot = before.find(node => node.kind === 'node' && node.label === 'task')!;
	const afterRoot = after.find(node => node.kind === 'node' && node.label === 'task')!;
	assert.equal(afterHealth.rowKey, beforeHealth.rowKey);
	assert.equal(afterRoot.rowKey, beforeRoot.rowKey);
});

test('behavior lens marks direct, aliased, nested and closure-contained table writes partial', () => {
	const source = [
		"local bt<const> = require('cartlib/behaviour_tree/library')",
		"local definition<const> = { root = { type = 'sequence', children = {} } }",
		'local alias<const> = definition',
		'local nested<const> = definition.root',
		'alias.flag = true',
		'nested[child_key] = { type = \'task\' }',
		'local mutate<const> = function()',
		"\tdefinition[dynamic_key] = { root = { type = 'task' } }",
		'end',
		"bt.register('mutated', definition)",
		'return mutate',
	].join('\n');
	const document = buildDocument('mutated_tree.lua', source);
	assert.equal(document.definitions.length, 1);
	assert.equal(document.definitions[0].resolution, 'partial');
	assert.match(document.definitions[0].detail, /known table mutation/);
	assert.ok(flatten(document.definitions).some(node => node.kind === 'node' && node.label === 'sequence'));
});

test('behavior lens marks syntax-recovery documents partial without discarding prior topology', () => {
	const source = [
		"local bt<const> = require('cartlib/behaviour_tree/library')",
		"bt.register('visible', { root = { type = 'task', task = tasks.run } })",
		'local incomplete =',
	].join('\n');
	const document = buildDocument('recovering_tree.lua', source);
	assert.equal(document.definitions.length, 1);
	assert.equal(document.definitions[0].resolution, 'partial');
	assert.match(document.definitions[0].detail, /syntax recovery/);
	assert.ok(flatten(document.definitions).some(node => node.kind === 'node' && node.label === 'task'));
});

test('behavior lens exposes live behavior-tree scheduling and policy fields', () => {
	const source = [
		"local bt<const> = require('cartlib/behaviour_tree/library')",
		"bt.register('schema', { root = {",
		"\ttype = 'simple_parallel',",
		"\tfinish_mode = 'abort_background',",
		"\tmain_task = { type = 'task', task = tasks.walk, interval_ticks = 3 },",
		"\tbackground_tree = { type = 'sequence', children = {",
		"\t\t{ type = 'timeline', timeline_id = 'attack', play_options = options },",
		"\t\t{ type = 'wait', minimum_duration_ticks = 2, maximum_duration_ticks = 5 },",
		'\t} },',
		'\tservices = { { service = services.scan, interval = cadence, tick_on_search_start = true, restart_timer_on_each_activation = true } },',
		"\tdecorators = { { type = 'blackboard', decorator = decorators.ready, observer_aborts = 'self', operation = 'equal', key = 'ready', value = true, notify_observer = true } },",
		'} })',
	].join('\n');
	const nodes = flatten(buildDocument('tree_schema.lua', source).definitions);
	assert.ok(nodes.some(node => node.kind === 'node' && node.detail.includes("finish_mode='abort_background'")));
	assert.ok(nodes.some(node => node.kind === 'node' && node.detail.includes('task=tasks.walk') && node.detail.includes('interval_ticks=3')));
	assert.ok(nodes.some(node => node.kind === 'node' && node.detail.includes("timeline_id='attack'") && node.detail.includes('play_options=options')));
	assert.ok(nodes.some(node => node.kind === 'node' && node.detail.includes('minimum_duration_ticks=2') && node.detail.includes('maximum_duration_ticks=5')));
	assert.ok(nodes.some(node => node.kind === 'service' && node.detail.includes('interval=cadence') && node.detail.includes('tick_on_search_start=true')));
	assert.ok(nodes.some(node => node.kind === 'decorator' && node.detail.includes("observer_aborts='self'") && node.detail.includes("operation='equal'")));
});

test('behavior lens retains numeric authored occurrences without inferring Lua list length', () => {
	const source = [
		"local bt<const> = require('cartlib/behaviour_tree/library')",
		"bt.register('numeric', { root = { type = 'sequence', children = {",
		"\t{ type = 'task', task = tasks.first },",
		"\t[4] = { type = 'task', task = tasks.fourth },",
		"\t[slot] = { type = 'task', task = tasks.computed },",
		'} } })',
	].join('\n');
	const definition = buildDocument('numeric_keys.lua', source).definitions[0];
	const nodes = flatten([definition]);
	const children = nodes.find(node => node.kind === 'section' && node.label.startsWith('children'))!;
	assert.equal(children.label, 'children (3 authored)');
	assert.equal(children.resolution, 'partial');
	assert.ok(children.children.some(node => node.label === '[4]' && node.resolution === 'partial'));
	assert.ok(children.children.some(node => node.label === '[slot]' && node.resolution === 'unresolved'));
	assert.equal(nodes.filter(node => node.kind === 'node' && node.label === 'task').length, 2);
});

test('behavior lens distinguishes string and numeric table keys in view identity', () => {
	const source = [
		"local fsm<const> = require('cartlib/fsm/library')",
		"fsm.register('keys', { states = { ['1'] = {}, [1] = {} } })",
	].join('\n');
	const nodes = flatten(buildDocument('key_kinds.lua', source).definitions);
	const keyed = nodes.filter(node => node.label === '1' || node.label === '[1]');
	assert.deepEqual(keyed.map(node => node.label), ['1', '[1]']);
	assert.notEqual(keyed[0].rowKey, keyed[1].rowKey);
});

test('behavior lens exposes FSM emitter filtering beside transitions', () => {
	const source = [
		"local fsm<const> = require('cartlib/fsm/library')",
		"fsm.register('events', { initial = 'idle', states = { idle = { on = {",
		"\tactivate = { go = '/active', emitter = 'player' },",
		'} }, active = {} } })',
	].join('\n');
	const nodes = flatten(buildDocument('fsm_events.lua', source).definitions);
	assert.ok(nodes.some(node => node.kind === 'event'
		&& node.label === 'activate'
		&& node.detail === "go='/active' | emitter='player'"));
});

test('behavior lens preserves the authored initializer and reference of an aliased FSM handler', () => {
	const source = [
		"local fsm<const> = require('cartlib/fsm/library')",
		"local activate<const> = { go = '/active', emitter = 'player' }",
		"fsm.register('events', { states = { idle = { on = { start = activate } }, active = {} } })",
	].join('\n');
	const nodes = flatten(buildDocument('fsm_handler_alias.lua', source).definitions);
	const event = nodes.find(node => node.kind === 'event' && node.label === 'start')!;
	assert.equal(event.authoredRange.start.line, 2);
	assert.equal(event.referenceRange!.start.line, 3);
	assert.equal(event.resolution, 'complete');
	assert.equal(event.detail, "go='/active' | emitter='player' | activate");
});

test('behavior lens uses ActionEffect schema rather than the incidental value shape', () => {
	const source = [
		"local effects<const> = require('cartlib/actioneffects')",
		"effects.register_effect('all', {",
		"\tevent = 'triggered',",
		'\thandler = { strange = true },',
		'\tcan_trigger = gates.ready,',
		'\tcooldown_ms = 100,',
		'\tcalculate_cooldown_ms = cooldown.calculate,',
		'\tinitial_cooldown_ms = 20,',
		'\tdefer_cooldown_commit = true,',
		'\tperiod_ms = 10,',
		"\trequired_tags = { 'armed' },",
		"\tblocked_tags = { 'stunned' },",
		"\trequired_state_paths = { '/active' },",
		"\tblocked_state_paths = { '/dead' },",
		'})',
	].join('\n');
	const nodes = flatten(buildDocument('effect_schema.lua', source).definitions);
	const scalarNames = [
		'event', 'handler', 'can_trigger', 'cooldown_ms', 'calculate_cooldown_ms',
		'initial_cooldown_ms', 'defer_cooldown_commit', 'period_ms',
	];
	for (let index = 0; index < scalarNames.length; index += 1) {
		assert.ok(nodes.some(node => node.kind === 'property' && node.label.startsWith(`${scalarNames[index]} =`)));
	}
	assert.ok(nodes.some(node => node.kind === 'property' && node.label === 'handler = <table 1>'));
	for (const label of ['required_tags (1)', 'blocked_tags (1)', 'required_state_paths (1)', 'blocked_state_paths (1)']) {
		assert.ok(nodes.some(node => node.kind === 'section' && node.label === label));
	}
});
