import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { WorkspaceImageAssets } from '../../ide/workspace/image_assets';
import { Host2DKind, type HostSolidQuadRenderSubmission } from '../../machine/ts/render/host_overlay/commands';
import { createActualSourcePanes } from '../helpers/source_panes';
import { createPackedImageFixture } from '../helpers/packed_images';
import { CARTLIB_OBJECT_SOURCE_MODULES } from '../fixtures/studio/cartlib_objects';

const SOURCE = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
local rectangle=require('cartlib/component/rectangle_component')
local sprite=require('cartlib/component/sprite_component')
local object=require('cartlib/world/object_2d')
prefab.define({def_id='panel',class=object,
 defaults={width=40,height=28,color=0x00123456},
 components={function(owner) return rectangle.new(owner,owner) end}})
prefab.define({def_id='picture',class=object,components={sprite.factory({imgid='sheet',order=1})}})
scenes.register('room',{objects={
 {member_id='back',definition_id='panel',position={x=0,y=0}},
 {member_id='picture',definition_id='picture',position={x=10,y=6}},
 {member_id='front',definition_id='panel',position={x=30,y=2},options={width=4,height=6,color=0xffa03080,order=2}},
}})`;

async function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny') {
	const f = createActualSourcePanes(t, false, [...CARTLIB_OBJECT_SOURCE_MODULES, ['scene.lua', SOURCE], ['cartlib/world/prefab.lua', 'return {define=function() end}'],
		['cartlib/world/scene_library.lua', 'return {}'], ['cartlib/component/rectangle_component.lua', 'return {new=function() end}'],
		['cartlib/component/sprite_component.lua', 'return {new=function() end,factory=function() end}']]);
	const pixels = new Uint8Array(8 * 8 * 4).fill(255); pixels[(1 * 8 + 1) * 4 + 3] = 0;
	const packed = createPackedImageFixture('sheet', 8, 8, pixels), provider = f.sources.catalog.getContext(f.sources.systemContextId);
	provider.previewRom!.bytes = packed.bytes; provider.previewRom!.index.entries.push(...packed.entries);
	provider.previewPackage.img.sheet = packed.image; f.sources.catalog.rebuildResources();
	f.editor.setFontVariant(font); f.editor.editorParts.minimize(f.firstPart); f.editor.editorParts.minimize(f.secondPart);
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: provider.id, path: 'scene.lua' })!);
	const document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, scene: document.scenes[0], sourceVersion: model.version } }), inputFocus.target!), true);
	f.update(); const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	assert.equal(client.authoring.availability, 'available'); assert.ok(client.authoring.subject !== undefined);
	assert.equal(client.view.viewport.canvas.items.length, 3);
	return { ...f, model, client, view: client.view.viewport };
}

for (const font of ['tiny', 'msx'] as const) test(`${font} Main interleaves native solid quads and images in authored visual order`, async t => {
	const f = await fixture(t, font), items = f.view.canvas.items, commands = f.paint();
	assert.deepEqual(items.map(item => item.kind), ['rectangle', 'sprite', 'rectangle']);
	const kinds = [], solids: HostSolidQuadRenderSubmission[] = [];
	for (let index = 0; index < commands.commandCount; index++) {
		const kind = commands.commandKinds[index];
		if (kind === Host2DKind.Bitmap || kind === Host2DKind.SolidQuad) kinds.push(kind);
		if (kind === Host2DKind.SolidQuad) solids.push(commands.commandRefs[index] as HostSolidQuadRenderSubmission);
	}
	assert.deepEqual(kinds, [Host2DKind.SolidQuad, Host2DKind.Bitmap, Host2DKind.SolidQuad]);
	// Exact primitive color is a renderer data contract: cartlib's ordinary rect ignores alpha.
	assert.deepEqual(solids.map(quad => quad.color), [0xff123456, 0xffa03080]);
	assert.equal('bitmap' in items[0], false); assert.equal('bitmap' in items[2], false);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('native viewport picking falls through a transparent image to the actual rectangle occurrence', async t => {
	const f = await fixture(t), scene = f.client.authoring.subject!, picture = f.view.canvas.items[1];
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	for (const [u, v, expected] of [[0.1875, 0.1875, scene.objects[0]], [0.6, 0.6, scene.objects[1]]] as const) {
		const x = picture.x + picture.xx * u + picture.yx * v, y = picture.y + picture.xy * u + picture.yy * v;
		assert.ok(f.view.canvas.pick(x, y) === expected);
		for (const down of [true, false]) {
			f.host.clock.advance(10);
			f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Primary : 0,
				pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
				cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
		}
		f.update(); assert.ok(f.client.authoring.selection?.kind === 'member' && f.client.authoring.selection.entry === expected);
	}
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles); assert.equal(f.model.canUndo, false);
});

test('rectangle framing, projection and picking consume full reflected/sheared visual geometry', async t => {
	const f = await fixture(t), old = 'position={x=0,y=0}';
	f.model.pushEditOperations([{ offset: SOURCE.indexOf(old), deleteLength: old.length,
		text: 'transform={xx=-2,xy=1,yx=0.5,yy=3,ox=7,oy=9}' }]); f.update();
	const item = f.view.canvas.items[0], entry = f.client.authoring.subject!.objects[0];
	assert.ok(entry.kind === 'object');
	const bounds = { left: 0, top: 0, right: 0, bottom: 0 };
	assert.equal(f.view.canvas.frameBounds(new Set([entry]), bounds), true);
	// True transformed geometry is this focused projection test's subject, not incidental UI dimensions.
	assert.deepEqual(bounds, { left: -73, top: 9, right: 21, bottom: 133 });
	assert.ok(f.view.canvas.pick(item.x + item.xx * 0.5 + item.yx * 0.5, item.y + item.xy * 0.5 + item.yy * 0.5) === entry);
	f.model.undo(); f.update(); assert.equal(f.model.buffer.getText(), SOURCE);
});

test('steady source reading retains solid/image records and does not rediscover assets or project geometry', async t => {
	const f = await fixture(t), items = [...f.view.canvas.items], affines = items.map(item => item.affine), revision = f.view.projectionRevision;
	const images = t.mock.method(WorkspaceImageAssets.prototype, 'get'), project = t.mock.method(f.view.camera, 'projectX');
	for (let frame = 0; frame < 100; frame++) f.update();
	assert.equal(images.mock.callCount(), 0); assert.equal(project.mock.callCount(), 0); assert.equal(f.view.projectionRevision, revision);
	assert.ok(f.view.canvas.items.every((item, index) => item === items[index] && item.affine === affines[index]));
	f.view.camera.pan(3, -5); f.update();
	assert.equal(images.mock.callCount(), 0);
	assert.ok(f.view.canvas.items.every((item, index) => item === items[index] && item.affine === affines[index]));
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('a source-kind replacement cannot reuse stale image material on a solid quad', async t => {
	const f = await fixture(t), old = "definition_id='panel'";
	f.model.pushEditOperations([{ offset: SOURCE.indexOf(old), deleteLength: old.length, text: "definition_id='picture'" }]); f.update();
	assert.deepEqual(f.view.canvas.items.map(item => item.kind), ['sprite', 'sprite', 'rectangle']);
	f.model.undo(); f.update();
	assert.deepEqual(f.view.canvas.items.map(item => item.kind), ['rectangle', 'sprite', 'rectangle']);
	assert.equal('bitmap' in f.view.canvas.items[0], false);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});
