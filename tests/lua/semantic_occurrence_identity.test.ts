import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';
import { parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';

const padding = '-- retained lexical boundary\n'.repeat(80);
const definitions = [
	'local value<const> = 1',
	'local object<const> = { named = 2, ["quoted"] = 3 }',
	'local function use(arg) local inner = value; return object.named, inner, arg end',
	'return object',
].join('\n');

test('shifted shared declaration occurrences retain identity but not presentation objects', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = padding + definitions;
	const first = workspace.updateFile('identity.lua', source);
	const retained = workspace.getSnapshot();
	const next = workspace.updateFile('identity.lua', '\n' + source,
		SourceChangeMap.unchanged(source.length).append([{ offset: 0, deletedLength: 0, insertedLength: 1 }]));
	assert.deepEqual(next.decls.map(decl => decl.id), first.decls.map(decl => decl.id));
	assert.ok(first.decls.some(decl => decl.name === 'quoted'));
	for (let index = 0; index < first.decls.length; index++) {
		const old = first.decls[index], current = next.decls[index];
		assert.notEqual(current, old);
		assert.equal(current.range.start.line, old.range.start.line + 1);
		assert.equal(workspace.getSnapshot().symbolResolver.getDeclaration(old.id), current);
		assert.equal(retained.symbolResolver.getDeclaration(old.id), old);
	}
	for (const [syntax, id] of first.declarationIdsBySyntax) {
		assert.equal(next.declarationIdsBySyntax.get(syntax), id);
	}
});

test('independent syntax occurrences do not alias by source spelling or position', () => {
	const first = buildLuaFileSemanticData(definitions, 'identity.lua');
	const second = buildLuaFileSemanticData(definitions, 'identity.lua');
	const firstIds = new Set(first.decls.map(decl => decl.id));
	for (const declaration of second.decls) assert.equal(firstIds.has(declaration.id), false);
	assert.deepEqual(first.decls.map(decl => decl.range), second.decls.map(decl => decl.range));
});

test('rebinding one supplied occurrence keeps its declaration identity, while file ownership distinguishes it', () => {
	const parsed = parseLuaChunkWithRecovery(definitions, 'identity.lua');
	const first = buildLuaFileSemanticData(definitions, 'identity.lua', parsed);
	const rebound = buildLuaFileSemanticData(definitions, 'identity.lua', parsed);
	const otherFile = buildLuaFileSemanticData(definitions, 'other.lua', parsed);
	assert.deepEqual(rebound.decls.map(decl => decl.id), first.decls.map(decl => decl.id));
	const ids = new Set(first.decls.map(decl => decl.id));
	for (const declaration of otherFile.decls) assert.equal(ids.has(declaration.id), false);
});

test('editing a same-file global witness cannot make allocation order choose navigation', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = 'bss counter: word\n' + padding + 'bss counter: word';
	const first = workspace.updateFile('globals.lua', source);
	const reader = workspace.updateFile('reader.lua', 'return counter');
	const retained = workspace.getSnapshot();
	const inserted = ' ';
	const edited = source.slice(0, 3) + inserted + source.slice(3);
	const current = workspace.updateFile('globals.lua', edited,
		SourceChangeMap.unchanged(source.length).append([{ offset: 3, deletedLength: 0, insertedLength: inserted.length }]));
	assert.notEqual(current.decls[0].id, first.decls[0].id, 'changed lexical block reparses first witness');
	assert.equal(current.decls[1].id, first.decls[1].id, 'later witness is shared');
	assert.deepEqual(workspace.getSnapshot().symbolResolver.resolveReferenceTargets(reader.refs[0]), [current.decls[0].id]);
	assert.deepEqual(retained.symbolResolver.resolveReferenceTargets(reader.refs[0]), [first.decls[0].id]);
	const cold = new LuaSemanticWorkspace();
	const fresh = cold.updateFile('globals.lua', edited);
	const freshReader = cold.updateFile('reader.lua', 'return counter');
	assert.deepEqual(cold.getSnapshot().symbolResolver.resolveReferenceTargets(freshReader.refs[0]), [fresh.decls[0].id]);
	assert.deepEqual(current.decls[0].range, fresh.decls[0].range);
});

test('new earlier lexical bindings change captured references without changing shared declaration identities', () => {
	const source = 'local value = 1\n' + padding + 'local function read() return value end\nreturn read';
	const workspace = new LuaSemanticWorkspace();
	const first = workspace.updateFile('capture.lua', source);
	const retained = workspace.getSnapshot();
	const offset = source.indexOf(padding);
	const inserted = 'local value = 2\n';
	const current = workspace.updateFile('capture.lua', source.slice(0, offset) + inserted + source.slice(offset),
		SourceChangeMap.unchanged(source.length).append([{ offset, deletedLength: 0, insertedLength: inserted.length }]));
	const oldFunction = first.decls.find(decl => decl.name === 'read')!;
	assert.equal(current.decls.find(decl => decl.name === 'read')!.id, oldFunction.id);
	const oldReference = first.refs.find(ref => ref.name === 'value' && !ref.isWrite)!;
	const newReference = current.refs.find(ref => ref.name === 'value' && !ref.isWrite)!;
	const locals = current.decls.filter(decl => decl.name === 'value');
	assert.deepEqual(workspace.getSnapshot().symbolResolver.resolveReferenceTargets(newReference), [locals[1].id]);
	assert.deepEqual(retained.symbolResolver.resolveReferenceTargets(oldReference), [first.decls[0].id]);
});
