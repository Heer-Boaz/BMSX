import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import type { GLTFModel } from '../../toolchain/ts/rompack/gltf';
import { loadModelFromBuffer, packModelAsset } from '../../toolchain/ts/rompack/model_asset';
import { createPackedImageFixture } from '../helpers/packed_images';
import { createSceneDocumentFixture } from '../helpers/scene_document_fixture';
import { CARTLIB_OBJECT_SOURCE_MODULES } from '../fixtures/studio/cartlib_objects';

const IMPORTS = [...CARTLIB_OBJECT_SOURCE_MODULES,
	['cartlib/world/prefab.lua', 'return {define=function() end}'],
	['cartlib/component/sprite_component.lua', 'return {new=function() end,factory=function() end}'],
	['cartlib/component/static_model_component.lua', 'return {new=function() end,factory=function() end}'],
] as const;
const SOURCE = `local scene=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
local sprites=require('cartlib/component/sprite_component')
prefab.define({def_id='sprite',class=require('cartlib/world/object_2d'),components={sprites.factory({imgid='late'})}})
scene.register('stage',{objects={
 {member_id='first',definition_id='sprite',position={x=0,y=0}},
 {member_id='second',definition_id='sprite',position={x=0,y=8}},
}})`;
const MODEL_SOURCE = `local scene=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
local models=require('cartlib/component/static_model_component')
prefab.define({def_id='model',class=require('cartlib/world/object_3d'),components={models.factory({model_id='shape'})}})
scene.register('stage',{objects={
 {member_id='first',definition_id='model',position={x=0,y=0,z=0}},
 {member_id='second',definition_id='model',position={x=1,y=0,z=0}},
}})`;

async function fixture(t: TestContext, source = SOURCE) {
	const f = await createSceneDocumentFixture(t, source, IMPORTS), viewport = f.view.viewport;
	// This suite owns the camera-fit algorithm. The realized viewport dimensions
	// are inputs to the fit, not assertions about general Workbench layout.
	viewport.layout({ left: 0, top: 0, right: 320, bottom: 240 }, 8); viewport.refresh();
	return { ...f, viewport };
}

function publishImage(f: Awaited<ReturnType<typeof fixture>>) {
	const pixels = new Uint8Array(8 * 8 * 4); pixels.fill(255);
	const image = createPackedImageFixture('late', 8, 8, pixels);
	const context = f.sources.catalog.getContext(f.sources.systemContextId);
	context.previewRom!.bytes = image.bytes; context.previewRom!.index.entries.push(...image.entries);
	context.previewPackage.img.late = image.image; f.sources.catalog.rebuildResources();
}

function publishModel(f: Awaited<ReturnType<typeof fixture>>) {
	const model: GLTFModel = { name: 'shape', scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
		meshes: [{ primitives: [{ positions: new Float32Array([-8, -8, 0, 8, -8, 0, 0, 8, 0]) }] }] };
	const packed = packModelAsset(model).buffer, context = f.sources.catalog.getContext(f.sources.systemContextId);
	context.previewRom!.bytes = packed; context.previewPackage.model.shape = loadModelFromBuffer('shape', packed);
	f.sources.catalog.rebuildResources();
}

test('automatic origin-only framing never magnifies dense pixel coordinates and explicit selection may zoom', async t => {
	const f = await fixture(t), { viewport } = f;
	assert.equal(viewport.canvas.items.length, 0);
	assert.equal(viewport.camera.capture().canvas.reading, 'initial');
	assert.ok(viewport.camera.scale <= 1);
	const revision = viewport.camera.revision, projection = viewport.projectionRevision;
	const fit = t.mock.method(viewport, 'frame');
	for (let i = 0; i < 30; i++) viewport.refresh();
	assert.equal(fit.mock.callCount(), 0); assert.equal(viewport.camera.revision, revision); assert.equal(viewport.projectionRevision, projection);
	assert.equal(selectSceneOutlineRow(f.view.hierarchy, 1), true); viewport.refresh();
	assert.ok(viewport.selected !== undefined && viewport.frame(viewport.selected));
	assert.equal(viewport.camera.capture().canvas.reading, 'manual'); assert.ok(viewport.camera.scale > 1);
});

test('automatic fit incorporates a later mounted image once and ignores steady refreshes', async t => {
	const f = await fixture(t), { viewport } = f;
	const initial = viewport.camera.capture(), before = viewport.camera.revision;
	assert.equal(viewport.canvas.items.length, 0);
	publishImage(f); viewport.refresh();
	assert.equal(viewport.canvas.items.length, 2);
	assert.equal(viewport.camera.capture().canvas.reading, 'initial');
	const fitted = viewport.camera.capture().canvas;
	assert.ok(fitted.scale > initial.canvas.scale); assert.notDeepEqual(fitted, initial.canvas);
	assert.equal(fitted.centerX, 4); assert.equal(fitted.centerY, 8);
	assert.ok(viewport.camera.revision > before);
	const camera = viewport.camera.capture(), revision = viewport.camera.revision;
	for (let i = 0; i < 30; i++) viewport.refresh();
	assert.deepEqual(viewport.camera.capture(), camera); assert.equal(viewport.camera.revision, revision);
	assert.equal(viewport.frame(undefined), true); assert.equal(viewport.camera.capture().canvas.reading, 'manual');
});

test('automatic origin fitting responds to changed source and viewport size but not a pure panel translation', async t => {
	const source = SOURCE.replace('x=0,y=8', 'x=1000,y=0');
	const f = await fixture(t, source), { viewport } = f;
	const before = viewport.camera.scale;
	viewport.layout({ left: 0, top: 0, right: 620, bottom: 240 }, 8); viewport.refresh();
	const larger = viewport.camera.scale; assert.ok(larger > before && larger <= 1);
	const revision = viewport.camera.revision, camera = viewport.camera.capture();
	viewport.layout({ left: 10, top: 20, right: 630, bottom: 260 }, 8); viewport.refresh();
	assert.equal(viewport.camera.revision, revision); assert.deepEqual(viewport.camera.capture(), camera);
	const text = f.model.buffer.getText(), offset = text.indexOf('x=1000');
	f.model.pushEditOperations([{ offset, deleteLength: 'x=1000'.length, text: 'x=2000' }]); viewport.refresh();
	assert.ok(viewport.camera.scale < larger); assert.equal(viewport.camera.capture().canvas.reading, 'initial');
});

test('restoring an automatic snapshot recomputes against the current source generation', async t => {
	const f = await fixture(t, SOURCE.replace('x=0,y=8', 'x=1000,y=0')), viewport = f.viewport;
	const prior = viewport.camera.capture();
	const text = f.model.buffer.getText(), offset = text.indexOf('x=1000');
	f.model.pushEditOperations([{ offset, deleteLength: 'x=1000'.length, text: 'x=2000' }]); viewport.refresh();
	const current = viewport.camera.capture(); assert.ok(current.canvas.scale < prior.canvas.scale);
	viewport.camera.restore(prior); viewport.refresh();
	assert.deepEqual(viewport.camera.capture(), current, 'an old automatic snapshot cannot freeze an obsolete source fit');
});

for (const gesture of ['pan', 'zoom', 'frameAll', 'frameSelection'] as const) test(`${gesture} keeps the chosen 2D reading across later source, assets and allocation`, async t => {
	const f = await fixture(t), { viewport } = f;
	if (gesture === 'pan') viewport.camera.pan(9, -4);
	else if (gesture === 'zoom') viewport.camera.zoom(1, 3, 5);
	else if (gesture === 'frameAll') assert.equal(viewport.frame(undefined), true);
	else {
		assert.equal(selectSceneOutlineRow(f.view.hierarchy, 1), true); viewport.refresh();
		assert.ok(viewport.selected !== undefined && viewport.frame(viewport.selected));
	}
	const reading = viewport.camera.capture(); assert.equal(reading.canvas.reading, 'manual');
	publishImage(f);
	const text = f.model.buffer.getText(), offset = text.indexOf('x=0,y=8');
	f.model.pushEditOperations([{ offset, deleteLength: 'x=0,y=8'.length, text: 'x=50,y=60' }]);
	viewport.layout({ left: 0, top: 0, right: 620, bottom: 400 }, 8); viewport.refresh();
	assert.deepEqual(viewport.camera.capture(), reading); assert.equal(viewport.canvas.items.length, 2);
});

test('automatic 3D reading incorporates a later mounted model; orbit then retains the chosen camera', async t => {
	const f = await fixture(t, MODEL_SOURCE), { viewport } = f;
	assert.equal(viewport.camera.mode, '3d'); assert.equal(viewport.models.scene.instances.length, 0);
	const initial = viewport.camera.capture().space;
	publishModel(f); viewport.refresh();
	assert.ok(viewport.models.scene.instances.length > 0);
	const updated = viewport.camera.capture().space;
	assert.equal(updated.reading, 'initial'); assert.ok(updated.distance > initial.distance);
	viewport.camera.orbit(17, 9); const manual = viewport.camera.capture();
	f.sources.catalog.rebuildResources(); viewport.layout({ left: 0, top: 0, right: 400, bottom: 260 }, 8); viewport.refresh();
	assert.deepEqual(viewport.camera.capture(), manual);
});

for (const reading of ['initial', 'manual'] as const) test(`serialized ${reading} camera preserves its framing policy after restore`, async t => {
	const f = await fixture(t), viewport = f.viewport;
	if (reading === 'manual') viewport.camera.pan(12, -7);
	const original = viewport.camera.capture(), serializer = f.editor.editorInputSerializers.scene_editor;
	const restored = await serializer.deserialize(serializer.serialize(f.primary.input)); assert.ok(restored instanceof SceneEditorInput);
	t.after(() => restored.dispose());
	const next = restored.view.viewport;
	next.layout({ left: 0, top: 0, right: 320, bottom: 240 }, 8); next.refresh();
	assert.deepEqual(next.camera.capture(), original);
	publishImage(f); next.refresh();
	if (reading === 'initial') {
		assert.ok(next.camera.scale > original.canvas.scale); assert.notDeepEqual(next.camera.capture().canvas, original.canvas);
	}
	else assert.deepEqual(next.camera.capture(), original);
});

for (const reading of ['initial', 'manual'] as const) test(`serialized ${reading} 3D camera restores mode and orbit intent`, async t => {
	const f = await fixture(t, MODEL_SOURCE), viewport = f.viewport;
	if (reading === 'manual') viewport.camera.orbit(12, -7);
	const original = viewport.camera.capture(), serializer = f.editor.editorInputSerializers.scene_editor;
	const restored = await serializer.deserialize(serializer.serialize(f.primary.input)); assert.ok(restored instanceof SceneEditorInput);
	t.after(() => restored.dispose());
	const next = restored.view.viewport;
	next.layout({ left: 0, top: 0, right: 320, bottom: 240 }, 8); next.refresh();
	assert.deepEqual(next.camera.capture(), original);
	publishModel(f); next.refresh();
	if (reading === 'initial') assert.ok(next.camera.capture().space.distance > original.space.distance);
	else assert.deepEqual(next.camera.capture(), original);
});
