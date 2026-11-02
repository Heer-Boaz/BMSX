import assert from 'node:assert/strict';
import test from 'node:test';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { stringLiteralValue } from '../../toolchain/ts/lua/syntax/literals';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { luaSourceRangeToTextRange } from '../../ide/language/lua/source_edits';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { SCENE_VIEWPORT_IMPORTS } from '../fixtures/studio/scene_viewport';
import { createSceneDocumentFixture } from '../helpers/scene_document_fixture';

const HEADER = `local scenes = require('cartlib/world/scene_library')
local prefab = require('cartlib/world/prefab')
prefab.define({def_id='actor',class=require('cartlib/world/object_2d')})
local ids = { intro = 'runtime-intro', other = 'runtime-other' }
`;
const OBJECTS = "{ objects = {{member_id='subject', definition_id='actor', position={x=11,y=22}}} }";

// Scene identity is a presentation contract: source expressions are provenance,
// not names. A column is necessary when separate occurrences share a line.
test('unresolved Scene names use one source-backed presentation for each same-line occurrence', async t => {
	const source = `${HEADER}scenes.register(ids.intro, ${OBJECTS}); scenes.register(ids.other, ${OBJECTS})`;
	const f = await createSceneDocumentFixture(t, source, SCENE_VIEWPORT_IMPORTS);
	const first = f.primary.input; assert.ok(first instanceof SceneEditorInput);
	f.group.model.pin(first); f.update();
	const firstView = first.view, firstScene = firstView.authoring.subject!;
	assert.equal(selectSceneOutlineRow(firstView.hierarchy, 0), true); f.update();
	const firstRoot = firstView.hierarchy.outline.roots[0].element;
	const firstDetails = firstView.details.projection.subject!;
	const firstPosition = { row: 0, column: 0 }; f.model.buffer.positionAt(firstView.authoring.subjectSpan!.start, firstPosition);
	assert.equal(first.title, firstRoot.label); assert.equal(first.title, firstDetails.label);
	assert.equal(first.title, `scene.lua:${firstPosition.row + 1}:${firstPosition.column + 1}`);
	assert.equal(first.title.includes('ids.intro'), false);
	assert.ok(first.description.includes('ids.intro'));

	const secondScene = f.ide.sceneSources.get(f.model).scenes[1];
	const range = luaSourceRangeToTextRange(f.model.buffer, secondScene.range);
	assert.equal(f.editor.sceneEditor.openDefinition(f.group, f.model.resource, range), true); f.update();
	const second = f.group.model.activeTab; assert.ok(second instanceof SceneEditorInput && second !== first);
	const secondView = second.view;
	assert.equal(selectSceneOutlineRow(secondView.hierarchy, 0), true); f.update();
	const secondRoot = secondView.hierarchy.outline.roots[0].element;
	const secondDetails = secondView.details.projection.subject!;
	const secondPosition = { row: 0, column: 0 }; f.model.buffer.positionAt(secondView.authoring.subjectSpan!.start, secondPosition);
	assert.equal(firstPosition.row, secondPosition.row); assert.notEqual(firstPosition.column, secondPosition.column);
	assert.equal(second.title, secondRoot.label); assert.equal(second.title, secondDetails.label);
	assert.equal(second.title, `scene.lua:${secondPosition.row + 1}:${secondPosition.column + 1}`);
	assert.equal(second.title.includes('ids.other'), false);
	assert.ok(second.description.includes('ids.other'));
	assert.notEqual(first.title, second.title);
	assert.ok(firstView.authoring.subject === firstScene && f.group.model.contains(first));
	assert.equal(f.model.buffer.getText(), source);
});

test('editing a literal Scene name in Source updates the retained Scene document and selection', async t => {
	const source = `${HEADER}scenes.register('MiXeD Scene', ${OBJECTS})`;
	const f = await createSceneDocumentFixture(t, source, SCENE_VIEWPORT_IMPORTS);
	const input = f.primary.input; assert.ok(input instanceof SceneEditorInput);
	const view = input.view, tabId = input.id;
	assert.equal(selectSceneOutlineRow(view.hierarchy, 0), true); f.update();
	assert.equal(input.title, 'MiXeD Scene');
	assert.equal(view.hierarchy.outline.roots[0].element.label, 'MiXeD Scene');
	assert.equal(view.details.projection.subject!.label, 'MiXeD Scene');
	assert.equal(selectSceneOutlineRow(view.hierarchy, 1), true); f.update();
	const primary = f.editor.mainWorkspace.primary; assert.ok(primary instanceof ScenePrimaryClient);
	const field = primary.details.control.controls[0];
	assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, '13', true);
	assert.equal(field.commit(), true);
	f.firstGroup.openEditor(new CodeEditorInput(f.model), { pinned: true }); f.update();
	const sourcePane = f.firstGroup.panes.activePane; assert.ok(sourcePane instanceof CodeEditorPane);
	sourcePane.focus();
	const old = "'MiXeD Scene'", offset = f.model.buffer.getText().indexOf(old);
	assert.equal(f.editor.textTarget!.replaceText(offset, offset + old.length, "'New Exact Scene'"), true); f.update();
	f.group.focus(); f.update();
	assert.equal(input.id, tabId); assert.ok(f.group.model.activeTab === input);
	assert.equal(input.title, 'New Exact Scene');
	assert.equal(view.hierarchy.outline.roots[0].element.label, 'New Exact Scene');
	const selected = view.authoring.selection;
	assert.ok(selected?.kind === 'member' && selected.index === 0 && selected.entry.kind === 'object');
	assert.equal(stringLiteralValue(selected.entry.memberId), 'subject');
	assert.ok(f.model.buffer.getText().includes('position={x=13,y=22}'));
	assert.equal(selectSceneOutlineRow(view.hierarchy, 0), true); f.update();
	assert.equal(view.details.projection.subject!.label, 'New Exact Scene');
});

test('source-backed Scene name location follows edits without changing the retained document', async t => {
	const source = `${HEADER}scenes.register(ids.intro, ${OBJECTS})`;
	const f = await createSceneDocumentFixture(t, source, SCENE_VIEWPORT_IMPORTS);
	const input = f.primary.input; assert.ok(input instanceof SceneEditorInput);
	const view = input.view, tabId = input.id, before = input.title;
	assert.equal(selectSceneOutlineRow(view.hierarchy, 0), true); f.update();
	f.firstGroup.openEditor(new CodeEditorInput(f.model), { pinned: true }); f.update();
	const sourcePane = f.firstGroup.panes.activePane; assert.ok(sourcePane instanceof CodeEditorPane);
	sourcePane.focus();
	assert.equal(f.editor.textTarget!.replaceText(0, 0, '-- inserted line\n'), true); f.update();
	f.group.focus(); f.update();
	assert.ok(f.group.model.activeTab === input); assert.equal(input.id, tabId);
	const position = { row: 0, column: 0 }; f.model.buffer.positionAt(view.authoring.subjectSpan!.start, position);
	assert.notEqual(input.title, before);
	assert.equal(input.title, `scene.lua:${position.row + 1}:${position.column + 1}`);
	assert.equal(input.title, view.hierarchy.outline.roots[0].element.label);
	assert.equal(input.title, view.details.projection.subject!.label);
	assert.equal(input.title.includes('ids.intro'), false); assert.ok(input.description.includes('ids.intro'));
});
