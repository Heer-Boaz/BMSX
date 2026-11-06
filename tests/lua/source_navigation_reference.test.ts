import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorSourceLocation } from '../../ide/editor/navigation/source_location';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_IMPORTS, SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';

// Identity predicates keep failures from inspecting the Studio's machine buffers.
async function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [...SCENE_VIEWPORT_IMPORTS,
		['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}'],
	]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	const document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), f.first.commandTarget), true);
	f.update();
	const main = f.editor.mainWorkspace, primary = main.primary;
	assert.ok(primary instanceof ScenePrimaryClient);
	main.focusPrimary('hierarchy');
	const origin = primary.hierarchy.control.focusTarget;
	assert.ok(inputFocus.admittedTarget === origin, 'the Main hierarchy owns keyboard focus');
	return { ...f, model, resource, main, primary, origin };
}

for (const placement of ['default', 'side'] as const)
	test(`Main's default source anchor cannot adopt a reentrant ${placement} reference opening as its own resolution`, async t => {
		const f = await fixture(t), reference = f.editor.editorParts.main.activeGroup;
		const ready = Promise.withResolvers<EditorSourceLocation | undefined>();
		const newer = new HostErrorInput('New reference attachment');
		const groups = [...f.editor.editorParts.groups];
		let resolving = false, replaced = false;
		const capture = f.main.captureSourceNavigation.bind(f.main);
		t.mock.method(f.main, 'captureSourceNavigation', options => {
			const source = capture(options); assert.ok(source !== undefined);
			return { ...source, beginResolution: () => { resolving = true; return source.beginResolution(); } };
		});
		const pending = f.editor.navigation.openSource(f.main, { target: f.origin, placement, source: {
			isCurrent: () => {
				if (resolving && !replaced) {
					replaced = true;
					reference.openEditor(newer, { preserveFocus: true });
				}
				return true;
			},
			readLocation: () => ready.promise,
		} });
		assert.equal(replaced, true);
		ready.resolve({ model: f.model, modelVersion: f.model.version });
		assert.equal(await pending, undefined);
		assert.ok(reference.model.activeTab === newer, 'the newer reference opening remains active');
		const currentGroups = f.editor.editorParts.groups;
		assert.equal(currentGroups.length, groups.length, 'superseded navigation creates no receiving group');
		assert.ok(currentGroups.every((group, index) => group === groups[index]), 'existing group identities and order remain unchanged');
		assert.ok(f.main.primary === f.primary, 'superseded navigation retains the Main source producer');
		assert.ok(inputFocus.admittedTarget === f.origin, 'superseded navigation retains the invoking hierarchy focus');
		assert.equal(f.editor.editorParts.groups.some(group => group.model.tabs.some(input =>
			input instanceof CodeEditorInput && input.workingCopy === f.model)), false);
	});

test('reusing a third-group Source cannot activate after its separately requested reference is replaced during handoff', async t => {
	const f = await fixture(t), reference = f.firstGroup, receiver = f.secondGroup;
	const existing = new CodeEditorInput(f.model);
	receiver.openEditor(existing, { pinned: true });
	f.main.focusPrimary('hierarchy');
	const newer = new HostErrorInput('New reference attachment');
	let replaced = false;
	t.after(receiver.panes.onWillShowEditor(() => {
		if (replaced) return;
		replaced = true;
		reference.openEditor(newer, { preserveFocus: true });
	}));
	const result = await f.editor.navigation.openSource(f.main, {
		target: f.origin, reference,
		source: { readLocation: () => ({ model: f.model, modelVersion: f.model.version }) },
	});
	assert.equal(replaced, true);
	assert.equal(result, undefined);
	assert.ok(reference.model.activeTab === newer, 'the newer reference opening remains active');
	assert.ok(receiver.model.activeTab === existing, 'the existing Source remains the receiving group subject');
	assert.ok(receiver.panes.activePane!.input === existing, 'the receiving pane retains its existing Source attachment');
	assert.ok(f.main.primary === f.primary, 'superseded handoff retains the Main source producer');
	assert.ok(inputFocus.admittedTarget === f.origin, 'superseded handoff retains the invoking hierarchy focus');
});
