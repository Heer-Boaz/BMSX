import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import type { HostMeshScene, HostMeshSceneRenderSubmission } from '../../machine/ts/render/host_overlay/mesh';
import { appendAffine3, type Affine3 } from '../../machine/ts/common/affine3';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import type { SceneSourceAffine, SceneSourceObject } from '../../ide/workbench/contrib/scene_editor/model';
import type { SceneTransformPreview } from '../../ide/workbench/contrib/scene_editor/transform_proposal';
import { SceneViewportCamera } from '../../ide/workbench/contrib/scene_editor/viewport/camera';
import { SceneViewportGeometry } from '../../ide/workbench/contrib/scene_editor/viewport/geometry';
import { SceneViewportCanvas } from '../../ide/workbench/contrib/scene_editor/viewport/canvas';
import { SceneViewportViewState, type SceneViewportPlacement } from '../../ide/workbench/contrib/scene_editor/viewport/view_state';
import { drawSceneViewport } from '../../ide/workbench/contrib/scene_editor/viewport/render';
import { api } from '../../ide/runtime/overlay_api';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { WorkspaceImageAssets } from '../../ide/workspace/image_assets';
import { WorkspaceModelAssets } from '../../ide/workspace/model_assets';
import type { SceneAddMemberChoice } from '../../ide/workbench/contrib/scene_editor/member_insertion';
import type { GLTFModel } from '../../toolchain/ts/rompack/gltf';
import { packModelAsset } from '../../toolchain/ts/rompack/model_asset';
import { createPackedImageFixture } from '../helpers/packed_images';
import { createSceneSourceFixture } from '../helpers/scene_sources';

function fixture(t: TestContext, family: '2d' | '3d', transform: string, attachment: string, presentation: string) {
	const module = family === '2d' ? 'sprite_component' : 'static_model_component';
	const source = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
local component=require('cartlib/component/${module}')
prefab.define({def_id='shape',class=require('cartlib/world/object_${family[0]}d'),
 components={component.factory({id_local='body',${family === '2d' ? "imgid='shape'" : "model_id='shape'"},
 attachment_affine={${attachment}},presentation_affine={${presentation}}})}})
scenes.register('main',{objects={{member_id='shape',definition_id='shape',transform={${transform}}}}})`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined, [
		['cartlib/world/prefab.lua', 'return {define=function() end}'], ['cartlib/world/world_object.lua', 'return {}'],
		[`cartlib/component/${module}.lua`, 'return {new=function() end,factory=function() end}'],
	]);
	const provider = f.sources.catalog.getContext(f.model.identity.contextId);
	if (family === '2d') {
		const pixels = new Uint8Array(2 * 2 * 4).fill(255), packed = createPackedImageFixture('shape', 2, 2, pixels);
		provider.previewRom!.bytes = packed.bytes; provider.previewRom!.index.entries.push(...packed.entries); provider.previewPackage.img.shape = packed.image;
	} else {
		const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
		const asset: GLTFModel = { name: 'shape', meshes: [{ primitives: [{ positions, indices: new Uint16Array([0, 1, 2]), indexComponentType: 5123 },
			{ positions, indices: new Uint8Array([2, 1, 0]), indexComponentType: 5121 }] }], nodes: [{ mesh: 0, translation: [2, 3, 4] }], scenes: [{ nodes: [0] }], scene: 0 };
		provider.previewRom!.bytes = packModelAsset(asset).buffer; provider.previewPackage.model.shape = asset;
	}
	f.sources.catalog.rebuildResources();
	const document = f.documents.get(f.model), context = new SceneAuthoringContext(f.model, f.documents,
		{ document, scene: document.scenes[0], sourceVersion: f.model.version });
	const read = context.visualScene!, entry = context.subject!.objects[0]; assert.equal(entry.kind, 'object');
	const images = new WorkspaceImageAssets(f.sources.catalog);
	images.update(f.model.identity.contextId, new Set(read.canvas.flatMap(visual => visual.kind === 'sprite' ? [visual.image] : [])));
	const assets = new WorkspaceModelAssets(f.sources.catalog);
	assets.update(f.model.identity.contextId, new Set(read.models.map(model => model.model)));
	const canvas = new SceneViewportCanvas(images), models = new SceneViewportGeometry(assets, canvas);
	canvas.prepare(read); models.prepare(read);
	t.after(() => { canvas.dispose(); images.dispose(); models.dispose(); assets.dispose(); context.dispose(); });
	return { ...f, source, context, read, entry, canvas, models, assets, images };
}

function preview(entry: SceneSourceObject, world: SceneSourceAffine | undefined): SceneTransformPreview & { revision: number } {
	return { worlds: new Map([[entry, world]]), revision: 0 };
}

const IDENTITY_2 = '1,0,0,1,0,0', IDENTITY_3 = '1,0,0,0,1,0,0,0,1,0,0,0';

test('sprite placement keeps authored append order and rebases without the original world inverse', t => {
	const origin = 2 ** 60, f = fixture(t, '2d', `xx=1, xy=0, yx=0, yy=1, ox=${origin}, oy=0`, `1,0,0,1,${-origin},0`, '1,0,0,1,1,2');
	const item = f.canvas.items[0]; assert.equal(item.affine.ox, 1); assert.equal(item.affine.oy, 2);
	assert.ok(f.read.canvas[0].world === f.context.spatialScene!.worlds.get(f.entry));
	const base = f.context.spatialScene!.worlds.get(f.entry)!, world: SceneSourceAffine = { family: '2d', xx: 0, xy: 0, yx: 2, yy: 3, ox: 7, oy: 9 };
	const proposal = preview(f.entry, world); f.canvas.prepare(f.read, proposal);
	assert.ok(f.canvas.items[0] === item); assert.deepEqual(item.affine, { xx: 0, xy: 0, yx: 2, yy: 3, ox: 11, oy: 15 });
	assert.equal(base.ox, origin); assert.equal(base.xx, 1);
	f.canvas.prepare(f.read); assert.ok(f.canvas.items[0] === item); assert.equal(item.affine.ox, 1); assert.equal(item.affine.oy, 2);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('sprite preview retains bindings and unavailable candidates; unrelated or idle proposals do no projection work', t => {
	const f = fixture(t, '2d', 'xx=1, xy=0.5, yx=0.25, yy=1, ox=5, oy=6', IDENTITY_2, IDENTITY_2), item = f.canvas.items[0];
	assert.ok(item.kind === 'sprite'); const bitmap = item.bitmap;
	const base = f.context.spatialScene!.worlds.get(f.entry)!; assert.equal(base.family, '2d');
	const world = { ...base }, proposal = preview(f.entry, world), camera = new SceneViewportCamera(), bounds = { left: 0, top: 0, right: 100, bottom: 100 };
	camera.setViewport(100, 100); f.canvas.project(camera, bounds, 1);
	for (let step = 0; step < 100; step++) {
		world.ox = base.ox + step; world.oy = base.oy - step; proposal.revision++; f.canvas.prepare(f.read, proposal);
		assert.ok(f.canvas.items[0] === item && item.bitmap === bitmap);
	}
	let retired = 0; bitmap.onDispose(() => retired++);
	assert.equal(bitmap.revision, 0); assert.equal(item.affine.ox, base.ox + 99);
	f.canvas.project(camera, bounds, 1); f.canvas.prepare(f.read, proposal); assert.equal(f.canvas.project(camera, bounds, 1), false);
	const unavailable = preview(f.entry, undefined); f.canvas.prepare(f.read, unavailable);
	assert.equal(f.canvas.items.length, 0); assert.equal(f.canvas.represented.has(f.entry), false); assert.equal(retired, 0);
	f.canvas.prepare(f.read); assert.ok(f.canvas.items[0] === item && item.bitmap === bitmap); assert.equal(item.affine.ox, base.ox);
	f.canvas.project(camera, bounds, 1);
	f.canvas.prepare(f.read, { worlds: new Map(), revision: 1 }); assert.equal(f.canvas.project(camera, bounds, 1), false);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('model placement composes source/proposed world then both authored affines then asset node', t => {
	const origin = 2 ** 60, f = fixture(t, '3d', `xx=1, xy=0, xz=0, yx=0, yy=1, yz=0, zx=0, zy=0, zz=0, ox=${origin}, oy=0, oz=0`,
		`1,0,0,0,1,0,0,0,1,${-origin},0,0`, '1,0,0,0,1,0,0,0,1,1,2,3');
	const draw = f.models.scene.instances[0]; assert.equal(draw.ox, 3); assert.equal(draw.oy, 5); assert.equal(draw.oz, 0);
	const world: SceneSourceAffine = { family: '3d', xx: -2, xy: 1, xz: 0, yx: 0.5, yy: 3, yz: 0, zx: 0, zy: 0, zz: 0, ox: 7, oy: 9, oz: 11 };
	const proposal = preview(f.entry, world), expected: Affine3 = { ...world };
	appendAffine3(expected, f.read.models[0].attachment); appendAffine3(expected, f.read.models[0].presentation);
	appendAffine3(expected, { xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 2, oy: 3, oz: 4 });
	f.models.prepare(f.read, proposal); assert.ok(f.models.scene.instances[0] === draw);
	for (const field of ['xx', 'xy', 'xz', 'yx', 'yy', 'yz', 'zx', 'zy', 'zz', 'ox', 'oy', 'oz'] as const) assert.equal(draw[field], expected[field]);
	f.models.prepare(f.read); assert.ok(f.models.scene.instances[0] === draw); assert.equal(draw.ox, 3); assert.equal(draw.oz, 0);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('model translation retains shared linear lanes, meshes and candidate draws across unavailable preview and cancel', t => {
	const f = fixture(t, '3d', 'xx=1, xy=0, xz=0, yx=0.5, yy=1, yz=0, zx=0, zy=0, zz=0, ox=5, oy=6, oz=7', IDENTITY_3, IDENTITY_3), scene = f.models.scene;
	const draw = scene.instances[0], second = scene.instances[1], mesh = draw.mesh;
	// The picking consumer owns the retained linear lanes, shared between material primitives.
	assert.ok('vertices' in draw && draw.vertices instanceof Float64Array); const vertices = draw.vertices;
	assert.ok('vertices' in second && second.vertices === vertices); const values = vertices.slice();
	Reflect.set(f.models, 'transform', () => assert.fail('translation must not transform retained picking vertex lanes'));
	const base = f.context.spatialScene!.worlds.get(f.entry)!, world = { ...base }, proposal = preview(f.entry, world);
	for (let step = 0; step < 100; step++) {
		world.ox = base.ox + step; world.oy = base.oy - step; proposal.revision++; f.models.prepare(f.read, proposal);
		assert.ok(scene.instances[0] === draw && draw.mesh === mesh && draw.vertices === vertices);
	}
	assert.deepEqual(vertices, values); assert.equal(draw.ox, base.ox + 99 + 3.5);
	const revision = scene.revision; f.models.prepare(f.read, proposal); assert.equal(scene.revision, revision);
	f.models.prepare(f.read, { worlds: new Map(), revision: 1 }); assert.equal(draw.ox, base.ox + 3.5);
	const restoredRevision = scene.revision; f.models.prepare(f.read); assert.equal(scene.revision, restoredRevision);
	let retired = 0; mesh.onDispose(() => retired++);
	f.models.prepare(f.read, preview(f.entry, undefined)); assert.equal(scene.instances.length, 0); assert.equal(f.models.represented.size, 0); assert.equal(retired, 0);
	f.models.prepare(f.read); assert.ok(scene.instances[0] === draw && scene.instances[1] === second && draw.mesh === mesh); assert.equal(retired, 0);
	assert.deepEqual(vertices, values); assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
});

test('generic model preview borrows main meshes and never owns their cache lifetime', t => {
	const f = fixture(t, '3d', 'xx=1,xy=0,xz=0,yx=0,yy=1,yz=0,zx=0,zy=0,zz=1,ox=5,oy=6,oz=7', IDENTITY_3, IDENTITY_3);
	const choice: SceneAddMemberChoice = { id: 'shape', family: '3d' };
	const source = { canvas: [], models: f.read.models.map(model => ({ ...model, entry: choice })) };
	const canvas = new SceneViewportCanvas<SceneAddMemberChoice>(f.images);
	const ghost = new SceneViewportGeometry<SceneAddMemberChoice>(f.assets, canvas); t.after(() => { ghost.dispose(); canvas.dispose(); });
	ghost.prepare(source); const draw = ghost.scene.instances[0], mesh = draw.mesh;
	assert.equal(mesh, f.models.scene.instances[0].mesh);
	const world: SceneSourceAffine = { family: '3d', xx: 1, xy: 0, xz: 0, yx: 0, yy: 1, yz: 0, zx: 0, zy: 0, zz: 1, ox: 8, oy: 9, oz: 10 };
	const proposal: SceneTransformPreview<SceneAddMemberChoice> & { revision: number } = { worlds: new Map([[choice, world]]), revision: 0 };
	const updates = t.mock.method(f.assets, 'update', () => assert.fail('pointer movement must not rediscover model assets'));
	for (let step = 0; step < 100; step++) {
		world.ox = 8 + step; proposal.revision++; ghost.prepare(source, proposal);
		assert.equal(ghost.scene.instances[0], draw); assert.equal(draw.mesh, mesh);
	}
	updates.mock.restore();
	assert.equal(draw.ox, 8 + 99 + 2); assert.equal(f.models.scene.instances[0].ox, 7);
	let retired = 0; mesh.onDispose(() => retired++);
	ghost.dispose(); assert.equal(retired, 0); assert.equal(f.models.scene.instances[0].mesh, mesh);
	f.assets.update(f.model.identity.contextId, new Set()); assert.equal(retired, 1);
	f.models.prepare(undefined); assert.equal(f.models.scene.instances.length, 0);
});

test('the Scene viewport shares main and Add model assets while the located ghost remains presentation-only', t => {
	configureFontVariant('tiny');
	const f = fixture(t, '3d', 'xx=1,xy=0,xz=0,yx=0,yy=1,yz=0,zx=0,zy=0,zz=1,ox=5,oy=6,oz=7', IDENTITY_3, IDENTITY_3);
	const view = new SceneViewportViewState(f.context, f.sources.catalog); t.after(() => view.dispose());
	view.layout({ left: 0, top: 0, right: 400, bottom: 300 }, 8); view.refresh();
	const main = view.geometry.scene.instances[0], mesh = main.mesh;
	const request = f.context.captureAddMember('3d')!, choice = request.choices[0], source = request.getPreview(choice)!;
	assert.ok(source.world.family === '3d'); const world = { ...source.world };
	const preview = { world, visuals: source.visuals, worlds: new Map([[choice, world]]), revision: 0 };
	view.placementPreview = preview; view.refresh(); const ghost = view.placementGeometry.scene.instances[0];
	assert.equal(ghost.mesh, mesh); assert.equal(view.geometry.scene.instances[0], main);
	let retired = 0; mesh.onDispose(() => retired++);
	const update = t.mock.method(WorkspaceModelAssets.prototype, 'update', () => assert.fail('pointer motion must only update retained placements'));
	const sourceRead = t.mock.method(f.context, 'refresh', () => assert.fail('pointer motion must not re-enter source projection'));
	const mainPreparation = t.mock.method(view.geometry, 'prepare', () => assert.fail('pointer motion must not prepare committed models'));
	for (let step = 0; step < 100; step++) {
		world.ox = step; world.oz = step * 2; preview.revision++; view.projectPlacement();
		assert.equal(view.placementGeometry.scene.instances[0], ghost); assert.equal(ghost.mesh, mesh);
		assert.equal(view.geometry.scene.instances[0], main);
	}
	update.mock.restore(); sourceRead.mock.restore(); mainPreparation.mock.restore();
	assert.equal(main.ox, 7); assert.equal(ghost.ox, 101); assert.equal(retired, 0);
	const overlay = createHostOverlayFixture(400, 300);
	const placement: SceneViewportPlacement = { definitionLabel: choice.id, preview, x: world.ox, y: world.oy, z: world.oz, located: true };
	const paint = () => {
		overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer); drawSceneViewport(view, false, placement); overlay.renderer.endFrame();
		const frame = overlay.queue.consumeOverlayFrame(), scenes: HostMeshScene[] = [];
		for (let index = 0; index < frame.commandCount; index++) if (frame.commandKinds[index] === Host2DKind.MeshScene)
			scenes.push((frame.commandRefs[index] as HostMeshSceneRenderSubmission).scene);
		return scenes;
	};
	const located = paint(); assert.equal(located.length, 2);
	assert.ok(located[0] === view.geometry.scene && located[1] === view.placementGeometry.scene);
	placement.located = false; const outside = paint();
	assert.equal(outside.length, 1); assert.ok(outside[0] === view.geometry.scene);
	view.placementPreview = undefined; view.refresh();
	assert.equal(view.placementGeometry.scene.instances.length, 0); assert.equal(main.mesh, mesh); assert.equal(retired, 0);
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false);
	view.dispose(); assert.equal(retired, 1);
});
