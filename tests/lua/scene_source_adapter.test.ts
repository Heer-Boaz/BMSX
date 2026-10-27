import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { buildResourceLuaSemanticFixtureFile, createResourceModuleProjectFixture } from '../helpers/lua_semantic_project';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { resourceIdentityKeyFromParts, type RuntimeResource } from '../../ide/common/resource';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaTableFieldNumberEdits, createLuaTableFieldRemovalEdits, readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { createLuaTableFieldMoveEdits } from '../../ide/language/lua/table_field_moves';
import { buildSceneSourceDocument, hasSceneSourceDefinitions } from '../../ide/workbench/contrib/scene_editor/source';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { buildLuaSemanticWorkspaceSnapshot, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';

function luaResource(path: string): RuntimeResource {
	return { contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace' as const, path },
		contextId: TEST_CARTRIDGE_CONTEXT_IDS[0],
		path,
		source: {
			resid: path,
			type: 'lua',
			source_path: path,
			generated: false,
		},
	};
}

test('scene discovery and projection share unchanged member-alias admission', () => {
	const source = `local scenes = require('cartlib/world/scene_library')
local publish = scenes['register']
publish('room', { objects = {} })
`;
	const path = 'room.lua';
	const analysis = buildResourceLuaSemanticFixtureFile(source, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path });
	assert.equal(hasSceneSourceDefinitions({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path }, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([analysis], ['cartlib/world/scene_library']))), true);
	const document = buildSceneSourceDocument({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path }, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([analysis], ['cartlib/world/scene_library'])));
	assert.deepEqual(document.scenes.map(scene => scene.id.kind), [LuaSyntaxKind.StringLiteralExpression]);
	const changed = buildResourceLuaSemanticFixtureFile(source + '\nlocal function replace() scenes = replacement end', { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path });
	assert.equal(hasSceneSourceDefinitions({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path }, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([changed], ['cartlib/world/scene_library']))), false);
	assert.equal(buildSceneSourceDocument({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path }, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([changed], ['cartlib/world/scene_library']))).scenes.length, 0);
});

test('scene projection follows API providers but retains unchanged content across workspace generations', () => {
	const resource = { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'room.lua' } as const;
	const source = `local publish = require('bridge')
publish('room', { objects = { { member_id = 'hero', definition_id = 'player' } } })
publish('other', { objects = {} })`;
	const main = buildResourceLuaSemanticFixtureFile(source, resource);
	const bridge = "return require('cartlib/world/scene_library').register";
	const [files, bindings] = createResourceModuleProjectFixture([main,
		buildResourceLuaSemanticFixtureFile(bridge, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'bridge.lua' }),
		buildResourceLuaSemanticFixtureFile('return false', { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'unrelated.lua' }),
	], ['cartlib/world/scene_library']);
	const workspace = new LuaSemanticWorkspace(bindings);
	workspace.updateFiles(files.map(file => file.analysis!));
	let snapshot = workspace.getSnapshot();
	assert.equal(hasSceneSourceDefinitions(resource, snapshot), true);
	const document = buildSceneSourceDocument(resource, snapshot);
	assert.equal(document.scenes.length, 2);
	workspace.updateFiles([buildResourceLuaSemanticFixtureFile('return {}', { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'unrelated.lua' })]);
	snapshot = workspace.getSnapshot();
	assert.equal(buildSceneSourceDocument(resource, snapshot, document), document, 'no false projection change to reset an active draft');
	workspace.updateFiles([buildResourceLuaSemanticFixtureFile('-- annotation\n' + bridge, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'bridge.lua' })]);
	assert.equal(buildSceneSourceDocument(resource, workspace.getSnapshot(), document), document, 'equivalent provider edit retains projection');
	workspace.updateFiles([buildResourceLuaSemanticFixtureFile('return replacement', { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'bridge.lua' })]);
	snapshot = workspace.getSnapshot();
	assert.equal(hasSceneSourceDefinitions(resource, snapshot), false);
	const revoked = buildSceneSourceDocument(resource, snapshot, document);
	assert.equal(revoked.scenes.length, 0);
	assert.equal(revoked.analysis, main, 'revocation does not require rebinding the consumer');
	workspace.updateFiles([buildResourceLuaSemanticFixtureFile(bridge, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'bridge.lua' })]);
	const restored = buildSceneSourceDocument(resource, workspace.getSnapshot(), revoked);
	assert.equal(restored.scenes.length, 2);
	assert.equal(restored.scenes[0].range, document.scenes[0].range);
	workspace.updateFiles([buildResourceLuaSemanticFixtureFile('-- moved\n' + source, resource)]);
	const moved = buildSceneSourceDocument(resource, workspace.getSnapshot(), restored);
	assert.notEqual(moved, restored);
	assert.equal(moved.scenes[0].range.start.line, restored.scenes[0].range.start.line + 1);
});

test('scene source adapter projects the real Nemesis root without executing Lua', () => {
	const path = 'carts/nemesis_s/scenes/root.lua';
	const source = readFileSync(path, 'utf8');
	const document = buildSceneSourceDocument(
		{ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path },
		buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path })], ['cartlib/world/scene_library'])),
	);

	assert.equal(document.scenes.length, 1);
	const scene = document.scenes[0];
	assert.equal(scene.resolution, 'complete');
	assert.equal(scene.id.kind, LuaSyntaxKind.MemberExpression);
	assert.equal(scene.objects.length, 4);
	assert.deepEqual(scene.objects.map(object => object.field), scene.objectsTable.fields,
		'a complete projection retains the actual ordered parent fields');
	assert.deepEqual(
		scene.objects.map(object => object.kind === 'object' ? document.analysis.chunk.locations.range(object.memberId.span).start.line : -1),
		[15, 24, 33, 42],
	);
	assert.deepEqual(
		scene.objects.map(object => object.kind === 'object' ? document.analysis.chunk.locations.range(object.position!.x.span).start.line : -1),
		[20, 29, 38, 47],
	);
	assert.ok(scene.objects.every(object => object.kind === 'object'
		&& object.position!.x.value.kind === LuaSyntaxKind.NumericLiteralExpression
		&& object.position!.y.value.kind === LuaSyntaxKind.NumericLiteralExpression
		&& object.position!.z.value.kind === LuaSyntaxKind.NumericLiteralExpression));
});

test('scene projection retains empty and keyed-only definitions as distinct source roots', () => {
	const source = "local scenes<const> = require('cartlib/world/scene_library')\n"
		+ "scenes.register('same', { objects = {} })\n"
		+ "scenes.register('same', { objects = { [1] = make_member() } })\n"
		+ "scenes.register('same', { objects = { make_member() } })";
	const document = buildSceneSourceDocument({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'scene.lua' }, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'scene.lua' })], ['cartlib/world/scene_library'])));
	assert.equal(document.scenes.length, 3);
	assert.deepEqual(document.scenes.map(scene => scene.objects.length), [0, 0, 1]);
	assert.deepEqual(document.scenes.map(scene => scene.resolution), ['complete', 'partial', 'partial']);
	assert.deepEqual(document.scenes.map(scene => scene.range.start.line), [2, 3, 4]);
	assert.equal(document.scenes[2].objects[0].kind, 'dynamic');
});

test('scene member moves use the retained parent table and preserve neighbouring definitions', () => {
	const path = 'scene.lua';
	const first = "\t-- first\n\t{ member_id = 'same', definition_id = 'one' },\n";
	const second = "\t-- second\n\t({ member_id = 'same', definition_id = 'two' });\n";
	const header = "local scenes<const> = require('cartlib/world/scene_library')\nscenes.register('root', { objects = {\n";
	const footer = "} })\nscenes.register('other', { objects = { { member_id = 'same', definition_id = 'three' } } })";
	const source = header + first + second + footer;
	const model = new EditorTextModel(luaResource(path), 'lua', source);
	const document = buildSceneSourceDocument(model.resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path })], ['cartlib/world/scene_library'])));
	assert.equal(document.scenes.length, 2);
	assert.equal(document.scenes[0].resolution, 'complete');
	assert.equal(document.scenes[1].objects.length, 1);
	model.pushEditOperations(createLuaTableFieldMoveEdits(model.buffer, document.analysis.chunk, document.scenes[0].objectsTable, 1, 0));
	assert.equal(model.buffer.getText(), header + second + first + footer);
	const moved = buildSceneSourceDocument(model.resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(model.buffer.getText(), { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path })], ['cartlib/world/scene_library'])));
	assert.deepEqual(moved.scenes.map(scene => scene.objects.map(object =>
		object.kind === 'object' ? readLuaSourceRange(model.buffer, moved.analysis.chunk.locations.range(object.definitionId.span)) : 'dynamic',
	)), [["'two'", "'one'"], ["'three'"]]);
	model.undo();
	assert.equal(model.buffer.getText(), source);
});

test('scene position edit changes the canonical Nemesis source through its text model', () => {
	const path = 'carts/nemesis_s/scenes/root.lua';
	const source = readFileSync(path, 'utf8');
	const model = new EditorTextModel(luaResource(path), 'lua', source);
	const document = buildSceneSourceDocument(
		{ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path },
		buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path })], ['cartlib/world/scene_library'])),
	);
	const object = document.scenes[0].objects[0];
	assert.equal(object.kind, 'object');
	if (object.kind === 'object') {
		const edits = createLuaTableFieldNumberEdits(model.buffer, document.analysis.chunk.locations, object.position!.x, 65536);
		assert.notEqual(edits, null);
		model.pushEditOperations(edits!);
	}

	const changed = source.replace('pos = { x = 0, y = 0, z = 0 }', 'pos = { x = 65536, y = 0, z = 0 }');
	assert.equal(model.buffer.getText(), changed);
	const reparsed = buildSceneSourceDocument(
		{ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path },
		buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(changed, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path })], ['cartlib/world/scene_library'])),
	);
	const reparsedObject = reparsed.scenes[0].objects[0];
	assert.equal(reparsedObject.kind, 'object');
	if (reparsedObject.kind === 'object') {
		assert.equal(reparsedObject.position!.x.value.kind, LuaSyntaxKind.NumericLiteralExpression);
		if (reparsedObject.position!.x.value.kind === LuaSyntaxKind.NumericLiteralExpression) {
			assert.equal(reparsedObject.position.x.value.value, 65536);
		}
	}
	model.undo();
	assert.equal(model.buffer.getText(), source);
});

test('scene source adapter accepts direct definitions through unchanged local module bindings', () => {
	const source = [
		"local scenes<const> = require('cartlib/world/scene_library')",
		"local mutable = require('cartlib/world/scene_library')",
		"scenes.register('direct', { objects = {",
		"\t{ member_id = 'hero', definition_id = 'player', options = { pos = { x = 1, y = offset, z = -3 } } },",
		'\tbuild_object(),',
		"\t[4] = { member_id = 'hidden', definition_id = 'hidden' },",
		'} })',
		"mutable.register('mutable', { objects = {} })",
		"scenes.register('built', build_scene())",
		'local shadowed<const> = function(scenes)',
		"\tscenes.register('shadowed', { objects = {} })",
		'end',
		'return shadowed',
	].join('\n');
	const document = buildSceneSourceDocument(
		{ contextId: TEST_CARTRIDGE_CONTEXT_IDS[1], path: 'scene.lua' },
		buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[1], path: 'scene.lua' })], ['cartlib/world/scene_library'])),
	);

	assert.equal(document.scenes.length, 2);
	assert.equal(document.scenes[0].resolution, 'partial');
	assert.equal(document.scenes[0].objects.length, 2);
	const object = document.scenes[0].objects[0];
	assert.equal(object.kind, 'object');
	if (object.kind === 'object') {
		assert.equal(object.position!.x.value.kind, LuaSyntaxKind.NumericLiteralExpression);
		assert.equal(object.position!.y.value.kind, LuaSyntaxKind.IdentifierExpression);
		assert.equal(object.position!.z.value.kind, LuaSyntaxKind.UnaryExpression);
	}
	assert.equal(document.scenes[0].objects[1].kind, 'dynamic');
});

test('scene members retain complete parser fields for source-only removal and document history', () => {
	const path = 'scene.lua';
	const member = "(( --[[inside]] { member_id = 'hero', definition_id = 'player' }))";
	const source = "local scenes<const> = require('cartlib/world/scene_library')\n"
		+ "scenes.register('root', { objects = {\n\t-- before\n\t" + member
		+ " -- exterior , ;\n\t; -- after\n\tbuild_object(),\n} })";
	const model = new EditorTextModel(luaResource(path), 'lua', source);
	const parsed = parseLuaChunkWithRecovery(source, resourceIdentityKeyFromParts(TEST_CARTRIDGE_CONTEXT_IDS[0], path));
	const document = buildSceneSourceDocument(model.resource, buildLuaSemanticWorkspaceSnapshot(...createResourceModuleProjectFixture([buildResourceLuaSemanticFixtureFile(source, { contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path }, parsed)], ['cartlib/world/scene_library'])));
	const [direct, dynamic] = document.scenes[0].objects;
	assert.equal(direct.kind, 'object');
	assert.equal(readLuaSourceRange(model.buffer, document.analysis.chunk.locations.range(direct.field.span)), member);
	assert.equal(dynamic.kind, 'dynamic');
	assert.equal(readLuaSourceRange(model.buffer, document.analysis.chunk.locations.range(dynamic.field.span)), 'build_object()');
	assert.equal(document.scenes[0].resolution, 'partial');
	model.pushEditOperations(createLuaTableFieldRemovalEdits(model.buffer, parsed.chunk.locations, parsed.tokens, direct.field));
	const removed = source.replace(member, '').replace('\t; -- after', '\t -- after');
	assert.equal(model.buffer.getText(), removed);
	assert.equal(parseLuaChunkWithRecovery(removed, path).syntaxError, null);
	model.undo();
	assert.equal(model.buffer.getText(), source);
	model.redo();
	assert.equal(model.buffer.getText(), removed);
});
