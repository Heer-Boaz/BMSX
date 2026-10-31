import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { WorkspaceModelAssets } from '../../ide/workspace/model_assets';
import { WorkspaceSourceCatalog } from '../../ide/workspace/source_catalog';
import { Host2DKind } from '../../machine/ts/render/host_overlay/commands';
import { writeHostMeshClipMatrix, type HostMeshSceneRenderSubmission } from '../../machine/ts/render/host_overlay/mesh';
import type { GLTFModel } from '../../toolchain/ts/rompack/gltf';
import { packModelAsset, loadModelFromBuffer } from '../../toolchain/ts/rompack/model_asset';
import { createActualSourcePanes } from '../helpers/source_panes';

const MEMBERS = `{member_id='back',definition_id='paint'},
 {member_id='front',definition_id='paint',spatial={local_transform={1,0,0,0,1,0,0,0,1,0,0,2}}}`;

function geometry(): GLTFModel {
	const positions = new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0, 1e6, 1e6, 1e6]);
	return { name: 'shape', meshes: [{ primitives: [{ positions, indices: new Uint16Array([0, 1, 2]), indexComponentType: 5123, materialIndex: 0 },
		{ positions, indices: new Uint8Array([2, 1, 0]), indexComponentType: 5121, materialIndex: 1 }] }],
		materials: [{ baseColorFactor: [0, 0.5, 1, 1] }, { baseColorFactor: [1, 0.5, 0, 1] }],
		nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
}

async function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny', members = MEMBERS, asset = geometry()) {
	const source = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
local models=require('cartlib/component/static_model_component')
prefab.define({def_id='paint',class={},spatial={family='3d',authority='affine'},
 components={models.factory({id_local='body',model_id='shape'})}})
scenes.register('sculpture',{objects={${members}}})`;
	const f = createActualSourcePanes(t, false, [['scene.lua', source], ['cartlib/world/prefab.lua', 'return {define=function() end}'],
		['cartlib/world/scene_library.lua', 'return {}'], ['cartlib/world/world_object.lua', 'return {}'],
		['cartlib/component/static_model_component.lua', 'return {new=function() end,factory=function() end}']]);
	const context = f.sources.catalog.getContext(f.sources.systemContextId), packed = packModelAsset(asset).buffer;
	context.previewRom!.bytes = packed; context.previewPackage.model.shape = loadModelFromBuffer('shape', packed); f.sources.catalog.rebuildResources();
	f.editor.setFontVariant(font);
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog,
		f.sources.catalog.resolveResource({ contextId: context.id, path: 'scene.lua' })!);
	const document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, scene: document.scenes[0], sourceVersion: model.version } }), inputFocus.target!), true);
	f.update(); const client = f.editor.mainWorkspace.primary; assert.ok(client instanceof ScenePrimaryClient);
	const view = client.view.viewport, camera = view.camera.capture();
	view.camera.restore({ ...camera, space: { ...camera.space, yaw: 0, pitch: 0 } }); f.update();
	return { ...f, source, model, client, view, context };
}

for (const font of ['tiny', 'msx'] as const)
test(`${font} Main submits actual model primitives and pointer selection chooses the nearest displayed occurrence`, async t => {
	const f = await fixture(t, font), view = f.view, scene = view.models.scene;
	assert.equal(view.camera.mode, '3d'); assert.equal(scene.instances.length, 4);
	assert.ok(scene.instances[0].mesh === scene.instances[2].mesh);
	assert.equal(scene.instances[0].mesh.color, 0xff0080ff);
	const commands = f.paint(), submissions: HostMeshSceneRenderSubmission[] = [];
	for (let index = 0; index < commands.commandCount; index++) if (commands.commandKinds[index] === Host2DKind.MeshScene)
		submissions.push(commands.commandRefs[index] as HostMeshSceneRenderSubmission);
	assert.equal(submissions.length, 1); assert.ok(submissions[0].scene === scene);
	const cycles = f.host.runtime.machine.scheduler.nowCycles, front = f.client.consumer.subject!.objects[1];
	const x = (view.bounds.left + view.bounds.right) / 2 + view.camera.projectX(0.2, 0.2, 2);
	const y = (view.bounds.top + view.bounds.bottom) / 2 + view.camera.projectY(0.2, 0.2, 2);
	assert.ok(view.pick(x, y) === front);
	for (const down of [true, false]) f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Primary : 0,
		pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
		cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
	f.update(); assert.ok(f.client.consumer.selection?.kind === 'member' && f.client.consumer.selection.entry === front);
	assert.ok(f.client.viewport.scope.contains(inputFocus.admittedTarget!.scope));
	assert.equal(f.model.buffer.getText(), f.source); assert.equal(f.model.canUndo, false); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});

test('idle Main and camera navigation retain geometry; provider generation retires the actual resource once', async t => {
	const f = await fixture(t), scene = f.view.models.scene, instance = scene.instances[0], mesh = instance.mesh, revision = scene.revision;
	for (let frame = 0; frame < 100; frame++) f.update();
	assert.equal(scene.revision, revision); assert.ok(scene.instances[0] === instance && instance.mesh === mesh);
	f.view.camera.pan(13, -7); f.update(); assert.ok(scene.revision > revision); assert.ok(scene.instances[0] === instance);
	f.view.camera.setMode('2d'); f.update(); const hiddenRevision = scene.revision;
	f.view.camera.pan(7, 8); f.update(); assert.equal(scene.revision, hiddenRevision);
	f.view.camera.setMode('3d'); f.update();
	let retired = 0; mesh.onDispose(() => retired++);
	f.context.previewRom!.bytes = f.context.previewRom!.bytes.slice(); f.sources.catalog.rebuildResources(); f.update();
	assert.equal(retired, 1); assert.ok(scene.instances[0].mesh !== mesh);
	f.editor.mainWorkspace.reset(); assert.equal(retired, 1);
});

test('Frame All remains available when navigation puts every source origin behind the camera', async t => {
	const f = await fixture(t), camera = f.view.camera.capture();
	f.view.camera.restore({ ...camera, space: { ...camera.space, centerZ: -100 } }); f.update();
	assert.equal(f.view.entries.length, 0);
	const command = f.client.viewport.commandTarget.getCommand('sceneViewport.frameAll')!;
	assert.equal(command.isEnabled(), true); command.run(); f.update();
	assert.ok(f.view.entries.length > 0); assert.equal(f.model.canUndo, false);
});

test('incomplete triangle assembly does not claim visible model geometry or hide its source-origin helper', async t => {
	const asset: GLTFModel = { name: 'shape', scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }],
		meshes: [{ primitives: [{ positions: new Float32Array([1000, 2000, 3000]) }] }] };
	const f = await fixture(t, 'tiny', `{member_id='origin',definition_id='paint'}`, asset);
	assert.equal(f.view.models.scene.instances.length, 0); assert.equal(f.view.models.represented.size, 0);
	assert.equal(f.view.camera.capture().space.distance, 8);
	assert.ok(f.view.pick(f.view.points[0], f.view.points[1]) === f.client.consumer.subject!.objects[0]);
});

for (const [name, matrix] of [['reflected', '-1,0,0,0.5,1,0,0,0,1,0,0,0'], ['flattened', '1,0,0,0,1,0,0,0,0,0,0,0']] as const)
test(`${name} actual indexed vertices determine fit and a full affine remains pickable`, async t => {
	const f = await fixture(t, 'tiny', `{member_id='face',definition_id='paint',spatial={local_transform={${matrix}}}}`);
	assert.ok(f.view.camera.capture().space.distance < 10, 'unused accessor vertices never inflate fit');
	const hit = f.view.models.pick(0, 0, f.view.camera); assert.ok(hit?.entry === f.client.consumer.subject!.objects[0]);
});

test('large-origin camera, fit and picking preserve small geometry before translation is narrowed or added', async t => {
	const origin = 2 ** 60, f = await fixture(t, 'tiny', `{member_id='face',definition_id='paint',spatial={local_transform={1,0,0,0,1,0,0,0,1,${origin},${origin},${origin}}}}`);
	const scene = f.view.models.scene, camera = f.view.camera, matrix = new Float64Array(16);
	assert.equal(scene.originX, origin); assert.ok(camera.capture().space.distance > 1 && camera.capture().space.distance < 10);
	writeHostMeshClipMatrix(matrix, scene, scene.instances[0]);
	assert.equal(matrix[12], 0); assert.equal(matrix[13], 0); assert.equal(matrix[15], camera.capture().space.distance);
	const hit = f.view.models.pick(0, 0, camera); assert.ok(hit?.entry === f.client.consumer.subject!.objects[0]);
	assert.equal(hit.originX, origin); assert.ok(Math.abs(hit.x) < 1e-10 && Math.abs(hit.y) < 1e-10);
});

test('framing preserves an off-origin mesh pivot beside a large world origin', async t => {
	const asset = geometry(), positions = asset.meshes[0].primitives[0].positions;
	for (let index = 0; index < 9; index += 3) { positions[index] += 100; positions[index + 1] += 200; positions[index + 2] += 300; }
	const origin = 2 ** 60, f = await fixture(t, 'tiny', `{member_id='face',definition_id='paint',spatial={local_transform={1,0,0,0,1,0,0,0,1,${origin},${origin},${origin}}}}`, asset);
	const camera = f.view.camera, reading = camera.capture().space;
	assert.equal(reading.originX, origin); assert.equal(reading.centerX, 100); assert.equal(reading.centerY, 200); assert.equal(reading.centerZ, 300);
	assert.ok(reading.distance > 1 && reading.distance < 10);
	const hit = f.view.models.pick(0, 0, camera); assert.ok(hit?.entry === f.client.consumer.subject!.objects[0]);
	assert.ok(Math.abs(hit.x - 100) < 1e-10 && Math.abs(hit.y - 200) < 1e-10 && Math.abs(hit.z - 300) < 1e-10);
	camera.zoom(1, 0, 0, hit); f.update(); assert.ok(f.view.models.pick(0, 0, camera)?.entry === hit.entry);
});

test('model availability follows the selected scene profile, explicit default and mounted provider generation', async t => {
	const model = geometry(); model.meshes.push({ primitives: [{ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), materialIndex: 2 }] });
	model.materials!.push({ alphaMode: 'BLEND' }); model.nodes!.push({ mesh: 1 }); model.scenes!.push({ nodes: [1] }); delete model.scene;
	const f = await fixture(t, 'tiny', MEMBERS, model), assets = new WorkspaceModelAssets(f.sources.catalog); t.after(() => assets.dispose());
	assets.update(f.context.id, new Set(['shape']));
	assert.equal(assets.get('shape'), undefined); assert.equal(assets.get('shape', 1), undefined);
	const first = assets.get('shape', 0)!; assert.equal(first.parts.length, 1);
	assert.ok(assets.get('shape', 0) === first); assert.equal(f.view.models.scene.instances.length, 0);
	let retired = 0; first.parts[0].meshes[0].onDispose(() => retired++);
	const unmounted = new WorkspaceSourceCatalog(); unmounted.admitContext({ ...f.context, previewRom: null }); t.after(() => unmounted.dispose());
	const unmountedAssets = new WorkspaceModelAssets(unmounted); t.after(() => unmountedAssets.dispose());
	unmountedAssets.update(f.context.id, new Set(['shape'])); assert.equal(unmountedAssets.get('shape', 0), undefined);
	delete f.context.previewPackage.model.shape; f.sources.catalog.rebuildResources(); assets.update(f.context.id, new Set(['shape']));
	assert.equal(retired, 1); assert.equal(assets.get('shape', 0), undefined);
});
