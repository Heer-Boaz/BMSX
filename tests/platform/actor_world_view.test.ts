import assert from 'node:assert/strict';
import test from 'node:test';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createHeadlessHostMeshTarget, renderHeadlessHostMeshScene } from '../../machine/ts/render/host_overlay/headless/mesh';
import { createLiveStudioFixture } from '../helpers/live_studio';

// Normal construction and ordinary render passes, not a fabricated world snapshot.
const CONTENT = `
	local models<const> = scene_library.instantiate('studio_test.textured')
	models.members.panels:set_position(800, 0, 0)
	studio_test_world_marker = world:spawn('studio_test.marker', { id = 'world-marker', position = { x = 700, y = 40 } })
	local text<const> = scene_library.instantiate('studio_test.initialized_text', { caption = { id = 'world-caption', content = 'studio' } })
	text.members.caption:set_position(700, 80)
	studio_test_world_caption = text.members.caption
`;

test('live world view retains unclipped initialized visuals, moving actors and textured models; camera input selects without running a second game', async t => {
	const f = await createLiveStudioFixture(t), { editor, ide, sources } = f;
	const cart = resolveLuaTextFileModel(editorTextModelService, sources.catalog, sources.catalog.luaResources.find(resource => resource.path === 'cart.lua')!);
	const text = cart.buffer.getText(), at = text.indexOf('\nend\n\nnew_game()');
	cart.pushEditOperations([{ offset: at, deleteLength: 0, text: CONTENT }]);
	assert.equal(ide.boots.start('workspace').result!.status, 'reset');
	editor.interaction.setActive(false); ide.transport.resumeHere();
	const frames = editor.actorLab.renderFrames;
	await f.until(() => frames.displayed.world.models.length !== 0 && frames.displayed.world.canvas.length > 4);
	ide.transport.pause(); editor.interaction.setActive(true);
	const part = editor.editorParts.createDocument({ requestedBounds: { left: 0, top: 24, right: 800, bottom: 340 } });
	editor.actorLab.open(part.activeGroup); const input = editor.actorLab.resolveInput(); editor.update(0);
	assert.equal(input.worldView.mode, '2d'); assert.equal(input.actorHashId, 0, 'opening the viewer does not require a preselected actor');
	const pane = part.activeGroup.panes.activePane!; assert.ok(pane instanceof ActorLabEditorPane); pane.focus();
	editor.commands.execute('sceneViewport.view2d', pane.commandTarget); editor.update(0);
	const view = input.worldView, frame = frames.displayed;
	const markerHash = (ide.guest.global('studio_test_world_marker') as Table).hashId;
	const captionHash = (ide.guest.global('studio_test_world_caption') as Table).hashId;
	const marker = view.canvas.items.find(item => item.source.entry.hashId === markerHash)!;
	assert.ok(marker); assert.equal(marker.affine.ox, 700, 'visual was outside the game camera, not reconstructed from scanout');
	const caption = view.canvas.items.filter(item => item.source.entry.hashId === captionHash);
	assert.equal(caption.length, 6, 'constructor-generated text is captured from the resolved glyph layout');
	assert.equal(caption[0].affine.ox, 708, 'physical and timeline presentation positions compose');
	assert.ok(caption.every(item => item.kind === 'sprite' && item.bitmap.image.pixels.some((value, i) => i % 4 === 3 && value !== 0)));
	assert.equal(view.geometry.scene.instances.length, 0, '2D viewing does not allocate unused 3D render resources');
	assert.equal(frame.world.models.peek(0).world.ox, 800);
	const cycles = f.runtime.machine.scheduler.nowCycles, appearance = frame.world.canvas.peek(0).appearance;
	const pick = view.canvas.items.find(item => item.source.entry.label.endsWith('bystander'))!;
	const x = pick.x + (pick.xx + pick.yx) / 2, y = pick.y + (pick.xy + pick.yy) / 2;
	f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }, { type: 'button', button: 'primary', down: false }]);
	assert.equal(input.actorHashId, pick.source.entry.hashId); assert.equal(input.actorPresent, true);
	const camera = view.camera.capture(), reads = t.mock.method(ide.guest, 'readStringMember'), textures = t.mock.method(view.assets, 'texture');
	f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'aux', down: true }, { type: 'pointer', x: x + 32, y: y + 16 }, { type: 'button', button: 'aux', down: false }]);
	assert.equal(reads.mock.callCount(), 0, 'camera gestures and picking use retained data, not the guest heap');
	assert.equal(textures.mock.callCount(), 0, 'camera motion does not resolve or decode textures'); reads.mock.restore(); textures.mock.restore();
	assert.notDeepEqual(view.camera.capture(), camera); assert.equal(f.runtime.machine.scheduler.nowCycles, cycles, 'paused camera navigation does not execute the guest');
	assert.equal(frame.world.canvas.peek(0).appearance, appearance, 'camera movement reuses captured appearance');
	const bystander = frame.world.canvas.peek(Array.from(frame.world.canvas).findIndex(item => item.actor.hashId === input.actorHashId));
	const oldX = bystander.pose.ox, cameraAfterPan = view.camera.capture();
	editor.interaction.setActive(false); ide.transport.resumeHere();
	await f.until(() => bystander.pose.ox !== oldX); ide.transport.pause(); editor.interaction.setActive(true); editor.update(0);
	assert.deepEqual(view.camera.capture(), cameraAfterPan, 'game updates never adopt the game camera');
	assert.equal(input.actorHashId, bystander.actor.hashId);
	editor.commands.execute('sceneViewport.view3d', pane.commandTarget); editor.update(0);
	const model = frame.world.models.peek(0); editor.actorLab.inspectActor(input, model.entry.domain, model.entry.hashId); editor.update(0);
	editor.commands.execute('sceneViewport.frameSelection', pane.commandTarget); editor.update(0);
	assert.equal(view.geometry.scene.instances.some(instance => instance.mesh.texture !== undefined), true);
	const scene = view.geometry.scene, target = createHeadlessHostMeshTarget(scene);
	renderHeadlessHostMeshScene(target, scene);
	assert.ok(target.pixels.some((value, index) => index % 4 === 3 && value !== 0), 'CPU renderer draws the captured textured model');
	let picked = false;
	for (let y = 0; y < scene.height && !picked; y += 4) for (let x = 0; x < scene.width; x += 4) {
		const actor = view.pick(view.bounds.left + x, view.bounds.top + y);
		if (actor?.hashId === model.entry.hashId) { picked = true; break; }
	}
	assert.ok(picked, '3D picking uses model triangles, not a collider or a camera-clipped sprite box');
	const source = cart.buffer.getText();
	const resources = [...scene.instances].map(instance => instance.mesh);
	const pose = { ...model.world }, revision = frames.revision;
	view.camera.orbit(12, -4); editor.update(0);
	assert.deepEqual(scene.instances.map(instance => instance.mesh), resources, 'orbit reuses geometry and GPU resources');
	assert.deepEqual(model.world, pose); assert.equal(frames.revision, revision);
	ide.guest.invalidate('history-restored'); editor.update(0);
	assert.equal(view.canvas.items.length, 0); assert.equal(view.geometry.scene.instances.length, 0, 'history retirement cannot expose prior-frame geometry');
	editor.commands.execute('actorLab.gameView', pane.commandTarget); editor.update(0);
	assert.equal(view.mode, 'game'); assert.equal(cart.buffer.getText(), source);
	ide.boots.start('workspace'); editor.update(0);
	assert.equal(input.actorHashId, 0); assert.equal(view.canvas.items.length, 0); assert.equal(view.geometry.scene.instances.length, 0);
});
