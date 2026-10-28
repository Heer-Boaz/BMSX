import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus, InputFocusTarget } from '../../ide/input/focus';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { SceneEditorPane } from '../../ide/workbench/contrib/scene_editor/editor_pane';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createActualSourcePanes } from '../helpers/source_panes';

for (const reattach of [false, true]) test(`Scene option retirement stops its old update after ${reattach ? 'same-kind reattachment' : 'a blur callback opens another editor'}`, t => {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant('tiny');
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	f.editor.sceneEditor.openResource(f.firstGroup, resource);
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof SceneEditorInput);
	f.update();
	const pane = f.firstGroup.panes.activePane;
	assert.ok(pane instanceof SceneEditorPane);
	selectSceneOutlineRow(input.view, 1); pane.update();
	f.editor.commands.execute('sceneEditor.details', pane.commandTarget);
	const option = pane.control.controls[pane.control.controls.length - 1].field.focusTarget.next;
	assert.ok(option instanceof InputFocusTarget);
	assert.equal(option.focus(), true);
	const source = input.workingCopy.buffer.getText(), version = input.workingCopy.version;
	const replacement = new HostErrorInput('replacement');
	let blurs = 0, reattachedOption: InputFocusTarget | undefined;
	const unbind = option.onDidBlur(() => {
		unbind(); blurs++;
		f.firstGroup.openEditor(replacement);
		if (!reattach) return;
		f.firstGroup.openEditor(input);
		assert.ok(f.firstGroup.panes.activePane === pane);
		selectSceneOutlineRow(input.view, 1); pane.update();
		const target = pane.control.controls[pane.control.controls.length - 1].field.focusTarget.next;
		assert.ok(target instanceof InputFocusTarget && target !== option);
		reattachedOption = target;
		assert.equal(target.focus(), true);
		assert.equal(target.textInput!.replaceText(0, target.textInput!.readText().text.length, '1234'), true);
	});
	t.after(unbind);
	selectSceneOutlineRow(input.view, 2);
	assert.equal(input.view.optionProperties.length, 0);
	assert.doesNotThrow(() => pane.update());
	assert.equal(blurs, 1);
	assert.equal(input.workingCopy.buffer.getText(), source);
	assert.equal(input.workingCopy.version, version);
	assert.equal(input.workingCopy.canUndo, false);
	if (reattach) {
		assert.ok(f.firstGroup.model.activeTab === input && f.firstGroup.panes.activePane === pane);
		assert.ok(inputFocus.admittedTarget === reattachedOption);
		assert.equal(reattachedOption!.textInput!.readText().text, '1234');
		assert.equal(reattachedOption!.edit!.pending, true);
	} else {
		assert.ok(f.firstGroup.model.activeTab === replacement);
		assert.ok(inputFocus.admittedTarget === f.firstGroup.panes.activePane?.commandTarget);
	}
});
