import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaSourceReader } from '../../ide/language/lua/source_reader';
import { buildLuaFileSemanticData, buildLuaSemanticWorkspaceSnapshot, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { createPathModuleBindingsFixture, createPathModuleProjectFixture } from '../helpers/lua_semantic_project';

function fixture(source: string, providers: Readonly<Record<string, string>> = {}) {
	const file = buildLuaFileSemanticData(source, 'strings.lua');
	const files = [file, ...Object.entries(providers).map(([path, source]) => buildLuaFileSemanticData(source, path))];
	for (const file of files) assert.equal(file.syntaxError, null);
	const snapshot = buildLuaSemanticWorkspaceSnapshot(...createPathModuleProjectFixture(files.map(file => ({ path: file.file, source: file.source, analysis: file }))));
	const returned = file.chunk.body.get(file.chunk.body.length - 1);
	assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement);
	return { file, files, snapshot, reader: new LuaSourceReader(snapshot), expressions: returned.expressions };
}

test('authored string content proofs do not admit their query-only providers as represented source owners', () => {
	const f = fixture(`local names = require('names')
local prefix<const> = '/'
local path<const> = prefix .. names.idle
return [=[O'Brien\u0060Fx]=], names.idle, prefix .. names.idle, path, names.empty, '/' .. 3`, {
		'names.lua': "return { idle = 'Idle', empty = '' }",
	});
	assert.deepEqual(f.expressions.map(expression => f.reader.stringValue(f.file, expression)), ["O'Brien`Fx", 'Idle', '/Idle', '/Idle', '', undefined]);
	assert.equal(f.reader.files.size, 0);
	for (const expression of f.expressions) {
		const first = f.reader.stringValue(f.file, expression);
		assert.equal(f.reader.stringValue(f.file, expression), first, 'repeated cold-source queries retain the same proof');
	}
	f.reader.expression(f.file, f.expressions[1]);
	assert.deepEqual([...f.reader.files].map(file => file.file).sort(), ['names.lua', 'strings.lua'],
		'an explicit source expression still records its navigation and editing owners after a content proof');
});

test('failed string content proofs do not import unrelated callback syntax recovery into represented source', () => {
	const file = buildLuaFileSemanticData("return require('callback')", 'strings.lua');
	const callback = buildLuaFileSemanticData('return function() end\nlocal broken =', 'callback.lua');
	assert.notEqual(callback.syntaxError, null);
	const snapshot = buildLuaSemanticWorkspaceSnapshot(...createPathModuleProjectFixture([file, callback].map(file => ({ path: file.file, source: file.source, analysis: file }))));
	const reader = new LuaSourceReader(snapshot), returned = file.chunk.body.get(0);
	assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement);
	assert.equal(reader.stringValue(file, returned.expressions[0]), undefined);
	assert.equal(reader.files.size, 0); assert.equal(reader.syntaxComplete, true);
	reader.expression(file, returned.expressions[0]);
	assert.equal(reader.files.has(callback), true); assert.equal(reader.syntaxComplete, false);
});

test('authored strings retain competing writes, unknown members, calls and cycles instead of inferring values', () => {
	const f = fixture(`local same = 'Idle'
same = 'Idle'
local unknown
unknown = unknown
local function make() return 'Idle' end
return '/' .. same, '/' .. unknown, '/' .. external.name, '/' .. make(), external or 'Idle'`);
	assert.deepEqual(f.expressions.map(expression => f.reader.stringValue(f.file, expression)), [undefined, undefined, undefined, undefined, undefined]);
});

test('formal inputs do not acquire a string value from a known call argument', () => {
	const f = fixture(`local function inspect(name) return '/' .. name end
return inspect('Idle')`);
	const returned = f.file.functionValueFlows[0].expression.body.body.get(0);
	assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement);
	assert.equal(f.reader.stringValue(f.file, returned.expressions[0]), undefined);
	assert.equal(f.reader.stringValue(f.file, f.expressions[0]), undefined);
});

test('authored string and mutation-query order preserves writer evidence', () => {
	for (const mutationFirst of [false, true]) {
		const f = fixture(`local names = { idle = 'Idle' }
local alias = names
alias.idle = 'Active'
return '/' .. names.idle`);
		if (mutationFirst) f.snapshot.symbolResolver.authoredSources.directTableMutations();
		assert.equal(f.reader.stringValue(f.file, f.expressions[0]), undefined);
		f.snapshot.symbolResolver.authoredSources.tableMutations();
		assert.equal(new LuaSourceReader(f.snapshot).stringValue(f.file, f.expressions[0]), undefined);
	}
});

test('authored string caches belong to their immutable semantic generation', () => {
	const workspace = new LuaSemanticWorkspace(createPathModuleBindingsFixture(['strings.lua', 'names.lua']));
	workspace.updateFile('strings.lua', "local names = require('names'); return '/' .. names.idle");
	workspace.updateFile('names.lua', "return { idle = 'Idle' }");
	const first = workspace.getSnapshot();
	workspace.updateFile('names.lua', "return { idle = 'Active' }");
	const second = workspace.getSnapshot();
	for (const [snapshot, expected] of [[second, '/Active'], [first, '/Idle'], [second, '/Active']] as const) {
		const file = snapshot.getFileData('strings.lua')!;
		const returned = file.chunk.body.get(file.chunk.body.length - 1);
		assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement);
		assert.equal(new LuaSourceReader(snapshot).stringValue(file, returned.expressions[0]), expected);
	}
});
