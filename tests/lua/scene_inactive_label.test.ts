import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { createSceneDocumentFixture } from '../helpers/scene_document_fixture';
import { SCENE_VIEWPORT_IMPORTS } from '../fixtures/studio/scene_viewport';

const OBJECTS = "{objects={{member_id='one',definition_id='actor',position={x=1,y=2}}}}";
const SOURCE = `local scenes=require('cartlib/world/scene_library')
local prefab=require('cartlib/world/prefab')
prefab.define({def_id='actor',class=require('cartlib/world/object_2d')})
scenes.register('First',${OBJECTS})
scenes.register('Other',${OBJECTS})`;

test('editing an inactive Scene ID in the real shared Source updates only that retained occurrence', async t => {
	const f = await createSceneDocumentFixture(t, SOURCE, SCENE_VIEWPORT_IMPORTS);
	const first = f.primary.input; assert.ok(first instanceof SceneEditorInput);
	f.group.model.pin(first); assert.equal(selectSceneOutlineRow(first.view.hierarchy, 1), true); f.update();
	const secondScene = f.ide.sceneSources.get(f.model).scenes[1];
	assert.equal(f.editor.sceneEditor.openDefinition(f.group, f.model.resource, luaSourceRangeToTextRange(f.model.buffer, secondScene.range)), true);
	f.update();
	const second = f.group.model.activeTab; assert.ok(second instanceof SceneEditorInput && second !== first);
	assert.equal(selectSceneOutlineRow(second.view.hierarchy, 1), true); f.update();
	const secondSelection = { ...second.view.authoring.selectionRange }, firstId = first.id;
	f.firstGroup.openEditor(new CodeEditorInput(f.model), { pinned: true }); f.update();
	const source = f.firstGroup.panes.activePane; assert.ok(source instanceof CodeEditorPane); source.focus();
	const offset = f.model.buffer.getText().indexOf("'First'");
	assert.equal(f.editor.textTarget!.replaceText(offset, offset + "'First'".length, "'Other'"), true); f.update();
	assert.equal(first.id, firstId); assert.ok(f.group.model.contains(first) && f.group.model.activeTab === second);
	assert.equal(first.title, 'Other'); assert.equal(second.title, 'Other');
	assert.deepEqual(second.view.authoring.selectionRange, secondSelection);
	const selected = second.view.authoring.selection;
	assert.ok(selected?.kind === 'member' && selected.entry.kind === 'object');
	assert.equal(stringLiteralValue(selected.entry.memberId), 'one');
	f.key('KeyZ', KeyModifier.ctrl); f.update();
	assert.equal(first.title, 'First'); assert.equal(second.title, 'Other');
	f.key('KeyY', KeyModifier.ctrl); f.update();
	assert.equal(first.title, 'Other'); assert.equal(second.title, 'Other');
});

test('an inactive Scene tab follows an ID edited through an incomplete literal in the real Source pane', async t => {
	const f = await createSceneDocumentFixture(t, SOURCE, SCENE_VIEWPORT_IMPORTS);
	const first = f.primary.input; assert.ok(first instanceof SceneEditorInput);
	f.group.model.pin(first);
	assert.equal(selectSceneOutlineRow(first.view.hierarchy, 1), true); f.update();
	const scene = f.ide.sceneSources.get(f.model).scenes[1];
	assert.equal(f.editor.sceneEditor.openDefinition(f.group, f.model.resource, luaSourceRangeToTextRange(f.model.buffer, scene.range)), true);
	f.update(); const second = f.group.model.activeTab; assert.ok(second instanceof SceneEditorInput && second !== first);
	assert.equal(selectSceneOutlineRow(second.view.hierarchy, 1), true); f.update();
	f.firstGroup.openEditor(new CodeEditorInput(f.model), { pinned: true }); f.update();
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof CodeEditorPane); pane.focus();
	const offset = f.model.buffer.getText().indexOf("'First'");
	assert.equal(f.editor.textTarget!.replaceText(offset + 6, offset + 7, ''), true); f.update();
	assert.equal(first.view.authoring.suspended, true); assert.equal(second.view.authoring.suspended, true);
	assert.equal(first.view.authoring.subject, undefined); assert.equal(second.view.authoring.subject, undefined);
	assert.equal(first.view.authoring.selection, undefined); assert.equal(second.view.authoring.selection, undefined);
	assert.equal(first.view.authoring.spatialScene, undefined); assert.equal(second.view.authoring.visualScene, undefined);
	assert.equal(first.title.includes('First'), false); assert.equal(second.title.includes('Other'), false);
	assert.equal(f.editor.commands.isEnabled('sceneEditor.removeMember', f.editor.mainWorkspace.primary!.commandTarget), false);
	assert.equal(f.editor.textTarget!.replaceText(offset + 1, offset + 6, 'Other'), true); f.update();
	assert.equal(f.editor.textTarget!.replaceText(offset + 6, offset + 6, "'"), true); f.update();
	assert.ok(f.group.model.contains(first) && f.group.model.activeTab === second);
	assert.equal(first.title, 'Other');
	assert.equal(first.view.authoring.suspended, false); assert.equal(second.view.authoring.suspended, false);
	const firstSelection = first.view.authoring.selection, secondSelection = second.view.authoring.selection;
	assert.ok(firstSelection?.kind === 'member' && firstSelection.entry.kind === 'object');
	assert.ok(secondSelection?.kind === 'member' && secondSelection.entry.kind === 'object');
	assert.equal(stringLiteralValue(firstSelection.entry.memberId), 'one');
	assert.equal(stringLiteralValue(secondSelection.entry.memberId), 'one');
});

test('complete ID replacement through an incomplete literal follows the same exact occurrence', async t => {
	const f = await createSceneDocumentFixture(t, SOURCE, SCENE_VIEWPORT_IMPORTS);
	const first = f.primary.input; assert.ok(first instanceof SceneEditorInput);
	f.group.model.pin(first);
	const scene = f.ide.sceneSources.get(f.model).scenes[1];
	assert.equal(f.editor.sceneEditor.openDefinition(f.group, f.model.resource, luaSourceRangeToTextRange(f.model.buffer, scene.range)), true);
	f.update();
	f.firstGroup.openEditor(new CodeEditorInput(f.model), { pinned: true }); f.update();
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof CodeEditorPane); pane.focus();
	const offset = f.model.buffer.getText().indexOf("'First'");
	assert.equal(f.editor.textTarget!.replaceText(offset, offset + 7, "'"), true); f.update();
	assert.equal(first.view.authoring.suspended, true); assert.equal(first.title.includes('First'), false);
	assert.equal(f.editor.textTarget!.replaceText(offset + 1, offset + 1, "Other'"), true); f.update();
	assert.equal(first.title, 'Other'); assert.equal(first.view.authoring.suspended, false);
	f.key('KeyZ', KeyModifier.ctrl); f.update();
	assert.equal(first.view.authoring.suspended, true); assert.equal(first.view.authoring.subject, undefined);
	f.key('KeyY', KeyModifier.ctrl); f.update();
	assert.equal(first.title, 'Other'); assert.equal(first.view.authoring.suspended, false);
});

test('deleting a whole inactive Scene retires its exact occurrence even after Undo', async t => {
	const f = await createSceneDocumentFixture(t, SOURCE, SCENE_VIEWPORT_IMPORTS);
	const first = f.primary.input; assert.ok(first instanceof SceneEditorInput); f.group.model.pin(first);
	const scene = f.ide.sceneSources.get(f.model).scenes[1];
	assert.equal(f.editor.sceneEditor.openDefinition(f.group, f.model.resource, luaSourceRangeToTextRange(f.model.buffer, scene.range)), true);
	f.update();
	f.firstGroup.openEditor(new CodeEditorInput(f.model), { pinned: true }); f.update();
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof CodeEditorPane); pane.focus();
	const declaration = `scenes.register('First',${OBJECTS})`, offset = f.model.buffer.getText().indexOf(declaration);
	assert.equal(f.editor.textTarget!.replaceText(offset, offset + declaration.length, ''), true); f.update();
	assert.equal(first.view.authoring.availability, 'unavailable');
	assert.equal(first.view.authoring.subject, undefined);
	f.key('KeyZ', KeyModifier.ctrl); f.update();
	assert.equal(first.view.authoring.availability, 'unavailable');
	assert.equal(first.view.authoring.subject, undefined);
	assert.ok(f.group.model.contains(first));
});

test('a temporarily unrecognized valid registration retains its inactive occurrence through Undo', async t => {
	const f = await createSceneDocumentFixture(t, SOURCE, SCENE_VIEWPORT_IMPORTS);
	const first = f.primary.input; assert.ok(first instanceof SceneEditorInput); f.group.model.pin(first);
	assert.equal(selectSceneOutlineRow(first.view.hierarchy, 1), true); f.update();
	const secondScene = f.ide.sceneSources.get(f.model).scenes[1];
	assert.equal(f.editor.sceneEditor.openDefinition(f.group, f.model.resource, luaSourceRangeToTextRange(f.model.buffer, secondScene.range)), true); f.update();
	f.firstGroup.openEditor(new CodeEditorInput(f.model), { pinned: true }); f.update();
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof CodeEditorPane); pane.focus();
	const offset = f.model.buffer.getText().indexOf('scenes.register');
	assert.equal(f.editor.textTarget!.replaceText(offset, offset + 'scenes.register'.length, 'scenes.not_here'), true); f.update();
	assert.equal(first.view.authoring.availability, 'unavailable');
	assert.equal(first.view.authoring.subject, undefined);
	assert.equal(first.view.authoring.selection, undefined);
	assert.equal(first.view.authoring.suspended, true);
	f.key('KeyZ', KeyModifier.ctrl); f.update();
	f.group.activate(first.id); f.update();
	assert.equal(first.view.authoring.availability, 'available');
	assert.equal(first.title, 'First');
	assert.equal(first.view.authoring.suspended, false);
	assert.ok(first.view.authoring.selection?.kind === 'member');
});

test('typing a registration name restores the active Scene only after exact recognition', async t => {
	const f = await createSceneDocumentFixture(t, SOURCE, SCENE_VIEWPORT_IMPORTS);
	const first = f.primary.input; assert.ok(first instanceof SceneEditorInput);
	assert.equal(selectSceneOutlineRow(first.view.hierarchy, 1), true); f.update();
	f.firstGroup.openEditor(new CodeEditorInput(f.model), { pinned: true }); f.update();
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof CodeEditorPane); pane.focus();
	const offset = f.model.buffer.getText().indexOf('scenes.register') + 'scenes.'.length;
	assert.equal(f.editor.textTarget!.replaceText(offset, offset + 1, ''), true); f.update();
	assert.equal(f.ide.sceneSources.get(f.model).analysis.chunk.syntaxError, null);
	assert.equal(first.view.authoring.subject, undefined); assert.equal(first.view.authoring.selection, undefined);
	assert.equal(first.view.authoring.spatialScene, undefined); assert.equal(first.view.authoring.visualScene, undefined);
	assert.equal(first.view.authoring.suspended, true);
	assert.equal(f.editor.textTarget!.replaceText(offset, offset, 'r'), true); f.update();
	assert.equal(first.view.authoring.suspended, false); assert.equal(first.title, 'First');
	assert.ok(first.view.authoring.selection?.kind === 'member');
});

test('one incomplete source generation suspends and restores every unrepresented open Scene occurrence', async t => {
	const source = `${SOURCE}\nscenes.register('Third',${OBJECTS})`;
	const f = await createSceneDocumentFixture(t, source, SCENE_VIEWPORT_IMPORTS);
	const first = f.primary.input; assert.ok(first instanceof SceneEditorInput); f.group.model.pin(first);
	const inputs = [first];
	for (const index of [1, 2]) {
		const scene = f.ide.sceneSources.get(f.model).scenes[index];
		assert.equal(f.editor.sceneEditor.openDefinition(f.group, f.model.resource, luaSourceRangeToTextRange(f.model.buffer, scene.range)), true); f.update();
		const input = f.group.model.activeTab; assert.ok(input instanceof SceneEditorInput); f.group.model.pin(input); inputs.push(input);
	}
	f.firstGroup.openEditor(new CodeEditorInput(f.model), { pinned: true }); f.update();
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof CodeEditorPane); pane.focus();
	const quote = f.model.buffer.getText().indexOf("'First'") + 6;
	assert.equal(f.editor.textTarget!.replaceText(quote, quote + 1, ''), true); f.update();
	for (const input of inputs) {
		assert.equal(input.view.authoring.subject, undefined);
		assert.equal(input.view.authoring.suspended, true);
		assert.ok(input.title.includes('scene.lua') && !['First', 'Other', 'Third'].includes(input.title));
	}
	assert.equal(f.editor.textTarget!.replaceText(quote, quote, "'"), true); f.update();
	assert.deepEqual(inputs.map(input => input.title), ['First', 'Other', 'Third']);
	for (const input of inputs) assert.ok(input.view.authoring.subject !== undefined && f.group.model.contains(input));
});
