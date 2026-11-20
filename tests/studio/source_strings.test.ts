import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LuaSourceReader, readLuaSourceTruth } from '../../ide/language/lua/source_reader';
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

test('typed immutable source fields retain their written occurrence and expose proven string content', () => {
	const f = fixture(`local labels_module<const> = require('labels')
local labels<const>: *text_record = labels_module.labels
return { text = labels[0].message }, labels[0].message, labels[0].message .. '!'`, {
		'labels.lua': `module<const>
struct text_record
 message: string
end
rodata labels: text_record = { message = 'ready' }
return { labels = labels }`,
	});
	const table = f.expressions[0]; assert.ok(table.kind === LuaSyntaxKind.TableConstructorExpression);
	const field = table.fields[0], written = f.reader.memberState(f.file, table, 'text');
	assert.ok(written !== undefined && written !== null && written.expression === field.value);
	assert.equal(f.reader.stringValue(written.file, written.expression), 'ready');
	assert.equal(f.reader.stringValue(f.file, f.expressions[1]), 'ready');
	assert.equal(f.reader.stringValue(f.file, f.expressions[2]), 'ready!');
});

test('typed string aliases require their initializer to reach the read', () => {
	const reached = fixture("rodata title: string = 'hi'\nlocal text = *title\nreturn text");
	assert.equal(reached.reader.stringValue(reached.file, reached.expressions[0]), 'hi');
	const skipped = fixture("rodata title: string = 'hi'\ngoto skip\nlocal text = *title\n::skip::\nreturn text");
	assert.equal(skipped.reader.stringValue(skipped.file, skipped.expressions[0]), undefined);
	const skippedConcat = fixture("rodata title: string = 'hi'\ngoto skip\nlocal text = *title .. '!'\n::skip::\nreturn text");
	assert.equal(skippedConcat.reader.stringValue(skippedConcat.file, skippedConcat.expressions[0]), undefined);
});

test('typed authored fields do not turn dynamic indices or mutable addresses into proven text', () => {
	const f = fixture(`struct text_record
 message: string
end
rodata labels: text_record = { message = 'ready' }
local p<const>: *text_record = labels
local runtime: *text_record = acquire()
local changed: *text_record = labels
changed = acquire()
return {text = p[index].message}, {text = runtime[0].message}, {text = changed[0].message},
 p[index].message, runtime[0].message, changed[0].message`);
	for (const expression of f.expressions.slice(0, 3)) {
		assert.ok(expression.kind === LuaSyntaxKind.TableConstructorExpression);
		const value = f.reader.memberState(f.file, expression, 'text');
		assert.ok(value !== undefined && value !== null && value.expression === expression.fields[0].value);
		assert.equal(f.reader.stringValue(value.file, value.expression), undefined);
	}
	assert.equal(f.reader.stringValue(f.file, f.expressions[3]), undefined);
	assert.equal(f.reader.stringValue(f.file, f.expressions[4]), undefined);
	assert.equal(f.reader.stringValue(f.file, f.expressions[5]), undefined);
});

test('typed storage loads, addresses, and whole aggregates retain distinct source semantics', () => {
	const f = fixture(`rodata title: string = 'ready'
rodata labels: string[2] = { 'one', 'two' }
return *title, title[0], &title, title, labels[0], labels[1], *labels, &labels[0]`);
	assert.deepEqual(f.expressions.map(expression => f.reader.stringValue(f.file, expression)),
		['ready', 'ready', undefined, undefined, 'one', 'two', undefined, undefined]);
});

test('a typed view of a selected storage address retains the original byte selection', () => {
	const f = fixture(`rodata labels: string[2] = { 'one', 'two' }
local p<const>: *string = &labels[1]
return *p, p[0], &p[0]`);
	assert.deepEqual(f.expressions.map(expression => f.reader.stringValue(f.file, expression)), ['two', 'two', undefined]);
});

test('a dereferenced struct view can select a string field without losing its typed root', () => {
	const f = fixture(`struct text_record
 message: string
end
rodata labels: text_record = { message = 'ready' }
local view<const>: *text_record = labels
return (*view).message, &(*view).message`);
	assert.deepEqual(f.expressions.map(expression => f.reader.stringValue(f.file, expression)), ['ready', undefined]);
});

test('a shadowing ordinary Lua table is not classified as a typed selection', () => {
	const f = fixture(`rodata labels: string[2] = { 'one', 'two' }
local function read()
 local labels = { { text = 'lua' } }
 return labels[1].text
end
return read()`);
	const flow = f.file.functionValueFlows[0];
	const returned = flow.expression.body.body.get(1);
	assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement);
	const query = f.snapshot.symbolResolver.writtenSources;
	const trace = query.trace(query.expression(f.file, returned.expressions[0]));
	assert.equal(trace.boundaries.some(boundary => boundary.reason === 'typed-access'), false);
});

test('a module storage address does not become a typed view merely through Lua indexing', () => {
	const f = fixture(`local module<const> = require('labels')
return module.labels[0]`, {
		'labels.lua': `module<const>
rodata labels: string[1] = { 'ready' }
return { labels = labels }`,
	});
	const query = f.snapshot.symbolResolver.writtenSources;
	const trace = query.trace(query.expression(f.file, f.expressions[0]));
	assert.equal(trace.boundaries.some(boundary => boundary.reason === 'typed-access'), false);
	assert.equal(f.reader.stringValue(f.file, f.expressions[0]), undefined);
});

test('address-of terminates a typed selection before an enclosing Lua index or member', () => {
	const f = fixture(`rodata title: string = 'ready'
return (&title)[0], (&title).text, &title[0]`);
	const query = f.snapshot.symbolResolver.writtenSources;
	const boundaries = f.expressions.map(expression => query.trace(query.expression(f.file, expression)).boundaries.map(boundary => boundary.reason));
	assert.equal(boundaries[0].includes('typed-access'), false);
	assert.equal(boundaries[1].includes('typed-access'), false);
	assert.ok(boundaries[2].includes('typed-access'));
	assert.deepEqual(f.expressions.map(expression => f.reader.stringValue(f.file, expression)), [undefined, undefined, undefined]);
});

test('a same-named static declaration in another module does not type a runtime global', () => {
	const storage = { path: 'storage.lua', source: `rodata shared: string[2] = {'one','two'}\nreturn 1` };
	const entry = { path: 'entry.lua', source: `shared = {'table'}\nreturn shared[1]` };
	for (const files of [[storage, entry], [entry, storage]]) {
		const snapshot = buildLuaSemanticWorkspaceSnapshot(...createPathModuleProjectFixture(files));
		const file = snapshot.getFileData(entry.path)!, statement = file.chunk.body.get(1);
		assert.ok(statement.kind === LuaSyntaxKind.ReturnStatement);
		const expression = statement.expressions[0], query = snapshot.symbolResolver.writtenSources;
		assert.equal(query.trace(query.expression(file, expression)).boundaries.some(boundary => boundary.reason === 'typed-access'), false);
		assert.equal(new LuaSourceReader(snapshot).stringValue(file, expression), undefined);
	}
});

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

test('closed string content retains its actual concat source when explicitly admitted', () => {
	const f = fixture(`local names = require('names')
local joined = 'STU' .. names.tail
return { direct = 'STU' .. 'DIO', alias = joined, empty = '' .. '' }`, {
		'names.lua': "return { tail = 'DIO' }",
	});
	const root = f.expressions[0]; assert.ok(root.kind === LuaSyntaxKind.TableConstructorExpression);
	const joined = f.file.chunk.body.get(1); assert.ok(joined.kind === LuaSyntaxKind.LocalAssignmentStatement);
	for (const [name, expected, syntax] of [
		['direct', 'STUDIO', root.fields[0].value], ['alias', 'STUDIO', joined.values[0]], ['empty', '', root.fields[2].value],
	] as const) {
		const field = f.reader.memberState(f.file, root, name);
		assert.ok(field !== undefined && field !== null);
		assert.equal(field.file, f.file); assert.equal(field.expression, syntax);
		assert.equal(f.reader.stringValue(field.file, field.expression), expected);
		assert.equal(readLuaSourceTruth(field), true, 'a concat produces a String, including an empty one');
		assert.equal(f.reader.memberState(f.file, root, name), field, 'source admission reuses the actual immutable occurrence');
	}
	assert.deepEqual([...f.reader.files].map(file => file.file), ['strings.lua'],
		'content-only providers do not become represented editing owners of the concat');
});

test('proved own concat values remain non-nil under prototype uncertainty without borrowing inherited fields', () => {
	const f = fixture("return setmetatable({ value = 'A' .. 'B' }, { __index = external })");
	const call = f.expressions[0]; assert.ok(call.kind === LuaSyntaxKind.CallExpression);
	const table = call.arguments[0]; assert.ok(table.kind === LuaSyntaxKind.TableConstructorExpression);
	for (const field of [f.reader.memberState(f.file, table, 'value'), f.reader.ownMemberState(f.file, table, 'value')]) {
		assert.ok(field !== undefined && field !== null);
		assert.equal(field.expression, table.fields[0].value); assert.equal(f.reader.stringValue(field.file, field.expression), 'AB');
	}
	assert.equal(f.reader.memberState(f.file, table, 'missing'), undefined);
	assert.equal(f.reader.ownMemberState(f.file, table, 'missing'), null);
});

for (const source of [
	"local value='A'..'B'; value='A'..'B'; return value",
	"return 'A' .. make_string()", "return 'A' .. external", "local cycle; cycle=cycle; return 'A'..cycle",
]) test(`concat source admission preserves unresolved writer evidence: ${source}`, () => {
	const f = fixture(source);
	assert.equal(f.reader.stringValue(f.file, f.expressions[0]), undefined);
	assert.equal(f.reader.expression(f.file, f.expressions[0]), undefined);
});

test('closed concat proof cannot erase unknown or competing own member writes', () => {
	for (const mutation of ["value[key]='AB'", "value.field='A'..'B'"]) {
		const f = fixture(`local value={field='A'..'B'}; ${mutation}; return value`);
		assert.equal(f.reader.memberState(f.file, f.expressions[0], 'field'), undefined);
		assert.equal(f.reader.ownMemberState(f.file, f.expressions[0], 'field'), undefined);
	}
});
