import { findOrderedSourceSpanEntryAtPosition } from '../../toolchain/ts/lua/semantic/source_range';
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
		assert.equal(next.chunk.locations.range(current.span).start.line, first.chunk.locations.range(old.span).start.line + 1);
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
	assert.deepEqual(first.decls.map(decl => first.chunk.locations.range(decl.span)), second.decls.map(decl => second.chunk.locations.range(decl.span)));
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
	assert.deepEqual(current.chunk.locations.range(current.decls[0].span), fresh.chunk.locations.range(fresh.decls[0].span));
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

test('shared binder spans resolve through retained and shifted location owners without mutation', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = padding + definitions;
	const old = workspace.updateFile('spans.lua', source);
	const spans = [...old.decls, ...old.refs].map(fact => ({ ...fact.span }));
	const ranges = [...old.decls, ...old.refs].map(fact => old.chunk.locations.range(fact.span));
	const current = workspace.updateFile('spans.lua', '\n' + source,
		SourceChangeMap.unchanged(source.length).append([{ offset: 0, deletedLength: 0, insertedLength: 1 }]));
	const oldFacts = [...old.decls, ...old.refs];
	const currentFacts = [...current.decls, ...current.refs];
	assert.equal(currentFacts.length, oldFacts.length);
	for (let index = 0; index < oldFacts.length; index++) {
		const previous = oldFacts[index], next = currentFacts[index];
		assert.deepEqual(previous.span, spans[index]);
		assert.deepEqual(next.span, previous.span);
		assert.equal('range' in previous, false);
		assert.equal('range' in next, false);
		assert.strictEqual(old.chunk.locations.range(previous.span), ranges[index]);
		assert.deepEqual(current.chunk.locations.range(previous.span), {
			path: old.file,
			start: { ...ranges[index].start, line: ranges[index].start.line + 1 },
			end: { ...ranges[index].end, line: ranges[index].end.line + 1 },
		});
		assert.deepEqual(current.chunk.locations.range(next.span), current.chunk.locations.range(previous.span));
	}
});

test('binding stores spans without materializing a source range for each fact', t => {
	const source = definitions + "\nlocal module = require('module')\nreturn module.item";
	const parsed = parseLuaChunkWithRecovery(source, 'spans.lua');
	const range = t.mock.method(parsed.chunk.locations, 'range');
	const position = t.mock.method(parsed.chunk.locations, 'position');
	const file = buildLuaFileSemanticData(source, 'spans.lua', parsed);
	assert.equal(file.syntaxError, null);
	assert.ok(file.decls.length > 5);
	assert.ok(file.refs.length > 5);
	assert.ok(file.memberAccesses.length > 0);
	assert.equal(file.moduleReferences.length, 1);
	assert.equal(range.mock.callCount(), 0, 'binding does not materialize presentation ranges');
	assert.equal(position.mock.callCount(), 0, 'binding does not materialize presentation positions');
	for (const fact of [...file.decls, ...file.refs, ...file.memberAccesses, ...file.moduleReferences]) {
		assert.equal('range' in fact, false);
		assert.ok(fact.span);
	}
});

test('ordered span lookup keeps inclusive endpoints without range or position materialization', t => {
	const source = padding + Array.from({ length: 64 }, (_, index) => `local value_${index} = ${index}`).join('\n');
	const workspace = new LuaSemanticWorkspace();
	const old = workspace.updateFile('lookup.lua', source);
	const current = workspace.updateFile('lookup.lua', '\n' + source,
		SourceChangeMap.unchanged(source.length).append([{ offset: 0, deletedLength: 0, insertedLength: 1 }]));
	for (const file of [old, current]) {
		const ranges = file.decls.map(decl => file.chunk.locations.range(decl.span));
		const range = t.mock.method(file.chunk.locations, 'range');
		const position = t.mock.method(file.chunk.locations, 'position');
		const offset = t.mock.method(file.chunk.locations, 'offset');
		for (const [index, declaration] of file.decls.entries()) {
			const { start, end } = ranges[index];
			for (const point of [start, end]) {
				const before = offset.mock.callCount();
				assert.equal(findOrderedSourceSpanEntryAtPosition(file.decls, file.chunk.locations, point.line, point.column), declaration);
				assert.ok(offset.mock.callCount() - before <= 8, '64 entries require logarithmic offset comparisons');
			}
			assert.equal(findOrderedSourceSpanEntryAtPosition(file.decls, file.chunk.locations, end.line, end.column + 1), undefined);
		}
		assert.equal(findOrderedSourceSpanEntryAtPosition(file.decls, file.chunk.locations, 1, 1), undefined);
		assert.equal(range.mock.callCount(), 0);
		assert.equal(position.mock.callCount(), 0);
	}
});
