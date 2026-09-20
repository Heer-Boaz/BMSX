import { luaSyntaxSnapshot } from '../helpers/lua_syntax_snapshot';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';
import {
	buildLuaFileSemanticData,
	buildLuaSemanticWorkspaceSnapshot,
	LuaSemanticWorkspace,
	type LuaSemanticWorkspaceSnapshot,
} from '../../toolchain/ts/lua/semantic/model';

const path = 'edit.lua';
const original = [
	'local base<const> = {}',
	'function base:run() end',
	'local item<const> = setmetatable({}, { __index = base })',
	'local function invoke()',
	'\titem:run()',
	'end',
	'invoke()',
	'return item',
].join('\n');

// Compare public answers rather than cross-generation identity. Future stable
// symbol IDs need not match a separately constructed workspace's IDs.
function answers(snapshot: LuaSemanticWorkspaceSnapshot) {
	const resolver = snapshot.symbolResolver;
	return snapshot.files.map(file => ({
		file: file.file,
		scopes: file.scopes.map(scope => ({
			kind: scope.kind,
			start: file.chunk.locations.position(scope.startInclusive.unit, scope.startInclusive.offset),
			end: file.chunk.locations.position(scope.endExclusive.unit, scope.endExclusive.offset),
			parent: scope.parentIndex, declarations: scope.declarationIndices,
		})),
		declarations: file.decls.map(decl => ({
			name: decl.namePath, range: decl.range,
			visibleFrom: file.chunk.locations.position(decl.visibleFrom.unit, decl.visibleFrom.offset),
		})),
		refs: file.refs.map(ref => ({
			name: ref.name,
			range: ref.range,
			targets: resolver.resolveReferenceTargets(ref).map(id => {
				const decl = resolver.getDeclaration(id);
				return { file: decl.file, name: decl.namePath, range: decl.range, signature: decl.signature };
			}),
		})),
	}));
}

test('binding consumes the supplied syntax generation independently of other documents', () => {
	const cached = buildLuaFileSemanticData(original, path);
	const parsed = parseLuaChunkWithRecovery(original, path);
	const explicit = buildLuaFileSemanticData(original, path, parsed);
	assert.notEqual(parsed.chunk, cached.chunk);
	assert.equal(explicit.chunk, parsed.chunk);
	for (const syntax of explicit.referencesBySyntax.keys()) {
		assert.equal(cached.referencesBySyntax.has(syntax), false);
	}
});

test('workspace construction retains an explicitly supplied parse generation', () => {
	const cached = buildLuaFileSemanticData(original, path);
	const parsed = parseLuaChunkWithRecovery(original, path);
	const snapshot = buildLuaSemanticWorkspaceSnapshot([{ path, source: original, parsed }]);
	assert.notEqual(parsed.chunk, cached.chunk);
	assert.equal(snapshot.getFileData(path)!.chunk, parsed.chunk);
	assert.notEqual(buildLuaFileSemanticData(original, path).chunk, parsed.chunk,
		'an independent source load cannot borrow another document owner');
});

test('workspace updates publish explicit generations even when source text is equal', () => {
	const workspace = new LuaSemanticWorkspace();
	const first = workspace.updateFile(path, original);
	const old = workspace.getSnapshot();
	const parsed = parseLuaChunkWithRecovery(original, path);
	const second = workspace.updateFile(path, original, parsed);
	assert.equal(second.chunk, parsed.chunk);
	assert.notEqual(first, second);
	assert.equal(workspace.getSnapshot().getFileData(path), second);
	assert.equal(old.getFileData(path), first);
	const third = buildLuaFileSemanticData(original, path);
	workspace.updateFiles([third]);
	const updated = workspace.getSnapshot();
	assert.equal(updated.getFileData(path), third);
	for (const [node, id] of third.declarationIdsBySyntax) {
		assert.equal(updated.symbolResolver.getDeclaration(id), third.decls.find(decl => decl.id === id));
		assert.equal(first.declarationIdsBySyntax.has(node), false);
	}
	workspace.updateFiles([third]);
	assert.equal(workspace.getSnapshot(), updated, 'republishing the same facts is a no-op');
	assert.equal(workspace.updateFile(path, original), third, 'text-only reads retain the generation');
});

const edits = [
	['insert line at start', '\n' + original],
	['insert within function', original.replace('\titem:run()', '\tlocal value = 1\n\titem:run()')],
	['change columns', original.replace('\titem:run()', '\t  item:run()')],
	['shadow captured local', original.replace('local function invoke()', 'local item<const> = {}\nlocal function invoke()')],
	['change prototype', original.replace('__index = base', '__index = {}')],
	['incomplete member', original.replace('item:run()', 'item:')],
	['missing function end', original.replace('\nend\ninvoke()', '\ninvoke()')],
	['long comment across statements', '--[=[\n' + original + '\n]=]'],
	['unterminated long comment', '--[=[\n' + original],
	['unterminated string', original.replace('local base<const> = {}', "local base<const> = 'open")],
	['CRLF', original.replaceAll('\n', '\r\n')],
	['non-ASCII trivia', '-- café 😀\n' + original],
] as const;

for (const [name, edited] of edits) {
	test(`workspace edit matches fresh parse/bind and preserves old snapshots: ${name}`, () => {
		const workspace = new LuaSemanticWorkspace();
		workspace.updateFile(path, original);
		workspace.updateFile('consumer.lua', "local item<const> = require('edit')\nitem:run()");
		const retained = workspace.getSnapshot();
		const retainedTree = luaSyntaxSnapshot(retained.getFileData(path)!.chunk);
		const retainedAnswers = answers(retained);
		const consumer = retained.getFileData('consumer.lua');

		for (const source of [edited, original]) { // Edit, then undo/repair.
			const updated = workspace.updateFile(path, source);
			const parsed = parseLuaChunkWithRecovery(source, path);
			const fresh = buildLuaFileSemanticData(source, path, parsed);
			assert.deepEqual(luaSyntaxSnapshot(updated.chunk), luaSyntaxSnapshot(parsed.chunk));
			assert.deepEqual(updated.syntaxError, parsed.syntaxError);
			assert.deepEqual(updated.annotations, fresh.annotations);
			const cold = new LuaSemanticWorkspace();
			cold.updateFiles([fresh, buildLuaFileSemanticData(consumer!.source, consumer!.file,
				parseLuaChunkWithRecovery(consumer!.source, consumer!.file))]);
			assert.deepEqual(answers(workspace.getSnapshot()), answers(cold.getSnapshot()));
			assert.equal(workspace.getFileData('consumer.lua'), consumer);
			assert.deepEqual(luaSyntaxSnapshot(retained.getFileData(path)!.chunk), retainedTree);
			assert.deepEqual(answers(retained), retainedAnswers);
		}
	});
}

test('public workspace edit maps retain lexical islands and match fresh binding through repair and undo', () => {
	const workspace = new LuaSemanticWorkspace();
	let source = original + '\n-- retained suffix\n'.repeat(80);
	const initial = workspace.updateFile(path, source);
	const retained = workspace.getSnapshot();
	const retainedAnswers = answers(retained);
	const edits = [
		{ offset: 0, deletedLength: 0, inserted: '-- café 😀\r\n' },
		{ offset: 0, deletedLength: 0, inserted: '--[=[' },
		{ offset: 0, deletedLength: 5, inserted: '' },
		{ offset: 0, deletedLength: 0, inserted: '\n' },
		{ offset: 0, deletedLength: 1, inserted: '' },
	];
	for (const [index, edit] of edits.entries()) {
		const previous = workspace.getFileData(path)!;
		const changes = SourceChangeMap.unchanged(source.length).append([
			{ offset: edit.offset, deletedLength: edit.deletedLength, insertedLength: edit.inserted.length },
		]);
		source = source.slice(0, edit.offset) + edit.inserted + source.slice(edit.offset + edit.deletedLength);
		const updated = workspace.updateFile(path, source, changes);
		const coldWorkspace = new LuaSemanticWorkspace();
		coldWorkspace.updateFile(path, source);
		const cold = coldWorkspace.getSnapshot();
		assert.deepEqual(luaSyntaxSnapshot(updated.chunk), luaSyntaxSnapshot(cold.getFileData(path)!.chunk));
		assert.deepEqual(answers(workspace.getSnapshot()), answers(cold));
		assert.deepEqual(answers(retained), retainedAnswers);
		if (index === 0) {
			assert.strictEqual(updated.chunk.tokens.get(updated.chunk.tokens.length - 1),
				previous.chunk.tokens.get(previous.chunk.tokens.length - 1));
		}
	}
	assert.strictEqual(retained.getFileData(path), initial);
	const current = workspace.getSnapshot();
	workspace.updateFile(path, source, SourceChangeMap.unchanged(source.length));
	assert.strictEqual(workspace.getSnapshot(), current);
	const parsed = parseLuaChunkWithRecovery(source, path);
	assert.strictEqual(workspace.updateFile(path, source, parsed).chunk, parsed.chunk,
		'supplied syntax remains authoritative after incremental updates');
});
