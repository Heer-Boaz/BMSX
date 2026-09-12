import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { inputFocus } from '../../../ide/input/focus';
import { pointerCapture } from '../../../ide/input/pointer/capture';
import { getActiveTab } from '../../../ide/workbench/ui/tabs';
import { BT_ORDER_SOURCE } from '../../helpers/behavior_order_fixture';
import { chooseBehavior } from './studio_behavior_picker';
import { check, type StudioFixture } from './studio_fixture';

/** Same menu/focus/command path over actual source, graph selection and a suspended machine. */
export async function testStudioContextMenu(test: StudioFixture): Promise<void> {
	const { ide, harness, frame, press, click, cycles, movePointer, setPointerButton, setKey, runPaletteCommand } = test;
	console.info('STUDIO: shared context menu: code/node/edge/canvas, focus, source invalidation and Undo');
	const position = cycles();
	harness.openLuaSource('cart.lua');
	const code = getActiveTab();
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	const dirty = model.dirty;
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: BT_ORDER_SOURCE }]);
	await runPaletteCommand('Behavior Lens: Open Behavior Tree (BT)');
	await chooseBehavior(test, 'BT fixture.order', 'BEHAVIOR TREES');
	const lens = getActiveTab();
	if (lens.kind !== 'behavior_lens' || lens.view.presentation.kind !== 'graph') throw new Error('context menu: actual BT graph required');
	const view = lens.view.presentation.viewport;
	const menu = ide.editor.contextMenu;
	const leaf = () => view.model.nodes[0].children[0].children[0];
	const cardBounds = () => {
		const node = leaf(); view.reveal(node);
		return { left: view.bounds.left + node.bounds.left - view.scrollX,
			right: view.bounds.left + node.bounds.right - view.scrollX,
			top: view.bounds.top + node.bounds.top - view.scrollY,
			bottom: view.bounds.top + node.bounds.top + node.headerHeight - view.scrollY };
	};
	const version = model.version;
	await click(cardBounds(), 1, 'pointer_secondary');
	check(menu.visible && view.selection === leaf() && !pointerCapture.active && model.version === version,
		'context menu: right click selects exact occurrence, without dragging, expanding or changing source');
	check(menu.model.rows.filter(row => row.command !== undefined).every(row => row.enabled === ide.editor.commands.isEnabled(row.command!)),
		'context menu: actions share toolbar/palette admission for invoking graph');
	check(menu.model.bounds.left >= 0 && menu.model.bounds.right <= 384 && menu.model.bounds.bottom <= 288,
		'context menu: actual tiny-font popup fits workbench');
	await press('Escape');
	const graphFocus = inputFocus.target;
	check(!menu.visible && graphFocus !== null && graphFocus !== activeCodeEditor.focusTarget, 'context menu: Escape restores graph focus');
	await press('ShiftLeft', 'F10');
	check(menu.visible && menu.model.rows[menu.model.selectedIndex].command === 'behaviorLens.source',
		'context menu: keyboard opens on selected graph node with first enabled command');
	// Source opens on key release; a held activation cannot become typing in the destination.
	setKey('Enter', true); for (let i = 0; i < 30; i += 1) await frame();
	check(menu.visible && getActiveTab() === lens && model.version === version, 'context menu: held Source is not text input');
	setKey('Enter', false); await frame();
	check(!menu.visible && getActiveTab() === code && model.version === version,
		'context menu: keyboard Source opens exact model without source mutation');
	await test.clickTab(lens.id);
	await click(cardBounds(), 1, 'pointer_secondary');
	const remove = menu.model.rows.find(row => row.command === 'behaviorLens.removeChild')!;
	const removeBounds = { left: menu.model.viewport.bounds.left, right: menu.model.viewport.bounds.right,
		top: menu.model.viewport.offsetTop + remove.top, bottom: menu.model.viewport.offsetTop + remove.bottom };
	movePointer(removeBounds); await frame(); setPointerButton('pointer_primary', true); await frame();
	check(model.version === version && pointerCapture.active, 'context menu: Remove waits for physical release');
	setPointerButton('pointer_primary', false); await frame();
	check(!menu.visible && view.model.nodes[0].children[0].children.length === 2, 'context menu: accepted Remove edits canonical Lua');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === BT_ORDER_SOURCE && view.model.nodes[0].children[0].children.length === 3,
		'context menu: restored graph focus uses shared working-copy Undo');
	await click(cardBounds(), 1, 'pointer_secondary');
	const before = model.version;
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- context invalidation\n' }]);
	await frame();
	check(!menu.visible && inputFocus.target === graphFocus, 'context menu: source changes revoke target and return focus');
	await press('ControlLeft', 'KeyZ');
	check(model.version > before && model.buffer.getText() === BT_ORDER_SOURCE, 'context menu: invalidation itself adds no history');
	// Empty canvas must not keep the previous node as an edit target.
	view.pan(-1000, -1000); await frame();
	await click({ left: view.bounds.left + 2, right: view.bounds.left + 3, top: view.bounds.top + 2, bottom: view.bounds.top + 3 }, 1, 'pointer_secondary');
	check(menu.visible && view.selection === null && menu.model.rows.some(row => row.command === 'undo' && row.enabled)
		&& menu.model.rows.every(row => row.command === 'undo' || row.command === 'redo'),
		'context menu: canvas is its own target, not the previously selected node');
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	check(!menu.visible && ide.editor.quickInput.visible, 'context menu: command palette replaces popup through normal focus ownership');
	await press('Escape');
	await test.clickTab(code.id);
	await press('ContextMenu');
	check(menu.visible && inputFocus.target === menu.focusTarget, 'context menu: keyboard route also belongs to code control');
	await press('Escape');
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && model.dirty === dirty && cycles() === position,
		'context menu: fixture edits undo completely; menus do not dirty source or advance paused machine');
}
