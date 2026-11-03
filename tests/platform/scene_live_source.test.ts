import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import { captureActorTarget } from '../../ide/workbench/contrib/actor_lab/target';
import { findRuntimeActor } from '../../ide/workbench/contrib/actor_lab/runtime';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { readActorChoices } from '../../ide/workbench/contrib/actor_lab/projection';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createLiveStudioFixture } from '../helpers/live_studio';

for (const pages of [1, 2]) test(`a visible initialized visual shares position history with its ${pages}-page runtime image`, async t => {
	const f = await createLiveStudioFixture(t), { editor, ide, sources } = f;
	const cart = resolveLuaTextFileModel(editorTextModelService, sources.catalog, sources.catalog.luaResources.find(resource => resource.path === 'cart.lua')!);
	const before = 'local scene<const> = scene_library.instantiate(root_scene.id)';
	cart.pushEditOperations([{ offset: cart.buffer.getText().indexOf(before), deleteLength: before.length,
		text: "local scene<const> = scene_library.instantiate('studio_test.initialized_text', { caption = { id = 'dynamic-caption', content = 'studio' } })" }]);
	if (pages === 2) {
		const offset = cart.buffer.getText().indexOf('framebuffer_count = 1');
		cart.pushEditOperations([{ offset, deleteLength: 'framebuffer_count = 1'.length, text: 'framebuffer_count = 2' }]);
	}
	assert.equal(ide.boots.start('workspace').result!.status, 'reset');
	editor.interaction.setActive(false); ide.transport.resumeHere();
	await f.until(() => ide.guest.global('studio_test_ready') === true);
	const actor = readActorChoices(sources, ide.guest, 0).find(item => item.label === 'dynamic-caption')!;
	const controller = editor.actorLab, frame = controller.viewportPicker.frame;
	await f.until(() => Array.from(frame.quads).some(quad => quad.hashId === actor.hashId));
	ide.transport.pause(); editor.interaction.setActive(true);
	const part = editor.editorParts.createDocument({ requestedBounds: { left: 0, top: 24, right: 800, bottom: 340 } });
	const input = controller.resolveInput(); part.activeGroup.openEditor(input); editor.update(0);
	const pane = part.activeGroup.panes.activePane!; assert.ok(pane instanceof ActorLabEditorPane);
	pane.focus(); editor.update(0);
	const quad = Array.from(frame.quads).find(quad => quad.hashId === actor.hashId)!;
	const bounds = input.previewBounds;
	const x = bounds.left + (quad.ox + quad.ax / 2) * (bounds.right - bounds.left) / frame.width;
	const y = bounds.top + (quad.oy + quad.by / 2) * (bounds.bottom - bounds.top) / frame.height;
	f.native.apply([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true }, { type: 'button', button: 'secondary', down: false }]);
	assert.equal(input.actorHashId, actor.hashId);
	assert.equal(editor.contextMenu.visible, true);
	assert.equal(editor.contextMenu.model.rows.some(row => row.command === 'actorLab.editScene' && row.enabled), true);
	editor.contextMenu.hide(); editor.commands.execute('actorLab.editScene', pane.commandTarget); editor.update(0);
	const scenePane = part.activeGroup.panes.activePane!; assert.ok(scenePane instanceof SceneEditorPane);
	assert.ok(scenePane.input instanceof SceneEditorInput);
	const authoring = scenePane.input.view.authoring, source = authoring.workingCopy;
	assert.equal(source.resource.path, 'scenes/text.lua');
	const document = ide.sceneSources.get(source);
	assert.equal(authoring.subject, document.scenes[1], 'not the first registration or another member with the same name');
	const selected = authoring.selection; assert.equal(selected?.kind, 'member');
	assert.equal(selected!.scene.objects[0], selected!.kind === 'member' ? selected!.entry : undefined);
	const original = source.buffer.getText(), cartText = cart.buffer.getText();
	assert.equal(authoring.captureLocalPosition()!.apply('x', 40), true);
	assert.equal(source.buffer.getText(), original.replace('x = 16, y = 120', 'x = 40, y = 120'), 'only the authored member position changes');
	assert.equal(cart.buffer.getText(), cartText, 'constructor inputs remain in the original caller');
	assert.equal(ide.sceneLive.source(0, actor.hashId, ide.sceneSources), undefined, 'uninstalled source is not attributed to the running plan');
	const liveX = () => Array.from(frame.quads).find(quad => quad.hashId === actor.hashId)!.ox;
	await f.until(() => liveX() === 48 && ide.actorExecution.active === undefined);
	assert.equal(ide.scenePositions.find(0, actor.hashId)!.x, 40);
	source.undo(); authoring.refresh();
	assert.equal(source.buffer.getText(), original);
	await f.until(() => liveX() === 24 && ide.actorExecution.active === undefined);
	// Sample the already initialized, seekable instance; no new Scene or controller.
	controller.inspectActor(input, 0, actor.hashId); controller.refresh(input);
	const timeline = input.runtime.roots[0].children.flatMap(node => node.children).find(node => node.kind === 'timeline')!;
	const scrub = ide.actorExecution.start({ kind: 'scrub', target: captureActorTarget(0, input.worldHashId!, input.runtime.roots, timeline, ide.guest),
		programHashId: (ide.guest.readStringMember(timeline.value, 'program') as Table).hashId, time: 500 });
	await f.until(() => scrub.result !== undefined);
	assert.equal(scrub.result!.status, 'completed');
	assert.equal(liveX(), 88, 'scrubbing redraws the actual initialized visual while the game stays paused');
	part.activeGroup.openEditor(input); controller.inspectActor(input, 0, actor.hashId); editor.update(0);
	const livePane = part.activeGroup.panes.activePane!; assert.ok(livePane instanceof ActorLabEditorPane);
	livePane.focus(); editor.update(0);
	const liveQuad = Array.from(frame.quads).find(quad => quad.hashId === actor.hashId)!;
	const scaleX = (input.previewBounds.right - input.previewBounds.left) / frame.width;
	const scaleY = (input.previewBounds.bottom - input.previewBounds.top) / frame.height;
	const startX = input.previewBounds.left + (liveQuad.ox + liveQuad.ax / 2) * scaleX;
	const startY = input.previewBounds.top + (liveQuad.oy + liveQuad.by / 2) * scaleY;
	f.native.apply([{ type: 'key', code: 'AltLeft', down: true }, { type: 'pointer', x: startX, y: startY },
		{ type: 'button', button: 'primary', down: true }, { type: 'pointer', x: startX + 24 * scaleX, y: startY + 16 * scaleY }]);
	assert.equal(source.buffer.getText(), original, 'pointer motion does not mutate source or run Lua');
	f.native.apply([{ type: 'button', button: 'primary', down: false }, { type: 'key', code: 'AltLeft', down: false }]);
	const moved = authoring.selectedLocalTransform!;
	assert.notEqual(moved.ox, 16);
	await f.until(() => liveX() === moved.ox + 72 && ide.actorExecution.active === undefined);
	assert.equal(Array.from(frame.quads).find(quad => quad.hashId === actor.hashId)!.oy, moved.oy);
	assert.notEqual(moved.oy, 120);
	assert.equal(source.buffer.getText(), original.replace('x = 16, y = 120', `x = ${moved.ox}, y = ${moved.oy}`), 'a live drag changes only member-position literals');
	editor.commands.execute('save', livePane.commandTarget);
	const save = ide.textFileSaves.latestOperation(source)!;
	assert.ok(save !== undefined, 'the live-image command uses the shared source Save owner');
	assert.equal((await save.completion).status, 'saved');
	assert.equal(save.snapshot.source, source.buffer.getText());
	editor.commands.execute('undo', livePane.commandTarget);
	await f.until(() => liveX() === 88 && ide.actorExecution.active === undefined);
	assert.equal(source.buffer.getText(), original, 'one Undo restores both authored axes');
	controller.refresh(input);
	const instance = input.runtime.roots[0].children.flatMap(node => node.children).find(node => node.kind === 'timeline')!;
	assert.equal(ide.guest.readStringMember(instance.value, 'position_ms'), 500, 'position edits and Undo do not advance the timeline');
	const restored = ide.sceneLive.source(0, actor.hashId, ide.sceneSources)!;
	assert.equal(restored.model, source); assert.equal(restored.member.actorHashId, actor.hashId);
	source.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- intervening source edit\n' }]); source.undo();
	assert.equal(editor.sceneEditor.openMember(part.activeGroup, source,
		{ document: restored.document, sourceVersion: restored.version, scene: restored.scene }, 0, () => ide.sceneLive.isCurrent(restored.member)), false,
		'Undo restores text, not an already captured opening request');
	// Reuse the same document and its authoring context on the next navigation.
	part.activeGroup.openEditor(input); controller.inspectActor(input, 0, actor.hashId); editor.update(0);
	editor.commands.execute('actorLab.editScene', part.activeGroup.panes.activePane!.commandTarget);
	assert.equal(part.activeGroup.model.activeTab, scenePane.input);
});

test('runtime source correspondence survives duplicate registry IDs but not procedural membership or heap replacement', async t => {
	const f = await createLiveStudioFixture(t), { editor, ide, sources } = f;
	const cart = resolveLuaTextFileModel(editorTextModelService, sources.catalog, sources.catalog.luaResources.find(resource => resource.path === 'cart.lua')!);
	const marker = 'scene_library.instantiate(live_scene.id)';
	cart.pushEditOperations([{ offset: cart.buffer.getText().indexOf(marker) + marker.length, deleteLength: 0, text: `
	scene_library.register(live_scene.id, { objects = {
		{ member_id = 'runner', definition_id = 'studio_test.actor', position = { x = 80, y = 100 }, options = { id = 'replacement' } },
	} })
	scene_library.instantiate(live_scene.id)
	scene:spawn('studio_test.actor', { id = 'procedural' })` }]);
	assert.equal(ide.boots.start('workspace').result!.status, 'reset');
	editor.interaction.setActive(false); ide.transport.resumeHere();
	await f.until(() => ide.guest.global('studio_test_ready') === true);
	ide.transport.pause(); editor.interaction.setActive(true);
	const actors = readActorChoices(sources, ide.guest, 0);
	const runner = actors.find(item => item.label === 'runner')!, replacement = actors.find(item => item.label === 'replacement')!;
	const first = ide.sceneLive.source(0, runner.hashId, ide.sceneSources)!, second = ide.sceneLive.source(0, replacement.hashId, ide.sceneSources)!;
	assert.equal(first.model.resource.path, 'scenes/live.lua');
	assert.equal(second.model, cart);
	assert.notEqual(first.member.sceneHashId, second.member.sceneHashId);
	assert.equal(ide.sceneLive.source(0, actors.find(item => item.label === 'procedural')!.hashId, ide.sceneSources), undefined);
	assert.equal(ide.boots.start('workspace').result!.status, 'reset');
	assert.equal(ide.sceneLive.isCurrent(first.member), false);
	assert.equal(ide.sceneLive.source(0, runner.hashId, ide.sceneSources), undefined);
});

test('Undo queued during a live position write settles the latest source on the same runtime', async t => {
	const f = await createLiveStudioFixture(t), { ide, sources, editor } = f;
	const actor = readActorChoices(sources, ide.guest, 0).find(item => item.label === 'studio_test.first')!;
	const binding = ide.scenePositions.bind(ide.scenePositions.source(0, actor.hashId)!)!, model = binding.authoring.workingCopy;
	const original = model.buffer.getText();
	assert.equal(binding.authoring.captureLocalPosition()!.apply('x', 40), true);
	await f.frame();
	const write = binding.operation!; assert.ok(write !== undefined);
	model.undo();
	await f.until(() => write.result !== undefined && ide.actorExecution.active === undefined && binding.x === 16);
	assert.equal(write.result!.status, 'completed');
	assert.equal(model.buffer.getText(), original);
	assert.equal(Array.from(editor.actorLab.viewportPicker.frame.quads).find(quad => quad.hashId === actor.hashId)!.ox, 16);
});

test('a member change before World admission retires a queued position-only write', async t => {
	const f = await createLiveStudioFixture(t), { ide, sources } = f;
	const actor = readActorChoices(sources, ide.guest, 0).find(item => item.label === 'studio_test.first')!;
	const binding = ide.scenePositions.bind(ide.scenePositions.source(0, actor.hashId)!)!, model = binding.authoring.workingCopy;
	assert.equal(binding.authoring.captureLocalPosition()!.apply('x', 40), true);
	await f.frame();
	const write = binding.operation!;
	assert.equal(write.invoked, false);
	const name = "member_id = 'first'", offset = model.buffer.getText().indexOf(name);
	model.pushEditOperations([{ offset, deleteLength: name.length, text: "member_id = 'renamed'" }]);
	await f.until(() => write.result !== undefined);
	assert.equal(write.invoked, false, 'a queued source edit cannot outlive its authored member correspondence');
	assert.equal(binding.linked, false);
	assert.equal(ide.guest.readStringMember(findRuntimeActor(sources, ide.guest, 0, actor.hashId)!, 'ox'), 16);
	assert.equal(model.buffer.getText().includes("member_id = 'renamed'"), true, 'authored changes are retained');
});

test('a controller-owned physical position rejects the live source write without losing source Undo', async t => {
	const f = await createLiveStudioFixture(t), { ide, sources, editor } = f;
	const actor = readActorChoices(sources, ide.guest, 0).find(item => item.label === 'runner')!;
	const binding = ide.scenePositions.bind(ide.scenePositions.source(0, actor.hashId)!)!, model = binding.authoring.workingCopy;
	const original = model.buffer.getText(), controller = editor.actorLab, input = controller.resolveInput();
	controller.inspectActor(input, 0, actor.hashId);
	const moving = input.runtime.roots[0].children.flatMap(node => node.children).flatMap(node => node.children).find(node => node.name === 'moving')!;
	const operation = ide.actorExecution.start({ kind: 'action', method: 'transition_to', args: [],
		target: captureActorTarget(0, input.worldHashId!, input.runtime.roots, moving, ide.guest) });
	await f.until(() => operation.result !== undefined);
	assert.equal(binding.authoring.captureLocalPosition()!.apply('x', 210), true);
	await f.until(() => !binding.linked);
	const x = ide.guest.readStringMember(findRuntimeActor(sources, ide.guest, 0, actor.hashId)!, 'ox');
	assert.notEqual(x, 200, 'ordinary controller code ran at World admission');
	assert.notEqual(x, 210, 'the source edit did not overwrite a controller-owned pose');
	assert.equal(ide.scenePositions.find(0, actor.hashId), binding, 'the canonical source history remains reachable');
	model.undo(); await f.frame();
	assert.equal(model.buffer.getText(), original);
	assert.equal(ide.guest.readStringMember(findRuntimeActor(sources, ide.guest, 0, actor.hashId)!, 'ox'), x, 'source Undo is not a rollback of controller execution');
	assert.equal(ide.boots.start('workspace').result!.status, 'reset');
	assert.equal(binding.attached, false);
	assert.equal(ide.scenePositions.find(0, actor.hashId), undefined);
});
