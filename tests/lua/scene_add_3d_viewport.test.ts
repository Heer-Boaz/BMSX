import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneViewportControl } from '../../ide/workbench/contrib/scene_editor/viewport/control';
import { SceneViewportViewState } from '../../ide/workbench/contrib/scene_editor/viewport/view_state';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import type { GLTFModel } from '../../toolchain/ts/rompack/gltf';
import { packModelAsset } from '../../toolchain/ts/rompack/model_asset';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const BOUNDS = { left: 10, top: 20, right: 650, bottom: 500 };
const SOURCE = `local scenes=require('cartlib/world/scene_library')
require('prefabs')
scenes.register('space',{objects={}})`;
const PREFABS = `local prefab=require('cartlib/world/prefab')
local model=require('cartlib/component/static_model_component')
prefab.define({def_id='actor',class=require('cartlib/world/object_2d')})
prefab.define({def_id='mesh',class=require('cartlib/world/object_3d'),
 components={model.factory({model_id='shape'})}})`;

function pointer(x: number, y: number, buttons = 0, pressed = 0, released = 0): PointerInputSnapshot {
	return { viewportX: x, viewportY: y, pressedButtons: buttons, justPressedButtons: pressed, justReleasedButtons: released,
		valid: true, insideViewport: true, modifiers: KeyModifier.none, spaceDown: false };
}

function fixture(t: TestContext) {
	configureFontVariant('tiny');
	const f = createSceneSourceFixture(t, SOURCE, 'scene.lua', undefined, [
		['cartlib/world/prefab.lua', 'return {define=function() end}'], ['prefabs.lua', PREFABS],
		['cartlib/component/static_model_component.lua', 'return {new=function() end,factory=function() end}'],
	]);
	// This host regression owns its packed geometry; no normal or shipped cart is read.
	const asset: GLTFModel = { name: 'shape', meshes: [{ primitives: [{
		positions: new Float32Array([-1, 0, 0, 1, 0, 0, 0, 2, 0]),
		indices: new Uint8Array([0, 1, 2]), indexComponentType: 5121, materialIndex: 0,
	}] }], materials: [{ baseColorFactor: [0.2, 0.6, 0.9, 1], unlit: true, doubleSided: true }],
		nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
	const assets = f.sources.catalog.getContext(f.model.identity.contextId);
	assets.previewRom!.bytes = packModelAsset(asset).buffer; assets.previewPackage.model.shape = asset;
	f.sources.catalog.rebuildResources();
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version });
	const menu = new ContextMenuController(inputFocus, pointerCapture, BOUNDS);
	const view = new SceneViewportViewState(context, f.sources.catalog), scope = new InputFocusScope(Symbol('3D Add'), inputFocus.workbenchScope);
	const panel = inputFocus.createTarget(null, scope), control = new SceneViewportControl({ isEnabled: () => false, execute() {} }, menu, scope, panel, new WorkbenchMenu([], undefined));
	control.setView(view, BOUNDS); view.camera.setMode('3d'); control.update();
	const provider = resolveLuaTextFileModel(f.models, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.model.identity.contextId, path: 'prefabs.lua' })!);
	const x = (BOUNDS.left + BOUNDS.right) / 2 + 43.25, y = (BOUNDS.top + BOUNDS.bottom) / 2 + 71.5;
	const ground = (pointerX = x, pointerY = y) => {
		const point = { x: 0, y: 0, z: 0 };
		assert.equal(view.camera.unprojectGround3d(pointerX - (BOUNDS.left + BOUNDS.right) / 2, pointerY - (BOUNDS.top + BOUNDS.bottom) / 2, point), true);
		return point;
	};
	const click = (pointerX = x, pointerY = y) => control.handlePointer(pointer(pointerX, pointerY, PointerButton.Primary, PointerButton.Primary), true);
	t.after(() => { control.dispose(); view.dispose(); context.dispose(); menu.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	return { ...f, assets, asset, provider, context, view, control, x, y, ground, click };
}

test('3D Add offers only its family and arms the existing packed-model preview without source or history', t => {
	const f = fixture(t), three = f.context.captureAddMember('3d')!, two = f.context.captureAddMember('2d')!;
	assert.deepEqual(three.choices, [{ id: 'mesh', family: '3d' }]);
	assert.deepEqual(two.choices, [{ id: 'actor', family: '2d' }]);
	assert.equal(f.context.canAddMember('2d'), true); assert.equal(f.context.canAddMember('3d'), true);
	assert.equal(f.control.beginAddMember(two, two.choices[0], () => assert.fail('wrong family placed')), false);
	assert.equal(f.control.beginAddMember(three, three.choices[0], () => assert.fail('hover placed')), true);
	const version = f.model.version;
	for (let frame = 0; frame < 30; frame++) f.control.handlePointer(pointer(f.x + frame / 10, f.y), false);
	assert.equal(f.view.placementGeometry.scene.instances.length, 1); assert.equal(f.view.geometry.scene.instances.length, 0);
	assert.equal(f.view.placementPreview!.world.family, '3d');
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.version, version);
	assert.equal(f.model.canUndo, false); assert.equal(f.model.dirty, false);
	assert.equal(f.provider.buffer.getText(), PREFABS); assert.deepEqual(f.context.getWorkingCopies(), [f.model]);
});

test('a 3D pointer placement publishes once, retains preview geometry and is removed/restored by one Undo/Redo', t => {
	const f = fixture(t), request = f.context.captureAddMember('3d')!; let placed = 0, changes = 0;
	t.after(f.model.onDidChangeContent(() => changes++));
	assert.equal(f.control.beginAddMember(request, request.choices[0], () => placed++), true);
	f.control.handlePointer(pointer(f.x, f.y), false);
	const expected = f.ground(), ghost = f.view.placementGeometry.scene.instances[0], mesh = ghost.mesh;
	assert.ok(ghost); assert.equal(ghost.ox, expected.x); assert.equal(ghost.oy, 0); assert.equal(ghost.oz, expected.z);
	// Exact world coordinates are the pointer-to-source contract. 3D placement
	// must not inherit 2D's pixel snapping or assert incidental widget geometry.
	assert.ok(expected.x !== Math.round(expected.x) && expected.z !== Math.round(expected.z));
	f.click();
	assert.equal(changes, 1); assert.equal(placed, 1); assert.equal(request.isCurrent(), false);
	assert.equal(f.context.subject!.objects.length, 1); assert.equal(f.model.canUndo, true);
	const selected = f.context.selection!; assert.ok(selected.kind === 'member' && selected.entry.kind === 'object');
	const pose = f.context.selectedLocalTransform!; assert.ok(pose.family === '3d');
	assert.equal(pose.ox, expected.x); assert.equal(pose.oy, 0); assert.equal(pose.oz, expected.z);
	assert.equal(readLuaSourceRange(f.model.buffer, f.context.document!.analysis.chunk.locations.range(selected.entry.field.span)),
		`{ member_id = 'mesh', definition_id = 'mesh', position = { x = ${expected.x}, y = 0, z = ${expected.z} } }`);
	const committed = f.model.buffer.getText(), draw = f.view.geometry.scene.instances[0];
	assert.equal(draw.mesh, mesh); assert.equal(draw.ox, ghost.ox); assert.equal(draw.oy, ghost.oy); assert.equal(draw.oz, ghost.oz);
	assert.equal(f.view.placementPreview, undefined); assert.equal(f.view.placementGeometry.scene.instances.length, 0);
	f.control.handlePointer(pointer(f.x, f.y, 0, 0, PointerButton.Primary), false);
	assert.equal(f.model.buffer.getText(), committed); assert.equal(changes, 1); assert.equal(pointerCapture.active, false);
	f.model.undo(); f.control.update();
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false); assert.equal(f.model.dirty, false);
	assert.equal(f.view.geometry.scene.instances.length, 0); assert.equal(f.context.subject!.objects.length, 0);
	f.model.redo(); f.control.update();
	assert.equal(f.model.buffer.getText(), committed); assert.equal(f.view.geometry.scene.instances.length, 1);
	assert.equal(f.provider.buffer.getText(), PREFABS);
});

test('same-family camera zoom and pan keep Add armed and move its ghost along the retained pointer ray', t => {
	const f = fixture(t), request = f.context.captureAddMember('3d')!; let placed = 0;
	assert.equal(f.control.beginAddMember(request, request.choices[0], () => placed++), true);
	f.control.handlePointer(pointer(f.x, f.y), false);
	const ghost = f.view.placementGeometry.scene.instances[0], mesh = ghost.mesh, before = [ghost.ox, ghost.oy, ghost.oz];
	const wheelX = f.x + 37.5, wheelY = f.y + 29.25, anchor = f.ground(wheelX, wheelY);
	assert.equal(f.control.handleWheel({ ...pointer(wheelX, wheelY), deltaX: 0, deltaY: -30 }), true);
	// The wheel event's current ray owns the dolly anchor, not the previous
	// pointer position or orbit-pivot plane. Large zoom must preserve that point.
	assert.ok(Math.abs(ghost.ox - anchor.x) < 1e-9); assert.ok(Math.abs(ghost.oz - anchor.z) < 1e-9);
	f.view.camera.pan(23, -9); f.control.update();
	const point = f.ground(wheelX, wheelY);
	assert.equal(f.view.placementGeometry.scene.instances[0], ghost); assert.equal(ghost.mesh, mesh);
	assert.equal(ghost.ox, point.x); assert.equal(ghost.oy, 0); assert.equal(ghost.oz, point.z);
	assert.notDeepEqual([ghost.ox, ghost.oy, ghost.oz], before);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false); assert.equal(placed, 0);
	f.click(wheelX, wheelY); assert.equal(placed, 1);
	const pose = f.context.selectedLocalTransform!; assert.ok(pose.family === '3d');
	assert.equal(pose.ox, point.x); assert.equal(pose.oz, point.z);
});

for (const miss of ['parallel', 'behind'] as const) test(`${miss} ground ray cannot insert a source member, and Escape still cancels`, t => {
	const f = fixture(t), state = f.view.camera.capture();
	f.view.camera.restore({ ...state, space: { ...state.space, originY: 2, pitch: 0 } });
	const request = f.context.captureAddMember('3d')!; let placed = 0;
	assert.equal(f.control.beginAddMember(request, request.choices[0], () => placed++), true);
	const x = (BOUNDS.left + BOUNDS.right) / 2, y = (BOUNDS.top + BOUNDS.bottom) / 2 - (miss === 'behind' ? 100 : 0);
	f.control.handlePointer(pointer(x, y), false);
	f.control.handlePointer(pointer(x, y, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false); assert.equal(placed, 0);
	assert.ok(f.view.placementPreview !== undefined, 'a missed plane remains armed, without an invented placement');
	inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none)); f.control.update();
	assert.equal(f.view.placementPreview, undefined); assert.equal(f.view.placementGeometry.scene.instances.length, 0);
	f.click(); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

const RETIREMENTS: readonly [string, (f: ReturnType<typeof fixture>) => void][] = [
	['camera family change', f => f.view.camera.setMode('2d')],
	['source revision', f => f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed\n' }])],
	['prefab provider revision', f => f.provider.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed\n' }])],
	['packed asset generation', f => { f.assets.previewRom!.bytes = f.assets.previewRom!.bytes.slice(); f.sources.catalog.rebuildResources(); }],
	['viewport attachment', f => f.control.clearView()],
];
for (const [reason, retire] of RETIREMENTS) test(`${reason} retires armed 3D Add without publishing its preview`, t => {
	const f = fixture(t), request = f.context.captureAddMember('3d')!; let placed = 0;
	assert.equal(f.control.beginAddMember(request, request.choices[0], () => placed++), true);
	f.control.handlePointer(pointer(f.x, f.y), false); assert.equal(f.view.placementGeometry.scene.instances.length, 1);
	retire(f); f.control.update();
	const source = f.model.buffer.getText(), version = f.model.version, canUndo = f.model.canUndo;
	f.click();
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.version, version); assert.equal(f.model.canUndo, canUndo);
	assert.equal(f.context.subject!.objects.length, 0); assert.equal(placed, 0); assert.equal(f.view.placementPreview, undefined);
});
