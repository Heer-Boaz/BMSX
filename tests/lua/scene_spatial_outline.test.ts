import assert from 'node:assert/strict';
import test from 'node:test';
import { SceneAuthoringContext } from '../../ide/workbench/contrib/scene_editor/authoring_context';
import { ScenePrimaryViewState } from '../../ide/workbench/contrib/scene_editor/primary_view';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { captureSceneReading, mapSceneReading, restoreSceneReading } from '../../ide/workbench/contrib/scene_editor/reading_snapshot';
import { rebuildWorkbenchTreeRows, setWorkbenchTreeCollapsed, workbenchTreeRoot } from '../../ide/workbench/ui/tree_view';
import { createSceneSourceFixture } from '../helpers/scene_sources';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { layoutSceneHierarchy } from '../../ide/workbench/contrib/scene_editor/hierarchy_layout';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';

const PREFAB = `local prefab = require('cartlib/world/prefab')
prefab.define({ def_id = 'node', class = {}, spatial = { family = '2d', authority = 'affine' } })`;
const SOURCE = `local scenes = require('cartlib/world/scene_library')
scenes.register('fixture', { objects = {
 { member_id = 'leaf', definition_id = 'node', spatial = { parent_id = 'child' } },
 { member_id = 'other', definition_id = 'node' },
 { member_id = 'child', definition_id = 'node', spatial = { parent_id = 'parent' } },
 { member_id = 'parent', definition_id = 'node' },
} })`;

test('Scene outline follows authored parent references, forward references and sibling order without moving source', t => {
	const f = createSceneSourceFixture(t, SOURCE, 'scene.lua', undefined,
		[['cartlib/world/prefab.lua', 'return {}'], ['prefabs.lua', PREFAB]]);
	const context = new SceneAuthoringContext(f.model, f.documents), view = new ScenePrimaryViewState(context);
	t.after(() => { view.dispose(); context.dispose(); });
	view.hierarchy.refresh();
	const tree = view.hierarchy.outline, scene = context.scenes[0], members = scene.objects;
	assert.deepEqual(tree.rows.slice(1).map(row => row.element.kind === 'member' ? row.element.entry : undefined),
		[members[1], members[3], members[2], members[0]]);
	assert.equal(tree.rows[3].parent, tree.rows[2]); assert.equal(tree.rows[4].parent, tree.rows[3]);
	assert.equal(workbenchTreeRoot(tree.rows[4]), tree.roots[0]);
	assert.equal(selectSceneOutlineRow(view.hierarchy, 4), true);
	assert.equal(context.selection?.kind, 'member');
	assert.equal(context.selection?.kind === 'member' ? context.selection.index : undefined, 0,
		'visible tree position is never the authored member index');
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false);
});

test('nested Scene disclosure survives canonical edits and reading-state restoration', t => {
	const f = createSceneSourceFixture(t, SOURCE, 'scene.lua', undefined,
		[['cartlib/world/prefab.lua', 'return {}'], ['prefabs.lua', PREFAB]]);
	const context = new SceneAuthoringContext(f.model, f.documents), view = new ScenePrimaryViewState(context);
	t.after(() => { view.dispose(); context.dispose(); });
	view.hierarchy.refresh();
	assert.equal(setWorkbenchTreeCollapsed(view.hierarchy.outline, 3, true), true);
	const snapshot = captureSceneReading(view);
	const release = f.model.onDidChangeContent(event => mapSceneReading(snapshot, event.changes)); t.after(release);
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- before\n' }]);
	view.hierarchy.refresh();
	const child = view.hierarchy.outline.rows[3]; assert.equal(child.collapsed, true);
	assert.equal(view.hierarchy.outline.rows.some(row => row.parent === child), false);
	child.collapsed = false; rebuildWorkbenchTreeRows(view.hierarchy.outline, null);
	assert.equal(restoreSceneReading(view, snapshot, context.captureSelectionRequest()), true);
	assert.equal(view.hierarchy.outline.rows[3].collapsed, true);
	assert.equal(view.hierarchy.outline.rows.length, 4);
});

test('unresolved authored parent relationships stay visible as unavailable facts, not invented edges', t => {
	const source = `local scenes = require('cartlib/world/scene_library')
scenes.register('fixture', { objects = {
 { member_id = 'a', definition_id = 'node', spatial = { parent_id = 'b' } },
 { member_id = 'b', definition_id = 'node', spatial = { parent_id = 'a' } },
 { member_id = 'missing', definition_id = 'node', spatial = { parent_id = 'absent' } },
} })`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined,
		[['cartlib/world/prefab.lua', 'return {}'], ['prefabs.lua', PREFAB]]);
	const context = new SceneAuthoringContext(f.model, f.documents), view = new ScenePrimaryViewState(context);
	t.after(() => { view.dispose(); context.dispose(); });
	view.hierarchy.refresh();
	const tree = view.hierarchy.outline;
	assert.equal(tree.rows.length, 4);
	for (const row of tree.rows.slice(1)) {
		assert.equal(row.parent, tree.roots[0]);
		assert.ok(row.element.kind === 'member' && row.element.unresolvedParent);
	}
	assert.equal(new Set(tree.rows.slice(1).map(row => row.element.kind === 'member' ? row.element.entry : undefined)).size, 3);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.dirty, false);
});

test('Scene hierarchy follows provider capabilities without rebuilding for unrelated dependency changes', t => {
	const f = createSceneSourceFixture(t, SOURCE, 'scene.lua', undefined, [
		['cartlib/world/prefab.lua', 'return {}'], ['prefabs.lua', PREFAB], ['unrelated.lua', 'return 1'],
	]);
	const context = new SceneAuthoringContext(f.model, f.documents), view = new ScenePrimaryViewState(context);
	t.after(() => { view.dispose(); context.dispose(); });
	view.hierarchy.refresh();
	const root = view.hierarchy.outline.roots[0], version = f.model.version;
	const parents = t.mock.method(context, 'getSpatialParents');
	for (let frame = 0; frame < 4; frame++) view.hierarchy.refresh();
	assert.equal(parents.mock.callCount(), 0, 'stable source generations do not rescan Scene topology during frame updates');
	const resource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'unrelated.lua' })!;
	const unrelated = resolveLuaTextFileModel(f.models, f.sources.catalog, resource);
	unrelated.pushEditOperations([{ offset: 7, deleteLength: 1, text: '2' }]);
	view.hierarchy.refresh();
	assert.equal(view.hierarchy.outline.roots[0], root, 'unchanged topology retains its presentation identities');
	const prefabResource = f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'prefabs.lua' })!;
	const prefabs = resolveLuaTextFileModel(f.models, f.sources.catalog, prefabResource);
	prefabs.pushEditOperations([{ offset: PREFAB.indexOf("'affine'"), deleteLength: 8, text: "'root_origin'" }]);
	view.hierarchy.refresh();
	assert.equal(f.model.version, version, 'provider admission is independent of edits to the Scene document');
	assert.notEqual(view.hierarchy.outline.roots[0], root);
	for (const row of view.hierarchy.outline.rows.slice(1)) assert.equal(row.parent, view.hierarchy.outline.roots[0]);
	assert.equal(f.model.buffer.getText(), SOURCE);
});

test('Scene reading position restores without remeasuring unchanged hierarchy content', t => {
	configureFontVariant('tiny');
	const f = createSceneSourceFixture(t, SOURCE, 'scene.lua', undefined,
		[['cartlib/world/prefab.lua', 'return {}'], ['prefabs.lua', PREFAB]]);
	const context = new SceneAuthoringContext(f.model, f.documents), view = new ScenePrimaryViewState(context);
	t.after(() => { view.dispose(); context.dispose(); });
	view.hierarchy.refresh();
	// Focused layout contract: pending reading state is independent of content/font/bounds changes.
	const bounds = { left: 0, top: 0, right: 320, bottom: 16 };
	assert.equal(layoutSceneHierarchy(view.hierarchy, bounds, true), true);
	const root = view.hierarchy.outline.roots[0], generation = view.hierarchy.outlineGeneration;
	view.hierarchy.position = 2;
	assert.equal(layoutSceneHierarchy(view.hierarchy, bounds, false), true);
	assert.equal(view.hierarchy.outline.scroll, 2); assert.equal(view.hierarchy.position, undefined);
	assert.equal(view.hierarchy.outline.roots[0], root); assert.equal(view.hierarchy.outlineGeneration, generation);
	assert.equal(layoutSceneHierarchy(view.hierarchy, bounds, false), false);
	assert.equal(f.model.buffer.getText(), SOURCE);
});

test('flat authored source can project and measure a deep hierarchy without recursive host visitors', t => {
	configureFontVariant('tiny');
	const members = Array.from({ length: 6000 }, (_, index) => `{ member_id = 'm${index}', definition_id = 'node'${index === 0 ? ''
		: `, spatial = { parent_id = 'm${index - 1}' }`} }`);
	const source = `local scenes = require('cartlib/world/scene_library')\nscenes.register('deep', { objects = {\n${members.join(',\n')}\n} })`;
	const f = createSceneSourceFixture(t, source, 'scene.lua', undefined,
		[['cartlib/world/prefab.lua', 'return {}'], ['prefabs.lua', PREFAB]]);
	const context = new SceneAuthoringContext(f.model, f.documents), view = new ScenePrimaryViewState(context);
	t.after(() => { view.dispose(); context.dispose(); });
	view.hierarchy.refresh();
	assert.equal(view.hierarchy.outline.rows.length, 6001);
	assert.equal(view.hierarchy.outline.rows[6000].depth, 6000);
	// Focused caption-layout test: depth clips available text, but must not exhaust the call stack.
	assert.equal(layoutSceneHierarchy(view.hierarchy, { left: 0, top: 0, right: 320, bottom: 160 }, true), true);
	assert.equal(view.hierarchy.outline.rows[6000].element.labelClipped, true);
	assert.equal(f.model.buffer.getText(), source); assert.equal(f.model.dirty, false);
});
