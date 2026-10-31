import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { HostBitmapRenderSubmission } from '../../machine/ts/render/host_overlay/bitmap';
import { createActualSourcePanes } from '../helpers/source_panes';
import { createPackedImageFixture } from '../helpers/packed_images';

const SOURCE = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
local sprites=require('cartlib/component/sprite_component')
prefab.define({def_id='paint',class={},spatial={family='2d',authority='affine'},
 components={sprites.factory({id_local='picture',imgid='sheet'})}})
scenes.register('painting',{objects={
 {member_id='back',definition_id='paint'},
 {member_id='front',definition_id='paint',spatial={local_transform={1,0.25,0.5,1,0,0}},
  initial={picture={order=1,flip_h=true}}},
}})`;

async function fixture(t: TestContext, font: 'tiny' | 'msx') {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['cartlib/world/prefab.lua', 'return { define=function() end }'],
		['cartlib/world/scene_library.lua', 'return {}'], ['cartlib/world/world_object.lua', 'return {}'], ['cartlib/component/sprite_component.lua',
			'return { new=function() end, factory=function(definition) return function() end end }']]);
	const pixels = new Uint8Array(8 * 8 * 4);
	for (let offset = 0; offset < pixels.length; offset += 4) { pixels[offset + 1] = 255; pixels[offset + 3] = 255; }
	pixels[(1 * 8 + 1) * 4 + 1] = pixels[(1 * 8 + 1) * 4 + 3] = 0;
	const packed = createPackedImageFixture('sheet', 8, 8, pixels);
	const context = f.sources.catalog.getContext(f.sources.systemContextId);
	context.previewRom!.bytes = packed.bytes; context.previewRom!.index.entries.push(...packed.entries);
	context.previewPackage.img.sheet = packed.image; f.sources.catalog.rebuildResources();
	f.editor.setFontVariant(font);
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: context.id, path: 'scene.lua' })!);
	const document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, scene: document.scenes[0], sourceVersion: model.version } }), inputFocus.target!), true);
	f.update(); const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	return { ...f, client, model, packed };
}

for (const font of ['tiny', 'msx'] as const)
test(`${font} Main paints authored assets and native picking respects shear, texture flip, transparency and draw order`, async t => {
	const f = await fixture(t, font), view = f.client.view.viewport, sprites = view.sprites.items;
	assert.equal(sprites.length, 2); assert.ok(sprites[0].bitmap === sprites[1].bitmap);
	assert.deepEqual(sprites[0].bitmap.image.pixels, f.packed.pixels, 'the packed provider image is the actual displayed data');
	const scene = f.client.consumer.subject!, back = scene.objects[0], front = scene.objects[1];
	assert.ok(sprites[0].source.entry === back && sprites[1].source.entry === front);
	const commands = f.paint(), bitmaps: HostBitmapRenderSubmission[] = [];
	for (let index = 0; index < commands.commandCount; index++) if (commands.commandKinds[index] === Host2DKind.Bitmap)
		bitmaps.push(commands.commandRefs[index] as HostBitmapRenderSubmission);
	assert.equal(bitmaps.length, 2);
	assert.ok(bitmaps.every(command => command.bitmap === sprites[0].bitmap));
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	// Coordinates come from the displayed quad. The contract is exact occurrence selection, not a fixed screen position.
	for (const [u, v, expected] of [[0.65, 0.65, front], [0.8, 0.2, back]] as const) {
		const top = sprites[1], x = top.x + top.xx * u + top.yx * v, y = top.y + top.xy * u + top.yy * v;
		assert.ok(view.sprites.pick(x, y) === expected);
		for (const down of [true, false]) {
			f.host.clock.advance(10);
			f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Primary : 0,
				pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
				cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
		}
		f.update(); assert.ok(f.client.consumer.selection?.kind === 'member' && f.client.consumer.selection.entry === expected);
		assert.ok(f.client.viewport.scope.contains(inputFocus.admittedTarget!.scope));
	}
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('steady Main reading and camera motion retain decoded pixels and sprite records', async t => {
	const f = await fixture(t, 'tiny'), view = f.client.view.viewport, items = view.sprites.items;
	const bitmap = items[0].bitmap, record = items[0], pixels = bitmap.image.pixels, revision = view.projectionRevision;
	for (let frame = 0; frame < 100; frame++) f.update();
	assert.equal(view.projectionRevision, revision); assert.ok(items[0] === record && record.bitmap === bitmap && bitmap.image.pixels === pixels);
	view.camera.pan(13, -7); f.update();
	assert.ok(items[0] === record && record.bitmap === bitmap && bitmap.image.pixels === pixels); assert.equal(bitmap.revision, 0);
	let retired = 0; bitmap.onDispose(() => retired++);
	f.editor.mainWorkspace.reset(); assert.equal(retired, 1);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('sprite hits require actual unit-square coverage and sampled opacity for representable Number geometry', async t => {
	const f = await fixture(t, 'tiny'), sprites = f.client.view.viewport.sprites;
	// Focused geometry contract, not UI positioning: unordered coordinates cover no points.
	for (const item of sprites.items) item.xx = 0 / 0;
	assert.equal(sprites.pick(100, 100), undefined);
	for (const item of sprites.items) { item.xx = 8; item.xy = item.yx = 0; item.yy = 8; item.x = item.y = 0; item.u0 = item.u1 = 0 / 0; }
	assert.equal(sprites.pick(4, 4), undefined);
});
