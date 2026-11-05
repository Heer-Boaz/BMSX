import { pickViewportCanvas, measureViewportCanvas } from '../../ide/workbench/contrib/scene_editor/viewport/canvas_geometry';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import type { SceneSourceAffine, SceneSourceObject } from '../../ide/workbench/contrib/scene_editor/model';
import type { SceneTransformPreview } from '../../ide/workbench/contrib/scene_editor/transform_proposal';
import { SceneViewportCanvas } from '../../ide/workbench/contrib/scene_editor/viewport/canvas';
import { WorkbenchViewportCamera } from '../../ide/workbench/ui/viewport_camera';
import { collectSceneTextImages } from '../../ide/workbench/contrib/scene_editor/viewport/text_layout';
import { WorkspaceImageAssets } from '../../ide/workspace/image_assets';
import { createPackedImageFixture } from '../helpers/packed_images';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { SCENE_TEXT_MODULES, SCENE_TEXT_SOURCE } from '../fixtures/studio/scene_text';

function fixture(t: TestContext, properties = "text='AA'", declaration = SCENE_TEXT_SOURCE) {
	const source = declaration.replace("options={text='A'}", `options={${properties}}`);
	const f = createSceneSourceFixture(t, source, 'text.lua', undefined, SCENE_TEXT_MODULES);
	const pixels = new Uint8Array(3 * 4 * 4); pixels.set([255, 255, 255, 255], (1 * 3 + 1) * 4);
	const packed = createPackedImageFixture('glyph_a', 3, 4, pixels), provider = f.sources.catalog.getContext(f.model.identity.contextId);
	provider.previewRom!.bytes = packed.bytes; provider.previewRom!.index.entries.push(...packed.entries);
	provider.previewPackage.img.glyph_a = packed.image; f.sources.catalog.rebuildResources();
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version });
	const read = context.visualScene!, visual = read.canvas[0]; assert.ok(visual.kind === 'text');
	const images = new WorkspaceImageAssets(f.sources.catalog), ids = new Set<string>(); collectSceneTextImages(visual, ids);
	images.update(f.model.identity.contextId, ids);
	const canvas = new SceneViewportCanvas(images), camera = new WorkbenchViewportCamera(), bounds = { left: 0, top: 0, right: 200, bottom: 120 };
	canvas.prepare(read); camera.setViewport(200, 120); canvas.project(camera, bounds, 1, visual.entry);
	t.after(() => { canvas.dispose(); images.dispose(); context.dispose(); });
	return { ...f, source, context, read, visual, images, ids, canvas, camera, bounds, provider };
}

test('text lowers to real glyph packets with transparent-texel picking and one borrowed component pose', t => {
	const f = fixture(t);
	assert.equal(f.canvas.items.length, 2);
	const [first, second] = f.canvas.items; assert.ok(first.kind === 'sprite' && second.kind === 'sprite');
	assert.ok(first.affine === second.affine && first.bitmap === second.bitmap);
	assert.ok(first.source === f.visual && second.source === f.visual);
	assert.equal(f.canvas.outlines.length, 1); assert.ok(f.canvas.outlines[0].source === f.visual);
	assert.equal(pickViewportCanvas(f.canvas.items, first.x + 1.5, first.y + 1.5), f.visual.entry);
	assert.equal(pickViewportCanvas(f.canvas.items, first.x + 0.5, first.y + 0.5), undefined);
	assert.equal(pickViewportCanvas(f.canvas.items, second.x + 1.5, second.y + 1.5), f.visual.entry);
	assert.equal(pickViewportCanvas(f.canvas.items, first.x + first.xx + 0.5, first.y + 1.5), undefined);
	assert.ok(f.canvas.represented.has(f.visual.entry));
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('text backgrounds precede all glyph packets and participate in picking without cloning the source', t => {
	const f = fixture(t, "text='AA',background_color=0xff123456,color=0xffabcdef");
	assert.deepEqual(f.canvas.items.map(item => item.kind), ['rectangle', 'rectangle', 'sprite', 'sprite']);
	assert.deepEqual(f.canvas.items.map(item => item.color), [0xff123456, 0xff123456, 0xffabcdef, 0xffabcdef]);
	assert.ok(f.canvas.items.every(item => item.source === f.visual && item.affine === f.canvas.items[0].affine));
	const first = f.canvas.items[0]; assert.equal(pickViewportCanvas(f.canvas.items, first.x + 0.5, first.y + 0.5), f.visual.entry);
});

test('glyph offsets compose after world, attachment and presentation placement for projection and framing', t => {
	const f = fixture(t, "text='AA',attachment_affine={2,0,0,3,5,7},presentation_affine={1,0,0,1,1,2}");
	const framed = { left: 0, top: 0, right: 0, bottom: 0 };
	// This is a focused affine layout algorithm contract, not UI pixel geometry.
	assert.equal(measureViewportCanvas(f.canvas.items, undefined, framed), true);
	assert.deepEqual(framed, { left: 7, top: 13, right: 21, bottom: 25 });
	const second = f.canvas.items[1];
	assert.equal(pickViewportCanvas(f.canvas.items, second.x + second.xx / 2, second.y + second.yy * 0.375), f.visual.entry);
	assert.equal(measureViewportCanvas(f.canvas.items, new Set(), framed), false);
});

test('glyph spacing, picking and the selected envelope retain small offsets around a large authored origin', t => {
	const origin = 2 ** 60, source = SCENE_TEXT_SOURCE.replace("definition_id='caption'", `definition_id='caption',position={x=${origin},y=${origin}}`);
	const f = fixture(t, "text='AA'", source), state = f.camera.capture();
	f.camera.restore({ ...state, canvas: { ...state.canvas, centerX: origin, centerY: origin } });
	f.canvas.project(f.camera, f.bounds, 1, f.visual.entry);
	const [first, second] = f.canvas.items;
	// Focused camera-relative layout contract: subtract the origin before adding glyph offsets.
	assert.equal(second.x - first.x, 4); assert.equal(second.y, first.y);
	assert.equal(pickViewportCanvas(f.canvas.items, second.x + 1.5, second.y + 1.5), f.visual.entry);
	assert.equal(pickViewportCanvas(f.canvas.items, first.x + 3.5, first.y + 1.5), undefined);
	const points = f.canvas.outlines[0].points;
	assert.equal(points[2] - points[0], 7); assert.equal(points[5] - points[1], 4);
});

test('camera and translation preview reuse glyph layout, bitmap bindings and a shared pose without asset lookups', t => {
	const f = fixture(t), packets = f.canvas.items.slice(), pose = packets[0].affine;
	const get = f.images.get.bind(f.images); let lookups = 0;
	t.mock.method(f.images, 'get', (id: string) => { lookups++; return get(id); });
	const base = f.visual.world, world = { ...base, family: '2d' as const }, preview: SceneTransformPreview & { revision: number } = {
		worlds: new Map([[f.visual.entry, world]]), revision: 0,
	};
	for (let step = 0; step < 50; step++) {
		world.ox = base.ox + step; world.oy = base.oy - step; preview.revision++;
		f.canvas.prepare(f.read, preview); f.camera.pan(1, -1); f.canvas.project(f.camera, f.bounds, 1);
		assert.ok(f.canvas.items.every((item, index) => item === packets[index] && item.affine === pose));
	}
	assert.equal(lookups, 0); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	f.canvas.prepare(f.read); assert.ok(f.canvas.items[0] === packets[0]); assert.equal(pose.ox, base.ox);
});

test('selection alone projects only its component outline and does not reproject glyph packets', t => {
	const f = fixture(t), projectX = t.mock.method(f.camera, 'projectX'), projectY = t.mock.method(f.camera, 'projectY');
	f.canvas.project(f.camera, f.bounds, 1);
	assert.equal(f.canvas.outlines.length, 0); assert.equal(projectX.mock.callCount(), 0); assert.equal(projectY.mock.callCount(), 0);
	f.canvas.project(f.camera, f.bounds, 1, f.visual.entry);
	// Four corners are the rectangle projection algorithm, not UI pixel geometry.
	assert.equal(f.canvas.outlines.length, 1); assert.equal(projectX.mock.callCount(), 4); assert.equal(projectY.mock.callCount(), 4);
	const outline = f.canvas.outlines[0];
	assert.equal(f.canvas.project(f.camera, f.bounds, 1, f.visual.entry), false);
	assert.ok(f.canvas.outlines[0] === outline); assert.equal(projectX.mock.callCount(), 4);
});

for (const second of ['A', '']) test(`a selected member binds each nonempty component outline independently: ${JSON.stringify(second)}`, t => {
	const source = SCENE_TEXT_SOURCE.replace('components={function(owner) return text_component.new(owner,owner) end}',
		`components={function(owner) return text_component.new(owner,owner) end,
 text_component.factory({font=font.get('custom'),text='${second}',attachment_affine={1,0,0,1,10,0}})}`);
	const f = fixture(t, "text='AA'", source);
	assert.equal(f.canvas.outlines.length, second === '' ? 1 : 2);
	assert.ok(f.canvas.outlines.every(outline => outline.source.entry === f.visual.entry));
	if (second !== '') assert.ok(f.canvas.outlines[0].affine !== f.canvas.outlines[1].affine);
});

test('dense packet reuse reattaches the correct component pose when an earlier text run changes length', t => {
	const source = SCENE_TEXT_SOURCE.replace('components={function(owner) return text_component.new(owner,owner) end}',
		"components={function(owner) return text_component.new(owner,owner) end,text_component.factory({font=font.get('custom'),text='A',attachment_affine={1,0,0,1,10,0}})}");
	const f = fixture(t, "text='AA'", source), reused = f.canvas.items[1], secondPose = f.canvas.items[2].affine;
	const offset = f.source.indexOf("options={text='AA'") + "options={text='".length;
	f.model.pushEditOperations([{ offset, deleteLength: 2, text: 'A' }]); f.context.refresh();
	const read = f.context.visualScene!;
	f.canvas.prepare(read); f.canvas.project(f.camera, f.bounds, 1, read.canvas[0].entry);
	assert.equal(f.canvas.items.length, 2); assert.ok(f.canvas.items[1] === reused && reused.affine === secondPose);
	assert.equal(f.canvas.items[1].x - f.canvas.items[0].x, 10 * f.camera.scale);
	f.model.undo(); f.context.refresh(); f.canvas.prepare(f.context.visualScene);
	assert.equal(f.canvas.items.length, 3); assert.ok(f.canvas.items[1] === reused && reused.affine === f.canvas.items[0].affine);
	assert.equal(f.model.buffer.getText(), f.source);
});

test('an unavailable preview retires selected text membership and restoring it rebinds the same glyph packets', t => {
	const f = fixture(t), packet = f.canvas.items[0], worlds = new Map<SceneSourceObject, SceneSourceAffine | undefined>([[f.visual.entry, undefined]]);
	const preview: SceneTransformPreview & { revision: number } = { worlds, revision: 0 };
	f.canvas.prepare(f.read, preview); f.canvas.project(f.camera, f.bounds, 1, f.visual.entry);
	assert.equal(f.canvas.items.length, 0); assert.equal(f.canvas.outlines.length, 0);
	worlds.set(f.visual.entry, { ...f.visual.world, family: '2d' }); preview.revision++;
	f.canvas.prepare(f.read, preview); f.canvas.project(f.camera, f.bounds, 1, f.visual.entry);
	assert.equal(f.canvas.outlines.length, 1); assert.ok(f.canvas.items[0] === packet);
	assert.equal(f.model.buffer.getText(), f.source);
});

test('source text edits and exact Undo publish glyph membership without replacing shared atlas resources', t => {
	const f = fixture(t), first = f.canvas.items[0]; assert.ok(first.kind === 'sprite'); const bitmap = first.bitmap;
	const offset = f.source.indexOf("text='AA'") + "text='".length;
	f.model.pushEditOperations([{ offset, deleteLength: 2, text: 'A' }]); f.context.refresh();
	f.canvas.prepare(f.context.visualScene);
	assert.equal(f.canvas.items.length, 1); assert.ok(f.canvas.items[0] === first && first.bitmap === bitmap);
	f.model.undo(); f.context.refresh(); f.canvas.prepare(f.context.visualScene);
	assert.equal(f.canvas.items.length, 2); assert.ok(f.canvas.items[0] === first && first.bitmap === bitmap);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('an unavailable glyph asset retires the entire text visual and cannot keep stale glyph packets', t => {
	const f = fixture(t); delete f.provider.previewPackage.img.glyph_a; f.sources.catalog.rebuildResources();
	f.images.update(f.model.identity.contextId, f.ids); f.canvas.prepare(f.read);
	f.canvas.project(f.camera, f.bounds, 1, f.visual.entry);
	assert.equal(f.canvas.items.length, 0); assert.equal(f.canvas.represented.has(f.visual.entry), false);
	assert.equal(f.canvas.outlines.length, 0);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});
