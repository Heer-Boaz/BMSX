import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { RuntimeResource } from '../../ide/common/resource';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { createLuaTableFieldIntegerEdits } from '../../ide/language/lua/source_edits';
import { buildSceneSourceDocument } from '../../ide/workbench/contrib/scene_editor/source';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';

function luaResource(path: string): RuntimeResource {
	return {
		domain: 0,
		path,
		source: {
			resid: path,
			type: 'lua',
			source_path: path,
			generated: false,
		},
	};
}

test('scene source adapter projects the real Nemesis root without executing Lua', () => {
	const path = 'carts/nemesis_s/scenes/root.lua';
	const source = readFileSync(path, 'utf8');
	const document = buildSceneSourceDocument(
		{ domain: 0, path },
		buildLuaFileSemanticData(source, path),
	);

	assert.equal(document.scenes.length, 1);
	const scene = document.scenes[0];
	assert.equal(scene.resolution, 'complete');
	assert.equal(scene.id.kind, LuaSyntaxKind.MemberExpression);
	assert.equal(scene.objects.length, 4);
	assert.deepEqual(
		scene.objects.map(object => object.kind === 'object' ? object.memberId.range.start.line : -1),
		[15, 23, 31, 39],
	);
	assert.deepEqual(
		scene.objects.map(object => object.kind === 'object' ? object.position!.x.range.start.line : -1),
		[19, 27, 35, 43],
	);
	assert.ok(scene.objects.every(object => object.kind === 'object'
		&& object.position!.x.value.kind === LuaSyntaxKind.NumericLiteralExpression
		&& object.position!.y.value.kind === LuaSyntaxKind.NumericLiteralExpression
		&& object.position!.z.value.kind === LuaSyntaxKind.NumericLiteralExpression));
});

test('scene position edit changes the canonical Nemesis source through its text model', () => {
	const path = 'carts/nemesis_s/scenes/root.lua';
	const source = readFileSync(path, 'utf8');
	const model = new EditorTextModel(luaResource(path), 'lua', source);
	const document = buildSceneSourceDocument(
		{ domain: 0, path },
		buildLuaFileSemanticData(source, path),
	);
	const object = document.scenes[0].objects[0];
	assert.equal(object.kind, 'object');
	if (object.kind === 'object') {
		const edits = createLuaTableFieldIntegerEdits(model.buffer, object.position!.x, 65536);
		assert.notEqual(edits, null);
		model.pushEditOperations(edits!);
	}

	const changed = source.replace('pos = { x = 0, y = 0, z = 0 }', 'pos = { x = 65536, y = 0, z = 0 }');
	assert.equal(model.buffer.getText(), changed);
	const reparsed = buildSceneSourceDocument(
		{ domain: 0, path },
		buildLuaFileSemanticData(changed, path),
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

test('scene source adapter accepts only direct definitions through immutable module bindings', () => {
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
		{ domain: 1, path: 'scene.lua' },
		buildLuaFileSemanticData(source, 'scene.lua'),
	);

	assert.equal(document.scenes.length, 1);
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
