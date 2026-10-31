import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneViewportCamera } from '../../ide/workbench/contrib/scene_editor/viewport/camera';
import { SceneViewportControl } from '../../ide/workbench/contrib/scene_editor/viewport/control';
import { SceneViewportViewState, SCENE_VIEWPORT_POINT_STRIDE } from '../../ide/workbench/contrib/scene_editor/viewport/view_state';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const PREFABS = `local prefab=require('cartlib/world/prefab')
prefab.define({def_id='node2',class={},spatial={family='2d',authority='affine'}})
prefab.define({def_id='node3',class={},spatial={family='3d',authority='affine'}})`;
const OBJECTS = `
 {member_id='first',definition_id='node2',spatial={local_transform={1,0,0,1,0,0}}},
 {member_id='second',definition_id='node2',spatial={parent_id='first',local_transform={2,0,1,1,100,20}}},
 {member_id='mesh',definition_id='node3',spatial={local_transform={1,0,0,0,1,0,0,0,1,7,11,13}}},
 {member_id='dynamic',definition_id='node2',spatial={local_transform=runtime_pose()}},`;
const BOUNDS = { left: 10, top: 20, right: 410, bottom: 260 };

function pointer(x: number, y: number, buttons: number, pressed = 0, released = 0, modifiers = KeyModifier.none): PointerInputSnapshot {
	return { viewportX: x, viewportY: y, valid: true, insideViewport: true, pressedButtons: buttons,
		justPressedButtons: pressed, justReleasedButtons: released, modifiers, spaceDown: false };
}
function fixture(t: TestContext, objects = OBJECTS, attach = true) {
	const source = `local scenes=require('cartlib/world/scene_library')\nscenes.register('main',{objects={${objects}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [['cartlib/world/prefab.lua', 'return {}'], ['prefabs.lua', PREFABS]]);
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version });
	const view = new SceneViewportViewState(context), scope = new InputFocusScope(Symbol('authored viewport'), inputFocus.workbenchScope);
	const semantic = inputFocus.createTarget(null, scope), panel = inputFocus.createTarget(semantic, new InputFocusScope(scope.surfaceScope, scope));
	panel.commandContext = semantic;
	semantic.registerCommand('sceneEditor.outline', { contextual: true, isEnabled: () => true, run: () => { semantic.focus(); } });
	const control = new SceneViewportControl(panel.scope, panel);
	if (attach) control.setView(view, BOUNDS);
	const select = (index: number) => {
		context.refresh(); const scene = context.subject!;
		assert.equal(context.select(context.document!, f.model.version, { kind: 'member', scene, entry: scene.objects[index], index }), true);
		control.update();
	};
	t.after(() => { control.dispose(); view.dispose(); context.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	return { ...f, source, context, view, scope, semantic, panel, control, select };
}

test('authored helper projection consumes actual affine families and retains unchanged numeric buffers', t => {
	const f = fixture(t), points = f.view.points, entries = f.view.entries;
	assert.equal(f.view.camera.mode, '2d'); assert.equal(entries.length, 2);
	assert.ok(entries[1] === f.context.subject!.objects[1]);
	// Focused projection contract: the X helper endpoint is the full world basis times the declared helper unit.
	const index = SCENE_VIEWPORT_POINT_STRIDE, scale = f.view.camera.scale;
	assert.equal(points[index + 2] - points[index], 32 * scale);
	assert.equal(points[index + 4] - points[index], 16 * scale);
	const projection = t.mock.method(f.view.camera, 'projectX'), revision = f.view.projectionRevision;
	for (let frame = 0; frame < 100; frame++) f.control.update();
	assert.equal(projection.mock.callCount(), 0); assert.equal(f.view.projectionRevision, revision);
	f.view.camera.pan(11, -7); f.control.update();
	assert.ok(f.view.points === points && f.view.entries === entries);
	inputFocus.executeCommand('sceneViewport.view3d', f.panel);
	assert.equal(f.view.entries.length, 1); assert.ok(f.view.entries[0] === f.context.subject!.objects[2]);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

for (const mode of ['2d', '3d'] as const) test(`${mode} camera zoom keeps the source point under the pointer and pan is its screen-plane inverse`, () => {
	const camera = new SceneViewportCamera(); camera.setMode(mode);
	const x = camera.projectX(19, 23, 29), y = camera.projectY(19, 23, 29);
	camera.zoom(1, x, y);
	assert.ok(Math.abs(camera.projectX(19, 23, 29) - x) < 1e-10);
	assert.ok(Math.abs(camera.projectY(19, 23, 29) - y) < 1e-10);
	camera.pan(13, -17);
	assert.ok(Math.abs(camera.projectX(19, 23, 29) - x - 13) < 1e-10);
	assert.ok(Math.abs(camera.projectY(19, 23, 29) - y + 17) < 1e-10);
	const snapshot = camera.capture(), restored = new SceneViewportCamera(); restored.restore(snapshot);
	assert.deepEqual(restored.capture(), snapshot);
});

test('camera persisted before first layout retains pending source-derived 3D admission', t => {
	const objects = `{member_id='mesh',definition_id='node3',spatial={local_transform={1,0,0,0,1,0,0,0,1,70,110,130}}}`;
	const f = fixture(t, objects, false), restored = new SceneViewportViewState(f.context); t.after(() => restored.dispose());
	const snapshot = f.view.camera.capture(); assert.equal(snapshot.reading, 'initial');
	restored.camera.restore(snapshot); f.control.setView(restored, BOUNDS);
	assert.equal(restored.camera.mode, '3d'); assert.equal(restored.camera.initial, false); assert.equal(restored.entries.length, 1);
	const reading = restored.camera.capture();
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- source edit\n' }]); f.control.update();
	assert.deepEqual(restored.camera.capture(), reading, 'source generations do not reset an admitted editor camera');
	f.control.layout({ ...BOUNDS, right: 510 }); assert.deepEqual(restored.camera.capture(), reading);
});

test('picking a drawn origin admits its exact authored occurrence and only local viewport keys act', t => {
	const f = fixture(t), index = SCENE_VIEWPORT_POINT_STRIDE;
	assert.equal(f.control.handlePointer(pointer(f.view.points[index], f.view.points[index + 1], PointerButton.Primary, PointerButton.Primary), true), true);
	assert.ok(f.context.selection?.kind === 'member' && f.context.selection.entry === f.context.subject!.objects[1]);
	assert.equal(f.panel.getCommand('sceneViewport.frameSelection')!.isEnabled(), true);
	const camera = f.view.camera.capture(); inputFocus.handleKeyboard(new KeyInputEvent('Digit3', KeyModifier.none));
	assert.equal(f.view.camera.mode, '3d'); assert.equal(f.panel.getCommand('sceneViewport.frameSelection')!.isEnabled(), false);
	f.semantic.focus(); const event = new KeyInputEvent('Digit2', KeyModifier.none);
	// A foreign keyboard recipient never runs the viewport handler or claims gameplay keys.
	f.semantic.bindKeyboard(() => {}); inputFocus.handleKeyboard(event);
	assert.equal(event.consumed, false); assert.equal(f.view.camera.mode, '3d');
	f.view.camera.restore(camera); f.control.update(); f.control.focus(); inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none));
	assert.ok(inputFocus.admittedTarget === f.semantic); assert.equal(f.model.canUndo, false);
});

test('frame commands are disabled for absent or unresolved geometry instead of becoming no-op menu actions', t => {
	const f = fixture(t); f.select(3);
	assert.equal(f.panel.getCommand('sceneViewport.frameSelection')!.isEnabled(), false);
	const empty = new SceneViewportViewState(f.context); t.after(() => empty.dispose());
	f.view.camera.setMode('3d'); f.select(0);
	assert.equal(f.panel.getCommand('sceneViewport.frameSelection')!.isEnabled(), false);
	const g = fixture(t, `{member_id='dynamic',definition_id='node2',spatial={local_transform=runtime_pose()}}`);
	assert.equal(g.panel.getCommand('sceneViewport.frameAll')!.isEnabled(), false);
});

test('pan and orbit use native capture, preserve same-panel focus, and cancel across allocation/source retirement', t => {
	const f = fixture(t); f.control.focus();
	f.control.handlePointer(pointer(200, 120, PointerButton.Auxiliary, PointerButton.Auxiliary), true);
	assert.equal(pointerCapture.active, true); const initial = f.view.camera.capture();
	f.panel.focus(); assert.equal(pointerCapture.active, true, 'same owning panel focus does not retire navigation');
	pointerCapture.dispatch(pointer(213, 127, PointerButton.Auxiliary), false, 0, f.control.focusTarget.scope.surfaceScope);
	assert.notDeepEqual(f.view.camera.capture(), initial);
	f.control.layout({ ...BOUNDS, right: 430 }); assert.equal(pointerCapture.active, false);
	f.control.focus(); inputFocus.executeCommand('sceneViewport.view3d', f.control.focusTarget);
	f.control.handlePointer(pointer(200, 120, PointerButton.Primary, PointerButton.Primary, 0, KeyModifier.alt), true);
	const orbit = f.view.camera.capture();
	pointerCapture.dispatch(pointer(220, 130, PointerButton.Primary), false, 0, f.control.focusTarget.scope.surfaceScope);
	assert.notEqual(f.view.camera.capture().yaw, orbit.yaw);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer\n' }]); f.control.update();
	assert.equal(pointerCapture.active, false); const retired = f.view.camera.capture();
	pointerCapture.dispatch(pointer(240, 140, PointerButton.Primary), false, 0, f.control.focusTarget.scope.surfaceScope);
	assert.deepEqual(f.view.camera.capture(), retired);
	assert.equal(f.model.buffer.getText(), '-- newer\n' + f.source);
});

test('an older frame invocation cannot retarget the canvas rebound by source admission', t => {
	const f = fixture(t), incoming = new SceneViewportViewState(f.context); t.after(() => incoming.dispose());
	incoming.camera.pan(31, -47); const before = incoming.camera.capture();
	const release = f.context.onDidChangeSpatialGeneration(() => { release(); f.control.setView(incoming, BOUNDS); }); t.after(release);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dependency admission\n' }]);
	assert.doesNotThrow(() => inputFocus.executeCommand('sceneViewport.frameAll', f.panel));
	assert.ok(f.control.view === incoming); assert.deepEqual(incoming.camera.capture(), before);
});

test('a captured frame request cannot survive detach/rebind or a newer selection intent', t => {
	const f = fixture(t), invocation = f.panel.getCommand('sceneViewport.frameAll')!.capture!()!;
	f.select(1); const before = f.view.camera.capture(); invocation.run(); assert.deepEqual(f.view.camera.capture(), before);
	const next = f.panel.getCommand('sceneViewport.view3d')!.capture!()!;
	f.control.clearView(); f.control.setView(f.view, BOUNDS); next.run(); assert.equal(f.view.camera.mode, '2d');
});

test('reentrant attachment retirement preserves the newer binding and disposal releases source projections', t => {
	const f = fixture(t), incoming = new SceneViewportViewState(f.context), superseded = new SceneViewportViewState(f.context);
	t.after(() => { incoming.dispose(); superseded.dispose(); });
	const release = f.control.focusTarget.scope.onDidRetireContext(() => { release(); f.control.setView(incoming, BOUNDS); }); t.after(release);
	f.control.setView(superseded, BOUNDS); assert.ok(f.control.view === incoming);
	const retired = f.control.focusTarget.scope.onDidRetireContext(() => { retired(); f.control.setView(superseded, BOUNDS); }); t.after(retired);
	f.control.dispose(); assert.equal(f.control.canFocus, false);
	incoming.dispose(); assert.equal(incoming.source, undefined); assert.equal(incoming.selected, undefined); assert.equal(incoming.entries.length, 0);
});
