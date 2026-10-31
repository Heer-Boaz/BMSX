import assert from 'node:assert/strict';
import test from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneDetailsProjection } from '../../ide/workbench/contrib/scene_editor/details_projection';
import { SceneDetailsViewState } from '../../ide/workbench/contrib/scene_editor/details_view';
import { SceneDetailsControl } from '../../ide/workbench/contrib/scene_editor/details_control';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { parseLuaNumberInput } from '../../ide/language/lua/source_edits';
import { readLuaNumberLiteral, readLuaNumberExpression } from '../../toolchain/ts/lua/syntax/number_expression';
import { SceneMemberRemovalProjection } from '../../ide/workbench/contrib/scene_editor/member_removal';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('fixture', { objects = {
 { member_id = 'child', definition_id = 'sprite',
   spatial = { parent_id = 'parent', local_transform = { -1, 0.5, 2, 1, 12.25, -3.5 } },
   initial = { base_sprite = { imgid = 'image', order = 5 } }, options = { health = 7 } },
 { member_id = 'parent', definition_id = 'mesh',
   spatial = { local_transform = { 1, 0, 0, 0.5, 1, 0, 0, 0, -2, 30, 40, 50 } } },
 { member_id = 'built', definition_id = 'sprite', spatial = { local_transform = build_pose() } },
 { member_id = 'controller', definition_id = 'controller' },
} })`;

test('Scene source retains full 2D/3D affines, authored parents and component inputs without evaluating Lua', t => {
	const f = createSceneSourceFixture(t, SOURCE), document = f.documents.get(f.model), scene = document.scenes[0];
	const authoring = new SceneAuthoringContext(f.model, f.documents), projection = new SceneDetailsProjection(authoring);
	t.after(() => authoring.dispose());
	const child = scene.objects[0]; assert.ok(child.kind === 'object' && child.spatial !== null);
	assert.equal(child.spatial.coefficients!.length, 6);
	assert.deepEqual(child.spatial.origin.map(field => readLuaNumberLiteral(field.value)), [12.25, -3.5]);
	assert.ok(child.spatial.parentId !== null && child.initial !== null);
	authoring.select(document, f.model.version, { kind: 'member', scene, entry: child, index: 0 }); projection.refresh();
	assert.deepEqual(projection.subject!.properties.map(property => [property.axis, property.value]), [['x', 12.25], ['y', -3.5]]);
	const fields = projection.subject!.optionProperties;
	assert.ok(fields.some(property => property.field === child.spatial!.parentId));
	assert.equal(fields.filter(property => child.spatial!.coefficients!.includes(property.field)).length, 4,
		'local origin is not duplicated in the generic authored-property lane');
	assert.ok(fields.some(property => property.label === 'initial.base_sprite.order' && property.sourceText === '5'));
	const parent = scene.objects[1]; assert.ok(parent.kind === 'object' && parent.spatial !== null);
	assert.equal(parent.spatial.coefficients!.length, 12);
	authoring.select(document, f.model.version, { kind: 'member', scene, entry: parent, index: 1 }); projection.refresh();
	assert.deepEqual(projection.subject!.properties.map(property => property.value), [30, 40, 50]);
	for (const index of [2, 3]) {
		authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[index], index }); projection.refresh();
		assert.equal(projection.subject!.properties.length, 0, 'computed or absent affines never invent editable coordinates');
	}
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
});

test('local-origin input accepts fractional Lua Numbers and preserves the basis, parent and canonical document Undo', t => {
	configureFontVariant('tiny');
	const f = createSceneSourceFixture(t, SOURCE), document = f.documents.get(f.model), scene = document.scenes[0];
	const authoring = new SceneAuthoringContext(f.model, f.documents), view = new SceneDetailsViewState(authoring);
	const scope = new InputFocusScope(Symbol('spatial source'), inputFocus.workbenchScope), parent = inputFocus.createTarget(null, scope);
	const bounds = { left: 0, top: 0, right: 320, bottom: 160 }, menu = new ContextMenuController(inputFocus, pointerCapture, bounds);
	const command = { isEnabled: () => true, run: () => {} };
	const control = new SceneDetailsControl({
		isEnabled: (id, target) => inputFocus.getCommand(id, target)?.isEnabled() === true,
		execute: (id, target) => inputFocus.executeCommand(id, target),
	}, menu, scope, parent, { outline: command, details: command });
	t.after(() => { control.dispose(); view.dispose(); authoring.dispose(); menu.dispose(); inputFocus.setTarget(null); });
	authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	control.setView(view, bounds);
	const field = control.controls[0]; setFieldText(field.field, '-1.25e2', true);
	assert.equal(field.commit(), true);
	assert.equal(f.model.buffer.getText(), SOURCE.replace('12.25, -3.5', '-125, -3.5'));
	f.model.undo(); control.update();
	assert.equal(f.model.buffer.getText(), SOURCE);
	assert.equal(control.controls[2].field.readOnly, true, 'a 2D declaration does not admit a fabricated Z edit');
});

test('numeric entry uses Lua literal syntax, not executable expressions or host integer coercion', () => {
	for (const [text, value] of [['0x100', 256], ['-0.125', -0.125], ['1.25e2', 125]] as const) {
		assert.deepEqual(parseLuaNumberInput(text), { value });
	}
	for (const text of ['1 / 2', 'compute()', '1, 2', '-', '1e1000']) assert.ok('error' in parseLuaNumberInput(text));
});

test('Delete Member preserves all direct 2D children and untouched source in one document Undo', t => {
	const source = `local scenes = require('cartlib/world/scene_library')
scenes.register('fixture', { objects = {
 -- child documentation stays
 { member_id = 'child', definition_id = 'sprite', spatial = {
   parent_id = 'obsolete', -- old relationship comment stays
   parent_id = 'parent', -- current relationship comment stays
   local_transform = { 1, 0, 2, -1, 6, 7 }, -- affine comment stays
 }, options = { team = 'blue' } },
 { member_id = 'ancestor', definition_id = 'sprite', spatial = { local_transform = { 2, 0, 1, 3, 10, 20 } } },
 { member_id = 'parent', definition_id = 'sprite', spatial = { parent_id = 'ancestor', local_transform = { 0, 1, -1, 0, 4, 5 } } },
 { member_id = 'sibling', definition_id = 'sprite', spatial = { parent_id = 'parent', local_transform = { 1, 0, 0, 1, 1, 2 } } },
 { member_id = 'leaf', definition_id = 'sprite', spatial = { parent_id = 'child', local_transform = { 1, 0, 0, 1, 8, 9 } } },
 { member_id = 'other', definition_id = 'sprite', spatial = { local_transform = build_pose() } },
} })`;
	const f = createSceneSourceFixture(t, source), authoring = new SceneAuthoringContext(f.model, f.documents);
	t.after(() => authoring.dispose());
	const document = f.documents.get(f.model), scene = document.scenes[0];
	authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[2], index: 2 });
	const projection = t.mock.method(SceneMemberRemovalProjection.prototype, 'edits');
	assert.equal(authoring.canRemoveSelectedMember(), true);
	const edits = projection.mock.calls[0].result;
	for (let index = 0; index < 20; index++) assert.equal(authoring.canRemoveSelectedMember(), true);
	assert.ok(projection.mock.calls.every(call => call.result === edits), 'stable command admission retains its edit batch');
	let changes = 0;
	const unbind = f.model.onDidChangeContent(() => changes++); t.after(unbind);
	assert.equal(authoring.removeSelectedMember(), true);
	assert.equal(changes, 1, 'children and parent publish one complete source generation');
	const changed = f.documents.get(f.model).scenes[0];
	assert.deepEqual(changed.objects.map(entry => entry.kind === 'object' ? stringLiteralValue(entry.memberId) : undefined),
		['child', 'ancestor', 'sibling', 'leaf', 'other']);
	for (const [index, expected] of [[0, [1, 3, 4, 6, 15, 53]], [2, [1, 3, -2, 0, 20, 38]]] as const) {
		const child = changed.objects[index]; assert.ok(child.kind === 'object');
		assert.equal(child.spatial!.parentId, null);
		assert.deepEqual(child.spatial!.coefficients!.map(field => readLuaNumberLiteral(field.value)), expected);
	}
	const text = f.model.buffer.getText();
	assert.ok(text.includes('-- old relationship comment stays') && text.includes('-- current relationship comment stays')
		&& text.includes('-- affine comment stays') && text.includes('-- child documentation stays'));
	for (const untouched of ["options = { team = 'blue' }", "{ member_id = 'leaf', definition_id = 'sprite', spatial = { parent_id = 'child', local_transform = { 1, 0, 0, 1, 8, 9 } } }",
		"{ member_id = 'other', definition_id = 'sprite', spatial = { local_transform = build_pose() } }"])
		assert.ok(text.includes(untouched), 'deletion does not reprint unrelated canonical source');
	f.model.undo(); assert.equal(f.model.buffer.getText(), source);
	f.model.redo(); assert.equal(f.model.buffer.getText(), text);
});

test('Delete Member preserves full 3D shear and singular ancestors without an inverse or TRS round trip', t => {
	const source = `local scenes = require('cartlib/world/scene_library')
scenes.register('fixture', { objects = {
 { member_id = 'child', definition_id = 'mesh', spatial = { parent_id = 'parent', local_transform = { 1, 1, 0, 0, 1, 1, 1, 0, 1, 2, 3, 4 } } },
 { member_id = 'parent', definition_id = 'mesh', spatial = { parent_id = 'ancestor', local_transform = { 1, 0, 0, 0, 0, 0, 0, 0, -1, 4, 5, 6 } } },
 { member_id = 'ancestor', definition_id = 'mesh', spatial = { local_transform = { 2, 0, 0, 1, -1, 0, 0, 1, 3, 10, 20, 30 } } },
} })`;
	const f = createSceneSourceFixture(t, source), authoring = new SceneAuthoringContext(f.model, f.documents);
	t.after(() => authoring.dispose());
	const document = f.documents.get(f.model), scene = document.scenes[0];
	authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 });
	assert.equal(authoring.removeSelectedMember(), true);
	const child = f.documents.get(f.model).scenes[0].objects[0]; assert.ok(child.kind === 'object');
	assert.equal(child.spatial!.parentId, null);
	assert.deepEqual(child.spatial!.coefficients!.map(field => readLuaNumberLiteral(field.value)), [2, 0, 0, 0, -1, -3, 2, -1, -3, 27, 17, 36]);
	f.model.undo(); assert.equal(f.model.buffer.getText(), source);
});

test('Delete Member admits inherited prefab affines at the current dependency generation', t => {
	const prefabSource = `local prefab = require('cartlib/world/prefab')
prefab.define({ def_id = 'parent', class = {}, spatial = { family = '2d', authority = 'affine', local_transform = { 2, 0, 1, 3, 10, 20 } } })
prefab.define({ def_id = 'child', class = {}, spatial = { family = '2d', authority = 'affine' } })`;
	const source = `local scenes = require('cartlib/world/scene_library')
scenes.register('fixture', { objects = {
 { member_id = 'child', definition_id = 'child', spatial = { parent_id = 'parent' } },
 { member_id = 'parent', definition_id = 'parent' },
 { member_id = 'explicit_default', definition_id = 'child', spatial = { parent_id = 'parent', local_transform = nil } },
 { member_id = 'nonspatial', definition_id = 'controller', spatial = nil },
} })`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined,
		[['cartlib/world/prefab.lua', 'return {}'], ['prefabs.lua', prefabSource]]);
	const authoring = new SceneAuthoringContext(f.model, f.documents); t.after(() => authoring.dispose());
	const document = f.documents.get(f.model), scene = document.scenes[0];
	authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 });
	assert.equal(authoring.canRemoveSelectedMember(), true);
	const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!;
	const prefabs = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	prefabs.pushEditOperations([{ offset: prefabSource.indexOf('10, 20'), deleteLength: 6, text: '30, 40' }]);
	assert.equal(authoring.removeSelectedMember(), true);
	const child = f.documents.get(f.model).scenes[0].objects[0]; assert.ok(child.kind === 'object');
	assert.equal(child.spatial!.parentId, null);
	assert.deepEqual(child.spatial!.coefficients!.map(field => readLuaNumberLiteral(field.value)), [2, 0, 1, 3, 30, 40]);
	const explicit = f.documents.get(f.model).scenes[0].objects[1]; assert.ok(explicit.kind === 'object');
	assert.equal(explicit.spatial!.parentId, null);
	assert.deepEqual(explicit.spatial!.coefficients!.map(field => readLuaNumberLiteral(field.value)), [2, 0, 1, 3, 30, 40]);
	assert.equal(prefabs.buffer.getText(), prefabSource.replace('10, 20', '30, 40'), 'Scene deletion does not rewrite its prefab provider');
	f.model.undo(); assert.equal(f.model.buffer.getText(), source);
});

test('Delete Member is unavailable only when the affected pose or relationship cannot be projected', t => {
	for (const [parentPose, childPose] of [['build_pose()', '{ 1, 0, 0, 1, 2, 3 }'], ['{ 1, 0, 0, 1, 2, 3 }', 'build_pose()']] as const) {
		const source = `local scenes = require('cartlib/world/scene_library')
scenes.register('fixture', { objects = {
 { member_id = 'parent', definition_id = 'sprite', spatial = { local_transform = ${parentPose} } },
 { member_id = 'child', definition_id = 'sprite', spatial = { parent_id = 'parent', local_transform = ${childPose} } },
 { member_id = 'other', definition_id = 'sprite', spatial = { local_transform = unknown() } },
} })`;
		const f = createSceneSourceFixture(t, source, `scene${parentPose.startsWith('build') ? 1 : 2}.lua`);
		const authoring = new SceneAuthoringContext(f.model, f.documents); t.after(() => authoring.dispose());
		const document = f.documents.get(f.model), scene = document.scenes[0];
		authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
		assert.equal(authoring.canRemoveSelectedMember(), false);
		assert.equal(authoring.removeSelectedMember(), false);
		assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.dirty, false);
		authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 });
		assert.equal(authoring.canRemoveSelectedMember(), true, 'a leaf needs no pose conversion and unrelated dynamic geometry stays source');
		assert.equal(authoring.removeSelectedMember(), true);
		f.model.undo(); assert.equal(f.model.buffer.getText(), source);
	}
});

test('Delete Member keeps occurrence identity despite duplicate names outside required ancestor chains', t => {
	const source = `local scenes = require('cartlib/world/scene_library')
scenes.register('fixture', { objects = {
 { member_id = 'same', definition_id = 'first' },
 { member_id = 'same', definition_id = 'second' },
 { member_id = 'parent', definition_id = 'sprite', spatial = { local_transform = { 1, 0, 0, 1, 3, 4 } } },
 { member_id = 'child', definition_id = 'sprite', spatial = { parent_id = 'parent', local_transform = { 1, 0, 0, 1, 5, 6 } } },
} })`;
	const f = createSceneSourceFixture(t, source), authoring = new SceneAuthoringContext(f.model, f.documents);
	t.after(() => authoring.dispose());
	let document = f.documents.get(f.model), scene = document.scenes[0];
	authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	assert.equal(authoring.removeSelectedMember(), true);
	assert.ok(f.model.buffer.getText().includes("{ member_id = 'same', definition_id = 'second' }"));
	assert.ok(!f.model.buffer.getText().includes("definition_id = 'first'"));
	f.model.undo(); assert.equal(f.model.buffer.getText(), source);
	document = f.documents.get(f.model); scene = document.scenes[0];
	authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[2], index: 2 });
	assert.equal(authoring.removeSelectedMember(), true, 'unrelated duplicate names do not make this child pose ambiguous');
	const child = f.documents.get(f.model).scenes[0].objects[2]; assert.ok(child.kind === 'object');
	assert.equal(child.spatial!.parentId, null);
	assert.deepEqual(child.spatial!.coefficients!.map(field => readLuaNumberLiteral(field.value)), [1, 0, 0, 1, 8, 10]);
});

test('Delete Member resolves shared written prefab inputs and replaces member aliases without rewriting their providers', t => {
	const source = `local scenes = require('cartlib/world/scene_library')
local ids = require('ids')
local offset = { 1, 0, 0, 1, 2, 3 } -- shared affine stays
local relationship = { parent_id = 'parent', local_transform = offset } -- shared relationship stays
scenes.register('fixture', { objects = {
 { member_id = 'child', definition_id = ids.child, spatial = { parent_id = 'parent', local_transform = offset } },
 { member_id = 'alias', definition_id = ids.child, spatial = relationship },
 { member_id = 'parent', definition_id = ids.parent },
} })`;
	const prefabs = `local prefab = require('cartlib/world/prefab')
local ids = require('ids')
local spatial = { family = '2d', authority = 'affine', local_transform = { 2, 0, 1, 3, 10, 20 } }
prefab.define({ def_id = ids.parent, class = {}, spatial = spatial })
prefab.define({ def_id = ids.child, class = {}, spatial = spatial })`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [
		['ids.lua', "return { parent = 'group', child = 'part' }"],
		['cartlib/world/prefab.lua', 'return {}'], ['prefabs.lua', prefabs],
	]);
	const authoring = new SceneAuthoringContext(f.model, f.documents); t.after(() => authoring.dispose());
	const document = f.documents.get(f.model), scene = document.scenes[0];
	authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[2], index: 2 });
	assert.equal(authoring.removeSelectedMember(), true);
	const changed = f.documents.get(f.model);
	for (const entry of changed.scenes[0].objects) {
		assert.ok(entry.kind === 'object');
		assert.equal(entry.spatial!.parentId, null);
		assert.deepEqual(entry.spatial!.coefficients!.map(field => readLuaNumberLiteral(field.value)), [2, 0, 1, 3, 17, 29]);
	}
	assert.ok(f.model.buffer.getText().includes("local offset = { 1, 0, 0, 1, 2, 3 } -- shared affine stays\nlocal relationship = { parent_id = 'parent', local_transform = offset } -- shared relationship stays"));
	f.model.undo(); assert.equal(f.model.buffer.getText(), source);
});

test('Delete Member preserves inherited placement without redundant affine overrides', t => {
	for (const family of ['2d', '3d']) {
		const affine = family === '2d' ? '2, 0, 1, 3, 10, 20' : '2, 0, 0, 1, -1, 0, 0, 1, 3, 10, 20, 30';
		const source = `local scenes = require('cartlib/world/scene_library')
scenes.register('fixture', { objects = {
 { member_id = 'child', definition_id = 'child', spatial = { parent_id = 'parent' } },
 { member_id = 'parent', definition_id = 'parent' },
} })`;
		const prefabs = `local prefab = require('cartlib/world/prefab')
prefab.define({ def_id = 'parent', class = {}, spatial = { family = '${family}', authority = 'affine' } })
prefab.define({ def_id = 'child', class = {}, spatial = { family = '${family}', authority = 'affine', local_transform = { ${affine} } } })`;
		const f = createSceneSourceFixture(t, source, `scene_${family}.lua`, undefined,
			[['cartlib/world/prefab.lua', 'return {}'], ['prefabs.lua', prefabs]]);
		const authoring = new SceneAuthoringContext(f.model, f.documents); t.after(() => authoring.dispose());
		const document = f.documents.get(f.model), scene = document.scenes[0];
		authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 });
		assert.equal(authoring.removeSelectedMember(), true);
		const child = f.documents.get(f.model).scenes[0].objects[0]; assert.ok(child.kind === 'object');
		assert.equal(child.spatial!.parentId, null); assert.equal(child.spatial!.localTransform, null);
		f.model.undo(); assert.equal(f.model.buffer.getText(), source);
	}
});

test('successive member deletions retain overflowed Number poses through canonical generated source', t => {
	const source = `local scenes = require('cartlib/world/scene_library')
scenes.register('fixture', { objects = {
 { member_id = 'parent', definition_id = 'sprite', spatial = { local_transform = { 1e308, 0, 0, 1, 0, 0 } } },
 { member_id = 'child', definition_id = 'sprite', spatial = { parent_id = 'parent', local_transform = { 2, 0, 0, 1, 0, 0 } } },
 { member_id = 'leaf', definition_id = 'sprite', spatial = { parent_id = 'child', local_transform = { 1, 0, 0, 1, 0, 0 } } },
} })`;
	const f = createSceneSourceFixture(t, source), authoring = new SceneAuthoringContext(f.model, f.documents);
	t.after(() => authoring.dispose());
	for (const expected of [[Infinity, 0, 0, 1, 0, 0], [Infinity, 0, NaN, 1, NaN, 0]]) {
		const document = f.documents.get(f.model), scene = document.scenes[0];
		authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
		assert.equal(authoring.removeSelectedMember(), true);
		const child = f.documents.get(f.model).scenes[0].objects[0]; assert.ok(child.kind === 'object');
		assert.equal(child.spatial!.parentId, null);
		assert.deepEqual(child.spatial!.coefficients!.map(field => readLuaNumberExpression(field.value)), expected);
	}
	f.model.undo(); f.model.undo(); assert.equal(f.model.buffer.getText(), source);
});
