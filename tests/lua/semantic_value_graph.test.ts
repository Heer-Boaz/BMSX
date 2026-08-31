import assert from 'node:assert/strict';
import { test } from 'node:test';
import { semanticSymbolAt, semanticSymbolsAt } from './semantic_test_harness';

const semanticWorkspaceModulePromise = import('../../toolchain/ts/lua/semantic/model');
const semanticValueGraphModulePromise = import('../../toolchain/ts/lua/semantic/value_graph');

function memberColumn(line: string, member: string): number {
	return line.lastIndexOf(member) + 1;
}

test('semantic workspace projects observed parameter members without merging argument objects', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const common = semanticSymbolsAt(snapshot, 'main.lua', 4, memberColumn(lines[3], 'common'));

	assert.deepEqual(
		common.map((symbol) => symbol.declaration.range.start.line),
		[1, 2],
		'member observed through every parameter value alternative',
	);
	assert.equal(
		semanticSymbolAt(snapshot, 'main.lua', 8, lines[7].indexOf('right_only') + 1),
		null,
		'left does not acquire unrelated right members',
	);
	assert.equal(
		semanticSymbolAt(snapshot, 'main.lua', 8, lines[7].indexOf('left_only', lines[7].indexOf(',')) + 1),
		null,
		'right does not acquire unrelated left members',
	);
});

test('semantic workspace retains every same-name method definition across value alternatives', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const targets = semanticSymbolsAt(snapshot,
		'main.lua',
		6,
		memberColumn(lines[5], 'run'),
	);

	assert.deepEqual(
		targets.map((target) => target.declaration.range.start.line),
		[2, 4],
	);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 7, memberColumn(lines[6], 'run'))!.declaration.range.start.line, 2);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 8, memberColumn(lines[7], 'run'))!.declaration.range.start.line, 4);
});

test('semantic workspace hides base methods overridden by a derived class', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const targets = semanticSymbolsAt(workspace.getSnapshot(),
		'main.lua',
		3,
		memberColumn(mainLines[2], 'run'),
	);

	assert.equal(targets.length, 1);
	assert.equal(targets[0].declaration.file, 'derived.lua');
	assert.equal(targets[0].declaration.range.start.line, 5);
});

test('semantic workspace retains member writes through reused table elements', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const counts = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		8,
		memberColumn(lines[7], 'counts'),
	);

	assert.ok(counts, 'nested member written through another parameter');
	assert.equal(counts!.declaration.range.start.line, 5);
});

test('semantic workspace propagates table elements through standard generic iterators', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const target = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		5,
		memberColumn(lines[4], 'run'),
	);

	assert.ok(target, 'table entry receiver from pairs');
	assert.equal(target!.declaration.range.start.line, 2);
	const indexedTarget = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		8,
		memberColumn(lines[7], 'run'),
	);
	assert.ok(indexedTarget, 'table entry receiver from ipairs');
	assert.equal(indexedTarget!.declaration.range.start.line, 2);
});

test('semantic workspace does not assign builtin iterator semantics to a shadowing function', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
		semanticSymbolAt(workspace.getSnapshot(), 'main.lua', 6, memberColumn(lines[5], 'run')),
		null,
	);
});

test('semantic workspace propagates values through higher-order calls', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const ready = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		9,
		memberColumn(lines[8], 'ready'),
	);

	assert.ok(ready, 'member written by a higher-order callback');
	assert.equal(ready!.declaration.range.start.line, 5);
});

test('semantic workspace follows function values through table member aliases', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const lines = [
		'local component<const> = {}',
		'function component:_wait() end',
		'local evaluate<const> = function(execution)',
		'\texecution:_wait()',
		'end',
		'local program<const> = { evaluate = evaluate }',
		'local pipeline<const> = { step = program.evaluate }',
		'pipeline.step(component)',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const wait = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		4,
		memberColumn(lines[3], '_wait'),
	);

	assert.ok(wait, 'call argument observed through table member aliases');
	assert.equal(wait!.declaration.range.start.line, 2);
});

test('semantic workspace evaluates every dynamic callee before resolving argument and return paths', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const left = semanticSymbolAt(snapshot, 'main.lua', 12, lines[11].indexOf('left_value') + 1);
	const right = semanticSymbolAt(snapshot, 'main.lua', 12, lines[11].indexOf('right_value') + 1);

	assert.ok(left, 'return path from the first callee');
	assert.equal(left!.declaration.range.start.line, 10);
	assert.ok(right, 'return path from the second callee');
	assert.equal(right!.declaration.range.start.line, 10);
});

test('semantic workspace retains every object-return branch', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const left = semanticSymbolAt(snapshot, 'main.lua', 10, lines[9].indexOf('left_value') + 1);
	const right = semanticSymbolAt(snapshot, 'main.lua', 10, lines[9].indexOf('right_value') + 1);

	assert.ok(left, 'first return branch');
	assert.equal(left!.declaration.range.start.line, 1);
	assert.ok(right, 'first value from a multiple-value return');
	assert.equal(right!.declaration.range.start.line, 2);
});

test('semantic workspace keeps function return values contextual to each callsite', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
		semanticSymbolAt(snapshot, 'main.lua', 8, lines[7].indexOf('left_only') + 1)!.declaration.range.start.line,
		1,
	);
	assert.equal(
		semanticSymbolAt(snapshot, 'main.lua', 8, lines[7].indexOf('right_only') + 1),
		null,
	);
	assert.equal(
		semanticSymbolAt(snapshot, 'main.lua', 9, lines[8].indexOf('right_only') + 1)!.declaration.range.start.line,
		2,
	);
	assert.equal(
		semanticSymbolAt(snapshot, 'main.lua', 9, lines[8].indexOf('left_only') + 1),
		null,
	);
});

test('semantic workspace keeps bound nested calls attached to their lexical closure', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const lines = [
		'local left<const> = { left_only = 1 }',
		'local right<const> = { right_only = 2 }',
		'local make_reader<const> = function(value)',
		'\tlocal read<const> = function()',
		'\t\treturn value',
		'\tend',
		'\tlocal invoke<const> = function()',
		'\t\treturn read()',
		'\tend',
		'\treturn invoke',
		'end',
		'local read_left<const> = make_reader(left)',
		'local read_right<const> = make_reader(right)',
		'local selected_left<const> = read_left()',
		'local selected_right<const> = read_right()',
		'return selected_left.left_only, selected_left.right_only,',
		'\tselected_right.right_only, selected_right.left_only',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const snapshot = workspace.getSnapshot();

	assert.equal(
		semanticSymbolAt(snapshot, 'main.lua', 16, lines[15].indexOf('left_only') + 1)!.declaration.range.start.line,
		1,
	);
	assert.equal(
		semanticSymbolAt(snapshot, 'main.lua', 16, lines[15].indexOf('right_only') + 1),
		null,
	);
	assert.equal(
		semanticSymbolAt(snapshot, 'main.lua', 17, lines[16].indexOf('right_only') + 1)!.declaration.range.start.line,
		2,
	);
	assert.equal(
		semanticSymbolAt(snapshot, 'main.lua', 17, lines[16].indexOf('left_only') + 1),
		null,
	);
});

test('semantic workspace keeps parameter-indexed return values contextual to each callsite', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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

	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 15, memberColumn(lines[14], 'left_only'))!.declaration.range.start.line, 4);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 16, memberColumn(lines[15], 'right_only'))!.declaration.range.start.line, 6);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 17, memberColumn(lines[16], 'right_only')), null);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 18, memberColumn(lines[17], 'left_only')), null);

	const retargeted = lines.slice();
	retargeted[12] = 'local selected_left<const> = lookup(right_key)';
	workspace.updateFile('main.lua', retargeted.join('\n'));
	snapshot = workspace.getSnapshot();
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 15, memberColumn(retargeted[14], 'left_only')), null);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 17, memberColumn(retargeted[16], 'right_only'))!.declaration.range.start.line, 6);
});

test('semantic workspace keeps parameter-keyed table writes contextual to each invocation', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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

	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 19, memberColumn(lines[18], 'left_only'))!.declaration.range.start.line, 3);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 20, memberColumn(lines[19], 'right_only'))!.declaration.range.start.line, 6);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 21, memberColumn(lines[20], 'right_only')), null);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 22, memberColumn(lines[21], 'left_only')), null);
});

test('semantic workspace summarizes recursive value flow without unbounded call contexts', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const visited = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		7,
		memberColumn(lines[6], 'visited'),
	);

	assert.ok(visited);
	assert.equal(visited.declaration.range.start.line, 2);
});

test('semantic workspace widens recursive local aliases into one call context', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const lines = [
		'local function propagate(source, target)',
		'\ttarget.visited = source.visited',
		'\tlocal source_child<const> = source.next',
		'\tlocal target_child<const> = target.next',
		'\treturn propagate(source_child, target_child)',
		'end',
		'local source<const> = { visited = true }',
		'local target<const> = {}',
		'propagate(source, target)',
		'return target.visited',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const visited = semanticSymbolAt(
		workspace.getSnapshot(),
		'main.lua',
		10,
		memberColumn(lines[9], 'visited'),
	);

	assert.ok(visited);
	assert.equal(visited.declaration.range.start.line, 2);
});

test('semantic workspace passes colon-call receivers through nested method calls', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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

	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 24, memberColumn(lines[23], 'left_only'))!.declaration.range.start.line, 15);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 25, memberColumn(lines[24], 'right_only'))!.declaration.range.start.line, 17);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 26, memberColumn(lines[25], 'right_only')), null);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 27, memberColumn(lines[26], 'left_only')), null);
});

test('semantic workspace uses unresolved receiver calls as parameter type hints', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const consumerLines = [
		'local consumer<const> = {}',
		'consumer.__index = consumer',
		'function consumer:accept(value)',
		'\tvalue:delivered()',
		'end',
		'return consumer',
	];
	const producerLines = [
		'local acquire<const> = require(\'acquire\')',
		'local producer<const> = {}',
		'producer.__index = producer',
		'function producer:delivered() end',
		'function producer:send()',
		'\tlocal receiver<const> = acquire()',
		'\treceiver:accept(self)',
		'end',
		'return producer',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('acquire.lua', 'return function() return {} end');
	workspace.updateFile('consumer.lua', consumerLines.join('\n'));
	workspace.updateFile('producer.lua', producerLines.join('\n'));
	const delivered = semanticSymbolAt(
		workspace.getSnapshot(),
		'consumer.lua',
		4,
		memberColumn(consumerLines[3], 'delivered'),
	);

	assert.ok(delivered, 'the named call candidate binds the producer argument');
	assert.equal(delivered.declaration.file, 'producer.lua');
	assert.equal(delivered.declaration.range.start.line, 4);
});

test('semantic workspace observes the current metatable after repeated setmetatable calls', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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

	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 13, memberColumn(lines[12], 'left_only'))!.declaration.range.start.line, 5);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 14, memberColumn(lines[13], 'right_only'))!.declaration.range.start.line, 8);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 15, memberColumn(lines[14], 'right_only')), null);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 16, memberColumn(lines[15], 'left_only')), null);
});

test('semantic workspace follows ordinary Lua metatable identity through getmetatable', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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

	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 6, memberColumn(lines[5], 'run'))!.declaration.range.start.line, 3);
	assert.equal(semanticSymbolAt(snapshot, 'main.lua', 7, memberColumn(lines[6], 'run'))!.declaration.range.start.line, 3);
});

test('semantic workspace applies metatables to values passed through function parameters', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const result = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		usageLine,
		lines[usageLine - 1].lastIndexOf('inherited') + 1,
	);

	assert.equal(result!.declaration.range.start.line, 3);
});

test('semantic workspace preserves both value alternatives of Lua and-or expressions', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const lines = [
		'local primary<const> = { primary_value = 1 }',
		'local fallback<const> = { fallback_value = 2 }',
		'local selected<const> = primary or fallback',
		'return selected.primary_value, selected.fallback_value',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const snapshot = workspace.getSnapshot();
	const primary = semanticSymbolAt(snapshot, 'main.lua', 4, lines[3].indexOf('primary_value') + 1);
	const fallback = semanticSymbolAt(snapshot, 'main.lua', 4, lines[3].indexOf('fallback_value') + 1);

	assert.ok(primary, 'left alternative member');
	assert.equal(primary!.declaration.range.start.line, 1);
	assert.ok(fallback, 'right alternative member');
	assert.equal(fallback!.declaration.range.start.line, 2);
});

test('semantic workspace publishes direct method receiver members without executing the method', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
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
	const blink = semanticSymbolAt(workspace.getSnapshot(),
		'main.lua',
		8,
		memberColumn(lines[7], 'blink'),
	);

	assert.ok(blink, 'method receiver member');
	assert.equal(blink!.declaration.file, 'main.lua');
	assert.deepEqual(blink!.declaration.namePath, ['self', 'blink']);
});

test('semantic value identities project implicit self onto the declared receiver', async () => {
	const { buildLuaFileSemanticData } = await semanticWorkspaceModulePromise;
	const { WorkspaceValueIdentityIndex } = await semanticValueGraphModulePromise;
	const source = [
		'local left<const> = {}',
		'function left:target() end',
		'function left:forward()',
		'\tself:target()',
		'end',
		'local right<const> = {}',
		'function right:target() end',
	].join('\n');
	const file = buildLuaFileSemanticData(source, 'methods.lua');
	const call = file.refs.find(ref => ref.name === 'target' && ref.range.start.line === 4);
	const target = file.decls.find(decl => decl.namePath.join('.') === 'left.target');
	assert.ok(call?.receiverValue);
	assert.ok(target);

	const identities = new WorkspaceValueIdentityIndex({
		files: [file],
		globalValues: new Map(),
	});
	assert.deepEqual(
		identities.resolveStaticMembers(call.receiverValue, call.name),
		[target.id],
	);
});

test('semantic workspace resolves fields injected by a generic instance factory without invoking methods', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const catalogSource = [
		'local catalog<const> = {}',
		'local entries<const> = {}',
		'function catalog.define(id, value_class)',
		'\tentries[id] = { instance_metatable = { __index = value_class } }',
		'end',
		'function catalog.definition(id)',
		'\treturn entries[id]',
		'end',
		'return catalog',
	].join('\n');
	const factoryLines = [
		"local catalog<const> = require('catalog')",
		'local factory<const> = {}',
		'factory.__index = factory',
		'function factory.new()',
		'\treturn setmetatable({}, factory)',
		'end',
		'function factory:create(id)',
		'\tlocal definition<const> = catalog.definition(id)',
		'\tlocal value<const> = {}',
		'\tsetmetatable(value, definition.instance_metatable)',
		'\tvalue.owner = self',
		'\treturn value',
		'end',
		'return factory',
	];
	const actorLines = [
		"local catalog<const> = require('catalog')",
		'local actor<const> = {}',
		'actor.__index = actor',
		'function actor:release()',
		"\tself.owner:create('item')",
		'end',
		"catalog.define('actor', actor)",
		'return actor',
	];
	const spectatorLines = [
		"local catalog<const> = require('catalog')",
		'local spectator<const> = {}',
		'spectator.__index = spectator',
		'function spectator:release()',
		"\tself.owner:create('item')",
		'end',
		"catalog.define('spectator', spectator)",
		'return spectator',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('catalog.lua', catalogSource);
	workspace.updateFile('factory.lua', factoryLines.join('\n'));
	workspace.updateFile('actor.lua', actorLines.join('\n'));
	workspace.updateFile('spectator.lua', spectatorLines.join('\n'));
	workspace.updateFile('main.lua', [
		"local factory<const> = require('factory')",
		"require('actor')",
		"require('spectator')",
		'local instance<const> = factory.new()',
		"instance:create('actor')",
	].join('\n'));
	const snapshot = workspace.getSnapshot();

	const create = semanticSymbolAt(
		snapshot,
		'actor.lua',
		5,
		memberColumn(actorLines[4], 'create'),
	);

	assert.ok(create, 'factory-injected owner member');
	assert.equal(create!.declaration.file, 'factory.lua');
	assert.equal(create!.declaration.range.start.line, 7);
	const callReferences = snapshot.symbolResolver.getReferences(create!.id).filter(reference => reference.isCall);
	assert.equal(
		callReferences.some(reference => reference.file === 'actor.lua' && reference.range.start.line === 5),
		true,
		'call hierarchy retains the constructed class method call',
	);
	assert.equal(
		semanticSymbolAt(
			snapshot,
			'spectator.lua',
			5,
			memberColumn(spectatorLines[4], 'create'),
		),
		null,
		'an unconstructed class does not acquire another allocation site',
	);
	assert.equal(
		callReferences.some(reference => reference.file === 'spectator.lua'),
		false,
		'call hierarchy does not retain the unconstructed sibling call',
	);
});

test('semantic workspace retains contextual prototype effects through configuration factories', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const channelLines = [
		'local channel<const> = {}',
		'local port<const> = {}',
		'port.__index = port',
		'function port:emit(name) end',
		'function channel.for_owner(owner)',
		'\treturn setmetatable({ owner = owner }, port)',
		'end',
		'return channel',
	];
	const baseLines = [
		"local channel<const> = require('channel')",
		'local base<const> = {}',
		'base.__index = base',
		'function base.initialize(self)',
		'\tself.events = channel.for_owner(self)',
		'end',
		'function base:set_space(id) end',
		'return base',
	];
	const catalogLines = [
		"local base<const> = require('base')",
		'local definitions<const> = {}',
		'local catalog<const> = {}',
		'function catalog.define(source)',
		'\tlocal prototype<const> = source.base or base',
		'\tsetmetatable(source.class, { __index = prototype })',
		'\tdefinitions[source.id] = {',
		'\t\tinstance_metatable = { __index = source.class },',
		'\t\tinitialize = prototype.initialize,',
		'\t}',
		'end',
		'function catalog.definition(id)',
		'\treturn definitions[id]',
		'end',
		'return catalog',
	];
	const factoryLines = [
		"local catalog<const> = require('catalog')",
		'local factory<const> = {}',
		'function factory:spawn(id)',
		'\tlocal definition<const> = catalog.definition(id)',
		'\tlocal value<const> = {}',
		'\tsetmetatable(value, definition.instance_metatable)',
		'\tdefinition.initialize(value)',
		'\treturn value',
		'end',
		'return factory',
	];
	const actorLines = [
		"local catalog<const> = require('catalog')",
		'local actor<const> = {}',
		'actor.__index = actor',
		'function actor:run()',
		'\tself:set_space(1)',
		"\tself.events:emit('run')",
		'end',
		'function actor.register()',
		"\tcatalog.define({ id = 'actor', class = actor })",
		'end',
		'return actor',
	];
	const spectatorLines = [
		'local spectator<const> = {}',
		'spectator.__index = spectator',
		'function spectator:run()',
		'\tself:set_space(1)',
		"\tself.events:emit('run')",
		'end',
		'return spectator',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('channel.lua', channelLines.join('\n'));
	workspace.updateFile('base.lua', baseLines.join('\n'));
	workspace.updateFile('catalog.lua', catalogLines.join('\n'));
	workspace.updateFile('factory.lua', factoryLines.join('\n'));
	workspace.updateFile('actor.lua', actorLines.join('\n'));
	workspace.updateFile('spectator.lua', spectatorLines.join('\n'));
	workspace.updateFile('main.lua', [
		"local actor<const> = require('actor')",
		"local factory<const> = require('factory')",
		'actor.register()',
		"factory:spawn('actor')",
	].join('\n'));
	const snapshot = workspace.getSnapshot();

	const inheritedMethod = semanticSymbolAt(
		snapshot,
		'actor.lua',
		5,
		memberColumn(actorLines[4], 'set_space'),
	);
	assert.ok(inheritedMethod, 'prototype installed through the configuration call');
	assert.equal(inheritedMethod!.declaration.file, 'base.lua');
	assert.equal(inheritedMethod!.declaration.range.start.line, 7);

	const initializedField = semanticSymbolAt(
		snapshot,
		'actor.lua',
		6,
		memberColumn(actorLines[5], 'events'),
	);
	assert.ok(initializedField, 'field published by the configured base initializer');
	assert.equal(initializedField!.declaration.file, 'base.lua');
	assert.equal(initializedField!.declaration.range.start.line, 5);

	const chainedMethod = semanticSymbolAt(
		snapshot,
		'actor.lua',
		6,
		memberColumn(actorLines[5], 'emit'),
	);
	assert.ok(chainedMethod, 'method retained from the initialized factory return');
	assert.equal(chainedMethod!.declaration.file, 'channel.lua');
	assert.equal(chainedMethod!.declaration.range.start.line, 4);

	assert.equal(
		semanticSymbolAt(
			snapshot,
			'spectator.lua',
			4,
			memberColumn(spectatorLines[3], 'set_space'),
		),
		null,
		'an unconfigured sibling does not acquire the prototype',
	);
});

test('semantic workspace propagates heap effects through forwarding call summaries', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const lines = [
		'local map<const> = {}',
		'function map:_write(target)',
		'\ttarget.ready = true',
		'end',
		'function map:write(target)',
		'\tself:_write(target)',
		'end',
		'local relay<const> = function(owner, target)',
		'\towner:write(target)',
		'end',
		'local outer<const> = function(owner, target)',
		'\trelay(owner, target)',
		'end',
		'local item<const> = {}',
		'outer(map, item)',
		'return item.ready',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const ready = semanticSymbolAt(
		workspace.getSnapshot(),
		'main.lua',
		16,
		memberColumn(lines[15], 'ready'),
	);

	assert.ok(ready, 'field written through three forwarding calls');
	assert.equal(ready!.declaration.range.start.line, 3);
});

test('forwarding call summaries preserve callsite receiver identity', async () => {
	const { LuaSemanticWorkspace } = await semanticWorkspaceModulePromise;
	const lines = [
		'local writer<const> = {}',
		'function writer:write(target)',
		'\ttarget.ready = true',
		'end',
		'local observer<const> = {}',
		'function observer:write(_target) end',
		'local relay<const> = function(owner, target)',
		'\towner:write(target)',
		'end',
		'local outer<const> = function(owner, target)',
		'\trelay(owner, target)',
		'end',
		'local written<const> = {}',
		'local untouched<const> = {}',
		'outer(writer, written)',
		'outer(observer, untouched)',
		'local yes<const> = written.ready',
		'local no<const> = untouched.ready',
	];
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('main.lua', lines.join('\n'));
	const snapshot = workspace.getSnapshot();

	assert.equal(
		semanticSymbolAt(snapshot, 'main.lua', 17, memberColumn(lines[16], 'ready'))!
			.declaration.range.start.line,
		3,
	);
	assert.equal(
		semanticSymbolAt(snapshot, 'main.lua', 18, memberColumn(lines[17], 'ready')),
		null,
		'an unrelated receiver does not acquire another callsite effect',
	);
});
