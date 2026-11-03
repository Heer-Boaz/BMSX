import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { ActorLabEditorPane } from '../../ide/workbench/contrib/actor_lab/editor_pane';
import { findRuntimeActor, runtimeWorld } from '../../ide/workbench/contrib/actor_lab/runtime';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import type { Table } from '../../machine/ts/machine/cpu/table';
import { createLiveStudioFixture } from '../helpers/live_studio';

async function fixture(t: TestContext, path = 'scenes/live.lua') {
	const f = await createLiveStudioFixture(t), { ide, editor, sources } = f;
	const source = resolveLuaTextFileModel(editorTextModelService, sources.catalog, sources.catalog.luaResources.find(resource => resource.path === path)!);
	const document = ide.sceneSources.get(source), scene = document.scenes[0];
	const part = editor.editorParts.createDocument({ requestedBounds: { left: 0, top: 24, right: 800, bottom: 340 } });
	assert.equal(editor.sceneEditor.openDefinition(part.activeGroup, source.resource, luaSourceRangeToTextRange(source.buffer, scene.range)), true);
	const pane = part.activeGroup.panes.activePane!; assert.ok(pane instanceof SceneEditorPane);
	pane.focus(); editor.update(0);
	assert.ok(pane.input instanceof SceneEditorInput);
	const authoring = pane.input.view.authoring;
	const select = (index: number) => {
		authoring.refresh(); const current = authoring.subject!;
		assert.equal(authoring.select(authoring.document!, source.version, { kind: 'member', scene: current, entry: current.objects[index], index }), true);
		editor.update(0);
	};
	const inspect = () => {
		assert.equal(editor.commands.isEnabled('sceneEditor.inspectLive', pane.control.focusTarget), true);
		editor.commands.execute('sceneEditor.inspectLive', pane.control.focusTarget);
	};
	return { ...f, part, pane, source, authoring, select, inspect };
}

test('Scene Inspect opens the exact normally initialized member in the existing live runtime editor', async t => {
	const f = await fixture(t), { ide, editor, part, source, authoring } = f;
	f.select(0);
	const version = source.version, text = source.buffer.getText();
	const result = ide.sceneLive.select(authoring);
	assert.equal(result.status, 'available'); assert.equal(result.members.length, 1);
	const member = result.members[0], actor = findRuntimeActor(f.sources, ide.guest, member.domain, member.actorHashId)!;
	assert.equal(ide.guest.formatValue(ide.guest.readStringMember(actor, 'id')), 'runner');
	assert.notEqual(ide.guest.readStringMember(actor, 'visual'), null, 'ordinary initialize created the visual');
	f.inspect();
	const pane = part.activeGroup.panes.activePane!; assert.ok(pane instanceof ActorLabEditorPane);
	assert.equal(pane.input.actorHashId, member.actorHashId);
	const controller = editor.actorLab, input = pane.input;
	const machine = input.runtime.roots[0].children.find(node => node.children.some(child => child.kind === 'machine'))!.children[0];
	controller.projection.reveal(machine.children.find(node => node.name === 'moving')!); editor.update(0);
	editor.commands.execute('actorLab.run', pane.commandTarget);
	const operation = ide.actorExecution.active!;
	await f.until(() => operation.result !== undefined);
	assert.equal(operation.result!.status, 'completed');
	for (let frame = 0; frame < 8; frame++) await f.frame();
	assert.equal(controller.viewport.transport.runtime === f.runtime, true);
	assert.ok((ide.guest.readStringMember(findRuntimeActor(f.sources, ide.guest, member.domain, member.actorHashId)!, 'updates') as number) > 0);
	assert.equal(source.version, version); assert.equal(source.buffer.getText(), text);
});

test('Inspect never constructs a registered Scene which normal gameplay has not initialized', async t => {
	const f = await fixture(t, 'scenes/text.lua');
	const world = runtimeWorld(f.sources, f.ide.guest, 0)!, objects = f.ide.guest.readStringMember(world, '_objects') as Table;
	const count = objects.arrayLength, identity = world.hashId;
	assert.equal(f.ide.sceneLive.select(f.authoring).status, 'not-live');
	f.inspect();
	assert.equal(f.part.activeGroup.panes.activePane === f.pane, true);
	assert.equal(objects.arrayLength, count);
	assert.equal(runtimeWorld(f.sources, f.ide.guest, 0)!.hashId, identity);
	assert.equal(f.ide.fault.faultSnapshot, null);
});

test('source edits and Undo retain canonical authoring while invalidating stale runtime correspondence', async t => {
	const f = await fixture(t); f.select(0);
	const original = f.source.buffer.getText(), member = f.ide.sceneLive.select(f.authoring).members[0];
	const command = f.pane.control.focusTarget.getCommand('sceneEditor.inspectLive')!.capture!()!;
	const offset = original.indexOf('x = 200');
	f.source.pushEditOperations([{ offset, deleteLength: 'x = 200'.length, text: 'x = 174' }]); f.authoring.refresh();
	assert.equal(f.ide.sceneLive.select(f.authoring).status, 'source-changed');
	assert.equal(command.isEnabled(), false); command.run();
	assert.equal(f.part.activeGroup.panes.activePane === f.pane, true);
	f.source.undo(); f.authoring.refresh();
	assert.equal(f.source.buffer.getText(), original);
	const restored = f.ide.sceneLive.select(f.authoring);
	assert.equal(restored.status, 'available'); assert.equal(restored.members[0].actorHashId, member.actorHashId);
	assert.equal(command.isEnabled(), false, 'Undo does not resurrect a captured command');
});

test('repeated live instances are chosen by runtime identity; edits dismiss the pending choice', async t => {
	const f = await fixture(t); f.select(0);
	const old = f.ide.sceneLive.select(f.authoring).members[0];
	const cart = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.sources.catalog.luaResources.find(resource => resource.path === 'cart.lua')!);
	const boot = cart.buffer.getText(), offset = boot.indexOf('scene_library.instantiate(live_scene.id)');
	cart.pushEditOperations([{ offset, deleteLength: 0,
		text: "scene_library.instantiate(live_scene.id, { runner = { id = 'second-runner' }, bystander = { id = 'second-bystander' } })\n\t" }]);
	assert.equal(f.ide.boots.start('workspace').result!.status, 'reset');
	f.editor.interaction.setActive(false); f.ide.transport.resumeHere();
	await f.until(() => f.ide.guest.global('studio_test_ready') === true); f.ide.transport.pause(); f.editor.interaction.setActive(true);
	assert.equal(f.ide.sceneLive.isCurrent(old), false, 'a new heap cannot resurrect the old instance receipt');
	const instances = f.ide.sceneLive.select(f.authoring);
	assert.equal(instances.members.length, 2);
	assert.notEqual(instances.members[0].sceneHashId, instances.members[1].sceneHashId);
	f.inspect(); assert.equal(f.editor.quickInput.visible, true);
	f.source.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- edit while choosing\n' }]);
	assert.equal(f.editor.quickInput.visible, false); assert.equal(f.part.activeGroup.panes.activePane === f.pane, true);
	f.source.undo(); f.authoring.refresh(); f.editor.update(0);
	f.inspect(); assert.equal(f.editor.quickInput.model.list.rows.length, 2);
	f.editor.quickInput.model.list.selectionIndex = 1;
	const row = f.editor.quickInput.model.list.rows[1];
	await f.editor.quickInput.accept();
	const pane = f.part.activeGroup.panes.activePane!; assert.ok(pane instanceof ActorLabEditorPane);
	assert.equal(pane.input.actorHashId, instances.members[row.itemIndex].actorHashId);
});
