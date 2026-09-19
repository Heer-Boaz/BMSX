import { luaSyntaxSnapshot } from '../helpers/lua_syntax_snapshot';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
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
			kind: scope.kind, start: scope.startInclusive, end: scope.endExclusive,
			parent: scope.parentIndex, declarations: scope.declarationIndices,
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
