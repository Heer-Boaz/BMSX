import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { WorkbenchViewportCamera } from '../../ide/workbench/ui/viewport_camera';
import { SceneViewportControl } from '../../ide/workbench/contrib/scene_editor/viewport/control';
import { SceneViewportViewState, SCENE_VIEWPORT_POINT_STRIDE } from '../../ide/workbench/contrib/scene_editor/viewport/view_state';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import type { EditorCommandId } from '../../ide/common/commands';
import { editorRuntimeState } from '../../ide/editor/common/runtime_state';

const PREFABS = `local prefab=require('cartlib/world/prefab')
prefab.define({def_id='node2',class=require('cartlib/world/object_2d')})
prefab.define({def_id='node3',class=require('cartlib/world/object_3d')})`;
const OBJECTS = `
 {member_id='first',definition_id='node2',position = { x = 0, y = 0 }},
 {member_id='second',definition_id='node2',parent='first',transform = { xx = 2, xy = 0, yx = 1, yy = 1, ox = 100, oy = 20 }},
 {member_id='mesh',definition_id='node3',position = { x = 7, y = 11, z = 13 }},
 {member_id='dynamic',definition_id='node2',transform=runtime_pose()},`;
const BOUNDS = { left: 10, top: 20, right: 410, bottom: 260 };

function pointer(x: number, y: number, buttons: number, pressed = 0, released = 0, modifiers = KeyModifier.none): PointerInputSnapshot {
	return { viewportX: x, viewportY: y, valid: true, insideViewport: true, pressedButtons: buttons,
		justPressedButtons: pressed, justReleasedButtons: released, modifiers, spaceDown: false };
}
function fixture(t: TestContext, objects = OBJECTS, attach = true) {
	configureFontVariant('tiny');
	const source = `local scenes=require('cartlib/world/scene_library')\nscenes.register('main',{objects={${objects}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [['cartlib/world/prefab.lua', 'return { define=function() end }'], ['prefabs.lua', PREFABS]]);
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version });
	const menu = new ContextMenuController(inputFocus, pointerCapture, BOUNDS);
	const view = new SceneViewportViewState(context, f.sources.catalog), scope = new InputFocusScope(Symbol('authored viewport'), inputFocus.workbenchScope);
	const semantic = inputFocus.createTarget(null, scope), panel = inputFocus.createTarget(semantic, new InputFocusScope(scope.surfaceScope, scope));
	panel.commandContext = semantic;
	const control = new SceneViewportControl({ isEnabled: (command, target) => inputFocus.getCommand(command, target)?.isEnabled() === true,
		execute: (command, target) => inputFocus.executeCommand(command, target) }, menu, panel.scope, panel, new WorkbenchMenu([], undefined));
	control.focusTarget.registerCommand('sceneEditor.outline', { contextual: true, isEnabled: () => true, run: () => { semantic.focus(); } });
	if (attach) control.setView(view, BOUNDS);
	const select = (index: number) => {
		context.refresh(); const scene = context.subject!;
		assert.equal(context.select(context.document!, f.model.version, { kind: 'member', scene, entry: scene.objects[index], index }), true);
		control.update();
	};
	t.after(() => { control.dispose(); view.dispose(); context.dispose(); menu.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	return { ...f, source, context, view, scope, semantic, panel, control, menu, select };
}

test('viewport menus admit primary-button orbit, pan, zoom and return to member selection without editing source', t => {
	const f = fixture(t); f.select(0);
	const selection = f.context.selection;
	const click = (command: EditorCommandId) => {
		f.control.update();
		const menuCommand = command === 'sceneViewport.view2d' || command === 'sceneViewport.view3d'
			? 'sceneViewport.viewOptions' : 'sceneViewport.navigationOptions';
		const item = f.view.navigationActions.items.find(item => item.command === menuCommand)!;
		assert.ok(item.visible && !item.overflowed && item.enabled);
		const x = (item.bounds.left + item.bounds.right) / 2, y = (item.bounds.top + item.bounds.bottom) / 2;
		const down = pointer(x, y, PointerButton.Primary, PointerButton.Primary);
		pointerCapture.beginRoute(f.scope.surfaceScope, down);
		assert.equal(f.control.handlePointer(down, true), true);
		pointerCapture.dispatch(pointer(x, y, 0, 0, PointerButton.Primary), false, 0, f.scope.surfaceScope);
		assert.equal(f.menu.visible, true);
		assert.ok(f.menu.model.rows.some(row => row.command === command && row.enabled));
		f.menu.handleKeyboard(new KeyInputEvent('Home', KeyModifier.none));
		for (let step = 0; f.menu.model.rows[f.menu.model.selectedIndex]?.command !== command && step < f.menu.model.rows.length; step++)
			f.menu.handleKeyboard(new KeyInputEvent('ArrowDown', KeyModifier.none));
		assert.equal(f.menu.model.rows[f.menu.model.selectedIndex].command, command);
		f.menu.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none));
		f.menu.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, false));
		assert.equal(f.menu.visible, false);
		assert.ok(inputFocus.admittedTarget === f.control.focusTarget);
		f.control.update();
	};
	const drag = () => {
		const x = (BOUNDS.left + BOUNDS.right) / 2, y = (BOUNDS.top + BOUNDS.bottom) / 2;
		f.control.handlePointer(pointer(x, y, PointerButton.Primary, PointerButton.Primary), true);
		assert.ok(pointerCapture.active);
		pointerCapture.dispatch(pointer(x + 30, y - 20, PointerButton.Primary), false, 0, f.scope.surfaceScope);
		pointerCapture.dispatch(pointer(x + 30, y - 20, 0, 0, PointerButton.Primary), false, 0, f.scope.surfaceScope);
	};
	click('sceneViewport.view3d'); click('sceneViewport.orbit');
	const beforeOrbit = f.view.camera.capture().space; drag();
	const afterOrbit = f.view.camera.capture().space;
	assert.notEqual(afterOrbit.yaw, beforeOrbit.yaw); assert.notEqual(afterOrbit.pitch, beforeOrbit.pitch);
	click('sceneViewport.pan'); drag();
	const afterPan = f.view.camera.capture().space;
	assert.equal(afterPan.yaw, afterOrbit.yaw); assert.equal(afterPan.pitch, afterOrbit.pitch);
	assert.notEqual(afterPan.centerX, afterOrbit.centerX);
	click('sceneViewport.zoomIn'); assert.ok(f.view.camera.capture().space.distance < afterPan.distance);
	const zoomed = f.view.camera.capture().space.distance;
	click('sceneViewport.zoomOut'); assert.ok(f.view.camera.capture().space.distance > zoomed);
	click('sceneViewport.frameAll'); assert.notDeepEqual(f.view.camera.capture().space, afterPan);
	assert.equal(f.context.selection, selection);
	click('sceneViewport.select'); assert.equal(f.view.navigationTool, 'select');
	click('sceneViewport.orbit'); click('sceneViewport.view2d');
	assert.equal(f.view.navigationTool, 'select');
	f.view.navigationMenu.refresh();
	assert.equal(f.view.navigationMenu.visibleItems.some(item => item.type === 'command' && item.command === 'sceneViewport.orbit'), false);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('retiring a viewport cancels a held navigation button instead of acting on the next document', t => {
	const f = fixture(t), item = f.view.navigationActions.items.find(item => item.command === 'sceneViewport.viewOptions')!;
	const x = (item.bounds.left + item.bounds.right) / 2, y = (item.bounds.top + item.bounds.bottom) / 2;
	const down = pointer(x, y, PointerButton.Primary, PointerButton.Primary);
	pointerCapture.beginRoute(f.scope.surfaceScope, down); f.control.handlePointer(down, true);
	assert.ok(pointerCapture.active);
	const next = new SceneViewportViewState(f.context, f.sources.catalog); t.after(() => next.dispose());
	f.control.setView(next, BOUNDS); const reading = next.camera.capture();
	pointerCapture.dispatch(pointer(x, y, 0, 0, PointerButton.Primary), false, 0, f.scope.surfaceScope);
	assert.equal(pointerCapture.active, false); assert.deepEqual(next.camera.capture(), reading);
	assert.equal(f.menu.visible, false);
});

test('a camera-button activation may retire its own viewport synchronously', t => {
	const f = fixture(t); f.select(0); f.view.camera.pan(50, 50);
	const item = f.view.navigationActions.items.find(item => item.command === 'sceneViewport.frameSelection')!;
	const unbind = f.view.camera.onDidChange(() => f.control.clearView()); t.after(unbind);
	const x = (item.bounds.left + item.bounds.right) / 2, y = (item.bounds.top + item.bounds.bottom) / 2;
	f.control.handlePointer(pointer(x, y, 0, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(f.control.canFocus, false); assert.equal(pointerCapture.active, false);
});

test('focus does not paint permanent instructions; help belongs to the action being pointed at', t => {
	const f = fixture(t); f.control.focus(); f.control.update();
	assert.equal(f.view.caption.lines.length, 0, 'an available idle viewport has no instructional artwork overlay');
	assert.equal(f.control.tooltipItem, undefined);
	const item = f.view.navigationActions.items.find(item => item.command === 'sceneViewport.navigationOptions')!;
	const x = (item.bounds.left + item.bounds.right) / 2, y = (item.bounds.top + item.bounds.bottom) / 2;
	f.control.handlePointer(pointer(x, y, 0), false);
	assert.ok(f.control.tooltipItem === item);
	f.control.handlePointer(pointer(BOUNDS.right - 2, BOUNDS.bottom - 2, 0), false);
	assert.equal(f.control.tooltipItem, undefined);
	inputFocus.executeCommand('sceneViewport.pan', f.panel); f.control.update();
	assert.equal(f.view.caption.lines.length, 0, 'changing interaction mode must not restore a permanent help box');
	f.view.source = undefined; f.view.prepareControls(undefined);
	assert.equal(f.view.caption.lines.length, 1, 'real unavailability remains visible rather than being hidden with the help text');
});

test('a narrow viewport reaches its view choices through the real action-bar overflow', t => {
	const f = fixture(t); f.control.focus();
	f.control.layout({ ...BOUNDS, right: BOUNDS.left + 24 });
	const overflow = f.view.navigationActions.overflow!.button;
	assert.equal(overflow.visible, true);
	const press = pointer((overflow.bounds.left + overflow.bounds.right) / 2, (overflow.bounds.top + overflow.bounds.bottom) / 2,
		0, PointerButton.Primary, PointerButton.Primary);
	pointerCapture.beginRoute(f.scope.surfaceScope, press); f.control.handlePointer(press, true);
	assert.equal(f.menu.visible, true);
	f.menu.handleKeyboard(new KeyInputEvent('Home', KeyModifier.none));
	assert.equal(f.menu.model.rows[f.menu.model.selectedIndex].command, 'sceneViewport.viewOptions');
	f.menu.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none));
	f.menu.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.equal(f.menu.visible, true);
	assert.ok(f.menu.model.rows.some(row => row.command === 'sceneViewport.view3d' && row.enabled));
	f.menu.handleKeyboard(new KeyInputEvent('End', KeyModifier.none));
	f.menu.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none));
	f.menu.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.equal(f.view.camera.mode, '3d');
	assert.equal(f.menu.visible, false); assert.ok(inputFocus.admittedTarget === f.control.focusTarget);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

for (const retirement of ['selection', 'source', 'allocation', 'attachment'] as const)
test(`an open viewport menu retires with its ${retirement} and cannot run its armed action later`, t => {
	const f = fixture(t); f.select(0); f.control.focus();
	inputFocus.executeCommand('sceneViewport.viewOptions', f.panel);
	assert.equal(f.menu.visible, true);
	f.menu.handleKeyboard(new KeyInputEvent('End', KeyModifier.none));
	assert.equal(f.menu.model.rows[f.menu.model.selectedIndex].command, 'sceneViewport.view3d');
	f.menu.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none));
	if (retirement === 'selection') f.select(1);
	else if (retirement === 'source') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- edit\n' }]);
	else if (retirement === 'allocation') f.control.layout({ ...BOUNDS, right: BOUNDS.right - 20 });
	else f.control.clearView();
	assert.equal(f.menu.visible, false);
	inputFocus.handleKeyboard(new KeyInputEvent('Enter', KeyModifier.none, false, false));
	assert.equal(f.view.camera.mode, '2d');
});

test('restoring a 2D camera reading retires its unavailable orbit tool', t => {
	const f = fixture(t), canvas = f.view.camera.capture();
	inputFocus.executeCommand('sceneViewport.view3d', f.panel); inputFocus.executeCommand('sceneViewport.orbit', f.panel);
	assert.equal(f.view.navigationTool, 'orbit');
	f.view.camera.restore(canvas); f.control.update();
	assert.equal(f.view.navigationTool, 'select');
});

test('authored helper projection consumes actual affine families and retains unchanged numeric buffers', t => {
	const f = fixture(t), points = f.view.points, entries = f.view.entries;
	assert.equal(f.view.camera.mode, '2d'); assert.equal(entries.length, 2);
	assert.ok(entries[1] === f.context.subject!.objects[1]);
	// Focused projection contract: the X helper endpoint is the full world basis times the declared helper unit.
	const index = SCENE_VIEWPORT_POINT_STRIDE;
	assert.equal(points[index + 2] - points[index], 32);
	assert.equal(points[index + 4] - points[index], 16);
	const projection = t.mock.method(f.view.camera, 'projectX'), revision = f.view.projectionRevision;
	const poses = t.mock.method(f.view.source!.worlds, 'get');
	for (let frame = 0; frame < 100; frame++) f.control.update();
	assert.equal(projection.mock.callCount(), 0); assert.equal(f.view.projectionRevision, revision);
	assert.equal(poses.mock.callCount(), 0, 'steady reading does not walk source poses to rediscover the camera family');
	f.view.camera.pan(11, -7); f.control.update();
	assert.ok(f.view.points === points && f.view.entries === entries);
	f.view.camera.zoom(1, 0, 0); f.control.update();
	assert.equal(points[index + 2] - points[index], 32, 'diagnostic basis units stay screen-sized while actual images zoom');
	inputFocus.executeCommand('sceneViewport.view3d', f.panel);
	assert.deepEqual(f.view.entries, f.context.subject!.objects.slice(0, 3), 'orbit view retains both planar and spatial members');
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('2D camera zoom anchors the source point and pan is its screen-plane inverse', () => {
	const camera = new WorkbenchViewportCamera();
	const x = camera.projectX(19, 23, 0), y = camera.projectY(19, 23, 0);
	camera.zoom(1, x, y);
	assert.ok(Math.abs(camera.projectX(19, 23, 0) - x) < 1e-10);
	assert.ok(Math.abs(camera.projectY(19, 23, 0) - y) < 1e-10);
	camera.pan(13, -17);
	assert.ok(Math.abs(camera.projectX(19, 23, 0) - x - 13) < 1e-10);
	assert.ok(Math.abs(camera.projectY(19, 23, 0) - y + 17) < 1e-10);
});

test('perspective dolly anchors the actual picked point and independent camera readings restore', () => {
	const camera = new WorkbenchViewportCamera(); camera.setViewport(400, 240); camera.pan(17, -23);
	const canvas = camera.capture().canvas;
	camera.setMode('3d'); camera.frame3D(-10, -10, -10, 10, 10, 10);
	const point = { originX: 0, originY: 0, originZ: 0, x: 1, y: 2, z: 3 }, x = camera.projectX(point.x, point.y, point.z), y = camera.projectY(point.x, point.y, point.z);
	camera.zoom(1, x, y, point);
	assert.ok(Math.abs(camera.projectX(point.x, point.y, point.z) - x) < 1e-10);
	assert.ok(Math.abs(camera.projectY(point.x, point.y, point.z) - y) < 1e-10);
	const space = camera.capture().space;
	camera.setMode('2d'); assert.deepEqual(camera.capture().canvas, canvas);
	camera.pan(8, 9); assert.deepEqual(camera.capture().space, space);
	camera.setMode('3d'); const snapshot = camera.capture(), restored = new WorkbenchViewportCamera();
	restored.setViewport(400, 240); restored.restore(snapshot);
	assert.deepEqual(restored.capture(), snapshot); assert.deepEqual(restored.clipFromOrigin, camera.clipFromOrigin);
	const origin = new Float64Array(3), direction = new Float64Array(3);
	camera.eyeRelativeTo(0, 0, 0, origin); camera.rayDirection3D(x, y, direction);
	const distance = Math.hypot(point.x - origin[0], point.y - origin[1], point.z - origin[2]);
	assert.ok(Math.abs(origin[0] + direction[0] * distance - point.x) < 1e-10);
	assert.ok(Math.abs(origin[1] + direction[1] * distance - point.y) < 1e-10);
	assert.ok(Math.abs(origin[2] + direction[2] * distance - point.z) < 1e-10);
});

test('camera framing fits actual image or line extents without imposing the origin-helper reading span', () => {
	const camera = new WorkbenchViewportCamera();
	// Focused camera-fit contract: an 8-unit quad occupies the 80-unit inset allocation.
	camera.frame2D(0, 0, 8, 8, 112, 112); assert.equal(camera.scale, 10);
	assert.equal(camera.projectX(0, 0, 0), -40); assert.equal(camera.projectY(8, 8, 0), 40);
	camera.frame2D(0, 0, 8, 0, 112, 112); assert.equal(camera.scale, 10);
	camera.frame2D(0, 0, 0, 0, 112, 112); assert.equal(camera.scale, 80 / 64);
});

test('camera persisted before first layout retains pending source-derived 3D admission', t => {
	const objects = `{member_id='mesh',definition_id='node3',position = { x = 70, y = 110, z = 130 }}`;
	const f = fixture(t, objects, false), restored = new SceneViewportViewState(f.context, f.sources.catalog); t.after(() => restored.dispose());
	const snapshot = f.view.camera.capture(); assert.equal(snapshot.canvas.reading, 'initial');
	restored.camera.restore(snapshot); f.control.setView(restored, BOUNDS);
	assert.equal(restored.camera.mode, '3d'); assert.equal(restored.camera.initial, true); assert.equal(restored.entries.length, 1);
	const reading = restored.camera.capture();
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- source edit\n' }]); f.control.update();
	assert.deepEqual(restored.camera.capture(), reading, 'unchanged source geometry preserves the automatic reading');
	f.control.layout({ ...BOUNDS, right: 510 }); assert.deepEqual(restored.camera.capture(), reading);
});

test('picking a drawn origin admits its exact authored occurrence and only local viewport keys act', t => {
	const f = fixture(t), index = SCENE_VIEWPORT_POINT_STRIDE;
	assert.equal(f.control.handlePointer(pointer(f.view.points[index], f.view.points[index + 1], PointerButton.Primary, PointerButton.Primary), true), true);
	assert.ok(f.context.selection?.kind === 'member' && f.context.selection.entry === f.context.subject!.objects[1]);
	assert.equal(f.panel.getCommand('sceneViewport.frameSelection')!.isEnabled(), true);
	const camera = f.view.camera.capture();
	for (const [code, modifier] of [['KeyF', KeyModifier.ctrl], ['Digit3', KeyModifier.meta], ['Digit2', KeyModifier.alt], ['Digit2', KeyModifier.shift]] as const) {
		const modified = new KeyInputEvent(code, modifier); inputFocus.handleKeyboard(modified);
		assert.equal(modified.consumed, false); assert.deepEqual(f.view.camera.capture(), camera);
	}
	inputFocus.handleKeyboard(new KeyInputEvent('Digit3', KeyModifier.none));
	assert.equal(f.view.camera.mode, '3d'); assert.equal(f.panel.getCommand('sceneViewport.frameSelection')!.isEnabled(), true);
	f.semantic.focus(); const event = new KeyInputEvent('Digit2', KeyModifier.none);
	// A foreign keyboard recipient never runs the viewport handler or claims gameplay keys.
	f.semantic.bindKeyboard(() => {}); inputFocus.handleKeyboard(event);
	assert.equal(event.consumed, false); assert.equal(f.view.camera.mode, '3d');
	f.view.camera.restore(camera); f.control.update(); f.control.focus(); inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none));
	assert.ok(inputFocus.admittedTarget === f.semantic); assert.equal(f.model.canUndo, false);
});

for (const [family, index] of [['2d', 0], ['3d', 2]] as const) test(`an unmodified click on empty ${family} canvas clears the authored selection`, t => {
	const f = fixture(t); f.select(index);
	inputFocus.executeCommand('sceneViewport.frameSelection', f.panel);
	assert.equal(f.view.camera.mode, family);
	const x = BOUNDS.left + 2, y = BOUNDS.top + 2;
	assert.equal(f.view.pick(x, y), undefined);
	assert.equal(f.control.handlePointer(pointer(x, y, PointerButton.Primary, PointerButton.Primary), true), true);
	assert.equal(f.context.selection, undefined);
	assert.equal(f.panel.getCommand('sceneViewport.frameSelection')!.isEnabled(), false);
	f.select(index);
	// A complete click may be delivered in one host poll, with no button still held.
	f.control.handlePointer(pointer(x, y, 0, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(f.context.selection, undefined);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('empty canvas modified clicks and camera gestures retain the selection', t => {
	const f = fixture(t); f.select(0);
	const selected = f.context.selection, x = BOUNDS.left + 2, y = BOUNDS.top + 2;
	assert.equal(f.view.pick(x, y), undefined);
	for (const modifiers of [KeyModifier.shift, KeyModifier.ctrl, KeyModifier.alt, KeyModifier.meta]) {
		f.control.handlePointer(pointer(x, y, PointerButton.Primary, PointerButton.Primary, 0, modifiers), true);
		assert.equal(f.context.selection, selected);
	}
	f.control.handlePointer({ ...pointer(x, y, PointerButton.Primary, PointerButton.Primary), spaceDown: true }, true);
	assert.equal(f.context.selection, selected);
	f.control.handlePointer(pointer(x, y, PointerButton.Auxiliary, PointerButton.Auxiliary), true);
	assert.equal(f.context.selection, selected); pointerCapture.interrupt(false);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('empty canvas click cannot override a newer selection admitted by its focus handoff', t => {
	const f = fixture(t); f.select(0); f.semantic.focus();
	const x = BOUNDS.left + 2, y = BOUNDS.top + 2;
	assert.equal(f.view.pick(x, y), undefined);
	const unbind = f.control.focusTarget.onDidFocus(() => f.select(1)); t.after(unbind);
	f.control.handlePointer(pointer(x, y, PointerButton.Primary, PointerButton.Primary), true);
	assert.ok(f.context.selection?.kind === 'member' && f.context.selection.entry === f.context.subject!.objects[1]);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('empty canvas click does not erase a newer selection admitted while clearing', t => {
	const f = fixture(t); f.select(0); f.control.focus();
	const x = BOUNDS.left + 2, y = BOUNDS.top + 2;
	assert.equal(f.view.pick(x, y), undefined);
	const unbind = f.context.onDidChangeSelection(() => {
		if (!f.context.hasSelection) { unbind(); f.select(1); }
	});
	t.after(unbind);
	f.control.handlePointer(pointer(x, y, PointerButton.Primary, PointerButton.Primary), true);
	assert.ok(f.context.selection?.kind === 'member' && f.context.selection.entry === f.context.subject!.objects[1]);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('frame commands are disabled for absent or unresolved geometry instead of becoming no-op menu actions', t => {
	const f = fixture(t); f.select(3);
	assert.equal(f.panel.getCommand('sceneViewport.frameSelection')!.isEnabled(), false);
	const empty = new SceneViewportViewState(f.context, f.sources.catalog); t.after(() => empty.dispose());
	const g = fixture(t, `{member_id='dynamic',definition_id='node2',transform=runtime_pose()}`);
	assert.equal(g.panel.getCommand('sceneViewport.frameAll')!.isEnabled(), false);
});

test('framing a planar selection retains the orbit view and preserves the independent canvas camera', t => {
	const f = fixture(t), camera = f.view.camera;
	camera.pan(12, 8); const canvas = camera.capture().canvas;
	f.select(2);
	assert.equal(camera.mode, '2d', 'selection alone does not override the chosen view');
	assert.equal(f.panel.getCommand('sceneViewport.frameSelection')!.isEnabled(), true);
	const changes: ReturnType<WorkbenchViewportCamera['capture']>[] = [];
	const unsubscribe = camera.onDidChange(() => { changes.push(camera.capture()); }); t.after(unsubscribe);
	inputFocus.executeCommand('sceneViewport.frameSelection', f.panel);
	assert.equal(camera.mode, '3d');
	assert.equal(changes.length, 1, 'mode and framed reading are published together');
	assert.equal(changes[0].mode, '3d'); assert.equal(changes[0].space.originX, 7);
	assert.deepEqual(camera.capture().canvas, canvas);
	const spatial3 = f.context.subject!.objects[2];
	assert.equal(spatial3.kind, 'object');
	assert.ok(f.view.entries.includes(spatial3));
	const space = camera.capture().space;
	f.select(0);
	assert.equal(camera.mode, '3d', 'selection alone preserves the manually chosen view');
	assert.equal(f.panel.getCommand('sceneViewport.frameSelection')!.isEnabled(), true);
	inputFocus.executeCommand('sceneViewport.frameSelection', f.panel);
	assert.equal(camera.mode, '3d', 'planar members can be framed in the orbit view');
	assert.deepEqual(camera.capture().canvas, canvas, 'framing in orbit leaves the independent canvas camera unchanged');
	assert.notDeepEqual(camera.capture().space, space);
	const spatial2 = f.context.subject!.objects[0];
	assert.equal(spatial2.kind, 'object');
	assert.ok(f.view.entries.includes(spatial2));
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('explicitly framing a selection adopts its view, but initial framing remains automatic', t => {
	const objects = `{member_id='object',definition_id='node2',position={x=7,y=11}}`;
	const initial = fixture(t, objects);
	assert.equal(initial.view.camera.automaticMode, true);
	let offset = initial.model.buffer.getText().indexOf("definition_id='node2'");
	initial.model.pushEditOperations([{ offset, deleteLength: "definition_id='node2'".length, text: "definition_id='node3'" }]);
	initial.control.update();
	assert.equal(initial.view.camera.mode, '3d', 'initial framing does not claim a manual mode');
	assert.equal(initial.view.camera.automaticMode, true);

	const framed = fixture(t, objects);
	framed.select(0);
	assert.equal(framed.view.camera.automaticMode, true);
	let publications = 0;
	const unsubscribe = framed.view.camera.onDidChange(() => { publications++; }); t.after(unsubscribe);
	inputFocus.executeCommand('sceneViewport.frameSelection', framed.panel);
	assert.equal(framed.view.camera.automaticMode, false, 'an explicit frame adopts the current view');
	assert.equal(publications, 1, 'adopting and framing publish one camera change');
	offset = framed.model.buffer.getText().indexOf("definition_id='node2'");
	framed.model.pushEditOperations([{ offset, deleteLength: "definition_id='node2'".length, text: "definition_id='node3'" }]);
	framed.control.update();
	assert.equal(framed.view.camera.mode, '2d', 'later source changes cannot override the adopted view');
});

test('a reentrant selection and camera gesture supersede the frame request', t => {
	const f = fixture(t), camera = f.view.camera;
	f.select(2);
	let newer: ReturnType<WorkbenchViewportCamera['capture']> | undefined;
	const unsubscribe = camera.onDidChange(() => {
		unsubscribe();
		f.select(0); camera.setMode('2d'); camera.pan(19, -13);
		newer = camera.capture();
	}); t.after(unsubscribe);
	inputFocus.executeCommand('sceneViewport.frameSelection', f.panel);
	assert.deepEqual(camera.capture(), newer);
	assert.ok(f.context.selection?.kind === 'member' && f.context.selection.entry === f.context.subject!.objects[0]);
	assert.equal(camera.mode, '2d'); assert.equal(f.model.buffer.getText(), f.source);
});

test('a reentrant frame notification cannot change a newly attached viewport', t => {
	const f = fixture(t), incoming = new SceneViewportViewState(f.context, f.sources.catalog); t.after(() => incoming.dispose());
	f.select(2);
	let newer: ReturnType<WorkbenchViewportCamera['capture']> | undefined;
	const unsubscribe = f.view.camera.onDidChange(() => {
		unsubscribe();
		f.control.setView(incoming, BOUNDS); incoming.camera.setMode('2d'); incoming.camera.pan(17, -11);
		newer = incoming.camera.capture();
	}); t.after(unsubscribe);
	inputFocus.executeCommand('sceneViewport.frameSelection', f.panel);
	assert.ok(f.control.view === incoming); assert.deepEqual(incoming.camera.capture(), newer);
	assert.equal(f.model.buffer.getText(), f.source);
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
	assert.notEqual(f.view.camera.capture().space.yaw, orbit.space.yaw);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer\n' }]); f.control.update();
	assert.equal(pointerCapture.active, false); const retired = f.view.camera.capture();
	pointerCapture.dispatch(pointer(240, 140, PointerButton.Primary), false, 0, f.control.focusTarget.scope.surfaceScope);
	assert.deepEqual(f.view.camera.capture(), retired);
	assert.equal(f.model.buffer.getText(), '-- newer\n' + f.source);
});

test('right click opens context only on release; pointer jitter is not a camera drag', t => {
	const f = fixture(t); f.select(0); const selection = f.context.selection, camera = f.view.camera.capture();
	f.control.handlePointer(pointer(200, 120, PointerButton.Secondary, PointerButton.Secondary), true);
	assert.equal(f.menu.visible, false); assert.equal(pointerCapture.active, true);
	pointerCapture.dispatch(pointer(202, 121, PointerButton.Secondary), false, 0, f.scope.surfaceScope);
	assert.deepEqual(f.view.camera.capture(), camera);
	pointerCapture.dispatch(pointer(202, 121, 0, 0, PointerButton.Secondary), false, 0, f.scope.surfaceScope);
	assert.equal(f.menu.visible, true); assert.equal(pointerCapture.active, false);
	assert.ok(f.context.selection === selection);
	f.menu.hide();
	f.control.handlePointer(pointer(200, 120, 0, PointerButton.Secondary, PointerButton.Secondary), true);
	assert.equal(f.menu.visible, true, 'a complete native click in one delivery follows the same admission');
	assert.equal(pointerCapture.active, false);
});

for (const mode of ['2d', '3d'] as const)
test(`${mode} right drag navigates without replacing selection, editing source or opening a menu`, t => {
	const f = fixture(t); f.select(0); f.view.camera.setMode(mode); f.control.update();
	const selection = f.context.selection, camera = f.view.camera.capture(), eye = new Float64Array(3), after = new Float64Array(3);
	f.view.camera.eyeRelativeTo(0, 0, 0, eye);
	f.control.handlePointer(pointer(200, 120, PointerButton.Secondary, PointerButton.Secondary), true);
	pointerCapture.dispatch(pointer(230, 140, PointerButton.Secondary), false, 0, f.scope.surfaceScope);
	assert.notDeepEqual(f.view.camera.capture(), camera);
	if (mode === '3d') {
		f.view.camera.eyeRelativeTo(0, 0, 0, after);
		for (let axis = 0; axis < 3; axis++) assert.ok(Math.abs(eye[axis] - after[axis]) < 1e-10, 'look rotates around the eye, not the orbit pivot');
	} else assert.deepEqual(f.view.camera.capture().space, camera.space);
	pointerCapture.dispatch(pointer(230, 140, 0, 0, PointerButton.Secondary), false, 0, f.scope.surfaceScope);
	assert.equal(f.menu.visible, false); assert.equal(pointerCapture.active, false);
	assert.ok(f.context.selection === selection);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('held Scene flight advances on host frames and RMB wheel changes speed, not zoom or source', t => {
	const f = fixture(t); f.select(2); f.view.camera.setMode('3d'); f.control.update();
	const camera = f.view.camera, initial = camera.capture(), points = f.view.points, selection = f.context.selection;
	const sources = t.mock.method(f.context, 'captureTranslation');
	const projection = t.mock.method(camera, 'projectX');
	editorRuntimeState.currentTimeMs = 0;
	f.control.handlePointer(pointer(200, 120, PointerButton.Secondary, PointerButton.Secondary), true);
	editorRuntimeState.currentTimeMs = 1000; f.control.update();
	assert.deepEqual(camera.capture(), initial); assert.equal(projection.mock.callCount(), 0, 'an idle hold does not reproject');
	f.control.focusTarget.handleKeyboard(new KeyInputEvent('KeyW', KeyModifier.none));
	editorRuntimeState.currentTimeMs = 1100; f.control.update();
	const first = camera.capture();
	assert.notDeepEqual(first, initial); assert.equal(first.space.distance, initial.space.distance);
	assert.ok(f.view.points === points);
	// Speed is an integration contract: the next equally long interval moves twice as far.
	f.control.handleWheel({ viewportX: 200, viewportY: 120, valid: true, insideViewport: true, deltaX: 0, deltaY: -4, modifiers: KeyModifier.none });
	assert.equal(f.view.navigationSpeed, 2); assert.deepEqual(camera.capture(), first);
	assert.equal(pointerCapture.active, true);
	editorRuntimeState.currentTimeMs = 1200; f.control.update();
	const second = camera.capture();
	assert.ok(Math.abs((second.space.centerZ - first.space.centerZ) / (first.space.centerZ - initial.space.centerZ) - 2) < 1e-10);
	f.control.focusTarget.handleKeyboard(new KeyInputEvent('KeyW', KeyModifier.none, false, false));
	editorRuntimeState.currentTimeMs = 1300; f.control.update(); assert.deepEqual(camera.capture(), second);
	pointerCapture.dispatch(pointer(200, 120, 0, 0, PointerButton.Secondary), false, 1300, f.scope.surfaceScope);
	assert.equal(f.menu.visible, false); assert.equal(sources.mock.callCount(), 0);
	assert.ok(f.context.selection === selection);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

for (const retirement of ['release', 'input', 'blur', 'escape', 'source', 'allocation', 'attachment', 'selection', 'mode', 'scope', 'lost button'] as const)
test(`Scene flight drops held keys on ${retirement}, without applying them to a later capture`, t => {
	const f = fixture(t); f.view.camera.setMode('3d'); f.control.update();
	editorRuntimeState.currentTimeMs = 0;
	f.control.handlePointer(pointer(200, 120, PointerButton.Secondary, PointerButton.Secondary), true);
	f.control.focusTarget.handleKeyboard(new KeyInputEvent('KeyW', KeyModifier.none));
	if (retirement === 'release') pointerCapture.dispatch(pointer(200, 120, 0, 0, PointerButton.Secondary), false, 0, f.scope.surfaceScope);
	else if (retirement === 'input') f.control.focusTarget.cancelInput();
	else if (retirement === 'blur') f.panel.focus();
	else if (retirement === 'escape') f.control.focusTarget.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none));
	else if (retirement === 'source') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- edit\n' }]);
	else if (retirement === 'allocation') f.control.layout({ ...BOUNDS, right: 430 });
	else if (retirement === 'attachment') { f.control.clearView(); f.control.setView(f.view, BOUNDS); }
	else if (retirement === 'selection') f.select(1);
	else if (retirement === 'mode') f.view.camera.setMode('2d');
	else if (retirement === 'scope') f.control.focusTarget.scope.retireContext();
	else pointerCapture.dispatch(pointer(200, 120, 0), false, 0, f.scope.surfaceScope);
	const retired = f.view.camera.capture();
	editorRuntimeState.currentTimeMs = 100; f.control.update();
	assert.equal(pointerCapture.active, false); assert.deepEqual(f.view.camera.capture(), retired);
	assert.equal(f.menu.visible, false);
	f.view.camera.setMode('3d'); f.control.update(); const restarted = f.view.camera.capture();
	f.control.handlePointer(pointer(200, 120, PointerButton.Secondary, PointerButton.Secondary), true);
	editorRuntimeState.currentTimeMs = 200; f.control.update();
	assert.deepEqual(f.view.camera.capture(), restarted);
});

for (const mode of ['2d', '3d'] as const)
test(`${mode} camera chords use both-button pan/zoom and Alt-right dolly without selection`, t => {
	const f = fixture(t); f.select(0); f.view.camera.setMode(mode); f.control.update(); const selection = f.context.selection;
	const before = f.view.camera.capture(), both = PointerButton.Primary | PointerButton.Secondary;
	f.control.handlePointer(pointer(200, 120, both, PointerButton.Secondary), true);
	pointerCapture.dispatch(pointer(200, 150, both), false, 0, f.scope.surfaceScope);
	const after = f.view.camera.capture();
	if (mode === '2d') assert.notEqual(after.canvas.scale, before.canvas.scale);
	else {
		assert.equal(after.space.yaw, before.space.yaw); assert.equal(after.space.pitch, before.space.pitch);
		assert.equal(after.space.distance, before.space.distance); assert.notEqual(after.space.centerY, before.space.centerY);
	}
	pointerCapture.dispatch(pointer(200, 150, 0, 0, both), false, 0, f.scope.surfaceScope);
	assert.equal(f.menu.visible, false);
	f.control.handlePointer(pointer(200, 120, PointerButton.Secondary, PointerButton.Secondary, 0, KeyModifier.alt), true);
	pointerCapture.dispatch(pointer(200, 150, PointerButton.Secondary), false, 0, f.scope.surfaceScope);
	if (mode === '3d') assert.notEqual(f.view.camera.capture().space.distance, after.space.distance);
	else assert.notEqual(f.view.camera.capture().canvas.scale, after.canvas.scale);
	pointerCapture.dispatch(pointer(200, 150, 0, 0, PointerButton.Secondary), false, 0, f.scope.surfaceScope);
	assert.equal(f.menu.visible, false); assert.ok(f.context.selection === selection);
	assert.equal(f.model.canUndo, false);
});

test('a flight callback may replace the viewport without moving or cancelling its successor', t => {
	const f = fixture(t), incoming = new SceneViewportViewState(f.context, f.sources.catalog); t.after(() => incoming.dispose());
	f.view.camera.setMode('3d'); f.control.update(); editorRuntimeState.currentTimeMs = 0;
	f.control.handlePointer(pointer(200, 120, PointerButton.Secondary, PointerButton.Secondary), true);
	f.control.focusTarget.handleKeyboard(new KeyInputEvent('KeyW', KeyModifier.none));
	const release = f.view.camera.onDidChange(() => {
		release(); f.control.setView(incoming, BOUNDS); incoming.camera.setMode('3d'); f.control.update();
		f.control.handlePointer(pointer(200, 120, PointerButton.Secondary, PointerButton.Secondary), true);
	}); t.after(release);
	editorRuntimeState.currentTimeMs = 100;
	f.control.focusTarget.handleKeyboard(new KeyInputEvent('KeyW', KeyModifier.none, false, false));
	assert.ok(f.control.view === incoming); assert.equal(pointerCapture.active, true);
	const camera = incoming.camera.capture();
	editorRuntimeState.currentTimeMs = 200; f.control.update(); assert.deepEqual(incoming.camera.capture(), camera);
});

test('an older frame invocation cannot retarget the canvas rebound by source admission', t => {
	const f = fixture(t), incoming = new SceneViewportViewState(f.context, f.sources.catalog); t.after(() => incoming.dispose());
	incoming.camera.pan(31, -47); const before = incoming.camera.capture();
	const invocation = f.panel.getCommand('sceneViewport.frameAll')!.capture!()!;
	const release = f.context.onDidChangeSpatialGeneration(() => { release(); f.control.setView(incoming, BOUNDS); }); t.after(release);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- dependency admission\n' }]);
	assert.doesNotThrow(() => invocation.run());
	assert.ok(f.control.view === incoming); assert.deepEqual(incoming.camera.capture(), before);
});

test('a captured frame request cannot survive detach/rebind or a newer selection intent', t => {
	const f = fixture(t), invocation = f.panel.getCommand('sceneViewport.frameAll')!.capture!()!;
	f.select(1); const before = f.view.camera.capture(); invocation.run(); assert.deepEqual(f.view.camera.capture(), before);
	const next = f.panel.getCommand('sceneViewport.view3d')!.capture!()!;
	f.control.clearView(); f.control.setView(f.view, BOUNDS); next.run(); assert.equal(f.view.camera.mode, '2d');
});

test('reentrant attachment retirement preserves the newer binding and disposal releases source projections', t => {
	const f = fixture(t), incoming = new SceneViewportViewState(f.context, f.sources.catalog), superseded = new SceneViewportViewState(f.context, f.sources.catalog);
	t.after(() => { incoming.dispose(); superseded.dispose(); });
	const release = f.control.focusTarget.scope.onDidRetireContext(() => { release(); f.control.setView(incoming, BOUNDS); }); t.after(release);
	f.control.setView(superseded, BOUNDS); assert.ok(f.control.view === incoming);
	const retired = f.control.focusTarget.scope.onDidRetireContext(() => { retired(); f.control.setView(superseded, BOUNDS); }); t.after(retired);
	f.control.dispose(); assert.equal(f.control.canFocus, false);
	incoming.dispose(); assert.equal(incoming.source, undefined); assert.equal(incoming.selected, undefined); assert.equal(incoming.entries.length, 0);
});
