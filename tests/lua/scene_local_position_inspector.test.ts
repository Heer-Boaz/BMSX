import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneDetailsControl } from '../../ide/workbench/contrib/scene_editor/details_control';
import { SceneDetailsViewState } from '../../ide/workbench/contrib/scene_editor/details_view';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const PREFABS = `local prefab=require('cartlib/world/prefab')
prefab.define({def_id='node2',class=require('cartlib/world/object_2d')})
prefab.define({def_id='root2',class=require('cartlib/world/object_2d')})
prefab.define({def_id='node3',class=require('cartlib/world/object_3d'),transform = { xx = -2, xy = 1, xz = 0, yx = 0.5, yy = 3, yz = 0, zx = 0, zy = 0, zz = 0, ox = 17, oy = 19, oz = 23 }})
prefab.define({def_id='logic',class={}})`;

function fixture(t: TestContext, members: string) {
	configureFontVariant('tiny');
	const source = `local scenes=require('cartlib/world/scene_library')
scenes.register('main',{objects={${members}}})
scenes.register('other',{objects={{member_id='other',definition_id='node2'}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined,
		[['cartlib/world/prefab.lua', 'return {define=function() end}'], ['prefabs.lua', PREFABS]]);
	const document = f.documents.get(f.model), authoring = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version }), view = new SceneDetailsViewState(authoring);
	const scope = new InputFocusScope(Symbol('semantic local position'), inputFocus.workbenchScope), parent = inputFocus.createTarget(null, scope);
	const bounds = { left: 0, top: 0, right: 320, bottom: 240 }, menu = new ContextMenuController(inputFocus, pointerCapture, bounds);
	const command = { isEnabled: () => true, run: () => {} };
	const control = new SceneDetailsControl({
		isEnabled: (id, target) => inputFocus.getCommand(id, target)?.isEnabled() ?? false,
		execute: (id, target) => inputFocus.executeCommand(id, target),
	}, menu, scope, parent, { outline: command, details: command }, new WorkbenchMenu([], undefined));
	control.setView(view, bounds);
	const select = (index: number) => {
		authoring.refresh(); const document = authoring.document!, scene = authoring.subject!;
		assert.equal(authoring.select(document, f.model.version, { kind: 'member', scene, entry: scene.objects[index], index }), true); control.update();
	};
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.model.identity.contextId, path: 'prefabs.lua' })!);
	t.after(() => { control.dispose(); view.dispose(); authoring.dispose(); menu.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	select(0);
	return { ...f, source, authoring, view, control, select, provider };
}

test('implicit identity is a semantic local position; accepting unchanged values writes nothing', t => {
	const f = fixture(t, `{member_id='node',definition_id='node2'}`), field = f.control.controls[0], version = f.model.version;
	assert.deepEqual(f.view.properties.map(property => property.descriptor.value), [0, 0]);
	assert.equal(field.field.readOnly, false); assert.equal(f.control.controls[2].field.readOnly, true);
	setFieldText(field.field, '0x0', true); assert.equal(field.commit(), true); f.control.update();
	assert.equal(f.model.version, version); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	setFieldText(field.field, '12.5', true); assert.equal(field.commit(), true); f.control.update();
	assert.equal(f.authoring.selectedLocalTransform!.ox, 12.5); assert.equal(f.authoring.selectedLocalTransform!.oy, 0);
	assert.equal(f.provider.buffer.getText(), PREFABS, 'the instance override never rewrites a shared prefab default');
	f.model.undo(); f.control.update(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	assert.deepEqual(f.view.properties.map(property => property.descriptor.value), [0, 0]);
});

test('inherited 3D origin is editable without discarding the prefab shear, reflection or singular basis', t => {
	const f = fixture(t, `{member_id='node',definition_id='node3'}`), initial = { ...f.authoring.selectedLocalTransform! };
	assert.deepEqual(f.view.properties.map(property => property.descriptor.value), [17, 19, 23]);
	setFieldText(f.control.controls[2].field, '-0.125', true); assert.equal(f.control.controls[2].commit(), true); f.control.update();
	assert.deepEqual(f.authoring.selectedLocalTransform, { ...initial, oz: -0.125 });
	assert.equal(f.provider.buffer.getText(), PREFABS); const changed = f.model.buffer.getText();
	f.model.undo(); f.control.update(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	f.model.redo(); f.control.update(); assert.equal(f.model.buffer.getText(), changed); assert.equal(f.authoring.selectedLocalTransform!.family, '3d');
});

test('explicit local-axis acceptance changes only that numeric token and keeps parent, basis and comments byte-identical', t => {
	const f = fixture(t, `{member_id='parent',definition_id='node2'},
 {member_id='child',definition_id='node2',parent='parent',transform = { xx = 2, xy = 0.5, yx = -1, yy = 3, ox = 0, oy = 0 },position={x=(12.25),y=-3.5},options={note='untouched'}}`);
	f.select(1); const field = f.control.controls[0];
	setFieldText(field.field, '42.5', true); assert.equal(field.commit(), true); f.control.update();
	assert.equal(f.model.buffer.getText(), f.source.replace('12.25', '42.5'));
	f.model.undo(); f.control.update(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('a singular parent cannot veto a local-origin edit that needs no world inverse', t => {
	const f = fixture(t, `{member_id='parent',definition_id='node2',transform = { xx = 0, xy = 0, yx = 0, yy = 0, ox = 100, oy = 200 }},
 {member_id='child',definition_id='node2',parent='parent',transform = { xx = 2, xy = 0, yx = 1, yy = 3, ox = 0, oy = 0 },position={x=7,y=8}}`);
	f.select(1);
	assert.deepEqual(f.view.properties.map(property => property.descriptor.value), [7, 8]); assert.equal(f.control.controls[0].field.readOnly, false);
	setFieldText(f.control.controls[0].field, '19', true); assert.equal(f.control.controls[0].commit(), true); f.control.update();
	assert.equal(f.model.buffer.getText(), f.source.replace('x=7', 'x=19'));
	assert.equal(f.authoring.selectedLocalTransform!.ox, 19);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('Escape cancels a semantic position draft before any default override is materialized', t => {
	const f = fixture(t, `{member_id='node',definition_id='root2'}`), field = f.control.controls[0];
	field.field.focusTarget.focus(); setFieldText(field.field, '73', true);
	inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none));
	assert.equal(field.pending, false); assert.equal(field.field.text, '0'); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('stale local-position requests cannot cross source, provider, selection or read-only authority', t => {
	const f = fixture(t, `{member_id='first',definition_id='node2'},{member_id='second',definition_id='node2'}`);
	let request = f.authoring.captureLocalPosition()!; f.select(1); assert.equal(request.apply('x', 10), false);
	request = f.authoring.captureLocalPosition()!;
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer source\n' }]);
	assert.equal(request.apply('x', 10), false); f.control.update();
	request = f.authoring.captureLocalPosition()!; f.provider.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer provider\n' }]);
	assert.equal(request.apply('x', 10), false); f.control.update();
	request = f.authoring.captureLocalPosition()!;
	f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } });
	assert.equal(request.apply('x', 10), false); assert.equal(f.control.controls[0].field.readOnly, true);
	f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: false } });
	assert.equal(f.control.controls[0].field.readOnly, false);
	setFieldText(f.control.controls[0].field, '23', true); assert.equal(f.control.controls[0].commit(), true); f.control.update();
	assert.equal(f.authoring.selectedLocalTransform!.ox, 23);
});

test('unknown/nonspatial prefabs never gain semantic position from an array shape', t => {
	for (const definition of ['missing', 'logic']) {
		const f = fixture(t, `{member_id='node',definition_id='${definition}',position = { x = 17, y = 19 }}`);
		assert.equal(f.view.properties.length, 0); assert.equal(f.authoring.captureLocalPosition(), undefined);
		assert.equal(f.control.controls[0].field.readOnly, true); assert.equal(f.model.buffer.getText(), f.source);
	}
});
