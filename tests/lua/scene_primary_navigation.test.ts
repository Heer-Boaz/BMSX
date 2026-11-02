import assert from 'node:assert/strict';
import test from 'node:test';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { NavigationHistoryEntry, navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { SceneEditorInput } from '../../ide/workbench/contrib/scene_editor/editor_input';
import { SceneNavigationLocation } from '../../ide/workbench/contrib/scene_editor/scene_navigation';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { createSceneDocumentFixture } from '../helpers/scene_document_fixture';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'first' },
 { member_id = 'same', definition_id = 'second' },
} })`;

async function fixture(t: test.TestContext) {
	const f = await createSceneDocumentFixture(t, SOURCE, []);
	assert.ok(f.primary.input instanceof SceneEditorInput);
	selectSceneOutlineRow(f.view.hierarchy, 1); f.update();
	t.after(() => resetNavigationHistoryState());
	return { ...f, input: f.primary.input,
		location: () => new SceneNavigationLocation(f.primary.input as SceneEditorInput, f.group, f.editor.sceneEditor) };
}

test('a Scene history location restores its exact bookmark after the old input ends', async t => {
	const f = await fixture(t), location = f.location(); t.after(() => location.dispose());
	assert.equal(await f.group.close(f.input.id), true);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved\n' }]);
	assert.equal(await location.restore({ isCurrent: () => true, preserveFocus: false }), true);
	const restored = f.group.model.activeTab; assert.ok(restored instanceof SceneEditorInput);
	assert.notEqual(restored, f.input);
	assert.ok(restored.view.authoring.subject === f.ide.sceneSources.get(f.model).scenes[0]);
	assert.equal(restored.view.authoring.selection?.kind, 'member');
});

for (const retirement of ['source', 'group'] as const) test(`${retirement} retirement revokes Scene entries in shared history`, async t => {
	const f = await fixture(t), location = f.location();
	resetNavigationHistoryState();
	const entry = new NavigationHistoryEntry({ kind: 'location', location }); navigationState.back.push(entry);
	let retirements = 0; location.onDidRetire(() => retirements++);
	if (retirement === 'source') editorTextModelService.clear();
	else {
		assert.ok(f.editor.editorParts.splitGroup(f.group, 'right'));
		assert.equal(await f.editor.editorParts.closeGroup(f.group), true);
	}
	assert.equal(location.isDisposed, true); assert.equal(retirements, 1);
	assert.equal(entry.isDisposed, true); assert.equal(navigationState.back.length, 0);
	assert.equal(await location.restore({ isCurrent: () => true, preserveFocus: false }), false);
	location.dispose(); assert.equal(retirements, 1);
});

test('history release disposes the occurrence without announcing source retirement', async t => {
	const f = await fixture(t), location = f.location(); let retirements = 0;
	location.onDidRetire(() => retirements++);
	new NavigationHistoryEntry({ kind: 'location', location }).dispose();
	assert.equal(location.isDisposed, true); assert.equal(retirements, 0);
});

test('Scene history equality uses the occurrence and selection rather than a former pane', async t => {
	const f = await fixture(t), first = f.location(), same = f.location();
	selectSceneOutlineRow(f.view.hierarchy, 2);
	const other = f.location(); t.after(() => { first.dispose(); same.dispose(); other.dispose(); });
	assert.equal(first.matches(same), true); assert.equal(first.matches(other), false);
});
