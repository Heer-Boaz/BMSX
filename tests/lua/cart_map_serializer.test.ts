import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceIdentityKey } from '../../ide/common/resource';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { CartMapInputSerializer } from '../../ide/workbench/contrib/cart_maps/editor_serializer';
import { layoutCartMap } from '../../ide/workbench/contrib/cart_maps/layout';
import { createCartMapMove, projectCartMap, selectCartMapRow } from '../../ide/workbench/contrib/cart_maps/source_projection';
import { captureCartMapView } from '../../ide/workbench/contrib/cart_maps/view_snapshot';
import { setWorkbenchTreeCollapsed } from '../../ide/workbench/ui/tree_view';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';

test('inactive restored map retains its pending viewport across another session capture', async t => {
	editorViewState.font = new EditorFont('tiny');
	editorViewState.lineHeight = 6;
	const sources = createScenarioTestSourceState([]);
	const resource = { domain: 0, path: 'res/data/nemesis_s_stage.yaml', source: { resid: 'stage', type: 'data' } } as const;
	sources.resourceByIdentity.set(resourceIdentityKey(resource), resource);
	const source = `map_rows:\n${Array.from({ length: 40 }, () => `  - "m${' '.repeat(119)}"\n`).join('')}`;
	const model = editorTextModelService.retain(resource, 'yaml', source);
	const input = new CartMapInput(model, 'nemesis');
	t.after(() => { input.dispose(); editorTextModelService.clear(); });
	projectCartMap(input);
	selectCartMapRow(input, 1);
	model.history.applyEdits(new Map([[model, createCartMapMove(input.selected!, 10, 0)]]));
	projectCartMap(input);
	const bounds = { left: 0, top: 0, right: 320, bottom: 200 };
	layoutCartMap(input, bounds, true);
	input.grid.horizontal.setScroll(80);
	input.grid.vertical.setScroll(64);
	input.tree.scroll = 5;
	const expected = captureCartMapView(input);
	const authored = model.buffer.getText(), version = model.version;
	const serializer = new CartMapInputSerializer(sources);
	const restored = await serializer.deserialize(serializer.serialize(input));
	t.after(() => restored.dispose());
	assert.equal(restored.workingCopy, model);
	assert.deepEqual(restored.restoredScroll, { x: 80, y: 64, tree: 5 });
	assert.equal(restored.grid.horizontal.getScroll(), 0, 'inactive input has not been laid out');
	assert.deepEqual(captureCartMapView(restored), expected);
	const reloaded = await serializer.deserialize(serializer.serialize(restored));
	t.after(() => reloaded.dispose());
	assert.deepEqual(captureCartMapView(reloaded), expected);
	layoutCartMap(reloaded, bounds, true);
	assert.equal(reloaded.restoredScroll, undefined);
	assert.deepEqual(captureCartMapView(reloaded), expected);
	assert.equal(model.buffer.getText(), authored);
	assert.equal(model.version, version);
	assert.equal(model.dirty, true);
	assert.equal(model.canUndo, true);
	reloaded.grid.horizontal.setScroll(40);
	assert.equal(captureCartMapView(reloaded).xScroll, 40, 'laid-out input captures its current viewport');
	model.undo();
	assert.equal(model.buffer.getText(), source);
});

test('map recovery rejects a view snapshot when its canonical source changed', async t => {
	const sources = createScenarioTestSourceState([]);
	const resource = { domain: 0, path: 'res/data/nemesis_s_stage.yaml', source: { resid: 'stage', type: 'data' } } as const;
	sources.resourceByIdentity.set(resourceIdentityKey(resource), resource);
	const source = 'map_rows: ["m   "]\n';
	const model = editorTextModelService.retain(resource, 'yaml', source);
	const input = new CartMapInput(model, 'nemesis');
	t.after(() => { input.dispose(); editorTextModelService.clear(); });
	projectCartMap(input);
	selectCartMapRow(input, 1);
	const serializer = new CartMapInputSerializer(sources), serialized = serializer.serialize(input);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# authored after capture\n' }]);
	const restored = await serializer.deserialize(serialized);
	t.after(() => restored.dispose());
	assert.equal(restored.workingCopy, model);
	assert.equal(model.buffer.getText(), `# authored after capture\n${source}`);
	assert.equal(restored.restoredScroll, undefined);
	assert.equal(restored.selected, undefined);
	assert.equal(model.dirty, true);
});

test('map capture projects background history selection before saving collapsed rooms', async t => {
	const sources = createScenarioTestSourceState([]);
	const resource = { domain: 0, path: 'res/data/castle_map.yaml', source: { resid: 'map', type: 'data' } } as const;
	sources.resourceByIdentity.set(resourceIdentityKey(resource), resource);
	const source = [
		'2:', '  map: ["...."]', '  objects:', '  - { type: rock, x: 1, y: 0 }',
		'7:', '  map: ["...."]', '',
	].join('\n');
	const model = editorTextModelService.retain(resource, 'yaml', source);
	const input = new CartMapInput(model, 'pietious');
	t.after(() => { input.dispose(); editorTextModelService.clear(); });
	projectCartMap(input);
	selectCartMapRow(input, 1);
	const selection = { ...input.selectionRange };
	model.history.applyEdits(new Map([[model, createCartMapMove(input.selected!, 2, 0)]]));
	projectCartMap(input);
	setWorkbenchTreeCollapsed(input.tree, 0, true);
	selectCartMapRow(input, input.tree.rows.indexOf(input.tree.roots[1]));
	// Undo in the source tab updates the tracked selection before this hidden
	// map's retained presentation has had another pane update.
	model.undo();
	assert.deepEqual(input.selectionRange, selection);
	assert.equal(input.activeSheet, '7');
	assert.equal(input.tree.roots[0].collapsed, true);
	const serializer = new CartMapInputSerializer(sources);
	const restored = await serializer.deserialize(serializer.serialize(input));
	t.after(() => restored.dispose());
	assert.deepEqual(restored.selectionRange, selection);
	assert.equal(restored.activeSheet, '2');
	assert.equal(restored.selected!.x, 1);
	assert.equal(restored.tree.roots[0].collapsed, false);
	assert.equal(model.buffer.getText(), source);
	assert.equal(model.canRedo, true);
});
