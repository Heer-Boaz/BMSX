import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';
import { buildLuaFileSemanticData, LuaSemanticWorkspace, type FileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { findInnermostScope, findLuaLexicalBindingAt } from '../../toolchain/ts/lua/semantic/scope_query';

function bindingAt(file: FileSemanticData, name: string, offset: number) {
	const position = file.chunk.locations.positionAt(offset);
	return findLuaLexicalBindingAt(file, name, position.line, position.column);
}

test('lexical boundaries retain relative occurrence points through a shifted generation', () => {
	const source = '-- retained boundary\n'.repeat(80)
		+ 'local function read(arg) local value = arg; return value end\nreturn read';
	const workspace = new LuaSemanticWorkspace();
	const first = workspace.updateFile('points.lua', source);
	const retainedScope = first.scopes[1];
	const retainedDeclaration = first.decls.find(decl => decl.name === 'value')!;
	const before = first.chunk.locations.position(retainedScope.startInclusive.unit, retainedScope.startInclusive.offset);
	const after = workspace.updateFile('points.lua', '\n' + source,
		SourceChangeMap.unchanged(source.length).append([{ offset: 0, deletedLength: 0, insertedLength: 1 }]));
	assert.deepEqual(after.scopes[1].startInclusive, retainedScope.startInclusive);
	assert.deepEqual(after.scopes[1].endExclusive, retainedScope.endExclusive);
	assert.deepEqual(after.decls.find(decl => decl.name === 'value')!.visibleFrom, retainedDeclaration.visibleFrom);
	assert.deepEqual(first.chunk.locations.position(retainedScope.startInclusive.unit, retainedScope.startInclusive.offset), before);
	assert.deepEqual(after.chunk.locations.position(retainedScope.startInclusive.unit, retainedScope.startInclusive.offset),
		{ line: before.line + 1, column: before.column });
});

test('ordinary local activation excludes its own initializer and is strict at the final token', () => {
	const source = 'local value = 1\ndo local value = value; print(value) end';
	const file = buildLuaFileSemanticData(source, 'activation.lua');
	const [outer, inner] = file.decls.filter(decl => decl.name === 'value');
	const activation = file.chunk.locations.offset(inner.visibleFrom.unit, inner.visibleFrom.offset);
	const initializer = source.indexOf('= value') + 2;
	const initialBinding = bindingAt(file, 'value', initializer);
	const boundaryBinding = bindingAt(file, 'value', activation);
	const activeBinding = bindingAt(file, 'value', activation + 1);
	assert.ok(initialBinding.kind === 'declaration');
	assert.ok(boundaryBinding.kind === 'declaration');
	assert.ok(activeBinding.kind === 'declaration');
	assert.equal(initialBinding.declaration.id, outer.id);
	assert.equal(boundaryBinding.declaration.id, outer.id);
	assert.equal(activeBinding.declaration.id, inner.id);
});

test('repeat scope includes its condition and ends after the condition token', () => {
	const source = 'repeat local done = true until done\nprint(done)';
	const file = buildLuaFileSemanticData(source, 'repeat.lua');
	const scope = file.scopes[1];
	const end = file.chunk.locations.offset(scope.endExclusive.unit, scope.endExclusive.offset);
	assert.equal(end, source.indexOf('\n'));
	assert.equal(bindingAt(file, 'done', source.indexOf('until done') + 6).kind, 'declaration');
	assert.equal(bindingAt(file, 'done', end).kind, 'global');
	assert.equal(bindingAt(file, 'done', source.lastIndexOf('done')).kind, 'global');
});

test('recursive const closure activation is anchored before its own body', () => {
	const source = 'local recur<const> = function() return recur() end\nreturn recur';
	const file = buildLuaFileSemanticData(source, 'recursive.lua');
	const declaration = file.decls.find(decl => decl.name === 'recur')!;
	assert.equal(file.chunk.locations.offset(declaration.visibleFrom.unit, declaration.visibleFrom.offset), source.indexOf('recur') + 'recur'.length - 1);
	const binding = bindingAt(file, 'recur', source.indexOf('return recur()') + 7);
	assert.ok(binding.kind === 'declaration');
	assert.equal(binding.declaration.id, declaration.id);
});

test('root scope owns EOF while its exclusive endpoint lies one position after it', () => {
	for (const source of ['', 'local value = 1', 'local value = 1\n']) {
		const file = buildLuaFileSemanticData(source, 'eof.lua');
		const root = file.scopes[0];
		assert.equal(file.chunk.locations.offset(root.startInclusive.unit, root.startInclusive.offset), 0);
		assert.equal(file.chunk.locations.offset(root.endExclusive.unit, root.endExclusive.offset), source.length + 1);
		const eof = file.chunk.locations.positionAt(source.length);
		assert.equal(findInnermostScope(file, eof.line, eof.column), root);
		assert.equal(findInnermostScope(file, eof.line, eof.column + 1), undefined);
	}
});

test('scope identity survives inserted siblings while parent attachment belongs to each generation', () => {
	const source = '-- lexical padding\n'.repeat(80)
		+ 'local function read(arg) do local value = arg; print(value) end end\nreturn read';
	const workspace = new LuaSemanticWorkspace();
	const old = workspace.updateFile('scope_ids.lua', source);
	const root = old.scopes[0];
	const body = old.scopes[1];
	const block = old.scopes[2];
	const inserted = 'do local sibling = 1 end\n';
	const current = workspace.updateFile('scope_ids.lua', inserted + source,
		SourceChangeMap.unchanged(source.length).append([{ offset: 0, deletedLength: 0, insertedLength: inserted.length }]));
	assert.notEqual(current.scopes[0].id, root.id);
	assert.equal(current.scopes[2].id, body.id);
	assert.equal(current.scopes[3].id, block.id);
	assert.equal(old.scopeParents.get(body.id), root.id);
	assert.equal(current.scopeParents.get(body.id), current.scopes[0].id);
	assert.equal(current.scopeParents.get(block.id), body.id);
	assert.equal(old.scopeParents.has(root.id), false);
	for (const file of [old, current]) {
		assert.equal(file.scopesById.size, file.scopes.length, 'each authored scope has a unique identity');
		for (const scope of file.scopes) {
			assert.strictEqual(file.scopesById.get(scope.id), scope);
			assert.equal('parentIndex' in scope, false);
			assert.equal('declarationIndices' in scope, false);
			for (const declaration of scope.declarations) {
				assert.equal(declaration.scope, scope.id);
				assert.strictEqual(file.decls.find(candidate => candidate.id === declaration.id), declaration);
				assert.equal('publicationSlot' in declaration, false);
				assert.equal('scopeRef' in declaration, false);
			}
		}
	}
});


test('binding one syntax generation under two files cannot collide lexical scope identities', () => {
	const source = 'local function outer() return function() return 1 end end';
	const parsed = parseLuaChunkWithRecovery(source, 'syntax.lua');
	const left = buildLuaFileSemanticData(source, 'left.lua', parsed);
	const right = buildLuaFileSemanticData(source, 'right.lua', parsed);
	assert.strictEqual(left.chunk, right.chunk);
	assert.equal(left.scopes.length, right.scopes.length);
	for (let index = 0; index < left.scopes.length; index++) {
		assert.notEqual(left.scopes[index].id, right.scopes[index].id);
		assert.equal(right.scopesById.has(left.scopes[index].id), false);
	}
	for (const flow of left.functionValueFlows) assert.equal(right.scopesById.has(flow.id), false);
});
