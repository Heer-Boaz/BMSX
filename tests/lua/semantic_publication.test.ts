import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLuaFileSemanticData, LuaSemanticWorkspace, type FileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';

function writtenFiles(workspace: LuaSemanticWorkspace, reader: FileSemanticData): string[] {
	const query = workspace.getSnapshot().symbolResolver.writtenSources;
	const returned = reader.chunk.body[0];
	assert.ok(returned.kind === LuaSyntaxKind.ReturnStatement);
	return query.trace(query.expression(reader, returned.expressions[0])).terminals.map(source => source.file.file);
}

test('publication retains declaration lookup and unread global lists across replacements and removal', () => {
	const workspace = new LuaSemanticWorkspace();
	const first = buildLuaFileSemanticData('shared = { old = 1 }; local hidden = 2', 'first.lua');
	const second = buildLuaFileSemanticData('shared = { second = 3 }', 'second.lua');
	workspace.updateFiles([first, second]);
	const old = workspace.getSnapshot();
	const updated = buildLuaFileSemanticData('shared = { updated = 4 }', 'first.lua');
	workspace.updateFiles([updated], ['second.lua']);
	workspace.updateFile('third.lua', 'added = 5');
	const current = workspace.getSnapshot();
	for (const decl of first.decls) assert.equal(old.symbolResolver.getDeclaration(decl.id), decl);
	for (const decl of second.decls) {
		assert.equal(old.symbolResolver.getDeclaration(decl.id), decl);
		assert.equal(current.symbolResolver.getDeclaration(decl.id), undefined);
	}
	assert.deepEqual(old.listGlobalDecls(), [...first.globalDecls, ...second.globalDecls], 'first lazy read uses old files, not the live index');
	assert.equal(old.listGlobalDecls(), old.listGlobalDecls());
	assert.deepEqual(current.listGlobalDecls(), current.files.flatMap(file => file.decls.filter(decl => decl.isGlobal)));
	assert.equal(current.symbolResolver.getDeclaration(updated.decls[0].id), updated.decls[0]);
});

test('navigation precedence and written-source insertion order remain distinct after publication', () => {
	const workspace = new LuaSemanticWorkspace();
	const first = buildLuaFileSemanticData('shared = { first = 1 }', 'first.lua');
	const second = buildLuaFileSemanticData('shared = { second = 2 }', 'second.lua');
	const reader = buildLuaFileSemanticData('return shared', 'reader.lua');
	workspace.updateFiles([first, second, reader]);
	const targets = () => workspace.getSnapshot().symbolResolver.resolveReferenceTargets(reader.refs[0]);
	assert.deepEqual(targets(), [first.decls[0].id]);
	assert.deepEqual(writtenFiles(workspace, reader), ['first.lua', 'second.lua']);
	const edited = buildLuaFileSemanticData('shared = { edited = 3 }', 'first.lua');
	workspace.updateFiles([edited]);
	assert.deepEqual(targets(), [edited.decls[0].id], 'editing does not change navigation precedence');
	assert.deepEqual(writtenFiles(workspace, reader), ['second.lua', 'first.lua'], 'written contributions preserve the previous Map insertion order');
	assert.deepEqual(workspace.getSnapshot().listGlobalDecls(), [...edited.globalDecls, ...second.globalDecls]);
	workspace.updateFiles([], ['first.lua']);
	workspace.updateFiles([first]);
	assert.deepEqual(targets(), [second.decls[0].id], 'delete/readd establishes a new file precedence');
	assert.deepEqual(writtenFiles(workspace, reader), ['second.lua', 'first.lua']);
});

test('two replacements in one batch publish the final facts without retaining intermediate symbols', () => {
	const workspace = new LuaSemanticWorkspace();
	const first = buildLuaFileSemanticData('first = 1', 'batch.lua');
	const second = buildLuaFileSemanticData('second = 2', 'batch.lua');
	workspace.updateFiles([first, second]);
	const snapshot = workspace.getSnapshot();
	assert.equal(snapshot.getFileData('batch.lua'), second);
	assert.equal(snapshot.symbolResolver.getDeclaration(first.decls[0].id), undefined);
	assert.equal(snapshot.symbolResolver.getDeclaration(second.decls[0].id), second.decls[0]);
	assert.deepEqual(snapshot.listGlobalDecls(), second.globalDecls);
});


test('global contributions preserve duplicate declarations while storage and lookup use the last same-ID value', () => {
	const source = 'bss counter: word';
	const parsed = parseLuaChunk(source, 'duplicate.lua');
	// One owned syntax occurrence can be supplied more than once by a compiler
	// input. The binder's declaration list and symbol lookup have different
	// multiplicity contracts even in this representable case.
	const chunk = { ...parsed.chunk, body: [parsed.chunk.body[0], parsed.chunk.body[0]] };
	const file = buildLuaFileSemanticData(source, 'duplicate.lua', undefined, chunk);
	assert.equal(file.decls.length, 2);
	assert.equal(file.decls[0].id, file.decls[1].id);
	assert.deepEqual(file.globalDecls, file.decls);
	assert.deepEqual(file.globalStorageDecls, [file.decls[1]]);
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles([file]);
	const snapshot = workspace.getSnapshot();
	assert.deepEqual(snapshot.listGlobalDecls(), file.decls);
	assert.equal(snapshot.symbolResolver.getDeclaration(file.decls[0].id), file.decls[1]);
	workspace.updateFiles([], [file.file]);
	assert.equal(workspace.getSnapshot().symbolResolver.getDeclaration(file.decls[0].id), undefined);
	assert.equal(snapshot.symbolResolver.getDeclaration(file.decls[0].id), file.decls[1]);
});

test('same-file global navigation retains its lexical symbol-ID tie break', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = '\nbss counter: word' + '\n'.repeat(8) + 'bss counter: word';
	const file = buildLuaFileSemanticData(source, 'order.lua');
	const reader = buildLuaFileSemanticData('return counter', 'reader.lua');
	workspace.updateFiles([file, reader]);
	const winner = file.globalDecls.map(decl => decl.id).sort()[0];
	assert.deepEqual(workspace.getSnapshot().symbolResolver.resolveReferenceTargets(reader.refs[0]), [winner]);
	assert.deepEqual(workspace.getSnapshot().listGlobalDecls(), file.globalDecls);
});

test('publication and lazy global enumeration do not inspect unchanged declaration arrays', () => {
	for (const fileCount of [1, 100]) {
		let reads = 0;
		const files: FileSemanticData[] = [];
		for (let index = 0; index < fileCount; index++) {
			const bound = buildLuaFileSemanticData('local value = 1; shared = value', `file_${index}.lua`);
			files.push({ ...bound, get decls() { reads++; return bound.decls; } });
		}
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFiles(files);
		const old = workspace.getSnapshot();
		reads = 0;
		workspace.updateFile('edited.lua', 'changed = 3');
		workspace.getSnapshot().listGlobalDecls();
		old.listGlobalDecls();
		assert.equal(reads, 0, `${fileCount} unchanged file arrays are not flattened or rescanned`);
	}
});
