import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import { readActorChoices } from '../../ide/workbench/contrib/actor_lab/projection';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createLiveStudioFixture } from '../helpers/live_studio';

test('a visible initialized visual opens its exact authored member and the shared position history', async t => {
	const f = await createLiveStudioFixture(t), { editor, ide, sources } = f;
	const cart = resolveLuaTextFileModel(editorTextModelService, sources.catalog, sources.catalog.luaResources.find(resource => resource.path === 'cart.lua')!);
	const before = 'local scene<const> = scene_library.instantiate(root_scene.id)';
	cart.pushEditOperations([{ offset: cart.buffer.getText().indexOf(before), deleteLength: before.length,
		text: "local scene<const> = scene_library.instantiate('studio_test.initialized_text', { caption = { id = 'dynamic-caption', content = 'studio' } })" }]);
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
	source.undo(); authoring.refresh();
	assert.equal(source.buffer.getText(), original);
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
