// Dedicated Studio YAML fixture; all mutations use ordinary Workbench input.
// npm run ide:test -- studio_test tests/ide/cart_map_context_ux.idetest.js --ttl 180
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) {
		if (character === '_') await press('ShiftLeft', 'Minus');
		else await press(character === '.' ? 'Period' : character === '/' ? 'Slash' : `Key${character.toUpperCase()}`);
	}
};
const secondary = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'secondary', down: false }]); await t.frames(3);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const openMap = async () => {
	t.command('resourceSearch'); await t.frames(2); await type('castle_map.yaml'); await press('Enter'); await t.frames(3);
	const input = t.activeWorkbenchTab();
	t.assert(input.kind === 'cart_map' && input.mapKind === 'pietious'
		&& input.workingCopy.resource.path === 'res/data/castle_map.yaml', 'Go to File did not use the dedicated map default editor');
	return input;
};
const sourceAction = () => {
	const menu = t.contextMenu();
	t.assert(menu.visible && menu.model.rows.some(row => row.command === 'editor.source' && row.enabled),
		'the actual map context did not expose its canonical Source capability');
	return menu;
};
const acceptSource = async () => {
	const menu = sourceAction(); await press('Home');
	for (let row = 0; row < menu.model.rows.length && menu.model.rows[menu.model.selectedIndex]?.command !== 'editor.source'; row++) await press('ArrowDown');
	t.assert(menu.model.rows[menu.model.selectedIndex]?.command === 'editor.source', 'keyboard menu navigation did not reach Source');
	await press('Enter'); await t.frames(3);
};

await t.waitForCart(); await t.frames(90);
await press('ControlRight', 'ShiftRight'); await t.frames(3);
t.assert(t.workbenchActive(), 'the ordinary host shortcut did not enter Workbench');
const input = await openMap(), model = input.workingCopy;
t.command('keepEditor'); await t.frames(2);
const source = model.buffer.getText(), version = model.version, history = model.history;
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
// Keep an actual Source view with a deliberately unrelated caret. Opening or
// cancelling map menus must not redirect that hidden editor's current reading.
t.command('editor.source'); await t.frames(3); t.command('keepEditor');
const code = t.activeWorkbenchTab();
t.assert(code.kind === 'code_editor' && code.workingCopy === model, 'Source setup did not share the canonical YAML working copy');
let caret;
const leaveSourceAtEnd = async () => {
	await press('ControlLeft', 'End');
	caret = { row: code.context.view.cursorRow, column: code.context.view.cursorColumn };
	t.assert(await openMap() === input, 'returning through Go to File replaced the retained map input');
};
await leaveSourceAtEnd();
const unchanged = () => {
	t.assert(model.buffer.getText() === source && model.version === version && model.history === history && !model.dirty,
		'context navigation mutated canonical YAML, history or clean state');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'authored map context navigation executed or replaced the paused guest');
};
const hiddenCaretUnchanged = () => t.assert(code.context.view.cursorRow === caret.row && code.context.view.cursorColumn === caret.column,
	'opening or cancelling a map context redirected the hidden Source caret');
const cancelled = async () => {
	const owner = sourceAction().invocationOrigin;
	await press('Escape');
	t.assert(!t.contextMenu().visible && t.activeWorkbenchTab() === input && owner.hasFocus,
		'cancelling the map context did not restore its exact invoking client');
	hiddenCaretUnchanged(); unchanged();
};
const openedSource = async range => {
	const position = { row: 0, column: 0 }; model.buffer.positionAt(range.start, position);
	await acceptSource();
	t.assert(t.activeWorkbenchTab() === code && code.workingCopy === model && t.activeEditorDocument().model === model
		&& t.activeEditorDocument().focusTarget.hasFocus, 'Source did not reuse and focus its own canonical YAML view');
	// Exact producer-to-caret correspondence is the navigation data contract.
	t.assert(code.context.view.cursorRow === position.row && code.context.view.cursorColumn === position.column,
		'the context opened Source at another map occurrence');
	unchanged();
};
const tree = input.tree, fonts = new Set();
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		const variant = input.layout.font.variant; fonts.add(variant);
		const label = `cart-map-context-${variant}-${theme}`;
		t.command('cartMap.outline'); await t.frames(2);
		await press('Home'); await press('ArrowRight');
		const target = tree.roots[0].children[1], index = tree.rows.indexOf(target);
		const y = tree.layout.contentTop + (index - (tree.scroll | 0) + 0.5) * tree.layout.rowHeight;
		await secondary(tree.layout.contentRight - 6, y);
		sourceAction();
		t.assert(tree.rows[tree.selectionIndex] === target && input.selected === target.element.item,
			'outline secondary press did not select its actual authored target');
		await capture(`${label}-outline-pointer`); await cancelled();
		for (const keys of [['ContextMenu'], ['ShiftLeft', 'F10']]) {
			await press(...keys); sourceAction(); hiddenCaretUnchanged(); await cancelled();
		}
		await press('ShiftLeft', 'F10'); await openedSource(target.element.range);
		await capture(`${label}-outline-source`); await leaveSourceAtEnd();

		t.command('cartMap.map'); await t.frames(2);
		const grid = input.grid, marker = grid.content.markers[0];
		const x = grid.bounds.left + (marker.x + 0.5) * grid.cellSize - grid.horizontal.getScroll();
		const gy = grid.bounds.top + (marker.y + 0.5) * grid.cellSize - grid.vertical.getScroll();
		await secondary(x, gy); sourceAction();
		t.assert(input.selected === marker && tree.rows[tree.selectionIndex].element.item === marker,
			'grid secondary press did not select its own source occurrence without dragging');
		await capture(`${label}-grid-pointer`); await cancelled();
		for (const keys of [['ContextMenu'], ['ShiftLeft', 'F10']]) {
			await press(...keys); sourceAction(); hiddenCaretUnchanged(); await cancelled();
		}
		const range = { ...input.selectionRange };
		await press('ContextMenu'); await openedSource(range);
		await capture(`${label}-grid-source`); await leaveSourceAtEnd();
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(3);
}
t.assert(fonts.size === 2, 'the dedicated map captures did not exercise both existing font variants');
unchanged(); hiddenCaretUnchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `map context workflow logged an error: ${t.logMessage(index).message}`);
t.log('Completed dedicated-map RMB, ContextMenu, Shift+F10, cancel/focus and exact canonical Source navigation in both fonts/themes.');
