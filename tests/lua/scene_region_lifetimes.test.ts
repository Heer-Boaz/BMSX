import assert from 'node:assert/strict';
import test from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { SceneEditorViewState } from '../../ide/workbench/contrib/scene_editor/view_state';
import { SceneHierarchyViewState } from '../../ide/workbench/contrib/scene_editor/hierarchy_view';
import { captureSceneEditorView, restoreSceneEditorView } from '../../ide/workbench/contrib/scene_editor/view_snapshot';
import { rebuildWorkbenchTreeRows } from '../../ide/workbench/ui/tree_view';
import { createSceneSourceFixture } from '../helpers/scene_sources';

const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('room', { objects = {
 { member_id = 'ship', definition_id = 'actor', options = { pos = { x = 11, y = 2, z = 3 } } },
 { member_id = 'ship', definition_id = 'actor', options = { pos = { x = 22, y = 5, z = 6 } } },
} })`;

test('constructing and refreshing a Scene hierarchy never admits a semantic selection', t => {
	const { model, documents } = createSceneSourceFixture(t, SOURCE, 'regions.lua');
	const context = new SceneAuthoringContext(model, documents);
	const hierarchy = new SceneHierarchyViewState(context);
	t.after(() => { hierarchy.dispose(); context.dispose(); });
	hierarchy.refresh();
	assert.equal(hierarchy.outline.rows.length, 3);
	assert.equal(context.selection, undefined);
	assert.equal(hierarchy.outline.selectionIndex, -1);
	const document = context.document!, scene = document.scenes[0];
	context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 });
	hierarchy.refresh();
	assert.equal(hierarchy.outline.selectionIndex, 2);
	context.select(document, model.version, undefined); hierarchy.refresh();
	assert.equal(context.selection, undefined);
	assert.equal(hierarchy.outline.selectionIndex, -1);
	assert.equal(model.dirty, false);
});

test('Scene snapshot restores exact semantic member independently of a collapsed hierarchy', t => {
	const { model, documents } = createSceneSourceFixture(t, SOURCE, 'regions.lua');
	const context = new SceneAuthoringContext(model, documents), view = new SceneEditorViewState(context);
	const document = context.document!, scene = document.scenes[0];
	context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 });
	view.refresh();
	view.hierarchy.outline.roots[0].collapsed = true;
	rebuildWorkbenchTreeRows(view.hierarchy.outline, null);
	view.hierarchy.position = 0; view.details.position = 31; view.section = 'details';
	const snapshot = captureSceneEditorView(view);
	const restoredContext = new SceneAuthoringContext(model, documents), restored = new SceneEditorViewState(restoredContext);
	t.after(() => { restored.dispose(); restoredContext.dispose(); context.dispose(); });
	restoreSceneEditorView(restored, snapshot);
	restored.refresh();
	const selected = restoredContext.selection;
	assert.ok(selected?.kind === 'member');
	assert.ok(selected.entry === restoredContext.document!.scenes[0].objects[1], 'restoration binds the captured second occurrence, not its namesake');
	assert.equal(restored.hierarchy.outline.roots[0].collapsed, true);
	assert.equal(restored.hierarchy.outline.rows.length, 1);
	assert.equal(restored.hierarchy.outline.selectionIndex, -1, 'a hidden member does not select a visible row or force expansion');
	assert.ok(restored.details.projection.subject!.selection === selected);
	assert.equal(restored.details.properties[0].descriptor.value, 22);
	assert.equal(restored.details.position, 31);
	assert.deepEqual(captureSceneEditorView(restored), snapshot);
	const originalSelection = context.selection;
	view.dispose();
	assert.ok(context.selection === originalSelection, 'disposing a presentation does not clear its contribution-owned selection');
	assert.equal(model.buffer.getText(), SOURCE);
});

test('same-source Scene selection projects a new highlight without rebuilding hierarchy occurrences', t => {
	const { model, documents } = createSceneSourceFixture(t, SOURCE, 'regions.lua');
	const context = new SceneAuthoringContext(model, documents), hierarchy = new SceneHierarchyViewState(context);
	t.after(() => { hierarchy.dispose(); context.dispose(); });
	hierarchy.refresh();
	const roots = hierarchy.outline.roots.slice(), rows = hierarchy.outline.rows.slice();
	const document = context.document!, scene = document.scenes[0];
	context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[1], index: 1 });
	hierarchy.refresh();
	assert.equal(hierarchy.outline.selectionIndex, 2);
	assert.equal(hierarchy.outline.rows.length, rows.length);
	assert.ok(hierarchy.outline.roots.every((root, index) => root === roots[index]));
	assert.ok(hierarchy.outline.rows.every((row, index) => row === rows[index]), 'highlight projection retains each actual hierarchy occurrence');
	hierarchy.outline.roots[0].collapsed = true;
	rebuildWorkbenchTreeRows(hierarchy.outline, null);
	context.select(document, model.version, { kind: 'member', scene, entry: scene.objects[0], index: 0 });
	hierarchy.refresh();
	assert.ok(hierarchy.outline.roots[0] === roots[0]);
	assert.equal(hierarchy.outline.roots[0].collapsed, true);
	assert.equal(hierarchy.outline.rows.length, 1);
	assert.equal(hierarchy.outline.selectionIndex, -1);
	assert.equal(model.dirty, false);
});
