import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { CartMapPane } from '../../ide/workbench/contrib/cart_maps/editor_pane';
import { resolveCartMapInput } from '../../ide/workbench/contrib/cart_maps/controller';
import { selectCartMapRow } from '../../ide/workbench/contrib/cart_maps/source_projection';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

const SOURCE = `2:
  map: ['........', '........']
  objects:
  - { type: rock, x: 1, y: 0 }
  - { type: rock, x: 4, y: 1 }
`;

async function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny') {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const f = createActualSourcePanes(t), path = 'res/data/castle_map.yaml';
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'data', resid: 'fixture-map', source_path: path, sourcemeta: { text: SOURCE } }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	const input = await resolveCartMapInput(f.sources.catalog, resource, 'pietious'); f.firstGroup.openEditor(input);
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof CartMapPane);
	f.editor.setFontVariant(font); f.update(); pane.focus();
	assert.equal(input.tree.roots.length, 1); assert.equal(input.tree.roots[0].children.length, 2);
	const model = input.workingCopy, menu = f.editor.contextMenu;
	const pointer = (x: number, y: number, button: PointerButton) => {
		for (const down of [true, false]) f.editor.dispatchPointer({ pointerId: 0, pointerType: 'mouse', x, y, buttons: down ? button : 0,
			pressedButtons: down ? button : 0, releasedButtons: down ? 0 : button, cancelledButtons: 0,
			modifiers: KeyModifier.none, spaceDown: false, timestamp: f.host.clock.now() });
		f.update();
	};
	const rowPointer = (index: number, button: PointerButton, twistie = false) => {
		const tree = input.tree, layout = tree.layout, node = tree.rows[index];
		const x = layout.contentLeft + node.depth * layout.indentWidth + (twistie ? layout.twistieWidth / 2 : layout.indentWidth + 3);
		const y = layout.contentTop + (index - tree.scroll + 0.5) * layout.rowHeight;
		pointer(x, y, button);
	};
	const chooseSource = async () => {
		const index = menu.model.rows.findIndex(row => row.command === 'editor.source');
		assert.ok(index >= 0 && menu.model.rows[index].enabled); menu.model.selectedIndex = index;
		f.key('Enter'); await setImmediate(); f.update();
	};
	return { ...f, input, pane, model, menu, pointer, rowPointer, chooseSource };
}

for (const font of ['tiny', 'msx'] as const) test(`${font} outline RMB admits the clicked occurrence and Source opens its canonical authored position`, async t => {
	const f = await fixture(t, font), node = f.input.tree.roots[0].children[1];
	f.rowPointer(f.input.tree.rows.indexOf(node), PointerButton.Secondary);
	assert.equal(f.menu.visible, true); assert.equal(f.input.selected, node.element.item);
	assert.equal(f.menu.model.rows.filter(row => row.command === 'editor.source').length, 1);
	const expected = f.pane.getSourceLocation()!;
	assert.equal(expected.model, f.model); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
	await f.chooseSource();
	const source = f.firstGroup.model.activeTab, pane = f.firstGroup.panes.activePane;
	assert.ok(source instanceof CodeEditorInput && pane instanceof CodeEditorPane);
	assert.equal(source.workingCopy, f.model); assert.equal(pane.code.view.cursorRow, expected.selection!.row);
	assert.equal(pane.code.view.cursorColumn, expected.selection!.startColumn);
	assert.equal(f.secondGroup.model.activeTab, f.secondInput); assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} secondary twistie context never acts as primary disclosure`, async t => {
	const f = await fixture(t, font), root = f.input.tree.roots[0];
	assert.equal(root.collapsed, false); f.rowPointer(0, PointerButton.Secondary, true);
	assert.equal(root.collapsed, false); assert.equal(f.menu.visible, true);
	f.key('Escape'); assert.equal(f.menu.visible, false);
	f.rowPointer(0, PointerButton.Primary, true); assert.equal(root.collapsed, true); assert.equal(f.menu.visible, false);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('grid RMB and primary selection address the actual clicked marker without editing source', async t => {
	const f = await fixture(t), grid = f.input.grid;
	f.editor.commands.execute('cartMap.map', f.pane.commandTarget); f.update();
	const nodes = f.input.tree.roots[0].children;
	for (const [node, button] of [[nodes[0], PointerButton.Primary], [nodes[1], PointerButton.Secondary]] as const) {
		const marker = node.element.item!;
		f.pointer(grid.bounds.left - grid.horizontal.getScroll() + (marker.x + 0.5) * grid.cellSize,
			grid.bounds.top - grid.vertical.getScroll() + (marker.y + 0.5) * grid.cellSize, button);
		assert.equal(f.input.selected, marker); assert.equal(f.menu.visible, button === PointerButton.Secondary);
	}
	const origin = f.menu.invocationOrigin; f.key('Escape'); assert.equal(inputFocus.admittedTarget, origin);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('ContextMenu and Shift+F10 use the current semantic selection and Escape returns to its owning client', async t => {
	const f = await fixture(t); f.rowPointer(2, PointerButton.Primary);
	const selected = f.input.selected, range = { ...f.input.selectionRange };
	for (const [code, modifiers] of [['ContextMenu', KeyModifier.none], ['F10', KeyModifier.shift]] as const) {
		const origin = inputFocus.admittedTarget; f.key(code, modifiers);
		assert.equal(f.menu.visible, true); assert.equal(f.menu.invocationOrigin, origin);
		assert.equal(f.input.selected, selected); assert.deepEqual(f.input.selectionRange, range);
		f.key('Escape'); assert.equal(f.menu.visible, false); assert.equal(inputFocus.admittedTarget, origin);
	}
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('source changes retire both body context and More sessions before their old Source action can accept', async t => {
	const f = await fixture(t);
	for (const surface of ['body', 'more'] as const) {
		if (surface === 'body') f.rowPointer(1, PointerButton.Secondary);
		else {
			const button = f.input.actionBar.overflow!.button; assert.equal(button.visible, true);
			f.pointer((button.bounds.left + button.bounds.right) / 2, (button.bounds.top + button.bounds.bottom) / 2, PointerButton.Primary);
		}
		assert.equal(f.menu.visible, true);
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# provider edit\n' }]);
		assert.equal(f.menu.visible, false); f.update();
		assert.equal(f.firstGroup.model.activeTab, f.input);
	}
});

test('replacing or closing the exact input retires its popup rather than dispatching into a later client', async t => {
	const f = await fixture(t); f.rowPointer(1, PointerButton.Secondary); assert.equal(f.menu.visible, true);
	f.firstGroup.openEditor(f.firstInput); f.update(); assert.equal(f.menu.visible, false);
	f.firstGroup.openEditor(f.input); f.update(); f.rowPointer(1, PointerButton.Secondary); assert.equal(f.menu.visible, true);
	await f.firstGroup.close(f.input.id); f.update(); assert.equal(f.menu.visible, false);
	assert.equal(f.firstGroup.model.contains(f.input), false); assert.equal(f.model.buffer.getText(), SOURCE);
});

test('a captured Source continuation cannot retarget a later explicit map selection', async t => {
	const f = await fixture(t); f.rowPointer(1, PointerButton.Primary);
	const request = f.pane.captureSourceLocation(); assert.equal(request.isCurrent!(), true);
	selectCartMapRow(f.input, 2); f.pane.update();
	assert.equal(request.isCurrent!(), false); assert.equal(request.readLocation(), undefined);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const surface of ['body', 'more'] as const) test(`${surface} Source acceptance cannot follow another selection published during focus return`, async t => {
	const f = await fixture(t); f.rowPointer(1, PointerButton.Secondary);
	if (surface === 'more') {
		f.key('Escape');
		const button = f.input.actionBar.overflow!.button;
		f.pointer((button.bounds.left + button.bounds.right) / 2, (button.bounds.top + button.bounds.bottom) / 2, PointerButton.Primary);
	}
	assert.equal(f.menu.visible, true);
	let returned = false;
	const origin = f.menu.returnFocus!;
	const unbind = origin.onDidFocus(() => { unbind(); returned = true; selectCartMapRow(f.input, 2); });
	t.after(unbind);
	const tabs = [...f.firstGroup.model.tabs];
	await f.chooseSource();
	assert.equal(returned, true); assert.equal(f.menu.visible, false);
	assert.equal(f.firstGroup.model.activeTab, f.input);
	assert.deepEqual(f.firstGroup.model.tabs, tabs);
	assert.equal(f.input.selected, f.input.tree.roots[0].children[1].element.item);
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

test('a captured Source continuation maps an unchanged occurrence through a canonical source edit', async t => {
	const f = await fixture(t); f.rowPointer(1, PointerButton.Primary);
	const request = f.pane.captureSourceLocation(), offset = f.input.selectionRange.start, prefix = '# mapped source\n';
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: prefix }]);
	const location = await request.readLocation(), position = { row: 0, column: 0 };
	f.model.buffer.positionAt(offset + prefix.length, position);
	assert.equal(request.isCurrent!(), true); assert.equal(location!.model, f.model);
	assert.equal(location!.modelVersion, f.model.version);
	assert.deepEqual(location!.selection, { row: position.row, startColumn: position.column, endColumn: position.column });
});

test('a captured Source continuation cannot turn a deleted selected occurrence into a file-start location', async t => {
	const f = await fixture(t); f.rowPointer(1, PointerButton.Primary);
	const request = f.pane.captureSourceLocation(), selected = { ...f.input.selectionRange };
	f.model.pushEditOperations([{ offset: selected.start, deleteLength: selected.end - selected.start, text: '' }]);
	assert.equal(request.readLocation(), undefined); assert.equal(request.isCurrent!(), false);
	assert.equal(f.firstGroup.model.activeTab, f.input);
});
