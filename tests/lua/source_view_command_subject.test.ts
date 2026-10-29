import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { captureSourceViewOpening } from '../../ide/workbench/contrib/source_views/quick_access';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { editorTextModelService } from '../../ide/editor/model/model_service';

function fixture(t: Parameters<typeof createActualSourcePanes>[0]) {
	const f = createActualSourcePanes(t, false, [
		['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}'],
	]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const input = resolveLuaCodeEditorInput(f.sources.catalog, resource);
	f.firstGroup.openEditor(input, { pinned: true }); f.update();
	return { ...f, resource, input };
}

for (const explicit of [false, true]) test(`Animation receives its ${explicit ? 'explicit' : 'implicit'} source subject independently of its opening destination`, t => {
	const f = fixture(t), open = t.mock.method(f.editor.animations, 'open', () => {});
	f.editor.commands.execute('animation', f.first.commandTarget, explicit ? f.input : undefined, f.second.commandTarget);
	assert.equal(open.mock.callCount(), 1);
	const [destination, , source] = open.mock.calls[0].arguments;
	assert.equal(destination, f.secondGroup);
	assert.equal(source!.model, f.input.workingCopy);
});

for (const explicit of [false, true]) test(`Scene opens its ${explicit ? 'explicit' : 'implicit'} source subject rather than the receiver document`, t => {
	const f = fixture(t), open = t.mock.method(f.editor.sceneEditor, 'openResource', () => {});
	f.editor.commands.execute('sceneEditor', f.first.commandTarget, explicit ? f.input : undefined, f.second.commandTarget);
	assert.equal(open.mock.callCount(), 1);
	const [destination, resource] = open.mock.calls[0].arguments;
	assert.equal(destination, f.secondGroup);
	assert.equal(resource, f.resource);
});

for (const command of ['animation', 'sceneEditor'] as const) test(`${command} from Main has no implicit background document subject`, async t => {
	const f = fixture(t), document = f.ide.sceneSources.get(f.input.workingCopy);
	assert.equal(await f.editor.openSceneInMain(f.input.workingCopy,
		{ document, sourceVersion: f.input.workingCopy.version, scene: document.scenes[0] }, f.first.commandTarget), true);
	const main = f.editor.mainWorkspace.primary;
	assert.ok(main instanceof ScenePrimaryClient);
	if (command === 'animation') {
		const open = t.mock.method(f.editor.animations, 'open', () => {});
		f.editor.commands.execute(command, main.commandTarget, undefined, f.second.commandTarget);
		assert.equal(open.mock.callCount(), 1);
		assert.equal(open.mock.calls[0].arguments[0], f.secondGroup);
		assert.equal(open.mock.calls[0].arguments[2], undefined);
	} else {
		const open = t.mock.method(f.editor.sceneEditor, 'openResource', () => {});
		f.editor.commands.execute(command, main.commandTarget, undefined, f.second.commandTarget);
		assert.equal(open.mock.callCount(), 0);
		assert.equal(f.secondPart.quickInput.visible, true, 'without an authored document subject, opening is an explicit source choice');
	}
});

test('Animation source acquisition cannot publish into a receiver after the invoking source attachment retires', t => {
	const f = createActualSourcePanes(t, false, [
		['caller.lua', "return require('definition')"],
		['definition.lua', 'return { duration_ms=100, tracks={} }'],
	]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'caller.lua' })!;
	const definition = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'definition.lua' })!;
	const input = resolveLuaCodeEditorInput(f.sources.catalog, resource);
	f.firstGroup.openEditor(input, { pinned: true }); f.update();
	const target = f.firstGroup.panes.activePane!.commandTarget, receiver = f.secondGroup.panes.activePane!.commandTarget;
	assert.equal(editorTextModelService.get(definition), undefined);
	let acquired = false;
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource.path !== definition.path) return;
		acquired = true;
		f.firstGroup.activate(f.firstInput.id);
	}));
	f.editor.commands.execute('animation', target, undefined, receiver);
	assert.equal(acquired, true, 'native animation production resolves its actual imported source model');
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput, 'retired source authority cannot publish into an independent receiver');
});

test('a seeded Scene opening hands authority to its own group without retaining the departed Source control', t => {
	const f = fixture(t);
	f.editor.commands.execute('sceneEditor', f.first.commandTarget);
	const input = f.firstGroup.model.activeTab;
	assert.ok(input?.kind === 'scene_editor');
	assert.equal(input.workingCopy, f.input.workingCopy);
	assert.equal(f.firstGroup.panes.activePane!.input, input);
});

test('a seeded Animation opening consumes its same-group sender receipt', t => {
	const f = createActualSourcePanes(t, false, [['animation.lua', 'return { duration_ms=100, tracks={} }']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'animation.lua' })!;
	const code = resolveLuaCodeEditorInput(f.sources.catalog, resource);
	f.firstGroup.openEditor(code, { pinned: true }); f.update();
	f.editor.commands.execute('animation', f.firstGroup.panes.activePane!.commandTarget);
	const input = f.firstGroup.model.activeTab;
	assert.ok(input?.kind === 'animation');
	assert.equal(input.workingCopy, code.workingCopy);
	assert.equal(f.firstGroup.panes.activePane!.input, input);
});

test('a source chooser acquires its own accepted choice after ordinary sender blur', async t => {
	const f = createActualSourcePanes(t, false, [['animation.lua', 'return { duration_ms=100, tracks={} }']]);
	f.editor.commands.execute('animation', f.first.commandTarget);
	const picker = f.firstPart.quickInput;
	assert.equal(picker.visible, true);
	assert.equal(picker.model.items.length, 1);
	picker.model.list.selectionIndex = 0;
	await picker.accept(); f.update();
	assert.equal(picker.visible, false);
	assert.equal(f.firstGroup.model.activeTab?.kind, 'animation');
});

test('an explicit inactive source uses its retained membership, not another document control', t => {
	const f = createActualSourcePanes(t, false, [
		['caller.lua', "return require('definition')"], ['definition.lua', 'return { duration_ms=100, tracks={} }'],
	]);
	f.firstGroup.model.pin(f.firstInput);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'caller.lua' })!;
	const input = resolveLuaCodeEditorInput(f.sources.catalog, resource);
	f.firstGroup.openEditor(input, { pinned: true }); f.firstGroup.activate(f.firstInput.id); f.update();
	let acquired = false;
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource.path !== 'definition.lua') return;
		acquired = true; f.firstGroup.activate(input.id);
	}));
	f.editor.commands.execute('animation', f.first.commandTarget, input, f.second.commandTarget);
	assert.equal(acquired, true);
	assert.equal(f.secondGroup.model.activeTab?.kind, 'animation');
});

test('an explicit inactive preview source hands off to its same-group projection before preview retirement', t => {
	const f = createActualSourcePanes(t, false, [['animation.lua', 'return { duration_ms=100, tracks={} }']]);
	f.firstGroup.model.pin(f.firstInput);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'animation.lua' })!;
	const input = resolveLuaCodeEditorInput(f.sources.catalog, resource);
	f.firstGroup.openEditor(input, { pinned: false }); f.firstGroup.activate(f.firstInput.id); f.update();
	assert.equal(f.firstGroup.model.previewTab, input);
	const opening = captureSourceViewOpening(f.firstGroup, input, f.firstGroup)!;
	f.editor.animations.open(f.firstGroup, f.firstPart.quickInput, { ...opening, options: { ...opening.options, pinned: false } });
	assert.equal(f.firstGroup.model.activeTab?.kind, 'animation');
	assert.equal(f.firstGroup.model.contains(input), false);
	assert.equal(f.firstGroup.panes.activePane!.input, f.firstGroup.model.activeTab);
});

test('a retained membership receipt cannot revive after a transfer away and back', t => {
	const f = createActualSourcePanes(t);
	const current = f.firstGroup.model.captureMembership(f.firstInput)!;
	assert.equal(current(), true);
	f.firstGroup.model.transferTo(f.secondGroup.model, f.firstInput).publish();
	assert.equal(current(), false);
	f.secondGroup.model.transferTo(f.firstGroup.model, f.firstInput).publish();
	assert.equal(f.firstGroup.model.contains(f.firstInput), true);
	assert.equal(current(), false);
	assert.equal(f.firstGroup.model.captureMembership(f.firstInput)!(), true);
});
