import assert from 'node:assert/strict';
import { test } from 'node:test';

const semanticModelModulePromise = import('../../toolchain/ts/lua/semantic/model');

function memberColumn(line: string, member: string): number {
	return line.lastIndexOf(member) + 1;
}

test('semantic workspace projects observed parameter members without merging argument objects', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local left<const> = { common = 1, left_only = 2 }',
		'local right<const> = { common = 3, right_only = 4 }',
		'local read_common<const> = function(value)',
		'\treturn value.common',
		'end',
		'read_common(left)',
		'read_common(right)',
		'return left.right_only, right.left_only',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const snapshot = workspace.getSnapshot();
	const common = snapshot.symbolsAt('main.lua', 4, memberColumn(lines[3], 'common'));

	assert.deepEqual(
		common.map((symbol) => symbol.decl.range.start.line),
		[1, 2],
		'member observed through every parameter value alternative',
	);
	assert.equal(
		snapshot.symbolAt('main.lua', 8, lines[7].indexOf('right_only') + 1),
		null,
		'left does not acquire unrelated right members',
	);
	assert.equal(
		snapshot.symbolAt('main.lua', 8, lines[7].indexOf('left_only', lines[7].indexOf(',')) + 1),
		null,
		'right does not acquire unrelated left members',
	);
});

test('semantic workspace retains every same-name method definition across value alternatives', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local left<const> = {}',
		'function left:run() end',
		'local right<const> = {}',
		'function right:run() end',
		'local selected<const> = left or right',
		'selected:run()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const targets = workspace.getSnapshot().symbolsAt(
		'main.lua',
		6,
		memberColumn(lines[5], 'run'),
	);

	assert.deepEqual(
		targets.map((target) => target.decl.range.start.line),
		[2, 4],
	);
});

test('semantic workspace hides base methods overridden by a derived class', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('base.lua', [
		'local base<const> = {}',
		'function base:run() end',
		'return base',
	].join('\n'));
	workspace.updateFile('derived.lua', [
		"local prefab<const> = require('cartlib/world/prefab')",
		"local base<const> = require('base')",
		'local derived<const> = {}',
		'function derived:run() end',
		"prefab.define({ def_id = 'derived', class = derived, base = base })",
		'return derived',
	].join('\n'));
	const mainLines = [
		"local world<const> = require('cartlib/world/world')",
		"local object<const> = world:spawn('derived', {})",
		'object:run()',
	];
	workspace.updateFile('main.lua', mainLines.join('\n'));
	const targets = workspace.getSnapshot().symbolsAt(
		'main.lua',
		3,
		memberColumn(mainLines[2], 'run'),
	);

	assert.equal(targets.length, 1);
	assert.equal(targets[0].decl.file, 'derived.lua');
	assert.equal(targets[0].decl.range.start.line, 4);
});

test('semantic workspace retains member writes through reused table elements', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local entries<const> = {}',
		'local entry<const> = {}',
		'entries[1] = entry',
		'local initialize<const> = function(value)',
		'\tvalue.state = { counts = {} }',
		'end',
		'local clear<const> = function(value)',
		'\treturn value.state.counts',
		'end',
		'initialize(entries[1])',
		'clear(entries[1])',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const counts = workspace.getSnapshot().symbolAt(
		'main.lua',
		8,
		memberColumn(lines[7], 'counts'),
	);

	assert.ok(counts, 'nested member written through another parameter');
	assert.equal(counts!.decl.range.start.line, 5);
});

test('semantic workspace propagates values through higher-order calls', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local invoke<const> = function(callback, value)',
		'\tcallback(value)',
		'end',
		'local initialize<const> = function(value)',
		'\tvalue.ready = true',
		'end',
		'local item<const> = {}',
		'invoke(initialize, item)',
		'return item.ready',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const ready = workspace.getSnapshot().symbolAt(
		'main.lua',
		9,
		memberColumn(lines[8], 'ready'),
	);

	assert.ok(ready, 'member written by a higher-order callback');
	assert.equal(ready!.decl.range.start.line, 5);
});

test('semantic workspace retains every object-return branch', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local left<const> = { left_value = 1 }',
		'local right<const> = { right_value = 2 }',
		'local select_value<const> = function(use_left)',
		'\tif use_left then',
		'\t\treturn left',
		'\tend',
		'\treturn right, true',
		'end',
		'local selected<const> = select_value(true)',
		'return selected.left_value, selected.right_value',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const snapshot = workspace.getSnapshot();
	const left = snapshot.symbolAt('main.lua', 10, lines[9].indexOf('left_value') + 1);
	const right = snapshot.symbolAt('main.lua', 10, lines[9].indexOf('right_value') + 1);

	assert.ok(left, 'first return branch');
	assert.equal(left!.decl.range.start.line, 1);
	assert.ok(right, 'first value from a multiple-value return');
	assert.equal(right!.decl.range.start.line, 2);
});

test('semantic workspace preserves both value alternatives of Lua and-or expressions', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local primary<const> = { primary_value = 1 }',
		'local fallback<const> = { fallback_value = 2 }',
		'local selected<const> = primary or fallback',
		'return selected.primary_value, selected.fallback_value',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const snapshot = workspace.getSnapshot();
	const primary = snapshot.symbolAt('main.lua', 4, lines[3].indexOf('primary_value') + 1);
	const fallback = snapshot.symbolAt('main.lua', 4, lines[3].indexOf('fallback_value') + 1);

	assert.ok(primary, 'left alternative member');
	assert.equal(primary!.decl.range.start.line, 1);
	assert.ok(fallback, 'right alternative member');
	assert.equal(fallback!.decl.range.start.line, 2);
});

test('semantic workspace resolves an FSM callback emitter from its retained object id', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const stageSource = [
		"local prefab<const> = require('cartlib/world/prefab')",
		'local stage<const> = {}',
		"local definition_id<const> = 'stage'",
		"local instance_id<const> = 'stage.instance'",
		'function stage:initialize()',
		'\tself.blink = false',
		'end',
		'prefab.define({ def_id = definition_id, class = stage })',
		'return { definition_id = definition_id, instance_id = instance_id }',
	].join('\n');
	const mainLines = [
		"local world<const> = require('cartlib/world/world')",
		"local fsm_library<const> = require('cartlib/fsm/fsm_library')",
		"local stage_module<const> = require('stage')",
		'world:spawn(stage_module.definition_id, { id = stage_module.instance_id })',
		"fsm_library.register('director', {",
		'\ton = {',
		"\t\tchanged = { emitter = stage_module.instance_id, go = function(_self, _state, _event, stage)",
		'\t\t\treturn stage.blink',
		'\t\tend },',
		'\t},',
		'})',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', mainLines.join('\n'));
	workspace.updateFile('stage.lua', stageSource);
	const blink = workspace.getSnapshot().symbolAt(
		'main.lua',
		8,
		memberColumn(mainLines[7], 'blink'),
	);

	assert.ok(blink, 'event emitter instance member');
	assert.equal(blink!.decl.file, 'stage.lua');
	assert.deepEqual(blink!.decl.namePath, ['self', 'blink']);
});
