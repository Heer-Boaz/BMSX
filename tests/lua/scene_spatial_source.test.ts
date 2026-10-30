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
import { parseLuaNumberInput, readLuaNumberLiteral } from '../../ide/language/lua/source_edits';
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
