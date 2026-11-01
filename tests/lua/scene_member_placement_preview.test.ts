import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { pointerHover } from '../../ide/input/pointer/hover';
import { api } from '../../ide/runtime/overlay_api';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneViewportControl } from '../../ide/workbench/contrib/scene_editor/viewport/control';
import { SceneViewportViewState } from '../../ide/workbench/contrib/scene_editor/viewport/view_state';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { WorkspaceImageAssets } from '../../ide/workspace/image_assets';
import { createPackedImageFixture } from '../helpers/packed_images';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { HostBitmapRenderSubmission } from '../../machine/ts/render/host_overlay/bitmap';

const BOUNDS = { left: 10, top: 20, right: 410, bottom: 260 };
const PREFABS = `local prefab=require('cartlib/world/prefab')
local sprite=require('cartlib/component/sprite_component')
local object=require('cartlib/world/object_2d')
prefab.define({def_id='shape',class=object,
 transform={xx=-2,xy=1,yx=0.5,yy=3,ox=900,oy=-500},
 components={sprite.factory({imgid='shape',color=0xff234567,flip_h=true,
 attachment_affine={1,0,0,1,2,3},presentation_affine={1,0,0,1,-1,4}})}})
prefab.define({def_id='custom',class=object,components={custom_visual}})`;

function pointer(x: number, y: number, pressed = 0, justPressed = 0): PointerInputSnapshot {
	return { viewportX: x, viewportY: y, pressedButtons: pressed, justPressedButtons: justPressed, justReleasedButtons: 0,
		valid: true, insideViewport: true, modifiers: KeyModifier.none, spaceDown: false };
}

function fixture(t: TestContext) {
	configureFontVariant('tiny');
	const source = `local scenes=require('cartlib/world/scene_library')
require('prefabs')
scenes.register('main',{objects={{member_id='old',definition_id='shape',position={x=1,y=2}}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [
		['cartlib/world/prefab.lua', 'return {define=function() end}'], ['prefabs.lua', PREFABS],
		['cartlib/component/sprite_component.lua', 'return {new=function() end,factory=function() end}'],
	]);
	const packed = createPackedImageFixture('shape', 2, 2, new Uint8Array(16).fill(255));
	const provider = f.sources.catalog.getContext(f.model.identity.contextId);
	provider.previewRom!.bytes = packed.bytes; provider.previewRom!.index.entries.push(...packed.entries);
	provider.previewPackage.img.shape = packed.image; f.sources.catalog.rebuildResources();
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, sourceVersion: f.model.version, scene: document.scenes[0] });
	const view = new SceneViewportViewState(context, f.sources.catalog), scope = new InputFocusScope(Symbol('placement preview'), inputFocus.workbenchScope);
	const parent = inputFocus.createTarget(null, scope), control = new SceneViewportControl(scope, parent);
	control.setView(view, BOUNDS);
	const camera = view.camera.capture();
	view.camera.restore({ ...camera, mode: '2d', modeIntent: 'manual', canvas: { centerX: 0, centerY: 0, scale: 2, reading: 'manual' } });
	control.update();
	const prefab = resolveLuaTextFileModel(f.models, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: f.model.identity.contextId, path: 'prefabs.lua' })!);
	const arm = (id = 'shape') => {
		const request = context.captureAddMember('2d')!, choice = request.choices.find(choice => choice.id === id)!;
		assert.equal(control.beginAddMember(request, choice, () => {}), true);
		return { request, choice };
	};
	t.after(() => { control.dispose(); view.dispose(); context.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	return { ...f, source, context, view, scope, control, prefab, arm };
}

for (const unavailable of ['pose', 'visibility'] as const) test(`unavailable ${unavailable} never turns into an invented placement image`, t => {
	const f = fixture(t), text = f.prefab.buffer.getText();
	const offset = text.indexOf(unavailable === 'pose' ? 'xx=-2' : "def_id='shape',");
	f.prefab.pushEditOperations(unavailable === 'pose'
		? [{ offset: offset + 3, deleteLength: 2, text: 'compute_scale()' }]
		: [{ offset: offset + "def_id='shape',".length, deleteLength: 0, text: 'defaults={visible=false},' }]);
	const request = f.context.captureAddMember('2d')!, choice = request.choices.find(choice => choice.id === 'shape')!;
	assert.ok(choice); const preview = request.getPreview(choice);
	if (unavailable === 'pose') assert.equal(preview, undefined);
	else assert.equal(preview!.visuals.canvas.length, 0);
	assert.equal(f.control.beginAddMember(request, choice, () => {}), true);
	f.control.handlePointer(pointer(244, 186), false);
	assert.equal(f.view.placementCanvas.items.length, 0); assert.equal(f.model.buffer.getText(), f.source);
	f.control.handlePointer(pointer(244, 186, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(f.context.subject!.objects.length, 2);
});

test('placement borrows the existing atlas and retains its geometry without source edits or asset work on pointer motion', t => {
	const f = fixture(t), original = f.view.canvas.items[0]; assert.ok(original.kind === 'sprite');
	const bitmap = original.bitmap, version = f.model.version;
	f.arm(); const preview = f.view.placementPreview!, sprite = f.view.placementCanvas.items[0];
	assert.ok(sprite.kind === 'sprite');
	assert.equal(sprite.bitmap, bitmap); assert.equal(f.view.canvas.items[0], original);
	const updates = t.mock.method(WorkspaceImageAssets.prototype, 'update');
	const scenePreparation = t.mock.method(f.view.canvas, 'prepare');
	for (let step = 0; step < 100; step++) {
		f.control.handlePointer(pointer(244 + step, 186), false);
		assert.equal(f.view.placementPreview, preview); assert.equal(f.view.placementCanvas.items[0], sprite);
		assert.equal(sprite.bitmap, bitmap); assert.equal(f.view.canvas.items[0], original);
	}
	assert.equal(updates.mock.callCount(), 0); assert.equal(scenePreparation.mock.callCount(), 0);
	assert.equal(preview.world.ox, 67); assert.equal(preview.world.oy, 23);
	assert.equal(f.model.version, version); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	let disposed = 0; bitmap.onDispose(() => disposed++);
	inputFocus.handleKeyboard(new KeyInputEvent('Escape', KeyModifier.none)); f.control.update();
	assert.equal(f.view.placementPreview, undefined); assert.equal(f.view.placementCanvas.items.length, 0);
	const restored = f.view.canvas.items[0]; assert.ok(restored.kind === 'sprite');
	assert.equal(restored.bitmap, bitmap); assert.equal(disposed, 0);
	f.view.dispose(); assert.equal(disposed, 1);
});

test('the ghost and committed sprite have the same footprint, inherited linear pose and visual inputs', t => {
	const f = fixture(t); f.arm(); f.control.handlePointer(pointer(244, 186), false);
	const ghost = f.view.placementCanvas.items[0];
	assert.ok(ghost.kind === 'sprite');
	// Preview-to-source correspondence is a geometric data contract, not a fixed UI rectangle.
	const footprint = [ghost.x, ghost.y, ghost.xx, ghost.xy, ghost.yx, ghost.yy, ghost.u0, ghost.v0, ghost.u1, ghost.v1];
	const affine = { ...ghost.affine }, bitmap = ghost.bitmap;
	f.control.handlePointer(pointer(244, 186, PointerButton.Primary, PointerButton.Primary), true); f.control.update();
	assert.equal(f.view.placementPreview, undefined); assert.equal(f.view.placementCanvas.items.length, 0);
	const selected = f.context.selection!; assert.equal(selected.kind, 'member');
	if (selected.kind !== 'member') throw new Error('expected inserted member');
	const sprite = f.view.canvas.items.find(sprite => sprite.source.entry === selected.entry)!;
	assert.ok(sprite.kind === 'sprite' && sprite.source.kind === 'sprite');
	assert.equal(sprite.bitmap, bitmap); assert.deepEqual(sprite.affine, affine);
	assert.deepEqual([sprite.x, sprite.y, sprite.xx, sprite.xy, sprite.yx, sprite.yy, sprite.u0, sprite.v0, sprite.u1, sprite.v1], footprint);
	assert.equal(f.context.selectedLocalTransform!.ox, 17); assert.equal(f.context.selectedLocalTransform!.oy, 23);
	assert.equal(sprite.source.color, 0xff234567); assert.equal(sprite.source.flipH, true);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('painting a located ghost uses translucent real texture; leaving the canvas hides it without cancelling Add', t => {
	const f = fixture(t); f.arm();
	pointerHover.beginDispatch(f.scope.surfaceScope); f.control.handlePointer(pointer(244, 186), false); pointerHover.endDispatch();
	f.control.update();
	const overlay = createHostOverlayFixture(450, 300);
	const paint = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); f.control.draw(); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), bitmaps: HostBitmapRenderSubmission[] = [];
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Bitmap)
			bitmaps.push(frame.commandRefs[index] as HostBitmapRenderSubmission);
		return bitmaps;
	};
	const draws = paint(); assert.equal(draws.length, 2);
	const alpha = draws[1].color >>> 24;
	assert.ok(alpha > 0 && alpha < 255, 'the insertion preview is visually distinct from committed content');
	const natural = t.mock.method(editorViewState.font.renderFont(), 'measure'), ranges = t.mock.method(editorViewState.font, 'measureTextRange');
	for (let step = 0; step < 20; step++) {
		f.control.handlePointer(pointer(244 + step, 186), false); f.control.update(); paint();
	}
	assert.equal(natural.mock.callCount(), 0, 'steady ghost motion and paint retain prepared annotation widths');
	assert.equal(ranges.mock.callCount(), 0, 'steady ghost motion and paint do not re-truncate annotation text');
	pointerHover.beginDispatch(f.scope.surfaceScope); pointerHover.endDispatch();
	assert.equal(paint().length, 1); assert.ok(f.view.placementPreview !== undefined);
	f.control.handlePointer(pointer(250, 190, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(f.context.subject!.objects.length, 2);
});

const RETIREMENTS: readonly [string, (f: ReturnType<typeof fixture>) => void][] = [
	['provider replacement', f => f.prefab.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- new provider\n' }])],
	['read-only source', f => f.model.refreshResource({ ...f.model.resource, source: { ...f.model.resource.source, generated: true } })],
	['scope retirement', f => f.control.focusTarget.scope.retireContext()],
	['perspective mode', f => f.view.camera.setMode('3d')],
	['canvas detach', f => f.control.clearView()],
];
for (const [name, retire] of RETIREMENTS) test(`${name} revokes the ghost and its placement instead of committing it`, t => {
	const f = fixture(t); f.arm(); f.control.handlePointer(pointer(244, 186), false);
	assert.equal(f.view.placementCanvas.items.length, 1);
	retire(f); f.control.update();
	assert.equal(f.view.placementPreview, undefined);
	f.control.handlePointer(pointer(260, 195, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('a custom-only prefab remains placeable without inventing a sprite or reusing the previous ghost', t => {
	const f = fixture(t); f.arm(); f.control.handlePointer(pointer(244, 186), false);
	assert.equal(f.view.placementCanvas.items.length, 1);
	f.arm('custom'); f.control.handlePointer(pointer(250, 190), false);
	assert.equal(f.view.placementCanvas.items.length, 0); assert.equal(f.model.buffer.getText(), f.source);
	f.control.handlePointer(pointer(250, 190, PointerButton.Primary, PointerButton.Primary), true);
	assert.equal(f.context.subject!.objects.length, 2); assert.equal(f.view.canvas.items.length, 1);
	f.model.undo(); assert.equal(f.model.buffer.getText(), f.source);
});
