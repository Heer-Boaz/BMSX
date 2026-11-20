import assert from 'node:assert/strict';
import test from 'node:test';
import { ActorWorldView } from '../../ide/workbench/contrib/actor_lab/world_view';
import { createHeadlessHostMeshTarget, renderHeadlessHostMeshScene } from '../../machine/ts/render/host_overlay/headless/mesh';
import { createLiveStudioFixture } from '../helpers/live_studio';
import { afterTest } from '../helpers/test_cleanup';

test('2D and 3D readers retain identities and poses across the same game publication', async t => {
	const f = await createLiveStudioFixture(t, {
		edits: { 'cart.lua': cart => {
			const at = cart.buffer.getText().indexOf('\n\tworld:render()');
			assert.ok(at >= 0);
			cart.pushEditOperations([{ offset: at, deleteLength: 0, text: `
	-- Reordering replaces retained draw slots without changing these objects.
	studio_test_actor:get_component(rectangle_component):set_order(studio_test_rendered_frames % 8 < 4 and -1 or 1)
` }]);
		} },
		ready: ({ editor }) => editor.actorLab.renderFrames.displayed.world.canvas.length >= 5,
	});
	const { editor, ide, sources } = f;
	const frames = editor.actorLab.renderFrames;
	const bounds = { left: 0, top: 0, right: 320, bottom: 240 };
	const held = (['2d', '3d'] as const).map(mode => {
		const view = new ActorWorldView(sources, frames);
		afterTest(t, () => view.dispose());
		view.setMode(mode);
		view.refresh(bounds, 0, 0);
		const packet = view.canvas.items.find(item => item.source.entry.label.endsWith('studio_test.first'))!;
		assert.ok(packet);
		const affine = packet.affine, actor = packet.source.entry, identity = { ...actor }, pose = { ...affine };
		const slot = view.canvas.items.indexOf(packet), camera = view.camera;
		view.refresh(bounds, 0, identity.hashId); view.frameAll(true); view.refresh(bounds, 0, identity.hashId);
		const framed = camera.capture();
		const localX = packet.offsetX + packet.width / 2, localY = packet.offsetY + packet.height / 2;
		const worldX = pose.xx * localX + pose.yx * localY, worldY = pose.xy * localX + pose.yy * localY;
		const sign = mode === '2d' ? 1 : -1;
		const x = bounds.right / 2 + camera.projectX(worldX, worldY * sign, 0, pose.ox, pose.oy * sign);
		const y = bounds.bottom / 2 + camera.projectY(worldX, worldY * sign, 0, pose.ox, pose.oy * sign);
		assert.deepEqual(view.pick(x, y), identity, mode);
		const image = mode === '3d' ? createHeadlessHostMeshTarget(bounds.right, bounds.bottom) : undefined;
		if (image !== undefined) renderHeadlessHostMeshScene(image, view.geometry.scene);
		return { view, mode, packet, affine, actor, identity, pose, slot, framed, x, y, image, pixels: image?.pixels.slice() };
	});

	// Publish the next game frame once while both view readers still hold N.
	editor.interaction.setActive(false); ide.transport.resumeHere();
	await f.until(() => held.every(({ slot, identity }) => frames.displayed.world.canvas.peek(slot).actor.hashId !== identity.hashId));
	ide.transport.pause();
	for (const { view, mode, packet, affine, actor, identity, pose, slot, framed, x, y, image, pixels } of held) {
		assert.deepEqual(view.pick(x, y), identity, `${mode}: a held draw slot cannot inherit the next occupant`);
		assert.deepEqual(packet.affine, pose, `${mode}: frame-all and selection use the same publication`);
		view.frameAll(true);
		assert.deepEqual(view.camera.capture(), framed, `${mode}: framing cannot follow the next occupant`);
		if (image !== undefined) {
			renderHeadlessHostMeshScene(image, view.geometry.scene);
			assert.deepEqual(image.pixels, pixels, 'the held view still renders the same geometry');
		}
		const reads = t.mock.method(ide.guest, 'readStringMember');
		view.refresh(bounds, 0, identity.hashId);
		assert.equal(reads.mock.callCount(), 0, 'view publication consumes render evidence, not another heap scan');
		reads.mock.restore();
		assert.deepEqual(view.pick(x, y), identity, `${mode}: the new order keeps the actor pickable`);
		assert.equal(view.canvas.items[slot], packet, 'packet storage is retained across publications');
		assert.equal(view.canvas.items[slot].affine, affine, 'pose storage is retained across publications');
		assert.equal(view.canvas.items[slot].source.entry, actor, 'identity storage is retained across publications');
		view.retire();
		assert.equal(view.pick(x, y), undefined, 'retirement removes the view publication itself');
	}
});

for (const pageCount of [1, 2]) test(`${pageCount}-page streamed models publish even with an empty final command buffer; retirement cannot relabel the held view`, async t => {
	const f = await createLiveStudioFixture(t, {
		edits: { 'cart.lua': cart => {
			const text = cart.buffer.getText(), pages = text.indexOf('framebuffer_count = 1');
			const construct = text.indexOf('\nend\n\nnew_game()'), render = text.indexOf('\n\tworld:render()');
			assert.ok(pages >= 0 && construct >= 0 && render >= 0);
			cart.pushEditOperations([
				{ offset: pages, deleteLength: 'framebuffer_count = 1'.length, text: `framebuffer_count = ${pageCount}` },
				{ offset: construct, deleteLength: 0, text: `
	local models<const> = scene_library.instantiate('studio_test.textured')
	studio_test_model = models.members.panels
	world:spawn('studio_test.textured', { id = 'replacement', position = { x = 600, y = 0, z = 0 } })
` },
				{ offset: render, deleteLength: 0, text: `
	if studio_test_rendered_frames == 8 then studio_test_model:mark_for_disposal() end
` },
			]);
		} },
		ready: ({ editor }) => editor.actorLab.renderFrames.displayed.world.models.length !== 0,
	});
	const { editor, ide, sources } = f;
	const frames = editor.actorLab.renderFrames;
	assert.equal(frames.displayed.world.models.length, 2, 'the final visual streams its triangles before World submits the already-empty buffer');
	ide.transport.pause();
	const identity = { ...frames.displayed.world.models.peek(0).entry };
	const view = new ActorWorldView(sources, frames);
	afterTest(t, () => view.dispose());
	view.setMode('3d');
	const bounds = { left: 0, top: 0, right: 320, bottom: 240 };
	view.refresh(bounds, identity.domain, identity.hashId); view.frameAll(true); view.refresh(bounds, identity.domain, identity.hashId);
	const scene = view.geometry.scene, image = createHeadlessHostMeshTarget(bounds.right, bounds.bottom);
	renderHeadlessHostMeshScene(image, scene);
	const pixels = image.pixels.slice(), instances = scene.instances.slice();
	let hit: { x: number; y: number } | undefined;
	for (let y = 0; y < scene.height && hit === undefined; y += 2) for (let x = 0; x < scene.width; x += 2) {
		if (view.pick(x, y)?.hashId === identity.hashId) { hit = { x, y }; break; }
	}
	assert.ok(hit, 'an actual textured-model triangle is pickable');
	editor.interaction.setActive(false); ide.transport.resumeHere();
	await f.until(() => frames.displayed.world.models.length === 1);
	ide.transport.pause();
	assert.notEqual(frames.displayed.world.models.peek(0).entry.hashId, identity.hashId);
	assert.deepEqual(view.pick(hit.x, hit.y), identity, 'a completed image remains associated with its rendered model');
	renderHeadlessHostMeshScene(image, scene); assert.deepEqual(image.pixels, pixels);
	assert.deepEqual(scene.instances, instances);
	view.refresh(bounds, identity.domain, identity.hashId);
	assert.notEqual(view.pick(hit.x, hit.y)?.hashId, identity.hashId, 'the next view publication retires the removed model');
});
