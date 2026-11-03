import { GX_GPU_STATUS_GPU_IDLE } from '../../machine/ts/machine/devices/gx/gpu';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { readActorChoices } from '../../ide/workbench/contrib/actor_lab/projection';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveStudioFixture } from '../helpers/live_studio';
import { findRuntimeActor } from '../../ide/workbench/contrib/actor_lab/runtime';

test('Actor picking retains the published game image, not later guest pose or a held repaint', async t => {
	const f = await createLiveStudioFixture(t), picker = f.editor.actorLab.viewportPicker, presenter = f.editor.actorLab.viewport.presenter;
	f.editor.interaction.setActive(false); f.ide.transport.resumeHere();
	await f.until(() => picker.frame.quads.length > 0);
	f.ide.transport.pause(); f.editor.interaction.setActive(true);
	const frame = picker.frame, sequence = presenter.gameFrameSequence;
	const observed = Array.from(frame.quads, quad => ({ ...quad }));
	assert.ok(observed.length >= 5, 'ordinary render captures all five initialized rectangles');
	const runner = observed.find(quad => quad.label.includes('runner'))!;
	assert.ok(runner, JSON.stringify(observed));
	const x = runner.ox + runner.ax / 2 + runner.bx / 2 + frame.offsetX;
	const y = runner.oy + runner.ay / 2 + runner.by / 2 + frame.offsetY;
	assert.equal(picker.pick(0, sequence, x, y)?.hashId, runner.hashId);
	assert.equal(picker.pick(0, sequence! + 1, x, y), undefined, 'image/evidence sequences must agree');
	const actor = findRuntimeActor(f.sources, f.ide.guest, 0, runner.hashId)!;
	const visual = f.ide.guest.readStringMember(actor, 'visual');
	// Later heap/caches are not the displayed image. No guest roots may have
	// survived the draw observation; selection only consumes copied scalars.
	f.ide.guest.invalidate();
	const read = t.mock.method(f.ide.guest, 'readStringMember');
	for (let i = 0; i < 100; i++) assert.equal(picker.pick(0, sequence, x + (i % 2) * 0.1, y)?.hashId, runner.hashId);
	assert.equal(read.mock.callCount(), 0);
	read.mock.restore();
	assert.notEqual(visual, null);
	await f.frame();
	assert.equal(presenter.gameFrameSequence, sequence, 'paused UI repaint holds the image');
	assert.deepEqual(Array.from(frame.quads, quad => ({ ...quad })), observed);
	assert.equal(picker.pick(0, sequence, x, y)?.hashId, runner.hashId);
	// Exercise the two publication boundaries independently. An in-flight GPU
	// prefix cannot be labeled as the preceding completed composition; until
	// its image is published, the old displayed image remains selectable.
	const output = f.runtime.machine.gxGpu.readDeviceOutput();
	f.ide.actorFrames.latched(output.statusWord & ~GX_GPU_STATUS_GPU_IDLE, output.pcrtcScanout, true);
	assert.equal(f.ide.actorFrames.displayCurrent, false);
	assert.equal(picker.pick(0, sequence, x, y)?.hashId, runner.hashId);
	f.ide.actorFrames.committed(sequence! + 1);
	assert.equal(picker.pick(0, sequence! + 1, x, y), undefined);
	f.ide.guest.invalidate('history-restored');
	assert.equal(picker.pick(0, sequence, x, y), undefined, 'restore cannot carry prior-heap image evidence');
	const commit = t.mock.method(f.ide.actorFrames, 'committed');
	f.ide.actorFrames.dispose();
	presenter.configurePresentation('completed', true); presenter.present(output, 0, 0);
	assert.equal(commit.mock.callCount(), 0, 'service retirement detaches before the frontend and presenter are destroyed');
});

for (const pageCount of [1, 2]) test(`moving actors are picked in the completed ${pageCount}-page image through ordinary boot and rendering`, async t => {
	const f = await createLiveStudioFixture(t), { editor, ide, sources } = f;
	for (const [path, before, after] of [
		['cart.lua', 'framebuffer_count = 1', `framebuffer_count = ${pageCount}`],
		['scenes/live.lua', "initial = 'idle'", "initial = 'moving'"],
	]) {
		const model = resolveLuaTextFileModel(editorTextModelService, sources.catalog, sources.catalog.luaResources.find(resource => resource.path === path)!);
		const text = model.buffer.getText(), offset = text.indexOf(before); assert.ok(offset >= 0);
		model.pushEditOperations([{ offset, deleteLength: before.length, text: after }]);
	}
	assert.equal(ide.boots.start('workspace').result!.status, 'reset');
	editor.interaction.setActive(false); ide.transport.resumeHere();
	await f.until(() => ide.guest.global('studio_test_ready') === true);
	const runner = readActorChoices(sources, ide.guest, 0).find(actor => actor.label === 'runner')!;
	const controller = editor.actorLab, picker = controller.viewportPicker, presenter = controller.viewport.presenter;
	const observed = () => {
		for (let i = 0; i < picker.frame.quads.length; i++) {
			const quad = picker.frame.quads.peek(i);
			if (quad.hashId === runner.hashId) return quad;
		}
	};
	await f.until(() => observed() !== undefined);
	const first = { ...observed()! }, firstSequence = presenter.gameFrameSequence;
	assert.equal(picker.pick(0, firstSequence, first.ox + first.ax / 2, first.oy + first.by / 2)?.hashId, runner.hashId);
	await f.until(() => observed() !== undefined && Math.abs(observed()!.ox - first.ox) > 12 && Math.abs(observed()!.oy - first.oy) > 2);
	ide.transport.pause(); editor.interaction.setActive(true);
	const second = { ...observed()! }, secondSequence = presenter.gameFrameSequence;
	assert.notEqual(secondSequence, firstSequence);
	assert.equal(picker.pick(0, secondSequence, second.ox + second.ax / 2, second.oy + second.by / 2)?.hashId, runner.hashId);
	assert.notEqual(picker.pick(0, secondSequence, first.ox + first.ax / 2, first.oy + first.by / 2)?.hashId, runner.hashId);
	const image = await presenter.captureGameFrame();
	// This is a rendering/picking correspondence assertion, not a frozen UI
	// layout: the selected quad's center lies in the real rectangle's pixels.
	const pixel = ((Math.trunc(second.oy + second.by / 2) * image.width) + Math.trunc(second.ox + second.ax / 2)) * 4;
	assert.notDeepEqual(image.pixels.slice(pixel, pixel + 3), image.pixels.slice(0, 3));

	const part = editor.editorParts.createDocument({ requestedBounds: { left: 0, top: 24, right: 800, bottom: 340 } });
	const input = controller.resolveInput(); input.domain = 0;
	part.activeGroup.openEditor(input); editor.update(0);
	const pane = part.activeGroup.panes.activePane!; assert.ok(pane instanceof ActorLabEditorPane);
	pane.focus(); editor.update(0);
	assert.equal(input.layout.previewVisible, true);
	const bounds = input.previewBounds, frame = picker.frame;
	const x = bounds.left + (second.ox + second.ax / 2) * (bounds.right - bounds.left) / frame.width;
	const y = bounds.top + (second.oy + second.by / 2) * (bounds.bottom - bounds.top) / frame.height;
	f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true }, { type: 'button', button: 'secondary', down: false }]);
	assert.equal(input.actorHashId, runner.hashId, 'pointer selection opens the actual visual owner');
	assert.equal(input.actorPresent, true);
});


test('ordinary cart initialization renders pickable dynamic text and sprite visuals without source-pattern projection', async t => {
	const f = await createLiveStudioFixture(t), { editor, ide, sources } = f;
	const cart = resolveLuaTextFileModel(editorTextModelService, sources.catalog, sources.catalog.luaResources.find(resource => resource.path === 'cart.lua')!);
	const before = 'local scene<const> = scene_library.instantiate(root_scene.id)';
	const offset = cart.buffer.getText().indexOf(before); assert.ok(offset >= 0);
	cart.pushEditOperations([{ offset, deleteLength: before.length, text: `
	local scene<const> = scene_library.instantiate('studio_test.initialized_text', { caption = { id = 'dynamic-text', content = 'studio' } })
	scene_library.instantiate('studio_test.animated', {
		actor = { id = 'sprite-actor' }, alternate = { id = 'sprite-alternate' }, sequence = { id = 'sprite-sequence' },
	})` }]);
	assert.equal(ide.boots.start('workspace').result!.status, 'reset');
	editor.interaction.setActive(false); ide.transport.resumeHere();
	await f.until(() => ide.guest.global('studio_test_ready') === true);
	const choices = readActorChoices(sources, ide.guest, 0), picker = editor.actorLab.viewportPicker;
	await f.until(() => picker.frame.quads.length >= 6);
	ide.transport.pause(); editor.interaction.setActive(true);
	for (const label of ['dynamic-text', 'sprite-actor', 'sprite-alternate', 'sprite-sequence']) {
		const actor = choices.find(choice => choice.label === label)!; assert.ok(actor);
		let quad;
		for (let i = 0; i < picker.frame.quads.length; i++) if (picker.frame.quads.peek(i).hashId === actor.hashId) quad = picker.frame.quads.peek(i);
		assert.ok(quad, `${label} was actually drawn`);
		assert.equal(picker.pick(0, picker.frame.sequence, quad.ox + quad.ax / 2 + quad.bx / 2, quad.oy + quad.ay / 2 + quad.by / 2)?.hashId, actor.hashId);
		if (label === 'dynamic-text') {
			assert.equal(quad.ox, 24, 'authored X=16 composes with presentation X=8');
			assert.ok(quad.ax > 0 && quad.by > 0, 'constructor-produced text has actual layout dimensions');
		}
	}
});
