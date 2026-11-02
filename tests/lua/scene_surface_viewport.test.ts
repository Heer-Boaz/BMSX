import assert from 'node:assert/strict';
import test from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneViewportCanvas } from '../../ide/workbench/contrib/scene_editor/viewport/canvas';
import { SceneViewportCamera } from '../../ide/workbench/contrib/scene_editor/viewport/camera';
import { SceneViewportViewState } from '../../ide/workbench/contrib/scene_editor/viewport/view_state';
import { drawSceneViewport } from '../../ide/workbench/contrib/scene_editor/viewport/render';
import { api } from '../../ide/runtime/overlay_api';
import { WorkspaceImageAssets } from '../../ide/workspace/image_assets';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { HostBitmapRenderSubmission } from '../../machine/ts/render/host_overlay/bitmap';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { createPackedImageFixture } from '../helpers/packed_images';
import { createSceneSourceFixture } from '../helpers/scene_sources';

test('authored surfaces retain image, transform, order, visibility and source without inventing missing images', t => {
	const source = `local scenes=require('cartlib/world/scene_library')
scenes.register('main',{objects={
 {member_id='big',definition_id='surface',transform={xx=0,xy=1,yx=-1,yy=0.5,ox=10,oy=20},options={imgid='big',color=0x00123456,order=2,attachment_affine={1,0,0,1,3,4}}},
 {member_id='small',definition_id='surface',options={imgid='small',order=-1,presentation_order=1}},
 {member_id='hidden',definition_id='surface',options={imgid='big',visible=false}},
 {member_id='disabled',definition_id='surface',options={imgid='big',enabled=false}},
 {member_id='absent',definition_id='surface'},
 {member_id='unknown',definition_id='surface',options={imgid=choose()}},
 {member_id='unknown_color',definition_id='surface',options={imgid='big',color=choose()}},
 {member_id='fixed',definition_id='fixed',options={imgid='big',color=0}},
 {member_id='zero',definition_id='zero'},
 {member_id='missing_asset',definition_id='surface',options={imgid='missing'}},
}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [
		['cartlib/world/prefab.lua', 'return {define=function() end}'],
		['cartlib/component/surface_component.lua', 'return {new=function() end}'],
		['prefabs.lua', `local prefab=require('cartlib/world/prefab')
local surface=require('cartlib/component/surface_component')
prefab.define({def_id='surface',class=require('cartlib/world/object_2d'),components={function(owner) return surface.new(owner,owner) end}})
prefab.define({def_id='fixed',class=require('cartlib/world/object_2d'),components={function(owner) return surface.new(owner,{imgid='small',color=false,presentation_affine={1,0,0,1,5,6}}) end}})
prefab.define({def_id='zero',class=require('cartlib/world/object_2d'),components={function(owner) return surface.new(owner,{imgid='small',color=0}) end}})`],
	]);
	const pixels = new Uint8Array(272 * 272 * 4);
	for (const [x, y, color] of [[2, 2, [255,0,0,255]], [257, 2, [0,255,0,255]], [2,257,[0,0,255,255]], [257,257,[255,255,255,255]]] as const)
		pixels.set(color, ((y + 4) * 272 + x + 4) * 4);
	const packed = createPackedImageFixture('big', 272, 272, pixels);
	Object.assign(packed.image.imgmeta!, { width: 264, height: 264, texture_u: 4, texture_v: 4 });
	packed.image.imgmeta!.gx_page_tiles = [
		{u:4,v:4,w:252,h:252,x:0,y:0}, {u:256,v:4,w:12,h:252,x:252,y:0},
		{u:4,v:256,w:252,h:12,x:0,y:252}, {u:256,v:256,w:12,h:12,x:252,y:252},
	];
	const small = { ...packed.image, resid: 'small', imgmeta: { ...packed.image.imgmeta!, width: 4, height: 4, gx_page_tiles: undefined } };
	const provider = f.sources.catalog.getContext(f.model.identity.contextId);
	provider.previewRom!.bytes = packed.bytes; provider.previewRom!.index.entries.push(...packed.entries, small);
	provider.previewPackage.img.big = packed.image; provider.previewPackage.img.small = small; f.sources.catalog.rebuildResources();
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version });
	const read = context.visualScene!;
	assert.deepEqual(read.canvas.map(item => item.kind === 'sprite' && [item.image, item.color, item.order]),
		[['small', 0xffffffff, 0], ['small', 0xffffffff, 0], ['small', 0, 0], ['missing', 0xffffffff, 0], ['big', 0x00123456, 2]]);
	assert.deepEqual([read.canvas[1].presentation.ox, read.canvas[1].presentation.oy], [5, 6]);
	const images = new WorkspaceImageAssets(f.sources.catalog);
	images.update(f.model.identity.contextId, new Set(['big', 'small', 'missing']));
	const canvas = new SceneViewportCanvas(images), camera = new SceneViewportCamera();
	canvas.prepare(read); camera.setViewport(600, 600); canvas.project(camera, {left:0,top:0,right:600,bottom:600}, 1);
	assert.equal(canvas.items.length, 4);
	const big = canvas.items[3]; assert.equal(big.kind, 'sprite');
	if (big.kind !== 'sprite') assert.fail('surface image requires a textured draw packet');
	assert.deepEqual([big.width, big.height, big.affine.xx, big.affine.xy, big.affine.yx, big.affine.yy, big.affine.ox, big.affine.oy], [264,264,0,1,-1,0.5,6,25]);
	for (const [x, y, color] of [[2,2,[255,0,0,255]], [257,2,[0,255,0,255]], [2,257,[0,0,255,255]], [257,257,[255,255,255,255]]] as const) {
		const u = (x + 0.5) / big.width, v = (y + 0.5) / big.height;
		assert.equal(canvas.pick(big.x + big.xx * u + big.yx * v, big.y + big.xy * u + big.yy * v), big.source.entry);
		const offset = ((y + 4) * big.bitmap.image.width + x + 4) * 4;
		assert.deepEqual(Array.from(big.bitmap.image.pixels.subarray(offset, offset + 4)), color);
	}
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.canUndo, false);
	configureFontVariant('tiny');
	const view = new SceneViewportViewState(context, f.sources.catalog), overlay = createHostOverlayFixture(600,600);
	view.layout({left:0,top:0,right:600,bottom:600}, 10); view.refresh();
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); drawSceneViewport(view, false); overlay.renderer.endFrame();
	const frame = overlay.queue.consumeOverlayFrame(), colors: number[] = [];
	for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.Bitmap)
		colors.push((frame.commandRefs[index] as HostBitmapRenderSubmission).color);
	assert.deepEqual(colors, [0xffffffff, 0xffffffff, 0xff000000, 0xff123456]);
	view.dispose();
	t.after(() => { canvas.dispose(); images.dispose(); context.dispose(); });
});
