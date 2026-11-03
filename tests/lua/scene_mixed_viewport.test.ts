import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import type { PointerInputSnapshot } from '../../ide/common/models';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { inputFocus, InputFocusScope } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { api } from '../../ide/runtime/overlay_api';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneViewportControl } from '../../ide/workbench/contrib/scene_editor/viewport/control';
import { drawSceneViewport } from '../../ide/workbench/contrib/scene_editor/viewport/render';
import { TranslateHandle } from '../../ide/workbench/contrib/scene_editor/viewport/translate_gizmo';
import { SceneViewportViewState } from '../../ide/workbench/contrib/scene_editor/viewport/view_state';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { WorkbenchMenu } from '../../ide/workbench/ui/menu/model';
import { WorkspaceImageAssets } from '../../ide/workspace/image_assets';
import { WorkspaceModelAssets } from '../../ide/workspace/model_assets';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { createHeadlessHostMeshTarget, renderHeadlessHostMeshScene } from '../../machine/ts/render/host_overlay/headless/mesh';
import { createPackedImageFixture } from '../helpers/packed_images';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { SCENE_TEXT_MODULES } from '../fixtures/studio/scene_text';

const BOUNDS = { left: 0, top: 0, right: 400, bottom: 300 };
const SOURCE = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
local sprite=require('cartlib/component/sprite_component')
local text=require('cartlib/text/text_component')
local model=require('cartlib/component/static_model_component')
local font=require('cartlib/font')
font.define('custom',{glyphs={['A']='glyph_a'},line_height=4,advance_padding=1})
prefab.define({def_id='tile',class=require('cartlib/world/object_2d'),
 components={sprite.factory({imgid='tile',attachment_affine={1,0,0,1,1,2},presentation_affine={1,0,0,1,2,0}})}})
prefab.define({def_id='caption',class=require('cartlib/world/object_2d'),
 components={text.factory({font=font.get('custom'),text='AA',color=0xff00ff00,background_color=0xffffff00})}})
prefab.define({def_id='mesh',class=require('cartlib/world/object_3d'),components={model.factory({model_id='mesh'})}})
scenes.register('mixed',{objects={
 {member_id='tile',definition_id='tile',position={x=0,y=0}},
 {member_id='caption',definition_id='caption',position={x=9,y=2}},
 {member_id='mesh',definition_id='mesh',position={x=3,y=-2,z=-1}},
}})`;

function pointer(x: number, y: number, pressed: number = PointerButton.Primary, justPressed = 0, justReleased = 0): PointerInputSnapshot {
	return { viewportX: x, viewportY: y, pressedButtons: pressed, justPressedButtons: justPressed, justReleasedButtons: justReleased,
		valid: true, insideViewport: true, modifiers: KeyModifier.none, spaceDown: false };
}

function fixture(t: TestContext, source = SOURCE) {
	configureFontVariant('tiny');
	const f = createSceneSourceFixture(t, source, 'mixed.lua', undefined, [...SCENE_TEXT_MODULES,
		['cartlib/component/sprite_component.lua', 'return {new=function() end,factory=function() end}'],
		['cartlib/component/static_model_component.lua', 'return {new=function() end,factory=function() end}'],
	]);
	const pixels = new Uint8Array(8 * 4 * 4);
	for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) {
		if (x < 2 || x === 5 && y === 1) pixels.set(x < 2 ? [255, 0, 0, 255] : [255, 255, 255, 255], (y * 8 + x) * 4);
	}
	const packed = createPackedImageFixture('tile', 8, 4, pixels);
	packed.image.imgmeta!.width = 4;
	const glyph = { ...packed.image, resid: 'glyph_a', imgmeta: { ...packed.image.imgmeta!, width: 3, texture_u: 4 } };
	const provider = f.sources.catalog.getContext(f.model.identity.contextId);
	provider.previewRom!.bytes = packed.bytes; provider.previewRom!.index.entries.push(...packed.entries, glyph);
	provider.previewPackage.img.tile = packed.image; provider.previewPackage.img.glyph_a = glyph;
	provider.previewPackage.model.mesh = { name: 'mesh', materials: [{ baseColorFactor: [0, 0, 1, 1], doubleSided: true }],
		meshes: [{ primitives: [{ positions: new Float32Array([0, 0, 0, 4, 0, 0, 4, -4, 0, 0, -4, 0]),
			indices: new Uint8Array([0, 1, 2, 0, 2, 3]), indexComponentType: 5121, materialIndex: 0 }] }],
		nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
	f.sources.catalog.rebuildResources();
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version });
	const view = new SceneViewportViewState(context, f.sources.catalog);
	const scope = new InputFocusScope(Symbol('mixed'), inputFocus.workbenchScope), panel = inputFocus.createTarget(null, scope);
	panel.commandContext = panel;
	const menu = new ContextMenuController(inputFocus, pointerCapture, BOUNDS);
	const control = new SceneViewportControl({ isEnabled: () => false, execute() {} }, menu, scope, panel, new WorkbenchMenu([], undefined));
	control.setView(view, BOUNDS); view.camera.setMode('3d'); view.frame(undefined);
	const state = view.camera.capture(); view.camera.restore({ ...state, space: { ...state.space, yaw: 0, pitch: 0 } }); control.update();
	const select = (index: number) => {
		const scene = context.subject!;
		context.select(context.document!, f.model.version, { kind: 'member', scene, entry: scene.objects[index], index }); control.update();
	};
	t.after(() => { control.dispose(); view.dispose(); context.dispose(); menu.dispose(); inputFocus.setTarget(null); pointerCapture.interrupt(false); });
	return { ...f, context, view, control, scope, select };
}

test('orbit viewport renders sprites, glyphs, backgrounds and models together and picks their authored members', t => {
	const f = fixture(t), { view } = f, entries = f.context.subject!.objects;
	assert.equal(view.camera.mode, '3d'); assert.equal(view.geometry.scene.instances.length, 4);
	assert.deepEqual([...view.geometry.represented], [entries[2], entries[0], entries[1]]);
	const target = createHeadlessHostMeshTarget(view.geometry.scene); renderHeadlessHostMeshScene(target, view.geometry.scene);
	// Pixel assertions exercise the actual renderer/projection, not incidental UI placement.
	for (const [x, y, z, entry, color] of [
		[3.5, -3.5, 0, entries[0], [255, 0, 0, 255]],
		[6.5, -3.5, -1, entries[2], [0, 0, 255, 255]],
		[10.5, -3.5, 0, entries[1], [0, 255, 0, 255]],
		[9.5, -2.5, 0, entries[1], [255, 255, 0, 255]],
	] as const) {
		const px = Math.trunc(200 + view.camera.projectX(x, y, z)), py = Math.trunc(150 + view.camera.projectY(x, y, z));
		assert.equal(view.pick(px + 0.5, py + 0.5), entry);
		const offset = (py * target.width + px) * 4;
		assert.deepEqual([...target.pixels.subarray(offset, offset + 4)], color);
	}
	const overlay = createHostOverlayFixture(400, 300);
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); drawSceneViewport(view, false); overlay.renderer.endFrame();
	const frame = overlay.queue.consumeOverlayFrame();
	assert.equal(frame.commandKinds.slice(0, frame.commandCount).filter(kind => kind === Host2DKind.MeshScene).length, 1,
		'all source content shares one depth pass, not a separate canvas painted on top');
	f.select(0); view.frame(view.selected); f.control.update();
	assert.equal(view.camera.mode, '3d'); assert.ok(view.canvas.outlines[0].visible);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('oblique planar alpha picking follows the affine texels actually rasterized, not perspective-correct UVs', t => {
	const f = fixture(t), { view } = f, entries = f.context.subject!.objects, reading = view.camera.capture();
	view.camera.restore({ ...reading, space: { ...reading.space, yaw: 0.8, pitch: 0.4 } }); f.control.update();
	const target = createHeadlessHostMeshTarget(view.geometry.scene); renderHeadlessHostMeshScene(target, view.geometry.scene);
	const owners = new Set();
	for (let y = 3; y < target.height; y += 7) for (let x = 3; x < target.width; x += 7) {
		const offset = (y * target.width + x) * 4, pixels = target.pixels;
		if (pixels[offset + 3] === 0) continue;
		const expected = pixels[offset + 2] === 255 ? entries[2] : pixels[offset + 1] === 255 ? entries[1] : entries[0];
		assert.ok(view.geometry.pick(x + 0.5 - 200, y + 0.5 - 150, view.camera)?.entry === expected, `visible owner at ${x}/${y}`);
		owners.add(expected);
	}
	assert.equal(owners.size, 3);
});

test('orbit and selection retain planar meshes and borrowed bitmap generations without asset rediscovery', t => {
	const f = fixture(t), { view } = f, instances = view.geometry.scene.instances.slice();
	const revision = view.geometry.scene.revision;
	for (let frame = 0; frame < 50; frame++) view.refresh();
	assert.equal(view.geometry.scene.revision, revision);
	t.mock.method(WorkspaceImageAssets.prototype, 'get', () => assert.fail('camera motion must not rediscover images'));
	t.mock.method(WorkspaceModelAssets.prototype, 'get', () => assert.fail('camera motion must not rediscover models'));
	for (let step = 0; step < 20; step++) {
		view.camera.orbit(2, 1); f.select(step % 3); view.refresh();
		assert.ok(view.geometry.scene.instances.every((draw, index) => draw === instances[index]));
	}
	let retired = 0, bitmapRetired = 0;
	const planar = instances[1].mesh; planar.onDispose(() => retired++); planar.texture!.bitmap.onDispose(() => bitmapRetired++);
	view.geometry.dispose(); assert.equal(retired, 1); assert.equal(bitmapRetired, 0, 'geometry borrows the shared image owner');
});

test('a long caption batches its atlas glyphs without merging authored owners or rescanning layout on translation', t => {
	const f = fixture(t, SOURCE.replace("text='AA'", `text='${'A'.repeat(512)}'`)), { view } = f;
	assert.equal(view.geometry.scene.instances.length, 4, 'one model, one sprite, one text-background batch and one glyph batch');
	const glyphs = view.geometry.scene.instances[3].mesh;
	assert.equal(glyphs.drawCount, 512 * 6);
	f.select(1);
	const world = { ...view.source!.worlds.get(view.selected!)! }, preview = { worlds: new Map([[view.selected!, world]]), revision: 0 };
	view.transformPreview = preview;
	const packets = view.canvas.packetRevision;
	for (let step = 0; step < 50; step++) {
		world.ox++; preview.revision++; view.refresh();
		assert.equal(view.canvas.packetRevision, packets); assert.equal(view.geometry.scene.instances[3].mesh, glyphs);
	}
});

for (const [yaw, pitch] of [[0, 0], [0.6, 0.3]]) test(`planar drag in orbit ${yaw}/${pitch} edits only the member position and Undo restores rendered content`, t => {
	const f = fixture(t), { view } = f, reading = view.camera.capture();
	view.camera.restore({ ...reading, space: { ...reading.space, yaw, pitch } }); f.select(0);
	const before = createHeadlessHostMeshTarget(view.geometry.scene); renderHeadlessHostMeshScene(before, view.geometry.scene);
	const original = before.pixels.slice(), x = view.gizmo.x, y = view.gizmo.y;
	assert.equal(view.gizmo.visibleAxes & TranslateHandle.Z, 0);
	assert.equal(f.control.handlePointer(pointer(x, y, PointerButton.Primary, PointerButton.Primary), true), true);
	assert.ok(pointerCapture.active);
	const nx = 200 + view.camera.projectX(4, -3, 0), ny = 150 + view.camera.projectY(4, -3, 0);
	pointerCapture.dispatch(pointer(nx, ny), false, 0, f.scope.surfaceScope);
	assert.equal(f.model.buffer.getText(), SOURCE, 'pointer motion is a retained proposal, not repeated source writes');
	renderHeadlessHostMeshScene(before, view.geometry.scene); assert.ok(before.pixels.some((value, index) => value !== original[index]), 'moving the member changes rendered content');
	pointerCapture.dispatch(pointer(nx, ny, 0, 0, PointerButton.Primary), false, 0, f.scope.surfaceScope);
	f.control.update();
	const selected = view.selected!, world = view.source!.worlds.get(selected)!;
	assert.equal(world.family, '2d'); assert.ok(Math.abs(world.ox - 4) < 1e-10); assert.ok(Math.abs(world.oy - 3) < 1e-10);
	const source = f.model.buffer.getText();
	assert.equal(source.slice(0, source.indexOf("position={x=")), SOURCE.slice(0, SOURCE.indexOf("position={x=")));
	assert.equal(source.slice(source.indexOf("{member_id='caption'")), SOURCE.slice(SOURCE.indexOf("{member_id='caption'")));
	assert.equal(f.model.canUndo, true); f.model.undo(); f.control.update();
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	renderHeadlessHostMeshScene(before, view.geometry.scene); assert.deepEqual(before.pixels, original);
	assert.equal(view.camera.mode, '3d');
});
