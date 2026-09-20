import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaSemanticFrontend } from '../../toolchain/ts/lua/semantic/frontend';
import { LuaSemanticWorkspace, type LuaSemanticWorkspaceSnapshot } from '../../toolchain/ts/lua/semantic/model';
import { declarationValueSource } from '../../toolchain/ts/lua/semantic/value_graph';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';

function declaration(snapshot: LuaSemanticWorkspaceSnapshot, name: string, file = 'aliases.lua') {
	return snapshot.getFileData(file)!.decls.find(item => item.name === name)!;
}

function functionNames(snapshot: LuaSemanticWorkspaceSnapshot, name: string, file = 'aliases.lua'): string[] {
	return snapshot.symbolResolver.resolveDefinitionFunctionTargets(declaration(snapshot, name, file).id)
		.map(id => {
			const target = snapshot.symbolResolver.getDeclaration(id);
			return `${target.file}:${target.namePath.join('.')}`;
		});
}

test('written alias cycles publish complete answers regardless of the first queried root', () => {
	const source = 'local sink, alias\nsink = alias\nalias = sink\nalias = function(value) return value + 1 end';
	for (const order of [['sink', 'alias'], ['alias', 'sink']]) {
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFile('aliases.lua', source);
		const snapshot = workspace.getSnapshot();
		for (const name of order) assert.deepEqual(functionNames(snapshot, name), ['aliases.lua:alias']);
		for (const name of order) assert.deepEqual(functionNames(snapshot, name), ['aliases.lua:alias']);
	}
});

test('one alias component retains all written exits in query-independent order', () => {
	const source = [
		'local first, second, third',
		'first = second',
		'second = third',
		'third = first',
		'first = function(left) return left end',
		'third = function(right) return right + 1 end',
	].join('\n');
	let expected: string[] | undefined;
	for (const first of ['first', 'second', 'third']) {
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFile('aliases.lua', source);
		const snapshot = workspace.getSnapshot();
		const actual = functionNames(snapshot, first);
		assert.deepEqual([...actual].sort(), ['aliases.lua:first', 'aliases.lua:third']);
		if (expected === undefined) expected = actual;
		else assert.deepEqual(actual, expected);
		for (const name of ['first', 'second', 'third']) assert.deepEqual(functionNames(snapshot, name), expected);
	}
});

test('zero-step global alias cycles can cross file boundaries', () => {
	for (const first of ['left', 'right']) {
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFile('left.lua', 'left = right');
		workspace.updateFile('right.lua', 'right = left\nright = function(value) return value end');
		const snapshot = workspace.getSnapshot();
		assert.deepEqual(functionNames(snapshot, first, `${first}.lua`), ['right.lua:right']);
		assert.deepEqual(functionNames(snapshot, 'left', 'left.lua'), ['right.lua:right']);
		assert.deepEqual(functionNames(snapshot, 'right', 'right.lua'), ['right.lua:right']);
	}
});

test('cyclic table aliases expose the same members after warming either root', () => {
	const source = 'local first, second\nfirst = second\nsecond = first\nsecond = { run = function(value) return value end }';
	for (const order of [['first', 'second'], ['second', 'first']]) {
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFile('aliases.lua', source);
		const snapshot = workspace.getSnapshot();
		for (const name of order) {
			const members = snapshot.symbolResolver.getMembers(declarationValueSource(declaration(snapshot, name).id));
			assert.deepEqual(members.map(member => member.name), ['run']);
		}
	}
});

test('alias components retain snapshot lifetime when a cycle is split and restored', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = 'local first, second\nfirst = second\nsecond = first\nsecond = function(value) return value end';
	workspace.updateFile('aliases.lua', source);
	const before = workspace.getSnapshot();
	assert.deepEqual(functionNames(before, 'second'), ['aliases.lua:second']);
	workspace.updateFile('aliases.lua', source.replace('first = second', 'first = nil'));
	const split = workspace.getSnapshot();
	assert.deepEqual(functionNames(split, 'first'), []);
	assert.deepEqual(functionNames(split, 'second'), ['aliases.lua:second']);
	assert.deepEqual(functionNames(before, 'first'), ['aliases.lua:second']);
	workspace.updateFile('aliases.lua', source);
	assert.deepEqual(functionNames(workspace.getSnapshot(), 'first'), ['aliases.lua:second']);
	assert.deepEqual(functionNames(split, 'first'), []);
});

test('member steps remain value projections rather than alias edges', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('aliases.lua', 'local owner = { child = { own = 1 } }\nlocal alias = owner.child');
	const snapshot = workspace.getSnapshot();
	assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(declaration(snapshot, 'alias').id))
		.map(member => member.name), ['own']);
	assert.deepEqual(snapshot.symbolResolver.getMembers(declarationValueSource(declaration(snapshot, 'owner').id))
		.map(member => member.name), ['child']);
});

test('prototype lookup can consume a cyclic alias without inheriting normal-phase pending answers', () => {
	const source = [
		'local base, alias',
		'base = alias',
		'alias = base',
		'alias = { shared = function(self) end }',
		'local derived = setmetatable({}, { __index = base })',
		'derived:shared()',
	].join('\n');
	for (const warm of [false, true]) {
		const frontend = buildLuaSemanticFrontend([{ path: 'aliases.lua', source }]);
		if (warm) {
			frontend.snapshot.symbolResolver.getMembers(declarationValueSource(declaration(frontend.snapshot, 'alias').id));
		}
		const hover = frontend.provideHover('aliases.lua', 6, 10);
		assert.equal(hover!.contents[0].label, '(function) alias.shared(self)');
	}
});

test('an alias-only cycle with no written shape stays unknown', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('aliases.lua', 'local first, second\nfirst = second\nsecond = first');
	const snapshot = workspace.getSnapshot();
	assert.deepEqual(functionNames(snapshot, 'first'), []);
	assert.deepEqual(functionNames(snapshot, 'second'), []);
});

test('a self-alias keeps its written terminal without recursively evaluating itself', () => {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('aliases.lua', 'local value\nvalue = value\nvalue = function(arg) return arg end');
	assert.deepEqual(functionNames(workspace.getSnapshot(), 'value'), ['aliases.lua:value']);
});

test('a newly discovered cycle can depend on an already evaluated alias component', () => {
	const source = 'local leaf = function(value) return value end\nlocal first, second\nfirst = second\nsecond = first\nsecond = leaf';
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('aliases.lua', source);
	const snapshot = workspace.getSnapshot();
	for (const name of ['leaf', 'second', 'first']) {
		assert.deepEqual(functionNames(snapshot, name), ['aliases.lua:leaf']);
	}
});

test('alias component ordering follows edited source order rather than syntax allocation order', () => {
	const first = 'local first\n', second = 'local second\n';
	const body = 'first = second\nsecond = first\nfirst = function(value) return value end\nsecond = function(value) return value + 1 end';
	const source = first + second + body;
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('aliases.lua', source);
	const before = workspace.getSnapshot();
	assert.deepEqual(functionNames(before, 'first'), ['aliases.lua:first', 'aliases.lua:second']);
	const changes = SourceChangeMap.unchanged(source.length).append([
		{ offset: first.length, deletedLength: second.length, insertedLength: 0 },
		{ offset: 0, deletedLength: 0, insertedLength: second.length },
	]);
	workspace.updateFile('aliases.lua', second + first + body, changes);
	const edited = workspace.getSnapshot();
	const cold = new LuaSemanticWorkspace();
	cold.updateFile('aliases.lua', second + first + body);
	assert.deepEqual(functionNames(edited, 'first'), ['aliases.lua:second', 'aliases.lua:first']);
	assert.deepEqual(functionNames(edited, 'first'), functionNames(cold.getSnapshot(), 'first'));
	assert.deepEqual(functionNames(before, 'first'), ['aliases.lua:first', 'aliases.lua:second']);
});

test('a long written-alias chain does not consume the host call stack', () => {
	const lines = ['local alias_0 = function(value) return value end'];
	for (let index = 1; index <= 3000; index++) lines.push(`local alias_${index} = alias_${index - 1}`);
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('aliases.lua', lines.join('\n'));
	assert.deepEqual(functionNames(workspace.getSnapshot(), 'alias_3000'), ['aliases.lua:alias_0']);
});
