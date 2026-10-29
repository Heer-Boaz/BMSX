import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { NavigationHistoryEntry, navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { ScenePrimaryBookmark } from '../../ide/workbench/contrib/scene_editor/primary_bookmark';
import { ScenePrimaryNavigationLocation } from '../../ide/workbench/contrib/scene_editor/primary_location';
import { ScenePrimaryViewState } from '../../ide/workbench/contrib/scene_editor/primary_view';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { createTestEditorWorkspace } from '../helpers/editor_panes';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('same', { objects = {
 { member_id = 'same', definition_id = 'first' },
 { member_id = 'same', definition_id = 'second' },
} })`;

function fixture(t: TestContext) {
	configureFontVariant('tiny');
	const f = createSceneSourceFixture(t, SOURCE), workspace = createTestEditorWorkspace(t);
	const document = f.documents.get(f.model);
	const context = new SceneAuthoringContext(f.model, f.documents, { document, sourceVersion: f.model.version, scene: document.scenes[0] });
	const view = new ScenePrimaryViewState(context); view.refresh(); selectSceneOutlineRow(view.hierarchy, 1);
	t.after(() => { view.dispose(); context.dispose(); resetNavigationHistoryState(); });
	return { ...f, ...workspace, context, view, bookmark: () => new ScenePrimaryBookmark(context, view) };
}

test('a Scene history location restores its exact independent bookmark after the old context ends', async t => {
	const f = fixture(t), bookmark = f.bookmark();
	const options = { isCurrent: () => true, preserveFocus: true };
	let restored = false;
	const location = new ScenePrimaryNavigationLocation(bookmark, f.mainWorkspace, async (captured, admitted) => {
		assert.ok(captured === bookmark && admitted === options);
		assert.ok(captured.resolve(f.documents)?.scene === f.documents.get(f.model).scenes[0]);
		restored = true; return true;
	}); t.after(() => location.dispose());
	f.view.dispose(); f.context.dispose();
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved\n' }]);
	assert.equal(await location.restore(options), true);
	assert.equal(restored, true);
	assert.equal(location.isDisposed, false);
});

for (const retirement of ['source', 'Main'] as const) test(`${retirement} retirement revokes Scene entries in the shared history`, async t => {
	const f = fixture(t), bookmark = f.bookmark();
	let restorations = 0, retirements = 0;
	const location = new ScenePrimaryNavigationLocation(bookmark, f.mainWorkspace, async () => { restorations++; return true; });
	const entry = new NavigationHistoryEntry({ kind: 'primary', location }); navigationState.back.push(entry);
	location.onDidRetire(() => retirements++);
	if (retirement === 'source') f.models.clear(); else f.mainWorkspace.dispose();
	assert.equal(location.isDisposed, true); assert.equal(bookmark.isDisposed, true);
	assert.equal(retirements, 1); assert.equal(entry.isDisposed, true); assert.equal(navigationState.back.length, 0);
	assert.equal(await location.restore({ isCurrent: () => true, preserveFocus: false }), false);
	assert.equal(restorations, 0);
	location.dispose(); assert.equal(retirements, 1);
});

test('history release disposes the bookmark without announcing a separate source retirement', t => {
	const f = fixture(t), bookmark = f.bookmark();
	let retirements = 0;
	const location = new ScenePrimaryNavigationLocation(bookmark, f.mainWorkspace, async () => true);
	location.onDidRetire(() => retirements++);
	new NavigationHistoryEntry({ kind: 'primary', location }).dispose();
	assert.equal(location.isDisposed, true); assert.equal(bookmark.isDisposed, true); assert.equal(retirements, 0);
	f.models.clear(); f.mainWorkspace.dispose();
	assert.equal(retirements, 0);
});

test('Scene history equality uses the bookmarked occurrence and selection rather than a former client', t => {
	const f = fixture(t), first = new ScenePrimaryNavigationLocation(f.bookmark(), f.mainWorkspace, async () => true);
	const same = new ScenePrimaryNavigationLocation(f.bookmark(), f.mainWorkspace, async () => false);
	selectSceneOutlineRow(f.view.hierarchy, 2);
	const other = new ScenePrimaryNavigationLocation(f.bookmark(), f.mainWorkspace, async () => true);
	t.after(() => { first.dispose(); same.dispose(); other.dispose(); });
	assert.equal(first.matches(same), true); assert.equal(first.matches(other), false);
});

test('an already-retired Scene bookmark produces an immediately retired location without subscribing Main', t => {
	const f = fixture(t), bookmark = f.bookmark(); bookmark.dispose();
	const subscribe = t.mock.method(f.mainWorkspace, 'onWillDispose');
	const location = new ScenePrimaryNavigationLocation(bookmark, f.mainWorkspace, async () => true);
	assert.equal(location.isDisposed, true); assert.equal(subscribe.mock.callCount(), 0);
	let retirements = 0; location.onDidRetire(() => retirements++);
	assert.equal(retirements, 1);
	assert.equal(new NavigationHistoryEntry({ kind: 'primary', location }).isDisposed, true);
});
