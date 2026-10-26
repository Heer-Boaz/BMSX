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
	const resource = { location: { kind: 'workspace' as const, path: 'res/data/nemesis_s_stage.yaml' }, domain: 0, path: 'res/data/nemesis_s_stage.yaml', source: { resid: 'stage', type: 'data' } } as const;
	sources.resourceByIdentity.set(resourceIdentityKey(resource), resource);
	const source = `map_rows:\n${Array.from({ length: 40 }, () => `  - "m${' '.repeat(119)}"\n`).join('')}`;
	const model = editorTextModelService.retain(resource, 'yaml', source);
	const input = new CartMapInput(model, 'nemesis');
	t.after(() => { input.dispose(); editorTextModelService.clear(); });
	projectCartMap(input);
	selectCartMapRow(input, 1);
	input.section = 'map';
	model.history.applyEdits(new Map([[model, createCartMapMove(input.selected!, 10, 0, input.editSource)]]));
	projectCartMap(input);
	const bounds = { left: 0, top: 0, right: 320, bottom: 200 };
	layoutCartMap(input, bounds, true);
	input.grid.restoreView({ x: 10.25, y: 8.5 });
	layoutCartMap(input, bounds, false);
	input.tree.scroll = 5;
	const expected = captureCartMapView(input);
	const authored = model.buffer.getText(), version = model.version;
	const serializer = new CartMapInputSerializer(sources);
	const restored = await serializer.deserialize(serializer.serialize(input));
	t.after(() => restored.dispose());
	assert.equal(restored.workingCopy, model);
	assert.equal(restored.restoredTreeScroll, 5);
	assert.equal(restored.section, 'map');
	assert.deepEqual(restored.grid.captureView(), { x: 10.25, y: 8.5 });
	assert.equal(restored.grid.horizontal.getScroll(), 0, 'inactive input has not been laid out');
	assert.deepEqual(captureCartMapView(restored), expected);
	const reloaded = await serializer.deserialize(serializer.serialize(restored));
	t.after(() => reloaded.dispose());
	assert.deepEqual(captureCartMapView(reloaded), expected);
	layoutCartMap(reloaded, bounds, true);
	assert.equal(reloaded.restoredTreeScroll, undefined);
	assert.deepEqual(captureCartMapView(reloaded), expected);
	assert.equal(model.buffer.getText(), authored);
	assert.equal(model.version, version);
	assert.equal(model.dirty, true);
	assert.equal(model.canUndo, true);
	reloaded.grid.restoreView({ x: 5.25, y: 8.5 });
	layoutCartMap(reloaded, bounds, false);
	assert.deepEqual(captureCartMapView(reloaded).grid, { x: 5.25, y: 8.5 }, 'laid-out input captures its actual world-cell viewport');
	model.undo();
	assert.equal(model.buffer.getText(), source);
});

test('map recovery rejects a view snapshot when its canonical source changed', async t => {
	const sources = createScenarioTestSourceState([]);
	const resource = { location: { kind: 'workspace' as const, path: 'res/data/nemesis_s_stage.yaml' }, domain: 0, path: 'res/data/nemesis_s_stage.yaml', source: { resid: 'stage', type: 'data' } } as const;
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
	assert.equal(restored.restoredTreeScroll, undefined);
	assert.equal(restored.section, 'outline');
	assert.equal(restored.selected, undefined);
	assert.equal(model.dirty, true);
});

for (const variant of ['tiny', 'msx'] as const) for (const section of ['outline', 'map'] as const)
	test(`${variant} restored ${section} consumes only the first visible Cart Map client bookmark`, async t => {
		editorViewState.font = new EditorFont(variant);
		editorViewState.lineHeight = editorViewState.font.lineHeight;
		const sources = createScenarioTestSourceState([]);
		const resource = { location: { kind: 'workspace' as const, path: 'res/data/nemesis_s_stage.yaml' }, domain: 0, path: 'res/data/nemesis_s_stage.yaml', source: { resid: 'stage', type: 'data' } } as const;
		sources.resourceByIdentity.set(resourceIdentityKey(resource), resource);
		const source = `map_rows:\n${Array.from({ length: 60 }, () => `  - "m${' '.repeat(119)}"\n`).join('')}`;
		const model = editorTextModelService.retain(resource, 'yaml', source), input = new CartMapInput(model, 'nemesis'), version = model.version;
		t.after(() => { input.dispose(); editorTextModelService.clear(); });
		projectCartMap(input); selectCartMapRow(input, 1);
		const wide = { left: 17, top: 29, right: 617, bottom: 249 };
		layoutCartMap(input, wide, true);
		input.grid.restoreView({ x: 17.25, y: 12.5 }); layoutCartMap(input, wide, false);
		input.tree.scroll = 7.25; input.section = section;
		const expected = captureCartMapView(input), serializer = new CartMapInputSerializer(sources);
		const restored = await serializer.deserialize(serializer.serialize(input)); t.after(() => restored.dispose());
		const narrow = { ...wide, right: wide.left + (variant === 'tiny' ? 78 : 118) };
		layoutCartMap(restored, narrow, true);
		assert.equal(restored.layout.mode, section);
		assert.deepEqual(captureCartMapView(restored), expected, 'a hidden client cannot replace its saved world or tree position');
		const again = await serializer.deserialize(serializer.serialize(restored)); t.after(() => again.dispose());
		assert.deepEqual(captureCartMapView(again), expected, 'capturing before the other client opens preserves the same complete memento');
		if (section === 'outline') {
			assert.equal(restored.restoredTreeScroll, undefined);
			restored.tree.scroll = 2.5;
			restored.section = 'map'; layoutCartMap(restored, narrow, false);
			assert.deepEqual(restored.grid.captureView(), expected.grid);
			assert.equal(restored.tree.scroll, 2.5, 'showing the map cannot replay a consumed tree bookmark');
		} else {
			assert.equal(restored.restoredTreeScroll, expected.treeScroll);
			restored.grid.restoreView({ x: 19.75, y: 14.25 }); layoutCartMap(restored, narrow, false);
			restored.section = 'outline'; layoutCartMap(restored, narrow, false);
			assert.equal(restored.restoredTreeScroll, undefined); assert.equal(restored.tree.scroll, expected.treeScroll);
			assert.deepEqual(restored.grid.captureView(), { x: 19.75, y: 14.25 }, 'showing the tree cannot replay a consumed map bookmark');
		}
		assert.equal(restored.workingCopy, model);
		assert.deepEqual(restored.selected!.source.range, input.selected!.source.range, 'restoration projects the exact canonical source occurrence');
		assert.deepEqual(restored.selectionRange, input.selectionRange);
		assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.dirty, false); assert.equal(model.canUndo, false);
	});

test('Source undo preserves a background map view selection and collapsed room', async t => {
	const sources = createScenarioTestSourceState([]);
	const resource = { location: { kind: 'workspace' as const, path: 'res/data/castle_map.yaml' }, domain: 0, path: 'res/data/castle_map.yaml', source: { resid: 'map', type: 'data' } } as const;
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
	model.history.applyEdits(new Map([[model, createCartMapMove(input.selected!, 2, 0, input.editSource)]]));
	projectCartMap(input);
	setWorkbenchTreeCollapsed(input.tree, 0, true);
	selectCartMapRow(input, input.tree.rows.indexOf(input.tree.roots[1]));
	const selection = { ...input.selectionRange };
	// Source Undo maps this hidden view's current room; it does not consume the
	// map editor's explicit object-selection history.
	model.undo();
	assert.deepEqual(input.selectionRange, selection);
	assert.equal(input.activeSheet, '7');
	assert.equal(input.tree.roots[0].collapsed, true);
	const serializer = new CartMapInputSerializer(sources);
	const restored = await serializer.deserialize(serializer.serialize(input));
	t.after(() => restored.dispose());
	assert.deepEqual(restored.selectionRange, selection);
	assert.equal(restored.activeSheet, '7');
	assert.equal(restored.selected, undefined);
	assert.equal(restored.tree.roots[0].collapsed, true);
	assert.equal(model.buffer.getText(), source);
	assert.equal(model.canRedo, true);
});

test('an outline-selected far marker keeps its queued reveal through serialization until the map first opens', async t => {
	editorViewState.font = new EditorFont('tiny'); editorViewState.lineHeight = editorViewState.font.lineHeight;
	const sources = createScenarioTestSourceState([]);
	const resource = { location: { kind: 'workspace' as const, path: 'res/data/nemesis_s_stage.yaml' }, domain: 0, path: 'res/data/nemesis_s_stage.yaml', source: { resid: 'stage', type: 'data' } } as const;
	sources.resourceByIdentity.set(resourceIdentityKey(resource), resource);
	const cells = Array<string>(300).fill(' '); cells[257] = 'm';
	const source = `map_rows: ["${cells.join('')}"]\n`;
	const model = editorTextModelService.retain(resource, 'yaml', source), input = new CartMapInput(model, 'nemesis'), version = model.version;
	t.after(() => { input.dispose(); editorTextModelService.clear(); });
	projectCartMap(input);
	const bounds = { left: 19, top: 27, right: 97, bottom: 245 };
	layoutCartMap(input, bounds, true); assert.equal(input.layout.mode, 'outline');
	input.grid.restoreView({ x: 2.25, y: 0 });
	selectCartMapRow(input, input.tree.rows.findIndex(row => row.element.item?.x === 257));
	input.grid.reveal(input.selected!);
	const selectedRange = { ...input.selectionRange }, expected = captureCartMapView(input);
	assert.deepEqual(expected.grid, { x: 2.25, y: 0, reveal: { x: 257, y: 0 } });
	const serializer = new CartMapInputSerializer(sources), restored = await serializer.deserialize(serializer.serialize(input));
	t.after(() => restored.dispose());
	assert.equal(restored.workingCopy, model); assert.deepEqual(captureCartMapView(restored), expected);
	layoutCartMap(restored, bounds, true);
	assert.equal(restored.layout.mode, 'outline'); assert.deepEqual(captureCartMapView(restored), expected,
		'recapturing a restored hidden map cannot consume its queued selection reveal');
	restored.section = 'map'; layoutCartMap(restored, bounds, false);
	const grid = restored.grid, left = grid.bounds.left + restored.selected!.x * grid.cellSize - grid.horizontal.getScroll();
	assert.ok(left >= grid.bounds.left && left + grid.cellSize <= grid.bounds.right, 'the first real map layout reveals the exact selected cell');
	assert.equal(grid.captureView().reveal, undefined); assert.equal(restored.selected!.x, 257);
	assert.deepEqual(restored.selectionRange, selectedRange); assert.equal(restored.workingCopy, model);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.dirty, false); assert.equal(model.canUndo, false);
});
