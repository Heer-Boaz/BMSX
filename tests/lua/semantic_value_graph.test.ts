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
		'left:run()',
		'right:run()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const snapshot = workspace.getSnapshot();
	const targets = snapshot.symbolsAt(
		'main.lua',
		6,
		memberColumn(lines[5], 'run'),
	);

	assert.deepEqual(
		targets.map((target) => target.decl.range.start.line),
		[2, 4],
	);
	assert.equal(snapshot.symbolAt('main.lua', 7, memberColumn(lines[6], 'run'))!.decl.range.start.line, 2);
	assert.equal(snapshot.symbolAt('main.lua', 8, memberColumn(lines[7], 'run'))!.decl.range.start.line, 4);
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
		"local base<const> = require('base')",
		'local derived<const> = {}',
		'derived.__index = derived',
		'setmetatable(derived, { __index = base })',
		'function derived:run() end',
		'return derived',
	].join('\n'));
	const mainLines = [
		"local derived<const> = require('derived')",
		'local object<const> = setmetatable({}, derived)',
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
	assert.equal(targets[0].decl.range.start.line, 5);
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

test('semantic workspace propagates table elements through standard generic iterators', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local actor<const> = {}',
		'function actor:run() end',
		'local entries<const> = { actor }',
		'for _, entry in pairs(entries) do',
		'\tentry:run()',
		'end',
		'for _, entry in ipairs(entries) do',
		'\tentry:run()',
		'end',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const target = workspace.getSnapshot().symbolAt(
		'main.lua',
		5,
		memberColumn(lines[4], 'run'),
	);

	assert.ok(target, 'table entry receiver from pairs');
	assert.equal(target!.decl.range.start.line, 2);
	const indexedTarget = workspace.getSnapshot().symbolAt(
		'main.lua',
		8,
		memberColumn(lines[7], 'run'),
	);
	assert.ok(indexedTarget, 'table entry receiver from ipairs');
	assert.equal(indexedTarget!.decl.range.start.line, 2);
});

test('semantic workspace does not assign builtin iterator semantics to a shadowing function', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local actor<const> = {}',
		'function actor:run() end',
		'local entries<const> = { actor }',
		'local pairs<const> = function() end',
		'for _, entry in pairs(entries) do',
		'\tentry:run()',
		'end',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));

	assert.equal(
		workspace.getSnapshot().symbolAt('main.lua', 6, memberColumn(lines[5], 'run')),
		null,
	);
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

test('semantic workspace evaluates every dynamic callee before resolving argument and return paths', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local left<const> = {}',
		'function left.new(world)',
		'\treturn world.left',
		'end',
		'local right<const> = {}',
		'function right.new(world)',
		'\treturn world.right',
		'end',
		'local classes<const> = { left, right }',
		'local manager<const> = { world = { left = { left_value = 1 }, right = { right_value = 2 } } }',
		'local selected<const> = classes[1].new(manager.world)',
		'return selected.left_value, selected.right_value',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const snapshot = workspace.getSnapshot();
	const left = snapshot.symbolAt('main.lua', 12, lines[11].indexOf('left_value') + 1);
	const right = snapshot.symbolAt('main.lua', 12, lines[11].indexOf('right_value') + 1);

	assert.ok(left, 'return path from the first callee');
	assert.equal(left!.decl.range.start.line, 10);
	assert.ok(right, 'return path from the second callee');
	assert.equal(right!.decl.range.start.line, 10);
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

test('semantic workspace keeps function return values contextual to each callsite', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local left<const> = { left_only = 1 }',
		'local right<const> = { right_only = 2 }',
		'local identity<const> = function(value)',
		'\treturn value',
		'end',
		'local selected_left<const> = identity(left)',
		'local selected_right<const> = identity(right)',
		'return selected_left.left_only, selected_left.right_only,',
		'\tselected_right.right_only, selected_right.left_only',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const snapshot = workspace.getSnapshot();

	assert.equal(
		snapshot.symbolAt('main.lua', 8, lines[7].indexOf('left_only') + 1)!.decl.range.start.line,
		1,
	);
	assert.equal(
		snapshot.symbolAt('main.lua', 8, lines[7].indexOf('right_only') + 1),
		null,
	);
	assert.equal(
		snapshot.symbolAt('main.lua', 9, lines[8].indexOf('right_only') + 1)!.decl.range.start.line,
		2,
	);
	assert.equal(
		snapshot.symbolAt('main.lua', 9, lines[8].indexOf('left_only') + 1),
		null,
	);
});

test('semantic workspace keeps parameter-indexed return values contextual to each callsite', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local left_key<const> = {}',
		'local right_key<const> = {}',
		'local left_value<const> = {}',
		'function left_value:left_only() end',
		'local right_value<const> = {}',
		'function right_value:right_only() end',
		'local values<const> = {}',
		'values[left_key] = left_value',
		'values[right_key] = right_value',
		'local lookup<const> = function(key)',
		'\treturn values[key]',
		'end',
		'local selected_left<const> = lookup(left_key)',
		'local selected_right<const> = lookup(right_key)',
		'selected_left:left_only()',
		'selected_right:right_only()',
		'selected_left:right_only()',
		'selected_right:left_only()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	let snapshot = workspace.getSnapshot();

	assert.equal(snapshot.symbolAt('main.lua', 15, memberColumn(lines[14], 'left_only'))!.decl.range.start.line, 4);
	assert.equal(snapshot.symbolAt('main.lua', 16, memberColumn(lines[15], 'right_only'))!.decl.range.start.line, 6);
	assert.equal(snapshot.symbolAt('main.lua', 17, memberColumn(lines[16], 'right_only')), null);
	assert.equal(snapshot.symbolAt('main.lua', 18, memberColumn(lines[17], 'left_only')), null);

	const retargeted = lines.slice();
	retargeted[12] = 'local selected_left<const> = lookup(right_key)';
	workspace.updateFile('main.lua', retargeted.join('\n'));
	snapshot = workspace.getSnapshot();
	assert.equal(snapshot.symbolAt('main.lua', 15, memberColumn(retargeted[14], 'left_only')), null);
	assert.equal(snapshot.symbolAt('main.lua', 17, memberColumn(retargeted[16], 'right_only'))!.decl.range.start.line, 6);
});

test('semantic workspace keeps parameter-keyed table writes contextual to each invocation', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local left_class<const> = {}',
		'left_class.__index = left_class',
		'function left_class:left_only() end',
		'local right_class<const> = {}',
		'right_class.__index = right_class',
		'function right_class:right_only() end',
		'local values<const> = {}',
		'local attach<const> = function(value)',
		'\tlocal class<const> = getmetatable(value)',
		'\tvalues[class] = value',
		'end',
		'local lookup<const> = function(class)',
		'\treturn values[class]',
		'end',
		'attach(setmetatable({}, left_class))',
		'attach(setmetatable({}, right_class))',
		'local selected_left<const> = lookup(left_class)',
		'local selected_right<const> = lookup(right_class)',
		'selected_left:left_only()',
		'selected_right:right_only()',
		'selected_left:right_only()',
		'selected_right:left_only()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const snapshot = workspace.getSnapshot();

	assert.equal(snapshot.symbolAt('main.lua', 19, memberColumn(lines[18], 'left_only'))!.decl.range.start.line, 3);
	assert.equal(snapshot.symbolAt('main.lua', 20, memberColumn(lines[19], 'right_only'))!.decl.range.start.line, 6);
	assert.equal(snapshot.symbolAt('main.lua', 21, memberColumn(lines[20], 'right_only')), null);
	assert.equal(snapshot.symbolAt('main.lua', 22, memberColumn(lines[21], 'left_only')), null);
});

test('semantic workspace summarizes recursive value flow without unbounded call contexts', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local function walk(node)',
		'\tnode.visited = true',
		'\treturn walk(node.next)',
		'end',
		'local root<const> = {}',
		'walk(root)',
		'return root.visited',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const visited = workspace.getSnapshot().symbolAt(
		'main.lua',
		7,
		memberColumn(lines[6], 'visited'),
	);

	assert.ok(visited);
	assert.equal(visited.decl.range.start.line, 2);
});

test('semantic workspace passes colon-call receivers through nested method calls', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local map<const> = {}',
		'map.__index = map',
		'function map:_write(key, value)',
		'\tself.values[key] = value',
		'end',
		'function map:write(key, value)',
		'\tself:_write(key, value)',
		'end',
		'function map:read(key)',
		'\treturn self.values[key]',
		'end',
		'local left_key<const> = {}',
		'local right_key<const> = {}',
		'local left_value<const> = {}',
		'function left_value:left_only() end',
		'local right_value<const> = {}',
		'function right_value:right_only() end',
		'local left<const> = setmetatable({ values = {} }, map)',
		'local right<const> = setmetatable({ values = {} }, map)',
		'left:write(left_key, left_value)',
		'right:write(right_key, right_value)',
		'local selected_left<const> = left:read(left_key)',
		'local selected_right<const> = right:read(right_key)',
		'selected_left:left_only()',
		'selected_right:right_only()',
		'selected_left:right_only()',
		'selected_right:left_only()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const snapshot = workspace.getSnapshot();

	assert.equal(snapshot.symbolAt('main.lua', 24, memberColumn(lines[23], 'left_only'))!.decl.range.start.line, 15);
	assert.equal(snapshot.symbolAt('main.lua', 25, memberColumn(lines[24], 'right_only'))!.decl.range.start.line, 17);
	assert.equal(snapshot.symbolAt('main.lua', 26, memberColumn(lines[25], 'right_only')), null);
	assert.equal(snapshot.symbolAt('main.lua', 27, memberColumn(lines[26], 'left_only')), null);
});

test('semantic workspace observes the current metatable after repeated setmetatable calls', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local base<const> = {}',
		'base.__index = base',
		'local left<const> = {}',
		'left.__index = left',
		'function left:left_only() end',
		'local right<const> = {}',
		'right.__index = right',
		'function right:right_only() end',
		'local left_value<const> = setmetatable(setmetatable({}, base), left)',
		'local right_value<const> = setmetatable(setmetatable({}, base), right)',
		'local left_metatable<const> = getmetatable(left_value)',
		'local right_metatable<const> = getmetatable(right_value)',
		'left_metatable:left_only()',
		'right_metatable:right_only()',
		'left_metatable:right_only()',
		'right_metatable:left_only()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const snapshot = workspace.getSnapshot();

	assert.equal(snapshot.symbolAt('main.lua', 13, memberColumn(lines[12], 'left_only'))!.decl.range.start.line, 5);
	assert.equal(snapshot.symbolAt('main.lua', 14, memberColumn(lines[13], 'right_only'))!.decl.range.start.line, 8);
	assert.equal(snapshot.symbolAt('main.lua', 15, memberColumn(lines[14], 'right_only')), null);
	assert.equal(snapshot.symbolAt('main.lua', 16, memberColumn(lines[15], 'left_only')), null);
});

test('semantic workspace follows ordinary Lua metatable identity through getmetatable', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local class<const> = {}',
		'class.__index = class',
		'function class:run() end',
		'local value<const> = setmetatable({}, class)',
		'local metatable<const> = getmetatable(value)',
		'value:run()',
		'metatable:run()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const snapshot = workspace.getSnapshot();

	assert.equal(snapshot.symbolAt('main.lua', 6, memberColumn(lines[5], 'run'))!.decl.range.start.line, 3);
	assert.equal(snapshot.symbolAt('main.lua', 7, memberColumn(lines[6], 'run'))!.decl.range.start.line, 3);
});

test('semantic workspace applies metatables to values passed through function parameters', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local base<const> = {}',
		'base.__index = base',
		'function base:inherited() end',
		'local apply_prototype<const> = function(value, prototype)',
		'\tsetmetatable(value, { __index = prototype })',
		'end',
		'local derived<const> = {}',
		'apply_prototype(derived, base)',
		'derived:inherited()',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const usageLine = lines.length;
	const result = workspace.getSnapshot().symbolAt(
		'main.lua',
		usageLine,
		lines[usageLine - 1].lastIndexOf('inherited') + 1,
	);

	assert.equal(result!.decl.range.start.line, 3);
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

test('semantic workspace publishes direct method receiver members without executing the method', async () => {
	const { LuaSemanticWorkspace } = await semanticModelModulePromise;
	const lines = [
		'local value_class<const> = {}',
		'value_class.__index = value_class',
		'function value_class:initialize()',
		'\tself.blink = false',
		'end',
		'local value<const> = setmetatable({}, value_class)',
		'local read<const> = function(input)',
		'\treturn input.blink',
		'end',
		'read(value)',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const blink = workspace.getSnapshot().symbolAt(
		'main.lua',
		8,
		memberColumn(lines[7], 'blink'),
	);

	assert.ok(blink, 'method receiver member');
	assert.equal(blink!.decl.file, 'main.lua');
	assert.deepEqual(blink!.decl.namePath, ['self', 'blink']);
});
