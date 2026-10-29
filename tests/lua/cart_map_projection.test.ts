import { pointerCapture } from '../../ide/input/pointer/capture';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';

import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { CartMapPane } from '../../ide/workbench/contrib/cart_maps/editor_pane';
import { projectCartMap, selectCartMapRow, createCartMapMove } from '../../ide/workbench/contrib/cart_maps/source_projection';
import { captureCartMapView, restoreCartMapView, CartMapNavigationSelection } from '../../ide/workbench/contrib/cart_maps/view_snapshot';
import { inputFocus } from '../../ide/input/focus';

import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { createScenarioTestSourceState } from '../helpers/scenario_sources';
import { WorkbenchSurfaceService } from '../../ide/workbench/services/windows/service';

const SOURCE = [
	'2:', "  map: ['....', '....']",
	'  objects:', '  - { type: rock, x: 1, y: 0 } # selected object',
	'  - { type: rock, x: 2, y: 1 } # same name, distinct source',
	'7:', "  map: ['..']", '',
].join('\n');

function fixture(source = SOURCE, kind: 'pietious' | 'nemesis' = 'pietious') {
	configureFontVariant('tiny');
	const path = kind === 'pietious' ? 'res/data/castle_map.yaml' : 'res/data/nemesis_s_stage.yaml';
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace' as const, path }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, source: { resid: 'map', type: 'data' } }, 'yaml', source);
	const input = new CartMapInput(model, kind);
	projectCartMap(input);
	return { model, input };
}

test('map projection retains source identity, not object ordinal or type', t => {
	const { model, input } = fixture();
	t.after(() => { input.dispose(); model.dispose(); });
	selectCartMapRow(input, 1);
	const original = input.selectionRange.start;
	const prefix = '  - { type: rock, x: 0, y: 1 } # new object\n';
	model.pushEditOperations([{ offset: SOURCE.indexOf('  -'), deleteLength: 0, text: prefix }]);
	projectCartMap(input);
	assert.equal(input.selectionRange.start, original + prefix.length);
	assert.equal(input.selected!.x, 1);
	assert.ok(input.selected?.kind === 'object');
	assert.equal(input.selected.source.index, 1);
	const range = input.selectionRange;
	model.pushEditOperations([{ offset: range.start, deleteLength: range.end - range.start, text: '{ type: rock, x: 3, y: 1 }' }]);
	projectCartMap(input);
	assert.equal(input.selected, undefined);
	model.undo();
	projectCartMap(input);
	assert.equal(input.selected, undefined, 'undo must not attach a removed source selection to newly inserted text');
});

test('map coordinates use the same source history and reject stale proposals', t => {
	const { model, input } = fixture();
	t.after(() => { input.dispose(); model.dispose(); });
	selectCartMapRow(input, 1);
	const edit = createCartMapMove(input.selected!, 3, 1, input.editSource);
	model.history.applyEdits(new Map([[model, edit]]));
	projectCartMap(input);
	assert.equal(model.buffer.getText(), SOURCE.replace('x: 1, y: 0', 'x: 3, y: 1'));
	assert.deepEqual([input.selected!.x, input.selected!.y], [3, 1]);
	model.undo(input.editSource); projectCartMap(input);
	assert.equal(model.buffer.getText(), SOURCE);
	assert.deepEqual([input.selected!.x, input.selected!.y], [1, 0]);
	model.redo(input.editSource); projectCartMap(input);
	assert.deepEqual([input.selected!.x, input.selected!.y], [3, 1]);
	const current = model.buffer.getText();
	assert.throws(() => model.history.applyEdits(new Map([[model, edit]])));
	assert.equal(model.buffer.getText(), current);
});

test('marker moves restore source selection through shared undo/redo, including escaped cells', t => {
	for (const source of ['map_rows: ["\\x6d \\x20 "]\n', 'map_rows: [" \\x20 \\x6d"]\n']) {
		const { model, input } = fixture(source, 'nemesis');
		t.after(() => { input.dispose(); model.dispose(); });
		selectCartMapRow(input, 1);
		const before = { ...input.selectionRange }, x = input.selected!.x;
		const destination = x === 0 ? 2 : 1;
		model.history.applyEdits(new Map([[model, createCartMapMove(input.selected!, destination, 0, input.editSource)]]));
		projectCartMap(input);
		assert.equal(input.selected!.x, destination);
		const after = { ...input.selectionRange };
		assert.equal(model.buffer.getText().slice(after.start, after.end), 'm');
		selectCartMapRow(input, -1);
		model.undo(input.editSource); projectCartMap(input);
		assert.equal(model.buffer.getText(), source);
		assert.equal(input.selected!.x, x);
		assert.deepEqual(input.selectionRange, before);
		model.redo(input.editSource); projectCartMap(input);
		assert.equal(input.selected!.x, destination);
		assert.deepEqual(input.selectionRange, after);
		// Unrelated text replacement is not a move and must not reattach by glyph.
		model.pushEditOperations([{ offset: after.start, deleteLength: after.end - after.start, text: 'M' }]);
		projectCartMap(input);
		assert.equal(input.selected, undefined);
		model.undo(input.editSource); projectCartMap(input);
		assert.equal(input.selected, undefined);
	}
});

test('stationary map projection retains parsed nodes without rereading the source', t => {
	const { model, input } = fixture();
	t.after(() => { input.dispose(); model.dispose(); });
	const roots = input.tree.roots.slice(), rows = input.tree.rows.slice(), grid = input.grid.content;
	t.mock.method(model.buffer, 'getText', () => assert.fail('unchanged projection read the source'));
	for (let iteration = 0; iteration < 100; iteration++) projectCartMap(input);
	assert.deepEqual(input.tree.roots, roots);
	assert.ok(input.tree.roots.every((root, index) => root === roots[index]));
	assert.ok(input.tree.rows.every((row, index) => row === rows[index]));
	assert.equal(input.grid.content, grid);
});

test('clearing map selection retains the sheet and its scroll in view recovery', t => {
	const { model, input } = fixture();
	t.after(() => { input.dispose(); model.dispose(); });
	selectCartMapRow(input, 1);
	input.grid.layout(0, 0, 20, 20);
	input.grid.horizontal.setScroll(8);
	input.grid.vertical.setScroll(4);
	const content = input.grid.content;
	selectCartMapRow(input, -1);
	assert.equal(input.grid.content, content);
	assert.equal(input.grid.selected, undefined);
	const snapshot = captureCartMapView(input);
	const other = new CartMapInput(model, 'pietious');
	t.after(() => other.dispose());
	restoreCartMapView(other, snapshot);
	assert.equal(other.activeSheet, input.activeSheet);
	assert.equal(other.selected, undefined);
	assert.deepEqual(other.grid.content!.rows, content!.rows);
	assert.equal(other.restoredTreeScroll, snapshot.treeScroll);
	assert.deepEqual(other.grid.captureView(), snapshot.grid);
	const firstRoom = new CartMapNavigationSelection(input);
	selectCartMapRow(other, other.tree.rows.indexOf(other.tree.roots[1]));
	selectCartMapRow(other, -1);
	const secondRoom = new CartMapNavigationSelection(other);
	t.after(() => { firstRoom.dispose(); secondRoom.dispose(); });
	assert.equal(firstRoom.matches(secondRoom), false, 'navigation retains distinct rooms even without a selected object');
});

test('invalid source revokes the map projection and recovers from ordinary text undo', t => {
	const { model, input } = fixture();
	t.after(() => { input.dispose(); model.dispose(); });
	selectCartMapRow(input, 1);
	model.pushEditOperations([{ offset: 0, deleteLength: SOURCE.length, text: '2: [broken\n' }]);
	projectCartMap(input);
	assert.equal(input.selected, undefined);
	assert.notEqual(input.diagnostic, null);
	assert.equal(input.grid.content, undefined);
	model.undo(); projectCartMap(input);
	assert.equal(input.diagnostic, null);
	assert.equal(input.selected, undefined);
	assert.equal(input.tree.roots.length, 2);
});

test('map viewport can reveal signed object positions outside the authored tile rectangle', t => {
	const { model, input } = fixture();
	t.after(() => { input.dispose(); model.dispose(); });
	selectCartMapRow(input, 1);
	model.history.applyEdits(new Map([[model, createCartMapMove(input.selected!, -3, -2, input.editSource)]]));
	projectCartMap(input);
	const grid = input.grid;
	grid.layout(40, 20, 80, 60);
	grid.reveal(input.selected!);
	const x = grid.bounds.left - 3 * grid.cellSize - grid.horizontal.getScroll() + 1;
	const y = grid.bounds.top - 2 * grid.cellSize - grid.vertical.getScroll() + 1;
	assert.ok(x >= grid.bounds.left && x < grid.bounds.right);
	assert.ok(y >= grid.bounds.top && y < grid.bounds.bottom);
	assert.equal(grid.columnAt(x), -3);
	assert.equal(grid.rowAt(y), -2);
	const before = model.buffer.getText();
	selectCartMapRow(input, -1);
	assert.equal(model.buffer.getText(), before);
	assert.equal(grid.content!.markers[0].x, -3);
});

test('accepted map moves and focused history reveal the restored member in both views', t => {
	const cells = Array<string>(501).fill(' ');
	cells[1] = 'm';
	for (let column = 10; column < 400; column += 10) cells[column] = 'm';
	const { model, input } = fixture(`map_rows: ["${cells.join('')}"]\n`, 'nemesis');
	const bounds = { left: 0, top: 0, right: 320, bottom: 200 }, surfaces = new WorkbenchSurfaceService();
	const surface = surfaces.attach({ role: 'content', captureScope: Symbol('map fixture'), getBounds: () => bounds, getClip: () => bounds, isVisible: () => true, draw() {} });
	const menu = new ContextMenuController(inputFocus, pointerCapture, bounds);
	t.after(() => menu.dispose());
	const pane = new CartMapPane(null!,
		{ isEnabled: () => false, execute: () => assert.fail('unexpected action bar command') }, createScenarioTestSourceState([]), surfaces, surface, bounds, inputFocus.workbenchScope, menu);
	t.after(() => {
		inputFocus.setTarget(null);
		pane.clearInput(); pane.dispose(); input.dispose(); model.dispose();
		surfaces.dispose();

	});
	pane.setInput(input, { left: 0, top: 0, right: 320, bottom: 200 });
	selectCartMapRow(input, 1); pane.update();
	setFieldText(pane.controls[0].field, '400', false);
	assert.equal(pane.controls[0].commit(), true);
	pane.focus();
	for (const [command, x] of [[undefined, 400], ['undo', 1], ['redo', 400]] as const) {
		if (command !== undefined) inputFocus.executeCommand(command);
		assert.equal(input.selected!.x, x);
		const { grid, tree } = input;
		const left = grid.bounds.left + x * grid.cellSize - grid.horizontal.getScroll();
		assert.ok(left >= grid.bounds.left && left + grid.cellSize <= grid.bounds.right);
		assert.ok(tree.selectionIndex >= tree.scroll && tree.selectionIndex < tree.scroll + tree.layout.visibleRowCount);
	}
	input.grid.horizontal.setScroll(0);
	input.tree.scroll = 0;
	pane.update();
	assert.equal(input.grid.horizontal.getScroll(), 0, 'ordinary updates preserve user panning');
	assert.equal(input.tree.scroll, 0, 'ordinary updates preserve outline scrolling');
});

test('two map inputs share authored moves without sharing the invoking view selection', t => {
	const { model, input } = fixture();
	const sibling = new CartMapInput(model, 'pietious');
	t.after(() => { input.dispose(); sibling.dispose(); model.dispose(); });
	projectCartMap(sibling);
	selectCartMapRow(input, 1);
	selectCartMapRow(sibling, 2);
	assert.equal(sibling.selected!.x, 2);
	const siblingSelection = { ...sibling.selectionRange };
	model.history.applyEdits(new Map([[model, createCartMapMove(input.selected!, 3, 1, input.editSource)]]));
	projectCartMap(input); projectCartMap(sibling);
	assert.deepEqual([input.selected!.x, input.selected!.y], [3, 1]);
	assert.equal(sibling.selected!.x, 2);
	assert.deepEqual(sibling.selectionRange, siblingSelection);
	model.undo(input.editSource);
	projectCartMap(input); projectCartMap(sibling);
	assert.equal(model.buffer.getText(), SOURCE);
	assert.deepEqual([input.selected!.x, input.selected!.y], [1, 0]);
	assert.equal(sibling.selected!.x, 2);
	assert.deepEqual(sibling.selectionRange, siblingSelection);
	model.redo(input.editSource);
	projectCartMap(input); projectCartMap(sibling);
	assert.deepEqual([input.selected!.x, input.selected!.y], [3, 1]);
	assert.equal(sibling.selected!.x, 2);
	assert.deepEqual(sibling.selectionRange, siblingSelection);
});
