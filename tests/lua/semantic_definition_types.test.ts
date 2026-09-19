import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaSemanticFrontend } from '../../toolchain/ts/lua/semantic/frontend';
import { LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { semanticSymbolsAt } from './semantic_test_harness';

type Source = { readonly path: string; readonly source: string };

function targetsAt(files: readonly Source[], path: string, line: number, name: string): string[] {
	const workspace = new LuaSemanticWorkspace();
	for (const file of files) workspace.updateFile(file.path, file.source);
	const snapshot = workspace.getSnapshot();
	const text = files.find(file => file.path === path)!.source.split('\n')[line - 1];
	return semanticSymbolsAt(snapshot, path, line, text.lastIndexOf(name) + 1)
		.map(target => `${target.declaration.file}:${target.declaration.namePath.join('.')}`)
		.sort();
}

const classes = [
	'local base<const> = {}',
	'base.__index = base',
	'function base:hello() self.count = 1 end',
	'function base:bye() end',
	'local derived<const> = setmetatable({}, { __index = base })',
	'derived.__index = derived',
	'function derived.new() return setmetatable({}, derived) end',
	'function derived:bye() end',
	'local object<const> = derived.new()',
	'object:hello()',
	'object:bye()',
	'return object.count',
].join('\n');

test('definition types follow constructors, metatable prototypes and overrides', () => {
	const files = [{ path: 'classes.lua', source: classes }];
	assert.deepEqual(targetsAt(files, 'classes.lua', 10, 'hello'), ['classes.lua:base.hello']);
	assert.deepEqual(targetsAt(files, 'classes.lua', 11, 'bye'), ['classes.lua:derived.bye'], 'the nearer definition shadows the prototype');
});

test('definition types give a class the fields its methods assign to self', () => {
	assert.deepEqual(targetsAt([{ path: 'classes.lua', source: classes }], 'classes.lua', 12, 'count'), ['classes.lua:self.count']);
});

test('definition types apply a prototype summary at call sites with static arguments', () => {
	const prefab = [
		'local root<const> = {}',
		'function root:set_space(space_id) end',
		'local prefab<const> = {}',
		'function prefab.define(source)',
		'\tlocal prototype<const> = source.base or root',
		'\tsetmetatable(source.class, { __index = prototype })',
		'end',
		'return prefab',
	].join('\n');
	const director = [
		"local prefab<const> = require('prefab')",
		'local director<const> = {}',
		'function director:start()',
		"\tself:set_space('main')",
		'end',
		'prefab.define({ class = director })',
		'return director',
	].join('\n');
	const files = [{ path: 'prefab.lua', source: prefab }, { path: 'director.lua', source: director }];
	assert.deepEqual(targetsAt(files, 'director.lua', 4, 'set_space'), ['prefab.lua:root.set_space']);
});

test('definition types resolve members written through an implicit namespace path', () => {
	const files = [
		{ path: 'base.lua', source: ['local base<const> = {}', 'function base.tools.byte() end', 'return base'].join('\n') },
		{ path: 'main.lua', source: ["local tools<const> = require('base').tools", 'tools.byte()'].join('\n') },
	];
	assert.deepEqual(targetsAt(files, 'main.lua', 2, 'byte'), ['base.lua:base.tools.byte']);
});

test('definition types treat an explicit self parameter as the owner instance', () => {
	const source = [
		'local actor<const> = {}',
		'function actor:run() end',
		'function actor.initialize(self)',
		'\tself:run()',
		'end',
	].join('\n');
	assert.deepEqual(targetsAt([{ path: 'actor.lua', source }], 'actor.lua', 4, 'run'), ['actor.lua:actor.run']);
});

test('definition types leave parameters unknown instead of inferring them from callers', () => {
	const source = [
		'local target<const> = {}',
		'function target:run() end',
		'local function apply(value)',
		'\tvalue:run()',
		'end',
		'apply(target)',
	].join('\n');
	assert.deepEqual(targetsAt([{ path: 'apply.lua', source }], 'apply.lua', 4, 'run'), []);
});

test('interactive member queries never instantiate calls', () => {
	const frontend = buildLuaSemanticFrontend([{ path: 'classes.lua', source: classes }]);
	const lines = classes.split('\n');
	frontend.provideHover('classes.lua', 10, lines[9].indexOf('hello') + 1);
	frontend.findSymbolsByPosition('classes.lua', 11, lines[10].indexOf('bye') + 1);
	frontend.provideSignatureHelp('classes.lua', 10, lines[9].indexOf('(') + 2);
	const file = frontend.getFile('classes.lua');
	const context = file.findMemberCompletionContextAt(12, 'return object.'.length + 1)!;
	assert.deepEqual(file.getMemberCompletionDeclarations(context).map(member => member.name).sort(),
		['__index', 'bye', 'count', 'hello', 'new']);
	assert.equal(frontend.snapshot.symbolResolver.getSemanticQueryMetrics().instantiatedCalls, 0);
});

test('definition answers are independent of query order', () => {
	const files = [{ path: 'classes.lua', source: classes }];
	const queries: [number, string][] = [[12, 'count'], [10, 'hello'], [11, 'bye']];
	const forward = queries.map(([line, name]) => targetsAt(files, 'classes.lua', line, name));
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFile('classes.lua', classes);
	const snapshot = workspace.getSnapshot();
	const lines = classes.split('\n');
	const reversed = [...queries].reverse().map(([line, name]) => semanticSymbolsAt(snapshot, 'classes.lua', line, lines[line - 1].lastIndexOf(name) + 1)
		.map(target => `${target.declaration.file}:${target.declaration.namePath.join('.')}`).sort()).reverse();
	assert.deepEqual(reversed, forward);
});
